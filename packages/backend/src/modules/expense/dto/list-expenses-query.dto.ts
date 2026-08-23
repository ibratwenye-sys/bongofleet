import { IsDateString, IsEnum, IsOptional, IsString } from 'class-validator';
import { ExpenseStatus, VehicleType } from '@prisma/client';

export class ListExpensesQueryDto {
  /** Stage H2 - omitted means every status, unchanged from before this
   *  field existed (every existing dashboard call and test relies on
   *  that). The Expenses page defaulting to status=APPROVED is H3's job. */
  @IsOptional()
  @IsEnum(ExpenseStatus)
  status?: ExpenseStatus;

  @IsOptional()
  @IsString()
  motorcycleId?: string;

  @IsOptional()
  @IsEnum(VehicleType)
  vehicleType?: VehicleType;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;
}
