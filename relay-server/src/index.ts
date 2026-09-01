import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import Stripe from 'stripe';
import { Resend } from 'resend';

const PORT = parseInt(process.env.PORT || '9000');
// 25s: two missed beats must still be well inside Render's ~100s idle-proxy timeout,
// and stale sockets need reaping fast so a reconnecting phone isn't shadowed by a ghost.
const HEARTBEAT_INTERVAL = 25000;
const LICENSE_KEYS = new Set<string>();
const LICENSE_DB = process.env.LICENSE_DB || 'licenses.json';
// Set this to enable self-verifying keys that survive a wiped licenses.json.
const LICENSE_SIGNING_SECRET = process.env.LICENSE_SIGNING_SECRET || '';
const STRIPE_SECRET = process.env.STRIPE_SECRET || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const STRIPE_PRICE_ID = process.env.STRIPE_PRICE_ID || '';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://xdeck.app';
const RESEND_API_KEY = process.env.RESEND_API_KEY || '';

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

let stripe: Stripe | null = null;
if (STRIPE_SECRET) {
  stripe = new Stripe(STRIPE_SECRET, { apiVersion: '2023-10-16' });
}

function loadLicenses(): Record<string, { key: string; email: string; createdAt: string; sessionId?: string }> {
  try {
    if (fs.existsSync(LICENSE_DB)) return JSON.parse(fs.readFileSync(LICENSE_DB, 'utf-8'));
  } catch {}
  return {};
}

function initLicenseKeys(): void {
  const db = loadLicenses();
  for (const entry of Object.values(db)) {
    if (entry.key) {
      LICENSE_KEYS.add(entry.key);
      console.log(`[RELAY] Loaded license from DB: ${entry.key.slice(0, 12)}...`);
    }
  }
  const envKeys = process.env.LICENSE_KEYS || '';
  if (envKeys) {
    for (const k of envKeys.split(',').map(s => s.trim()).filter(Boolean)) {
      LICENSE_KEYS.add(k);
      console.log(`[RELAY] Loaded license from env: ${k.slice(0, 12)}...`);
    }
  }
  console.log(`[RELAY] Total valid license keys: ${LICENSE_KEYS.size}`);
}

function saveLicense(email: string, key: string, sessionId?: string): void {
  const db = loadLicenses();
  db[email] = { key, email, createdAt: new Date().toISOString(), sessionId };
  fs.writeFileSync(LICENSE_DB, JSON.stringify(db, null, 2));
  LICENSE_KEYS.add(key);
}

function findLicenseBySessionId(sessionId: string): { key: string; email: string } | null {
  const db = loadLicenses();
  for (const entry of Object.values(db)) {
    if (entry.sessionId === sessionId) return { key: entry.key, email: entry.email };
  }
  return null;
}

interface RelayClient {
  ws: WebSocket;
  role: 'desktop' | 'phone';
  licenseKey: string;
  deviceName: string;
  /** Stable per-install identifier, so a reconnect is distinguishable from a stranger. */
  deviceId: string;
  alive: boolean;
  /** Set while another device is contesting this slot; resolved by the next pong. */
  onProbePong?: () => void;
}

const sessions = new Map<string, { desktop: RelayClient | null; phone: RelayClient | null }>();

function generateLicenseKey(): string {
  // Keys are self-verifying: a random serial plus a truncated HMAC of it. That lets
  // validateLicenseKey() accept a key we issued even after Render's ephemeral disk
  // has wiped licenses.json, without accepting keys nobody paid for.
  const serial = crypto.randomBytes(3).toString('hex').toUpperCase(); // 6 hex chars
  if (!LICENSE_SIGNING_SECRET) {
    // Unsigned fallback: only usable while it survives in licenses.json / env.
    const hex = crypto.randomBytes(8).toString('hex').toUpperCase();
    return `XDECK-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}`;
  }
  const sig = signSerial(serial);
  const body = `${serial}${sig}`; // 6 + 10 = 16 chars
  return `XDECK-${body.slice(0, 4)}-${body.slice(4, 8)}-${body.slice(8, 12)}-${body.slice(12, 16)}`;
}

function signSerial(serial: string): string {
  return crypto
    .createHmac('sha256', LICENSE_SIGNING_SECRET)
    .update(`xdeck-license:${serial.toUpperCase()}`)
    .digest('hex')
    .slice(0, 10)
    .toUpperCase();
}

function addLicenseKey(key: string) {
  LICENSE_KEYS.add(key);
  console.log(`[RELAY] License key added: ${key.slice(0, 12)}... (total: ${LICENSE_KEYS.size})`);
}

/**
 * A key is valid only if we issued it: either it is in the allowlist (licenses.json
 * from Stripe, or the LICENSE_KEYS env var) or it carries a valid signature.
 * Never accept a key just because it has the right shape — that would make Cloud
 * mode free for anyone who can read the format.
 */
function validateLicenseKey(key: string): boolean {
  const normalized = key.trim().toUpperCase();
  if (LICENSE_KEYS.has(key) || LICENSE_KEYS.has(normalized)) return true;

  if (LICENSE_SIGNING_SECRET) {
    const body = normalized.replace(/^XDECK-/, '').replace(/-/g, '');
    if (body.length !== 16) return false;
    const serial = body.slice(0, 6);
    const provided = body.slice(6);
    const expected = signSerial(serial);
    if (provided.length !== expected.length) return false;
    try {
      return crypto.timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
    } catch {
      return false;
    }
  }

  return false;
}

function getSession(licenseKey: string) {
  if (!sessions.has(licenseKey)) {
    sessions.set(licenseKey, { desktop: null, phone: null });
  }
  return sessions.get(licenseKey)!;
}

function removeClient(client: RelayClient) {
  const session = sessions.get(client.licenseKey);
  if (!session) return;

  // Only vacate the slot if it still points at *this* client. A late 'close' event
  // from a socket we already replaced must not evict its successor.
  const slot = client.role === 'desktop' ? session.desktop : session.phone;
  if (slot !== client) return;

  if (client.role === 'desktop') {
    session.desktop = null;
    if (session.phone?.ws.readyState === WebSocket.OPEN) {
      session.phone.ws.send(JSON.stringify({ type: 'relay_status', connected: false }));
    }
  } else {
    session.phone = null;
    if (session.desktop?.ws.readyState === WebSocket.OPEN) {
      session.desktop.ws.send(JSON.stringify({ type: 'relay_status', connected: false }));
    }
  }
  console.log(`[RELAY] ${client.role} disconnected (${client.licenseKey.slice(0, 12)}...)`);

  if (!session.desktop && !session.phone) {
    sessions.delete(client.licenseKey);
  }
}

function sendToPeer(client: RelayClient, data: string) {
  const session = sessions.get(client.licenseKey);
  if (!session) return false;
  const peer = client.role === 'desktop' ? session.phone : session.desktop;
  if (peer && peer.ws.readyState === WebSocket.OPEN) {
    peer.ws.send(data);
    return true;
  }
  return false;
}

const httpServer = http.createServer((req, res) => {
  const origin = req.headers.origin || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Stripe-Signature');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  // All non-async handlers first
  if (req.url === '/health') {
    const stats = { sessions: sessions.size, keys: LICENSE_KEYS.size };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(stats));
    return;
  }

  if (req.url === '/api/license' && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => body += chunk);
    req.on('end', () => {
      try {
        const { key } = JSON.parse(body);
        const valid = validateLicenseKey(key);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ valid }));
      } catch {
        res.writeHead(400);
        res.end('Bad request');
      }
    });
    return;
  }

  // Stripe: Create checkout session
  if (req.url === '/api/checkout' && req.method === 'POST') {
    if (!stripe) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Stripe not configured' }));
      return;
    }

    let body = '';
    req.on('data', (chunk) => body += chunk);
    req.on('end', async () => {
      try {
        const { email } = JSON.parse(body);

        // Pre-validate: can we actually reach Stripe?
        try {
          await stripe!.checkout.sessions.list({ limit: 1 });
        } catch (e: any) {
          console.error('[STRIPE] Pre-check failed:', e.message);
          res.writeHead(503, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Stripe API unreachable. Please try again.' }));
          return;
        }

        const lineItem = STRIPE_PRICE_ID
          ? [{ price: STRIPE_PRICE_ID, quantity: 1 }]
          : [{
              price_data: {
                currency: 'usd',
                product_data: { name: 'XDECK Lifetime License', description: 'Turn your phone into a stream deck' },
                unit_amount: 1000,
              },
              quantity: 1,
            }];

        const session = await stripe!.checkout.sessions.create({
          payment_method_types: ['card'],
          line_items: lineItem,
          mode: 'payment',
          customer_email: email || undefined,
          success_url: `${FRONTEND_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${FRONTEND_URL}/index.html#pricing`,
          metadata: { product: 'xdeck_lifetime' },
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ url: session.url }));
      } catch (e: any) {
        console.error('[STRIPE] Checkout error:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // Stripe: Webhook for payment events
  if (req.url === '/api/webhook' && req.method === 'POST') {
    if (!stripe || !STRIPE_WEBHOOK_SECRET) {
      res.writeHead(500);
      res.end('Stripe not configured');
      return;
    }
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', async () => {
      try {
        const body = Buffer.concat(chunks);
        const sig = req.headers['stripe-signature']!;
        const event = stripe!.webhooks.constructEvent(body, sig, STRIPE_WEBHOOK_SECRET);

        if (event.type === 'checkout.session.completed') {
          const session = event.data.object as Stripe.Checkout.Session;
          const email = session.customer_email || session.customer_details?.email || 'unknown';
          const key = generateLicenseKey();
          saveLicense(email, key, session.id);
          console.log(`[STRIPE] Payment successful: ${email} → ${key} (session: ${session.id})`);
        }

        res.writeHead(200);
        res.end(JSON.stringify({ received: true }));
      } catch (e: any) {
        console.error('[STRIPE] Webhook error:', e.message);
        res.writeHead(400);
        res.end(`Webhook Error: ${e.message}`);
      }
    });
    return;
  }

  // Lookup license by Stripe session ID — verifies payment directly via Stripe API
  const sessionMatch = req.url?.match(/^\/api\/license\/lookup\?session_id=(.+)$/);
  if (sessionMatch && req.method === 'GET') {
    const sessionId = decodeURIComponent(sessionMatch[1]);

    // Check if already generated
    const existing = findLicenseBySessionId(sessionId);
    if (existing) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ key: existing.key, email: existing.email }));
      return;
    }

    // Verify payment via Stripe API
    if (!stripe) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Stripe not configured' }));
      return;
    }

    stripe.checkout.sessions.retrieve(sessionId).then((session) => {
      if (session.payment_status === 'paid') {
        const email = session.customer_email || session.customer_details?.email || 'unknown';
        const key = generateLicenseKey();
        saveLicense(email, key, sessionId);
        console.log(`[STRIPE] License generated via lookup: ${email} → ${key}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ key, email }));
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ key: null, email: null, status: session.payment_status }));
      }
    }).catch((e: any) => {
      console.error('[STRIPE] Session lookup error:', e.message);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Failed to verify payment' }));
    });
    return;
  }

  // Contact form
  if (req.url === '/api/contact' && req.method === 'POST') {
    if (!resend) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Email service not configured' }));
      return;
    }
    let body = '';
    req.on('data', (chunk) => body += chunk);
    req.on('end', async () => {
      try {
        const { name, email, subject, message } = JSON.parse(body);
        if (!name || !email || !subject || !message) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'All fields are required' }));
          return;
        }

        const subjectMap: Record<string, string> = {
          general: 'General Inquiry',
          technical: 'Technical Support',
          billing: 'Billing / License',
          feature: 'Feature Request',
          bug: 'Bug Report',
        };
        const subjectLabel = subjectMap[subject] || subject;

        await resend.emails.send({
          from: 'XDECK Contact <onboarding@resend.dev>',
          to: 'support@xdeck.app',
          replyTo: email,
          subject: `[XDECK ${subjectLabel}] ${name}`,
          html: `
            <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #0F172A; color: #F8FAFC;">
              <div style="padding: 24px; background: rgba(30,41,59,0.6); border-radius: 16px; border: 1px solid rgba(255,255,255,0.08);">
                <h2 style="color: #818cf8; margin: 0 0 16px;">New Contact Form Submission</h2>
                <table style="width: 100%; border-collapse: collapse;">
                  <tr><td style="padding: 8px 0; color: #94A3B8; font-weight: 600;">Name</td><td style="padding: 8px 0; color: #F8FAFC;">${name}</td></tr>
                  <tr><td style="padding: 8px 0; color: #94A3B8; font-weight: 600;">Email</td><td style="padding: 8px 0; color: #F8FAFC;">${email}</td></tr>
                  <tr><td style="padding: 8px 0; color: #94A3B8; font-weight: 600;">Subject</td><td style="padding: 8px 0; color: #F8FAFC;">${subjectLabel}</td></tr>
                </table>
                <div style="margin-top: 16px; padding: 16px; background: rgba(255,255,255,0.03); border-radius: 12px; border: 1px solid rgba(255,255,255,0.05);">
                  <p style="color: #94A3B8; font-weight: 600; margin: 0 0 8px;">Message</p>
                  <p style="color: #F8FAFC; margin: 0; line-height: 1.6; white-space: pre-wrap;">${message}</p>
                </div>
                <p style="color: #475569; font-size: 12px; margin-top: 20px; text-align: center;">Reply to this email to respond directly to ${name}.</p>
              </div>
            </div>
          `,
        });

        console.log(`[CONTACT] Message from ${name} <${email}>: ${subjectLabel}`);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: true }));
      } catch (e: any) {
        console.error('[CONTACT] Error:', e.message);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to send message' }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

const wss = new WebSocketServer({ server: httpServer, path: '/relay' });

/** How long an incumbent gets to prove it is still there before we hand its slot over. */
const PROBE_TIMEOUT_MS = 2000;

/**
 * Asks an existing client to prove it is still alive. Used to tell two cases apart
 * that look identical from the outside: the same user reconnecting after a network
 * drop (must succeed) and a second person using a shared key (must be refused).
 */
function probeAlive(incumbent: RelayClient): Promise<boolean> {
  if (incumbent.ws.readyState !== WebSocket.OPEN) return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const done = (alive: boolean) => {
      if (settled) return;
      settled = true;
      incumbent.onProbePong = undefined;
      resolve(alive);
    };
    incumbent.onProbePong = () => done(true);
    try {
      incumbent.ws.ping();
    } catch {
      done(false);
      return;
    }
    setTimeout(() => done(false), PROBE_TIMEOUT_MS);
  });
}

wss.on('connection', (ws) => {
  (ws as any).isAlive = true;
  let client: RelayClient | null = null;
  let authInProgress = false;

  const rejectFatal = (error: string, message: string) => {
    try {
      ws.send(JSON.stringify({ type: 'relay_error', error, message, fatal: true }));
    } catch {}
    ws.close();
  };

  async function handleAuth(msg: any) {
    const { licenseKey: rawKey, role, deviceName, deviceId } = msg as {
      licenseKey: string; role: 'desktop' | 'phone'; deviceName: string; deviceId?: string;
    };
    if (!rawKey || !role || (role !== 'desktop' && role !== 'phone')) {
      rejectFatal('Invalid auth', 'Malformed authentication request.');
      return;
    }
    if (!validateLicenseKey(rawKey)) {
      rejectFatal('Invalid license key', 'That license key is not valid. Buy a key to use Cloud mode.');
      return;
    }
    // Normalize before it becomes a session identity: otherwise "xdeck-…" and
    // "XDECK-…" would be two independent sessions, letting one key serve many users.
    const licenseKey = rawKey.trim().toUpperCase();

    const identity = (deviceId || '').trim()
      // No deviceId (an older client): give it an identity that can never match an
      // incumbent, so omitting the field can't be used to impersonate one. Such a
      // client still reclaims its own slot once the liveness probe finds it dead.
      || `anon:${crypto.randomBytes(8).toString('hex')}`;
    const session = getSession(licenseKey);
    const previous = role === 'desktop' ? session.desktop : session.phone;

    if (previous) {
      if (previous.deviceId === identity) {
        // Same device reconnecting — take the slot back immediately. Waiting for the
        // heartbeat to reap the old socket is what caused the connect/reconnect loop.
        console.log(`[RELAY] ${role} reconnected, replacing its own session (${licenseKey.slice(0, 12)}...)`);
      } else if (await probeAlive(previous)) {
        // A different device, and the current holder is demonstrably still there.
        // One key, one user: refuse instead of kicking the paying customer off.
        console.log(`[RELAY] ${role} REFUSED — key in use by another device (${licenseKey.slice(0, 12)}...)`);
        rejectFatal(
          'key_in_use',
          `This license key is already in use on another ${role}. Each key works on one ${role} at a time — buy your own key to use XDECK.`,
        );
        return;
      } else {
        console.log(`[RELAY] ${role} took over a dead session (${licenseKey.slice(0, 12)}...)`);
      }
    }

    if (ws.readyState !== WebSocket.OPEN) return;

    client = { ws, role, licenseKey, deviceName: deviceName || role, deviceId: identity, alive: true };
    // Re-read the session: probeAlive() awaited, so removeClient may have deleted it.
    const live = getSession(licenseKey);
    const stale = role === 'desktop' ? live.desktop : live.phone;
    if (role === 'desktop') live.desktop = client;
    else live.phone = client;

    if (stale && stale !== client) {
      try {
        if (stale.ws.readyState === WebSocket.OPEN) {
          stale.ws.send(JSON.stringify({ type: 'relay_error', error: 'replaced', fatal: true }));
        }
        stale.ws.terminate();
      } catch {}
    }

    console.log(`[RELAY] ${role} connected (${licenseKey.slice(0, 12)}...)`);

    ws.send(JSON.stringify({ type: 'relay_auth_ok', role }));

    const peer = role === 'desktop' ? live.phone : live.desktop;
    if (peer && peer.ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'relay_status', connected: true, peer: peer.deviceName }));
      peer.ws.send(JSON.stringify({ type: 'relay_status', connected: true, peer: client.deviceName }));
    } else {
      ws.send(JSON.stringify({ type: 'relay_status', connected: false }));
    }
  }

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.type === 'relay_auth') {
        if (client || authInProgress) return;
        authInProgress = true;
        handleAuth(msg)
          .catch((e) => console.error('[RELAY] Auth error:', e))
          .finally(() => { authInProgress = false; });
        return;
      }

      // Anything arriving mid-probe is dropped rather than rejected — the client is
      // legitimately mid-handshake.
      if (authInProgress) return;

      if (!client) {
        ws.send(JSON.stringify({ type: 'relay_error', error: 'Not authenticated' }));
        return;
      }

      // Keepalive is answered by the relay itself — it must not depend on a peer
      // being present, or the PWA's liveness check fails whenever the desktop is off.
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong', ts: msg.ts }));
        return;
      }

      if (!sendToPeer(client, raw.toString())) {
        // Tell the sender its message went nowhere so the UI can stop pretending
        // the edit was applied.
        ws.send(JSON.stringify({ type: 'relay_status', connected: false, undelivered: msg.type }));
      }
    } catch {
    }
  });

  ws.on('close', () => {
    if (client) removeClient(client);
  });

  ws.on('pong', () => {
    if (client) {
      client.alive = true;
      client.onProbePong?.();
    }
    (ws as any).isAlive = true;
  });
});

const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    const socket = ws as WebSocket & { isAlive: boolean };
    if (!socket.isAlive) { 
      console.log('[RELAY] Heartbeat: terminating stale connection');
      socket.terminate(); 
      return; 
    }
    socket.isAlive = false;
    socket.ping();
  });
}, HEARTBEAT_INTERVAL);

wss.on('close', () => clearInterval(heartbeat));

process.on('uncaughtException', (e) => { console.error('[RELAY] Uncaught:', e.message); });
process.on('unhandledRejection', (e) => { console.error('[RELAY] Unhandled:', e); });

httpServer.listen(PORT, () => {
  initLicenseKeys();
  console.log(`[RELAY] Server running on port ${PORT}`);
  console.log(`[RELAY] WebSocket: ws://0.0.0.0:${PORT}/relay`);
  console.log(`[RELAY] Health: http://0.0.0.0:${PORT}/health`);

  // Keep-alive: self-ping every 5 minutes to prevent Render free tier from sleeping
  setInterval(() => {
    http.get(`http://127.0.0.1:${PORT}/health`, (res) => {
      res.resume();
    }).on('error', () => {});
  }, 5 * 60 * 1000);
});
