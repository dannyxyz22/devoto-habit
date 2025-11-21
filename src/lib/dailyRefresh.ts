import { BOOKS } from './books';
import { getReadingPlan, getProgress, getDailyBaseline, setDailyBaseline } from './storage';
import { computeTotalWords, computeWordsUpToPosition, computeWordsUpToInclusiveTarget, computeDaysRemaining, computeDailyTargetWords, computeAchievedWordsToday, computeDailyProgressPercent } from './reading';
import { updateDailyProgressWidget } from '@/main';

// Central DRY function to recompute daily percent & push widget without needing UI pages.
export async function performDailyWidgetRefresh() {
  try {
    const todayISO = new Date().toISOString().slice(0, 10);
    // Choose active book same heuristic as Index
    let activeBookId: string | null = null;
    try {
      const last = localStorage.getItem('lastBookId');
      if (last) activeBookId = last;
      if (!activeBookId) {
        for (const b of BOOKS) {
          const plan = getReadingPlan(b.id);
          if (plan?.targetDateISO) { activeBookId = b.id; break; }
        }
      }
    } catch { }

    if (!activeBookId) return; // nothing to refresh

    const meta = BOOKS.find(b => b.id === activeBookId);
    const isUserEpub = activeBookId.startsWith('user-');

    if (!meta && !isUserEpub) return;

    const progress = getProgress(activeBookId);
    let dailyProgressPercent: number | null = null;
    let hasGoal = false;

    if (isUserEpub || meta?.type === 'epub') {
      // EPUB: percent based logic
      const base = getDailyBaseline(activeBookId, todayISO);
      if (!base && (progress.percent || 0) > 0) {
        setDailyBaseline(activeBookId, todayISO, { words: 0, percent: progress.percent });
      }
      const baselinePercent = base ? base.percent : (progress.percent || 0);
      const plan = getReadingPlan(activeBookId);
      const daysRemaining = computeDaysRemaining(plan?.targetDateISO);
      const dailyTargetPercent = daysRemaining ? Math.ceil(Math.max(0, 100 - baselinePercent) / daysRemaining) : null;
      const achievedPercentToday = Math.max(0, (progress.percent || 0) - baselinePercent);
      dailyProgressPercent = computeDailyProgressPercent(achievedPercentToday, dailyTargetPercent);
      hasGoal = dailyTargetPercent != null && dailyTargetPercent > 0;
    } else {
      // Non EPUB: load structure if cached only (avoid network on background)
      if (!meta) return; // Should not happen given checks above
      let parts: any = null;
      try { const cached = localStorage.getItem(`book:${meta.id}`); if (cached) parts = JSON.parse(cached); } catch { }
      if (!parts) return; // no cached data, skip silent refresh
      const totalWords = computeTotalWords(parts);
      const wordsUpToCurrent = computeWordsUpToPosition(parts, { partIndex: progress.partIndex, chapterIndex: progress.chapterIndex });
      const plan = getReadingPlan(activeBookId);
      const targetWords = computeWordsUpToInclusiveTarget(parts, { targetPartIndex: plan.targetPartIndex, targetChapterIndex: plan.targetChapterIndex }, totalWords);
      const base = getDailyBaseline(activeBookId, todayISO);
      if (!base && wordsUpToCurrent > 0) {
        // Use words-based total book percent for baseline percent
        const totalBookPercent = Math.min(100, Math.round((wordsUpToCurrent / Math.max(1, totalWords)) * 100));
        setDailyBaseline(activeBookId, todayISO, { words: wordsUpToCurrent, percent: totalBookPercent });
      }
      const baselineWords = base ? base.words : wordsUpToCurrent;
      const daysRemaining = computeDaysRemaining(plan?.targetDateISO);
      const dailyTargetWords = computeDailyTargetWords(targetWords, baselineWords, daysRemaining);
      const achievedWordsToday = computeAchievedWordsToday(wordsUpToCurrent, baselineWords);
      dailyProgressPercent = computeDailyProgressPercent(achievedWordsToday, dailyTargetWords);
      hasGoal = dailyTargetWords != null && dailyTargetWords > 0;
    }

    if (dailyProgressPercent != null) {
      await updateDailyProgressWidget(dailyProgressPercent, hasGoal);
    }
  } catch (e) {
    try { console.log('[DailyRefresh] erro', e); } catch { }
  }
}

// Expose on window for native-triggered usage
try { (window as any).devotaDailyRefresh = performDailyWidgetRefresh; } catch { }