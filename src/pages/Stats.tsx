import { getStats, getStreak } from "@/lib/storage";
import { SEO } from "@/components/app/SEO";
import { PageHeader } from "@/components/app/PageHeader";

const totalMinutes = (m: Record<string, number>) => Object.values(m).reduce((a, b) => a + b, 0);

const Stats = () => {
  const s = getStreak();
  const stats = getStats();
  const total = totalMinutes(stats.minutesByDate);

  return (
    <main className="container mx-auto py-10">
      <SEO
        title="Estatísticas — Leitura Devota"
        description="Acompanhe seu streak e o tempo total de leitura."
        canonical="/estatisticas"
      />
      <PageHeader title="Estatísticas" />
      <section className="grid md:grid-cols-3 gap-6">
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">Streak atual</p>
          <p className="text-3xl font-bold">{s.current} 🔥</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">Maior streak</p>
          <p className="text-3xl font-bold">{s.longest}</p>
        </div>
        <div className="rounded-lg border p-4">
          <p className="text-sm text-muted-foreground">Minutos lidos</p>
          <p className="text-3xl font-bold">{total}</p>
        </div>
      </section>
    </main>
  );
};

export default Stats;
