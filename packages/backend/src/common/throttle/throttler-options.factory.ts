import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerModuleOptions, ThrottlerStorage } from '@nestjs/throttler';
import { AuthController } from '../../modules/auth/auth.controller';
import {
  GLOBAL_THROTTLE,
  LOGIN_IDENTIFIER_THROTTLE,
  LOGIN_IP_THROTTLE,
  REFRESH_THROTTLE,
  SIGNUP_IDENTIFIER_THROTTLE,
  SIGNUP_IP_THROTTLE,
  PASSWORD_RESET_IDENTIFIER_THROTTLE,
  PASSWORD_RESET_IP_THROTTLE,
  PASSWORD_RESET_CONFIRM_IP_THROTTLE,
} from './throttle.constants';
import {
  trackByIp,
  trackByIpAndIdentifier,
  trackByUserOrIp,
  trackRefreshByUser,
  trackByIdentifier,
} from './throttle-tracker.util';

/**
 * Stage H0. Everything ThrottlerModule.forRootAsync needs, built here rather
 * than inline in app.module.ts so the wiring is unit-testable (fake
 * ExecutionContexts against `login`/`signup`/`refresh` skipIf) without
 * booting the whole app.
 *
 * Handler-reference comparison (`context.getHandler() === AuthController.
 * prototype.login`), not string route-path matching - it's the framework's
 * own identity for "which route is this", stable across path prefixes, and
 * a compile error if the method is ever renamed or removed.
 *
 * Takes an already-constructed `storage`, not a Redis client - constructing
 * ThrottlerStorageRedisService is the caller's concern (app.module.ts), so
 * this function has no Redis side effect of its own and is safe to call
 * directly in a unit test.
 */
export function buildThrottlerOptions(
  storage: ThrottlerStorage,
  config: ConfigService,
  jwt: JwtService,
): ThrottlerModuleOptions {
  const accessSecret = config.get<string>('JWT_ACCESS_SECRET') as string;
  const refreshSecret = config.get<string>('JWT_REFRESH_SECRET') as string;

  const isHandler =
    (method: (...args: never[]) => unknown) =>
    (context: ExecutionContext): boolean =>
      context.getHandler() === method;

  const isLogin = isHandler(AuthController.prototype.login);
  const isSignup = isHandler(AuthController.prototype.signup);
  const isRefresh = isHandler(AuthController.prototype.refresh);
  const isResetRequest = isHandler(AuthController.prototype.requestPasswordReset);
  const isResetConfirm = isHandler(AuthController.prototype.confirmPasswordReset);

  return {
    storage,
    throttlers: [
      {
        name: 'default',
        ...GLOBAL_THROTTLE,
        getTracker: (req) => trackByUserOrIp(req, jwt, accessSecret),
      },
      {
        name: 'login-identifier',
        ...LOGIN_IDENTIFIER_THROTTLE,
        getTracker: (req) => trackByIpAndIdentifier(req),
        skipIf: (context) => !isLogin(context),
      },
      {
        name: 'login-ip',
        ...LOGIN_IP_THROTTLE,
        getTracker: (req) => trackByIp(req),
        skipIf: (context) => !isLogin(context),
      },
      {
        name: 'signup-identifier',
        ...SIGNUP_IDENTIFIER_THROTTLE,
        getTracker: (req) => trackByIpAndIdentifier(req),
        skipIf: (context) => !isSignup(context),
      },
      {
        name: 'signup-ip',
        ...SIGNUP_IP_THROTTLE,
        getTracker: (req) => trackByIp(req),
        skipIf: (context) => !isSignup(context),
      },
      // Stage H0f - password reset. The identifier throttler is IP-blind
      // on purpose (see PASSWORD_RESET_IDENTIFIER_THROTTLE): what it stops is
      // one rider being mailed over and over, which spreading across hosts
      // would otherwise defeat.
      {
        name: 'password-reset-identifier',
        ...PASSWORD_RESET_IDENTIFIER_THROTTLE,
        getTracker: (req) => trackByIdentifier(req),
        skipIf: (context) => !isResetRequest(context),
      },
      {
        name: 'password-reset-ip',
        ...PASSWORD_RESET_IP_THROTTLE,
        getTracker: (req) => trackByIp(req),
        skipIf: (context) => !isResetRequest(context),
      },
      {
        name: 'password-reset-confirm-ip',
        ...PASSWORD_RESET_CONFIRM_IP_THROTTLE,
        getTracker: (req) => trackByIp(req),
        skipIf: (context) => !isResetConfirm(context),
      },
      {
        name: 'refresh',
        ...REFRESH_THROTTLE,
        getTracker: (req) => trackRefreshByUser(req, jwt, refreshSecret),
        skipIf: (context) => !isRefresh(context),
      },
    ],
  };
}
