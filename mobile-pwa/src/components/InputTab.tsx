import { useState, useRef, useCallback } from 'react';
import type { WSMessage } from '@shared/protocol';

interface InputTabProps {
  sendMessage: (msg: WSMessage) => boolean;
  onBack: () => void;
}

type ViewMode = 'split' | 'keyboard' | 'trackpad';

interface KeyboardTheme {
  id: string;
  name: string;
  bgColor: string;
  padBg: string;
  keyBg: string;
  keyBorder: string;
  keyText: string;
  modActiveBg: string;
  modActiveText: string;
  accentBg: string;
  accentText: string;
  accentBorder: string;
}

const PRESET_THEMES: KeyboardTheme[] = [
  {
    id: 'midnight',
    name: 'Midnight Blue',
    bgColor: '#080d1a',
    padBg: 'rgba(255, 255, 255, 0.02)',
    keyBg: 'rgba(255, 255, 255, 0.06)',
    keyBorder: 'rgba(255, 255, 255, 0.1)',
    keyText: '#f1f5f9',
    modActiveBg: 'rgba(99, 102, 241, 0.35)',
    modActiveText: '#c7d2fe',
    accentBg: 'rgba(99, 102, 241, 0.25)',
    accentText: '#a5b4fc',
    accentBorder: 'rgba(99, 102, 241, 0.4)',
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk Neon',
    bgColor: '#12072b',
    padBg: 'rgba(236, 72, 153, 0.04)',
    keyBg: 'rgba(36, 20, 71, 0.8)',
    keyBorder: 'rgba(236, 72, 153, 0.25)',
    keyText: '#fdf2f8',
    modActiveBg: 'rgba(236, 72, 153, 0.45)',
    modActiveText: '#fbcfe8',
    accentBg: 'rgba(236, 72, 153, 0.3)',
    accentText: '#f472b6',
    accentBorder: 'rgba(236, 72, 153, 0.5)',
  },
  {
    id: 'oled',
    name: 'OLED Black',
    bgColor: '#000000',
    padBg: '#09090b',
    keyBg: '#18181b',
    keyBorder: '#27272a',
    keyText: '#fafafa',
    modActiveBg: '#10b981',
    modActiveText: '#ffffff',
    accentBg: 'rgba(16, 185, 129, 0.2)',
    accentText: '#34d399',
    accentBorder: 'rgba(16, 185, 129, 0.4)',
  },
  {
    id: 'royal',
    name: 'Royal Violet',
    bgColor: '#0d061c',
    padBg: 'rgba(168, 85, 247, 0.03)',
    keyBg: 'rgba(38, 21, 74, 0.7)',
    keyBorder: 'rgba(168, 85, 247, 0.2)',
    keyText: '#f5f3ff',
    modActiveBg: 'rgba(168, 85, 247, 0.4)',
    modActiveText: '#e9d5ff',
    accentBg: 'rgba(168, 85, 247, 0.25)',
    accentText: '#c084fc',
    accentBorder: 'rgba(168, 85, 247, 0.45)',
  },
  {
    id: 'matrix',
    name: 'Emerald Matrix',
    bgColor: '#02150d',
    padBg: 'rgba(34, 197, 94, 0.03)',
    keyBg: 'rgba(10, 41, 24, 0.75)',
    keyBorder: 'rgba(34, 197, 94, 0.25)',
    keyText: '#bbf7d0',
    modActiveBg: 'rgba(34, 197, 94, 0.4)',
    modActiveText: '#dcfce7',
    accentBg: 'rgba(34, 197, 94, 0.25)',
    accentText: '#4ade80',
    accentBorder: 'rgba(34, 197, 94, 0.45)',
  },
];

const THEME_STORAGE_KEY = 'xdeck_input_theme_v2';

export default function InputTab({ sendMessage, onBack }: InputTabProps) {
  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const [showSettings, setShowSettings] = useState(false);
  const [theme, setTheme] = useState<KeyboardTheme>(() => {
    try {
      const saved = localStorage.getItem(THEME_STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch {}
    return PRESET_THEMES[0];
  });

  const saveTheme = useCallback((newTheme: KeyboardTheme) => {
    setTheme(newTheme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(newTheme));
    } catch {}
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col overflow-hidden select-none"
      style={{
        backgroundColor: theme.bgColor,
        paddingTop: 'max(env(safe-area-inset-top, 0px), 8px)',
        paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 6px)',
        paddingLeft: 'max(env(safe-area-inset-left, 0px), 8px)',
        paddingRight: 'max(env(safe-area-inset-right, 0px), 8px)',
      }}
    >
      {/* Top Navigation Bar */}
      <header className="flex items-center justify-between px-3 py-1.5 border-b border-white/10 shrink-0 gap-2">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-white/70 hover:text-white px-2.5 py-1 rounded-lg bg-white/5 active:bg-white/10 transition-colors text-xs font-medium shrink-0"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          <span>Back</span>
        </button>

        {/* View Mode Switcher */}
        <div className="flex bg-white/5 p-0.5 rounded-lg border border-white/10 text-[11px] font-medium shrink-0">
          <button
            onClick={() => setViewMode('split')}
            className={`px-2.5 py-1 rounded-md transition-all ${
              viewMode === 'split' ? 'bg-indigo-600 text-white shadow-sm' : 'text-white/50 hover:text-white/80'
            }`}
          >
            Split
          </button>
          <button
            onClick={() => setViewMode('keyboard')}
            className={`px-2.5 py-1 rounded-md transition-all ${
              viewMode === 'keyboard' ? 'bg-indigo-600 text-white shadow-sm' : 'text-white/50 hover:text-white/80'
            }`}
          >
            Keyboard
          </button>
          <button
            onClick={() => setViewMode('trackpad')}
            className={`px-2.5 py-1 rounded-md transition-all ${
              viewMode === 'trackpad' ? 'bg-indigo-600 text-white shadow-sm' : 'text-white/50 hover:text-white/80'
            }`}
          >
            Trackpad
          </button>
        </div>

        {/* Settings Button */}
        <button
          onClick={() => setShowSettings(true)}
          className="p-1.5 rounded-lg bg-white/5 text-white/70 hover:text-white active:bg-white/10 transition-colors shrink-0"
          title="Customize Colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 21a4 4 0 01-4-4 4 4 0 014-4h1a4 4 0 014 4 4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"
            />
          </svg>
        </button>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col landscape:flex-row overflow-hidden min-h-0 min-w-0 mt-1 gap-1">
        {(viewMode === 'split' || viewMode === 'trackpad') && (
          <Trackpad
            sendMessage={sendMessage}
            theme={theme}
            isFull={viewMode === 'trackpad'}
          />
        )}
        {(viewMode === 'split' || viewMode === 'keyboard') && (
          <Keyboard
            sendMessage={sendMessage}
            theme={theme}
            isFull={viewMode === 'keyboard'}
          />
        )}
      </div>

      {/* Theme Customizer Modal */}
      {showSettings && (
        <ThemeSettingsModal
          theme={theme}
          onSave={saveTheme}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

/* ========================================================================== */
/* Trackpad Component                                                         */
/* ========================================================================== */

function Trackpad({
  sendMessage,
  theme,
  isFull,
}: {
  sendMessage: (msg: WSMessage) => boolean;
  theme: KeyboardTheme;
  isFull: boolean;
}) {
  const padRef = useRef<HTMLDivElement>(null);
  const lastPos = useRef<{ x: number; y: number } | null>(null);
  const touching = useRef(false);
  const [tapping, setTapping] = useState(false);
  const touchStartTime = useRef<number>(0);
  const didMove = useRef(false);

  const sendMouse = useCallback((action: string, params: Record<string, any>) => {
    sendMessage({ type: 'mouse_event', action, ...params } as any);
  }, [sendMessage]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    const touch = e.touches[0];
    lastPos.current = { x: touch.clientX, y: touch.clientY };
    touching.current = true;
    didMove.current = false;
    touchStartTime.current = Date.now();
    setTapping(true);
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    if (!touching.current || !lastPos.current) return;
    const touch = e.touches[0];
    const dx = touch.clientX - lastPos.current.x;
    const dy = touch.clientY - lastPos.current.y;
    lastPos.current = { x: touch.clientX, y: touch.clientY };

    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      didMove.current = true;
    }

    if (e.touches.length >= 2) {
      sendMouse('scroll', { scrollY: -Math.round(dy * 1.5) });
    } else {
      // 1.8x sensitivity factor for smooth response
      sendMouse('move', { dx: Math.round(dx * 1.8), dy: Math.round(dy * 1.8) });
    }
  }, [sendMouse]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    if (e.touches.length === 0) {
      touching.current = false;
      lastPos.current = null;
      setTapping(false);

      // If tap was quick and didn't drag, trigger left click
      const elapsed = Date.now() - touchStartTime.current;
      if (!didMove.current && elapsed < 250) {
        sendMouse('click', { button: 1, down: false });
      }
    } else {
      lastPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    }
  }, [sendMouse]);

  return (
    <div
      className={`relative flex flex-col rounded-xl overflow-hidden border border-white/10 shrink-0 min-h-0 ${
        isFull ? 'flex-1 h-full' : 'h-[28%] landscape:h-full landscape:w-[35%]'
      }`}
      style={{ backgroundColor: theme.padBg }}
    >
      {/* Touch Zone */}
      <div
        ref={padRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        className="flex-1 relative select-none touch-none overflow-hidden"
      >
        {/* Subtle Background Grid */}
        <div
          className="absolute inset-0 pointer-events-none opacity-40"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.06) 1px, transparent 1px)',
            backgroundSize: '24px 24px',
          }}
        />

        {/* Center Target Indicator */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div
            className={`w-10 h-10 rounded-full border transition-all duration-100 flex items-center justify-center ${
              tapping ? 'scale-75' : 'scale-100 opacity-60'
            }`}
            style={{
              borderColor: tapping ? theme.accentText : 'rgba(255,255,255,0.2)',
              backgroundColor: tapping ? theme.accentBg : 'transparent',
            }}
          >
            <div
              className="w-1.5 h-1.5 rounded-full"
              style={{ backgroundColor: tapping ? theme.accentText : 'rgba(255,255,255,0.3)' }}
            />
          </div>
        </div>

        {/* Gesture Hint */}
        <div className="absolute top-2 left-0 right-0 text-center pointer-events-none px-4">
          <span className="text-[9px] text-white/30 font-mono tracking-wider">
            Drag = Move &middot; Tap = Left Click &middot; 2-Finger = Scroll
          </span>
        </div>
      </div>

      {/* Hardware Buttons (Left & Right Click) */}
      <div className="flex border-t border-white/10 h-9 shrink-0 bg-black/20">
        <button
          onTouchStart={(e) => {
            e.preventDefault();
            sendMouse('click', { button: 1, down: false });
          }}
          className="flex-1 flex items-center justify-center text-[11px] font-semibold text-white/70 active:bg-white/15 border-r border-white/10 transition-colors"
        >
          Left Click
        </button>
        <button
          onTouchStart={(e) => {
            e.preventDefault();
            sendMouse('click', { button: 3, down: false });
          }}
          className="flex-1 flex items-center justify-center text-[11px] font-semibold text-white/70 active:bg-white/15 transition-colors"
        >
          Right Click
        </button>
      </div>
    </div>
  );
}

/* ========================================================================== */
/* Keyboard Component                                                         */
/* ========================================================================== */

const KEY_ROWS: string[][] = [
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'],
  ['z', 'x', 'c', 'v', 'b', 'n', 'm'],
];

const MODIFIERS = ['ctrl', 'alt', 'shift', 'cmd'];

const SPECIAL: Record<string, string> = {
  '⇥': 'Tab',
  '⌫': 'BackSpace',
  '⏎': 'Return',
  ' ': 'space',
  '⎋': 'Escape',
  '◀': 'Left',
  '▶': 'Right',
  '▲': 'Up',
  '▼': 'Down',
};

function Keyboard({
  sendMessage,
  theme,
  isFull,
}: {
  sendMessage: (msg: WSMessage) => boolean;
  theme: KeyboardTheme;
  isFull: boolean;
}) {
  const [activeMods, setActiveMods] = useState<Set<string>>(new Set());
  const [textMode, setTextMode] = useState(false);
  const [textInput, setTextInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const sendKey = useCallback(
    (key: string) => {
      if (activeMods.size > 0) {
        const combo = [...activeMods, key].join('+');
        sendMessage({ type: 'keyboard_event', action: 'key', value: combo });
      } else {
        sendMessage({ type: 'keyboard_event', action: 'key', value: key });
      }
    },
    [activeMods, sendMessage]
  );

  const sendText = useCallback(
    (text: string) => {
      sendMessage({ type: 'keyboard_event', action: 'text', value: text });
    },
    [sendMessage]
  );

  const toggleMod = useCallback((mod: string) => {
    setActiveMods((prev) => {
      const next = new Set(prev);
      if (next.has(mod)) next.delete(mod);
      else next.add(mod);
      return next;
    });
  }, []);

  const handleKeyPress = useCallback(
    (key: string) => {
      const mapped = SPECIAL[key] || key;
      if (mapped === 'shift') {
        toggleMod('shift');
        return;
      }
      sendKey(mapped);
    },
    [sendKey, toggleMod]
  );

  const handleTextSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (textInput.trim()) {
        sendText(textInput);
        setTextInput('');
      }
    },
    [textInput, sendText]
  );

  return (
    <div className={`flex-1 flex flex-col overflow-hidden min-h-0 min-w-0 ${isFull ? 'h-full' : ''}`}>
      {/* Function / Subheader Row */}
      <div className="flex items-center justify-between px-1 py-1 shrink-0 gap-2">
        <button
          onClick={() => setTextMode(!textMode)}
          className="text-[11px] font-medium px-3 py-1 rounded-lg transition-all border shrink-0 flex items-center gap-1.5"
          style={{
            backgroundColor: textMode ? theme.accentBg : theme.keyBg,
            color: textMode ? theme.accentText : theme.keyText,
            borderColor: textMode ? theme.accentBorder : theme.keyBorder,
          }}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
          </svg>
          <span>{textMode ? 'Keys View' : 'Type Text'}</span>
        </button>

        {/* Modifiers List */}
        <div className="flex flex-1 gap-1 justify-end">
          {MODIFIERS.map((mod) => {
            const isActive = activeMods.has(mod);
            return (
              <button
                key={mod}
                onTouchStart={(e) => {
                  e.preventDefault();
                  toggleMod(mod);
                }}
                className="px-2.5 py-0.5 rounded-md text-[10px] font-bold uppercase transition-all select-none border"
                style={{
                  backgroundColor: isActive ? theme.modActiveBg : theme.keyBg,
                  color: isActive ? theme.modActiveText : 'rgba(255,255,255,0.6)',
                  borderColor: isActive ? theme.accentBorder : theme.keyBorder,
                }}
              >
                {mod}
              </button>
            );
          })}
        </div>
      </div>

      {textMode ? (
        <form onSubmit={handleTextSubmit} className="flex-1 flex flex-col justify-center p-3 gap-3">
          <input
            ref={inputRef}
            type="text"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder="Type text and press Send..."
            className="w-full bg-white/5 border border-white/15 rounded-xl px-4 py-3 text-base text-white placeholder-white/30 outline-none focus:border-indigo-500/80"
            autoFocus
          />
          <div className="flex gap-2">
            <button
              type="submit"
              className="flex-1 py-3 rounded-xl text-sm font-semibold text-white shadow-lg transition-transform active:scale-95"
              style={{ backgroundColor: theme.accentText, color: '#000000' }}
            >
              Send Text to PC
            </button>
            <button
              type="button"
              onClick={() => {
                sendKey('Return');
              }}
              className="px-5 py-3 rounded-xl text-sm font-semibold border transition-transform active:scale-95"
              style={{
                backgroundColor: theme.keyBg,
                color: theme.keyText,
                borderColor: theme.keyBorder,
              }}
            >
              Enter ⏎
            </button>
          </div>
        </form>
      ) : (
        /* Virtual Full Keyboard */
        <div className="flex-1 flex flex-col justify-between overflow-hidden min-h-0 min-w-0 p-1 gap-[3px]">
          {/* Numbers Row */}
          <div className="flex-1 flex gap-[3px] min-h-0">
            {KEY_ROWS[0].map((key) => (
              <button
                key={key}
                onTouchStart={(e) => {
                  e.preventDefault();
                  handleKeyPress(key);
                }}
                className="flex-1 flex items-center justify-center rounded-lg text-xs md:text-sm font-semibold border active:opacity-75 transition-all select-none min-h-0"
                style={{
                  backgroundColor: theme.keyBg,
                  color: theme.keyText,
                  borderColor: theme.keyBorder,
                }}
              >
                {key}
              </button>
            ))}
          </div>

          {/* QWERTY Row */}
          <div className="flex-1 flex gap-[3px] min-h-0">
            {KEY_ROWS[1].map((key) => (
              <button
                key={key}
                onTouchStart={(e) => {
                  e.preventDefault();
                  handleKeyPress(key);
                }}
                className="flex-1 flex items-center justify-center rounded-lg text-xs md:text-sm font-semibold border active:opacity-75 transition-all select-none min-h-0 uppercase"
                style={{
                  backgroundColor: theme.keyBg,
                  color: theme.keyText,
                  borderColor: theme.keyBorder,
                }}
              >
                {key}
              </button>
            ))}
          </div>

          {/* ASDF Row */}
          <div className="flex-1 flex gap-[3px] min-h-0 px-1">
            {KEY_ROWS[2].map((key) => (
              <button
                key={key}
                onTouchStart={(e) => {
                  e.preventDefault();
                  handleKeyPress(key);
                }}
                className="flex-1 flex items-center justify-center rounded-lg text-xs md:text-sm font-semibold border active:opacity-75 transition-all select-none min-h-0 uppercase"
                style={{
                  backgroundColor: theme.keyBg,
                  color: theme.keyText,
                  borderColor: theme.keyBorder,
                }}
              >
                {key}
              </button>
            ))}
          </div>

          {/* ZXCV Row */}
          <div className="flex-1 flex gap-[3px] min-h-0 px-2">
            {KEY_ROWS[3].map((key) => (
              <button
                key={key}
                onTouchStart={(e) => {
                  e.preventDefault();
                  handleKeyPress(key);
                }}
                className="flex-1 flex items-center justify-center rounded-lg text-xs md:text-sm font-semibold border active:opacity-75 transition-all select-none min-h-0 uppercase"
                style={{
                  backgroundColor: theme.keyBg,
                  color: theme.keyText,
                  borderColor: theme.keyBorder,
                }}
              >
                {key}
              </button>
            ))}
          </div>

          {/* Space / Enter / Tab / Backspace Row */}
          <div className="flex-1 flex gap-[3px] min-h-0">
            <button
              onTouchStart={(e) => {
                e.preventDefault();
                handleKeyPress('⇥');
              }}
              className="px-2.5 flex items-center justify-center rounded-lg text-[10px] font-bold border active:opacity-75 select-none min-h-0 shrink-0"
              style={{
                backgroundColor: theme.keyBg,
                color: theme.keyText,
                borderColor: theme.keyBorder,
              }}
            >
              Tab
            </button>
            <button
              onTouchStart={(e) => {
                e.preventDefault();
                handleKeyPress('⌫');
              }}
              className="flex-1 flex items-center justify-center rounded-lg text-xs font-bold border active:opacity-75 select-none min-h-0"
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.15)',
                color: '#fca5a5',
                borderColor: 'rgba(239, 68, 68, 0.3)',
              }}
            >
              ⌫
            </button>
            <button
              onTouchStart={(e) => {
                e.preventDefault();
                handleKeyPress(' ');
              }}
              className="flex-[2.5] flex items-center justify-center rounded-lg text-xs font-bold border active:opacity-75 select-none min-h-0"
              style={{
                backgroundColor: theme.keyBg,
                color: theme.keyText,
                borderColor: theme.keyBorder,
              }}
            >
              SPACE
            </button>
            <button
              onTouchStart={(e) => {
                e.preventDefault();
                handleKeyPress('⏎');
              }}
              className="flex-[1.4] flex items-center justify-center rounded-lg text-xs font-bold border active:opacity-75 select-none min-h-0"
              style={{
                backgroundColor: theme.accentBg,
                color: theme.accentText,
                borderColor: theme.accentBorder,
              }}
            >
              ENTER ⏎
            </button>
          </div>

          {/* Arrows & Utility Row */}
          <div className="flex-1 flex gap-[3px] min-h-0">
            <button
              onTouchStart={(e) => {
                e.preventDefault();
                handleKeyPress('⎋');
              }}
              className="px-2 flex items-center justify-center rounded-lg text-[10px] font-bold border active:opacity-75 select-none min-h-0"
              style={{
                backgroundColor: theme.keyBg,
                color: theme.keyText,
                borderColor: theme.keyBorder,
              }}
            >
              Esc
            </button>
            <button
              onTouchStart={(e) => {
                e.preventDefault();
                handleKeyPress('▲');
              }}
              className="flex-1 flex items-center justify-center rounded-lg text-xs font-bold border active:opacity-75 select-none min-h-0"
              style={{
                backgroundColor: theme.keyBg,
                color: theme.keyText,
                borderColor: theme.keyBorder,
              }}
            >
              ▲
            </button>
            <button
              onTouchStart={(e) => {
                e.preventDefault();
                handleKeyPress('▼');
              }}
              className="flex-1 flex items-center justify-center rounded-lg text-xs font-bold border active:opacity-75 select-none min-h-0"
              style={{
                backgroundColor: theme.keyBg,
                color: theme.keyText,
                borderColor: theme.keyBorder,
              }}
            >
              ▼
            </button>
            <button
              onTouchStart={(e) => {
                e.preventDefault();
                handleKeyPress('◀');
              }}
              className="flex-1 flex items-center justify-center rounded-lg text-xs font-bold border active:opacity-75 select-none min-h-0"
              style={{
                backgroundColor: theme.keyBg,
                color: theme.keyText,
                borderColor: theme.keyBorder,
              }}
            >
              ◀
            </button>
            <button
              onTouchStart={(e) => {
                e.preventDefault();
                handleKeyPress('▶');
              }}
              className="flex-1 flex items-center justify-center rounded-lg text-xs font-bold border active:opacity-75 select-none min-h-0"
              style={{
                backgroundColor: theme.keyBg,
                color: theme.keyText,
                borderColor: theme.keyBorder,
              }}
            >
              ▶
            </button>
            <button
              onTouchStart={(e) => {
                e.preventDefault();
                handleKeyPress('Delete');
              }}
              className="px-2 flex items-center justify-center rounded-lg text-[10px] font-bold border active:opacity-75 select-none min-h-0"
              style={{
                backgroundColor: theme.keyBg,
                color: theme.keyText,
                borderColor: theme.keyBorder,
              }}
            >
              Del
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ========================================================================== */
/* Theme Customizer Modal Component                                           */
/* ========================================================================== */

function toHexColor(color: string, fallback: string = '#1e293b'): string {
  if (!color) return fallback;
  if (color.startsWith('#') && (color.length === 7 || color.length === 4)) {
    if (color.length === 4) {
      return `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`;
    }
    return color;
  }
  const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (match) {
    const r = parseInt(match[1], 10).toString(16).padStart(2, '0');
    const g = parseInt(match[2], 10).toString(16).padStart(2, '0');
    const b = parseInt(match[3], 10).toString(16).padStart(2, '0');
    return `#${r}${g}${b}`;
  }
  return fallback;
}

function ThemeSettingsModal({
  theme,
  onSave,
  onClose,
}: {
  theme: KeyboardTheme;
  onSave: (theme: KeyboardTheme) => void;
  onClose: () => void;
}) {
  const [current, setCurrent] = useState<KeyboardTheme>({ ...theme });

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 backdrop-blur-md p-3 sm:p-4 select-none">
      <div className="w-full max-w-sm bg-slate-900/95 border border-white/20 rounded-2xl shadow-2xl flex flex-col max-h-[85vh] overflow-hidden">
        {/* Pinned Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 shrink-0 bg-slate-900">
          <h2 className="text-sm font-bold text-white flex items-center gap-2">
            <span>🎨</span>
            <span>Keyboard & Key Colors</span>
          </h2>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-white/10 flex items-center justify-center text-white/60 hover:text-white active:bg-white/20"
          >
            ✕
          </button>
        </div>

        {/* Scrollable Content Body */}
        <div className="flex-1 overflow-y-auto min-h-0 p-4 space-y-4 touch-pan-y">
          {/* Preset Themes Section */}
          <div>
            <label className="text-[11px] font-semibold text-white/60 uppercase tracking-wider block mb-2">
              Preset Themes
            </label>
            <div className="grid grid-cols-2 gap-2">
              {PRESET_THEMES.map((preset) => {
                const isSelected = current.id === preset.id;
                return (
                  <button
                    key={preset.id}
                    onClick={() => {
                      setCurrent({ ...preset });
                      onSave({ ...preset });
                    }}
                    className={`p-2 rounded-xl border text-left flex items-center gap-2 transition-all ${
                      isSelected
                        ? 'border-indigo-500 bg-indigo-500/20'
                        : 'border-white/10 bg-white/5 hover:bg-white/10 active:bg-white/15'
                    }`}
                  >
                    <div
                      className="w-5 h-5 rounded-md border border-white/20 shrink-0 shadow-sm"
                      style={{ backgroundColor: preset.bgColor }}
                    />
                    <span className="text-[11px] font-medium text-white/90 truncate">{preset.name}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Custom Colors Section */}
          <div className="space-y-2.5 pt-2 border-t border-white/10">
            <label className="text-[11px] font-semibold text-white/60 uppercase tracking-wider block">
              Custom Colors
            </label>

            {/* Background Color */}
            <div className="flex items-center justify-between bg-white/5 p-2.5 rounded-xl border border-white/10">
              <span className="text-xs text-white/80 font-medium">Keyboard Background</span>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={toHexColor(current.bgColor, '#080d1a')}
                  onChange={(e) => {
                    const updated = { ...current, id: 'custom', bgColor: e.target.value };
                    setCurrent(updated);
                    onSave(updated);
                  }}
                  className="w-8 h-8 rounded-lg cursor-pointer bg-transparent border-0"
                />
                <span className="text-[11px] font-mono text-white/60">{current.bgColor}</span>
              </div>
            </div>

            {/* Key Background Color */}
            <div className="flex items-center justify-between bg-white/5 p-2.5 rounded-xl border border-white/10">
              <span className="text-xs text-white/80 font-medium">Key Background</span>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={toHexColor(current.keyBg, '#1e293b')}
                  onChange={(e) => {
                    const updated = { ...current, id: 'custom', keyBg: e.target.value };
                    setCurrent(updated);
                    onSave(updated);
                  }}
                  className="w-8 h-8 rounded-lg cursor-pointer bg-transparent border-0"
                />
                <span className="text-[11px] font-mono text-white/60">{current.keyBg}</span>
              </div>
            </div>

            {/* Key Text Color */}
            <div className="flex items-center justify-between bg-white/5 p-2.5 rounded-xl border border-white/10">
              <span className="text-xs text-white/80 font-medium">Key Text Color</span>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={toHexColor(current.keyText, '#f8fafc')}
                  onChange={(e) => {
                    const updated = { ...current, id: 'custom', keyText: e.target.value };
                    setCurrent(updated);
                    onSave(updated);
                  }}
                  className="w-8 h-8 rounded-lg cursor-pointer bg-transparent border-0"
                />
                <span className="text-[11px] font-mono text-white/60">{current.keyText}</span>
              </div>
            </div>

            {/* Accent Color */}
            <div className="flex items-center justify-between bg-white/5 p-2.5 rounded-xl border border-white/10">
              <span className="text-xs text-white/80 font-medium">Accent / Special Key</span>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={toHexColor(current.accentText, '#818cf8')}
                  onChange={(e) => {
                    const val = e.target.value;
                    const updated = {
                      ...current,
                      id: 'custom',
                      accentText: val,
                      accentBg: `${val}33`,
                      accentBorder: `${val}66`,
                    };
                    setCurrent(updated);
                    onSave(updated);
                  }}
                  className="w-8 h-8 rounded-lg cursor-pointer bg-transparent border-0"
                />
                <span className="text-[11px] font-mono text-white/60">{current.accentText}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Pinned Action Buttons Footer */}
        <div className="px-4 py-3 border-t border-white/10 flex gap-2 shrink-0 bg-slate-900">
          <button
            onClick={() => {
              const defaultTheme = PRESET_THEMES[0];
              setCurrent(defaultTheme);
              onSave(defaultTheme);
            }}
            className="px-3 py-2 rounded-xl text-xs font-semibold bg-white/5 text-white/70 hover:bg-white/10 active:bg-white/15 transition-colors"
          >
            Reset Default
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-xl text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white shadow-md transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
