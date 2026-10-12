import { describe, expect, it } from 'vitest';
import { dayToIso, isoWeek, mondayOf, mondayOfIsoWeek, parseDay, weekLabel, weekday } from './dates';

describe('dates', () => {
  it('čte český i ISO formát data', () => {
    expect(dayToIso(parseDay('12.10.2026')!)).toBe('2026-10-12');
    expect(dayToIso(parseDay('5.1.2026')!)).toBe('2026-01-05');
    expect(dayToIso(parseDay('2026-10-12')!)).toBe('2026-10-12');
    expect(parseDay('31.02.2026')).toBeNull();
    expect(parseDay('')).toBeNull();
  });

  it('počítá ISO týdny včetně přelomu roku', () => {
    expect(isoWeek(parseDay('12.10.2026')!)).toEqual({ year: 2026, week: 42 });
    expect(isoWeek(parseDay('05.01.2026')!)).toEqual({ year: 2026, week: 2 });
    expect(isoWeek(parseDay('31.12.2026')!)).toEqual({ year: 2026, week: 53 });
    expect(isoWeek(parseDay('04.01.2027')!)).toEqual({ year: 2027, week: 1 });
    expect(isoWeek(parseDay('29.12.2025')!)).toEqual({ year: 2026, week: 1 });
  });

  it('najde pondělí týdne a den v týdnu', () => {
    const wed = parseDay('14.10.2026')!;
    expect(weekday(wed)).toBe(3);
    expect(dayToIso(mondayOf(wed))).toBe('2026-10-12');
    expect(dayToIso(mondayOfIsoWeek(2026, 42))).toBe('2026-10-12');
    expect(dayToIso(mondayOfIsoWeek(2026, 1))).toBe('2025-12-29');
    expect(weekLabel(wed)).toBe('CW 42');
    expect(weekLabel(wed, true)).toBe('CW 42/2026');
  });
});
