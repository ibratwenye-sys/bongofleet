import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthenticatedUser } from '../auth.types';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
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
}
