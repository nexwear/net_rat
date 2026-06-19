// Supervised PPP (pulses-per-piece) training.
//
// INPUT:     current run cycles (from streamed amps) + IR horseshoe (count_pass)
// OUTPUT_1:  IR horseshoe (count_pass) only
// Hall rotations (count_cycle) are not used — firmware unchanged; signals derived here.
const { query } = require('../db');
const {
  TRAINING_SIGNAL,
  enrichLiveSignals,
  sessionPrimaryPulseCount,
} = require('./trainingSignals');

const CYCLE_MODULES = ['INPUT', 'OUTPUT_1'];

function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function notFound(msg) {
  const e = new Error(msg);
  e.status = 404;
  return e;
}
function badRequest(msg) {
  const e = new Error(msg);
  e.status = 400;
  return e;
}

async function getNode(nodeId) {
  const { rows } = await query(
    'SELECT id, module_type, status, label FROM nodes WHERE id = $1',
    [nodeId]
  );
  return rows[0] || null;
}

async function getOpenSessionBase(nodeId) {
  const { rows } = await query(
    `SELECT s.id AS session_id, s.card_uid, s.count_cycle, s.count_pass, s.start_ts,
            (SELECT cs.current_amps FROM count_samples cs
              WHERE cs.session_id = s.id ORDER BY cs.ts DESC LIMIT 1) AS amps
       FROM sessions s
      WHERE s.node_id = $1 AND s.end_ts IS NULL
      ORDER BY s.start_ts DESC NULLS LAST
      LIMIT 1`,
    [nodeId]
  );
  if (!rows[0]) return null;
  return {
    sessionId: rows[0].session_id,
    cardUid: rows[0].card_uid,
    cycle: rows[0].count_cycle ?? 0,
    pass: rows[0].count_pass ?? 0,
    amps: rows[0].amps ?? null,
    startTs: rows[0].start_ts,
  };
}

async function getNodeLiveSignals(nodeId, moduleType) {
  const base = await getOpenSessionBase(nodeId);
  return enrichLiveSignals(moduleType, base);
}

async function getTrainingRow(trainingId) {
  const { rows } = await query('SELECT * FROM ppp_training WHERE id = $1', [trainingId]);
  return rows[0] || null;
}

async function getMarks(trainingId) {
  const { rows } = await query(
    `SELECT piece_index, count_cycle, count_pass, delta_cycle, marked_at
       FROM ppp_training_marks WHERE training_id = $1 ORDER BY piece_index ASC`,
    [trainingId]
  );
  return rows;
}

function livePayload(live) {
  if (!live) return null;
  return {
    sessionId: live.sessionId,
    cardUid: live.cardUid,
    cycle: live.cycle,
    pass: live.pass,
    ir: live.ir,
    currentRuns: live.currentRuns,
    primary: live.primary,
    amps: live.amps ?? null,
    signal: live.signal,
  };
}

function buildState(t, marks, live) {
  const deltas = marks.map((m) => m.delta_cycle).filter((d) => Number.isFinite(d) && d > 0);
  const lastDelta = marks.length ? marks[marks.length - 1].delta_cycle : null;
  const sig = TRAINING_SIGNAL[t.module_type];
  return {
    id: t.id,
    nodeId: t.node_id,
    moduleType: t.module_type,
    garmentModelId: t.garment_model_id,
    sizeCode: t.size_code,
    baselineCycle: t.baseline_cycle,
    status: t.status,
    pieceCount: t.piece_count,
    validPieces: deltas.length,
    runningPpp: median(deltas),
    resultPpp: t.result_ppp,
    lastDelta,
    signalLabel: sig?.label ?? 'pulses',
    marks: marks.map((m) => ({
      pieceIndex: m.piece_index,
      primary: m.count_cycle,
      ir: m.count_pass,
      delta: m.delta_cycle,
      at: m.marked_at,
    })),
    live: livePayload(live),
  };
}

async function startTraining({ nodeId, garmentModelId, sizeCode }) {
  const node = await getNode(nodeId);
  if (!node) throw notFound('node not found');
  if (!CYCLE_MODULES.includes(node.module_type)) {
    throw badRequest(
      `training only applies to ${CYCLE_MODULES.join('/')} nodes (got ${node.module_type})`
    );
  }

  await query(
    `UPDATE ppp_training SET status = 'CANCELLED', ended_at = NOW()
      WHERE node_id = $1 AND status = 'ACTIVE'`,
    [nodeId]
  );

  const live = await getNodeLiveSignals(nodeId, node.module_type);
  const baseline = live?.primary ?? 0;

  const { rows } = await query(
    `INSERT INTO ppp_training (node_id, module_type, garment_model_id, size_code, baseline_cycle)
     VALUES ($1, $2::module_type, $3, $4, $5)
     RETURNING *`,
    [nodeId, node.module_type, garmentModelId || 0, sizeCode || 0, baseline]
  );
  return buildState(rows[0], [], live);
}

async function markPiece(trainingId) {
  const t = await getTrainingRow(trainingId);
  if (!t) throw notFound('training run not found');
  if (t.status !== 'ACTIVE') throw badRequest('training run is not active');

  const live = await getNodeLiveSignals(t.node_id, t.module_type);
  if (!live) {
    const e = new Error('no open session on the node — tap the operator card to start one');
    e.status = 409;
    throw e;
  }

  const { rows: last } = await query(
    `SELECT count_cycle FROM ppp_training_marks
      WHERE training_id = $1 ORDER BY piece_index DESC LIMIT 1`,
    [trainingId]
  );
  const prevPrimary = last[0]?.count_cycle ?? t.baseline_cycle;
  const delta = live.primary - prevPrimary;
  const pieceIndex = t.piece_count + 1;

  await query(
    `INSERT INTO ppp_training_marks (training_id, piece_index, count_cycle, count_pass, delta_cycle)
     VALUES ($1, $2, $3, $4, $5)`,
    [trainingId, pieceIndex, live.primary, live.ir, delta]
  );
  await query('UPDATE ppp_training SET piece_count = $2 WHERE id = $1', [trainingId, pieceIndex]);

  const marks = await getMarks(trainingId);
  return buildState({ ...t, piece_count: pieceIndex }, marks, live);
}

async function undoMark(trainingId) {
  const t = await getTrainingRow(trainingId);
  if (!t) throw notFound('training run not found');
  if (t.status !== 'ACTIVE') throw badRequest('training run is not active');

  const { rows } = await query(
    `DELETE FROM ppp_training_marks
      WHERE id = (SELECT id FROM ppp_training_marks WHERE training_id = $1
                  ORDER BY piece_index DESC LIMIT 1)
      RETURNING piece_index`,
    [trainingId]
  );
  const newCount = Math.max(0, t.piece_count - (rows.length ? 1 : 0));
  await query('UPDATE ppp_training SET piece_count = $2 WHERE id = $1', [trainingId, newCount]);

  const live = await getNodeLiveSignals(t.node_id, t.module_type);
  const marks = await getMarks(trainingId);
  return buildState({ ...t, piece_count: newCount }, marks, live);
}

async function finishTraining(trainingId, save) {
  const t = await getTrainingRow(trainingId);
  if (!t) throw notFound('training run not found');
  if (t.status !== 'ACTIVE') throw badRequest('training run already finished');

  const marks = await getMarks(trainingId);
  const deltas = marks.map((m) => m.delta_cycle).filter((d) => Number.isFinite(d) && d > 0);
  const ppp = median(deltas);
  const willSave = !!(save && ppp && ppp > 0);

  if (willSave) {
    const sampleCount = Math.min(deltas.length, 50);
    await query(
      `INSERT INTO ppp_calibration
         (garment_model_id, size_code, module_type, pulses_per_piece, sample_count, updated_at)
       VALUES ($1, $2, $3::module_type, $4, $5, NOW())
       ON CONFLICT (garment_model_id, size_code, module_type) DO UPDATE
         SET pulses_per_piece = $4, sample_count = $5, updated_at = NOW()`,
      [t.garment_model_id, t.size_code, t.module_type, ppp, sampleCount]
    );
    await query(
      `UPDATE ppp_training SET status = 'SAVED', result_ppp = $2, ended_at = NOW() WHERE id = $1`,
      [trainingId, ppp]
    );
  } else {
    await query(
      `UPDATE ppp_training SET status = 'CANCELLED', ended_at = NOW() WHERE id = $1`,
      [trainingId]
    );
  }

  const t2 = await getTrainingRow(trainingId);
  return {
    saved: willSave,
    resultPpp: willSave ? ppp : null,
    validPieces: deltas.length,
    training: buildState(t2, marks, null),
  };
}

async function getTrainingState(trainingId) {
  const t = await getTrainingRow(trainingId);
  if (!t) throw notFound('training run not found');
  const live = await getNodeLiveSignals(t.node_id, t.module_type);
  const marks = await getMarks(trainingId);
  return buildState(t, marks, live);
}

async function getLiveForNode(nodeId) {
  const node = await getNode(nodeId);
  if (!node) throw notFound('node not found');
  const live = await getNodeLiveSignals(nodeId, node.module_type);
  const { rows } = await query(
    `SELECT * FROM ppp_training WHERE node_id = $1 AND status = 'ACTIVE'
      ORDER BY started_at DESC LIMIT 1`,
    [nodeId]
  );
  let training = null;
  if (rows[0]) {
    training = buildState(rows[0], await getMarks(rows[0].id), live);
  }
  return {
    nodeId,
    moduleType: node.module_type,
    live: livePayload(live),
    training,
  };
}

async function recalibrateFromHistory({ apply = false, includeDeclared = false } = {}) {
  const { rows: truthRows } = await query(
    `
    SELECT b.id AS bundle_id, b.garment_model_id, b.size_code,
           COALESCE(o2.true_count,
                    CASE WHEN $1 THEN b.declared_pieces END) AS true_count
      FROM bundles b
      LEFT JOIN (
        SELECT bundle_id, MAX(count_pass) AS true_count
        FROM sessions WHERE module_type = 'OUTPUT_2' AND count_pass > 0
        GROUP BY bundle_id
      ) o2 ON o2.bundle_id = b.id
     WHERE COALESCE(o2.true_count, CASE WHEN $1 THEN b.declared_pieces END) > 0
    `,
    [includeDeclared]
  );

  if (!truthRows.length) {
    return { applied: apply, includeDeclared, groups: 0, totalSamples: 0, rows: [] };
  }

  const { rows: sessionRows } = await query(
    `SELECT id, bundle_id, module_type, count_pass, count_cycle
       FROM sessions
      WHERE module_type IN ('INPUT', 'OUTPUT_1')
        AND bundle_id = ANY($1::uuid[])`,
    [truthRows.map((r) => r.bundle_id)]
  );

  const truthByBundle = new Map(truthRows.map((r) => [r.bundle_id, r]));
  const buckets = new Map();

  for (const s of sessionRows) {
    const truth = truthByBundle.get(s.bundle_id);
    if (!truth?.true_count) continue;

    const pulses = await sessionPrimaryPulseCount(s.id, s.module_type, s);
    if (!pulses || pulses <= 0) continue;

    const ppp = pulses / truth.true_count;
    if (!Number.isFinite(ppp) || ppp <= 0) continue;

    const key = `${truth.garment_model_id || 0}:${truth.size_code || 0}:${s.module_type}`;
    if (!buckets.has(key)) {
      buckets.set(key, {
        garment_model_id: truth.garment_model_id || 0,
        size_code: truth.size_code || 0,
        module_type: s.module_type,
        ppps: [],
      });
    }
    buckets.get(key).ppps.push(ppp);
  }

  const rows = [...buckets.values()]
    .map((b) => {
      const sorted = [...b.ppps].sort((a, c) => a - c);
      const mid = Math.floor(sorted.length / 2);
      const medianPpp =
        sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
      return {
        garment_model_id: b.garment_model_id,
        size_code: b.size_code,
        module_type: b.module_type,
        median_ppp: medianPpp,
        mean_ppp: sorted.reduce((a, v) => a + v, 0) / sorted.length,
        min_ppp: sorted[0],
        max_ppp: sorted[sorted.length - 1],
        samples: sorted.length,
      };
    })
    .sort((a, b) =>
      a.garment_model_id - b.garment_model_id ||
      a.size_code - b.size_code ||
      a.module_type.localeCompare(b.module_type)
    );

  if (apply) {
    for (const r of rows) {
      await query(
        `INSERT INTO ppp_calibration
           (garment_model_id, size_code, module_type, pulses_per_piece, sample_count, updated_at)
         VALUES ($1, $2, $3::module_type, $4, $5, NOW())
         ON CONFLICT (garment_model_id, size_code, module_type) DO UPDATE
           SET pulses_per_piece = $4, sample_count = $5, updated_at = NOW()`,
        [r.garment_model_id, r.size_code, r.module_type, r.median_ppp, Math.min(Number(r.samples), 50)]
      );
    }
  }

  return {
    applied: apply,
    includeDeclared,
    groups: rows.length,
    totalSamples: rows.reduce((a, r) => a + Number(r.samples), 0),
    rows: rows.map((r) => ({
      garmentModelId: r.garment_model_id,
      sizeCode: r.size_code,
      moduleType: r.module_type,
      ppp: Math.round(r.median_ppp),
      meanPpp: Math.round(r.mean_ppp),
      minPpp: Math.round(r.min_ppp),
      maxPpp: Math.round(r.max_ppp),
      samples: Number(r.samples),
    })),
  };
}

async function getCalibration(garmentModelId, sizeCode, moduleType) {
  const { rows } = await query(
    `SELECT pulses_per_piece, sample_count, updated_at
       FROM ppp_calibration
      WHERE garment_model_id = $1 AND size_code = $2 AND module_type = $3::module_type`,
    [garmentModelId || 0, sizeCode || 0, moduleType]
  );
  return rows[0] || null;
}

module.exports = {
  CYCLE_MODULES,
  startTraining,
  markPiece,
  undoMark,
  finishTraining,
  getTrainingState,
  getLiveForNode,
  getCalibration,
  recalibrateFromHistory,
};
