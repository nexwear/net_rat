const express = require('express');
const { query } = require('../db');

const router = express.Router();

router.post('/bundles', async (req, res) => {
  const { lineId, declaredPieces } = req.body || {};
  const pieces = Number(declaredPieces) || 100;

  let line = lineId;
  if (!line) {
    const { rows } = await query('SELECT id FROM lines ORDER BY id LIMIT 1');
    line = rows[0]?.id;
  }
  if (!line) {
    return res.status(400).json({ error: 'no line configured' });
  }

  const { rows } = await query(
    `INSERT INTO bundles (line_id, declared_pieces, status)
     VALUES ($1, $2, 'ISSUED')
     RETURNING id, line_id, declared_pieces, status, created_at`,
    [line, pieces]
  );
  res.status(201).json(rows[0]);
});

router.get('/bundles', async (_req, res) => {
  const { rows } = await query(
    `SELECT b.id, b.line_id, b.declared_pieces, b.card_uid, b.status, b.created_at,
            c.uid AS assigned_card_uid, c.status AS card_status
     FROM bundles b
     LEFT JOIN cards c ON c.current_bundle_id = b.id
     ORDER BY b.created_at DESC
     LIMIT 50`
  );
  res.json(rows);
});

router.get('/bundles/:id', async (req, res) => {
  const { rows } = await query(
    `SELECT b.*, c.uid AS assigned_card_uid
     FROM bundles b
     LEFT JOIN cards c ON c.current_bundle_id = b.id
     WHERE b.id = $1`,
    [req.params.id]
  );
  if (rows.length === 0) {
    return res.status(404).json({ error: 'not found' });
  }
  res.json(rows[0]);
});

module.exports = router;
