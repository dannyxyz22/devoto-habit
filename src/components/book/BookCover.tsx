import { useCoverImage } from '@/hooks/useCoverImage';
import { BookOpen } from 'lucide-react';

interface BookCoverProps {
    bookId: string;
    coverUrl?: string | null;
    title: string;
    className?: string;
}

/**
 * BookCover component with automatic caching
 * 
 * Features:
 * - Automatically caches external cover URLs locally
 * - Handles base64 data URLs without caching
 * - Shows fallback icon when no cover is available
 * - Cleans up object URLs to prevent memory leaks
 */
export function BookCover({ bookId, coverUrl, title, className = '' }: BookCoverProps) {
    const cachedCoverSrc = useCoverImage(bookId, coverUrl);

    if (!cachedCoverSrc) {
        return (
            <div className={`flex items-center justify-center bg-gradient-to-br from-purple-100 to-pink-100 ${className}`}>
                <BookOpen className="w-12 h-12 text-purple-400" />
            </div>
        );
    }

    return (
        <img
            src={cachedCoverSrc}
            alt={`Capa de ${title}`}
            className={`object-cover ${className}`}
            loading="lazy"
        />
    );
}
