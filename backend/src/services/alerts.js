const { query } = require('../db');
const push = require('./push');

async function raiseAlert(type, { lineId, nodeId, detail, dedupKey, severity = 'MED' } = {}) {
  let id;
  if (dedupKey) {
    const { rows } = await query(
      `INSERT INTO alerts (type, line_id, node_id, severity, detail, dedup_key)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (dedup_key) DO NOTHING
       RETURNING id`,
      [type, lineId || null, nodeId || null, severity, detail || null, dedupKey]
    );
    id = rows[0]?.id || null;
  } else {
    const { rows } = await query(
      `INSERT INTO alerts (type, line_id, node_id, severity, detail)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [type, lineId || null, nodeId || null, severity, detail || null]
    );
    id = rows[0]?.id || null;
  }

  // Only push for genuinely new alerts (deduped ones return null). Fire-and-
  // forget so a slow FCM call never blocks ingest.
  if (id) {
    push.sendAlert({ id, type, severity, detail, lineId, nodeId }).catch(() => {});
  }
  return id;
}

async function resolveAlert(dedupKey) {
  await query(
    `UPDATE alerts SET resolved_at = NOW() WHERE dedup_key = $1 AND resolved_at IS NULL`,
    [dedupKey]
  );
}

async function listAlerts({ resolved = false, limit = 200 } = {}) {
  const { rows } = await query(
    `SELECT * FROM alerts
     WHERE ($1::boolean OR resolved_at IS NULL)
     ORDER BY raised_at DESC
     LIMIT $2`,
    [resolved, limit]
  );
  return rows;
}

async function ackAlert(id, userId) {
  const { rows } = await query(
    `UPDATE alerts SET acknowledged_by = $2, acknowledged_at = NOW()
     WHERE id = $1 AND acknowledged_at IS NULL
     RETURNING *`,
    [id, userId || null]
  );
  return rows[0] || null;
}

module.exports = { raiseAlert, resolveAlert, listAlerts, ackAlert };
