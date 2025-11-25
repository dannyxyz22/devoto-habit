import { useState, useEffect } from 'react';
import { getCoverObjectUrl, saveCoverBlob } from '@/lib/coverCache';

/**
 * Custom hook to manage book cover images with local caching
 * 
 * @param bookId - Unique identifier for the book
 * @param coverUrl - External URL or base64 data URL for the cover
 * @returns The cover image URL to display (from cache or freshly loaded)
 * 
 * How it works:
 * 1. First checks local cache for the cover
 * 2. If not cached and coverUrl is external (http/https), downloads and caches it
 * 3. If coverUrl is base64, uses it directly (won't be cached or synced)
 */
export function useCoverImage(bookId: string | undefined, coverUrl: string | undefined | null): string | null {
    const [imageSrc, setImageSrc] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);

    useEffect(() => {
        if (!bookId) {
            setImageSrc(null);
            return;
        }

        let isMounted = true;

        async function loadCover() {
            setIsLoading(true);

            try {
                // Step 1: Check cache first
                const cachedUrl = await getCoverObjectUrl(bookId);
                if (cachedUrl && isMounted) {
                    setImageSrc(cachedUrl);
                    setIsLoading(false);
                    return;
                }

                // Step 2: If no cache, check if we have a cover URL
                if (!coverUrl) {
                    if (isMounted) {
                        setImageSrc(null);
                        setIsLoading(false);
                    }
                    return;
                }

                // Step 3: If it's a base64 data URL, use it directly (don't cache)
                if (coverUrl.startsWith('data:')) {
                    if (isMounted) {
                        setImageSrc(coverUrl);
                        setIsLoading(false);
                    }
                    return;
                }

                // Step 4: It's an external URL - download and cache it
                try {
                    // Use weserv.nl proxy to bypass CORS for external images
                    // Convert http to https for weserv compatibility
                    const secureUrl = coverUrl.replace(/^http:/, 'https:');
                    const proxyUrl = `https://images.weserv.nl/?url=${encodeURIComponent(secureUrl)}`;

                    const response = await fetch(proxyUrl);
                    if (!response.ok) throw new Error('Failed to fetch cover');

                    const blob = await response.blob();

                    // Save to cache for future use
                    await saveCoverBlob(bookId, blob);

                    // Create object URL for display
                    const objectUrl = URL.createObjectURL(blob);

                    if (isMounted) {
                        setImageSrc(objectUrl);
                        setIsLoading(false);
                    }
                } catch (error) {
                    console.error('Failed to load cover image:', error);
                    if (isMounted) {
                        // Fallback to original URL if download fails
                        setImageSrc(coverUrl);
                        setIsLoading(false);
                    }
                }
            } catch (error) {
                console.error('Error in useCoverImage:', error);
                if (isMounted) {
                    setImageSrc(null);
                    setIsLoading(false);
                }
            }
        }

        loadCover();

        return () => {
            isMounted = false;
            // Clean up object URLs to prevent memory leaks
            if (imageSrc && imageSrc.startsWith('blob:')) {
                URL.revokeObjectURL(imageSrc);
            }
        };
    }, [bookId, coverUrl]);

    return imageSrc;
}
