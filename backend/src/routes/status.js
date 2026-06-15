const express = require('express');
const { query } = require('../db');

const router = express.Router();

router.get('/status', async (_req, res) => {
  const [nodes, heartbeats, sessions, scans, bundles] = await Promise.all([
    query(
      `SELECT id, chip_id, module_type, status, fw_version, last_seen_at, rssi
       FROM nodes ORDER BY last_seen_at DESC NULLS LAST`
    ),
    query(
      `SELECT DISTINCT ON (node_id) node_id, rssi, uptime, fw_version, queue_depth, ts
       FROM heartbeats ORDER BY node_id, ts DESC`
    ),
    query(
      `SELECT s.id, s.bundle_id, s.card_uid, s.module_type, s.node_id,
              s.count_pass, s.count_cycle, s.start_ts, s.end_ts, s.close_reason
       FROM sessions s ORDER BY COALESCE(s.end_ts, s.start_ts) DESC NULLS LAST LIMIT 20`
    ),
    query(
      `SELECT event_id, node_id, card_uid, kind, bundle_id, ts
       FROM scan_events ORDER BY ts DESC LIMIT 20`
    ),
    query(
      `SELECT id, declared_pieces, card_uid, status, created_at
       FROM bundles ORDER BY created_at DESC LIMIT 10`
    ),
  ]);

  res.json({
    nodes: nodes.rows,
    latestHeartbeats: heartbeats.rows,
    recentSessions: sessions.rows,
    recentScans: scans.rows,
    recentBundles: bundles.rows,
  });
});

router.get('/scans/recent', async (req, res) => {
  const kind = req.query.kind || 'ASSIGN_SCAN';
  const minutes = Number(req.query.minutes) || 10;
  const { rows } = await query(
    `SELECT event_id, node_id, card_uid, kind, bundle_id, ts
     FROM scan_events
     WHERE kind = $1::scan_kind AND ts > NOW() - ($2 || ' minutes')::interval
     ORDER BY ts DESC`,
    [kind, minutes]
  );
  res.json(rows);
});

module.exports = router;
