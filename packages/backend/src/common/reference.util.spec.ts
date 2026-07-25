import { generateRideReference } from './reference.util';

describe('generateRideReference', () => {
  it('produces the "BF-" + 8 base32 chars format', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateRideReference()).toMatch(/^BF-[0-9A-HJKMNP-TV-Z]{8}$/);
    }
  });

  it('never emits the ambiguous characters I, L, O, U', () => {
    const joined = Array.from({ length: 300 }, () => generateRideReference()).join('');
    expect(joined).not.toMatch(/[ILOU]/);
  });

  it('is effectively unique across many generations', () => {
    const codes = new Set(Array.from({ length: 5000 }, () => generateRideReference()));
    expect(codes.size).toBe(5000);
  });
});
