const crypto = require('crypto');
const { query } = require('../db');
const { raiseAlert } = require('./alerts');

function makeToken(prefix = 'tok') {
  return `${prefix}_${crypto.randomBytes(24).toString('hex')}`;
}

function makeNodeId(chipId, moduleHint) {
  const suffix = chipId.slice(-6).toUpperCase();
  const mod = (moduleHint || 'INPUT').replace(/[^A-Z0-9_]/gi, '').slice(0, 12);
  return `${mod}-${suffix}`;
}

async function findNodeByToken(token) {
  if (!token) return null;
  const { rows } = await query(
    'SELECT * FROM nodes WHERE api_token = $1 LIMIT 1',
    [token]
  );
  return rows[0] || null;
}

async function claimDevice(chipId, moduleHint, label) {
  const existing = await query('SELECT * FROM nodes WHERE chip_id = $1', [chipId]);
  let node;
  const lbl = label && label.trim() ? label.trim() : null;

  if (existing.rowCount > 0) {
    node = existing.rows[0];
    const tempToken = makeToken('tmp');
    await query(
      `UPDATE nodes SET api_token = $1, status = 'PENDING',
         module_type = COALESCE($2::module_type, module_type),
         label = COALESCE($4, label)
       WHERE id = $3`,
      [tempToken, moduleHint || null, node.id, lbl]
    );
    node.api_token = tempToken;
    node.status = 'PENDING';
  } else {
    const nodeId = makeNodeId(chipId, moduleHint);
    const tempToken = makeToken('tmp');
    const mod = moduleHint || 'INPUT';
    const { rows } = await query(
      `INSERT INTO nodes (id, chip_id, module_type, api_token, status, label)
       VALUES ($1, $2, $3::module_type, $4, 'PENDING', $5)
       RETURNING *`,
      [nodeId, chipId, mod, tempToken, lbl]
    );
    node = rows[0];
  }

  if (process.env.AUTO_APPROVE_DEVICES === 'true') {
    node = await approveDevice(node.id, {
      moduleType: moduleHint || node.module_type || 'INPUT',
    });
  }

  return { nodeId: node.id, tempToken: node.api_token };
}

async function approveDevice(nodeId, { lineId, moduleType } = {}) {
  const line =
    lineId ||
    process.env.DEFAULT_LINE_ID ||
    (await query('SELECT id FROM lines ORDER BY id LIMIT 1')).rows[0]?.id;

  const token = makeToken('tok');
  const mod = moduleType || 'INPUT';

  const { rows } = await query(
    `UPDATE nodes
     SET status = 'ACTIVE', api_token = $1, line_id = $2, module_type = $3::module_type
     WHERE id = $4
     RETURNING *`,
    [token, line, mod, nodeId]
  );

  if (rows.length === 0) {
    const err = new Error('Node not found');
    err.status = 404;
    throw err;
  }
  return rows[0];
}

async function getDeviceConfig(nodeId, token) {
  const { rows } = await query(
    'SELECT n.*, l.factory_id FROM nodes n LEFT JOIN lines l ON l.id = n.line_id WHERE n.id = $1 AND n.api_token = $2',
    [nodeId, token]
  );
  const node = rows[0];
  if (!node) {
    const err = new Error('Not found');
    err.status = 404;
    throw err;
  }

  if (node.status === 'PENDING') {
    return { status: 'PENDING' };
  }

  return {
    status: 'ACTIVE',
    nodeId: node.id,
    lineId: String(node.line_id || ''),
    factoryId: String(node.factory_id || process.env.DEFAULT_FACTORY_ID || '1'),
    moduleType: node.module_type,
    token: node.api_token,
    otaHrs: 6,
  };
}

async function resolveBundle(cardUid) {
  const { rows } = await query(
    'SELECT current_bundle_id FROM cards WHERE uid = $1',
    [cardUid]
  );
  return rows[0]?.current_bundle_id || null;
}

/** Register UID in the card pool if missing; always returns card_number when possible. */
async function ensureCardRegistered(cardUid) {
  const uid = (cardUid || '').trim().toUpperCase();
  if (!uid) return null;

  const { rows } = await query(
    'SELECT uid, card_number, label, status, current_bundle_id FROM cards WHERE uid = $1',
    [uid]
  );
  if (rows.length > 0) {
    return { ...rows[0], newlyRegistered: false };
  }

  const { rows: next } = await query('SELECT COALESCE(MAX(card_number), 0) + 1 AS next FROM cards');
  const num = next[0].next;
  const { rows: ins } = await query(
    `INSERT INTO cards (uid, family, status, card_number)
     VALUES ($1, 'UNKNOWN', 'AVAILABLE', $2)
     RETURNING uid, card_number, label, status, current_bundle_id`,
    [uid, num]
  );
  return { ...ins[0], newlyRegistered: true };
}

// ─── Pulses-per-piece (PPP) calibration ──────────────────────────────────────
// INPUT / OUTPUT_1 estimate pieces as (motor rotations / PPP). PPP is learned
// per garment style + size + operation and corrected against the OUTPUT_2
// ground-truth count when a bundle finishes the line.

const DEFAULT_PPP = 400;

// Resolve the best PPP for a bundle's style+size at a given station, falling
// back: exact (style+size) → style average → global → hard default.
async function lookupPpp(garmentModelId, sizeCode, moduleType) {
  const gm = garmentModelId || 0;
  const size = sizeCode || 0;
  const { rows } = await query(
    `SELECT pulses_per_piece
       FROM ppp_calibration
      WHERE module_type = $3
        AND garment_model_id IN ($1, 0)
        AND size_code IN ($2, 0)
        AND sample_count > 0
      ORDER BY (garment_model_id = $1) DESC, (size_code = $2) DESC, sample_count DESC
      LIMIT 1`,
    [gm, size, moduleType]
  );
  return rows[0]?.pulses_per_piece || DEFAULT_PPP;
}

// Reconcile PPP using the OUTPUT_2 ground-truth count. For each upstream
// station that recorded raw rotations (count_cycle) on this bundle, fold
// rotations/trueCount into the rolling average for its style+size+operation.
// LEAST(sample_count, 50) caps the window so the estimate stays adaptive.
async function reconcilePpp(bundleId, trueCount) {
  if (!bundleId || !trueCount || trueCount <= 0) return;

  const { rows: bRows } = await query(
    'SELECT garment_model_id, size_code FROM bundles WHERE id = $1',
    [bundleId]
  );
  const bundle = bRows[0];
  if (!bundle) return;
  const gm = bundle.garment_model_id || 0;
  const size = bundle.size_code || 0;

  const { rows: sRows } = await query(
    `SELECT module_type, count_cycle
       FROM sessions
      WHERE bundle_id = $1
        AND module_type IN ('INPUT','OUTPUT_1')
        AND count_cycle > 0`,
    [bundleId]
  );

  for (const s of sRows) {
    const sample = s.count_cycle / trueCount;
    if (!Number.isFinite(sample) || sample <= 0) continue;
    await query(
      `INSERT INTO ppp_calibration
         (garment_model_id, size_code, module_type, pulses_per_piece, sample_count, updated_at)
       VALUES ($1, $2, $3, $4, 1, NOW())
       ON CONFLICT (garment_model_id, size_code, module_type) DO UPDATE SET
         pulses_per_piece =
           (ppp_calibration.pulses_per_piece * LEAST(ppp_calibration.sample_count, 50) + $4)
           / (LEAST(ppp_calibration.sample_count, 50) + 1),
         sample_count = ppp_calibration.sample_count + 1,
         updated_at = NOW()`,
      [gm, size, s.module_type, sample]
    );
  }
}

async function checkSeq(nodeId, seq) {
  const { rows } = await query('SELECT flags FROM nodes WHERE id = $1', [nodeId]);
  const lastSeq = rows[0]?.flags?.lastSeq || 0;
  if (typeof seq === 'number' && seq < lastSeq - 1000) {
    const err = new Error('Sequence rollback rejected');
    err.status = 409;
    throw err;
  }
  if (typeof seq === 'number' && seq > lastSeq) {
    await query(
      `UPDATE nodes SET flags = COALESCE(flags, '{}'::jsonb) || jsonb_build_object('lastSeq', $2::int)
       WHERE id = $1`,
      [nodeId, seq]
    );
  }
}

async function isDuplicateEvent(eventId) {
  const checks = await Promise.all([
    query('SELECT 1 FROM scan_events WHERE event_id = $1', [eventId]),
    query('SELECT 1 FROM unassigned_counts WHERE event_id = $1', [eventId]),
  ]);
  return checks.some((r) => r.rowCount > 0);
}

function parseTs(ts, tsValid) {
  if (tsValid === false || tsValid === 'false') {
    return new Date();
  }
  const d = new Date(Number(ts));
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

async function runYieldChecks({ count_pass: pass, count_cycle: cycle, node_id: nodeId, module_type: moduleType }, bundleId) {
  if (!bundleId) return;
  const { rows } = await query('SELECT declared_pieces, line_id FROM bundles WHERE id = $1', [bundleId]);
  if (!rows[0]) return;
  const { declared_pieces: declared, line_id: lineId } = rows[0];

  // DISCREPANCY: > 20% loss vs declared
  if (declared > 0 && pass < declared * 0.8) {
    await raiseAlert('DISCREPANCY', {
      lineId,
      nodeId,
      detail: `${moduleType}: ${pass} counted vs ${declared} declared (${Math.round((1 - pass / declared) * 100)}% loss)`,
      dedupKey: `discrepancy:${bundleId}:${moduleType}`,
      severity: 'MED',
    });
  }

  // SENSOR_DISAGREE: |pass - cycle| / max > 30%
  if (pass > 0 && cycle > 0) {
    const diff = Math.abs(pass - cycle);
    const maxC = Math.max(pass, cycle);
    if (diff / maxC > 0.3) {
      await raiseAlert('SENSOR_DISAGREE', {
        lineId,
        nodeId,
        detail: `${moduleType}: pass=${pass}, cycle=${cycle} (${Math.round((diff / maxC) * 100)}% disagree)`,
        dedupKey: `sensor_disagree:${bundleId}:${moduleType}`,
        severity: 'MED',
      });
    }
  }
}

async function ingestScan(node, body) {
  const { eventId, seq, kind, cardUid, ts, tsValid, moduleType: bodyModule } = body;

  const deviceReportsAdmin = bodyModule === 'ADMIN';
  const isAdminNode = node.module_type === 'ADMIN' || deviceReportsAdmin;

  // Admin-room reader: ASSIGN_SCAN only (card registry / bundle assign). Line nodes never emit this.
  if (isAdminNode) {
    if (kind !== 'ASSIGN_SCAN') {
      const err = new Error('ADMIN nodes only accept ASSIGN_SCAN');
      err.status = 400;
      throw err;
    }
    if (deviceReportsAdmin && node.module_type !== 'ADMIN') {
      await query(
        `UPDATE nodes SET module_type = 'ADMIN'::module_type WHERE id = $1`,
        [node.id]
      );
      node.module_type = 'ADMIN';
    }
  } else if (kind === 'ASSIGN_SCAN') {
    const err = new Error('ASSIGN_SCAN only allowed from ADMIN nodes');
    err.status = 400;
    throw err;
  }

  await checkSeq(node.id, seq);

  const dup = await query('SELECT 1 FROM scan_events WHERE event_id = $1', [eventId]);
  if (dup.rowCount > 0) {
    if (kind === 'ASSIGN_SCAN' && cardUid) {
      const info = await ensureCardRegistered(cardUid);
      return {
        duplicate: true,
        ok: true,
        cardUid,
        cardNumber: info?.card_number ?? null,
        cardStatus: info?.status ?? null,
        newlyRegistered: false,
      };
    }
    return { duplicate: true };
  }

  let cardInfo = null;
  if (kind === 'ASSIGN_SCAN' && cardUid) {
    cardInfo = await ensureCardRegistered(cardUid);
  }

  const bundleId = cardInfo?.current_bundle_id || (await resolveBundle(cardUid));
  const when = parseTs(ts, tsValid);

  await query(
    `INSERT INTO scan_events (event_id, node_id, module_type, card_uid, bundle_id, kind, ts)
     VALUES ($1, $2, $3::module_type, $4, $5, $6::scan_kind, $7)`,
    [eventId, node.id, node.module_type, cardUid, bundleId, kind, when]
  );

  // UNASSIGNED_CARD alert when card taps with no bundle mapping
  if (kind === 'TAP_IN' && !bundleId && cardUid) {
    const { rows: line } = await query('SELECT line_id FROM nodes WHERE id = $1', [node.id]);
    await raiseAlert('UNASSIGNED_CARD', {
      lineId: line[0]?.line_id,
      nodeId: node.id,
      detail: `Card ${cardUid} has no bundle mapping`,
      dedupKey: `unassigned:${cardUid}`,
      severity: 'LOW',
    });
  }

  let sessionId;
  if (kind === 'TAP_IN' && bundleId) {
    // Toggle: if this card already has an open session on this node, close it
    const openSame = await query(
      `SELECT id FROM sessions WHERE node_id = $1 AND bundle_id = $2 AND end_ts IS NULL LIMIT 1`,
      [node.id, bundleId]
    );
    if (openSame.rowCount > 0) {
      sessionId = openSame.rows[0].id;
      await query(
        `UPDATE sessions SET end_ts = $2, close_reason = 'CARD_TAP' WHERE id = $1`,
        [sessionId, when]
      );
    } else {
      // Close any stale open sessions on this node from other bundles
      await query(
        `UPDATE sessions SET end_ts = $2, close_reason = 'TIMEOUT'
         WHERE node_id = $1 AND end_ts IS NULL`,
        [node.id, when]
      );
      sessionId = crypto.randomUUID();
      await query(
        `INSERT INTO sessions (id, bundle_id, card_uid, module_type, node_id, start_ts)
         VALUES ($1, $2, $3, $4::module_type, $5, $6)
         ON CONFLICT (bundle_id, module_type) DO UPDATE
         SET id = EXCLUDED.id, card_uid = EXCLUDED.card_uid, node_id = EXCLUDED.node_id,
             start_ts = EXCLUDED.start_ts, end_ts = NULL, close_reason = NULL`,
        [sessionId, bundleId, cardUid, node.module_type, node.id, when]
      );
      if (node.module_type === 'INPUT') {
        await query(
          "UPDATE bundles SET status = 'IN_PROGRESS' WHERE id = $1",
          [bundleId]
        );
      }
    }
  }

  return {
    ok: true,
    bundleId,
    sessionId,
    cardUid: cardUid || cardInfo?.uid,
    cardNumber: cardInfo?.card_number ?? null,
    cardStatus: cardInfo?.status ?? null,
    cardLabel: cardInfo?.label ?? null,
    newlyRegistered: cardInfo?.newlyRegistered ?? false,
  };
}

async function ingestSession(node, body) {
  if (node.module_type === 'ADMIN') {
    const err = new Error('ADMIN nodes do not report production sessions');
    err.status = 400;
    throw err;
  }
  const { eventId, seq, sessionId, cardUid, type, counts, currentAmps, closeReason, ts, tsValid } =
    body;
  await checkSeq(node.id, seq);

  const bundleId = await resolveBundle(cardUid);
  const when = parseTs(ts, tsValid);
  const pass = counts?.pass ?? 0;
  const cycle = counts?.cycle ?? 0;

  if (type === 'UPDATE') {
    await query(
      `INSERT INTO sessions (id, bundle_id, card_uid, module_type, node_id, start_ts, count_pass, count_cycle)
       VALUES ($1, $2, $3, $4::module_type, $5, $6, $7, $8)
       ON CONFLICT (bundle_id, module_type) DO UPDATE
       SET count_pass = EXCLUDED.count_pass, count_cycle = EXCLUDED.count_cycle, node_id = EXCLUDED.node_id`,
      [sessionId, bundleId, cardUid, node.module_type, node.id, when, pass, cycle]
    );
    await query(
      `INSERT INTO count_samples (session_id, count_pass, count_cycle, current_amps, ts)
       VALUES ($1, $2, $3, $4, $5)`,
      [sessionId, pass, cycle, currentAmps ?? null, when]
    );
  } else if (type === 'CLOSE') {
    await query(
      `INSERT INTO sessions (id, bundle_id, card_uid, module_type, node_id, start_ts, end_ts,
                             count_pass, count_cycle, close_reason)
       VALUES ($1, $2, $3, $4::module_type, $5, $6, $6, $7, $8, $9::close_reason)
       ON CONFLICT (bundle_id, module_type) DO UPDATE
       SET end_ts = EXCLUDED.end_ts, count_pass = EXCLUDED.count_pass,
           count_cycle = EXCLUDED.count_cycle, close_reason = EXCLUDED.close_reason`,
      [
        sessionId,
        bundleId,
        cardUid,
        node.module_type,
        node.id,
        when,
        pass,
        cycle,
        closeReason || 'TIMEOUT',
      ]
    );

    await runYieldChecks(
      { count_pass: pass, count_cycle: cycle, node_id: node.id, module_type: node.module_type },
      bundleId
    );

    if (node.module_type === 'OUTPUT_2' && bundleId) {
      await query("UPDATE bundles SET status = 'COMPLETED', card_uid = NULL WHERE id = $1", [
        bundleId,
      ]);
      await query(
        "UPDATE cards SET status = 'AVAILABLE', current_bundle_id = NULL WHERE uid = $1",
        [cardUid]
      );
      // OUTPUT_2 is the ground truth — use it to calibrate upstream PPP.
      await reconcilePpp(bundleId, pass);
    }
  }

  return { ok: true };
}

async function ingestUnassigned(node, body) {
  if (node.module_type === 'ADMIN') {
    const err = new Error('ADMIN nodes do not report unassigned counts');
    err.status = 400;
    throw err;
  }
  const { eventId, seq, cardUid, counts, ts, tsValid } = body;
  await checkSeq(node.id, seq);

  const dup = await query('SELECT 1 FROM unassigned_counts WHERE event_id = $1', [eventId]);
  if (dup.rowCount > 0) {
    return { duplicate: true };
  }

  const when = parseTs(ts, tsValid);
  await query(
    `INSERT INTO unassigned_counts (event_id, node_id, module_type, card_uid, count_pass, count_cycle, ts)
     VALUES ($1, $2, $3::module_type, $4, $5, $6, $7)`,
    [
      eventId,
      node.id,
      node.module_type,
      cardUid || null,
      counts?.pass ?? 0,
      counts?.cycle ?? 0,
      when,
    ]
  );
  return { ok: true };
}

async function ingestHeartbeat(node, body) {
  const { rssi, uptime, fwVersion, queueDepth, flags, ackedOp } = body;

  if (ackedOp) {
    await query(
      'UPDATE nodes SET pending_op = NULL, pending_op_at = NULL WHERE id = $1',
      [node.id]
    );
  }

  await query(
    `UPDATE nodes SET last_seen_at = NOW(), rssi = $2, fw_version = $3,
     flags = COALESCE(flags, '{}'::jsonb) || COALESCE($4::jsonb, '{}'::jsonb)
     WHERE id = $1`,
    [node.id, rssi, fwVersion, flags ? JSON.stringify(flags) : null]
  );

  await query(
    `INSERT INTO heartbeats (node_id, rssi, uptime, fw_version, queue_depth, flags)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [node.id, rssi, uptime, fwVersion, queueDepth, flags ? JSON.stringify(flags) : null]
  );

  // QUEUE_OVERFLOW alert from heartbeat overflow flag
  if (flags?.overflow) {
    const { rows: n } = await query('SELECT line_id FROM nodes WHERE id = $1', [node.id]);
    await raiseAlert('QUEUE_OVERFLOW', {
      lineId: n[0]?.line_id,
      nodeId: node.id,
      detail: `Offline queue overflowed — oldest events may be lost`,
      dedupKey: `queue_overflow:${node.id}`,
      severity: 'LOW',
    });
  }

  const { rows } = await query('SELECT pending_op FROM nodes WHERE id = $1', [node.id]);
  const pendingOp = rows[0]?.pending_op ?? null;

  return { ok: true, serverTimeMs: Date.now(), pendingOp };
}

module.exports = {
  findNodeByToken,
  claimDevice,
  approveDevice,
  getDeviceConfig,
  ingestScan,
  ingestSession,
  ingestUnassigned,
  ingestHeartbeat,
  resolveBundle,
  ensureCardRegistered,
  lookupPpp,
  reconcilePpp,
};
