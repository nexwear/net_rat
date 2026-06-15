const express = require('express');
const { query } = require('../db');
const { resolveBundle } = require('../services/devices');

const router = express.Router();

router.get('/card/:uid', async (req, res) => {
  const uid = req.params.uid.toUpperCase();
  const bundleId = await resolveBundle(uid);
  if (!bundleId) {
    return res.status(404).json({ error: 'unassigned' });
  }
  const { rows } = await query(
    'SELECT id, declared_pieces, status FROM bundles WHERE id = $1',
    [bundleId]
  );
  const bundle = rows[0];
  if (!bundle) {
    return res.status(404).json({ error: 'bundle not found' });
  }
  res.json({
    bundleId: bundle.id,
    declaredPieces: bundle.declared_pieces,
    status: bundle.status,
  });
});

router.post('/cards/:uid/assign', async (req, res) => {
  const uid = req.params.uid.toUpperCase();
  const { bundleId } = req.body || {};
  if (!bundleId) {
    return res.status(400).json({ error: 'bundleId required' });
  }

  const existing = await query('SELECT status, current_bundle_id FROM cards WHERE uid = $1', [uid]);
  if (existing.rowCount > 0 && existing.rows[0].status === 'IN_USE') {
    return res.status(409).json({ error: 'card already in use' });
  }

  await query(
    `INSERT INTO cards (uid, family, status, current_bundle_id)
     VALUES ($1, 'UNKNOWN', 'IN_USE', $2)
     ON CONFLICT (uid) DO UPDATE SET status = 'IN_USE', current_bundle_id = EXCLUDED.current_bundle_id`,
    [uid, bundleId]
  );
  await query('UPDATE bundles SET card_uid = $1, status = $2 WHERE id = $3', [
    uid,
    'ISSUED',
    bundleId,
  ]);

  res.json({ ok: true, uid, bundleId });
});

module.exports = router;
