import { Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { requestContext } from '../../../common/context/request-context';
import { AuthenticatedUser } from '../auth.types';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = AuthenticatedUser>(err: unknown, user: AuthenticatedUser | false): TUser {
    if (err || !user) {
      throw err instanceof Error ? err : new UnauthorizedException('Unauthorized');
    }

    requestContext.enterWith({
      tenantId: user.tenantId,
      userId: user.userId,
      role: user.role,
    });

    return user as unknown as TUser;
  }
}
