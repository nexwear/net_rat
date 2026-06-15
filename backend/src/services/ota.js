const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { query } = require('../db');

const FIRMWARE_DIR = path.join(__dirname, '..', '..', 'firmware');

function ensureFirmwareDir() {
  if (!fs.existsSync(FIRMWARE_DIR)) {
    fs.mkdirSync(FIRMWARE_DIR, { recursive: true });
  }
}

function rolloutBucket(nodeId, pct) {
  let hash = 0;
  for (let i = 0; i < nodeId.length; i++) {
    hash = (hash * 31 + nodeId.charCodeAt(i)) >>> 0;
  }
  return hash % 100 < pct;
}

function sha256File(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(data).digest('hex');
}

function publicBaseUrl(req) {
  if (process.env.OTA_PUBLIC_BASE_URL) {
    return process.env.OTA_PUBLIC_BASE_URL.replace(/\/$/, '');
  }
  const host = req.get('host');
  const proto = req.get('x-forwarded-proto') || req.protocol;
  return `${proto}://${host}`;
}

function parseVersion(version) {
  return String(version)
    .trim()
    .split('.')
    .map((part) => parseInt(part, 10) || 0);
}

function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i++) {
    const lv = left[i] || 0;
    const rv = right[i] || 0;
    if (lv !== rv) {
      return lv - rv;
    }
  }
  return 0;
}

async function checkUpdate(node, body, req) {
  const fwVersion = body.fwVersion || node.fw_version || '0.0.0';
  const moduleType = body.moduleType || node.module_type;

  const { rows } = await query(
    `SELECT * FROM firmware_releases
     WHERE paused = false AND rollout_pct > 0
       AND (module_type IS NULL OR module_type = $1::module_type)
     ORDER BY created_at DESC`,
    [moduleType]
  );

  let best = null;
  for (const release of rows) {
    if (compareVersions(release.version, fwVersion) <= 0) {
      continue;
    }
    if (!rolloutBucket(node.id, release.rollout_pct)) {
      continue;
    }
    if (!best || compareVersions(release.version, best.version) > 0) {
      best = release;
    }
  }

  if (!best) {
    return { update: false };
  }

  return {
    update: true,
    version: best.version,
    url: best.url.startsWith('http')
      ? best.url
      : `${publicBaseUrl(req)}${best.url}`,
    sha256: best.sha256,
  };
}

async function reportUpdate(node, body) {
  const { fromVersion, toVersion, success, detail } = body;
  await query(
    `INSERT INTO ota_events (node_id, from_version, to_version, success, detail)
     VALUES ($1, $2, $3, $4, $5)`,
    [node.id, fromVersion || null, toVersion || null, !!success, detail || null]
  );

  if (success && toVersion) {
    await query('UPDATE nodes SET fw_version = $1 WHERE id = $2', [toVersion, node.id]);
  }

  return { ok: true };
}

async function registerRelease({ version, moduleType, rolloutPct, fileName }, req) {
  ensureFirmwareDir();
  const binName = fileName || `firmware-${version}.bin`;
  const filePath = path.join(FIRMWARE_DIR, binName);
  if (!fs.existsSync(filePath)) {
    const err = new Error(`firmware file not found: ${binName} (place in backend/firmware/)`);
    err.status = 400;
    throw err;
  }

  const sha256 = sha256File(filePath);
  const url = `/v1/ota/bin/${binName}`;
  const mod = moduleType || null;

  const { rows } = await query(
    `INSERT INTO firmware_releases (version, module_type, url, sha256, rollout_pct)
     VALUES ($1, $2::module_type, $3, $4, $5)
     ON CONFLICT (version, module_type) DO UPDATE
     SET url = EXCLUDED.url, sha256 = EXCLUDED.sha256, rollout_pct = EXCLUDED.rollout_pct,
         paused = false, created_at = NOW()
     RETURNING *`,
    [version, mod, url, sha256, rolloutPct ?? 100]
  );

  return {
    ...rows[0],
    publicUrl: `${publicBaseUrl(req)}${url}`,
    sha256,
  };
}

async function listReleases() {
  const { rows } = await query(
    'SELECT * FROM firmware_releases ORDER BY created_at DESC LIMIT 50'
  );
  return rows;
}

async function setRollout(id, { rolloutPct, paused }) {
  const { rows } = await query(
    `UPDATE firmware_releases
     SET rollout_pct = COALESCE($2, rollout_pct),
         paused = COALESCE($3, paused)
     WHERE id = $1
     RETURNING *`,
    [id, rolloutPct, paused]
  );
  if (rows.length === 0) {
    const err = new Error('release not found');
    err.status = 404;
    throw err;
  }
  return rows[0];
}

function resolveBinPath(fileName) {
  const safe = path.basename(fileName);
  const filePath = path.join(FIRMWARE_DIR, safe);
  if (!fs.existsSync(filePath)) {
    const err = new Error('firmware not found');
    err.status = 404;
    throw err;
  }
  return filePath;
}

module.exports = {
  ensureFirmwareDir,
  checkUpdate,
  reportUpdate,
  registerRelease,
  listReleases,
  setRollout,
  resolveBinPath,
  FIRMWARE_DIR,
};
