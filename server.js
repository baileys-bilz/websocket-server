const { WebSocketServer } = require('ws');
const http = require('http');

// HTTP server for health checks (Railway needs this)
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('WebSocket server is running');
});

// WebSocket server attached to HTTP server
const wss = new WebSocketServer({ server });

// Track connected clients
let clientCount = 0;

wss.on('connection', (ws, req) => {
  clientCount++;
  const clientId = `client-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

  console.log(`[CONNECT] ${clientId} from ${clientIp} | Total: ${clientCount}`);

  // Send welcome message
  ws.send(JSON.stringify({
    type: 'welcome',
    clientId,
    message: 'Connected to WebSocket server',
    timestamp: new Date().toISOString()
  }));

  // Handle incoming messages
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      console.log(`[MESSAGE] ${clientId}:`, msg);

      // Echo back with server timestamp
      ws.send(JSON.stringify({
        type: 'echo',
        clientId,
        data: msg,
        serverTime: new Date().toISOString()
      }));

      // Broadcast to other clients
      wss.clients.forEach((client) => {
        if (client !== ws && client.readyState === 1) {
          client.send(JSON.stringify({
            type: 'broadcast',
            from: clientId,
            data: msg,
            timestamp: new Date().toISOString()
          }));
        }
      });
    } catch (err) {
      // Handle plain text messages
      console.log(`[MESSAGE] ${clientId}: ${data.toString()}`);
      ws.send(JSON.stringify({
        type: 'echo',
        data: data.toString(),
        serverTime: new Date().toISOString()
      }));
    }
  });

  // Handle pong (keepalive)
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  // Handle disconnect
  ws.on('close', () => {
    clientCount--;
    console.log(`[DISCONNECT] ${clientId} | Total: ${clientCount}`);
  });

  // Handle errors
  ws.on('error', (err) => {
    console.error(`[ERROR] ${clientId}:`, err.message);
  });
});

// Keepalive ping every 30s
const pingInterval = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

wss.on('close', () => clearInterval(pingInterval));

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ HTTP server listening on port ${PORT}`);
  console.log(`✅ WebSocket server ready on ws://0.0.0.0:${PORT}`);
  console.log(`✅ Health check: http://0.0.0.0:${PORT}/health`);
});
