import { useState, useEffect, useCallback } from 'react'
import { API_BASE, adminHeaders } from './AdminPage.jsx'

const STATUS_COLORS = {
  ISSUED: '#7a8bb0',
  IN_PROGRESS: '#e59f00',
  COMPLETED: '#2caa4a',
  LOST: '#c44',
}

function StatusBadge({ status }) {
  return (
    <span
      style={{
        background: STATUS_COLORS[status] || '#888',
        color: '#fff',
        borderRadius: 4,
        padding: '2px 7px',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: 0.5,
      }}
    >
      {status}
    </span>
  )
}

function CreateBundlePanel({ onCreated }) {
  const [lines, setLines] = useState([])
  const [contractors, setContractors] = useState([])
  const [models, setModels] = useState([])
  const [sizes, setSizes] = useState([])

  const [lineId, setLineId] = useState('')
  const [pieces, setPieces] = useState(100)
  const [contractorId, setContractorId] = useState('')
  const [modelId, setModelId] = useState('')
  const [sizeCode, setSizeCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  useEffect(() => {
    const h = adminHeaders()
    Promise.all([
      fetch(`${API_BASE}/v1/admin/lines`, { headers: h }).then((r) => r.json()),
      fetch(`${API_BASE}/v1/admin/contractors`, { headers: h }).then((r) => r.json()),
      fetch(`${API_BASE}/v1/admin/garment-models`, { headers: h }).then((r) => r.json()),
      fetch(`${API_BASE}/v1/admin/sizes`, { headers: h }).then((r) => r.json()),
    ]).then(([l, c, m, s]) => {
      setLines(Array.isArray(l) ? l : [])
      setContractors(Array.isArray(c) ? c : [])
      setModels(Array.isArray(m) ? m : [])
      setSizes(Array.isArray(s) ? s : [])
      if (l[0]) setLineId(String(l[0].id))
    })
  }, [])

  async function submit(e) {
    e.preventDefault()
    if (!pieces || pieces < 1) return setError('Declared pieces must be > 0')
    setLoading(true)
    setError('')
    setSuccess('')
    try {
      const body = {
        lineId: lineId ? Number(lineId) : undefined,
        declaredPieces: Number(pieces),
        contractorId: contractorId ? Number(contractorId) : undefined,
        garmentModelId: modelId ? Number(modelId) : undefined,
        sizeCode: sizeCode ? Number(sizeCode) : undefined,
      }
      const res = await fetch(`${API_BASE}/v1/admin/bundles`, {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setSuccess(`Bundle created: ${data.id.slice(0, 8)}…`)
      setPieces(100)
      setContractorId('')
      setModelId('')
      setSizeCode('')
      onCreated()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form className="upload-panel" onSubmit={submit}>
      <h3>Create Bundle</h3>
      <div className="upload-row">
        <div>
          <label>Line</label>
          <select value={lineId} onChange={(e) => setLineId(e.target.value)}>
            {lines.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label>Declared Pieces</label>
          <input
            type="number" min="1" value={pieces}
            onChange={(e) => setPieces(e.target.value)}
          />
        </div>
        <div>
          <label>Contractor</label>
          <select value={contractorId} onChange={(e) => setContractorId(e.target.value)}>
            <option value="">— none —</option>
            {contractors.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label>Garment Model</label>
          <select value={modelId} onChange={(e) => setModelId(e.target.value)}>
            <option value="">— none —</option>
            {models.map((m) => (
              <option key={m.id} value={m.id}>{m.style}</option>
            ))}
          </select>
        </div>
        <div>
          <label>Size</label>
          <select value={sizeCode} onChange={(e) => setSizeCode(e.target.value)}>
            <option value="">— none —</option>
            {sizes.map((s) => (
              <option key={s.code} value={s.code}>{s.label}</option>
            ))}
          </select>
        </div>
      </div>
      {error && <p className="error">{error}</p>}
      {success && <p className="success">{success}</p>}
      <button type="submit" className="btn-primary" disabled={loading}>
        {loading ? 'Creating…' : 'Create Bundle'}
      </button>
    </form>
  )
}

function AssignCardModal({ bundle, onClose, onDone }) {
  const [cardUid, setCardUid] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    if (!cardUid.trim()) return setError('Card UID required')
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API_BASE}/v1/admin/bundles/${bundle.id}/assign-card`, {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify({ cardUid: cardUid.trim().toUpperCase() }),
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
        <h2>Assign Card</h2>
        <p className="modal-node-id">Bundle {bundle.id.slice(0, 8)}… · {bundle.declared_pieces} pcs</p>
        <label>Card UID (hex)</label>
        <input
          value={cardUid}
          onChange={(e) => setCardUid(e.target.value)}
          placeholder="e.g. A1B2C3D4"
          autoFocus
        />
        {error && <p className="error">{error}</p>}
        <div className="modal-actions">
          <button onClick={onClose} disabled={loading}>Cancel</button>
          <button className="btn-primary" onClick={submit} disabled={loading}>
            {loading ? 'Assigning…' : 'Assign'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function BundlesTab() {
  const [bundles, setBundles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [assignBundle, setAssignBundle] = useState(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/v1/admin/bundles`, { headers: adminHeaders() })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load bundles')
      setBundles(data)
      setError('')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function releaseCard(bundle) {
    try {
      await fetch(`${API_BASE}/v1/admin/bundles/${bundle.id}/release-card`, {
        method: 'POST',
        headers: adminHeaders(),
      })
      load()
    } catch (e) {
      console.error(e)
    }
  }

  function handleDone() {
    setAssignBundle(null)
    load()
  }

  return (
    <div>
      <CreateBundlePanel onCreated={load} />

      <div className="section-header" style={{ marginTop: 32 }}>
        <h2>Bundles ({bundles.length})</h2>
        <button onClick={load} className="btn-sm">Refresh</button>
      </div>

      {loading && <p className="loading">Loading…</p>}
      {error && <p className="error">{error}</p>}

      {!loading && bundles.length === 0 && (
        <p className="empty">No bundles yet. Create one above.</p>
      )}

      {bundles.length > 0 && (
        <div className="table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Bundle ID</th>
                <th>Line</th>
                <th>Model / Size</th>
                <th>Contractor</th>
                <th>Pieces</th>
                <th>Status</th>
                <th>Card</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {bundles.map((b) => (
                <tr key={b.id}>
                  <td className="mono">{b.id.slice(0, 8)}…</td>
                  <td>{b.line_name || b.line_id || '—'}</td>
                  <td>{[b.garment_model, b.size_label].filter(Boolean).join(' / ') || '—'}</td>
                  <td>{b.contractor_name || '—'}</td>
                  <td>{b.declared_pieces}</td>
                  <td><StatusBadge status={b.status} /></td>
                  <td className="mono">{b.assigned_card_uid || b.card_uid || '—'}</td>
                  <td style={{ fontSize: 11, color: '#7a8bb0' }}>
                    {b.created_at ? new Date(b.created_at).toLocaleString() : '—'}
                  </td>
                  <td>
                    {b.status !== 'COMPLETED' && !b.assigned_card_uid && !b.card_uid && (
                      <button className="btn-sm btn-primary" onClick={() => setAssignBundle(b)}>
                        Assign Card
                      </button>
                    )}
                    {(b.assigned_card_uid || b.card_uid) && b.status !== 'COMPLETED' && (
                      <button className="btn-sm btn-danger" onClick={() => releaseCard(b)}>
                        Release
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {assignBundle && (
        <AssignCardModal bundle={assignBundle} onClose={() => setAssignBundle(null)} onDone={handleDone} />
      )}
    </div>
  )
}
