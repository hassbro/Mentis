'use client';
import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';

export default function CastPage() {
  const [gameStarted, setGameStarted] = useState(false);
  const [activeRound, setActiveRound] = useState(1);
  const [viewMode, setViewMode] = useState<'qr' | 'board'>('qr');
  const [buzzerUrl, setBuzzerUrl] = useState('http://192.168.4.146:3000/buzzer');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setBuzzerUrl(`${window.location.protocol}//${window.location.host}/buzzer`);
    }
    loadCastState();

    const channel = supabase
      .channel('cast_sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_state' }, (payload: any) => {
        if (payload.new) {
          setGameStarted(payload.new.game_started ?? false);
          setActiveRound(payload.new.active_round ?? 1);
          if (payload.new.game_started) {
            setViewMode('board');
          }
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function loadCastState() {
    const { data } = await supabase.from('game_state').select('*').maybeSingle();
    if (data) {
      setGameStarted(data.game_started ?? false);
      setActiveRound(data.active_round ?? 1);
      if (data.game_started) {
        setViewMode('board');
      }
    }
  }

  const qrCodeApiUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x220&data=${encodeURIComponent(buzzerUrl)}`;

  return (
    <main className="min-h-screen w-full bg-[#0d1117] text-slate-100 flex flex-col items-center justify-between p-4 sm:p-6 md:p-10 select-none overflow-x-hidden">
      
      {/* Top Header / Floating Toggle Bar */}
      <header className="w-full flex items-center justify-between max-w-7xl mx-auto pt-2">
        <div className="flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-mono uppercase tracking-widest text-slate-400">Cast Mode Active</span>
        </div>

        <div className="flex items-center gap-2 bg-[#161b22] border border-[#21262d] p-1.5 rounded-2xl shadow-xl">
          <button
            onClick={() => setViewMode('qr')}
            className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
              viewMode === 'qr' ? 'bg-[#f0b429] text-[#0d1117]' : 'text-slate-300 hover:bg-[#21262d]'
            }`}
          >
            QR Join
          </button>
          <button
            onClick={() => setViewMode('board')}
            className={`px-3 sm:px-4 py-1.5 sm:py-2 rounded-xl text-xs font-bold transition cursor-pointer ${
              viewMode === 'board' ? 'bg-[#f0b429] text-[#0d1117]' : 'text-slate-300 hover:bg-[#21262d]'
            }`}
          >
            Game Board
          </button>
        </div>
      </header>

      {/* Center Content Body */}
      <div className="flex-1 flex flex-col items-center justify-center w-full max-w-4xl my-auto py-6">
        {viewMode === 'qr' ? (
          <div className="flex flex-col items-center text-center space-y-6 sm:space-y-8 w-full">
            <div className="space-y-3 max-w-xl px-4">
              <div className="inline-block bg-[#f0b429]/10 border border-[#f0b429]/30 text-[#f0b429] text-[10px] sm:text-xs font-black uppercase tracking-widest px-4 py-1.5 rounded-full">
                Live Participant Join
              </div>
              <h1 className="text-3xl sm:text-5xl md:text-6xl font-black uppercase tracking-wider text-white leading-tight">
                Scan to Join Buzzer
              </h1>
              <p className="text-xs sm:text-sm text-slate-400">
                Point your smartphone camera at the code below to open your team's buzzer controller instantly.
              </p>
            </div>

            {/* Responsive QR Box */}
            <div className="bg-white p-4 sm:p-5 rounded-3xl flex flex-col items-center justify-center shadow-2xl transform transition hover:scale-105 duration-300">
              <img 
                src={qrCodeApiUrl} 
                alt="Buzzer QR Code" 
                className="w-48 h-48 sm:w-56 sm:h-56 md:w-64 md:h-64 object-contain" 
              />
            </div>

            <div className="w-full max-w-md px-4">
              <div className="text-[11px] sm:text-xs font-mono text-slate-400 uppercase tracking-wider bg-[#161b22] border border-[#21262d] px-4 sm:px-6 py-3 rounded-2xl truncate shadow-inner">
                Direct Link: <span className="text-[#f0b429]">{buzzerUrl}</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="w-full flex flex-col items-center justify-center space-y-4 text-center px-4 animate-fade-in">
            <h2 className="text-2xl sm:text-4xl md:text-5xl font-black uppercase tracking-widest text-[#f0b429]">
              Active Game Board (Round {activeRound})
            </h2>
            <p className="text-xs sm:text-sm text-slate-400">
              The game board view is now live and synchronized with the admin control panel.
            </p>
          </div>
        )}
      </div>

      {/* Footer Branding */}
      <footer className="w-full text-center text-[10px] sm:text-xs text-slate-500 font-mono pb-2">
        Real-Time Trivia Buzzer System &bull; Powered by Next.js & Supabase
      </footer>

    </main>
  );
}