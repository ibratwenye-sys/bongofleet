import { BadRequestException } from '@nestjs/common';
import { darEsSalaamDayRangeUtc } from './dar-es-salaam-day-range';

describe('darEsSalaamDayRangeUtc (Stage I3, §7)', () => {
  it('a Dar es Salaam calendar day starts at 21:00 UTC the day before (UTC+3)', () => {
    const { start, end } = darEsSalaamDayRangeUtc('2026-08-20');
    expect(start.toISOString()).toBe('2026-08-19T21:00:00.000Z');
    expect(end.toISOString()).toBe('2026-08-20T21:00:00.000Z');
  });

  it('the range is exactly 24 hours, end exclusive', () => {
    const { start, end } = darEsSalaamDayRangeUtc('2026-01-01');
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it('rejects a non-YYYY-MM-DD string', () => {
    expect(() => darEsSalaamDayRangeUtc('20-08-2026')).toThrow(BadRequestException);
    expect(() => darEsSalaamDayRangeUtc('2026-08-20T00:00:00.000Z')).toThrow(BadRequestException);
    expect(() => darEsSalaamDayRangeUtc('not-a-date')).toThrow(BadRequestException);
    expect(() => darEsSalaamDayRangeUtc('')).toThrow(BadRequestException);
  });
});
