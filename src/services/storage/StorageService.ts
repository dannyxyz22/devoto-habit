export interface StorageService {
    /**
     * Upload a file to storage
     * @param path The path where the file should be stored
     * @param file The file to upload
     */
    uploadFile(path: string, file: File | Blob): Promise<{ path: string | null; error: any }>;

    /**
     * Get the public URL for a file
     * @param path The path of the file
     */
    getPublicUrl(path: string): string;
}
