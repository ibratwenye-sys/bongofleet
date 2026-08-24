import { Prisma, SubscriptionPricingTier } from '@prisma/client';
import { estimatedMonthlyTotal, resolvePricingTier } from './subscription-pricing';

const NOW = new Date('2026-08-24T00:00:00.000Z');

function tier(
  minBikeCount: number,
  pricePerBikePerMonth: number,
  effectiveFrom: Date = new Date('2020-01-01T00:00:00.000Z'),
): SubscriptionPricingTier {
  return {
    id: `tier-${minBikeCount}`,
    minBikeCount,
    pricePerBikePerMonth: new Prisma.Decimal(pricePerBikePerMonth),
    effectiveFrom,
    createdAt: effectiveFrom,
  };
}

describe('resolvePricingTier (Stage SUB1, DESIGN_SUBSCRIPTION.md §5b)', () => {
  it('base-tier-only: every bike count resolves to the single seeded 0-floor row', () => {
    const tiers = [tier(0, 10000)];

    expect(resolvePricingTier(tiers, 0, NOW).pricePerBikePerMonth.toFixed(2)).toBe('10000.00');
    expect(resolvePricingTier(tiers, 1, NOW).pricePerBikePerMonth.toFixed(2)).toBe('10000.00');
    expect(resolvePricingTier(tiers, 500, NOW).pricePerBikePerMonth.toFixed(2)).toBe('10000.00');
  });

  it('multi-tier: picks the highest minBikeCount <= activeBikeCount, exactly at each boundary', () => {
    // §5b's documented future shape: 0/11/31/51 -> 10k/9k/8k/7k.
    const tiers = [tier(0, 10000), tier(11, 9000), tier(31, 8000), tier(51, 7000)];

    expect(resolvePricingTier(tiers, 10, NOW).pricePerBikePerMonth.toFixed(2)).toBe('10000.00');
    expect(resolvePricingTier(tiers, 11, NOW).pricePerBikePerMonth.toFixed(2)).toBe('9000.00');
    expect(resolvePricingTier(tiers, 30, NOW).pricePerBikePerMonth.toFixed(2)).toBe('9000.00');
    expect(resolvePricingTier(tiers, 31, NOW).pricePerBikePerMonth.toFixed(2)).toBe('8000.00');
    expect(resolvePricingTier(tiers, 50, NOW).pricePerBikePerMonth.toFixed(2)).toBe('8000.00');
    expect(resolvePricingTier(tiers, 51, NOW).pricePerBikePerMonth.toFixed(2)).toBe('7000.00');
    expect(resolvePricingTier(tiers, 1000, NOW).pricePerBikePerMonth.toFixed(2)).toBe('7000.00');
  });

  it('a tier not yet effective is ignored, falling back to the highest tier that already applies', () => {
    const tiers = [
      tier(0, 10000),
      // Announced but not live yet - asOf is before this tier's effectiveFrom.
      tier(11, 9000, new Date('2099-01-01T00:00:00.000Z')),
    ];

    expect(resolvePricingTier(tiers, 20, NOW).pricePerBikePerMonth.toFixed(2)).toBe('10000.00');
  });

  it('activeBikeCount below every tier minBikeCount still resolves via the 0-floor tier', () => {
    // "Correctly" here means: the 0-floor tier is always eligible (0 <=
    // activeBikeCount for any non-negative count), so it is always the
    // fallback - there is no bike count this can fail to resolve for.
    const tiers = [tier(0, 10000), tier(11, 9000)];

    expect(resolvePricingTier(tiers, 0, NOW).minBikeCount).toBe(0);
  });

  it('throws rather than silently resolving nothing when no 0-floor tier exists', () => {
    const tiers = [tier(11, 9000)];

    expect(() => resolvePricingTier(tiers, 5, NOW)).toThrow();
  });
});

describe('estimatedMonthlyTotal', () => {
  it('multiplies as a real Decimal computation', () => {
    const total = estimatedMonthlyTotal(new Prisma.Decimal('10000.00'), 7);
    expect(total.toFixed(2)).toBe('70000.00');
  });
});
