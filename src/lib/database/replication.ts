import { replicateSupabase, SupabaseReplicationOptions } from 'rxdb-supabase';
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
        console.log('ReplicationManager: Starting replication...');
        const db = await getDatabase();

        // Stop existing replications if any
        await this.stopReplication();

        // Replicate Books
        const booksReplication = replicateSupabase<RxBookDocumentType>({
            supabaseClient: supabase,
            collection: db.books,
            table: 'books',
            replicationIdentifier: 'books-replication',
            pull: {
                realtimePostgresChanges: true
            },
            push: {
                // Only push changes if user is online
                // RxDB handles this automatically but good to know
            }
        });

        // Replicate Settings
        const settingsReplication = replicateSupabase<RxSettingsDocumentType>({
            supabaseClient: supabase,
            collection: db.settings,
            table: 'user_settings',
            replicationIdentifier: 'settings-replication',
            pull: {
                realtimePostgresChanges: true
            },
            push: {}
        });

        this.replicationStates = [booksReplication, settingsReplication];

        // Log errors
        this.replicationStates.forEach(state => {
            state.error$.subscribe(err => {
                console.error('Replication error:', err);
            });
        });

        console.log('ReplicationManager: Replication started');
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
