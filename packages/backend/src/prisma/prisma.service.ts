import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { tenantScopingExtension } from './extensions/tenant-scoping.extension';

function buildExtendedClient(rawClient: PrismaClient) {
  return rawClient.$extends(tenantScopingExtension);
}

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly rawClient: PrismaClient;
  readonly client: ReturnType<typeof buildExtendedClient>;

  constructor(config: ConfigService) {
    // max / idleTimeoutMillis are pg.PoolConfig fields, not a
    // @prisma/adapter-pg-specific option - PrismaPg's first argument is
    // passed straight through to `new pg.Pool(...)` under the hood (see its
    // constructor: `pg.Pool | pg.PoolConfig | string`). DATABASE_POOL_MAX's
    // default of 10 is a starting point, not a number verified against
    // Ibrahim's actual Postgres instance under real load - see
    // env.validation.ts.
    const adapter = new PrismaPg({
      connectionString: config.get<string>('DATABASE_URL'),
      max: config.get<number>('DATABASE_POOL_MAX'),
      idleTimeoutMillis: config.get<number>('DATABASE_POOL_IDLE_TIMEOUT_MS'),
    });
    this.rawClient = new PrismaClient({ adapter });
    this.client = buildExtendedClient(this.rawClient);
  }

  async onModuleInit(): Promise<void> {
    await this.rawClient.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.rawClient.$disconnect();
  }
}
