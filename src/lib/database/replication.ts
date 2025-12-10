import { replicateSupabase } from 'rxdb/plugins/replication-supabase';
import { supabase } from '@/lib/supabase';
import { getDatabase } from '@/lib/database/db';
import { RxReplicationState } from 'rxdb/plugins/replication';
import { RxBookDocumentType, RxSettingsDocumentType, RxUserEpubDocumentType } from '@/lib/database/schema';

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
                    batchSize: 10
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
                        // Filter out base64 cover_url, keep external URLs only
                        if (rest.cover_url && rest.cover_url.startsWith('data:')) {
                            delete rest.cover_url;
                        }
                        console.log('[Replication UserEpubs] ⬆️ Pushing doc:', { id: rest.id, percent: rest.percentage });
                        return rest;
                    }
                }
            });

            this.replicationStates = [booksReplication, userEpubsReplication, settingsReplication];

            // Validate all replication states were created successfully
            const invalidStates = this.replicationStates.filter(s => !s);
            if (invalidStates.length > 0) {
                throw new Error(`Failed to create ${invalidStates.length} replication state(s)`);
            }

            // Subscribe to error$ for each replication to catch issues
            this.replicationStates.forEach((state, index) => {
                const names = ['Books', 'User EPUBs', 'Settings'];
                const name = names[index];
                (state as any).error$.subscribe((err: any) => {
                    console.error(`[${name} Replication] Error:`, err);
                });
            });

            // Start replications
            for (const state of this.replicationStates) {
                if (typeof (state as any).start === 'function') {
                    await (state as any).start();
                }
            }

            // Wait for initial sync
            try {
                await Promise.race([
                    Promise.all(this.replicationStates.map(s => s.awaitInitialReplication())),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Replication timeout')), 10000))
                ]);
                console.log('ReplicationManager: Initial replication complete ✓');
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
        console.log('ReplicationManager: Quick sync triggered...');

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
}

export const replicationManager = ReplicationManager.getInstance();
