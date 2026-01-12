import { RxBookDocumentType, RxSettingsDocumentType, RxUserEpubDocumentType, RxReadingPlanDocumentType, RxDailyBaselineDocumentType, RxUserStatsDocumentType } from '@/lib/database/schema';

export interface DataLayer {
    /**
     * Get all books for the current user
     */
    getBooks(): Promise<RxBookDocumentType[]>;

    /**
     * Get a single book by ID
     */
    getBook(id: string): Promise<RxBookDocumentType | null>;

    /**
     * Save or update a book
     */
    saveBook(book: Partial<RxBookDocumentType>): Promise<RxBookDocumentType>;

    /**
     * Delete a book (Soft delete)
     */
    deleteBook(id: string): Promise<void>;

    /**
     * Get user settings
     */
    getSettings(): Promise<RxSettingsDocumentType | null>;

    /**
     * Save user settings
     */
    saveSettings(settings: Partial<RxSettingsDocumentType>): Promise<RxSettingsDocumentType>;

    /**
     * Get all EPUB metadata for the current user
     */
    getUserEpubs(): Promise<RxUserEpubDocumentType[]>;

    /**
     * Get a single EPUB metadata by ID
     */
    getUserEpub(id: string): Promise<RxUserEpubDocumentType | null>;

    /**
     * Save or update EPUB metadata
     */
    saveUserEpub(epub: Partial<RxUserEpubDocumentType>): Promise<RxUserEpubDocumentType>;

    /**
     * Delete EPUB metadata (Soft delete)
     */
    deleteUserEpub(id: string): Promise<void>;

    // ========== Reading Plans ==========

    /**
     * Get reading plan for a book
     */
    getReadingPlan(bookId: string): Promise<RxReadingPlanDocumentType | null>;

    /**
     * Save or update reading plan
     */
    saveReadingPlan(plan: Partial<RxReadingPlanDocumentType>): Promise<RxReadingPlanDocumentType>;

    /**
     * Delete reading plan for a book
     */
    deleteReadingPlan(bookId: string): Promise<void>;

    // ========== Daily Baselines ==========

    /**
     * Get daily baseline for a book on a specific date
     */
    getDailyBaseline(bookId: string, dateISO: string): Promise<RxDailyBaselineDocumentType | null>;

    /**
     * Get all baselines for a book, ordered by date ascending
     * @param bookId The book ID
     * @param limit Optional limit on number of baselines to return (default: 90 days)
     */
    getBaselinesForBook(bookId: string, limit?: number): Promise<RxDailyBaselineDocumentType[]>;

    /**
     * Save daily baseline for a book
     */
    saveDailyBaseline(baseline: Partial<RxDailyBaselineDocumentType>): Promise<RxDailyBaselineDocumentType>;

    // ========== User Stats ==========

    /**
     * Get user stats (streak, reading time, last book)
     */
    getUserStats(): Promise<RxUserStatsDocumentType | null>;

    /**
     * Save user stats
     */
    saveUserStats(stats: Partial<RxUserStatsDocumentType>): Promise<RxUserStatsDocumentType>;
}
