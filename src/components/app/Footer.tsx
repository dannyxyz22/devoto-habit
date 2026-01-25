import { ExternalLink } from "lucide-react";

export const Footer = () => {
    return (
        <footer className="mt-16 py-12 border-t border-border/40 flex flex-col items-center gap-6 text-center">
            <div className="flex flex-col gap-3">
                <a
                    href="https://landing-ignisverbi.lovable.app/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-center justify-center gap-2 text-primary font-medium hover:text-primary/80 transition-all text-lg"
                >
                    Conheça o Ignis Verbi
                    <ExternalLink className="h-4 w-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </a>
                <p className="text-sm text-muted-foreground/80 max-w-sm mx-auto leading-relaxed">
                    O aplicativo definitivo para cultivar o hábito da leitura espiritual através dos grandes clássicos da Igreja.
                </p>
            </div>

            <div className="flex flex-col gap-1">
                <p className="text-xs text-muted-foreground/60">
                    © {new Date().getFullYear()} Ignis Verbi
                </p>
                <p className="text-[10px] text-muted-foreground/40 uppercase tracking-widest font-medium">
                    Ad Maiorem Dei Gloriam
                </p>
            </div>
        </footer>
    );
};

export default Footer;
