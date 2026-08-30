import { useState, useCallback, useRef, useEffect } from 'react';
import type { Page, Button, Background, GridConfig, LayoutPreference } from '@shared/protocol';
import {
  compressImageToDataUrl,
  ICON_MAX_PX,
  ICON_QUALITY,
  BACKGROUND_MAX_PX,
  BACKGROUND_QUALITY,
} from '../utils/image';

interface SettingsPanelProps {
  page: Page;
  editingButtonId: string | null;
  layoutPreference: LayoutPreference;
  isRotated?: boolean;
  onSaveButton: (pageId: string, button: Button) => void;
  onDeleteButton: (pageId: string, buttonId: string) => void;
  onUpdateBackground: (pageId: string, background: Background) => void;
  onUpdateGrid: (pageId: string, grid: GridConfig) => void;
  onUpdateLayout: (layout: LayoutPreference) => void;
  onPreviewBackground?: (background: Background | null) => void;
  onPreviewGrid?: (grid: GridConfig | null) => void;
  onClose: () => void;
}

const PRESET_GRADIENTS = [
  'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)',
  'linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)',
  'linear-gradient(135deg, #200122 0%, #6f0000 100%)',
  'linear-gradient(135deg, #141e30 0%, #243b55 100%)',
  'linear-gradient(135deg, #000428 0%, #004e92 100%)',
  'linear-gradient(135deg, #1a1a2e 0%, #e94560 100%)',
  'linear-gradient(135deg, #0f2027 0%, #203a43 50%, #2c5364 100%)',
  'linear-gradient(135deg, #232526 0%, #414345 100%)',
];

const CATEGORIZED_ICONS = {
  browsers: [
    { label: 'Chrome/Web', emoji: '🌐' },
    { label: 'Firefox', emoji: '🦊' },
    { label: 'Safari', emoji: '🧭' },
    { label: 'Tor', emoji: '🧅' },
    { label: 'Brave', emoji: '🦁' },
    { label: 'Edge', emoji: '🌊' },
    { label: 'Internet', emoji: '🌍' },
    { label: 'Webpage', emoji: '🕸️' },
  ],
  games: [
    { label: 'Steam/Game', emoji: '🎮' },
    { label: 'Joystick', emoji: '🕹️' },
    { label: 'Target', emoji: '🎯' },
    { label: 'Swords', emoji: '⚔️' },
    { label: 'Trophy', emoji: '🏆' },
    { label: 'Race', emoji: '🏁' },
    { label: 'Alien', emoji: '👾' },
    { label: 'Dice', emoji: '🎲' },
    { label: 'Puzzle', emoji: '🧩' },
    { label: 'Ghost', emoji: '👻' },
  ],
  streaming: [
    { label: 'Netflix/Popcorn', emoji: '🍿' },
    { label: 'Movie/Cinema', emoji: '🎬' },
    { label: 'TV Screen', emoji: '📺' },
    { label: 'Music Player', emoji: '🎵' },
    { label: 'Headphones', emoji: '🎧' },
    { label: 'Microphone', emoji: '🎤' },
    { label: 'Speaker', emoji: '🔊' },
    { label: 'Camcorder', emoji: '📹' },
    { label: 'Radio', emoji: '📻' },
    { label: 'Streaming', emoji: '🔴' },
  ],
  development: [
    { label: 'IDE/Code', emoji: '💻' },
    { label: 'VS Code/Tools', emoji: '🛠️' },
    { label: 'Terminal', emoji: '⬛' },
    { label: 'Bug/Debug', emoji: '🐞' },
    { label: 'Rocket/Deploy', emoji: '🚀' },
    { label: 'Folder/Workspace', emoji: '📁' },
    { label: 'Database', emoji: '🗄️' },
    { label: 'System Settings', emoji: '⚙️' },
    { label: 'Password/Key', emoji: '🔑' },
    { label: 'Hardware/Rig', emoji: '🖥️' },
  ],
  creative: [
    { label: 'Photoshop/Paint', emoji: '🎨' },
    { label: 'Brush/Design', emoji: '🖌️' },
    { label: 'Camera/Photos', emoji: '📷' },
    { label: 'Ruler/Layout', emoji: '📐' },
    { label: 'Text Editor', emoji: '📝' },
    { label: 'Office/Mail', emoji: '📧' },
    { label: 'Chat/Slack', emoji: '💬' },
    { label: 'Calendar/Tasks', emoji: '📅' },
    { label: 'Store/Cart', emoji: '🛒' },
    { label: 'Secure/Lock', emoji: '🔒' },
  ],
};

export function SettingsPanel({
  page,
  editingButtonId,
  layoutPreference,
  isRotated,
  onSaveButton,
  onDeleteButton,
  onUpdateBackground,
  onUpdateGrid,
  onUpdateLayout,
  onPreviewBackground,
  onPreviewGrid,
  onClose,
}: SettingsPanelProps) {
  const [tab, setTab] = useState<'buttons' | 'grid' | 'background' | 'layout'>(
    editingButtonId ? 'buttons' : 'layout'
  );
  const [uploading, setUploading] = useState(false);
  const [iconCategory, setIconCategory] = useState<keyof typeof CATEGORIZED_ICONS>('browsers');
  const iconInputRef = useRef<HTMLInputElement>(null);
  const iconCameraRef = useRef<HTMLInputElement>(null);
  const bgInputRef = useRef<HTMLInputElement>(null);
  const bgCameraRef = useRef<HTMLInputElement>(null);

  const [buttonForm, setButtonForm] = useState(() => {
    if (editingButtonId && editingButtonId !== 'new') {
      const btn = page.buttons.find((b) => b.id === editingButtonId);
      return btn || { id: '', label: '', icon: '', iconSize: 'normal' as const, action: { kind: 'open_url' as const, target: '' }, position: { row: 0, col: 0 } };
    }
    const occupied = new Set(page.buttons.map((b) => `${b.position.row}-${b.position.col}`));
    let pos = { row: 0, col: 0 };
    for (let r = 0; r < page.grid.rows; r++) {
      for (let c = 0; c < page.grid.cols; c++) {
        if (!occupied.has(`${r}-${c}`)) { pos = { row: r, col: c }; break; }
      }
    }
    return { id: '', label: '', icon: '', iconSize: 'normal' as const, action: { kind: 'open_url' as const, target: '' }, position: pos };
  });

  const [gridForm, setGridForm] = useState(page.grid);
  const [bgForm, setBgForm] = useState(page.background);
  const [layoutForm, setLayoutForm] = useState(layoutPreference);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Seed the forms from the page once, and again only if the panel is reused for a
  // different page. Re-seeding whenever page.grid/background change would discard
  // the user's in-progress choice every time the desktop echoes a config_sync.
  const seededPageId = useRef(page.id);
  useEffect(() => {
    if (seededPageId.current === page.id) return;
    seededPageId.current = page.id;
    setGridForm(page.grid);
    setBgForm(page.background);
  }, [page.id, page.grid, page.background]);

  const uploadFile = useCallback(async (file: File, kind: 'icon' | 'background'): Promise<string | null> => {
    setUploadError(null);
    const { dataUrl, error } = await compressImageToDataUrl(
      file,
      kind === 'icon' ? ICON_MAX_PX : BACKGROUND_MAX_PX,
      kind === 'icon' ? ICON_QUALITY : BACKGROUND_QUALITY,
    );
    if (error || !dataUrl) {
      setUploadError(error || 'Could not use that image');
      return null;
    }
    return dataUrl;
  }, []);

  const handleIconUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const url = await uploadFile(file, 'icon');
    if (url) setButtonForm((prev) => ({ ...prev, icon: url }));
    setUploading(false);
    e.target.value = '';
  }, [uploadFile]);

  const handleBgUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const url = await uploadFile(file, 'background');
    if (url) setBgForm({ type: 'image', value: url });
    setUploading(false);
    e.target.value = '';
  }, [uploadFile]);

  const handleSaveButton = useCallback(() => {
    onSaveButton(page.id, buttonForm);
  }, [page.id, buttonForm, onSaveButton]);

  const handleSaveGrid = useCallback(() => {
    onUpdateGrid(page.id, gridForm);
    onPreviewGrid?.(null);
  }, [page.id, gridForm, onUpdateGrid, onPreviewGrid]);

  const handleSaveBackground = useCallback(() => {
    onUpdateBackground(page.id, bgForm);
    onPreviewBackground?.(null);
  }, [page.id, bgForm, onUpdateBackground, onPreviewBackground]);

  // Live preview: emit background and grid changes as user edits
  useEffect(() => {
    onPreviewBackground?.(bgForm);
  }, [bgForm, onPreviewBackground]);

  useEffect(() => {
    onPreviewGrid?.(gridForm);
  }, [gridForm, onPreviewGrid]);

  // Clear previews on unmount
  useEffect(() => {
    return () => {
      onPreviewBackground?.(null);
      onPreviewGrid?.(null);
    };
  }, [onPreviewBackground, onPreviewGrid]);

  const isFull = layoutPreference.area === 'full';

  return (
    <div className="absolute inset-0 z-50">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div
        className="absolute inset-0 flex flex-col rounded-none overflow-hidden"
        style={{
          background: 'rgba(0,0,0,0.55)',
          backdropFilter: 'blur(40px) saturate(180%)',
          WebkitBackdropFilter: 'blur(40px) saturate(180%)',
          height: '100%',
          paddingTop: isFull ? 0 : (isRotated ? 'var(--safe-right)' : 'var(--safe-top)'),
          paddingBottom: isFull ? 0 : (isRotated ? 'var(--safe-right)' : 'var(--safe-bottom)'),
          paddingLeft: isFull ? 0 : (isRotated ? 'var(--safe-top)' : 'var(--safe-left)'),
          paddingRight: isFull ? 0 : (isRotated ? 'var(--safe-bottom)' : 'var(--safe-right)'),
          borderTop: '1px solid rgba(255,255,255,0.15)',
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-white/10 shrink-0">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/10 shrink-0">
          {(['buttons', 'grid', 'background', 'layout'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-3 text-xs font-medium capitalize transition-colors ${
                tab === t ? 'text-white border-b-2 border-white/80' : 'text-white/40'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4" style={{ WebkitOverflowScrolling: 'touch' }}>
          {tab === 'buttons' && (
            <>
              {/* Icon preview + upload */}
              <div className="flex items-center gap-4">
                <button
                  onClick={() => iconInputRef.current?.click()}
                  className="w-16 h-16 rounded-2xl glass-panel flex items-center justify-center overflow-hidden hover:bg-white/10 transition-colors relative"
                >
                  {buttonForm.icon ? (
                    buttonForm.icon.length <= 4 && !buttonForm.icon.startsWith('http') ? (
                      <span className="text-3xl">{buttonForm.icon}</span>
                    ) : (
                      <img src={buttonForm.icon} alt="" className="w-full h-full object-cover" />
                    )
                  ) : (
                    <svg className="w-6 h-6 text-white/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  )}
                  {uploading && (
                    <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                      <svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                    </div>
                  )}
                </button>
                <div className="flex-1 space-y-1">
                  <p className="text-sm font-medium text-white/80">Button Icon</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => iconInputRef.current?.click()}
                      className="text-xs px-3 py-1 rounded-lg bg-white/10 text-white/60 hover:bg-white/15 transition-colors"
                    >
                      📁 Gallery
                    </button>
                    <button
                      onClick={() => iconCameraRef.current?.click()}
                      className="text-xs px-3 py-1 rounded-lg bg-white/10 text-white/60 hover:bg-white/15 transition-colors"
                    >
                      📷 Camera
                    </button>
                  </div>
                  {buttonForm.icon && (
                    <button
                      onClick={() => setButtonForm((prev) => ({ ...prev, icon: '' }))}
                      className="text-xs text-red-400"
                    >
                      Remove icon
                    </button>
                  )}
                </div>
              </div>
              <input ref={iconInputRef} type="file" accept="image/*" onChange={handleIconUpload} className="hidden" />
              <input ref={iconCameraRef} type="file" accept="image/*" capture="environment" onChange={handleIconUpload} className="hidden" />
              {uploadError && <p className="text-xs text-red-400">{uploadError}</p>}

              {/* Icon size toggle */}
              <div>
                <label className="block text-xs text-white/50 mb-1.5">Icon Size</label>
                <div className="flex gap-2">
                  {(['normal', 'full'] as const).map((size) => (
                    <button
                      key={size}
                      onClick={() => setButtonForm((prev) => ({ ...prev, iconSize: size }))}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all ${
                        buttonForm.iconSize === size
                          ? 'bg-white/20 border border-white/40 text-white'
                          : 'glass-panel text-white/50'
                      }`}
                    >
                      {size === 'normal' ? 'Icon + Label' : 'Full Image'}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-white/30 mt-1">
                  {buttonForm.iconSize === 'full' ? 'Image fills the entire button' : 'Small icon with label below'}
                </p>
              </div>

              {/* Preset emoji icons */}
              <div className="space-y-2.5">
                <label className="block text-xs text-white/50">Or pick a preset icon</label>
                
                {/* Category selector */}
                <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none" style={{ WebkitOverflowScrolling: 'touch' }}>
                  {(Object.keys(CATEGORIZED_ICONS) as Array<keyof typeof CATEGORIZED_ICONS>).map((cat) => {
                    const labels = {
                      browsers: '🌐 Browsers',
                      games: '🎮 Games',
                      streaming: '🍿 Media/Netflix',
                      development: '💻 Dev/IDE',
                      creative: '🎨 Apps/Creative'
                    };
                    return (
                      <button
                        key={cat}
                        onClick={() => setIconCategory(cat)}
                        className={`text-xs px-2.5 py-1.5 rounded-lg font-medium transition-all shrink-0 ${
                          iconCategory === cat
                            ? 'bg-white/20 text-white border border-white/35'
                            : 'glass-panel text-white/50'
                        }`}
                      >
                        {labels[cat]}
                      </button>
                    );
                  })}
                </div>

                {/* Preset Grid */}
                <div className="grid grid-cols-6 gap-2">
                  {CATEGORIZED_ICONS[iconCategory].map((preset) => (
                    <button
                      key={preset.label}
                      onClick={() => setButtonForm((prev) => ({ ...prev, icon: preset.emoji }))}
                      className={`aspect-square rounded-xl glass-panel flex items-center justify-center text-xl hover:bg-white/10 transition-colors ${
                        buttonForm.icon === preset.emoji ? 'ring-2 ring-white/60 bg-white/15' : ''
                      }`}
                      title={preset.label}
                    >
                      {preset.emoji}
                    </button>
                  ))}
                </div>
              </div>

              {/* Label */}
              <div>
                <label className="block text-xs text-white/50 mb-1.5">Label</label>
                <input
                  type="text"
                  value={buttonForm.label}
                  onChange={(e) => setButtonForm((prev) => ({ ...prev, label: e.target.value }))}
                  placeholder="Button name"
                  className="w-full px-4 py-2.5 glass-panel text-white placeholder-white/30 outline-none"
                />
              </div>

              {/* Action type */}
              <div>
                <label className="block text-xs text-white/50 mb-1.5">Action Type</label>
                <div className="grid grid-cols-3 gap-2">
                  {([
                    { kind: 'open_url', label: 'Open URL', icon: '🌐' },
                    { kind: 'start_app', label: 'Start App', icon: '🚀' },
                    { kind: 'open_app', label: 'Quick Launch', icon: '📱' },
                    { kind: 'hotkey', label: 'Hotkey', icon: '⌨️' },
                    { kind: 'media_key', label: 'Media Key', icon: '🎵' },
                    { kind: 'run_command', label: 'Run Command', icon: '⚙️' },
                  ] as const).map(({ kind, label, icon }) => (
                    <button
                      key={kind}
                      onClick={() => setButtonForm((prev) => ({ ...prev, action: { ...prev.action, kind } }))}
                      className={`py-2.5 rounded-xl text-xs font-medium transition-all flex flex-col items-center gap-1 ${
                        buttonForm.action.kind === kind
                          ? 'bg-white/20 border border-white/40 text-white'
                          : 'glass-panel text-white/50'
                      }`}
                    >
                      <span className="text-base">{icon}</span>
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Target */}
              <div>
                {buttonForm.action.kind === 'start_app' ? (
                  <>
                    <div>
                      <label className="block text-xs text-white/50 mb-1.5">Application Path</label>
                      <input
                        type="text"
                        value={buttonForm.action.target}
                        onChange={(e) => setButtonForm((prev) => ({ ...prev, action: { ...prev.action, target: e.target.value } }))}
                        placeholder="/opt/google/chrome/google-chrome"
                        className="w-full px-4 py-2.5 glass-panel text-white placeholder-white/30 outline-none font-mono text-sm"
                      />
                      <p className="text-[10px] text-white/30 mt-1">Full path to the executable</p>
                    </div>
                    <div className="mt-3">
                      <label className="block text-xs text-white/50 mb-1.5">Arguments</label>
                      <input
                        type="text"
                        value={(buttonForm.action as any).args || ''}
                        onChange={(e) => setButtonForm((prev) => ({ ...prev, action: { ...prev.action, args: e.target.value } }))}
                        placeholder='--profile-directory="Profile 4" --app-id=xxxxx'
                        className="w-full px-4 py-2.5 glass-panel text-white placeholder-white/30 outline-none font-mono text-sm"
                      />
                      <p className="text-[10px] text-white/30 mt-1">Space-separated command line arguments</p>
                    </div>
                    <div className="mt-2 p-3 rounded-xl bg-white/5 border border-white/10">
                      <p className="text-[10px] text-white/40 leading-relaxed">
                        <span className="text-white/60 font-medium">Tip:</span> To launch a Chrome PWA, use:<br/>
                        <span className="font-mono text-white/50">Path:</span> /opt/google/chrome/google-chrome<br/>
                        <span className="font-mono text-white/50">Args:</span> --app=https://web.whatsapp.com
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <label className="block text-xs text-white/50 mb-1.5">
                      {buttonForm.action.kind === 'open_url' && 'URL'}
                      {buttonForm.action.kind === 'open_app' && 'App Name'}
                      {buttonForm.action.kind === 'hotkey' && 'Key Combination'}
                      {buttonForm.action.kind === 'media_key' && 'Media Action'}
                      {buttonForm.action.kind === 'run_command' && 'Shell Command'}
                    </label>
                    {buttonForm.action.kind === 'media_key' ? (
                      <select
                        value={buttonForm.action.target}
                        onChange={(e) => setButtonForm((prev) => ({ ...prev, action: { ...prev.action, target: e.target.value } }))}
                        className="w-full px-4 py-2.5 glass-panel text-white outline-none text-sm"
                      >
                        <option value="play" className="bg-gray-800">▶ Play / Pause</option>
                        <option value="pause" className="bg-gray-800">⏸ Pause</option>
                        <option value="stop" className="bg-gray-800">⏹ Stop</option>
                        <option value="next" className="bg-gray-800">⏭ Next Track</option>
                        <option value="prev" className="bg-gray-800">⏮ Previous Track</option>
                        <option value="volume_up" className="bg-gray-800">🔊 Volume Up</option>
                        <option value="volume_down" className="bg-gray-800">🔉 Volume Down</option>
                        <option value="mute" className="bg-gray-800">🔇 Mute / Unmute</option>
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={buttonForm.action.target}
                        onChange={(e) => setButtonForm((prev) => ({ ...prev, action: { ...prev.action, target: e.target.value } }))}
                        placeholder={
                          buttonForm.action.kind === 'open_url' ? 'https://...' :
                          buttonForm.action.kind === 'open_app' ? 'spotify, firefox, code...' :
                          buttonForm.action.kind === 'hotkey' ? 'ctrl+alt+t, cmd+space...' :
                          'ls -la, echo hello...'
                        }
                        className="w-full px-4 py-2.5 glass-panel text-white placeholder-white/30 outline-none font-mono text-sm"
                      />
                    )}
                    {buttonForm.action.kind === 'hotkey' && (
                      <p className="text-[10px] text-white/30 mt-1">
                        Use: ctrl, alt, shift, cmd/command + key. Separate with +
                      </p>
                    )}
                    {buttonForm.action.kind === 'run_command' && (
                      <p className="text-[10px] text-white/30 mt-1">
                        Runs any shell command on the desktop. Timeout: 30s.
                      </p>
                    )}
                  </>
                )}
              </div>

              {/* Save / Delete */}
              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleSaveButton}
                  className="flex-1 py-3 rounded-xl font-semibold text-white"
                  style={{ background: 'rgba(255,255,255,0.2)', backdropFilter: 'blur(12px) saturate(150%)', WebkitBackdropFilter: 'blur(12px) saturate(150%)', border: '1px solid rgba(255,255,255,0.3)' }}
                >
                  Save Button
                </button>
                {editingButtonId && editingButtonId !== 'new' && (
                  <button
                    onClick={() => onDeleteButton(page.id, editingButtonId)}
                    className="px-4 py-3 rounded-xl bg-red-500/20 border border-red-500/40 text-red-300 font-medium"
                  >
                    Delete
                  </button>
                )}
              </div>
            </>
          )}

          {tab === 'grid' && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-white/50 mb-1.5">Columns</label>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setGridForm((p) => ({ ...p, cols: Math.max(2, p.cols - 1) }))}
                      className="w-10 h-10 rounded-xl glass-panel flex items-center justify-center text-white/60"
                    >-</button>
                    <div className="flex-1 text-center text-white font-mono text-lg">{gridForm.cols}</div>
                    <button
                      onClick={() => setGridForm((p) => ({ ...p, cols: Math.min(8, p.cols + 1) }))}
                      className="w-10 h-10 rounded-xl glass-panel flex items-center justify-center text-white/60"
                    >+</button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-white/50 mb-1.5">Rows</label>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setGridForm((p) => ({ ...p, rows: Math.max(2, p.rows - 1) }))}
                      className="w-10 h-10 rounded-xl glass-panel flex items-center justify-center text-white/60"
                    >-</button>
                    <div className="flex-1 text-center text-white font-mono text-lg">{gridForm.rows}</div>
                    <button
                      onClick={() => setGridForm((p) => ({ ...p, rows: Math.min(10, p.rows + 1) }))}
                      className="w-10 h-10 rounded-xl glass-panel flex items-center justify-center text-white/60"
                    >+</button>
                  </div>
                </div>
              </div>

              {/* Preview */}
              <div className="glass-panel p-3 rounded-xl">
                <p className="text-xs text-white/40 mb-2 text-center">Preview</p>
                <div
                  className="gap-1 mx-auto"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${gridForm.cols}, 1fr)`,
                    gridTemplateRows: `repeat(${gridForm.rows}, 1fr)`,
                    maxWidth: '200px',
                    aspectRatio: `${gridForm.cols} / ${gridForm.rows}`,
                  }}
                >
                  {Array.from({ length: gridForm.cols * gridForm.rows }).map((_, i) => (
                    <div key={i} className="rounded-md bg-white/10 border border-white/10" />
                  ))}
                </div>
              </div>

              <button
                onClick={handleSaveGrid}
                className="w-full py-3 rounded-xl font-semibold text-white"
                style={{ background: 'rgba(255,255,255,0.2)', backdropFilter: 'blur(12px) saturate(150%)', WebkitBackdropFilter: 'blur(12px) saturate(150%)', border: '1px solid rgba(255,255,255,0.3)' }}
              >
                Apply Grid
              </button>
            </>
          )}

          {tab === 'background' && (
            <>
              {/* Background preview */}
              <div
                className="w-full h-32 rounded-2xl border border-white/10 overflow-hidden"
                style={{
                  background: bgForm.type === 'gradient'
                    ? bgForm.value
                    : bgForm.type === 'image' && bgForm.value
                    ? `url(${bgForm.value}) center/cover`
                    : bgForm.value || '#1a1a2e',
                }}
              >
                <div className="w-full h-full flex items-center justify-center">
                  <span className="text-xs text-white/40 bg-black/30 px-3 py-1 rounded-full backdrop-blur-sm">Preview</span>
                </div>
              </div>

              {/* Type selector */}
              <div>
                <label className="block text-xs text-white/50 mb-1.5">Type</label>
                <div className="flex gap-2">
                  {(['gradient', 'image', 'color'] as const).map((type) => (
                    <button
                      key={type}
                      onClick={() => setBgForm((prev) => ({ ...prev, type }))}
                      className={`flex-1 py-2.5 rounded-xl text-sm font-medium capitalize transition-all ${
                        bgForm.type === type
                          ? 'bg-white/20 border border-white/40 text-white'
                          : 'glass-panel text-white/50'
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>
              </div>

              {/* Image upload */}
              {bgForm.type === 'image' && (
                <>
                  <div>
                    <label className="block text-xs text-white/50 mb-1.5">Upload from device</label>
                    <div className="flex gap-2">
                      <button
                        onClick={() => bgInputRef.current?.click()}
                        disabled={uploading}
                        className="flex-1 py-3 glass-panel rounded-xl text-white/50 hover:bg-white/5 transition-colors flex items-center justify-center gap-2 text-sm"
                      >
                        {uploading ? (
                          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                        ) : '📁 Gallery'}
                      </button>
                      <button
                        onClick={() => bgCameraRef.current?.click()}
                        disabled={uploading}
                        className="flex-1 py-3 glass-panel rounded-xl text-white/50 hover:bg-white/5 transition-colors flex items-center justify-center gap-2 text-sm"
                      >
                        📷 Camera
                      </button>
                    </div>
                    <input ref={bgInputRef} type="file" accept="image/*" onChange={handleBgUpload} className="hidden" />
                    <input ref={bgCameraRef} type="file" accept="image/*" capture="environment" onChange={handleBgUpload} className="hidden" />
                    {uploadError && <p className="text-xs text-red-400 mt-2">{uploadError}</p>}
                  </div>

                  {/* Preset gradients */}
                  <div>
                    <label className="block text-xs text-white/50 mb-2">Or pick a preset</label>
                    <div className="grid grid-cols-4 gap-2">
                      {PRESET_GRADIENTS.map((g) => (
                        <button
                          key={g}
                          onClick={() => setBgForm({ type: 'gradient', value: g })}
                          className="aspect-square rounded-xl border border-white/10 hover:border-white/40 transition-colors"
                          style={{ background: g }}
                        />
                      ))}
                    </div>
                  </div>

                  {/* Manual URL */}
                  <div>
                    <label className="block text-xs text-white/50 mb-1.5">Or enter image URL</label>
                    <input
                      type="text"
                      value={bgForm.type === 'image' ? bgForm.value : ''}
                      onChange={(e) => setBgForm({ type: 'image', value: e.target.value })}
                      placeholder="https://... or http://desktop-ip:8787/uploads/..."
                      className="w-full px-4 py-2.5 glass-panel text-white placeholder-white/30 outline-none font-mono text-xs"
                    />
                  </div>
                </>
              )}

              {/* Gradient */}
              {bgForm.type === 'gradient' && (
                <>
                  <div>
                    <label className="block text-xs text-white/50 mb-2">Pick a gradient</label>
                    <div className="grid grid-cols-4 gap-2">
                      {PRESET_GRADIENTS.map((g) => (
                        <button
                          key={g}
                          onClick={() => setBgForm({ type: 'gradient', value: g })}
                          className={`aspect-square rounded-xl border transition-colors ${
                            bgForm.value === g ? 'border-white/60 ring-2 ring-white/30' : 'border-white/10 hover:border-white/30'
                          }`}
                          style={{ background: g }}
                        />
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-white/50 mb-1.5">Or custom CSS gradient</label>
                    <input
                      type="text"
                      value={bgForm.value}
                      onChange={(e) => setBgForm({ type: 'gradient', value: e.target.value })}
                      placeholder="linear-gradient(...)"
                      className="w-full px-4 py-2.5 glass-panel text-white placeholder-white/30 outline-none font-mono text-xs"
                    />
                  </div>
                </>
              )}

              {/* Color */}
              {bgForm.type === 'color' && (
                <div className="space-y-3">
                  <input
                    type="color"
                    value={bgForm.value || '#1a1a2e'}
                    onChange={(e) => setBgForm({ type: 'color', value: e.target.value })}
                    className="w-full h-16 rounded-xl cursor-pointer border-0"
                  />
                  <input
                    type="text"
                    value={bgForm.value}
                    onChange={(e) => setBgForm({ type: 'color', value: e.target.value })}
                    placeholder="#1a1a2e"
                    className="w-full px-4 py-2.5 glass-panel text-white placeholder-white/30 outline-none font-mono text-sm"
                  />
                </div>
              )}

              <button
                onClick={handleSaveBackground}
                className="w-full py-3 rounded-xl font-semibold text-white"
                style={{ background: 'rgba(255,255,255,0.2)', backdropFilter: 'blur(12px) saturate(150%)', WebkitBackdropFilter: 'blur(12px) saturate(150%)', border: '1px solid rgba(255,255,255,0.3)' }}
              >
                Apply Background
              </button>
            </>
          )}

          {tab === 'layout' && (
            <>
              {/* Orientation */}
              <div>
                <label className="block text-xs text-white/50 mb-2">Orientation</label>
                <div className="grid grid-cols-3 gap-2">
                  {(['auto', 'portrait', 'landscape'] as const).map((o) => (
                    <button
                      key={o}
                      onClick={() => setLayoutForm((prev) => ({ ...prev, orientation: o }))}
                      className={`py-3 rounded-xl text-sm font-medium capitalize transition-all flex flex-col items-center gap-1 ${
                        layoutForm.orientation === o
                          ? 'bg-white/20 border border-white/40 text-white'
                          : 'glass-panel text-white/50'
                      }`}
                    >
                      {o === 'auto' && (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                      )}
                      {o === 'portrait' && (
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                        </svg>
                      )}
                      {o === 'landscape' && (
                        <svg className="w-5 h-5 rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
                        </svg>
                      )}
                      {o}
                    </button>
                  ))}
                </div>
              </div>

              {/* Safe area vs Full area */}
              <div>
                <label className="block text-xs text-white/50 mb-2">Screen Area</label>
                <div className="flex gap-2">
                  {(['safe', 'full'] as const).map((a) => (
                    <button
                      key={a}
                      onClick={() => setLayoutForm((prev) => ({ ...prev, area: a }))}
                      className={`flex-1 py-3 rounded-xl text-sm font-medium transition-all flex flex-col items-center gap-1 ${
                        layoutForm.area === a
                          ? 'bg-white/20 border border-white/40 text-white'
                          : 'glass-panel text-white/50'
                      }`}
                    >
                      {a === 'safe' ? 'Safe Area' : 'Full Screen'}
                      <span className="text-[10px] opacity-60">
                        {a === 'safe' ? 'Respect notch/edges' : 'Edge to edge'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Preview */}
              <div className="glass-panel p-4 rounded-xl">
                <p className="text-xs text-white/40 mb-2 text-center">Preview</p>
                <div
                  className="mx-auto border border-white/20 rounded-lg overflow-hidden"
                  style={{
                    width: layoutForm.orientation === 'landscape' ? '100%' : '50%',
                    aspectRatio: layoutForm.orientation === 'landscape' ? '16/9' : layoutForm.orientation === 'portrait' ? '9/16' : 'auto',
                    maxHeight: '120px',
                  }}
                >
                  <div
                    className="w-full h-full flex items-center justify-center text-xs text-white/40"
                    style={{
                      background: 'linear-gradient(135deg, #1a1a2e, #0f3460)',
                      padding: layoutForm.area === 'safe' ? '8px' : '2px',
                    }}
                  >
                    <div className="w-full h-full border border-dashed border-white/20 rounded flex items-center justify-center">
                      Grid
                    </div>
                  </div>
                </div>
              </div>

              <button
                onClick={() => onUpdateLayout(layoutForm)}
                className="w-full py-3 rounded-xl font-semibold text-white"
                style={{ background: 'rgba(255,255,255,0.2)', backdropFilter: 'blur(12px) saturate(150%)', WebkitBackdropFilter: 'blur(12px) saturate(150%)', border: '1px solid rgba(255,255,255,0.3)' }}
              >
                Apply Layout
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
