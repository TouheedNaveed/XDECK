import { useState, useCallback, useEffect, useRef } from 'react';
import { store, type ConnectionInfo } from '../state/store';
import jsQR from 'jsqr';
import { useTranslation, type Locale } from '../i18n';
import { usePwa } from '../hooks/usePwa';

interface PairingScreenProps {
  onConnect: (info: ConnectionInfo) => void;
  isConnecting: boolean;
  isLoading: boolean;
  /** Unrecoverable connection failure from the last attempt, if any. */
  error?: string | null;
}

export function PairingScreen({ onConnect, isConnecting, isLoading, error: connectionError }: PairingScreenProps) {
  const { t, locale, setLocale } = useTranslation();
  const { canInstall, showUpdate, install, reload, isIOS, canShowManualInstall } = usePwa();
  const [ip, setIp] = useState('');
  const [port, setPort] = useState('8787');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState('');
  const [discovered, setDiscovered] = useState<ConnectionInfo | null>(null);
  const [qrActive, setQrActive] = useState(false);
  const [qrError, setQrError] = useState('');
  // Cloud mode is the only one that can work from an https origin (a browser blocks
  // ws:// to a LAN address from a secure page), so default to it there.
  const [connectMode, setConnectMode] = useState<'lan' | 'relay'>(
    location.protocol === 'https:' && location.hostname !== 'localhost' ? 'relay' : 'lan'
  );
  const [licenseKey, setLicenseKey] = useState('');
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number>(0);

  // ws:// to a LAN IP is blocked from an https page, and the hosted PWA is https.
  const lanUnavailable = location.protocol === 'https:' && location.hostname !== 'localhost' && !discovered;

  useEffect(() => {
    if (connectionError) setError(connectionError);
  }, [connectionError]);

  // Auto-connect when opened via QR code URL: http://desktop-ip:8787?code=123456
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const urlCode = params.get('code');
    if (urlCode && (location.protocol === 'http:' || location.hostname === 'localhost')) {
      const info: ConnectionInfo = {
        ip: location.hostname,
        port: parseInt(location.port) || 8787,
        code: urlCode,
        mode: 'lan',
      };
      store.saveConnection(info);
      onConnect(info);
    }
  }, [onConnect]);

  useEffect(() => {
    store.getConnection().then((conn) => {
      if (conn?.mode === 'relay' && conn.licenseKey) {
        setConnectMode('relay');
        setLicenseKey(conn.licenseKey);
      }
    });
  }, []);

  // Clear error when switching tabs
  useEffect(() => {
    setError('');
  }, [connectMode]);

  const stopQrScanner = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setQrActive(false);
  }, []);

  const startQrScan = useCallback(async () => {
    setQrError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setQrError('Camera requires HTTPS. Make sure you are accessing via https://');
      return;
    }
    setQrActive(true);
  }, []);

  // Live camera scan loop
  useEffect(() => {
    if (!qrActive) return;
    let active = true;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        if (!active) { stream.getTracks().forEach(t => t.stop()); return; }
        streamRef.current = stream;

        // Wait a tick for the video element to mount
        await new Promise(r => setTimeout(r, 100));

        const video = videoRef.current;
        if (!video || !active) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        video.srcObject = stream;
        video.setAttribute('playsinline', 'true');
        await video.play();

        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;

        const scan = () => {
          if (!active || video.readyState < video.HAVE_ENOUGH_DATA) {
            if (active) rafRef.current = requestAnimationFrame(scan);
            return;
          }

          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

          const code = jsQR(imageData.data, imageData.width, imageData.height, {
            inversionAttempts: 'dontInvert',
          });

          if (code) {
            // Try URL format first: http://192.168.x.x:8787?code=123456
            try {
              const url = new URL(code.data);
              if (url.hostname && (url.port || url.protocol === 'http:')) {
                const scannedCode = url.searchParams.get('code') || '';
                // If currently on HTTPS (pages.dev PWA), redirect to desktop-served PWA
                if (location.protocol === 'https:' && location.hostname !== url.hostname) {
                  active = false;
                  stream.getTracks().forEach(t => t.stop());
                  setQrActive(false);
                  window.location.href = code.data;
                  return;
                }
                setIp(url.hostname);
                setPort(url.port || '8787');
                setCode(scannedCode);
                active = false;
                stream.getTracks().forEach(t => t.stop());
                setQrActive(false);
                return;
              }
            } catch {
              // Not a URL, try JSON format (legacy)
              try {
                const data = JSON.parse(code.data);
                if (data.ip) {
                  setIp(data.ip);
                  setPort(String(data.port || 8787));
                  setCode(String(data.code || ''));
                  active = false;
                  stream.getTracks().forEach(t => t.stop());
                  setQrActive(false);
                  return;
                }
              } catch {}
            }
          }

          if (active) rafRef.current = requestAnimationFrame(scan);
        };
        rafRef.current = requestAnimationFrame(scan);
      } catch (err) {
        if (active) {
          setQrError('Camera access denied or unavailable');
          setQrActive(false);
        }
      }
    })();

    return () => {
      active = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(t => t.stop());
        streamRef.current = null;
      }
    };
  }, [qrActive]);

  // Auto-discover on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setScanning(true);

      // If served from the desktop server itself (http://desktop-ip:8787) or a local dev server,
      // try fetching /pairing from same origin. Skip when on Cloudflare Pages (xdeck-pwa.pages.dev).
      const isLocalOrigin = location.hostname === 'localhost'
        || location.hostname === '127.0.0.1'
        || location.hostname.match(/^192\.168\./)
        || location.hostname.match(/^10\./)
        || location.hostname.match(/^172\.(1[6-9]|2\d|3[01])\./);

      if (isLocalOrigin) {
        setScanProgress('Connecting via local server...');
        try {
          const res = await fetch('/pairing', { signal: AbortSignal.timeout(2000) });
          if (res.ok) {
            const data = await res.json();
            if (!cancelled) {
              const detectedPort = parseInt(location.port) || 8787;
              setDiscovered({ ip: location.hostname, port: detectedPort, code: data.code, mode: 'lan' });
              setIp(location.hostname);
              setPort(String(detectedPort));
              setScanProgress(`Found XDECK at ${location.hostname}!`);
              setScanning(false);
            }
            return;
          }
        } catch {}
      }

      // Fallback: scan network for direct HTTP connections. Pointless from an https
      // origin — the browser blocks every http request as mixed content — so skip it
      // rather than firing 254 doomed fetches.
      if (location.protocol === 'https:') {
        if (!cancelled) {
          setScanning(false);
          setScanProgress('');
        }
        return;
      }

      setScanProgress('Scanning network...');

      try {
        const pc = new RTCPeerConnection({ iceServers: [] });
        pc.createDataChannel('');
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        const localIp = await new Promise<string>((resolve) => {
          let found = false;
          pc.onicecandidate = (e) => {
            if (found || !e.candidate?.candidate) return;
            const match = e.candidate.candidate.match(/(\d+\.\d+\.\d+\.\d+)/);
            if (match) { found = true; resolve(match[1]); pc.close(); }
          };
          setTimeout(() => { if (!found) { resolve(''); pc.close(); } }, 2000);
        });

        if (cancelled) return;

        if (localIp) {
          const parts = localIp.split('.');
          const subnet = `${parts[0]}.${parts[1]}.${parts[2]}`;
          setScanProgress(`Found subnet ${subnet}.0/24, scanning...`);

          const batchSize = 20;
          for (let start = 1; start <= 254 && !cancelled; start += batchSize) {
            const batch = Array.from({ length: batchSize }, (_, i) => start + i)
              .filter((i) => i <= 254);

            const results = await Promise.allSettled(
              batch.map(async (i) => {
                const testIp = `${subnet}.${i}`;
                try {
                  const res = await fetch(`http://${testIp}:8787/pairing`, {
                    signal: AbortSignal.timeout(400),
                  });
                  if (res.ok) {
                    const data = await res.json();
                    return { ip: testIp, port: 8787, code: data.code, mode: 'lan' as const } as ConnectionInfo;
                  }
                } catch {}
                return null;
              })
            );

            const found = results.find((r) => r.status === 'fulfilled' && r.value)?.status === 'fulfilled'
              ? (results.find((r) => r.status === 'fulfilled' && r.value) as PromiseFulfilledResult<ConnectionInfo>).value
              : null;

            if (found && !cancelled) {
              setDiscovered(found);
              setIp(found.ip);
              setScanProgress(`Found XDECK at ${found.ip}!`);
              setScanning(false);
              return;
            }
          }
        }
      } catch {}

      if (!cancelled) {
        setScanProgress('No server found. Enter IP manually.');
        setScanning(false);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!ip.trim()) {
      setError('Please enter the desktop app IP address');
      return;
    }

    const connectionInfo: ConnectionInfo = {
      ip: ip.trim(),
      port: parseInt(port) || 8787,
      code: code.trim(),
      mode: 'lan',
    };

    await store.saveConnection(connectionInfo);
    onConnect(connectionInfo);
  }, [ip, port, code, onConnect]);

  if (isLoading) {
    return (
      <div className="h-full w-full flex items-center justify-center p-6">
        <div className="text-center">
          <div className="w-20 h-20 mx-auto mb-4 rounded-2xl overflow-hidden shadow-lg shadow-purple-500/20">
            <img src="/logo.png" alt="XDECK" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent mb-4">
            XDECK
          </h1>
          <div className="flex items-center justify-center gap-2 text-sm text-white/50">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            Checking for saved connection...
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full flex items-center justify-center p-6 overflow-y-auto">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-6">
          <div className="w-20 h-20 mx-auto mb-4 rounded-2xl overflow-hidden shadow-lg shadow-purple-500/20">
            <img src="/logo.png" alt="XDECK" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-2xl font-bold bg-gradient-to-r from-indigo-400 via-purple-400 to-pink-400 bg-clip-text text-transparent">
            XDECK
          </h1>
          <p className="text-sm text-white/40 mt-1">
            {isConnecting ? t('pairing.connecting') : t('pairing.subtitle')}
          </p>
          <div className="flex items-center justify-center gap-1 mt-2">
            {(['en', 'es'] as Locale[]).map((l) => (
              <button
                key={l}
                onClick={() => setLocale(l)}
                className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                  locale === l ? 'bg-white/15 text-white' : 'text-white/30'
                }`}
              >
                {l.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        {/* Live QR Scanner */}
        {qrActive && (
          <div className="fixed inset-0 z-50 bg-black flex flex-col">
            <div className="relative flex-1 flex items-center justify-center overflow-hidden">
              <video
                ref={videoRef}
                className="absolute inset-0 w-full h-full object-cover"
                playsInline
                muted
                autoPlay
              />
              <canvas ref={canvasRef} className="hidden" />
              {/* Scanning overlay */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-64 h-64 relative">
                  <div className="absolute inset-0 border-2 border-white/60 rounded-2xl" />
                  <div className="absolute top-0 left-0 w-8 h-8 border-t-4 border-l-4 border-purple-400 rounded-tl-2xl" />
                  <div className="absolute top-0 right-0 w-8 h-8 border-t-4 border-r-4 border-purple-400 rounded-tr-2xl" />
                  <div className="absolute bottom-0 left-0 w-8 h-8 border-b-4 border-l-4 border-purple-400 rounded-bl-2xl" />
                  <div className="absolute bottom-0 right-0 w-8 h-8 border-b-4 border-r-4 border-purple-400 rounded-br-2xl" />
                  <div className="absolute top-1/2 left-0 right-0 h-0.5 bg-purple-400/60 scan-line" />
                </div>
              </div>
            </div>
            <div className="p-6 text-center bg-black/80">
              <p className="text-white/70 text-sm mb-4">Point at the QR code on your desktop</p>
              <button
                onClick={stopQrScanner}
                className="px-6 py-3 rounded-xl bg-white/15 text-white font-medium text-sm"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {qrError && (
          <p className="text-xs text-red-400 text-center mb-3">{qrError}</p>
        )}

        {/* Scan QR button */}
        {!qrActive && !discovered && (
          <button
            onClick={() => startQrScan()}
            className="w-full glass-panel px-4 py-3 mb-4 flex items-center gap-3 hover:bg-white/10 transition-colors"
          >
            <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
              </svg>
            </div>
            <div className="text-left flex-1">
              <p className="text-sm font-semibold text-white">Scan QR Code</p>
              <p className="text-xs text-white/40">Point camera at desktop screen</p>
            </div>
            <svg className="w-4 h-4 text-white/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        )}

        {/* Scan status */}
        {scanning && (
          <div className="glass-panel px-4 py-3 mb-4 text-center">
            <div className="flex items-center justify-center gap-2 text-sm text-white/60">
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
              {scanProgress}
            </div>
          </div>
        )}

        {/* Discovered server */}
        {discovered && !scanning && (
          <button
            onClick={() => {
              store.saveConnection(discovered);
              onConnect(discovered);
            }}
            disabled={isConnecting}
            className="w-full glass-panel px-4 py-3 mb-4 flex items-center gap-3 hover:bg-white/10 transition-colors disabled:opacity-50"
          >
            <div className="w-10 h-10 rounded-xl bg-green-500/20 flex items-center justify-center">
              <svg className="w-5 h-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div className="text-left flex-1">
              <p className="text-sm font-semibold text-white">XDECK Desktop</p>
              <p className="text-xs text-white/40 font-mono">{discovered.ip}:{discovered.port}</p>
            </div>
            <span className="text-xs text-purple-400 font-medium">
              {isConnecting ? t('pairing.connecting') : 'Tap to connect'}
            </span>
          </button>
        )}

        {/* Connect Mode Toggle */}
        <div className="flex rounded-2xl glass-panel p-1 mb-4">
          <button
            onClick={() => setConnectMode('lan')}
            className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all ${
              connectMode === 'lan' ? 'bg-white/15 text-white' : 'text-white/40'
            }`}
          >
            Local Network
          </button>
          <button
            onClick={() => setConnectMode('relay')}
            className={`flex-1 py-2.5 rounded-xl text-sm font-medium transition-all ${
              connectMode === 'relay' ? 'bg-white/15 text-white' : 'text-white/40'
            }`}
          >
            Cloud
          </button>
        </div>

        {connectMode === 'lan' && lanUnavailable && (
          <div className="glass-panel px-4 py-3 mb-4 border border-amber-500/30">
            <p className="text-xs text-amber-300/90 leading-relaxed">
              {ip
                ? <>Open <code className="bg-white/10 px-1 rounded">http://{ip}:{port || '8787'}</code> on this phone for local control.</>
                : <>Blocked by browser security. Switch to <strong>Cloud</strong>, or open XDECK from your desktop's address.</>
              }
            </p>
          </div>
        )}

        {connectMode === 'relay' ? (
          <form onSubmit={(e) => {
            e.preventDefault();
            setError('');
            if (!licenseKey.trim()) {
              setError('Please enter your license key');
              return;
            }
            const connectionInfo: ConnectionInfo = {
              ip: '',
              port: 0,
              code: '',
              mode: 'relay',
              licenseKey: licenseKey.trim(),
            };
            store.saveConnection(connectionInfo);
            onConnect(connectionInfo);
          }} className="space-y-3">
            <div>
              <label className="block text-xs text-white/50 mb-1.5">License Key</label>
              <input
                type="text"
                value={licenseKey}
                onChange={(e) => {
                  const val = e.target.value;
                  const clean = val.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 21);
                  let raw = clean;
                  if (raw.length > 0 && !raw.startsWith('XDECK')) {
                    if (raw.length <= 16) {
                      raw = 'XDECK' + raw;
                    }
                  }
                  let formatted = '';
                  if (raw.length > 0) formatted += raw.slice(0, 5);
                  if (raw.length > 5) formatted += '-' + raw.slice(5, 9);
                  if (raw.length > 9) formatted += '-' + raw.slice(9, 13);
                  if (raw.length > 13) formatted += '-' + raw.slice(13, 17);
                  if (raw.length > 17) formatted += '-' + raw.slice(17, 21);
                  setLicenseKey(formatted);
                }}
                placeholder="XDECK-XXXX-XXXX-XXXX-XXXX"
                className="w-full px-4 py-3 glass-panel text-white placeholder-white/30 outline-none focus:border-purple-500/50 transition-colors font-mono text-center tracking-wider"
              />
              <p className="text-[10px] text-white/30 mt-1.5">
                Enter the license key from your purchase email. Each key works on one
                phone and one computer at a time.
              </p>
            </div>

            {error && (
              <p className="text-xs text-red-400 text-center">{error}</p>
            )}

            <button
              type="submit"
              disabled={isConnecting || !licenseKey.trim()}
              className="w-full py-3 mt-2 rounded-2xl font-semibold text-white transition-all disabled:opacity-50"
              style={{
                background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #a855f7 100%)',
              }}
            >
              {isConnecting ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Connecting to cloud...
                </span>
              ) : (
                'Connect via Cloud'
              )}
            </button>
          </form>
        ) : lanUnavailable ? (
        /* LAN blocked on HTTPS — show message instead of useless form */
        <div className="text-center py-4">
          <p className="text-xs text-white/30">
            Switch to <strong>Cloud</strong> mode above, or open XDECK directly from
            your desktop's address on this phone's browser.
          </p>
        </div>
        ) : (
        /* Manual form */
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs text-white/50 mb-1.5">{t('pairing.manual_ip')}</label>
            <input
              type="text"
              value={ip}
              onChange={(e) => setIp(e.target.value)}
              placeholder="192.168.1.100"
              className="w-full px-4 py-3 glass-panel text-white placeholder-white/30 outline-none focus:border-purple-500/50 transition-colors font-mono"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-white/50 mb-1.5">Port</label>
              <input
                type="text"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                placeholder="8787"
                className="w-full px-4 py-3 glass-panel text-white placeholder-white/30 outline-none focus:border-purple-500/50 transition-colors font-mono"
              />
            </div>
            <div>
              <label className="block text-xs text-white/50 mb-1.5">{t('pairing.pairing_code')}</label>
              <input
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
                maxLength={6}
                className="w-full px-4 py-3 glass-panel text-white placeholder-white/30 outline-none focus:border-purple-500/50 transition-colors font-mono text-center tracking-widest"
              />
            </div>
          </div>

          {error && (
            <p className="text-xs text-red-400 text-center">{error}</p>
          )}

          <button
            type="submit"
            disabled={isConnecting || !ip.trim()}
            className="w-full py-3 mt-2 rounded-2xl font-semibold text-white transition-all disabled:opacity-50"
            style={{
              background: 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #a855f7 100%)',
            }}
          >
            {isConnecting ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                {t('pairing.connecting')}
              </span>
            ) : (
              t('pairing.connect')
            )}
          </button>
        </form>
        )}

        <p className="text-[10px] text-white/20 text-center mt-6">
          {connectMode === 'relay'
            ? 'Connect from anywhere via cloud relay'
            : 'Make sure your phone and desktop are on the same WiFi network'
          }
        </p>

        {showUpdate && (
          <button
            onClick={reload}
            className="w-full py-2.5 mt-3 rounded-2xl text-sm font-medium bg-green-500/20 text-green-300 border border-green-500/30 hover:bg-green-500/30 transition-all"
          >
            New version available — tap to update
          </button>
        )}

        {canInstall && !showUpdate && (
          <button
            onClick={install}
            className="w-full py-2.5 mt-3 rounded-2xl text-sm font-medium bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-500/30 transition-all"
          >
            Install XDECK App
          </button>
        )}

        {!canInstall && !showUpdate && canShowManualInstall && (
          <div className="glass-panel px-4 py-3 mt-3 border border-indigo-500/20 text-center">
            <p className="text-xs text-indigo-300/80 font-medium mb-1">Install XDECK App</p>
            <p className="text-[10px] text-white/40 leading-relaxed">
              {isIOS
                ? 'Tap the Share button in Safari, then "Add to Home Screen".'
                : 'Open this page in Chrome, tap the menu, then "Add to Home Screen" or "Install App".'}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
