import { useState, useCallback, useEffect } from 'react';
import { useWebSocket } from './state/useWebSocket';
import { DeckGrid } from './components/DeckGrid';
import { PageNav } from './components/PageNav';
import { SettingsPanel } from './components/SettingsPanel';
import { PairingScreen } from './components/PairingScreen';
import { ConnectionIndicator } from './components/ConnectionIndicator';
import { useTranslation } from './i18n';
import toast, { Toaster } from 'react-hot-toast';
import type { Button, LayoutPreference } from '@shared/protocol';

export function App() {
  const { t } = useTranslation();
  const {
    connectionState,
    isInitialized,
    config,
    connect,
    disconnect,
    sendMessage,
    triggerButton,
  } = useWebSocket();

  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [showSettings, setShowSettings] = useState(false);
  const [editingButton, setEditingButton] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [deviceIsLandscape, setDeviceIsLandscape] = useState(() => window.matchMedia('(orientation: landscape)').matches);
  const [viewport, setViewport] = useState(() => ({
    width: window.innerWidth,
    height: window.innerHeight,
  }));
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
      width: `${viewport.height}px`,
      height: `${viewport.width}px`,
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

  useEffect(() => {
    const handleResize = () => {
      setViewport({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };
    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
    };
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

  const handleSaveButton = useCallback((pageId: string, button: any) => {
    sendMessage({
      type: 'button_update',
      pageId,
      button: { ...button, id: button.id || `btn_${Date.now()}` },
    });
    setShowSettings(false);
    setEditingButton(null);
  }, [sendMessage]);

  const handleDeleteButton = useCallback((pageId: string, buttonId: string) => {
    sendMessage({ type: 'button_delete', pageId, buttonId });
    setShowSettings(false);
    setEditingButton(null);
  }, [sendMessage]);

  const handleUpdateBackground = useCallback((pageId: string, background: any) => {
    sendMessage({ type: 'background_update', pageId, background });
  }, [sendMessage]);

  const handleUpdateGrid = useCallback((pageId: string, grid: any) => {
    sendMessage({ type: 'grid_update', pageId, grid });
  }, [sendMessage]);

  const handleReorder = useCallback((buttons: Button[]) => {
    if (!currentPage) return;
    buttons.forEach((btn) => {
      sendMessage({ type: 'button_update', pageId: currentPage.id, button: btn });
    });
  }, [currentPage, sendMessage]);

  const handleUpdateLayout = useCallback((layoutPref: LayoutPreference) => {
    setTimeout(() => {
      sendMessage({ type: 'layout_update', layoutPreference: layoutPref });
      toast.success('Layout updated');
    }, 200);
  }, [sendMessage]);

  const handleAddPage = useCallback(() => {
    const newPage = {
      id: `p_${Date.now()}`,
      name: `Page ${config.pages.length + 1}`,
      grid: { cols: 4, rows: 5 },
      background: { type: 'gradient' as const, value: 'linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%)' },
      buttons: [],
    };
    sendMessage({ type: 'page_update', page: newPage });
    setCurrentPageIndex(config.pages.length);
  }, [config.pages.length, sendMessage]);

  const handleDeletePage = useCallback(() => {
    if (config.pages.length <= 1) {
      toast.error('Cannot delete the only page');
      return;
    }
    sendMessage({ type: 'page_delete', pageId: currentPage!.id });
    setCurrentPageIndex(Math.max(0, currentPageIndex - 1));
  }, [config.pages.length, currentPage, currentPageIndex, sendMessage]);

  if (!isInitialized || connectionState === 'disconnected') {
    return <PairingScreen onConnect={connect} isConnecting={connectionState === 'connecting'} isLoading={!isInitialized} />;
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
        <ConnectionIndicator state={connectionState} />
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
