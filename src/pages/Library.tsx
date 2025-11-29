import { dataLayer } from "@/services/data/RxDBDataLayer";
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ensureHttps } from "@/lib/utils";
import { BackLink } from "@/components/app/BackLink";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BOOKS, type BookMeta } from "@/lib/books";
import { SEO } from "@/components/app/SEO";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { setReadingPlan, getProgress, getReadingPlan, setDailyBaseline, setProgress, getDailyBaseline } from "@/lib/storage";
import { toast } from "@/hooks/use-toast";
import { formatISO } from "date-fns";
import { resolveEpubSource } from "@/lib/utils";
import ePub from "epubjs";
import { getCoverObjectUrl, saveCoverBlob } from "@/lib/coverCache";
import { saveUserEpub, getUserEpubs, deleteUserEpub, reUploadEpub } from "@/lib/userEpubs";
import { getDatabase } from "@/lib/database/db";
import { BookSearchDialog } from "@/components/app/BookSearchDialog";
import { Upload, Trash2, BookPlus, AlertCircle, X } from "lucide-react";
import { BookCover } from "@/components/book/BookCover";

type Paragraph = { type: string; content: string };
type Chapter = { chapter_title: string; content: Paragraph[] };
type Part = { part_title: string; chapters: Chapter[] };

const Library = () => {
  const Cover = ({ src, alt }: { src: string; alt: string }) => (
    <div className="overflow-hidden rounded-t-lg h-56 md:h-64 lg:h-72 bg-muted">
      <img src={ensureHttps(src)} alt={alt} className="w-full h-full object-contain object-center" loading="lazy" />
    </div>
  );
  const [open, setOpen] = useState(false);
  const [selectedBook, setSelectedBook] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string>("");
  const [currentPosition, setCurrentPosition] = useState<string>("0-0");
  const [targetChapter, setTargetChapter] = useState<string>("end");
  const [bookParts, setBookParts] = useState<Part[] | null>(null);
  const [selectedIsEpub, setSelectedIsEpub] = useState<boolean>(false);
  const [selectedIsPhysical, setSelectedIsPhysical] = useState<boolean>(false);
  const [allBooks, setAllBooks] = useState<BookMeta[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [showBookSearch, setShowBookSearch] = useState(false);
  const [dismissedOverlays, setDismissedOverlays] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const today = new Date().toISOString().slice(0, 10);

  // Lazy EPUB cover loader: extracts the cover image from the EPUB and caches as Blob in Cache Storage
  const EpubCoverLoader = ({ id, title, sourceUrl }: { id: string; title: string; sourceUrl: string }) => {
    const [src, setSrc] = useState<string | null>(null);

    useEffect(() => {
      let cancelled = false;
      const run = async () => {
        try {
          // Try Cache Storage first
          const cachedUrl = await getCoverObjectUrl(id);
          if (cachedUrl) { setSrc(cachedUrl); return; }

          const url = resolveEpubSource(sourceUrl);
          let ab: ArrayBuffer | null = null;
          // Try Cache Storage for the EPUB file
          try {
            if ('caches' in window) {
              const cache = await caches.open('epub-cache-v1');
              const match = await cache.match(url);
              if (match && match.ok) ab = await match.arrayBuffer();
            }
          } catch { }
          if (!ab) {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            try {
              if ('caches' in window) {
                const cache = await caches.open('epub-cache-v1');
                await cache.put(url, resp.clone());
              }
            } catch { }
            ab = await resp.arrayBuffer();
          }
          if (cancelled || !ab) return;
          const book = ePub(ab);
          await book.ready;
          // Try epub.js coverUrl API first
          let coverUrl: string | null = null;
          try { coverUrl = await (book as any).coverUrl?.(); } catch { }
          // Fallback: derive from metadata/manifest and extract blob
          if (!coverUrl) {
            let href: string | null = null;
            try {
              const metadata = await (book as any).loaded?.metadata;
              href = metadata?.cover || null;
            } catch { }
            if (!href) {
              try {
                const manifest = await (book as any).loaded?.manifest;
                if (manifest) {
                  const items: any[] = Object.values(manifest);
                  const item = items.find((it) => it?.properties?.includes?.('cover-image'))
                    || items.find((it) => (it?.id || '').toLowerCase() === 'cover')
                    || items.find((it) => (it?.href || '').toLowerCase().includes('cover'));
                  href = item?.href || null;
                }
              } catch { }
            }
            if (href) {
              try {
                const blob = await (book as any).archive?.getBlob?.(href);
                if (blob) coverUrl = URL.createObjectURL(blob);
              } catch { }
            }
          }
          // Cache the cover blob for reuse
          if (coverUrl) {
            try {
              const blob = await (await fetch(coverUrl)).blob();
              await saveCoverBlob(id, blob);
              if (!cancelled) {
                const objUrl = URL.createObjectURL(blob);
                setSrc(objUrl);
              }
              try { URL.revokeObjectURL(coverUrl!); } catch { }
            } catch {
              if (!cancelled) setSrc(null);
            }
          }
        } catch {
          // Ignore failures; fallback to placeholder
        }
      };
      run();
      return () => { cancelled = true; };
    }, [id, sourceUrl]);

    return (
      <Cover
        src={src || "/placeholder.svg"}
        alt={`Capa do livro ${title}`}
      />
    );
  };

  // Reactive book loading
  useEffect(() => {
    let subscription: any;

    const setupSubscription = async () => {
      try {
        const db = await getDatabase();
        const { combineLatest } = await import('rxjs');

        const books$ = db.books.find({
          selector: { _deleted: false }
        }).$;

        const userEpubs$ = db.user_epubs.find({
          selector: { _deleted: false }
        }).$;

        subscription = combineLatest([books$, userEpubs$]).subscribe(async ([rxBooks, rxEpubs]) => {
          try {
            // 1. Process User EPUBs
            const userEpubsLocal = await getUserEpubs();
            const localEpubHashes = new Set(userEpubsLocal.map(e => e.fileHash));

            const userEpubBooks: BookMeta[] = rxEpubs.map(epub => {
              const epubData = epub.toJSON();
              const hasLocalFile = localEpubHashes.has(epubData.file_hash);
              const localEpub = userEpubsLocal.find(e => e.fileHash === epubData.file_hash);

              return {
                id: epubData.id,
                title: epubData.title,
                author: epubData.author || '',
                sourceUrl: hasLocalFile && localEpub ? URL.createObjectURL(localEpub.blob) : undefined,
                description: 'Uploaded by user',
                coverImage: hasLocalFile && localEpub ? localEpub.coverUrl : undefined,
                type: 'epub' as const,
                isUserUpload: true,
                addedDate: epubData.added_date,
                fileHash: epubData.file_hash,
                hasLocalFile,
                percentage: epubData.percentage || 0
              };
            });

            // 2. Process Physical Books from RxDB
            const physicalBooksMeta: BookMeta[] = rxBooks
              .filter(b => b.type === 'physical')
              .map(b => {
                const book = b.toJSON();
                return {
                  id: book.id,
                  title: book.title,
                  author: book.author || '',
                  description: '', // Physical books in DB currently don't store description
                  coverImage: book.cover_url,
                  type: 'physical' as const,
                  isPhysical: true,
                  totalPages: book.total_pages || 0,
                  currentPage: book.current_page || 0,
                  addedDate: book.added_date || new Date(book._modified).getTime(),
                  percentage: book.percentage || 0
                };
              });

            // 3. Process Static Books (merge with RxDB data)
            const staticBooksMeta: BookMeta[] = BOOKS.map(staticBook => {
              // Check if we have synced data for this static book
              const syncedBook = rxBooks.find(b => b.id === staticBook.id);
              if (syncedBook) {
                const syncedData = syncedBook.toJSON();
                return {
                  ...staticBook,
                  // Override with synced progress data
                  percentage: syncedData.percentage || 0,
                  // Keep static metadata (cover, description, sourceUrl) from BOOKS
                  // unless we want to allow overrides from DB in future
                };
              }
              return staticBook;
            });

            // 4. Merge and Sort
            const allUserBooks = [...userEpubBooks, ...physicalBooksMeta, ...staticBooksMeta]
              .sort((a, b) => (b.addedDate || 0) - (a.addedDate || 0));

            // Deduplicate by ID just in case
            const uniqueBooks = Array.from(new Map(allUserBooks.map(item => [item.id, item])).values());

            setAllBooks(uniqueBooks);
            console.log('[Library] Updated books list:', uniqueBooks.length);

          } catch (err) {
            console.error('[Library] Error processing book update:', err);
          }
        });
      } catch (err) {
        console.error('[Library] Error setting up subscription:', err);
      }
    };

    setupSubscription();

    return () => {
      if (subscription) subscription.unsubscribe();
    };
  }, []);

  // Handle EPUB file upload
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const userEpub = await saveUserEpub(file);

      // Add to books list
      const newBook: BookMeta = {
        id: userEpub.id,
        title: userEpub.title,
        author: userEpub.author,
        sourceUrl: URL.createObjectURL(userEpub.blob),
        description: 'Uploaded by user',
        coverImage: userEpub.coverUrl, // Use extracted cover
        type: 'epub',
        isUserUpload: true,
        addedDate: userEpub.addedDate,
        fileHash: userEpub.fileHash,
        hasLocalFile: true, // Explicitly mark as having local file
      };

      setAllBooks(prev => [newBook, ...prev]);

      toast({
        title: 'EPUB uploaded successfully',
        description: `${userEpub.title} by ${userEpub.author}`,
      });
    } catch (error) {
      console.error('Upload error:', error);
      toast({
        title: 'Upload failed',
        description: error instanceof Error ? error.message : 'Failed to upload EPUB',
        variant: 'destructive',
      });
    } finally {
      setIsUploading(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Handle delete user EPUB or physical book
  const handleDeleteBook = async (bookId: string) => {
    try {
      if (bookId.startsWith('user-')) {
        await deleteUserEpub(bookId);
      } else if (bookId.startsWith('physical-')) {
        await dataLayer.deleteBook(bookId);
      }
      setAllBooks(prev => prev.filter(book => book.id !== bookId));
      toast({
        title: 'Book deleted',
        description: 'The book has been removed from your library',
      });
    } catch (error) {
      console.error('Delete error:', error);
      toast({
        title: 'Delete failed',
        description: 'Failed to delete the book',
        variant: 'destructive',
      });
    }
  };

  // Reload books after adding a physical book
  const handleBookAdded = async () => {
    const userEpubs = await getUserEpubs();
    const rxdbBooks = await dataLayer.getBooks();
    // Separar livros físicos do RxDB
    const physicalBooks = rxdbBooks
      .filter(b => b.type === 'physical')
      .map(b => ({
        id: b.id,
        title: b.title,
        author: b.author || '',
        coverImage: b.cover_url,
        totalPages: b.total_pages || 0,
        currentPage: b.current_page || 0,
        addedDate: b.added_date || new Date(b._modified).getTime(),
        description: ''
      }));

    const userEpubBooks: BookMeta[] = userEpubs.map(epub => ({
      id: epub.id,
      title: epub.title,
      author: epub.author,
      sourceUrl: URL.createObjectURL(epub.blob),
      description: 'Uploaded by user',
      coverImage: epub.coverUrl,
      type: 'epub' as const,
      isUserUpload: true,
      addedDate: epub.addedDate,
    }));

    const physicalBooksMeta: BookMeta[] = physicalBooks.map(book => ({
      id: book.id,
      title: book.title,
      author: book.author,
      description: book.description || '',
      coverImage: book.coverImage,
      type: 'physical' as const,
      isPhysical: true,
      totalPages: book.totalPages,
      currentPage: book.currentPage,
      addedDate: book.addedDate,
    }));

    const allUserBooks = [...userEpubBooks, ...physicalBooksMeta]
      .sort((a, b) => (b.addedDate || 0) - (a.addedDate || 0));

    setAllBooks([...allUserBooks, ...BOOKS]);
  };

  const onChooseBook = async (bookId: string) => {
    setSelectedBook(bookId);
    const plan = getReadingPlan(bookId);
    setEndDate(plan.targetDateISO ?? "");
    // Default current position from saved progress or start
    const prog = getProgress(bookId);
    setCurrentPosition(`${prog.partIndex}-${prog.chapterIndex}`);

    // Set target chapter from plan
    if (plan.targetPartIndex !== undefined && plan.targetChapterIndex !== undefined) {
      setTargetChapter(`${plan.targetPartIndex}-${plan.targetChapterIndex}`);
    } else {
      setTargetChapter("end");
    }

    // Load book structure for chapter selection
    const book = allBooks.find(b => b.id === bookId);
    const isEpub = book?.type === 'epub';
    const isPhysical = book?.type === 'physical';

    setSelectedIsEpub(isEpub);
    setSelectedIsPhysical(isPhysical);

    if (book) {
      if (isEpub || isPhysical) {
        // EPUB/Physical: no JSON structure; skip fetch and open dialog with date only
        setBookParts(null);
        setOpen(true);
        return;
      } else {
        try {
          const cacheKey = `book:${bookId}`;
          const cached = localStorage.getItem(cacheKey);
          if (cached) {
            setBookParts(JSON.parse(cached));
          } else {
            const response = await fetch(book.sourceUrl!);
            const data = await response.json();
            setBookParts(data);
            localStorage.setItem(cacheKey, JSON.stringify(data));
          }
        } catch (error) {
          console.error("Failed to load book:", error);
        }
      }
    }

    setOpen(true);
  };

  const startReading = async (withPlan: boolean) => {
    if (!selectedBook) return;
    const meta = allBooks.find(b => b.id === selectedBook);

    if (selectedIsEpub || selectedIsPhysical || meta?.type === 'epub') {
      if (withPlan) {
        if (!endDate) {
          toast({ title: "Selecione uma data", description: "Escolha uma data de término ou comece sem meta." });
          return;
        }
        setReadingPlan(selectedBook, endDate);
        // Persist plan start percent from current saved progress
        try {
          const prog = getProgress(selectedBook);
          localStorage.setItem(
            `planStart:${selectedBook}`,
            JSON.stringify({ startPercent: prog?.percent || 0 })
          );
        } catch { }
      } else {
        setReadingPlan(selectedBook, null);
        // Don't initialize baseline here for EPUBs - let EpubReader do it when user actually starts reading
      }

      // Navigate based on type
      setOpen(false);
      if (selectedIsPhysical || meta?.type === 'physical') {
        navigate(`/physical/${selectedBook}`);
      } else {
        navigate(`/epub/${selectedBook}`);
      }
      return;
    }
    // Parse current position from selection
    let curPartIndex = 0;
    let curChapterIndex = 0;
    if (currentPosition && currentPosition.includes("-")) {
      const [pStr, cStr] = currentPosition.split("-");
      curPartIndex = Number(pStr) || 0;
      curChapterIndex = Number(cStr) || 0;
    }
    if (withPlan) {
      if (!endDate) {
        toast({ title: "Selecione uma data", description: "Escolha uma data de término ou comece sem meta." });
        return;
      }

      // Parse target chapter
      let targetPartIndex: number | undefined;
      let targetChapterIndex: number | undefined;

      if (targetChapter !== "end") {
        const [partIdx, chapterIdx] = targetChapter.split("-").map(Number);
        targetPartIndex = partIdx;
        targetChapterIndex = chapterIdx;
      }

      setReadingPlan(selectedBook, endDate, targetPartIndex, targetChapterIndex);

      // Set progress to chosen current position and reset daily baseline accordingly
      if (bookParts) {
        // Compute percent based on flat chapters
        const flat: Array<{ pi: number; ci: number }> = [];
        bookParts.forEach((part, pi) => part.chapters.forEach((_, ci) => flat.push({ pi, ci })));
        const idx = flat.findIndex((x) => x.pi === curPartIndex && x.ci === curChapterIndex);
        const percent = idx >= 0 ? Math.round(((idx + 1) / flat.length) * 100) : 0;
        setProgress(selectedBook, { partIndex: curPartIndex, chapterIndex: curChapterIndex, percent });
        // Compute baseline words up to current position
        let wordsUpToCurrent = 0;
        bookParts.forEach((part, pi) => {
          part.chapters.forEach((ch, ci) => {
            if (pi < curPartIndex || (pi === curPartIndex && ci < curChapterIndex)) {
              ch.content?.forEach((blk) => {
                wordsUpToCurrent += blk.content.trim().split(/\s+/).filter(Boolean).length;
              });
            }
          });
        });
        const todayISO = formatISO(new Date(), { representation: "date" });
        setDailyBaseline(selectedBook, todayISO, { words: wordsUpToCurrent, percent });
        try { console.log('[Baseline] persistida', { scope: 'Library', bookId: selectedBook, todayISO, words: wordsUpToCurrent, percent }); } catch { }
        // Persist plan start for plan progress calculations (start indexes and words)
        try {
          localStorage.setItem(
            `planStart:${selectedBook}`,
            JSON.stringify({ startPartIndex: curPartIndex, startChapterIndex: curChapterIndex, startWords: wordsUpToCurrent })
          );
        } catch { }
      }
    } else {
      setReadingPlan(selectedBook, null);
      // Also set progress to chosen current position when starting without plan
      if (bookParts) {
        const flat: Array<{ pi: number; ci: number }> = [];
        bookParts.forEach((part, pi) => part.chapters.forEach((_, ci) => flat.push({ pi, ci })));
        const idx = flat.findIndex((x) => x.pi === curPartIndex && x.ci === curChapterIndex);
        const percent = idx >= 0 ? Math.round(((idx + 1) / flat.length) * 100) : 0;
        setProgress(selectedBook, { partIndex: curPartIndex, chapterIndex: curChapterIndex, percent });
        let wordsUpToCurrent = 0;
        bookParts.forEach((part, pi) => {
          part.chapters.forEach((ch, ci) => {
            if (pi < curPartIndex || (pi === curPartIndex && ci < curChapterIndex)) {
              ch.content?.forEach((blk) => {
                wordsUpToCurrent += blk.content.trim().split(/\s+/).filter(Boolean).length;
              });
            }
          });
        });
        const todayISO = formatISO(new Date(), { representation: "date" });
        setDailyBaseline(selectedBook, todayISO, { words: wordsUpToCurrent, percent });
        try { console.log('[Baseline] persistida', { scope: 'Library', bookId: selectedBook, todayISO, words: wordsUpToCurrent, percent }); } catch { }
      }
    }
    setOpen(false);
    navigate(selectedIsEpub ? `/epub/${selectedBook}` : `/leitor/${selectedBook}`);
  };

  return (
    <main className="min-h-screen bg-background py-10">
      <SEO
        title="Biblioteca Católica — Leitura Devota"
        description="Escolha um clássico católico em português e comece sua leitura devocional."
        canonical="/biblioteca"
      />
      <div className="container mx-auto">
        <nav className="mb-4 text-sm">
          <BackLink to="/" label="Início" className="text-muted-foreground hover:text-foreground" />
        </nav>
        <h1 className="text-3xl font-bold mb-6 text-foreground">Biblioteca</h1>
      </div>
      <div className="container mx-auto mb-6">
        <input
          ref={fileInputRef}
          type="file"
          accept=".epub"
          onChange={handleFileUpload}
          className="hidden"
        />
        <div className="flex gap-2">
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading}
            className=""
          >
            <Upload className="h-4 w-4 mr-2" />
            {isUploading ? 'Uploading...' : 'Upload EPUB'}
          </Button>
          <Button
            onClick={() => setShowBookSearch(true)}
            variant="outline"
            className=""
          >
            <BookPlus className="h-4 w-4 mr-2" />
            Adicionar livro físico
          </Button>
        </div>
      </div>

      <BookSearchDialog
        open={showBookSearch}
        onOpenChange={setShowBookSearch}
        onBookAdded={handleBookAdded}
      />
      <section className="container mx-auto grid md:grid-cols-2 gap-6">
        {allBooks.map((book) => (
          <Card key={book.id} className="hover:shadow-lg transition-shadow">
            <div
              role="button"
              tabIndex={0}
              onClick={() => {
                if (book.isPhysical) {
                  navigate(`/physical/${book.id}`);
                } else {
                  navigate(book.type === 'epub' ? `/epub/${book.id}` : `/leitor/${book.id}`);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (book.isPhysical) {
                    navigate(`/physical/${book.id}`);
                  } else {
                    navigate(book.type === 'epub' ? `/epub/${book.id}` : `/leitor/${book.id}`);
                  }
                }
              }}
              className="cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2"
            >
              {book.coverImage ? (
                <Cover
                  src={book.coverImage}
                  alt={`Capa do livro ${book.title}`}
                />
              ) : book.type === 'epub' ? (
                <EpubCoverLoader id={book.id} title={book.title} sourceUrl={book.sourceUrl!} />
              ) : null}
            </div>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>{book.title}</span>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">{book.author}</span>
                  {(book.isUserUpload || book.isPhysical) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteBook(book.id);
                      }}
                      className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                      title="Delete book"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground mb-4">{book.description}</p>

              {/* EPUB not available locally message */}
              {book.type === 'epub' && book.isUserUpload && !book.hasLocalFile && (
                <div className="mb-4 p-3 bg-muted rounded-lg flex items-start gap-2">
                  <AlertCircle className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-muted-foreground">EPUB não disponível localmente</p>
                    <p className="text-xs text-muted-foreground mt-0.5">Faça upload para ler neste dispositivo</p>
                  </div>
                </div>
              )}

              {book.isPhysical && book.totalPages && (
                <div className="mb-4">
                  <div className="flex justify-between text-sm text-muted-foreground mb-1">
                    <span>Progresso</span>
                    <span>{book.currentPage || 0} / {book.totalPages} páginas</span>
                  </div>
                  <div className="w-full bg-secondary rounded-full h-2">
                    <div
                      className="bg-primary h-2 rounded-full transition-all"
                      style={{ width: `${Math.round(((book.currentPage || 0) / book.totalPages) * 100)}%` }}
                    />
                  </div>
                </div>
              )}
              {book.type === 'epub' && (() => {
                // Use percentage from RxDB (book.percentage) or fallback to local storage
                const percent = book.percentage !== undefined ? book.percentage : getProgress(book.id).percent;

                return percent > 0 ? (
                  <div className="mb-4">
                    <div className="flex justify-between text-sm text-muted-foreground mb-1">
                      <span>Progresso</span>
                      <span>{Math.round(percent)}%</span>
                    </div>
                    <div className="w-full bg-secondary rounded-full h-2">
                      <div
                        className="bg-primary h-2 rounded-full transition-all"
                        style={{ width: `${percent}%` }}
                      />
                    </div>
                  </div>
                ) : null;
              })()}
              <div className="flex items-center gap-2 flex-wrap">
                {/* Upload EPUB button for missing files */}
                {book.type === 'epub' && book.isUserUpload && !book.hasLocalFile && (
                  <Button
                    variant="default"
                    onClick={async (e) => {
                      e.stopPropagation();
                      const input = document.createElement('input');
                      input.type = 'file';
                      input.accept = '.epub';
                      input.onchange = async (uploadEvent) => {
                        const uploadedFile = (uploadEvent.target as HTMLInputElement).files?.[0];
                        if (!uploadedFile) return;

                        try {
                          await reUploadEpub(book.fileHash!, uploadedFile);

                          // Reload books to update UI
                          const rxdb = await getDatabase();
                          const epubMetadata = await rxdb.user_epubs.find({
                            selector: { _deleted: false }
                          }).exec();
                          const userEpubs = await getUserEpubs();
                          const localEpubHashes = new Set(userEpubs.map(e => e.fileHash));

                          const userEpubBooks: BookMeta[] = epubMetadata.map(epub => {
                            const epubData = epub.toJSON();
                            const hasLocalFile = localEpubHashes.has(epubData.file_hash);
                            const localEpub = userEpubs.find(e => e.fileHash === epubData.file_hash);

                            return {
                              id: epubData.id,
                              title: epubData.title,
                              author: epubData.author || '',
                              sourceUrl: hasLocalFile && localEpub ? URL.createObjectURL(localEpub.blob) : undefined,
                              description: 'Uploaded by user',
                              coverImage: hasLocalFile && localEpub ? localEpub.coverUrl : undefined,
                              type: 'epub' as const,
                              isUserUpload: true,
                              addedDate: epubData.added_date,
                              fileHash: epubData.file_hash,
                              hasLocalFile
                            };
                          });

                          const rxdbBooks = await dataLayer.getBooks();
                          const physicalBooks = rxdbBooks
                            .filter(b => b.type === 'physical')
                            .map(b => ({
                              id: b.id,
                              title: b.title,
                              author: b.author || '',
                              coverImage: b.cover_url,
                              totalPages: b.total_pages || 0,
                              currentPage: b.current_page || 0,
                              addedDate: b.added_date || new Date(b._modified).getTime(),
                              description: ''
                            }));

                          const physicalBooksMeta: BookMeta[] = physicalBooks.map(book => ({
                            id: book.id,
                            title: book.title,
                            author: book.author,
                            description: book.description || '',
                            coverImage: book.coverImage,
                            type: 'physical' as const,
                            isPhysical: true,
                            totalPages: book.totalPages,
                            currentPage: book.currentPage,
                            addedDate: book.addedDate,
                          }));

                          const allUserBooks = [...userEpubBooks, ...physicalBooksMeta]
                            .sort((a, b) => (b.addedDate || 0) - (a.addedDate || 0));

                          setAllBooks([...allUserBooks, ...BOOKS]);

                          toast({
                            title: 'EPUB carregado com sucesso',
                            description: `${book.title} está disponível novamente neste dispositivo`,
                          });
                        } catch (error) {
                          console.error('Re-upload error:', error);
                          toast({
                            title: 'Falha no upload',
                            description: error instanceof Error ? error.message : 'Falha ao fazer upload do EPUB',
                            variant: 'destructive',
                          });
                        }
                      };
                      input.click();
                    }}
                  >
                    <Upload className="h-4 w-4 mr-2" />
                    Fazer upload do EPUB
                  </Button>
                )}

                {/* Reading and goal buttons - disabled when EPUB is not available */}
                <Button
                  onClick={() => {
                    if (book.isPhysical) {
                      navigate(`/physical/${book.id}`);
                    } else {
                      navigate(book.type === 'epub' ? `/epub/${book.id}` : `/leitor/${book.id}`);
                    }
                  }}
                  disabled={book.type === 'epub' && book.isUserUpload && !book.hasLocalFile}
                >
                  Continuar leitura
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => onChooseBook(book.id)}
                  disabled={book.type === 'epub' && book.isUserUpload && !book.hasLocalFile}
                >
                  Definir meta
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </section>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Definir meta de término (opcional)</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {!selectedIsEpub && !selectedIsPhysical && (
              <>
                <div>
                  <label htmlFor="currentPosition" className="text-sm font-medium">Posição atual</label>
                  <Select value={currentPosition} onValueChange={setCurrentPosition}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione seu ponto atual" />
                    </SelectTrigger>
                    <SelectContent>
                      {bookParts?.map((part, partIndex) =>
                        part.chapters.map((chapter, chapterIndex) => (
                          <SelectItem key={`cur-${partIndex}-${chapterIndex}`} value={`${partIndex}-${chapterIndex}`}>
                            {part.part_title} - {chapter.chapter_title}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label htmlFor="targetChapter" className="text-sm font-medium">Meta de leitura</label>
                  <Select value={targetChapter} onValueChange={setTargetChapter}>
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione até onde quer ler" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="end">Final do livro</SelectItem>
                      {bookParts?.map((part, partIndex) =>
                        part.chapters.map((chapter, chapterIndex) => (
                          <SelectItem key={`${partIndex}-${chapterIndex}`} value={`${partIndex}-${chapterIndex}`}>
                            {part.part_title} - {chapter.chapter_title}
                          </SelectItem>
                        ))
                      )}
                    </SelectContent>
                  </Select>
                </div>
              </>
            )}

            <div>
              <label htmlFor="endDate" className="text-sm font-medium">Data para concluir a leitura</label>
              <Input
                id="endDate"
                type="date"
                min={today}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>

            <p className="text-xs text-muted-foreground">
              {selectedIsEpub
                ? "Defina uma data para concluir o EPUB. Calcularemos metas diárias em porcentagem lida."
                : selectedIsPhysical
                  ? "Defina uma data para concluir o livro. Calcularemos metas diárias em páginas."
                  : "Defina uma meta específica e uma data. Calcularemos uma meta diária a partir do seu ponto atual de leitura."}
            </p>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => startReading(false)}>Começar sem meta</Button>
            <Button onClick={() => startReading(true)}>Definir meta e começar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
};

export default Library;
