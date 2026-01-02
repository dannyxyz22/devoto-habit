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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Pencil, Upload } from "lucide-react";
import { saveCoverBlob } from "@/lib/coverCache";
import { calculatePagePercent } from "@/lib/percentageUtils";




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

    // Edit Dialog State
    const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
    const [editTitle, setEditTitle] = useState("");
    const [editAuthor, setEditAuthor] = useState("");
    const [editTotalPages, setEditTotalPages] = useState("");
    const [editCoverFile, setEditCoverFile] = useState<File | null>(null);
    const [editCoverPreview, setEditCoverPreview] = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);
    const [coverVersion, setCoverVersion] = useState(0);




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

                    setBook(physicalBook);

                    // Only update input if user is not currently editing
                    if (!isUserEditing.current) {
                        setCurrentPage(physicalBook.currentPage.toString());
                    }

                    // Initialize progress in storage
                    const todayISO = format(new Date(), "yyyy-MM-dd");
                    // Determine if we need to update local storage progress
                    const existingProgress = getProgress(bookId);

                    // Update if missing or if page count is out of sync (e.g. from cloud sync)
                    if (!existingProgress || existingProgress.currentPage !== physicalBook.currentPage) {
                        const percent = calculatePagePercent(physicalBook.currentPage, physicalBook.totalPages);
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

                    // Create if missing OR repair if missing 'page' property for physical book
                    if (!baseline || (baseline.page === undefined)) {
                        // Use current page as baseline. 
                        // Note: If user already read today and we are just loading now, using currentPage 
                        // might mean daily progress = 0. But for a fresh "start of day", this is correct.
                        // If repairing, we technically don't know the "start" page, so using current is the safest fallback 
                        // to avoid negative progress or wild jumps, enabling tracking FROM NOW.
                        const percent = calculatePagePercent(physicalBook.currentPage, physicalBook.totalPages);

                        setDailyBaseline(bookId, todayISO, {
                            words: 0,
                            percent,
                            page: physicalBook.currentPage // Explicitly save page for physical books
                        });

                        console.log('[PhysicalBookTracker] 📏 Baseline initialized/repaired:', {
                            bookId,
                            page: physicalBook.currentPage,
                            wasMissing: !baseline
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
            setBook(
                prev => prev
                    ? { ...prev, currentPage: newPage }
                    : prev
            );

            // 3. Persistência única via DataLayer
            await dataLayer.saveBookProgress(bookId, newPage);

            // 4. Atualização de métricas locais
            const percent = calculatePagePercent(newPage, book.totalPages);
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

    const handleOpenEditDialog = () => {
        if (!book) return;
        setEditTitle(book.title);
        setEditAuthor(book.author);
        setEditTotalPages(book.totalPages.toString());
        setEditCoverFile(null);
        setEditCoverPreview(null);
        setIsEditDialogOpen(true);
    };

    const handleCoverFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setEditCoverFile(file);
            const reader = new FileReader();
            reader.onloadend = () => {
                setEditCoverPreview(reader.result as string);
            };
            reader.readAsDataURL(file);
        }
    };

    const handleSaveMetadata = async () => {
        if (!book || !bookId) return;

        const newTotalPages = parseInt(editTotalPages, 10);
        if (!editTitle.trim() || !editAuthor.trim() || isNaN(newTotalPages) || newTotalPages <= 0) {
            toast({
                title: "Dados inválidos",
                description: "Verifique os campos preenchidos",
                variant: "destructive",
            });
            return;
        }

        setIsSaving(true);
        try {
            // 1. Save cover if changed
            if (editCoverFile) {
                await saveCoverBlob(bookId, editCoverFile);
                setCoverVersion(v => v + 1);
            }

            // 2. Update book metadata
            await dataLayer.saveBook({
                id: bookId,
                title: editTitle.trim(),
                author: editAuthor.trim(),
                total_pages: newTotalPages,
                // If we uploaded a new cover, we want to ensure we don't keep using an old external URL
                // But we don't want to wipe it if we didn't change it.
                // If editCoverFile is present, we can set cover_url to null or keep it as is?
                // If we set it to null, useCoverImage will fail to find external URL and look in cache.
                // If we keep it, useCoverImage checks cache FIRST. So it should be fine.
                // However, if we want to be sure, we can clear it if a local file is provided.
                ...(editCoverFile ? { cover_url: undefined } : {})
            });

            // 3. Update local state immediately for responsiveness
            setBook(prev => prev ? {
                ...prev,
                title: editTitle.trim(),
                author: editAuthor.trim(),
                totalPages: newTotalPages
            } : null);

            setIsEditDialogOpen(false);
            toast({
                title: "Livro atualizado!",
                description: "As informações foram salvas com sucesso.",
            });
        } catch (error) {
            console.error("Error updating book:", error);
            toast({
                title: "Erro ao salvar",
                description: "Não foi possível atualizar o livro.",
                variant: "destructive",
            });
        } finally {
            setIsSaving(false);
        }
    };

    const persistenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Updated quick add: automatically persists progress and updates UI
    const handleQuickAdd = async (pages: number) => {
        if (!book || !bookId) return;
        const newPage = Math.min(book.currentPage + pages, book.totalPages);

        // 1. Optimistic UI update immediately
        setCurrentPage(newPage.toString());

        const nextVersion = lastAppliedProgressVersionRef.current + 1;
        lastAppliedProgressVersionRef.current = nextVersion;

        setBook(
            prev => prev
                ? { ...prev, currentPage: newPage }
                : prev
        );

        // 2. Update local storage immediately (cheap synchronous op)
        const percent = calculatePagePercent(newPage, book.totalPages);
        setProgress(bookId, {
            partIndex: 0,
            chapterIndex: 0,
            percent,
            currentPage: newPage,
            totalPages: book.totalPages,
        });

        // Feedback
        toast({
            title: "Progresso atualizado!",
            description: `Você está na página ${newPage} de ${book.totalPages}`,
        });

        // Update last book immediately
        setLastBookId(bookId).catch(console.error);

        // 3. Debounced Database Persistence
        // Clear pending save to avoid overwriting with intermediate state
        if (persistenceTimeoutRef.current) {
            clearTimeout(persistenceTimeoutRef.current);
        }

        persistenceTimeoutRef.current = setTimeout(async () => {
            try {
                console.log(`[Debounced Save] Saving final page: ${newPage} for book ${bookId}`);
                await dataLayer.saveBookProgress(bookId, newPage);
                console.log('[Debounced Save] Success');
            } catch (error) {
                console.error("[Debounced Save] Error:", error);
                // Since this is delayed, showing a toast here might be confusing if the user has moved on,
                // but we should log it.
            }
        }, 1000); // Wait 1 second after last click
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

    const progressPercent = calculatePagePercent(book.currentPage, book.totalPages);

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
                                coverVersion={coverVersion}
                            />
                            <div className="flex-1">
                                <div className="flex items-start justify-between gap-2">
                                    <CardTitle className="text-2xl mb-2">{book.title}</CardTitle>
                                    <Button variant="ghost" size="icon" onClick={handleOpenEditDialog} className="h-8 w-8 text-muted-foreground hover:text-foreground">
                                        <Pencil className="h-4 w-4" />
                                        <span className="sr-only">Editar</span>
                                    </Button>
                                </div>
                                <p className="text-muted-foreground">{book.author}</p>
                                {book.publisher && (
                                    <p className="text-sm text-muted-foreground mt-1">{book.publisher}</p>
                                )}
                            </div>
                        </div>
                    </CardHeader>
                </Card>

                <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
                    <DialogContent>
                        <DialogHeader>
                            <DialogTitle>Editar Livro</DialogTitle>
                            <DialogDescription>
                                Altere as informações do livro ou a capa.
                            </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4 py-2">
                            <div className="space-y-2">
                                <Label htmlFor="edit-title">Título</Label>
                                <Input
                                    id="edit-title"
                                    value={editTitle}
                                    onChange={(e) => setEditTitle(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="edit-author">Autor</Label>
                                <Input
                                    id="edit-author"
                                    value={editAuthor}
                                    onChange={(e) => setEditAuthor(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label htmlFor="edit-pages">Total de Páginas</Label>
                                <Input
                                    id="edit-pages"
                                    type="number"
                                    value={editTotalPages}
                                    onChange={(e) => setEditTotalPages(e.target.value)}
                                />
                            </div>
                            <div className="space-y-2">
                                <Label>Capa do Livro</Label>
                                <div className="flex items-center gap-4">
                                    <div className="w-16 h-24 bg-muted rounded overflow-hidden flex-shrink-0 border">
                                        {editCoverPreview ? (
                                            <img src={editCoverPreview} alt="Preview" className="w-full h-full object-cover" />
                                        ) : (
                                            <BookCover
                                                bookId={bookId}
                                                title={book.title}
                                                coverUrl={book.coverUrl}
                                                className="w-full h-full"
                                            />
                                        )}
                                    </div>
                                    <div className="flex-1">
                                        <Label htmlFor="cover-upload" className="cursor-pointer inline-flex items-center gap-2 px-4 py-2 bg-secondary text-secondary-foreground hover:bg-secondary/80 rounded-md text-sm font-medium transition-colors">
                                            <Upload className="w-4 h-4" />
                                            Escolher nova capa
                                        </Label>
                                        <Input
                                            id="cover-upload"
                                            type="file"
                                            accept="image/*"
                                            className="hidden"
                                            onChange={handleCoverFileChange}
                                        />
                                        <p className="text-xs text-muted-foreground mt-2">
                                            A imagem será salva apenas neste dispositivo.
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <DialogFooter>
                            <Button variant="outline" onClick={() => setIsEditDialogOpen(false)}>Cancelar</Button>
                            <Button onClick={handleSaveMetadata} disabled={isSaving}>
                                {isSaving ? "Salvando..." : "Salvar Alterações"}
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                </Dialog>

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
