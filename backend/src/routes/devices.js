const express = require('express');
const { query } = require('../db');
const {
  claimDevice,
  approveDevice,
  getDeviceConfig,
  resolveBundle,
} = require('../services/devices');

const router = express.Router();

router.post('/claim', async (req, res) => {
  try {
    const { chipId, moduleHint } = req.body || {};
    if (!chipId) {
      return res.status(400).json({ error: 'chipId required' });
    }
    const result = await claimDevice(chipId, moduleHint);
    res.json(result);
  } catch (err) {
    console.error('claim error', err);
    res.status(500).json({ error: 'claim failed' });
  }
});

router.get('/:nodeId/config', async (req, res) => {
  try {
    const token = req.get('X-Node-Token');
    const cfg = await getDeviceConfig(req.params.nodeId, token);
    res.json(cfg);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Dev/admin: approve a pending device (no RBAC yet — pilot only)
router.post('/:nodeId/approve', async (req, res) => {
  try {
    const { lineId, moduleType } = req.body || {};
    const node = await approveDevice(req.params.nodeId, { lineId, moduleType });
    res.json({
      status: 'ACTIVE',
      nodeId: node.id,
      lineId: String(node.line_id),
      moduleType: node.module_type,
      token: node.api_token,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/', async (_req, res) => {
  const { rows } = await query(
    'SELECT id, chip_id, module_type, status, fw_version, last_seen_at, rssi FROM nodes ORDER BY created_at DESC'
  );
  res.json(rows);
});

module.exports = router;
