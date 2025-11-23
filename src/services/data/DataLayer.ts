import { RxBookDocumentType, RxSettingsDocumentType } from '@/lib/database/schema';

export interface DataLayer {
    /**
     * Get all books for the current user
     */
    getBooks(): Promise<RxBookDocumentType[]>;

    /**
     * Get a single book by ID
     */
    getBook(id: string): Promise<RxBookDocumentType | null>;

    /**
     * Save or update a book
     */
    saveBook(book: Partial<RxBookDocumentType>): Promise<RxBookDocumentType>;

    /**
     * Delete a book (Soft delete)
     */
    deleteBook(id: string): Promise<void>;

    /**
     * Get user settings
     */
    getSettings(): Promise<RxSettingsDocumentType | null>;

    /**
     * Save user settings
     */
    saveSettings(settings: Partial<RxSettingsDocumentType>): Promise<RxSettingsDocumentType>;
}
