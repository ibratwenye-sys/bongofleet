import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerOptions } from '@nestjs/throttler';
import { AuthController } from '../../modules/auth/auth.controller';
import { buildThrottlerOptions } from './throttler-options.factory';
import {
  GLOBAL_THROTTLE,
  LOGIN_IDENTIFIER_THROTTLE,
  LOGIN_IP_THROTTLE,
  REFRESH_THROTTLE,
  SIGNUP_IDENTIFIER_THROTTLE,
  SIGNUP_IP_THROTTLE,
} from './throttle.constants';

function fakeConfig(values: Record<string, string>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

function contextFor(handler: (...args: never[]) => unknown): ExecutionContext {
  return { getHandler: () => handler } as unknown as ExecutionContext;
}

function throttlerNamed(options: ThrottlerOptions[], name: string): ThrottlerOptions {
  const found = options.find((o) => o.name === name);
  if (!found) throw new Error(`no throttler named ${name} in options`);
  return found;
}

describe('buildThrottlerOptions (Stage H0)', () => {
  const config = fakeConfig({
    JWT_ACCESS_SECRET: 'access-secret',
    JWT_REFRESH_SECRET: 'refresh-secret',
  });
  const jwt = new JwtService();
  const storage = { increment: jest.fn() }; // buildThrottlerOptions just passes this through untouched

  const options = buildThrottlerOptions(storage, config, jwt) as { throttlers: ThrottlerOptions[] };
  const throttlers = options.throttlers;

  it("produces exactly the six named throttlers, with the constants' own limits/ttls", () => {
    expect(throttlers.map((t) => t.name).sort()).toEqual(
      [
        'default',
        'login-identifier',
        'login-ip',
        'refresh',
        'signup-identifier',
        'signup-ip',
      ].sort(),
    );
    expect(throttlerNamed(throttlers, 'default')).toMatchObject(GLOBAL_THROTTLE);
    expect(throttlerNamed(throttlers, 'login-identifier')).toMatchObject(LOGIN_IDENTIFIER_THROTTLE);
    expect(throttlerNamed(throttlers, 'login-ip')).toMatchObject(LOGIN_IP_THROTTLE);
    expect(throttlerNamed(throttlers, 'refresh')).toMatchObject(REFRESH_THROTTLE);
    expect(throttlerNamed(throttlers, 'signup-identifier')).toMatchObject(
      SIGNUP_IDENTIFIER_THROTTLE,
    );
    expect(throttlerNamed(throttlers, 'signup-ip')).toMatchObject(SIGNUP_IP_THROTTLE);
  });

  it('signup-ip is at least as strict as login-ip (Stage H0b Part 2)', () => {
    expect(SIGNUP_IP_THROTTLE.limit).toBeLessThanOrEqual(LOGIN_IP_THROTTLE.limit);
  });

  it("'default' never skips - it's the global ceiling, checked on every route", () => {
    const t = throttlerNamed(throttlers, 'default');
    expect(t.skipIf).toBeUndefined();
  });

  it.each([
    ['login-identifier', AuthController.prototype.login],
    ['login-ip', AuthController.prototype.login],
    ['signup-identifier', AuthController.prototype.signup],
    ['signup-ip', AuthController.prototype.signup],
    ['refresh', AuthController.prototype.refresh],
  ])('%s only runs on its own route, skipping every other handler', (name, ownHandler) => {
    const t = throttlerNamed(throttlers, name);
    expect(t.skipIf).toBeDefined();

    expect(t.skipIf!(contextFor(ownHandler))).toBe(false);

    const otherHandlers = [
      AuthController.prototype.login,
      AuthController.prototype.signup,
      AuthController.prototype.refresh,
      function unrelatedHandler() {},
    ].filter((h) => h !== ownHandler);
    for (const other of otherHandlers) {
      expect(t.skipIf!(contextFor(other))).toBe(true);
    }
  });

  it('the default tracker resolves through trackByUserOrIp (falls back to IP with no token)', async () => {
    const t = throttlerNamed(throttlers, 'default');
    const tracker = await t.getTracker!(
      { ip: '10.0.0.1', headers: {} },
      contextFor(() => {}),
    );
    expect(tracker).toBe('ip:10.0.0.1');
  });

  it('the refresh tracker resolves through trackRefreshByUser (falls back to IP with no token)', async () => {
    const t = throttlerNamed(throttlers, 'refresh');
    const tracker = await t.getTracker!(
      { ip: '10.0.0.1', body: {} },
      contextFor(() => {}),
    );
    expect(tracker).toBe('ip:10.0.0.1');
  });

  it('login-identifier and signup-identifier both resolve through trackByIpAndIdentifier', async () => {
    const loginT = throttlerNamed(throttlers, 'login-identifier');
    const signupT = throttlerNamed(throttlers, 'signup-identifier');
    const req = { ip: '10.0.0.1', body: { email: 'a@test.local' } };
    const context = contextFor(() => {});
    expect(await loginT.getTracker!(req, context)).toBe('ip:10.0.0.1:id:a@test.local');
    expect(await signupT.getTracker!(req, context)).toBe('ip:10.0.0.1:id:a@test.local');
  });

  it('login-ip and signup-ip both resolve through trackByIp', async () => {
    const loginIpT = throttlerNamed(throttlers, 'login-ip');
    const signupIpT = throttlerNamed(throttlers, 'signup-ip');
    const req = { ip: '10.0.0.1', body: { email: 'anything' } };
    const context = contextFor(() => {});
    expect(await loginIpT.getTracker!(req, context)).toBe('ip:10.0.0.1');
    expect(await signupIpT.getTracker!(req, context)).toBe('ip:10.0.0.1');
  });
});
