import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsPositive,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { RIDER_EXPENSE_CATEGORIES } from '../rider-expense-categories';

class ExpenseCategoryCapEntryDto {
  @IsIn(RIDER_EXPENSE_CATEGORIES, {
    message: `category must be one of: ${RIDER_EXPENSE_CATEGORIES.join(', ')}`,
  })
  category: string;

  /**
   * null clears the cap entirely (deletes the row) - cleaner than storing
   * a null cap and having every read site treat "row exists with null" the
   * same as "no row". A provided value must be a positive number: 0 or
   * negative is rejected, since a zero cap would flag every claim in that
   * category, which is never what "no cap" or "a real cap" means - banning
   * a category outright is a different, unbuilt feature.
   */
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive({ message: 'dailyCapAmount must be a positive number, or null to clear the cap' })
  dailyCapAmount: number | null;
}

/**
 * PUT /expense-category-caps's body - a full replace of only the
 * categories included here; a category left out of the array is left
 * untouched, not cleared.
 */
export class UpsertExpenseCategoryCapsDto {
  @IsArray()
  @ArrayMaxSize(RIDER_EXPENSE_CATEGORIES.length)
  @ValidateNested({ each: true })
  @Type(() => ExpenseCategoryCapEntryDto)
  caps: ExpenseCategoryCapEntryDto[];
}
