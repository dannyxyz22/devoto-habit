import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import hero from "@/assets/hero-devota.jpg";
import { Button } from "@/components/ui/button";


export const Hero = () => {
  const [ctaLabel, setCtaLabel] = useState("Começar agora");
  const [ctaHref, setCtaHref] = useState("/biblioteca");

  useEffect(() => {
    try {
      const ls = window.localStorage;
      let used = false;
      // Any saved progress or plan implies prior interaction
      for (let i = 0; i < ls.length; i++) {
        const key = ls.key(i) || "";
        if (key.startsWith("progress:") || key.startsWith("plan:")) {
          used = true;
          break;
        }
      }
      // Streak or stats also count
      if (!used) {
        const streak = ls.getItem("streak");
        if (streak) {
          const s = JSON.parse(streak || "null");
          if (s?.lastReadISO) used = true;
        }
      }
      if (!used) {
        const stats = ls.getItem("stats");
        if (stats) {
          const st = JSON.parse(stats || "null");
          if (st?.minutesByDate && Object.keys(st.minutesByDate).length > 0) used = true;
        }
      }
      if (used) {
        setCtaLabel("Continuar");
        const last = ls.getItem('lastBookId');
        if (last) setCtaHref(`/leitor/${last}`);
      }
    } catch {}
  }, []);

  return (
    <header className="relative overflow-hidden rounded-lg border bg-card">
      <div className="absolute inset-0 bg-gradient-to-r from-background/60 via-background/40 to-background/60" aria-hidden />
      <img
        src={hero}
        alt="Jovem lendo um clássico católico à luz de vela, ambiência sagrada"
        className="w-full h-72 md:h-96 object-cover"
        loading="eager"
      />
      <div className="absolute inset-0 flex items-center">
        <div className="p-6 md:p-10">
          <p className="text-sm text-muted-foreground">Clássicos católicos</p>
          <h1 className="text-3xl md:text-5xl font-bold max-w-2xl leading-tight mt-2">
            Leitura devocional diária que cria hábito e transforma a alma
          </h1>
          <p className="mt-3 text-muted-foreground max-w-xl">
            Acompanhe seu progresso, mantenha seu streak, receba lembretes e conclua
            os grandes clássicos da espiritualidade católica.
          </p>
          <div className="mt-6 flex gap-3">
            <Button asChild variant="hero" size="lg">
              <Link to={ctaHref}>{ctaLabel}</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <Link to="/biblioteca">Ver biblioteca</Link>
            </Button>
          </div>
        </div>
      </div>
    </header>
  );
};

export default Hero;
