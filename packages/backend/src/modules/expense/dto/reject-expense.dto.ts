import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

/** Stage H2 - rejectionReason is required, not optional: rejecting without
 *  a reason is how you lose a rider's trust (DESIGN_RIDER_EXPENSES.md §4). */
export class RejectExpenseDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  rejectionReason: string;
}
