import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { TenantStatus } from '@prisma/client';
import { PrismaService } from '../../src/prisma/prisma.service';
import { requestContext } from '../../src/common/context/request-context';

export interface SignupBody {
  email: string;
  password: string;
  companyName: string;
  firstName: string;
  lastName: string;
  phone: string;
  [key: string]: string;
}

export interface ActivatedOwner {
  accessToken: string;
  refreshToken: string;
  tenantId: string;
}

/**
 * Stage S1. POST /auth/signup now creates a PENDING_VERIFICATION tenant that
 * every authenticated route except a small allow-list refuses (see
 * tenant-lock.util.ts / JwtAuthGuard) until it verifies - the real code flow
 * is tested end to end, once, in signup-verification.e2e-spec.ts, with the
 * real Redis-backed code and a captured mailer message.
 *
 * Every OTHER spec just needs a WORKING owner account to test something
 * unrelated (drivers, payments, assignments, ...), so this activates the
 * tenant directly via Prisma instead - one shared place, not eighteen copies
 * of a mailer-interception harness that would couple every unrelated spec to
 * how verification is delivered.
 *
 * Wrapped in requestContext.runUnscoped(): the tenant-scoping Prisma
 * extension (tenant-scoping.extension.ts) throws on any query made with no
 * ALS store, and there is none here - this runs outside a request.
 *
 * trialEndsAt is stamped 7 days out to mirror what real verification does
 * (TENANT_TRIAL_DAYS' default in env.validation.ts) - a fixed number here
 * rather than reading the config value, since nothing in this test flow
 * exercises trial-length configurability; that's covered directly in
 * signup-verification.e2e-spec.ts.
 */
export async function signupAndActivateOwner(
  app: INestApplication,
  body: SignupBody,
): Promise<ActivatedOwner> {
  const res = await request(app.getHttpServer()).post('/auth/signup').send(body).expect(201);

  const prisma = app.get(PrismaService);
  const user = await requestContext.runUnscoped(() =>
    prisma.client.user.findFirstOrThrow({
      where: { email: body.email },
      select: { tenantId: true },
    }),
  );

  const trialEndsAt = new Date();
  trialEndsAt.setUTCDate(trialEndsAt.getUTCDate() + 7);

  await requestContext.runUnscoped(() =>
    prisma.client.tenant.update({
      where: { id: user.tenantId },
      data: { status: TenantStatus.ACTIVE, verifiedAt: new Date(), trialEndsAt },
    }),
  );

  return {
    accessToken: res.body.accessToken as string,
    refreshToken: res.body.refreshToken as string,
    tenantId: user.tenantId,
  };
}
