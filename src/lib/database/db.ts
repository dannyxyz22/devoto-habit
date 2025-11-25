import { createRxDatabase, RxDatabase, RxCollection } from 'rxdb';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';
import { bookSchema, settingsSchema, RxBookDocumentType, RxSettingsDocumentType } from './schema';
// Define the database type
export type DevotoDatabaseCollections = {
    books: RxCollection<RxBookDocumentType>;
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
            schema: bookSchema
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
