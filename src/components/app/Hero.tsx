import { Link } from "react-router-dom";
import { useEffect, useState } from "react";
import hero from "@/assets/hero-devota.jpg";
import { Button } from "@/components/ui/button";
import { UserMenu } from "./UserMenu";
import { useToast } from "@/components/ui/use-toast";
import { getLastBookIdAsync } from "@/lib/storage";


export interface HeroProps {
  activeBookId?: string | null;
  used?: boolean;
}

export const Hero = ({ activeBookId, used }: HeroProps) => {
  const { toast } = useToast();
  const [debugCount, setDebugCount] = useState(0);

  let ctaLabel = "Começar agora";
  let ctaHref = "/biblioteca";

  if (used) {
    ctaLabel = "Continuar";
    if (activeBookId) {
      if (activeBookId.startsWith('physical-')) {
        ctaHref = `/book/${activeBookId}`;
      } else {
        // All non-physical books are EPUBs
        ctaHref = `/epub/${activeBookId}`;
      }
    }
  }

  return (
    <header className="relative overflow-hidden rounded-lg border bg-card">
      <div className="absolute inset-0 bg-gradient-to-r from-background/60 via-background/40 to-background/60" aria-hidden />
      <img
        src={hero}
        alt="Jovem lendo um clássico católico à luz de vela, ambiência sagrada"
        className="w-full h-72 md:h-96 object-cover"
        loading="eager"
      />
      <div className="absolute top-4 right-4 z-10">
        <UserMenu />
      </div>
      <div className="absolute inset-0 flex items-center">
        <div className="p-6 md:p-10">
          <p
            className="text-sm text-muted-foreground select-none cursor-default active:text-primary transition-colors"
          >
            Clássicos católicos
          </p>
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
