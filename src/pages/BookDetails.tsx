import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { ptBR } from "date-fns/locale";
import { dataLayer } from "@/services/data/RxDBDataLayer";
import { getUserEpubs } from "@/lib/userEpubs";
import { BOOKS, type BookMeta } from "@/lib/books";
import { getProgress, setLastBookId, getReadingPlanAsync, type ReadingPlan } from "@/lib/storage";
import { calculatePagePercent } from "@/lib/percentageUtils";
import { getCoverObjectUrl } from "@/lib/coverCache";

import { BackLink } from "@/components/app/BackLink";
import { SEO } from "@/components/app/SEO";
import { BookCover } from "@/components/book/BookCover";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, ReferenceDot } from "recharts";
import { BookOpen, TrendingUp, Calendar, ArrowRight, Target } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

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
  const [readingPlan, setReadingPlan] = useState<ReadingPlan | null>(null);

  // Determine if book uses pages (physical) or percentage (epub)
  const isPhysical = book?.isPhysical || book?.type === "physical";
  const yAxisLabel = isPhysical ? "Páginas" : "Progresso (%)";
  const yAxisMax = isPhysical ? (book?.totalPages || 100) : 100;

  // Scroll to top when page loads
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

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

        // Load reading plan (goal)
        const plan = await getReadingPlanAsync(bookId);
        setReadingPlan(plan);

        // Use foundBook to determine if physical (not state which isn't updated yet)
        const bookIsPhysical = foundBook.isPhysical || foundBook.type === "physical";
        
        const chartData: ProgressDataPoint[] = baselines.map((baseline) => {
          const value = bookIsPhysical
            ? baseline.page ?? Math.round((baseline.percent / 100) * (foundBook?.totalPages || 100))
            : baseline.percent;

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
  }, [bookId, navigate, showAllData]);

  const handleContinueReading = async () => {
    if (!book || !bookId) return;
    await setLastBookId(bookId);

    if (isPhysical) {
      navigate(`/physical/${bookId}`);
    } else if (book.type === "epub" || book.isUserUpload) {
      navigate(`/epub/${bookId}`);
    } else {
      navigate(`/leitor/${bookId}`);
    }
  };

  const chartConfig = {
    value: {
      label: isPhysical ? "Página" : "Progresso",
      color: "hsl(var(--primary))",
    },
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-background py-6 md:py-10">
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
    <main className="min-h-screen bg-background py-6 md:py-10">
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
              <BookCover bookId={bookId!} coverUrl={book.coverImage} title={book.title} className="w-full h-full" />
              )}
            </div>

            <div className="space-y-2 text-center md:text-left">
              <h1 className="text-xl md:text-2xl font-bold leading-tight">{book.title}</h1>
              <p className="text-muted-foreground">{book.author}</p>
            </div>

            <Button onClick={handleContinueReading} className="w-full" size="lg">
              <BookOpen className="mr-2 h-5 w-5" />
              Continuar Leitura
            </Button>
          </div>

          {/* Progress Section */}
          <div className="space-y-6">
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
                                return isPhysical ? `🎯 Meta: ${value} páginas` : `🎯 Meta: ${value}%`;
                              }
                              return isPhysical ? `${value} páginas` : `${value}%`;
                            }}
                          />
                        }
                      />
                      {/* Actual progress area */}
                      <Area
                        type="monotone"
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
                      <p className="text-3xl font-bold text-primary">{progressData.length}</p>
                    </div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-6">
                    <div className="text-center">
                      <p className="text-sm text-muted-foreground">Início</p>
                      <p className="text-lg font-semibold">
                        {format(parseISO(progressData[0].date), "dd/MM/yyyy")}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
