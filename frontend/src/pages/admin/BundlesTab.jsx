import { useState, useEffect, useCallback, useRef } from 'react'
import { API_BASE, adminHeaders } from './AdminPage.jsx'

const STATUS_CLASS = {
  ISSUED: 'badge badge-gray',
  IN_PROGRESS: 'badge badge-yellow',
  COMPLETED: 'badge badge-green',
  LOST: 'badge badge-red',
}

function StatusBadge({ status }) {
  return <span className={STATUS_CLASS[status] || 'badge badge-gray'}>{status}</span>
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

function fmt(n) {
  return n != null ? String(n).padStart(3, '0') : null
}

function AssignCardModal({ bundle, onClose, onDone }) {
  const [available, setAvailable] = useState([])
  const [selected, setSelected]   = useState('')
  const [manualUid, setManualUid] = useState('')
  const [mode, setMode] = useState('admin') // admin | pick | manual
  const [loading, setLoading]     = useState(false)
  const [fetching, setFetching]   = useState(true)
  const [error, setError]         = useState('')
  const [waitingTap, setWaitingTap] = useState(true)
  const [lastTap, setLastTap] = useState(null)
  const seenScanRef = useRef(new Set())

  useEffect(() => {
    fetch(`${API_BASE}/v1/admin/cards/available`, { headers: adminHeaders() })
      .then((r) => r.json())
      .then((data) => {
        setAvailable(Array.isArray(data) ? data : [])
        if (data.length > 0) setSelected(String(data[0].card_number ?? ''))
      })
      .catch(() => setMode('manual'))
      .finally(() => setFetching(false))
  }, [])

  async function assignUid(uid) {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`${API_BASE}/v1/admin/bundles/${bundle.id}/assign-card`, {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify({ cardUid: uid.trim().toUpperCase() }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      onDone()
    } catch (e) {
      setError(e.message)
      setWaitingTap(true)
    } finally {
      setLoading(false)
    }
  }

  // Poll admin-room ASSIGN_SCAN events (ADMIN nodes only).
  useEffect(() => {
    if (mode !== 'admin' || !waitingTap || loading) return undefined
    let cancelled = false

    async function poll() {
      try {
        const res = await fetch(
          `${API_BASE}/v1/scans/recent?kind=ASSIGN_SCAN&minutes=2`,
          { headers: adminHeaders() }
        )
        const scans = await res.json()
        if (!Array.isArray(scans) || cancelled) return
        for (const s of scans) {
          if (!s.event_id || !s.card_uid || seenScanRef.current.has(s.event_id)) continue
          seenScanRef.current.add(s.event_id)
          setLastTap({
            uid: s.card_uid,
            cardNumber: s.card_number,
            status: s.card_status,
          })
          setWaitingTap(false)
          await assignUid(s.card_uid)
          return
        }
      } catch (_) {}
    }

    poll()
    const id = setInterval(poll, 1500)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [mode, waitingTap, loading, bundle.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function submit() {
    setLoading(true); setError('')
    try {
      if (mode === 'manual') {
        if (!manualUid.trim()) throw new Error('Card UID required')
        await assignUid(manualUid)
        return
      }
      if (!selected) throw new Error('Select a card')
      const res = await fetch(`${API_BASE}/v1/admin/bundles/${bundle.id}/assign-card`, {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify({ cardNumber: Number(selected) }),
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
        <p className="modal-node-id">Bundle {bundle.id.slice(0, 8)}… · {bundle.declared_pieces} pcs · {bundle.contractor_name || 'no contractor'}</p>

        <div className="reconfig-tabs" style={{ marginBottom: 14 }}>
          {[
            ['admin', 'Admin reader'],
            ['pick', 'Pick card #'],
            ['manual', 'Enter UID'],
          ].map(([k, label]) => (
            <button
              key={k}
              type="button"
              className={mode === k ? 'rtab active' : 'rtab'}
              onClick={() => { setMode(k); setError(''); setWaitingTap(true) }}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === 'admin' && (
          <div style={{
            background: 'var(--surface-2)', borderRadius: 8, padding: '14px 16px',
            border: '1px solid var(--brand)', marginBottom: 12,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <span style={{
                width: 8, height: 8, borderRadius: '50%', background: 'var(--brand)',
                boxShadow: waitingTap ? '0 0 6px var(--brand)' : 'none',
              }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--brand)' }}>
                {loading ? 'Assigning…' : waitingTap ? 'Waiting for admin reader tap' : 'Processing…'}
              </span>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0, lineHeight: 1.5 }}>
              Tap the NFC card on the <strong>admin room reader</strong>. This scan is only used to link the card to this bundle — it does not start a production session.
            </p>
            {lastTap?.cardNumber != null && (
              <div style={{
                marginTop: 10, display: 'flex', alignItems: 'center', gap: 10,
                background: 'var(--surface-1)', borderRadius: 6, padding: '8px 10px',
              }}>
                <span style={{ fontSize: 20, fontWeight: 800, fontFamily: 'var(--mono)' }}>
                  {fmt(lastTap.cardNumber)}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>
                  {lastTap.uid}
                </span>
              </div>
            )}
          </div>
        )}

        {mode === 'pick' && (
          <>
            <label>Select Available Card</label>
            {fetching ? (
              <p style={{ color: 'var(--text-3)', fontSize: 12 }}>Loading available cards…</p>
            ) : available.length === 0 ? (
              <p className="warn-text">No registered cards available. Register cards in the Cards tab first, or use admin reader / manual UID.</p>
            ) : (
              <select value={selected} onChange={(e) => setSelected(e.target.value)} autoFocus>
                {available.map((c) => (
                  <option key={c.uid} value={String(c.card_number)}>
                    {fmt(c.card_number)}{c.label ? ` — ${c.label}` : ''} ({c.uid})
                  </option>
                ))}
              </select>
            )}
          </>
        )}

        {mode === 'manual' && (
          <>
            <label>Card UID (hex)</label>
            <input value={manualUid} onChange={(e) => setManualUid(e.target.value)}
              placeholder="e.g. A1B2C3D4" autoFocus />
          </>
        )}

        {error && <p className="error">{error}</p>}

        <div className="modal-actions">
          <button onClick={onClose} disabled={loading}>Cancel</button>
          {mode !== 'admin' && (
            <button className="btn-sm btn-primary" onClick={submit}
              disabled={loading || (mode === 'pick' && available.length === 0 && !fetching)}>
              {loading ? 'Assigning…' : 'Assign'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Bundle pipeline tracker ──────────────────────────────────────────────────

const MOD_ORDER  = ['INPUT', 'OUTPUT_1', 'OUTPUT_2']
const MOD_LABEL  = { INPUT: 'Input', OUTPUT_1: 'Output 1', OUTPUT_2: 'Output 2' }
const MOD_COLOR  = { INPUT: 'var(--brand)', OUTPUT_1: '#8b5cf6', OUTPUT_2: '#ec4899' }

function elapsed(start, end) {
  if (!start) return '—'
  const ms = (end ? new Date(end) : new Date()) - new Date(start)
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  if (h > 0) return `${h}h ${m % 60}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}

function StageCard({ session, declared, prev }) {
  const done    = !!session?.end_ts
  const active  = !!session && !done
  const waiting = !session

  const pct = declared > 0 && session ? Math.min(100, Math.round((session.count_pass / declared) * 100)) : 0
  const color = waiting ? 'var(--border)' : (active ? MOD_COLOR[session.module_type] : 'var(--success)')

  const yieldVsPrev = prev && prev.count_pass > 0 && session
    ? Math.round((session.count_pass / prev.count_pass) * 100) : null

  return (
    <div style={{
      flex: 1, minWidth: 160,
      border: `1px solid ${color}`,
      borderTop: `3px solid ${color}`,
      borderRadius: 8,
      padding: '14px 16px',
      background: 'var(--surface)',
      display: 'flex', flexDirection: 'column', gap: 8,
      opacity: waiting ? 0.45 : 1,
    }}>
      {/* Stage header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{
          fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
          color, textTransform: 'uppercase',
        }}>
          {MOD_LABEL[session?.module_type] || MOD_LABEL[MOD_ORDER[0]]}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{
          fontSize: 10, fontWeight: 600,
          color: waiting ? 'var(--text-3)' : active ? 'var(--warning)' : 'var(--success)',
        }}>
          {waiting ? 'Waiting' : active ? '⚡ Active' : '✓ Done'}
        </span>
      </div>

      {/* Count */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ fontSize: 28, fontWeight: 800, color: waiting ? 'var(--text-3)' : 'var(--text)', letterSpacing: '-0.03em' }}>
          {session ? session.count_pass : '—'}
        </span>
        {declared > 0 && session && (
          <span style={{ fontSize: 12, color: 'var(--text-3)' }}>/ {declared} pcs</span>
        )}
      </div>

      {/* Progress bar */}
      {session && declared > 0 && (
        <div style={{ background: 'var(--surface-2)', borderRadius: 3, height: 5, overflow: 'hidden' }}>
          <div style={{
            width: `${pct}%`, height: '100%', borderRadius: 3,
            background: done ? 'var(--success)' : color,
            transition: 'width 0.4s',
          }} />
        </div>
      )}

      {/* Stats */}
      {session && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: 'var(--text-3)' }}>
          <span>{pct}% of declared</span>
          {session.count_cycle > 0 && (
            <span style={{ color: session.count_cycle !== session.count_pass ? 'var(--warning)' : 'var(--text-3)' }}>
              Cycle sensor: {session.count_cycle}
              {session.count_cycle !== session.count_pass && ` (Δ ${Math.abs(session.count_pass - session.count_cycle)})`}
            </span>
          )}
          {yieldVsPrev != null && (
            <span style={{ color: yieldVsPrev < 90 ? 'var(--warning)' : 'var(--success)' }}>
              Yield from prev: {yieldVsPrev}%
            </span>
          )}
          <span>Duration: {elapsed(session.start_ts, session.end_ts)}</span>
          {session.node_id && (
            <span style={{ fontFamily: 'var(--mono)', fontSize: 10 }}>{session.node_id}</span>
          )}
          {done && session.close_reason && (
            <span>Closed: {session.close_reason}</span>
          )}
        </div>
      )}

      {waiting && (
        <span style={{ fontSize: 11, color: 'var(--text-3)' }}>Not started</span>
      )}
    </div>
  )
}

function BundleTrackModal({ bundleId, onClose }) {
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState('')

  useEffect(() => {
    fetch(`${API_BASE}/v1/admin/bundles/${bundleId}`, { headers: adminHeaders() })
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false) })
      .catch((e) => { setError(e.message); setLoading(false) })
  }, [bundleId])

  if (loading) return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal"><p className="loading">Loading…</p></div>
    </div>
  )
  if (error || !data) return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal"><p className="error">{error || 'Not found'}</p></div>
    </div>
  )

  const { bundle: b, sessions } = data
  const sessionMap = Object.fromEntries(sessions.map((s) => [s.module_type, s]))

  // Which stages actually exist in this bundle's data
  const stages = MOD_ORDER.filter((m) => {
    // Show a stage if there's a session for it OR it's after the last seen stage
    const lastSeen = MOD_ORDER.findIndex((m2) => sessionMap[m2])
    return MOD_ORDER.indexOf(m) <= lastSeen + 1
  })
  // Always show at least INPUT
  if (!stages.includes('INPUT')) stages.push('INPUT')

  // Current stage = last stage with an active (open) session
  const activeStage = MOD_ORDER.find((m) => sessionMap[m] && !sessionMap[m].end_ts)
  const inputSession = sessionMap['INPUT']

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: 700, maxWidth: '96vw', gap: 16 }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <h2 style={{ margin: 0 }}>Bundle Tracking</h2>
            <span className={STATUS_CLASS[b.status] || 'badge badge-gray'}>{b.status}</span>
            {activeStage && (
              <span className="badge badge-yellow">⚡ {MOD_LABEL[activeStage]}</span>
            )}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>{b.id}</div>
          <div style={{ marginTop: 8, display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, color: 'var(--text-2)' }}>
            <span>📦 {b.declared_pieces} pcs declared</span>
            {b.garment_model && <span>👕 {b.garment_model}{b.size_label ? ` / ${b.size_label}` : ''}</span>}
            {b.contractor_name && <span>🏭 {b.contractor_name}</span>}
            {b.line_name && <span>〰 {b.line_name}</span>}
            {b.assigned_card_number != null && (
              <span>🃏 Card {fmt(b.assigned_card_number)}{b.assigned_card_label ? ` (${b.assigned_card_label})` : ''}</span>
            )}
          </div>
        </div>

        {/* Stage pipeline */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {stages.map((mod, i) => (
            <StageCard
              key={mod}
              session={sessionMap[mod] ? { ...sessionMap[mod], module_type: mod } : null}
              declared={b.declared_pieces}
              prev={i > 0 ? sessionMap[stages[i - 1]] : null}
            />
          ))}
        </div>

        {/* Sensor comparison note */}
        {sessions.length > 0 && (
          <div style={{
            background: 'var(--surface-1)', border: '1px solid var(--border-dim)',
            borderRadius: 6, padding: '10px 14px', fontSize: 11, color: 'var(--text-3)', lineHeight: 1.6,
          }}>
            <strong style={{ color: 'var(--text-2)' }}>Sensor counting:</strong>{' '}
            Each station has two independent sensors — <em>pass</em> (main beam-break count) and <em>cycle</em> (mechanical counter).
            Discrepancy between them indicates sensor drift or double-counts.
            Yield between stages shows pieces lost or rejected at each operation.
          </div>
        )}

        <div className="modal-actions">
          <button className="btn-sm" onClick={onClose}>Close</button>
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
  const [trackBundleId, setTrackBundleId] = useState(null)

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
                  <td>
                    {b.assigned_card_number != null
                      ? <span style={{ fontFamily: 'var(--mono)', fontWeight: 700 }}>{fmt(b.assigned_card_number)}</span>
                      : b.assigned_card_uid || b.card_uid
                      ? <span className="mono" style={{ fontSize: 11 }}>{b.assigned_card_uid || b.card_uid}</span>
                      : <span style={{ color: 'var(--text-3)' }}>—</span>}
                    {b.assigned_card_label && (
                      <span style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 5 }}>{b.assigned_card_label}</span>
                    )}
                  </td>
                  <td style={{ fontSize: 11, color: '#7a8bb0' }}>
                    {b.created_at ? new Date(b.created_at).toLocaleString() : '—'}
                  </td>
                  <td>
                    <button className="btn-sm" onClick={() => setTrackBundleId(b.id)}>
                      Track
                    </button>
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
      {trackBundleId && (
        <BundleTrackModal bundleId={trackBundleId} onClose={() => setTrackBundleId(null)} />
      )}
    </div>
  )
}
