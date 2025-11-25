import { useState, useEffect } from "react";
import { BookCover } from "@/components/book/BookCover";

import { useParams, useNavigate } from "react-router-dom";
import { BackLink } from "@/components/app/BackLink";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SEO } from "@/components/app/SEO";
import { setProgress, getProgress, getDailyBaseline, setDailyBaseline } from "@/lib/storage";
import { useToast } from "@/components/ui/use-toast";
import { format } from "date-fns";
import { BookOpen, Plus } from "lucide-react";
import type { PhysicalBook } from "@/lib/physicalBooks";
import { dataLayer } from "@/services/data/RxDBDataLayer";

export default function PhysicalBookTracker() {
    const { bookId } = useParams<{ bookId: string }>();
    const navigate = useNavigate();
    const { toast } = useToast();

    const [book, setBook] = useState<PhysicalBook | null>(null);
    const [currentPage, setCurrentPage] = useState("");
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const loadBook = async () => {
            if (!bookId) {
                navigate("/biblioteca");
                return;
            }

            try {
                const rxBook = await dataLayer.getBook(bookId);

                if (!rxBook) {
                    toast({
                        title: "Livro não encontrado",
                        description: "Este livro não existe na sua biblioteca",
                        variant: "destructive",
                    });
                    navigate("/biblioteca");
                    return;
                }

                const physicalBook: PhysicalBook = {
                    id: rxBook.id,
                    title: rxBook.title,
                    author: rxBook.author || "",
                    coverUrl: rxBook.cover_url,
                    totalPages: rxBook.total_pages || 0,
                    currentPage: rxBook.current_page || 0,
                    isPhysical: true,
                    addedDate: rxBook._modified,
                    description: "", // Add if needed
                    publisher: "", // Add if needed
                };

                setBook(physicalBook);
                setCurrentPage(physicalBook.currentPage.toString());

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
            } catch (error) {
                console.error("Error loading book:", error);
                toast({
                    title: "Erro ao carregar livro",
                    description: "Tente novamente",
                    variant: "destructive",
                });
            } finally {
                setLoading(false);
            }
        };

        loadBook();
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
            // Update via DataLayer
            const rxBook = await dataLayer.getBook(bookId);
            if (rxBook) {
                await dataLayer.saveBook({
                    ...rxBook,
                    current_page: newPage,
                    _modified: Date.now()
                });
            }

            const percent = Math.round((newPage / book.totalPages) * 100);
            setProgress(bookId, {
                partIndex: 0,
                chapterIndex: 0,
                percent,
                currentPage: newPage,
                totalPages: book.totalPages,
            });

            setBook({ ...book, currentPage: newPage });

            toast({
                title: "Progresso atualizado!",
                description: `Você está na página ${newPage} de ${book.totalPages}`,
            });

            // Update last book ID
            localStorage.setItem('lastBookId', bookId);
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
        try {
            // Update via DataLayer
            const rxBook = await dataLayer.getBook(bookId);
            if (rxBook) {
                await dataLayer.saveBook({
                    ...rxBook,
                    current_page: newPage,
                    _modified: Date.now()
                });
            }

            const percent = Math.round((newPage / book.totalPages) * 100);
            setProgress(bookId, {
                partIndex: 0,
                chapterIndex: 0,
                percent,
                currentPage: newPage,
                totalPages: book.totalPages,
            });
            setBook({ ...book, currentPage: newPage });
            toast({
                title: "Progresso atualizado!",
                description: `Você está na página ${newPage} de ${book.totalPages}`,
            });
            localStorage.setItem('lastBookId', bookId);
        } catch (error) {
            console.error("Error quick adding pages:", error);
            toast({
                title: "Erro ao atualizar progresso",
                description: "Tente novamente",
                variant: "destructive",
            });
        }
    };

    if (loading) {
        return (
            <main className="min-h-screen lg:bg-slate-900 py-10">
                <div className="container mx-auto">
                    <p className="text-center lg:text-white">Carregando...</p>
                </div>
            </main>
        );
    }

    if (!book) {
        return null;
    }

    const progressPercent = Math.round((book.currentPage / book.totalPages) * 100);

    return (
        <main className="min-h-screen lg:bg-slate-900 py-10">
            <SEO
                title={`${book.title} — Rastreamento`}
                description={`Acompanhe seu progresso em ${book.title}`}
                canonical={`/physical/${bookId}`}
            />

            <div className="container mx-auto max-w-3xl">
                <nav className="mb-4 text-sm">
                    <BackLink to="/biblioteca" label="Biblioteca" className="lg:text-slate-300 hover:lg:text-white" />
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
