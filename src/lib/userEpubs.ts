import ePub from 'epubjs';
import { getDatabase } from '@/lib/database/db';
import { dataLayer } from '@/services/data/RxDBDataLayer';

export interface UserEpub {
    id: string;
    title: string;
    author: string;
    blob: Blob;
    coverUrl?: string;  // Data URL for cover image
    addedDate: number;
    fileHash: string;
    fileSize: number;
}

const DB_NAME = 'devoto-habit-db';
const STORE_NAME = 'user-epubs';
const DB_VERSION = 1;

// Calculate SHA-256 hash of a blob
export const calculateFileHash = async (blob: Blob): Promise<string> => {
    const arrayBuffer = await blob.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
};

// Open IndexedDB connection
const openDB = (): Promise<IDBDatabase> => {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);

        request.onupgradeneeded = (event) => {
            const db = (event.target as IDBOpenDBRequest).result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, { keyPath: 'fileHash' });
                store.createIndex('id', 'id', { unique: true });
            }
        };
    });
};

// Save user EPUB to IndexedDB and RxDB
export const saveUserEpub = async (file: File): Promise<UserEpub> => {
    // Validate file type
    if (!file.name.toLowerCase().endsWith('.epub')) {
        throw new Error('File must be an EPUB');
    }

    // Read file as ArrayBuffer
    const arrayBuffer = await file.arrayBuffer();
    const blob = new Blob([arrayBuffer], { type: 'application/epub+zip' });

    // Calculate file hash
    const fileHash = await calculateFileHash(blob);
    const fileSize = blob.size;

    console.log('[Upload] Calculated hash:', fileHash);

    // Check if EPUB with this hash already exists in RxDB
    const rxdb = await getDatabase();
    const existingEpub = await rxdb.user_epubs.findOne({
        selector: { file_hash: fileHash }
    }).exec();

    if (existingEpub) {
        console.log('[userEpubs] ❌ DUPLICATE EPUB DETECTED:', {
            file_hash: fileHash,
            existing_title: existingEpub.title,
            attempted_title: file.name
        });
        throw new Error('Este EPUB já está na sua biblioteca');
    }

    // Extract metadata using epubjs
    const book = ePub(arrayBuffer);
    await book.ready;

    const metadata = await book.loaded.metadata;
    const title = metadata.title || file.name.replace('.epub', '');
    const author = metadata.creator || 'Unknown Author';

    // Extract cover image
    let coverUrl: string | undefined;
    try {
        console.log('[Cover] Starting extraction...');

        // Wait for cover to be loaded
        await book.loaded.cover;

        // Get cover URL
        const coverUrlFromBook = await book.coverUrl();
        console.log('[Cover] URL from book:', coverUrlFromBook);

        if (coverUrlFromBook) {
            // Fetch and convert to data URL
            const response = await fetch(coverUrlFromBook);
            const coverBlob = await response.blob();
            console.log('[Cover] Blob size:', coverBlob.size, 'type:', coverBlob.type);

            const reader = new FileReader();
            coverUrl = await new Promise((resolve) => {
                reader.onloadend = () => resolve(reader.result as string);
                reader.readAsDataURL(coverBlob);
            });
            console.log('[Cover] Successfully extracted, length:', coverUrl?.length);
        } else {
            console.log('[Cover] No cover URL returned from book');
        }
    } catch (error) {
        console.error('[Cover] Extraction failed:', error);
    }

    // Generate unique ID with 'user-' prefix
    const id = `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const addedDate = Date.now();

    // Save metadata to RxDB using DataLayer (ensures correct user_id and will sync to Supabase)
    await dataLayer.saveUserEpub({
        id,
        title,
        author,
        file_hash: fileHash,
        file_size: fileSize,
        cover_url: coverUrl && !coverUrl.startsWith('data:') ? coverUrl : undefined,
        added_date: addedDate,
        _modified: addedDate,
        _deleted: false
    });

    console.log('[userEpubs] ✅ NEW EPUB UPLOADED:', {
        id,
        title,
        author,
        file_hash: fileHash,
        file_size: fileSize,
        added_date: addedDate,
        added_date_readable: new Date(addedDate).toLocaleString()
    });

    console.log('[Upload] Saved metadata to RxDB:', { id, title, author, fileHash });

    // Save blob to IndexedDB for local access
    const userEpub: UserEpub = {
        id,
        title,
        author,
        blob,
        coverUrl,
        addedDate,
        fileHash,
        fileSize
    };

    const db = await openDB();
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    return new Promise((resolve, reject) => {
        const request = store.put(userEpub);
        request.onsuccess = () => {
            console.log('[Upload] Saved blob to IndexedDB');
            resolve(userEpub);
        };
        request.onerror = () => reject(request.error);
    });
};

// Get all user EPUBs from RxDB (not IndexedDB)
export const getUserEpubs = async (): Promise<UserEpub[]> => {
    try {
        const rxdb = await getDatabase();
        const epubs = await rxdb.user_epubs.find({
            selector: { _deleted: false }
        }).exec();

        // Check which ones have local files
        const db = await openDB();
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);

        const result: UserEpub[] = [];

        for (const epub of epubs) {
            const epubData = epub.toJSON();

            // Check if blob exists in IndexedDB
            const blobRequest = store.get(epubData.file_hash);
            const hasLocalFile = await new Promise<boolean>((resolve) => {
                blobRequest.onsuccess = () => resolve(!!blobRequest.result);
                blobRequest.onerror = () => resolve(false);
            });

            if (hasLocalFile) {
                const localData = await new Promise<any>((resolve) => {
                    const req = store.get(epubData.file_hash);
                    req.onsuccess = () => resolve(req.result);
                    req.onerror = () => resolve(null);
                });

                if (localData) {
                    result.push({
                        id: epubData.id,
                        title: epubData.title,
                        author: epubData.author || '',
                        blob: localData.blob,
                        coverUrl: localData.coverUrl,
                        addedDate: epubData.added_date,
                        fileHash: epubData.file_hash,
                        fileSize: epubData.file_size || 0
                    });
                }
            }
        }

        return result;
    } catch (error) {
        console.error('Error getting user EPUBs:', error);
        return [];
    }
};

// Delete user EPUB
export const deleteUserEpub = async (id: string): Promise<void> => {
    const rxdb = await getDatabase();
    const epub = await rxdb.user_epubs.findOne(id).exec();

    if (epub) {
        const fileHash = epub.file_hash;

        // Soft delete in RxDB
        await epub.patch({
            _deleted: true,
            _modified: Date.now()
        });

        // Delete from IndexedDB
        const db = await openDB();
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);

        return new Promise((resolve, reject) => {
            const request = store.delete(fileHash);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error);
        });
    }
};

// Get user EPUB blob by ID
export const getUserEpubBlob = async (id: string): Promise<Blob | null> => {
    try {
        const rxdb = await getDatabase();
        const epub = await rxdb.user_epubs.findOne(id).exec();

        if (!epub) return null;

        const db = await openDB();
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const store = transaction.objectStore(STORE_NAME);

        return new Promise((resolve, reject) => {
            const request = store.get(epub.file_hash);
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

// Re-upload EPUB file (for cross-device sync)
export const reUploadEpub = async (fileHash: string, file: File): Promise<void> => {
    // Calculate hash of uploaded file
    const arrayBuffer = await file.arrayBuffer();
    const blob = new Blob([arrayBuffer], { type: 'application/epub+zip' });
    const uploadedHash = await calculateFileHash(blob);

    // Verify hash matches
    if (uploadedHash !== fileHash) {
        console.log('[userEpubs] ❌ HASH MISMATCH:', {
            expected_hash: fileHash,
            uploaded_hash: uploadedHash,
            file_name: file.name
        });
        throw new Error('Este não é o mesmo arquivo EPUB. Hash não corresponde.');
    }
    
    console.log('[userEpubs] ✅ RE-UPLOAD HASH VERIFIED:', {
        file_hash: fileHash,
        file_name: file.name,
        file_size: file.size
    });

    // Get metadata from RxDB
    const rxdb = await getDatabase();
    const epub = await rxdb.user_epubs.findOne({
        selector: { file_hash: fileHash }
    }).exec();

    if (!epub) {
        throw new Error('EPUB metadata not found');
    }

    // Extract cover if needed
    let coverUrl: string | undefined;
    try {
        const book = ePub(arrayBuffer);
        await book.ready;
        await book.loaded.cover;
        const coverUrlFromBook = await book.coverUrl();

        if (coverUrlFromBook) {
            const response = await fetch(coverUrlFromBook);
            const coverBlob = await response.blob();
            const reader = new FileReader();
            coverUrl = await new Promise((resolve) => {
                reader.onloadend = () => resolve(reader.result as string);
                reader.readAsDataURL(coverBlob);
            });
        }
    } catch (error) {
        console.error('[Re-upload] Cover extraction failed:', error);
    }

    // Save blob to IndexedDB
    const userEpub: UserEpub = {
        id: epub.id,
        title: epub.title,
        author: epub.author || '',
        blob,
        coverUrl,
        addedDate: epub.added_date,
        fileHash: epub.file_hash,
        fileSize: epub.file_size || 0
    };

    const db = await openDB();
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    return new Promise((resolve, reject) => {
        const request = store.put(userEpub);
        request.onsuccess = () => {
            console.log('[Re-upload] EPUB file saved locally');
            resolve();
        };
        request.onerror = () => reject(request.error);
    });
};
