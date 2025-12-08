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
        
        // Test RLS policies by fetching a sample document
        try {
            const { data: testBooks, error: testError, count } = await supabase
                .from('books')
                .select('id, title, user_id, type, _modified', { count: 'exact' })
                .limit(100);
            
            console.log('ReplicationManager: RLS Test - Books accessible:', testBooks?.length || 0, 'Total count:', count);
            
            // Show _modified values to debug replication
            if (testBooks && testBooks.length > 0) {
                console.log('ReplicationManager: Sample book _modified:', testBooks[0]._modified, 'Type:', typeof testBooks[0]._modified);
                console.log('ReplicationManager: All _modified values:', testBooks.map((b: any) => ({ id: b.id, _modified: b._modified })));
            }
            if (testError) {
                console.error('ReplicationManager: RLS Test failed:', testError);
            } else if (testBooks) {
                console.log('ReplicationManager: Sample books:', testBooks);
                // Count by type
                const byType = testBooks.reduce((acc, book) => {
                    const type = book.type || 'unknown';
                    acc[type] = (acc[type] || 0) + 1;
                    return acc;
                }, {} as Record<string, number>);
                console.log('ReplicationManager: Books by type:', byType);
            }
        } catch (err) {
            console.error('ReplicationManager: RLS Test exception:', err);
        }
        
        const db = await getDatabase();

        // Stop existing replications if any
        await this.stopReplication();

        // Clear old checkpoints to force full re-sync
        try {
            // Try to clear checkpoint data from storage
            const allDocs = await db.books.find().exec();
            console.log('ReplicationManager: Found', allDocs.length, 'books in local DB before clear');
        } catch (err) {
            console.warn('ReplicationManager: Could not query books:', err);
        }

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
                    queryBuilder: ({ query }) => {
                        // CRITICAL: This tells RxDB how to query Supabase
                        console.log('[Books Pull] queryBuilder called!');
                        return query;
                    },
                    modifier: (doc) => {
                        console.log('[Books Pull] Received from Supabase:', { id: doc.id, user_id: doc.user_id, title: doc.title });
                        // Map nullable fields
                        if (!doc.author) delete doc.author;
                        if (!doc.file_hash) delete doc.file_hash;

                        // _modified is already BIGINT in Supabase, no conversion needed
                        return doc;
                    }
                },
                push: {
                    batchSize: 50,
                    modifier: (doc) => {
                        console.log('[Push Modifier] Original:', doc);
                        const { created_at, updated_at, ...rest } = doc as any;

                        // Filter out base64 cover_url, but keep external URLs
                        if (rest.cover_url && rest.cover_url.startsWith('data:')) {
                            delete rest.cover_url;
                        }

                        console.log('[Push Modifier] Sanitized:', rest);
                        return rest;
                    }
                }
            });
            
            console.log('ReplicationManager: Books replication result:', {
                type: typeof booksReplication,
                hasAwaitInitialReplication: typeof (booksReplication as any).awaitInitialReplication === 'function',
                hasReceived: typeof (booksReplication as any).received$ !== 'undefined',
                keys: Object.keys(booksReplication as any).slice(0, 10),
                // Explore internal structure
                internalState: (booksReplication as any).internalReplicationState ? 'exists' : 'missing',
                isPaused: (booksReplication as any).isPaused,
                isStopped: (booksReplication as any).isStopped,
                canceled: (booksReplication as any).canceled
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
                    queryBuilder: ({ query }) => {
                        console.log('[Settings Pull] Executing query...');
                        return query; // Return the base query - RLS will filter by user
                    },
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
                    queryBuilder: ({ query }) => {
                        console.log('[User EPUBs Pull] Executing query...');
                        return query; // Return the base query - RLS will filter by user
                    },
                    modifier: (doc) => {
                        console.log('[User EPUBs Pull] Received from Supabase:', { id: doc.id, user_id: doc.user_id, title: doc.title });
                        // Map nullable fields
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

            // CRITICAL: Subscribe to observables to trigger pull
            // RxDB won't start pulling until someone subscribes to the replication state's observables
            console.log('ReplicationManager: Setting up subscriptions to trigger replication...');
            const subscriptions: any[] = [];
            
            this.replicationStates.forEach((state, index) => {
                const names = ['Books', 'User EPUBs', 'Settings'];
                const name = names[index];
                let totalReceived = 0;
                try {
                    // Subscribe to ALL observables to ensure pull is triggered
                    subscriptions.push(
                        (state as any).error$.subscribe((err: any) => {
                            console.error(`[${name} Replication] Error:`, err);
                        })
                    );
                    
                    subscriptions.push(
                        (state as any).received$.subscribe((docs: any[]) => {
                            if (!docs || !Array.isArray(docs)) {
                                console.log(`[${name} Replication] received$ emitted with non-array:`, typeof docs, docs);
                            } else {
                                totalReceived += docs.length;
                                console.log(`[${name} Replication] received$ emitted with ${docs.length} docs (Total so far: ${totalReceived})`);
                                if (docs.length > 0) {
                                    console.log(`[${name} Replication] Pulled ${docs.length} document(s)`, docs.map((d: any) => d.id));
                                }
                            }
                        })
                    );
                    
                    subscriptions.push(
                        (state as any).sent$.subscribe((docs: any[]) => {
                            console.log(`[${name} Replication] sent$ emitted with ${docs.length} docs`);
                            if (docs.length > 0) {
                                console.log(`[${name} Replication] Pushed ${docs.length} document(s)`);
                            }
                        })
                    );
                    
                    // Also subscribe to active$ to see state changes
                    subscriptions.push(
                        (state as any).active$.subscribe((isActive: boolean) => {
                            console.log(`[${name} Replication] active$ changed to:`, isActive);
                        })
                    );
                    
                } catch (err) {
                    console.warn(`[${name}] Failed to setup subscriptions:`, err);
                }
            });
            
            // Try to resume/activate the replication if it's paused
            console.log('ReplicationManager: Attempting to resume replication if paused...');
            for (let i = 0; i < this.replicationStates.length; i++) {
                const state = this.replicationStates[i];
                const names = ['Books', 'User EPUBs', 'Settings'];
                const name = names[i];
                
                try {
                    if (typeof (state as any).resume === 'function') {
                        console.log(`[${name}] Calling resume()...`);
                        await (state as any).resume();
                        console.log(`[${name}] Resumed`);
                    }
                    
                    if (typeof (state as any).start === 'function') {
                        console.log(`[${name}] Calling start()...`);
                        await (state as any).start();
                        console.log(`[${name}] Started`);
                    }
                } catch (err) {
                    console.warn(`[${name}] Error resuming/starting:`, err);
                }
            }
            
            console.log('ReplicationManager: Subscriptions active, replication should be pulling now...');

            // Try to manually trigger pull if method exists
            console.log('ReplicationManager: Attempting to manually trigger pull...');
            for (let i = 0; i < this.replicationStates.length; i++) {
                const state = this.replicationStates[i];
                const names = ['Books', 'User EPUBs', 'Settings'];
                const name = names[i];
                
                try {
                    // Try to call pull() directly if it exists
                    if (typeof (state as any).pull === 'function') {
                        console.log(`[${name}] Calling pull() directly...`);
                        await (state as any).pull();
                        console.log(`[${name}] Pull completed`);
                    } else {
                        console.log(`[${name}] pull() method not found on state`);
                    }
                } catch (err) {
                    console.warn(`[${name}] Error calling pull():`, err);
                }
            }

            // Wait for initial sync
            console.log('ReplicationManager: Waiting for initial replication...');
            try {
                await Promise.race([
                    Promise.all(this.replicationStates.map(s => s.awaitInitialReplication())),
                    new Promise((_, reject) => setTimeout(() => reject(new Error('Replication timeout')), 10000))
                ]);
                console.log('ReplicationManager: Initial replication complete ✓');
            } catch (err) {
                if ((err as Error).message === 'Replication timeout') {
                    console.warn('ReplicationManager: Replication timeout (but continuing anyway)...');
                } else {
                    throw err;
                }
            }

            // Check how many books were synced
            const totalBooks = await db.books.count().exec();
            console.log(`ReplicationManager: Books sync complete - Total in RxDB: ${totalBooks} (Expected: 20 from Supabase)`);

            // Log replication states and internal checkpoints
            this.replicationStates.forEach((state, index) => {
                const names = ['Books', 'User EPUBs', 'Settings'];
                const name = names[index] || 'Unknown';
                
                // Get internal state
                const internalState = (state as any).internalReplicationState;
                const checkpoint = internalState?.checkpointDoc;
                
                console.log(`[${name} Replication] Active:`, !!(state as any).isStopped, 'Live:', (state as any).live);
                console.log(`[${name} Replication] Checkpoint:`, checkpoint);
                
                // Try to get stats
                try {
                    const stats = {
                        canceled: (state as any).canceled,
                        isStopped: (state as any).isStopped,
                        subjects: {
                            active: !!(state as any).subjects?.active,
                            error: !!(state as any).subjects?.error,
                            received: !!(state as any).subjects?.received,
                            sent: !!(state as any).subjects?.sent,
                        }
                    };
                    console.log(`[${name} Replication] Stats:`, stats);
                } catch (err) {
                    console.warn(`[${name} Replication] Could not get stats:`, err);
                }
            });

            // After initial replication, proactively reconcile user_epubs:
            // Ensure local docs exist in Supabase to avoid RC_PUSH 'doc not found'
            await this.reconcileUserEpubs();

        } catch (error) {
            console.error('ReplicationManager: Failed to start replication:', error);
            throw error;
        }
    }

    async stopReplication() {
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
                .select('id,file_hash,user_id')
                .eq('user_id', userId);
            if (fetchErr) {
                console.warn('[User EPUBs Reconciliation] Fetch server rows error:', fetchErr);
            }

            const serverByHash = new Map<string, { id: string }>();
            (serverRows || []).forEach(r => serverByHash.set(r.file_hash, { id: r.id }));

            // Align local IDs with server IDs where the same file_hash already exists
            for (const d of localDocs) {
                const json = d.toJSON();
                const match = serverByHash.get(json.file_hash as any);
                if (match && json.id !== match.id) {
                    try {
                        // Replace local doc with server id to avoid conflicts in replication
                        const replacement = { ...json, id: match.id } as any;
                        await d.remove();
                        await db.user_epubs.insert(replacement);
                        console.log('[User EPUBs Reconciliation] Aligned local doc id to server id for hash', json.file_hash);
                    } catch (err) {
                        console.warn('[User EPUBs Reconciliation] Failed aligning local id:', err);
                    }
                }
            }

            // Upsert remaining (or aligned) local docs to Supabase with onConflict on file_hash+user_id
            const upsertPayload = localJsons.map(j => ({ ...j, user_id: userId }));
            const { error: upsertErr } = await supabase
                .from('user_epubs')
                .upsert(upsertPayload, { onConflict: 'user_id,file_hash' });
            if (upsertErr) {
                console.warn('[User EPUBs Reconciliation] Upsert error:', upsertErr);
            } else {
                console.log('[User EPUBs Reconciliation] Upserted/Aligned', upsertPayload.length, 'rows');
            }
        } catch (err) {
            console.warn('[User EPUBs Reconciliation] Failed:', err);
        }
    }
}

export const replicationManager = ReplicationManager.getInstance();
