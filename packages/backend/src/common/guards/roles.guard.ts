import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '@prisma/client';
import { ROLES_KEY } from '../decorators/roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    // Read from `request.user` (set synchronously by JwtAuthGuard/Passport before
    // this guard runs) rather than `requestContext` - AsyncLocalStorage's
    // `enterWith` isn't guaranteed to propagate cleanly across a second,
    // separately-invoked guard in the chain, while `request.user` is a plain
    // property on the shared request object with no such ambiguity.
    const request = context.switchToHttp().getRequest<{ user?: { role?: UserRole } }>();
    const role = request.user?.role;
    if (!role || !requiredRoles.includes(role)) {
      throw new ForbiddenException('Insufficient role for this action');
    }

    return true;
  }
}
