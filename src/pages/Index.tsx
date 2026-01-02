import Hero from "@/components/app/Hero";
import { BookCover } from "@/components/book/BookCover";

import { updateDailyProgressWidget } from "@/main";
import { Capacitor } from "@capacitor/core";
import { WidgetUpdater, canUseNative } from "@/lib/widgetUpdater";
import { SEO } from "@/components/app/SEO";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useEffect, useMemo, useState } from "react";
import { Progress } from "@/components/ui/progress";
import { BOOKS, type BookMeta } from "@/lib/books";
import { getUserEpubs } from "@/lib/userEpubs";
import { dataLayer } from "@/services/data/RxDBDataLayer";
import { getDatabase } from "@/lib/database/db";
import { differenceInCalendarDays, formatISO, parseISO, format } from "date-fns";
import { useTodayISO } from "@/hooks/use-today";
import { getStreak, getReadingPlan, getProgress, getDailyBaseline, getDailyBaselineAsync, setDailyBaseline, getStats, getLastBookIdAsync, setLastBookId, type Streak, type ReadingPlan, type BaselineEntry } from "@/lib/storage";
import {
  type Part,
  computeTotalWords,
  computeWordsUpToPosition,
  computeWordsUpToInclusiveTarget,
  computePlanProgressPercent,
  computeDaysRemaining,
  computeDailyTargetWords,
  computeAchievedWordsToday,
  computeDailyProgressPercent,
} from "@/lib/reading";
import {
  calculatePagePercent,
  calculateWordPercent,
  percentToPages,
  percentToPagesCeil,
  calculateProgressPercent,
  calculateRatioPercent,
} from "@/lib/percentageUtils";
import { Calendar } from "lucide-react";

// Types now shared via lib/reading

const Index = () => {
  const [userId, setUserId] = useState<string>('local-user');
  const [isAuthLoading, setIsAuthLoading] = useState(true);

  // Listen for auth changes to update userId
  useEffect(() => {
    // Initial check
    import('@/services/auth/SupabaseAuthService').then(({ authService }) => {
      authService.getUser().then(({ user }) => {
        setUserId(user ? user.id : 'local-user');
        setIsAuthLoading(false);
      });

      // Listen for changes
      authService.onAuthStateChange((event, session) => {
        console.log('[Index] 🔐 Auth state change:', event, session?.user?.id);
        setUserId(session?.user ? session.user.id : 'local-user');
        setIsAuthLoading(false);
      });
    });
  }, []);

  const [streak, setStreak] = useState<Streak>(() => getStreak());
  const [used, setUsed] = useState(false);
  const [activeBookId, setActiveBookId] = useState<string | null>(null);
  const [allBooks, setAllBooks] = useState<BookMeta[]>(BOOKS);
  const [parts, setParts] = useState<Part[] | null>(null);
  const [activeIsEpub, setActiveIsEpub] = useState(false);
  const [activeIsPhysical, setActiveIsPhysical] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Reactive progress from RxDB subscription
  const [activeBookProgress, setActiveBookProgress] = useState<{ partIndex: number; chapterIndex: number; percent: number }>(
    { partIndex: 0, chapterIndex: 0, percent: 0 }
  );

  // Reactive plan from RxDB subscription
  const [activePlan, setActivePlan] = useState<ReadingPlan>({ targetDateISO: null });

  // Reactive baseline from RxDB subscription
  const todayISO = useTodayISO();
  const [activeBaseline, setActiveBaseline] = useState<BaselineEntry | null>(null);

  // Physical book info for page calculations
  const [activeBookPhysicalInfo, setActiveBookPhysicalInfo] = useState<{ totalPages: number; currentPage: number } | null>(null);

  const [isReplicationComplete, setIsReplicationComplete] = useState(false);

  // Initialize isReplicationComplete for local-user or wait for event
  useEffect(() => {
    if (userId === 'local-user') {
      setIsReplicationComplete(true);
    } else {
      setIsReplicationComplete(false); // Reset on login to wait for new replication
    }
  }, [userId]);

  // Listen for replication complete event to update state
  useEffect(() => {
    const handleReplication = () => {
      console.log('[Index] 📥 Global replication complete event received');
      setIsReplicationComplete(true);
    };
    window.addEventListener('rxdb-initial-replication-complete', handleReplication);
    return () => window.removeEventListener('rxdb-initial-replication-complete', handleReplication);
  }, []);

  // Subscribe to RxDB for reactive progress updates
  useEffect(() => {
    if (!activeBookId) {
      setActiveBookProgress({ partIndex: 0, chapterIndex: 0, percent: 0 });
      return;
    }

    // Load initial from localStorage immediately
    const localProgress = getProgress(activeBookId);
    setActiveBookProgress(localProgress);

    let subscription: { unsubscribe: () => void } | null = null;

    const loadFromRxDB = async () => {
      try {
        const db = await getDatabase();

        // Try user_epubs first
        const epub = await db.user_epubs.findOne({
          selector: { id: activeBookId, _deleted: false }
        }).exec();

        if (epub) {
          const data = epub.toJSON();
          const dbPercent = data.percentage || 0;
          console.log('[Index] 📚 loadFromRxDB - user_epubs found:', {
            id: activeBookId,
            percent: dbPercent,
            user_id: data.user_id,
            title: data.title
          });
          setActiveBookProgress(prev => ({
            partIndex: 0,
            chapterIndex: 0,
            percent: dbPercent // Trust DB
          }));
          return true;
        }

        // Try books collection
        const book = await db.books.findOne({
          selector: { id: activeBookId, _deleted: false }
        }).exec();

        if (book) {
          const data = book.toJSON();
          let dbPercent = data.percentage || 0;

          // FIX: For physical books, calculate percent from pages dynamically
          // This ensures consistency with Library.tsx and updates reactively when current_page changes
          // Use round: false to keep precision and prevent prematurely rounding 1 page to 0% difference
          if (data.type === 'physical' && data.total_pages && data.total_pages > 0) {
            dbPercent = calculatePagePercent(data.current_page || 0, data.total_pages, { round: false });
            // Store physical book info
            setActiveBookPhysicalInfo({
              totalPages: data.total_pages,
              currentPage: data.current_page || 0
            });
          } else {
            setActiveBookPhysicalInfo(null);
          }

          console.log('[Index] 📚 loadFromRxDB - books found:', { id: activeBookId, percent: dbPercent, type: data.type });
          setActiveBookProgress(prev => ({
            partIndex: data.part_index || prev.partIndex,
            chapterIndex: data.chapter_index || prev.chapterIndex,
            percent: dbPercent // Trust DB
          }));
          return true;
        }

        console.log('[Index] 📚 loadFromRxDB - no book found for:', activeBookId);
        return false;
      } catch (err) {
        console.error('[Index] loadFromRxDB failed:', err);
        return false;
      }
    };

    const setupSubscription = async () => {
      try {
        const db = await getDatabase();

        // Subscribe to user_epubs for user-uploaded EPUB progress
        const epubSub = db.user_epubs.findOne({
          selector: { id: activeBookId, _deleted: false }
        }).$.subscribe(epub => {
          if (epub) {
            const data = epub.toJSON();
            const dbPercent = data.percentage || 0;
            // Take max of DB and current state (which may have localStorage)
            setActiveBookProgress(prev => ({
              partIndex: 0,
              chapterIndex: 0,
              percent: dbPercent // Trust DB
            }));
          }
        });

        // Subscribe to books for physical books and static EPUBs
        const bookSub = db.books.findOne({
          selector: { id: activeBookId, _deleted: false }
        }).$.subscribe(book => {
          if (book) {
            const data = book.toJSON();
            let dbPercent = data.percentage || 0;

            // FIX: For physical books, calculate percent from pages dynamically
            // But prefer the stored percentage if it exists (it's more accurate)
            if (data.type === 'physical' && data.total_pages && data.total_pages > 0) {
              const calculatedPercent = calculatePagePercent(data.current_page || 0, data.total_pages, { round: false });
              // Use stored percentage if available, otherwise calculate
              dbPercent = data.percentage != null ? data.percentage : calculatedPercent;
            }

            console.log('[Index] 📚 Book subscription fired:', {
              bookId: activeBookId,
              type: data.type,
              current_page: data.current_page,
              total_pages: data.total_pages,
              stored_percentage: data.percentage,
              calculated_percent: data.type === 'physical' && data.total_pages ? calculatePagePercent(data.current_page || 0, data.total_pages) : null,
              final_percent: dbPercent
            });

            // Store physical book info for page calculations
            if (data.type === 'physical' && data.total_pages) {
              setActiveBookPhysicalInfo({
                totalPages: data.total_pages,
                currentPage: data.current_page || 0
              });
            } else {
              setActiveBookPhysicalInfo(null);
            }

            // Take max of DB and current state
            setActiveBookProgress(prev => ({
              partIndex: data.part_index || prev.partIndex,
              chapterIndex: data.chapter_index || prev.chapterIndex,
              percent: dbPercent // Trust DB
            }));
          }
        });

        // Combine subscriptions
        subscription = {
          unsubscribe: () => {
            epubSub.unsubscribe();
            bookSub.unsubscribe();
          }
        };
      } catch (err) {
        console.error('[Index] Failed to setup RxDB subscription:', err);
      }
    };

    // Load from RxDB immediately
    loadFromRxDB();

    setupSubscription();

    // Listen for replication complete event
    const handleReplicationComplete = () => {
      console.log('[Index] 📥 Received rxdb-initial-replication-complete event (book progress)');
      loadFromRxDB();
    };

    window.addEventListener('rxdb-initial-replication-complete', handleReplicationComplete);

    return () => {
      subscription?.unsubscribe();
      window.removeEventListener('rxdb-initial-replication-complete', handleReplicationComplete);
    };
  }, [activeBookId]);


  // Subscribe to user_stats for reactive streak and lastBookId updates
  useEffect(() => {
    console.log('[Index] 🚀 useEffect user_stats subscription STARTING for user:', userId);

    // Load from localStorage immediately
    setStreak(getStreak());

    // Also load lastBookId from localStorage immediately
    const cachedLastBookId = localStorage.getItem('lastBookId');
    console.log('[Index] 📦 localStorage lastBookId:', cachedLastBookId);
    if (cachedLastBookId) {
      console.log('[Index] ✅ Setting activeBookId from localStorage:', cachedLastBookId);
      setActiveBookId(cachedLastBookId);
    }

    let subscription: { unsubscribe: () => void } | null = null;

    const loadFromRxDB = async () => {
      try {
        const db = await getDatabase();
        // Filter by specific user_id to avoid picking up stale data from other users
        const docs = await db.user_stats.find({
          selector: {
            user_id: userId,
            _deleted: false
          }
        }).exec();
        console.log('[Index] 🔄 Manual RxDB load - user_stats docs:', docs?.length, 'for user:', userId);
        if (docs && docs.length > 0) {
          const stats = docs[0].toJSON();
          console.log('[Index] 📊 Manual load user_stats data:', {
            user_id: stats.user_id,
            last_book_id: stats.last_book_id,
            streak_current: stats.streak_current
          });
          setStreak({
            current: stats.streak_current || 0,
            longest: stats.streak_longest || 0,
            lastReadISO: stats.last_read_iso || null,
            freezeAvailable: stats.freeze_available ?? true
          });
          if (stats.last_book_id) {
            console.log('[Index] ✅ Setting activeBookId from manual load:', stats.last_book_id);
            setActiveBookId(stats.last_book_id);
            // Also mark as used since we have data from cloud
            setUsed(true);
          }
          return true;
        }
        return false;
      } catch (err) {
        console.error('[Index] Manual RxDB load failed:', err);
        return false;
      }
    };

    const setupSubscription = async () => {
      try {
        console.log('[Index] 🔌 Setting up RxDB user_stats subscription for user:', userId);
        const db = await getDatabase();
        const sub = db.user_stats.find({
          selector: {
            user_id: userId,
            _deleted: false
          }
        }).$.subscribe(docs => {
          console.log('[Index] 📡 user_stats subscription emitted:', docs?.length, 'docs');
          if (docs && docs.length > 0) {
            const stats = docs[0].toJSON();
            console.log('[Index] 📊 user_stats data:', {
              user_id: stats.user_id,
              last_book_id: stats.last_book_id,
              streak_current: stats.streak_current,
              last_read_iso: stats.last_read_iso
            });
            setStreak({
              current: stats.streak_current || 0,
              longest: stats.streak_longest || 0,
              lastReadISO: stats.last_read_iso || null,
              freezeAvailable: stats.freeze_available ?? true
            });
            // Always sync activeBookId from user_stats (reactive to local and cloud changes)
            if (stats.last_book_id) {
              console.log('[Index] ✅ Setting activeBookId from RxDB:', stats.last_book_id);
              setActiveBookId(stats.last_book_id);
              // Also mark as used since we have data from cloud
              setUsed(true);
            } else {
              console.log('[Index] ⚠️ No last_book_id in user_stats');
            }
          } else {
            console.log('[Index] ⚠️ user_stats subscription: no docs found for user:', userId);
          }
        });
        subscription = { unsubscribe: () => sub.unsubscribe() };
        console.log('[Index] ✅ RxDB subscription active');
      } catch (err) {
        console.error('[Index] ❌ Failed to setup user_stats subscription:', err);
      }
    };

    // Load from RxDB immediately
    loadFromRxDB();

    // Setup reactive subscription
    setupSubscription();

    // Listen for the replication complete event
    // This handles the case where subscription was set up before data was pulled from Supabase
    const handleReplicationComplete = () => {
      console.log('[Index] 📥 Received rxdb-initial-replication-complete event');
      loadFromRxDB();
    };

    window.addEventListener('rxdb-initial-replication-complete', handleReplicationComplete);

    return () => {
      console.log('[Index] 🧹 Cleaning up user_stats subscription');
      subscription?.unsubscribe();
      window.removeEventListener('rxdb-initial-replication-complete', handleReplicationComplete);
    };
  }, [userId]); // Re-subscribe when userId changes

  // Subscribe to reading_plans for reactive plan updates
  useEffect(() => {
    if (!activeBookId) {
      setActivePlan({ targetDateISO: null });
      return;
    }

    // Load from localStorage immediately
    setActivePlan(getReadingPlan(activeBookId));

    let subscription: { unsubscribe: () => void } | null = null;

    const loadFromRxDB = async () => {
      try {
        const db = await getDatabase();
        // Use find() with selector (same as subscription) to ensure consistency
        const docs = await db.reading_plans.find({
          selector: { book_id: activeBookId, _deleted: false }
        }).exec();
        if (docs && docs.length > 0) {
          const plan = docs[0].toJSON();
          console.log('[Index] 📅 loadFromRxDB - reading_plan found:', {
            book_id: activeBookId,
            targetDateISO: plan.target_date_iso,
            plan
          });
          setActivePlan({
            targetDateISO: plan.target_date_iso ?? null,
            targetPartIndex: plan.target_part_index,
            targetChapterIndex: plan.target_chapter_index,
            startPercent: plan.start_percent,
            startPartIndex: plan.start_part_index,
            startChapterIndex: plan.start_chapter_index,
            startWords: plan.start_words,
          });
          return true;
        }
        console.log('[Index] 📅 loadFromRxDB - reading_plan not found for:', { book_id: activeBookId });
        return false;
      } catch (err) {
        console.error('[Index] loadFromRxDB reading_plans failed:', err);
        return false;
      }
    };

    const setupSubscription = async () => {
      try {
        const db = await getDatabase();
        // Use find() with selector to better detect new documents being created
        // This works better than findOne() when a document doesn't exist yet
        const sub = db.reading_plans.find({
          selector: { book_id: activeBookId, _deleted: false }
        }).$.subscribe(docs => {
          if (docs && docs.length > 0) {
            const plan = docs[0].toJSON();
            console.log('[Index] 📅 Reading plan subscription fired:', {
              book_id: activeBookId,
              plan,
              targetDateISO: plan.target_date_iso
            });
            setActivePlan({
              targetDateISO: plan.target_date_iso ?? null,
              targetPartIndex: plan.target_part_index,
              targetChapterIndex: plan.target_chapter_index,
              startPercent: plan.start_percent,
              startPartIndex: plan.start_part_index,
              startChapterIndex: plan.start_chapter_index,
              startWords: plan.start_words,
            });
          } else {
            // Document was deleted or doesn't exist - reset plan
            console.log('[Index] 📅 Reading plan subscription: no doc found, resetting plan', { book_id: activeBookId });
            setActivePlan({ targetDateISO: null });
          }
        });
        subscription = { unsubscribe: () => sub.unsubscribe() };
      } catch (err) {
        console.error('[Index] Failed to setup reading_plans subscription:', err);
      }
    };

    // Load from RxDB immediately
    loadFromRxDB();

    setupSubscription();

    // Listen for replication complete event
    const handleReplicationComplete = () => {
      console.log('[Index] 📥 Received rxdb-initial-replication-complete event (reading_plans)');
      loadFromRxDB();
    };

    window.addEventListener('rxdb-initial-replication-complete', handleReplicationComplete);

    return () => {
      subscription?.unsubscribe();
      window.removeEventListener('rxdb-initial-replication-complete', handleReplicationComplete);
    };
  }, [activeBookId, userId]);

  // Subscribe to daily_baselines for reactive baseline updates
  useEffect(() => {
    if (!activeBookId) {
      setActiveBaseline(null);
      return;
    }

    // Load from localStorage immediately
    const localBaseline = getDailyBaseline(activeBookId, todayISO);
    setActiveBaseline(localBaseline);

    let subscription: { unsubscribe: () => void } | null = null;

    const loadFromRxDB = async () => {
      try {
        const db = await getDatabase();
        // Build baselineId with userId (same format as RxDBDataLayer)
        const baselineId = `${userId}:${activeBookId}:${todayISO}`;
        
        let baseline = null;
        
        // Try specific ID first
        const doc = await db.daily_baselines.findOne(baselineId).exec();
        if (doc) {
          baseline = doc.toJSON();
        } else if (userId === 'local-user') {
          // If not found and user is local-user, search for ANY baseline for this book/date
          const docs = await db.daily_baselines.find({
            selector: {
              book_id: activeBookId,
              date_iso: todayISO,
              _deleted: { $eq: false }
            },
            sort: [{ _modified: 'desc' }]
          }).exec();
          
          if (docs && docs.length > 0) {
            baseline = docs[0].toJSON();
            console.log('[Index] 📏 loadFromRxDB - found baseline from authenticated user:', {
              originalUserId: baseline.user_id,
              page: baseline.page,
              percent: baseline.percent
            });
          }
        }
        
        if (baseline) {
          console.log('[Index] 📏 loadFromRxDB - daily_baseline found:', { id: baselineId, baseline });
          setActiveBaseline({
            words: baseline.words || 0,
            percent: baseline.percent || 0,
            page: baseline.page,
            timestamp: baseline._modified
          });
          return true;
        }
        console.log('[Index] 📏 loadFromRxDB - daily_baseline not found:', { baselineId, userId, activeBookId, todayISO });
        return false;
      } catch (err) {
        console.error('[Index] loadFromRxDB daily_baselines failed:', err);
        return false;
      }
    };

    const setupSubscription = async () => {
      try {
        const db = await getDatabase();
        // When logged out (userId='local-user'), search by book_id and date_iso to find baseline
        // from ANY user (especially from previous authenticated session)
        // When logged in, still try specific ID first for performance
        const baselineId = `${userId}:${activeBookId}:${todayISO}`;
        
        if (userId === 'local-user') {
          // For local-user, subscribe to ANY baseline for this book/date
          const sub = db.daily_baselines.find({
            selector: {
              book_id: activeBookId,
              date_iso: todayISO,
              _deleted: { $eq: false }
            },
            sort: [{ _modified: 'desc' }]
          }).$.subscribe(docs => {
            if (docs && docs.length > 0) {
              const baseline = docs[0].toJSON();
              console.log('[Index] 📏 Baseline subscription fired (any user):', {
                baseline,
                bookId: activeBookId,
                originalUserId: baseline.user_id,
                todayISO
              });
              setActiveBaseline({
                words: baseline.words || 0,
                percent: baseline.percent || 0,
                page: baseline.page,
                timestamp: baseline._modified
              });
            } else {
              console.log('[Index] 📏 Baseline subscription: no doc found', { bookId: activeBookId, todayISO });
              setActiveBaseline(null);
            }
          });
          subscription = { unsubscribe: () => sub.unsubscribe() };
        } else {
          // For authenticated user, use specific ID
          const sub = db.daily_baselines.findOne(baselineId).$.subscribe(doc => {
            if (doc) {
              const baseline = doc.toJSON();
              console.log('[Index] 📏 Baseline subscription fired:', {
                baselineId,
                baseline,
                bookId: activeBookId,
                userId,
                todayISO
              });
              setActiveBaseline({
                words: baseline.words || 0,
                percent: baseline.percent || 0,
                page: baseline.page,
                timestamp: baseline._modified
              });
            } else {
              console.log('[Index] 📏 Baseline subscription: no doc found', { baselineId, bookId: activeBookId, userId, todayISO });
              setActiveBaseline(null);
            }
          });
          subscription = { unsubscribe: () => sub.unsubscribe() };
        }
      } catch (err) {
        console.error('[Index] Failed to setup daily_baselines subscription:', err);
      }
    };

    // Load from RxDB immediately
    loadFromRxDB();

    setupSubscription();

    // Listen for replication complete event
    const handleReplicationComplete = () => {
      console.log('[Index] 📥 Received rxdb-initial-replication-complete event (daily_baselines)');
      loadFromRxDB();
    };

    window.addEventListener('rxdb-initial-replication-complete', handleReplicationComplete);

    return () => {
      subscription?.unsubscribe();
      window.removeEventListener('rxdb-initial-replication-complete', handleReplicationComplete);
    };
  }, [activeBookId, todayISO, userId]);

  // Detect prior usage and choose an active book
  useEffect(() => {
    (async () => {
      try {
        const ls = window.localStorage;
        let u = false;

        // Check for lastBookId first (most reliable indicator of prior usage)
        const lastBookId = ls.getItem("lastBookId");
        if (lastBookId) {
          u = true;
          console.log('[Index] 🔍 Prior usage detected via lastBookId:', lastBookId);
        }

        // Also check legacy patterns
        if (!u) {
          for (let i = 0; i < ls.length; i++) {
            const key = ls.key(i) || "";
            if (key.startsWith("progress:") || key.startsWith("plan:")) { u = true; break; }
          }
        }
        if (!u) {
          const sk = ls.getItem("streak");
          const st = sk ? JSON.parse(sk) : null;
          if (st?.lastReadISO) u = true;
        }
        if (!u) {
          const stat = ls.getItem("stats");
          const s = stat ? JSON.parse(stat) : null;
          if (s?.minutesByDate && Object.keys(s.minutesByDate).length > 0) u = true;
        }

        // Also check RxDB for user_stats (handles fresh login on new device)
        if (!u) {
          const db = await getDatabase();
          const userStatsDocs = await db.user_stats.find({ selector: { _deleted: false } }).exec();
          if (userStatsDocs.length > 0) {
            const stats = userStatsDocs[0].toJSON();
            if (stats.last_book_id || stats.streak_current > 0 || stats.total_minutes > 0) {
              u = true;
              console.log('[Index] 🔍 Prior usage detected via RxDB user_stats');
            }
          }
        }

        console.log('[Index] 🔍 Prior usage result:', u);
        setUsed(u);

        // Fallback: if no lastBookId was set via subscription, try to pick first book with plan
        // The subscription from user_stats will set activeBookId if available
        // This is just a fallback for first-time users or when no lastBookId exists
        const last = await getLastBookIdAsync();
        if (!last) {
          for (const b of BOOKS) {
            const plan = getReadingPlan(b.id);
            if (plan?.targetDateISO) {
              setActiveBookId(b.id);
              break;
            }
          }
        }
      } catch { }
    })();
  }, []);

  // Load user books (EPUBs and Physical)
  useEffect(() => {
    const loadBooks = async () => {
      console.log('[Index] 📖 Loading user books...');
      const [userEpubs, rxdbBooks, allUserEpubsFromRxDB] = await Promise.all([
        getUserEpubs(),
        dataLayer.getBooks(),
        dataLayer.getUserEpubs(), // Get all epubs from RxDB (including ones without local blob)
      ]);

      console.log('[Index] 📖 Loaded:', {
        userEpubs: userEpubs.length,
        rxdbBooks: rxdbBooks.length,
        allUserEpubsFromRxDB: allUserEpubsFromRxDB.length
      });
      console.log('[Index] 📚 rxdbBooks encontrados:', rxdbBooks);

      // EPUBs with local blob (can be read)
      const userBooks: BookMeta[] = userEpubs.map(epub => ({
        id: epub.id,
        title: epub.title,
        author: epub.author,
        sourceUrl: URL.createObjectURL(epub.blob),
        description: 'Adicionado pelo usuário',
        coverImage: epub.coverUrl,
        type: 'epub' as const,
        isUserUpload: true,
        addedDate: epub.addedDate,
      }));

      // IDs of epubs that have local blobs
      const localEpubIds = new Set(userEpubs.map(e => e.id));

      // EPUBs from RxDB without local blob (synced from another device, need re-upload)
      const cloudOnlyEpubs: BookMeta[] = allUserEpubsFromRxDB
        .filter(epub => !localEpubIds.has(epub.id))
        .map(epub => ({
          id: epub.id,
          title: epub.title,
          author: epub.author || '',
          description: 'Synced from cloud - re-upload needed to read',
          coverImage: epub.cover_url,
          type: 'epub' as const,
          isUserUpload: true,
          needsReUpload: true, // Flag indicating blob is missing
          addedDate: epub.added_date,
        }));

      if (cloudOnlyEpubs.length > 0) {
        console.log('[Index] 📖 Cloud-only EPUBs (need re-upload):', cloudOnlyEpubs.map(e => e.title));
      }

      const physicalBooksMeta: BookMeta[] = rxdbBooks
        .filter(b => b.type === 'physical')
        .map(book => ({
          id: book.id,
          title: book.title,
          author: book.author || '',
          description: '', // Add if needed
          coverImage: book.cover_url,
          type: 'physical' as const,
          isPhysical: true,
          totalPages: book.total_pages || 0,
          currentPage: book.current_page || 0,
          addedDate: book._modified,
        }));

      setAllBooks([...userBooks, ...cloudOnlyEpubs, ...physicalBooksMeta, ...BOOKS]);
    };

    loadBooks();

    // Listen for replication complete to reload books
    const handleReplicationComplete = () => {
      console.log('[Index] 📥 Received rxdb-initial-replication-complete event (books list)');
      loadBooks();
    };

    window.addEventListener('rxdb-initial-replication-complete', handleReplicationComplete);

    return () => {
      window.removeEventListener('rxdb-initial-replication-complete', handleReplicationComplete);
    };
  }, [userId]);

  // Ensure active book is in allBooks list (handles case where user_id mismatch or not loaded yet)
  useEffect(() => {
    if (!activeBookId) return;

    const existsInAllBooks = allBooks.some(b => b.id === activeBookId);
    if (existsInAllBooks) return;

    // Active book not in allBooks - try to load it directly from RxDB
    const loadActiveBook = async () => {
      const db = await getDatabase();

      // Try user_epubs first
      const epub = await db.user_epubs.findOne({
        selector: { id: activeBookId, _deleted: false }
      }).exec();

      if (epub) {
        const data = epub.toJSON();
        console.log('[Index] 📖 Adding missing active book from user_epubs:', data.title);
        const bookMeta: BookMeta = {
          id: data.id,
          title: data.title,
          author: data.author || '',
          description: 'Synced from cloud - re-upload needed to read',
          coverImage: data.cover_url,
          type: 'epub' as const,
          isUserUpload: true,
          needsReUpload: true,
          addedDate: data.added_date,
        };
        setAllBooks(prev => {
          // Avoid duplicates
          if (prev.some(b => b.id === activeBookId)) return prev;
          return [bookMeta, ...prev];
        });
        return;
      }

      // Try books collection
      const book = await db.books.findOne({
        selector: { id: activeBookId, _deleted: false }
      }).exec();

      if (book) {
        const data = book.toJSON();
        console.log('[Index] 📖 Adding missing active book from books:', data.title);
        const bookMeta: BookMeta = {
          id: data.id,
          title: data.title,
          author: data.author || '',
          description: '',
          coverImage: data.cover_url,
          type: data.type as any || 'epub',
          addedDate: data._modified,
        };
        setAllBooks(prev => {
          if (prev.some(b => b.id === activeBookId)) return prev;
          return [bookMeta, ...prev];
        });
      }
    };

    loadActiveBook();
  }, [activeBookId, allBooks]);

  // Load active book structure to compute progress when needed
  useEffect(() => {
    if (!activeBookId) return;
    const meta = allBooks.find(b => b.id === activeBookId);
    if (!meta) return;

    const isEpub = meta.type === 'epub';
    const isPhysical = meta.type === 'physical';
    setActiveIsEpub(isEpub);
    setActiveIsPhysical(isPhysical);

    // Clear physical book info if not physical
    if (!isPhysical) {
      setActiveBookPhysicalInfo(null);
    }

    if (isEpub || isPhysical) {
      setParts(null);
      return;
    } else {
      const cacheKey = `book:${meta.id}`;
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        try { setParts(JSON.parse(cached)); return; } catch { }
      }
      setLoading(true);
      fetch(meta.sourceUrl!)
        .then(r => r.json())
        .then(json => {
          localStorage.setItem(cacheKey, JSON.stringify(json));
          setParts(json as Part[]);
        })
        .catch(() => setErr("Falha ao carregar o livro para estatísticas."))
        .finally(() => setLoading(false));
    }
  }, [activeBookId, allBooks]);

  // Use reactive plan from RxDB subscription
  const plan = activePlan;
  // Use reactive progress from RxDB subscription
  const p = activeBookProgress;
  const totalWords = useMemo(() => computeTotalWords(parts), [parts]);

  const isPercentBased = (activeBookId?.startsWith('user-') || activeIsEpub || activeIsPhysical);

  const wordsUpToCurrent = useMemo(
    () => isPercentBased ? 0 : computeWordsUpToPosition(parts, { partIndex: p.partIndex, chapterIndex: p.chapterIndex }),
    [isPercentBased, parts, p]
  );
  const targetWords = useMemo(
    () => isPercentBased ? 0 : computeWordsUpToInclusiveTarget(parts, { targetPartIndex: plan.targetPartIndex, targetChapterIndex: plan.targetChapterIndex }, totalWords),
    [isPercentBased, parts, plan, totalWords]
  );

  // Load plan start to compute progress from start to target
  const planStart = useMemo(() => {
    if (!activeBookId) return null as null | { startPartIndex: number; startChapterIndex: number; startWords?: number };
    try {
      const raw = localStorage.getItem(`planStart:${activeBookId}`);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }, [activeBookId]);

  const remainingWords = Math.max(0, targetWords - wordsUpToCurrent);
  // Note: todayISO is defined at the top of the component

  // Get full baseline entry (words + percent) to access exact page count for physical books
  const baselineEntryForToday = useMemo(() => {
    if (!activeBookId) return null;
    // 1. Reactive from RxDB
    if (activeBaseline) return activeBaseline;
    // 2. LocalStorage fallback
    return getDailyBaseline(activeBookId, todayISO);
  }, [activeBookId, activeBaseline, todayISO]);

  // Use reactive baseline from RxDB subscription, with fallback
  const baselineForToday = useMemo(() => {
    // If not local user and replication not complete, don't fallback to current progress yet.
    // This avoids creating a "session-only" baseline that might be wrong.
    const isLocalUser = userId === 'local-user';
    const canUseFallback = isLocalUser || isReplicationComplete;

    if (!activeBookId || isAuthLoading) return (isPercentBased ? (p.percent || 0) : wordsUpToCurrent);

    if (baselineEntryForToday) {
      const result = isPercentBased ? baselineEntryForToday.percent : baselineEntryForToday.words;
      console.log('[Index] 📏 baselineForToday: using entry', { baselineEntryForToday, result, isPercentBased });
      return result;
    }

    if (!canUseFallback) {
      console.log('[Index] 📏 baselineForToday: replication pending, returning current as temporary (will not persist)...');
      return isPercentBased ? (p.percent || 0) : wordsUpToCurrent;
    }

    const fallback = isPercentBased ? (p.percent || 0) : wordsUpToCurrent;
    console.log('[Index] 📏 baselineForToday: using fallback (current progress)', { fallback, p: p.percent, isPercentBased });
    return fallback;
  }, [activeBookId, isPercentBased, wordsUpToCurrent, p.percent, baselineEntryForToday, isAuthLoading, isReplicationComplete, userId]);

  // Persist baseline if missing, with guards and logs
  useEffect(() => {
    if (!activeBookId || isAuthLoading) return;

    const persistBaseline = async () => {
      // 1. Check state first (fastest)
      if (activeBaseline) return;

      // GUARD: Don't create baseline until replication is complete for real users
      if (userId !== 'local-user' && !isReplicationComplete) {
        try { console.log('[Baseline] waiting for replication before creating', { scope: 'Index', bookId: activeBookId }); } catch { }
        return;
      }

      // 2. Check sync local storage (fast)
      const base = getDailyBaseline(activeBookId, todayISO);
      if (base) {
        try { console.log('[Baseline] existente (localStorage)', { scope: 'Index', bookId: activeBookId, todayISO, base }); } catch { }
        return;
      }

      // 3. Check RxDB async (authoritative)
      // This prevents overwriting if data exists in DB but not yet in state/localStorage
      const rxBase = await getDailyBaselineAsync(activeBookId, todayISO);
      if (rxBase) {
        try { console.log('[Baseline] existente (RxDB async)', { scope: 'Index', bookId: activeBookId, todayISO, rxBase }); } catch { }
        return;
      }

      // GUARD: For physical books, wait for page info to ensure precision
      if (activeIsPhysical && !activeBookPhysicalInfo) {
        try { console.log('[Baseline] waiting for physical info', { scope: 'Index', bookId: activeBookId }); } catch { }
        return;
      }

      const hasProgress = isPercentBased ? ((p?.percent ?? 0) > 0) : (wordsUpToCurrent > 0);
      if (!parts && !isPercentBased) {
        try { console.log('[Baseline] skip persist: parts não carregadas', { scope: 'Index', bookId: activeBookId, todayISO, wordsUpToCurrent, p, isPercentBased }); } catch { }
        return;
      }
      if (!hasProgress) {
        try { console.log('[Baseline] skip persist: sem progresso ainda', { scope: 'Index', bookId: activeBookId, todayISO, wordsUpToCurrent, percent: p.percent, isPercentBased }); } catch { }
        return;
      }
      // Use consistent percent: EPUB/Physical uses p.percent; non-EPUB uses words-based totalBookProgressPercent
      const baselinePercent = isPercentBased ? (p.percent || 0) : (parts ? calculateWordPercent(wordsUpToCurrent, totalWords, { round: false }) : 0);

      // For physical books, use specific 'page' field.
      // For others, store wordsUpToCurrent in 'words'.

      const baselineWords = isPercentBased ? 0 : wordsUpToCurrent;
      const baselinePage = (activeIsPhysical && activeBookPhysicalInfo)
        ? activeBookPhysicalInfo.currentPage
        : undefined;

      setDailyBaseline(activeBookId, todayISO, { words: baselineWords, percent: baselinePercent, page: baselinePage });
      try { console.log('[Baseline] persistida', { scope: 'Index', bookId: activeBookId, todayISO, words: baselineWords, percent: baselinePercent, page: baselinePage }); } catch { }
    };

    persistBaseline();
  }, [activeBookId, todayISO, parts, isPercentBased, wordsUpToCurrent, p.percent, totalWords, activeIsPhysical, activeBookPhysicalInfo, isAuthLoading, activeBaseline]);

  const daysRemaining = useMemo(() => computeDaysRemaining(plan?.targetDateISO), [plan]);
  // EPUB/Physical daily target uses percentage instead of words
  const dailyTargetWords = useMemo(
    () => isPercentBased
      ? (daysRemaining ? Math.max(0, 100 - (baselineForToday || 0)) / daysRemaining : null)
      : computeDailyTargetWords(targetWords, baselineForToday, daysRemaining),
    [isPercentBased, targetWords, baselineForToday, daysRemaining]
  );
  const achievedWordsToday = useMemo(
    () => isPercentBased ? Math.max(0, (p.percent || 0) - (baselineForToday || 0)) : computeAchievedWordsToday(wordsUpToCurrent, baselineForToday),
    [isPercentBased, p.percent, baselineForToday, wordsUpToCurrent]
  );

  // Calculate pages for physical books (must be before dailyProgressPercent)
  const pagesReadToday = useMemo(() => {
    if (!activeIsPhysical || !activeBookPhysicalInfo) return null;

    // Get baseline percent (from subscription, localStorage, or current progress)
    const baselinePercent = baselineForToday;

    // Calculate baseline page from baseline percent with better precision
    // Use round for more accurate conversion (baseline percent was likely calculated from a page)
    let baselinePage = 0;

    // NEW: Use exact page from baseline entry if available (more precise for physical books)
    // Find the best baseline page available
    if (baselineEntryForToday?.page !== undefined) {
      baselinePage = baselineEntryForToday.page;
    } else {
      // Fallback: calculate from percent (less precise but works if page info is missing)
      baselinePage = Math.round((baselinePercent / 100) * activeBookPhysicalInfo.totalPages);
    }

    // Pages read today = current page - baseline page
    return Math.max(0, activeBookPhysicalInfo.currentPage - baselinePage);
  }, [activeIsPhysical, activeBookPhysicalInfo, baselineForToday, baselineEntryForToday]);

  const pagesExpectedToday = useMemo(() => {
    if (!activeIsPhysical || !activeBookPhysicalInfo || !dailyTargetWords) return null;
    // dailyTargetWords is in percent for physical books
    // Convert percent to pages (always round up)
    return percentToPagesCeil(dailyTargetWords, activeBookPhysicalInfo.totalPages);
  }, [activeIsPhysical, activeBookPhysicalInfo, dailyTargetWords]);

  const dailyProgressPercent = useMemo(
    () => {
      // For physical books, calculate using pages directly for better precision
      if (activeIsPhysical && pagesReadToday != null && pagesExpectedToday != null && pagesExpectedToday > 0) {
        const result = calculateProgressPercent(pagesReadToday, pagesExpectedToday) ?? 0;
        console.log('[Index] 📊 Daily progress calculation (physical, pages-based):', {
          pagesReadToday,
          pagesExpectedToday,
          dailyProgressPercent: result,
          baselineForToday,
          currentPage: activeBookPhysicalInfo?.currentPage,
          totalPages: activeBookPhysicalInfo?.totalPages,
          baselinePage: activeBookPhysicalInfo ? percentToPages(baselineForToday, activeBookPhysicalInfo.totalPages) : null
        });
        return result;
      }

      // For EPUBs and other books, use the standard calculation
      const result = computeDailyProgressPercent(achievedWordsToday, dailyTargetWords);
      console.log('[Index] 📊 Daily progress calculation:', {
        achievedWordsToday,
        dailyTargetWords,
        dailyProgressPercent: result,
        baselineForToday,
        currentPercent: p.percent,
        isPercentBased
      });
      return result;
    },
    [activeIsPhysical, pagesReadToday, pagesExpectedToday, activeBookPhysicalInfo, baselineForToday, achievedWordsToday, dailyTargetWords, p.percent, isPercentBased]
  );
  const planProgressPercent = useMemo(() => {
    if (isPercentBased) {
      // From plan start percent to 100% target
      const rawStart = planStart?.startWords != null ? planStart.startWords : null; // for type narrowing only

      let startPercent = plan?.startPercent;
      if (startPercent == null) {
        startPercent = (() => { try { const raw = localStorage.getItem(`planStart:${activeBookId}`); const j = raw ? JSON.parse(raw) : null; return j?.startPercent ?? 0; } catch { return 0; } })();
      }
      const denom = Math.max(1, 100 - startPercent);
      const num = Math.max(0, (p.percent || 0) - startPercent);
      return calculateRatioPercent(num, denom, { round: false });
    }
    return computePlanProgressPercent(parts, wordsUpToCurrent, targetWords, planStart);
  }, [isPercentBased, parts, wordsUpToCurrent, targetWords, planStart, p.percent, activeBookId]);

  const totalBookProgressPercent = useMemo(() =>
    isPercentBased
      ? (p.percent || 0)
      : (parts ? calculateWordPercent(wordsUpToCurrent, totalWords) : null),
    [isPercentBased, parts, wordsUpToCurrent, totalWords, p.percent]
  );

  // Current reading position labels
  const currentPartTitle = useMemo(() => {
    if (!parts) return null;
    const part = parts[p.partIndex];
    return part?.part_title ?? null;
  }, [parts, p.partIndex]);
  const currentChapterTitle = useMemo(() => {
    if (!parts) return null;
    const part = parts[p.partIndex];
    const ch = part?.chapters?.[p.chapterIndex];
    return ch?.chapter_title ?? null;
  }, [parts, p.partIndex, p.chapterIndex]);

  // Target labels for the reading plan
  const targetPartTitle = useMemo(() => {
    if (!parts || plan?.targetPartIndex == null) return null;
    const part = parts[plan.targetPartIndex];
    return part?.part_title ?? null;
  }, [parts, plan]);
  const targetChapterTitle = useMemo(() => {
    if (!parts || plan?.targetPartIndex == null || plan?.targetChapterIndex == null) return null;
    const ch = parts[plan.targetPartIndex]?.chapters?.[plan.targetChapterIndex];
    return ch?.chapter_title ?? null;
  }, [parts, plan]);

  const stats = useMemo(() => getStats(), []);
  const minutesToday = stats.minutesByDate[todayISO] || 0;

  // Push widget update when progress/goal changes (native only)
  useEffect(() => {
    const isNative = canUseNative();
    if (!isNative) return;
    const percent = Math.max(0, Math.min(100, dailyProgressPercent || 0));
    const hasGoal = dailyTargetWords != null && dailyTargetWords > 0;
    (async () => {
      try {
        await updateDailyProgressWidget(percent, hasGoal);
        await WidgetUpdater.update?.();
      } catch { }
    })();
  }, [dailyProgressPercent, dailyTargetWords]);

  return (
    <main className="safe-top">
      <SEO
        title="Leitura Devota — Clássicos Católicos"
        description="Crie o hábito de leitura espiritual diária com clássicos católicos em português."
        canonical="/"
      />
      <Hero activeBookId={activeBookId} used={used} />
      <section className="mt-8 grid md:grid-cols-3 gap-6">
        {/* Meta diária (se houver) */}
        <div className="rounded-lg border p-4">
          <h3 className="text-lg font-semibold">Meta diária</h3>
          {used && activeBookId && dailyProgressPercent != null ? (
            <>
              <Progress value={dailyProgressPercent} />
              <p className="text-sm text-muted-foreground mt-2">
                {dailyProgressPercent.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% — {
                  activeIsPhysical && pagesReadToday != null && pagesExpectedToday != null
                    ? `${pagesReadToday}/${pagesExpectedToday} páginas`
                    : isPercentBased
                      ? `${(achievedWordsToday || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}/${(dailyTargetWords || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`
                      : `${achievedWordsToday}/${dailyTargetWords} palavras`
                }
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Marco inicial de hoje:{' '}
                {activeIsPhysical && activeBookPhysicalInfo
                  ? `Página ${baselineEntryForToday?.page ?? 0} de ${activeBookPhysicalInfo.totalPages} do livro`
                  : `${(baselineEntryForToday?.percent ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} % do livro`}
                {baselineEntryForToday?.timestamp && (
                  <span className="block text-[10px] opacity-70">
                    Criado às {format(new Date(baselineEntryForToday.timestamp), 'HH:mm')}
                  </span>
                )}
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">Se tiver uma meta, mostraremos seu progresso diário aqui.</p>
          )}
        </div>

        {/* Meta de leitura: mostra progresso da meta (se houver) */}
        <div className="rounded-lg border p-4">
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <span>Meta de leitura</span>
            {plan?.targetDateISO && (
              <span className="text-base font-normal text-muted-foreground flex items-center gap-1">
                <Calendar className="h-4 w-4" />
                {format(parseISO(plan.targetDateISO), "dd/MM/yyyy")}
              </span>
            )}
          </h3>
          {used && activeBookId && plan?.targetDateISO && planProgressPercent != null ? (
            <>
              <Progress value={planProgressPercent} />
              <p className="text-sm text-muted-foreground mt-2">Meta: {planProgressPercent?.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
                {daysRemaining ? ` • ${daysRemaining} dia(s) restantes` : ""}
              </p>
              {!isPercentBased && parts && plan?.targetPartIndex != null && (
                <p className="text-sm text-muted-foreground mt-1">
                  {`${targetPartTitle ? `${targetPartTitle}` : ""}`}
                  <br />
                  {plan.targetChapterIndex != null ? `${targetChapterTitle ? `${targetChapterTitle}` : ""}` : ""}
                </p>
              )}
            </>
          ) : (
            <p className="text-muted-foreground">Defina uma meta e acompanhe seu avanço.</p>
          )}
        </div>

        {/* Livro ativo */}
        <div className="rounded-lg border p-4">
          <h3 className="text-lg font-semibold">Livro ativo</h3>
          {used ? (
            <>
              <p className="text-muted-foreground text-sm">{activeBookId ? (allBooks.find(b => b.id === activeBookId)?.title || activeBookId) : "—"}</p>
              {activeBookId && totalBookProgressPercent != null && (
                <div className="mt-2">
                  <Progress value={totalBookProgressPercent} />
                  <p className="text-sm text-muted-foreground mt-2">Livro: {totalBookProgressPercent.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</p>
                </div>
              )}
            </>
          ) : (
            <Button asChild variant="link">
              <Link to="/biblioteca">Escolha um livro na biblioteca</Link>
            </Button>
          )}
        </div>
      </section>
      <section className="mt-6 grid md:grid-cols-3 gap-6">
        {/* Marcador do livro (posição atual) */}
        <div className="rounded-lg border p-4">
          <h3 className="text-lg font-semibold">Marcador do livro</h3>
          {used && activeBookId ? (
            isPercentBased ? (
              <>
                <p className="text-sm text-muted-foreground mt-1">{(p.percent || 0).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}% lido</p>
                <div className="mt-2">
                  <Button asChild variant="link">
                    <Link to={activeIsPhysical ? `/physical/${activeBookId}` : `/epub/${activeBookId}`} onClick={() => setLastBookId(activeBookId)}>Continuar leitura</Link>
                  </Button>
                </div>
              </>
            ) : parts ? (
              <>
                <p className="text-sm text-muted-foreground mt-1">
                  {`${currentPartTitle ? `${currentPartTitle}` : ""}`}
                  <br />
                  {`${currentChapterTitle ? `${currentChapterTitle}` : ""}`}
                </p>
                <div className="mt-2">
                  <Button asChild variant="link">
                    <Link to={`/leitor/${activeBookId}`} onClick={() => setLastBookId(activeBookId)}>Continuar leitura</Link>
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-muted-foreground text-sm">Carregando marcador…</p>
            )
          ) : (
            <Button asChild variant="link">
              <Link to="/biblioteca">Escolha um livro na biblioteca</Link>
            </Button>
          )}
        </div>
        {/* Streak diário */}
        <div className="rounded-lg border p-4">
          <h3 className="text-lg font-semibold">Streak diário</h3>
          {used ? (
            <>
              <p className="text-3xl font-bold text-primary">{streak.current} dias</p>
              <p className="text-xs text-muted-foreground">Recorde: {streak.longest} • {streak.lastReadISO ? "Atualizado" : "Ainda não iniciado"}</p>
              {streak.freezeAvailable && (
                <p className="text-xs text-blue-600">🧊 1 congelamento disponível</p>
              )}
            </>
          ) : (
            <p className="text-muted-foreground">Ganhe consistência com sua leitura devocional.</p>
          )}
        </div>
        {/* Minutos hoje */}
        <div className="rounded-lg border p-4">
          <h3 className="text-lg font-semibold">Minutos hoje</h3>
          {used ? (
            <p className="text-2xl font-bold">{minutesToday} min</p>
          ) : (
            <Button asChild variant="link">
              <Link to="/biblioteca">Contabilize seu tempo de leitura</Link>
            </Button>
          )}
        </div>
      </section>
      {err && (
        <div className="mt-4 rounded-lg border p-4">
          <h3 className="text-lg font-semibold">Status</h3>
          <p className="text-muted-foreground text-sm">{err}</p>
        </div>
      )}

    </main>
  );
};

export default Index;
