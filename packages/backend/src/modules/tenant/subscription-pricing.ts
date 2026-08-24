import { Prisma, SubscriptionPricingTier } from '@prisma/client';

/**
 * Stage SUB1 (DESIGN_SUBSCRIPTION.md §5b). Picks which SubscriptionPricingTier
 * applies to a tenant with `activeBikeCount` active bikes, as of `asOf`.
 *
 * Pure and DB-free on purpose: pass in tiers you've already fetched. Among
 * tiers whose effectiveFrom is not in the future, this returns the one with
 * the highest minBikeCount that is still <= activeBikeCount - i.e. the most
 * specific tier the bike count actually qualifies for.
 *
 * Requires a minBikeCount: 0 tier to exist among `tiers` - that is the floor
 * every bike count resolves against (including activeBikeCount 0), so there
 * is always a match. A caller passing tiers with no such floor gets a thrown
 * error rather than a silent undefined - the seed migration guarantees this
 * in production; only a hand-built test fixture could violate it.
 */
export function resolvePricingTier(
  tiers: SubscriptionPricingTier[],
  activeBikeCount: number,
  asOf: Date,
): SubscriptionPricingTier {
  const eligible = tiers
    .filter((tier) => tier.effectiveFrom <= asOf && tier.minBikeCount <= activeBikeCount)
    .sort((a, b) => b.minBikeCount - a.minBikeCount);

  const tier = eligible[0];
  if (!tier) {
    throw new Error(
      'resolvePricingTier: no eligible tier for activeBikeCount ' +
        `${activeBikeCount} as of ${asOf.toISOString()} - a minBikeCount: 0 tier must always exist`,
    );
  }
  return tier;
}

export function estimatedMonthlyTotal(
  pricePerBikePerMonth: Prisma.Decimal,
  activeBikeCount: number,
): Prisma.Decimal {
  return pricePerBikePerMonth.times(activeBikeCount);
}
