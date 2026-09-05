const { WebSocketServer } = require('ws');
const http = require('http');
const crypto = require('crypto');

// ─── HTTP Server ─────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  // Health check
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', clients: clientCount, uptime: process.uptime() }));
  }

  // Rich HTML page for WhatsApp preview / browser test
  if (req.url === '/' || req.url === '/rich') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(getRichHTML(req.headers.host));
  }

  // API: Send rich response data to all WS clients
  if (req.url === '/api/broadcast' && req.method === 'POST') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        broadcastToWS({ type: 'rich:data', ...data });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true, clients: clientCount }));
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON' }));
      }
    });
    return;
  }

  // API: Get Baileys plugin source
  if (req.url === '/plugin.js') {
    res.writeHead(200, { 'Content-Type': 'application/javascript' });
    return res.end(getPluginCode(req.headers.host));
  }

  res.writeHead(404);
  res.end('Not found');
});

// ─── WebSocket Server ────────────────────────────────────────────────────────
const wss = new WebSocketServer({ server });
let clientCount = 0;

wss.on('connection', (ws, req) => {
  clientCount++;
  const id = `c-${Date.now().toString(36)}`;
  console.log(`[WS:+] ${id} | Total: ${clientCount}`);

  ws.send(JSON.stringify({
    event: 'connection',
    id,
    clients: clientCount,
    time: Date.now()
  }));

  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw.toString());
      console.log(`[WS:MSG] ${id}:`, msg.event || msg.type || 'data');

      // Echo + broadcast
      wss.clients.forEach(c => {
        if (c.readyState === 1) {
          c.send(JSON.stringify({
            event: msg.event || 'message',
            from: id,
            data: msg,
            time: Date.now()
          }));
        }
      });
    } catch {
      ws.send(JSON.stringify({ event: 'echo', data: raw.toString() }));
    }
  });

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('close', () => { clientCount--; console.log(`[WS:-] ${id} | Total: ${clientCount}`); });
});

// Keepalive
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

function broadcastToWS(data) {
  const json = JSON.stringify(data);
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(json); });
}

// ─── Rich HTML Template ──────────────────────────────────────────────────────
function getRichHTML(host) {
  const wsUrl = `wss://${host}/`;
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>WebSocket Rich</title>
<style>
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent;-webkit-user-select:none;user-select:none}
html,body{margin:0;padding:0;width:100%;background:transparent;font-family:"SFMono-Regular","Cascadia Code","Roboto Mono",Consolas,monospace}
body{padding:10px}
.terminal{width:100%;max-width:680px;margin:auto;overflow:hidden;border-radius:12px;background:#080b0e;border:1px solid #20262c;box-shadow:0 12px 30px rgba(0,0,0,.45),inset 0 1px rgba(255,255,255,.025)}
.header{height:36px;display:flex;align-items:center;padding:0 12px;background:#101419;border-bottom:1px solid #20262c}
.dots{display:flex;gap:5px}
.dot{width:8px;height:8px;border-radius:50%;background:#343c43}
.terminal-title{flex:1;text-align:center;margin-right:34px;color:#707a83;font-size:9px}
.content{padding:14px}
.command-line{font-size:9px;line-height:1.7;word-break:break-word}
.user{color:#5cff8d}
.host{color:#72b7ff}
.symbol{color:#626c74}
.command{color:#dce3e8;margin-left:4px}
.title{margin-top:8px;color:#edf1f3;font-size:15px;font-weight:700}
.subtitle{margin-top:4px;color:#555f67;font-size:7px;letter-spacing:1px}
.status{margin-top:13px;padding:11px;border-radius:8px;background:#0b0f12;border:1px solid #1c242a}
.status-row{display:flex;align-items:center;gap:8px}
.status-dot{width:7px;height:7px;flex-shrink:0;border-radius:50%;background:#72b7ff;box-shadow:0 0 8px rgba(114,183,255,.5)}
.status-text{color:#aab3ba;font-size:9px;font-weight:700}
.status-detail{margin-top:5px;padding-left:15px;color:#505b63;font-size:8px}
.endpoint{margin-top:10px;padding:10px 11px;border-radius:8px;background:#050709;border:1px solid #171d22}
.endpoint-label{color:#4e5961;font-size:7px;letter-spacing:1px}
.endpoint-value{margin-top:5px;color:#72b7ff;font-size:8px;line-height:1.5;word-break:break-all}
.log{margin-top:10px;padding:10px 11px;min-height:125px;max-height:205px;overflow:hidden;border-radius:8px;background:#050709;border:1px solid #171d22;color:#737e86;font-size:8px;line-height:1.7;white-space:pre-wrap;word-break:break-word}
.log-info{color:#72b7ff}
.log-ok{color:#5cff8d}
.log-error{color:#ff6875}
.log-warning{color:#ffd166}
.footer{margin-top:10px;padding-top:9px;border-top:1px solid #171d22;text-align:center;color:#3d464d;font-size:7px;letter-spacing:.7px}
</style>
</head><body>
<div class="terminal">
  <div class="header">
    <div class="dots"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div>
    <div class="terminal-title">rich@websocket ~ terminal</div>
  </div>
  <div class="content">
    <div class="command-line">
      <span class="user">rich</span><span class="symbol">@</span><span class="host">websocket</span><span class="symbol">:~$</span><span class="command">ws-connect</span>
    </div>
    <div class="title">WebSocket Rich</div>
    <div class="subtitle">REALTIME CONNECTION / RICH RESPONSE</div>
    <div class="status">
      <div class="status-row">
        <div id="statusDot" class="status-dot"></div>
        <div id="status" class="status-text">CONNECTING...</div>
      </div>
      <div id="detail" class="status-detail">Initializing WebSocket...</div>
    </div>
    <div class="endpoint">
      <div class="endpoint-label">WSS ENDPOINT</div>
      <div id="endpoint" class="endpoint-value"></div>
    </div>
    <div id="log" class="log">[SYS] Initializing...</div>
    <div class="footer">RICH WEBSOCKET • REALTIME</div>
  </div>
</div>
<script>
(()=>{
  const WS_URL='${wsUrl}';
  const status=document.getElementById('status');
  const detail=document.getElementById('detail');
  const endpoint=document.getElementById('endpoint');
  const log=document.getElementById('log');
  const statusDot=document.getElementById('statusDot');
  endpoint.textContent=WS_URL;
  const getTime()=>new Date().toLocaleTimeString('en-US',{hour12:false});
  const addLog=(text,type='normal')=>{
    const line=document.createElement('span');
    line.className=type==='normal'?'':'log-'+type;
    line.textContent='['+getTime()+'] '+text;
    log.appendChild(document.createTextNode('\\n'));
    log.appendChild(line);
    log.scrollTop=log.scrollHeight;
  };
  const setStatus=(title,desc,type)=>{
    status.textContent=title;
    detail.textContent=desc;
    if(type==='success'){statusDot.style.background='#5cff8d';statusDot.style.boxShadow='0 0 8px rgba(92,255,141,.55)'}
    else if(type==='error'){statusDot.style.background='#ff6875';statusDot.style.boxShadow='0 0 8px rgba(255,104,117,.55)'}
    else if(type==='warning'){statusDot.style.background='#ffd166';statusDot.style.boxShadow='0 0 8px rgba(255,209,102,.55)'}
    else{statusDot.style.background='#72b7ff';statusDot.style.boxShadow='0 0 8px rgba(114,183,255,.55)'}
  };
  if(!window.WebSocket){setStatus('NOT SUPPORTED','WebSocket unavailable','error');addLog('[ERR] No WebSocket','error');return}
  addLog('[INFO] Connecting...','info');
  addLog('[INFO] Protocol: WSS','info');
  let ws;
  try{ws=new WebSocket(WS_URL)}catch(e){setStatus('FAILED',e.message,'error');addLog('[ERR] '+e.message,'error');return}
  ws.onopen=()=>{
    setStatus('CONNECTED','WebSocket connected','success');
    addLog('[OK] Connected','ok');
    addLog('[OK] Tunnel reachable','ok');
    ws.send(JSON.stringify({event:'connection_test',sender:'RICH_CLIENT',message:'HELLO',time:Date.now()}));
    addLog('[SEND] connection_test','info');
  };
  ws.onmessage=e=>{
    addLog('[RECV] '+e.data,'ok');
    try{
      const d=JSON.parse(e.data);
      if(d.event==='connection')addLog('[OK] CONFIRMED','ok');
      if(d.event==='connection_test'){setStatus('SUCCESS','Realtime received','success');addLog('[OK] REALTIME OK','ok')}
      if(d.event==='rich:data'){addLog('[DATA] '+JSON.stringify(d.data),'info')}
    }catch{addLog('[OK] Data received','ok')}
  };
  ws.onerror=()=>{setStatus('ERROR','Connection failed','error');addLog('[ERR] WebSocket error','error')};
  ws.onclose=e=>{setStatus('CLOSED','Disconnected','warning');addLog('[CLOSE] Code: '+e.code,'warning')};
})()
</script>
</body></html>`;
}

// ─── Baileys Plugin Code ─────────────────────────────────────────────────────
function getPluginCode(host) {
  const wsUrl = `wss://${host}`;
  return `// Auto-generated Baileys Plugin
// WebSocket Rich Response - hosted on ${host}

const WS_URL = '${wsUrl}';

const sources = [
  {
    source_type: 'THIRD_PARTY',
    source_display_name: 'Rich WebSocket',
    source_subtitle: 'Realtime Connection',
    source_url: WS_URL,
    favicon: {
      url: 'https://cdn-icons-png.flaticon.com/512/2166/2166823.png',
      mime_type: 'image/png',
      width: 16,
      height: 16
    }
  }
];

module.exports = {
  command: ['.rich', '.ws'],
  tags: ['tools'],
  help: '.rich - Send WebSocket Rich Response',
  
  async run(conn, m, { text }) {
    const { proto, generateWAMessageFromContent, generateMessageIDV2 } = 
      await import('@whiskeysockets/baileys');

    // Fetch HTML from server
    const res = await fetch(WS_URL + '/rich');
    const html = await res.text();

    const richResponseMessage = {
      messageType: 1,
      submessages: [
        {
          messageType: proto.AIRichResponseSubMessageType.AI_RICH_RESPONSE_TEXT,
          messageText: 'WebSocket Rich Response'
        }
      ],
      unifiedResponse: {
        data: Buffer.from(JSON.stringify({
          response_id: generateMessageIDV2(),
          sections: [{
            view_model: {
              primitive: {
                __typename: 'GenAIaeacdsnwHtmlPrimitive',
                payload: html,
                trusted_sources: sources.map(x => x.source_url)
              },
              __typename: 'GenAISingleLayoutViewModel'
            }
          }]
        })).toString('base64')
      },
      contextInfo: {
        forwardingScore: 1,
        isForwarded: true,
        forwardedAiBotMessageInfo: { botJid: '0@bot' },
        forwardOrigin: 4
      }
    };

    const isi = {
      messageContextInfo: {
        deviceListMetadata: {},
        deviceListMetadataVersion: 2,
        botMetadata: {
          messageDisclaimerText: 'WebSocket Rich',
          richResponseSourcesMetadata: { sources }
        }
      },
      botForwardedMessage: {
        message: { richResponseMessage }
      }
    };

    const msg = generateWAMessageFromContent(m.chat, isi, {
      messageId: generateMessageIDV2()
    });

    await conn.relayMessage(m.chat, msg.message, { messageId: msg.key.id });
    return m.reply('Rich WebSocket terkirim ✅');
  }
};
`;
}

// ─── Start ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(\`✅ Server: http://0.0.0.0:\${PORT}\`);
  console.log(\`✅ WebSocket: ws://0.0.0.0:\${PORT}\`);
  console.log(\`✅ Rich Page: http://0.0.0.0:\${PORT}/rich\`);
  console.log(\`✅ Plugin: http://0.0.0.0:\${PORT}/plugin.js\`);
});
