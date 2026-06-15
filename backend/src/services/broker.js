const { WebSocketServer } = require('ws');

const clients = new Set();
let wss = null;

function attach(server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('close', () => clients.delete(ws));
    ws.on('error', () => clients.delete(ws));
  });

  // Kill dead connections every 30 s
  setInterval(() => {
    for (const ws of clients) {
      if (!ws.isAlive) { clients.delete(ws); ws.terminate(); continue; }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30_000);

  console.log('[Broker] WebSocket listening at /ws');
}

function broadcast(type, payload) {
  if (!wss || clients.size === 0) return;
  const msg = JSON.stringify({ type, payload, ts: Date.now() });
  for (const client of clients) {
    try {
      if (client.readyState === 1) client.send(msg);
    } catch {
      clients.delete(client);
    }
  }
}

module.exports = { attach, broadcast };
