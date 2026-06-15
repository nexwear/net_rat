const express = require('express');
const { findNodeByToken, ingestScan, ingestSession, ingestUnassigned, ingestHeartbeat } =
  require('../services/devices');

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

router.post('/heartbeat', deviceAuth, async (req, res) => {
  try {
    const result = await ingestHeartbeat(req.node, req.body || {});
    res.json(result);
  } catch (err) {
    console.error('heartbeat error', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/scan', deviceAuth, async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.eventId || !body.cardUid || !body.kind) {
      return res.status(400).json({ error: 'eventId, cardUid, kind required' });
    }
    const result = await ingestScan(req.node, body);
    res.json(result);
  } catch (err) {
    console.error('scan error', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/session', deviceAuth, async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.sessionId || !body.type) {
      return res.status(400).json({ error: 'sessionId and type required' });
    }
    const result = await ingestSession(req.node, body);
    res.json(result);
  } catch (err) {
    console.error('session error', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/unassigned', deviceAuth, async (req, res) => {
  try {
    const body = req.body || {};
    if (!body.eventId) {
      return res.status(400).json({ error: 'eventId required' });
    }
    const result = await ingestUnassigned(req.node, body);
    res.json(result);
  } catch (err) {
    console.error('unassigned error', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
