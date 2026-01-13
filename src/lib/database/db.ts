import { createRxDatabase, RxDatabase, RxCollection, addRxPlugin } from 'rxdb';
import { getRxStorageDexie } from 'rxdb/plugins/storage-dexie';
import { RxDBMigrationSchemaPlugin } from 'rxdb/plugins/migration-schema';
import { RxDBUpdatePlugin } from 'rxdb/plugins/update';
import {
    bookSchema,
    settingsSchema,
    userEpubSchema,
    readingPlanSchema,
    dailyBaselineSchema,
    userStatsSchema,
    RxBookDocumentType,
    RxSettingsDocumentType,
    RxUserEpubDocumentType,
    RxReadingPlanDocumentType,
    RxDailyBaselineDocumentType,
    RxUserStatsDocumentType
} from './schema';
import { ensureStaticBooks } from './staticBooksInit';

// Add required plugins
addRxPlugin(RxDBMigrationSchemaPlugin);
addRxPlugin(RxDBUpdatePlugin);

// Define the database type
export type DevotoDatabaseCollections = {
    books: RxCollection<RxBookDocumentType>;
    user_epubs: RxCollection<RxUserEpubDocumentType>;
    settings: RxCollection<RxSettingsDocumentType>;
    reading_plans: RxCollection<RxReadingPlanDocumentType>;
    daily_baselines: RxCollection<RxDailyBaselineDocumentType>;
    user_stats: RxCollection<RxUserStatsDocumentType>;
};
export type DevotoDatabase = RxDatabase<DevotoDatabaseCollections>;

let _dbPromise: Promise<DevotoDatabase> | null = null;
let _deadlockTimerId: ReturnType<typeof setTimeout> | null = null;
let _dbInitStartTime: number | null = null;

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
            schema: userEpubSchema,
            migrationStrategies: {
                // Migration from v0 to v1: add progress fields
                1: function (oldDoc: any) {
                    console.log('[Migration] user_epubs v0→v1: Adding progress fields for:', oldDoc.id);
                    return {
                        ...oldDoc,
                        percentage: oldDoc.percentage || 0,
                        last_location_cfi: oldDoc.last_location_cfi || ''
                    };
                }
            }
        },
        settings: {
            schema: settingsSchema
        },
        reading_plans: {
            schema: readingPlanSchema
        },
        daily_baselines: {
            schema: dailyBaselineSchema,
            migrationStrategies: {
                1: function (oldDoc: any) {
                    return oldDoc;
                }
            }
        },
        user_stats: {
            schema: userStatsSchema
        }
    });

    db.user_stats.preInsert((data, instance) => {
        console.log('[HOOK] preInsert user_stats', data);
        console.trace('[HOOK] preInsert user_stats trace');
        return data;
    }, false);
    db.user_stats.preSave((data, instance) => {
        console.log('[HOOK] preSave user_stats', data);
        console.trace('[HOOK] preSave user_stats trace');
        return data;
    }, false);

    console.log('DatabaseService: Database created');

    // Initialize static books (EPUBs from books.ts)
    // Use 'local-user' as default - will be updated when user logs in
    await ensureStaticBooks(db, 'local-user');

    return db;
};

const getDatabase = async (): Promise<DevotoDatabase> => {
    if (!_dbPromise) {
        console.log('Initializing Database Promise...');
        _dbInitStartTime = Date.now();
        
        // Setup a single deadlock detection timer (only once when DB creation starts)
        if (!_deadlockTimerId) {
            _deadlockTimerId = setTimeout(() => {
                const elapsed = _dbInitStartTime ? Date.now() - _dbInitStartTime : 0;
                console.warn(`getDatabase() is taking ${elapsed}ms. This may be normal for first load with migrations.`);
                _deadlockTimerId = null;
            }, 10000); // Increased to 10s and changed to warning, not critical
        }
        
        _dbPromise = _createDatabase()
            .then(db => {
                // Clear the timeout when DB is ready
                if (_deadlockTimerId) {
                    clearTimeout(_deadlockTimerId);
                    _deadlockTimerId = null;
                }
                const elapsed = _dbInitStartTime ? Date.now() - _dbInitStartTime : 0;
                console.log(`DatabaseService: Database ready in ${elapsed}ms`);
                return db;
            })
            .catch(err => {
                // Clear the timeout on error
                if (_deadlockTimerId) {
                    clearTimeout(_deadlockTimerId);
                    _deadlockTimerId = null;
                }
                _dbPromise = null; // Reset on error
                throw err;
            });
    }

    return _dbPromise;
};

export { getDatabase };
