import { describe, it, expect, beforeAll, vi } from 'vitest';
import {
  computeDaysRemaining,
  computeDailyTargetWords,
  computeAchievedWordsToday,
  computeDailyProgressPercent,
} from '../reading';
import { addDays, formatISO } from 'date-fns';

// Freeze time helper
const setSystemDate = (d: Date) => {
  vi.setSystemTime(d);
};

describe('daily goal helpers', () => {
  beforeAll(() => {
    vi.useFakeTimers();
  });

  it('computeDaysRemaining returns at least 1 and includes today', () => {
    const today = new Date('2025-09-08T12:00:00Z');
    setSystemDate(today);
    const target = formatISO(addDays(today, 0), { representation: 'date' });
    const target2 = formatISO(addDays(today, 3), { representation: 'date' });

    expect(computeDaysRemaining(target)).toBe(1);
    expect(computeDaysRemaining(target2)).toBe(4); // includes today
  });

  it('computeDailyTargetWords divides remaining by days, rounding up', () => {
    const targetWords = 1000;
    const baselineWords = 100; // start-of-day position
    const days = 3;
    expect(computeDailyTargetWords(targetWords, baselineWords, days)).toBe(Math.ceil((1000 - 100) / 3));
  });

  it('computeAchievedWordsToday clamps at 0 if behind baseline', () => {
    expect(computeAchievedWordsToday(500, 600)).toBe(0);
    expect(computeAchievedWordsToday(700, 600)).toBe(100);
  });

  it('computeDailyProgressPercent returns null when no target, else capped 0..100', () => {
    expect(computeDailyProgressPercent(50, null)).toBeNull();
    expect(computeDailyProgressPercent(50, 100)).toBe(50);
    expect(computeDailyProgressPercent(120, 100)).toBe(100);
  });
});
