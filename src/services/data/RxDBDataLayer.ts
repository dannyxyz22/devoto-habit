import { DataLayer } from './DataLayer';
import { formatISO, format } from 'date-fns';
import { getDatabase } from '@/lib/database/db';
import { RxBookDocumentType, RxSettingsDocumentType, RxReadingPlanDocumentType, RxDailyBaselineDocumentType, RxUserStatsDocumentType } from '@/lib/database/schema';
import { authService } from '@/services/auth/SupabaseAuthService';
import { supabase } from '@/lib/supabase';
import { logger } from '@/lib/logger';
import { replicationManager } from '@/lib/database/replication';
import { ensureStaticBooks } from '@/lib/database/staticBooksInit';
import { calculatePagePercent } from '@/lib/percentageUtils';

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
                    console.log(`DataLayer: ${event} - starting replication first, then migrating local data...`);

                    // Start replication FIRST to fetch server data
                    await replicationManager.startReplication();

                    // Wait for initial replication to complete
                    console.log('DataLayer: Waiting for initial replication to complete...');
                    await new Promise(resolve => setTimeout(resolve, 2000)); // Give time for initial pull

                    // NOW migrate local-user data (will check if server data exists)
                    await this.migrateLocalUserData(session.user.id);

                    // Ensure static books have correct user_id after login
                    const db = await getDatabase();
                    await ensureStaticBooks(db, session.user.id);

                    // Reconcile user_epubs to ensure missing rows are upserted
                    await replicationManager.reconcileUserEpubs();
                    await replicationManager.reconcileReadingPlans();

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

            // Migrate daily baselines
            const localBaselines = await db.daily_baselines.find({
                selector: {
                    user_id: 'local-user',
                    _deleted: { $eq: false }
                }
            }).exec();

            if (localBaselines.length > 0) {
                console.log(`DataLayer: Migrating ${localBaselines.length} local-user baselines to user ${userId}`);

                for (const baseline of localBaselines) {
                    try {
                        // Need to create a new document with the correct composite ID
                        const bookId = baseline.book_id;
                        const dateISO = baseline.date_iso;
                        const newId = `${userId}:${bookId}:${dateISO}`;

                        // Check if already exists for the authenticated user (from server replication)
                        const existing = await db.daily_baselines.findOne(newId).exec();
                        if (!existing) {
                            // No server data exists, safe to migrate local baseline
                            await db.daily_baselines.insert({
                                id: newId,
                                user_id: userId,
                                book_id: bookId,
                                date_iso: dateISO,
                                words: baseline.words,
                                percent: baseline.percent,
                                page: baseline.page,
                                _modified: Date.now(),
                                _deleted: false
                            });
                            console.log(`DataLayer: Baseline migrated: ${bookId} - ${dateISO}`);
                        } else {
                            // Server data exists - compare timestamps to keep the most recent
                            const localMod = baseline._modified || 0;
                            const serverMod = existing._modified || 0;

                            if (localMod > serverMod) {
                                // Local is newer, update server data
                                await existing.incrementalPatch({
                                    words: baseline.words,
                                    percent: baseline.percent,
                                    page: baseline.page,
                                    _modified: Math.max(Date.now(), serverMod + 1)
                                });
                                console.log(`DataLayer: Baseline updated (local newer): ${bookId} - ${dateISO}`);
                            } else {
                                // Server is newer or equal, keep server data
                                console.log(`DataLayer: Baseline skipped (server data is newer): ${bookId} - ${dateISO}`);
                            }
                        }

                        // Delete the old local-user baseline
                        await baseline.incrementalPatch({
                            _deleted: true,
                            _modified: Date.now()
                        });
                    } catch (err: any) {
                        logger.logError(err, { context: `DataLayer: Failed to migrate baseline ${baseline.id}` });
                        console.error(`DataLayer: Failed to migrate baseline ${baseline.id}:`, err);
                    }
                }

                console.log('DataLayer: Baselines migration complete');
            } else {
                console.log('DataLayer: No local-user baselines to migrate');
            }

            // Migrate reading plans
            const localPlans = await db.reading_plans.find({
                selector: {
                    user_id: 'local-user',
                    _deleted: { $eq: false }
                }
            }).exec();

            if (localPlans.length > 0) {
                console.log(`DataLayer: Migrating ${localPlans.length} local-user reading plans to user ${userId}`);

                for (const plan of localPlans) {
                    try {
                        // Need to create a new document with the correct composite ID
                        const bookId = plan.book_id;
                        const newId = `${userId}:${bookId}`;

                        // Check if already exists for the authenticated user (from server replication)
                        const existing = await db.reading_plans.findOne(newId).exec();
                        if (!existing) {
                            // No server data exists, safe to migrate local plan
                            await db.reading_plans.insert({
                                id: newId,
                                user_id: userId,
                                book_id: bookId,
                                target_date_iso: plan.target_date_iso,
                                target_part_index: plan.target_part_index,
                                target_chapter_index: plan.target_chapter_index,
                                start_percent: plan.start_percent,
                                start_part_index: plan.start_part_index,
                                start_chapter_index: plan.start_chapter_index,
                                start_words: plan.start_words,
                                _modified: Date.now(),
                                _deleted: false
                            });
                            console.log(`DataLayer: Reading plan migrated: ${bookId}`);
                        } else {
                            // Server data exists - PRESERVE server's target_date_iso (user-set goal)
                            // Only fill in start_* fields if they're missing on server
                            const serverData = existing.toJSON();
                            const updates: Record<string, any> = {};

                            // Only fill start_* fields if server is missing them and local has them
                            if ((serverData.start_percent == null || serverData.start_percent === 0) && plan.start_percent != null && plan.start_percent > 0) {
                                updates.start_percent = plan.start_percent;
                            }
                            if (serverData.start_part_index == null && plan.start_part_index != null) {
                                updates.start_part_index = plan.start_part_index;
                            }
                            if (serverData.start_chapter_index == null && plan.start_chapter_index != null) {
                                updates.start_chapter_index = plan.start_chapter_index;
                            }
                            if (serverData.start_words == null && plan.start_words != null) {
                                updates.start_words = plan.start_words;
                            }

                            // Only update target_date_iso if server doesn't have one and local does
                            if (!serverData.target_date_iso && plan.target_date_iso) {
                                updates.target_date_iso = plan.target_date_iso;
                                console.log(`DataLayer: Reading plan - filling missing target_date from local: ${bookId}`);
                            }

                            // Only apply if there are updates to make
                            if (Object.keys(updates).length > 0) {
                                updates._modified = Math.max(Date.now(), (serverData._modified || 0) + 1);
                                await existing.incrementalPatch(updates);
                                console.log(`DataLayer: Reading plan enhanced with local start data: ${bookId}`, updates);
                            } else {
                                // Server has all data, keep server data
                                console.log(`DataLayer: Reading plan skipped (server has complete data): ${bookId}`);
                            }
                        }

                        // Delete the old local-user plan
                        await plan.incrementalPatch({
                            _deleted: true,
                            _modified: Date.now()
                        });
                    } catch (err: any) {
                        logger.logError(err, { context: `DataLayer: Failed to migrate reading plan ${plan.id}` });
                        console.error(`DataLayer: Failed to migrate reading plan ${plan.id}:`, err);
                    }
                }

                console.log('DataLayer: Reading plans migration complete');
            } else {
                console.log('DataLayer: No local-user reading plans to migrate');
            }

            // Migrate user stats (last_book_id, streaks, etc.)
            const localStats = await db.user_stats.find({
                selector: {
                    user_id: 'local-user',
                    _deleted: { $eq: false }
                }
            }).exec();

            if (localStats.length > 0) {
                console.log(`DataLayer: Migrating ${localStats.length} local-user stats to user ${userId}`);

                for (const stats of localStats) {
                    try {
                        // Check if server stats exist
                        const serverStats = await db.user_stats.find({
                            selector: {
                                user_id: userId,
                                _deleted: { $eq: false }
                            }
                        }).exec();

                        if (serverStats.length === 0) {
                            // No server stats exist, create new stats with authenticated user_id
                            await db.user_stats.insert({
                                id: crypto.randomUUID(),
                                user_id: userId,
                                streak_current: stats.streak_current,
                                streak_longest: stats.streak_longest,
                                last_read_iso: stats.last_read_iso,
                                freeze_available: stats.freeze_available,
                                total_minutes: stats.total_minutes,
                                last_book_id: stats.last_book_id,
                                minutes_by_date: stats.minutes_by_date,
                                _modified: Date.now(),
                                _deleted: false
                            });
                            console.log(`DataLayer: User stats migrated for user ${userId}`);
                        } else {
                            // Server stats exist - compare timestamps to keep the most recent
                            const serverStat = serverStats[0];
                            const localMod = stats._modified || 0;
                            const serverMod = serverStat._modified || 0;

                            if (localMod > serverMod) {
                                // Local is newer, update server data
                                await serverStat.incrementalPatch({
                                    streak_current: stats.streak_current,
                                    streak_longest: stats.streak_longest,
                                    last_read_iso: stats.last_read_iso,
                                    freeze_available: stats.freeze_available,
                                    total_minutes: stats.total_minutes,
                                    last_book_id: stats.last_book_id,
                                    minutes_by_date: stats.minutes_by_date,
                                    _modified: Math.max(Date.now(), serverMod + 1)
                                });
                                console.log(`DataLayer: User stats updated (local newer) for user ${userId}`);
                            } else {
                                // Server is newer or equal, keep server data
                                console.log(`DataLayer: User stats skipped (server data is newer) for user ${userId}`);
                            }
                        }

                        // Delete the old local-user stats
                        await stats.incrementalPatch({
                            _deleted: true,
                            _modified: Date.now()
                        });
                    } catch (err: any) {
                        logger.logError(err, { context: `DataLayer: Failed to migrate user stats ${stats.id}` });
                        console.error(`DataLayer: Failed to migrate user stats ${stats.id}:`, err);
                    }
                }

                console.log('DataLayer: User stats migration complete');
            } else {
                console.log('DataLayer: No local-user stats to migrate');
            }

            console.log('DataLayer: All migrations complete');
        } catch (error) {
            logger.logError(error, { context: 'DataLayer: Migration failed' });
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

    async saveBookProgress(bookId: string, newPage: number) {
        const db = await getDatabase();
        const book = await db.books.findOne(bookId).exec();
        if (!book) return;

        const currentVersion = book.get('progress_version') ?? 0;
        const totalPages = book.get('total_pages') || 0;

        // Get OLD percentage BEFORE updating (needed for baseline creation)
        const oldPercentage = book.get('percentage') || 0;

        // Calculate NEW percentage for physical books
        const newPercentage = totalPages > 0
            ? calculatePagePercent(newPage, totalPages, { round: false })
            : oldPercentage;

        // Ensure baseline exists for today BEFORE updating progress
        // (only create if missing, don't update existing)
        const todayISO = format(new Date(), 'yyyy-MM-dd');
        const userId = await this.getUserId();
        const baselineId = `${userId}:${bookId}:${todayISO}`;
        const existingBaseline = await db.daily_baselines.findOne(baselineId).exec();

        if (!existingBaseline) {
            // Create baseline with the OLD progress (before this update) as starting point
            // This ensures that today's progress is calculated correctly
            await this.saveDailyBaseline({
                book_id: bookId,
                date_iso: todayISO,
                words: 0,
                percent: oldPercentage, // Use old progress, not new
                page: book.get('current_page') || 0
            });
            console.log('[DataLayer] 📏 Baseline created for today:', { bookId, todayISO, percent: oldPercentage, page: book.get('current_page') });
        }

        // Now update the book progress
        await book.incrementalPatch({
            current_page: newPage,
            percentage: newPercentage,
            progress_version: currentVersion + 1,
            _modified: Math.max(Date.now(), (book.get('_modified') || 0) + 1)
        });

        console.log('[DataLayer] 📖 Progress updated', {
            bookId,
            newPage,
            oldPercentage,
            newPercentage,
            progress_version: currentVersion + 1
        });
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
                current_page: updates.current_page,
                last_location_cfi: updates.last_location_cfi,
                _modified: updates._modified
            });
            // Force immediate sync (Safe to use because saveToRxDB is already debounced)
            //replicationManager.quickSync().catch(e => console.warn('[DataLayer] ⚠️ Quick sync failed:', e));
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

            // PROACTIVE BASELINE: Initialize baseline for today to anchor "Read Today" at 0
            try {
                const todayISO = format(new Date(), 'yyyy-MM-dd');
                await this.saveDailyBaseline({
                    book_id: newBook.id,
                    date_iso: todayISO,
                    words: dataToSave.type === 'physical' ? 0 : 0, // Words will be 0 for physical initially
                    percent: dataToSave.percentage || 0,
                    page: dataToSave.current_page || 0
                });
                console.log('[DataLayer] 📏 Proactive baseline created for new physical/static book:', newBook.id);
            } catch (err) {
                console.warn('[DataLayer] ⚠️ Failed to create proactive baseline:', err);
            }

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
        const allEpubs = await db.user_epubs.find().exec();
        console.log('[DataLayer.getUserEpubs] Total EPUBs in RxDB:', allEpubs.length, 'User:', user?.id || 'local-user');
        console.log('[DataLayer.getUserEpubs] All EPUBs:', allEpubs.map(e => ({
            id: e.id,
            user_id: e.user_id,
            title: e.title,
            _deleted: e._deleted
        })));

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

            // PROACTIVE BASELINE: Initialize baseline for today to anchor "Read Today" at 0
            try {
                const todayISO = format(new Date(), 'yyyy-MM-dd');
                await this.saveDailyBaseline({
                    book_id: newEpub.id,
                    date_iso: todayISO,
                    words: 0,
                    percent: dataToSave.percentage || 0,
                    page: undefined // EPUBs don't use page field usually
                });
                console.log('[DataLayer] 📏 Proactive baseline created for new EPUB:', newEpub.id);
            } catch (err) {
                console.warn('[DataLayer] ⚠️ Failed to create proactive baseline:', err);
            }

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

    // ========== Reading Plans ==========

    async getReadingPlan(bookId: string): Promise<RxReadingPlanDocumentType | null> {
        const db = await getDatabase();
        const userId = await this.getUserId();

        // Try to find by composite ID first (user_id:book_id)
        const compositeId = `${userId}:${bookId}`;
        let plan = await db.reading_plans.findOne(compositeId).exec();

        if (!plan) {
            // Fallback: search by book_id for any user (especially when logged out)
            const plans = await db.reading_plans.find({
                selector: {
                    book_id: bookId,
                    _deleted: { $eq: false }
                },
                sort: [{ _modified: 'desc' }] // Get most recent
            }).exec();
            plan = plans[0] || null;

            if (plan && userId === 'local-user') {
                console.log('[DataLayer] 📅 Found existing reading plan from authenticated user:', {
                    bookId,
                    originalUserId: plan.user_id,
                    targetDate: plan.target_date_iso
                });
            }
        }

        return plan ? plan.toJSON() : null;
    }

    async saveReadingPlan(planData: Partial<RxReadingPlanDocumentType>): Promise<RxReadingPlanDocumentType> {
        const db = await getDatabase();
        const userId = await this.getUserId();

        const bookId = planData.book_id!;
        const id = planData.id || `${userId}:${bookId}`;

        const existingPlan = await db.reading_plans.findOne(id).exec();

        if (existingPlan) {
            const updates: any = {
                _modified: Math.max(Date.now(), (existingPlan.get('_modified') || 0) + 1)
            };

            // Only update target_date_iso if it's a valid non-empty string
            if (planData.target_date_iso !== undefined) {
                if (planData.target_date_iso === null || planData.target_date_iso === '') {
                    // If null or empty, don't update (or could set to null explicitly)
                    // For now, we'll skip updating to preserve existing value
                } else if (typeof planData.target_date_iso === 'string' && planData.target_date_iso.trim() !== '') {
                    updates.target_date_iso = planData.target_date_iso;
                }
            }
            if (planData.target_part_index !== undefined) updates.target_part_index = planData.target_part_index;
            if (planData.target_chapter_index !== undefined) updates.target_chapter_index = planData.target_chapter_index;
            if (planData.start_part_index !== undefined) updates.start_part_index = planData.start_part_index;
            if (planData.start_chapter_index !== undefined) updates.start_chapter_index = planData.start_chapter_index;
            if (planData.start_words !== undefined) updates.start_words = planData.start_words;
            if (planData.start_percent !== undefined) updates.start_percent = planData.start_percent;

            await existingPlan.incrementalPatch(updates);
            replicationManager.quickSync().catch(e => console.warn('[DataLayer] ⚠️ Quick sync failed:', e));
            return existingPlan.toJSON();
        } else {
            const dataToSave = {
                id,
                user_id: userId,
                book_id: bookId,
                target_date_iso: planData.target_date_iso,
                target_part_index: planData.target_part_index,
                target_chapter_index: planData.target_chapter_index,
                start_part_index: planData.start_part_index,
                start_chapter_index: planData.start_chapter_index,
                start_words: planData.start_words,
                start_percent: planData.start_percent,
                _modified: Date.now(),
                _deleted: false
            } as RxReadingPlanDocumentType;

            const newPlan = await db.reading_plans.insert(dataToSave);
            replicationManager.quickSync().catch(e => console.warn('[DataLayer] ⚠️ Quick sync failed:', e));
            return newPlan.toJSON();
        }
    }

    async deleteReadingPlan(bookId: string): Promise<void> {
        const db = await getDatabase();
        const userId = await this.getUserId();

        // Try to find by composite ID first (user_id:book_id), then by book_id alone
        const compositeId = `${userId}:${bookId}`;
        let plan = await db.reading_plans.findOne(compositeId).exec();

        if (!plan) {
            // Fallback: search by book_id for local-user plans or plans from different users
            const plans = await db.reading_plans.find({
                selector: {
                    book_id: bookId,
                    _deleted: { $eq: false }
                }
            }).exec();
            plan = plans[0] || null;
        }

        if (plan && !plan._deleted) {
            await plan.incrementalPatch({
                _deleted: true,
                _modified: Date.now()
            });
            replicationManager.quickSync().catch(e => console.warn('[DataLayer] ⚠️ Quick sync failed:', e));
            console.log('[DataLayer] 📅 Reading plan deleted:', { bookId, planId: plan.id });
        } else {
            console.log('[DataLayer] 📅 No plan found to delete:', { bookId, compositeId });
        }
    }

    // ========== Daily Baselines ==========

    async getDailyBaseline(bookId: string, dateISO: string): Promise<RxDailyBaselineDocumentType | null> {
        const db = await getDatabase();
        const userId = await this.getUserId();

        // Try to find with current userId first
        const id = `${userId}:${bookId}:${dateISO}`;
        let baseline = await db.daily_baselines.findOne(id).exec();

        // If not found and user is local-user (logged out), search for ANY baseline for this book/date
        // This prevents creating duplicate baselines when user logs out
        if (!baseline && userId === 'local-user') {
            const baselines = await db.daily_baselines.find({
                selector: {
                    book_id: bookId,
                    date_iso: dateISO,
                    _deleted: { $eq: false }
                },
                sort: [{ _modified: 'desc' }] // Get most recent
            }).exec();

            baseline = baselines[0] || null;

            if (baseline) {
                console.log('[DataLayer] 📏 Found existing baseline from authenticated user:', {
                    bookId,
                    dateISO,
                    originalUserId: baseline.user_id,
                    percent: baseline.percent,
                    page: baseline.page
                });
            }
        }

        return baseline ? baseline.toJSON() : null;
    }

    async getBaselinesForBook(bookId: string, limit: number = 90): Promise<RxDailyBaselineDocumentType[]> {
        const db = await getDatabase();

        const baselines = await db.daily_baselines.find({
            selector: {
                book_id: bookId,
                _deleted: { $eq: false }
            },
            sort: [{ date_iso: 'asc' }]
        }).exec();

        // Convert to JSON and apply limit
        const result = baselines.map(b => b.toJSON());

        // If we have more than limit, take the most recent ones
        if (result.length > limit) {
            return result.slice(-limit);
        }

        return result;
    }

    async saveDailyBaseline(baselineData: Partial<RxDailyBaselineDocumentType>): Promise<RxDailyBaselineDocumentType> {
        const db = await getDatabase();
        const userId = await this.getUserId();

        const bookId = baselineData.book_id!;
        const dateISO = baselineData.date_iso!;
        const id = baselineData.id || `${userId}:${bookId}:${dateISO}`;

        let existingBaseline = await db.daily_baselines.findOne(id).exec();

        // If user is local-user and baseline doesn't exist, check if there's an existing baseline
        // from a previous authenticated session to avoid creating duplicates
        if (!existingBaseline && userId === 'local-user') {
            const baselines = await db.daily_baselines.find({
                selector: {
                    book_id: bookId,
                    date_iso: dateISO,
                    _deleted: { $eq: false }
                },
                sort: [{ _modified: 'desc' }]
            }).exec();

            if (baselines.length > 0) {
                existingBaseline = baselines[0];
                console.log('[DataLayer] 📏 Found existing baseline from authenticated user, skipping duplicate creation:', {
                    bookId,
                    dateISO,
                    originalUserId: existingBaseline.user_id,
                    percent: existingBaseline.percent,
                    page: existingBaseline.page
                });
                return existingBaseline.toJSON();
            }
        }

        if (existingBaseline) {
            const updates: any = {
                _modified: Math.max(Date.now(), (existingBaseline.get('_modified') || 0) + 1)
            };

            if (baselineData.words !== undefined) updates.words = baselineData.words;
            if (baselineData.percent !== undefined) updates.percent = baselineData.percent;
            if (baselineData.page !== undefined) updates.page = baselineData.page;

            await existingBaseline.incrementalPatch(updates);
            replicationManager.quickSync().catch(e => console.warn('[DataLayer] ⚠️ Quick sync failed:', e));
            return existingBaseline.toJSON();
        } else {
            const dataToSave = {
                id,
                user_id: userId,
                book_id: bookId,
                date_iso: dateISO,
                words: baselineData.words ?? 0,
                percent: baselineData.percent ?? 0,
                page: baselineData.page,
                _modified: Date.now(),
                _deleted: false
            } as RxDailyBaselineDocumentType;

            const newBaseline = await db.daily_baselines.insert(dataToSave);
            replicationManager.quickSync().catch(e => console.warn('[DataLayer] ⚠️ Quick sync failed:', e));
            return newBaseline.toJSON();
        }
    }

    // ========== User Stats ==========

    async getUserStats(): Promise<RxUserStatsDocumentType | null> {
        const db = await getDatabase();
        const userId = await this.getUserId();

        // Try to find with current userId first
        let stats = await db.user_stats.find({
            selector: {
                user_id: userId,
                _deleted: { $eq: false }
            }
        }).exec();

        // If not found and user is local-user (logged out), search for ANY stats
        // This ensures that after logout, we still show the last_book_id from the authenticated session
        if (stats.length === 0 && userId === 'local-user') {
            const allStats = await db.user_stats.find({
                selector: {
                    _deleted: { $eq: false }
                },
                sort: [{ _modified: 'desc' }] // Get most recent
            }).exec();

            if (allStats.length > 0) {
                stats = [allStats[0]];
                console.log('[DataLayer] 📊 Found existing stats from authenticated user:', {
                    originalUserId: allStats[0].user_id,
                    last_book_id: allStats[0].last_book_id,
                    streak_current: allStats[0].streak_current
                });
            }
        }

        return stats.length > 0 ? stats[0].toJSON() : null;
    }

    async saveUserStats(statsData: Partial<RxUserStatsDocumentType>): Promise<RxUserStatsDocumentType> {
        const db = await getDatabase();
        const userId = await this.getUserId();

        // user_stats PK is now 'id', so we must search by user_id field
        const existingStats = await db.user_stats.findOne({
            selector: { user_id: userId }
        }).exec();

        if (existingStats) {
            const updates: any = {
                _modified: Math.max(Date.now(), (existingStats.get('_modified') || 0) + 1)
            };

            if (statsData.streak_current !== undefined) updates.streak_current = statsData.streak_current;
            if (statsData.streak_longest !== undefined) updates.streak_longest = statsData.streak_longest;
            if (statsData.last_read_iso !== undefined) updates.last_read_iso = statsData.last_read_iso;
            if (statsData.freeze_available !== undefined) updates.freeze_available = statsData.freeze_available;
            if (statsData.total_minutes !== undefined) updates.total_minutes = statsData.total_minutes;
            if (statsData.last_book_id !== undefined) updates.last_book_id = statsData.last_book_id;
            if (statsData.minutes_by_date !== undefined) {
                updates.minutes_by_date = typeof statsData.minutes_by_date === 'string'
                    ? statsData.minutes_by_date
                    : JSON.stringify(statsData.minutes_by_date);
            }

            await existingStats.incrementalPatch(updates);

            console.log('[DataLayer] User stats updated: incrementalPatch');
            console.trace('[DataLayer] User stats incrementalPatch stack trace');
            return existingStats.toJSON();
        } else {
            const minutesByDateStr = statsData.minutes_by_date !== undefined
                ? (typeof statsData.minutes_by_date === 'string'
                    ? statsData.minutes_by_date
                    : JSON.stringify(statsData.minutes_by_date))
                : '{}';

            const dataToSave = {
                id: statsData.id || crypto.randomUUID(), // Generate ID if missing
                user_id: userId,
                streak_current: statsData.streak_current ?? 0,
                streak_longest: statsData.streak_longest ?? 0,
                last_read_iso: statsData.last_read_iso,
                freeze_available: statsData.freeze_available ?? true,
                total_minutes: statsData.total_minutes ?? 0,
                last_book_id: statsData.last_book_id,
                minutes_by_date: minutesByDateStr,
                _modified: Date.now(),
                _deleted: false
            } as RxUserStatsDocumentType;

            // Use upsert to handle race conditions where document may have been created between findOne and insert
            // Note: with random ID, upsert is effectively insert, but safer if ID was provided
            const newStats = await db.user_stats.upsert(dataToSave);
            console.log('[DataLayer] User stats updated: upsert', newStats.id);

            return newStats.toJSON();
        }
    }
}

export const dataLayer = RxDBDataLayerImpl.getInstance();
