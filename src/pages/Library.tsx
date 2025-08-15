import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BOOKS } from "@/lib/books";
import { SEO } from "@/components/app/SEO";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { setReadingPlan, getProgress, getReadingPlan } from "@/lib/storage";
import { toast } from "@/hooks/use-toast";

type Part = { part_title: string; chapters: { chapter_title: string }[] };

const Library = () => {
  const [open, setOpen] = useState(false);
  const [selectedBook, setSelectedBook] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string>("");
  const [targetChapter, setTargetChapter] = useState<string>("end");
  const [bookParts, setBookParts] = useState<Part[] | null>(null);
  const navigate = useNavigate();
  const today = new Date().toISOString().slice(0, 10);

  const onChooseBook = async (bookId: string) => {
    setSelectedBook(bookId);
    const plan = getReadingPlan(bookId);
    setEndDate(plan.targetDateISO ?? "");
    
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

  const startReading = (withPlan: boolean) => {
    if (!selectedBook) return;
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
    } else {
      setReadingPlan(selectedBook, null);
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
      <h1 className="text-3xl font-bold mb-6">Biblioteca</h1>
      <section className="grid md:grid-cols-2 gap-6">
        {BOOKS.map((book) => (
          <Card key={book.id} className="hover:shadow-lg transition-shadow">
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
              Defina uma meta específica e uma data. Calcularemos uma meta diária proporcional ao restante.
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
