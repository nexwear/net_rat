const express = require('express');
const { query } = require('../db');
const { resolveBundle, lookupPpp } = require('../services/devices');

const router = express.Router();

router.get('/card/:uid', async (req, res) => {
  const uid = req.params.uid.toUpperCase();
  const module = (req.query.module || '').toUpperCase();
  const bundleId = await resolveBundle(uid);
  if (!bundleId) {
    return res.status(404).json({ error: 'unassigned' });
  }
  const { rows } = await query(
    'SELECT id, declared_pieces, status, garment_model_id, size_code FROM bundles WHERE id = $1',
    [bundleId]
  );
  const bundle = rows[0];
  if (!bundle) {
    return res.status(404).json({ error: 'bundle not found' });
  }

  // PPP only matters for the rotation-quantum stations (INPUT / OUTPUT_1).
  let ppp = 0;
  if (module === 'INPUT' || module === 'OUTPUT_1') {
    ppp = Math.round(await lookupPpp(bundle.garment_model_id, bundle.size_code, module));
  }

  res.json({
    bundleId: bundle.id,
    declaredPieces: bundle.declared_pieces,
    status: bundle.status,
    ppp,
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
