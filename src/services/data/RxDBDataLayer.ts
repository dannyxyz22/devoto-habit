import { DataLayer } from './DataLayer';
import { getDatabase } from '@/lib/database/db';
import { RxBookDocumentType, RxSettingsDocumentType } from '@/lib/database/schema';
import { authService } from '@/services/auth/SupabaseAuthService';
import { replicationManager } from '@/lib/database/replication';
import { ensureStaticBooks } from '@/lib/database/staticBooksInit';

class RxDBDataLayerImpl implements DataLayer {
    private static instance: RxDBDataLayerImpl;
    private migrationInProgress = false;
    private lastMigratedUserId: string | null = null;

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
            if ((event === 'SIGNED_IN' || event === 'INITIAL_SESSION') && session) {
                // Prevent duplicate migrations for same user
                if (this.migrationInProgress || this.lastMigratedUserId === session.user.id) {
                    console.log(`DataLayer: ${event} - skipping duplicate migration for user ${session.user.id}`);
                    return;
                }

                this.migrationInProgress = true;
                try {
                    console.log(`DataLayer: ${event} - migrating local data and starting replication...`);
                    await this.migrateLocalUserData(session.user.id);
                    // Ensure static books have correct user_id after login
                    const db = await getDatabase();
                    await ensureStaticBooks(db, session.user.id);
                    // Reconcile user_epubs to ensure missing rows are upserted before replication
                    await replicationManager.reconcileUserEpubs();
                    await replicationManager.startReplication();

                    this.lastMigratedUserId = session.user.id;
                } finally {
                    this.migrationInProgress = false;
                }
            } else if (event === 'SIGNED_OUT') {
                console.log('DataLayer: User signed out, stopping replication...');
                this.lastMigratedUserId = null;
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
                    try {
                        await book.update({
                            $set: {
                                user_id: userId,
                                _modified: Date.now(),
                                // Preserve added_date if it exists, otherwise use _modified as fallback
                                added_date: book.added_date || book._modified
                            }
                        });
                    } catch (err: any) {
                        // Ignore CONFLICT errors (already migrated by concurrent process)
                        if (err?.code === 'CONFLICT') {
                            console.log(`DataLayer: Book ${book.id} already migrated (conflict ignored)`);
                        } else {
                            throw err;
                        }
                    }
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
                    try {
                        await epub.update({
                            $set: {
                                user_id: userId,
                                _modified: Date.now(),
                                // Preserve added_date if it exists, otherwise use _modified as fallback
                                added_date: epub.added_date || epub._modified
                            }
                        });
                    } catch (err: any) {
                        // Ignore CONFLICT errors (already migrated by concurrent process)
                        if (err?.code === 'CONFLICT') {
                            console.log(`DataLayer: EPUB ${epub.id} already migrated (conflict ignored)`);
                        } else {
                            throw err;
                        }
                    }
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

        // Log total books in database before filtering
        const allBooksCount = await db.books.count().exec();
        console.log('[DataLayer.getBooks] Total books in RxDB:', allBooksCount, 'User:', user?.id || 'local-user');

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

        console.log('[DataLayer.getBooks] Filtered books:', books.length, 'User filter:', user?.id || 'none');
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

        if (existingBook) {
            // Use atomicPatch to avoid CONFLICT errors
            // Only update fields that are actually provided
            // Ensure strictly monotonic timestamp to avoid sync rejection if local clock is behind server
            const updates: any = {
                _modified: Math.max(Date.now(), (existingBook.get('_modified') || 0) + 1)
            };

            // Add fields that are explicitly provided
            if (sanitizedBookData.title !== undefined) updates.title = sanitizedBookData.title;
            if (sanitizedBookData.author !== undefined) updates.author = sanitizedBookData.author;
            if (sanitizedBookData.type !== undefined) updates.type = sanitizedBookData.type;
            if (cover_url && !cover_url.startsWith('data:')) updates.cover_url = cover_url;
            if (bookData.part_index !== undefined) updates.part_index = bookData.part_index;
            if (bookData.chapter_index !== undefined) updates.chapter_index = bookData.chapter_index;
            if (bookData.last_location_cfi !== undefined) updates.last_location_cfi = bookData.last_location_cfi;
            if (bookData.total_pages !== undefined) updates.total_pages = bookData.total_pages;
            if (bookData.current_page !== undefined) updates.current_page = bookData.current_page;
            if (bookData.published_date !== undefined) updates.published_date = bookData.published_date;
            if (bookData.percentage !== undefined) updates.percentage = bookData.percentage;

            await existingBook.incrementalPatch(updates);
            console.log('[DataLayer] Book updated:', {
                id: existingBook.id,
                title: existingBook.title,
                percentage: updates.percentage,
                last_location_cfi: updates.last_location_cfi,
                _modified: updates._modified
            });
            // Force immediate sync (Safe to use because saveToRxDB is already debounced)
            replicationManager.quickSync().catch(e => console.warn('[DataLayer] ⚠️ Quick sync failed:', e));
            return existingBook.toJSON();
        } else {
            const dataToSave = {
                ...sanitizedBookData,
                user_id: userId,
                _modified: Date.now(),
                _deleted: false,
                added_date: bookData.added_date || Date.now(),
                cover_url: cover_url && !cover_url.startsWith('data:') ? cover_url : undefined,
                part_index: bookData.part_index ?? 0,
                chapter_index: bookData.chapter_index ?? 0,
                last_location_cfi: bookData.last_location_cfi ?? undefined
            } as RxBookDocumentType;

            const newBook = await db.books.insert(dataToSave);
            console.log('[DataLayer] ✅ NEW BOOK CREATED:', {
                id: newBook.id,
                title: newBook.title,
                type: newBook.type,
                added_date: newBook.added_date,
                added_date_readable: new Date(newBook.added_date).toLocaleString(),
                _modified: newBook._modified
            });
            // Force immediate sync
            replicationManager.quickSync().catch(e => console.warn('[DataLayer] ⚠️ Quick sync failed:', e));
            return newBook.toJSON();
        }
    }

    async deleteBook(id: string): Promise<void> {
        const db = await getDatabase();
        const book = await db.books.findOne(id).exec();

        if (book) {
            // Soft delete using incrementalPatch to avoid conflicts
            await book.incrementalPatch({
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

        const existingSettings = await db.settings.findOne(userId).exec();

        if (existingSettings) {
            // Use atomicPatch with only the fields that changed
            // Use atomicPatch with only the fields that changed
            const updates: any = {
                _modified: Math.max(Date.now(), (existingSettings.get('_modified') || 0) + 1)
            };
            if (settingsData.daily_goal_minutes !== undefined) updates.daily_goal_minutes = settingsData.daily_goal_minutes;
            if (settingsData.theme !== undefined) updates.theme = settingsData.theme;

            await existingSettings.incrementalPatch(updates);
            return existingSettings.toJSON();
        } else {
            const dataToSave = {
                ...settingsData,
                user_id: userId,
                _modified: Date.now()
            } as RxSettingsDocumentType;

            const newSettings = await db.settings.insert(dataToSave);
            return newSettings.toJSON();
        }
    }

    async getUserEpubs(): Promise<import('@/lib/database/schema').RxUserEpubDocumentType[]> {
        const db = await getDatabase();
        const { user } = await authService.getUser();

        // Log total EPUBs in database before filtering
        const allEpubsCount = await db.user_epubs.count().exec();
        console.log('[DataLayer.getUserEpubs] Total EPUBs in RxDB:', allEpubsCount, 'User:', user?.id || 'local-user');

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

        console.log('[DataLayer.getUserEpubs] Filtered EPUBs:', epubs.length, 'User filter:', user?.id || 'none');
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

        if (existingEpub) {
            // Use atomicPatch to avoid CONFLICT errors during replication
            // Only update fields that are explicitly provided
            const updates: any = {
                _modified: Math.max(Date.now(), (existingEpub.get('_modified') || 0) + 1)
            };

            if (epubData.title !== undefined) updates.title = epubData.title;
            if (epubData.author !== undefined) updates.author = epubData.author;
            if (epubData.file_hash !== undefined) updates.file_hash = epubData.file_hash;
            if (epubData.file_size !== undefined) updates.file_size = epubData.file_size;
            if (epubData.percentage !== undefined) updates.percentage = epubData.percentage;
            if (epubData.last_location_cfi !== undefined) updates.last_location_cfi = epubData.last_location_cfi;

            try {
                await existingEpub.incrementalPatch(updates);
            } catch (err: any) {
                // Retry once if we get a CONFLICT (rare with atomicPatch, but possible)
                if (err?.code === 'CONFLICT' || err?.rxdb?.code === 'CONFLICT') {
                    console.log('[DataLayer] CONFLICT detected, retrying saveUserEpub...');
                    const fresh = await db.user_epubs.findOne(epubData.id!).exec();
                    if (fresh) {
                        await fresh.incrementalPatch(updates);
                    }
                } else {
                    throw err;
                }
            }

            // Force immediate sync
            replicationManager.quickSync().catch(e => console.warn('[DataLayer] ⚠️ Quick sync failed:', e));
            return existingEpub.toJSON();
        } else {
            const dataToSave = {
                ...epubData,
                user_id: userId,
                _modified: Date.now(),
                _deleted: false,
                added_date: epubData.added_date || Date.now()
            } as import('@/lib/database/schema').RxUserEpubDocumentType;

            const newEpub = await db.user_epubs.insert(dataToSave);
            // Force immediate sync
            replicationManager.quickSync().catch(e => console.warn('[DataLayer] ⚠️ Quick sync failed:', e));
            return newEpub.toJSON();
        }
    }

    async deleteUserEpub(id: string): Promise<void> {
        const db = await getDatabase();
        const epub = await db.user_epubs.findOne(id).exec();

        if (epub) {
            // Soft delete using incrementalPatch to avoid conflicts
            await epub.incrementalPatch({
                _deleted: true,
                _modified: Date.now()
            });
        }
    }
}

export const dataLayer = RxDBDataLayerImpl.getInstance();
