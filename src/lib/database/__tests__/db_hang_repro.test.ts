
import { describe, it, expect } from 'vitest';
import { getDatabase } from '../db';

describe('Database Initialization', () => {
    it('should resolve getDatabase() within 5 seconds', async () => {
        const dbPromise = getDatabase();
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000));

        try {
            const db = await Promise.race([dbPromise, timeout]);
            expect(db).toBeDefined();
            console.log('Database resolved successfully');
        } catch (error) {
            console.error('Database failed to resolve:', error);
            throw error;
        }
    });
});
