import { replicateSupabase } from 'rxdb/plugins/replication-supabase';
import { supabase } from '@/lib/supabase';
import { getDatabase } from '@/lib/database/db';
import { RxReplicationState } from 'rxdb/plugins/replication';
import { RxBookDocumentType, RxSettingsDocumentType, RxUserEpubDocumentType, RxReadingPlanDocumentType, RxDailyBaselineDocumentType, RxUserStatsDocumentType } from '@/lib/database/schema';
import { BOOKS } from '@/lib/books';

export class ReplicationManager {
    private static instance: ReplicationManager;
    private replicationStates: RxReplicationState<any, any>[] = [];

    private constructor() { }

    public static getInstance(): ReplicationManager {
        if (!ReplicationManager.instance) {
            ReplicationManager.instance = new ReplicationManager();
        }
        return ReplicationManager.instance;
    }

    async startReplication() {
        console.log('ReplicationManager: Starting Supabase replication...');

        if (!supabase) {
            console.warn('ReplicationManager: Supabase client not initialized, skipping replication');
            return;
        }

        // Verify Supabase authentication
        const { data: { session }, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) {
            console.error('ReplicationManager: Failed to get session:', sessionError);
            return;
        }
        if (!session) {
            console.warn('ReplicationManager: No active session, skipping replication');
            return;
        }
        console.log('ReplicationManager: Authenticated as:', session.user.email, 'User ID:', session.user.id);

        // Verify RLS policies
        try {
            const { count, error: testError } = await supabase
                .from('books')
                .select('id', { count: 'exact', head: true });

            if (testError) {
                console.error('ReplicationManager: RLS Test failed:', testError);
            } else {
                console.log('ReplicationManager: Books accessible via RLS:', count);
            }
        } catch (err) {
            console.error('ReplicationManager: RLS Test exception:', err);
        }

        const db = await getDatabase();

        // Stop existing replications if any
        await this.stopReplication();

        // FIRST: Migrate any local-user data to the real user_id BEFORE starting replication
        await this.migrateLocalUserData();

        // SECOND: Reconcile local data with Supabase via UPSERT to avoid 409 Conflict errors
        // This ensures documents that exist both locally and on server are synced properly
        console.log('ReplicationManager: Reconciling local data with Supabase...');
        await this.reconcileBooks();
        await this.reconcileUserEpubs();
        await this.reconcileUserStats();
        await this.reconcileReadingPlans();
        await this.reconcileDailyBaselines();
        console.log('ReplicationManager: Reconciliation complete');

        // We'll setup Realtime listener after replications are created
        // to trigger reSync when changes come from other clients

        try {
            // Replicate Books


            const booksReplication = await replicateSupabase<RxBookDocumentType>({
                tableName: 'books',
                client: supabase,
                collection: db.books,
                replicationIdentifier: 'books-replication',
                live: true,
                pull: {
                    batchSize: 50,

                    modifier: (doc) => {
                        console.log('[Cloud Debug] ⬇️ Pulled Book:', doc);
                        // Map nullable fields - cover_url is handled by Cache Storage in UI
                        if (!doc.author) delete doc.author;
                        if (!doc.file_hash) delete doc.file_hash;
                        if (!doc.cover_url) delete doc.cover_url;
                        return doc;
                    }
                },
                push: {
                    batchSize: 50,
                    modifier: (doc) => {
                        const { created_at, updated_at, ...rest } = doc as any;
                        // Skip documents with local-user (pre-login data)
                        if (rest.user_id === 'local-user') return null;
                        // Filter out base64 cover_url, but keep external URLs
                        if (rest.cover_url && rest.cover_url.startsWith('data:')) {
                            delete rest.cover_url;
                        }
                        console.log('[Replication Books] ⬆️ Pushing doc:', { id: rest.id, title: rest.title, percent: rest.percentage });
                        return rest;
                    }
                }
            });

            // Replicate Settings
            const settingsReplication = await replicateSupabase<RxSettingsDocumentType>({
                tableName: 'user_settings',
                client: supabase,
                collection: db.settings,
                replicationIdentifier: 'settings-replication',
                live: true,
                pull: {
                    batchSize: 10,

                    modifier: (doc) => {
                        console.log('[Cloud Debug] ⬇️ Pulled Settings:', doc);
                        // Map nullable fields
                        if (!doc.theme) delete doc.theme;
                        if (!doc.font_size) delete doc.font_size;
                        if (!doc.text_align) delete doc.text_align;
                        if (!doc.line_spacing) delete doc.line_spacing;
                        if (!doc.last_active_book_id) delete doc.last_active_book_id;
                        return doc;
                    }
                },
                push: {
                    batchSize: 10,
                    modifier: (doc) => {
                        const { created_at, updated_at, ...rest } = doc as any;
                        // Skip documents with local-user (pre-login data)
                        if (rest.user_id === 'local-user') return null;
                        return rest;
                    }
                }
            });

            // Replicate User EPUBs
            const userEpubsReplication = await replicateSupabase<RxUserEpubDocumentType>({
                tableName: 'user_epubs',
                client: supabase,
                collection: db.user_epubs,
                replicationIdentifier: 'user-epubs-replication',
                live: true,
                pull: {
                    batchSize: 50,
                    modifier: (doc) => {
                        console.log('[Cloud Debug] ⬇️ Pulled User Epub:', doc);
                        // Map nullable fields - cover_url is handled by Cache Storage in UI
                        if (!doc.author) delete doc.author;
                        if (!doc.file_size) delete doc.file_size;
                        if (!doc.cover_url) delete doc.cover_url;
                        if (!doc.percentage) delete doc.percentage;
                        if (!doc.last_location_cfi) delete doc.last_location_cfi;
                        return doc;
                    }
                },
                push: {
                    batchSize: 50,
                    modifier: (doc) => {
                        const { created_at, updated_at, ...rest } = doc as any;
                        // Skip documents with local-user (pre-login data)
                        if (rest.user_id === 'local-user') return null;
                        // Filter out base64 cover_url, keep external URLs only
                        if (rest.cover_url && rest.cover_url.startsWith('data:')) {
                            delete rest.cover_url;
                        }
                        console.log('[Replication UserEpubs] ⬆️ Pushing doc:', { id: rest.id, percent: rest.percentage });
                        return rest;
                    }
                }
            });

            // Replicate Reading Plans
            const readingPlansReplication = await replicateSupabase<RxReadingPlanDocumentType>({
                tableName: 'reading_plans',
                client: supabase,
                collection: db.reading_plans,
                replicationIdentifier: 'reading-plans-replication',
                live: true,
                pull: {
                    batchSize: 50,
                    modifier: (doc) => {
                        console.log('[Cloud Debug] ⬇️ Pulled Reading Plan:', doc);
                        if (!doc.target_date_iso) delete doc.target_date_iso;
                        return doc;
                    }
                },
                push: {
                    batchSize: 50,
                    modifier: (doc) => {
                        console.log('[Replication ReadingPlans] modifier called with:', { user_id: (doc as any).user_id, id: (doc as any).id });
                        const { created_at, updated_at, ...rest } = doc as any;
                        // Skip documents with local-user (pre-login data)
                        if (rest.user_id === 'local-user') {
                            console.log('[Replication ReadingPlans] ⏭️ SKIPPING local-user doc');
                            return null;
                        }
                        console.log('[Replication ReadingPlans] ⬆️ Pushing doc:', { id: rest.id, book_id: rest.book_id });
                        return rest;
                    }
                }
            });

            // Replicate Daily Baselines

            const dailyBaselinesReplication = await replicateSupabase<RxDailyBaselineDocumentType>({
                tableName: 'daily_baselines',
                client: supabase,
                collection: db.daily_baselines,
                replicationIdentifier: 'daily-baselines-replication',
                live: true,
                pull: {
                    batchSize: 100,
                    modifier: (doc) => {
                        console.log('[Cloud Debug] ⬇️ Pulled Annual Baseline:', doc);
                        return doc;
                    }
                },
                push: {
                    batchSize: 100,
                    modifier: (doc) => {
                        const { created_at, updated_at, ...rest } = doc as any;
                        // Skip documents with local-user (pre-login data)
                        if (rest.user_id === 'local-user') return null;
                        return rest;
                    }
                }
            });



            // Replicate User Stats
            // minutes_by_date is now stored as JSON string in both RxDB and Supabase
            const userStatsReplication = await replicateSupabase<RxUserStatsDocumentType>({
                tableName: 'user_stats',
                client: supabase,
                collection: db.user_stats,
                replicationIdentifier: 'user-stats-replication',
                live: true,
                pull: {
                    batchSize: 10,
                    modifier: (doc) => {
                        console.log('[Cloud Debug] ⬇️ Pulled User Stats:', doc);
                        if (!doc.last_read_iso) delete doc.last_read_iso;
                        if (!doc.last_book_id) delete doc.last_book_id;
                        // Ensure minutes_by_date is a string (it should already be TEXT in Supabase)
                        if (doc.minutes_by_date === null || doc.minutes_by_date === undefined) {
                            doc.minutes_by_date = '{}';
                        } else if (typeof doc.minutes_by_date !== 'string') {
                            doc.minutes_by_date = JSON.stringify(doc.minutes_by_date);
                        }
                        return doc;
                    }
                },
                push: {
                    batchSize: 10,
                    modifier: async (doc) => {
                        console.log('[Replication UserStats] 📋 Modifier received doc:', doc);

                        const docData = doc as any;

                        // 1. Block local-user
                        if (docData.user_id === 'local-user') {
                            console.log('[Replication UserStats] ⏭️ Modifier BLOCKED local-user');
                            return null;
                        }

                        // 2. Align ID with server (fix duplicate key error)
                        const { data: existing } = await supabase
                            .from('user_stats')
                            .select('id')
                            .eq('user_id', docData.user_id)
                            .maybeSingle();

                        if (existing) {
                            console.log(`[Replication UserStats] 🔄 Aligning ID: Local ${docData.id} -> Server ${existing.id}`);
                            docData.id = existing.id;
                        }

                        // 3. Stringify minutes_by_date
                        if (docData.minutes_by_date && typeof docData.minutes_by_date !== 'string') {
                            docData.minutes_by_date = JSON.stringify(docData.minutes_by_date);
                        }
                        if (!docData.minutes_by_date) docData.minutes_by_date = '{}';

                        // 4. MANUAL UPSERT to bypass default INSERT behavior (which causes 409 Conflict)
                        console.log(`[Replication UserStats] ⬆️ Manually upserting doc to avoid 409 Conflict`, { id: docData.id });
                        const { error } = await supabase
                            .from('user_stats')
                            .upsert(docData, { onConflict: 'id' });

                        if (error) {
                            console.error('[Replication UserStats] ❌ Manual upsert failed:', error);
                            // We return null anyway, but log the error
                        } else {
                            console.log('[Replication UserStats] ✅ Manual upsert success');
                        }

                        // Return null to tell RxDB "I handled it / skip default push"
                        return null;
                    }
                } as any
            });

            this.replicationStates = [booksReplication, userEpubsReplication, settingsReplication, readingPlansReplication, dailyBaselinesReplication, userStatsReplication];
            //this.replicationStates = [userStatsReplication];

            // Validate all replication states were created successfully
            const invalidStates = this.replicationStates.filter(s => !s);
            if (invalidStates.length > 0) {
                throw new Error(`Failed to create ${invalidStates.length} replication state(s)`);
            }

            // Subscribe to error$ for each replication to catch issues
            this.replicationStates.forEach((state, index) => {
                const names = ['Books', 'User EPUBs', 'Settings', 'Reading Plans', 'Daily Baselines', 'User Stats'];
                const name = names[index];
                (state as any).error$.subscribe((err: any) => {
                    console.error(`[${name} Replication] Error:`, err);
                });
            });



            // Set up polling fallback when Supabase Realtime is disabled.
            // This will call quickSync every 30 seconds to pull any new changes.

            /*const pollingIntervalMs = 30000;
            const pollHandle = setInterval(() => {
                replicationManager.quickSync().catch(e => console.warn('[Replication] quickSync failed:', e));
            }, pollingIntervalMs);
            // Store handle so it can be cleared on stopReplication if needed.
            (this as any)._pollHandle = pollHandle;*/

            // Wait for initial sync
            try {
                await Promise.race([
                    Promise.all(this.replicationStates.map(s => s.awaitInitialReplication())),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Replication timeout')), 10000))
                ]);
                console.log('ReplicationManager: Initial replication complete ✓');

                // Dispatch a global event to notify listeners that replication is complete
                window.dispatchEvent(new CustomEvent('rxdb-initial-replication-complete'));
                console.log('ReplicationManager: Dispatched rxdb-initial-replication-complete event');
            } catch (err) {
                if ((err as Error).message === 'Replication timeout') {
                    console.warn('ReplicationManager: Replication timeout (continuing anyway)');
                } else {
                    throw err;
                }
            }

            // Log final sync count
            const totalBooks = await db.books.count().exec();
            console.log(`ReplicationManager: Synced ${totalBooks} books`);

            // Setup Realtime listener to trigger reSync when changes come from other clients
            // The replicateSupabase plugin should handle this, but as a fallback we do it manually
            const booksState = this.replicationStates[0];
            const userEpubsState = this.replicationStates[1];

            const realtimeChannel = supabase.channel('db-changes')
                .on('postgres_changes',
                    { event: '*', schema: 'public', table: 'books' },
                    (payload) => {
                        console.log('🔔 [Realtime] Books change from server:', payload.eventType);
                        // Trigger reSync to pull the changes
                        if (booksState && typeof (booksState as any).reSync === 'function') {
                            console.log('🔔 [Realtime] Triggering books reSync...');
                            (booksState as any).reSync();
                        }
                    }
                )
                .on('postgres_changes',
                    { event: '*', schema: 'public', table: 'user_epubs' },
                    (payload) => {
                        console.log('🔔 [Realtime] User EPUBs change from server:', payload.eventType);
                        if (userEpubsState && typeof (userEpubsState as any).reSync === 'function') {
                            (userEpubsState as any).reSync();
                        }
                    }
                )
                .subscribe((status) => {
                    console.log('🔔 [Realtime] Channel status:', status);
                    if (status === 'TIMED_OUT' || status === 'CHANNEL_ERROR') {
                        console.warn('⚠️ [Realtime] Channel unstable. Restarting replication...');
                        // Debounce restart to prevent loops
                        setTimeout(() => {
                            this.startReplication().catch(e => console.error('Restart failed:', e));
                        }, 2000);
                    }
                });

            // Store for cleanup
            (this as any).realtimeChannel = realtimeChannel;

            // Reconcile user_epubs to avoid push conflicts
            await this.reconcileUserEpubs();

            // Reconcile books to avoid push conflicts
            await this.reconcileBooks();

            // Reconcile user_stats to avoid push conflicts (handles minutes_by_date object issue)
            await this.reconcileUserStats();

        } catch (error) {
            console.error('ReplicationManager: Failed to start replication:', error);
            throw error;
        }
    }

    async stopReplication() {
        // Cleanup Realtime channel
        if ((this as any).realtimeChannel) {
            try {
                supabase.removeChannel((this as any).realtimeChannel);
                (this as any).realtimeChannel = null;
            } catch (err) {
                console.warn('ReplicationManager: Error removing realtime channel:', err);
            }
        }

        if (this.replicationStates.length > 0) {
            console.log('ReplicationManager: Stopping replication...');
            try {
                // Filter out any null/undefined states before canceling
                const validStates = this.replicationStates.filter(s => s && typeof s.cancel === 'function');
                await Promise.all(validStates.map(state => state.cancel()));
            } catch (error) {
                console.warn('ReplicationManager: Error during stop:', error);
            } finally {
                this.replicationStates = [];
                console.log('ReplicationManager: Replication stopped');
            }
        }
    }

    /**
     * Quick sync: trigger reSync on all active replications without clearing checkpoints.
     * This is a lightweight fallback when Realtime is not available.
     * Returns a promise that resolves when all reSyncs have been triggered.
     */
    async quickSync(): Promise<void> {
        console.log('Quick sync triggered, but void implementation');
        return;

        console.log('ReplicationManager: Quick sync triggered...');
        console.trace('ReplicationManager: quickSync stack trace');


        if (this.replicationStates.length === 0) {
            console.warn('ReplicationManager: No active replications for quick sync');
            // Try to start replication if not active
            await this.startReplication();
            return;
        }

        const names = ['Books', 'User EPUBs', 'Settings'];

        for (let i = 0; i < this.replicationStates.length; i++) {
            const state = this.replicationStates[i];
            const name = names[i];

            if (state && typeof (state as any).reSync === 'function') {
                console.log(`[${name}] Triggering reSync...`);
                (state as any).reSync();
            }
        }

        // Wait a bit for the sync to process
        await new Promise(resolve => setTimeout(resolve, 1000));
        console.log('ReplicationManager: Quick sync complete');
    }

    /**
     * Force a full re-sync by clearing checkpoints and restarting replication.
     * Useful when documents are missing from local database.
     */
    async forceFullResync() {
        console.log('ReplicationManager: Forcing full re-sync (clearing checkpoints)...');

        try {
            // Stop current replication
            await this.stopReplication();

            // Clear RxDB internal storage for checkpoints
            const db = await getDatabase();

            // Try to clear checkpoints by removing internal docs
            const checkpointIds = [
                'books-replication',
                'user-epubs-replication',
                'settings-replication'
            ];

            // Method 1: Try to access and clear via internals (if available)
            for (const id of checkpointIds) {
                try {
                    // Access RxDB's internal checkpoint storage
                    const storageInstances = (db as any).internalStore?.storageInstances;
                    if (storageInstances) {
                        const checkpointKey = 'replication-checkpoint-' + id;
                        if (storageInstances[checkpointKey]) {
                            await storageInstances[checkpointKey].remove();
                            console.log(`ReplicationManager: Cleared checkpoint storage for ${id}`);
                        }
                    }
                } catch (err) {
                    console.warn(`ReplicationManager: Method 1 failed for ${id}:`, err);
                }
            }

            // Method 2: Try to clear via internal collections (alternative approach)
            try {
                const internals = (db as any).internals;
                if (internals) {
                    console.log('ReplicationManager: Found internals:', Object.keys(internals));
                    // Clear any checkpoint-related data
                    for (const key of Object.keys(internals)) {
                        if (key.includes('checkpoint') || key.includes('replication')) {
                            console.log(`ReplicationManager: Found checkpoint key: ${key}`);
                        }
                    }
                }
            } catch (err) {
                console.warn('ReplicationManager: Method 2 failed:', err);
            }

            console.log('ReplicationManager: Checkpoint clearing attempted, restarting replication...');

            // Small delay to ensure cleanup is complete
            await new Promise(resolve => setTimeout(resolve, 100));

            // Restart replication (will pull all documents from scratch)
            await this.startReplication();

        } catch (error) {
            console.error('ReplicationManager: Failed to force full re-sync:', error);
            throw error;
        }
    }

    /**
     * Reconcile local user_epubs with Supabase by upserting missing rows.
     * This prevents RC_PUSH conflicts when offline-created docs are migrated after login.
     */
    public async reconcileUserEpubs() {
        try {
            const db = await getDatabase();
            const { data: auth } = await supabase.auth.getUser();
            const userId = auth?.user?.id;
            if (!userId) {
                console.log('[User EPUBs Reconciliation] Skipped: no authenticated user');
                return;
            }
            // Fetch local EPUBs
            const localDocs = await db.user_epubs.find({
                selector: { _deleted: false }
            }).exec();

            if (localDocs.length === 0) return;

            // Prepare local docs
            const localJsons = localDocs.map(d => {
                const json = d.toJSON();
                const { created_at, updated_at, ...rest } = json as any;
                // Strip base64 cover
                if (rest.cover_url && rest.cover_url.startsWith('data:')) {
                    delete rest.cover_url;
                }
                return rest;
            });

            // Fetch server rows for this user to detect existing file_hash entries
            const { data: serverRows, error: fetchErr } = await supabase
                .from('user_epubs')
                .select('id,file_hash,user_id,percentage,last_location_cfi') // Fetch progress data
                .eq('user_id', userId);
            if (fetchErr) {
                console.warn('[User EPUBs Reconciliation] Fetch server rows error:', fetchErr);
            }

            const serverByHash = new Map<string, { id: string; percentage?: number; last_location_cfi?: string }>();
            (serverRows || []).forEach(r => serverByHash.set(r.file_hash, {
                id: r.id,
                percentage: r.percentage ?? undefined,
                last_location_cfi: r.last_location_cfi ?? undefined
            }));

            // Align local IDs with server IDs where the same file_hash already exists
            for (const d of localDocs) {
                const json = d.toJSON();
                const match = serverByHash.get(json.file_hash as any);
                if (match && json.id !== match.id) {
                    try {
                        // Replace local doc with server id to avoid conflicts in replication
                        // IMPORTANT: Adopt server progress to prevent overwriting it with local 0%
                        const replacement = {
                            ...json,
                            id: match.id,
                            // Verify if local is newer or has progress before blindly taking server?
                            // In this re-onboarding case, local is likely 0. 
                            // If local has progress, we might want to keep it?
                            // But safest is: if local is 0, take server.
                            percentage: (json.percentage || 0) > (match.percentage || 0) ? json.percentage : (match.percentage ?? json.percentage),
                            last_location_cfi: (json.percentage || 0) > (match.percentage || 0) ? json.last_location_cfi : (match.last_location_cfi ?? json.last_location_cfi),
                            _modified: Date.now() // Ensure it's treated as a fresh update locally
                        } as any;

                        await d.remove();
                        await db.user_epubs.insert(replacement);
                        console.log('[User EPUBs Reconciliation] Aligned local doc id to server id for hash', json.file_hash);
                    } catch (err) {
                        console.warn('[User EPUBs Reconciliation] Failed aligning local id:', err);
                    }
                }
            }

            // Upsert ONLY local docs that strictly do NOT exist on server
            // This prevents overwriting existing server data with local defaults
            const newDocs = localJsons.filter(j => !serverByHash.has(j.file_hash));

            if (newDocs.length === 0) {
                console.log('[User EPUBs Reconciliation] No new documents to upsert.');
                return;
            }

            // Upsert remaining (new) local docs to Supabase
            const upsertPayload = newDocs.map(j => ({ ...j, user_id: userId }));
            const { error: upsertErr } = await supabase
                .from('user_epubs')
                .upsert(upsertPayload, { onConflict: 'user_id,file_hash' });
            if (upsertErr) {
                console.warn('[User EPUBs Reconciliation] Upsert error:', upsertErr);
            } else {
                console.log(`[User EPUBs Reconciliation] Upserted ${upsertPayload.length} new docs.`);
            }
        } catch (err) {
            console.warn('[User EPUBs Reconciliation] Failed:', err);
        }
    }

    /**
     * Reconcile local books with Supabase by upserting missing rows.
     * This prevents RC_PUSH conflicts when offline-created docs are migrated after login.
     */
    public async reconcileBooks() {
        try {
            const db = await getDatabase();
            const { data: auth } = await supabase.auth.getUser();
            const userId = auth?.user?.id;
            if (!userId) {
                console.log('[Books Reconciliation] Skipped: no authenticated user');
                return;
            }

            // Fetch local books
            const localDocs = await db.books.find({
                selector: { _deleted: false }
            }).exec();

            if (localDocs.length === 0) {
                console.log('[Books Reconciliation] No local books to reconcile');
                return;
            }

            // Get local book data
            const localJsons = localDocs.map(d => d.toJSON());
            const localIds = localJsons.map(j => j.id);

            // Check which ones already exist on server
            const { data: serverBooks, error: fetchErr } = await supabase
                .from('books')
                .select('id')
                .eq('user_id', userId)
                .in('id', localIds);

            if (fetchErr) {
                console.warn('[Books Reconciliation] Fetch error:', fetchErr);
                return;
            }

            const serverIds = new Set((serverBooks || []).map(b => b.id));

            // Find books that exist locally but not on server
            const newDocs = localJsons.filter(j => !serverIds.has(j.id));

            if (newDocs.length === 0) {
                console.log('[Books Reconciliation] All books already synced.');
                return;
            }

            console.log(`[Books Reconciliation] Upserting ${newDocs.length} books...`);

            // Upsert new books to Supabase
            const upsertPayload = newDocs.map(j => ({
                ...j,
                user_id: userId,
                // Remove any fields that shouldn't be synced
                created_at: undefined,
                updated_at: undefined
            }));

            const { error: upsertErr } = await supabase
                .from('books')
                .upsert(upsertPayload, { onConflict: 'id,user_id' });

            if (upsertErr) {
                console.warn('[Books Reconciliation] Upsert error:', upsertErr);
            } else {
                console.log(`[Books Reconciliation] Upserted ${upsertPayload.length} books.`);
            }
        } catch (err) {
            console.warn('[Books Reconciliation] Failed:', err);
        }
    }

    /**
     * Reconcile local user_stats with Supabase.
     * This handles the minutes_by_date object field that causes RC_PUSH errors.
     */
    /**
     * Reconcile local user_stats with Supabase.
     */
    public async reconcileUserStats() {
        const db = await getDatabase();
        const { data: auth } = await supabase.auth.getUser();
        const userId = auth?.user?.id;

        if (!userId) {
            console.log('[Reconcile] Skipped: no authenticated user');
            return;
        }

        // Find by user_id since it's no longer PK
        const localDoc = await db.user_stats.findOne({
            selector: { user_id: userId }
        }).exec();

        if (!localDoc) {
            console.log('[Reconcile] No local user_stats for this user');
            return;
        }

        const localData = localDoc.toJSON();

        // Server fetch
        const { data: serverDoc, error } = await supabase
            .from('user_stats')
            .select('*')
            .eq('user_id', userId)
            .maybeSingle();

        if (error) {
            console.warn('[Reconcile] Fetch error:', error);
            return;
        }

        // Case 1: Missing on Server -> Create
        if (!serverDoc) {
            console.log('[Reconcile] Server missing user_stats, creating from local');

            // Ensure ID exists (it should from local, but just in case)
            const idToUse = localData.id || crypto.randomUUID();

            await supabase
                .from('user_stats')
                .upsert({
                    ...localData,
                    id: idToUse,
                    minutes_by_date:
                        typeof localData.minutes_by_date === 'string'
                            ? localData.minutes_by_date
                            : JSON.stringify(localData.minutes_by_date || {}),
                    _modified: undefined
                }, { onConflict: 'user_id' }); // user_id should still be unique constraint on server

            return;
        }

        // Case 2: Server Newer -> Update Local
        if (serverDoc._modified > localData._modified) {
            console.log('[Reconcile] Server newer, patching local');
            await localDoc.incrementalPatch({
                streak_current: serverDoc.streak_current,
                streak_longest: serverDoc.streak_longest,
                last_read_iso: serverDoc.last_read_iso,
                freeze_available: serverDoc.freeze_available,
                total_minutes: serverDoc.total_minutes,
                last_book_id: serverDoc.last_book_id,
                minutes_by_date: serverDoc.minutes_by_date,
                _modified: serverDoc._modified,
                _deleted: serverDoc._deleted
            });
            return;
        }

        // Case 3: Local Newer -> Upsert to Server
        console.log('[Reconcile User Stats] Local newer or equal, UPSERT to server');
        await supabase
            .from('user_stats')
            .upsert({
                id: serverDoc.id, // Use server ID if we have it to avoid PK conflict? Or local ID?
                // Actually if we matched by user_id, we should probably respect server ID if it exists?
                // But localData.id is our source of truth for this doc.
                // Let's use localData (it's the winner) but ensure we map to the right row.
                // If ID differs, we might have an issue. Assuming they align or we rely on user_id unique constraint.
                ...localData,
                minutes_by_date:
                    typeof localData.minutes_by_date === 'string'
                        ? localData.minutes_by_date
                        : JSON.stringify(localData.minutes_by_date || {}),
                _deleted: localData._deleted ?? false
            }, { onConflict: 'user_id' });

        console.log('[Reconcile User Stats] Upsert complete');
    }


    /**
     * Reconcile local reading_plans with Supabase by upserting.
     */
    public async reconcileReadingPlans() {
        try {
            const db = await getDatabase();
            const { data: auth } = await supabase.auth.getUser();
            const userId = auth?.user?.id;
            if (!userId) {
                console.log('[Reading Plans Reconciliation] Skipped: no authenticated user');
                return;
            }

            // Fetch local reading_plans
            const localDocs = await db.reading_plans.find({
                selector: { _deleted: false }
            }).exec();

            if (localDocs.length === 0) {
                console.log('[Reading Plans Reconciliation] No local plans to reconcile');
                return;
            }

            const localJsons = localDocs.map(d => d.toJSON());
            const localIds = localJsons.map(j => j.id);

            // Check which ones already exist on server
            const { data: serverPlans, error: fetchErr } = await supabase
                .from('reading_plans')
                .select('id, start_percent, start_part_index, start_chapter_index, start_words, target_date_iso, _modified')
                .eq('user_id', userId)
                .in('id', localIds);

            if (fetchErr) {
                console.warn('[Reading Plans Reconciliation] Fetch error:', fetchErr);
                return;
            }

            const serverMap = new Map((serverPlans || []).map(p => [p.id, p]));
            const newDocs: any[] = [];
            const updateDocs: any[] = [];

            for (const localJson of localJsons) {
                const serverPlan = serverMap.get(localJson.id);

                // Get legacy start data from localStorage if missing in RxDB
                let localStartPercent = localJson.start_percent;
                let localStartPart = localJson.start_part_index;
                let localStartChapter = localJson.start_chapter_index;
                let localStartWords = localJson.start_words;

                if (localStartPercent == null) { // Loose check for null/undefined
                    try {
                        const raw = localStorage.getItem(`planStart:${localJson.book_id}`);
                        if (raw) {
                            const parsed = JSON.parse(raw);
                            localStartPercent = parsed.startPercent;
                            localStartPart = parsed.startPartIndex;
                            localStartChapter = parsed.startChapterIndex;
                            localStartWords = parsed.startWords;
                            console.log(`[Reading Plans Reconciliation] Found legacy local data for ${localJson.book_id}:`, parsed);
                        }
                    } catch (e) {
                        // ignore parse error
                    }
                }

                if (!serverPlan) {
                    // New plan, add to insert list (enriching with local storage data if needed)
                    newDocs.push({
                        ...localJson,
                        start_percent: localStartPercent,
                        start_part_index: localStartPart,
                        start_chapter_index: localStartChapter,
                        start_words: localStartWords
                    });
                } else {
                    // Check if server is missing start data that we have locally (in RxDB or localStorage)
                    // AND check timestamp to respect latest target_date
                    // Relaxed condition: if server is null OR 0, and we have a valid local start > 0
                    const serverValue = serverPlan.start_percent;
                    const localHasValue = localStartPercent !== undefined && localStartPercent > 0;
                    const serverMissingStart = (serverValue === null || serverValue === 0) && localHasValue;

                    if (serverMissingStart) {
                        console.log(`[Reading Plans Reconciliation] enhancing server plan ${localJson.id} with local start data (Server: ${serverValue}, Local: ${localStartPercent})`);

                        // Timestamp check: if local is newer (or equal), use local date. If server is strictly newer, use server date.
                        // _modified can be number or string? strict comparison usually safer if types known. 
                        // Assuming numbers from previous code context, but handling potential nulls.
                        const serverMod = serverPlan._modified || 0;
                        const localMod = localJson._modified || 0;

                        // If server is newer, we want to KEEP server's date but PATCH the start stats.
                        // If local is newer, we overwrite everything (which upsert does by default for the fields we provide).
                        const useServerDate = serverMod > localMod;
                        const targetDate = useServerDate ? serverPlan.target_date_iso : localJson.target_date_iso;

                        updateDocs.push({
                            ...localJson,
                            user_id: userId,
                            // Patch start data
                            start_percent: localStartPercent,
                            start_part_index: localStartPart,
                            start_chapter_index: localStartChapter,
                            start_words: localStartWords,
                            // Respect strict timestamp for target date
                            target_date_iso: targetDate
                        });
                    }
                }
            }

            if (newDocs.length === 0 && updateDocs.length === 0) {
                console.log('[Reading Plans Reconciliation] All plans already synced');
                return;
            }

            console.log(`[Reading Plans Reconciliation] Upserting ${newDocs.length} new plans and updating ${updateDocs.length} existing...`);

            const upsertPayload = [...newDocs, ...updateDocs].map(j => ({
                ...j,
                user_id: userId
            }));

            const { error: upsertErr } = await supabase
                .from('reading_plans')
                .upsert(upsertPayload, { onConflict: 'id' });

            if (upsertErr) {
                console.warn('[Reading Plans Reconciliation] Upsert error:', upsertErr);
            } else {
                console.log(`[Reading Plans Reconciliation] Upserted ${upsertPayload.length} plans`);
            }
        } catch (err) {
            console.warn('[Reading Plans Reconciliation] Failed:', err);
        }
    }

    /**
     * Reconcile local daily_baselines with Supabase by upserting.
     */
    public async reconcileDailyBaselines() {
        try {
            const db = await getDatabase();
            const { data: auth } = await supabase.auth.getUser();
            const userId = auth?.user?.id;
            if (!userId) {
                console.log('[Daily Baselines Reconciliation] Skipped: no authenticated user');
                return;
            }

            // Fetch local daily_baselines
            const localDocs = await db.daily_baselines.find({
                selector: { _deleted: false }
            }).exec();

            if (localDocs.length === 0) {
                console.log('[Daily Baselines Reconciliation] No local baselines to reconcile');
                return;
            }

            const localJsons = localDocs.map(d => d.toJSON());
            const localIds = localJsons.map(j => j.id);

            // Check which ones already exist on server
            const { data: serverBaselines, error: fetchErr } = await supabase
                .from('daily_baselines')
                .select('id')
                .eq('user_id', userId)
                .in('id', localIds);

            if (fetchErr) {
                console.warn('[Daily Baselines Reconciliation] Fetch error:', fetchErr);
                return;
            }

            const serverIds = new Set((serverBaselines || []).map(b => b.id));
            const newDocs = localJsons.filter(j => !serverIds.has(j.id));

            if (newDocs.length === 0) {
                console.log('[Daily Baselines Reconciliation] All baselines already synced');
                return;
            }

            console.log(`[Daily Baselines Reconciliation] Upserting ${newDocs.length} baselines...`);

            const upsertPayload = newDocs.map(j => ({
                ...j,
                user_id: userId,
                created_at: undefined,
                updated_at: undefined
            }));

            const { error: upsertErr } = await supabase
                .from('daily_baselines')
                .upsert(upsertPayload, { onConflict: 'id,user_id' });

            if (upsertErr) {
                console.warn('[Daily Baselines Reconciliation] Upsert error:', upsertErr);
            } else {
                console.log(`[Daily Baselines Reconciliation] Upserted ${upsertPayload.length} baselines`);
            }
        } catch (err) {
            console.warn('[Daily Baselines Reconciliation] Failed:', err);
        }
    }


    public async migrateLocalUserStats(realUserId: string) {
        const db = await getDatabase();

        // user_stats now PK = id, so we search by user_id
        const localStats = await db.user_stats.findOne({
            selector: { user_id: 'local-user' }
        }).exec();

        if (!localStats) return;

        const localData = localStats.toJSON();

        // Verifica se já existe user_stats local para o usuário real
        const existingStats = await db.user_stats.findOne({
            selector: { user_id: realUserId }
        }).exec();

        if (!existingStats) {
            // Adopt local-user stats by updating user_id (stays same document ID)
            await localStats.incrementalPatch({
                user_id: realUserId,
                _modified: Date.now()
            });
            console.log('[Migration] user_stats ownership transferred to real user');
        } else {
            // Merge into existing stats
            await existingStats.incrementalPatch({
                streak_current: Math.max(existingStats.streak_current, localData.streak_current),
                streak_longest: Math.max(existingStats.streak_longest, localData.streak_longest),
                total_minutes: Math.max(existingStats.total_minutes, localData.total_minutes),
                last_read_iso: localData.last_read_iso ?? existingStats.last_read_iso,
                last_book_id: localData.last_book_id ?? existingStats.last_book_id,
                minutes_by_date: this.mergeMinutesByDate(
                    localData.minutes_by_date,
                    existingStats.minutes_by_date
                ),
                _modified: Date.now()
            });
            console.log('[Migration] user_stats minimally merged locally');

            // Remove the old local-user doc since we merged its data
            await localStats.remove();
            console.log('[Migration] local-user user_stats removed');
        }
    }



    /**
     * Migrate documents with user_id='local-user' to the real authenticated user_id.
     * This handles data created before login that needs to be synced.
     */
    public async migrateLocalUserData() {
        try {
            const db = await getDatabase();
            const { data: auth } = await supabase.auth.getUser();
            const realUserId = auth?.user?.id;

            if (!realUserId) {
                console.log('[Migration] Skipped: no authenticated user');
                return;
            }

            console.log('[Migration] Starting migration from local-user to:', realUserId);
            let totalMigrated = 0;

            // Migrate books
            const localBooks = await db.books.find({ selector: { user_id: 'local-user' } }).exec();
            for (const book of localBooks) {
                const bookData = book.toJSON();

                // Check if this is a static book - if so, PRESERVE the ID, just update user_id
                const isStatic = BOOKS.some(b => b.id === bookData.id);

                if (isStatic) {
                    // Update in-place so we don't lose the ID or create duplicates
                    await book.update({
                        $set: {
                            user_id: realUserId,
                            _modified: Date.now()
                        }
                    });
                    console.log(`[Migration] Updated static book ownership: ${bookData.id}`);
                    totalMigrated++;
                } else {
                    // Start NON-STATIC logic
                    // User uploaded books get namespaced ID to avoid conflicts
                    const newId = `${realUserId}:${bookData.id.replace('local-user:', '')}`;

                    // Check if already exists with real user_id
                    const existing = await db.books.findOne(newId).exec();
                    if (!existing) {
                        await db.books.insert({
                            ...bookData,
                            id: newId,
                            user_id: realUserId,
                            _modified: Date.now()
                        });
                    }
                    // Remove the local-user version
                    await book.remove();
                    totalMigrated++;
                    // End NON-STATIC logic
                }
            }
            if (localBooks.length > 0) {
                console.log(`[Migration] Migrated ${localBooks.length} books`);
            }

            // Migrate user_epubs
            const localEpubs = await db.user_epubs.find({ selector: { user_id: 'local-user' } }).exec();
            for (const epub of localEpubs) {
                const epubData = epub.toJSON();
                const newId = `${realUserId}:${epubData.id.replace('local-user:', '')}`;

                const existing = await db.user_epubs.findOne(newId).exec();
                if (!existing) {
                    await db.user_epubs.insert({
                        ...epubData,
                        id: newId,
                        user_id: realUserId,
                        _modified: Date.now()
                    });
                }
                await epub.remove();
                totalMigrated++;
            }
            if (localEpubs.length > 0) {
                console.log(`[Migration] Migrated ${localEpubs.length} user_epubs`);
            }

            // Migrate reading_plans
            const localPlans = await db.reading_plans.find({ selector: { user_id: 'local-user' } }).exec();
            for (const plan of localPlans) {
                const planData = plan.toJSON();
                const newId = planData.id.replace('local-user:', `${realUserId}:`);

                const existing = await db.reading_plans.findOne(newId).exec();
                if (!existing) {
                    await db.reading_plans.insert({
                        ...planData,
                        id: newId,
                        user_id: realUserId,
                        _modified: Date.now()
                    });
                }
                await plan.remove();
                totalMigrated++;
            }
            if (localPlans.length > 0) {
                console.log(`[Migration] Migrated ${localPlans.length} reading_plans`);
            }

            // Migrate daily_baselines
            const localBaselines = await db.daily_baselines.find({ selector: { user_id: 'local-user' } }).exec();
            for (const baseline of localBaselines) {
                const baselineData = baseline.toJSON();
                const newId = baselineData.id.replace('local-user:', `${realUserId}:`);

                const existing = await db.daily_baselines.findOne(newId).exec();
                if (!existing) {
                    await db.daily_baselines.insert({
                        ...baselineData,
                        id: newId,
                        user_id: realUserId,
                        _modified: Date.now()
                    });
                }
                await baseline.remove();
                totalMigrated++;
            }
            if (localBaselines.length > 0) {
                console.log(`[Migration] Migrated ${localBaselines.length} daily_baselines`);
            }

            await this.migrateLocalUserStats(realUserId);

            // Migrate settings
            const localSettings = await db.settings.findOne('local-user').exec();
            if (localSettings) {
                const settingsData = localSettings.toJSON();

                const existingSettings = await db.settings.findOne(realUserId).exec();
                if (!existingSettings) {
                    await db.settings.insert({
                        ...settingsData,
                        user_id: realUserId,
                        _modified: Date.now()
                    });
                    console.log('[Migration] Migrated settings');
                }
                await localSettings.remove();
                totalMigrated++;
            }

            if (totalMigrated > 0) {
                console.log(`[Migration] ✅ Complete! Migrated ${totalMigrated} documents from local-user to ${realUserId}`);
            } else {
                console.log('[Migration] No local-user data to migrate');
            }
        } catch (err) {
            console.error('[Migration] Failed:', err);
        }
    }

    /**
     * Helper to merge minutes_by_date objects (stored as JSON strings)
     */
    private mergeMinutesByDate(a: string | Record<string, number> | undefined, b: string | Record<string, number> | undefined): string {
        const parseIfString = (val: string | Record<string, number> | undefined): Record<string, number> => {
            if (!val) return {};
            if (typeof val === 'string') {
                try { return JSON.parse(val); } catch { return {}; }
            }
            return val;
        };

        const objA = parseIfString(a);
        const objB = parseIfString(b);

        // Merge: for each date, take the max value
        const merged: Record<string, number> = { ...objB };
        for (const [date, minutes] of Object.entries(objA)) {
            merged[date] = Math.max(merged[date] || 0, minutes);
        }

        return JSON.stringify(merged);
    }
}

export const replicationManager = ReplicationManager.getInstance();
