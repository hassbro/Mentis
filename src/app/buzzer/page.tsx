'use client';
import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { Zap, CheckCircle2, AlertCircle } from 'lucide-react';

export default function BuzzerPage() {
  const [teamName, setTeamName] = useState('');
  const [teamId, setTeamId] = useState<number | null>(null);
  const [waitingApproval, setWaitingApproval] = useState(false);
  const [isApproved, setIsApproved] = useState(false);

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

  const [currentTurnName, setCurrentTurnName] = useState<string | null>(null);
  const countdownRef = useRef<number | null>(null);
  const subsRef = useRef<any[]>([]);
  const approvalPollRef = useRef<any | null>(null);
  const gsPollRef = useRef<any | null>(null);

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
      return;
    }
    const end = new Date(expiresAtIso).getTime();
    if (countdownRef.current) { window.clearInterval(countdownRef.current); countdownRef.current = null; }
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      // not storing countdown state to minimize complexity; host shows it
      if (remaining <= 0 && countdownRef.current) { window.clearInterval(countdownRef.current); countdownRef.current = null; }
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
          setWaitingApproval(!data.approved);
          setIsApproved(!!data.approved);
          setTeamScore(data.score ?? 0);
          if (data.approved) {
            clearInterval(approvalPollRef.current); approvalPollRef.current = null;
          }
        }
      } catch (err) {
        console.error('approvalPoll error', err);
      }
    }, 1500);
  }

  function stopApprovalPoll() {
    if (approvalPollRef.current) { clearInterval(approvalPollRef.current); approvalPollRef.current = null; }
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
          setBuzzerWinner(t?.name ?? null);
        } else setBuzzerWinner(null);
      }
    })();

    // game_state channel
    const gsCh = createChannel(`buzzer_gs_${Date.now()}`);
    gsCh.on('postgres_changes', { event: '*', schema: 'public', table: 'game_state' }, async (payload: any) => {
      if (!payload.new) return;
      console.debug('BUZZER: game_state event ->', payload.new);
      const gs = payload.new;
      setRawMode(gs.mode ?? null);
      const fStarted = !!gs.final_started && !!gs.final_round;
      setFinalStarted(fStarted);
      setFinalRound(gs.final_round ?? null);
      if (gs.active_question_id && (gs.question_revealed === true || gs.is_question_visible === true)) { await loadQuestionById(gs.active_question_id); } else { setActiveQuestion(null); setFinalQ(null); }
      setShowAnswer(!!gs.answer_revealed);
      if (gs.final_countdown_expires_at) startLocalCountdown(gs.final_countdown_expires_at); else { if (countdownRef.current) { window.clearInterval(countdownRef.current); countdownRef.current = null; } }
      if (gs.current_turn_team_id) {
        const { data: t } = await supabase.from('teams').select('name').eq('id', gs.current_turn_team_id).maybeSingle();
        setCurrentTurnName(t?.name ?? null);
      } else setCurrentTurnName(null);
    });
    // subscribe and store channel object (not subscribe result)
    safeSubscribe(gsCh);
    subsRef.current.push(gsCh);

    // buzzers channel
    const bzCh = createChannel(`buzzer_sync_${Date.now()}`);
    bzCh.on('postgres_changes', { event: '*', schema: 'public', table: 'buzzers' }, async (payload: any) => {
      const b = payload.new;
      if (!b) return;
      console.debug('BUZZER: buzzers event ->', b);
      setBuzzerActive(!!b.active);
      
      if (b.active) {
        setHasBuzzed(false);
      }

      // Show the winner whenever a winner_team_id is set in the database
      if (b.winner_team_id) {
        const { data: t } = await supabase.from('teams').select('name').eq('id', b.winner_team_id).maybeSingle();
        setBuzzerWinner(t?.name ?? null);
      } else {
        setBuzzerWinner(null); // Clears automatically when the host resets/clears the winner!
      }
    });
    safeSubscribe(bzCh);
    subsRef.current.push(bzCh);

    postCheck = setTimeout(async () => {
      try {
        const { data } = await supabase.from('game_state').select('*').maybeSingle();
        console.debug('BUZZER: post-subscribe recheck game_state ->', data);
        if (data) {
        if (data.active_question_id && (data.question_revealed === true || data.is_question_visible === true)) { await loadQuestionById(data.active_question_id); } else { setActiveQuestion(null); setFinalQ(null); }
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

  // submit wager / answer (final)
  async function submitWager(value: number | null) {
    if (!teamId || !finalRound) { alert('Final not active'); return; }
    const payload = { team_id: teamId as any, final_round: finalRound as any, wager: value ?? 0, submitted_wager_at: value !== null ? new Date().toISOString() : null };
    const res = await supabase.from('final_submissions').upsert(payload, { onConflict: ['team_id', 'final_round'] as any });
    console.debug('submitWager ->', res);
    if (!res.error) { /* local update not required, subscription will pick up */ }
  }

  async function submitAnswer(text: string | null) {
    if (!teamId || !finalRound) { alert('Final not active'); return; }
    const payload = { team_id: teamId as any, final_round: finalRound as any, answer: text ?? '', submitted_answer_at: text ? new Date().toISOString() : null };
    const res = await supabase.from('final_submissions').upsert(payload, { onConflict: ['team_id', 'final_round']as any });
    console.debug('submitAnswer ->', res);
  }

  // handle buzz
  async function handleBuzz() {
    // Remove !!buzzerWinner from here so it doesn't permanently lock out new buzzes
    if (!teamId || !buzzerActive || hasBuzzed) return;
    
    setHasBuzzed(true);
    const res = await supabase.from('buzzers').update({ active: false, winner_team_id: teamId }).eq('id', 1);
    console.debug('buzz write ->', res);
  }

  // decide effectiveMode for UI (respects explicit buzzer/turn mode over stale finalStarted flags)
  const effectiveMode = rawMode === 'buzzer' ? 'buzzer' : (rawMode === 'turn' ? 'turn' : (finalStarted ? 'final' : 'buzzer'));
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

            {effectiveMode === 'final' ? (
              <div className="space-y-4">
                <div className="bg-[#0d1117] border border-[#21262d] p-3.5 rounded-2xl">
                  <div className="text-[10px] text-slate-400 uppercase tracking-widest">Your Score</div>
                  <div className="mt-2 font-black text-2xl">{teamScore}</div>
                </div>

                <div className="bg-[#0d1117] border border-[#21262d] p-3.5 rounded-2xl">
                  <div className="text-[10px] uppercase text-slate-400">Wager (max = your score)</div>
                  <div className="mt-2 flex gap-2">
                    <input type="number" min={0} max={teamScore} value={''} placeholder="Enter wager" onChange={() => {}} className="flex-1 bg-[#0d1117] border rounded-xl px-3 py-2" />
                    <button onClick={() => submitWager(null)} className="px-4 py-2 bg-[#60A5FA] text-[#0d1117] rounded-md font-bold">Submit</button>
                  </div>
                </div>

                <div className="bg-[#0d1117] border border-[#21262d] p-3.5 rounded-2xl">
                  <div className="text-[10px] uppercase text-slate-400">Final Answer</div>
                  <div className="mt-2 flex gap-2">
                    <input type="text" value={''} placeholder="Enter final answer" onChange={() => {}} className="flex-1 bg-[#0d1117] border rounded-xl px-3 py-2" />
                    <button onClick={() => submitAnswer('')} className="px-4 py-2 bg-emerald-500 text-white rounded-md font-bold">Submit</button>
                  </div>
                </div>

                <div className="bg-[#0f1720] border border-[#2a313a] rounded-lg p-4 text-left text-sm text-slate-200">
                  <div className="text-[10px] text-slate-400 uppercase">Final Clue</div>
                  <div className="mt-2">{finalQ?.clue ?? 'Waiting for host'}</div>
                </div>

                {(finalQ && showAnswer) && (
                  <div className="bg-[#0f1720] border border-[#2a313a] rounded-lg p-4 text-left text-sm text-amber-200 font-black mt-2">
                    {finalQ.answer}
                  </div>
                )}
              </div>
            ) : effectiveMode === 'turn' ? (
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
            ) : (
              <div className="space-y-6">
                <div className="bg-[#0d1117] border border-[#21262d] p-3.5 rounded-2xl mb-4 flex items-center justify-between">
                  <div className="text-xs">Team Score</div>
                  <div className="font-black text-2xl">{teamScore}</div>
                </div>

                {/* Question & Answer display added for Buzzer Mode */}
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

                <div className="flex justify-center">
                  <button onClick={handleBuzz} disabled={!buzzerActive || hasBuzzed || !!buzzerWinner} className={`w-44 h-44 rounded-full font-black ${!buzzerActive ? 'bg-slate-800 text-slate-500' : buzzerWinner ? 'bg-rose-500/20 text-rose-400' : hasBuzzed ? 'bg-emerald-500 text-slate-900' : 'bg-rose-600 text-white'}`}>
                    <Zap className="w-7 h-7 mb-1" />
                    {!buzzerActive ? 'LOCKED' : buzzerWinner ? (buzzerWinner === teamName ? 'YOU BUZZED' : 'BUZZED') : 'BUZZ!'}
                  </button>
                </div>
                
                {/* First buzzed team info shown dynamically in the status tile */}
                <div className="font-bold text-center">
                  {buzzerWinner ? (
                    <span className="text-amber-400 text-lg animate-pulse">
                      🚨 {buzzerWinner} BUZZED FIRST!
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
    </main>
  );
}