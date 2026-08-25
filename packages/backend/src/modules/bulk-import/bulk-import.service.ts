import { BadRequestException, Injectable } from '@nestjs/common';
import { PaymentStatus, UserRole } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { hashPassword } from '../auth/utils/password.util';
import { dateOnlyInDarEsSalaam } from '../ownership-plan/ownership-plan.derivation';
import { generatePlaceholderPassword } from './bulk-import.placeholder';
import { parseWorkbook } from './bulk-import.parser';
import {
  ExistingDbState,
  computeCanCommit,
  toSheetResults,
  validateWorkbook,
  ValidatedWorkbook,
} from './bulk-import.validator';
import {
  BulkImportCommitCounts,
  BulkImportCommitResult,
  BulkImportPreviewResult,
} from './bulk-import.types';

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// The opening-balance assignment's date - the calendar day immediately
// before billingStartDate, computed with the same Africa/Dar_es_Salaam
// day-boundary constant derivation.ts exports, never a second hardcoded
// offset (Stage BI1 spec).
function dayBefore(isoDateString: string): Date {
  const d = new Date(`${isoDateString}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d;
}

// Minimal shape both this.prisma.client and a $transaction callback's `tx`
// satisfy - only the handful of model delegates this module touches.
type ImportClient = Pick<
  PrismaService['client'],
  'motorcycle' | 'driver' | 'ownershipPlan' | 'user' | 'dailyAssignment' | 'dailyPayment'
>;

@Injectable()
export class BulkImportService {
  constructor(private readonly prisma: PrismaService) {}

  private async fetchExistingState(client: ImportClient): Promise<ExistingDbState> {
    const [motorcycles, drivers, plans] = await Promise.all([
      client.motorcycle.findMany({
        select: { id: true, registrationNumber: true, vehicleType: true },
      }),
      client.driver.findMany({
        select: { id: true, userId: true, nationalId: true, user: { select: { phone: true } } },
      }),
      client.ownershipPlan.findMany({
        select: { id: true, driverId: true, motorcycleId: true },
      }),
    ]);

    return {
      motorcycles,
      drivers: drivers.map((d) => ({
        id: d.id,
        userId: d.userId,
        phone: d.user.phone,
        nationalId: d.nationalId,
      })),
      plans,
    };
  }

  private async parseAndValidate(
    file: Express.Multer.File,
    client: ImportClient,
  ): Promise<ValidatedWorkbook> {
    if (!file) {
      throw new BadRequestException('A workbook file is required');
    }
    const parsed = await parseWorkbook(file.buffer);
    const existing = await this.fetchExistingState(client);
    const todayIso = isoDate(dateOnlyInDarEsSalaam(new Date()));
    return validateWorkbook(parsed, existing, todayIso);
  }

  private buildPreview(validated: ValidatedWorkbook): BulkImportPreviewResult {
    return { sheets: toSheetResults(validated), canCommit: computeCanCommit(validated) };
  }

  /**
   * POST /bulk-import/preview (§4) - parses and fully validates the workbook
   * and returns a per-sheet, per-row result. Writes nothing: reads run
   * through this.prisma.client directly, no $transaction, nothing ever
   * reaches a create/update call.
   */
  async preview(file: Express.Multer.File): Promise<BulkImportPreviewResult> {
    const validated = await this.parseAndValidate(file, this.prisma.client);
    return this.buildPreview(validated);
  }

  /**
   * POST /bulk-import/commit (§4) - re-parses and re-validates the exact
   * same file from scratch (never trusts a prior preview call - there is no
   * server-side session between the two, see bulk-import.types.ts), inside
   * one transaction. Any row still showing an error aborts before a single
   * write happens; a write that fails mid-transaction (a race since preview,
   * or since the top of this same commit) rolls back everything already
   * written in this call - nothing partially imported.
   */
  async commit(
    file: Express.Multer.File,
    actor: AuthenticatedUser,
  ): Promise<BulkImportCommitResult> {
    return this.prisma.client.$transaction(async (tx) => {
      const validated = await this.parseAndValidate(file, tx);
      const preview = this.buildPreview(validated);
      if (!preview.canCommit) {
        throw new BadRequestException(
          'Cannot commit: some rows still have errors. Fix them and preview again.',
        );
      }

      const counts: BulkImportCommitCounts = {
        vehiclesCreated: 0,
        vehiclesUpdated: 0,
        driversCreated: 0,
        driversUpdated: 0,
        ownershipPlansCreated: 0,
        ownershipPlansUpdated: 0,
      };

      // --- Vehicles, then Drivers - no dependency between the two (§4). ---
      const motorcycleIdByReg = new Map<string, string>();
      for (const v of validated.vehicles) {
        if (v.existingId) {
          await tx.motorcycle.update({
            where: { id: v.existingId },
            data: {
              vehicleType: v.vehicleType,
              make: v.make,
              model: v.model,
              year: v.year,
              chassisNumber: v.chassisNumber,
              colour: v.colour,
            },
          });
          motorcycleIdByReg.set(v.registrationNumber, v.existingId);
          counts.vehiclesUpdated += 1;
        } else {
          const created = await tx.motorcycle.create({
            data: {
              tenantId: actor.tenantId,
              registrationNumber: v.registrationNumber,
              vehicleType: v.vehicleType,
              make: v.make,
              model: v.model,
              year: v.year,
              chassisNumber: v.chassisNumber,
              colour: v.colour,
            },
          });
          motorcycleIdByReg.set(v.registrationNumber, created.id);
          counts.vehiclesCreated += 1;
        }
      }

      const driverIdByPhone = new Map<string, string>();
      for (const d of validated.drivers) {
        if (d.existingId && d.existingUserId) {
          await tx.user.update({
            where: { id: d.existingUserId },
            data: { firstName: d.firstName, lastName: d.lastName, phone: d.phone },
          });
          await tx.driver.update({
            where: { id: d.existingId },
            data: {
              nationalId: d.nationalId,
              emergencyContact: d.emergencyContact,
              residenceWard: d.residenceWard,
              residenceDistrict: d.residenceDistrict,
              residenceRegion: d.residenceRegion,
              driverType: d.driverType,
            },
          });
          driverIdByPhone.set(d.phone, d.existingId);
          counts.driversUpdated += 1;
        } else {
          const passwordHash = await hashPassword(generatePlaceholderPassword());
          const user = await tx.user.create({
            data: {
              tenantId: actor.tenantId,
              email: d.email,
              phone: d.phone,
              passwordHash,
              role: UserRole.RIDER,
              firstName: d.firstName,
              lastName: d.lastName,
              isActive: true,
            },
          });
          const driver = await tx.driver.create({
            data: {
              tenantId: actor.tenantId,
              userId: user.id,
              // licensePlaceholder is always set for a brand-new driver row
              // (bulk-import.validator.ts) - never null here.
              licenseNumber: d.licensePlaceholder as string,
              nationalId: d.nationalId,
              emergencyContact: d.emergencyContact,
              residenceWard: d.residenceWard,
              residenceDistrict: d.residenceDistrict,
              residenceRegion: d.residenceRegion,
              driverType: d.driverType,
            },
          });
          driverIdByPhone.set(d.phone, driver.id);
          counts.driversCreated += 1;
        }
      }

      // --- Assignments sheet writes nothing of its own: every row on it is
      // 'reference' or 'error' status (bulk-import.validator.ts) - it exists
      // only to infer driverType (already folded into the Drivers writes
      // above) and to help a re-reading owner see the roster they typed
      // matched. ---

      // --- Ownership plans last - needs both maps above, whether the
      // driver/vehicle was just created or already existed. ---
      const now = new Date();
      for (const p of validated.ownershipPlans) {
        const driverId = driverIdByPhone.get(p.driverPhone);
        const motorcycleId = motorcycleIdByReg.get(p.vehicleRegistrationNumber);
        if (!driverId || !motorcycleId) {
          // Guarded against by validateWorkbook (every row either resolves
          // both or is already 'error', which would have failed the
          // preview.canCommit check above) - defensive only.
          throw new BadRequestException(
            `Row ${p.row}: could not resolve the driver or vehicle for this ownership plan.`,
          );
        }

        const startDate = new Date(`${p.startDate}T00:00:00.000Z`);
        const billingStartDate = new Date(`${p.billingStartDate}T00:00:00.000Z`);
        const contractEndDate = p.contractEndDate
          ? new Date(`${p.contractEndDate}T00:00:00.000Z`)
          : null;

        if (p.existingId) {
          // Stage BI1 - a re-import updates the plan's own terms only. The
          // opening balance is a one-time historical fact recorded once, at
          // first import (below) - re-applying it here on every re-import
          // would double-count it, which is exactly what re-import
          // idempotency (§6) rules out.
          await tx.ownershipPlan.update({
            where: { id: p.existingId },
            data: {
              dailyAmount: p.dailyAmount,
              instalmentCount: p.instalmentCount,
              totalPrice: p.totalPrice,
              downPayment: p.downPayment,
              startDate,
              billingStartDate,
              contractEndDate,
              graceDays: p.graceDays,
              lateFeeAmount: p.lateFeeAmount,
              breachAfterConsecutiveMissedDays: p.breachAfterConsecutiveMissedDays,
              activeWeekdays: p.activeWeekdays,
              notes: p.notes,
            },
          });
          counts.ownershipPlansUpdated += 1;
          continue;
        }

        const plan = await tx.ownershipPlan.create({
          data: {
            tenantId: actor.tenantId,
            driverId,
            motorcycleId,
            dailyAmount: p.dailyAmount,
            instalmentCount: p.instalmentCount,
            totalPrice: p.totalPrice,
            downPayment: p.downPayment,
            startDate,
            billingStartDate,
            contractEndDate,
            graceDays: p.graceDays,
            lateFeeAmount: p.lateFeeAmount,
            breachAfterConsecutiveMissedDays: p.breachAfterConsecutiveMissedDays,
            activeWeekdays: p.activeWeekdays,
            notes: p.notes,
          },
        });
        counts.ownershipPlansCreated += 1;

        // Stage BI1 (§5) - the opening-balance row. Deliberately NOT routed
        // through OwnershipPlanService.create()/allocateAppliedDeposit -
        // that path's eager first instalment assumes a plan starting now at
        // its true startDate, which for an imported plan can be months in
        // the past (see ownership-plan.service.ts's own Stage G10 comment).
        // Skipped entirely for a zero opening balance - never a zero-amount
        // synthetic row.
        if (p.openingBalance > 0) {
          const assignedDate = dayBefore(p.billingStartDate);
          const assignment = await tx.dailyAssignment.create({
            data: {
              tenantId: actor.tenantId,
              driverId,
              motorcycleId,
              assignedDate,
              targetAmount: p.openingBalance,
              ownershipPlanId: plan.id,
              notes: 'Bulk import — balance brought forward, not a real billing day.',
            },
          });
          await tx.dailyPayment.create({
            data: {
              tenantId: actor.tenantId,
              dailyAssignmentId: assignment.id,
              driverId,
              amount: p.openingBalance,
              status: PaymentStatus.COMPLETED,
              paymentMethod: 'IMPORTED_OPENING_BALANCE',
              paidAt: now,
            },
          });
        }
      }

      return { preview, counts };
    });
  }
}
