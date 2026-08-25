import { generateTrackingToken } from './tracking-token.util';

describe('generateTrackingToken', () => {
  it('produces a URL-safe base64url string with no padding', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateTrackingToken()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('encodes 32 bytes - base64url has no padding, so length is ceil(32*8/6) = 43', () => {
    expect(generateTrackingToken()).toHaveLength(43);
  });

  it('is effectively unique across many generations', () => {
    const tokens = new Set(Array.from({ length: 5000 }, () => generateTrackingToken()));
    expect(tokens.size).toBe(5000);
  });
});
