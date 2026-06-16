const express = require('express');
const { query } = require('../db');
const { approveDevice, ensureCardRegistered, lookupCard } = require('../services/devices');
const { listAlerts, ackAlert } = require('../services/alerts');
const {
  getAdminReaderStatus,
  setAdminReaderMode,
} = require('../services/adminReaderMode');
const { jwtAuth, requirePerm } = require('../middleware/rbac');
const training = require('../services/training');

const router = express.Router();
const VALID_OP_TYPES = ['SET_MODULE_TYPE', 'SET_WIFI', 'FACTORY_RESET', 'FORCE_OTA_CHECK'];

// All admin routes require authentication
router.use(jwtAuth);

// Sensitive calibration actions are SUPER_ADMIN-only.
function requireSuperAdmin(req, res, next) {
  if (req.user?.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ error: 'SUPER_ADMIN required' });
  }
  next();
}

router.get('/nodes', async (_req, res) => {
  try {
    const { rows } = await query(`
      SELECT
        n.id, n.chip_id, n.module_type, n.status, n.fw_version,
        n.last_seen_at, n.rssi, n.flags, n.line_id, n.created_at,
        n.pending_op, n.pending_op_at, n.label,
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

router.post('/nodes/:nodeId/approve', requirePerm('nodes.config'), async (req, res) => {
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

router.post('/nodes/:nodeId/reconfig', requirePerm('nodes.config'), async (req, res) => {
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

    const sets = ['pending_op = $1', 'pending_op_at = NOW()'];
    const params = [JSON.stringify(op), req.params.nodeId];
    if (type === 'SET_MODULE_TYPE') {
      sets.push(`module_type = $3::module_type`);
      params.push(moduleType);
    }

    const { rows } = await query(
      `UPDATE nodes SET ${sets.join(', ')}
       WHERE id = $2 RETURNING id, module_type, pending_op, pending_op_at`,
      params
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

// ─── Dashboard aggregate stats ───────────────────────────────────────────────

router.get('/dashboard/stats', async (_req, res) => {
  try {
    const [bRow, sRow, lineRows, ctrRows, nRow, aRow] = await Promise.all([

      // Bundle status counts + completed-today via session end_ts
      query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'ISSUED')      AS issued,
          COUNT(*) FILTER (WHERE status = 'IN_PROGRESS') AS in_progress,
          COUNT(*) FILTER (WHERE status = 'COMPLETED')   AS completed,
          COUNT(*) FILTER (WHERE status = 'LOST')        AS lost,
          (SELECT COUNT(*) FROM bundles b2
           WHERE b2.status = 'COMPLETED'
           AND EXISTS (
             SELECT 1 FROM sessions s2
             WHERE s2.bundle_id = b2.id AND s2.end_ts >= CURRENT_DATE
           )
          ) AS completed_today
        FROM bundles
      `),

      // Today's piece counts
      query(`
        SELECT
          COALESCE(SUM(count_pass) FILTER (WHERE module_type = 'INPUT'), 0)                 AS input_today,
          COALESCE(SUM(count_pass) FILTER (WHERE module_type IN ('OUTPUT_1','OUTPUT_2')), 0) AS output_today
        FROM sessions
        WHERE start_ts >= CURRENT_DATE
      `),

      // Per-line aggregates (all time)
      query(`
        SELECT
          l.id, l.name,
          COUNT(DISTINCT b.id) FILTER (WHERE b.status = 'IN_PROGRESS') AS active_bundles,
          COUNT(DISTINCT b.id) FILTER (WHERE b.status = 'COMPLETED')   AS completed_bundles,
          COALESCE(SUM(s.count_pass) FILTER (WHERE s.module_type = 'INPUT'), 0)                 AS input_pieces,
          COALESCE(SUM(s.count_pass) FILTER (WHERE s.module_type IN ('OUTPUT_1','OUTPUT_2')), 0) AS output_pieces,
          COUNT(DISTINCT n.id) FILTER (WHERE n.status = 'ACTIVE')      AS total_nodes,
          COUNT(DISTINCT n.id) FILTER (
            WHERE n.status = 'ACTIVE' AND n.last_seen_at > NOW() - INTERVAL '30 seconds'
          ) AS active_nodes
        FROM lines l
        LEFT JOIN nodes n ON n.line_id = l.id
        LEFT JOIN bundles b ON b.line_id = l.id
        LEFT JOIN sessions s ON s.bundle_id = b.id
        GROUP BY l.id, l.name
        ORDER BY l.id
      `),

      // Per-contractor aggregates
      query(`
        SELECT
          c.id, c.name AS contractor_name, c.code,
          COUNT(DISTINCT b.id)                                              AS bundles_assigned,
          COUNT(DISTINCT b.id) FILTER (WHERE b.status = 'COMPLETED')       AS bundles_completed,
          COUNT(DISTINCT b.id) FILTER (WHERE b.status = 'IN_PROGRESS')     AS bundles_active,
          COALESCE(SUM(b.declared_pieces), 0)                              AS declared_pieces,
          COALESCE(SUM(s.count_pass) FILTER (WHERE s.module_type = 'INPUT'), 0)                 AS input_pieces,
          COALESCE(SUM(s.count_pass) FILTER (WHERE s.module_type IN ('OUTPUT_1','OUTPUT_2')), 0) AS output_pieces
        FROM contractors c
        INNER JOIN bundles b ON b.contractor_id = c.id
        LEFT JOIN sessions s ON s.bundle_id = b.id
        GROUP BY c.id, c.name, c.code
        ORDER BY bundles_assigned DESC
      `),

      // Node health counts
      query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'ACTIVE')  AS total,
          COUNT(*) FILTER (
            WHERE status = 'ACTIVE' AND last_seen_at > NOW() - INTERVAL '30 seconds'
          ) AS active,
          COUNT(*) FILTER (
            WHERE status = 'ACTIVE'
            AND last_seen_at BETWEEN NOW() - INTERVAL '120 seconds' AND NOW() - INTERVAL '30 seconds'
          ) AS stale,
          COUNT(*) FILTER (
            WHERE status = 'ACTIVE'
            AND (last_seen_at IS NULL OR last_seen_at < NOW() - INTERVAL '120 seconds')
          ) AS offline,
          COUNT(*) FILTER (WHERE status = 'PENDING') AS pending
        FROM nodes
      `),

      // Alert counts
      query(`
        SELECT
          COUNT(*) FILTER (WHERE resolved_at IS NULL)                             AS open,
          COUNT(*) FILTER (WHERE resolved_at IS NULL AND severity = 'HIGH')       AS high_severity,
          COUNT(*) FILTER (WHERE resolved_at IS NULL AND acknowledged_at IS NULL)  AS unacknowledged
        FROM alerts
      `),
    ]);

    res.json({
      bundles:     bRow.rows[0],
      sessions:    sRow.rows[0],
      lines:       lineRows.rows,
      contractors: ctrRows.rows,
      nodes:       nRow.rows[0],
      alerts:      aRow.rows[0],
    });
  } catch (err) {
    console.error('dashboard/stats error', err);
    res.status(500).json({ error: err.message });
  }
});

// ─── Live dashboard snapshot ─────────────────────────────────────────────────

router.get('/dashboard', async (_req, res) => {
  try {
    const { rows } = await query(`
      SELECT * FROM (
        SELECT DISTINCT ON (n.id)
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
        ORDER BY n.id, s.start_ts DESC NULLS LAST
      ) sub
      ORDER BY line_id,
        CASE module_type
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

router.post('/alerts/:id/ack', requirePerm('alerts.manage'), async (req, res) => {
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

router.post('/contractors', requirePerm('master.manage'), async (req, res) => {
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

router.post('/garment-models', requirePerm('master.manage'), async (req, res) => {
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

// ─── Card Registry ───────────────────────────────────────────────────────────

router.get('/cards', async (_req, res) => {
  try {
    const { rows } = await query(`
      SELECT c.uid, c.card_number, c.label, c.status, c.registered_at,
             c.current_bundle_id,
             b.status AS bundle_status, b.declared_pieces,
             cnt.name AS contractor_name,
             l.name AS line_name
      FROM cards c
      LEFT JOIN bundles b ON b.id = c.current_bundle_id
      LEFT JOIN contractors cnt ON cnt.id = b.contractor_id
      LEFT JOIN lines l ON l.id = b.line_id
      ORDER BY c.card_number NULLS LAST, c.uid
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Must be before /:uid to avoid route collision
router.get('/cards/available', async (_req, res) => {
  try {
    const { rows } = await query(`
      SELECT uid, card_number, label, status
      FROM cards WHERE status = 'AVAILABLE'
      ORDER BY card_number NULLS LAST, uid
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/cards', requirePerm('cards.pool'), async (req, res) => {
  try {
    const { uid, cardNumber, label } = req.body || {};
    if (!uid) return res.status(400).json({ error: 'uid required' });

    const normalized = uid.trim().toUpperCase();
    const { rows: existing } = await query(
      'SELECT uid, card_number, label, status, current_bundle_id FROM cards WHERE uid = $1',
      [normalized]
    );
    if (existing.length > 0) {
      if (label) {
        await query('UPDATE cards SET label = $2 WHERE uid = $1', [normalized, label.trim()]);
        existing[0].label = label.trim();
      }
      return res.json(existing[0]);
    }

    let num = cardNumber != null ? Number(cardNumber) : null;
    if (num == null) {
      const card = await ensureCardRegistered(normalized);
      if (label) {
        await query('UPDATE cards SET label = $2 WHERE uid = $1', [normalized, label.trim()]);
        card.label = label.trim();
      }
      return res.status(201).json(card);
    }

    const { rows } = await query(
      `INSERT INTO cards (uid, family, status, card_number, label)
       VALUES ($1, 'UNKNOWN', 'AVAILABLE', $2, $3)
       RETURNING uid, card_number, label, status`,
      [normalized, num, label || null]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'card number already taken' });
    res.status(500).json({ error: err.message });
  }
});

router.post('/cards/register-range', requirePerm('cards.pool'), async (req, res) => {
  try {
    const { uids, startNumber, labels } = req.body || {};
    if (!Array.isArray(uids) || uids.length === 0) {
      return res.status(400).json({ error: 'uids array required' });
    }

    let start = Number(startNumber);
    if (!start) {
      const { rows } = await query('SELECT COALESCE(MAX(card_number), 0) + 1 AS next FROM cards');
      start = rows[0].next;
    }

    const results = [];
    for (let i = 0; i < uids.length; i++) {
      const uid = uids[i]?.trim().toUpperCase();
      if (!uid) continue;
      const num = start + i;
      const lbl = Array.isArray(labels) ? (labels[i] || null) : null;
      try {
        const { rows } = await query(
          `INSERT INTO cards (uid, family, status, card_number, label)
           VALUES ($1, 'UNKNOWN', 'AVAILABLE', $2, $3)
           ON CONFLICT (uid) DO UPDATE SET card_number = $2, label = COALESCE($3, cards.label)
           RETURNING uid, card_number, label, status`,
          [uid, num, lbl]
        );
        results.push({ ...rows[0], ok: true });
      } catch (e) {
        results.push({ uid, card_number: num, ok: false, error: e.message });
      }
    }

    res.json({ registered: results.filter((r) => r.ok).length, total: uids.length, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/cards/:uid', requirePerm('cards.pool'), async (req, res) => {
  try {
    const { cardNumber, label } = req.body || {};
    const uid = req.params.uid.toUpperCase();
    const sets = [];
    const vals = [uid];
    if (cardNumber != null) { vals.push(Number(cardNumber)); sets.push(`card_number = $${vals.length}`); }
    if (label      != null) { vals.push(label);              sets.push(`label = $${vals.length}`); }
    if (!sets.length) return res.status(400).json({ error: 'nothing to update' });

    const { rows } = await query(
      `UPDATE cards SET ${sets.join(', ')} WHERE uid = $1 RETURNING uid, card_number, label, status`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: 'card not found' });
    res.json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'card number already taken' });
    res.status(500).json({ error: err.message });
  }
});

router.post('/cards/:uid/release', requirePerm('cards.pool'), async (req, res) => {
  try {
    const uid = req.params.uid.toUpperCase();
    const { rows: card } = await query('SELECT current_bundle_id FROM cards WHERE uid = $1', [uid]);
    if (!card.length) return res.status(404).json({ error: 'card not found' });

    if (card[0].current_bundle_id) {
      await query('UPDATE bundles SET card_uid = NULL WHERE id = $1', [card[0].current_bundle_id]);
    }
    const { rows } = await query(
      `UPDATE cards SET status = 'AVAILABLE', current_bundle_id = NULL WHERE uid = $1
       RETURNING uid, card_number, label, status`,
      [uid]
    );
    res.json(rows[0]);
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

// Single bundle detail + all stage sessions (for tracking modal)
router.get('/bundles/:bundleId', async (req, res) => {
  try {
    const { rows: b } = await query(`
      SELECT b.*,
             c.name AS contractor_name, g.style AS garment_model,
             sz.label AS size_label, l.name AS line_name,
             card.uid AS assigned_card_uid,
             card.card_number AS assigned_card_number,
             card.label AS assigned_card_label
      FROM bundles b
      LEFT JOIN contractors c ON c.id = b.contractor_id
      LEFT JOIN garment_models g ON g.id = b.garment_model_id
      LEFT JOIN sizes sz ON sz.code = b.size_code
      LEFT JOIN lines l ON l.id = b.line_id
      LEFT JOIN cards card ON card.current_bundle_id = b.id
      WHERE b.id = $1
    `, [req.params.bundleId]);
    if (!b.length) return res.status(404).json({ error: 'bundle not found' });

    const { rows: sessions } = await query(`
      SELECT s.id, s.module_type, s.node_id, s.card_uid,
             s.start_ts, s.end_ts, s.count_pass, s.count_cycle, s.close_reason
      FROM sessions s
      WHERE s.bundle_id = $1
      ORDER BY
        CASE s.module_type
          WHEN 'INPUT' THEN 1 WHEN 'OUTPUT_1' THEN 2
          WHEN 'OUTPUT_2' THEN 3 ELSE 4 END,
        s.start_ts ASC
    `, [req.params.bundleId]);

    res.json({ bundle: b[0], sessions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/bundles', async (req, res) => {
  try {
    const { rows } = await query(`
      SELECT b.id, b.line_id, b.declared_pieces, b.card_uid, b.status,
             b.created_at, b.pickup_at, b.size_code,
             c.name AS contractor_name, g.style AS garment_model,
             sz.label AS size_label,
             l.name AS line_name,
             card.uid AS assigned_card_uid,
             card.card_number AS assigned_card_number,
             card.label AS assigned_card_label
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

// ─── Admin NFC reader mode (Cards register vs Bundles assign) ────────────────

router.get('/admin-reader/mode', async (_req, res) => {
  res.json(getAdminReaderStatus());
});

router.post('/admin-reader/mode', async (req, res) => {
  try {
    const { mode } = req.body || {};
    const result = setAdminReaderMode(mode, req.user?.id ?? req.user?.email ?? null);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// ─── Card assignment ─────────────────────────────────────────────────────────

router.post('/bundles/:bundleId/assign-card', async (req, res) => {
  try {
    const { cardUid, cardNumber } = req.body || {};
    let uid = cardUid ? cardUid.trim().toUpperCase() : null;

    // Resolve by card number if no uid provided
    if (!uid && cardNumber != null) {
      const { rows } = await query(
        'SELECT uid, status FROM cards WHERE card_number = $1',
        [Number(cardNumber)]
      );
      if (!rows.length) return res.status(404).json({ error: `Card #${cardNumber} is not registered` });
      if (rows[0].status !== 'AVAILABLE') {
        return res.status(409).json({ error: `Card #${String(cardNumber).padStart(3,'0')} is ${rows[0].status} — not available` });
      }
      uid = rows[0].uid;
    }

    if (!uid) return res.status(400).json({ error: 'cardUid or cardNumber required' });

    const card = await lookupCard(uid);
    if (!card) {
      return res.status(404).json({
        error: 'Card not registered — register it on the Cards tab first',
      });
    }

    const { bundleId } = req.params;
    const { rows: bundles } = await query('SELECT id FROM bundles WHERE id = $1', [bundleId]);
    if (!bundles.length) return res.status(404).json({ error: 'bundle not found' });

    if (card.current_bundle_id && card.current_bundle_id !== bundleId) {
      return res.status(409).json({ error: 'card is already assigned to another bundle' });
    }
    if (card.status === 'IN_USE' && card.current_bundle_id && card.current_bundle_id !== bundleId) {
      return res.status(409).json({ error: 'card is currently IN_USE' });
    }

    await query(
      `UPDATE cards SET status = 'IN_USE', current_bundle_id = $2 WHERE uid = $1`,
      [uid, bundleId]
    );
    await query('UPDATE bundles SET card_uid = $1 WHERE id = $2', [uid, bundleId]);

    res.json({
      ok: true,
      bundleId,
      cardUid: uid,
      cardNumber: card.card_number,
      label: card.label,
      newlyRegistered: card.newlyRegistered ?? false,
    });
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

// Wipe operational data (cards, nodes, bundles, scans). SUPER_ADMIN only.
router.post('/db/clear', async (req, res) => {
  try {
    if (req.user?.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'SUPER_ADMIN required' });
    }
    if (req.body?.confirm !== 'CLEAR') {
      return res.status(400).json({ error: 'send { "confirm": "CLEAR" }' });
    }
    await query(`
      TRUNCATE TABLE
        count_samples,
        sessions,
        scan_events,
        unassigned_counts,
        heartbeats,
        ota_events,
        alerts,
        device_tokens,
        ppp_training_marks,
        ppp_training,
        bundles,
        cards,
        nodes,
        ppp_calibration
      RESTART IDENTITY CASCADE
    `);
    res.json({ ok: true, cleared: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PPP training (supervised calibration) ───────────────────────────────────
// SUPER_ADMIN taps "piece completed" per garment while an operator sews; the
// per-piece rotation deltas are reduced to a pulses-per-piece value that seeds
// ppp_calibration. See services/training.js.

// Live snapshot for a node (current session counts + active run, for polling).
router.get('/training/live/:nodeId', requireSuperAdmin, async (req, res) => {
  try {
    res.json(await training.getLiveForNode(req.params.nodeId));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Current saved calibration for a style+size+module (before/after display).
router.get('/training/calibration', requireSuperAdmin, async (req, res) => {
  try {
    const { garmentModelId, sizeCode, moduleType } = req.query;
    if (!moduleType) return res.status(400).json({ error: 'moduleType required' });
    const cal = await training.getCalibration(
      Number(garmentModelId) || 0,
      Number(sizeCode) || 0,
      moduleType
    );
    res.json(cal || null);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Batch recalibration from all historical data. apply=false → dry-run preview.
router.post('/training/recompute', requireSuperAdmin, async (req, res) => {
  try {
    const apply = req.body?.apply === true;
    const includeDeclared = req.body?.includeDeclared === true;
    res.json(await training.recalibrateFromHistory({ apply, includeDeclared }));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/training/start', requireSuperAdmin, async (req, res) => {
  try {
    const { nodeId, garmentModelId, sizeCode } = req.body || {};
    if (!nodeId) return res.status(400).json({ error: 'nodeId required' });
    res.json(
      await training.startTraining({
        nodeId,
        garmentModelId: Number(garmentModelId) || 0,
        sizeCode: Number(sizeCode) || 0,
      })
    );
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/training/:id', requireSuperAdmin, async (req, res) => {
  try {
    res.json(await training.getTrainingState(req.params.id));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/training/:id/mark', requireSuperAdmin, async (req, res) => {
  try {
    res.json(await training.markPiece(req.params.id));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/training/:id/undo', requireSuperAdmin, async (req, res) => {
  try {
    res.json(await training.undoMark(req.params.id));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.post('/training/:id/finish', requireSuperAdmin, async (req, res) => {
  try {
    const save = req.body?.save !== false; // default: save
    res.json(await training.finishTraining(req.params.id, save));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
