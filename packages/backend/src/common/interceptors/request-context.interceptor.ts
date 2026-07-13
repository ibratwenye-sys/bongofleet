import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { UserRole } from '@prisma/client';
import { requestContext } from '../context/request-context';

interface RequestUser {
  tenantId: string;
  userId: string;
  role: UserRole;
}

@Injectable()
export class RequestContextInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<{ user?: RequestUser }>();
    const user = request.user;

    if (!user) {
      return next.handle();
    }

    return new Observable((subscriber) => {
      requestContext.run({ tenantId: user.tenantId, userId: user.userId, role: user.role }, () => {
        next.handle().subscribe(subscriber);
      });
    });
  }
}
