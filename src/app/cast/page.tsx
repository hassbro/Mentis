'use client';
import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';

export default function CastPage() {
  const [gameState, setGameState] = useState<any | null>(null);
  const [teams, setTeams] = useState<any[]>([]);
  const [gameMode, setGameMode] = useState<'buzzer' | 'turn'>('buzzer');
  const [categories, setCategories] = useState<any[]>([]);
  const [questionsMap, setQuestionsMap] = useState<{ [catId: number]: { [points: number]: any } }>({});
  const [activeQuestion, setActiveQuestion] = useState<any | null>(null);
  const [buzzerWinnerName, setBuzzerWinnerName] = useState<string | null>(null);
  const [originUrl, setOriginUrl] = useState('');
  const [showQR, setShowQR] = useState(true);
  const [currentTurnTeamId, setCurrentTurnTeamId] = useState<number | null>(null);
  const currentTeam = teams.find((t: any) => t.id === currentTurnTeamId);
  const currentTurnName = currentTeam ? currentTeam.name : null;
  
  const [showWinnerModal, setShowWinnerModal] = useState(false);
  const [isFinalActive, setIsFinalActive] = useState(false);
  const [gameWinner, setGameWinner] = useState<any | null>(null);
  const [gameEnded, setGameEnded] = useState(false);

  const isMountedRef = useRef(true);

  // Dynamically compute board points from loaded questionsMap keys (Mentis & Double Mentis)
  const boardPoints = (() => {
    const pointsSet = new Set<number>();
    Object.values(questionsMap).forEach((catQs: any) => {
      if (catQs) {
        Object.keys(catQs).forEach(pt => pointsSet.add(Number(pt)));
      }
    });
    const pts = Array.from(pointsSet).sort((a, b) => a - b);
    return pts.length > 0 ? pts : [100, 200, 300, 400, 500, 1000];
  })();

  useEffect(() => {
    isMountedRef.current = true;
    if (typeof window !== 'undefined') {
      setOriginUrl(window.location.origin);
      
      // Auto-move window to external display if available (Electron environment)
      if (window.electronAPI && window.electronAPI.moveToExternalDisplay) {
        console.log('CAST: Attempting to move to external display');
        window.electronAPI.moveToExternalDisplay();
      }
    }

    

    async function init() {
      const { data: gs } = await supabase.from('game_state').select('*').maybeSingle();
      if (!isMountedRef.current) return;
      if (gs) {
        setGameState(gs);
        
        // 👉 ADD THESE TWO LINES TO SYNC INITIAL LOAD STATE:
        if (gs.game_mode) setGameMode(gs.game_mode);
        if (gs.current_turn_team_id !== undefined) setCurrentTurnTeamId(gs.current_turn_team_id);

        if (gs.active_question_id) {
          loadActiveQuestion(gs.active_question_id);
        } else {
          setActiveQuestion(null); 
        }
        if (gs.show_winner || gs.winner_revealed || gs.game_over || gs.scores_calculated || gs.winner_screen) {
          setShowWinnerModal(true);
        }
        if (gs.final_round || gs.is_final_round || gs.final_started || gs.round === 'final') {
          setIsFinalActive(true);
        }
      }
      fetchTeams();
    }

    init();

    // 👉 Host Broadcast Listeners
    const channel = supabase.channel('cast_categories_sync');
    
    channel.on('broadcast', { event: 'categories_update' }, (payload: any) => {
      if (payload.payload && isMountedRef.current) {
        console.log('CAST: Received categories update:', payload.payload);
        setCategories(payload.payload.categories || []);
        setQuestionsMap(payload.payload.questionsMap || {});
        setShowQR(false); 
        setGameEnded(false); // Reset game ended when new board loads
      }
    });

    channel.on('broadcast', { event: 'clear_active_question' }, () => {
      if (isMountedRef.current) {
        setActiveQuestion(null);
      }
    });

    // Listen for game mode and turn updates via broadcast
    channel.on('broadcast', { event: 'game_state_update' }, (payload: any) => {
      if (payload.payload && isMountedRef.current) {
        if (payload.payload.gameMode) {
          setGameMode(payload.payload.gameMode);
        }
        if (payload.payload.currentTurnTeamId !== undefined) {
          setCurrentTurnTeamId(payload.payload.currentTurnTeamId);
        }
      }
    });

    // Your existing buzzer winner broadcast listener
    channel.on('broadcast', { event: 'buzzer_winner_update' }, (payload: any) => {
      if (payload.payload && isMountedRef.current) {
        setBuzzerWinnerName(payload.payload.winnerName);
      }
    });

    // Listen for game mode and turn updates from the host
    channel.on('broadcast', { event: 'game_mode_turn_update' }, (payload: any) => {
      if (payload.payload && isMountedRef.current) {
        if (payload.payload.gameMode !== undefined) {
          setGameMode(payload.payload.gameMode);
        }
        if (payload.payload.currentTurnTeamId !== undefined) {
          setCurrentTurnTeamId(payload.payload.currentTurnTeamId);
        }
      }
    });

    channel.on('broadcast', { event: 'game_winner' }, (payload: any) => {
      console.log('=== CAST PAGE WINNER DEBUG ===');
      console.log('Cast page received game winner event:', payload);
      console.log('Payload:', payload.payload);
      if (payload.payload && isMountedRef.current) {
        console.log('Setting game winner:', payload.payload.winner);
        console.log('Setting teams:', payload.payload.teams);
        console.log('Setting game ended:', payload.payload.gameEnded);
        setGameWinner(payload.payload.winner);
        setTeams(payload.payload.teams || []);
        setGameEnded(payload.payload.gameEnded || true);
        setShowQR(false);
        // Also update game state to ensure winner screen is shown
        setGameState((prev: any) => ({ ...(prev || {}), game_over: true, winner_screen: true }));      } else {
        console.log('Payload or isMountedRef.current is falsy');
      }
    });

    channel.on('broadcast', { event: 'start_final_mentis' }, () => {
      if (isMountedRef.current) {
        setIsFinalActive(true);
      }
    });

    channel.on('broadcast', { event: 'show_winner_screen' }, () => {
      if (isMountedRef.current) {
        setShowWinnerModal(true);
      }
    });

    channel.on('broadcast', { event: 'reset_cast' }, (payload: any) => {
if (payload.payload && isMountedRef.current) {
setShowQR(payload.payload.showQR);
setCategories([]);
setQuestionsMap({});
setShowWinnerModal(false);
setIsFinalActive(false);
setActiveQuestion(null);
setGameWinner(null);
}
});

    channel.subscribe();

    // Real-time listener for question tile updates
    // Real-time listener for question tile updates
    // Real-time listener for question tile updates
    const questionsCh = supabase.channel(`cast_questions_${Date.now()}`);

    questionsCh.on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'questions' }, (payload: any) => {
      const updatedQ = payload.new;
      
      setQuestionsMap(prev => {
        const next = { ...prev };
        Object.keys(next).forEach(key => {
          const catId = Number(key);
          if (next[catId]) {
            // Create a fresh object copy for the category to trigger React reactivity
            next[catId] = { ...next[catId] };
            Object.keys(next[catId]).forEach(ptKey => {
              const pt = Number(ptKey);
              if (next[catId][pt]?.id === updatedQ.id) {
                next[catId][pt] = {
                  ...next[catId][pt],
                  is_answered: updatedQ.is_answered
                };
              }
            });
          }
        });
        return next;
      });
    }).subscribe();

    // Real-time listener for game_state changes
    const gsCh = supabase.channel(`cast_gamestate_${Date.now()}`);
    gsCh.on('postgres_changes', { event: '*', schema: 'public', table: 'game_state' }, async (payload: any) => {
      if (!payload.new || !isMountedRef.current) return;
      const gs = payload.new;
      setGameState(gs);
      
      if (gs.show_winner || gs.winner_revealed || gs.game_over || gs.scores_calculated || gs.winner_screen) {
        setShowWinnerModal(true);
      }

      if (gs.final_round || gs.is_final_round || gs.final_started || gs.round === 'final') {
        setIsFinalActive(true);
      }

      if (gs.active_question_id) {
        loadActiveQuestion(gs.active_question_id);
      } else {
        setActiveQuestion(null);
      }
    }).subscribe();

    // Real-time listener for buzzers & game state
    const bzCh = supabase.channel(`cast_buzzers_${Date.now()}`);
    bzCh.on('postgres_changes', { event: '*', schema: 'public', table: 'buzzers' }, async (payload: any) => {
      const b = payload.new;
      if (!b || !isMountedRef.current) return;

      // Update game mode and turn team ID if present in the payload
      if (b.game_mode) setGameMode(b.game_mode);
      if (b.current_turn_team_id !== undefined) setCurrentTurnTeamId(b.current_turn_team_id);

      // Handle buzzer winner
      if (b.winner_team_id) {
        const { data: t } = await supabase.from('teams').select('name').eq('id', b.winner_team_id).maybeSingle();
        setBuzzerWinnerName(t?.name ?? null);
      } else {
        setBuzzerWinnerName(null);
      }
    }).subscribe();

    // Real-time listener for teams score updates
    const teamCh = supabase.channel(`cast_teams_${Date.now()}`);
    teamCh.on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, () => {
      fetchTeams();
    }).subscribe();

    // Polling backup
    const pollInterval = setInterval(async () => {
      const { data: gs } = await supabase.from('game_state').select('*').maybeSingle();
      if (gs && isMountedRef.current) {
        setGameState(gs);
        if (gs.show_winner || gs.winner_revealed || gs.game_over || gs.scores_calculated || gs.winner_screen) {
          setShowWinnerModal(true);
        }
        if (gs.final_round || gs.is_final_round || gs.final_started || gs.round === 'final') {
          setIsFinalActive(true);
        }
      }
    }, 2000);

    return () => {
      isMountedRef.current = false;
      clearInterval(pollInterval);
      supabase.removeChannel(channel);
      supabase.removeChannel(questionsCh);
      supabase.removeChannel(gsCh);
      supabase.removeChannel(bzCh);
      supabase.removeChannel(teamCh);
    };
  }, []);

  async function fetchTeams() {
    const { data } = await supabase.from('teams').select('*').order('score', { ascending: false });
    if (data && isMountedRef.current) setTeams(data || []);
  }

  async function loadActiveQuestion(qId: number) {
    const { data } = await supabase.from('questions').select('*').eq('id', qId).maybeSingle();
    if (data && isMountedRef.current) setActiveQuestion(data);
  }

  const isGameStarted = categories.length > 0 && !showQR;
  const hasActiveQuestion = Boolean(gameState?.active_question_id && activeQuestion);
  const isQuestionVisible = (gameState?.is_question_visible === true || gameState?.question_revealed === true) && hasActiveQuestion && (gameState.active_question_id === activeQuestion.id);

  // Final Mentis clue is strictly hidden until the host reveals it via active question
  const isFinalClueRevealed = isFinalActive && isQuestionVisible;

  const sortedTeamsForWinner = [...teams].sort((a, b) => (b.score || 0) - (a.score || 0));
  const winnerTeam = sortedTeamsForWinner[0];
  
  const isWinnerScreenActive = 
    gameEnded || 
    showWinnerModal || 
    gameState?.show_winner === true || 
    gameState?.winner_revealed === true || 
    gameState?.game_over === true ||
    gameState?.scores_calculated === true ||
    gameState?.winner_screen === true;

  // Use broadcast winner if available, otherwise fall back to winnerTeam from gameState
  const displayWinner = gameWinner || winnerTeam;
  const displayTeams = teams.length > 0 ? teams : (gameWinner ? [{ ...gameWinner, id: 1 }] : []);

  console.log('=== CAST PAGE RENDER DEBUG ===');
  console.log('gameEnded:', gameEnded);
  console.log('showWinnerModal:', showWinnerModal);
  console.log('gameWinner:', gameWinner);
  console.log('winnerTeam:', winnerTeam);
  console.log('displayWinner:', displayWinner);
  console.log('isWinnerScreenActive:', isWinnerScreenActive);
  console.log('teams.length:', teams.length);
  console.log('displayTeams.length:', displayTeams.length);

  const currentTimer = gameState?.timer !== undefined ? gameState.timer : gameState?.countdown;
  
  // Calculate Final Mentis countdown
  const finalCountdown = gameState?.final_countdown_expires_at 
    ? Math.max(0, Math.ceil((new Date(gameState.final_countdown_expires_at).getTime() - Date.now()) / 1000))
    : null;

    console.log('--- CAST RENDER DEBUG ---');
console.log('gameMode:', gameMode);
console.log('currentTurnTeamId:', currentTurnTeamId);
console.log('currentTurnName:', currentTurnName);

  return (
    <main className="min-h-screen bg-[#0b0f19] text-white p-6 flex flex-col justify-between select-none relative">
      {/* Top Header */}
      <header className="flex justify-between items-center border-b border-slate-800 pb-4 mb-6">
        <div className="flex items-center space-x-3">
          <div className="bg-amber-500 text-black font-black px-3 py-1.5 rounded-lg text-xl">M</div>
          <h1 className="text-xl font-black tracking-wider">MENTIS <span className="text-slate-400 font-normal text-sm">TRIVIA & INTELLECT</span></h1>
        </div>
        <div className="flex items-center gap-4">
          {finalCountdown !== null && finalCountdown > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/30 text-amber-400 font-mono font-extrabold px-4 py-1.5 rounded-full text-sm animate-pulse flex items-center gap-1.5">
              <span>⏱️</span> {finalCountdown}s
            </div>
          )}
          {currentTimer !== undefined && currentTimer !== null && (
            <div className="bg-red-500/10 border border-red-500/30 text-red-400 font-mono font-extrabold px-4 py-1.5 rounded-full text-sm animate-pulse flex items-center gap-1.5">
              <span>⏳</span> {currentTimer}s
            </div>
          )}
          <div className="text-xs uppercase font-bold bg-amber-500/10 text-amber-400 px-4 py-1.5 rounded-full border border-amber-500/20">
            {isWinnerScreenActive ? 'Grand Champion' : isFinalActive ? 'Final Mentis' : boardPoints.includes(2000) ? 'Double Mentis' : isGameStarted ? 'Live Game Board' : 'Lobby'}
          </div>
        </div>
      </header>

      {/* Main Content Layout */}
      <div className="flex-1 grid grid-cols-12 gap-6 items-center">
        <div className="col-span-12 lg:col-span-9 flex items-center justify-center">
          {showQR ? (
            <div className="text-center max-w-xl mx-auto space-y-6 bg-slate-900/60 p-10 rounded-2xl border border-slate-800 shadow-xl">
              <h2 className="text-3xl font-black">Scan to Join the Game</h2>
              <p className="text-slate-400 text-sm">Point your phone camera at the QR code to register your team buzzer.</p>
              <div className="inline-block p-4 bg-white rounded-2xl shadow-2xl">
                <img 
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(originUrl + '/buzzer')}`} 
                  alt="Join QR Code" 
                  className="w-52 h-52 object-contain"
                />
              </div>
              <div className="text-amber-400 font-mono text-xs tracking-wider">{originUrl}/buzzer</div>
            </div>
          ) : isFinalActive ? (
            <div className="w-full bg-slate-900/90 border border-slate-700 rounded-3xl p-12 shadow-2xl text-center space-y-6">
              <div className="text-amber-400 font-bold text-sm uppercase tracking-widest">
                Final Mentis Round
              </div>

              {isFinalClueRevealed ? (
                <div className="space-y-6 animate-fade-in">
                  <div className="text-3xl font-extrabold text-slate-100 leading-relaxed">
                    {activeQuestion ? activeQuestion.clue : 'Final Clue'}
                  </div>

                  {currentTimer !== undefined && currentTimer !== null && (
                    <div className="inline-flex items-center gap-2 bg-red-500/10 border border-red-500/30 px-6 py-2 rounded-full text-2xl font-mono font-black text-red-400 animate-pulse">
                      <span>⏳</span> {currentTimer}s
                    </div>
                  )}

                  {gameState?.answer_revealed && activeQuestion && (
                    <div className="bg-amber-500/10 border border-amber-500/30 p-4 rounded-2xl text-center mt-4">
                      <span className="text-xs text-amber-400 uppercase font-bold block">Correct Answer</span>
                      <span className="text-xl font-black text-amber-300 mt-1 block">{activeQuestion.answer}</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="py-12 space-y-3">
                  <h2 className="text-3xl font-black text-amber-400 animate-pulse">Final Round Started</h2>
                  <p className="text-slate-400 text-sm">Waiting for host to reveal the final clue...</p>
                </div>
              )}
            </div>
          ) : isQuestionVisible && activeQuestion ? (
            <div className="w-full bg-slate-900/90 border border-slate-700 rounded-3xl p-12 shadow-2xl text-center space-y-6">
              <div className="text-amber-400 font-bold text-sm uppercase tracking-widest">
                Active Clue ({(() => {
                  // Calculate display points based on board type
                  const points = activeQuestion.points || 0;
                  const boardPoints = Array.from(new Set(Object.values(questionsMap).flatMap(Object.keys).map(Number)));
                  const isDouble = boardPoints.includes(2000);
                  return isDouble ? points * 2 : points;
                })()} Points)
              </div>

              {/* Daily Double Indicator Badge */}
              {gameState?.mode === 'daily_double' && (
                <div className="inline-block bg-amber-500/20 border border-amber-500/50 text-amber-300 px-5 py-1.5 rounded-full text-sm font-extrabold tracking-widest uppercase animate-pulse">
                  ⭐ DAILY DOUBLE ⭐
                </div>
              )}

              {/* Rendered ONCE cleanly */}
              <div className="text-3xl font-extrabold text-slate-100 leading-relaxed">
                {activeQuestion.clue}
              </div>

              {currentTimer !== undefined && currentTimer !== null && (
                <div className="inline-flex items-center gap-2 bg-red-500/10 border border-red-500/30 px-6 py-2 rounded-full text-2xl font-mono font-black text-red-400 animate-pulse">
                  <span>⏳</span> {currentTimer}s
                </div>
              )}

              {gameState?.answer_revealed && (
                <div className="bg-emerald-500/10 border border-emerald-500/30 p-4 rounded-2xl">
                  <div className="text-xs uppercase text-emerald-400 font-bold">
                    Answer
                  </div>

                  <div className="text-xl font-black text-emerald-300 mt-1">
                    {activeQuestion.answer}
                  </div>
                </div>
              )}
            </div>
          ) : (
            // Falls back immediately to the main grid when canceled
            <div className="w-full grid grid-cols-5 gap-3 items-start">
              {categories.map((cat: any) => (
                <div key={cat.id} className="flex flex-col space-y-2 w-full">
                  <div className="w-full h-16 bg-slate-800/80 border border-slate-700 px-3 py-2 rounded-xl text-center font-bold text-[11px] uppercase tracking-wider flex items-center justify-center">
                    <span className="line-clamp-3 leading-tight">
                      {cat.name}
                    </span>
                  </div>

                  {boardPoints.map((pt) => {
  const q = questionsMap[cat.id]?.[pt];
  // Checks if the question is marked as answered/canceled
  const isAnswered = q?.is_answered === true;

  return (
    <div
      key={pt}
      className={`w-full h-16 rounded-xl flex items-center justify-center font-black text-xl border transition-all ${
        isAnswered
          ? 'bg-slate-900/25 border-slate-800/40 text-slate-600 opacity-50'
          : 'bg-slate-900/60 border-slate-700/80 text-amber-400 shadow-md'
      }`}
    >
      {isAnswered ? '—' : `${pt}`}
    </div>
  );
})}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Sidebar */}
        <aside className="col-span-12 lg:col-span-3 flex flex-col space-y-4">
          <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 flex flex-col h-[420px]">
            <div className="flex justify-between items-center mb-3 pb-2 border-b border-slate-800">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1">
                🏆 Team Scores
              </span>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {teams.map((t) => {
                const isCurrentTurn = gameMode === 'turn' && t.id === currentTurnTeamId;
                return (
                  <div key={t.id} className={`bg-black/30 border px-3 py-2.5 rounded-lg flex justify-between items-center ${isCurrentTurn ? 'border-amber-400 bg-amber-400/10' : 'border-slate-800'}`}>
                    <span className="font-semibold text-sm truncate mr-2">{t.name} {isCurrentTurn && '(Turn)'}</span>
                    <span className="text-amber-400 font-mono font-bold text-sm">{t.score}</span>
                  </div>
                );
              })}
              {teams.length === 0 && (
                <div className="text-xs text-slate-500 text-center py-6">No teams registered</div>
              )}
            </div>
          </div>

          <div className="bg-[#0d1117] border border-[#21262d] rounded-xl p-4 text-center shadow-lg">
  {gameMode === 'turn' ? (
    <>
      <div className="text-[10px] uppercase tracking-wider text-sky-400 font-bold">Current Turn</div>
      <div className="font-black text-white mt-1.5 text-sm tracking-wide">
        {currentTurnName ? currentTurnName.toUpperCase() : 'WAITING FOR TURN'}
      </div>
    </>
  ) : (
    <>
      <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">First Buzzed Team</div>
      <div className="font-black text-amber-400 mt-1.5 text-sm tracking-wide">
        {buzzerWinnerName ? `${buzzerWinnerName.toUpperCase()} BUZZED FIRST!` : 'NO BUZZES YET'}
      </div>
    </>
  )}
</div>
        </aside>
      </div>

      {/* Grand Champion Winner Modal Overlay (Highest z-index forced display) */}
      {isWinnerScreenActive && displayWinner && (
        <div className="fixed inset-0 bg-slate-950/95 backdrop-blur-lg flex items-center justify-center p-4 z-[99999]">
          <div className="bg-[#161b22] border-2 border-amber-500/50 max-w-xl w-full p-8 rounded-3xl shadow-2xl text-center space-y-6 animate-fade-in">
            <div className="space-y-2">
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-amber-500/10 border border-amber-500/25 rounded-full text-amber-400 text-xs font-bold uppercase tracking-widest">
                <span>🏆</span> Final Mentis
              </div>
              <h2 className="text-xs uppercase tracking-widest text-amber-400 font-extrabold pt-2">Grand Champion</h2>
              <div className="text-4xl md:text-5xl font-black text-slate-100 tracking-wider py-2">
                {displayWinner?.name}
              </div>
              <p className="text-xs text-slate-400">Final Score: {displayWinner?.score || 0} points</p>
            </div>

            <div className="border-t border-slate-800 pt-6 text-left space-y-3">
              <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Final Standings</h3>
              <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                {displayTeams.length > 0 ? displayTeams.map((team, index) => (
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