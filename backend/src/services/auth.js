const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query, pool } = require('../db');

const secret = () => process.env.JWT_SECRET || 'dev-secret-change-me';

async function loginUser(email, password) {
  const { rows } = await query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
  const user = rows[0];
  if (!user || !user.password_hash) {
    throw Object.assign(new Error('Invalid email or password'), { status: 401 });
  }
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) throw Object.assign(new Error('Invalid email or password'), { status: 401 });

  const token = jwt.sign(
    { userId: user.id, email: user.email, role: user.role,
      factoryId: user.factory_id, lineIds: user.line_ids || [] },
    secret(),
    { expiresIn: '7d' }
  );

  return {
    token,
    user: { id: user.id, email: user.email, name: user.name, role: user.role },
  };
}

function verifyToken(token) {
  return jwt.verify(token, secret());
}

async function listUsers() {
  const { rows } = await query(
    'SELECT id, email, name, role, factory_id, line_ids FROM users ORDER BY id'
  );
  return rows;
}

async function createUser({ email, name, password, role, factoryId, lineIds }) {
  const VALID_ROLES = ['SUPER_ADMIN','FACTORY_ADMIN','LINE_SUPERVISOR','ADMIN_OPERATOR','AUDITOR','CONTRACTOR'];
  if (!VALID_ROLES.includes(role)) throw Object.assign(new Error(`Invalid role: ${role}`), { status: 400 });

  const hash = await bcrypt.hash(password, 10);
  const { rows } = await query(
    `INSERT INTO users (email, name, password_hash, role, factory_id, line_ids)
     VALUES ($1, $2, $3, $4::user_role, $5, $6)
     RETURNING id, email, name, role, factory_id, line_ids`,
    [email.toLowerCase(), name, hash, role, factoryId || null, lineIds || null]
  );
  return rows[0];
}

async function updateUser(id, { name, password, role, factoryId, lineIds }) {
  const sets = [];
  const vals = [];
  let i = 1;
  if (name    !== undefined) { sets.push(`name = $${i++}`);                     vals.push(name); }
  if (password !== undefined){ sets.push(`password_hash = $${i++}`);             vals.push(await bcrypt.hash(password, 10)); }
  if (role    !== undefined) { sets.push(`role = $${i++}::user_role`);           vals.push(role); }
  if (factoryId !== undefined){ sets.push(`factory_id = $${i++}`);               vals.push(factoryId || null); }
  if (lineIds !== undefined) { sets.push(`line_ids = $${i++}`);                  vals.push(lineIds || null); }
  if (!sets.length) throw Object.assign(new Error('Nothing to update'), { status: 400 });
  vals.push(id);
  const { rows } = await query(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $${i} RETURNING id, email, name, role`,
    vals
  );
  if (!rows[0]) throw Object.assign(new Error('User not found'), { status: 404 });
  return rows[0];
}

async function deleteUser(id) {
  const { rowCount } = await query('DELETE FROM users WHERE id = $1', [id]);
  if (!rowCount) throw Object.assign(new Error('User not found'), { status: 404 });
}

async function ensureDefaultAdmin() {
  const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM users');
  if (rows[0].n > 0) return;

  const email = process.env.SUPER_ADMIN_EMAIL || 'admin@nexwear.io';
  const pass  = process.env.SUPER_ADMIN_PASSWORD || 'Nexwear@2025';
  const hash  = await bcrypt.hash(pass, 10);
  await pool.query(
    `INSERT INTO users (email, name, password_hash, role) VALUES ($1, 'Super Admin', $2, 'SUPER_ADMIN')
     ON CONFLICT DO NOTHING`,
    [email, hash]
  );
  console.log(`[Auth] Default SUPER_ADMIN created → ${email}`);
}

module.exports = { loginUser, verifyToken, listUsers, createUser, updateUser, deleteUser, ensureDefaultAdmin };
