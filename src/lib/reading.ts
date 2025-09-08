import { differenceInCalendarDays, parseISO } from "date-fns";
// Shared book structure types and utilities for word counting and plan progress

export type Paragraph = { type: string; content: string };
export type Chapter = { chapter_title: string; content: Paragraph[] };
export type Part = { part_title: string; chapters: Chapter[] };

export type Position = { partIndex: number; chapterIndex: number };
export type PlanStart = { startPartIndex: number; startChapterIndex: number; startWords?: number } | null;
export type PlanTarget = { targetPartIndex?: number; targetChapterIndex?: number };

export const countWordsInChapter = (ch: Chapter): number => {
  let count = 0;
  ch.content.forEach((blk) => {
    count += blk.content.trim().split(/\s+/).filter(Boolean).length;
  });
  return count;
};

export const computeTotalWords = (parts: Part[] | null | undefined): number => {
  if (!parts) return 0;
  let count = 0;
  parts.forEach((part) => part.chapters.forEach((ch) => { count += countWordsInChapter(ch); }));
  return count;
};

export const computeWordsUpToPosition = (parts: Part[] | null | undefined, pos: Position): number => {
  if (!parts) return 0;
  let count = 0;
  parts.forEach((part, pi) =>
    part.chapters.forEach((ch, ci) => {
      if (pi < pos.partIndex || (pi === pos.partIndex && ci < pos.chapterIndex)) {
        count += countWordsInChapter(ch);
      }
    })
  );
  return count;
};

// Computes words up to and including the target chapter; if no target provided, returns total words
export const computeWordsUpToInclusiveTarget = (
  parts: Part[] | null | undefined,
  target: PlanTarget,
  precomputedTotal?: number
): number => {
  const total = precomputedTotal ?? computeTotalWords(parts);
  if (!parts || target.targetPartIndex === undefined || target.targetChapterIndex === undefined) return total;
  let count = 0;
  parts.forEach((part, pi) =>
    part.chapters.forEach((ch, ci) => {
      if (pi < target.targetPartIndex! || (pi === target.targetPartIndex! && ci <= target.targetChapterIndex!)) {
        count += countWordsInChapter(ch);
      }
    })
  );
  return count;
};

export const computePlanStartWords = (parts: Part[] | null | undefined, planStart: PlanStart): number => {
  if (!planStart) return 0;
  if (planStart.startWords != null) return planStart.startWords;
  if (!parts) return 0;
  let count = 0;
  parts.forEach((part, pi) =>
    part.chapters.forEach((ch, ci) => {
      if (pi < planStart.startPartIndex || (pi === planStart.startPartIndex && ci < planStart.startChapterIndex)) {
        count += countWordsInChapter(ch);
      }
    })
  );
  return count;
};

export const computePlanProgressPercent = (
  parts: Part[] | null | undefined,
  wordsUpToCurrent: number,
  targetWords: number,
  planStart: PlanStart
): number | null => {
  if (!parts) return null;
  const startWords = computePlanStartWords(parts, planStart);
  const denom = Math.max(1, targetWords - startWords);
  const num = Math.max(0, wordsUpToCurrent - startWords);
  return Math.min(100, Math.round((num / denom) * 100));
};

// Daily goal helpers
export const computeDaysRemaining = (targetDateISO: string | null | undefined): number | null => {
  if (!targetDateISO) return null;
  try {
    const target = parseISO(targetDateISO);
    const diff = differenceInCalendarDays(target, new Date());
    return Math.max(1, diff + 1);
  } catch {
    return null;
  }
};

export const computeDailyTargetWords = (
  targetWords: number,
  baselineWords: number | null,
  daysRemaining: number | null
): number | null => {
  if (!daysRemaining || baselineWords == null) return null;
  const remainingFromStartOfDay = Math.max(0, targetWords - baselineWords);
  return Math.ceil(remainingFromStartOfDay / daysRemaining);
};

export const computeAchievedWordsToday = (wordsUpToCurrent: number, baselineWords: number | null): number =>
  baselineWords != null ? Math.max(0, wordsUpToCurrent - baselineWords) : 0;

export const computeDailyProgressPercent = (
  achievedWordsToday: number,
  dailyTargetWords: number | null
): number | null => (dailyTargetWords ? Math.min(100, Math.round((achievedWordsToday / dailyTargetWords) * 100)) : null);

// Helpers to derive today's baseline synchronously (useful for rollover tests)
export const deriveBaselineWords = (baseline: { words: number } | null, wordsUpToCurrent: number): number =>
  baseline ? baseline.words : wordsUpToCurrent;

export const deriveBaselinePercent = (baseline: { percent: number } | null, currentPercent: number): number =>
  baseline ? baseline.percent : currentPercent;

// EPUB daily helpers (percent-based)
export const computeEpubDailyTargetPercent = (
  baselinePercent: number | null,
  daysRemaining: number | null
): number | null => {
  if (baselinePercent == null || daysRemaining == null) return null;
  return Math.ceil(Math.max(0, 100 - baselinePercent) / daysRemaining);
};

export const computeEpubAchievedPercentToday = (
  currentPercent: number,
  baselinePercent: number | null
): number => (baselinePercent != null ? Math.max(0, currentPercent - baselinePercent) : 0);
