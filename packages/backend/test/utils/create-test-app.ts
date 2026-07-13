import { INestApplication, ValidationPipe } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';

// e2e specs build the app straight from AppModule via Test.createTestingModule(),
// which never runs main.ts's bootstrap() - so anything wired imperatively there
// (app.useGlobalPipes, app.use(helmet()), app.enableCors()) is otherwise silently
// absent from every e2e test. Only the ValidationPipe is replicated here since
// that's the one that's actually load-bearing for correctness (DTO transform/
// whitelist behavior) rather than headers/CORS, which no current test asserts on.
export async function createTestApp(moduleFixture: TestingModule): Promise<INestApplication> {
  const app = moduleFixture.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.init();
  return app;
}
