import { Link } from "react-router-dom";
import hero from "@/assets/hero-devota.jpg";
import { Button } from "@/components/ui/button";
import { SEO } from "./SEO";

export const Hero = () => {
  return (
    <header className="relative overflow-hidden rounded-lg border bg-card">
      <SEO
        title="Leitura Devota — Clássicos Católicos"
        description="Forme o hábito de leitura espiritual diária com clássicos católicos em português. Streak, metas e lembretes."
        canonical="/"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-background/60 via-background/40 to-background/60" aria-hidden />
      <img
        src={hero}
        alt="Jovem lendo um clássico católico à luz de vela, ambiência sagrada"
        className="w-full h-72 md:h-96 object-cover"
        loading="eager"
      />
      <div className="absolute inset-0 flex items-center">
        <div className="p-6 md:p-10">
          <p className="text-sm text-muted-foreground">Clássicos em domínio público</p>
          <h1 className="text-3xl md:text-5xl font-bold max-w-2xl leading-tight mt-2">
            Leitura devocional diária que cria hábito e transforma a alma
          </h1>
          <p className="mt-3 text-muted-foreground max-w-xl">
            Acompanhe seu progresso, mantenha seu streak, receba lembretes e conclua
            os grandes clássicos da espiritualidade católica.
          </p>
          <div className="mt-6 flex gap-3">
            <Button asChild variant="hero" size="lg">
              <Link to="/biblioteca">Começar agora</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link to="/estatisticas">Ver estatísticas</Link>
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Hero;
