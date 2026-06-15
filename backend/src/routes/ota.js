const express = require('express');
const path = require('path');
const { findNodeByToken } = require('../services/devices');
const {
  checkUpdate,
  reportUpdate,
  registerRelease,
  listReleases,
  setRollout,
  resolveBinPath,
  ensureFirmwareDir,
} = require('../services/ota');

const router = express.Router();

async function deviceAuth(req, res, next) {
  const token = req.get('X-Node-Token');
  const node = await findNodeByToken(token);
  if (!node || node.status !== 'ACTIVE') {
    return res.status(401).json({ error: 'invalid or inactive token' });
  }
  req.node = node;
  next();
}

router.post('/ota/check', deviceAuth, async (req, res) => {
  try {
    const result = await checkUpdate(req.node, req.body || {}, req);
    res.json(result);
  } catch (err) {
    console.error('ota/check error', err);
    res.status(500).json({ error: 'check failed' });
  }
});

router.post('/ota/report', deviceAuth, async (req, res) => {
  try {
    const result = await reportUpdate(req.node, req.body || {});
    res.json(result);
  } catch (err) {
    console.error('ota/report error', err);
    res.status(500).json({ error: 'report failed' });
  }
});

router.get('/ota/bin/:fileName', (req, res) => {
  try {
    ensureFirmwareDir();
    const filePath = resolveBinPath(req.params.fileName);
    res.download(filePath);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/admin/ota/releases', async (_req, res) => {
  try {
    res.json(await listReleases());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin/ota/releases', async (req, res) => {
  try {
    const { version, moduleType, rolloutPct, fileName } = req.body || {};
    if (!version) {
      return res.status(400).json({ error: 'version required' });
    }
    const release = await registerRelease({ version, moduleType, rolloutPct, fileName }, req);
    res.status(201).json(release);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.patch('/admin/ota/releases/:id', async (req, res) => {
  try {
    const release = await setRollout(Number(req.params.id), req.body || {});
    res.json(release);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
