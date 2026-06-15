const express = require('express');
const { loginUser, listUsers, createUser, updateUser, deleteUser } = require('../services/auth');
const { jwtAuth, requirePerm } = require('../middleware/rbac');

const router = express.Router();

// POST /v1/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });
    const result = await loginUser(email, password);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// GET /v1/auth/me  — returns current user from token
router.get('/me', jwtAuth, (req, res) => {
  res.json(req.user);
});

// GET /v1/auth/users
router.get('/users', jwtAuth, requirePerm('users.manage'), async (_req, res) => {
  try {
    res.json(await listUsers());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /v1/auth/users
router.post('/users', jwtAuth, requirePerm('users.manage'), async (req, res) => {
  try {
    const { email, name, password, role, factoryId, lineIds } = req.body || {};
    if (!email || !password || !role) return res.status(400).json({ error: 'email, password, role required' });
    const user = await createUser({ email, name, password, role, factoryId, lineIds });
    res.status(201).json(user);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// PATCH /v1/auth/users/:id
router.patch('/users/:id', jwtAuth, requirePerm('users.manage'), async (req, res) => {
  try {
    const user = await updateUser(Number(req.params.id), req.body || {});
    res.json(user);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// DELETE /v1/auth/users/:id
router.delete('/users/:id', jwtAuth, requirePerm('users.manage'), async (req, res) => {
  try {
    await deleteUser(Number(req.params.id));
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

module.exports = router;
