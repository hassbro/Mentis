'use client';
import { useState, useEffect, Suspense, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
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
      <div className="min-h-screen bg-[#181c25] text-slate-100 flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-300 font-medium text-lg animate-pulse">
          <RefreshCw className="w-5 h-5 animate-spin" /> Loading MENTIS...
        </div>
      </div>
    }>
      <GameContent />
    </Suspense>
  );
}

function GameContent() {
  const searchParams = useSearchParams();
  const roundParam = searchParams.get('round');

  // board state
  const [categories, setCategories] = useState<any[]>([]);
  const [questionsMap, setQuestionsMap] = useState<{ [catId: number]: { [points: number]: any | null } }>({});
  const [boardPoints, setBoardPoints] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);

  const [round, setRound] = useState<'jeopardy' | 'double_jeopardy' | 'final'>('jeopardy');
  const [answeredQuestions, setAnsweredQuestions] = useState<{ [qId: number]: boolean }>({});
  const [dailyDoubles, setDailyDoubles] = useState<Set<number>>(new Set());

  // active question
  const [activeQuestion, setActiveQuestion] = useState<any | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);
  // daily double
  const [isDailyDoubleScreen, setIsDailyDoubleScreen] = useState(false);
  const [wagerAmount, setWagerAmount] = useState<string>('');
  const [wagerError, setWagerError] = useState<string>('');

  // final
  const [finalQuestion, setFinalQuestion] = useState<any | null>(null);
  const [finalRoundId, setFinalRoundId] = useState<string | null>(null);
  const [finalSubs, setFinalSubs] = useState<any[]>([]); // live final_submissions rows
  const [revealEnabled, setRevealEnabled] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null); // seconds remaining
  const countdownTimerRef = useRef<number | null>(null);

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

  // --- Channel helpers (local, minimal) ---
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
  // --- end helpers ---

  // --- helpers: fetch teams, board ---
  async function fetchTeams() {
    const { data } = await supabase.from('teams').select('*').eq('approved', true).order('score', { ascending: false });
    if (data) setTeams(data);
  }
  useEffect(() => { fetchTeams(); }, []);

  useEffect(() => {
    const targetRound = (roundParam === 'double_jeopardy' || roundParam === 'final') ? roundParam : 'jeopardy';
    if (targetRound === 'final') startFinalMentis();
    else { setRound(targetRound as any); fetchGameData(targetRound as any); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  async function fetchGameData(currentRound: 'jeopardy' | 'double_jeopardy') {
    setLoading(true);
    const { data: catData } = await supabase.from('categories').select('*');
    if (!catData) { setLoading(false); return; }
    
    // Filter out final categories
    const filtered = catData.filter(c => !(String(c.name || '').toLowerCase().includes('final')));
    
    // ENSURE UNIQUE CATEGORY NAMES & SHUFFLE THEM FOR A FRESH BOARD ON REFRESH
    const seenNames = new Set<string>();
    const uniqueList = filtered.filter(c => {
      const name = String(c.name || '').trim().toLowerCase();
      if (seenNames.has(name)) return false;
      seenNames.add(name);
      return true;
    });

    // Shuffle uniquely so refreshing generates a different set of categories
    const shuffledCats = [...uniqueList].sort(() => Math.random() - 0.5);
    const uniqueCats = shuffledCats.slice(0, 5);
    setCategories(uniqueCats);

    const standardPoints = currentRound === 'double_jeopardy' ? [200,400,600,800,1000,2000] : [100,200,300,400,500,1000];
    setBoardPoints(standardPoints);

    const catIds = uniqueCats.map(c => c.id);
    const { data: qData } = await supabase.from('questions').select('*').in('category_id', catIds);

    const map: { [catId: number]: { [points: number]: any | null } } = {};
    const assignedIds = new Set<number>();

    uniqueCats.forEach(cat => {
      map[cat.id] = {};
      standardPoints.forEach(pt => {
        const candidate = (qData || []).find((q: any) => {
          const adjusted = currentRound === 'double_jeopardy' ? q.points * 2 : q.points;
          return adjusted === pt && !assignedIds.has(q.id);
        });

        if (candidate) {
          map[cat.id][pt] = { ...candidate, points: pt };
          assignedIds.add(candidate.id);
        } else {
          const fallback = (qData || []).find((q: any) => q.category_id === cat.id && !assignedIds.has(q.id));
          if (fallback) {
            map[cat.id][pt] = { ...fallback, points: pt };
            assignedIds.add(fallback.id);
          } else {
            map[cat.id][pt] = null;
          }
        }
      });
    });

    const assignedQuestions = Object.values(map).flatMap(pm => Object.values(pm).filter(Boolean));
    const shuffled = [...assignedQuestions].sort(() => Math.random() - 0.5);
    const ddSet = new Set<number>(shuffled.slice(0, Math.min(2, shuffled.length)).map((q: any) => q.id));
    setDailyDoubles(ddSet);

    setQuestionsMap(map);
    setLoading(false);
  }

  // --- final flow helpers ---

  // create final_round id and create blank submission rows for approved teams
  async function startFinalMentis() {
    setLoading(true);
    try {
      // Find all final categories
      const { data: finalCats } = await supabase.from('categories').select('id').ilike('name', '%final%');
      let finalQ = null;

      if (finalCats && finalCats.length > 0) {
        const catIds = finalCats.map((c: any) => c.id);
        // Fetch all questions for final categories instead of just limiting to 1
        const { data: qList } = await supabase.from('questions').select('*').in('category_id', catIds);
        
        if (qList && qList.length > 0) {
          // SHUFFLE and pick a random one for a fresh final question every time!
          const shuffledFinals = [...qList].sort(() => Math.random() - 0.5);
          finalQ = shuffledFinals[0];
        }
      }

      if (!finalQ) {
        const { data: q } = await supabase.from('questions').select('*').eq('is_answered', false);
        if (q && q.length > 0) {
          const shuffledUnanswered = [...q].sort(() => Math.random() - 0.5);
          finalQ = shuffledUnanswered[0];
        }
      }
      
      if (!finalQ) {
        const { data: q } = await supabase.from('questions').select('*');
        if (q && q.length > 0) {
          const shuffledAll = [...q].sort(() => Math.random() - 0.5);
          finalQ = shuffledAll[0];
        }
      }

      // create unique final_round id
      const finalRound = new Date().toISOString();
      setFinalRoundId(finalRound);
      setFinalQuestion(finalQ ?? null);
      setActiveQuestion(finalQ ?? null);
      setShowAnswer(false);

      // insert empty final_submissions rows for all approved teams (wager/answer null)
      const { data: approved } = await supabase.from('teams').select('id').eq('approved', true);
      if (approved && approved.length > 0) {
        // upsert rows (unique constraint on team_id, final_round)
        const payload = approved.map((t: any) => ({
          team_id: t.id,
          final_round: finalRound,
          wager: null,
          answer: null,
          is_correct: null
        }));
        await supabase.from('final_submissions').upsert(payload, { onConflict: ['team_id', 'final_round'] });
      }

      // publish game_state final flags (do not reveal question yet)
      await supabase.from('game_state').upsert({
        id: 1,
        final_started: true,
        final_round: finalRound,
        final_countdown_expires_at: null,
        active_question_id: finalQ ? finalQ.id : null,
        question_revealed: false,
        answer_revealed: false
      });

      // load live submissions
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
    // reveal enabled when every approved team has a non-null wager
    const approvedTeamIds = new Set(teams.map(t => t.id));
    const entriesCount = subs.filter(s => s && s.wager !== null && approvedTeamIds.has(s.team_id)).length;
    setRevealEnabled(entriesCount >= teams.length && teams.length > 0);
  }

  // Subscribe to final submissions for a given finalRound (attach handlers before subscribing)
  function subscribeFinalSubmissions(finalRound: string | null) {
    // clean up existing channel if present
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

    // subscribe and store the channel object for cleanup
    safeSubscribe(ch);
    finalSubsChannelRef.current = ch;
  }

  // host force reveal (or normal reveal when enabled)
  async function revealQuestionForFinal(force = false) {
    if (!finalRoundId || (!revealEnabled && !force)) {
      // not allowed unless forced
      return;
    }
    // set question_revealed and set countdown expiration timestamp (30s)
    const expiresAt = new Date(Date.now() + 30_000).toISOString();
    await supabase.from('game_state').update({
      question_revealed: true,
      final_countdown_expires_at: expiresAt
    }).eq('id', 1);

    // start local countdown UI
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

  // host reveals final answer (shows correct answer text)
  async function revealFinalAnswer() {
    await supabase.from('game_state').update({ answer_revealed: true }).eq('id', 1);
    setShowAnswer(true);
  }

  // host calculates final results:
  // - host marks is_correct per final_submissions rows via local state (we will store chosenCorrectIds)
  // - Calculate applies wagers to teams: +wager if correct else -wager
  async function calculateFinalResults(chosenCorrectTeamIds: number[]) {
    if (!finalRoundId) return;
    // load submissions for this final
    const { data: subs } = await supabase.from('final_submissions').select('*').eq('final_round', finalRoundId);
    if (!subs) return;

    // build score updates
    const updates: { id: number; newScore: number }[] = [];
    for (const team of teams) {
      const sub = subs.find((s: any) => s.team_id === team.id);
      const wager = (sub && sub.wager) ? Number(sub.wager) : 0;
      const isCorrect = chosenCorrectTeamIds.includes(team.id);
      const newScore = isCorrect ? team.score + wager : team.score - wager;
      updates.push({ id: team.id, newScore });
      // update final_submissions row is_correct
      await supabase.from('final_submissions').update({
        is_correct: isCorrect
      }).match({ team_id: team.id, final_round: finalRoundId });
    }

    // batch update teams (sequential for clarity)
    for (const u of updates) {
      await supabase.from('teams').update({ score: u.newScore }).eq('id', u.id);
    }

    // publish winners and clear final flags in game_state
    const winnerIds = chosenCorrectTeamIds;
    await supabase.from('game_state').update({
      final_started: false,
      final_round: null,
      final_countdown_expires_at: null,
      active_question_id: null,
      question_revealed: false,
      answer_revealed: false,
      final_winner_ids: winnerIds
    }).eq('id', 1);

    // refresh local teams and final subs
    await fetchTeams();
    setFinalSubs([]);
    setFinalRoundId(null);
    setFinalQuestion(null);
    setShowAnswer(false);
    setCountdown(null);
    if (countdownTimerRef.current) { window.clearInterval(countdownTimerRef.current); countdownTimerRef.current = null; }
  }

  // subscribe to game_state to track reveal timestamps and final round changes
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('game_state').select('*').maybeSingle();
      if (data) {
        setGameMode((data.mode as any) ?? 'unknown');
        setCurrentTurnTeamId(data.current_turn_team_id ?? null);

        if (data.final_started && data.final_round) {
          setFinalRoundId(data.final_round);
          // load submissions
          loadFinalSubmissions(data.final_round);
          subscribeFinalSubmissions(data.final_round);
        } else {
          setFinalRoundId(null);
        }

        // if countdown exists, start local countdown
        if (data.final_countdown_expires_at) {
          startLocalCountdown(data.final_countdown_expires_at);
        }
      }
    })();

    // create channel, attach handlers, then subscribe; store channel object for cleanup
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

      // if answer_revealed updated, reflect locally
      setShowAnswer(!!gs.answer_revealed);
    });

    safeSubscribe(ch);
    gameStateChannelRef.current = ch;

    return () => {
      safeRemoveChannel(gameStateChannelRef.current);
      gameStateChannelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teams]);

  // --- existing question handling (non-final) ---
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

    if (dailyDoubles.has(question.id)) {
      setIsDailyDoubleScreen(true);
      const score = teams[activeTeamIndex]?.score || 0;
      setWagerAmount(String(Math.max(question.points, score)));
    } else setIsDailyDoubleScreen(false);
  }

  async function revealAnswerHandler() {
    try {
      await supabase.from('game_state').update({ answer_revealed: true }).eq('id', 1);
    } catch (e) {
      console.error('Failed to publish answer reveal', e);
    }
    setShowAnswer(true);
  }

  // turn helper
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

    // authoritative scoring team
    const { data: gs } = await supabase.from('game_state').select('current_turn_team_id').maybeSingle();
    const scoringTeamId = gs?.current_turn_team_id ?? (teams[activeTeamIndex] && teams[activeTeamIndex].id);
    const scoringTeam = teams.find(t => t.id === scoringTeamId) ?? teams[activeTeamIndex];

    if (scoringTeam) {
      const updatedScore = correct ? scoringTeam.score + pointsToUse : scoringTeam.score - pointsToUse;
      await supabase.from('teams').update({ score: updatedScore }).eq('id', scoringTeam.id);
      await fetchTeams();
    }

    // Clear active question in DB so clients clear
    try {
      await supabase.from('game_state').update({
        active_question_id: null,
        question_revealed: false,
        answer_revealed: false
      }).eq('id', 1);
    } catch (e) {
      console.error('Failed to clear active question in game_state', e);
    }

    // Advance turn if in turn mode
    if (gameMode === 'turn') {
      await setNextTurnInDB();
    }

    setAnsweredQuestions(prev => ({ ...prev, [activeQuestion.id]: true }));
    setActiveQuestion(null);
    setShowAnswer(false);
    setIsDailyDoubleScreen(false);
    setWagerAmount('');
    setWagerError('');
  }

  // --- rendering (final vs non-final) ---
  if (loading) {
    return (
      <main className="min-h-screen bg-[#181c25] text-slate-100 flex items-center justify-center">
        <div className="flex items-center gap-3 text-slate-300 font-medium text-lg animate-pulse">
          <RefreshCw className="w-5 h-5 animate-spin" /> Loading MENTIS...
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
        <div className="max-w-[1400px] mx-auto w-full mb-6 pb-4 border-b ${borderColor} flex items-center justify-between">
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
              {finalQuestion ? (
                <div className="mt-4 bg-[#0f1720] border border-[#2a313a] rounded-lg p-8 text-left text-xl leading-relaxed">
                  {finalQuestion.clue}
                </div>
              ) : (
                <div className="mt-4 text-slate-400">No final question available</div>
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
              <button onClick={() => calculateFinalResults([])} className="px-4 py-2 rounded-md bg-rose-600 text-white">End Final</button>
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
                          <label className="flex items-center gap-2 text-xs">
                            <input type="checkbox" defaultChecked={!!s.is_correct} onChange={async (e) => {
                              const newVal = e.currentTarget.checked;
                              await supabase.from('final_submissions').update({ is_correct: newVal }).match({ team_id: s.team_id, final_round: finalRoundId });
                              await loadFinalSubmissions(finalRoundId);
                            }} />
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
                  const { data } = await supabase.from('final_submissions').select('team_id').eq('final_round', finalRoundId).eq('is_correct', true);
                  const chosen = (data || []).map((r: any) => r.team_id);
                  await calculateFinalResults(chosen);
                }} className="flex-1 px-3 py-2 bg-amber-500 rounded-md font-bold text-[#0d1117]">Calculate</button>

                <button onClick={async () => {
                  if (!confirm('Force calculate without marking correct teams automatically? You will be able to check before applying.')) return;
                  await calculateFinalResults([]);
                }} className="px-3 py-2 bg-red-600 rounded-md text-white">Force Calculate</button>
              </div>
            </div>
          </aside>
        </div>
      </main>
    );
  }

  // NON-FINAL rendering remains unchanged (grid etc)
  const cols = Math.max(1, categories.length);
  const tileHeight = 80;
  const headerHeight = 56;

  return (
    <main className="min-h-screen bg-[#181c25] text-slate-100 p-6">
      <div className="max-w-[1400px] mx-auto w-full mb-6 pb-4 border-b border-[#2f3748] flex items-center justify-between">
        <MentisLogo isDJ={isDJ} isFinal={isFinal} />
        <div className="flex items-center gap-3">
          <button onClick={() => fetchGameData(round)} className="bg-[#222733] px-4 py-2 rounded-xl text-xs">Refresh Board</button>
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

      {/* active question modal (non-final) unchanged */}
      {activeQuestion && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 z-50">
          <div className="bg-[#222733] border-2 border-amber-400/20 max-w-2xl w-full p-8 rounded-3xl shadow-2xl text-center">
            {isDailyDoubleScreen ? (
              <div className="space-y-6">
                <div className="inline-flex items-center gap-2 bg-amber-400/20 text-amber-300 px-5 py-2 rounded-full text-sm font-extrabold uppercase">Daily Double!</div>
                <h3 className="text-xl font-bold">Place Your Wager</h3>
                <input type="number" min={5} max={Math.max(activeQuestion.points, teams[activeTeamIndex]?.score || 0)} value={wagerAmount} onChange={(e) => setWagerAmount(e.target.value)} className="w-full bg-[#1b202a] border rounded-xl px-4 py-3 text-center text-xl font-black text-amber-300" />
                <div className="flex gap-2"><button onClick={() => { const p = parseInt(wagerAmount); const maxAllowed = Math.max(activeQuestion.points, teams[activeTeamIndex]?.score || 0); if (isNaN(p) || p < 5 || p > maxAllowed) { setWagerError(`Wager must be between 5 and ${maxAllowed}`); return; } setIsDailyDoubleScreen(false); }} className="bg-amber-400 text-slate-900 py-3 px-6 rounded-xl">Confirm</button></div>
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
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}