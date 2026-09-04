'use client';
import { useEffect, useState, useRef } from 'react';
import { supabase } from '@/lib/supabase';

export default function CastPage() {
  const [gameState, setGameState] = useState<any | null>(null);
  const [teams, setTeams] = useState<any[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [questionsMap, setQuestionsMap] = useState<{ [catId: number]: { [points: number]: any } }>({});
  const [activeQuestion, setActiveQuestion] = useState<any | null>(null);
  const [buzzerWinnerName, setBuzzerWinnerName] = useState<string | null>(null);
  const [finalQuestion, setFinalQuestion] = useState<any | null>(null);
  const [finalSubs, setFinalSubs] = useState<any[]>([]);
  const [originUrl, setOriginUrl] = useState('');

  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    if (typeof window !== 'undefined') {
      setOriginUrl(window.location.origin);
    }

    async function init() {
      const { data: gs } = await supabase.from('game_state').select('*').maybeSingle();
      if (!isMountedRef.current) return;
      setGameState(gs);
      if (gs) {
        if (gs.active_question_id) loadActiveQuestion(gs.active_question_id);
        if (gs.final_round) {
          loadFinalSubmissions(gs.final_round);
          loadFinalQuestion(gs.active_question_id);
        }
      }
      fetchTeams();
      fetchBoardData();
    }

    init();

    // Real-time synchronization channels
    const gsCh = supabase.channel(`cast_gamestate_${Date.now()}`);
    gsCh.on('postgres_changes', { event: '*', schema: 'public', table: 'game_state' }, async (payload: any) => {
      if (!payload.new || !isMountedRef.current) return;
      const gs = payload.new;
      setGameState(gs);

      if (gs.active_question_id) {
        loadActiveQuestion(gs.active_question_id);
      } else {
        setActiveQuestion(null);
      }

      if (gs.final_round) {
        loadFinalSubmissions(gs.final_round);
        loadFinalQuestion(gs.active_question_id);
      }
    }).subscribe();

    const bzCh = supabase.channel(`cast_buzzers_${Date.now()}`);
    bzCh.on('postgres_changes', { event: '*', schema: 'public', table: 'buzzers' }, async (payload: any) => {
      const b = payload.new;
      if (!b || !isMountedRef.current) return;
      if (b.winner_team_id) {
        const { data: t } = await supabase.from('teams').select('name').eq('id', b.winner_team_id).maybeSingle();
        setBuzzerWinnerName(t?.name ?? null);
      } else {
        setBuzzerWinnerName(null);
      }
    }).subscribe();

    const teamCh = supabase.channel(`cast_teams_${Date.now()}`);
    teamCh.on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, () => {
      fetchTeams();
    }).subscribe();

    return () => {
      isMountedRef.current = false;
      supabase.removeChannel(gsCh);
      supabase.removeChannel(bzCh);
      supabase.removeChannel(teamCh);
    };
  }, []);

  async function fetchTeams() {
    const { data } = await supabase.from('teams').select('*').order('score', { ascending: false });
    if (data && isMountedRef.current) setTeams(data);
  }

  async function fetchBoardData() {
    const { data: catData } = await supabase.from('categories').select('*');
    if (!catData || !isMountedRef.current) return;
    const filtered = catData.filter(c => !(String(c.name || '').toLowerCase().includes('final')));
    const uniqueCats = filtered.slice(0, 5);
    setCategories(uniqueCats);

    const catIds = uniqueCats.map(c => c.id);
    const { data: qData } = await supabase.from('questions').select('*').in('category_id', catIds);

    const standardPoints = [100, 200, 300, 400, 500, 1000];
    const map: { [catId: number]: { [points: number]: any } } = {};
    uniqueCats.forEach(cat => {
      map[cat.id] = {};
      standardPoints.forEach(pt => {
        const found = (qData || []).find((q: any) => q.category_id === cat.id && q.points === pt);
        map[cat.id][pt] = found || null;
      });
    });
    setQuestionsMap(map);
  }

  async function loadActiveQuestion(qId: number) {
    const { data } = await supabase.from('questions').select('*').eq('id', qId).maybeSingle();
    if (data && isMountedRef.current) setActiveQuestion(data);
  }

  async function loadFinalQuestion(qId: number | null) {
    if (!qId) return;
    const { data } = await supabase.from('questions').select('*').eq('id', qId).maybeSingle();
    if (data && isMountedRef.current) setFinalQuestion(data);
  }

  async function loadFinalSubmissions(roundId: string) {
    const { data } = await supabase.from('final_submissions').select('*, teams(name)').eq('final_round', roundId);
    if (data && isMountedRef.current) setFinalSubs(data);
  }

  const isGameStarted = gameState?.game_started === true;
  const isFinalRound = gameState?.final_started === true || gameState?.is_final_round === true;
  const isQuestionVisible = gameState?.is_question_visible === true || gameState?.question_revealed === true;

  return (
    <main className="min-h-screen bg-[#0b0f19] text-white p-6 flex flex-col justify-between select-none">
      {/* Top Header */}
      <header className="flex justify-between items-center border-b border-slate-800 pb-4 mb-6">
        <div className="flex items-center space-x-3">
          <div className="bg-amber-500 text-black font-black px-3 py-1.5 rounded-lg text-xl">M</div>
          <h1 className="text-xl font-black tracking-wider">MENTIS <span className="text-slate-400 font-normal text-sm">TRIVIA & INTELLECT</span></h1>
        </div>
        <div className="text-xs uppercase font-bold bg-amber-500/10 text-amber-400 px-4 py-1.5 rounded-full border border-amber-500/20">
          {isFinalRound ? 'Final Mentis' : isGameStarted ? 'Live Game Board' : 'Lobby / Registration'}
        </div>
      </header>

      {/* Main Content Layout with Side Panel */}
      <div className="flex-1 grid grid-cols-12 gap-6 items-center">
        {/* Center Board / Active View (8 cols) */}
        <div className="col-span-12 lg:col-span-9 flex items-center justify-center">
          {!isGameStarted ? (
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
          ) : isFinalRound ? (
            <div className="w-full bg-slate-900/80 border border-slate-800 rounded-2xl p-8 shadow-2xl space-y-6">
              <div className="text-center">
                <span className="text-xs uppercase tracking-widest text-amber-400 font-bold">Final Round Clue</span>
                <h2 className="text-2xl font-bold mt-2">{finalQuestion ? finalQuestion.clue : 'Waiting for Final Clue...'}</h2>
              </div>
              {gameState?.answer_revealed && finalQuestion && (
                <div className="bg-amber-500/10 border border-amber-500/30 p-4 rounded-xl text-center">
                  <span className="text-xs text-amber-400 uppercase font-bold block">Correct Answer</span>
                  <span className="text-lg font-extrabold text-amber-300 mt-1 block">{finalQuestion.answer}</span>
                </div>
              )}
              <div className="border-t border-slate-800 pt-6">
                <h3 className="text-xs font-semibold text-slate-400 mb-3 uppercase tracking-wider">Team Submissions</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {finalSubs.map((sub: any) => (
                    <div key={sub.team_id} className="bg-black/40 border border-slate-800 p-3 rounded-xl flex justify-between items-center">
                      <span className="font-bold text-sm truncate">{sub.teams?.name || 'Team'}</span>
                      <span className="text-xs bg-slate-800 px-2 py-1 rounded text-slate-300">
                        {sub.answer ? 'Submitted ✓' : 'Thinking...'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : isQuestionVisible && activeQuestion && gameState?.mode !== 'final' && !gameState?.final_started ? (
            <div className="w-full bg-slate-900/90 border border-slate-700 rounded-3xl p-12 shadow-2xl text-center space-y-6">
              <div className="text-amber-400 font-bold text-sm uppercase tracking-widest">Active Clue ({activeQuestion.points} Points)</div>
              <div className="text-3xl font-extrabold text-slate-100 leading-relaxed">{activeQuestion.clue}</div>
              
              {gameState?.answer_revealed && (
                <div className="bg-emerald-500/10 border border-emerald-500/30 p-4 rounded-2xl">
                  <div className="text-xs uppercase text-emerald-400 font-bold">Answer</div>
                  <div className="text-xl font-black text-emerald-300 mt-1">{activeQuestion.answer}</div>
                </div>
              )}
            </div>
          ) : (
            <div className="w-full grid grid-cols-5 gap-3">
              {categories.map((cat: any) => (
                <div key={cat.id} className="flex flex-col space-y-2">
                  <div className="bg-slate-800/80 border border-slate-700 p-2 rounded-xl text-center font-bold text-[11px] uppercase tracking-wider h-14 flex items-center justify-center">
                    {cat.name}
                  </div>
                  {[100, 200, 300, 400, 500, 1000].map((pt) => {
                    const q = questionsMap[cat.id]?.[pt];
                    const isAnswered = q?.is_answered;
                    return (
                      <div 
                        key={pt} 
                        className={`h-16 rounded-xl flex items-center justify-center font-black text-xl border ${
                          isAnswered 
                            ? 'bg-slate-900/20 border-slate-800/40 text-slate-700' 
                            : 'bg-slate-900/60 border-slate-800 text-amber-400 shadow'
                        }`}
                      >
                        {isAnswered ? '—' : `$${pt}`}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right Sidebar: Team Scores & Buzzer Status (3 cols) */}
        <aside className="col-span-12 lg:col-span-3 flex flex-col space-y-4">
          {/* Team Scores Box */}
          <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-4 flex flex-col h-[420px]">
            <div className="flex justify-between items-center mb-3 pb-2 border-b border-slate-800">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1">
                🏆 Team Scores
              </span>
            </div>
            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
              {teams.map((t) => (
                <div key={t.id} className="bg-black/30 border border-slate-800 px-3 py-2.5 rounded-lg flex justify-between items-center">
                  <span className="font-semibold text-sm truncate mr-2">{t.name}</span>
                  <span className="text-amber-400 font-mono font-bold text-sm">{t.score}</span>
                </div>
              ))}
              {teams.length === 0 && (
                <div className="text-xs text-slate-500 text-center py-6">No teams registered</div>
              )}
            </div>
          </div>

          {/* First Buzzed Team Box */}
          <div className="bg-[#0d1117] border border-[#21262d] rounded-xl p-4 text-center shadow-lg">
            <div className="text-[10px] uppercase tracking-wider text-slate-400 font-bold">First Buzzed Team</div>
            <div className="font-black text-amber-400 mt-1.5 text-sm tracking-wide">
              {buzzerWinnerName ? `🚨 ${buzzerWinnerName.toUpperCase()} BUZZED FIRST!` : 'NO BUZZES YET'}
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}