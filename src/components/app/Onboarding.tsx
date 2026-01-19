import { useState, useEffect } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
} from "@/components/ui/dialog";
import {
    Carousel,
    CarouselContent,
    CarouselItem,
    type CarouselApi,
} from "@/components/ui/carousel";
import { Button } from "@/components/ui/button";
import { BookOpen, Flame, ShieldCheck, ChevronRight, ChevronLeft, Library, Layout } from "lucide-react";
import { cn } from "@/lib/utils";

export const Onboarding = () => {
    const [open, setOpen] = useState(false);
    const [api, setApi] = useState<CarouselApi>();
    const [current, setCurrent] = useState(0);

    useEffect(() => {
        const hasSeenOnboarding = localStorage.getItem("hasSeenOnboarding_v1");
        if (hasSeenOnboarding !== "true") {
            setOpen(true);
        }
    }, []);

    useEffect(() => {
        if (!api) return;

        setCurrent(api.selectedScrollSnap());
        api.on("select", () => {
            setCurrent(api.selectedScrollSnap());
        });
    }, [api]);

    const handleFinish = () => {
        localStorage.setItem("hasSeenOnboarding_v1", "true");
        setOpen(false);
    };

    const slides = [
        {
            title: (
                <>
                    Que bom ter você aqui no <span className="text-primary">Ignis Verbi</span>!
                </>
            ),
            description: "Sua jornada de leitura devocional começa aqui. Leia clássicos ou defina metas para seus livros físicos.",
            icon: <BookOpen className="h-12 w-12 text-primary" />,
        },
        {
            title: (
                <>
                    Crie Hábitos de <span className="text-primary">Leitura Espiritual</span>!
                </>
            ),
            description: "Defina metas diárias, acompanhe seu progresso e mantenha o hábito de leitura para transformar sua alma.",
            icon: <Flame className="h-12 w-12 text-orange-500" />,
        },
        {
            title: "Biblioteca Espiritual Digital",
            description: "Escolha entre os clássicos inclusos ou adicione seus eBooks. Sincronizamos seu progresso e metas.",
            icon: <Library className="h-12 w-12 text-green-600" />,
        },
        {
            title: (
                <>
                    Sua Meta no <span className="text-primary">Widget</span>!
                </>
            ),
            description: "Instale nosso Widget no Android e acompanhe sua meta diária diretamente na tela inicial, sem precisar abrir o app.",
            icon: <Layout className="h-12 w-12 text-blue-500" />,
        },
    ];

    return (
        <Dialog open={open} onOpenChange={(val) => {
            if (!val) handleFinish();
            setOpen(val);
        }}>
            <DialogContent className="w-[92vw] max-w-[425px] p-0 overflow-hidden border-none bg-card rounded-2xl sm:rounded-2xl max-h-[90vh] flex flex-col">
                <div className="flex-1 overflow-y-auto">
                    <div className="p-6 pb-2">
                        <Carousel setApi={setApi} className="w-full">
                            <CarouselContent>
                                {slides.map((slide, index) => (
                                    <CarouselItem key={index} className="flex flex-col items-center text-center space-y-4 py-4 md:py-8 px-4">
                                        <div className="bg-primary/10 p-4 rounded-full mb-2">
                                            {slide.icon}
                                        </div>
                                        <h2 className="text-2xl font-bold">{slide.title}</h2>
                                        <p className="text-muted-foreground px-2">
                                            {slide.description}
                                        </p>
                                    </CarouselItem>
                                ))}
                            </CarouselContent>
                        </Carousel>
                    </div>
                </div>

                <div className="flex flex-col items-center p-6 pt-0 space-y-6">
                    {/* Dot Indicators */}
                    <div className="flex gap-2">
                        {slides.map((_, index) => (
                            <div
                                key={index}
                                className={cn(
                                    "h-2 w-2 rounded-full transition-colors",
                                    current === index ? "bg-primary" : "bg-primary/20"
                                )}
                            />
                        ))}
                    </div>

                    <div className="flex w-full gap-3">
                        {current > 0 ? (
                            <Button
                                variant="outline"
                                className="flex-1"
                                onClick={() => api?.scrollPrev()}
                            >
                                <ChevronLeft className="h-4 w-4 mr-2" />
                                Anterior
                            </Button>
                        ) : (
                            <div className="flex-1" />
                        )}

                        {current === slides.length - 1 ? (
                            <Button className="flex-1" onClick={handleFinish}>
                                Começar agora
                            </Button>
                        ) : (
                            <Button className="flex-1" onClick={() => api?.scrollNext()}>
                                Próximo
                                <ChevronRight className="h-4 w-4 ml-2" />
                            </Button>
                        )}
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};
