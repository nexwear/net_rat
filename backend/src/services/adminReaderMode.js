/** Tracks which admin UI screen owns the NFC reader (single desk). */
const MODES = new Set(['IDLE', 'REGISTER', 'BUNDLE']);

let state = {
  mode: 'IDLE',
  setAt: 0,
  setBy: null,
};

const TTL_MS = 15 * 60 * 1000;

function expireIfStale() {
  if (state.mode === 'IDLE') return;
  if (Date.now() - state.setAt > TTL_MS) {
    state = { mode: 'IDLE', setAt: 0, setBy: null };
  }
}

function getAdminReaderMode() {
  expireIfStale();
  return state.mode;
}

function setAdminReaderMode(mode, userId = null) {
  const m = String(mode || 'IDLE').toUpperCase();
  if (!MODES.has(m)) {
    const err = new Error('mode must be IDLE, REGISTER, or BUNDLE');
    err.status = 400;
    throw err;
  }
  state = { mode: m, setAt: Date.now(), setBy: userId };
  return { mode: m };
}

function getAdminReaderStatus() {
  expireIfStale();
  return {
    mode: state.mode,
    setAt: state.setAt || null,
    setBy: state.setBy,
  };
}

module.exports = {
  getAdminReaderMode,
  setAdminReaderMode,
  getAdminReaderStatus,
};
