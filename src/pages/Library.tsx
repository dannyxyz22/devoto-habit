import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BOOKS } from "@/lib/books";
import { SEO } from "@/components/app/SEO";

const Library = () => {
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
              <Button asChild>
                <Link to={`/leitor/${book.id}`}>Ler agora</Link>
              </Button>
            </CardContent>
          </Card>
        ))}
      </section>
    </main>
  );
};

export default Library;
