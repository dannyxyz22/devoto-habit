import { replicateSupabase } from 'rxdb/plugins/replication-supabase';
import { supabase } from '@/lib/supabase';
import { getDatabase } from '@/lib/database/db';
import { RxReplicationState } from 'rxdb/plugins/replication';
import { RxBookDocumentType, RxSettingsDocumentType } from '@/lib/database/schema';

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
                        if (!doc.cover_url) delete doc.cover_url;
                        if (!doc.file_hash) delete doc.file_hash;
                        return doc;
                    }
                },
                push: {
                    batchSize: 50
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

            this.replicationStates = [booksReplication, settingsReplication];

            // Log errors
            this.replicationStates.forEach((state, index) => {
                const name = index === 0 ? 'Books' : 'Settings';
                state.error$.subscribe(err => {
                    console.error(`[${name} Replication] Error:`, err);
                });
            });

            // Wait for initial sync
            console.log('ReplicationManager: Waiting for initial replication...');
            await Promise.all(this.replicationStates.map(s => s.awaitInitialReplication()));
            console.log('ReplicationManager: Initial replication complete ✓');

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
}

export const replicationManager = ReplicationManager.getInstance();
