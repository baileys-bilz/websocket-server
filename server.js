const { WebSocketServer } = require('ws');
const http = require('http');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');

const logger = pino({ level: 'silent' });

// ─── HTTP Server ─────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      uptime: process.uptime(),
      whatsapp: waConnected ? 'connected' : 'disconnected',
    }));
    return;
  }

  if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!DOCTYPE html>
<html><head><title>WS + WhatsApp Bot</title>
<style>
  body { font-family: system-ui; max-width: 600px; margin: 40px auto; padding: 20px; background: #0a0a0a; color: #e0e0e0; }
  h1 { color: #25D366; }
  .status { padding: 12px; border-radius: 8px; margin: 16px 0; }
  .ok { background: #1a3a1a; border: 1px solid #25D366; }
  .off { background: #3a1a1a; border: 1px solid #ff4444; }
  code { background: #1a1a2e; padding: 2px 8px; border-radius: 4px; font-size: 14px; }
  .endpoint { background: #1a1a2e; padding: 16px; border-radius: 8px; margin: 12px 0; }
  .endpoint p { margin: 4px 0; }
</style></head><body>
  <h1>🟢 WebSocket + WhatsApp Bot Server</h1>
  <div class="status ${waConnected ? 'ok' : 'off'}">
    WhatsApp: <strong>${waConnected ? 'Connected ✅' : 'Disconnected ❌'}</strong>
  </div>
  <div class="endpoint">
    <p><strong>WebSocket:</strong> <code>wss://${req.headers.host}</code></p>
    <p><strong>Health:</strong> <code>https://${req.headers.host}/health</code></p>
    <p><strong>WA Pairing:</strong> <code>POST /pair?phone=62xxx</code></p>
    <p><strong>WA Status:</strong> <code>GET /wa-status</code></p>
  </div>
</body></html>`);
    return;
  }

  // WhatsApp pairing endpoint
  if (req.url.startsWith('/pair') && req.method === 'POST') {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const phone = url.searchParams.get('phone');
    if (!phone) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing ?phone= parameter' }));
      return;
    }
    handlePairing(phone, res);
    return;
  }

  // WhatsApp status
  if (req.url === '/wa-status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      connected: waConnected,
      phone: waPhoneNumber,
      uptime: waConnected ? Math.floor(process.uptime()) : 0,
    }));
    return;
  }

  // Send WhatsApp message
  if (req.url.startsWith('/send') && req.method === 'POST') {
    let body = '';
    req.on('data', (chunk) => body += chunk);
    req.on('end', () => {
      try {
        const { to, message } = JSON.parse(body);
        if (!to || !message) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing to/message' }));
          return;
        }
        sendWhatsAppMessage(to, message).then((result) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, result }));
        }).catch((err) => {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        });
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

// ─── WebSocket Server ────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server });
let clientCount = 0;

wss.on('connection', (ws, req) => {
  clientCount++;
  const clientId = `client-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  console.log(`[WS:CONNECT] ${clientId} from ${clientIp} | Total: ${clientCount}`);

  ws.send(JSON.stringify({
    type: 'welcome',
    clientId,
    whatsapp: { connected: waConnected, phone: waPhoneNumber },
    timestamp: new Date().toISOString(),
  }));

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      console.log(`[WS:MESSAGE] ${clientId}:`, msg);

      // If message has 'to' and 'text', send via WhatsApp
      if (msg.to && msg.text) {
        sendWhatsAppMessage(msg.to, msg.text).then(() => {
          ws.send(JSON.stringify({ type: 'wa:sent', to: msg.to, status: 'delivered' }));
        }).catch((err) => {
          ws.send(JSON.stringify({ type: 'wa:error', error: err.message }));
        });
        return;
      }

      // Echo back
      ws.send(JSON.stringify({
        type: 'echo',
        clientId,
        data: msg,
        serverTime: new Date().toISOString(),
      }));

      // Broadcast to others
      wss.clients.forEach((client) => {
        if (client !== ws && client.readyState === 1) {
          client.send(JSON.stringify({
            type: 'broadcast',
            from: clientId,
            data: msg,
            timestamp: new Date().toISOString(),
          }));
        }
      });
    } catch (err) {
      ws.send(JSON.stringify({ type: 'echo', data: data.toString() }));
    }
  });

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('close', () => { clientCount--; console.log(`[WS:DISCONNECT] ${clientId} | Total: ${clientCount}`); });
  ws.on('error', (err) => console.error(`[WS:ERROR] ${clientId}:`, err.message));
});

// Keepalive
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

// ─── Broadcast to WS clients ─────────────────────────────────────────────────
function broadcastToWS(data) {
  const payload = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) client.send(payload);
  });
}

// ─── WhatsApp Bot ────────────────────────────────────────────────────────────
let waSocket = null;
let waConnected = false;
let waPhoneNumber = null;
let pairingInProgress = false;
const AUTH_DIR = path.join(__dirname, 'auth_info');

async function startWhatsApp() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  waSocket = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    logger,
    printQRInTerminal: false,
    browser: ['WebSocket-Bot', 'Chrome', '1.0.0'],
    generateHighQualityLinkPreview: false,
  });

  // Connection updates
  waSocket.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (connection === 'open') {
      waConnected = true;
      waPhoneNumber = waSocket.user?.id?.split(':')[0] || null;
      console.log(`[WA:CONNECTED] Phone: ${waPhoneNumber}`);
      broadcastToWS({ type: 'wa:status', connected: true, phone: waPhoneNumber });
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error?.output?.statusCode;
      waConnected = false;
      waPhoneNumber = null;
      console.log(`[WA:DISCONNECTED] Status: ${statusCode}`);
      broadcastToWS({ type: 'wa:status', connected: false });

      if (statusCode !== DisconnectReason.loggedOut) {
        console.log('[WA:RECONNECTING] in 5s...');
        setTimeout(() => startWhatsApp(), 5000);
      } else {
        console.log('[WA:LOGGED_OUT] Need to re-pair');
      }
    }
  });

  // Save credentials on update
  waSocket.ev.on('creds.update', saveCreds);

  // Message handler
  waSocket.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (msg.key.fromMe) continue;

      const from = msg.key.remoteJid;
      const text = msg.message?.conversation
        || msg.message?.extendedTextMessage?.text
        || msg.message?.imageMessage?.caption
        || '';
      const sender = msg.pushName || from.split('@')[0];

      console.log(`[WA:MSG] ${sender} (${from}): ${text}`);

      // Broadcast to WebSocket clients
      broadcastToWS({
        type: 'wa:message',
        from,
        sender,
        text,
        timestamp: new Date(msg.messageTimestamp * 1000).toISOString(),
        id: msg.key.id,
      });

      // ── Bot Commands ────────────────────────────────────────────────
      const cmd = text.toLowerCase().trim();

      if (cmd === '!ping') {
        await waSocket.sendMessage(from, { text: '🏓 Pong!' });
      } else if (cmd === '!info') {
        await waSocket.sendMessage(from, {
          text: `🤖 *WebSocket Bot*\n\n` +
                `📱 Number: ${waPhoneNumber || 'N/A'}\n` +
                `👥 WS Clients: ${clientCount}\n` +
                `⏱️ Uptime: ${Math.floor(process.uptime())}s\n` +
                `📡 Status: Online`
        });
      } else if (cmd === '!help') {
        await waSocket.sendMessage(from, {
          text: `📋 *Commands*\n\n` +
                `!ping - Test bot\n` +
                `!info - Bot info\n` +
                `!help - Show this\n` +
                `!echo <text> - Repeat text\n` +
                `!broadcast <text> - Send to all WS clients`
        });
      } else if (cmd.startsWith('!echo ')) {
        const echo = text.slice(6);
        await waSocket.sendMessage(from, { text: echo });
      } else if (cmd.startsWith('!broadcast ')) {
        const broadcast = text.slice(11);
        broadcastToWS({ type: 'wa:broadcast', from, sender, text: broadcast });
        await waSocket.sendMessage(from, { text: `✅ Broadcasted to ${clientCount} clients` });
      }
    }
  });
}

async function handlePairing(phone, res) {
  if (pairingInProgress) {
    res.writeHead(409, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Pairing already in progress' }));
    return;
  }

  if (waConnected) {
    res.writeHead(409, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Already connected', phone: waPhoneNumber }));
    return;
  }

  pairingInProgress = true;

  try {
    // Restart with pairing code
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();

    waSocket = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, logger),
      },
      logger,
      printQRInTerminal: false,
      browser: ['WebSocket-Bot', 'Chrome', '1.0.0'],
      generateHighQualityLinkPreview: false,
    });

    // Wait for pairing code
    const code = await waSocket.requestPairingCode(phone);

    console.log(`[WA:PAIRING] Code for ${phone}: ${code}`);
    broadcastToWS({ type: 'wa:pairing', phone, code });

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ phone, code, message: 'Enter this code on your WhatsApp' }));

    // Handle connection after pairing
    waSocket.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect } = update;
      if (connection === 'open') {
        waConnected = true;
        waPhoneNumber = waSocket.user?.id?.split(':')[0] || phone;
        pairingInProgress = false;
        console.log(`[WA:CONNECTED] Phone: ${waPhoneNumber}`);
        broadcastToWS({ type: 'wa:status', connected: true, phone: waPhoneNumber });
      }
      if (connection === 'close') {
        waConnected = false;
        pairingInProgress = false;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        if (statusCode !== DisconnectReason.loggedOut) {
          setTimeout(() => startWhatsApp(), 5000);
        }
      }
    });

    waSocket.ev.on('creds.update', saveCreds);

    // Re-attach message handler
    waSocket.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const msg of messages) {
        if (msg.key.fromMe) continue;
        const from = msg.key.remoteJid;
        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
        const sender = msg.pushName || from.split('@')[0];
        broadcastToWS({
          type: 'wa:message', from, sender, text,
          timestamp: new Date(msg.messageTimestamp * 1000).toISOString(),
          id: msg.key.id,
        });
      }
    });

  } catch (err) {
    pairingInProgress = false;
    console.error('[WA:PAIR_ERROR]', err.message);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: err.message }));
    }
  }
}

async function sendWhatsAppMessage(to, text) {
  if (!waSocket || !waConnected) throw new Error('WhatsApp not connected');
  const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
  return waSocket.sendMessage(jid, { text });
}

// ─── Start ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', async () => {
  console.log(`✅ Server listening on port ${PORT}`);
  console.log(`✅ WebSocket: ws://0.0.0.0:${PORT}`);
  console.log(`✅ Health: http://0.0.0.0:${PORT}/health`);

  // Try to start WhatsApp with existing auth
  try {
    await startWhatsApp();
  } catch (err) {
    console.log('[WA] No existing auth, use /pair?phone=62xxx to connect');
  }
});
