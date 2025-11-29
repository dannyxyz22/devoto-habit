import { createRxDatabase, RxDatabase, RxCollection, addRxPlugin } from 'rxdb';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';
import { RxDBMigrationSchemaPlugin } from 'rxdb/plugins/migration-schema';
import { RxDBUpdatePlugin } from 'rxdb/plugins/update';
import { bookSchema, settingsSchema, userEpubSchema, RxBookDocumentType, RxSettingsDocumentType, RxUserEpubDocumentType } from './schema';

// Add required plugins
addRxPlugin(RxDBMigrationSchemaPlugin);
addRxPlugin(RxDBUpdatePlugin);

// Define the database type
export type DevotoDatabaseCollections = {
    books: RxCollection<RxBookDocumentType>;
    user_epubs: RxCollection<RxUserEpubDocumentType>;
    settings: RxCollection<RxSettingsDocumentType>;
};
export type DevotoDatabase = RxDatabase<DevotoDatabaseCollections>;
let dbPromise: Promise<DevotoDatabase> | null = null;

const _createDatabase = async (): Promise<DevotoDatabase> => {
    console.log('DatabaseService: Creating database...');

    const db = await createRxDatabase<DevotoDatabaseCollections>({
        name: 'devotodb_v6',
        storage: getRxStorageDexie(),
        hashFunction: (input: string) => {
            let hash = 0;
            for (let i = 0; i < input.length; i++) {
                hash = ((hash << 5) - hash) + input.charCodeAt(i);
                hash = hash & hash;
            }
            return Promise.resolve(Math.abs(hash).toString(16));
        }
    });

    console.log('DatabaseService: Adding collections...');
    await db.addCollections({
        books: {
            schema: bookSchema,
            migrationStrategies: {
                // Migration from v0 to v1: populate added_date from _modified
                1: function (oldDoc: any) {
                    console.log('[Migration] v0→v1: Setting added_date for book:', oldDoc.id);
                    return {
                        ...oldDoc,
                        added_date: oldDoc._modified || Date.now()
                    };
                }
            }
        },
        user_epubs: {
            schema: userEpubSchema
        },
        settings: {
            schema: settingsSchema
        }
    });

    console.log('DatabaseService: Database created');
    return db;
};
export const getDatabase = (): Promise<DevotoDatabase> => {
    if (!dbPromise) {
        dbPromise = _createDatabase();
    }
    return dbPromise;
};
