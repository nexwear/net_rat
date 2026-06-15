import { useState, useEffect, useCallback } from 'react'
import { apiFetch, authHeaders } from '../../auth.js'

const API_BASE = '/api'

const ROLES = [
  { value: 'SUPER_ADMIN',    label: 'Super Admin',     desc: 'Full access' },
  { value: 'FACTORY_ADMIN',  label: 'Factory Admin',   desc: 'Manage users, bundles, nodes, OTA' },
  { value: 'LINE_SUPERVISOR',label: 'Line Supervisor',  desc: 'View own lines, manage alerts' },
  { value: 'ADMIN_OPERATOR', label: 'Admin Operator',   desc: 'Assign cards, view lines' },
  { value: 'AUDITOR',        label: 'Auditor',          desc: 'Read-only: lines and reports' },
  { value: 'CONTRACTOR',     label: 'Contractor',       desc: 'Self view only' },
]

const ROLE_CLASS = {
  SUPER_ADMIN:     'badge badge-red',
  FACTORY_ADMIN:   'badge badge-blue',
  LINE_SUPERVISOR: 'badge badge-cyan',
  ADMIN_OPERATOR:  'badge badge-yellow',
  AUDITOR:         'badge badge-gray',
  CONTRACTOR:      'badge badge-gray',
}

function CreateUserModal({ onClose, onDone }) {
  const [form, setForm] = useState({ email: '', name: '', password: '', role: 'FACTORY_ADMIN' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })) }

  async function submit() {
    if (!form.email || !form.password || !form.role) return setError('Email, password, and role are required')
    setLoading(true)
    setError('')
    try {
      const res = await apiFetch(`${API_BASE}/v1/auth/users`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      onDone()
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Create User</h2>

        <label>Email</label>
        <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="user@nexwear.io" autoFocus />

        <label>Name</label>
        <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Full name" />

        <label>Password</label>
        <input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} placeholder="Min 8 characters" />

        <label>Role</label>
        <select value={form.role} onChange={(e) => set('role', e.target.value)}>
          {ROLES.map((r) => (
            <option key={r.value} value={r.value}>{r.label} — {r.desc}</option>
          ))}
        </select>

        {error && <p className="error">{error}</p>}

        <div className="modal-actions">
          <button onClick={onClose} disabled={loading}>Cancel</button>
          <button className="btn-sm btn-primary" onClick={submit} disabled={loading}>
            {loading ? 'Creating…' : 'Create User'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ResetPasswordModal({ user, onClose, onDone }) {
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    if (!password) return setError('Password required')
    setLoading(true)
    setError('')
    try {
      const res = await apiFetch(`${API_BASE}/v1/auth/users/${user.id}`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: JSON.stringify({ password }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      onDone()
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Reset Password</h2>
        <p className="modal-node-id">{user.email}</p>
        <label>New Password</label>
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus />
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button onClick={onClose} disabled={loading}>Cancel</button>
          <button className="btn-sm btn-primary" onClick={submit} disabled={loading}>
            {loading ? 'Saving…' : 'Reset Password'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function UsersTab() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [resetUser, setResetUser] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await apiFetch(`${API_BASE}/v1/auth/users`, { headers: authHeaders() })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setUsers(data)
      setError('')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function deleteUser(id, email) {
    if (!confirm(`Delete user ${email}? This cannot be undone.`)) return
    try {
      await apiFetch(`${API_BASE}/v1/auth/users/${id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      })
      load()
    } catch (e) {
      alert(e.message)
    }
  }

  function handleDone() {
    setShowCreate(false)
    setResetUser(null)
    load()
  }

  if (loading) return <p className="loading">Loading users…</p>
  if (error) return <p className="error">{error}</p>

  return (
    <div>
      <div className="section-header">
        <h2>Users ({users.length})</h2>
        <button className="btn-sm btn-primary" onClick={() => setShowCreate(true)}>+ Add User</button>
        <button className="btn-sm" onClick={load}>Refresh</button>
      </div>

      <div style={{ marginBottom: 16, padding: '10px 14px', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
          {ROLES.map((r) => (
            <span key={r.value} style={{ fontSize: 12, color: 'var(--text-2)' }}>
              <span className={ROLE_CLASS[r.value]} style={{ marginRight: 5 }}>{r.label}</span>
              {r.desc}
            </span>
          ))}
        </div>
      </div>

      {users.length === 0 ? (
        <p className="empty">No users yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Name</th>
                <th>Role</th>
                <th>Factory</th>
                <th>Lines</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <td className="mono">{u.email}</td>
                  <td>{u.name || '—'}</td>
                  <td><span className={ROLE_CLASS[u.role] || 'badge badge-gray'}>{u.role}</span></td>
                  <td style={{ color: 'var(--text-3)' }}>{u.factory_id || '—'}</td>
                  <td style={{ color: 'var(--text-3)', fontSize: 11 }}>
                    {u.line_ids?.length ? u.line_ids.join(', ') : '—'}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn-sm" onClick={() => setResetUser(u)}>Reset PW</button>
                      <button className="btn-sm btn-danger" onClick={() => deleteUser(u.id, u.email)}>Delete</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && <CreateUserModal onClose={() => setShowCreate(false)} onDone={handleDone} />}
      {resetUser  && <ResetPasswordModal user={resetUser} onClose={() => setResetUser(null)} onDone={handleDone} />}
    </div>
  )
}
