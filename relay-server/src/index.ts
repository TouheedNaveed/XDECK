import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import Stripe from 'stripe';

const PORT = parseInt(process.env.PORT || '9000');
const HEARTBEAT_INTERVAL = 60000;
const LICENSE_KEYS = new Set<string>();
const LICENSE_DB = process.env.LICENSE_DB || 'licenses.json';
const STRIPE_SECRET = process.env.STRIPE_SECRET || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://xdeck.app';

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
  alive: boolean;
}

const sessions = new Map<string, { desktop: RelayClient | null; phone: RelayClient | null }>();

function generateLicenseKey(): string {
  const bytes = crypto.randomBytes(16);
  const hex = bytes.toString('hex').toUpperCase();
  return `XDECK-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}`;
}

function addLicenseKey(key: string) {
  LICENSE_KEYS.add(key);
  console.log(`[RELAY] License key added: ${key} (total: ${LICENSE_KEYS.size})`);
}

function validateLicenseKey(key: string): boolean {
  if (LICENSE_KEYS.has(key)) return true;
  if (process.env.NODE_ENV !== 'production') return true;
  return false;
}

function getSession(licenseKey: string) {
  if (!sessions.has(licenseKey)) {
    sessions.set(licenseKey, { desktop: null, phone: null });
  }
  return sessions.get(licenseKey)!;
}

function removeClient(client: RelayClient) {
  const session = getSession(client.licenseKey);
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
  const session = getSession(client.licenseKey);
  const peer = client.role === 'desktop' ? session.phone : session.desktop;
  if (peer && peer.ws.readyState === WebSocket.OPEN) {
    peer.ws.send(data);
  }
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

        const session = await stripe!.checkout.sessions.create({
          payment_method_types: ['card'],
          line_items: [{
            price_data: {
              currency: 'usd',
              product_data: { name: 'XDECK Lifetime License', description: 'Turn your phone into a stream deck' },
              unit_amount: 1000,
            },
            quantity: 1,
          }],
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

  res.writeHead(404);
  res.end('Not found');
});

const wss = new WebSocketServer({ server: httpServer, path: '/relay' });

wss.on('connection', (ws, req) => {
  (ws as any).isAlive = true;
  let client: RelayClient | null = null;

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());

      if (msg.type === 'relay_auth') {
        const { licenseKey, role, deviceName } = msg as { licenseKey: string; role: 'desktop' | 'phone'; deviceName: string };
        if (!licenseKey || !role || (role !== 'desktop' && role !== 'phone')) {
          ws.send(JSON.stringify({ type: 'relay_error', error: 'Invalid auth' }));
          ws.close();
          return;
        }
        if (!validateLicenseKey(licenseKey)) {
          ws.send(JSON.stringify({ type: 'relay_error', error: 'Invalid license key' }));
          ws.close();
          return;
        }

        const session = getSession(licenseKey);
        const existingClient = role === 'desktop' ? session.desktop : session.phone;
        if (existingClient) {
          if (existingClient.ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'relay_error', error: `${role} already connected` }));
            ws.close();
            return;
          }
          // Old connection is stale/closed — clean it up
          removeClient(existingClient);
        }

        client = { ws, role, licenseKey, deviceName: deviceName || role, alive: true };
        if (role === 'desktop') session.desktop = client;
        else session.phone = client;

        console.log(`[RELAY] ${role} connected (${licenseKey.slice(0, 12)}...)`);

        ws.send(JSON.stringify({ type: 'relay_auth_ok', role }));

        const peer = role === 'desktop' ? session.phone : session.desktop;
        if (peer && peer.ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'relay_status', connected: true, peer: peer.deviceName }));
          peer.ws.send(JSON.stringify({ type: 'relay_status', connected: true, peer: deviceName }));
        } else {
          ws.send(JSON.stringify({ type: 'relay_status', connected: false }));
        }
        return;
      }

      if (!client) {
        ws.send(JSON.stringify({ type: 'relay_error', error: 'Not authenticated' }));
        return;
      }

      sendToPeer(client, raw.toString());
    } catch {
    }
  });

  ws.on('close', () => {
    if (client) removeClient(client);
  });

  ws.on('pong', () => {
    if (client) client.alive = true;
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

// Seed default license key for development
if (process.env.NODE_ENV !== 'production') {
  addLicenseKey('XDECK-DEV0-0001-0001-0001');
}

process.on('uncaughtException', (e) => { console.error('[RELAY] Uncaught:', e.message); });
process.on('unhandledRejection', (e) => { console.error('[RELAY] Unhandled:', e); });

httpServer.listen(PORT, () => {
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
