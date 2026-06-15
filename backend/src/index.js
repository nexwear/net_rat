const express = require('express');
const { initDb } = require('./db');
const deviceRoutes = require('./routes/devices');
const ingestRoutes = require('./routes/ingest');
const cardRoutes = require('./routes/cards');
const bundleRoutes = require('./routes/bundles');
const statusRoutes = require('./routes/status');
const otaRoutes = require('./routes/ota');
const adminRoutes = require('./routes/admin');
const { ensureFirmwareDir } = require('./services/ota');
const offlineWatcher = require('./services/offlineWatcher');

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json());

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'backend' });
});

app.get('/healthz', (_req, res) => {
  res.json({ status: 'ok' });
});

app.use('/v1/devices', deviceRoutes);
app.use('/v1', cardRoutes);
app.use('/v1', bundleRoutes);
app.use('/v1', statusRoutes);
app.use('/v1', otaRoutes);
app.use('/v1', ingestRoutes);
app.use('/v1/admin', adminRoutes);

async function start() {
  try {
    await initDb();
    ensureFirmwareDir();
    console.log('Database ready');
  } catch (err) {
    console.error('Database init failed:', err.message);
    if (process.env.REQUIRE_DB !== 'false') {
      process.exit(1);
    }
  }

  app.listen(PORT, () => {
    console.log(`Backend running on port ${PORT}`);
    if (process.env.AUTO_APPROVE_DEVICES === 'true') {
      console.log('AUTO_APPROVE_DEVICES enabled — new claims activate immediately');
    }
    offlineWatcher.start();
    console.log('Offline watcher started (30s interval)');
  });
}

start();
