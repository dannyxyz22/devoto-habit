/**
 * Physical Books Storage - IndexedDB management for physical book tracking
 */

const DB_NAME = 'devoto-habit-physical-books';
const DB_VERSION = 1;
const STORE_NAME = 'physicalBooks';

export interface PhysicalBook {
    id: string;                    // 'physical-{timestamp}-{random}'
    title: string;
    author: string;
    coverUrl?: string;             // Data URL (base64) for offline access
    totalPages: number;
    currentPage: number;
    isbn?: string;
    publisher?: string;
    publishedDate?: string;
    description?: string;
    isPhysical: true;
    addedDate: number;
}

/**
 * Initialize IndexedDB for physical books
 */
function openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;

            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                store.createIndex('addedDate', 'addedDate', { unique: false });
                store.createIndex('title', 'title', { unique: false });
            }
        };
    });
}

/**
 * Save a physical book to IndexedDB
 */
export async function savePhysicalBook(book: Omit<PhysicalBook, 'id' | 'isPhysical' | 'addedDate'>): Promise<PhysicalBook> {
    const db = await openDB();

    const physicalBook: PhysicalBook = {
        ...book,
        id: `physical-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        isPhysical: true,
        addedDate: Date.now(),
        currentPage: book.currentPage || 0,
    };

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.add(physicalBook);

        request.onsuccess = () => {
            console.log('[PhysicalBooks] Saved:', physicalBook.id, physicalBook.title,
                'with cover:', !!physicalBook.coverUrl,
                physicalBook.coverUrl ? `(${physicalBook.coverUrl.substring(0, 50)}...)` : '');
            resolve(physicalBook);
        };
        request.onerror = () => reject(request.error);

        transaction.oncomplete = () => db.close();
    });
}

/**
 * Get all physical books from IndexedDB
 */
export async function getPhysicalBooks(): Promise<PhysicalBook[]> {
    const db = await openDB();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => {
            const books = request.result as PhysicalBook[];
            console.log('[PhysicalBooks] Loaded:', books.length, 'books');
            resolve(books);
        };
        request.onerror = () => reject(request.error);

        transaction.oncomplete = () => db.close();
    });
}

/**
 * Get a single physical book by ID
 */
export async function getPhysicalBook(id: string): Promise<PhysicalBook | null> {
    const db = await openDB();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readonly');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.get(id);

        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => reject(request.error);

        transaction.oncomplete = () => db.close();
    });
}

/**
 * Update physical book progress (current page)
 */
export async function updatePhysicalBookProgress(id: string, currentPage: number): Promise<void> {
    const db = await openDB();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const getRequest = store.get(id);

        getRequest.onsuccess = () => {
            const book = getRequest.result as PhysicalBook;
            if (!book) {
                reject(new Error(`Physical book not found: ${id}`));
                return;
            }

            book.currentPage = Math.min(currentPage, book.totalPages);
            const updateRequest = store.put(book);

            updateRequest.onsuccess = () => {
                console.log('[PhysicalBooks] Updated progress:', id, `${book.currentPage}/${book.totalPages}`);
                resolve();
            };
            updateRequest.onerror = () => reject(updateRequest.error);
        };

        getRequest.onerror = () => reject(getRequest.error);
        transaction.oncomplete = () => db.close();
    });
}

/**
 * Delete a physical book from IndexedDB
 */
export async function deletePhysicalBook(id: string): Promise<void> {
    const db = await openDB();

    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        const request = store.delete(id);

        request.onsuccess = () => {
            console.log('[PhysicalBooks] Deleted:', id);
            resolve();
        };
        request.onerror = () => reject(request.error);

        transaction.oncomplete = () => db.close();
    });
}
