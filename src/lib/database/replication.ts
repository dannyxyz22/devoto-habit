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
        const db = await getDatabase();

        // Stop existing replications if any
        await this.stopReplication();

        try {
            // Replicate Books
            const booksReplication = replicateSupabase<RxBookDocumentType>({
                tableName: 'books',
                client: supabase,
                collection: db.books,
                replicationIdentifier: 'books-replication',
                live: true,
                pull: {
                    batchSize: 50,
                    modifier: (doc) => {
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

            // Replicate Settings
            const settingsReplication = replicateSupabase<RxSettingsDocumentType>({
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
            const userEpubsReplication = replicateSupabase<RxUserEpubDocumentType>({
                tableName: 'user_epubs',
                client: supabase,
                collection: db.user_epubs,
                replicationIdentifier: 'user-epubs-replication',
                live: true,
                pull: {
                    batchSize: 50,
                    modifier: (doc) => {
                        // Map nullable fields
                        if (!doc.author) delete doc.author;
                        if (!doc.file_size) delete doc.file_size;
                        if (!doc.cover_url) delete doc.cover_url;
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

            // Log errors
            this.replicationStates.forEach((state, index) => {
                const names = ['Books', 'User EPUBs', 'Settings'];
                const name = names[index] || 'Unknown';
                state.error$.subscribe(err => {
                    console.error(`[${name} Replication] Error:`, err);
                });
            });

            // Wait for initial sync
            console.log('ReplicationManager: Waiting for initial replication...');
            await Promise.all(this.replicationStates.map(s => s.awaitInitialReplication()));
            console.log('ReplicationManager: Initial replication complete ✓');

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
            await Promise.all(this.replicationStates.map(state => state.cancel()));
            this.replicationStates = [];
            console.log('ReplicationManager: Replication stopped');
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
