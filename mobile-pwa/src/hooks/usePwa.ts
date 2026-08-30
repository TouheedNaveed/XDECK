import { useState, useEffect, useCallback } from 'react';

export function usePwa() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [canInstall, setCanInstall] = useState(false);
  const [showUpdate, setShowUpdate] = useState(false);

  // Capture install prompt
  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setCanInstall(true);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  useEffect(() => {
    const handler = () => { setDeferredPrompt(null); setCanInstall(false); };
    window.addEventListener('appinstalled', handler);
    return () => window.removeEventListener('appinstalled', handler);
  }, []);

  // Detect service worker updates
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    function checkWaiting(swreg: ServiceWorkerRegistration) {
      if (swreg.waiting && navigator.serviceWorker.controller) {
        setShowUpdate(true);
      }
    }

    let polling: ReturnType<typeof setInterval>;

    navigator.serviceWorker.getRegistration().then((reg) => {
      if (!reg) return;

      // Check immediately
      checkWaiting(reg);

      // Listen for new SW installing
      reg.addEventListener('updatefound', () => {
        const sw = reg.installing;
        if (!sw) return;
        sw.addEventListener('statechange', () => {
          if (sw.state === 'installed' && navigator.serviceWorker.controller) {
            setShowUpdate(true);
          }
        });
      });

      // Also poll for updates every 30 seconds
      polling = setInterval(() => {
        reg.update().then(() => {
          checkWaiting(reg);
        }).catch(() => {});
      }, 30000);
    });

    // When new SW takes over, reload
    let reloading = false;
    const onControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);

    return () => {
      if (polling) clearInterval(polling);
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
    };
  }, []);

  const install = useCallback(async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    setDeferredPrompt(null);
    setCanInstall(false);
  }, [deferredPrompt]);

  const reload = useCallback(() => {
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (reg?.waiting) {
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      }
    });
  }, []);

  return { canInstall, showUpdate, install, reload };
}
