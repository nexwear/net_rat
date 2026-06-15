const express = require('express');
const { query } = require('../db');
const { approveDevice } = require('../services/devices');
const { listAlerts, ackAlert } = require('../services/alerts');

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

// ─── Live dashboard snapshot ─────────────────────────────────────────────────

router.get('/dashboard', async (_req, res) => {
  try {
    const { rows } = await query(`
      SELECT
        l.id   AS line_id,   l.name AS line_name,
        n.id   AS node_id,   n.module_type, n.status AS node_status,
        n.last_seen_at, n.rssi, n.fw_version,
        s.id   AS session_id, s.bundle_id, s.card_uid,
        s.start_ts, s.count_pass, s.count_cycle,
        b.declared_pieces, b.status AS bundle_status
      FROM lines l
      LEFT JOIN nodes n ON n.line_id = l.id
      LEFT JOIN sessions s ON s.node_id = n.id AND s.end_ts IS NULL
      LEFT JOIN bundles b ON b.id = s.bundle_id
      ORDER BY l.id,
        CASE n.module_type
          WHEN 'INPUT'    THEN 1 WHEN 'OUTPUT_1' THEN 2
          WHEN 'OUTPUT_2' THEN 3 WHEN 'ADMIN'    THEN 4 ELSE 5 END
    `);

    const linesMap = new Map();
    for (const row of rows) {
      if (!linesMap.has(row.line_id)) {
        linesMap.set(row.line_id, { id: row.line_id, name: row.line_name, nodes: [] });
      }
      if (row.node_id) {
        linesMap.get(row.line_id).nodes.push({
          nodeId: row.node_id,
          moduleType: row.module_type,
          status: row.node_status,
          lastSeenAt: row.last_seen_at,
          rssi: row.rssi,
          fwVersion: row.fw_version,
          session: row.session_id ? {
            sessionId: row.session_id,
            bundleId: row.bundle_id,
            cardUid: row.card_uid,
            startTs: row.start_ts,
            countPass: row.count_pass ?? 0,
            countCycle: row.count_cycle ?? 0,
            declaredPieces: row.declared_pieces,
          } : null,
        });
      }
    }

    res.json(Array.from(linesMap.values()));
  } catch (err) {
    console.error('dashboard error', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Alerts ────────────────────────────────────────────────────────────────

router.get('/alerts', async (req, res) => {
  try {
    const resolved = req.query.resolved === 'true';
    const rows = await listAlerts({ resolved });
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/alerts/:id/ack', async (req, res) => {
  try {
    const alert = await ackAlert(Number(req.params.id));
    if (!alert) return res.status(404).json({ error: 'alert not found or already acked' });
    res.json(alert);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Master data ────────────────────────────────────────────────────────────

router.get('/contractors', async (_req, res) => {
  try {
    const { rows } = await query('SELECT * FROM contractors WHERE active = true ORDER BY name');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/contractors', async (req, res) => {
  try {
    const { name, code, ratePerPiece } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name required' });
    const { rows } = await query(
      `INSERT INTO contractors (name, code, rate_per_piece) VALUES ($1, $2, $3) RETURNING *`,
      [name, code || null, ratePerPiece || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/garment-models', async (_req, res) => {
  try {
    const { rows } = await query('SELECT * FROM garment_models ORDER BY style');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/garment-models', async (req, res) => {
  try {
    const { style, sam, opsCount } = req.body || {};
    if (!style) return res.status(400).json({ error: 'style required' });
    const { rows } = await query(
      `INSERT INTO garment_models (style, sam, ops_count) VALUES ($1, $2, $3) RETURNING *`,
      [style, sam || null, opsCount || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/sizes', async (_req, res) => {
  try {
    const { rows } = await query('SELECT * FROM sizes ORDER BY code');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/lines', async (_req, res) => {
  try {
    const { rows } = await query('SELECT * FROM lines ORDER BY id');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Bundles (admin view with full detail) ──────────────────────────────────

router.get('/bundles', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT b.id, b.line_id, b.declared_pieces, b.card_uid, b.status,
             b.created_at, b.pickup_at, b.size_code,
             c.name AS contractor_name, g.style AS garment_model,
             sz.label AS size_label,
             l.name AS line_name,
             card.uid AS assigned_card_uid
      FROM bundles b
      LEFT JOIN contractors c ON c.id = b.contractor_id
      LEFT JOIN garment_models g ON g.id = b.garment_model_id
      LEFT JOIN sizes sz ON sz.code = b.size_code
      LEFT JOIN lines l ON l.id = b.line_id
      LEFT JOIN cards card ON card.current_bundle_id = b.id
      ORDER BY b.created_at DESC
      LIMIT 200
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/bundles', async (req, res) => {
  try {
    const { lineId, declaredPieces, contractorId, garmentModelId, sizeCode, pickupAt } = req.body || {};
    const pieces = Number(declaredPieces);
    if (!pieces || pieces < 1) return res.status(400).json({ error: 'declaredPieces must be > 0' });

    let line = lineId;
    if (!line) {
      const { rows } = await query('SELECT id FROM lines ORDER BY id LIMIT 1');
      line = rows[0]?.id;
    }
    if (!line) return res.status(400).json({ error: 'no line configured' });

    const { rows } = await query(
      `INSERT INTO bundles (line_id, declared_pieces, contractor_id, garment_model_id, size_code, pickup_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'ISSUED')
       RETURNING id, line_id, declared_pieces, contractor_id, garment_model_id, size_code, status, created_at`,
      [line, pieces, contractorId || null, garmentModelId || null, sizeCode || null, pickupAt || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Card assignment ─────────────────────────────────────────────────────────

router.post('/bundles/:bundleId/assign-card', async (req, res) => {
  try {
    const { cardUid } = req.body || {};
    if (!cardUid) return res.status(400).json({ error: 'cardUid required' });

    const { bundleId } = req.params;

    // Check bundle exists
    const { rows: bundles } = await query('SELECT id FROM bundles WHERE id = $1', [bundleId]);
    if (!bundles.length) return res.status(404).json({ error: 'bundle not found' });

    // Check card not already in use on another bundle
    const { rows: existing } = await query(
      `SELECT current_bundle_id FROM cards WHERE uid = $1`,
      [cardUid]
    );
    if (existing.length > 0 && existing[0].current_bundle_id && existing[0].current_bundle_id !== bundleId) {
      return res.status(409).json({ error: 'card already assigned to another bundle' });
    }

    // Upsert card and assign
    await query(
      `INSERT INTO cards (uid, family, status, current_bundle_id)
       VALUES ($1, 'UNKNOWN', 'IN_USE', $2)
       ON CONFLICT (uid) DO UPDATE
       SET status = 'IN_USE', current_bundle_id = $2`,
      [cardUid, bundleId]
    );

    await query(
      `UPDATE bundles SET card_uid = $1 WHERE id = $2`,
      [cardUid, bundleId]
    );

    res.json({ ok: true, bundleId, cardUid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/bundles/:bundleId/release-card', async (req, res) => {
  try {
    const { bundleId } = req.params;
    const { rows } = await query('SELECT card_uid FROM bundles WHERE id = $1', [bundleId]);
    const cardUid = rows[0]?.card_uid;
    if (cardUid) {
      await query(`UPDATE cards SET status = 'AVAILABLE', current_bundle_id = NULL WHERE uid = $1`, [cardUid]);
    }
    await query(`UPDATE bundles SET card_uid = NULL WHERE id = $1`, [bundleId]);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
