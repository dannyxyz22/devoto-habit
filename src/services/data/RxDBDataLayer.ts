import { DataLayer } from './DataLayer';
import { getDatabase } from '@/lib/database/db';
import { RxBookDocumentType, RxSettingsDocumentType } from '@/lib/database/schema';
import { authService } from '@/services/auth/SupabaseAuthService';
import { replicationManager } from '@/lib/database/replication';

class RxDBDataLayerImpl implements DataLayer {
    private static instance: RxDBDataLayerImpl;

    private constructor() {
        this.initializeAuthListener();
    }

    public static getInstance(): RxDBDataLayerImpl {
        if (!RxDBDataLayerImpl.instance) {
            RxDBDataLayerImpl.instance = new RxDBDataLayerImpl();
        }
        return RxDBDataLayerImpl.instance;
    }

    private initializeAuthListener() {
        authService.onAuthStateChange(async (event, session) => {
            if (event === 'SIGNED_IN' && session) {
                console.log('DataLayer: User signed in, migrating local data and starting replication...');
                await this.migrateLocalUserData(session.user.id);
                // Reconcile user_epubs to ensure missing rows are upserted before replication
                await replicationManager.reconcileUserEpubs();
                await replicationManager.startReplication();
            } else if (event === 'SIGNED_OUT') {
                console.log('DataLayer: User signed out, stopping replication...');
                await replicationManager.stopReplication();
            }
        });
    }

    /**
     * Migrate all local-user books to the authenticated user
     * This ensures offline data is preserved when user logs in
     */
    private async migrateLocalUserData(userId: string): Promise<void> {
        try {
            const db = await getDatabase();

            // Migrate books
            const localBooks = await db.books.find({
                selector: {
                    user_id: 'local-user',
                    _deleted: { $eq: false }
                }
            }).exec();

            if (localBooks.length > 0) {
                console.log(`DataLayer: Migrating ${localBooks.length} local-user books to user ${userId}`);

                // Update each book's user_id to the authenticated user
                // Preserve added_date during migration
                for (const book of localBooks) {
                    await book.update({
                        $set: {
                            user_id: userId,
                            _modified: Date.now(),
                            // Preserve added_date if it exists, otherwise use _modified as fallback
                            added_date: book.added_date || book._modified
                        }
                    });
                }

                console.log('DataLayer: Books migration complete');
            } else {
                console.log('DataLayer: No local-user books to migrate');
            }

            // Migrate user EPUBs
            const localEpubs = await db.user_epubs.find({
                selector: {
                    user_id: 'local-user',
                    _deleted: { $eq: false }
                }
            }).exec();

            if (localEpubs.length > 0) {
                console.log(`DataLayer: Migrating ${localEpubs.length} local-user EPUBs to user ${userId}`);

                // Update each EPUB's user_id to the authenticated user
                for (const epub of localEpubs) {
                    await epub.update({
                        $set: {
                            user_id: userId,
                            _modified: Date.now(),
                            // Preserve added_date if it exists, otherwise use _modified as fallback
                            added_date: epub.added_date || epub._modified
                        }
                    });
                }

                console.log('DataLayer: EPUBs migration complete');
            } else {
                console.log('DataLayer: No local-user EPUBs to migrate');
            }

            console.log('DataLayer: All migrations complete');
        } catch (error) {
            console.error('DataLayer: Migration failed:', error);
        }
    }

       // Removed checkpoint clearing due to internalStore API mismatch; using reconciliation instead.

    private async getUserId(): Promise<string> {
        const { user } = await authService.getUser();
        if (!user) {
            console.log('DataLayer: No user logged in, using local-user ID');
            return 'local-user';
        }
        return user.id;
    }

    async getBooks(): Promise<RxBookDocumentType[]> {
        const db = await getDatabase();
        const { user } = await authService.getUser();

        // When logged in, show only user's books
        // When logged out, show ALL locally cached books (for offline access)
        const books = await db.books.find({
            selector: user ? {
                user_id: user.id,
                _deleted: { $eq: false }
            } : {
                _deleted: { $eq: false }
            }
        }).exec();

        return books.map(doc => doc.toJSON());
    }

    async getBook(id: string): Promise<RxBookDocumentType | null> {
        const db = await getDatabase();
        const book = await db.books.findOne(id).exec();
        return book ? book.toJSON() : null;
    }

    async saveBook(bookData: Partial<RxBookDocumentType>): Promise<RxBookDocumentType> {
        const db = await getDatabase();
        const userId = await this.getUserId();

        // Ensure user_id is set and sanitize data
        // If cover_url is a base64 data URL, don't save it to the database
        // Only save external URLs (http/https)
        const { cover_url, ...sanitizedBookData } = bookData as any;

        const existingBook = await db.books.findOne(sanitizedBookData.id).exec();

        const dataToSave = {
            ...sanitizedBookData,
            user_id: userId,
            _modified: Date.now(),
            _deleted: false,
            // Set added_date only for new books, preserve for existing
            added_date: existingBook ? existingBook.added_date : (bookData.added_date || Date.now()),
            // Only save cover_url if it's an external URL, not base64
            cover_url: cover_url && !cover_url.startsWith('data:') ? cover_url : undefined,
            // Ensure progress fields are preserved or defaulted
            part_index: bookData.part_index ?? 0,
            chapter_index: bookData.chapter_index ?? 0,
            last_location_cfi: bookData.last_location_cfi ?? undefined
        } as RxBookDocumentType;

        if (existingBook) {
            await existingBook.patch(dataToSave);
            console.log('[DataLayer] Book updated:', { id: existingBook.id, title: existingBook.title, added_date: existingBook.added_date });
            return existingBook.toJSON();
        } else {
            const newBook = await db.books.insert(dataToSave);
            console.log('[DataLayer] ✅ NEW BOOK CREATED:', {
                id: newBook.id,
                title: newBook.title,
                type: newBook.type,
                added_date: newBook.added_date,
                added_date_readable: new Date(newBook.added_date).toLocaleString(),
                _modified: newBook._modified
            });
            return newBook.toJSON();
        }
    }

    async deleteBook(id: string): Promise<void> {
        const db = await getDatabase();
        const book = await db.books.findOne(id).exec();

        if (book) {
            // Soft delete
            await book.patch({
                _deleted: true,
                _modified: Date.now()
            });
        }
    }

    async getSettings(): Promise<RxSettingsDocumentType | null> {
        const db = await getDatabase();
        const userId = await this.getUserId();

        const settings = await db.settings.findOne(userId).exec();
        return settings ? settings.toJSON() : null;
    }

    async saveSettings(settingsData: Partial<RxSettingsDocumentType>): Promise<RxSettingsDocumentType> {
        const db = await getDatabase();
        const userId = await this.getUserId();

        const dataToSave = {
            ...settingsData,
            user_id: userId,
            _modified: Date.now()
        } as RxSettingsDocumentType;

        const existingSettings = await db.settings.findOne(userId).exec();

        if (existingSettings) {
            await existingSettings.patch(dataToSave);
            return existingSettings.toJSON();
        } else {
            const newSettings = await db.settings.insert(dataToSave);
            return newSettings.toJSON();
        }
    }

    async getUserEpubs(): Promise<import('@/lib/database/schema').RxUserEpubDocumentType[]> {
        const db = await getDatabase();
        const { user } = await authService.getUser();

        // When logged in, show only user's EPUBs
        // When logged out, show ALL locally cached EPUBs (for offline access)
        const epubs = await db.user_epubs.find({
            selector: user ? {
                user_id: user.id,
                _deleted: { $eq: false }
            } : {
                _deleted: { $eq: false }
            }
        }).exec();

        return epubs.map(doc => doc.toJSON());
    }

    async getUserEpub(id: string): Promise<import('@/lib/database/schema').RxUserEpubDocumentType | null> {
        const db = await getDatabase();
        const epub = await db.user_epubs.findOne(id).exec();
        return epub ? epub.toJSON() : null;
    }

    async saveUserEpub(epubData: Partial<import('@/lib/database/schema').RxUserEpubDocumentType>): Promise<import('@/lib/database/schema').RxUserEpubDocumentType> {
        const db = await getDatabase();
        const userId = await this.getUserId();

        const existingEpub = await db.user_epubs.findOne(epubData.id!).exec();

        const dataToSave = {
            ...epubData,
            user_id: userId,
            _modified: Date.now(),
            _deleted: false,
            // Set added_date only for new EPUBs, preserve for existing
            added_date: existingEpub ? existingEpub.added_date : (epubData.added_date || Date.now())
        } as import('@/lib/database/schema').RxUserEpubDocumentType;

        if (existingEpub) {
            await existingEpub.patch(dataToSave);
            return existingEpub.toJSON();
        } else {
            const newEpub = await db.user_epubs.insert(dataToSave);
            return newEpub.toJSON();
        }
    }

    async deleteUserEpub(id: string): Promise<void> {
        const db = await getDatabase();
        const epub = await db.user_epubs.findOne(id).exec();

        if (epub) {
            // Soft delete
            await epub.patch({
                _deleted: true,
                _modified: Date.now()
            });
        }
    }
}

export const dataLayer = RxDBDataLayerImpl.getInstance();
