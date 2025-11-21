import ePub from 'epubjs';

export interface UserEpub {
    id: string;
    title: string;
    author: string;
    blob: Blob;
    addedDate: number;
}

const DB_NAME = 'devoto-habit-db';
const STORE_NAME = 'user-epubs';
const DB_VERSION = 1;

// Open IndexedDB connection
const openDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.createObjectStore(STORE_NAME, { keyPath: 'id' });
            }
        };
    });
};

// Save user EPUB to IndexedDB
export const saveUserEpub = async (file: File): Promise<UserEpub> => {
    // Validate file type
    if (!file.name.toLowerCase().endsWith('.epub')) {
        throw new Error('File must be an EPUB');
    }

    // Read file as ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();
    const blob = new Blob([arrayBuffer], { type: 'application/epub+zip' });

    // Extract metadata using epubjs
    const book = ePub(arrayBuffer);
    await book.ready;

    const metadata = await book.loaded.metadata;
    const title = metadata.title || file.name.replace('.epub', '');
    const author = metadata.creator || 'Unknown Author';

    // Generate unique ID
    const id = `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    const userEpub: UserEpub = {
        id,
        title,
        author,
        blob,
        addedDate: Date.now(),
    };

    // Save to IndexedDB
    const db = await openDB();
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    return new Promise((resolve, reject) => {
        const request = store.add(userEpub);
        request.onsuccess = () => resolve(userEpub);
        request.onerror = () => reject(request.error);
    });
};

// Get all user EPUBs
export const getUserEpubs = async (): Promise<UserEpub[]> => {
    try {
        const db = await openDB();
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);

        return new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result || []);
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.error('Error getting user EPUBs:', error);
        return [];
    }
};

// Delete user EPUB
export const deleteUserEpub = async (id: string): Promise<void> => {
    const db = await openDB();
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    return new Promise((resolve, reject) => {
        const request = store.delete(id);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
};

// Get user EPUB blob by ID
export const getUserEpubBlob = async (id: string): Promise<Blob | null> => {
    try {
        const db = await openDB();
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);

        return new Promise((resolve, reject) => {
            const request = store.get(id);
            request.onsuccess = () => {
                const result = request.result as UserEpub | undefined;
                resolve(result?.blob || null);
            };
            request.onerror = () => reject(request.error);
        });
    } catch (error) {
        console.error('Error getting user EPUB blob:', error);
        return null;
    }
};
