import { DataLayer } from './DataLayer';
import { getDatabase } from '@/lib/database/db';
import { RxBookDocumentType, RxSettingsDocumentType } from '@/lib/database/schema';
import { authService } from '@/services/auth/SupabaseAuthService';
import { replicationManager } from '@/lib/database/replication';

class RxDBDataLayerImpl implements DataLayer {
    private static instance: RxDBDataLayerImpl;

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
            if (event === 'SIGNED_IN' && session) {
                console.log('DataLayer: User signed in, starting replication...');
                await replicationManager.startReplication();
            } else if (event === 'SIGNED_OUT') {
                console.log('DataLayer: User signed out, stopping replication...');
                await replicationManager.stopReplication();
            }
        });
    }

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
        const userId = await this.getUserId();

        const books = await db.books.find({
            selector: {
                user_id: userId,
                _deleted: { $eq: false }
            }
        }).exec();

        return books.map(doc => doc.toJSON());
    }

    async getBook(id: string): Promise<RxBookDocumentType | null> {
        const db = await getDatabase();
        const book = await db.books.findOne(id).exec();
        return book ? book.toJSON() : null;
    }

    async saveBook(bookData: Partial<RxBookDocumentType>): Promise<RxBookDocumentType> {
        const db = await getDatabase();
        const userId = await this.getUserId();

        // Ensure user_id is set and sanitize data
        const { cover_url, ...sanitizedBookData } = bookData as any;

        const dataToSave = {
            ...sanitizedBookData,
            user_id: userId,
            _modified: Date.now(),
            _deleted: false,
            // Ensure progress fields are preserved or defaulted
            part_index: bookData.part_index ?? 0,
            chapter_index: bookData.chapter_index ?? 0,
            last_location_cfi: bookData.last_location_cfi ?? undefined
        } as RxBookDocumentType;

        const existingBook = await db.books.findOne(dataToSave.id).exec();

        if (existingBook) {
            await existingBook.patch(dataToSave);
            return existingBook.toJSON();
        } else {
            const newBook = await db.books.insert(dataToSave);
            return newBook.toJSON();
        }
    }

    async deleteBook(id: string): Promise<void> {
        const db = await getDatabase();
        const book = await db.books.findOne(id).exec();

        if (book) {
            // Soft delete
            await book.patch({
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

        const dataToSave = {
            ...settingsData,
            user_id: userId,
            _modified: Date.now()
        } as RxSettingsDocumentType;

        const existingSettings = await db.settings.findOne(userId).exec();

        if (existingSettings) {
            await existingSettings.patch(dataToSave);
            return existingSettings.toJSON();
        } else {
            const newSettings = await db.settings.insert(dataToSave);
            return newSettings.toJSON();
        }
    }
}

export const dataLayer = RxDBDataLayerImpl.getInstance();
