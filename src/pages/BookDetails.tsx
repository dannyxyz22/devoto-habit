import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { dataLayer } from "@/services/data/RxDBDataLayer";
import { getDatabase } from "@/lib/database/db";
import { getUserEpubs } from "@/lib/userEpubs";
import { BOOKS, type BookMeta } from "@/lib/books";
import { getProgress, setProgress, setLastBookId, getReadingPlanAsync, setReadingPlan, getDailyBaselineAsync, setDailyBaseline, type ReadingPlan } from "@/lib/storage";
import { calculatePagePercent } from "@/lib/percentageUtils";
import { getCoverObjectUrl, saveCoverBlob } from "@/lib/coverCache";
import { computeDaysRemaining } from "@/lib/reading";
import { toast } from "@/hooks/use-toast";
import { refreshWidget } from "@/lib/widgetService";

import { BackLink } from "@/components/app/BackLink";
import { SEO } from "@/components/app/SEO";
import { BookCover } from "@/components/book/BookCover";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, ReferenceDot } from "recharts";
import { BookOpen, TrendingUp, Calendar, ArrowRight, Target, Trash2, Plus, Pencil, Upload } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ProgressDataPoint = {
  date: string;
  dateFormatted: string;
  timestamp: number;
  value: number;
  isGoal?: boolean;
};

export default function BookDetails() {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();

  const [book, setBook] = useState<BookMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [progressData, setProgressData] = useState<ProgressDataPoint[]>([]);
  const [showAllData, setShowAllData] = useState(false);
  const [readingPlan, setReadingPlanState] = useState<ReadingPlan | null>(null);
  const [goalDialogOpen, setGoalDialogOpen] = useState(false);
  const [goalDate, setGoalDate] = useState<string>("");
  const [refetchTrigger, setRefetchTrigger] = useState(0);

  // Physical book progress tracking state
  const [currentPageInput, setCurrentPageInput] = useState("");
  const lastAppliedProgressVersionRef = useRef<number>(-1);
  const isUserEditing = useRef(false);
  const persistenceTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Edit dialog state
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editAuthor, setEditAuthor] = useState("");
  const [editTotalPages, setEditTotalPages] = useState("");
  const [editCoverFile, setEditCoverFile] = useState<File | null>(null);
  const [editCoverPreview, setEditCoverPreview] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [coverVersion, setCoverVersion] = useState(0);

  // Daily progress state (for showing today's progress in reading goal card)
  const [baselineForToday, setBaselineForToday] = useState<{ percent: number; page?: number } | null>(null);

  // Determine if book uses pages (physical) or percentage (epub)
  const isPhysical = book?.isPhysical || book?.type === "physical";
  const yAxisLabel = isPhysical ? "Páginas" : "Progresso (%)";
  const yAxisMax = isPhysical ? (book?.totalPages || 100) : 100;

  // Scroll to top when page loads
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Reactive subscription to reading plan changes (sync from other devices)
  useEffect(() => {
    if (!bookId) return;

    let subscription: any;

    const setupSubscription = async () => {
      try {
        const db = await getDatabase();
        
        // Subscribe to reading_plans collection for this book
        subscription = db.reading_plans.findOne({
          selector: { book_id: bookId }
        }).$.subscribe((planDoc) => {
          if (planDoc) {
            const planData = planDoc.toJSON();
            // Check if the plan is deleted or has no valid target date
            if (planData._deleted || !planData.target_date_iso || planData.target_date_iso.trim() === '') {
              console.log('[BookDetails] Reading plan deleted or empty, clearing state');
              setReadingPlanState({ targetDateISO: null });
              setRefetchTrigger((prev) => prev + 1);
            } else {
              console.log('[BookDetails] Reading plan updated:', planData.target_date_iso);
              setReadingPlanState({
                targetDateISO: planData.target_date_iso,
                targetPartIndex: planData.target_part_index,
                targetChapterIndex: planData.target_chapter_index,
                startPercent: planData.start_percent,
                startPartIndex: planData.start_part_index,
                startChapterIndex: planData.start_chapter_index,
                startWords: planData.start_words,
              });
              setRefetchTrigger((prev) => prev + 1);
            }
          } else {
            // No plan document found
            console.log('[BookDetails] No reading plan found for book');
            setReadingPlanState({ targetDateISO: null });
            setRefetchTrigger((prev) => prev + 1);
          }
        });
      } catch (error) {
        console.error('[BookDetails] Error setting up reading plan subscription:', error);
      }
    };

    setupSubscription();

    return () => {
      if (subscription) {
        subscription.unsubscribe();
      }
    };
  }, [bookId]);

  // Reactive subscription to physical book changes (sync from other devices)
  useEffect(() => {
    if (!bookId) return;

    let subscription: any;

    const setupBookSubscription = async () => {
      try {
        const db = await getDatabase();
        const book$ = db.books.findOne(bookId).$;

        subscription = book$.subscribe((rxBook) => {
          if (!rxBook) return;

          const incomingVersion = rxBook.progress_version ?? 0;

          if (incomingVersion < lastAppliedProgressVersionRef.current) {
            console.warn('[BookDetails] Ignored stale progress', {
              incomingVersion,
              lastApplied: lastAppliedProgressVersionRef.current,
              current_page: rxBook.current_page
            });
            return;
          }

          lastAppliedProgressVersionRef.current = incomingVersion;

          const bookData = rxBook.toJSON();
          
          // Update book state for physical books
          if (bookData.type === 'physical') {
            setBook(prev => prev ? {
              ...prev,
              title: bookData.title,
              author: bookData.author || "",
              totalPages: bookData.total_pages || 0,
              currentPage: bookData.current_page || 0,
              percentage: calculatePagePercent(bookData.current_page || 0, bookData.total_pages || 1),
            } : prev);

            // Only update input if user is not currently editing
            if (!isUserEditing.current) {
              setCurrentPageInput((bookData.current_page || 0).toString());
            }
          }
        });
      } catch (error) {
        console.error('[BookDetails] Error setting up book subscription:', error);
      }
    };

    setupBookSubscription();

    return () => {
      if (subscription) {
        subscription.unsubscribe();
      }
    };
  }, [bookId]);

  useEffect(() => {
    if (!bookId) {
      navigate("/biblioteca");
      return;
    }

    const loadBookData = async () => {
      try {
        setLoading(true);

        // Try to find in different sources
        let foundBook: BookMeta | null = null;

        // 1. Check physical books in RxDB
        const rxdbBook = await dataLayer.getBook(bookId);
        if (rxdbBook && rxdbBook.type === "physical") {
          foundBook = {
            id: rxdbBook.id,
            title: rxdbBook.title,
            author: rxdbBook.author || "",
            description: "",
            coverImage: rxdbBook.cover_url,
            type: "physical",
            isPhysical: true,
            totalPages: rxdbBook.total_pages || 0,
            currentPage: rxdbBook.current_page || 0,
            percentage: calculatePagePercent(rxdbBook.current_page || 0, rxdbBook.total_pages || 1),
          };
        }

        // 2. Check user EPUBs
        if (!foundBook) {
          const userEpubs = await getUserEpubs();
          const userEpub = userEpubs.find((e) => e.id === bookId);
          if (userEpub) {
            const localProgress = getProgress(bookId);
            foundBook = {
              id: userEpub.id,
              title: userEpub.title,
              author: userEpub.author,
              description: "Uploaded by user",
              coverImage: userEpub.coverUrl,
              type: "epub",
              isUserUpload: true,
              percentage: localProgress.percent || 0,
            };
          }
        }

        // 3. Check built-in books
        if (!foundBook) {
          const builtIn = BOOKS.find((b) => b.id === bookId);
          if (builtIn) {
            const localProgress = getProgress(bookId);
            foundBook = {
              ...builtIn,
              percentage: localProgress.percent || 0,
            };
          }
        }

        if (!foundBook) {
          navigate("/biblioteca");
          return;
        }

        setBook(foundBook);

        // Initialize currentPageInput for physical books
        if (foundBook.isPhysical || foundBook.type === "physical") {
          setCurrentPageInput((foundBook.currentPage || 0).toString());
        }

        // Load cover from cache if available
        const cachedCover = await getCoverObjectUrl(bookId);
        if (cachedCover) {
          setCoverUrl(cachedCover);
        } else if (foundBook.coverImage) {
          setCoverUrl(foundBook.coverImage);
        }

        // Load baselines for the chart
        const limit = showAllData ? 365 : 90;
        const baselines = await dataLayer.getBaselinesForBook(bookId, limit);

        // Find today's baseline for daily progress calculation
        const todayISO = format(new Date(), "yyyy-MM-dd");
        const todayBaseline = baselines.find(b => b.date_iso === todayISO);
        if (todayBaseline) {
          setBaselineForToday({ percent: todayBaseline.percent, page: todayBaseline.page });
        } else {
          setBaselineForToday(null);
        }

        // Load reading plan (goal)
        const plan = await getReadingPlanAsync(bookId);
        setReadingPlanState(plan);

        // Use foundBook to determine if physical (not state which isn't updated yet)
        const bookIsPhysical = foundBook.isPhysical || foundBook.type === "physical";
        
        // Get current progress for today
        const currentProgress = bookIsPhysical 
          ? foundBook.currentPage || 0
          : foundBook.percentage || 0;
        
        const chartData: ProgressDataPoint[] = baselines.map((baseline) => {
          // For today, use current progress instead of baseline
          const isToday = baseline.date_iso === todayISO;
          const value = isToday 
            ? (bookIsPhysical ? currentProgress : currentProgress)
            : (bookIsPhysical
              ? baseline.page ?? Math.round((baseline.percent / 100) * (foundBook?.totalPages || 100))
              : baseline.percent);

          return {
            date: baseline.date_iso,
            dateFormatted: format(parseISO(baseline.date_iso), "dd MMM", { locale: ptBR }),
            timestamp: parseISO(baseline.date_iso).getTime(),
            value,
          };
        });

        // Add goal point if there's a reading plan with target date
        if (plan.targetDateISO) {
          const goalValue = bookIsPhysical ? (foundBook.totalPages || 100) : 100;
          const goalDate = plan.targetDateISO;
          
          // Check if goal date is after the last baseline date (or if no baselines)
          const lastBaselineDate = chartData.length > 0 ? chartData[chartData.length - 1].date : null;
          
          if (!lastBaselineDate || goalDate >= lastBaselineDate) {
            chartData.push({
              date: goalDate,
              dateFormatted: format(parseISO(goalDate), "dd MMM", { locale: ptBR }),
              timestamp: parseISO(goalDate).getTime(),
              value: goalValue,
              isGoal: true,
            });
          }
        }

        setProgressData(chartData);
      } catch (error) {
        console.error("Error loading book details:", error);
        navigate("/biblioteca");
      } finally {
        setLoading(false);
      }
    };

    loadBookData();
  }, [bookId, navigate, showAllData, refetchTrigger]);

  const handleContinueReading = async () => {
    if (!book || !bookId) return;
    await setLastBookId(bookId);

    // All non-physical books are EPUBs
    navigate(`/epub/${bookId}`);
  };

  // Physical book progress handlers
  const handleUpdateProgress = async () => {
    if (!book || !bookId || !isPhysical) return;

    const newPage = parseInt(currentPageInput, 10);

    if (isNaN(newPage) || newPage < 0 || newPage > (book.totalPages || 0)) {
      toast({
        title: "Página inválida",
        description: `Digite um número entre 0 e ${book.totalPages}`,
        variant: "destructive",
      });
      return;
    }

    try {
      // 1. Advance local version BEFORE writing
      const nextVersion = lastAppliedProgressVersionRef.current + 1;
      lastAppliedProgressVersionRef.current = nextVersion;

      // 2. Optimistic local state update
      setBook(prev => prev ? { ...prev, currentPage: newPage } : prev);

      // 3. Single persistence via DataLayer
      await dataLayer.saveBookProgress(bookId, newPage);

      // 4. Local metrics update
      const percent = calculatePagePercent(newPage, book.totalPages || 1);
      setProgress(bookId, {
        partIndex: 0,
        chapterIndex: 0,
        percent,
        currentPage: newPage,
        totalPages: book.totalPages || 0,
      });

      // 5. Auxiliary metadata
      setLastBookId(bookId);

      // 6. User feedback
      toast({
        title: "Progresso atualizado!",
        description: `Você está na página ${newPage} de ${book.totalPages}`,
      });

      // 7. Update widget
      await refreshWidget(bookId);

      // 8. Trigger chart refresh
      setRefetchTrigger((prev) => prev + 1);
    } catch (error) {
      console.error("Error updating progress:", error);
      toast({
        title: "Erro ao atualizar progresso",
        description: "Tente novamente",
        variant: "destructive",
      });
    }
  };

  const handleQuickAdd = async (pages: number) => {
    if (!book || !bookId || !isPhysical) return;
    const newPage = Math.min((book.currentPage || 0) + pages, book.totalPages || 0);

    // 1. Optimistic UI update immediately
    setCurrentPageInput(newPage.toString());

    const nextVersion = lastAppliedProgressVersionRef.current + 1;
    lastAppliedProgressVersionRef.current = nextVersion;

    setBook(prev => prev ? { ...prev, currentPage: newPage } : prev);

    // 2. Update local storage immediately
    const percent = calculatePagePercent(newPage, book.totalPages || 1);
    setProgress(bookId, {
      partIndex: 0,
      chapterIndex: 0,
      percent,
      currentPage: newPage,
      totalPages: book.totalPages || 0,
    });

    // Feedback
    toast({
      title: "Progresso atualizado!",
      description: `Você está na página ${newPage} de ${book.totalPages}`,
    });

    // Update last book immediately
    setLastBookId(bookId).catch(console.error);

    // 3. Debounced Database Persistence
    if (persistenceTimeoutRef.current) {
      clearTimeout(persistenceTimeoutRef.current);
    }

    persistenceTimeoutRef.current = setTimeout(async () => {
      try {
        await dataLayer.saveBookProgress(bookId, newPage);
        await refreshWidget(bookId);
        setRefetchTrigger((prev) => prev + 1);
      } catch (error) {
        console.error("[Debounced Save] Error:", error);
      }
    }, 1000);
  };

  // Edit dialog handlers
  const handleOpenEditDialog = () => {
    if (!book) return;
    setEditTitle(book.title);
    setEditAuthor(book.author || "");
    setEditTotalPages((book.totalPages || 0).toString());
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
        ...(editCoverFile ? { cover_url: undefined } : {})
      });

      // 3. Update local state immediately
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

  const chartConfig = {
    value: {
      label: isPhysical ? "Página" : "Progresso",
      color: "hsl(var(--primary))",
    },
  };

  // Handle setting a goal
  const handleSetGoal = useCallback(async () => {
    if (!bookId || !goalDate) {
      toast({ title: "Selecione uma data", description: "Escolha uma data de término." });
      return;
    }

    try {
      await setReadingPlan(bookId, goalDate);
      toast({ title: "Meta definida!", description: `Meta: terminar até ${format(parseISO(goalDate), "dd/MM/yyyy")}` });
      setGoalDialogOpen(false);
      setGoalDate("");
      setRefetchTrigger((prev) => prev + 1); // Trigger chart refresh
    } catch (error) {
      console.error("Error setting goal:", error);
      toast({ title: "Erro ao definir meta", description: "Tente novamente.", variant: "destructive" });
    }
  }, [bookId, goalDate]);

  // Handle deleting a goal
  const handleDeleteGoal = useCallback(async () => {
    if (!bookId) return;

    try {
      await setReadingPlan(bookId, null);
      toast({ title: "Meta removida", description: "A meta de leitura foi removida." });
      setRefetchTrigger((prev) => prev + 1); // Trigger chart refresh
    } catch (error) {
      console.error("Error deleting goal:", error);
      toast({ title: "Erro ao remover meta", description: "Tente novamente.", variant: "destructive" });
    }
  }, [bookId]);

  // Open goal dialog with current goal date if exists
  const openGoalDialog = useCallback(() => {
    if (readingPlan?.targetDateISO) {
      setGoalDate(readingPlan.targetDateISO);
    } else {
      setGoalDate("");
    }
    setGoalDialogOpen(true);
  }, [readingPlan]);

  const today = new Date().toISOString().slice(0, 10);

  if (loading) {
    return (
      <main className="safe-top pt-6 min-h-screen bg-background pb-6 md:py-10">
        <div className="container mx-auto px-4">
          <BackLink to="/biblioteca" label="Biblioteca" />
          <div className="mt-6 flex flex-col gap-6 md:grid md:grid-cols-[280px_1fr]">
            <Skeleton className="h-64 w-44 mx-auto md:h-96 md:w-full rounded-lg" />
            <div className="space-y-4">
              <Skeleton className="h-10 w-3/4" />
              <Skeleton className="h-6 w-1/2" />
              <Skeleton className="h-64 w-full" />
            </div>
          </div>
        </div>
      </main>
    );
  }

  if (!book) {
    return null;
  }

  const currentProgress = isPhysical
    ? book.currentPage || 0
    : book.percentage || getProgress(bookId!).percent || 0;

  const progressLabel = isPhysical
    ? `${book.currentPage || 0} / ${book.totalPages} páginas`
    : `${(currentProgress || 0).toFixed(1)}%`;

  return (
    <main className="safe-top pt-6 min-h-screen bg-background pb-6 md:py-10">
      <SEO
        title={`${book.title} — Detalhes`}
        description={`Acompanhe seu progresso em ${book.title}`}
        canonical={`/book/${bookId}`}
      />

      <div className="container mx-auto px-4">
        <BackLink to="/biblioteca" label="Biblioteca" />

        <div className="mt-6 flex flex-col gap-6 md:grid md:grid-cols-[280px_1fr] md:gap-8">
          {/* Book Cover & Info */}
          <div className="space-y-4">
            <div className="overflow-hidden rounded-lg shadow-lg bg-muted aspect-[2/3] w-44 mx-auto md:w-full md:max-w-[280px]">
              {coverUrl ? (
                <img
                  src={coverUrl}
                  alt={`Capa de ${book.title}`}
                  className="w-full h-full object-cover"
                />
              ) : (
              <BookCover bookId={bookId!} coverUrl={book.coverImage} title={book.title} className="w-full h-full" coverVersion={coverVersion} />
              )}
            </div>

            <div className="space-y-2 text-center md:text-left">
              <div className="flex items-center justify-center md:justify-between gap-2">
                <h1 className="text-xl md:text-2xl font-bold leading-tight">{book.title}</h1>
                {isPhysical && (
                  <Button variant="ghost" size="icon" onClick={handleOpenEditDialog} className="h-8 w-8 text-muted-foreground hover:text-foreground">
                    <Pencil className="h-4 w-4" />
                    <span className="sr-only">Editar</span>
                  </Button>
                )}
              </div>
              <p className="text-muted-foreground">{book.author}</p>
            </div>

            {/* Continue Reading button - only for EPUBs */}
            {!isPhysical && (
              <Button onClick={handleContinueReading} className="w-full" size="lg">
                <BookOpen className="mr-2 h-5 w-5" />
                Continuar Leitura
              </Button>
            )}

            {/* Goal Button */}
            <Button onClick={openGoalDialog} variant="outline" className="w-full" size="lg">
              <Target className="mr-2 h-5 w-5" />
              {readingPlan?.targetDateISO ? "Alterar Meta" : "Definir Meta"}
            </Button>
          </div>

          {/* Progress Section */}
          <div className="space-y-6">
            {/* Reading Goal Card */}
            {readingPlan?.targetDateISO && (
              <Card className="border-primary/30 bg-primary/5">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center justify-between text-lg">
                    <span className="flex items-center gap-2">
                      <Target className="h-5 w-5 text-primary" />
                      Meta de Leitura
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleDeleteGoal}
                      className="text-muted-foreground hover:text-destructive h-8 w-8 p-0"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span className="text-lg font-medium">
                      Terminar até {format(parseISO(readingPlan.targetDateISO), "dd/MM/yyyy")}
                    </span>
                  </div>
                  {(() => {
                    const daysRemaining = computeDaysRemaining(readingPlan.targetDateISO);
                    if (daysRemaining === null) return null;
                    
                    // Calculate remaining progress
                    const currentProgressValue = isPhysical
                      ? calculatePagePercent(book?.currentPage || 0, book?.totalPages || 1)
                      : currentProgress || 0;
                    const remainingPercent = Math.max(0, 100 - currentProgressValue);
                    
                    // Daily target
                    const dailyPercentTarget = daysRemaining > 0 ? remainingPercent / daysRemaining : 0;
                    
                    // For physical books, convert to pages
                    const dailyPagesTarget = isPhysical && book?.totalPages && daysRemaining > 0
                      ? Math.ceil((dailyPercentTarget / 100) * book.totalPages)
                      : null;

                    // Calculate today's progress
                    let pagesReadToday: number | null = null;
                    let percentReadToday: number | null = null;
                    let dailyProgressPercent: number | null = null;

                    if (baselineForToday) {
                      if (isPhysical && book?.totalPages) {
                        const baselinePage = baselineForToday.page ?? Math.round((baselineForToday.percent / 100) * book.totalPages);
                        pagesReadToday = Math.max(0, (book.currentPage || 0) - baselinePage);
                        if (dailyPagesTarget && dailyPagesTarget > 0) {
                          dailyProgressPercent = Math.min(100, (pagesReadToday / dailyPagesTarget) * 100);
                        }
                      } else {
                        percentReadToday = Math.max(0, currentProgressValue - baselineForToday.percent);
                        if (dailyPercentTarget > 0) {
                          dailyProgressPercent = Math.min(100, (percentReadToday / dailyPercentTarget) * 100);
                        }
                      }
                    }
                    
                    return (
                      <>
                        <p className="text-sm text-muted-foreground mt-1">
                          {daysRemaining < 0
                            ? "Meta atrasada"
                            : daysRemaining === 1
                              ? "Hoje é o dia!"
                              : `Faltam ${daysRemaining} dias`}
                        </p>
                        {remainingPercent > 0 && daysRemaining > 0 && (
                          <>
                            <p className="text-sm font-medium text-primary mt-2 flex items-center gap-1">
                              <TrendingUp className="h-4 w-4" />
                              Meta diária: {isPhysical && dailyPagesTarget
                                ? `${dailyPagesTarget} página${dailyPagesTarget > 1 ? 's' : ''}`
                                : `${dailyPercentTarget.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
                              }
                            </p>
                            {baselineForToday && dailyProgressPercent !== null && (
                              <div className="mt-2">
                                <div className="flex justify-between text-xs text-muted-foreground mb-1">
                                  <span>Progresso de hoje</span>
                                  <span>
                                    {isPhysical && pagesReadToday !== null && dailyPagesTarget
                                      ? `${pagesReadToday}/${dailyPagesTarget} páginas`
                                      : percentReadToday !== null
                                        ? `${percentReadToday.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}/${dailyPercentTarget.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`
                                        : ''
                                    }
                                  </span>
                                </div>
                                <div className="w-full bg-secondary rounded-full h-2">
                                  <div
                                    className="bg-primary h-2 rounded-full transition-all"
                                    style={{ width: `${Math.min(100, dailyProgressPercent)}%` }}
                                  />
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </>
                    );
                  })()}
                </CardContent>
              </Card>
            )}

            {/* Current Progress Card */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-lg">
                  <TrendingUp className="h-5 w-5 text-primary" />
                  Progresso Atual
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-end gap-4">
                  <span className="text-4xl font-bold text-primary">
                    {isPhysical
                      ? calculatePagePercent(book.currentPage || 0, book.totalPages || 1).toFixed(1)
                      : (currentProgress || 0).toFixed(1)}
                    %
                  </span>
                  <span className="text-muted-foreground mb-1">{progressLabel}</span>
                </div>
                <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className="h-full bg-primary transition-all duration-500"
                    style={{
                      width: `${isPhysical ? calculatePagePercent(book.currentPage || 0, book.totalPages || 1) : currentProgress}%`,
                    }}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Physical Book Progress Update Card */}
            {isPhysical && (
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <BookOpen className="h-5 w-5 text-primary" />
                    Atualizar Progresso
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <label htmlFor="current-page" className="text-sm font-medium mb-2 block">
                      Página atual
                    </label>
                    <div className="flex gap-2">
                      <Input
                        id="current-page"
                        type="number"
                        min="0"
                        max={book.totalPages || 0}
                        value={currentPageInput}
                        onChange={(e) => setCurrentPageInput(e.target.value)}
                        onFocus={() => { isUserEditing.current = true; }}
                        onBlur={() => { isUserEditing.current = false; }}
                        className="flex-1"
                      />
                      <Button onClick={handleUpdateProgress}>Atualizar</Button>
                    </div>
                  </div>

                  <div>
                    <p className="text-sm font-medium mb-2">Adicionar páginas rapidamente:</p>
                    <div className="flex gap-2 flex-wrap">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleQuickAdd(1)}
                        disabled={(book.currentPage || 0) >= (book.totalPages || 0)}
                      >
                        <Plus className="h-3 w-3 mr-1" />1
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleQuickAdd(5)}
                        disabled={(book.currentPage || 0) >= (book.totalPages || 0)}
                      >
                        <Plus className="h-3 w-3 mr-1" />5
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleQuickAdd(10)}
                        disabled={(book.currentPage || 0) >= (book.totalPages || 0)}
                      >
                        <Plus className="h-3 w-3 mr-1" />10
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleQuickAdd(20)}
                        disabled={(book.currentPage || 0) >= (book.totalPages || 0)}
                      >
                        <Plus className="h-3 w-3 mr-1" />20
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Progress Chart */}
            <Card>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Calendar className="h-5 w-5 text-primary" />
                    Evolução da Leitura
                  </CardTitle>
                  {progressData.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowAllData(!showAllData)}
                    >
                      {showAllData ? "Últimos 90 dias" : "Ver tudo"}
                      <ArrowRight className="ml-1 h-4 w-4" />
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="px-2 md:px-6">
                {progressData.length > 0 ? (
                  <ChartContainer config={chartConfig} className="h-[220px] md:h-[300px] w-full">
                    <AreaChart
                      data={progressData}
                      margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
                    >
                      <defs>
                        <linearGradient id="colorValue" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                      <XAxis
                        dataKey="timestamp"
                        type="number"
                        scale="time"
                        domain={['dataMin', 'dataMax']}
                        tick={{ fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(timestamp) => format(new Date(timestamp), "dd MMM", { locale: ptBR })}
                      />
                      <YAxis
                        domain={[0, yAxisMax]}
                        tick={{ fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                        width={35}
                      />
                      <ChartTooltip
                        content={
                          <ChartTooltipContent
                            formatter={(value, name, item) => {
                              const isGoalPoint = item?.payload?.isGoal;
                              if (isGoalPoint) {
                                return isPhysical ? `🎯 Meta: ${value}` : `🎯 Meta: ${value}%`;
                              }
                              return isPhysical ? `${value}` : `${value}%`;
                            }}
                          />
                        }
                      />
                      {/* Actual progress area */}
                      <Area
                        type="linear"
                        dataKey="value"
                        stroke="hsl(var(--primary))"
                        fill="url(#colorValue)"
                        strokeWidth={2}
                        dot={(props: any) => {
                          const { cx, cy, payload } = props;
                          if (payload?.isGoal) {
                            // Goal point - star shape
                            const size = 10;
                            const starPath = (cx: number, cy: number, size: number) => {
                              const angle = Math.PI / 5;
                              const points: string[] = [];
                              for (let i = 0; i < 10; i++) {
                                const r = i % 2 === 0 ? size : size * 0.4;
                                const currentAngle = angle * i - Math.PI / 2;
                                const x = cx + r * Math.cos(currentAngle);
                                const y = cy + r * Math.sin(currentAngle);
                                points.push(`${x},${y}`);
                              }
                              return `M ${points.join(' L ')} Z`;
                            };
                            
                            return (
                              <path
                                key={`goal-${payload.date}`}
                                d={starPath(cx, cy, size)}
                                fill="hsl(var(--chart-2))"
                                stroke="hsl(var(--background))"
                                strokeWidth={2}
                              />
                            );
                          }
                          // Regular point
                          return (
                            <circle
                              key={`dot-${payload?.date}`}
                              cx={cx}
                              cy={cy}
                              r={3}
                              fill="hsl(var(--primary))"
                            />
                          );
                        }}
                        activeDot={{ r: 5 }}
                      />
                    </AreaChart>
                  </ChartContainer>
                ) : (
                  <div className="flex h-[200px] flex-col items-center justify-center text-center text-muted-foreground">
                    <Calendar className="mb-2 h-10 w-10 opacity-50" />
                    <p>Nenhum histórico de leitura disponível</p>
                    <p className="text-sm">
                      Comece a ler para acompanhar seu progresso ao longo do tempo
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Stats Summary */}
            {progressData.length > 1 && (
              <div className="grid gap-4 grid-cols-2">
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-center">
                      <p className="text-sm text-muted-foreground">Dias de leitura</p>
                      <p className="text-3xl font-bold text-primary">
                        {progressData.filter(d => !d.isGoal).length}
                      </p>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-center">
                      <p className="text-sm text-muted-foreground">Início</p>
                      <p className="text-lg font-semibold">
                        {format(parseISO(progressData.find(d => !d.isGoal)?.date || progressData[0].date), "dd/MM/yyyy")}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Goal Dialog */}
      <Dialog open={goalDialogOpen} onOpenChange={setGoalDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {readingPlan?.targetDateISO ? "Alterar meta de leitura" : "Definir meta de leitura"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label htmlFor="goalDate" className="text-sm font-medium">
                Data para concluir a leitura
              </label>
              <Input
                id="goalDate"
                type="date"
                min={today}
                value={goalDate}
                onChange={(e) => setGoalDate(e.target.value)}
                className="mt-1"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Defina uma data para concluir o livro. A meta aparecerá no gráfico de progresso.
            </p>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setGoalDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={handleSetGoal} disabled={!goalDate}>
              {readingPlan?.targetDateISO ? "Atualizar meta" : "Definir meta"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Book Dialog - Physical Books Only */}
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
                      bookId={bookId!}
                      title={book?.title || ""}
                      coverUrl={book?.coverImage}
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
    </main>
  );
}
