import { useState, useRef, useCallback } from 'react';
import type { WSMessage } from '@shared/protocol';

interface InputTabProps {
  sendMessage: (msg: WSMessage) => boolean;
  onBack: () => void;
}

export default function InputTab({ sendMessage, onBack }: InputTabProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{
        background: '#080d1a',
        paddingTop: 'env(safe-area-inset-top, 0px)',
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        paddingLeft: 'env(safe-area-inset-left, 0px)',
        paddingRight: 'env(safe-area-inset-right, 0px)',
      }}
    >
      <header className="flex items-center justify-between px-4 py-2 border-b border-white/5 shrink-0"
        style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
      >
        <button onClick={onBack} className="flex items-center gap-1 text-white/50 hover:text-white transition-colors text-xs">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg>
          Back
        </button>
        <span className="text-xs font-semibold text-white/60">Input</span>
        <div className="w-12" />
      </header>

      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        <Trackpad sendMessage={sendMessage} />
        <Keyboard sendMessage={sendMessage} />
      </div>
    </div>
  );
}

/* ── Trackpad ─────────────────────────────────────────────────────────── */

function Trackpad({ sendMessage }: { sendMessage: (msg: WSMessage) => boolean }) {
  const padRef = useRef<HTMLDivElement>(null);
  const lastPos = useRef<{ x: number; y: number } | null>(null);
  const touching = useRef(false);
  const fingerCount = useRef(0);
  const [tapping, setTapping] = useState(false);

  const sendMouse = useCallback((action: string, params: Record<string, any>) => {
    console.log('[XDECK] Send mouse:', action, params);
    sendMessage({ type: 'mouse_event', action, ...params } as any);
  }, [sendMessage]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    const touch = e.touches[0];
    lastPos.current = { x: touch.clientX, y: touch.clientY };
    touching.current = true;
    fingerCount.current = e.touches.length;
    setTapping(true);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    if (!touching.current || !lastPos.current) return;

    const touch = e.touches[0];
    const dx = touch.clientX - lastPos.current.x;
    const dy = touch.clientY - lastPos.current.y;
    lastPos.current = { x: touch.clientX, y: touch.clientY };

    if (e.touches.length >= 2) {
      sendMouse('scroll', { scrollY: -Math.round(dy / 3) });
    } else {
      sendMouse('move', { dx: Math.round(dx * 2), dy: Math.round(dy * 2) });
    }
  }, [sendMouse]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    if (e.touches.length === 0) {
      touching.current = false;
      lastPos.current = null;
      setTapping(false);
      sendMouse('click', { button: 1, down: false });
    } else {
      lastPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      fingerCount.current = e.touches.length;
    }
  }, [sendMouse]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    sendMouse('click', { button: 3, down: true });
    setTimeout(() => sendMouse('click', { button: 3, down: false }), 50);
  }, [sendMouse]);

  return (
    <div
      ref={padRef}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onContextMenu={handleContextMenu}
      className="relative flex-shrink-0 select-none touch-none overflow-hidden"
      style={{ height: '35%', minHeight: 100, background: 'rgba(255,255,255,0.02)' }}
    >
      <div className="absolute inset-0 pointer-events-none" style={{
        backgroundImage: 'linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)',
        backgroundSize: '20px 20px',
      }} />

      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className={`w-10 h-10 rounded-full border transition-all duration-100 ${
          tapping ? 'border-indigo-400/80 bg-indigo-500/15 scale-75' : 'border-white/10'
        }`} />
        <div className={`absolute w-1 h-1 rounded-full transition-all duration-100 ${
          tapping ? 'bg-indigo-400' : 'bg-white/20'
        }`} />
      </div>

      <div className="absolute bottom-1.5 left-0 right-0 text-center pointer-events-none px-4">
        <span className="text-[8px] text-white/15 font-mono">
          Drag = move &middot; Tap = click &middot; 2-finger = scroll &middot; Long press = right-click
        </span>
      </div>
    </div>
  );
}

/* ── Keyboard ─────────────────────────────────────────────────────────── */

const KEY_ROWS = [
  ['1','2','3','4','5','6','7','8','9','0'],
  ['q','w','e','r','t','y','u','i','o','p'],
  ['a','s','d','f','g','h','j','k','l'],
  ['z','x','c','v','b','n','m'],
];

const MODIFIERS = ['ctrl', 'alt', 'shift', 'cmd'];

const SPECIAL: Record<string, string> = {
  '⇥': 'Tab', '⌫': 'BackSpace', '⏎': 'Return',
  ' ': 'space', '⎋': 'Escape',
  '◀': 'Left', '▶': 'Right', '▲': 'Up', '▼': 'Down',
};

function Keyboard({ sendMessage }: { sendMessage: (msg: WSMessage) => boolean }) {
  const [activeMods, setActiveMods] = useState<Set<string>>(new Set());
  const [textMode, setTextMode] = useState(false);
  const [textInput, setTextInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const sendKey = useCallback((key: string) => {
    if (activeMods.size > 0) {
      const combo = [...activeMods, key].join('+');
      console.log('[XDECK] Send key:', combo);
      sendMessage({ type: 'keyboard_event', action: 'key', value: combo });
    } else {
      console.log('[XDECK] Send key:', key);
      sendMessage({ type: 'keyboard_event', action: 'key', value: key });
    }
  }, [activeMods, sendMessage]);

  const sendText = useCallback((text: string) => {
    console.log('[XDECK] Send text:', text);
    sendMessage({ type: 'keyboard_event', action: 'text', value: text });
  }, [sendMessage]);

  const toggleMod = useCallback((mod: string) => {
    setActiveMods(prev => {
      const next = new Set(prev);
      if (next.has(mod)) next.delete(mod);
      else next.add(mod);
      return next;
    });
  }, []);

  const handleKeyPress = useCallback((key: string) => {
    const mapped = SPECIAL[key] || key;
    if (mapped === 'shift') {
      toggleMod('shift');
      return;
    }
    sendKey(mapped);
  }, [sendKey, toggleMod]);

  const handleTextSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (textInput.trim()) {
      sendText(textInput);
      setTextInput('');
    }
  }, [textInput, sendText]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0" style={{ background: 'rgba(255,255,255,0.01)' }}>
      {/* Mode toggles */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-t border-white/5 shrink-0">
        <button
          onClick={() => setTextMode(!textMode)}
          className={`text-[10px] px-2 py-1 rounded-lg transition-all ${
            textMode ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-500/30' : 'bg-white/5 text-white/40 border border-white/10'
          }`}
        >
          {textMode ? 'Keys' : 'Type Text'}
        </button>
      </div>

      {textMode ? (
        <form onSubmit={handleTextSubmit} className="flex items-center gap-2 px-3 py-2 shrink-0">
          <input
            ref={inputRef}
            type="text"
            value={textInput}
            onChange={e => setTextInput(e.target.value)}
            placeholder="Type text to send..."
            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-white/20 outline-none focus:border-indigo-500/50"
          />
          <button type="submit" className="bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-3 py-2.5 rounded-xl text-xs font-semibold shrink-0">
            Send
          </button>
        </form>
      ) : (
        <div className="flex-1 overflow-y-auto min-h-0" style={{ WebkitOverflowScrolling: 'touch' }}>
          <div className="max-w-lg mx-auto px-2 py-1">
            {/* Modifier keys */}
            <div className="flex gap-1 mb-1">
              {MODIFIERS.map(mod => (
                <button
                  key={mod}
                  onTouchStart={(e) => { e.preventDefault(); toggleMod(mod); }}
                  className={`flex-1 py-1.5 rounded-lg text-[10px] font-semibold uppercase transition-all select-none ${
                    activeMods.has(mod)
                      ? 'bg-indigo-500/30 text-indigo-200 border border-indigo-400/40'
                      : 'bg-white/5 text-white/40 border border-white/8'
                  }`}
                >
                  {mod}
                </button>
              ))}
            </div>

            {/* Key rows */}
            {KEY_ROWS.map((row, ri) => (
              <div key={ri} className="flex gap-0.5 mb-0.5">
                {row.map(key => (
                  <button
                    key={key}
                    onTouchStart={(e) => { e.preventDefault(); handleKeyPress(key); }}
                    className="flex-1 py-2.5 rounded-md text-[14px] font-medium bg-white/5 text-white/70 border border-white/8 active:bg-indigo-500/20 active:text-indigo-200 active:border-indigo-500/30 transition-all select-none"
                  >
                    {key}
                  </button>
                ))}
              </div>
            ))}

            {/* Bottom row: special keys */}
            <div className="flex gap-0.5 mb-0.5">
              <button
                onTouchStart={(e) => { e.preventDefault(); handleKeyPress('⇥'); }}
                className="px-3 py-2.5 rounded-md text-[10px] font-medium bg-white/5 text-white/40 border border-white/8 active:bg-indigo-500/20 select-none"
              >
                Tab
              </button>
              <button
                onTouchStart={(e) => { e.preventDefault(); handleKeyPress('⌫'); }}
                className="flex-1 py-2.5 rounded-md text-[14px] font-medium bg-white/5 text-white/70 border border-white/8 active:bg-red-500/20 active:text-red-300 select-none"
              >
                ⌫
              </button>
              <button
                onTouchStart={(e) => { e.preventDefault(); handleKeyPress(' '); }}
                className="flex-[2] py-2.5 rounded-md text-[11px] font-medium bg-white/5 text-white/50 border border-white/8 active:bg-indigo-500/20 select-none"
              >
                Space
              </button>
              <button
                onTouchStart={(e) => { e.preventDefault(); handleKeyPress('⏎'); }}
                className="flex-1 py-2.5 rounded-md text-[13px] font-semibold bg-indigo-500/15 text-indigo-300 border border-indigo-500/20 active:bg-indigo-500/30 select-none"
              >
                Enter
              </button>
            </div>

            {/* Arrow keys + Esc row */}
            <div className="flex gap-0.5 mb-1">
              <button
                onTouchStart={(e) => { e.preventDefault(); handleKeyPress('⎋'); }}
                className="px-3 py-2 rounded-md text-[10px] font-medium bg-white/5 text-white/40 border border-white/8 active:bg-red-500/20 active:text-red-300 select-none"
              >
                Esc
              </button>
              <button
                onTouchStart={(e) => { e.preventDefault(); handleKeyPress('▲'); }}
                className="flex-1 py-1.5 rounded-md text-[10px] bg-white/5 text-white/40 border border-white/8 active:bg-indigo-500/20 select-none"
              >
                ▲
              </button>
              <button
                onTouchStart={(e) => { e.preventDefault(); handleKeyPress('▼'); }}
                className="flex-1 py-1.5 rounded-md text-[10px] bg-white/5 text-white/40 border border-white/8 active:bg-indigo-500/20 select-none"
              >
                ▼
              </button>
              <button
                onTouchStart={(e) => { e.preventDefault(); handleKeyPress('◀'); }}
                className="flex-1 py-1.5 rounded-md text-[10px] bg-white/5 text-white/40 border border-white/8 active:bg-indigo-500/20 select-none"
              >
                ◀
              </button>
              <button
                onTouchStart={(e) => { e.preventDefault(); handleKeyPress('▶'); }}
                className="flex-1 py-1.5 rounded-md text-[10px] bg-white/5 text-white/40 border border-white/8 active:bg-indigo-500/20 select-none"
              >
                ▶
              </button>
              <button
                onTouchStart={(e) => { e.preventDefault(); handleKeyPress('Delete'); }}
                className="px-3 py-2 rounded-md text-[10px] bg-white/5 text-white/30 border border-white/8 active:bg-red-500/20 active:text-red-300 select-none"
              >
                Del
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
