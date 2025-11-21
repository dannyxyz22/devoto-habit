import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { BackLink } from "@/components/app/BackLink";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BOOKS } from "@/lib/books";
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

type Paragraph = { type: string; content: string };
type Chapter = { chapter_title: string; content: Paragraph[] };
type Part = { part_title: string; chapters: Chapter[] };

const Library = () => {
  const Cover = ({ src, alt }: { src: string; alt: string }) => (
    <div className="overflow-hidden rounded-t-lg h-56 md:h-64 lg:h-72 bg-muted">
      <img src={src} alt={alt} className="w-full h-full object-contain object-center" loading="lazy" />
    </div>
  );
  const [open, setOpen] = useState(false);
  const [selectedBook, setSelectedBook] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string>("");
  const [currentPosition, setCurrentPosition] = useState<string>("0-0");
  const [targetChapter, setTargetChapter] = useState<string>("end");
  const [bookParts, setBookParts] = useState<Part[] | null>(null);
  const [selectedIsEpub, setSelectedIsEpub] = useState<boolean>(false);
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
    const book = BOOKS.find(b => b.id === bookId);
    setSelectedIsEpub(book?.type === 'epub');
    if (book) {
      if (book.type === 'epub') {
        // EPUB: no JSON structure; skip fetch and open dialog with date only
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
            const response = await fetch(book.sourceUrl);
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
    const meta = BOOKS.find(b => b.id === selectedBook);
    if (meta?.type === 'epub') {
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
        // Initialize baseline from current percent if missing
        try {
          const prog = getProgress(selectedBook);
          const todayISO = formatISO(new Date(), { representation: "date" });
          const existing = getDailyBaseline(selectedBook, todayISO);
          if (!existing) {
            setDailyBaseline(selectedBook, todayISO, { words: 0, percent: prog?.percent || 0 });
            try { console.log('[Baseline] persistida', { scope: 'Library', bookId: selectedBook, todayISO, words: 0, percent: prog?.percent || 0 }); } catch { }
          }
        } catch { }
      }
      // For EPUBs, just navigate to the EPUB reader
      setOpen(false);
      navigate(`/epub/${selectedBook}`);
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
    navigate(`/leitor/${selectedBook}`);
  };

  return (
    <main className="min-h-screen lg:bg-slate-900 py-10">
      <SEO
        title="Biblioteca Católica — Leitura Devota"
        description="Escolha um clássico católico em português e comece sua leitura devocional."
        canonical="/biblioteca"
      />
      <div className="container mx-auto">
        <nav className="mb-4 text-sm">
          <BackLink to="/" label="Início" className="lg:text-slate-300 hover:lg:text-white" />
        </nav>
        <h1 className="text-3xl font-bold mb-6 lg:text-white">Biblioteca</h1>
      </div>
      <section className="container mx-auto grid md:grid-cols-2 gap-6">
        {BOOKS.map((book) => (
          <Card key={book.id} className="hover:shadow-lg transition-shadow">
            <div
              role="button"
              tabIndex={0}
              onClick={() => navigate(book.type === 'epub' ? `/epub/${book.id}` : `/leitor/${book.id}`)}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(book.type === 'epub' ? `/epub/${book.id}` : `/leitor/${book.id}`); } }}
              className="cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50 focus:ring-offset-2"
            >
              {book.type === 'epub'
                ? (<EpubCoverLoader id={book.id} title={book.title} sourceUrl={book.sourceUrl} />)
                : (book.coverImage && (
                  <Cover
                    src={book.coverImage}
                    alt={`Capa do livro ${book.title}`}
                  />
                ))}
            </div>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>{book.title}</span>
                <span className="text-sm text-muted-foreground">{book.author}</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground mb-4">{book.description}</p>
              <div className="flex items-center gap-2">
                <Button onClick={() => navigate(book.type === 'epub' ? `/epub/${book.id}` : `/leitor/${book.id}`)}>
                  Continuar leitura
                </Button>
                <Button variant="secondary" onClick={() => onChooseBook(book.id)}>Definir meta</Button>
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
            {!selectedIsEpub && (
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
