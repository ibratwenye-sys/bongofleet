import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { parseTrustProxy } from './common/trust-proxy.util';

const DEV_DEFAULT_CORS_ORIGINS = [
  'http://localhost:5173', // dashboard (Vite dev server)
  // Stage H2 - `vite preview`'s default port, serving the dashboard's
  // production build. The Playwright smoke suite (packages/dashboard/e2e)
  // runs against this, not the dev server, on purpose - without this
  // origin allowed, every login in that suite fails at the CORS layer,
  // silently, before the request ever reaches a route.
  'http://localhost:4173', // dashboard (Vite preview / production build)
  'http://localhost:19006', // mobile-app (Expo web dev server)
];

function resolveCorsOrigins(config: ConfigService): string[] {
  const raw = config.get<string>('CORS_ORIGINS') ?? '';
  const origins = raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (origins.length > 0) {
    return origins;
  }

  if (config.get<string>('NODE_ENV') === 'production') {
    throw new Error(
      'CORS_ORIGINS must be set in production - refusing to start with no explicit allowlist',
    );
  }

  return DEV_DEFAULT_CORS_ORIGINS;
}

// Fail-safe-by-default, same shape as resolveCorsOrigins above: a
// production deploy only gets /api/docs if someone explicitly opts in via
// SWAGGER_ENABLED. Development gets it for free since there's no exposure
// risk there.
function shouldEnableSwagger(config: ConfigService): boolean {
  return (
    config.get<string>('NODE_ENV') !== 'production' ||
    config.get<boolean>('SWAGGER_ENABLED') === true
  );
}

function setupSwagger(app: NestExpressApplication): void {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('BongoFleet API')
      .setDescription('BongoFleet backend API - motorcycle ownership-plan and fleet management')
      .setVersion('1.0')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup('api/docs', app, document);
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  // Stage H0b Part 1 - must be set before anything reads req.ip (rate
  // limiting, audit logging, etc.). See trust-proxy.util.ts for what values
  // are accepted and why "true" is refused outright.
  app.set('trust proxy', parseTrustProxy(config.get<string>('TRUST_PROXY')));

  app.use(helmet());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({ origin: resolveCorsOrigins(config), credentials: true });

  if (shouldEnableSwagger(config)) {
    setupSwagger(app);
  }

  const port = config.get<number>('PORT') ?? 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`BongoFleet API listening on http://localhost:${port}`);
}
bootstrap();
