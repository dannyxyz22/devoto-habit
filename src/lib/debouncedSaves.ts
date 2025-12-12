/**
 * Debounced save utilities for RxDB operations
 * Prevents excessive writes for high-frequency updates
 */

type DebouncedFn<T extends (...args: any[]) => any> = {
  (...args: Parameters<T>): void;
  flush: () => void;
  cancel: () => void;
};

/**
 * Creates a debounced version of an async function
 */
export function debounce<T extends (...args: any[]) => Promise<any>>(
  fn: T,
  delay: number
): DebouncedFn<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let pendingArgs: Parameters<T> | null = null;
  let pendingPromise: Promise<any> | null = null;

  const flush = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (pendingArgs) {
      const args = pendingArgs;
      pendingArgs = null;
      pendingPromise = fn(...args).catch(e => {
        console.warn('[debounce] Flush failed:', e);
      });
    }
  };

  const cancel = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    pendingArgs = null;
  };

  const debounced = (...args: Parameters<T>) => {
    pendingArgs = args;
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(flush, delay);
  };

  debounced.flush = flush;
  debounced.cancel = cancel;

  return debounced;
}

// Pre-configured debounced saves
import { dataLayer } from "@/services/data/RxDBDataLayer";
import type { RxUserStatsDocumentType, RxReadingPlanDocumentType, RxDailyBaselineDocumentType } from "@/lib/database/schema";

/**
 * Debounced user stats save (2 second delay)
 * Use for streak updates, reading time, last book ID
 */
export const debouncedSaveUserStats = debounce(
  async (stats: Partial<RxUserStatsDocumentType>) => {
    await dataLayer.saveUserStats(stats);
  },
  2000
);

/**
 * Debounced reading plan save (2 second delay)
 */
export const debouncedSaveReadingPlan = debounce(
  async (plan: Partial<RxReadingPlanDocumentType>) => {
    await dataLayer.saveReadingPlan(plan);
  },
  2000
);

/**
 * Debounced daily baseline save (5 second delay)
 * Baselines typically only change once per day
 */
export const debouncedSaveDailyBaseline = debounce(
  async (baseline: Partial<RxDailyBaselineDocumentType>) => {
    await dataLayer.saveDailyBaseline(baseline);
  },
  5000
);

/**
 * Flush all pending debounced saves
 * Call this before navigation or app close
 */
export const flushAllDebouncedSaves = () => {
  debouncedSaveUserStats.flush();
  debouncedSaveReadingPlan.flush();
  debouncedSaveDailyBaseline.flush();
};

// Flush on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', flushAllDebouncedSaves);
  window.addEventListener('pagehide', flushAllDebouncedSaves);
}
