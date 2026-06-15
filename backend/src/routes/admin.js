const express = require('express');
const { query } = require('../db');
const { approveDevice } = require('../services/devices');

const router = express.Router();

const VALID_OP_TYPES = ['SET_MODULE_TYPE', 'SET_WIFI', 'FACTORY_RESET', 'FORCE_OTA_CHECK'];

function adminAuth(req, res, next) {
  const secret = process.env.ADMIN_SECRET;
  if (secret && req.get('Authorization') !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'admin auth required' });
  }
  next();
}

router.use(adminAuth);

router.get('/nodes', async (_req, res) => {
  try {
    const { rows } = await query(`
      SELECT
        n.id, n.chip_id, n.module_type, n.status, n.fw_version,
        n.last_seen_at, n.rssi, n.flags, n.line_id, n.created_at,
        n.pending_op, n.pending_op_at,
        h.uptime, h.queue_depth
      FROM nodes n
      LEFT JOIN LATERAL (
        SELECT uptime, queue_depth
        FROM heartbeats
        WHERE node_id = n.id
        ORDER BY ts DESC
        LIMIT 1
      ) h ON true
      ORDER BY n.created_at DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error('admin/nodes error', err);
    res.status(500).json({ error: err.message });
  }
});

router.post('/nodes/:nodeId/approve', async (req, res) => {
  try {
    const { lineId, moduleType } = req.body || {};
    const node = await approveDevice(req.params.nodeId, { lineId, moduleType });
    res.json({
      status: 'ACTIVE',
      nodeId: node.id,
      lineId: String(node.line_id || ''),
      moduleType: node.module_type,
      token: node.api_token,
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/nodes/:nodeId/reconfig', async (req, res) => {
  try {
    const { type, moduleType, wifi } = req.body || {};

    if (!type || !VALID_OP_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${VALID_OP_TYPES.join(', ')}` });
    }

    if (type === 'SET_MODULE_TYPE') {
      const valid = ['INPUT', 'OUTPUT_1', 'OUTPUT_2', 'ADMIN'];
      if (!moduleType || !valid.includes(moduleType)) {
        return res.status(400).json({ error: `moduleType must be one of: ${valid.join(', ')}` });
      }
    }

    if (type === 'SET_WIFI') {
      if (!Array.isArray(wifi) || wifi.length === 0 || !wifi[0].ssid) {
        return res.status(400).json({ error: 'wifi must be [{ssid, pass}, ...]' });
      }
    }

    const op = { type };
    if (type === 'SET_MODULE_TYPE') op.moduleType = moduleType;
    if (type === 'SET_WIFI') op.wifi = wifi.map((w) => ({ s: w.ssid, p: w.pass || '' }));

    const { rows } = await query(
      `UPDATE nodes SET pending_op = $1, pending_op_at = NOW()
       WHERE id = $2 RETURNING id, pending_op, pending_op_at`,
      [JSON.stringify(op), req.params.nodeId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'node not found' });
    }

    res.json({ ok: true, nodeId: rows[0].id, pendingOp: rows[0].pending_op });
  } catch (err) {
    console.error('admin/reconfig error', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
