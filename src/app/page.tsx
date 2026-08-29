'use client';
import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { RefreshCw, Trophy, Plus, Settings, Trash2, RotateCcw, Flame, ArrowRight, Zap, Lock, Unlock } from 'lucide-react';

function MentisLogo({ isDJ, isFinal }: { isDJ: boolean; isFinal: boolean }) {
  const label = isFinal ? 'Final Mentis' : isDJ ? 'Double Mentis' : 'Trivia & Intellect';
  const color = isFinal ? 'text-purple-400' : isDJ ? 'text-sky-400' : 'text-amber-400';
  const gradient = isFinal ? 'from-purple-400 to-purple-600' : isDJ ? 'from-sky-400 to-sky-600' : 'from-amber-400 to-amber-600';

  return (
    <div className="flex items-center gap-3 select-none">
      <div className={`relative w-10 h-10 bg-gradient-to-br ${gradient} rounded-xl p-0.5 shadow-lg flex items-center justify-center transition-colors duration-500`}>
        <div className="w-full h-full bg-[#181c25] rounded-[10px] flex items-center justify-center">
          <svg 
            viewBox="0 0 24 24" 
            className={`w-5 h-5 ${color} fill-current transition-colors duration-500`}
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M3 17V7C3 5.89543 3.89543 5 5 5H7C7.55228 5 8.05228 5.22386 8.41421 5.58579L12 9.17157L15.5858 5.58579C15.9477 5.22386 16.4477 5 17 5H19C20.1046 5 21 5.89543 21 7V17C21 18.1046 20.1046 19 19 19H17C15.8954 19 15 18.1046 15 17V11.4142L13.4142 13C12.6332 13.781 11.3668 13.781 10.5858 13L9 11.4142V17C9 18.1046 8.10465 19 7 19H5C3.89543 19 3 18.1046 3 17Z" />
          </svg>
        </div>
      </div>

      <div className="flex flex-col">
        <span className="text-xl font-black tracking-[0.2em] text-slate-100 font-sans">
          MENTIS
        </span>
        <span className={`text-[9px] tracking-[0.3em] uppercase ${color} font-bold -mt-1 transition-colors duration-500`}>
          {label}
        </span>
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

  const [categories, setCategories] = useState<any[]>([]);
  const [questionsMap, setQuestionsMap] = useState<{ [catId: number]: { [points: number]: any } }>({});
  const [boardPoints, setBoardPoints] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);

  const [round, setRound] = useState<'jeopardy' | 'double_jeopardy' | 'final'>('jeopardy');
  const [usedQuestionIds, setUsedQuestionIds] = useState<number[]>([]);
  const [dailyDoubles, setDailyDoubles] = useState<Set<number>>(new Set());

  const [activeQuestion, setActiveQuestion] = useState<any | null>(null);
  const [isDailyDoubleScreen, setIsDailyDoubleScreen] = useState(false);
  const [wagerAmount, setWagerAmount] = useState<string>('');
  const [wagerError, setWagerError] = useState<string>('');
  const [showAnswer, setShowAnswer] = useState(false);
  const [answeredQuestions, setAnsweredQuestions] = useState<{ [qId: number]: boolean }>({});
  
  const [finalQuestion, setFinalQuestion] = useState<any | null>(null);
  const [finalStep, setFinalStep] = useState<'wagering' | 'clue' | 'winner'>('wagering');
  const [finalWagers, setFinalWagers] = useState<{ [teamId: string]: string }>({});
  const [finalCorrectMap, setFinalCorrectMap] = useState<{ [teamId: string]: boolean }>({});

  const [teams, setTeams] = useState<any[]>([]);
  const [newTeamName, setNewTeamName] = useState('');
  const [activeTeamIndex, setActiveTeamIndex] = useState<number>(0);

  // Buzzer states
  const [buzzerActive, setBuzzerActive] = useState(false);
  const [buzzerWinnerName, setBuzzerWinnerName] = useState<string | null>(null);

  async function fetchTeams() {
    const { data, error } = await supabase
      .from('teams')
      .select('*')
      .eq('approved', true)
      .order('score', { ascending: false });

    if (!error && data) {
      setTeams(data);
    }
  }

  async function fetchBuzzerState() {
    const { data } = await supabase
      .from('buzzers')
      .select('*')
      .eq('id', 1)
      .maybeSingle();

    if (data) {
      setBuzzerActive(data.active);
      setBuzzerWinner(data.winner_team_id ? teams.find(t => t.id === data.winner_team_id) : null);
    }
  }

  useEffect(() => {
    async function fetchBuzzerState() {
      const { data } = await supabase.from('buzzers').select('*').eq('id', 1).maybeSingle();
      if (data) {
        setBuzzerActive(data.active);
        if (data.winner_team_id) {
          const { data: teamData } = await supabase.from('teams').select('name').eq('id', data.winner_team_id).single();
          setBuzzerWinnerName(teamData ? teamData.name : null);
        } else {
          setBuzzerWinnerName(null);
        }
      }
    }
    
    fetchBuzzerState();

    const buzzerChannel = supabase
      .channel('main_buzzer_sync')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'buzzers' },
        async (payload: any) => {
          const newData = payload.new;
          if (newData) {
            setBuzzerActive(newData.active);
            if (newData.winner_team_id) {
              const { data: teamData } = await supabase.from('teams').select('name').eq('id', newData.winner_team_id).single();
              setBuzzerWinnerName(teamData ? teamData.name : null);
            } else {
              setBuzzerWinnerName(null);
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(buzzerChannel);
    };
  }, []);

  async function toggleBuzzer(activate: boolean) {
    const { error } = await supabase
      .from('buzzers')
      .upsert({ id: 1, active: activate, winner_team_id: null });

    if (!error) {
      setBuzzerActive(activate);
      setBuzzerWinner(null);
    }
  }

  async function updateTeamScore(teamId: number, newScore: number) {
    const { error } = await supabase
      .from('teams')
      .update({ score: newScore })
      .eq('id', teamId);

    if (!error) {
      fetchTeams();
    }
  }

  useEffect(() => {
    const targetRound = (roundParam === 'double_jeopardy' || roundParam === 'final') 
      ? roundParam 
      : 'jeopardy';

    if (targetRound === 'final') {
      startFinalMentis();
    } else if (targetRound === 'double_jeopardy') {
      startDoubleJeopardy();
    } else {
      setRound('jeopardy');
      fetchGameData('jeopardy', []);
    }
  }, [roundParam]);

  async function fetchGameData(currentRound: 'jeopardy' | 'double_jeopardy', excludedIds: number[] = []) {
    setLoading(true);
    if (currentRound === 'jeopardy') {
      setAnsweredQuestions({});
      setDailyDoubles(new Set());
      setUsedQuestionIds([]);
    }

    const { data: settings } = await supabase
      .from('app_settings')
      .select('*')
      .eq('id', 1)
      .maybeSingle();

    const randomizeCategories = settings?.randomize_categories ?? false;
    const selectedCategoryIds: number[] = settings?.selected_category_ids ?? [];

    let catQuery = supabase.from('categories').select('*');
    const { data: catsData, error: catError } = await catQuery;

    if (catError || !catsData) {
      setLoading(false);
      return;
    }

    let filteredCats = catsData.filter(c => {
      const rawName = (c.name || '').replace(/\\/g, '').trim().toLowerCase();
      return !rawName.includes('final');
    });

    if (selectedCategoryIds.length > 0) {
      filteredCats = filteredCats.filter(c => selectedCategoryIds.includes(c.id));
    }

    if (randomizeCategories || selectedCategoryIds.length === 0 || currentRound === 'double_jeopardy') {
      filteredCats = [...filteredCats].sort(() => Math.random() - 0.5);
    }

    const uniqueCats: any[] = [];
    const seenNormalizedNames = new Set<string>();

    for (const cat of filteredCats) {
      const cleanedName = (cat.name || '').replace(/\\/g, '').trim();
      const normKey = cleanedName.toLowerCase();

      if (normKey && !seenNormalizedNames.has(normKey)) {
        seenNormalizedNames.add(normKey);
        uniqueCats.push({ ...cat, name: cleanedName });
      }
      if (uniqueCats.length === 5) break;
    }

    setCategories(uniqueCats);

    const standardPoints = currentRound === 'double_jeopardy' 
      ? [200, 400, 600, 800, 1000, 2000] 
      : [100, 200, 300, 400, 500, 1000];
    
    setBoardPoints(standardPoints);

    const catIds = uniqueCats.map(c => c.id);
    if (catIds.length > 0) {
      const { data: qData } = await supabase
        .from('questions')
        .select('*')
        .in('category_id', catIds);

      const map: { [catId: number]: { [points: number]: any } } = {};
      let allLoadedQuestions: any[] = [];
      const assignedIds = new Set<number>();

      uniqueCats.forEach(cat => {
        const catQuestions = (qData || []).filter(q => q.category_id === cat.id && !excludedIds.includes(q.id));
        const pointMap: { [points: number]: any } = {};
        
        standardPoints.forEach(targetPt => {
          const exactMatch = catQuestions.find(q => {
            const adjusted = currentRound === 'double_jeopardy' ? q.points * 2 : q.points;
            return adjusted === targetPt && !assignedIds.has(q.id);
          });

          if (exactMatch) {
            assignedIds.add(exactMatch.id);
            const adjustedPoints = currentRound === 'double_jeopardy' ? exactMatch.points * 2 : exactMatch.points;
            const processedQ = { ...exactMatch, points: adjustedPoints };
            pointMap[targetPt] = processedQ;
            allLoadedQuestions.push(processedQ);
          }
        });

        standardPoints.forEach(targetPt => {
          if (!pointMap[targetPt]) {
            const availableQ = catQuestions.find(q => !assignedIds.has(q.id));
            if (availableQ) {
              assignedIds.add(availableQ.id);
              const processedQ = { ...availableQ, points: targetPt };
              pointMap[targetPt] = processedQ;
              allLoadedQuestions.push(processedQ);
            }
          }
        });

        standardPoints.forEach(targetPt => {
          if (!pointMap[targetPt] && catQuestions.length > 0) {
            const fallbackQ = catQuestions[Math.floor(Math.random() * catQuestions.length)];
            const processedQ = { ...fallbackQ, points: targetPt, id: `${fallbackQ.id}-${cat.id}-${targetPt}` };
            pointMap[targetPt] = processedQ;
            allLoadedQuestions.push(processedQ);
          }
        });

        map[cat.id] = pointMap;
      });

      if (allLoadedQuestions.length > 0) {
        const shuffled = [...allLoadedQuestions].sort(() => Math.random() - 0.5);
        const selectedDDs = new Set(shuffled.slice(0, Math.min(2, shuffled.length)).map(q => q.id));
        setDailyDoubles(selectedDDs);
      }

      setQuestionsMap(map);
    }

    setLoading(false);
  }

  function startDoubleJeopardy() {
    const currentIds: number[] = [];
    Object.values(questionsMap).forEach(pointMap => {
      Object.values(pointMap).forEach((q: any) => currentIds.push(q.id));
    });

    const accumulatedExclusions = [...usedQuestionIds, ...currentIds];
    setUsedQuestionIds(accumulatedExclusions);
    setRound('double_jeopardy');
    fetchGameData('double_jeopardy', accumulatedExclusions);
  }

  async function startFinalMentis() {
    setLoading(true);
    
    let randomFinal = null;
    const { data: catData } = await supabase
      .from('categories')
      .select('id')
      .ilike('name', '%final%');

    if (catData && catData.length > 0) {
      const catIds = catData.map(c => c.id);
      const { data: finalQList } = await supabase
        .from('questions')
        .select('*')
        .in('category_id', catIds);

      if (finalQList && finalQList.length > 0) {
        randomFinal = finalQList[Math.floor(Math.random() * finalQList.length)];
      }
    }

    if (!randomFinal) {
      randomFinal = { clue: "Name the ultimate trivia champion.", answer: "MENTIS" };
    }

    setFinalQuestion(randomFinal);
    await fetchTeams();

    const initialWagers: { [id: string]: string } = {};
    teams.forEach((team) => { initialWagers[team.id] = '0'; });
    setFinalWagers(initialWagers);

    const initialCorrect: { [id: string]: boolean } = {};
    teams.forEach((team) => { initialCorrect[team.id] = false; });
    setFinalCorrectMap(initialCorrect);

    setRound('final');
    setFinalStep('wagering');
    setLoading(false);
  }

  function handleCellClick(question: any) {
    if (!question || answeredQuestions[question.id]) return;
    
    setActiveQuestion(question);
    setShowAnswer(false);
    setWagerError('');
    
    if (dailyDoubles.has(question.id)) {
      setIsDailyDoubleScreen(true);
      const activeTeamScore = teams[activeTeamIndex]?.score || 0;
      const maxAllowed = Math.max(question.points, activeTeamScore);
      setWagerAmount(maxAllowed.toString());
    } else {
      setIsDailyDoubleScreen(false);
    }
  }

  function handleScoreAdjustment(correct: boolean) {
    if (!activeQuestion) return;

    const isDD = dailyDoubles.has(activeQuestion.id);
    const pointsToUse = isDD ? (parseInt(wagerAmount) || 0) : activeQuestion.points;

    const currentTeam = teams[activeTeamIndex];
    if (currentTeam) {
      const updatedScore = correct ? currentTeam.score + pointsToUse : currentTeam.score - pointsToUse;
      updateTeamScore(currentTeam.id, updatedScore);
    }

    setAnsweredQuestions(prev => ({ ...prev, [activeQuestion.id]: true }));
    setActiveQuestion(null);
    setShowAnswer(false);
    setIsDailyDoubleScreen(false);
    setWagerAmount('');
    setWagerError('');
  }

  async function handleAddTeam(e: React.FormEvent) {
    e.preventDefault();
    if (!newTeamName.trim()) return;

    const { error } = await supabase
      .from('teams')
      .insert([{ name: newTeamName.trim(), score: 0, approved: true }]);

    if (!error) {
      setNewTeamName('');
      fetchTeams();
    }
  }

  async function handleRemoveTeam(teamId: number, e: React.MouseEvent) {
    e.stopPropagation();
    const { error } = await supabase
      .from('teams')
      .delete()
      .eq('id', teamId);

    if (!error) {
      fetchTeams();
      setActiveTeamIndex(0);
    }
  }

  async function handleResetScores() {
    for (const team of teams) {
      await supabase.from('teams').update({ score: 0 }).eq('id', team.id);
    }
    fetchTeams();
  }

  let totalQuestionsCount = 0;
  Object.values(questionsMap).forEach(pointMap => {
    totalQuestionsCount += Object.keys(pointMap).length;
  });
  const answeredCount = Object.keys(answeredQuestions).length;
  const isBoardFinished = totalQuestionsCount > 0 && answeredCount >= totalQuestionsCount;

  const isDJ = round === 'double_jeopardy';
  const isFinal = round === 'final';
  const bgMain = isFinal ? 'bg-[#20172a]' : isDJ ? 'bg-[#1e232d]' : 'bg-[#181c25]';
  const panelBg = isFinal ? 'bg-[#2b1f3a]' : isDJ ? 'bg-[#262c3a]' : 'bg-[#222733]';
  const borderColor = isFinal ? 'border-[#4a3563]' : isDJ ? 'border-[#374155]' : 'border-[#2f3748]';
  const headerGradient = isFinal 
    ? 'from-[#38264e] to-[#2d1e3e] border-[#5a4277] text-purple-200' 
    : isDJ 
    ? 'from-[#2a3447] to-[#222a38] border-[#475569] text-sky-200' 
    : 'from-[#283142] to-[#202735] border-[#3b465c] text-amber-200';
  const cellBg = isDJ 
    ? 'bg-[#242b38] hover:bg-[#2e3747] border-[#333d4e] text-sky-300' 
    : 'bg-[#222836] hover:bg-[#2b3344] border-[#313b4d] text-amber-300';

  if (loading) {
    return (
      <main className={`min-h-screen ${bgMain} text-slate-100 flex items-center justify-center`}>
        <div className="flex items-center gap-3 text-slate-300 font-medium text-lg animate-pulse">
          <RefreshCw className="w-5 h-5 animate-spin" /> Loading MENTIS...
        </div>
      </main>
    );
  }

  return (
    <main className={`min-h-screen ${bgMain} text-slate-100 p-6 flex flex-col justify-between transition-colors duration-500`}>
      <div className={`max-w-[1400px] mx-auto w-full flex justify-between items-center mb-6 pb-4 border-b ${borderColor}`}>
        <MentisLogo isDJ={isDJ} isFinal={isFinal} />

        <div className="flex items-center gap-3">
          {round !== 'final' && (
            <button
              onClick={() => fetchGameData(round, usedQuestionIds)}
              className={`flex items-center gap-2 ${panelBg} hover:opacity-90 text-slate-200 text-xs font-semibold py-2 px-4 rounded-xl border ${borderColor} transition cursor-pointer shadow-sm`}
            >
              <RefreshCw className="w-3.5 h-3.5" /> Refresh Board
            </button>
          )}
          
          <a
            href="/admin"
            className={`flex items-center gap-2 ${panelBg} hover:opacity-90 text-slate-200 text-xs font-semibold py-2 px-4 rounded-xl border ${borderColor} transition cursor-pointer shadow-sm`}
          >
            <Settings className="w-3.5 h-3.5" /> Admin Dashboard
          </a>
        </div>
      </div>

      {isFinal ? (
        <div className="max-w-3xl mx-auto w-full my-auto flex flex-col items-center justify-center flex-grow">
          <div className={`${panelBg} border-2 border-purple-500/50 w-full p-8 rounded-2xl shadow-2xl space-y-6 text-center`}>
            
            <div className="inline-flex items-center gap-2 bg-purple-500/20 text-purple-300 border border-purple-500/30 px-5 py-2 rounded-full text-sm font-extrabold uppercase tracking-widest">
              FINAL MENTIS
            </div>

            {finalStep === 'wagering' && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-black text-slate-100 mb-2">Secret Wagers</h2>
                  <p className="text-xs text-slate-400">Each team can wager up to their current total score.</p>
                </div>

                <div className="space-y-3 max-w-md mx-auto">
                  {teams.length === 0 ? (
                    <p className="text-xs text-amber-400 bg-amber-400/10 border border-amber-400/30 p-3 rounded-xl">
                      No approved teams found. Please approve teams via the Admin Panel.
                    </p>
                  ) : (
                    teams.map((team) => {
                      const maxAllowed = Math.max(0, team.score);
                      return (
                        <div key={team.id} className="flex items-center justify-between bg-[#1b1424] border border-[#422c5c] p-3 rounded-xl">
                          <div className="text-left">
                            <span className="font-bold text-sm text-slate-200 block">{team.name}</span>
                            <span className="text-[11px] text-purple-300">Score: {team.score} pts</span>
                          </div>
                          <input
                            type="number"
                            min="0"
                            max={maxAllowed}
                            value={finalWagers[team.id] || ''}
                            onChange={(e) => setFinalWagers({ ...finalWagers, [team.id]: e.target.value })}
                            className="w-28 p-2 bg-[#2b1f3a] border border-purple-400/50 rounded-lg text-center font-bold text-purple-200 text-sm outline-none"
                          />
                        </div>
                      );
                    })
                  )}
                </div>

                <button
                  onClick={() => setFinalStep('clue')}
                  className="bg-purple-600 hover:bg-purple-500 text-white font-bold py-3.5 px-8 rounded-xl transition text-sm cursor-pointer shadow-md"
                >
                  Reveal Final Clue
                </button>
              </div>
            )}

            {finalStep === 'clue' && (
              <div className="space-y-6">
                <div className="py-4">
                  <span className="text-xs text-purple-300 uppercase tracking-widest font-semibold block mb-2">Final Clue</span>
                  <h2 className="text-2xl sm:text-3xl font-bold leading-relaxed text-slate-100">
                    {finalQuestion?.clue}
                  </h2>
                </div>

                {showAnswer ? (
                  <div className="bg-[#1b1424] border border-[#422c5c] p-4 rounded-xl space-y-2">
                    <span className="text-xs text-slate-400 uppercase tracking-wide">Correct Answer:</span>
                    <p className="text-2xl font-black text-purple-300">{finalQuestion?.answer}</p>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowAnswer(true)}
                    className="bg-purple-600 hover:bg-purple-500 text-white font-bold py-3 px-6 rounded-xl transition text-sm cursor-pointer shadow-md"
                  >
                    Reveal Answer
                  </button>
                )}

                <div className="space-y-3 pt-2">
                  <span className="text-xs text-slate-400 uppercase tracking-wide block">Mark Team Results:</span>
                  <div className="space-y-2 max-w-md mx-auto">
                    {teams.map((team) => (
                      <label key={team.id} className="flex items-center justify-between bg-[#1b1424] border border-[#422c5c] p-3 rounded-xl cursor-pointer">
                        <span className="font-bold text-sm text-slate-200">{team.name} (Wager: {finalWagers[team.id] || 0})</span>
                        <input
                          type="checkbox"
                          checked={finalCorrectMap[team.id] || false}
                          onChange={(e) => setFinalCorrectMap({ ...finalCorrectMap, [team.id]: e.target.checked })}
                          className="w-5 h-5 rounded accent-purple-500 cursor-pointer"
                        />
                      </label>
                    ))}
                  </div>
                </div>

                <button
                  onClick={async () => {
                    for (const team of teams) {
                      const wager = parseInt(finalWagers[team.id]) || 0;
                      const isCorrect = finalCorrectMap[team.id] || false;
                      const updatedScore = isCorrect ? team.score + wager : team.score - wager;
                      await updateTeamScore(team.id, updatedScore);
                    }
                    setFinalStep('winner');
                  }}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3.5 px-8 rounded-xl transition text-sm cursor-pointer shadow-md"
                >
                  Calculate Final Scores & Declare Winner
                </button>
              </div>
            )}

            {finalStep === 'winner' && (
              <div className="space-y-6 py-4">
                <div className="w-16 h-16 bg-amber-400/20 text-amber-400 rounded-full flex items-center justify-center mx-auto text-2xl font-bold animate-bounce">
                  🏆
                </div>
                <div>
                  <h2 className="text-3xl font-black text-slate-100 mb-1">Final Results</h2>
                  <p className="text-xs text-slate-400">The game has concluded. Congratulations to the champions!</p>
                </div>

                <div className="space-y-3 max-w-md mx-auto">
                  {[...teams].sort((a, b) => b.score - a.score).map((team, idx) => (
                    <div key={team.id} className={`p-4 rounded-xl border flex justify-between items-center ${idx === 0 ? 'bg-amber-500/10 border-amber-400/60 ring-1 ring-amber-400/30' : 'bg-[#1b1424] border-[#422c5c]'}`}>
                      <div className="flex items-center gap-3">
                        <span className="font-black text-amber-400 text-base">#{idx + 1}</span>
                        <span className="font-bold text-sm text-slate-200">{team.name}</span>
                      </div>
                      <span className="font-black text-lg text-purple-300">{team.score} pts</span>
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => {
                    window.location.href = '/';
                  }}
                  className="bg-purple-600 hover:bg-purple-500 text-white font-bold py-3 px-6 rounded-xl transition text-sm cursor-pointer shadow-md"
                >
                  Play Again
                </button>
              </div>
            )}

          </div>
        </div>
      ) : (
        <div className="max-w-[1400px] mx-auto w-full flex flex-col lg:flex-row gap-8 items-start justify-center flex-grow relative">
          
          <div className="flex-grow w-full overflow-x-auto relative">
            {categories.length === 0 ? (
              <div className={`text-center py-20 ${panelBg} border ${borderColor} rounded-2xl p-8`}>
                <p className="text-slate-400 mb-4">No categories available or matching your filter configuration.</p>
                <a href="/admin" className="inline-block bg-amber-400 text-slate-950 font-bold px-6 py-3 rounded-xl text-sm">
                  Go to Admin Panel
                </a>
              </div>
            ) : (
              <div className="grid grid-cols-5 gap-3 w-full relative">
                {categories.map(cat => {
                  const catPointMap = questionsMap[cat.id] || {};

                  return (
                    <div key={cat.id} className="flex flex-col gap-3">
                      {/* Category Header */}
                      <div className={`bg-gradient-to-b ${headerGradient} border-2 font-bold text-center p-4 rounded-xl shadow-md uppercase tracking-wide text-xs sm:text-sm flex items-center justify-center min-h-[75px]`}>
                        {cat.name}
                      </div>

                      {/* Vertical Stack of Question Tiles Aligned by Points */}
                      {boardPoints.map(pointsVal => {
                        const question = catPointMap[pointsVal];
                        const isAnswered = question && answeredQuestions[question.id];

                        if (!question) {
                          return <div key={`${cat.id}-empty-${pointsVal}`} className="h-20 invisible"></div>;
                        }

                        return (
                          <button
                            key={`${cat.id}-${pointsVal}`}
                            disabled={isAnswered}
                            onClick={() => handleCellClick(question)}
                            className={`h-20 rounded-xl font-black text-xl transition-all duration-150 flex items-center justify-center border shadow-sm ${
                              isAnswered 
                                ? `${panelBg}/40 border-slate-800 text-slate-600 cursor-not-allowed` 
                                : `${cellBg} hover:brightness-125 cursor-pointer`
                            }`}
                          >
                            {isAnswered ? '—' : question.points}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}

            {isBoardFinished && (
              <div className="absolute inset-0 bg-slate-950/75 backdrop-blur-sm rounded-2xl flex flex-col items-center justify-center p-8 z-20 animate-in fade-in duration-300">
                <div className="bg-[#222733] border-2 border-amber-400 p-8 rounded-2xl shadow-2xl text-center space-y-6 max-w-md w-full">
                  <div className="w-12 h-12 bg-amber-400/20 text-amber-400 rounded-full flex items-center justify-center mx-auto text-xl font-bold">
                    ✓
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-slate-100 mb-2">
                      {round === 'jeopardy' ? 'Round 1 Completed!' : 'Double Mentis Completed!'}
                    </h3>
                    <p className="text-xs text-slate-400">
                      {round === 'jeopardy' ? 'Ready to unlock Double Mentis?' : 'Ready to proceed to Final Mentis?'}
                    </p>
                  </div>
                  {round === 'jeopardy' ? (
                    <button
                      onClick={startDoubleJeopardy}
                      className="w-full bg-gradient-to-r from-sky-500 to-sky-600 hover:from-sky-400 hover:to-sky-500 text-slate-950 font-bold py-3.5 px-6 rounded-xl transition shadow-md flex items-center justify-center gap-2 cursor-pointer text-sm"
                    >
                      Proceed to Double Mentis <ArrowRight className="w-4 h-4" />
                    </button>
                  ) : (
                    <button
                      onClick={startFinalMentis}
                      className="w-full bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-400 hover:to-purple-500 text-white font-bold py-3.5 px-6 rounded-xl transition shadow-md flex items-center justify-center gap-2 cursor-pointer text-sm"
                    >
                      Proceed to Final Mentis <ArrowRight className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className={`w-full lg:w-80 ${panelBg} border ${borderColor} p-5 rounded-2xl shadow-xl flex flex-col gap-4 flex-shrink-0`}>
            <div className={`flex justify-between items-center border-b ${borderColor} pb-3`}>
              <div className="flex items-center gap-2 text-sm font-bold text-slate-200">
                <Trophy className="w-4 h-4 text-amber-400" /> Team Scores
              </div>
              {teams.length > 0 && (
                <button
                  onClick={handleResetScores}
                  className="flex items-center gap-1 text-[11px] text-slate-400 hover:text-slate-200 font-medium bg-slate-800/60 hover:bg-slate-800 px-2.5 py-1 rounded-lg transition cursor-pointer"
                  title="Reset all team scores to 0"
                >
                  <RotateCcw className="w-3 h-3" /> Reset Scores
                </button>
              )}
            </div>

            <div className="flex flex-col gap-3 max-h-[300px] overflow-y-auto pr-1">
              {teams.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-4">No approved teams yet. Accept teams from the Admin dashboard.</p>
              ) : (
                teams.map((team, index) => (
                  <div
                    key={team.id}
                    onClick={() => setActiveTeamIndex(index)}
                    className={`p-3 rounded-xl border transition cursor-pointer flex justify-between items-center ${
                      activeTeamIndex === index 
                        ? `${isDJ ? 'bg-sky-950/30 border-sky-500/60 ring-1 ring-sky-500/30' : 'bg-slate-800/60 border-amber-400/60 ring-1 ring-amber-400/30'} shadow-sm` 
                        : 'bg-[#1b202a] border-[#293244] hover:opacity-90'
                    }`}
                  >
                    <span className="font-bold text-xs text-slate-200 truncate max-w-[140px]">{team.name}</span>
                    <div className="flex items-center gap-2">
                      <span className={`font-black text-base ${isDJ ? 'text-sky-300' : 'text-amber-300'}`}>{team.score}</span>
                      <button
                        onClick={(e) => handleRemoveTeam(team.id, e)}
                        className="text-slate-500 hover:text-red-400 transition p-1 cursor-pointer"
                        title="Remove team"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            <form onSubmit={handleAddTeam} className={`flex gap-2 pt-2 border-t ${borderColor}`}>
              <input
                type="text"
                placeholder="New team name..."
                value={newTeamName}
                onChange={(e) => setNewTeamName(e.target.value)}
                className={`flex-grow bg-[#1b202a] border ${borderColor} rounded-xl px-3 py-2 text-xs text-slate-200 outline-none focus:border-amber-400/50`}
              />
              <button
                type="submit"
                className="bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold px-3 py-2 rounded-xl text-xs transition cursor-pointer flex items-center justify-center shadow-sm"
              >
                <Plus className="w-4 h-4" />
              </button>
            </form>

            {/* LIVE BUZZER CONTROL PANEL */}
            <div className={`mt-2 pt-4 border-t ${borderColor} flex flex-col gap-3`}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <Zap className="w-3.5 h-3.5 text-amber-400" /> Live Buzzer
                </span>
                <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${buzzerActive ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'}`}>
                  {buzzerActive ? 'Active' : 'Locked'}
                </span>
              </div>

              {buzzerWinnerName ? (
  <div className="bg-[#0d1117] border border-[#21262d] rounded-xl p-4 text-center space-y-1">
    <span className="text-[10px] uppercase font-extrabold tracking-widest text-slate-500 block">First Buzzed Team</span>
    <p className="text-sm font-black tracking-wide text-amber-400 animate-pulse uppercase">
      {buzzerWinnerName}
    </p>
  </div>
) : (
  <div className="bg-[#0d1117] border border-[#21262d] rounded-xl p-4 text-center space-y-1">
    <span className="text-[10px] uppercase font-extrabold tracking-widest text-slate-500 block">First Buzzed Team</span>
    <p className="text-sm font-black tracking-wide text-slate-400 uppercase">
      NO BUZZES YET
    </p>
  </div>
)}

              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => toggleBuzzer(true)}
                  className={`flex-1 py-2 px-3 rounded-xl font-bold text-xs transition flex items-center justify-center gap-1.5 shadow-sm cursor-pointer ${buzzerActive ? 'bg-emerald-600/50 text-white cursor-default' : 'bg-emerald-600 hover:bg-emerald-500 text-white'}`}
                >
                  <Unlock className="w-3 h-3" /> Open
                </button>
                <button
                  onClick={() => toggleBuzzer(false)}
                  className={`flex-1 py-2 px-3 rounded-xl font-bold text-xs transition flex items-center justify-center gap-1.5 shadow-sm cursor-pointer ${!buzzerActive ? 'bg-rose-600/50 text-white cursor-default' : 'bg-rose-600 hover:bg-rose-500 text-white'}`}
                >
                  <Lock className="w-3 h-3" /> Lock
                </button>
              </div>
            </div>

          </div>

        </div>
      )}

      {/* QUESTION MODAL / DAILY DOUBLE SCREEN */}
      {activeQuestion && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4 z-50 animate-in fade-in duration-200">
          <div className={`${panelBg} border-2 ${isDJ ? 'border-sky-500/50' : 'border-amber-400/50'} max-w-2xl w-full p-8 rounded-3xl shadow-2xl space-y-6 text-center relative`}>
            
            {isDailyDoubleScreen ? (
              <div className="space-y-6">
                <div className="inline-flex items-center gap-2 bg-amber-400/20 text-amber-300 border border-amber-400/30 px-5 py-2 rounded-full text-sm font-extrabold uppercase tracking-widest animate-pulse">
                  <Flame className="w-4 h-4 text-amber-400" /> Daily Double!
                </div>
                
                <div>
                  <h3 className="text-xl font-bold text-slate-100 mb-1">Place Your Wager</h3>
                  <p className="text-xs text-slate-400">
                    Team: <span className="font-bold text-slate-200">{teams[activeTeamIndex]?.name}</span> (Score: {teams[activeTeamIndex]?.score})
                  </p>
                </div>

                <div className="space-y-2 max-w-xs mx-auto">
                  <input
                    type="number"
                    min="5"
                    max={Math.max(activeQuestion.points, teams[activeTeamIndex]?.score || 0)}
                    value={wagerAmount}
                    onChange={(e) => setWagerAmount(e.target.value)}
                    placeholder="Enter wager..."
                    className="w-full bg-[#1b202a] border border-[#374155] rounded-xl px-4 py-3 text-center text-xl font-black text-amber-300 outline-none focus:border-amber-400"
                  />
                  {wagerError && <p className="text-xs text-rose-400 font-medium">{wagerError}</p>}
                </div>

                <button
                  onClick={() => {
                    const parsed = parseInt(wagerAmount);
                    const maxAllowed = Math.max(activeQuestion.points, teams[activeTeamIndex]?.score || 0);
                    if (isNaN(parsed) || parsed < 5 || parsed > maxAllowed) {
                      setWagerError(`Wager must be between 5 and ${maxAllowed}`);
                      return;
                    }
                    setIsDailyDoubleScreen(false);
                    setWagerError('');
                  }}
                  className="bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold py-3 px-8 rounded-xl transition text-sm cursor-pointer shadow-md"
                >
                  Confirm Wager & View Clue
                </button>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="flex justify-between items-center text-xs font-bold text-slate-400 uppercase tracking-widest">
                  <span>{activeQuestion.points} Points</span>
                  {dailyDoubles.has(activeQuestion.id) && (
                    <span className="text-amber-400 flex items-center gap-1">
                      <Flame className="w-3.5 h-3.5" /> Daily Double ({wagerAmount} pts)
                    </span>
                  )}
                </div>

                <div className="py-4">
                  <h2 className="text-2xl sm:text-3xl font-bold leading-relaxed text-slate-100">
                    {activeQuestion.clue}
                  </h2>
                </div>

                {showAnswer ? (
                  <div className="bg-[#1b202a] border border-[#293244] p-4 rounded-2xl space-y-2 animate-in fade-in duration-200">
                    <span className="text-xs text-slate-400 uppercase tracking-wide">Correct Answer:</span>
                    <p className="text-2xl font-black text-amber-300">{activeQuestion.answer}</p>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowAnswer(true)}
                    className="bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold py-3 px-6 rounded-xl transition text-sm cursor-pointer border border-[#374155]"
                  >
                    Reveal Answer
                  </button>
                )}

                <div className="flex items-center justify-center gap-4 pt-4 border-t border-[#374155]">
                  <button
                    onClick={() => handleScoreAdjustment(false)}
                    className="flex-1 bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/40 font-bold py-3.5 px-6 rounded-xl transition text-sm cursor-pointer shadow-sm"
                  >
                    Incorrect (-{dailyDoubles.has(activeQuestion.id) ? wagerAmount : activeQuestion.points})
                  </button>
                  <button
                    onClick={() => handleScoreAdjustment(true)}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3.5 px-6 rounded-xl transition text-sm cursor-pointer shadow-md"
                  >
                    Correct (+{dailyDoubles.has(activeQuestion.id) ? wagerAmount : activeQuestion.points})
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>
      )}
    </main>
  );
}