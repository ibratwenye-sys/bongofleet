import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { AuthenticatedUser, AuthenticatedUserWithTenantLock } from '../auth.types';
import { checkTenantLock, tenantLockMessage } from '../tenant-lock.util';
import { ALLOW_WHEN_LOCKED_KEY } from '../decorators/allow-when-locked.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  // Plain `new Reflector()`, not constructor-injected: Reflector has no
  // dependencies of its own, and every module that references this guard by
  // class in @UseGuards(JwtAuthGuard) - about fifteen of them - does so
  // WITHOUT listing it as a provider (unlike RolesGuard, which needs real DI
  // for its own Reflector and so IS listed in each module's providers).
  // Giving JwtAuthGuard a DI-resolved constructor dependency would silently
  // fail to resolve in every one of those modules; this avoids that.
  private readonly reflector = new Reflector();

  handleRequest<TUser = AuthenticatedUser>(err: unknown, user: AuthenticatedUser | false): TUser {
    if (err || !user) {
      throw err instanceof Error ? err : new UnauthorizedException('Unauthorized');
    }

    // Tenant-context population moved to RequestContextInterceptor - it wraps
    // the whole rest of the pipeline in `als.run`, which reliably survives
    // Nest's internal RxJS-based dispatch between here and the controller/
    // service, unlike `enterWith` called from a guard (see that interceptor's
    // comment for why `enterWith` alone wasn't enough).
    return user as unknown as TUser;
  }

  /**
   * Stage S1 Part 3. This is the ONE enforcement point for tenant lock in
   * the whole app: every authenticated route - dashboard and rider app
   * alike, there is no second auth path - passes through this exact guard
   * after Passport/handleRequest confirms the JWT itself, so refusing a
   * locked tenant here needs no change to any other controller or module.
   * A route opts OUT via @AllowWhenLocked(), not the other way round.
   *
   * Data is never deleted by any of this - see tenant-lock.util.ts and the
   * Stage S1 migration. Locked means refused here, nothing more.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const authenticated = (await super.canActivate(context)) as boolean;
    if (!authenticated) {
      return false;
    }

    const allowWhenLocked = this.reflector.getAllAndOverride<boolean>(ALLOW_WHEN_LOCKED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (allowWhenLocked) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user: AuthenticatedUserWithTenantLock }>();
    const lock = checkTenantLock({
      status: request.user.tenantStatus,
      trialEndsAt: request.user.trialEndsAt,
      billingExemptAt: request.user.billingExemptAt,
    });
    if (lock.locked) {
      throw new ForbiddenException(tenantLockMessage(lock.reason));
    }

    return true;
  }
}
