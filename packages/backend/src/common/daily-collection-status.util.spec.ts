import { PaymentStatus, Prisma } from '@prisma/client';
import { getDailyCollectionStatus } from './daily-collection-status.util';
import { PrismaService } from '../prisma/prisma.service';

function dec(n: number) {
  return new Prisma.Decimal(n);
}

const TODAY = new Date('2026-08-25T00:00:00.000Z');

describe('getDailyCollectionStatus', () => {
  let prisma: {
    client: {
      dailyAssignment: { findMany: jest.Mock };
      dailyPayment: { aggregate: jest.Mock; groupBy: jest.Mock };
    };
  };

  beforeEach(() => {
    prisma = {
      client: {
        dailyAssignment: { findMany: jest.fn() },
        dailyPayment: { aggregate: jest.fn(), groupBy: jest.fn() },
      },
    };
  });

  it('sums targetAmount for dueToday and COMPLETED paidAt for receivedToday', async () => {
    prisma.client.dailyAssignment.findMany.mockResolvedValue([
      { id: 'a1', motorcycleId: 'moto-1', targetAmount: dec(12000) },
      { id: 'a2', motorcycleId: 'moto-2', targetAmount: dec(15000) },
    ]);
    prisma.client.dailyPayment.aggregate.mockResolvedValue({ _sum: { amount: dec(20000) } });
    prisma.client.dailyPayment.groupBy.mockResolvedValue([
      { dailyAssignmentId: 'a1', _sum: { amount: dec(12000) } },
    ]);

    const status = await getDailyCollectionStatus(prisma as unknown as PrismaService, TODAY);

    expect(status.dueToday.toFixed(2)).toBe('27000.00'); // 12000 + 15000
    expect(status.receivedToday.toFixed(2)).toBe('20000.00');
  });

  it('an assignment with no payment at all is outstanding for its full target', async () => {
    prisma.client.dailyAssignment.findMany.mockResolvedValue([
      { id: 'a1', motorcycleId: 'moto-1', targetAmount: dec(10000) },
    ]);
    prisma.client.dailyPayment.aggregate.mockResolvedValue({ _sum: { amount: null } });
    prisma.client.dailyPayment.groupBy.mockResolvedValue([]); // no completed payments at all

    const status = await getDailyCollectionStatus(prisma as unknown as PrismaService, TODAY);

    expect(status.outstandingRows).toHaveLength(1);
    expect(status.outstandingRows[0]).toMatchObject({
      dailyAssignmentId: 'a1',
      motorcycleId: 'moto-1',
    });
    expect(status.outstandingRows[0].targetAmount.toFixed(2)).toBe('10000.00');
    expect(status.outstandingRows[0].paidAmount.toFixed(2)).toBe('0.00');
    expect(status.outstandingRows[0].balance.toFixed(2)).toBe('10000.00');
  });

  it('a fully-paid assignment is not outstanding; a partially-paid one is outstanding for the shortfall only', async () => {
    prisma.client.dailyAssignment.findMany.mockResolvedValue([
      { id: 'a1', motorcycleId: 'moto-1', targetAmount: dec(10000) }, // fully paid
      { id: 'a2', motorcycleId: 'moto-2', targetAmount: dec(15000) }, // short 7000
    ]);
    prisma.client.dailyPayment.aggregate.mockResolvedValue({ _sum: { amount: dec(18000) } });
    prisma.client.dailyPayment.groupBy.mockResolvedValue([
      { dailyAssignmentId: 'a1', _sum: { amount: dec(10000) } },
      { dailyAssignmentId: 'a2', _sum: { amount: dec(8000) } },
    ]);

    const status = await getDailyCollectionStatus(prisma as unknown as PrismaService, TODAY);

    expect(status.outstandingRows).toHaveLength(1);
    expect(status.outstandingRows[0]).toMatchObject({ dailyAssignmentId: 'a2' });
    expect(status.outstandingRows[0].balance.toFixed(2)).toBe('7000.00');
  });

  it('skips the groupBy call entirely when there are no assignments today (never one query per assignment, and never a needless one)', async () => {
    prisma.client.dailyAssignment.findMany.mockResolvedValue([]);
    prisma.client.dailyPayment.aggregate.mockResolvedValue({ _sum: { amount: null } });

    const status = await getDailyCollectionStatus(prisma as unknown as PrismaService, TODAY);

    expect(prisma.client.dailyPayment.groupBy).not.toHaveBeenCalled();
    expect(status.dueToday.toFixed(2)).toBe('0.00');
    expect(status.receivedToday.toFixed(2)).toBe('0.00');
    expect(status.outstandingRows).toEqual([]);
  });

  it('scopes both queries to [today, tomorrow)', async () => {
    prisma.client.dailyAssignment.findMany.mockResolvedValue([]);
    prisma.client.dailyPayment.aggregate.mockResolvedValue({ _sum: { amount: null } });

    await getDailyCollectionStatus(prisma as unknown as PrismaService, TODAY);

    const assignmentWhere = prisma.client.dailyAssignment.findMany.mock.calls[0][0].where;
    expect(assignmentWhere.assignedDate.gte).toEqual(TODAY);
    expect(assignmentWhere.assignedDate.lt).toEqual(new Date('2026-08-26T00:00:00.000Z'));

    const paymentWhere = prisma.client.dailyPayment.aggregate.mock.calls[0][0].where;
    expect(paymentWhere.status).toBe(PaymentStatus.COMPLETED);
    expect(paymentWhere.paidAt.gte).toEqual(TODAY);
    expect(paymentWhere.paidAt.lt).toEqual(new Date('2026-08-26T00:00:00.000Z'));
  });
});
