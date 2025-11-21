/**
 * LRU (Least Recently Used) Cache for EPUB Locations
 * 
 * Manages caching of epub.js locations in localStorage with automatic cleanup
 * to prevent storage overflow. Keeps only the most recently accessed books.
 */

const CACHE_KEY_PREFIX = 'epubLocations:';
const CACHE_INDEX_KEY = 'epubLocationsIndex';
const MAX_CACHED_BOOKS = 5; // Maximum number of books to keep in cache

interface CacheIndex {
    [bookId: string]: number; // bookId -> timestamp of last access
}

/**
 * Get the cache index from localStorage
 */
function getCacheIndex(): CacheIndex {
    try {
        const raw = localStorage.getItem(CACHE_INDEX_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

/**
 * Save the cache index to localStorage
 */
function saveCacheIndex(index: CacheIndex): void {
    try {
        localStorage.setItem(CACHE_INDEX_KEY, JSON.stringify(index));
    } catch (err) {
        console.error('[LocationsCache] Failed to save index:', err);
    }
}

/**
 * Clean up old cache entries, keeping only the most recent MAX_CACHED_BOOKS
 */
function cleanupOldEntries(currentBookId: string): void {
    const index = getCacheIndex();

    // Get all book IDs sorted by last access time (most recent first)
    const sortedBooks = Object.entries(index)
        .sort(([, timeA], [, timeB]) => timeB - timeA);

    // If we have more than MAX_CACHED_BOOKS, remove the oldest ones
    if (sortedBooks.length >= MAX_CACHED_BOOKS) {
        const booksToRemove = sortedBooks.slice(MAX_CACHED_BOOKS - 1); // Keep room for current book

        booksToRemove.forEach(([bookId]) => {
            if (bookId !== currentBookId) {
                try {
                    localStorage.removeItem(`${CACHE_KEY_PREFIX}${bookId}`);
                    delete index[bookId];
                    console.log('[LocationsCache] Removed old cache for:', bookId);
                } catch (err) {
                    console.error('[LocationsCache] Failed to remove cache:', err);
                }
            }
        });

        saveCacheIndex(index);
    }
}

/**
 * Load locations from cache for a specific book
 * @param bookId - The book ID
 * @returns The cached locations string, or null if not found
 */
export function loadLocationsFromCache(bookId: string): string | null {
    try {
        const cached = localStorage.getItem(`${CACHE_KEY_PREFIX}${bookId}`);

        if (cached) {
            // Update last access time
            const index = getCacheIndex();
            index[bookId] = Date.now();
            saveCacheIndex(index);

            console.log('[LocationsCache] Loaded from cache:', bookId);
            return cached;
        }

        return null;
    } catch (err) {
        console.error('[LocationsCache] Failed to load cache:', err);
        return null;
    }
}

/**
 * Save locations to cache for a specific book
 * @param bookId - The book ID
 * @param locationsData - The locations data string from epub.js
 */
export function saveLocationsToCache(bookId: string, locationsData: string): void {
    try {
        // Clean up old entries before saving new one
        cleanupOldEntries(bookId);

        // Save the locations
        localStorage.setItem(`${CACHE_KEY_PREFIX}${bookId}`, locationsData);

        // Update index
        const index = getCacheIndex();
        index[bookId] = Date.now();
        saveCacheIndex(index);

        console.log('[LocationsCache] Saved to cache:', bookId, `(${Object.keys(index).length}/${MAX_CACHED_BOOKS} books cached)`);
    } catch (err) {
        console.error('[LocationsCache] Failed to save cache:', err);

        // If we hit quota exceeded, try to clean up and retry
        if (err instanceof DOMException && err.name === 'QuotaExceededError') {
            console.warn('[LocationsCache] Quota exceeded, forcing cleanup...');
            const index = getCacheIndex();
            const oldestBook = Object.entries(index)
                .sort(([, timeA], [, timeB]) => timeA - timeB)[0];

            if (oldestBook) {
                try {
                    localStorage.removeItem(`${CACHE_KEY_PREFIX}${oldestBook[0]}`);
                    delete index[oldestBook[0]];
                    saveCacheIndex(index);

                    // Retry save
                    localStorage.setItem(`${CACHE_KEY_PREFIX}${bookId}`, locationsData);
                    index[bookId] = Date.now();
                    saveCacheIndex(index);

                    console.log('[LocationsCache] Saved after cleanup');
                } catch (retryErr) {
                    console.error('[LocationsCache] Failed even after cleanup:', retryErr);
                }
            }
        }
    }
}

/**
 * Clear all cached locations (useful for debugging or manual cleanup)
 */
export function clearAllLocationsCache(): void {
    try {
        const index = getCacheIndex();
        Object.keys(index).forEach(bookId => {
            localStorage.removeItem(`${CACHE_KEY_PREFIX}${bookId}`);
        });
        localStorage.removeItem(CACHE_INDEX_KEY);
        console.log('[LocationsCache] Cleared all cache');
    } catch (err) {
        console.error('[LocationsCache] Failed to clear cache:', err);
    }
}

/**
 * Get cache statistics (for debugging)
 */
export function getCacheStats(): { cachedBooks: number; maxBooks: number; bookIds: string[] } {
    const index = getCacheIndex();
    return {
        cachedBooks: Object.keys(index).length,
        maxBooks: MAX_CACHED_BOOKS,
        bookIds: Object.keys(index),
    };
}
