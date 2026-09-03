'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import {
  RefreshCw,
  Trophy,
  Plus,
  Settings,
  Trash2,
  Users,
  Zap,
  Play,
  CheckCircle2,
  AlertCircle,
  ShieldAlert
} from 'lucide-react';

/**
 * Full Admin dashboard (modified)
 * - Minimal, focused fixes:
 *   - Use safe channel creation / subscribe / removal pattern to avoid "on after subscribe" and "unsubscribe is not a function" runtime errors
 *   - Use explicit UPDATE (eq('id', 1)) for Launch Mentis / Launch Double writes and log the result
 * - No other behavior/UI changes
 */

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<'rounds' | 'teams' | 'questions' | 'settings' | 'cast'>('rounds');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Pending team join request (popup)
  const [pendingTeam, setPendingTeam] = useState<any | null>(null);

  // Teams
  const [teams, setTeams] = useState<any[]>([]);
  const [newTeamName, setNewTeamName] = useState('');

  // Game / rounds
  const [gameMode, setGameMode] = useState<'buzzer' | 'turn' | 'unknown'>('unknown');
  const [buzzerOpen, setBuzzerOpen] = useState(false);
  const [buzzerWinnerName, setBuzzerWinnerName] = useState<string | null>(null);
  const [activeRound, setActiveRound] = useState<number | string>(1);

  // Questions (manual / bulk)
  const [categories, setCategories] = useState<any[]>([]);
  const [selectedCatId, setSelectedCatId] = useState<number | ''>('');
  const [newCatName, setNewCatName] = useState('');
  const [manualClue, setManualClue] = useState('');
  const [manualAnswer, setManualAnswer] = useState('');
  const [manualPoints, setManualPoints] = useState('100');
  const [importText, setImportText] = useState('');

  // Settings
  const [appSettings, setAppSettings] = useState<any>({ randomize_categories: false, selected_category_ids: [] as number[] });

  // Cast / origin
  const [originUrl, setOriginUrl] = useState('');

  // --- Channel helpers (local) ---
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

  useEffect(() => {
    if (typeof window !== 'undefined') setOriginUrl(window.location.origin);
    loadAdminData();
    fetchPendingTeams();

    // We'll create channel objects, attach handlers, then safeSubscribe
    const approvalChannel = createChannel('team_approvals');
    approvalChannel.on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'teams' }, (payload: any) => {
      if (payload.new && !payload.new.approved) setPendingTeam(payload.new);
    });
    safeSubscribe(approvalChannel);

    // buzzer sync channel
    const buzzerChannel = createChannel('admin_buzzer_sync_realtime');
    buzzerChannel.on('postgres_changes', { event: '*', schema: 'public', table: 'buzzers' }, async (payload: any) => {
      const newData = payload.new;
      if (newData) {
        setBuzzerOpen(!!newData.active);
        if (newData.winner_team_id) {
          const { data: t } = await supabase.from('teams').select('name').eq('id', newData.winner_team_id).maybeSingle();
          setBuzzerWinnerName(t ? t.name : null);
        } else setBuzzerWinnerName(null);
      }
    });
    safeSubscribe(buzzerChannel);

    // global game_state watcher (mode/round)
    const gsChannel = createChannel('admin_game_state');
    gsChannel.on('postgres_changes', { event: '*', schema: 'public', table: 'game_state' }, (payload: any) => {
      if (payload.new) {
        setGameMode(payload.new.mode ?? 'unknown');
        setActiveRound(payload.new.active_round ?? 1);
        setBuzzerOpen(payload.new.buzzer_open ?? false);
      }
    });
    safeSubscribe(gsChannel);

    // cleanup
    return () => {
      safeRemoveChannel(approvalChannel);
      safeRemoveChannel(buzzerChannel);
      safeRemoveChannel(gsChannel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadAdminData() {
    setLoading(true);
    await fetchTeams();
    const { data: catData } = await supabase.from('categories').select('*').order('name');
    if (catData) setCategories(catData);
    const { data: gState } = await supabase.from('game_state').select('*').maybeSingle();
    if (gState) {
      setGameMode(gState.mode ?? 'unknown');
      setActiveRound(gState.active_round ?? 1);
      setBuzzerOpen(gState.buzzer_open ?? false);
    }
    const { data: sett } = await supabase.from('app_settings').select('*').eq('id', 1).maybeSingle();
    if (sett) setAppSettings({ randomize_categories: sett.randomize_categories ?? false, selected_category_ids: sett.selected_category_ids ?? [] });
    setLoading(false);
  }

  async function fetchTeams() {
    const { data } = await supabase.from('teams').select('*').order('score', { ascending: false });
    if (data) setTeams(data);
  }

  async function fetchPendingTeams() {
    const { data } = await supabase.from('teams').select('*').eq('approved', false).limit(1);
    if (data && data.length) setPendingTeam(data[0]);
  }

  function showNotification(text: string, type: 'success' | 'error') {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 4000);
  }

  // --- Teams controls ---
  async function handleAddTeam(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!newTeamName.trim()) return;
    const name = newTeamName.trim();
    const { error } = await supabase.from('teams').upsert({ name, score: 0 }, { onConflict: 'name' });
    if (error) showNotification(error.message, 'error');
    else { setNewTeamName(''); fetchTeams(); showNotification('Team added', 'success'); }
  }

  async function handleDeleteTeam(id: number) {
    const { error } = await supabase.from('teams').delete().eq('id', id);
    if (error) showNotification(error.message, 'error'); else { fetchTeams(); showNotification('Team removed', 'success'); }
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
    showNotification('Team request rejected.', 'error');
  }

  // --- Buzzer & Game controls ---
  async function toggleBuzzer() {
    const nextState = !buzzerOpen;
    await supabase.from('buzzers').upsert({ id: 1, active: nextState, winner_team_id: null });
    setBuzzerOpen(nextState);
    showNotification(nextState ? 'Buzzer opened' : 'Buzzer closed', 'success');
  }

  async function resetBuzzer() {
    await supabase.from('buzzers').update({ active: false, winner_team_id: null }).eq('id', 1);
    setBuzzerWinnerName(null);
    showNotification('Buzzer queue cleared.', 'success');
  }

  async function setMode(mode: 'buzzer' | 'turn') {
    const { error } = await supabase.from('game_state').update({ mode }).eq('id', 1);
    if (error) showNotification(`Failed to set mode: ${error.message}`, 'error');
    else { setGameMode(mode); showNotification(`Mode set to ${mode}`, 'success'); }
  }

  async function setCurrentTurn(teamId: number | null) {
    const { error } = await supabase.from('game_state').update({ current_turn_team_id: teamId }).eq('id', 1);
    if (error) showNotification(`Failed to set current turn: ${error.message}`, 'error');
    else showNotification(teamId ? 'Current turn set.' : 'Cleared current turn.', 'success');
  }

  // NEXT TURN random non-repeating until cycle end (safe)
  async function nextRandomTurn() {
    const { data: teamsData, error: teamErr } = await supabase.from('teams').select('id,name').eq('approved', true);
    if (teamErr || !teamsData || teamsData.length === 0) { showNotification('No approved teams available', 'error'); return; }
    const teamIds = teamsData.map(t => t.id);

    const { data: gs } = await supabase.from('game_state').select('turn_history').maybeSingle();
    const history: number[] = (gs && gs.turn_history) ? gs.turn_history : [];

    let candidates = teamIds.filter(id => !history.includes(id));

    if (candidates.length === 0) {
      // all teams had a turn — continue if questions remain, else stop
      const { count } = await supabase.from('questions').select('*', { count: 'exact', head: true }).eq('is_answered', false);
      if ((count ?? 0) > 0) {
        const { error } = await supabase.from('game_state').update({ turn_history: [] }).eq('id', 1);
        if (error) { showNotification('Failed to reset turn history', 'error'); return; }
        candidates = [...teamIds];
      } else { showNotification('No unanswered questions left; no next turn selected', 'success'); return; }
    }

    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    const newHistory = [...history.filter(Boolean), chosen];

    const { error } = await supabase.from('game_state').update({ current_turn_team_id: chosen, turn_history: newHistory }).eq('id', 1);
    if (error) showNotification(`Failed to set next turn: ${error.message}`, 'error');
    else {
      const chosenTeam = teamsData.find(t => t.id === chosen);
      showNotification(`Next turn: ${chosenTeam ? chosenTeam.name : chosen}`, 'success');
    }
  }

  // deterministic round-robin advance helper (used by host after scoring)
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

  // Open host board helper: clear any active question then open in new tab
  async function openHostBoard(path: string) {
    try {
      await supabase.from('game_state').update({
        active_question_id: null,
        question_revealed: false,
        answer_revealed: false
      }).eq('id', 1);
    } catch (e) {
      console.error('Failed to clear game_state before launch', e);
    }
    window.open(path, '_blank');
  }

  // --- Questions: manual + bulk import ---
  async function handleAddCategory(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!newCatName.trim()) return;
    const { error } = await supabase.from('categories').insert([{ name: newCatName.trim() }]);
    if (error) showNotification(error.message, 'error'); else { showNotification('Category added', 'success'); setNewCatName(''); loadAdminData(); }
  }

  async function handleManualQuestionSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedCatId || !manualClue.trim() || !manualAnswer.trim()) { showNotification('Please fill category/clue/answer', 'error'); return; }
    const points = parseInt(manualPoints || '100', 10) || 100;
    const { error } = await supabase.from('questions').insert([{ category_id: selectedCatId, clue: manualClue.trim(), answer: manualAnswer.trim(), points }]);
    if (error) showNotification(error.message, 'error'); else { showNotification('Question added', 'success'); setManualClue(''); setManualAnswer(''); setManualPoints('100'); loadAdminData(); }
  }

  async function handleBulkImport() {
    if (!importText.trim()) { showNotification('Please enter text to import.', 'error'); return; }
    const lines = importText.split(/\r?\n/);
    let currentCatId: number | null = null;
    let successCount = 0;
    for (let rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      if (line.startsWith('#')) {
        const catName = line.replace('#', '').trim();
        if (!catName) continue;
        const { data: existingCat } = await supabase.from('categories').select('id').ilike('name', catName).maybeSingle();
        if (existingCat) currentCatId = existingCat.id;
        else {
          const { data: newCat, error: catError } = await supabase.from('categories').insert([{ name: catName }]).select('id').single();
          if (catError) console.error('Category insert error:', catError); else if (newCat) currentCatId = newCat.id;
        }
        continue;
      }
      if (currentCatId && line.includes('|')) {
        const parts = line.split('|').map(p => p.trim());
        if (parts.length >= 2) {
          const clue = parts[0], answer = parts[1], points = parts[2] ? parseInt(parts[2], 10) || 100 : 100;
          const { error } = await supabase.from('questions').insert({ category_id: currentCatId, clue, answer, points });
          if (!error) successCount++;
        }
      }
    }
    if (successCount > 0) { showNotification(`Imported ${successCount} questions`, 'success'); setImportText(''); loadAdminData(); }
    else showNotification('Import failed. Check format: "#Category" on its own line, then "clue | answer | points" lines', 'error');
  }

  // --- Reset game (full) ---
  async function handleResetGame() {
    if (!confirm('Reset the entire game and remove all teams?')) return;
    await supabase.from('teams').delete();
    await supabase.from('game_state').update({ game_started: false, buzzer_open: false, active_round: 1, current_turn_team_id: null, turn_history: [] }).eq('id', 1);
    await supabase.from('questions').update({ is_answered: false }).neq('id', 0);
    await supabase.from('buzzers').update({ active: false, winner_team_id: null }).eq('id', 1);
    setPendingTeam(null);
    await fetchTeams();
    showNotification('Game reset', 'success');
  }

  // --- App settings save ---
  async function saveAppSettings() {
    // upsert row id=1
    const row = { id: 1, randomize_categories: appSettings.randomize_categories ?? false, selected_category_ids: appSettings.selected_category_ids ?? [] };
    const { error } = await supabase.from('app_settings').upsert(row, { onConflict: 'id' });
    if (error) showNotification(error.message, 'error'); else showNotification('Settings saved', 'success');
  }

  // --- NEW: startFinal (safe) ---
  async function startFinal() {
    try {
      // choose a final question (prefer a category named "final")
      let finalQ: any = null;
      const { data: finalCats } = await supabase.from('categories').select('id').ilike('name', '%final%');
      if (finalCats && finalCats.length > 0) {
        const catIds = finalCats.map((c: any) => c.id);
        const { data: q } = await supabase.from('questions').select('*').in('category_id', catIds).limit(1);
        if (q && q.length > 0) finalQ = q[0];
      }
      if (!finalQ) {
        const { data: q } = await supabase.from('questions').select('*').eq('is_answered', false).limit(1);
        if (q && q.length > 0) finalQ = q[0];
      }
      if (!finalQ) {
        const { data: q } = await supabase.from('questions').select('*').limit(1);
        if (q && q.length > 0) finalQ = q[0];
      }

      const finalRound = new Date().toISOString();

      // create final_submissions for approved teams with non-null defaults
      const { data: approved } = await supabase.from('teams').select('id').eq('approved', true);
      if (approved && approved.length) {
        const payload = approved.map((t: any) => ({
          team_id: t.id,
          final_round: finalRound,
          wager: 0,
          answer: '',
          is_correct: null
        }));
        const subsUpsert = await supabase.from('final_submissions').upsert(payload, { onConflict: ['team_id', 'final_round'] as any });
        console.debug('startFinal final_submissions upsert ->', subsUpsert);
        if (subsUpsert.error) console.error('startFinal final_submissions upsert error', subsUpsert.error);
      }

      // set game_state final flags and mode (use upsert here to ensure row exists)
      const gsPayload: any = {
        id: 1,
        final_started: true,
        final_round: finalRound,
        final_countdown_expires_at: null,
        active_question_id: finalQ ? finalQ.id : null,
        question_revealed: false,
        answer_revealed: false,
        mode: 'final'
      };
      const gsUpsert = await supabase.from('game_state').upsert(gsPayload);
      console.debug('startFinal gsUpsert ->', gsUpsert);
      if (gsUpsert.error) console.error('startFinal gsUpsert error', gsUpsert.error);

      // small follow-up update to encourage realtime propagation
      await supabase.from('game_state').update({ final_countdown_expires_at: null }).eq('id', 1);

      await loadAdminData();
      showNotification('Final started', 'success');
    } catch (err) {
      console.error('startFinal error', err);
      showNotification('Failed to start final (see console)', 'error');
    }
  }

  // UI helpers
  function Notification() {
    if (!message) return null;
    return (
      <div className={`p-3 rounded-md mb-4 text-sm ${message.type === 'success' ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20' : 'bg-rose-500/10 text-rose-300 border border-rose-500/20'}`}>
        {message.text}
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-[#0d1117] text-slate-100 p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="flex items-center justify-between bg-[#161b22] border border-[#21262d] px-6 py-4 rounded-2xl">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-[#f0b429] rounded-xl flex items-center justify-center text-[#0d1117] font-black">M</div>
            <div>
              <h1 className="text-sm font-black tracking-widest uppercase">MENTIS ADMIN</h1>
              <div className="text-xs text-amber-400 font-bold uppercase">Control Panel</div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button onClick={() => openHostBoard('/cast')} className="bg-[#0d1117] border border-[#21262d] px-3 py-2 rounded-xl text-xs">Open Cast ↗</button>
            <button onClick={() => openHostBoard('/buzzer')} className="bg-[#f0b429]/10 px-3 py-2 rounded-xl text-amber-400 text-xs border border-amber-400/20">Open Buzzer ↗</button>
            <button onClick={handleResetGame} className="bg-rose-600/10 px-3 py-2 rounded-xl text-rose-400 text-xs border border-rose-500/20">Reset Game</button>
          </div>
        </header>

        <Notification />

        {/* Tabs */}
        <nav className="flex gap-2">
          <button onClick={() => setActiveTab('rounds')} className={`px-4 py-2 rounded-md text-xs ${activeTab === 'rounds' ? 'bg-amber-500 text-[#0d1117]' : 'bg-[#0d1117] text-slate-300'}`}>Rounds</button>
          <button onClick={() => setActiveTab('teams')} className={`px-4 py-2 rounded-md text-xs ${activeTab === 'teams' ? 'bg-amber-500 text-[#0d1117]' : 'bg-[#0d1117] text-slate-300'}`}>Teams</button>
          <button onClick={() => setActiveTab('questions')} className={`px-4 py-2 rounded-md text-xs ${activeTab === 'questions' ? 'bg-amber-500 text-[#0d1117]' : 'bg-[#0d1117] text-slate-300'}`}>Questions</button>
          <button onClick={() => setActiveTab('settings')} className={`px-4 py-2 rounded-md text-xs ${activeTab === 'settings' ? 'bg-amber-500 text-[#0d1117]' : 'bg-[#0d1117] text-slate-300'}`}>Settings</button>
          <button onClick={() => setActiveTab('cast')} className={`px-4 py-2 rounded-md text-xs ${activeTab === 'cast' ? 'bg-amber-500 text-[#0d1117]' : 'bg-[#0d1117] text-slate-300'}`}>Cast</button>
        </nav>

        {/* Content */}
        <section className="bg-[#161b22] border border-[#21262d] rounded-2xl p-6">
          {activeTab === 'rounds' && (
            <div className="space-y-6">
              <h2 className="text-sm font-black">Game & Rounds</h2>

              <div className="flex gap-4 items-center">
                <div className="flex items-center gap-2">
                  <button onClick={() => setMode('buzzer')} className={`px-3 py-2 rounded-md text-xs ${gameMode === 'buzzer' ? 'bg-amber-500 text-[#0d1117]' : 'bg-[#0d1117]'}`}>Buzzer Mode</button>
                  <button onClick={() => setMode('turn')} className={`px-3 py-2 rounded-md text-xs ${gameMode === 'turn' ? 'bg-amber-500 text-[#0d1117]' : 'bg-[#0d1117]'}`}>Turn Mode</button>
                  <button onClick={nextRandomTurn} className="px-3 py-2 rounded-md text-xs bg-sky-500 text-white">Next Turn</button>
                </div>

                <div className="ml-auto flex items-center gap-2">
                  <button
  onClick={async () => {
    // ensure DB is cleared of any active question / final flags before opening
    const res = await supabase.from('game_state').update({
      final_started: false,
      final_round: null,
      final_countdown_expires_at: null,
      active_question_id: null,
      question_revealed: false,
      answer_revealed: false
    }).eq('id', 1);
    console.debug('ADMIN_LAUNCH_MENTIS clear-state ->', res);
    openHostBoard('/');
  }}
  className="px-3 py-2 rounded-md bg-amber-500 text-[#0d1117] text-xs"
>
  Launch Mentis
</button>

<button
  onClick={async () => {
    const res = await supabase.from('game_state').update({
      final_started: false,
      final_round: null,
      final_countdown_expires_at: null,
      active_question_id: null,
      question_revealed: false,
      answer_revealed: false
    }).eq('id', 1);
    console.debug('ADMIN_LAUNCH_DOUBLE clear-state ->', res);
    openHostBoard('/?round=double_jeopardy');
  }}
  className="px-3 py-2 rounded-md bg-sky-500 text-white text-xs"
>
  Launch Double
</button>

<button
  onClick={async () => {
    // startFinal will write DB final flags and create final_submissions
    await startFinal();
    openHostBoard('/?round=final');
  }}
  className="px-3 py-2 rounded-md bg-purple-600 text-white text-xs"
>
  Launch Final
</button>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
  <div className="p-4 bg-[#0d1117] rounded-md border border-[#21262d]">
    <div className="text-xs text-slate-400">Buzzer state</div>
    <div className="mt-2 flex gap-2 items-center">
      <button onClick={toggleBuzzer} className={`px-3 py-2 rounded-md ${buzzerOpen ? 'bg-rose-600 text-white' : 'bg-emerald-500 text-[#0d1117]'}`}>
        {buzzerOpen ? 'Close' : 'Open'} Buzzers
      </button>
      <button onClick={resetBuzzer} className="px-3 py-2 rounded-md bg-[#0d1117] text-xs">Reset Queue</button>
    </div>
    
    {/* Added first-buzzed indicator here */}
    {/* Added first-buzzed indicator here */}
<div className="mt-3 text-xs font-bold">
  {buzzerWinnerName ? (
    <span className="text-amber-400 flex items-center gap-1 animate-pulse">
      🚨 First: {buzzerWinnerName}
    </span>
  ) : (
    <span className="text-slate-500">No buzzes yet</span>
  )}
</div>
  </div>

                <div className="p-4 bg-[#0d1117] rounded-md border border-[#21262d]">
                  <div className="text-xs text-slate-400">Current round</div>
                  <div className="mt-2">
                    <select value={String(activeRound)} onChange={(e) => setActiveRound(e.target.value)} className="bg-[#0d1117] border rounded-md px-3 py-2 text-sm">
                      <option value="1">Round 1</option>
                      <option value="2">Round 2</option>
                      <option value="final">Final</option>
                    </select>
                  </div>
                </div>

                <div className="p-4 bg-[#0d1117] rounded-md border border-[#21262d]">
                  <div className="text-xs text-slate-400">Game actions</div>
                  <div className="mt-2 flex gap-2">
                    <button onClick={handleResetGame} className="px-3 py-2 rounded-md bg-rose-600 text-white text-xs">Reset Game</button>
                    <button onClick={() => fetchTeams()} className="px-3 py-2 rounded-md bg-[#0d1117] text-xs">Refresh Teams</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'teams' && (
            <div className="space-y-6">
              <h2 className="text-sm font-black">Teams</h2>

              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <div className="space-y-3">
                    {teams.map(team => (
                      <div key={team.id} className="p-3 bg-[#0d1117] rounded-md border border-[#21262d] flex items-center justify-between">
                        <div>
                          <div className="font-bold">{team.name}</div>
                          <div className="text-xs text-slate-400">Score: {team.score}</div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={() => handleDeleteTeam(team.id)} className="text-xs bg-[#0d1117] px-3 py-2 rounded-md">Delete</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <form onSubmit={handleAddTeam} className="space-y-3">
                    <div>
                      <label className="text-xs text-slate-400">Add Team</label>
                      <input value={newTeamName} onChange={(e) => setNewTeamName(e.target.value)} className="w-full bg-[#0d1117] border rounded-md px-3 py-2 mt-1" placeholder="Team name" />
                    </div>
                    <button type="submit" className="px-3 py-2 bg-amber-500 rounded-md text-[#0d1117] font-bold">Add Team</button>
                  </form>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'questions' && (
            <div className="space-y-6">
              <h2 className="text-sm font-black">Questions</h2>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-[#0d1117] rounded-md border border-[#21262d]">
                  <h3 className="text-xs font-bold">Add Question</h3>
                  <form onSubmit={handleManualQuestionSubmit} className="space-y-3 mt-3">
                    <div>
                      <label className="text-xs text-slate-400">Category</label>
                      <select value={selectedCatId} onChange={(e) => setSelectedCatId(Number(e.target.value) || '')} className="w-full bg-[#0d1117] border rounded-md px-3 py-2 mt-1">
                        <option value="">Select category</option>
                        {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                      <div className="mt-2 text-xs text-slate-400">Or add a category below</div>
                    </div>

                    <div>
                      <label className="text-xs text-slate-400">Clue</label>
                      <input value={manualClue} onChange={(e) => setManualClue(e.target.value)} className="w-full bg-[#0d1117] border rounded-md px-3 py-2 mt-1" />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400">Answer</label>
                      <input value={manualAnswer} onChange={(e) => setManualAnswer(e.target.value)} className="w-full bg-[#0d1117] border rounded-md px-3 py-2 mt-1" />
                    </div>
                    <div>
                      <label className="text-xs text-slate-400">Points</label>
                      <input value={manualPoints} onChange={(e) => setManualPoints(e.target.value)} className="w-full bg-[#0d1117] border rounded-md px-3 py-2 mt-1" />
                    </div>
                    <div className="flex gap-2">
                      <button type="submit" className="px-3 py-2 bg-amber-500 rounded-md text-xs text-[#0d1117]">Add Question</button>
                    </div>
                  </form>
                </div>

                <div className="p-4 bg-[#0d1117] rounded-md border border-[#21262d]">
                  <h3 className="text-xs font-bold">Bulk Import</h3>
                  <p className="text-xs text-slate-400 mt-2">Format: Use lines starting with #Category to create categories, then lines "clue | answer | points"</p>
                  <textarea value={importText} onChange={(e) => setImportText(e.target.value)} className="w-full h-44 mt-3 bg-[#0d1117] border rounded-md p-3" />
                  <div className="mt-3 flex gap-2">
                    <button onClick={handleBulkImport} className="px-3 py-2 bg-sky-500 rounded-md text-xs text-white">Import</button>
                  </div>
                </div>
              </div>

              <div className="mt-4">
                <h4 className="text-xs font-bold">Add Category</h4>
                <div className="mt-2 flex gap-2">
                  <input value={newCatName} onChange={(e) => setNewCatName(e.target.value)} className="bg-[#0d1117] border rounded-md px-3 py-2 w-1/3" placeholder="Category name" />
                  <button onClick={handleAddCategory} className="px-3 py-2 bg-amber-500 rounded-md text-xs text-[#0d1117]">Add</button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="space-y-6">
              <h2 className="text-sm font-black">Settings</h2>
              <div className="p-4 bg-[#0d1117] rounded-md border border-[#21262d]">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={!!appSettings.randomize_categories} onChange={(e) => setAppSettings({ ...appSettings, randomize_categories: e.target.checked })} />
                  <span className="text-xs">Randomize categories each game</span>
                </label>
                <div className="mt-3">
                  <button onClick={saveAppSettings} className="px-3 py-2 bg-amber-500 rounded-md text-xs text-[#0d1117]">Save Settings</button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'cast' && (
            <div className="space-y-6">
              <h2 className="text-sm font-black">Cast / Screens</h2>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 bg-[#0d1117] rounded-md border border-[#21262d]">
                  <div className="text-xs">Open Cast Screen (host display)</div>
                  <div className="mt-2 flex gap-2">
                    <a href="/cast" target="_blank" rel="noreferrer" className="px-3 py-2 bg-[#0d1117] rounded-md text-xs">Open Cast</a>
                    <a href="/buzzer" target="_blank" rel="noreferrer" className="px-3 py-2 bg-[#0d1117] rounded-md text-xs">Open Buzzer</a>
                  </div>
                </div>

                <div className="p-4 bg-[#0d1117] rounded-md border border-[#21262d]">
                  <div className="text-xs">Shareable Links</div>
                  <div className="mt-2 text-xs">
                    Cast URL: <code className="bg-[#0d1117] px-2 py-1 rounded">{originUrl}/cast</code>
                    <div className="mt-2">Buzzer URL: <code className="bg-[#0d1117] px-2 py-1 rounded">{originUrl}/buzzer</code></div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </section>

        {/* pending team popup */}
        {pendingTeam && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
            <div className="bg-[#161b22] border border-[#21262d] rounded-2xl p-6 max-w-md w-full space-y-4 text-center">
              <div className="w-12 h-12 mx-auto bg-[#f0b429]/10 rounded-xl flex items-center justify-center text-amber-300">
                <AlertCircle />
              </div>
              <h3 className="text-base font-black">New Team Join Request</h3>
              <p className="text-xs text-slate-400">Team <strong className="text-amber-400">{pendingTeam.name}</strong> has requested to join.</p>
              <div className="flex gap-3">
                <button onClick={handleRejectTeam} className="flex-1 bg-rose-500/10 rounded-md py-2 text-rose-400 border border-rose-500/20">Reject</button>
                <button onClick={handleAcceptTeam} className="flex-1 bg-amber-500 rounded-md py-2 text-[#0d1117] font-bold">Accept</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}