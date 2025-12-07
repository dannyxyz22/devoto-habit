import { StorageService } from './StorageService';
import { supabase } from '@/lib/supabase';

class SupabaseStorageServiceImpl implements StorageService {
    private static instance: SupabaseStorageServiceImpl;
    private bucketName = 'covers'; // Default bucket

    private constructor() { }

    public static getInstance(): SupabaseStorageServiceImpl {
        if (!SupabaseStorageServiceImpl.instance) {
            SupabaseStorageServiceImpl.instance = new SupabaseStorageServiceImpl();
        }
        return SupabaseStorageServiceImpl.instance;
    }

    async uploadFile(path: string, file: File | Blob): Promise<{ path: string | null; error: any }> {
        if (!supabase) {
            return { path: null, error: new Error('Supabase client not initialized') };
        }
        const { data, error } = await supabase.storage
            .from(this.bucketName)
            .upload(path, file, {
                upsert: true
            });

        if (error) return { path: null, error };
        return { path: data.path, error: null };
    }

    getPublicUrl(path: string): string {
        // If the path is already a full URL (e.g. Google Books), return it as is
        if (path.startsWith('http')) {
            return path;
        }

        // If supabase is not initialized, return empty string
        if (!supabase) {
            console.warn('Supabase client not initialized, cannot generate public URL');
            return '';
        }

        // Otherwise, generate the Supabase Storage public URL
        const { data } = supabase.storage
            .from(this.bucketName)
            .getPublicUrl(path);

        return data.publicUrl;
    }
}

export const storageService = SupabaseStorageServiceImpl.getInstance();
