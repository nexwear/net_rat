// Firebase Cloud Messaging (FCM) push notifications.
//
// Fully optional: if no Firebase credentials are configured the service stays
// disabled and every call is a safe no-op, so the backend runs unchanged until
// you set up Firebase. Provide credentials via either:
//   FIREBASE_SERVICE_ACCOUNT  – the service-account JSON as a single env string
//   GOOGLE_APPLICATION_CREDENTIALS – path to the service-account JSON file
// and `npm install firebase-admin`.

const path = require('path');
const { query } = require('../db');

let messaging = null;
let enabled = false;

function init() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  const file = process.env.GOOGLE_APPLICATION_CREDENTIALS || process.env.FIREBASE_CREDENTIALS_FILE;
  if (!raw && !file) {
    console.log('[push] FCM disabled (no credentials set)');
    return;
  }
  try {
    const admin = require('firebase-admin');
    const credential = raw
      ? admin.credential.cert(JSON.parse(raw))
      : admin.credential.cert(require(path.resolve(file)));
    if (!admin.apps.length) admin.initializeApp({ credential });
    messaging = admin.messaging();
    enabled = true;
    console.log('[push] FCM enabled');
  } catch (err) {
    console.warn('[push] FCM init failed — pushes disabled:', err.message);
  }
}

async function registerToken(userId, token, platform) {
  if (!token) return;
  await query(
    `INSERT INTO device_tokens (token, user_id, platform, last_seen_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (token) DO UPDATE
       SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, last_seen_at = NOW()`,
    [token, userId || null, platform || null]
  );
}

async function unregisterToken(token) {
  if (!token) return;
  await query('DELETE FROM device_tokens WHERE token = $1', [token]);
}

// Fire-and-forget push for a newly raised alert. Sends to every registered
// device and prunes tokens FCM reports as dead.
async function sendAlert({ id, type, severity, detail, lineId, nodeId }) {
  if (!enabled || !messaging) return;
  let tokens;
  try {
    const { rows } = await query('SELECT token FROM device_tokens');
    tokens = rows.map((r) => r.token);
  } catch {
    return;
  }
  if (tokens.length === 0) return;

  const title = `${severity || 'ALERT'} · ${type}`;
  const body = detail || 'New alert on the production line';

  try {
    const res = await messaging.sendEachForMulticast({
      tokens,
      notification: { title, body },
      data: {
        kind: 'alert',
        alertId: String(id || ''),
        type: String(type || ''),
        severity: String(severity || ''),
        lineId: String(lineId || ''),
        nodeId: String(nodeId || ''),
      },
      android: { priority: 'high', notification: { channelId: 'alerts', sound: 'default' } },
      apns: { payload: { aps: { sound: 'default' } } },
    });

    const dead = [];
    res.responses.forEach((r, i) => {
      if (!r.success) {
        const code = r.error?.code || '';
        if (
          code.includes('registration-token-not-registered') ||
          code.includes('invalid-registration-token') ||
          code.includes('invalid-argument')
        ) {
          dead.push(tokens[i]);
        }
      }
    });
    if (dead.length) {
      await query('DELETE FROM device_tokens WHERE token = ANY($1)', [dead]).catch(() => {});
    }
  } catch (err) {
    console.warn('[push] send failed:', err.message);
  }
}

module.exports = {
  init,
  registerToken,
  unregisterToken,
  sendAlert,
  get enabled() {
    return enabled;
  },
};
