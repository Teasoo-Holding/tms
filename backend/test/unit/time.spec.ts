import { watDate, watIso, watWallClock } from '../../src/domain/time';

describe('WAT time helpers', () => {
  it('gives the WAT date and time of an instant', () => {
    expect(watDate('2026-10-28T23:30:00Z')).toBe('2026-10-29');
    expect(watDate('2026-10-28T22:59:59Z')).toBe('2026-10-28');
    expect(watIso(new Date('2026-10-28T23:30:00Z'))).toBe('2026-10-29T00:30:00+01:00');
    expect(watWallClock(new Date('2026-10-28T23:30:00Z')).toISOString()).toBe('2026-10-29T00:30:00.000Z');
  });
});
