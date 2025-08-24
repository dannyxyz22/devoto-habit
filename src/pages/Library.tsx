import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BOOKS } from "@/lib/books";
import { SEO } from "@/components/app/SEO";
import { PageHeader } from "@/components/app/PageHeader";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { setReadingPlan, getProgress, getReadingPlan, setDailyBaseline, setProgress } from "@/lib/storage";
import { toast } from "@/hooks/use-toast";
import { formatISO } from "date-fns";

type Paragraph = { type: string; content: string };
type Chapter = { chapter_title: string; content: Paragraph[] };
type Part = { part_title: string; chapters: Chapter[] };

const Library = () => {
  const Cover = ({ src, alt }: { src: string; alt: string }) => {
    const [bg, setBg] = useState<string | undefined>(undefined);
    const triedRef = useRef(false);

    useEffect(() => {
      if (!src || triedRef.current) return;
      triedRef.current = true;
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = src;
      img.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          if (!ctx) return;
          const w = 32, h = 32;
          canvas.width = w;
          canvas.height = h;
          ctx.drawImage(img, 0, 0, w, h);
          const { data } = ctx.getImageData(0, 0, w, h);
          let r = 0, g = 0, b = 0, count = 0;
          for (let i = 0; i < data.length; i += 4) {
            const a = data[i + 3];
            if (a < 128) continue; // ignore mostly transparent
            r += data[i];
            g += data[i + 1];
            b += data[i + 2];
            count++;
          }
          if (count) {
            r = Math.round(r / count);
            g = Math.round(g / count);
            b = Math.round(b / count);
            // Convert to HSL and darken lightness slightly
            const toHsl = (R: number, G: number, B: number) => {
              const r1 = R / 255, g1 = G / 255, b1 = B / 255;
              const max = Math.max(r1, g1, b1), min = Math.min(r1, g1, b1);
              let h = 0, s = 0;
              const l = (max + min) / 2;
              const d = max - min;
              if (d !== 0) {
                s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
                switch (max) {
                  case r1: h = (g1 - b1) / d + (g1 < b1 ? 6 : 0); break;
                  case g1: h = (b1 - r1) / d + 2; break;
                  case b1: h = (r1 - g1) / d + 4; break;
                }
                h /= 6;
              }
              return { h, s, l };
            };
            const fromHsl = (h: number, s: number, l: number) => {
              const hue2rgb = (p: number, q: number, t: number) => {
                if (t < 0) t += 1;
                if (t > 1) t -= 1;
                if (t < 1/6) return p + (q - p) * 6 * t;
                if (t < 1/2) return q;
                if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
                return p;
              };
              let r2: number, g2: number, b2: number;
              if (s === 0) {
                r2 = g2 = b2 = l; // achromatic
              } else {
                const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
                const p = 2 * l - q;
                r2 = hue2rgb(p, q, h + 1/3);
                g2 = hue2rgb(p, q, h);
                b2 = hue2rgb(p, q, h - 1/3);
              }
              return {
                r: Math.round(r2 * 255),
                g: Math.round(g2 * 255),
                b: Math.round(b2 * 255)
              };
            };
            const { h, s, l } = toHsl(r, g, b);
            const newL = Math.max(0.15, l - 0.07); // slightly darker
            const rgb = fromHsl(h, s, newL);
            setBg(`rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`);
          }
        } catch {
          // Ignore CORS/canvas errors; fallback to default bg
        }
      };
    }, [src]);

    return (
      <div className="overflow-hidden rounded-t-lg h-56 md:h-64 lg:h-72 bg-muted" style={bg ? { background: bg } : undefined}>
        <img src={src} alt={alt} className="w-full h-full object-contain object-center" loading="lazy" />
      </div>
    );
  };
  const [open, setOpen] = useState(false);
  const [selectedBook, setSelectedBook] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string>("");
  const [currentPosition, setCurrentPosition] = useState<string>("0-0");
  const [targetChapter, setTargetChapter] = useState<string>("end");
  const [bookParts, setBookParts] = useState<Part[] | null>(null);
  const navigate = useNavigate();
  const today = new Date().toISOString().slice(0, 10);

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
    if (book) {
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
    
    setOpen(true);
  };

  const startReading = async (withPlan: boolean) => {
    if (!selectedBook) return;
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
        // Persist plan start for plan progress calculations (start indexes and words)
        try {
          localStorage.setItem(
            `planStart:${selectedBook}`,
            JSON.stringify({ startPartIndex: curPartIndex, startChapterIndex: curChapterIndex, startWords: wordsUpToCurrent })
          );
        } catch {}
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
      }
    }
    setOpen(false);
    navigate(`/leitor/${selectedBook}`);
  };

  return (
    <main className="container mx-auto py-10">
      <SEO
        title="Biblioteca Católica — Leitura Devota"
        description="Escolha um clássico católico em português e comece sua leitura devocional."
        canonical="/biblioteca"
      />
      <PageHeader title="Biblioteca" />
      <section className="grid md:grid-cols-2 gap-6">
        {BOOKS.map((book) => (
          <Card key={book.id} className="hover:shadow-lg transition-shadow">
            {book.coverImage && (
              <Cover
                src={book.coverImage}
                alt={`Capa do livro ${book.title}`}
              />
            )}
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>{book.title}</span>
                <span className="text-sm text-muted-foreground">{book.author}</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground mb-4">{book.description}</p>
              <div className="flex items-center gap-2">
                <Button onClick={() => navigate(`/leitor/${book.id}`)}>Continuar leitura</Button>
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
              Defina uma meta específica e uma data. Calcularemos uma meta diária a partir do seu ponto atual de leitura.
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
