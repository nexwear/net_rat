const crypto = require('crypto');
const { query } = require('../db');
const { raiseAlert } = require('./alerts');
const { getAdminReaderMode } = require('./adminReaderMode');
const { sessionPrimaryPulseCount } = require('./trainingSignals');

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
  const raw = (moduleHint || '').trim().toUpperCase();
  const valid = ['INPUT', 'OUTPUT_1', 'OUTPUT_2', 'ADMIN'];
  const mod = valid.includes(raw) ? raw : null;
  if (moduleHint && !mod) {
    console.warn(`claim: invalid moduleHint "${moduleHint}", ignoring`);
  }

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
      [tempToken, mod, node.id, lbl]
    );
    if (mod) node.module_type = mod;
    node.api_token = tempToken;
    node.status = 'PENDING';
  } else {
    const nodeId = makeNodeId(chipId, mod || 'INPUT');
    const tempToken = makeToken('tmp');
    const insertMod = mod || 'INPUT';
    const { rows } = await query(
      `INSERT INTO nodes (id, chip_id, module_type, api_token, status, label)
       VALUES ($1, $2, $3::module_type, $4, 'PENDING', $5)
       RETURNING *`,
      [nodeId, chipId, insertMod, tempToken, lbl]
    );
    node = rows[0];
  }

  if (process.env.AUTO_APPROVE_DEVICES === 'true') {
    node = await approveDevice(node.id, {
      moduleType: mod || node.module_type || 'INPUT',
    });
  }

  console.log(`claim: chip=${chipId} node=${node.id} module=${node.module_type} hint=${mod || '(none)'}`);

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

  // Atomic allocation via sequence; ON CONFLICT covers two requests racing to
  // register the same new UID (the loser gets no row back and re-reads it).
  const { rows: ins } = await query(
    `INSERT INTO cards (uid, family, status, card_number)
     VALUES ($1, 'UNKNOWN', 'AVAILABLE', nextval('cards_card_number_seq'))
     ON CONFLICT (uid) DO NOTHING
     RETURNING uid, card_number, label, status, current_bundle_id`,
    [uid]
  );
  if (ins.length > 0) {
    return { ...ins[0], newlyRegistered: true };
  }
  const { rows: raced } = await query(
    'SELECT uid, card_number, label, status, current_bundle_id FROM cards WHERE uid = $1',
    [uid]
  );
  return raced.length > 0 ? { ...raced[0], newlyRegistered: false } : null;
}

/** Lookup only — never inserts (bundle assign / card lookup UI). */
async function lookupCard(cardUid) {
  const uid = (cardUid || '').trim().toUpperCase();
  if (!uid) return null;

  const { rows } = await query(
    'SELECT uid, card_number, label, status, current_bundle_id FROM cards WHERE uid = $1',
    [uid]
  );
  if (rows.length === 0) return null;
  return { ...rows[0], newlyRegistered: false };
}

async function resolveAssignScanCard(cardUid) {
  const mode = getAdminReaderMode();
  if (mode === 'REGISTER') {
    return {
      mode,
      ignored: false,
      unregistered: false,
      cardInfo: await ensureCardRegistered(cardUid),
    };
  }
  if (mode === 'BUNDLE') {
    const cardInfo = await lookupCard(cardUid);
    return {
      mode,
      ignored: false,
      unregistered: !cardInfo,
      cardInfo,
    };
  }
  return { mode: 'IDLE', ignored: true, unregistered: false, cardInfo: null };
}

function assignScanResponse(cardUid, cardInfo, extra = {}) {
  return {
    ok: true,
    cardUid: cardUid || cardInfo?.uid || null,
    cardNumber: cardInfo?.card_number ?? null,
    cardStatus: cardInfo?.status ?? null,
    cardLabel: cardInfo?.label ?? null,
    newlyRegistered: cardInfo?.newlyRegistered ?? false,
    ...extra,
  };
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
// station, fold primary sensor pulses / trueCount into the rolling average.
// INPUT → current run cycles (from amps); OUTPUT_1 → IR (count_pass); not hall.
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
    `SELECT id, module_type, count_pass, count_cycle
       FROM sessions
      WHERE bundle_id = $1
        AND module_type IN ('INPUT','OUTPUT_1')`,
    [bundleId]
  );

  for (const s of sRows) {
    const pulses = await sessionPrimaryPulseCount(s.id, s.module_type, s);
    if (!pulses || pulses <= 0) continue;
    const sample = pulses / trueCount;
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
      const resolved = await resolveAssignScanCard(cardUid);
      return assignScanResponse(cardUid, resolved.cardInfo, {
        duplicate: true,
        mode: resolved.mode,
        ignored: resolved.ignored,
        unregistered: resolved.unregistered,
        newlyRegistered: false,
      });
    }
    return { duplicate: true };
  }

  let cardInfo = null;
  let assignMeta = { mode: 'IDLE', ignored: false, unregistered: false };
  if (kind === 'ASSIGN_SCAN' && cardUid) {
    const resolved = await resolveAssignScanCard(cardUid);
    cardInfo = resolved.cardInfo;
    assignMeta = resolved;
    if (resolved.ignored) {
      console.log(`assign scan ignored (reader IDLE): uid=${cardUid} node=${node.id}`);
    } else if (resolved.unregistered) {
      console.log(`assign scan unregistered card: uid=${cardUid} node=${node.id}`);
    }
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
    const { rows: bundleRows } = await query('SELECT status FROM bundles WHERE id = $1', [bundleId]);
    if (bundleRows[0]?.status === 'COMPLETED') {
      return assignScanResponse(cardUid, cardInfo, {
        bundleId,
        sessionId: null,
        skippedSession: true,
        mode: assignMeta.mode,
        ignored: assignMeta.ignored,
        unregistered: assignMeta.unregistered,
      });
    }

    if (!deviceReportsSessionOpen(body)) {
      return assignScanResponse(cardUid, cardInfo, {
        bundleId,
        sessionId: null,
        mode: assignMeta.mode,
        ignored: assignMeta.ignored,
        unregistered: assignMeta.unregistered,
        skippedSession: true,
      });
    }

    // Toggle: if this card already has an open session on this node, close it
    const openSame = await query(
      `SELECT id FROM sessions WHERE node_id = $1 AND bundle_id = $2 AND end_ts IS NULL LIMIT 1`,
      [node.id, bundleId]
    );
    if (openSame.rowCount > 0) {
      sessionId = openSame.rows[0].id;
      const { rows: sess } = await query(
        'SELECT count_pass FROM sessions WHERE id = $1',
        [sessionId]
      );
      await query(
        `UPDATE sessions SET end_ts = $2, close_reason = 'NEXT_TAP' WHERE id = $1`,
        [sessionId, when]
      );
      if (node.module_type === 'OUTPUT_2') {
        await reconcilePpp(bundleId, sess[0]?.count_pass ?? 0);
      }
      await completeBundle(bundleId, cardUid);
      return assignScanResponse(cardUid, cardInfo, {
        bundleId,
        sessionId: null,
        bundleCompleted: true,
        mode: assignMeta.mode,
        ignored: assignMeta.ignored,
        unregistered: assignMeta.unregistered,
      });
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

  return assignScanResponse(cardUid, cardInfo, {
    bundleId,
    sessionId,
    mode: assignMeta.mode,
    ignored: assignMeta.ignored,
    unregistered: assignMeta.unregistered,
  });
}

/** Persist counts on the canonical cloud session row (device may send a local UUID). */
async function upsertOpenSessionCounts({ node, sessionId, bundleId, cardUid, when, pass, cycle }) {
  const pack = (row) => ({
    sessionId: row.id,
    countPass: row.count_pass ?? pass,
    countCycle: row.count_cycle ?? cycle,
  });

  // Prefer the cloud session id once the device has synced it from TAP_IN / UPDATE ack.
  if (sessionId) {
    const { rows } = await query(
      `UPDATE sessions
          SET count_pass = GREATEST(count_pass, $2),
              count_cycle = GREATEST(count_cycle, $3),
              node_id = $4
        WHERE id = $1 AND end_ts IS NULL
        RETURNING id, count_pass, count_cycle`,
      [sessionId, pass, cycle, node.id]
    );
    if (rows[0]) return pack(rows[0]);
  }

  if (bundleId) {
    const { rows } = await query(
      `INSERT INTO sessions (id, bundle_id, card_uid, module_type, node_id, start_ts, count_pass, count_cycle)
       VALUES ($1, $2, $3, $4::module_type, $5, $6, $7, $8)
       ON CONFLICT (bundle_id, module_type) DO UPDATE
       SET count_pass = GREATEST(sessions.count_pass, EXCLUDED.count_pass),
           count_cycle = GREATEST(sessions.count_cycle, EXCLUDED.count_cycle),
           node_id = EXCLUDED.node_id,
           card_uid = COALESCE(EXCLUDED.card_uid, sessions.card_uid)
       WHERE sessions.end_ts IS NULL
       RETURNING id, count_pass, count_cycle`,
      [sessionId, bundleId, cardUid, node.module_type, node.id, when, pass, cycle]
    );
    if (rows[0]) return pack(rows[0]);
  }

  const { rows } = await query(
    `UPDATE sessions
        SET count_pass = GREATEST(count_pass, $2),
            count_cycle = GREATEST(count_cycle, $3)
      WHERE node_id = $1 AND end_ts IS NULL
      RETURNING id, count_pass, count_cycle`,
    [node.id, pass, cycle]
  );
  if (rows[0]) return pack(rows[0]);

  await query(
    `INSERT INTO sessions (id, bundle_id, card_uid, module_type, node_id, start_ts, count_pass, count_cycle)
     VALUES ($1, $2, $3, $4::module_type, $5, $6, $7, $8)`,
    [sessionId, bundleId || null, cardUid, node.module_type, node.id, when, pass, cycle]
  );
  return { sessionId, countPass: pass, countCycle: cycle };
}

/** Close the open session row and never regress counts already stored in the cloud. */
async function closeOpenSession({
  node,
  sessionId,
  bundleId,
  cardUid,
  when,
  pass,
  cycle,
  closeReason,
}) {
  let existing = null;

  if (bundleId) {
    const { rows } = await query(
      `SELECT id, count_pass, count_cycle, end_ts
         FROM sessions
        WHERE bundle_id = $1 AND module_type = $2::module_type`,
      [bundleId, node.module_type]
    );
    existing = rows[0] || null;
  }

  if (!existing) {
    const { rows } = await query(
      `SELECT id, count_pass, count_cycle, end_ts
         FROM sessions
        WHERE node_id = $1 AND module_type = $2::module_type AND end_ts IS NULL
        ORDER BY start_ts DESC
        LIMIT 1`,
      [node.id, node.module_type]
    );
    existing = rows[0] || null;
  }

  const finalPass = Math.max(pass, existing?.count_pass ?? 0);
  const finalCycle = Math.max(cycle, existing?.count_cycle ?? 0);
  const resolvedId = existing?.id || sessionId;
  const endTs = existing?.end_ts || when;
  const reason = closeReason || 'TIMEOUT';

  if (existing) {
    await query(
      `UPDATE sessions
          SET end_ts = $2,
              count_pass = $3,
              count_cycle = $4,
              close_reason = $5::close_reason,
              node_id = $6,
              card_uid = COALESCE($7, card_uid)
        WHERE id = $1`,
      [resolvedId, endTs, finalPass, finalCycle, reason, node.id, cardUid || null]
    );
  } else {
    await query(
      `INSERT INTO sessions (id, bundle_id, card_uid, module_type, node_id, start_ts, end_ts,
                             count_pass, count_cycle, close_reason)
       VALUES ($1, $2, $3, $4::module_type, $5, $6, $6, $7, $8, $9::close_reason)`,
      [
        resolvedId,
        bundleId,
        cardUid,
        node.module_type,
        node.id,
        when,
        finalPass,
        finalCycle,
        reason,
      ]
    );
  }

  return { sessionId: resolvedId, countPass: finalPass, countCycle: finalCycle };
}

/** Release the card and mark the bundle completed — keep sessions for stats/history. */
async function completeBundle(bundleId, cardUid) {
  if (!bundleId) {
    return { released: false, completed: false };
  }

  await query(
    `UPDATE cards SET status = 'AVAILABLE', current_bundle_id = NULL
     WHERE current_bundle_id = $1`,
    [bundleId]
  );
  if (cardUid) {
    await query(
      `UPDATE cards SET status = 'AVAILABLE', current_bundle_id = NULL WHERE uid = $1`,
      [cardUid]
    );
  }

  const { rowCount } = await query(
    `UPDATE bundles SET status = 'COMPLETED', card_uid = NULL WHERE id = $1`,
    [bundleId]
  );
  return { released: true, completed: rowCount > 0 };
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
    if (!deviceReportsSessionOpen(body)) {
      return { ok: true, skipped: true };
    }
    const resolved = await upsertOpenSessionCounts({
      node,
      sessionId,
      bundleId,
      cardUid,
      when,
      pass,
      cycle,
    });
    await query(
      `INSERT INTO count_samples (session_id, count_pass, count_cycle, current_amps, ts)
       VALUES ($1, $2, $3, $4, $5)`,
      [resolved.sessionId, resolved.countPass, resolved.countCycle, currentAmps ?? null, when]
    );
    let declaredPieces = 0;
    if (bundleId) {
      const { rows: b } = await query('SELECT declared_pieces FROM bundles WHERE id = $1', [bundleId]);
      declaredPieces = b[0]?.declared_pieces ?? 0;
    }
    return {
      ok: true,
      sessionId: resolved.sessionId,
      countPass: resolved.countPass,
      countCycle: resolved.countCycle,
      bundleId,
      declaredPieces,
    };
  } else if (type === 'CLOSE') {
    const closed = await closeOpenSession({
      node,
      sessionId,
      bundleId,
      cardUid,
      when,
      pass,
      cycle,
      closeReason,
    });

    await runYieldChecks(
      {
        count_pass: closed.countPass,
        count_cycle: closed.countCycle,
        node_id: node.id,
        module_type: node.module_type,
      },
      bundleId
    );

    if (node.module_type === 'OUTPUT_2' && bundleId) {
      await reconcilePpp(bundleId, closed.countPass);
    }

    const finalized = await completeBundle(bundleId, cardUid);

    return {
      ok: true,
      sessionId: closed.sessionId,
      countPass: closed.countPass,
      countCycle: closed.countCycle,
      bundleId,
      bundleCompleted: finalized.completed,
    };
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

/** Only explicit device telemetry may open/update sessions — not heartbeat inference. */
function deviceReportsSessionOpen(body) {
  if (body.deviceSessionOpen === true) return true;
  if (body.deviceSessionOpen === false) return false;
  return true;
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

  const { rows: refreshed } = await query('SELECT flags FROM nodes WHERE id = $1', [node.id]);
  node.flags = refreshed[0]?.flags || node.flags;

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

async function getActiveSessionForNode(node) {
  if (node.module_type === 'ADMIN') return null;

  const { rows } = await query(
    `SELECT s.id, s.bundle_id, s.card_uid, s.count_pass, s.count_cycle, s.start_ts,
            b.declared_pieces, b.garment_model_id, b.size_code
       FROM sessions s
       LEFT JOIN bundles b ON b.id = s.bundle_id
      WHERE s.node_id = $1 AND s.end_ts IS NULL
      ORDER BY s.start_ts DESC
      LIMIT 1`,
    [node.id]
  );
  if (!rows[0]?.card_uid) return null;

  const s = rows[0];
  // Sessions/bundles may stay open for days (a card can sit on a bundle across
  // shifts). Only treat one as abandoned after a full week, matching the node's
  // SESSION_TIMEOUT_MS. Override with SESSION_OPEN_MAX_MS env if needed.
  const SESSION_OPEN_MAX_MS = Number(process.env.SESSION_OPEN_MAX_MS) || 7 * 24 * 60 * 60 * 1000;
  const ageMs = Date.now() - new Date(s.start_ts).getTime();
  if (ageMs > SESSION_OPEN_MAX_MS) {
    await query(
      `UPDATE sessions SET end_ts = NOW(), close_reason = 'TIMEOUT'
       WHERE id = $1 AND end_ts IS NULL`,
      [s.id]
    );
    return null;
  }

  let ppp = 0;
  if (node.module_type === 'INPUT' || node.module_type === 'OUTPUT_1') {
    ppp = Math.round(await lookupPpp(s.garment_model_id, s.size_code, node.module_type));
  }

  return {
    sessionId: s.id,
    bundleId: s.bundle_id,
    cardUid: s.card_uid,
    countPass: s.count_pass ?? 0,
    countCycle: s.count_cycle ?? 0,
    declaredPieces: s.declared_pieces ?? 0,
    ppp,
    startTs: s.start_ts ? new Date(s.start_ts).getTime() : null,
  };
}

module.exports = {
  findNodeByToken,
  claimDevice,
  approveDevice,
  getDeviceConfig,
  getActiveSessionForNode,
  ingestScan,
  ingestSession,
  ingestUnassigned,
  ingestHeartbeat,
  resolveBundle,
  ensureCardRegistered,
  lookupCard,
  lookupPpp,
  reconcilePpp,
};
