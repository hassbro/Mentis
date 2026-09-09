'use client';
import { useState, useEffect, Suspense, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase, DAILY_DOUBLE_CHANNEL } from '@/lib/supabase';
import {
  RefreshCw,
  Trophy,
  Plus,
  Settings,
  Trash2,
  Flame,
  Zap
} from 'lucide-react';

/**
 * Host board with Final Mentis flow:
 * - startFinalMentis() creates a final_round id and inserts blank final_submissions rows for approved teams
 * - host waits for wagers (clients upsert final_submissions.wager)
 * - Reveal Question enabled once all wagers exist (or host forces)
 * - Reveal starts 30s countdown (published in game_state.final_countdown_expires_at)
 * - buzzer clients submit answer text to final_submissions.answer
 * - Host marks correctness (checkbox per team), clicks Calculate => updates teams' scores accordingly
 *
 * Relies on game_state fields:
 * - final_started (boolean)
 * - final_round (text)
 * - final_countdown_expires_at (timestamptz | null)
 * - active_question_id, question_revealed, answer_revealed (as usual)
 *
 * Requires final_submissions table (SQL provided separately).
 */

function MentisLogo({ isDJ, isFinal }: { isDJ: boolean; isFinal: boolean }) {
  const label = isFinal ? 'Final Mentis' : isDJ ? 'Double Mentis' : 'Trivia & Intellect';
  const color = isFinal ? 'text-purple-400' : isDJ ? 'text-sky-400' : 'text-amber-400';
  const gradient = isFinal ? 'from-purple-400 to-purple-600' : isDJ ? 'from-sky-400 to-sky-600' : 'from-amber-400 to-amber-600';

  return (
    <div className="flex items-center gap-3 select-none">
      <div className={`relative w-10 h-10 bg-gradient-to-br ${gradient} rounded-xl p-0.5 shadow-lg flex items-center justify-center`}>
        <div className="w-full h-full bg-[#181c25] rounded-[10px] flex items-center justify-center">
          <svg viewBox="0 0 24 24" className={`w-5 h-5 ${color} fill-current`} xmlns="http://www.w3.org/2000/svg">
            <path d="M3 17V7C3 5.89543 3.89543 5 5 5H7C7.55228 5 8.05228 5.22386 8.41421 5.58579L12 9.17157L15.5858 5.58579C15.9477 5.22386 16.4477 5 17 5H19C20.1046 5 21 5.89543 21 7V17C21 18.1046 20.1046 19 19 19H5C3.89543 19 3 18.1046 3 17Z" />
          </svg>
        </div>
      </div>

      <div className="flex flex-col">
        <span className="text-xl font-black tracking-[0.2em] text-slate-100">MENTIS</span>
        <span className={`text-[9px] tracking-[0.3em] uppercase ${color} font-bold -mt-1`}>{label}</span>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={
      <main className="min-h-screen bg-[#181c25] text-slate-100 flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-300 font-medium text-lg animate-pulse">
          <RefreshCw className="w-5 h-5 animate-spin" /> Loading MENTIS...
        </div>
      </main>
    }>
      <GameContent />
    </Suspense>
  );
}

function GameContent() {
  const [roundParam, setRoundParam] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return new URLSearchParams(window.location.search).get('round');
    }
    return null;
  });
  const [gameEnded, setGameEnded] = useState(false);
  const [winnerDetails, setWinnerDetails] = useState<{ name: string; score: number } | null>(null);

  // board state
  const [categories, setCategories] = useState<any[]>([]);
  const [questionsMap, setQuestionsMap] = useState<{ [catId: number]: { [points: number]: any | null } }>({});
  const [boardPoints, setBoardPoints] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);

  const [round, setRound] = useState<'jeopardy' | 'double_jeopardy' | 'final'>('jeopardy');
  const [answeredQuestions, setAnsweredQuestions] = useState<{ [qId: number]: boolean }>({});
  const [dailyDoubles, setDailyDoubles] = useState<Set<number>>(new Set());
  
  // Simple ID-based tracking for used categories
  const [jeopardyCategoryIds, setJeopardyCategoryIds] = useState<number[]>([]);

  // active question
  const [activeQuestion, setActiveQuestion] = useState<any | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  // daily double
  const [isDailyDoubleScreen, setIsDailyDoubleScreen] = useState(false);
  const [wagerAmount, setWagerAmount] = useState<string>('');
  const [wagerError, setWagerError] = useState<string>('');
  const [receivedWagers, setReceivedWagers] = useState<{ teamId: number; wager: number }[]>([]);

  // final
  const [finalQuestion, setFinalQuestion] = useState<any | null>(null);
  const [finalRoundId, setFinalRoundId] = useState<string | null>(null);
  const [finalSubs, setFinalSubs] = useState<any[]>([]); // live final_submissions rows
  const [revealEnabled, setRevealEnabled] = useState(false);
  const [isQuestionVisible, setIsQuestionVisible] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null); // seconds remaining
  const countdownTimerRef = useRef<number | null>(null);
  const [chosenCorrectTeamIds, setChosenCorrectTeamIds] = useState<number[]>([]);
  const [showFinalModal, setShowFinalModal] = useState(false);
  const [showFinalQuestionAlert, setShowFinalQuestionAlert] = useState(false);

  // teams & side
  const [teams, setTeams] = useState<any[]>([]);
  const [newTeamName, setNewTeamName] = useState('');
  const [activeTeamIndex, setActiveTeamIndex] = useState<number>(0);

  // buzzer & game_state
  const [buzzerActive, setBuzzerActive] = useState(false);
  const [buzzerWinnerName, setBuzzerWinnerName] = useState<string | null>(null);
  const [gameMode, setGameMode] = useState<'buzzer' | 'turn' | 'unknown'>('unknown');
  const [currentTurnTeamId, setCurrentTurnTeamId] = useState<number | null>(null);

  // channel refs (for safe cleanup / reuse)
  const finalSubsChannelRef = useRef<any | null>(null);
  const gameStateChannelRef = useRef<any | null>(null);
  const dailyDoubleChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // --- Channel helpers ---
  function createChannel(name: string) {
    return supabase.channel(name);
  }

  async function safeSubscribe(ch: any) {
    try {
      const r = ch.subscribe();
      if (r && typeof r.then === 'function') {
        await r.catch((e: any) => console.warn('channel subscribe failed', e));
      }
    } catch (e) {
      console.warn('channel.subscribe threw', e);
    }
  }

  function safeRemoveChannel(ch: any) {
    if (!ch) return;
    try {
      const clientAny: any = supabase as any;
      if (typeof clientAny.removeChannel === 'function') {
        try { clientAny.removeChannel(ch); } catch (e) { /* ignore */ }
      } else {
        if (ch && typeof ch.unsubscribe === 'function') {
          try { ch.unsubscribe(); } catch (e) { /* ignore */ }
        } else if (ch && typeof ch.remove === 'function') {
          try { ch.remove(); } catch (e) { /* ignore */ }
        } else {
          console.debug('safeRemoveChannel: unknown channel shape', ch);
        }
      }
    } catch (err) {
      console.warn('safeRemoveChannel error', err);
    }
  }

  async function fetchTeams() {
    const { data } = await supabase.from('teams').select('*').eq('approved', true).order('score', { ascending: false });
    if (data) setTeams(data);
  }
  useEffect(() => { fetchTeams(); }, []);

  // Receive daily double wagers submitted from buzzer clients
  useEffect(() => {
    const ch = createChannel(`host_daily_double_${Date.now()}`);
    ch.on('broadcast', { event: 'wager_submitted' }, (msg: { payload?: { teamId?: number; wager?: number } }) => {
      const teamId = Number(msg?.payload?.teamId);
      const wager = Number(msg?.payload?.wager);
      if (!teamId || Number.isNaN(wager)) return;
      setReceivedWagers(prev => [...prev.filter(w => w.teamId !== teamId), { teamId, wager }]);
      setWagerAmount(String(wager));
    });
    safeSubscribe(ch);
    dailyDoubleChannelRef.current = ch;
    return () => {
      safeRemoveChannel(dailyDoubleChannelRef.current);
      dailyDoubleChannelRef.current = null;
    };
  }, []);

  useEffect(() => {
    const targetRound = (roundParam === 'double_jeopardy' || roundParam === 'final') ? roundParam : 'jeopardy';
    if (targetRound === 'final') startFinalMentis();
    else {
      const boardRound: 'jeopardy' | 'double_jeopardy' = targetRound === 'double_jeopardy' ? 'double_jeopardy' : 'jeopardy';
      setRound(boardRound);
      fetchGameData(boardRound).then(() => ensureCurrentTurn());
    }
  }, [roundParam]);

  // Real-time listener for who buzzed first
  useEffect(() => {
    const channel = supabase
      .channel('main_board_buzzers_realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'buzzers' },
        async (payload: any) => {
          const b = payload.new;
          if (!b) return;
          
          if (b.winner_team_id) {
            const { data: t } = await supabase.from('teams').select('name').eq('id', b.winner_team_id).maybeSingle();
            setIsQuestionVisible(payload.new.is_question_visible ?? false);
            setBuzzerWinnerName(t?.name ?? null);
          } else {
            setBuzzerWinnerName(null);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Subscribe to game_state to track reveal timestamps and final round changes
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('game_state').select('*').maybeSingle();
      if (data) {
        setGameMode((data.mode as any) ?? 'unknown');
        setCurrentTurnTeamId(data.current_turn_team_id ?? null);

        if (data.final_started && data.final_round) {
          setFinalRoundId(data.final_round);
          loadFinalSubmissions(data.final_round);
          subscribeFinalSubmissions(data.final_round);
        } else {
          setFinalRoundId(null);
        }

        if (data.final_countdown_expires_at) {
          startLocalCountdown(data.final_countdown_expires_at);
        }
      }
    })();

    const ch = createChannel('host_game_state_sub');
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'game_state' }, async (payload: any) => {
      if (!payload.new) return;
      const gs = payload.new;
      setGameMode((gs.mode as any) ?? 'unknown');
      setCurrentTurnTeamId(gs.current_turn_team_id ?? null);

      if (gs.final_started && gs.final_round) {
        setFinalRoundId(gs.final_round);
        await loadFinalSubmissions(gs.final_round);
        subscribeFinalSubmissions(gs.final_round);
      } else {
        setFinalRoundId(null);
        setFinalSubs([]);
      }

      if (gs.final_countdown_expires_at) {
        startLocalCountdown(gs.final_countdown_expires_at);
      } else {
        setCountdown(null);
        if (countdownTimerRef.current) { window.clearInterval(countdownTimerRef.current); countdownTimerRef.current = null; }
      }

      setShowAnswer(!!gs.answer_revealed);
    });

    safeSubscribe(ch);
    gameStateChannelRef.current = ch;

    return () => {
      safeRemoveChannel(gameStateChannelRef.current);
      gameStateChannelRef.current = null;
    };
  }, [teams]);

  async function fetchGameData(currentRound: 'jeopardy' | 'double_jeopardy') {
    setLoading(true);
    
    const { data: catData } = await supabase.from('categories').select('*');
    if (!catData) { setLoading(false); return; }
    
    const filtered = catData.filter(c => !(String(c.name || '').toLowerCase().includes('final')));
    
    // Deduplicate by name first to handle duplicate category entries
    const categoryMap = new Map<string, any>();
    filtered.forEach(c => {
      const name = String(c.name || '').trim().toLowerCase();
      if (!categoryMap.has(name)) {
        categoryMap.set(name, c);
      }
    });
    const uniqueList = Array.from(categoryMap.values());

    console.log('=== CATEGORY SELECTION DEBUG ===');
    console.log('Current round:', currentRound);
    console.log('All available categories:', uniqueList.map(c => ({ id: c.id, name: c.name })));

    let selectedCategories: any[];
    let boardSeedIds: number[] = [];

    try {
      // Use database to store shuffled category IDs for randomness across games
      const { data: settings } = await supabase.from('app_settings').select('category_shuffle_ids').maybeSingle();
      
      if (currentRound === 'jeopardy') {
        // Reuse the stored shuffle so reloading the board keeps the same categories
        // and clues; a new shuffle is only generated for a fresh game (admin launch
        // and reset both clear category_shuffle_ids).
        const savedIds: number[] = settings?.category_shuffle_ids || [];
        const savedAreValid = savedIds.length > 0 && savedIds.some(id => uniqueList.some(c => c.id === id));
        const shuffledIds = savedAreValid
          ? savedIds
          : [...uniqueList].sort(() => Math.random() - 0.5).map(c => c.id);

        if (!savedAreValid) {
          await supabase.from('app_settings').upsert({
            id: 1,
            category_shuffle_ids: shuffledIds
          }, { onConflict: 'id' });
        }
        boardSeedIds = shuffledIds;
        console.log('Jeopardy: Using shuffle', shuffledIds, savedAreValid ? '(restored)' : '(new)');
        
        // Reconstruct categories from shuffled IDs
        const categoryPairs = shuffledIds
          .map((id: number) => [id, uniqueList.find(c => c.id === id)] as [number, any])
          .filter(([id, cat]) => cat !== undefined);
        const idMap = new Map(categoryPairs);
        const shuffledCategories = Array.from(idMap.values());
        
        // Use first half for Jeopardy
        const midpoint = Math.ceil(shuffledCategories.length / 2);
        const firstHalf = shuffledCategories.slice(0, midpoint);
        selectedCategories = firstHalf.slice(0, Math.min(5, firstHalf.length));
        console.log('Jeopardy: Selected from first half of shuffled list');
        console.log('Selected:', selectedCategories.map(c => ({ id: c.id, name: c.name })));
      } else {
        // Double Jeopardy: use saved shuffle from database
        const shuffledIds: number[] = settings?.category_shuffle_ids || [];
        boardSeedIds = shuffledIds;
        console.log('Double Jeopardy: Using saved shuffle from DB:', shuffledIds);
        
        // Reconstruct categories from shuffled IDs
        const categoryPairs = shuffledIds
          .map((id: number): [number, any] => [id, uniqueList.find(c => c.id === id)])
          .filter((pair): pair is [number, any] => pair[1] !== undefined);
        const idMap = new Map(categoryPairs);
        const shuffledCategories = Array.from(idMap.values());
        
        // Use second half for Double Jeopardy
        const midpoint = Math.ceil(shuffledCategories.length / 2);
        const secondHalf = shuffledCategories.slice(midpoint);
        selectedCategories = secondHalf.slice(0, Math.min(5, secondHalf.length));
        console.log('Double Jeopardy: Selected from second half of shuffled list');
        console.log('Selected:', selectedCategories.map(c => ({ id: c.id, name: c.name })));
      }
    } catch (e) {
      console.error('Database shuffle failed, using ID division fallback:', e);
      // Fallback: deterministic ID division
      const sortedBy = [...uniqueList].sort((a, b) => a.id - b.id);
      const midpoint = Math.ceil(sortedBy.length / 2);
      
      if (currentRound === 'jeopardy') {
        const firstHalf = sortedBy.slice(0, midpoint);
        const shuffled = [...firstHalf].sort(() => Math.random() - 0.5);
        selectedCategories = shuffled.slice(0, Math.min(5, firstHalf.length));
        console.log('Jeopardy Fallback: First half shuffled');
      } else {
        const secondHalf = sortedBy.slice(midpoint);
        const shuffled = [...secondHalf].sort(() => Math.random() - 0.5);
        selectedCategories = shuffled.slice(0, Math.min(5, secondHalf.length));
        console.log('Double Jeopardy Fallback: Second half shuffled');
      }
    }

    console.log('Selected categories for this round:', selectedCategories.map(c => ({ id: c.id, name: c.name })));

    setCategories(selectedCategories);

    const standardPoints = currentRound === 'double_jeopardy' ? [200,400,600,800,1000,2000] : [100,200,300,400,500,1000];
    setBoardPoints(standardPoints);

    const catIds = selectedCategories.map(c => c.id);
    // Filter out already answered questions globally
    const { data: qData } = await supabase.from('questions').select('*').in('category_id', catIds).eq('is_answered', false);

    console.log('=== QUESTION SELECTION DEBUG ===');
    console.log('Available questions (is_answered=false):', qData?.length || 0);
    console.log('Filter applied: category_id in', catIds, 'AND is_answered=false');

    // Seeded RNG so the same board (clues + daily doubles) is rebuilt on reload
    // instead of re-rolling questions, which made clues repeat across reloads.
    const seedSource = `${currentRound}:${(boardSeedIds.length ? boardSeedIds : selectedCategories.map(c => c.id)).join(',')}`;
    let seed = 2166136261;
    for (let i = 0; i < seedSource.length; i++) {
      seed ^= seedSource.charCodeAt(i);
      seed = Math.imul(seed, 16777619);
    }
    const seededRandom = () => {
      seed |= 0;
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };

    const map: { [catId: number]: { [points: number]: any | null } } = {};
    const assignedIds = new Set<number>();

    selectedCategories.forEach(cat => {
  map[cat.id] = {};

  standardPoints.forEach(pt => {
    // Find ALL matching questions for this category/point combination
    const candidates = (qData || []).filter((q: any) => {
      const adjusted = currentRound === 'double_jeopardy'
        ? q.points * 2
        : q.points;

      return (
        q.category_id === cat.id &&
        adjusted === pt &&
        !assignedIds.has(q.id)
      );
    });

    // Randomly select one if multiple exist
    const ordered = [...candidates].sort((a: { id: number }, b: { id: number }) => a.id - b.id);
    const candidate = ordered.length > 0
      ? ordered[Math.floor(seededRandom() * ordered.length)]
      : null;

    if (candidate) {
      // Debug: Check what fields are available
      console.log(`Candidate object keys:`, Object.keys(candidate));
      console.log(`Candidate object:`, candidate);
      
      const questionText = candidate.question || candidate.clue || candidate.question_text || candidate.text || 'NO TEXT FIELD';
      const questionPreview = questionText ? questionText.substring(0, 50) : 'EMPTY';
      console.log(`Found question for ${cat.name} ${pt}: ID ${candidate.id}, Question: "${questionPreview}..." (out of ${candidates.length} candidates)`);
      
      // Only assign if question has valid text
      if (questionText && questionText.trim() !== '') {
        map[cat.id][pt] = {
          ...candidate,
          points: pt
        };
        assignedIds.add(candidate.id);
      } else {
        console.log(`Question ID ${candidate.id} has no text, skipping...`);
        map[cat.id][pt] = null;
      }
    } else {
      console.log(`No question found for ${cat.name} ${pt}`);
      map[cat.id][pt] = null;
    }
  });
});

    const assignedQuestions = Object.values(map)
      .flatMap(pm => Object.values(pm).filter(Boolean))
      .sort((a: { id: number }, b: { id: number }) => a.id - b.id);
    const shuffled = [...assignedQuestions].sort(() => seededRandom() - 0.5);
    const ddSet = new Set<number>(shuffled.slice(0, Math.min(2, shuffled.length)).map((q: any) => q.id));
    setDailyDoubles(ddSet);

    setQuestionsMap(map);

    // Broadcast categories to cast page for mirroring using httpSend
    try {
      const channel = supabase.channel('cast_categories_sync');
      await channel.send({
        type: 'broadcast',
        event: 'categories_update',
        payload: {
          categories: selectedCategories,
          questionsMap: map,
          round: currentRound
        }
      });
    } catch (e) {
      console.log('Broadcast failed (channel might not be ready):', e);
    }

    setLoading(false);
  }

  // In turn mode the first turn must be published before the first question,
  // otherwise the opening team also receives the next turn.
  async function ensureCurrentTurn() {
    const { data: gs } = await supabase.from('game_state').select('mode,current_turn_team_id').maybeSingle();
    if (!gs || gs.mode !== 'turn' || gs.current_turn_team_id) return;

    const { data: teamsData } = await supabase.from('teams').select('id').eq('approved', true).order('id', { ascending: true });
    if (!teamsData || teamsData.length === 0) return;

    await supabase.from('game_state').update({ current_turn_team_id: teamsData[0].id }).eq('id', 1);
    setCurrentTurnTeamId(teamsData[0].id);
  }

  async function startFinalMentis() {
    setLoading(true);
    try {
      const { data: finalCats } = await supabase
  .from('categories')
  .select('id')
  .ilike('name', '%final%');

let finalQ = null;

if (finalCats && finalCats.length > 0) {
  const catIds = finalCats.map((c: any) => c.id);

  const { data: qList } = await supabase
    .from('questions')
    .select('*')
    .in('category_id', catIds)
    .eq('is_answered', false);

  if (qList && qList.length > 0) {
    const shuffledFinals = [...qList].sort(() => Math.random() - 0.5);
    finalQ = shuffledFinals[0];
  }
}

// Fallback: if no unanswered final questions, try any unanswered question
if (!finalQ) {
  const { data: anyQ } = await supabase
    .from('questions')
    .select('*')
    .eq('is_answered', false)
    .limit(1);
  
  if (anyQ && anyQ.length > 0) {
    finalQ = anyQ[0];
  }
}

if (!finalQ) {
  setShowFinalQuestionAlert(true);
  setLoading(false);
  return;
}

      const finalRound = new Date().toISOString();
      setFinalRoundId(finalRound);
      setFinalQuestion(finalQ ?? null);
      setActiveQuestion(finalQ ?? null);
      setShowAnswer(false);

      const { data: approved } = await supabase.from('teams').select('id').eq('approved', true);
      if (approved && approved.length > 0) {
        const payload = approved.map((t: any) => ({
          team_id: t.id,
          final_round: finalRound,
          wager: null,
          answer: null,
          is_correct: null
        }));
        await supabase.from('final_submissions').upsert(payload, { onConflict: ['team_id', 'final_round'] as any });
      }

      await supabase.from('game_state').upsert({
        id: 1,
        final_started: true,
        final_round: finalRound,
        final_countdown_expires_at: null,
        active_question_id: finalQ ? finalQ.id : null,
        is_question_visible: false,
        answer_revealed: false
      });

      await loadFinalSubmissions(finalRound);
      subscribeFinalSubmissions(finalRound);
    } catch (err) {
      console.error('startFinalMentis error', err);
    } finally {
      setLoading(false);
    }
  }

  async function loadFinalSubmissions(finalRound: string | null) {
    if (!finalRound) return;
    const { data } = await supabase.from('final_submissions').select('*').eq('final_round', finalRound);
    if (data) setFinalSubs(data);
    evaluateRevealEnabled(data ?? []);
  }

  function evaluateRevealEnabled(subs: any[]) {
    const approvedTeamIds = new Set(teams.map(t => t.id));
    const entriesCount = subs.filter(s => s && s.wager !== null && approvedTeamIds.has(s.team_id)).length;
    setRevealEnabled(entriesCount >= teams.length && teams.length > 0);
  }

  function subscribeFinalSubmissions(finalRound: string | null) {
    if (finalSubsChannelRef.current) {
      try { safeRemoveChannel(finalSubsChannelRef.current); } catch (e) { /* ignore */ }
      finalSubsChannelRef.current = null;
    }
    if (!finalRound) return;

    const chName = `final_subs_${finalRound}_${Date.now()}_${Math.floor(Math.random()*10000)}`;
    const ch = createChannel(chName);

    ch.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'final_submissions', filter: `final_round=eq.${finalRound}` },
      (payload: any) => {
        loadFinalSubmissions(finalRound).catch(err => console.error('loadFinalSubmissions err', err));
      }
    );

    safeSubscribe(ch);
    finalSubsChannelRef.current = ch;
  }

  async function revealQuestionForFinal(force = false) {
    if (!force && (!finalRoundId || !revealEnabled)) {
      return;
    }

    const expiresAt = new Date(Date.now() + 30_000).toISOString();
    
    const { error } = await supabase.from('game_state').update({
      is_question_visible: true,
      final_countdown_expires_at: expiresAt
    }).eq('id', 1);

    if (!error) {
      setIsQuestionVisible(true);
    }

    startLocalCountdown(expiresAt);
  }

  function startLocalCountdown(expiresAtIso: string) {
    const end = new Date(expiresAtIso).getTime();
    if (countdownTimerRef.current) {
      window.clearInterval(countdownTimerRef.current);
      countdownTimerRef.current = null;
    }
    const tick = () => {
      const now = Date.now();
      const remaining = Math.max(0, Math.ceil((end - now) / 1000));
      setCountdown(remaining);
      if (remaining <= 0 && countdownTimerRef.current) {
        window.clearInterval(countdownTimerRef.current);
        countdownTimerRef.current = null;
      }
    };
    tick();
    countdownTimerRef.current = window.setInterval(tick, 250);
  }

  async function revealFinalAnswer() {
    await supabase.from('game_state').update({ answer_revealed: true }).eq('id', 1);
    setShowAnswer(true);
  }

  // FIXED & COMPLETED calculateFinalResults logic
  async function calculateFinalResults(chosenCorrectTeamIds: number[]) {
    if (!finalRoundId) return;
    
    const { data: subs } = await supabase.from('final_submissions').select('*').eq('final_round', finalRoundId);
    if (!subs) return;

    if (finalQuestion?.id) {
      await supabase.from('questions').update({ is_answered: true }).eq('id', finalQuestion.id);
    }

    let updatedTeamsList = [...teams];

    for (const team of teams) {
      const sub = subs.find((s: any) => s.team_id === team.id);
      const wager = (sub && sub.wager) ? Number(sub.wager) : 0;
      const isCorrect = chosenCorrectTeamIds.includes(team.id);
      const newScore = isCorrect ? team.score + wager : team.score - wager;
      
      await supabase.from('teams').update({ score: newScore }).eq('id', team.id);
      
      await supabase.from('final_submissions').update({
        is_correct: isCorrect
      }).match({ team_id: team.id, final_round: finalRoundId });

      // Update local array for immediate winner calculation
      const target = updatedTeamsList.find(t => t.id === team.id);
      if (target) target.score = newScore;
    }

    // Sort teams to find the highest score
    updatedTeamsList.sort((a, b) => b.score - a.score);
    const topWinner = updatedTeamsList[0] || null;

    // End final round state in database
    await supabase.from('game_state').update({
      final_started: false,
      final_round: null,
      final_countdown_expires_at: null,
      active_question_id: null,
      is_question_visible: false,
      answer_revealed: false
    }).eq('id', 1);

    setFinalRoundId(null);
    setFinalQuestion(null);
    setActiveQuestion(null);
    setTeams(updatedTeamsList);
    
    if (topWinner) {
      setWinnerDetails({ name: topWinner.name, score: topWinner.score });
      setGameEnded(true); // Trigger winner screen on host

      console.log('=== WINNER BROADCAST DEBUG ===');
      console.log('Broadcasting winner to cast page:', topWinner);
      console.log('Teams being broadcast:', updatedTeamsList);
      console.log('Broadcast payload:', {
        winner: { name: topWinner.name, score: topWinner.score },
        teams: updatedTeamsList,
        gameEnded: true
      });

      // Update game_state with winner flags for polling
      await supabase.from('game_state').update({
        game_over: true,
        winner_screen: true
      }).eq('id', 1);

      // Broadcast winner details to cast page
      try {
        const channel = supabase.channel('cast_categories_sync');
        console.log('Host: Using channel:', channel);
        const broadcastResult = await channel.send({
          type: 'broadcast',
          event: 'game_winner',
          payload: {
            winner: { name: topWinner.name, score: topWinner.score },
            teams: updatedTeamsList,
            gameEnded: true
          }
        });
        console.log('Host: Winner broadcast sent successfully, result:', broadcastResult);
      } catch (e: any) {
        console.error('Host: Final winner broadcast failed:', e.message);
      }
    }
  }

  async function handleCellClick(question: any) {
    if (!question || answeredQuestions[question.id]) return;

    setActiveQuestion(question);
    setShowAnswer(false);
    setWagerError('');

    try {
      await supabase.from('game_state').update({
        active_question_id: question.id,
        question_revealed: true,
        answer_revealed: false
      }).eq('id', 1);
    } catch (e) {
      console.error('Failed to publish active question to game_state', e);
    }

    try {
      await supabase.channel('cast_categories_sync').send({
        type: 'broadcast',
        event: 'active_question_meta',
        payload: {
          questionId: question.id,
          categoryName: categories.find(c => c.id === question.category_id)?.name ?? null,
          points: question.points,
          isDailyDouble: dailyDoubles.has(question.id)
        }
      });
    } catch (e) {
      console.error('Failed to broadcast active question meta', e);
    }

    if (dailyDoubles.has(question.id)) {
      setIsDailyDoubleScreen(true);
      setReceivedWagers([]);
      const score = wagerTeam()?.score || 0;
      setWagerAmount(String(Math.max(question.points, score)));
      await broadcastDailyDouble(question);
    } else setIsDailyDoubleScreen(false);
  }

  function wagerTeam() {
    const eligibleId = gameMode === 'buzzer'
      ? teams.find(t => t.name === buzzerWinnerName)?.id ?? null
      : currentTurnTeamId;
    return teams.find(t => t.id === eligibleId) ?? teams[activeTeamIndex];
  }

  async function broadcastDailyDouble(question: { id: number; points: number }) {
    const eligibleTeamId = wagerTeam()?.id ?? null;
    try {
      await supabase.channel(DAILY_DOUBLE_CHANNEL).send({
        type: 'broadcast',
        event: 'daily_double_start',
        payload: { questionId: question.id, points: question.points, eligibleTeamId }
      });
    } catch (e) {
      console.error('Failed to broadcast daily double', e);
    }
  }

  async function endDailyDouble() {
    try {
      await supabase.channel(DAILY_DOUBLE_CHANNEL).send({
        type: 'broadcast',
        event: 'daily_double_end',
        payload: {}
      });
    } catch (e) {
      console.error('Failed to broadcast daily double end', e);
    }
  }

  // Closes the clue with no score change (e.g. nobody buzzed) and burns the tile
  async function cancelActiveQuestion() {
    if (!activeQuestion) return;

    await supabase.from('questions').update({ is_answered: true }).eq('id', activeQuestion.id);

    try {
      await supabase.from('game_state').update({
        active_question_id: null,
        question_revealed: false,
        answer_revealed: false
      }).eq('id', 1);
    } catch (e) {
      console.error('Failed to clear active question in game_state', e);
    }

    await supabase.from('buzzers').update({ active: false, winner_team_id: null }).eq('id', 1);
    setBuzzerActive(false);
    await endDailyDouble();

    if (gameMode === 'turn') await setNextTurnInDB();

    setAnsweredQuestions(prev => ({ ...prev, [activeQuestion.id]: true }));
    setActiveQuestion(null);
    setShowAnswer(false);
    setIsDailyDoubleScreen(false);
    setWagerAmount('');
    setWagerError('');
    setReceivedWagers([]);
  }

  async function revealAnswerHandler() {
    try {
      await supabase.from('game_state').update({ answer_revealed: true }).eq('id', 1);
    } catch (e) {
      console.error('Failed to publish answer reveal', e);
    }
    setShowAnswer(true);
  }

  async function setNextTurnInDB() {
    try {
      const { count: unanswered } = await supabase.from('questions').select('*', { head: true, count: 'exact' }).eq('is_answered', false);
      if ((unanswered ?? 0) <= 0) {
        await supabase.from('game_state').update({ current_turn_team_id: null }).eq('id', 1);
        return;
      }

      const { data: teamsData } = await supabase.from('teams').select('id').eq('approved', true).order('id', { ascending: true });
      if (!teamsData || teamsData.length === 0) {
        await supabase.from('game_state').update({ current_turn_team_id: null }).eq('id', 1);
        return;
      }
      const teamIds = teamsData.map((t: any) => t.id);

      const { data: gs } = await supabase.from('game_state').select('current_turn_team_id').maybeSingle();
      const currentId = gs?.current_turn_team_id ?? null;

      let nextId: number;
      if (!currentId) nextId = teamIds[0];
      else {
        const idx = teamIds.indexOf(currentId);
        nextId = idx === -1 ? teamIds[0] : teamIds[(idx + 1) % teamIds.length];
      }

      await supabase.from('game_state').update({ current_turn_team_id: nextId }).eq('id', 1);
    } catch (err) {
      console.error('setNextTurnInDB error', err);
    }
  }

  async function handleScoreAdjustment(correct: boolean) {
    if (!activeQuestion) return;

    const isDD = dailyDoubles.has(activeQuestion.id);
    const pointsToUse = isDD ? (parseInt(wagerAmount) || 0) : activeQuestion.points;

    console.log('=== SCORE ADJUSTMENT DEBUG ===');
    console.log('Game mode:', gameMode);
    console.log('Active question:', activeQuestion);
    console.log('Points to use:', pointsToUse);
    console.log('Correct:', correct);
    console.log('Buzzer winner name:', buzzerWinnerName);

    // In buzzer mode, use the buzzer winner from local state
    let scoringTeamId;
    if (gameMode === 'buzzer' && buzzerWinnerName) {
      // Find team by name
      const scoringTeam = teams.find(t => t.name === buzzerWinnerName);
      scoringTeamId = scoringTeam?.id;
      console.log('Buzzer mode: Using buzzer winner name:', buzzerWinnerName);
      console.log('Buzzer mode: Found team by name:', scoringTeam);
    } else if (gameMode === 'buzzer') {
      // Fallback to database if name not available
      const { data: buzzerData } = await supabase.from('buzzers').select('winner_team_id').eq('id', 1).maybeSingle();
      scoringTeamId = buzzerData?.winner_team_id;
      console.log('Buzzer mode: Buzzer data:', buzzerData);
      console.log('Buzzer mode: Using buzzer winner team ID:', scoringTeamId);
    } else {
      const { data: gs } = await supabase.from('game_state').select('current_turn_team_id').maybeSingle();
      scoringTeamId = gs?.current_turn_team_id ?? (teams[activeTeamIndex] && teams[activeTeamIndex].id);
      console.log('Turn mode: Game state:', gs);
      console.log('Turn mode: Using current turn team ID:', scoringTeamId);
    }
    
    const scoringTeam = teams.find(t => t.id === scoringTeamId) ?? teams[activeTeamIndex];
    console.log('Scoring team:', scoringTeam, 'Team ID:', scoringTeamId);
    console.log('All teams:', teams);

    if (scoringTeam) {
      const updatedScore = correct ? scoringTeam.score + pointsToUse : scoringTeam.score - pointsToUse;
      console.log('Current score:', scoringTeam.score, 'Updated score:', updatedScore);
      await supabase.from('teams').update({ score: updatedScore }).eq('id', scoringTeam.id);
      await fetchTeams();
    } else {
      console.warn('No scoring team found!');
    }

    // Mark question as answered globally to prevent repetition
    console.log('Marking question as answered:', activeQuestion.id);
    await supabase.from('questions').update({ is_answered: true }).eq('id', activeQuestion.id);

    try {
      await supabase.from('game_state').update({
        active_question_id: null,
        question_revealed: false,
        answer_revealed: false
      }).eq('id', 1);
    } catch (e) {
      console.error('Failed to clear active question in game_state', e);
    }

    if (gameMode === 'turn') {
      await setNextTurnInDB();
    }

    await endDailyDouble();

    setAnsweredQuestions(prev => ({ ...prev, [activeQuestion.id]: true }));
    setActiveQuestion(null);
    setShowAnswer(false);
    setIsDailyDoubleScreen(false);
    setWagerAmount('');
    setWagerError('');
    setReceivedWagers([]);
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-[#181c25] text-slate-100 flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-300 font-medium text-lg animate-pulse">
          <RefreshCw className="w-5 h-5 animate-spin" /> Loading MENTIS...
        </div>
      </main>
    );
  }

  // --- WINNER / FINAL LEADERBOARD SCREEN ---
  if (gameEnded) {
    return (
      <main className="min-h-screen bg-[#181c25] text-slate-100 flex flex-col items-center justify-center p-6">
        <div className="max-w-xl w-full bg-[#222733] border border-[#2f3748] rounded-3xl p-8 shadow-2xl text-center space-y-6">
          <MentisLogo isDJ={false} isFinal={true} />

          {winnerDetails && (
            <div className="bg-gradient-to-r from-amber-500/20 via-amber-400/30 to-amber-500/20 border border-amber-400/40 rounded-2xl p-6 shadow-inner">
              <div className="flex items-center justify-center gap-2 text-amber-300 text-sm font-bold uppercase tracking-widest mb-1">
                <Trophy className="w-5 h-5 text-amber-400 animate-bounce" /> Grand Champion <Trophy className="w-5 h-5 text-amber-400 animate-bounce" />
              </div>
              <div className="text-4xl font-black text-amber-200 tracking-wide mt-2">
                {winnerDetails.name.toUpperCase()}
              </div>
              <div className="text-xs text-slate-400 mt-1">Final Score: {winnerDetails.score} points</div>
            </div>
          )}

          <div className="space-y-3 text-left">
            <div className="text-xs uppercase text-slate-400 font-bold tracking-wider px-1">Final Standings</div>
            <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
              {teams.map((team, index) => (
                <div key={team.id} className="p-4 rounded-xl bg-[#1b202a] border border-[#293244] flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-black text-slate-500">#{index + 1}</span>
                    <span className="font-bold text-sm text-slate-200">{team.name}</span>
                  </div>
                  <span className="font-black text-lg text-amber-300">{team.score}</span>
                </div>
              ))}
            </div>
          </div>

          <button 
            onClick={async () => {
              // 1. Clear any dependent/related records first (prevents foreign key errors)
              await supabase.from('final_submissions').delete().neq('id', 0);
              
              // 2. Completely delete all teams from the database
              await supabase.from('teams').delete().neq('id', -999999); 
              
              // 3. Reset game state back to default
              await supabase.from('game_state').update({
                final_started: false,
                final_round: null,
                active_question_id: null,
                is_question_visible: false,
                answer_revealed: false
              }).eq('id', 1);

              // 4. Reset local UI states
              setGameEnded(false);
              setWinnerDetails(null);
              setShowAnswer(false);
              setIsDailyDoubleScreen(false);
              setWagerAmount('');
              setWagerError('');
              // 5. Reset game state
              await supabase.from('game_state').update({
                game_over: false,
                winner_screen: false,
                final_started: false,
                final_round: null
              }).eq('id', 1);
              
              // 6. Reset cast screen to QR
              try {
                await supabase.channel('cast_categories_sync').send({
                  type: 'broadcast',
                  event: 'reset_cast',
                  payload: { showQR: true }
                });
              } catch (e) {
                console.log('Cast reset broadcast failed:', e);
              }
              
              // 7. Close the window
              window.close();
            }} 
            className="w-full py-3 bg-rose-600 hover:bg-rose-500 text-white font-extrabold rounded-xl text-sm transition-all shadow-lg"
          >
            End Game
          </button>
        </div>
      </main>
    );
  }

  const isDJ = round === 'double_jeopardy';
  const isFinal = round === 'final' || !!finalRoundId;
  const bgMain = isFinal ? 'bg-[#20172a]' : isDJ ? 'bg-[#1e232d]' : 'bg-[#181c25]';
  const borderColor = isFinal ? 'border-[#4a3563]' : isDJ ? 'border-[#374155]' : 'border-[#2f3748]';

  // FINAL layout (host)
  if (isFinal) {
    return (
      <main className={`min-h-screen ${bgMain} text-slate-100 p-6`}>
        <div className="max-w-[1400px] mx-auto w-full mb-6 pb-4 border-b border-[#2f3748] flex items-center justify-between">
          <MentisLogo isDJ={isDJ} isFinal={true} />
          <div className="flex items-center gap-3">
            <button onClick={() => startFinalMentis()} className="bg-[#222733] px-4 py-2 rounded-xl text-xs">Start / Reload Final</button>
            <a href="/admin" className="bg-[#222733] px-4 py-2 rounded-xl text-xs">Admin Dashboard</a>
          </div>
        </div>

        <div className="max-w-[1400px] mx-auto w-full flex gap-8">
          {/* LEFT: question + controls */}
          <div className="flex-1 bg-[#15171a] rounded-xl p-8 border border-[#24292f]">
            <div className="mb-6">
              <div className="text-xs text-slate-400 uppercase tracking-widest">Final Question</div>
              
              {isQuestionVisible && finalQuestion ? (
                <div className="mt-4 bg-[#0f1720] border border-[#2a313a] rounded-lg p-8 text-left text-xl leading-relaxed">
                  {finalQuestion.clue}
                </div>
              ) : (
                <div className="mt-4 bg-[#0f1720] border border-[#2a313a] rounded-lg p-8 text-center text-slate-400 italic">
                  🔒 Final Question is hidden. Waiting for host to reveal...
                </div>
              )}
            </div>

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => revealQuestionForFinal(false)}
                disabled={!revealEnabled}
                className={`px-4 py-2 rounded-md font-bold ${revealEnabled ? 'bg-amber-500 text-[#0d1117]' : 'bg-[#444] text-slate-400 cursor-not-allowed'}`}
              >
                Reveal Question
              </button>

              <button
                onClick={() => revealQuestionForFinal(true)}
                className="px-4 py-2 rounded-md bg-sky-500 text-white"
              >
                Force Reveal
              </button>

              <button onClick={revealFinalAnswer} className="px-4 py-2 rounded-md bg-emerald-500 text-white">Reveal Answer</button>
              <button onClick={() => calculateFinalResults(chosenCorrectTeamIds)} className="px-4 py-2 rounded-md bg-rose-600 text-white">
                Calculate Scores & End Final
              </button>            
            </div>

            <div className="mt-6">
              <div className="text-xs text-slate-400 uppercase">Countdown</div>
              <div className="mt-2 text-2xl font-black">{countdown !== null ? `${countdown}s` : '—'}</div>
            </div>

            <div className="mt-6">
              <div className="text-xs text-slate-400 uppercase">Answer (revealed)</div>
              <div className="mt-2">
                {showAnswer ? <div className="bg-[#0f1720] border border-[#2a313a] rounded-lg p-4 text-amber-200 font-bold">{finalQuestion?.answer ?? '—'}</div> : <div className="text-slate-400">Answer hidden</div>}
              </div>
            </div>
          </div>

          {/* RIGHT: submissions table + host correctness selectors + calculate */}
          <aside className={`w-96 bg-[#222733] border ${borderColor} p-5 rounded-2xl`}>
            <div className="flex justify-between items-center border-b pb-3">
              <div className="text-sm font-bold">Final Submissions</div>
              <button onClick={() => loadFinalSubmissions(finalRoundId)} className="text-xs">Refresh</button>
            </div>

            <div className="mt-4 space-y-3 max-h-[500px] overflow-y-auto">
              {finalSubs.length === 0 ? <div className="text-xs text-slate-400">Waiting for teams to join / submit wagers</div> :
                finalSubs.map((s: any) => {
                  const team = teams.find(t => t.id === s.team_id) ?? { name: `Team ${s.team_id}` };
                  const isChecked = chosenCorrectTeamIds.includes(team.id);

                  return (
                    <div key={s.team_id} className="p-3 bg-[#15191d] rounded-lg border border-[#2a313a]">
                      <div className="flex justify-between items-center">
                        <div className="font-bold text-sm">{team.name}</div>
                        <div className="text-amber-300 font-black">{team.score}</div>
                      </div>

                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <div className="text-xs text-slate-400">Wager</div>
                        <div className="text-xs text-slate-400">Answer</div>

                        <div className="pt-1">
                          <div className="text-sm">{s.wager !== null ? s.wager : '—'}</div>
                        </div>
                        <div className="pt-1">
                          <div className="text-sm">{s.answer ? s.answer : '—'}</div>
                        </div>

                        <div className="col-span-2 mt-2 flex items-center gap-2">
                          <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                            <input 
                              type="checkbox" 
                              checked={isChecked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setChosenCorrectTeamIds([...chosenCorrectTeamIds, team.id]);
                                } else {
                                  setChosenCorrectTeamIds(chosenCorrectTeamIds.filter(id => id !== team.id));
                                }
                              }} 
                            />
                            <span>Mark Correct</span>
                          </label>
                        </div>
                      </div>
                    </div>
                  );
                })
              }
            </div>

            <div className="mt-4 border-t pt-4">
              <div className="flex gap-2">
                <button onClick={async () => {
                  await calculateFinalResults(chosenCorrectTeamIds);
                }} className="flex-1 px-3 py-2 bg-amber-500 rounded-md font-bold text-[#0d1117]">Calculate</button>

                <button onClick={async () => {
                  if (!confirm('Force calculate without marking correct teams automatically?')) return;
                  await calculateFinalResults([]);
                }} className="px-3 py-2 bg-red-600 rounded-md text-white">Force</button>
              </div>
            </div>
          </aside>
        </div>
      </main>
    );
  }

  // NON-FINAL rendering (grid etc)
  const cols = Math.max(1, categories.length);
  const tileHeight = 80;
  const headerHeight = 56;

  return (
    <main className="min-h-screen bg-[#181c25] text-slate-100 p-6">
      <div className="max-w-[1400px] mx-auto w-full mb-6 pb-4 border-b border-[#2f3748] flex items-center justify-between">
        <MentisLogo isDJ={isDJ} isFinal={isFinal} />
        <div className="flex items-center gap-3">
          <button onClick={() => fetchGameData(round as any)} className="bg-[#222733] px-4 py-2 rounded-xl text-xs">Refresh Board</button>
          <a href="/admin" className="bg-[#222733] px-4 py-2 rounded-xl text-xs">Admin Dashboard</a>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto w-full flex gap-8">
        <div className="flex-1">
          <div
            className="w-full"
            style={{
              display: 'grid',
              gridTemplateColumns: `repeat(${cols}, 1fr)`,
              gridAutoRows: `${tileHeight}px`,
              gap: '1rem'
            }}
          >
            {categories.map((cat, colIndex) => (
              <div
                key={`header-${colIndex}`}
                style={{ gridColumn: colIndex + 1, gridRow: 1, height: `${headerHeight}px` }}
                className="bg-gradient-to-b from-[#2a313a] to-[#232a33] rounded-xl flex items-center justify-center px-3 text-center font-bold uppercase tracking-wide text-sm"
              >
                <div className="truncate">{cat.name}</div>
              </div>
            ))}

            {boardPoints.map((pointsVal, rowIdx) =>
              categories.map((cat, colIdx) => {
                const question = (questionsMap[cat.id] || {})[pointsVal] ?? null;
                const isAnswered = question && answeredQuestions[question.id];
                const cellKey = `cell-r${rowIdx}-c${colIdx}`;
                return question ? (
                  <button
                    key={cellKey}
                    onClick={() => handleCellClick(question)}
                    disabled={isAnswered}
                    style={{ gridColumn: colIdx + 1, gridRow: rowIdx + 2, height: `${tileHeight}px` }}
                    className={`rounded-xl font-black flex items-center justify-center ${isAnswered ? 'bg-[#1b202a] text-slate-600' : 'bg-[#222836] hover:brightness-105 text-xl text-amber-300 cursor-pointer'}`}
                  >
                    {isAnswered ? '—' : question.points}
                  </button>
                ) : (
                  <div
                    key={cellKey}
                    style={{ gridColumn: colIdx + 1, gridRow: rowIdx + 2, height: `${tileHeight}px` }}
                    className="rounded-xl bg-[#0f1720] border border-[#1f2a34] flex items-center justify-center text-slate-600"
                  />
                );
              })
            )}
          </div>
        </div>

        <aside className="w-80 bg-[#222733] border border-[#2f3748] p-5 rounded-2xl">
          <div className="flex justify-between items-center border-b pb-3">
            <div className="text-sm font-bold"><Trophy className="inline-block w-4 h-4 mr-2 text-amber-400" /> Team Scores</div>
            <button onClick={() => fetchTeams()} className="text-xs">Refresh</button>
          </div>

          <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1 mt-3">
            {teams.map((team, index) => (
              <div key={team.id} onClick={() => setActiveTeamIndex(index)} className={`p-3 rounded-xl border flex justify-between items-center ${activeTeamIndex === index ? 'ring-1 ring-amber-400/30' : 'bg-[#1b202a]'}`}>
                <span className="font-bold text-xs">{team.name}</span>
                <div className="flex items-center gap-2">
                  <span className="font-black text-base text-amber-300">{team.score}</span>
                  <button onClick={(e) => { e.stopPropagation(); supabase.from('teams').delete().eq('id', team.id).then(() => fetchTeams()); }} className="text-slate-500 hover:text-red-400 p-1"><Trash2 className="w-3 h-3" /></button>
                </div>
              </div>
            ))}
          </div>

          <form onSubmit={(e) => { e.preventDefault(); if (!newTeamName.trim()) return; supabase.from('teams').insert([{ name: newTeamName.trim(), score: 0, approved: true }]).then(() => { setNewTeamName(''); fetchTeams(); }); }} className="flex gap-2 pt-2 border-t mt-4">
            <input type="text" placeholder="New team name..." value={newTeamName} onChange={(e) => setNewTeamName(e.target.value)} className="flex-grow bg-[#1b202a] border rounded-xl px-3 py-2 text-xs text-slate-200 outline-none" />
            <button type="submit" className="bg-amber-400 text-slate-900 font-bold px-3 py-2 rounded-xl"><Plus className="w-4 h-4" /></button>
          </form>

          <div className="mt-4 pt-4 border-t">
            {gameMode === 'turn' && (
              <div className="bg-[#0d1117] border border-[#21262d] rounded-xl p-4 text-center mb-3">
                <div className="text-[10px] uppercase text-slate-400">Current Turn</div>
                <div className="font-black text-amber-400 mt-1">{(teams.find(t => t.id === currentTurnTeamId)?.name ?? '—').toUpperCase()}</div>
              </div>
            )}

            <div className="bg-[#0d1117] border border-[#21262d] rounded-xl p-4 text-center">
              <div className="text-[10px] uppercase text-slate-400">First Buzzed Team</div>
              <div className="font-black text-amber-400 mt-1">{buzzerWinnerName ? buzzerWinnerName.toUpperCase() : 'NO BUZZES YET'}</div>
            </div>

            <div className="flex gap-2 mt-3">
              <button onClick={() => supabase.from('buzzers').upsert({ id:1, active: !buzzerActive, winner_team_id: null }).then(() => setBuzzerActive(!buzzerActive))} className={`flex-1 py-2 rounded-xl font-bold ${buzzerActive ? 'bg-rose-600 text-white' : 'bg-emerald-500 text-slate-900'}`}>{buzzerActive ? 'Lock' : 'Open'}</button>
              <button onClick={() => supabase.from('buzzers').update({ active: false, winner_team_id: null }).eq('id',1)} className="flex-1 py-2 rounded-xl bg-[#0d1117] border border-[#21262d] text-slate-300">Reset</button>
            </div>
          </div>
        </aside>
      </div>

      {/* active question modal (non-final) */}
      {activeQuestion && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 z-50">
          <div className="bg-[#222733] border-2 border-amber-400/20 max-w-2xl w-full p-8 rounded-3xl shadow-2xl text-center">
            {isDailyDoubleScreen ? (
              <div className="space-y-6">
                <div className="inline-flex items-center gap-2 bg-amber-400/20 text-amber-300 px-5 py-2 rounded-full text-sm font-extrabold uppercase">Daily Double!</div>
                <h3 className="text-xl font-bold">Place Your Wager</h3>
                <div className="text-xs text-slate-400">Waiting for {wagerTeam()?.name ?? 'the player'} to submit a wager on their buzzer, or set it here.</div>

                {receivedWagers.length > 0 && (
                  <div className="space-y-2 text-left">
                    {receivedWagers.map(w => {
                      const t = teams.find(tt => tt.id === w.teamId);
                      return (
                        <div key={w.teamId} className="flex items-center justify-between bg-[#1b202a] border border-[#293244] rounded-xl px-4 py-2">
                          <span className="text-xs font-bold">{t?.name ?? `Team ${w.teamId}`}</span>
                          <div className="flex items-center gap-3">
                            <span className="text-amber-300 font-black">{w.wager}</span>
                            <button onClick={() => setWagerAmount(String(w.wager))} className="text-[10px] uppercase text-slate-300 border border-[#293244] rounded-lg px-2 py-1">Use</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                <input type="number" min={5} max={Math.max(activeQuestion.points, wagerTeam()?.score || 0)} value={wagerAmount} onChange={(e) => setWagerAmount(e.target.value)} className="w-full bg-[#1b202a] border rounded-xl px-4 py-3 text-center text-xl font-black text-amber-300" />
                <div className="flex gap-2"><button onClick={() => { const p = parseInt(wagerAmount); const maxAllowed = Math.max(activeQuestion.points, wagerTeam()?.score || 0); if (isNaN(p) || p < 5 || p > maxAllowed) { setWagerError(`Wager must be between 5 and ${maxAllowed}`); return; } setIsDailyDoubleScreen(false); }} className="bg-amber-400 text-slate-900 py-3 px-6 rounded-xl">Confirm</button></div>
                {wagerError && <div className="text-xs text-rose-400">{wagerError}</div>}
              </div>
            ) : (
              <div className="space-y-6">
                <div className="text-xs text-slate-400 uppercase tracking-widest"><span>{activeQuestion.points} Points</span></div>
                <h2 className="text-2xl sm:text-3xl font-bold text-slate-100">{activeQuestion.clue}</h2>

                {showAnswer ? (
                  <div className="bg-[#1b202a] border border-[#293244] p-4 rounded-2xl">
                    <div className="text-xs text-slate-400 uppercase">Correct Answer:</div>
                    <div className="text-2xl font-black text-amber-300">{activeQuestion.answer}</div>
                  </div>
                ) : (
                  <button onClick={revealAnswerHandler} className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold py-3 px-6 rounded-xl">Reveal Answer</button>
                )}

                <div className="flex items-center justify-center gap-4 pt-4 border-t">
                  <button onClick={() => handleScoreAdjustment(false)} className="flex-1 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 py-3.5 rounded-xl">Incorrect</button>
                  <button onClick={() => handleScoreAdjustment(true)} className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-3.5 rounded-xl">Correct</button>
                </div>

                <button onClick={cancelActiveQuestion} className="w-full bg-[#1b202a] hover:bg-[#232a36] border border-[#293244] text-slate-300 text-xs font-bold py-3 rounded-xl">No Buzz — Close Without Scoring</button>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}