const { query } = require('../db');
const { raiseAlert, resolveAlert } = require('./alerts');

const THRESHOLD_MS = 45 * 1000;
const INTERVAL_MS = 30 * 1000;

function inShift(shiftStart, shiftEnd, now) {
  if (!shiftStart || !shiftEnd) return true; // no shift config = always active
  const pad = (n) => String(n).padStart(2, '0');
  const hhmm = `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}`;
  return hhmm >= shiftStart.slice(0, 5) && hhmm <= shiftEnd.slice(0, 5);
}

async function tick() {
  try {
    const now = new Date();

    const { rows: nodes } = await query(`
      SELECT n.id, n.line_id, n.last_seen_at,
             l.shift_start, l.shift_end
      FROM nodes n
      LEFT JOIN lines l ON l.id = n.line_id
      WHERE n.status = 'ACTIVE'
    `);

    for (const node of nodes) {
      if (!inShift(node.shift_start, node.shift_end, now)) continue;

      const ageMs = node.last_seen_at ? now - new Date(node.last_seen_at) : Infinity;
      const stale = ageMs > THRESHOLD_MS;
      const dedupKey = `down:${node.id}`;

      if (stale) {
        const ageSec = Math.round(ageMs / 1000);
        await raiseAlert('NODE_DOWN', {
          lineId: node.line_id,
          nodeId: node.id,
          detail: `No heartbeat for ${ageSec}s`,
          dedupKey,
          severity: 'HIGH',
        });
      } else {
        const { rows: open } = await query(
          `SELECT id FROM alerts WHERE dedup_key = $1 AND resolved_at IS NULL LIMIT 1`,
          [dedupKey]
        );
        if (open.length > 0) {
          await resolveAlert(dedupKey);
          await raiseAlert('NODE_RECOVERED', {
            lineId: node.line_id,
            nodeId: node.id,
            detail: `Node came back online`,
            severity: 'LOW',
          });
        }
      }
    }

    // Escalate unacked NODE_DOWN older than 10 min
    await query(`
      UPDATE alerts
      SET detail = CONCAT(detail, ' [ESCALATED]')
      WHERE type = 'NODE_DOWN'
        AND resolved_at IS NULL
        AND acknowledged_at IS NULL
        AND raised_at < NOW() - INTERVAL '10 minutes'
        AND detail NOT LIKE '%[ESCALATED]%'
    `);
  } catch (err) {
    console.error('[OfflineWatcher] error:', err.message);
  }
}

function start() {
  tick();
  return setInterval(tick, INTERVAL_MS);
}

module.exports = { start };
