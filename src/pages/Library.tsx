import { dataLayer } from "@/services/data/RxDBDataLayer";
import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ensureHttps } from "@/lib/utils";
import { BackLink } from "@/components/app/BackLink";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BOOKS, type BookMeta } from "@/lib/books";
import { SEO } from "@/components/app/SEO";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getProgress, getReadingPlan, getDailyBaseline, setLastBookId, getLastBookIdAsync } from "@/lib/storage";
import { toast } from "@/hooks/use-toast";
import { resolveEpubSource } from "@/lib/utils";
import ePub from "epubjs";
import { getCoverObjectUrl, saveCoverBlob } from "@/lib/coverCache";
import { saveUserEpub, getUserEpubs, deleteUserEpub, reUploadEpub } from "@/lib/userEpubs";
import { getDatabase } from "@/lib/database/db";
import { BookSearchDialog } from "@/components/app/BookSearchDialog";
import { Upload, Trash2, BookPlus, AlertCircle, Bookmark } from "lucide-react";
import { BookCover } from "@/components/book/BookCover";
import { calculatePagePercent } from "@/lib/percentageUtils";

const Library = () => {
  const Cover = ({ src, alt }: { src: string; alt: string }) => (
    <div className="overflow-hidden rounded-t-lg h-56 md:h-64 lg:h-72 bg-muted">
      <img src={ensureHttps(src)} alt={alt} className="w-full h-full object-contain object-center" loading="lazy" />
    </div>
  );
  const [allBooks, setAllBooks] = useState<BookMeta[]>([]);
  const [activeBookId, setActiveBookId] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [showBookSearch, setShowBookSearch] = useState(false);
  const [dismissedOverlays, setDismissedOverlays] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const today = new Date().toISOString().slice(0, 10);

  const [sortBy, setSortBy] = useState<'date' | 'title'>('date');

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

  // Cached cover loader: loads from Cache Storage first, falls back to coverUrl
  const CachedCoverLoader = ({ id, title, coverUrl }: { id: string; title: string; coverUrl?: string | null }) => {
    const [src, setSrc] = useState<string | null>(null);

    useEffect(() => {
      let cancelled = false;
      const run = async () => {
        try {
          // Try Cache Storage first - this should have the cover if already cached
          const cachedUrl = await getCoverObjectUrl(id);
          if (cachedUrl) {
            if (!cancelled) setSrc(cachedUrl);
            return; // Found in cache, no need to fetch
          }

          // No cache found - only fetch if we have a coverUrl
          // Use a CORS proxy for external URLs to avoid CORS errors
          if (coverUrl && !cancelled) {
            if (coverUrl.startsWith('data:')) {
              // Base64 data URL - use directly
              setSrc(coverUrl);
              return;
            }

            if (coverUrl.startsWith('http')) {
              // Use weserv.nl proxy to bypass CORS
              const proxyUrl = `https://images.weserv.nl/?url=${encodeURIComponent(coverUrl)}&w=300&q=80`;
              try {
                const resp = await fetch(proxyUrl);
                if (resp.ok) {
                  const blob = await resp.blob();
                  await saveCoverBlob(id, blob);
                  if (!cancelled) setSrc(URL.createObjectURL(blob));
                  return;
                }
              } catch { /* ignore proxy errors */ }
            }
          }
        } catch { /* ignore */ }
      };
      run();
      return () => { cancelled = true; };
    }, [id, coverUrl]);

    return (
      <Cover
        src={src || "/placeholder.png"}
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

        const readingPlans$ = db.reading_plans.find({
          selector: { _deleted: false }
        }).$;

        subscription = combineLatest([books$, userEpubs$, readingPlans$]).subscribe(async ([rxBooks, rxEpubs, rxPlans]) => {
          try {
            // Build map of book_id -> target_date_iso from reading plans
            // Only include plans that are not deleted and have a valid target_date_iso
            const plansMap = new Map<string, string>();
            rxPlans.forEach(plan => {
              const planData = plan.toJSON();
              const targetDateISO = planData.target_date_iso;
              // Only include if not deleted, has a target_date_iso, and it's a valid non-empty string
              if (!planData._deleted && targetDateISO && typeof targetDateISO === 'string' && targetDateISO.trim() !== '') {
                // Validate the date format (should be YYYY-MM-DD)
                if (/^\d{4}-\d{2}-\d{2}$/.test(targetDateISO)) {
                  plansMap.set(planData.book_id, targetDateISO);
                } else {
                  console.warn('[Library] Invalid date format in plan:', { book_id: planData.book_id, target_date_iso: targetDateISO });
                }
              }
            });

            // 1. Process User EPUBs
            const userEpubsLocal = await getUserEpubs();
            const localEpubHashes = new Set(userEpubsLocal.map(e => e.fileHash));

            const userEpubBooks: (BookMeta & { targetDateISO?: string | null })[] = rxEpubs.map(epub => {
              const epubData = epub.toJSON();
              const hasLocalFile = localEpubHashes.has(epubData.file_hash);
              const localEpub = userEpubsLocal.find(e => e.fileHash === epubData.file_hash);

              return {
                id: epubData.id,
                title: epubData.title,
                author: epubData.author || '',
                sourceUrl: hasLocalFile && localEpub ? URL.createObjectURL(localEpub.blob) : undefined,
                description: 'Adicionado pelo usuário',
                coverImage: hasLocalFile && localEpub ? localEpub.coverUrl : undefined,
                type: 'epub' as const,
                isUserUpload: true,
                addedDate: epubData.added_date,
                fileHash: epubData.file_hash,
                hasLocalFile,
                percentage: epubData.percentage || 0,
                targetDateISO: plansMap.get(epubData.id) ?? null
              };
            });

            // 2. Process Physical Books from RxDB
            const physicalBooksMeta: (BookMeta & { targetDateISO?: string | null })[] = rxBooks
              .filter(b => b.type === 'physical')
              .map(b => {
                const book = b.toJSON();
                console.log('[Library] Physical book:', book, ' current page:', book.current_page);
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
                  percentage: book.percentage || 0,
                  targetDateISO: plansMap.get(book.id) ?? null
                };
              });

            // 3. Process Static Books (merge with RxDB data)
            const staticBooksMeta: (BookMeta & { targetDateISO?: string | null })[] = BOOKS.map(staticBook => {
              // Check if we have synced data for this static book
              const syncedBook = rxBooks.find(b => b.id === staticBook.id);
              if (syncedBook) {
                const syncedData = syncedBook.toJSON();
                return {
                  ...staticBook,
                  // Override with synced progress data
                  percentage: syncedData.percentage || 0,
                  targetDateISO: plansMap.get(staticBook.id) ?? null
                  // Keep static metadata (cover, description, sourceUrl) from BOOKS
                  // unless we want to allow overrides from DB in future
                };
              }
              return {
                ...staticBook,
                targetDateISO: plansMap.get(staticBook.id) ?? null
              };
            });

            // 4. Merge
            const allUserBooks = [...userEpubBooks, ...physicalBooksMeta, ...staticBooksMeta];

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

  // Auto-sync on page load as fallback when Realtime is not available
  useEffect(() => {
    const autoSync = async () => {
      try {
        const { replicationManager } = await import('@/lib/database/replication');
        // Small delay to let the page render first
        await new Promise(resolve => setTimeout(resolve, 500));
        await replicationManager.quickSync();
        console.log('[Library] Auto-sync completed on page load');
      } catch (err) {
        console.warn('[Library] Auto-sync failed (non-critical):', err);
      }
    };

    autoSync();
  }, []);

  // Load active book ID
  useEffect(() => {
    const loadActiveBook = async () => {
      // Try local storage first for speed
      const local = localStorage.getItem('lastBookId');
      if (local) setActiveBookId(local);

      // Then try async storage (RxDB)
      const id = await getLastBookIdAsync();
      if (id) setActiveBookId(id);
    };
    loadActiveBook();
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

    const allUserBooks = [...userEpubBooks, ...physicalBooksMeta];

    setAllBooks([...allUserBooks, ...BOOKS]);
  };

  const sortedBooks = [...allBooks].sort((a, b) => {
    // Active book always comes first
    if (a.id === activeBookId) return -1;
    if (b.id === activeBookId) return 1;

    if (sortBy === 'date') {
      return (b.addedDate || 0) - (a.addedDate || 0);
    } else {
      return a.title.localeCompare(b.title);
    }
  });

  return (
    <main className="min-h-screen bg-background py-10">
      <SEO
        title="Biblioteca Católica — Leitura Devota"
        description="Escolha um clássico católico em português e comece sua leitura devocional."
        canonical="/biblioteca"
      />
      <div className="container mx-auto px-4">
        <nav className="mb-4 text-sm">
          <BackLink to="/" label="Início" className="text-muted-foreground hover:text-foreground" />
        </nav>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <h1 className="text-3xl font-bold text-foreground">Biblioteca</h1>
          <div className="flex items-center gap-2">
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as 'date' | 'title')}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Ordenar por" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="date">Data de adição</SelectItem>
                <SelectItem value="title">Alfabética</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
      <div className="container mx-auto mb-6 px-4">
        <input
          ref={fileInputRef}
          type="file"
          accept=".epub"
          onChange={handleFileUpload}
          className="hidden"
        />
        <div className="flex gap-2 flex-wrap">
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
          <Button
            onClick={async () => {
              try {
                // Check if user is logged in first
                const { authService } = await import('@/services/auth/SupabaseAuthService');
                const { user } = await authService.getUser();

                if (!user) {
                  toast({
                    title: 'Login necessário',
                    description: 'Faça login para sincronizar seus dados',
                  });
                  navigate('/login');
                  return;
                }

                const { replicationManager } = await import('@/lib/database/replication');
                toast({
                  title: 'Sincronizando...',
                });
                await replicationManager.quickSync();
                // RxDB subscription will automatically update the UI when data changes
                toast({
                  title: 'Sincronizado!',
                });
              } catch (error) {
                toast({
                  title: 'Erro no sync',
                  description: error instanceof Error ? error.message : 'Erro desconhecido',
                  variant: 'destructive',
                });
              }
            }}
            variant="outline"
            size="sm"
          >
            🔄 Atualizar
          </Button>
        </div>
      </div>

      <BookSearchDialog
        open={showBookSearch}
        onOpenChange={setShowBookSearch}
        onBookAdded={handleBookAdded}
      />
      <section className="container mx-auto grid grid-cols-1 md:grid-cols-2 gap-6 px-4 md:px-0">
        {!allBooks.some(b => b.isUserUpload || b.isPhysical) && (
          <Card className="bg-primary/5 border-dashed border-primary/20 col-span-1 md:col-span-2">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-primary">
                <BookPlus className="h-5 w-5" />
                Comece sua Biblioteca Pessoal
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground mb-4">
                Sua biblioteca pessoal está vazia. Você pode adicionar seus próprios arquivos EPUB ou rastrear o progresso de livros físicos da sua estante.
              </p>
              <div className="flex gap-3 flex-wrap">
                <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="h-4 w-4 mr-2" />
                  Subir EPUB
                </Button>
                <Button variant="outline" size="sm" onClick={() => setShowBookSearch(true)}>
                  <BookPlus className="h-4 w-4 mr-2" />
                  Livro Físico
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
        {sortedBooks.map((book) => (
          <Card key={book.id} className="hover:shadow-lg transition-shadow">
            <div
              role="button"
              tabIndex={0}
              onClick={() => {
                // Check if EPUB is not available locally
                if (book.type === 'epub' && book.isUserUpload && !book.hasLocalFile) {
                  toast({
                    title: 'EPUB não disponível',
                    description: 'Faça o upload para ler neste dispositivo',
                  });
                  return;
                }

                // Navigate to unified book details page
                navigate(`/book/${book.id}`);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();

                  // Check if EPUB is not available locally
                  if (book.type === 'epub' && book.isUserUpload && !book.hasLocalFile) {
                    toast({
                      title: 'EPUB não disponível',
                      description: 'Faça o upload para ler neste dispositivo',
                    });
                    return;
                  }

                  // Navigate to unified book details page
                  navigate(`/book/${book.id}`);
                }
              }}
              className="cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2"
            >
              {book.isPhysical || book.isUserUpload ? (
                <CachedCoverLoader id={book.id} title={book.title} coverUrl={book.coverImage} />
              ) : book.coverImage ? (
                <Cover
                  src={book.coverImage}
                  alt={`Capa do livro ${book.title}`}
                />
              ) : book.type === 'epub' ? (
                <EpubCoverLoader id={book.id} title={book.title} sourceUrl={book.sourceUrl!} />
              ) : null}
            </div>
            <CardHeader>
              {book.id === activeBookId && (
                <div className="flex items-center gap-1 bg-primary/10 text-primary text-xs px-2 py-1 rounded-full w-fit mb-2">
                  <Bookmark className="h-3 w-3 fill-current" />
                  <span>Lendo agora</span>
                </div>
              )}
              <CardTitle className="flex items-center justify-between">
                <span>{book.title}</span>
                <div className="flex items-center gap-2">
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
              {book.author && (
                <p className="text-sm text-muted-foreground">{book.author}</p>
              )}
              {book.addedDate && (
                <p className="text-xs text-muted-foreground mt-1">
                  Adicionado em: {new Date(book.addedDate).toLocaleDateString()}
                </p>
              )}
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
                    <span className="flex gap-1">
                      <span className="font-medium text-foreground">
                        {calculatePagePercent(book.currentPage || 0, book.totalPages, { round: false }).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
                      </span>
                      <span>
                        ({book.currentPage || 0} / {book.totalPages})
                      </span>
                    </span>
                  </div>
                  <div className="w-full bg-secondary rounded-full h-2">
                    <div
                      className="bg-primary h-2 rounded-full transition-all"
                      style={{ width: `${calculatePagePercent(book.currentPage || 0, book.totalPages, { round: false })}%` }}
                    />
                  </div>
                </div>
              )}
              {book.type === 'epub' && (() => {
                const dbProgress = book.percentage || 0;
                const localProgress = getProgress(book.id).percent || 0;
                // Trust DB progress (it's reactive); if 0, fallback to local storage
                const percent = dbProgress || localProgress;

                return percent > 0 ? (
                  <div className="mb-4">
                    <div className="flex justify-between text-sm text-muted-foreground mb-1">
                      <span>Progresso</span>
                      <span>{percent.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</span>
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
                    // Save as current book before navigating
                    setLastBookId(book.id);
                    // Navigate to unified book details page
                    navigate(`/book/${book.id}`);
                  }}
                  disabled={book.type === 'epub' && book.isUserUpload && !book.hasLocalFile}
                >
                  Detalhes
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </section>

      {/* Delete local data button at the bottom */}
      <div className="container mx-auto mt-12 mb-8 flex justify-center">
        <Button
          onClick={async () => {
            if (!confirm('⚠️ Isso vai DELETAR o banco local e baixar tudo do Supabase. Continuar?')) {
              return;
            }

            try {
              toast({
                title: 'Deletando banco local...',
                description: 'Aguarde, isso vai recarregar a página',
              });

              // Delete IndexedDB databases
              const dbs = await indexedDB.databases();
              console.log('🗑️ Found databases:', dbs);

              for (const db of dbs) {
                if (db.name?.includes('devoto')) {
                  console.log('🗑️ Deleting:', db.name);
                  await new Promise((resolve, reject) => {
                    const req = indexedDB.deleteDatabase(db.name!);
                    req.onsuccess = () => resolve(undefined);
                    req.onerror = () => reject(req.error);
                    req.onblocked = () => {
                      console.warn('Database deletion blocked:', db.name);
                      resolve(undefined);
                    };
                  });
                }
              }

              // Clear localStorage
              console.log('🗑️ Clearing localStorage...');
              localStorage.clear();

              console.log('✅ Database and localStorage deleted, reloading...');

              // Reload the page to recreate database
              window.location.reload();

            } catch (error) {
              console.error('Delete error:', error);
              toast({
                title: 'Erro ao deletar banco',
                description: error instanceof Error ? error.message : 'Erro desconhecido',
                variant: 'destructive',
              });
            }
          }}
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-destructive"
        >
          🗑️ Deletar dados locais
        </Button>
      </div>
    </main>
  );
};

export default Library;
