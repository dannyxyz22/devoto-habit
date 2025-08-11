import Hero from "@/components/app/Hero";
import { SEO } from "@/components/app/SEO";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";

const Index = () => {
  return (
    <main>
      <SEO
        title="Leitura Devota — Clássicos Católicos"
        description="Crie o hábito de leitura espiritual diária com clássicos católicos em português."
        canonical="/"
      />
      <Hero />
      <section className="mt-8 grid md:grid-cols-3 gap-6">
        <div className="rounded-lg border p-4">
          <h2 className="text-lg font-semibold">Streak diário</h2>
          <p className="text-muted-foreground">Ganhe consistência com sua leitura devocional.</p>
        </div>
        <div className="rounded-lg border p-4">
          <h2 className="text-lg font-semibold">Metas e lembretes</h2>
          <p className="text-muted-foreground">Defina um horário e receba lembretes sutis.</p>
        </div>
        <div className="rounded-lg border p-4">
          <h2 className="text-lg font-semibold">Progresso visível</h2>
          <p className="text-muted-foreground">Acompanhe capítulos e conclusão de livros.</p>
        </div>
      </section>
      <div className="mt-6">
        <Button asChild variant="link">
          <Link to="/biblioteca">Ver biblioteca completa →</Link>
        </Button>
      </div>
    </main>
  );
};

export default Index;
