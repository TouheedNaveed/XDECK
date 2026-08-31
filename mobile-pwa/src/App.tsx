import { useState, useCallback, useEffect } from 'react';
import { useWebSocket } from './state/useWebSocket';
import { DeckGrid } from './components/DeckGrid';
import { PageNav } from './components/PageNav';
import { SettingsPanel } from './components/SettingsPanel';
import { PairingScreen } from './components/PairingScreen';
import { ConnectionIndicator } from './components/ConnectionIndicator';
import { useTranslation } from './i18n';
import toast, { Toaster } from 'react-hot-toast';
import type { Button, LayoutPreference, WSMessage, DeckConfig } from '@shared/protocol';
import { playTapSound } from './utils/audio';

export function App() {
  const { t } = useTranslation();
  const {
    connectionState,
    isLive,
    lastError,
    isInitialized,
    config,
    connect,
    disconnect,
    sendMessage,
    updateConfig,
    triggerButton,
  } = useWebSocket();

  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [editingButton, setEditingButton] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [deviceIsLandscape, setDeviceIsLandscape] = useState(() => window.matchMedia('(orientation: landscape)').matches);

  const [triggerResults, setTriggerResults] = useState<Map<string, { ok: boolean; time: number }>>(new Map());
  const [previewBg, setPreviewBg] = useState<import('@shared/protocol').Background | null>(null);
  const [previewGrid, setPreviewGrid] = useState<import('@shared/protocol').GridConfig | null>(null);

  const currentPage = config.pages[currentPageIndex];
  const layout = config.layoutPreference || { orientation: 'auto', area: 'safe' };
  const targetOrientation = layout.orientation;

  const isLandscape = targetOrientation === 'auto'
    ? deviceIsLandscape
    : targetOrientation === 'landscape';

  const isRotated = targetOrientation !== 'auto' && (
    (targetOrientation === 'landscape' && !deviceIsLandscape) ||
    (targetOrientation === 'portrait' && deviceIsLandscape)
  );

  const isFull = layout.area === 'full';

  let containerStyle: React.CSSProperties = {};
  let contentPadding: React.CSSProperties = {};

  if (isRotated) {
    containerStyle = {
      position: 'fixed',
      top: '50%',
      left: '50%',
      width: '100vh',
      height: '100vw',
      transform: 'translate(-50%, -50%) rotate(90deg)',
      overflow: 'hidden',
    };

    contentPadding = {
      paddingTop: isFull ? 0 : 'var(--safe-left)',      // Visual Top = Physical Left
      paddingRight: isFull ? 0 : 'var(--safe-bottom)',  // Visual Right = Physical Bottom
      paddingBottom: isFull ? 0 : 'var(--safe-right)',  // Visual Bottom = Physical Right
      paddingLeft: isFull ? 0 : 'var(--safe-top)',     // Visual Left = Physical Top
    };
  } else {
    containerStyle = {
      position: 'fixed',
      inset: 0,
      width: '100%',
      height: '100%',
    };

    contentPadding = {
      paddingTop: isFull ? 0 : 'var(--safe-top)',
      paddingBottom: isFull ? 0 : 'var(--safe-bottom)',
      paddingLeft: isFull ? 0 : 'var(--safe-left)',
      paddingRight: isFull ? 0 : 'var(--safe-right)',
    };
  }

  useEffect(() => {
    if (!currentPage) return;
    const bgData = previewBg || currentPage.background;
    document.body.classList.add('xdeck-bg-dynamic');
    const bg =
      bgData.type === 'gradient'
        ? bgData.value
        : bgData.type === 'image'
        ? `url(${bgData.value}) center/cover`
        : bgData.value;
    document.body.style.background = bg;
    document.documentElement.style.background = bg;
    const root = document.getElementById('root');
    if (root) root.style.background = bg;
    return () => {
      document.body.style.background = '';
      document.documentElement.style.background = '';
      if (root) root.style.background = '';
      document.body.classList.remove('xdeck-bg-dynamic');
    };
  }, [currentPage?.background, previewBg]);

  useEffect(() => {
    const mq = window.matchMedia('(orientation: landscape)');
    const handler = (e: MediaQueryListEvent) => setDeviceIsLandscape(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);



  // Handle Fullscreen mode dynamically
  useEffect(() => {
    if (!isInitialized) return;
    const isFullArea = layout.area === 'full';
    const isCurrentFull = !!document.fullscreenElement;

    if (isFullArea && !isCurrentFull) {
      const requestFS = () => {
        try {
          if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen().catch(() => {});
          }
        } catch {}
      };
      requestFS();
      const triggerOnGesture = () => {
        requestFS();
        document.removeEventListener('click', triggerOnGesture);
        document.removeEventListener('touchstart', triggerOnGesture);
      };
      document.addEventListener('click', triggerOnGesture);
      document.addEventListener('touchstart', triggerOnGesture);
      return () => {
        document.removeEventListener('click', triggerOnGesture);
        document.removeEventListener('touchstart', triggerOnGesture);
      };
    } else if (!isFullArea && isCurrentFull) {
      try {
        document.exitFullscreen().catch(() => {});
      } catch {}
    }
  }, [layout.area, isInitialized]);

  // Handle Hardware Screen Orientation lock dynamically
  useEffect(() => {
    if (!isInitialized) return;
    const orient = layout.orientation;

    if (orient === 'auto') {
      try {
        if (screen.orientation && 'unlock' in screen.orientation) {
          (screen.orientation as any).unlock();
        }
      } catch (err) {
        console.warn('Failed to unlock screen orientation:', err);
      }
    } else {
      const lockType = orient === 'portrait' ? 'portrait' : 'landscape';
      if (screen.orientation && 'lock' in screen.orientation) {
        const performLock = () => {
          (screen.orientation as any).lock(lockType).catch((err: any) => {
            console.warn('Orientation lock failed (will fallback to CSS rotation):', err);
          });
        };

        performLock();

        const lockOnGesture = () => {
          performLock();
          document.removeEventListener('click', lockOnGesture);
          document.removeEventListener('touchstart', lockOnGesture);
        };
        document.addEventListener('click', lockOnGesture);
        document.addEventListener('touchstart', lockOnGesture);
        return () => {
          document.removeEventListener('click', lockOnGesture);
          document.removeEventListener('touchstart', lockOnGesture);
        };
      }
    }
  }, [layout.orientation, isInitialized]);

  const handlePageChange = useCallback((index: number) => {
    setCurrentPageIndex(index);
  }, []);

  const handleTrigger = useCallback(async (buttonId: string) => {
    if (editMode) return;

    try {
      const soundEnabled = localStorage.getItem('xdeck-tap-sound-enabled') !== 'false';
      if (soundEnabled) {
        const volumeVal = localStorage.getItem('xdeck-tap-sound-volume');
        const volume = volumeVal ? parseInt(volumeVal) : 50;
        playTapSound(volume);
      }
    } catch (e) {}

    const ok = await triggerButton(buttonId);
    setTriggerResults((prev) => {
      const next = new Map(prev);
      next.set(buttonId, { ok, time: Date.now() });
      return next;
    });
    // Clear the indicator after 3 seconds
    setTimeout(() => {
      setTriggerResults((prev) => {
        const next = new Map(prev);
        const entry = next.get(buttonId);
        if (entry && Date.now() - entry.time >= 2900) {
          next.delete(buttonId);
        }
        return next;
      });
    }, 3100);
    if (ok) {
      toast.success(t('toast.triggered'), { duration: 1000 });
    } else {
      toast.error(t('toast.trigger_failed'), { duration: 1500 });
    }
  }, [triggerButton, editMode, t]);

  const handleAddButton = useCallback(() => {
    setEditingButton('new');
    setShowSettings(true);
  }, []);

  const handleEditButton = useCallback((buttonId: string) => {
    setEditingButton(buttonId);
    setShowSettings(true);
  }, []);

  /**
   * Every config change goes through here. The desktop owns the config, so a change
   * we can't deliver must not be shown as applied — that mismatch is what makes the
   * app look like it "did nothing" while still flashing a success toast.
   */
  const commit = useCallback((
    msg: WSMessage,
    optimistic: (c: DeckConfig) => DeckConfig,
    successText?: string,
  ): boolean => {
    if (!isLive || !sendMessage(msg)) {
      toast.error(
        connectionState === 'waiting'
          ? 'Desktop is offline — change not saved'
          : 'Not connected — change not saved',
        { duration: 2500 },
      );
      return false;
    }
    updateConfig(optimistic);
    if (successText) toast.success(successText, { duration: 1200 });
    return true;
  }, [isLive, connectionState, sendMessage, updateConfig]);

  const handleSaveButton = useCallback((pageId: string, button: any) => {
    const btn = { ...button, id: button.id || `btn_${Date.now()}` };
    const ok = commit({ type: 'button_update', pageId, button: btn }, (c) => ({
      ...c,
      pages: c.pages.map((p) => {
        if (p.id !== pageId) return p;
        const idx = p.buttons.findIndex((b) => b.id === btn.id);
        const buttons = [...p.buttons];
        if (idx >= 0) buttons[idx] = btn; else buttons.push(btn);
        return { ...p, buttons };
      }),
    }));
    if (!ok) return;
    setShowSettings(false);
    setEditingButton(null);
  }, [commit]);

  const handleDeleteButton = useCallback((pageId: string, buttonId: string) => {
    const ok = commit({ type: 'button_delete', pageId, buttonId }, (c) => ({
      ...c,
      pages: c.pages.map((p) => p.id !== pageId ? p : { ...p, buttons: p.buttons.filter((b) => b.id !== buttonId) }),
    }));
    if (!ok) return;
    setShowSettings(false);
    setEditingButton(null);
  }, [commit]);

  const handleUpdatePageProperties = useCallback((pageId: string, background: any, name: string, textColor: string) => {
    const nextPages = config.pages.map((p) => p.id !== pageId ? p : { ...p, background, name, textColor });
    commit({ type: 'config_sync', pages: nextPages, layoutPreference: layout }, (c) => ({
      ...c,
      pages: nextPages,
    }), 'Page properties updated');
  }, [config.pages, layout, commit]);

  const handleUpdateBackground = useCallback((pageId: string, background: any) => {
    const pageObj = config.pages.find((p) => p.id === pageId);
    handleUpdatePageProperties(pageId, background, pageObj?.name || 'Main', pageObj?.textColor || '#ffffff');
  }, [config.pages, handleUpdatePageProperties]);

  const handleUpdateGrid = useCallback((pageId: string, grid: any) => {
    commit({ type: 'grid_update', pageId, grid }, (c) => ({
      ...c,
      pages: c.pages.map((p) => p.id !== pageId ? p : { ...p, grid }),
    }), 'Grid updated');
  }, [commit]);

  const handleReorder = useCallback((buttons: Button[]) => {
    if (!currentPage) return;
    if (!isLive) {
      toast.error('Not connected — layout not saved', { duration: 2500 });
      return;
    }
    updateConfig((c) => ({
      ...c,
      pages: c.pages.map((p) => p.id !== currentPage.id ? p : { ...p, buttons }),
    }));
    buttons.forEach((btn) => {
      sendMessage({ type: 'button_update', pageId: currentPage.id, button: btn });
    });
  }, [currentPage, isLive, sendMessage, updateConfig]);

  const handleUpdateLayout = useCallback((layoutPref: LayoutPreference) => {
    commit(
      { type: 'layout_update', layoutPreference: layoutPref },
      (c) => ({ ...c, layoutPreference: layoutPref }),
      'Layout updated',
    );
  }, [commit]);

  const handleAddPage = useCallback(() => {
    const newPage = {
      id: `p_${Date.now()}`,
      name: `Page ${config.pages.length + 1}`,
      grid: { cols: 4, rows: 5 },
      background: { type: 'gradient' as const, value: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)' },
      buttons: [],
    };
    if (commit({ type: 'page_update', page: newPage }, (c) => ({ ...c, pages: [...c.pages, newPage] }))) {
      setCurrentPageIndex(config.pages.length);
    }
  }, [config.pages.length, commit]);

  const handleDeletePage = useCallback(() => {
    if (config.pages.length <= 1) {
      toast.error('Cannot delete the only page');
      return;
    }
    const ok = commit({ type: 'page_delete', pageId: currentPage!.id }, (c) => ({
      ...c,
      pages: c.pages.filter((p) => p.id !== currentPage!.id),
    }));
    if (ok) setCurrentPageIndex(Math.max(0, currentPageIndex - 1));
  }, [config.pages.length, currentPage, currentPageIndex, commit]);

  // Surface connection problems once, rather than silently looping.
  useEffect(() => {
    if (lastError) toast.error(lastError, { duration: 6000, id: 'xdeck-conn-error' });
  }, [lastError]);

  if (!isInitialized || connectionState === 'disconnected' || connectionState === 'error') {
    return (
      <PairingScreen
        onConnect={connect}
        isConnecting={connectionState === 'connecting'}
        isLoading={!isInitialized}
        error={connectionState === 'error' ? lastError : null}
      />
    );
  }

  return (
    <div className="w-full h-full relative overflow-hidden" style={containerStyle}>
      {/* Background — fills entire viewport behind safe area */}
      {currentPage && (
        <div
          className="absolute inset-0 z-0"
          style={{
            background: currentPage.background.type === 'gradient'
              ? currentPage.background.value
              : currentPage.background.type === 'image'
              ? `url(${currentPage.background.value}) center/cover`
              : currentPage.background.value,
          }}
        />
      )}

      <div
        className="w-full h-full flex flex-col overflow-hidden relative z-10"
        style={contentPadding}
      >
      <Toaster
        position="top-center"
        toastOptions={{
          className: 'glass-panel',
          style: {
            background: 'rgba(255,255,255,0.1)',
            color: '#e0e7ff',
            backdropFilter: 'blur(16px)',
          },
        }}
      />

      {/* Header */}
      <header className="relative z-10 flex items-center justify-between px-4 py-2 shrink-0">
        <div className="flex items-center gap-2">
          <ConnectionIndicator state={connectionState} />
          <span className="text-[9px] text-white/20 font-mono">v1.1.8</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setEditMode(!editMode)}
            className={`px-3 py-1.5 text-xs font-medium rounded-xl transition-all ${
              editMode
                ? 'bg-white/20 border border-white/30 text-white'
                : 'glass-panel opacity-70 hover:opacity-100'
            }`}
          >
            {editMode ? 'Done' : 'Edit'}
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="glass-panel px-3 py-1.5 text-xs font-medium opacity-70 hover:opacity-100 transition-opacity"
          >
            Settings
          </button>
          <button
            onClick={disconnect}
            className="glass-panel px-3 py-1.5 text-xs font-medium opacity-50 hover:opacity-100 transition-opacity text-red-400"
            title="Sign out"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
          </button>
        </div>
      </header>

      {/* Grid — fills ALL remaining space */}
      <main className="relative z-10 flex-1 overflow-hidden" style={{ minHeight: 0 }}>
        {currentPage && (
          <DeckGrid
            page={currentPage}
            onTrigger={handleTrigger}
            onEditButton={handleEditButton}
            onAddButton={handleAddButton}
            onReorder={handleReorder}
            editMode={editMode}
            isLandscape={isLandscape}
            triggerResults={triggerResults}
            previewGrid={previewGrid}
          />
        )}
      </main>

      {/* Navigation */}
      <footer className="relative z-10 pb-2 pt-1 shrink-0">
        <PageNav
          pages={config.pages}
          currentPageIndex={currentPageIndex}
          onPageChange={handlePageChange}
          onAddPage={handleAddPage}
          onDeletePage={handleDeletePage}
          canDeletePages={config.pages.length > 1}
        />
      </footer>
      </div>

      {/* Settings panel */}
      {showSettings && currentPage && (
        <SettingsPanel
          page={currentPage}
          editingButtonId={editingButton}
          layoutPreference={layout}
          isRotated={isRotated}
          onSaveButton={handleSaveButton}
          onDeleteButton={handleDeleteButton}
          onUpdateBackground={handleUpdateBackground}
          onUpdatePageProperties={handleUpdatePageProperties}
          onUpdateGrid={handleUpdateGrid}
          onUpdateLayout={handleUpdateLayout}
          onPreviewBackground={setPreviewBg}
          onPreviewGrid={setPreviewGrid}
          onClose={() => {
            setShowSettings(false);
            setEditingButton(null);
          }}
        />
      )}
    </div>
  );
}
