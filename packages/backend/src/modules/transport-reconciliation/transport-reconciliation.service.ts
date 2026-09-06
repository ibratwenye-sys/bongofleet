import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../auth/auth.types';
import { parseStatementFile } from './statement-parser';
import { matchStatementRow, JobCandidate, MatchCandidate } from './matching';
import { RowSelection } from './row-selections';

function assertOwnerOrManager(actor: AuthenticatedUser): void {
  if (actor.role !== 'OWNER' && actor.role !== 'MANAGER') {
    throw new ForbiddenException('Only OWNER or MANAGER may reconcile transport payments');
  }
}

function money(value: Prisma.Decimal | number): string {
  return new Prisma.Decimal(value).toFixed(2);
}

export interface PreviewRow {
  rowIndex: number;
  date: string | null;
  amount: number | null;
  narrative: string;
  error: string | null;
  candidates: (Omit<MatchCandidate, 'remainingBalance'> & { remainingBalance: string })[];
}

export interface PreviewResult {
  fileName: string;
  rows: PreviewRow[];
}

export interface CommitRowResult {
  rowIndex: number;
  status: 'committed' | 'skipped' | 'error';
  transportJobId?: string;
  message?: string;
  /** True when the chosen job had already reached amountReceived >=
   *  revenue before this match was applied - someone paid it via another
   *  route since the preview was generated. Still recorded (an overpaid
   *  job is a valid, non-blocking state), just flagged for a dashboard
   *  heads-up rather than silently absorbed. */
  overpaidWarning?: boolean;
}

export interface CommitResult {
  results: CommitRowResult[];
}

@Injectable()
export class TransportReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Reads and matches only - writes nothing. Fetches every TransportJob
   * for this tenant ONCE (not one query per statement row) and lets the
   * pure matchStatementRow() filter/match in memory per row.
   */
  async preview(file: Express.Multer.File, actor: AuthenticatedUser): Promise<PreviewResult> {
    assertOwnerOrManager(actor);

    const parsedRows = await parseStatementFile(file.buffer, file.originalname);
    const candidates = await this.loadCandidateJobs();

    const rows: PreviewRow[] = parsedRows.map((row) => {
      if (row.error || row.date === null || row.amount === null) {
        return {
          rowIndex: row.rowNumber,
          date: row.date?.toISOString() ?? null,
          amount: row.amount,
          narrative: row.narrative,
          error: row.error,
          candidates: [],
        };
      }
      const matches = matchStatementRow(
        { amount: row.amount, narrative: row.narrative },
        candidates,
      );
      return {
        rowIndex: row.rowNumber,
        date: row.date.toISOString(),
        amount: row.amount,
        narrative: row.narrative,
        error: null,
        candidates: matches.map((m) => ({ ...m, remainingBalance: money(m.remainingBalance) })),
      };
    });

    return { fileName: file.originalname, rows };
  }

  /**
   * Re-parses the SAME re-uploaded file from scratch - never trusts any
   * client-supplied amount/date/narrative, only rowIndex -> transportJobId
   * selections, since a tampered request could otherwise credit an
   * arbitrary job an arbitrary amount. One Prisma transaction for the
   * whole call: a mid-batch failure rolls back every write already made in
   * this commit, never leaving some jobs updated and others not.
   */
  async commit(
    file: Express.Multer.File,
    selections: RowSelection[],
    actor: AuthenticatedUser,
  ): Promise<CommitResult> {
    assertOwnerOrManager(actor);

    const parsedRows = await parseStatementFile(file.buffer, file.originalname);
    const parsedByRowIndex = new Map(parsedRows.map((r) => [r.rowNumber, r]));

    const chosen = selections.filter((s) => s.transportJobId !== 'skip');
    if (chosen.length === 0) {
      return { results: [] };
    }

    const jobIds = [...new Set(chosen.map((s) => s.transportJobId))];
    // Tenant-scoped automatically by the Prisma extension - a cross-tenant
    // id simply isn't in this result set, same 404-not-403 shape every
    // other cross-tenant lookup in this codebase already uses.
    const jobs = await this.prisma.client.transportJob.findMany({ where: { id: { in: jobIds } } });
    const jobById = new Map(jobs.map((j) => [j.id, j]));

    return this.prisma.client.$transaction(async (tx) => {
      const results: CommitRowResult[] = [];

      for (const selection of chosen) {
        const parsedRow = parsedByRowIndex.get(selection.rowIndex);
        if (!parsedRow || parsedRow.error || parsedRow.date === null || parsedRow.amount === null) {
          results.push({
            rowIndex: selection.rowIndex,
            status: 'error',
            message:
              'This row could not be re-read from the file - it may not match what you previewed',
          });
          continue;
        }

        const job = jobById.get(selection.transportJobId);
        if (!job) {
          results.push({
            rowIndex: selection.rowIndex,
            status: 'error',
            message: 'Transport job not found',
          });
          continue;
        }

        const overpaidWarning = new Prisma.Decimal(job.amountReceived).greaterThanOrEqualTo(
          job.revenue,
        );
        const newAmountReceived = new Prisma.Decimal(job.amountReceived).plus(parsedRow.amount);

        await tx.transportJob.update({
          where: { id: job.id },
          data: {
            amountReceived: newAmountReceived,
            lastPaymentReceivedAt: parsedRow.date,
          },
        });
        await tx.transportPaymentMatch.create({
          data: {
            tenantId: actor.tenantId,
            transportJobId: job.id,
            amount: parsedRow.amount,
            transactionDate: parsedRow.date,
            narrativeText: parsedRow.narrative,
            sourceFileName: file.originalname,
            matchedByUserId: actor.userId,
          },
        });

        results.push({
          rowIndex: selection.rowIndex,
          status: 'committed',
          transportJobId: job.id,
          overpaidWarning,
        });
      }

      return { results };
    });
  }

  private async loadCandidateJobs(): Promise<JobCandidate[]> {
    const jobs = await this.prisma.client.transportJob.findMany({
      select: {
        id: true,
        reference: true,
        customerName: true,
        revenue: true,
        amountReceived: true,
      },
    });
    return jobs.map((j) => ({
      id: j.id,
      reference: j.reference,
      customerName: j.customerName,
      revenue: j.revenue.toNumber(),
      amountReceived: j.amountReceived.toNumber(),
    }));
  }
}
