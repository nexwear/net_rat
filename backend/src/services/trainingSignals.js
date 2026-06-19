// Per-station training / PPP signals (server-side only — no firmware change).
//
// INPUT     → current run cycles (from amps) + IR horseshoe (count_pass)
// OUTPUT_1  → IR horseshoe (count_pass) only
// Hall (count_cycle) is never used for calibration on these stations.

const { query } = require('../db');

// Match firmware CurrentDriver RUN_ON_A / RUN_OFF_A hysteresis.
const CURRENT_RUN_ON_A = 0.8;
const CURRENT_RUN_OFF_A = 0.55;

const TRAINING_SIGNAL = {
  INPUT: {
    primary: 'current',
    label: 'current run cycles',
    secondary: 'ir',
  },
  OUTPUT_1: {
    primary: 'ir',
    label: 'IR beam breaks',
    secondary: null,
  },
};

function deriveCurrentRunCycles(samples) {
  let running = false;
  let cycles = 0;
  for (const s of samples) {
    const amps = s.amps ?? s.current_amps ?? 0;
    if (!running && amps >= CURRENT_RUN_ON_A) {
      running = true;
    } else if (running && amps < CURRENT_RUN_OFF_A) {
      running = false;
      cycles++;
    }
  }
  return cycles;
}

async function getSessionAmpSamples(sessionId) {
  const { rows } = await query(
    `SELECT current_amps AS amps, ts FROM count_samples
      WHERE session_id = $1 ORDER BY ts ASC`,
    [sessionId]
  );
  return rows;
}

async function enrichLiveSignals(moduleType, base) {
  if (!base) return null;
  const ir = base.pass ?? 0;
  let currentRuns = null;
  if (moduleType === 'INPUT') {
    const samples = await getSessionAmpSamples(base.sessionId);
    currentRuns = deriveCurrentRunCycles(samples);
  }
  const primary = primaryPulseValue(moduleType, { pass: ir, currentRuns });
  return {
    ...base,
    ir,
    currentRuns,
    primary,
    signal: TRAINING_SIGNAL[moduleType] || null,
  };
}

function primaryPulseValue(moduleType, { pass = 0, currentRuns = 0 }) {
  if (moduleType === 'OUTPUT_1') return pass;
  if (moduleType === 'INPUT') return currentRuns ?? 0;
  return 0;
}

async function sessionPrimaryPulseCount(sessionId, moduleType, sessionRow = {}) {
  if (moduleType === 'OUTPUT_1') {
    return sessionRow.count_pass ?? 0;
  }
  if (moduleType === 'INPUT') {
    const samples = await getSessionAmpSamples(sessionId);
    return deriveCurrentRunCycles(samples);
  }
  return sessionRow.count_cycle ?? 0;
}

module.exports = {
  TRAINING_SIGNAL,
  CURRENT_RUN_ON_A,
  CURRENT_RUN_OFF_A,
  deriveCurrentRunCycles,
  getSessionAmpSamples,
  enrichLiveSignals,
  primaryPulseValue,
  sessionPrimaryPulseCount,
};
