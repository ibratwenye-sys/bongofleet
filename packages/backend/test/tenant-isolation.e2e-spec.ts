import { Test, TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { UserRole } from '@prisma/client';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { requestContext } from '../src/common/context/request-context';
import { cleanDatabase } from './utils/prisma-test.util';

describe('Tenant isolation (integration)', () => {
  let moduleRef: TestingModule;
  let prisma: PrismaService;
  let tenantA: { id: string };
  let tenantB: { id: string };

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot({ isGlobal: true, envFilePath: '../../.env' }), PrismaModule],
    }).compile();
    prisma = moduleRef.get(PrismaService);
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);

    [tenantA, tenantB] = await requestContext.runUnscoped(() =>
      Promise.all([
        prisma.client.tenant.create({ data: { name: 'Tenant A' } }),
        prisma.client.tenant.create({ data: { name: 'Tenant B' } }),
      ]),
    );

    await requestContext.runUnscoped(() =>
      Promise.all([
        prisma.client.user.create({
          data: {
            tenantId: tenantA.id,
            email: 'a@example.com',
            phone: '+254700000010',
            passwordHash: 'x',
            role: UserRole.OWNER,
            firstName: 'A',
            lastName: 'Owner',
          },
        }),
        prisma.client.user.create({
          data: {
            tenantId: tenantB.id,
            email: 'b@example.com',
            phone: '+254700000011',
            passwordHash: 'x',
            role: UserRole.OWNER,
            firstName: 'B',
            lastName: 'Owner',
          },
        }),
      ]),
    );
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await moduleRef.close();
  });

  it('a query scoped to tenant A never returns tenant B rows', async () => {
    requestContext.enterWith({ tenantId: tenantA.id, userId: 'irrelevant', role: UserRole.OWNER });
    const usersVisibleToA = await prisma.client.user.findMany();

    expect(usersVisibleToA).toHaveLength(1);
    expect(usersVisibleToA[0].email).toBe('a@example.com');
  });

  it("fetching tenant B's user by id while scoped to tenant A returns nothing", async () => {
    const tenantBUser = await requestContext.runUnscoped(() =>
      prisma.client.user.findFirst({ where: { tenantId: tenantB.id } }),
    );

    requestContext.enterWith({ tenantId: tenantA.id, userId: 'irrelevant', role: UserRole.OWNER });
    const result = await prisma.client.user.findUnique({ where: { id: tenantBUser!.id } });

    expect(result).toBeNull();
  });

  it('throws instead of silently returning unscoped data when tenant context is missing', async () => {
    await expect(prisma.client.user.findMany()).rejects.toThrow(/Tenant context missing/);
  });
});
