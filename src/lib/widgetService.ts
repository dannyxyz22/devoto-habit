import { getDatabase } from "@/lib/database/db";
import {
    getDailyBaselineAsync,
    getReadingPlanAsync,
    getProgress
} from "@/lib/storage";
import {
    computeDaysRemaining,
    computeDailyTargetWords,
    computeDailyProgressPercent,
    computeTotalWords,
    computeWordsUpToPosition
} from "@/lib/reading";
import {
    calculatePagePercent,
    calculateWordPercent,
    percentToPagesCeil
} from "@/lib/percentageUtils";
import { updateDailyProgressWidget } from "@/main";
import { WidgetUpdater, canUseNative } from "@/lib/widgetUpdater"; // Verify path
import { format } from "date-fns";
import { BOOKS } from "@/lib/books";
import { dataLayer } from "@/services/data/RxDBDataLayer";

export async function refreshWidget(bookId: string) {
    if (!canUseNative()) return;

    try {
        console.log('[WidgetService] 🔄 Refreshing widget for book:', bookId);

        // 1. Get Book Metadata
        let bookMeta: any = BOOKS.find(b => b.id === bookId);
        if (!bookMeta) {
            try {
                const db = await getDatabase();
                // Try user_epubs
                const epub = await db.user_epubs.findOne(bookId).exec();
                if (epub) {
                    bookMeta = { ...epub.toJSON(), type: 'epub', isUserUpload: true };
                } else {
                    // Try books
                    const book = await db.books.findOne(bookId).exec();
                    if (book) {
                        bookMeta = { ...book.toJSON() };
                    }
                }
            } catch (e) {
                console.error('[WidgetService] Failed to load book meta:', e);
            }
        }

        if (!bookMeta) {
            console.warn('[WidgetService] Book not found, cannot update widget');
            return;
        }

        const isPhysical = bookMeta.type === 'physical';
        const isEpub = bookMeta.type === 'epub' || bookMeta.isUserUpload; // Assuming user upload is epub for now

        // 2. Get Reading Plan
        const plan = await getReadingPlanAsync(bookId);
        if (!plan?.targetDateISO) {
            console.log('[WidgetService] No reading plan, clearing widget goal');
            await updateDailyProgressWidget(0, false);
            await WidgetUpdater.update?.();
            return;
        }

        const todayISO = format(new Date(), 'yyyy-MM-dd');

        // 3. Get Daily Baseline
        const baseline = await getDailyBaselineAsync(bookId, todayISO);

        // 4. Get Current Progress
        let currentProgress: { percent: number; currentPage?: number; totalPages?: number; words?: number } = { percent: 0 };

        if (isPhysical) {
            // For physical, we trust RxDB or local state passed in? 
            // Better to fetch fresh from RxDB to be sure
            const book = await dataLayer.getBook(bookId);
            if (book) {
                currentProgress = {
                    percent: calculatePagePercent(book.current_page || 0, book.total_pages || 0, { round: false }),
                    currentPage: book.current_page || 0,
                    totalPages: book.total_pages || 0
                };
            }
        } else {
            // For EPUB
            // Check RxDB first
            const userEpub = await dataLayer.getUserEpub(bookId);
            if (userEpub) {
                currentProgress.percent = userEpub.percentage || 0;
            } else {
                // Fallback to static book in books collection
                const book = await dataLayer.getBook(bookId);
                if (book) {
                    currentProgress.percent = book.percentage || 0;
                }
            }
        }

        // 5. Calculate Daily Progress
        const daysRemaining = computeDaysRemaining(plan.targetDateISO);
        let dailyProgressPercent = 0;

        if (isPhysical && currentProgress.totalPages && currentProgress.currentPage !== undefined) {
            // Physical calc
            const baselinePercent = baseline ? baseline.percent : 0; // Baseline for physical is stored as percent too?
            // Wait, Index.tsx uses pages for physical baseline if available

            let baselinePage = 0;
            if (baseline && baseline.page !== undefined) {
                baselinePage = baseline.page;
            } else {
                // Fallback
                baselinePage = Math.round(((baseline?.percent || 0) / 100) * currentProgress.totalPages);
            }

            const pagesReadToday = Math.max(0, currentProgress.currentPage - baselinePage);

            // Target
            // We need dailyTargetWords but for physical it's dailyTargetPercent...
            // Re-using logic from Index.tsx

            // Calculate daily target percent
            const dailyTargetPercent = daysRemaining ? Math.max(0, 100 - (baseline?.percent || 0)) / daysRemaining : 0;
            const pagesExpectedToday = percentToPagesCeil(dailyTargetPercent, currentProgress.totalPages);

            if (pagesExpectedToday > 0) {
                dailyProgressPercent = calculatePagePercent(pagesReadToday, pagesExpectedToday) || 0;
            } else if (pagesReadToday > 0) {
                dailyProgressPercent = 100; // Done for the day if target is 0 but we read something? Or maybe 100
            }

        } else {
            // EPUB / Percent based
            const baselinePercent = baseline ? baseline.percent : 0;
            const currentPercent = currentProgress.percent;

            const achievedPercentToday = Math.max(0, currentPercent - baselinePercent);

            const dailyTargetPercent = daysRemaining ? Math.max(0, 100 - baselinePercent) / daysRemaining : 0;

            dailyProgressPercent = computeDailyProgressPercent(achievedPercentToday, dailyTargetPercent) ?? 0;
        }

        // Clamp
        dailyProgressPercent = Math.max(0, Math.min(100, dailyProgressPercent));
        const hasGoal = true; // We established plan.targetDateISO exists

        // 6. Update Widget
        console.log('[WidgetService] 🚀 Updating widget:', { dailyProgressPercent, hasGoal, bookId });
        await updateDailyProgressWidget(dailyProgressPercent, hasGoal);
        await WidgetUpdater.update?.();

    } catch (err) {
        console.error('[WidgetService] ❌ Failed to refresh widget:', err);
    }
}
