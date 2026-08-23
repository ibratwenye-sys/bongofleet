import {
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

/**
 * Stage H2 (DESIGN_RIDER_EXPENSES.md §4). A RIDER's own submission -
 * category/amount/incurredAt/description validated exactly like
 * CreateExpenseDto, but no motorcycleId/transportJobId: those are derived
 * server-side from the rider's own DailyAssignment on incurredAt
 * (ExpenseService.submit), never taken from the request body.
 */
export class SubmitExpenseDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  category: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(10_000_000)
  amount: number;

  @IsDateString()
  incurredAt: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}
