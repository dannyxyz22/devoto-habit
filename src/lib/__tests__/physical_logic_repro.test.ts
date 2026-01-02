
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { calculatePagePercent } from '../percentageUtils';

// Mock storage functions
const title = 'Test Book';
const bookId = 'test-book-1';
const todayISO = '2025-01-01';

const mocks = {
    getProgress: vi.fn(),
    setProgress: vi.fn(),
    getDailyBaseline: vi.fn(),
    setDailyBaseline: vi.fn(),
};

// Simulate the logic in PhysicalBookTracker
function simulateTracker(physicalBook: any) {
    const existingProgress = mocks.getProgress(physicalBook.id);

    // Logic from PhysicalBookTracker.tsx
    if (!existingProgress || existingProgress.currentPage !== physicalBook.currentPage) {
        const percent = calculatePagePercent(physicalBook.currentPage, physicalBook.totalPages);
        mocks.setProgress(physicalBook.id, {
            partIndex: 0,
            chapterIndex: 0,
            percent,
            currentPage: physicalBook.currentPage,
            totalPages: physicalBook.totalPages,
        });
    }

    const baseline = mocks.getDailyBaseline(physicalBook.id, todayISO);

    if (!baseline || (baseline.page === undefined)) {
        const percent = calculatePagePercent(physicalBook.currentPage, physicalBook.totalPages);

        mocks.setDailyBaseline(physicalBook.id, todayISO, {
            words: 0,
            percent,
            page: physicalBook.currentPage
        });
    }
}

describe('Physical Book Baseline Logic', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should include page property when creating a new baseline', () => {
        const book = { id: bookId, currentPage: 52, totalPages: 100 };

        mocks.getProgress.mockReturnValue({ currentPage: 52 }); // Progress matches
        mocks.getDailyBaseline.mockReturnValue(null); // No baseline exists

        simulateTracker(book);

        expect(mocks.setDailyBaseline).toHaveBeenCalledWith(
            bookId,
            todayISO,
            expect.objectContaining({
                page: 52,
                percent: 52,
                words: 0
            })
        );
    });

    it('should repairing existing baseline missing page property', () => {
        const book = { id: bookId, currentPage: 52, totalPages: 100 };

        mocks.getProgress.mockReturnValue({ currentPage: 52 });
        // Scenario: Old bug created baseline without page
        mocks.getDailyBaseline.mockReturnValue({ words: 0, percent: 52 });

        simulateTracker(book);

        expect(mocks.setDailyBaseline).toHaveBeenCalledWith(
            bookId,
            todayISO,
            expect.objectContaining({
                page: 52
            })
        );
    });

    it('should NOT overwrite correct baseline', () => {
        const book = { id: bookId, currentPage: 53, totalPages: 100 }; // User read 1 page

        mocks.getProgress.mockReturnValue({ currentPage: 53 });
        // Baseline correctly set at start of day (52)
        mocks.getDailyBaseline.mockReturnValue({ words: 0, percent: 52, page: 52 });

        simulateTracker(book);

        // Should NOT call setDailyBaseline again
        expect(mocks.setDailyBaseline).not.toHaveBeenCalled();
    });

    it('should sync local progress if outdated', () => {
        const book = { id: bookId, currentPage: 55, totalPages: 100 }; // Cloud has newer page

        mocks.getProgress.mockReturnValue({ currentPage: 50 }); // Local is old

        simulateTracker(book);

        expect(mocks.setProgress).toHaveBeenCalledWith(
            bookId,
            expect.objectContaining({
                currentPage: 55,
                percent: 55
            })
        );
    });
});
