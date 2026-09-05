const { WebSocketServer } = require('ws');
const http = require('http');

const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', clients: wss.clients.size }));
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('WebSocket server running');
});

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  console.log(`[+] Connected: ${ip} | Total: ${wss.clients.size}`);

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (data) => {
    // Broadcast ke semua client lain
    wss.clients.forEach((client) => {
      if (client !== ws && client.readyState === 1) {
        client.send(data.toString());
      }
    });
  });

  ws.on('close', () => {
    console.log(`[-] Disconnected | Total: ${wss.clients.size}`);
  });

  ws.on('error', (err) => {
    console.error(`[!] Error: ${err.message}`);
  });
});

// Keepalive tiap 30 detik
setInterval(() => {
  wss.clients.forEach((ws) => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`WS running on port ${PORT}`);
});

