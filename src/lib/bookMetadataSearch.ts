/**
 * Book Metadata Search - Integration with Google Books API and Open Library
 * With lazy loading support for cover images
 */

const CACHE_DB_NAME = 'devoto-habit-metadata-cache';
const CACHE_DB_VERSION = 1;
const CACHE_STORE_NAME = 'searchCache';
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

export interface BookSearchResult {
    title: string;
    author: string;
    coverUrl?: string;              // Data URL after download (for storage)
    coverSourceUrl?: string;        // Original API image URL (for lazy loading)
    totalPages?: number;
    isbn?: string;
    publisher?: string;
    publishedDate?: string;
    description?: string;
}

interface CachedSearch {
    query: string;
    results: BookSearchResult[];
    timestamp: number;
}

/**
 * Initialize cache database
 */
function openCacheDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(CACHE_DB_NAME, CACHE_DB_VERSION);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;

            if (!db.objectStoreNames.contains(CACHE_STORE_NAME)) {
                db.createObjectStore(CACHE_STORE_NAME, { keyPath: 'query' });
            }
        };
    });
}

/**
 * Get cached search results
 */
async function getCachedMetadata(query: string): Promise<BookSearchResult[] | null> {
    try {
        const db = await openCacheDB();

        return new Promise((resolve, reject) => {
            const transaction = db.transaction([CACHE_STORE_NAME], 'readonly');
            const store = transaction.objectStore(CACHE_STORE_NAME);
            const request = store.get(query.toLowerCase());

            request.onsuccess = () => {
                const cached = request.result as CachedSearch | undefined;

                if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
                    console.log('[MetadataSearch] Cache hit:', query);
                    resolve(cached.results);
                } else {
                    if (cached) {
                        console.log('[MetadataSearch] Cache expired:', query);
                    }
                    resolve(null);
                }
            };
            request.onerror = () => reject(request.error);

            transaction.oncomplete = () => db.close();
        });
    } catch (error) {
        console.error('[MetadataSearch] Cache read error:', error);
        return null;
    }
}

/**
 * Cache search results
 */
async function cacheMetadata(query: string, results: BookSearchResult[]): Promise<void> {
    try {
        const db = await openCacheDB();

        const cached: CachedSearch = {
            query: query.toLowerCase(),
            results,
            timestamp: Date.now(),
        };

        return new Promise((resolve, reject) => {
            const transaction = db.transaction([CACHE_STORE_NAME], 'readwrite');
            const store = transaction.objectStore(CACHE_STORE_NAME);
            const request = store.put(cached);

            request.onsuccess = () => {
                console.log('[MetadataSearch] Cached:', query, results.length, 'results');
                resolve();
            };
            request.onerror = () => reject(request.error);

            transaction.oncomplete = () => db.close();
        });
    } catch (error) {
        console.error('[MetadataSearch] Cache write error:', error);
    }
}

/**
 * Download image and convert to Data URL for offline storage
 */
export async function downloadImageAsDataUrl(url: string): Promise<string | undefined> {
    try {
        // Use HTTPS if URL is HTTP
        const secureUrl = url.replace(/^http:/, 'https:');
        console.log('[MetadataSearch] Downloading cover from:', secureUrl);

        // Add timeout to prevent hanging on slow downloads
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

        try {
            const response = await fetch(secureUrl, {
                signal: controller.signal,
                mode: 'cors' // Explicitly request CORS
            });
            clearTimeout(timeoutId);

            if (!response.ok) {
                console.warn('[MetadataSearch] Cover download failed:', response.status, response.statusText);
                return undefined;
            }

            const blob = await response.blob();
            console.log('[MetadataSearch] Cover downloaded, size:', blob.size, 'bytes, type:', blob.type);

            // Convert blob to Data URL
            const dataUrl = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result as string);
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });

            console.log('[MetadataSearch] Cover converted to Data URL, length:', dataUrl.length);
            return dataUrl;
        } catch (fetchError) {
            clearTimeout(timeoutId);
            if (fetchError instanceof Error && fetchError.name === 'AbortError') {
                console.error('[MetadataSearch] Cover download timeout after 10s:', secureUrl);
            } else {
                console.error('[MetadataSearch] Cover fetch error (likely CORS):', fetchError);
            }

            // Try CORS proxy fallback
            console.log('[MetadataSearch] Attempting CORS proxy fallback...');
            try {
                const proxyUrl = `https://images.weserv.nl/?url=${encodeURIComponent(secureUrl)}`;
                const proxyResponse = await fetch(proxyUrl);

                if (!proxyResponse.ok) {
                    console.warn('[MetadataSearch] Proxy download failed:', proxyResponse.status);
                    return undefined;
                }

                const proxyBlob = await proxyResponse.blob();
                console.log('[MetadataSearch] Proxy cover downloaded, size:', proxyBlob.size, 'bytes');

                const proxyDataUrl = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result as string);
                    reader.onerror = reject;
                    reader.readAsDataURL(proxyBlob);
                });

                console.log('[MetadataSearch] Proxy cover converted to Data URL, length:', proxyDataUrl.length);
                return proxyDataUrl;
            } catch (proxyError) {
                console.error('[MetadataSearch] Proxy fallback also failed:', proxyError);
                return undefined;
            }
        }
    } catch (error) {
        console.error('[MetadataSearch] Image download error:', error);
        return undefined;
    }
}

/**
 * Search Google Books API
 * Returns results immediately with coverSourceUrl for lazy loading
 */
async function searchGoogleBooks(query: string): Promise<BookSearchResult[]> {
    try {
        const encodedQuery = encodeURIComponent(query);
        const url = `https://www.googleapis.com/books/v1/volumes?q=${encodedQuery}&maxResults=10`;

        console.log('[MetadataSearch] Searching Google Books:', query);
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Google Books API error: ${response.status}`);
        }

        const data = await response.json();

        if (!data.items || data.items.length === 0) {
            return [];
        }

        // Return results immediately without waiting for cover downloads
        const results: BookSearchResult[] = data.items.map((item: any) => {
            const volumeInfo = item.volumeInfo;

            return {
                title: volumeInfo.title || 'Unknown Title',
                author: volumeInfo.authors?.[0] || 'Unknown Author',
                coverSourceUrl: volumeInfo.imageLinks?.thumbnail,  // Store source URL for lazy loading
                totalPages: volumeInfo.pageCount,
                isbn: volumeInfo.industryIdentifiers?.[0]?.identifier,
                publisher: volumeInfo.publisher,
                publishedDate: volumeInfo.publishedDate,
                description: volumeInfo.description,
            };
        });

        console.log('[MetadataSearch] Google Books found:', results.length, 'results (covers will load lazily)');
        return results;
    } catch (error) {
        console.error('[MetadataSearch] Google Books error:', error);
        throw error;
    }
}

/**
 * Search Open Library API
 * Returns results immediately with coverSourceUrl for lazy loading
 */
async function searchOpenLibrary(query: string): Promise<BookSearchResult[]> {
    try {
        const encodedQuery = encodeURIComponent(query);
        const url = `https://openlibrary.org/search.json?q=${encodedQuery}&limit=10`;

        console.log('[MetadataSearch] Searching Open Library:', query);
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Open Library API error: ${response.status}`);
        }

        const data = await response.json();

        if (!data.docs || data.docs.length === 0) {
            return [];
        }

        // Return results immediately without waiting for cover downloads
        const results: BookSearchResult[] = data.docs.map((doc: any) => {
            let coverSourceUrl: string | undefined;
            if (doc.cover_i) {
                coverSourceUrl = `https://covers.openlibrary.org/b/id/${doc.cover_i}-L.jpg`;
            }

            return {
                title: doc.title || 'Unknown Title',
                author: doc.author_name?.[0] || 'Unknown Author',
                coverSourceUrl,  // Store source URL for lazy loading
                totalPages: doc.number_of_pages_median,
                isbn: doc.isbn?.[0],
                publisher: doc.publisher?.[0],
                publishedDate: doc.first_publish_year?.toString(),
                description: undefined, // Open Library doesn't provide description in search
            };
        });

        console.log('[MetadataSearch] Open Library found:', results.length, 'results (covers will load lazily)');
        return results;
    } catch (error) {
        console.error('[MetadataSearch] Open Library error:', error);
        throw error;
    }
}

/**
 * Main search function with cache and fallback
 */
export async function searchBookMetadata(query: string): Promise<BookSearchResult[]> {
    if (!query || query.trim().length === 0) {
        return [];
    }

    const normalizedQuery = query.trim();

    // 1. Check cache first
    const cached = await getCachedMetadata(normalizedQuery);
    if (cached) {
        return cached;
    }

    // 2. Try Google Books API
    try {
        const results = await searchGoogleBooks(normalizedQuery);
        if (results.length > 0) {
            await cacheMetadata(normalizedQuery, results);
            return results;
        }
    } catch (error) {
        console.warn('[MetadataSearch] Google Books failed, trying Open Library...');
    }

    // 3. Fallback to Open Library
    try {
        const results = await searchOpenLibrary(normalizedQuery);
        if (results.length > 0) {
            await cacheMetadata(normalizedQuery, results);
            return results;
        }
    } catch (error) {
        console.error('[MetadataSearch] Both APIs failed:', error);
    }

    return [];
}
