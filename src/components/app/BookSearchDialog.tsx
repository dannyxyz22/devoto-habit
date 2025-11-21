import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Search, BookPlus } from "lucide-react";
import { searchBookMetadata, type BookSearchResult } from "@/lib/bookMetadataSearch";
import { savePhysicalBook } from "@/lib/physicalBooks";
import { useToast } from "@/components/ui/use-toast";

interface BookSearchDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onBookAdded: () => void;
}

export function BookSearchDialog({ open, onOpenChange, onBookAdded }: BookSearchDialogProps) {
    const [searchQuery, setSearchQuery] = useState("");
    const [isSearching, setIsSearching] = useState(false);
    const [searchResults, setSearchResults] = useState<BookSearchResult[]>([]);
    const [showManualEntry, setShowManualEntry] = useState(false);
    const { toast } = useToast();

    // Manual entry form state
    const [manualTitle, setManualTitle] = useState("");
    const [manualAuthor, setManualAuthor] = useState("");
    const [manualPages, setManualPages] = useState("");

    const handleSearch = async () => {
        if (!searchQuery.trim()) {
            toast({
                title: "Digite algo para buscar",
                description: "Insira um ISBN ou título + autor",
                variant: "destructive",
            });
            return;
        }

        setIsSearching(true);
        setSearchResults([]);
        setShowManualEntry(false);

        try {
            const results = await searchBookMetadata(searchQuery);

            if (results.length === 0) {
                toast({
                    title: "Nenhum resultado encontrado",
                    description: "Tente outra busca ou adicione manualmente",
                });
                setShowManualEntry(true);
            } else {
                setSearchResults(results);
            }
        } catch (error) {
            console.error("Search error:", error);
            toast({
                title: "Erro na busca",
                description: "Tente novamente ou adicione manualmente",
                variant: "destructive",
            });
            setShowManualEntry(true);
        } finally {
            setIsSearching(false);
        }
    };

    const handleSelectBook = async (result: BookSearchResult) => {
        try {
            console.log('[BookSearch] Saving book:', result.title, 'with cover:', !!result.coverUrl);

            await savePhysicalBook({
                title: result.title,
                author: result.author,
                coverUrl: result.coverUrl,
                totalPages: result.totalPages || 0,
                currentPage: 0,
                isbn: result.isbn,
                publisher: result.publisher,
                publishedDate: result.publishedDate,
                description: result.description || "",
            });

            console.log('[BookSearch] Book saved successfully');

            toast({
                title: "Livro adicionado!",
                description: `${result.title} foi adicionado à sua biblioteca`,
            });

            onBookAdded();
            onOpenChange(false);
            resetForm();
        } catch (error) {
            console.error("Error saving book:", error);
            toast({
                title: "Erro ao adicionar livro",
                description: "Tente novamente",
                variant: "destructive",
            });
        }
    };

    const handleManualAdd = async () => {
        if (!manualTitle.trim() || !manualAuthor.trim() || !manualPages) {
            toast({
                title: "Preencha todos os campos",
                description: "Título, autor e número de páginas são obrigatórios",
                variant: "destructive",
            });
            return;
        }

        const totalPages = parseInt(manualPages, 10);
        if (isNaN(totalPages) || totalPages <= 0) {
            toast({
                title: "Número de páginas inválido",
                description: "Digite um número válido de páginas",
                variant: "destructive",
            });
            return;
        }

        try {
            await savePhysicalBook({
                title: manualTitle.trim(),
                author: manualAuthor.trim(),
                totalPages,
                currentPage: 0,
                description: "",
            });

            toast({
                title: "Livro adicionado!",
                description: `${manualTitle} foi adicionado à sua biblioteca`,
            });

            onBookAdded();
            onOpenChange(false);
            resetForm();
        } catch (error) {
            console.error("Error saving manual book:", error);
            toast({
                title: "Erro ao adicionar livro",
                description: "Tente novamente",
                variant: "destructive",
            });
        }
    };

    const resetForm = () => {
        setSearchQuery("");
        setSearchResults([]);
        setShowManualEntry(false);
        setManualTitle("");
        setManualAuthor("");
        setManualPages("");
    };

    return (
        <Dialog open={open} onOpenChange={(newOpen) => {
            onOpenChange(newOpen);
            if (!newOpen) resetForm();
        }}>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Adicionar Livro Físico</DialogTitle>
                    <DialogDescription>
                        Busque por ISBN ou título + autor, ou adicione manualmente
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-4">
                    {/* Search Input */}
                    <div className="flex gap-2">
                        <div className="flex-1">
                            <Input
                                placeholder="ISBN ou título + autor (ex: Imitação de Cristo Tomás de Kempis)"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                            />
                        </div>
                        <Button onClick={handleSearch} disabled={isSearching}>
                            {isSearching ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                                <Search className="h-4 w-4" />
                            )}
                        </Button>
                    </div>

                    {/* Search Results */}
                    {searchResults.length > 0 && (
                        <div className="space-y-2">
                            <h3 className="text-sm font-medium">Resultados da busca:</h3>
                            <div className="space-y-2 max-h-96 overflow-y-auto">
                                {searchResults.map((result, index) => (
                                    <div
                                        key={index}
                                        className="flex gap-3 p-3 border rounded-lg hover:bg-accent cursor-pointer transition-colors"
                                        onClick={() => handleSelectBook(result)}
                                    >
                                        {result.coverUrl && (
                                            <img
                                                src={result.coverUrl}
                                                alt={result.title}
                                                className="w-16 h-24 object-cover rounded"
                                            />
                                        )}
                                        <div className="flex-1 min-w-0">
                                            <h4 className="font-medium truncate">{result.title}</h4>
                                            <p className="text-sm text-muted-foreground">{result.author}</p>
                                            {result.totalPages && (
                                                <p className="text-xs text-muted-foreground">{result.totalPages} páginas</p>
                                            )}
                                            {result.publishedDate && (
                                                <p className="text-xs text-muted-foreground">{result.publishedDate}</p>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Manual Entry Form */}
                    {showManualEntry && (
                        <div className="space-y-4 pt-4 border-t">
                            <div className="flex items-center gap-2">
                                <BookPlus className="h-5 w-5" />
                                <h3 className="text-sm font-medium">Adicionar manualmente</h3>
                            </div>

                            <div className="space-y-3">
                                <div>
                                    <Label htmlFor="manual-title">Título *</Label>
                                    <Input
                                        id="manual-title"
                                        value={manualTitle}
                                        onChange={(e) => setManualTitle(e.target.value)}
                                        placeholder="Título do livro"
                                    />
                                </div>

                                <div>
                                    <Label htmlFor="manual-author">Autor *</Label>
                                    <Input
                                        id="manual-author"
                                        value={manualAuthor}
                                        onChange={(e) => setManualAuthor(e.target.value)}
                                        placeholder="Nome do autor"
                                    />
                                </div>

                                <div>
                                    <Label htmlFor="manual-pages">Número de páginas *</Label>
                                    <Input
                                        id="manual-pages"
                                        type="number"
                                        min="1"
                                        value={manualPages}
                                        onChange={(e) => setManualPages(e.target.value)}
                                        placeholder="300"
                                    />
                                </div>

                                <Button onClick={handleManualAdd} className="w-full">
                                    Adicionar Livro
                                </Button>
                            </div>
                        </div>
                    )}

                    {/* Show manual entry button if no results */}
                    {!showManualEntry && searchResults.length === 0 && !isSearching && (
                        <Button
                            variant="outline"
                            onClick={() => setShowManualEntry(true)}
                            className="w-full"
                        >
                            <BookPlus className="h-4 w-4 mr-2" />
                            Adicionar manualmente
                        </Button>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
