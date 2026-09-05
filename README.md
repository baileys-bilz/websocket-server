# WebSocket Server - Railway

Simple WebSocket server with broadcast support, ready for Railway deployment.

## Features

- WebSocket server on the same port as HTTP
- Health check endpoint (`/health`)
- Client tracking & broadcast messaging
- Keepalive ping/pong (30s interval)
- JSON message protocol with timestamps

## Deploy to Railway

### Option 1: Railway CLI

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Init project
railway init

# Deploy
railway up
```

### Option 2: GitHub

1. Push this folder to a GitHub repo
2. Go to [railway.app](https://railway.app)
3. Click "New Project" → "Deploy from GitHub repo"
4. Select your repo
5. Railway auto-detects Node.js and deploys

### Option 3: Railway Dashboard

1. Go to [railway.app](https://railway.app)
2. Click "New Project" → "Empty Project"
3. Click "Settings" → "Deploy from GitHub" or use CLI

## Environment Variables

Railway sets `PORT` automatically. No extra env vars needed.

## Test Connection

```javascript
const ws = new WebSocket('wss://your-app.up.railway.app');

ws.onopen = () => {
  ws.send(JSON.stringify({ hello: 'world' }));
};

ws.onmessage = (e) => {
  console.log(JSON.parse(e.data));
};
```

## Message Types

| Type | Description |
|------|-------------|
| `welcome` | Sent on connection with clientId |
| `echo` | Echo of your message with server timestamp |
| `broadcast` | Message from another client |
