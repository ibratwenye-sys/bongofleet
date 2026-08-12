import { JwtService } from '@nestjs/jwt';
import {
  bearerToken,
  normalizeIdentifier,
  trackByIp,
  trackByIpAndIdentifier,
  trackByUserOrIp,
  trackRefreshByUser,
  verifyJwtPayload,
} from './throttle-tracker.util';

const ACCESS_SECRET = 'test-access-secret';
const REFRESH_SECRET = 'test-refresh-secret';

function signAccessToken(
  jwt: JwtService,
  overrides: Partial<{ sub: string; tenant_id: string }> = {},
) {
  return jwt.sign(
    { sub: 'user-1', tenant_id: 'tenant-1', role: 'OWNER', jti: 'jti-1', ...overrides },
    { secret: ACCESS_SECRET },
  );
}

describe('normalizeIdentifier', () => {
  it('trims and lowercases so casing/whitespace variations share a budget', () => {
    expect(normalizeIdentifier('  Driver@Acme.Test  ')).toBe('driver@acme.test');
  });

  it('non-string input (missing/malformed body) becomes an empty string, never throws', () => {
    expect(normalizeIdentifier(undefined)).toBe('');
    expect(normalizeIdentifier(null)).toBe('');
    expect(normalizeIdentifier(42)).toBe('');
  });
});

describe('bearerToken', () => {
  it('extracts the token from a well-formed Authorization header', () => {
    expect(bearerToken({ headers: { authorization: 'Bearer abc.def.ghi' } })).toBe('abc.def.ghi');
  });

  it('returns null for a missing header, wrong scheme, or malformed header', () => {
    expect(bearerToken({ headers: {} })).toBeNull();
    expect(bearerToken({})).toBeNull();
    expect(bearerToken({ headers: { authorization: 'Basic abc' } })).toBeNull();
    expect(bearerToken({ headers: { authorization: 'Bearer' } })).toBeNull();
  });
});

describe('verifyJwtPayload', () => {
  const jwt = new JwtService();

  it('returns the payload for a token that verifies', () => {
    const token = signAccessToken(jwt);
    expect(verifyJwtPayload(jwt, token, ACCESS_SECRET)).toMatchObject({
      sub: 'user-1',
      tenant_id: 'tenant-1',
    });
  });

  it('returns null for a token signed with the wrong secret - never trusts an unverified sub', () => {
    const token = signAccessToken(jwt);
    expect(verifyJwtPayload(jwt, token, 'a-different-secret')).toBeNull();
  });

  it('returns null for an expired token', () => {
    const token = jwt.sign({ sub: 'user-1' }, { secret: ACCESS_SECRET, expiresIn: -1 });
    expect(verifyJwtPayload(jwt, token, ACCESS_SECRET)).toBeNull();
  });

  it('returns null for garbage input and for null', () => {
    expect(verifyJwtPayload(jwt, 'not-a-jwt', ACCESS_SECRET)).toBeNull();
    expect(verifyJwtPayload(jwt, null, ACCESS_SECRET)).toBeNull();
  });
});

describe('trackByUserOrIp (Stage H0 Part 1)', () => {
  const jwt = new JwtService();

  it('keys on user+tenant when the request carries a JWT that verifies', () => {
    const token = signAccessToken(jwt, { sub: 'user-42', tenant_id: 'tenant-9' });
    const req = { ip: '10.0.0.5', headers: { authorization: `Bearer ${token}` } };
    expect(trackByUserOrIp(req, jwt, ACCESS_SECRET)).toBe('user:user-42:tenant-9');
  });

  it('falls back to IP for an anonymous request (no Authorization header)', () => {
    const req = { ip: '10.0.0.5', headers: {} };
    expect(trackByUserOrIp(req, jwt, ACCESS_SECRET)).toBe('ip:10.0.0.5');
  });

  it('falls back to IP for a present-but-invalid token, rather than trusting an unverified sub', () => {
    const forged = jwt.sign({ sub: 'attacker-picks-any-id' }, { secret: 'wrong-secret' });
    const req = { ip: '10.0.0.5', headers: { authorization: `Bearer ${forged}` } };
    expect(trackByUserOrIp(req, jwt, ACCESS_SECRET)).toBe('ip:10.0.0.5');
  });

  it('two different users on the same IP get different keys', () => {
    const tokenA = signAccessToken(jwt, { sub: 'user-a' });
    const tokenB = signAccessToken(jwt, { sub: 'user-b' });
    const reqA = { ip: '10.0.0.5', headers: { authorization: `Bearer ${tokenA}` } };
    const reqB = { ip: '10.0.0.5', headers: { authorization: `Bearer ${tokenB}` } };
    expect(trackByUserOrIp(reqA, jwt, ACCESS_SECRET)).not.toBe(
      trackByUserOrIp(reqB, jwt, ACCESS_SECRET),
    );
  });
});

describe('trackByIpAndIdentifier (Stage H0 Part 2)', () => {
  it('combines IP and normalized identifier', () => {
    const req = { ip: '10.0.0.5', body: { email: ' Driver@Acme.Test ' } };
    expect(trackByIpAndIdentifier(req)).toBe('ip:10.0.0.5:id:driver@acme.test');
  });

  it('two different identifiers on the same IP get different keys', () => {
    const reqA = { ip: '10.0.0.5', body: { email: 'a@test.local' } };
    const reqB = { ip: '10.0.0.5', body: { email: 'b@test.local' } };
    expect(trackByIpAndIdentifier(reqA)).not.toBe(trackByIpAndIdentifier(reqB));
  });

  it('the same identifier from two different IPs gets different keys', () => {
    const reqA = { ip: '10.0.0.5', body: { email: 'a@test.local' } };
    const reqB = { ip: '10.0.0.9', body: { email: 'a@test.local' } };
    expect(trackByIpAndIdentifier(reqA)).not.toBe(trackByIpAndIdentifier(reqB));
  });
});

describe('trackByIp (Stage H0 Part 2 backstop)', () => {
  it('is blind to identifier - same IP, different identifiers, same key', () => {
    const reqA = { ip: '10.0.0.5', body: { email: 'a@test.local' } };
    const reqB = { ip: '10.0.0.5', body: { email: 'b@test.local' } };
    expect(trackByIp(reqA)).toBe(trackByIp(reqB));
    expect(trackByIp(reqA)).toBe('ip:10.0.0.5');
  });
});

describe('trackRefreshByUser (Stage H0 Part 3)', () => {
  const jwt = new JwtService();

  it("keys on the refresh token's own user, ignoring IP entirely", () => {
    const token = jwt.sign({ sub: 'user-7' }, { secret: REFRESH_SECRET });
    const reqA = { ip: '10.0.0.1', body: { refreshToken: token } };
    const reqB = { ip: '10.0.0.99', body: { refreshToken: token } };
    expect(trackRefreshByUser(reqA, jwt, REFRESH_SECRET)).toBe('user:user-7');
    expect(trackRefreshByUser(reqA, jwt, REFRESH_SECRET)).toBe(
      trackRefreshByUser(reqB, jwt, REFRESH_SECRET),
    );
  });

  it('falls back to IP for a garbage/missing refresh token', () => {
    expect(trackRefreshByUser({ ip: '10.0.0.1', body: {} }, jwt, REFRESH_SECRET)).toBe(
      'ip:10.0.0.1',
    );
    expect(
      trackRefreshByUser(
        { ip: '10.0.0.1', body: { refreshToken: 'garbage' } },
        jwt,
        REFRESH_SECRET,
      ),
    ).toBe('ip:10.0.0.1');
  });
});
