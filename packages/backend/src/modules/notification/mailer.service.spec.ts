import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { MailerService } from './mailer.service';

function makeConfig(values: Record<string, unknown>) {
  return {
    get: jest.fn((key: string, fallback?: unknown) => values[key] ?? fallback),
  };
}

async function makeService(values: Record<string, unknown>): Promise<MailerService> {
  const moduleRef = await Test.createTestingModule({
    providers: [MailerService, { provide: ConfigService, useValue: makeConfig(values) }],
  }).compile();
  return moduleRef.get(MailerService);
}

describe('MailerService', () => {
  it('runs in log-only mode when SMTP_HOST is blank and still reports success', async () => {
    const service = await makeService({ SMTP_HOST: '' });

    expect(service.isConfigured).toBe(false);
    await expect(
      service.send({ to: ['owner@test.local'], subject: 'Hi', text: 'Body' }),
    ).resolves.toBe(true);
  });

  it('uses a real SMTP transport when SMTP_HOST is set', async () => {
    const service = await makeService({ SMTP_HOST: 'smtp.test.local' });
    expect(service.isConfigured).toBe(true);
  });

  it('reports false instead of throwing when the transport fails', async () => {
    const service = await makeService({ SMTP_HOST: 'smtp.test.local' });
    const transporter = (service as unknown as { transporter: { sendMail: jest.Mock } })
      .transporter;
    transporter.sendMail = jest.fn().mockRejectedValue(new Error('connection refused'));

    await expect(
      service.send({ to: ['owner@test.local'], subject: 'Hi', text: 'Body' }),
    ).resolves.toBe(false);
    expect(transporter.sendMail).toHaveBeenCalledTimes(1);
  });
});
