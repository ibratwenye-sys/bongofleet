import { INestApplication, ValidationPipe } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';

// e2e specs build the app straight from AppModule via Test.createTestingModule(),
// which never runs main.ts's bootstrap() - so anything wired imperatively there
// (app.useGlobalPipes, app.use(helmet()), app.enableCors()) is otherwise silently
// absent from every e2e test. Only the ValidationPipe is replicated here since
// that's the one that's actually load-bearing for correctness (DTO transform/
// whitelist behavior) rather than headers/CORS, which no current test asserts on.
//
// Stage H0b Part 1 - trust proxy is the one exception: main.ts sets it via
// app.set('trust proxy', parseTrustProxy(...)) before anything reads req.ip,
// and a handful of e2e tests specifically need that configured to exercise
// it (see rate-limiting.e2e-spec.ts). Defaults to `false` (disabled) so every
// other existing e2e test keeps its current assumption that req.ip is the
// raw test-client socket address, unaffected by any header it sends.
export async function createTestApp(
  moduleFixture: TestingModule,
  options: { trustProxy?: number | string | boolean } = {},
): Promise<INestApplication> {
  const app = moduleFixture.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app
    .getHttpAdapter()
    .getInstance()
    .set('trust proxy', options.trustProxy ?? false);
  await app.init();
  return app;
}
