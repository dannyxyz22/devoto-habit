import { useState, useEffect, useRef } from "react";
import { BookCover } from "@/components/book/BookCover";

import { useParams, useNavigate } from "react-router-dom";
import { BackLink } from "@/components/app/BackLink";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SEO } from "@/components/app/SEO";
import { setProgress, getProgress, getDailyBaseline, setDailyBaseline, setLastBookId } from "@/lib/storage";
import { useToast } from "@/components/ui/use-toast";
import { format } from "date-fns";
import { BookOpen, Plus } from "lucide-react";
import type { PhysicalBook } from "@/lib/physicalBooks";
import { getDatabase } from "@/lib/database/db";
import { dataLayer } from "@/services/data/RxDBDataLayer";




export default function PhysicalBookTracker() {
    const { bookId } = useParams<{ bookId: string }>();
    const navigate = useNavigate();
    const { toast } = useToast();

    const [book, setBook] = useState<PhysicalBook | null>(null);
    const [currentPage, setCurrentPage] = useState("");
    const [loading, setLoading] = useState(true);

    const lastAppliedProgressVersionRef = useRef<number>(-1);

    
    // Track if user is currently editing to avoid overwriting their input
    const isUserEditing = useRef(false);


    function setBookDebug(
    updater: PhysicalBook | ((prev: PhysicalBook | null) => PhysicalBook | null),
    source: string
) {
    setBook(prev => {
        const next =
            typeof updater === 'function'
                ? updater(prev)
                : updater;

        console.group('[SET BOOK]');
        console.log('SOURCE:', source);
        console.log('FROM:', prev?.currentPage);
        console.log('TO:', next?.currentPage);
        console.trace();
        console.groupEnd();

        return next;
    });
}

    //Debug do set currentPage
    useEffect(() => {
    if (!book) return;

    console.group('[BOOK STATE]');
    console.log('currentPage:', book.currentPage);
    console.trace();
    console.groupEnd();
}, [book]);

    // Reactive subscription to book changes
    useEffect(() => {
        if (!bookId) {
            navigate("/biblioteca");
            return;
        }

        let subscription: any;

        const setupSubscription = async () => {
            try {
                const db = await getDatabase();
                const book$ = db.books.findOne(bookId).$;

                subscription = book$.subscribe((rxBook) => {
                    if (!rxBook) {
                        // Book was deleted or doesn't exist
                        if (!loading) {
                            toast({
                                title: "Livro não encontrado",
                                description: "Este livro não existe na sua biblioteca",
                                variant: "destructive",
                            });
                            navigate("/biblioteca");
                        }
                        return;
                    }

                     const incomingVersion = rxBook.progress_version ?? 0;

                    if (incomingVersion < lastAppliedProgressVersionRef.current) {
                        console.warn('[SUBSCRIPTION] Ignored stale progress', {
                            incomingVersion,
                            lastApplied: lastAppliedProgressVersionRef.current,
                            current_page: rxBook.current_page
                        });
                        return;
                    }

                    lastAppliedProgressVersionRef.current = incomingVersion;


                    const bookData = rxBook.toJSON();
                    const physicalBook: PhysicalBook = {
                        id: bookData.id,
                        title: bookData.title,
                        author: bookData.author || "",
                        coverUrl: bookData.cover_url,
                        totalPages: bookData.total_pages || 0,
                        currentPage: bookData.current_page || 0,
                        isPhysical: true,
                        addedDate: bookData._modified,
                        description: "",
                        publisher: "",
                    };

                    setBookDebug(physicalBook, "setup subscription");
                    
                    // Only update input if user is not currently editing
                    if (!isUserEditing.current) {
                        setCurrentPage(physicalBook.currentPage.toString());
                    }

                    // Initialize progress in storage
                    const todayISO = format(new Date(), "yyyy-MM-dd");
                    const existingProgress = getProgress(bookId);

                    if (!existingProgress) {
                        const percent = Math.round((physicalBook.currentPage / physicalBook.totalPages) * 100);
                        setProgress(bookId, {
                            partIndex: 0,
                            chapterIndex: 0,
                            percent,
                            currentPage: physicalBook.currentPage,
                            totalPages: physicalBook.totalPages,
                        });
                    }

                    // Initialize baseline if needed
                    const baseline = getDailyBaseline(bookId, todayISO);
                    if (!baseline) {
                        const percent = Math.round((physicalBook.currentPage / physicalBook.totalPages) * 100);
                        setDailyBaseline(bookId, todayISO, {
                            words: 0,
                            percent,
                        });
                    }

                    setLoading(false);
                });
            } catch (error) {
                console.error("Error setting up book subscription:", error);
                toast({
                    title: "Erro ao carregar livro",
                    description: "Tente novamente",
                    variant: "destructive",
                });
                setLoading(false);
            }
        };

        setupSubscription();

        return () => {
            if (subscription) {
                subscription.unsubscribe();
            }
        };
    }, [bookId, navigate, toast]);

    const handleUpdateProgress = async () => {
        if (!book || !bookId) return;

        const newPage = parseInt(currentPage, 10);

        if (isNaN(newPage) || newPage < 0 || newPage > book.totalPages) {
            toast({
                title: "Página inválida",
                description: `Digite um número entre 0 e ${book.totalPages}`,
                variant: "destructive",
            });
            return;
        }

        try {
            // 1. Avança a versão local ANTES da escrita
            const nextVersion = lastAppliedProgressVersionRef.current + 1;
            lastAppliedProgressVersionRef.current = nextVersion;

            // 2. Atualização otimista do estado local
            setBookDebug(
                prev => prev
                    ? { ...prev, currentPage: newPage }
                    : prev,
                "handleUpdateProgress"
            );

            // 3. Persistência única via DataLayer
            await dataLayer.saveBookProgress(bookId, newPage);

            // 4. Atualização de métricas locais
            const percent = Math.round((newPage / book.totalPages) * 100);
            setProgress(bookId, {
                partIndex: 0,
                chapterIndex: 0,
                percent,
                currentPage: newPage,
                totalPages: book.totalPages,
            });

            // 5. Metadado auxiliar
            setLastBookId(bookId);

            // 6. Feedback ao usuário
            toast({
                title: "Progresso atualizado!",
                description: `Você está na página ${newPage} de ${book.totalPages}`,
            });
        } catch (error) {
            console.error("Error updating progress:", error);
            toast({
                title: "Erro ao atualizar progresso",
                description: "Tente novamente",
                variant: "destructive",
            });
        }

    };

    // Updated quick add: automatically persists progress and updates UI
    const handleQuickAdd = async (pages: number) => {
        if (!book || !bookId) return;
        const newPage = Math.min(book.currentPage + pages, book.totalPages);
        setCurrentPage(newPage.toString());
        // Persist the new page count

        const nextVersion = lastAppliedProgressVersionRef.current + 1;
        lastAppliedProgressVersionRef.current = nextVersion;

        setBookDebug(
            prev => prev
            ? { ...prev, currentPage: newPage }
            : prev,
            "handleQuickAdd"
        );

        try {
            // Update via DataLayer
            console.log(`Quick adding ${pages} pages to book ID ${bookId}`);
            const rxBook = await dataLayer.getBook(bookId);
            if (rxBook) {
                console.log('[DataLayer before] Save book with new current_page:', newPage);

                dataLayer.saveBookProgress(bookId, newPage)
                console.log('[DataLayer finished] Save book with new current_page:', newPage);
            }

            const percent = Math.round((newPage / book.totalPages) * 100);
                 console.log('[Set progress before] Save book with new current_page:', newPage);
            setProgress(bookId, {
           
                partIndex: 0,
                chapterIndex: 0,
                percent,
                currentPage: newPage,
                totalPages: book.totalPages,
            });
                 console.log('[Set progress after] Save book with new current_page:', newPage);

            toast({
                title: "Progresso atualizado!",
                description: `Você está na página ${newPage} de ${book.totalPages}`,
            });
            await setLastBookId(bookId);
        } catch (error) {
            console.error("Error quick adding pages:", error);
            toast({
                title: "Erro ao atualizar progresso",
                description: "Tente novamente",
                variant: "destructive",
            });
        }
        console.log('[Quick add finished] Save book with new current_page:', newPage);
    };

    if (loading) {
        return (
            <main className="min-h-screen bg-background py-10">
                <div className="container mx-auto">
                    <p className="text-center text-foreground">Carregando...</p>
                </div>
            </main>
        );
    }

    if (!book) {
        return null;
    }

    const progressPercent = Math.round((book.currentPage / book.totalPages) * 100);

    return (
        <main className="min-h-screen bg-background py-10">
            <SEO
                title={`${book.title} — Rastreamento`}
                description={`Acompanhe seu progresso em ${book.title}`}
                canonical={`/physical/${bookId}`}
            />

            <div className="container mx-auto max-w-3xl">
                <nav className="mb-4 text-sm">
                    <BackLink to="/biblioteca" label="Biblioteca" className="text-muted-foreground hover:text-foreground" />
                </nav>

                <Card className="mb-6">
                    <CardHeader>
                        <div className="flex gap-4">
                            <BookCover
                                bookId={book.id}
                                coverUrl={book.coverUrl}
                                title={book.title}
                                className="w-full h-48 rounded-t-lg"
                            />
                            <div className="flex-1">
                                <CardTitle className="text-2xl mb-2">{book.title}</CardTitle>
                                <p className="text-muted-foreground">{book.author}</p>
                                {book.publisher && (
                                    <p className="text-sm text-muted-foreground mt-1">{book.publisher}</p>
                                )}
                            </div>
                        </div>
                    </CardHeader>
                </Card>

                <Card className="mb-6">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <BookOpen className="h-5 w-5" />
                            Progresso de Leitura
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div>
                            <div className="flex justify-between text-sm text-muted-foreground mb-2">
                                <span>Páginas lidas</span>
                                <span>{book.currentPage} / {book.totalPages} ({progressPercent}%)</span>
                            </div>
                            <div className="w-full bg-secondary rounded-full h-3">
                                <div
                                    className="bg-primary h-3 rounded-full transition-all"
                                    style={{ width: `${progressPercent}%` }}
                                />
                            </div>
                        </div>

                        <div className="space-y-3">
                            <div>
                                <label htmlFor="current-page" className="text-sm font-medium mb-2 block">
                                    Página atual
                                </label>
                                <div className="flex gap-2">
                                    <Input
                                        id="current-page"
                                        type="number"
                                        min="0"
                                        max={book.totalPages}
                                        value={currentPage}
                                        onChange={(e) => setCurrentPage(e.target.value)}
                                        onFocus={() => { isUserEditing.current = true; }}
                                        onBlur={() => { isUserEditing.current = false; }}
                                        className="flex-1"
                                    />
                                    <Button onClick={handleUpdateProgress}>Atualizar</Button>
                                </div>
                            </div>

                            <div>
                                <p className="text-sm font-medium mb-2">Adicionar páginas rapidamente:</p>
                                <div className="flex gap-2">
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleQuickAdd(1)}
                                        disabled={book.currentPage >= book.totalPages}
                                    >
                                        <Plus className="h-3 w-3 mr-1" />
                                        1
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleQuickAdd(5)}
                                        disabled={book.currentPage >= book.totalPages}
                                    >
                                        <Plus className="h-3 w-3 mr-1" />
                                        5
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleQuickAdd(10)}
                                        disabled={book.currentPage >= book.totalPages}
                                    >
                                        <Plus className="h-3 w-3 mr-1" />
                                        10
                                    </Button>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => handleQuickAdd(20)}
                                        disabled={book.currentPage >= book.totalPages}
                                    >
                                        <Plus className="h-3 w-3 mr-1" />
                                        20
                                    </Button>
                                </div>
                            </div>
                        </div>

                        {book.description && (
                            <div className="pt-4 border-t">
                                <p className="text-sm text-muted-foreground">{book.description}</p>
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </main>
    );
}
