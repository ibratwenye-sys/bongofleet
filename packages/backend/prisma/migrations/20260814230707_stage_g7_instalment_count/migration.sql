-- Stage G7: totalOwed becomes dailyAmount * instalmentCount, exactly, never
-- derived from totalPrice - downPayment. Existing plans have no
-- instalmentCount, so it is backfilled here as
-- ceil((total_price - down_payment) / daily_amount) - the old totalOwed
-- divided by dailyAmount, rounded up to a whole number of days. This is
-- acceptable ONLY because nothing is live (no real driver has a plan yet):
-- for any existing plan whose old totalOwed was not an exact multiple of
-- dailyAmount, the new totalOwed (dailyAmount * instalmentCount) shifts up
-- to just under one day's payment above the old figure.

-- AlterTable
ALTER TABLE "ownership_plans" ADD COLUMN "instalment_count" INTEGER;

-- Backfill
UPDATE "ownership_plans"
SET "instalment_count" = CEIL(("total_price" - "down_payment") / "daily_amount")::INTEGER;

-- Enforce NOT NULL now that every row has a value
ALTER TABLE "ownership_plans" ALTER COLUMN "instalment_count" SET NOT NULL;
