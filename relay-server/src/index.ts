import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import Stripe from 'stripe';

const PORT = parseInt(process.env.PORT || '9000');
const HEARTBEAT_INTERVAL = 30000;
const LICENSE_KEYS = new Set<string>();
const LICENSE_DB = process.env.LICENSE_DB || 'licenses.json';
const STRIPE_SECRET = process.env.STRIPE_SECRET || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const FRONTEND_URL = process.env.FRONTEND_URL || 'https://xdeck.app';

let stripe: Stripe | null = null;
if (STRIPE_SECRET) {
  stripe = new Stripe(STRIPE_SECRET, { apiVersion: '2023-10-16' });
}

function loadLicenses(): Record<string, { key: string; email: string; createdAt: string }> {
  try {
    if (fs.existsSync(LICENSE_DB)) return JSON.parse(fs.readFileSync(LICENSE_DB, 'utf-8'));
  } catch {}
  return {};
}

function saveLicense(email: string, key: string): void {
  const db = loadLicenses();
  db[email] = { key, email, createdAt: new Date().toISOString() };
  fs.writeFileSync(LICENSE_DB, JSON.stringify(db, null, 2));
  LICENSE_KEYS.add(key);
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
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Stripe-Signature');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

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
          success_url: `${FRONTEND_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${FRONTEND_URL}/#pricing`,
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
          saveLicense(email, key);
          console.log(`[STRIPE] Payment successful: ${email} → ${key}`);
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

  res.writeHead(404);
  res.end('Not found');
});

const wss = new WebSocketServer({ server: httpServer, path: '/relay' });

wss.on('connection', (ws, req) => {
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
        if (role === 'desktop' ? session.desktop : session.phone) {
          ws.send(JSON.stringify({ type: 'relay_error', error: `${role} already connected` }));
          ws.close();
          return;
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
  });
});

const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    const socket = ws as WebSocket & { isAlive: boolean };
    if (!socket.isAlive) { socket.terminate(); return; }
    socket.isAlive = false;
    socket.ping();
  });
}, HEARTBEAT_INTERVAL);

wss.on('close', () => clearInterval(heartbeat));

// Seed default license key for development
if (process.env.NODE_ENV !== 'production') {
  addLicenseKey('XDECK-DEV0-0001-0001-0001');
}

httpServer.listen(PORT, () => {
  console.log(`[RELAY] Server running on port ${PORT}`);
  console.log(`[RELAY] WebSocket: ws://0.0.0.0:${PORT}/relay`);
  console.log(`[RELAY] Health: http://0.0.0.0:${PORT}/health`);
});
