import { parseTrustProxy } from './trust-proxy.util';

describe('parseTrustProxy (Stage H0b Part 1)', () => {
  it('empty/undefined/"0" disables proxy trust', () => {
    expect(parseTrustProxy(undefined)).toBe(false);
    expect(parseTrustProxy('')).toBe(false);
    expect(parseTrustProxy('0')).toBe(false);
    expect(parseTrustProxy('  ')).toBe(false);
  });

  it('a positive integer string is returned as a number (hop count)', () => {
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy('2')).toBe(2);
    expect(parseTrustProxy(' 3 ')).toBe(3);
  });

  it('a single IP address or CIDR subnet is returned as-is', () => {
    expect(parseTrustProxy('10.0.0.5')).toBe('10.0.0.5');
    expect(parseTrustProxy('10.0.0.0/8')).toBe('10.0.0.0/8');
    expect(parseTrustProxy('::1')).toBe('::1');
  });

  it('a comma-separated list of addresses/subnets is returned as-is', () => {
    expect(parseTrustProxy('10.0.0.5,10.0.0.6')).toBe('10.0.0.5,10.0.0.6');
  });

  it('rejects "true" and "*" - never trust every proxy', () => {
    expect(() => parseTrustProxy('true')).toThrow(/not allowed/i);
    expect(() => parseTrustProxy('TRUE')).toThrow(/not allowed/i);
    expect(() => parseTrustProxy('*')).toThrow(/not allowed/i);
  });

  it('rejects zero-or-negative-looking nonsense rather than defaulting permissively', () => {
    expect(() => parseTrustProxy('-1')).toThrow();
    expect(() => parseTrustProxy('banana')).toThrow();
    expect(() => parseTrustProxy('yes')).toThrow();
    expect(() => parseTrustProxy('1.2.3')).not.toThrow(); // looks address-shaped, Express's own problem
    expect(() => parseTrustProxy('not-an-ip,also-not')).toThrow();
  });
});
