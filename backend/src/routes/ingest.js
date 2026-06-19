const express = require('express');
const {
  findNodeByToken,
  ingestScan,
  ingestSession,
  ingestUnassigned,
  ingestHeartbeat,
  getActiveSessionForNode,
} = require('../services/devices');
const broker = require('../services/broker');
const mqtt = require('../services/mqttClient');

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

    const payload = {
      nodeId: req.node.id,
      lineId: req.node.line_id,
      rssi: req.body.rssi,
      fwVersion: req.body.fwVersion,
      uptime: req.body.uptime,
      queueDepth: req.body.queueDepth,
      lastSeenAt: new Date().toISOString(),
    };
    broker.broadcast('node_heartbeat', payload);
    mqtt.publish(`factory/nodes/${req.node.id}/heartbeat`, payload);
  } catch (err) {
    console.error('heartbeat error', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

/** Open production session on this node (for ESP resume after reboot). */
router.get('/session/active', deviceAuth, async (req, res) => {
  try {
    const session = await getActiveSessionForNode(req.node);
    if (!session) {
      return res.json({ active: false });
    }
    res.json({ active: true, ...session });
  } catch (err) {
    console.error('session/active error', err);
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

    const payload = {
      nodeId: req.node.id,
      lineId: req.node.line_id,
      kind: body.kind,
      cardUid: body.cardUid,
      bundleId: result.bundleId,
      sessionId: result.sessionId,
      cardNumber: result.cardNumber,
      cardStatus: result.cardStatus,
      newlyRegistered: result.newlyRegistered,
    };
    broker.broadcast('scan_event', payload);
    mqtt.publish(`factory/nodes/${req.node.id}/scan`, payload);
    if (result.bundleCompleted && result.bundleId) {
      const bundlePayload = {
        bundleId: result.bundleId,
        nodeId: req.node.id,
        lineId: req.node.line_id,
        status: 'COMPLETED',
      };
      broker.broadcast('bundle_completed', bundlePayload);
      mqtt.publish(`factory/bundles/${result.bundleId}/completed`, bundlePayload);
    }
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
    if (result.skipped) {
      return;
    }

    const payload = {
      nodeId: req.node.id,
      lineId: req.node.line_id,
      type: body.type,
      sessionId: result.sessionId || body.sessionId,
      cardUid: body.cardUid,
      countPass: result.countPass ?? body.counts?.pass ?? 0,
      countCycle: result.countCycle ?? body.counts?.cycle ?? 0,
      closeReason: body.closeReason,
    };
    broker.broadcast('session_update', payload);
    mqtt.publish(`factory/nodes/${req.node.id}/session`, payload);
    if (result.bundleCompleted && result.bundleId) {
      const bundlePayload = {
        bundleId: result.bundleId,
        nodeId: req.node.id,
        lineId: req.node.line_id,
        status: 'COMPLETED',
      };
      broker.broadcast('bundle_completed', bundlePayload);
      mqtt.publish(`factory/bundles/${result.bundleId}/completed`, bundlePayload);
    }
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

    broker.broadcast('unassigned_count', {
      nodeId: req.node.id,
      lineId: req.node.line_id,
      cardUid: body.cardUid,
      countPass: body.counts?.pass ?? 0,
    });
  } catch (err) {
    console.error('unassigned error', err);
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
