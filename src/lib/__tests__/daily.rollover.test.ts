import { describe, it, expect, beforeAll, vi } from 'vitest';
import {
  computeDaysRemaining,
  computeDailyTargetWords,
  computeAchievedWordsToday,
  computeDailyProgressPercent,
  deriveBaselineWords,
  deriveBaselinePercent,
} from '../reading';
import { addDays, formatISO } from 'date-fns';

const setSystemDate = (d: Date) => vi.setSystemTime(d);

describe('daily rollover behavior', () => {
  beforeAll(() => {
    vi.useFakeTimers();
  });

  it('when day changes and no baseline exists for the new day, progress starts from 0% for words', () => {
    // Yesterday state
    const yesterday = new Date('2025-09-07T10:00:00Z');
    setSystemDate(yesterday);
    const targetWords = 1000;
    const wordsUpToCurrentYesterday = 600; // user ended day at 600 words

    // Yesterday: suppose baseline existed at 400 words
    const baselineYesterday = { words: 400 };
    const achievedYesterday = computeAchievedWordsToday(wordsUpToCurrentYesterday, baselineYesterday.words);
    const daysRemYesterday = computeDaysRemaining(formatISO(addDays(yesterday, 3), { representation: 'date' }));
    const dailyTargetYesterday = computeDailyTargetWords(targetWords, baselineYesterday.words, daysRemYesterday);
    const percentYesterday = computeDailyProgressPercent(achievedYesterday, dailyTargetYesterday);
    expect(percentYesterday).not.toBeNull();

    // Today: new day, baseline missing -> derive from current words
    const today = new Date('2025-09-08T08:00:00Z');
    setSystemDate(today);
    const wordsUpToCurrentToday = wordsUpToCurrentYesterday; // same position at day start

    const baselineTodayDerived = deriveBaselineWords(null, wordsUpToCurrentToday);
    const daysRemToday = computeDaysRemaining(formatISO(addDays(today, 2), { representation: 'date' }));
    const dailyTargetToday = computeDailyTargetWords(targetWords, baselineTodayDerived, daysRemToday);
    const achievedToday = computeAchievedWordsToday(wordsUpToCurrentToday, baselineTodayDerived);
    const percentToday = computeDailyProgressPercent(achievedToday, dailyTargetToday);

    expect(achievedToday).toBe(0);
    expect(percentToday).toBe(0);
  });

  it('EPUB: when day changes and baseline is missing, progress starts at 0% toward the day target', () => {
    const yesterday = new Date('2025-09-07T10:00:00Z');
    setSystemDate(yesterday);
    const currentPercentYesterday = 60;
    const baselinePercentYesterday = 40;

    // Today
    const today = new Date('2025-09-08T08:00:00Z');
    setSystemDate(today);
    const currentPercentToday = currentPercentYesterday;

    const baselinePercentToday = deriveBaselinePercent(null, currentPercentToday);
    const daysRem = computeDaysRemaining(formatISO(addDays(today, 2), { representation: 'date' }));
    const dailyTargetPercent = daysRem ? Math.ceil(Math.max(0, 100 - baselinePercentToday) / daysRem) : null;

    const achieved = Math.max(0, currentPercentToday - baselinePercentToday);
    const p = computeDailyProgressPercent(achieved, dailyTargetPercent);

    expect(achieved).toBe(0);
    expect(p).toBe(0);
  });
});
