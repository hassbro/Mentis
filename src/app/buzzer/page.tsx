'use client';
import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { Zap, CheckCircle2, AlertCircle } from 'lucide-react';

export default function BuzzerPage() {
  const [teamName, setTeamName] = useState('');
  const [teamId, setTeamId] = useState<number | null>(null);
  const [waitingApproval, setWaitingApproval] = useState(false);
  const [isApproved, setIsApproved] = useState(false);
  const [countdownValue, setCountdownValue] = useState<number | null>(null);
  const [showTimeUpModal, setShowTimeUpModal] = useState(false);
  const [gameMode, setGameMode] = useState<'buzzer' | 'turn'>('buzzer');

  // authoritative fields
  const [rawMode, setRawMode] = useState<string | null>(null);
  const [finalStarted, setFinalStarted] = useState(false);
  const [finalRound, setFinalRound] = useState<string | null>(null);
  const [finalQ, setFinalQ] = useState<any | null>(null);
  const [activeQuestion, setActiveQuestion] = useState<any | null>(null);
  const [showAnswer, setShowAnswer] = useState(false);

  const [teamScore, setTeamScore] = useState<number>(0);
  const [buzzerActive, setBuzzerActive] = useState(false);
  const [buzzerWinner, setBuzzerWinner] = useState<string | null>(null);
  const [hasBuzzed, setHasBuzzed] = useState(false);
  const [wager, setWager] = useState('');
  const [wagerSubmitted, setWagerSubmitted] = useState(false);
  const [answer, setAnswer] = useState('');
  const [buzzerWinnerName, setBuzzerWinnerName] = useState<string | null>(null);

  const [currentTurnName, setCurrentTurnName] = useState<string | null>(null);
  const countdownRef = useRef<number | null>(null);
  const subsRef = useRef<any[]>([]);
  const approvalPollRef = useRef<any | null>(null);
  const gsPollRef = useRef<any | null>(null);
  const winnerPollRef = useRef<any | null>(null);

  // Winner screen state
  const [gameWinner, setGameWinner] = useState<any | null>(null);
  const [gameEnded, setGameEnded] = useState(false);
  const [winnerTeams, setWinnerTeams] = useState<any[]>([]);

  // --- Channel helpers (minimal, local) ---
  function createChannel(name: string) {
    return supabase.channel(name);
  }

  async function safeSubscribe(ch: any) {
    try {
      const r = ch.subscribe();
      // some SDK versions return a promise
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

  function startLocalCountdown(expiresAtIso: string | null) {
  if (!expiresAtIso) {
    if (countdownRef.current) { window.clearInterval(countdownRef.current); countdownRef.current = null; }
    setCountdownValue(null);
    return;
  }
  
  const end = new Date(expiresAtIso).getTime();
  if (countdownRef.current) { window.clearInterval(countdownRef.current); countdownRef.current = null; }
  
  const tick = () => {
    const remaining = Math.max(0, Math.ceil((end - Date.now()) / 1000));
    
    // 👉 Store the state so the client screen re-renders with the ticking numbers
    setCountdownValue(remaining);
    
    if (remaining <= 0 && countdownRef.current) { 
      window.clearInterval(countdownRef.current); 
      countdownRef.current = null; 
    }
  };
  
  tick();
  countdownRef.current = window.setInterval(tick, 250);
}

  // load question by id (shared)
  async function loadQuestionById(qId: number | null) {
    if (!qId) { setActiveQuestion(null); setFinalQ(null); return; }
    const { data } = await supabase.from('questions').select('id,clue,answer,points').eq('id', qId).maybeSingle();
    if (data) { setActiveQuestion(data); setFinalQ(data); } else { setActiveQuestion(null); setFinalQ(null); }
  }

  // approval poll fallback
  function startApprovalPoll(tid: number) {
    if (approvalPollRef.current) return;
    approvalPollRef.current = setInterval(async () => {
      try {
        const { data } = await supabase.from('teams').select('approved,score').eq('id', tid).maybeSingle();
        if (data) {
          console.log('BUZZER: Approval poll - team data:', data);
          setWaitingApproval(!data.approved);
          setIsApproved(!!data.approved);
          setTeamScore(data.score ?? 0);
          if (data.approved) {
            clearInterval(approvalPollRef.current); approvalPollRef.current = null;
          }
        } else {
          console.log('BUZZER: Approval poll - no team data found, team may have been deleted');
        }
      } catch (err) {
        console.error('approvalPoll error', err);
      }
    }, 1500);
  }

  function stopApprovalPoll() {
    if (approvalPollRef.current) { clearInterval(approvalPollRef.current); approvalPollRef.current = null; }
  }

  function startWinnerPoll() {
    if (winnerPollRef.current) return;
    winnerPollRef.current = setInterval(async () => {
      try {
        const { data: gs } = await supabase.from('game_state').select('*').maybeSingle();
        console.log('BUZZER: Winner poll - game_state:', gs);
        
        // Check all possible win flags to match host/cast logic
        const shouldShowWinner = 
          gs?.game_over === true || 
          gs?.winner_screen === true || 
          gs?.show_winner === true || 
          gs?.scores_calculated === true;
        console.log('BUZZER: Should show winner:', shouldShowWinner);
        
        if (shouldShowWinner) {
          // Fetch teams to calculate winner
          const { data: teamsData } = await supabase.from('teams').select('*');
          if (teamsData && teamsData.length > 0) {
            const sorted = [...teamsData].sort((a, b) => b.score - a.score);
            const winner = sorted[0];
            console.log('BUZZER: Winner poll - calculated winner:', winner);
            setGameWinner(winner);
            setWinnerTeams(sorted);
            setGameEnded(true);
          }
        }
        // 🛑 Removed the 'else' block that was clearing out setGameWinner(null)!
      } catch (e) {
        console.error('Winner poll error:', e);
      }
    }, 2000);
  }

  function stopWinnerPoll() {
    if (winnerPollRef.current) { clearInterval(winnerPollRef.current); winnerPollRef.current = null; }
  }

  // initial load & subscriptions
  useEffect(() => {
    let postCheck: any = null;

    (async () => {
      const { data } = await supabase.from('game_state').select('*').maybeSingle();
      console.debug('BUZZER: initial game_state ->', data);
      if (data) {
        setRawMode(data.mode ?? null);
        const fStarted = !!data.final_started && !!data.final_round;
        setFinalStarted(fStarted);
        setFinalRound(data.final_round ?? null);
        if (data.active_question_id) await loadQuestionById(data.active_question_id);
        setShowAnswer(!!data.answer_revealed);
        if (data.final_countdown_expires_at) startLocalCountdown(data.final_countdown_expires_at);
      }
      const { data: b } = await supabase.from('buzzers').select('*').eq('id',1).maybeSingle();
      console.debug('BUZZER: initial buzzers ->', b);
      if (b) {
        setBuzzerActive(!!b.active);
        if (b.active && b.winner_team_id) {
          const { data: t } = await supabase.from('teams').select('name').eq('id', b.winner_team_id).maybeSingle();
          const winnerName = t?.name ?? null;
          setBuzzerWinner(winnerName);
          setBuzzerWinnerName(winnerName); // Also set buzzerWinnerName for display
        } else {
          setBuzzerWinner(null);
          setBuzzerWinnerName(null); // Also clear buzzerWinnerName
        }
      }
    })();

    // game_state channel
    const gsCh = createChannel(`buzzer_gs_${Date.now()}`);
    gsCh.on('postgres_changes', { event: '*', schema: 'public', table: 'game_state' }, async (payload: any) => {
      if (!payload.new) return;
      console.debug('BUZZER: game_state event ->', payload.new);
      const gs = payload.new;
      const rawNewMode = gs.game_mode ?? gs.mode ?? null;
      setRawMode(rawNewMode);

      // 👉 Fixed: Explicitly handle the string comparison cleanly
      if (String(rawNewMode) === 'daily_double') {
        setWagerSubmitted(false);
        setWager('');
      }
      const fStarted = !!gs.final_started && !!gs.final_round;
      setFinalStarted(fStarted);
      setFinalRound(gs.final_round ?? null);
      if (gs.active_question_id && (gs.question_revealed === true || gs.is_question_visible === true)) { await loadQuestionById(gs.active_question_id); } else { setActiveQuestion(null); setFinalQ(null); }
      setShowAnswer(!!gs.answer_revealed);
      if (gs.final_countdown_expires_at) startLocalCountdown(gs.final_countdown_expires_at); else { if (countdownRef.current) { window.clearInterval(countdownRef.current); countdownRef.current = null; } }
      // Inside your buzzer client (buzzer/page) real-time listener for game_state
if (gs.current_turn_team_id) {
  const { data: t } = await supabase.from('teams').select('name').eq('id', gs.current_turn_team_id).maybeSingle();
  setCurrentTurnName(t?.name ?? null);
} else {
  setCurrentTurnName(null);
}
      
      // 👉 TRIGGER WINNER MODAL ON DATABASE CHANGE
      if (gs.game_over || gs.winner_screen || gs.show_winner || gs.scores_calculated || gs.round === 'final') {
        supabase.from('teams').select('*').then(({ data: teamsData }) => {
          if (teamsData && teamsData.length > 0) {
            const sorted = [...teamsData].sort((a, b) => (b.score || 0) - (a.score || 0));
            setGameWinner(sorted[0]);
            setWinnerTeams(sorted);
            setGameEnded(true);
          }
        });
      }

      // Reset winner screen when game mode changes or game resets
      if (gs.mode && (gs.mode !== 'final' || !gs.final_started)) {
        setGameWinner(null);
        setGameEnded(false);
        setWinnerTeams([]);
      }
    });

    // Listen for winner broadcast from host
    const winnerCh = createChannel('cast_categories_sync');
    winnerCh.on('broadcast', { event: 'game_winner' }, async (payload: any) => {
      console.log('BUZZER: Received game winner broadcast! Fetching teams...', payload);
      
      const { data: teamsData, error } = await supabase.from('teams').select('*');
      console.log('BUZZER Winner Fetch - Teams:', teamsData, 'Error:', error);
      
      if (teamsData && teamsData.length > 0) {
        const sorted = [...teamsData].sort((a, b) => (b.score || 0) - (a.score || 0));
        setGameWinner(sorted[0]);
        setWinnerTeams(sorted);
        setGameEnded(true);
      }
    });
    winnerCh.on('broadcast', { event: 'reset_cast' }, (payload: any) => {
      console.log('BUZZER: Received reset signal:', payload);
      // Unconditionally clear winner states on any reset
      setGameWinner(null);
      setGameEnded(false);
      setWinnerTeams([]);
      setBuzzerWinner(null);
      setBuzzerWinnerName(null);
    });
    
    // Listen for buzzer winner broadcast from host
    winnerCh.on('broadcast', { event: 'buzzer_winner_update' }, (payload: any) => {
      console.log('BUZZER: Received buzzer winner broadcast:', payload);
      if (payload.payload && payload.payload.winnerName) {
        setBuzzerWinnerName(payload.payload.winnerName);
        setBuzzerWinner(payload.payload.winnerName);
      } else {
        setBuzzerWinnerName(null);
        setBuzzerWinner(null);
      }
    });
    console.log('BUZZER: Setting up winner broadcast listener on channel: cast_categories_sync');
    // subscribe and store channel object (not subscribe result)
    safeSubscribe(gsCh);
    subsRef.current.push(gsCh);
    safeSubscribe(winnerCh);
    subsRef.current.push(winnerCh);
    
    // Start winner polling as fallback
    startWinnerPoll();

    // buzzers channel
    const bzCh = createChannel(`buzzer_sync_${Date.now()}`);
    bzCh.on('postgres_changes', { event: '*', schema: 'public', table: 'buzzers' }, async (payload: any) => {
      const b = payload.new;
      if (!b) return;
      console.debug('BUZZER: buzzers event ->', b);
      setBuzzerActive(!!b.active);
      
      if (b.active) {
        setHasBuzzed(false);
        setBuzzerWinner(null);
        setBuzzerWinnerName(null);
      }

      // Show the winner whenever a winner_team_id is set in the database
      if (b.winner_team_id) {
        console.log('BUZZER: Database has winner_team_id:', b.winner_team_id);
        const { data: t } = await supabase.from('teams').select('name').eq('id', b.winner_team_id).maybeSingle();
        const winnerName = t?.name ?? null;
        console.log('BUZZER: Fetched winner name:', winnerName);
        setBuzzerWinner(winnerName);
        setBuzzerWinnerName(winnerName); // Also set buzzerWinnerName for display
      } else {
        console.log('BUZZER: No winner_team_id in database');
        setBuzzerWinner(null); // Clears automatically when the host resets/clears the winner!
        setBuzzerWinnerName(null); // Also clear buzzerWinnerName
      }
    });
    safeSubscribe(bzCh);
    subsRef.current.push(bzCh);

    postCheck = setTimeout(async () => {
  try {
    const { data } = await supabase.from('game_state').select('*').maybeSingle();
    console.debug('BUZZER: post-subscribe recheck game_state ->', data);
    if (data) {
      if (data.game_mode) {
        setRawMode(data.game_mode); // Sync rawMode on load
      }
      if (data.active_question_id && (data.question_revealed === true || data.is_question_visible === true)) { 
        await loadQuestionById(data.active_question_id); 
      } else { 
        setActiveQuestion(null); 
        setFinalQ(null); 
      }
      setShowAnswer(!!data.answer_revealed);
    }
  } catch (err) {
    console.error('post-subscribe recheck error', err);
  }
}, 500);

    return () => {
      // use safe remover for each channel
      subsRef.current.forEach((c) => safeRemoveChannel(c));
      subsRef.current = [];
      if (postCheck) clearTimeout(postCheck);
      stopApprovalPoll();
      stopWinnerPoll();
      if (countdownRef.current) { window.clearInterval(countdownRef.current); countdownRef.current = null; }
    };
  }, []);

  // watch team approval/score changes
  useEffect(() => {
    if (!teamId) return;
    const ch = createChannel(`team_score_${teamId}_${Date.now()}`);
    ch.on('postgres_changes', { event: '*', schema: 'public', table: 'teams', filter: `id=eq.${teamId}` }, payload => {
      if (!payload.new) return;
    if (!payload.new) return;
      const newData = payload.new as any;
      setTeamScore(newData.score ?? 0);
      if (newData.approved) {
        setWaitingApproval(false);
        setIsApproved(true);
        stopApprovalPoll();
      }
    });
    safeSubscribe(ch);
    subsRef.current.push(ch);
    return () => { safeRemoveChannel(ch); };
  }, [teamId]);

  // register team
  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!teamName.trim()) return;
    const name = teamName.trim();
    const { data, error } = await supabase.from('teams').insert([{ name, score: 0, approved: false }]).select().single();
    if (error) { alert(error.message); return; }
    if (data) {
      setTeamId(data.id);
      setWaitingApproval(!data.approved);
      setIsApproved(!!data.approved);
      setTeamScore(data.score ?? 0);
      if (!data.approved) startApprovalPoll(data.id);
    }
  }

  // Add this state at the top of your buzzer component if you haven't yet:
// const [wagerSubmitted, setWagerSubmitted] = useState(false);

// submit wager / answer (final / daily double)
async function submitWager(value: string | number | null) {
  if (!teamId) { alert('No team connected'); return; }
  const numericValue = value !== null ? Number(value) : 0;

  if (effectiveMode === 'daily_double') {
    // 1. Update the team row
    await supabase
      .from('teams')
      .update({ daily_double_wager: numericValue, wager: numericValue })
      .eq('id', teamId);

    // 2. Also update game_state so the host instantly detects it globally
    await supabase
      .from('game_state')
      .update({ daily_double_wager: numericValue, player_submitted: true })
      .eq('id', 1);
      
    setWagerSubmitted(true);
    return;
  }


  // EXISTING FINAL JEOPARDY SUBMISSION
  if (!finalRound) { alert('Final not active'); return; }
  
  const payload = { 
    team_id: teamId as any, 
    final_round: finalRound as any, 
    wager: numericValue, 
    submitted_wager_at: value !== null ? new Date().toISOString() : null 
  };
  
  const res = await supabase.from('final_submissions').upsert(payload, { onConflict: ['team_id', 'final_round'] as any });
  console.debug('submitWager ->', res);
}


  async function submitAnswer(text: string | null) {
  // 🛑 Prevent submission if the countdown has hit 0
  if (countdownValue === 0) {
    setShowTimeUpModal(true); // Replaces the browser alert with your custom modal
    return;
  }

  if (!teamId || !finalRound) { alert('Final not active'); return; }
  
  const payload = { 
    team_id: teamId as any, 
    final_round: finalRound as any, 
    answer: text ?? '', 
    submitted_answer_at: text ? new Date().toISOString() : null 
  };
  
  const res = await supabase.from('final_submissions').upsert(payload, { onConflict: ['team_id', 'final_round'] as any });
  console.debug('submitAnswer ->', res);
}

  // handle buzz
  async function handleBuzz() {
    // Remove !!buzzerWinner from here so it doesn't permanently lock out new buzzes
    if (!teamId || !buzzerActive || hasBuzzed) return;
    
    setHasBuzzed(true);
    const currentTeamName = teamName; // Capture current team name
    console.log('BUZZER: User buzzed! Team:', currentTeamName);
    setBuzzerWinner(currentTeamName); // Set local state immediately for instant feedback
    setBuzzerWinnerName(currentTeamName); // Also set buzzerWinnerName
    const res = await supabase.from('buzzers').update({ active: false, winner_team_id: teamId }).eq('id', 1);
    console.debug('buzz write ->', res);
  }

  // decide effectiveMode for UI (respects explicit buzzer/turn mode over stale finalStarted flags)
  const effectiveMode = rawMode === 'buzzer' ? 'buzzer' : (rawMode === 'turn' ? 'turn' : (rawMode === 'daily_double' ? 'daily_double' : (finalStarted ? 'final' : 'buzzer')));
  console.debug('BUZZER render effectiveMode=', effectiveMode, { rawMode, finalStarted, finalRound, activeQuestionId: activeQuestion?.id, finalQId: finalQ?.id, showAnswer });

  // render
  return (
    <main className="min-h-screen w-full bg-[#0d1117] text-slate-100 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-[#161b22] border border-[#21262d] p-6 rounded-3xl shadow-2xl">
        {!teamId && (
          <form onSubmit={handleRegister} className="space-y-4">
            <label className="text-[10px] text-slate-400 uppercase">Team Name</label>
            <input value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="Enter Team Name..." className="w-full bg-[#0d1117] border border-[#21262d] px-4 py-3 rounded-xl text-sm text-slate-200 outline-none" />
            <button type="submit" className="w-full bg-[#60A5FA] rounded-xl py-3 font-black text-[#0d1117]">Register Team</button>
          </form>
        )}

        {teamId && waitingApproval && !isApproved && (
          <div className="py-8 text-center">
            <div className="w-12 h-12 bg-amber-500/10 mx-auto rounded-2xl flex items-center justify-center animate-pulse"><AlertCircle className="w-6 h-6 text-amber-400" /></div>
            <h3 className="text-sm font-black mt-3">Waiting for Admin Approval</h3>
            <div className="text-xs text-slate-400 mt-2">Approve this team in the Admin Dashboard.</div>
          </div>
        )}

        {teamId && isApproved && (
          <>
            <div className="bg-[#0d1117] border border-[#21262d] p-3.5 rounded-2xl mb-4 flex items-center justify-between">
              <div className="text-xs">Team: <span className="text-[#60A5FA] font-bold">{teamName}</span></div>
              <div className="text-xs text-emerald-400 font-bold flex items-center gap-1"><CheckCircle2 className="w-4 h-4" /> Connected</div>
            </div>

            {/* ============================================================== */}
            {/* 1. FINAL JEOPARDY & DAILY DOUBLE MOVEMENT SCREEN              */}
            {/* ============================================================== */}
            {(effectiveMode === 'final' || effectiveMode === 'daily_double') && (
              <div className="space-y-4">
                <div className="bg-[#0d1117] border border-[#21262d] p-3.5 rounded-2xl">
                  <div className="text-[10px] text-slate-400 uppercase tracking-widest">Your Score</div>
                  <div className="mt-2 font-black text-2xl">{teamScore}</div>
                </div>

                <div className="bg-[#0d1117] border border-[#21262d] p-3.5 rounded-2xl">
                  <div className="text-[10px] uppercase text-slate-400">
                    {effectiveMode === 'daily_double' ? 'Daily Double Wager' : 'Wager (max = your score)'}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <input 
                      type="number" 
                      min={0} 
                      max={teamScore} 
                      value={wager} 
                      disabled={wagerSubmitted} 
                      placeholder="Enter wager" 
                      onChange={(e) => setWager(e.target.value)} 
                      className="flex-1 bg-[#0d1117] border border-[#21262d] rounded-xl px-3 py-2 text-white outline-none disabled:opacity-50" 
                    />
                    <button 
                      onClick={() => submitWager(wager)}
                      disabled={wagerSubmitted} 
                      className={`px-4 py-2 rounded-xl font-bold transition-all ${
                        wagerSubmitted 
                          ? 'bg-slate-800 text-slate-500 cursor-not-allowed' 
                          : 'bg-[#60A5FA] text-[#0d1117] hover:bg-blue-400'
                      }`}
                    >
                      {wagerSubmitted ? 'Submitted' : 'Submit'}
                    </button>
                  </div>
                </div> {/* 👉 Closed the wager wrapper div correctly */}

                {/* ONLY Render Final Answer Box for Final Jeopardy mode */}
                {effectiveMode === 'final' && (
                  <div className="bg-[#0d1117] border border-[#21262d] p-3.5 rounded-2xl">
                    <div className="text-[10px] uppercase text-slate-400">Final Answer</div>
                    <div className="mt-2 flex gap-2">
                      <input 
                        type="text" 
                        value={answer} 
                        placeholder="Enter final answer" 
                        onChange={(e) => setAnswer(e.target.value)} 
                        className="flex-1 bg-[#0d1117] border border-[#21262d] rounded-xl px-3 py-2 text-white outline-none" 
                      />
                      <button onClick={() => submitAnswer(answer)} className="px-4 py-2 bg-emerald-500 text-white rounded-xl font-bold hover:bg-emerald-400 transition-all">Submit</button>
                    </div>
                  </div>
                )}

                {/* SMALL COUNTDOWN TIMER */}
                {countdownValue !== null && countdownValue > 0 && (
                  <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl py-2 px-4 flex items-center justify-between animate-pulse">
                    <span className="text-[10px] text-amber-400 font-bold uppercase tracking-wider">Time Remaining</span>
                    <span className="text-sm font-black font-mono text-amber-300">00:{countdownValue < 10 ? `0${countdownValue}` : countdownValue}</span>
                  </div>
                )}

                <div className="bg-[#0f1720] border border-[#2a313a] rounded-lg p-4 text-left text-sm text-slate-200">
                  <div className="text-[10px] text-slate-400 uppercase">
                    {effectiveMode === 'daily_double' ? 'Daily Double Clue' : 'Final Clue'}
                  </div>
                  <div className="mt-2">{finalQ?.clue ?? 'Waiting for host'}</div>
                </div>

                {showTimeUpModal && (
                  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
                    <div className="bg-[#161b22] border border-[#30363d] rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-2xl text-center">
                      <div className="text-amber-400 font-bold text-lg">Time's Up!</div>
                      <p className="text-slate-300 text-sm">The countdown has expired. Submissions are now closed.</p>
                      <button 
                        onClick={() => setShowTimeUpModal(false)}
                        className="w-full py-2 bg-[#60A5FA] hover:bg-blue-400 text-[#0d1117] font-bold rounded-xl transition-all"
                      >
                        Got it
                      </button>
                    </div>
                  </div>
                )}

                {(finalQ && showAnswer) && (
                  <div className="bg-[#0f1720] border border-[#2a313a] rounded-lg p-4 text-left text-sm text-amber-200 font-black mt-2">
                    {finalQ.answer}
                  </div>
                )}
              </div>
            )}

            {/* ============================================================== */}
            {/* 2. STANDARD TURN MODE LAYOUT                                   */}
            {/* ============================================================== */}
            {effectiveMode === 'turn' && (
              <div className="space-y-4">
                <div className="bg-[#0d1117] border border-[#21262d] p-3.5 rounded-2xl">
                  <div className="text-[10px] text-slate-400 uppercase tracking-widest">Active Question / Clue</div>
                  <div className="mt-3 bg-[#0f1720] border border-[#2a313a] rounded-lg p-4 text-left text-sm leading-relaxed">{activeQuestion?.clue ?? 'No active question revealed'}</div>
                </div>

                {(showAnswer && activeQuestion?.answer) && (
                  <div className="bg-[#0d1117] border border-[#21262d] p-3.5 rounded-2xl">
                    <div className="text-[10px] uppercase text-amber-300 font-bold">Answer</div>
                    <div className="mt-2 bg-[#0f1720] border border-[#2a313a] rounded-lg p-3 text-left text-sm text-amber-200 font-black">{activeQuestion.answer}</div>
                  </div>
                )}

                <div className="bg-[#0d1117] border border-[#21262d] p-3.5 rounded-2xl text-center">
                  <div className="text-[10px] text-slate-400 uppercase tracking-widest">Current Turn</div>
                  <div className="mt-2 font-black text-lg text-slate-100">{currentTurnName ?? 'Current Team'}</div>
                </div>
              </div>
            )}

            {/* ============================================================== */}
            {/* 3. DEFAULT BUZZER MODE LAYOUT                                  */}
            {/* ============================================================== */}
            {effectiveMode !== 'final' && effectiveMode !== 'daily_double' && effectiveMode !== 'turn' && (
              <div className="space-y-6">
                <div className="bg-[#0d1117] border border-[#21262d] p-3.5 rounded-2xl mb-4 flex items-center justify-between">
                  <div className="text-xs">Team Score</div>
                  <div className="font-black text-2xl">{teamScore}</div>
                </div>

                <div className="bg-[#0d1117] border border-[#21262d] p-3.5 rounded-2xl">
                  <div className="text-[10px] text-slate-400 uppercase tracking-widest">Active Question / Clue</div>
                  <div className="mt-3 bg-[#0f1720] border border-[#2a313a] rounded-lg p-4 text-left text-sm leading-relaxed">{activeQuestion?.clue ?? 'No active question revealed'}</div>
                </div>

                {(showAnswer && activeQuestion?.answer) && (
                  <div className="bg-[#0d1117] border border-[#21262d] p-3.5 rounded-2xl">
                    <div className="text-[10px] uppercase text-amber-300 font-bold">Answer</div>
                    <div className="mt-2 bg-[#0f1720] border border-[#2a313a] rounded-lg p-3 text-left text-sm text-amber-200 font-black">{activeQuestion.answer}</div>
                  </div>
                )}


                                <div className="flex justify-center mt-6">
                  <button onClick={handleBuzz} disabled={!buzzerActive || hasBuzzed || !!buzzerWinner} className={`w-44 h-44 rounded-full font-black flex flex-col items-center justify-center ${!buzzerActive ? 'bg-slate-800 text-slate-500' : buzzerWinner ? 'bg-rose-500/20 text-rose-400' : hasBuzzed ? 'bg-emerald-500 text-slate-900' : 'bg-rose-600 text-white'}`}>
                    <Zap className="w-7 h-7 mb-1" />
                    {!buzzerActive ? 'LOCKED' : buzzerWinner ? (buzzerWinner === teamName ? 'YOU BUZZED' : 'BUZZED') : 'BUZZ!'}
                  </button>
                </div>
                
                {/* Dynamic turn or buzzer info shown in the status tile */}
<div className="font-bold text-center mt-4">
  {gameMode === 'turn' ? (
    <span className="text-sky-400 text-lg">
      👉 CURRENT TURN: {currentTurnName ? currentTurnName.toUpperCase() : 'WAITING...'}
    </span>
  ) : buzzerWinnerName ? (
    <span className="text-amber-400 text-lg animate-pulse">
      🚨 {buzzerWinnerName.toUpperCase()} BUZZED FIRST!
    </span>
  ) : (
    <span className="text-slate-400 text-xs">Waiting for host to open the buzzer...</span>
  )}
</div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Winner Placard Overlay */}
      {(gameEnded || gameWinner) && (
        <div className="fixed inset-0 bg-slate-950/95 backdrop-blur-lg flex items-center justify-center p-4 z-[99999]">
          <div className="bg-[#161b22] border-2 border-amber-500/50 max-w-xl w-full p-8 rounded-3xl shadow-2xl text-center space-y-6 animate-fade-in">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-amber-500/10 border border-amber-500/25 rounded-full text-amber-400 text-xs font-bold uppercase tracking-widest">
                <span>🏆</span> Final Mentis
              </div>
              <h2 className="text-xs uppercase tracking-widest text-amber-400 font-extrabold pt-2">Grand Champion</h2>
              <div className="text-4xl md:text-5xl font-black text-slate-100 tracking-wider py-2">
                {gameWinner?.name}
              </div>
              <p className="text-xs text-slate-400">Final Score: {gameWinner?.score || 0} points</p>
            </div>

            <div className="border-t border-slate-800 pt-6 text-left space-y-3">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Final Standings</h3>
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {winnerTeams.length > 0 ? winnerTeams.map((team, index) => (
                  <div key={team.id} className="bg-black/30 border border-slate-800 px-4 py-2.5 rounded-xl flex justify-between items-center">
                    <span className="font-semibold text-sm text-slate-300">#{index + 1} {team.name}</span>
                    <span className="text-amber-400 font-mono font-bold text-sm">{team.score || 0}</span>
                  </div>
                )) : (
                  <div className="text-slate-400 text-xs">No teams data available</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
