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
    const adapter = new PrismaPg({
      connectionString: config.get<string>('DATABASE_URL'),
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
