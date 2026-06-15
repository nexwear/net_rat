import { useState, useEffect, useCallback } from 'react'
import { API_BASE, adminHeaders } from './AdminPage.jsx'

const MODULE_TYPES = ['INPUT', 'OUTPUT_1', 'OUTPUT_2', 'ADMIN']

function timeSince(ts) {
  if (!ts) return '—'
  const sec = Math.floor((Date.now() - new Date(ts)) / 1000)
  if (sec < 60) return `${sec}s ago`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  return `${Math.floor(sec / 3600)}h ago`
}

const STATUS_CLASS = {
  PENDING: 'badge badge-yellow',
  ACTIVE: 'badge badge-green',
  OFFLINE: 'badge badge-gray',
  DECOMMISSIONED: 'badge badge-red',
}

function StatusBadge({ status }) {
  return <span className={STATUS_CLASS[status] || 'badge badge-gray'}>{status}</span>
}

function ApproveModal({ node, onClose, onDone }) {
  const [moduleType, setModuleType] = useState(node.module_type || 'INPUT')
  const [lineId, setLineId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API_BASE}/v1/admin/nodes/${node.id}/approve`, {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify({ moduleType, lineId: lineId || undefined }),
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
        <h2>Approve Node</h2>
        <p className="modal-node-id">{node.id}</p>
        <label>Module Type</label>
        <select value={moduleType} onChange={(e) => setModuleType(e.target.value)}>
          {MODULE_TYPES.map((m) => <option key={m}>{m}</option>)}
        </select>
        <label>Line ID (optional)</label>
        <input value={lineId} onChange={(e) => setLineId(e.target.value)} placeholder="leave blank for default" />
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button onClick={onClose} disabled={loading}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={loading}>
            {loading ? 'Approving…' : 'Approve'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ReconfigModal({ node, onClose, onDone }) {
  const [mode, setMode] = useState('module')
  const [moduleType, setModuleType] = useState(node.module_type || 'INPUT')
  const [ssid, setSsid] = useState('')
  const [wifiPass, setWifiPass] = useState('')
  const [confirm, setConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  async function sendReconfig(body) {
    setLoading(true)
    setError('')
    setSuccess('')
    try {
      const res = await fetch(`${API_BASE}/v1/admin/nodes/${node.id}/reconfig`, {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setSuccess('Command queued — node will apply on next heartbeat (≤15 s).')
      setTimeout(onDone, 1500)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  function submit() {
    if (mode === 'module') {
      sendReconfig({ type: 'SET_MODULE_TYPE', moduleType })
    } else if (mode === 'wifi') {
      if (!ssid) return setError('SSID required')
      sendReconfig({ type: 'SET_WIFI', wifi: [{ ssid, pass: wifiPass }] })
    } else if (mode === 'ota') {
      sendReconfig({ type: 'FORCE_OTA_CHECK' })
    } else if (mode === 'reset') {
      sendReconfig({ type: 'FACTORY_RESET' })
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Reconfigure Node</h2>
        <p className="modal-node-id">{node.id}</p>

        <div className="reconfig-tabs">
          {[['module', 'Module Type'], ['wifi', 'WiFi'], ['ota', 'Force OTA'], ['reset', 'Factory Reset']].map(([k, label]) => (
            <button key={k} className={mode === k ? 'rtab active' : 'rtab'} onClick={() => { setMode(k); setError(''); setSuccess('') }}>
              {label}
            </button>
          ))}
        </div>

        {mode === 'module' && (
          <>
            <label>New Module Type</label>
            <select value={moduleType} onChange={(e) => setModuleType(e.target.value)}>
              {MODULE_TYPES.map((m) => <option key={m}>{m}</option>)}
            </select>
          </>
        )}

        {mode === 'wifi' && (
          <>
            <label>SSID</label>
            <input value={ssid} onChange={(e) => setSsid(e.target.value)} placeholder="WiFi network name" />
            <label>Password</label>
            <input type="password" value={wifiPass} onChange={(e) => setWifiPass(e.target.value)} placeholder="leave blank if open" />
          </>
        )}

        {mode === 'ota' && (
          <p className="info-text">Forces the node to check for OTA updates immediately on next heartbeat.</p>
        )}

        {mode === 'reset' && (
          <>
            <p className="warn-text">⚠ This will wipe all NVS config and reboot the node into provisioning mode. It will need to be re-provisioned via SoftAP.</p>
            <label className="check-row">
              <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} />
              I understand this will erase the node config
            </label>
          </>
        )}

        {error && <p className="error">{error}</p>}
        {success && <p className="success">{success}</p>}

        <div className="modal-actions">
          <button onClick={onClose} disabled={loading}>Cancel</button>
          <button
            className={mode === 'reset' ? 'btn-danger' : 'btn-primary'}
            onClick={submit}
            disabled={loading || (mode === 'reset' && !confirm)}
          >
            {loading ? 'Sending…' : 'Send Command'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function NodesTab() {
  const [nodes, setNodes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [approveNode, setApproveNode] = useState(null)
  const [reconfigNode, setReconfigNode] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/v1/admin/nodes`, { headers: adminHeaders() })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load nodes')
      setNodes(data)
      setError('')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function handleDone() {
    setApproveNode(null)
    setReconfigNode(null)
    load()
  }

  if (loading) return <p className="loading">Loading nodes…</p>
  if (error) return <p className="error">{error}</p>

  return (
    <div>
      <div className="section-header">
        <h2>Nodes ({nodes.length})</h2>
        <button onClick={load} className="btn-sm">Refresh</button>
      </div>

      {nodes.length === 0 ? (
        <p className="empty">No nodes yet. Flash a device and provision it via SoftAP.</p>
      ) : (
        <div className="table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Node ID</th>
                <th>Type</th>
                <th>FW Version</th>
                <th>Status</th>
                <th>Last Seen</th>
                <th>RSSI</th>
                <th>Pending Op</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {nodes.map((n) => (
                <tr key={n.id}>
                  <td>
                    {n.label && (
                      <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 2 }}>{n.label}</div>
                    )}
                    <span className="mono" style={{ color: n.label ? 'var(--text-3)' : undefined }}>{n.id}</span>
                  </td>
                  <td>{n.module_type || '—'}</td>
                  <td className="mono">{n.fw_version || '—'}</td>
                  <td><StatusBadge status={n.status} /></td>
                  <td>{timeSince(n.last_seen_at)}</td>
                  <td>{n.rssi != null ? `${n.rssi} dBm` : '—'}</td>
                  <td className="mono pending-op">
                    {n.pending_op ? n.pending_op.type : '—'}
                  </td>
                  <td>
                    {n.status === 'PENDING' && (
                      <button className="btn-sm btn-primary" onClick={() => setApproveNode(n)}>Approve</button>
                    )}
                    {n.status === 'ACTIVE' && (
                      <button className="btn-sm" onClick={() => setReconfigNode(n)}>Reconfigure</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {approveNode && (
        <ApproveModal node={approveNode} onClose={() => setApproveNode(null)} onDone={handleDone} />
      )}
      {reconfigNode && (
        <ReconfigModal node={reconfigNode} onClose={() => setReconfigNode(null)} onDone={handleDone} />
      )}
    </div>
  )
}
