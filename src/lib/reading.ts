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
