import { describe, it, expect, beforeAll, vi } from 'vitest';
import {
  computeDaysRemaining,
  computeDailyProgressPercent,
  deriveBaselinePercent,
  computeEpubDailyTargetPercent,
  computeEpubAchievedPercentToday,
} from '../reading';
import { addDays, formatISO } from 'date-fns';

const setNow = (d: Date) => vi.setSystemTime(d);

describe('EPUB daily goal (percent-based)', () => {
  beforeAll(() => vi.useFakeTimers());

  it('derives baseline percent for a new day and starts at 0% progress', () => {
    // Yesterday 60%, baseline 40%
    const yesterday = new Date('2025-09-07T15:00:00Z');
    setNow(yesterday);

    // Today, same position at start of day, no baseline saved for today
    const today = new Date('2025-09-08T08:00:00Z');
    setNow(today);
    const currentPercent = 60;
    const baselineToday = deriveBaselinePercent(null, currentPercent);

    const daysRemaining = computeDaysRemaining(formatISO(addDays(today, 2), { representation: 'date' }));
    const dailyTarget = computeEpubDailyTargetPercent(baselineToday, daysRemaining);
    const achieved = computeEpubAchievedPercentToday(currentPercent, baselineToday);
    const p = computeDailyProgressPercent(achieved, dailyTarget);

    expect(achieved).toBe(0);
    expect(p).toBe(0);
  });

  it('computes daily target percent with rounding up and clamps progress to 100%', () => {
    const base = 70; // start-of-day percent
    const current = 95; // read 25% today
    const today = new Date('2025-09-08T09:00:00Z');
    setNow(today);

    const daysRemaining = computeDaysRemaining(formatISO(addDays(today, 1), { representation: 'date' })); // include today
    const dailyTarget = computeEpubDailyTargetPercent(base, daysRemaining); // ceil((100-70)/2) = ceil(30/2) = 15
    expect(dailyTarget).toBe(15);

    const achieved = computeEpubAchievedPercentToday(current, base); // 25
    const p = computeDailyProgressPercent(achieved, dailyTarget); // min(100, round(25/15*100)) = 100
    expect(p).toBe(100);
  });

  it('handles no goal (no target date)', () => {
    const base = 20;
    const current = 25;
    const dailyTarget = computeEpubDailyTargetPercent(base, null);
    const achieved = computeEpubAchievedPercentToday(current, base);
    const p = computeDailyProgressPercent(achieved, dailyTarget);
    expect(dailyTarget).toBeNull();
    expect(p).toBeNull();
  });
});
