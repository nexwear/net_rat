import { useState, useEffect, useCallback, useRef } from 'react'
import { API_BASE, adminHeaders } from './AdminPage.jsx'

function timeSince(ts) {
  if (!ts) return '—'
  const sec = Math.floor((Date.now() - new Date(ts)) / 1000)
  if (sec < 60) return `${sec}s ago`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  return `${Math.floor(sec / 3600)}h ago`
}

function UploadPanel({ onUploaded }) {
  const [version, setVersion] = useState('')
  const [moduleType, setModuleType] = useState('')
  const [rolloutPct, setRolloutPct] = useState(10)
  const [file, setFile] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const fileRef = useRef()

  async function submit(e) {
    e.preventDefault()
    if (!version.trim()) return setError('Version required (e.g. 1.0.14)')
    if (!file) return setError('Select a .bin file')
    setLoading(true)
    setError('')
    setSuccess('')

    try {
      const fileName = `firmware-${version.trim()}.bin`

      const uploadRes = await fetch(`${API_BASE}/v1/admin/ota/firmware/${fileName}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/octet-stream',
          ...adminHeaders(),
        },
        body: file,
      })
      if (!uploadRes.ok) {
        const d = await uploadRes.json()
        throw new Error(d.error || 'Upload failed')
      }

      const body = { version: version.trim(), rolloutPct, fileName }
      if (moduleType) body.moduleType = moduleType

      const regRes = await fetch(`${API_BASE}/v1/admin/ota/releases`, {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify(body),
      })
      const data = await regRes.json()
      if (!regRes.ok) throw new Error(data.error || 'Register failed')

      setSuccess(`Release ${data.version} registered (rollout ${data.rollout_pct}%).`)
      setVersion('')
      setFile(null)
      if (fileRef.current) fileRef.current.value = ''
      onUploaded()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form className="upload-panel" onSubmit={submit}>
      <h3>Upload New Firmware</h3>
      <div className="upload-row">
        <div>
          <label>Version</label>
          <input value={version} onChange={(e) => setVersion(e.target.value)} placeholder="1.0.14" />
        </div>
        <div>
          <label>Module Type (blank = all)</label>
          <select value={moduleType} onChange={(e) => setModuleType(e.target.value)}>
            <option value="">All nodes</option>
            <option>INPUT</option>
            <option>OUTPUT_1</option>
            <option>OUTPUT_2</option>
            <option>ADMIN</option>
          </select>
        </div>
        <div>
          <label>Initial Rollout %</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="range" min="0" max="100" value={rolloutPct}
              onChange={(e) => setRolloutPct(Number(e.target.value))}
              style={{ flex: 1 }}
            />
            <span style={{ minWidth: 32 }}>{rolloutPct}%</span>
          </div>
        </div>
        <div>
          <label>Firmware Binary (.bin)</label>
          <input
            type="file" accept=".bin" ref={fileRef}
            onChange={(e) => setFile(e.target.files[0] || null)}
          />
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {success && <p className="success">{success}</p>}
      <button type="submit" className="btn-primary" disabled={loading}>
        {loading ? 'Uploading…' : 'Upload & Register'}
      </button>
    </form>
  )
}

function RolloutRow({ release, nodeCount, onUpdated }) {
  const [pct, setPct] = useState(release.rollout_pct)
  const [saving, setSaving] = useState(false)

  async function patch(patch) {
    setSaving(true)
    try {
      const res = await fetch(`${API_BASE}/v1/admin/ota/releases/${release.id}`, {
        method: 'PATCH',
        headers: adminHeaders(),
        body: JSON.stringify(patch),
      })
      if (res.ok) onUpdated()
    } finally {
      setSaving(false)
    }
  }

  return (
    <tr>
      <td className="mono">{release.version}</td>
      <td>{release.module_type || 'All'}</td>
      <td>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="range" min="0" max="100" value={pct} disabled={saving || release.paused}
            onChange={(e) => setPct(Number(e.target.value))}
            onMouseUp={() => patch({ rolloutPct: pct })}
            onTouchEnd={() => patch({ rolloutPct: pct })}
            style={{ width: 100 }}
          />
          <span style={{ minWidth: 32 }}>{pct}%</span>
        </div>
      </td>
      <td>
        <button
          className={release.paused ? 'btn-sm btn-primary' : 'btn-sm btn-danger'}
          onClick={() => patch({ paused: !release.paused })}
          disabled={saving}
        >
          {release.paused ? 'Resume' : 'Pause'}
        </button>
      </td>
      <td>{nodeCount > 0 ? <span className="badge badge-green">{nodeCount} node{nodeCount !== 1 ? 's' : ''}</span> : <span style={{color:'var(--text-3)'}}>—</span>}</td>
      <td>{timeSince(release.created_at)}</td>
    </tr>
  )
}

export default function OtaTab() {
  const [releases, setReleases] = useState([])
  const [nodes, setNodes] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [rRes, nRes] = await Promise.all([
        fetch(`${API_BASE}/v1/admin/ota/releases`, { headers: adminHeaders() }),
        fetch(`${API_BASE}/v1/admin/nodes`, { headers: adminHeaders() }),
      ])
      const [rData, nData] = await Promise.all([rRes.json(), nRes.json()])
      if (!rRes.ok) throw new Error(rData.error || 'Failed to load releases')
      setReleases(rData)
      setNodes(Array.isArray(nData) ? nData : [])
      setError('')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  function nodeCountForVersion(version) {
    return nodes.filter((n) => n.fw_version === version).length
  }

  return (
    <div>
      <UploadPanel onUploaded={load} />

      <div className="section-header" style={{ marginTop: 32 }}>
        <h2>Firmware Releases</h2>
        <button onClick={load} className="btn-sm">Refresh</button>
      </div>

      {loading && <p className="loading">Loading…</p>}
      {error && <p className="error">{error}</p>}

      {!loading && releases.length === 0 && (
        <p className="empty">No releases yet. Upload a firmware binary above.</p>
      )}

      {releases.length > 0 && (
        <div className="table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Version</th>
                <th>Module Type</th>
                <th>Rollout</th>
                <th>State</th>
                <th>Nodes on this version</th>
                <th>Registered</th>
              </tr>
            </thead>
            <tbody>
              {releases.map((r) => (
                <RolloutRow
                  key={r.id}
                  release={r}
                  nodeCount={nodeCountForVersion(r.version)}
                  onUpdated={load}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {nodes.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h3>Node Firmware Summary</h3>
          <div className="table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Node ID</th>
                  <th>Type</th>
                  <th>FW Version</th>
                  <th>Status</th>
                  <th>Last Seen</th>
                </tr>
              </thead>
              <tbody>
                {nodes.map((n) => (
                  <tr key={n.id}>
                    <td className="mono">{n.id}</td>
                    <td>{n.module_type || '—'}</td>
                    <td className="mono">{n.fw_version || '—'}</td>
                    <td>{n.status}</td>
                    <td>{timeSince(n.last_seen_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
