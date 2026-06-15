const express = require('express');
const { jwtAuth } = require('../middleware/rbac');
const push = require('../services/push');

const router = express.Router();

// Register this device to receive push notifications (called after login).
router.post('/register', jwtAuth, async (req, res) => {
  const { token, platform } = req.body || {};
  if (!token) return res.status(400).json({ error: 'token required' });
  try {
    await push.registerToken(req.user.userId, token, platform);
    res.json({ ok: true, pushEnabled: push.enabled });
  } catch (err) {
    console.error('register token error', err);
    res.status(500).json({ error: 'failed to register token' });
  }
});

// Stop receiving pushes on this device (called on logout).
router.post('/unregister', jwtAuth, async (req, res) => {
  const { token } = req.body || {};
  try {
    await push.unregisterToken(token);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'failed to unregister token' });
  }
});

module.exports = router;
