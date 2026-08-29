'use client';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { 
  Settings, Layers, HelpCircle, Users, Play, 
  Trash2, Plus, ArrowLeft, CheckCircle2, AlertCircle, ShieldAlert, Zap, Monitor, QrCode 
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<'rounds' | 'teams' | 'questions' | 'settings' | 'cast'>('rounds');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [pendingTeam, setPendingTeam] = useState<any | null>(null);

  // Teams & Game State
  const [teams, setTeams] = useState<any[]>([]);
  const [newTeamName, setNewTeamName] = useState('');
  const [gameStarted, setGameStarted] = useState(false);
  const [activeRound, setActiveRound] = useState(1);
  const [buzzerOpen, setBuzzerOpen] = useState(false);
  const [buzzerWinnerName, setBuzzerWinnerName] = useState<string | null>(null);
  const [buzzedTeam, setBuzzedTeam] = useState<string | null>(null);

  // Categories & Questions State
  const [categories, setCategories] = useState<any[]>([]);
  const [selectedCatId, setSelectedCatId] = useState<number | ''>('');
  const [newCatName, setNewCatName] = useState('');
  
  // Manual Question Form
  const [manualClue, setManualClue] = useState('');
  const [manualAnswer, setManualAnswer] = useState('');
  const [manualPoints, setManualPoints] = useState('200');

  // Bulk Import State
  const [importText, setImportText] = useState('');

  // App Settings State
  const [appSettings, setAppSettings] = useState({
    randomize_categories: false,
    selected_category_ids: [] as number[],
  });

  const [originUrl, setOriginUrl] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setOriginUrl(window.location.origin);
    }
    loadAdminData();
    fetchPendingTeams();

    async function fetchInitialBuzzerState() {
      const { data: buzzerData } = await supabase.from('buzzers').select('*').eq('id', 1).maybeSingle();
      if (buzzerData) {
        setBuzzerOpen(buzzerData.active);
        if (buzzerData.winner_team_id) {
          const { data: teamData } = await supabase.from('teams').select('name').eq('id', buzzerData.winner_team_id).single();
          setBuzzerWinnerName(teamData ? teamData.name : null);
        } else {
          setBuzzerWinnerName(null);
        }
      }
    }
    fetchInitialBuzzerState();

    const approvalChannel = supabase
      .channel('team_approvals')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'teams' },
        (payload: any) => {
          if (payload.new && !payload.new.approved) {
            setPendingTeam(payload.new);
          }
        }
      )
      .subscribe();

    const buzzerChannel = supabase
      .channel('admin_buzzer_sync_realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'buzzers' },
        async (payload: any) => {
          const newData = payload.new;
          if (newData) {
            setBuzzerOpen(newData.active);
            if (newData.winner_team_id) {
              const { data: teamData } = await supabase.from('teams').select('name').eq('id', newData.winner_team_id).single();
              setBuzzerWinnerName(teamData ? teamData.name : 'A Team');
            } else {
              setBuzzerWinnerName(null);
            }
          }
        }
      )
      .subscribe();

    const fullSyncChannel = supabase
      .channel('admin_full_sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'teams' }, () => {
        fetchTeams();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_state' }, (payload: any) => {
        if (payload.new) {
          setGameStarted(payload.new.game_started ?? false);
          setActiveRound(payload.new.active_round ?? 1);
          setBuzzerOpen(payload.new.buzzer_open ?? false);
        }
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'buzzer_state' }, (payload: any) => {
        if (payload.new) {
          setBuzzedTeam(payload.new.buzzed_team);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(approvalChannel);
      supabase.removeChannel(buzzerChannel);
      supabase.removeChannel(fullSyncChannel);
    };
  }, []);

  async function fetchTeams() {
    const { data } = await supabase.from('teams').select('*').order('score', { ascending: false });
    if (data) {
      setTeams(data);
    }
  }

  async function fetchPendingTeams() {
    const { data } = await supabase
      .from('teams')
      .select('*')
      .eq('approved', false)
      .limit(1);

    if (data && data.length > 0) {
      setPendingTeam(data[0]);
    }
  }

  async function handleAcceptTeam() {
    if (!pendingTeam) return;
    await supabase.from('teams').update({ approved: true }).eq('id', pendingTeam.id);
    setPendingTeam(null);
    fetchTeams();
    showNotification(`Team "${pendingTeam.name}" accepted!`, 'success');
  }

  async function handleRejectTeam() {
    if (!pendingTeam) return;
    await supabase.from('teams').delete().eq('id', pendingTeam.id);
    setPendingTeam(null);
    showNotification(`Team request rejected.`, 'error');
  }

  async function loadAdminData() {
    setLoading(true);
    await fetchTeams();

    const { data: catData } = await supabase.from('categories').select('*').order('name');
    if (catData) setCategories(catData);

    const { data: gState } = await supabase.from('game_state').select('*').maybeSingle();
    if (gState) {
      setGameStarted(gState.game_started ?? false);
      setActiveRound(gState.active_round ?? 1);
      setBuzzerOpen(gState.buzzer_open ?? false);
    }

    const { data: bState } = await supabase.from('buzzer_state').select('*').maybeSingle();
    if (bState) {
      setBuzzedTeam(bState.buzzed_team);
    }

    const { data: settData } = await supabase.from('app_settings').select('*').eq('id', 1).maybeSingle();
    if (settData) {
      setAppSettings({
        randomize_categories: settData.randomize_categories ?? false,
        selected_category_ids: settData.selected_category_ids ?? [],
      });
    }
    setLoading(false);
  }

  function showNotification(text: string, type: 'success' | 'error') {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 4000);
  }

  async function handleAddTeam(e: React.FormEvent) {
    e.preventDefault();
    if (!newTeamName.trim()) return;
    const name = newTeamName.trim();
    const { error } = await supabase.from('teams').upsert({ name, score: 0 }, { onConflict: 'name' });
    if (error) {
      showNotification(error.message, 'error');
    } else {
      setNewTeamName('');
      fetchTeams();
      showNotification('Team added successfully!', 'success');
    }
  }

  async function handleDeleteTeam(id: number) {
    const { error } = await supabase.from('teams').delete().eq('id', id);
    if (error) {
      showNotification(error.message, 'error');
    } else {
      fetchTeams();
      showNotification('Team removed.', 'success');
    }
  }

  async function handleUpdateScore(id: number, currentScore: number, amount: number) {
    const newScore = currentScore + amount;
    await supabase.from('teams').update({ score: newScore }).eq('id', id);
    fetchTeams();
  }

  async function handleResetGame() {
    if (!confirm('Are you sure you want to reset the entire game and clear all teams?')) return;
    
    await supabase.from('teams').delete().neq('id', 0);
    await supabase.from('game_state').update({ game_started: false, buzzer_open: false, active_round: 1, last_refreshed: Date.now() }).eq('id', 1);
    await supabase.from('questions').update({ is_answered: false }).neq('id', 0);
    await supabase.from('buzzer_state').update({ buzzed_team: null }).eq('id', 1);
    
    fetchTeams();
    showNotification('Game fully reset.', 'success');
  }

  async function toggleBuzzer() {
    const nextState = !buzzerOpen;
    await supabase.from('buzzers').update({ active: nextState, winner_team_id: null }).eq('id', 1);
    setBuzzerOpen(nextState);
  }

  async function resetBuzzer() {
    await supabase.from('buzzers').update({ active: false, winner_team_id: null }).eq('id', 1);
    setBuzzerWinnerName(null);
    showNotification('Buzzer queue cleared.', 'success');
  }

  async function handleAddCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!newCatName.trim()) return;

    const { error } = await supabase.from('categories').insert([{ name: newCatName.trim() }]);
    if (error) {
      showNotification(error.message, 'error');
    } else {
      showNotification('Category added successfully!', 'success');
      setNewCatName('');
      loadAdminData();
    }
  }

  async function handleDeleteCategory(id: number) {
    if (!confirm('Are you sure? This will delete all questions linked to this category.')) return;
    await supabase.from('questions').delete().eq('category_id', id);
    const { error } = await supabase.from('categories').delete().eq('id', id);
    if (error) {
      showNotification(error.message, 'error');
    } else {
      showNotification('Category deleted.', 'success');
      loadAdminData();
    }
  }

  async function handleManualQuestionSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedCatId || !manualClue.trim() || !manualAnswer.trim()) {
      showNotification('Please fill in all question fields and select a category.', 'error');
      return;
    }

    const { error } = await supabase.from('questions').insert([{
      category_id: selectedCatId,
      clue: manualClue.trim(),
      answer: manualAnswer.trim(),
      points: parseInt(manualPoints) || 200
    }]);

    if (error) {
      showNotification(error.message, 'error');
    } else {
      showNotification('Question added successfully!', 'success');
      setManualClue('');
      setManualAnswer('');
    }
  }

  async function handleBulkImport() {
    if (!importText.trim()) {
      showNotification('Please enter text to import.', 'error');
      return;
    }

    const lines = importText.split(/\r?\n/);
    let currentCatId: number | null = null;
    let successCount = 0;

    for (let rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      if (line.startsWith('#')) {
        const catName = line.replace('#', '').trim();
        if (!catName) continue;

        const { data: existingCat } = await supabase
          .from('categories')
          .select('id')
          .ilike('name', catName)
          .maybeSingle();

        if (existingCat) {
          currentCatId = existingCat.id;
        } else {
          const { data: newCat, error: catError } = await supabase
            .from('categories')
            .insert([{ name: catName }])
            .select('id')
            .single();

          if (catError) {
            console.error('Category insert error:', catError);
          } else if (newCat) {
            currentCatId = newCat.id;
          }
        }
        continue;
      }

      if (currentCatId && line.includes('|')) {
        const parts = line.split('|').map(p => p.trim());
        if (parts.length >= 2) {
          const clue = parts[0];
          const answer = parts[1];
          const points = parts[2] ? parseInt(parts[2], 10) || 200 : 200;

          const { error: qError } = await supabase.from('questions').insert({
            category_id: currentCatId,
            clue: clue,
            answer: answer,
            points: points
          });

          if (qError) {
            console.error('Question insert error:', qError);
          } else {
            successCount++;
          }
        }
      }
    }

    if (successCount > 0) {
      showNotification(`Successfully imported ${successCount} questions!`, 'success');
      setImportText('');
      loadAdminData();
    } else {
      showNotification('Import failed. Check your # category headers and | separators.', 'error');
    }
  }

  return (
    <main className="min-h-screen bg-[#0d1117] text-slate-100 p-6 md:p-8 select-none">
      <div className="max-w-6xl mx-auto space-y-6">
        
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-[#161b22] border border-[#21262d] px-8 py-5 rounded-2xl shadow-xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#f0b429] text-[#0d1117] rounded-xl flex items-center justify-center font-black text-lg shadow-md">
              M
            </div>
            <div>
              <h1 className="text-sm font-black tracking-widest text-white uppercase">MENTIS ADMIN</h1>
              <p className="text-[10px] text-[#f0b429] font-bold uppercase tracking-wider">Control Panel & Configuration</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <a
              href="/cast"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-[#0d1117] hover:bg-[#21262d] text-slate-300 text-xs font-bold py-2.5 px-4 rounded-xl border border-[#21262d] transition"
            >
              Open Cast Screen ↗
            </a>
            <a
              href="/buzzer"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-[#f0b429]/10 hover:bg-[#f0b429]/20 text-[#f0b429] text-xs font-bold py-2.5 px-4 rounded-xl border border-[#f0b429]/30 transition"
            >
              Open Buzzer Screen ↗
            </a>
            <button
              onClick={handleResetGame}
              className="flex items-center gap-2 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 text-xs font-bold py-2.5 px-4 rounded-xl transition cursor-pointer"
            >
              <ShieldAlert className="w-4 h-4" /> Reset Game
            </button>
          </div>
        </div>

        {pendingTeam && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-[#161b22] border border-[#21262d] max-w-md w-full p-6 rounded-3xl shadow-2xl space-y-6 text-center animate-in fade-in zoom-in duration-200">
              <div className="w-12 h-12 bg-[#f0b429]/10 border border-[#f0b429]/30 text-[#f0b429] rounded-2xl mx-auto flex items-center justify-center font-black">
                ?
              </div>
              <div className="space-y-2">
                <h3 className="text-base font-black uppercase tracking-wider text-white">New Team Join Request</h3>
                <p className="text-xs text-slate-400">Team <span className="text-[#f0b429] font-bold text-sm uppercase">"{pendingTeam.name}"</span> wants to join the game.</p>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  onClick={handleRejectTeam}
                  className="flex-1 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 font-bold py-3 rounded-xl text-xs uppercase tracking-wider transition cursor-pointer"
                >
                  Reject
                </button>
                <button
                  onClick={handleAcceptTeam}
                  className="flex-1 bg-[#f0b429] hover:bg-[#d99f22] text-[#0d1117] font-black py-3 rounded-xl text-xs uppercase tracking-wider transition cursor-pointer shadow-md"
                >
                  Accept Team
                </button>
              </div>
            </div>
          </div>
        )}

        {message && (
          <div className={`p-4 rounded-xl border flex items-center gap-3 text-xs font-bold shadow-md ${
            message.type === 'success' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
          }`}>
            {message.type === 'success' ? <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 flex-shrink-0" />}
            <span>{message.text}</span>
          </div>
        )}

        <div className="flex flex-wrap gap-2 border-b border-[#21262d] pb-4">
          {[
            { id: 'rounds', label: 'Game & Rounds', icon: Play },
            { id: 'teams', label: 'Teams & Scores', icon: Users },
            { id: 'questions', label: 'Categories & Questions', icon: HelpCircle },
            { id: 'settings', label: 'Board Settings', icon: Layers },
            { id: 'cast', label: 'Cast Screen', icon: Monitor },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-2 px-5 py-3 rounded-xl text-xs font-bold transition cursor-pointer ${
                  isActive 
                    ? 'bg-[#f0b429] text-[#0d1117] shadow-md font-black' 
                    : 'bg-[#161b22] hover:bg-[#21262d] text-slate-300 border border-[#21262d]'
                }`}
              >
                <Icon className="w-4 h-4" /> {tab.label}
              </button>
            );
          })}
        </div>

        {activeTab === 'rounds' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="bg-[#161b22] border border-[#21262d] p-6 rounded-2xl shadow-xl space-y-4">
              <div className="w-8 h-8 bg-[#f0b429]/10 text-[#f0b429] border border-[#f0b429]/30 rounded-xl flex items-center justify-center font-black text-xs">1</div>
              <h3 className="text-sm font-black uppercase tracking-wide text-slate-100">Mentis</h3>
              <p className="text-xs text-slate-400 leading-relaxed">Standard game board featuring normal point tiers and randomized categories.</p>
              <a
                href="/"
                target="_blank"
                rel="noopener noreferrer"
                className="block text-center bg-[#f0b429] hover:bg-[#d99f22] text-[#0d1117] font-black py-3 rounded-xl text-xs uppercase tracking-wider transition cursor-pointer shadow-sm"
              >
                Launch Mentis ↗
              </a>
            </div>

            <div className="bg-[#161b22] border border-[#21262d] p-6 rounded-2xl shadow-xl space-y-4">
              <div className="w-8 h-8 bg-sky-400/10 text-sky-400 border border-sky-400/30 rounded-xl flex items-center justify-center font-black text-xs">2</div>
              <h3 className="text-sm font-black uppercase tracking-wide text-slate-100">Double Mentis</h3>
              <p className="text-xs text-slate-400 leading-relaxed">Advanced board layout with doubled point values and fresh question pools.</p>
              <a
                href="/?round=double_jeopardy"
                target="_blank"
                rel="noopener noreferrer"
                className="block text-center bg-sky-500 hover:bg-sky-400 text-slate-950 font-black py-3 rounded-xl text-xs uppercase tracking-wider transition cursor-pointer shadow-sm"
              >
                Launch Double Mentis ↗
              </a>
            </div>

            <div className="bg-[#161b22] border border-[#21262d] p-6 rounded-2xl shadow-xl space-y-4">
              <div className="w-8 h-8 bg-purple-400/10 text-purple-400 border border-purple-400/30 rounded-xl flex items-center justify-center font-black text-xs">3</div>
              <h3 className="text-sm font-black uppercase tracking-wide text-slate-100">Final Mentis</h3>
              <p className="text-xs text-slate-400 leading-relaxed">Secret wagering round where teams put their cumulative scores on the line.</p>
              <a
                href="/?round=final"
                target="_blank"
                rel="noopener noreferrer"
                className="block text-center bg-purple-600 hover:bg-purple-500 text-white font-black py-3 rounded-xl text-xs uppercase tracking-wider transition cursor-pointer shadow-sm"
              >
                Launch Final Mentis ↗
              </a>
            </div>
          </div>
        )}

        {activeTab === 'teams' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
            <div className="lg:col-span-2 bg-[#161b22] border border-[#21262d] p-6 rounded-2xl shadow-xl space-y-5">
              <div className="flex items-center justify-between border-b border-[#21262d] pb-3">
                <h3 className="text-xs font-black uppercase tracking-wider text-white">Manage Teams & Scores</h3>
                <span className="text-[11px] text-slate-400 font-bold">{teams.length} Teams Registered</span>
              </div>

              <form onSubmit={handleAddTeam} className="flex gap-2">
                <input
                  type="text"
                  placeholder="Enter new team name..."
                  value={newTeamName}
                  onChange={(e) => setNewTeamName(e.target.value)}
                  className="flex-grow bg-[#0d1117] border border-[#21262d] px-4 py-3 rounded-xl text-xs text-slate-200 outline-none placeholder-slate-500 focus:border-[#f0b429]"
                />
                <button
                  type="submit"
                  className="bg-[#f0b429] hover:bg-[#d99f22] text-[#0d1117] font-black px-6 py-3 rounded-xl text-xs uppercase tracking-wider transition cursor-pointer flex items-center gap-2 shadow-sm"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Team
                </button>
              </form>

              <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
                {teams.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-10">No teams added yet. Add a team above.</p>
                ) : (
                  teams.map((team) => (
                    <div key={team.id} className="flex justify-between items-center bg-[#0d1117] border border-[#21262d] p-3.5 rounded-xl">
                      <span className="text-xs font-bold text-slate-200 uppercase tracking-wide">{team.name}</span>
                      
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-black text-[#f0b429]">{team.score} pts</span>
                        
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => handleUpdateScore(team.id, team.score, 100)}
                            className="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-[11px] font-bold px-2.5 py-1.5 rounded-lg transition cursor-pointer"
                          >
                            +100
                          </button>
                          <button
                            onClick={() => handleUpdateScore(team.id, team.score, -100)}
                            className="bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 text-[11px] font-bold px-2.5 py-1.5 rounded-lg transition cursor-pointer"
                          >
                            -100
                          </button>
                          <button
                            onClick={() => handleDeleteTeam(team.id)}
                            className="bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 text-[11px] font-bold px-2 py-1.5 rounded-lg transition ml-1 cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Live Buzzer Control Box */}
            <div className="bg-[#161b22] border border-[#21262d] rounded-2xl p-5 space-y-4 shadow-xl">
              
              {/* Header */}
              <div className="flex items-center gap-2 text-xs font-black uppercase tracking-wider text-slate-400">
                <Zap className="w-4 h-4 text-amber-400 fill-current" />
                <span>Live Buzzer Control</span>
              </div>

              {/* First Buzzed Team Display Area */}
              <div className="bg-[#0d1117] border border-[#21262d] rounded-xl p-4 text-center space-y-1">
                <span className="text-[10px] uppercase font-extrabold tracking-widest text-slate-500 block">First Buzzed Team</span>
                <p className={`text-sm font-black tracking-wide ${buzzerWinnerName ? 'text-amber-400 animate-pulse' : 'text-slate-400'}`}>
                  {buzzerWinnerName ? buzzerWinnerName.toUpperCase() : 'NO BUZZES YET'}
                </p>
              </div>

              {/* Open/Lock Action Button */}
              <button
                onClick={toggleBuzzer}
                className={`w-full py-3.5 rounded-xl font-black text-xs uppercase tracking-wider transition cursor-pointer shadow-lg ${
                  buzzerOpen
                    ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-rose-900/20'
                    : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950 shadow-emerald-900/20'
                }`}
              >
                {buzzerOpen ? 'Lock Buzzers' : 'Open Buzzers'}
              </button>

              {/* Reset Queue Button */}
              <button
                onClick={resetBuzzer}
                className="w-full bg-[#0d1117] hover:bg-[#21262d] border border-[#21262d] text-slate-300 font-bold py-3 rounded-xl text-xs uppercase tracking-wider transition cursor-pointer"
              >
                Reset Buzzer Queue
              </button>

            </div>

          </div>
        )}

        {activeTab === 'questions' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-[#161b22] border border-[#21262d] p-6 rounded-2xl shadow-xl space-y-5">
              <h3 className="text-xs font-black uppercase tracking-wider text-white border-b border-[#21262d] pb-3">Categories</h3>

              <form onSubmit={handleAddCategory} className="flex gap-2">
                <input
                  type="text"
                  placeholder="New category name..."
                  value={newCatName}
                  onChange={(e) => setNewCatName(e.target.value)}
                  className="flex-grow bg-[#0d1117] border border-[#21262d] px-4 py-3 rounded-xl text-xs text-slate-200 outline-none placeholder-slate-500 focus:border-[#f0b429]"
                />
                <button
                  type="submit"
                  className="bg-[#f0b429] hover:bg-[#d99f22] text-[#0d1117] font-black px-5 py-3 rounded-xl text-xs uppercase tracking-wider transition cursor-pointer flex items-center gap-2 shadow-sm"
                >
                  <Plus className="w-3.5 h-3.5" /> Add
                </button>
              </form>

              <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                {categories.length === 0 ? (
                  <p className="text-xs text-slate-500 text-center py-6">No categories found.</p>
                ) : (
                  categories.map((cat) => (
                    <div key={cat.id} className="flex justify-between items-center bg-[#0d1117] border border-[#21262d] p-3 rounded-xl">
                      <span className="text-xs font-bold text-slate-200 uppercase">{cat.name}</span>
                      <button
                        onClick={() => handleDeleteCategory(cat.id)}
                        className="text-slate-500 hover:text-rose-400 transition p-1 cursor-pointer"
                        title="Delete Category"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="bg-[#161b22] border border-[#21262d] p-6 rounded-2xl shadow-xl space-y-5">
              <h3 className="text-xs font-black uppercase tracking-wider text-white border-b border-[#21262d] pb-3">Add Questions</h3>

              <div>
                <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest block mb-1.5">Target Category</label>
                <select
                  value={selectedCatId}
                  onChange={(e) => setSelectedCatId(e.target.value ? Number(e.target.value) : '')}
                  className="w-full bg-[#0d1117] border border-[#21262d] p-3 rounded-xl text-xs text-slate-200 outline-none focus:border-[#f0b429]"
                >
                  <option value="">-- Select Category --</option>
                  {categories.map(cat => (
                    <option key={cat.id} value={cat.id}>{cat.name}</option>
                  ))}
                </select>
              </div>

              <form onSubmit={handleManualQuestionSubmit} className="space-y-3 pt-2 border-t border-[#21262d]">
                <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest block">Single Question Entry</span>
                <input
                  type="text"
                  placeholder="Clue / Question text..."
                  value={manualClue}
                  onChange={(e) => setManualClue(e.target.value)}
                  className="w-full bg-[#0d1117] border border-[#21262d] p-2.5 rounded-xl text-xs text-slate-200 outline-none focus:border-[#f0b429]"
                />
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Answer..."
                    value={manualAnswer}
                    onChange={(e) => setManualAnswer(e.target.value)}
                    className="flex-grow bg-[#0d1117] border border-[#21262d] p-2.5 rounded-xl text-xs text-slate-200 outline-none focus:border-[#f0b429]"
                  />
                  <select
                    value={manualPoints}
                    onChange={(e) => setManualPoints(e.target.value)}
                    className="w-28 bg-[#0d1117] border border-[#21262d] p-2.5 rounded-xl text-xs text-slate-200 outline-none"
                  >
                    <option value="200">200 pts</option>
                    <option value="400">400 pts</option>
                    <option value="600">600 pts</option>
                    <option value="800">800 pts</option>
                    <option value="1000">1000 pts</option>
                  </select>
                </div>
                <button
                  type="submit"
                  className="w-full bg-[#21262d] hover:bg-slate-800 text-slate-200 font-bold py-2.5 rounded-xl text-xs uppercase tracking-wider transition cursor-pointer border border-[#30363d]"
                >
                  Add Single Question
                </button>
              </form>

              <div className="space-y-3 pt-2 border-t border-[#21262d]">
                <span className="text-[10px] font-bold text-slate-300 uppercase tracking-widest block">
                  Bulk Import (.txt File or Paste Text)
                </span>
                
                <textarea
                  placeholder="# Category Name&#10;Clue | Answer | Points (optional)&#10;What is the capital of France? | Paris | 200"
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  rows={5}
                  className="w-full bg-[#0d1117] border border-[#21262d] p-3 rounded-xl text-xs text-slate-200 outline-none focus:border-[#f0b429] font-mono resize-none"
                />
                <button
                  type="button"
                  onClick={handleBulkImport}
                  className="w-full bg-[#f0b429] hover:bg-[#d99f22] text-[#0d1117] font-black py-3 rounded-xl text-xs uppercase tracking-wider transition cursor-pointer shadow-sm"
                >
                  Import Questions
                </button>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="bg-[#161b22] border border-[#21262d] p-6 rounded-2xl shadow-xl space-y-5 max-w-xl">
            <h3 className="text-xs font-black uppercase tracking-wider text-white border-b border-[#21262d] pb-3">Game Board Settings</h3>
            <p className="text-xs text-slate-400">Configure global board preferences and category randomization behavior.</p>
            
            <div className="flex items-center justify-between bg-[#0d1117] border border-[#21262d] p-4 rounded-xl">
              <div>
                <span className="text-xs font-bold text-slate-200 block uppercase">Randomize Categories</span>
                <span className="text-[11px] text-slate-500">Pick random categories from the database on board load.</span>
              </div>
              <input 
                type="checkbox" 
                checked={appSettings.randomize_categories}
                onChange={async (e) => {
                  const val = e.target.checked;
                  setAppSettings(prev => ({ ...prev, randomize_categories: val }));
                  await supabase.from('app_settings').update({ randomize_categories: val }).eq('id', 1);
                  showNotification('Settings updated.', 'success');
                }}
                className="w-4 h-4 accent-[#f0b429] cursor-pointer"
              />
            </div>
          </div>
        )}

        {activeTab === 'cast' && (
          <div className="bg-[#161b22] border border-[#21262d] p-6 rounded-2xl shadow-xl space-y-6 max-w-xl">
            <div className="flex items-center justify-between border-b border-[#21262d] pb-3">
              <h3 className="text-xs font-black uppercase tracking-wider text-white">Cast Screen QR & Link</h3>
              <Monitor className="w-4 h-4 text-[#f0b429]" />
            </div>

            <p className="text-xs text-slate-400 leading-relaxed">
              Open or cast this URL on your secondary display, projector, or stream output. It automatically syncs live game state and scores.
            </p>

            {originUrl && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 bg-[#0d1117] border border-[#21262d] p-3 rounded-xl">
                  <input
                    type="text"
                    readOnly
                    value={`${originUrl}/cast`}
                    className="flex-grow bg-transparent text-xs text-slate-300 outline-none font-mono px-2"
                  />
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(`${originUrl}/cast`);
                      showNotification('Cast URL copied to clipboard!', 'success');
                    }}
                    className="bg-[#f0b429] hover:bg-[#d99f22] text-[#0d1117] font-black text-xs px-4 py-2 rounded-lg transition cursor-pointer"
                  >
                    Copy
                  </button>
                </div>

                <div className="bg-[#0d1117] border border-[#21262d] p-6 rounded-2xl flex flex-col items-center justify-center space-y-3">
                  <div className="bg-white p-3 rounded-xl shadow-md">
                    <QRCodeSVG value={`${originUrl}/cast`} size={160} />
                  </div>
                  <span className="text-[10px] uppercase font-bold tracking-widest text-slate-500">Scan to Open Cast Screen</span>
                </div>
              </div>
            )}
          </div>
        )}

      </div>
    </main>
  );
}