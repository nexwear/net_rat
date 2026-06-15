const { verifyToken } = require('../services/auth');

const PERMS = {
  SUPER_ADMIN:     ['*'],
  FACTORY_ADMIN:   ['users.manage','master.manage','cards.assign','cards.pool',
                    'line.view','alerts.manage','nodes.config','ota.view','reports.view'],
  LINE_SUPERVISOR: ['line.view:own','alerts.manage:own','reports.view:own'],
  ADMIN_OPERATOR:  ['cards.assign','cards.pool','line.view'],
  AUDITOR:         ['line.view','reports.view'],
  CONTRACTOR:      ['self.view'],
};

function hasPerm(role, perm) {
  const list = PERMS[role] || [];
  return list.includes('*') || list.includes(perm) || list.includes(perm + ':own');
}

function jwtAuth(req, res, next) {
  const header = req.get('Authorization');
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'authentication required' });
  }
  const token = header.slice(7);

  // Machine-to-machine: ADMIN_SECRET acts as SUPER_ADMIN
  const adminSecret = process.env.ADMIN_SECRET;
  if (adminSecret && token === adminSecret) {
    req.user = { userId: null, email: 'system', role: 'SUPER_ADMIN', factoryId: null, lineIds: [] };
    return next();
  }

  try {
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(401).json({ error: 'invalid or expired token' });
  }
}

function requirePerm(perm) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'not authenticated' });
    if (!hasPerm(req.user.role, perm)) {
      return res.status(403).json({ error: `permission required: ${perm}` });
    }
    next();
  };
}

module.exports = { jwtAuth, requirePerm, hasPerm, PERMS };
