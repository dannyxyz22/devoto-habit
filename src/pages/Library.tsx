import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BOOKS } from "@/lib/books";
import { SEO } from "@/components/app/SEO";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { setReadingPlan, getProgress, getReadingPlan } from "@/lib/storage";
import { toast } from "@/hooks/use-toast";

const Library = () => {
  const [open, setOpen] = useState(false);
  const [selectedBook, setSelectedBook] = useState<string | null>(null);
  const [endDate, setEndDate] = useState<string>("");
  const navigate = useNavigate();
  const today = new Date().toISOString().slice(0, 10);

  const onChooseBook = (bookId: string) => {
    setSelectedBook(bookId);
    const plan = getReadingPlan(bookId);
    setEndDate(plan.targetDateISO ?? "");
    setOpen(true);
  };

  const startReading = (withPlan: boolean) => {
    if (!selectedBook) return;
    if (withPlan) {
      if (!endDate) {
        toast({ title: "Selecione uma data", description: "Escolha uma data de término ou comece sem meta." });
        return;
      }
      setReadingPlan(selectedBook, endDate);
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
          <div className="space-y-3">
            <label htmlFor="endDate" className="text-sm font-medium">Data para concluir a leitura</label>
            <Input
              id="endDate"
              type="date"
              min={today}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">Você pode definir uma data para terminar o livro. Calcularemos uma meta diária proporcional ao restante.</p>
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
