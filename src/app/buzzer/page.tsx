'use client';
import { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { Zap, Lock, Unlock, AlertCircle, CheckCircle2 } from 'lucide-react';

export default function BuzzerPage() {
  const [teamName, setTeamName] = useState('');
  const [teamId, setTeamId] = useState<number | null>(null);
  const [waitingApproval, setWaitingApproval] = useState(false);
  const [isApproved, setIsApproved] = useState(false);
  
  const [buzzerActive, setBuzzerActive] = useState(false);
  const [buzzerWinner, setBuzzerWinner] = useState<string | null>(null);
  const [hasBuzzed, setHasBuzzed] = useState(false);

  // Audio refs
  const openSound = useRef<HTMLAudioElement | null>(null);
  const buzzSound = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    openSound.current = new Audio('https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3');
    buzzSound.current = new Audio('https://assets.mixkit.co/active_storage/sfx/1002/1002-preview.mp3');
  }, []);

  const playLimitedSound = (audioRef: React.MutableRefObject<HTMLAudioElement | null>) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = 0;
    audio.play().catch(() => {});
    setTimeout(() => {
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
      }
    }, 3000);
  };

  // Handle team registration
  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!teamName.trim()) return;

    const name = teamName.trim();
    const { data, error } = await supabase
      .from('teams')
      .insert([{ name, score: 0, approved: false }])
      .select()
      .single();

    if (error) {
      alert(error.message);
    } else if (data) {
      setTeamId(data.id);
      setWaitingApproval(true);
    }
  }

  // Listen to buzzer changes (`buzzers` table id = 1)
  useEffect(() => {
    async function fetchInitialBuzzer() {
      const { data } = await supabase.from('buzzers').select('*').eq('id', 1).maybeSingle();
      if (data) {
        setBuzzerActive(data.active);
        if (data.winner_team_id) {
          const { data: teamData } = await supabase.from('teams').select('name').eq('id', data.winner_team_id).single();
          if (teamData) setBuzzerWinner(teamData.name);
        } else {
          setBuzzerWinner(null);
        }
      }
    }

    fetchInitialBuzzer();

    const buzzerChannel = supabase
      .channel('student_buzzer_sync_v3')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'buzzers' },
        async (payload: any) => {
          const newData = payload.new;
          if (newData) {
            const wasActive = buzzerActive;
            setBuzzerActive(newData.active);

            // Play open sound if it just turned active
            if (newData.active && !wasActive) {
              playLimitedSound(openSound);
            }

            if (newData.winner_team_id) {
              const { data: teamData } = await supabase.from('teams').select('name').eq('id', newData.winner_team_id).single();
              setBuzzerWinner(teamData ? teamData.name : 'Another Team');
            } else {
              setBuzzerWinner(null);
              setHasBuzzed(false);
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(buzzerChannel);
    };
  }, [buzzerActive]);

  // Team-specific approval listener
  useEffect(() => {
    if (!teamId) return;

    const approvalChannel = supabase
      .channel(`team_approval_${teamId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'teams', filter: `id=eq.${teamId}` },
        (payload: any) => {
          if (payload.new && payload.new.approved) {
            setIsApproved(true);
            setWaitingApproval(false);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(approvalChannel);
    };
  }, [teamId]);

  // Handle buzzer press
  async function handleBuzz() {
    if (!teamId || !buzzerActive || hasBuzzed || buzzerWinner) return;

    playLimitedSound(buzzSound);
    setHasBuzzed(true);

    await supabase
      .from('buzzers')
      .update({ active: false, winner_team_id: teamId })
      .eq('id', 1);
  }

  return (
    <main className="min-h-screen w-full bg-[#0d1117] text-slate-100 flex flex-col items-center justify-center p-4 sm:p-6 select-none">
      <div className="max-w-md w-full bg-[#161b22] border border-[#21262d] p-6 sm:p-8 rounded-3xl shadow-2xl text-center space-y-6 my-auto">
        
        {/* Header */}
        <div className="flex items-center justify-center gap-3">
          <div className="w-10 h-10 bg-[#f0b429] text-[#0d1117] rounded-xl flex items-center justify-center font-black text-lg shadow-md">
            M
          </div>
          <div className="text-left">
            <h1 className="text-sm font-black tracking-widest text-white uppercase">MENTIS BUZZER</h1>
            <p className="text-[10px] text-[#f0b429] font-bold uppercase tracking-wider">Interactive Team Client</p>
          </div>
        </div>

        {/* STEP 1: Registration Form */}
        {!teamId && (
          <form onSubmit={handleRegister} className="space-y-4">
            <div className="space-y-1.5 text-left">
              <label className="text-[10px] text-slate-400 font-bold uppercase tracking-widest block">Team Name</label>
              <input
                type="text"
                placeholder="Enter Team Name..."
                value={teamName}
                onChange={(e) => setTeamName(e.target.value)}
                className="w-full bg-[#0d1117] border border-[#21262d] px-4 py-3.5 rounded-xl text-sm text-slate-200 outline-none placeholder-slate-500 focus:border-[#f0b429]"
                required
              />
            </div>
            <button
              type="submit"
              className="w-full bg-[#f0b429] hover:bg-[#d99f22] text-[#0d1117] font-black py-3.5 rounded-xl text-xs uppercase tracking-wider transition cursor-pointer shadow-lg active:scale-95"
            >
              Register Team
            </button>
          </form>
        )}

        {/* STEP 2: Waiting for Approval */}
        {teamId && waitingApproval && !isApproved && (
          <div className="py-8 space-y-3">
            <div className="w-12 h-12 bg-amber-500/10 border border-amber-500/30 text-amber-400 rounded-2xl mx-auto flex items-center justify-center animate-pulse">
              <AlertCircle className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-black uppercase tracking-wider text-white">Waiting for Admin Approval</h3>
            <p className="text-xs text-slate-400">The host will accept your team <span className="text-[#f0b429] font-bold uppercase">"{teamName}"</span> shortly.</p>
          </div>
        )}

        {/* STEP 3: Active Game Buzzer Interface */}
        {teamId && isApproved && (
          <div className="space-y-6">
            <div className="bg-[#0d1117] border border-[#21262d] p-3.5 rounded-2xl flex items-center justify-between">
              <span className="text-xs text-slate-400 font-bold uppercase">Team: <span className="text-[#f0b429]">{teamName}</span></span>
              <span className="flex items-center gap-1.5 text-xs text-emerald-400 font-bold">
                <CheckCircle2 className="w-4 h-4" /> Connected
              </span>
            </div>

            {/* Status Indicator */}
            <div className="py-1">
              {buzzerWinner ? (
                <div className="bg-amber-500/10 border border-amber-500/30 p-3 rounded-xl text-amber-400 text-xs font-bold uppercase tracking-wider">
                  ⚡ {buzzerWinner} Buzzed In First!
                </div>
              ) : buzzerActive ? (
                <div className="bg-emerald-500/10 border border-emerald-500/30 p-3 rounded-xl flex items-center justify-center gap-2 text-emerald-400 text-xs font-bold uppercase tracking-wider animate-pulse">
                  <Unlock className="w-4 h-4" /> Buzzer is Open! Press to Buzz!
                </div>
              ) : (
                <div className="bg-rose-500/10 border border-rose-500/30 p-3 rounded-xl flex items-center justify-center gap-2 text-rose-400 text-xs font-bold uppercase tracking-wider">
                  <Lock className="w-4 h-4" /> Buzzer is Locked
                </div>
              )}
            </div>

            {/* Big Buzzer Button */}
            <div className="pt-2 flex justify-center">
              <button
                onClick={handleBuzz}
                disabled={!buzzerActive || hasBuzzed || !!buzzerWinner}
                className={`w-44 h-44 sm:w-48 sm:h-48 rounded-full font-black text-sm sm:text-base uppercase tracking-widest shadow-2xl transition flex flex-col items-center justify-center gap-2 cursor-pointer border-4 active:scale-95 ${
                  !buzzerActive 
                    ? 'bg-slate-800 text-slate-500 border-slate-700 cursor-not-allowed'
                    : buzzerWinner && buzzerWinner !== teamName
                    ? 'bg-rose-500/20 text-rose-400 border-rose-500/40 cursor-not-allowed'
                    : hasBuzzed || buzzerWinner === teamName
                    ? 'bg-emerald-500 text-slate-950 border-emerald-400'
                    : 'bg-rose-600 hover:bg-rose-500 text-white border-rose-400 shadow-rose-600/50'
                }`}
              >
                <Zap className="w-7 h-7 sm:w-8 sm:h-8" />
                {buzzerWinner === teamName 
                  ? 'YOU BUZZED!' 
                  : buzzerWinner 
                  ? `${buzzerWinner} BUZZED` 
                  : buzzerActive 
                  ? 'BUZZ!' 
                  : 'LOCKED'}
              </button>
            </div>

            <p className="text-xs text-slate-400 font-medium">
              {buzzerActive 
                ? 'Hit the buzzer as fast as you can!' 
                : 'Waiting for host to open the buzzer...'}
            </p>
          </div>
        )}

      </div>
    </main>
  );
}