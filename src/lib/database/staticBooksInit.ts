import { BOOKS } from '@/lib/books';
import { RxBookDocumentType } from '@/lib/database/schema';
import type { DevotoDatabase } from './db';

/**
 * Ensures all static EPUBs (from books.ts) exist in the RxDB books collection.
 * This allows their progress to be synced to Supabase.
 * 
 * @param db - The RxDB database instance
 * @param userId - The user ID to associate with the books (defaults to 'local-user')
 */
export async function ensureStaticBooks(db: DevotoDatabase, userId: string = 'local-user'): Promise<void> {
    try {
        // Filter only EPUB books from the static list
        const staticEpubs = BOOKS.filter(book => book.type === 'epub');

        console.log(`[StaticBooks] Ensuring ${staticEpubs.length} static EPUBs exist in database for user: ${userId}...`);

        let created = 0;
        let existing = 0;
        let updated = 0;

        for (const book of staticEpubs) {
            // Check if book already exists
            const existingBook = await db.books.findOne(book.id).exec();

            if (existingBook) {
                // PROTECTION: If we are initializing as 'local-user' (default on boot),
                // but the book is already assigned to a real logged-in user (UUID),
                // DO NOT overwrite it back to 'local-user'.
                if (userId === 'local-user' && existingBook.user_id !== 'local-user') {
                    console.log(`[StaticBooks] 🛡️ Valid user_id found (${existingBook.user_id}), skipping reset to local-user for: ${book.title}`);
                    continue;
                }

                // If user_id changed, update it
                if (existingBook.user_id !== userId) {
                    await existingBook.update({
                        $set: {
                            user_id: userId,
                            _modified: Date.now()
                        }
                    });
                    updated++;
                    console.log(`[StaticBooks] ↻ Updated user_id for: ${book.title}`);
                } else {
                    existing++;
                    console.log(`[StaticBooks] ✓ Book already exists: ${book.title}`);
                }
                continue;
            }

            // Create new book entry
            const bookData: RxBookDocumentType = {
                id: book.id,
                user_id: userId,
                title: book.title,
                author: book.author || 'Unknown',
                type: 'epub',
                total_pages: 0,
                current_page: 0,
                percentage: 0,
                progress_version: 0,
                part_index: 0,
                chapter_index: 0,
                last_location_cfi: undefined,
                cover_url: book.coverImage && !book.coverImage.startsWith('data:') ? book.coverImage : undefined,
                file_hash: undefined,
                added_date: Date.now(),
                _modified: Date.now(),
                _deleted: false
            };

            await db.books.insert(bookData);
            created++;
            console.log(`[StaticBooks] ✅ Created book: ${book.title}`);
        }

        console.log(`[StaticBooks] Initialization complete: ${created} created, ${existing} existing, ${updated} updated`);
    } catch (error) {
        console.error('[StaticBooks] Error ensuring static books:', error);
        // Don't throw - this is a best-effort initialization
    }
}
