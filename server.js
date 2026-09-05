const { WebSocketServer } = require('ws');
const http = require('http');
const net = require('net');

const server = http.createServer((req, res) => {
  // Health check
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', clients: wss.clients.size }));
  }

  // Test koneksi ke WhatsApp servers
  if (req.url === '/wa-test') {
    const hosts = [
      'mmg.whatsapp.net',
      'static.whatsapp.net',
      '31.13.80.53',
      'web.whatsapp.com',
      'g.whatsapp.net'
    ];

    Promise.all(hosts.map(h => testEdge(h, 443))).then(results => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(results, null, 2));
    });
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('WebSocket server running');
});

function testEdge(host, port) {
  return new Promise((resolve) => {
    const start = Date.now();
    const socket = net.createConnection({ host, port, timeout: 8000 });

    socket.once('connect', () => {
      resolve({ host, ok: true, ms: Date.now() - start });
      socket.destroy();
    });

    socket.once('timeout', () => {
      socket.destroy();
      resolve({ host, ok: false, error: 'timeout' });
    });

    socket.once('error', (err) => {
      resolve({ host, ok: false, error: err.message });
    });
  });
}

const wss = new WebSocketServer({ server });

wss.on('connection', (ws, req) => {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  console.log(`[+] ${ip} | Total: ${wss.clients.size}`);

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (data) => {
    wss.clients.forEach((client) => {
      if (client !== ws && client.readyState === 1) {
        client.send(data.toString());
      }
    });
  });

  ws.on('close', () => console.log(`[-] Total: ${wss.clients.size}`));
  ws.on('error', (err) => console.error(`[!] ${err.message}`));
});

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
