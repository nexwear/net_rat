import { useState, useEffect, useCallback } from 'react'
import { API_BASE, adminHeaders } from './AdminPage.jsx'

function fmt(n) {
  return n != null ? String(n).padStart(3, '0') : '—'
}

function CardStatusBadge({ status }) {
  const cls = {
    AVAILABLE: 'badge badge-green',
    IN_USE:    'badge badge-yellow',
    LOST:      'badge badge-red',
  }
  return <span className={cls[status] || 'badge badge-gray'}>{status}</span>
}

// ─── Register single card modal ───────────────────────────────────────────────

function RegisterModal({ nextNumber, onClose, onDone }) {
  const [uid, setUid]     = useState('')
  const [num, setNum]     = useState(String(nextNumber || ''))
  const [label, setLabel] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  async function submit() {
    if (!uid.trim()) return setError('Card UID required')
    setLoading(true); setError('')
    try {
      const res = await fetch(`${API_BASE}/v1/admin/cards`, {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify({
          uid: uid.trim().toUpperCase(),
          cardNumber: num ? Number(num) : undefined,
          label: label.trim() || undefined,
        }),
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
        <h2>Register Card</h2>

        <label>Card UID (hex)</label>
        <input value={uid} onChange={(e) => setUid(e.target.value)}
          placeholder="e.g. A1B2C3D4" autoFocus />

        <label>Card Number (auto-assigns if blank)</label>
        <input type="number" min="1" value={num} onChange={(e) => setNum(e.target.value)}
          placeholder={String(nextNumber)} />

        <label>Label (optional)</label>
        <input value={label} onChange={(e) => setLabel(e.target.value)}
          placeholder="e.g. Red card, Bin A…" />

        {error && <p className="error">{error}</p>}

        <div className="modal-actions">
          <button onClick={onClose} disabled={loading}>Cancel</button>
          <button className="btn-sm btn-primary" onClick={submit} disabled={loading}>
            {loading ? 'Registering…' : 'Register'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Register range modal ─────────────────────────────────────────────────────

function RegisterRangeModal({ nextNumber, onClose, onDone }) {
  const [raw, setRaw]         = useState('')
  const [start, setStart]     = useState(String(nextNumber || ''))
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [result, setResult]   = useState(null)

  const uids = raw.split(/[\n,\s]+/).map((s) => s.trim().toUpperCase()).filter(Boolean)

  async function submit() {
    if (!uids.length) return setError('Paste at least one UID')
    setLoading(true); setError('')
    try {
      const res = await fetch(`${API_BASE}/v1/admin/cards/register-range`, {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify({ uids, startNumber: Number(start) || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setResult(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  if (result) {
    return (
      <div className="modal-overlay" onClick={onClose}>
        <div className="modal" style={{ width: 520 }} onClick={(e) => e.stopPropagation()}>
          <h2>Batch Registration Complete</h2>
          <p style={{ color: 'var(--success)' }}>
            {result.registered} / {result.total} cards registered successfully.
          </p>
          <div className="table-wrap" style={{ maxHeight: 240, overflowY: 'auto' }}>
            <table className="admin-table">
              <thead><tr><th>#</th><th>UID</th><th>Status</th></tr></thead>
              <tbody>
                {result.results.map((r) => (
                  <tr key={r.uid}>
                    <td style={{ fontWeight: 700 }}>{fmt(r.card_number)}</td>
                    <td className="mono">{r.uid}</td>
                    <td>
                      {r.ok
                        ? <span className="badge badge-green">OK</span>
                        : <span className="badge badge-red" title={r.error}>Failed</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="modal-actions">
            <button className="btn-sm btn-primary" onClick={() => { onDone(); onClose() }}>Done</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: 480 }} onClick={(e) => e.stopPropagation()}>
        <h2>Register Card Range</h2>
        <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '-4px 0 4px' }}>
          Paste UIDs (one per line, or comma-separated). Each will be assigned the next sequential number.
        </p>

        <label>Card UIDs</label>
        <textarea
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder={'A1B2C3D4\nE5F6G7H8\n…'}
          rows={6}
          style={{
            background: 'var(--surface-1)', border: '1px solid var(--border)',
            borderRadius: 6, color: 'var(--text)', fontFamily: 'var(--mono)',
            fontSize: 12, padding: '8px 10px', width: '100%', resize: 'vertical',
            outline: 'none',
          }}
          autoFocus
        />

        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <label>Starting Number</label>
            <input type="number" min="1" value={start}
              onChange={(e) => setStart(e.target.value)}
              placeholder={String(nextNumber)} />
          </div>
          {uids.length > 0 && (
            <div style={{ paddingBottom: 1, color: 'var(--text-3)', fontSize: 12, whiteSpace: 'nowrap' }}>
              → assigns {fmt(Number(start) || nextNumber)} – {fmt((Number(start) || nextNumber) + uids.length - 1)}
            </div>
          )}
        </div>

        {error && <p className="error">{error}</p>}

        <div className="modal-actions">
          <button onClick={onClose} disabled={loading}>Cancel</button>
          <button className="btn-sm btn-primary" onClick={submit} disabled={loading || !uids.length}>
            {loading ? 'Registering…' : `Register ${uids.length} card${uids.length !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Edit label modal ─────────────────────────────────────────────────────────

function EditModal({ card, onClose, onDone }) {
  const [label, setLabel]     = useState(card.label || '')
  const [num, setNum]         = useState(String(card.card_number || ''))
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

  async function submit() {
    setLoading(true); setError('')
    try {
      const body = {}
      if (num && Number(num) !== card.card_number) body.cardNumber = Number(num)
      if (label !== card.label) body.label = label
      if (!Object.keys(body).length) return onClose()

      const res = await fetch(`${API_BASE}/v1/admin/cards/${card.uid}`, {
        method: 'PATCH',
        headers: adminHeaders(),
        body: JSON.stringify(body),
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
        <h2>Edit Card</h2>
        <p className="modal-node-id">{card.uid}</p>

        <label>Card Number</label>
        <input type="number" min="1" value={num} onChange={(e) => setNum(e.target.value)} />

        <label>Label</label>
        <input value={label} onChange={(e) => setLabel(e.target.value)}
          placeholder="optional description" autoFocus />

        {error && <p className="error">{error}</p>}

        <div className="modal-actions">
          <button onClick={onClose} disabled={loading}>Cancel</button>
          <button className="btn-sm btn-primary" onClick={submit} disabled={loading}>
            {loading ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main tab ─────────────────────────────────────────────────────────────────

export default function CardsTab() {
  const [cards, setCards]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')
  const [showReg, setShowReg]   = useState(false)
  const [showRange, setShowRange] = useState(false)
  const [editCard, setEditCard] = useState(null)
  const [filter, setFilter]     = useState('ALL')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API_BASE}/v1/admin/cards`, { headers: adminHeaders() })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setCards(data)
      setError('')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function forceRelease(card) {
    if (!confirm(`Force-release card ${fmt(card.card_number)} (${card.uid})?\nThis will unlink it from its current bundle.`)) return
    try {
      await fetch(`${API_BASE}/v1/admin/cards/${card.uid}/release`, {
        method: 'POST', headers: adminHeaders(),
      })
      load()
    } catch (e) { alert(e.message) }
  }

  function handleDone() {
    setShowReg(false); setShowRange(false); setEditCard(null)
    load()
  }

  const nextNumber = cards.length
    ? Math.max(0, ...cards.map((c) => c.card_number || 0)) + 1
    : 1

  const counts = {
    ALL:       cards.length,
    AVAILABLE: cards.filter((c) => c.status === 'AVAILABLE').length,
    IN_USE:    cards.filter((c) => c.status === 'IN_USE').length,
  }

  const visible = filter === 'ALL' ? cards : cards.filter((c) => c.status === filter)

  return (
    <div>
      {/* Header */}
      <div className="section-header">
        <h2>Card Registry</h2>
        <button className="btn-sm btn-primary" onClick={() => setShowReg(true)}>+ Register Card</button>
        <button className="btn-sm" onClick={() => setShowRange(true)}>+ Register Range</button>
        <button className="btn-sm" onClick={load}>Refresh</button>
      </div>

      {/* Status filter chips */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {[['ALL', 'All'], ['AVAILABLE', 'Available'], ['IN_USE', 'In Use']].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            style={{
              background: filter === key ? 'var(--brand-subtle)' : 'var(--surface)',
              border: `1px solid ${filter === key ? 'var(--brand)' : 'var(--border)'}`,
              borderRadius: 6, padding: '4px 12px', cursor: 'pointer',
              color: filter === key ? 'var(--brand)' : 'var(--text-3)',
              fontSize: 12, fontWeight: filter === key ? 700 : 500,
              fontFamily: 'var(--sans)',
            }}
          >
            {label} <span style={{ opacity: 0.7 }}>({counts[key]})</span>
          </button>
        ))}
      </div>

      {loading && <p className="loading">Loading cards…</p>}
      {error   && <p className="error">{error}</p>}

      {!loading && visible.length === 0 && (
        <p className="empty">
          {filter === 'ALL'
            ? 'No cards registered. Click "Register Card" or "Register Range" to add cards.'
            : `No ${filter.toLowerCase().replace('_', ' ')} cards.`}
        </p>
      )}

      {visible.length > 0 && (
        <div className="table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>#</th>
                <th>UID</th>
                <th>Label</th>
                <th>Status</th>
                <th>Current Bundle</th>
                <th>Contractor</th>
                <th>Line</th>
                <th>Registered</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => (
                <tr key={c.uid}>
                  <td>
                    <span style={{
                      fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 15,
                      color: c.status === 'AVAILABLE' ? 'var(--success)'
                           : c.status === 'IN_USE'    ? 'var(--warning)'
                           : 'var(--text-3)',
                    }}>
                      {fmt(c.card_number)}
                    </span>
                  </td>
                  <td className="mono" style={{ fontSize: 11 }}>{c.uid}</td>
                  <td style={{ color: 'var(--text-2)' }}>{c.label || <span style={{ color: 'var(--text-3)' }}>—</span>}</td>
                  <td><CardStatusBadge status={c.status} /></td>
                  <td className="mono" style={{ fontSize: 11 }}>
                    {c.current_bundle_id
                      ? <span title={c.current_bundle_id}>{c.current_bundle_id.slice(0, 8)}…</span>
                      : <span style={{ color: 'var(--text-3)' }}>—</span>}
                  </td>
                  <td style={{ color: 'var(--text-2)' }}>{c.contractor_name || '—'}</td>
                  <td style={{ color: 'var(--text-2)' }}>{c.line_name || '—'}</td>
                  <td style={{ fontSize: 11, color: 'var(--text-3)' }}>
                    {c.registered_at ? new Date(c.registered_at).toLocaleDateString() : '—'}
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="btn-sm" onClick={() => setEditCard(c)}>Edit</button>
                      {c.status === 'IN_USE' && (
                        <button className="btn-sm btn-danger" onClick={() => forceRelease(c)}>
                          Release
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Legend */}
      <div style={{ marginTop: 14, display: 'flex', gap: 20, fontSize: 11, color: 'var(--text-3)' }}>
        <span><span style={{ color: 'var(--success)', fontWeight: 700 }}>001</span> = available for assignment</span>
        <span><span style={{ color: 'var(--warning)', fontWeight: 700 }}>001</span> = in use on a bundle</span>
        <span>Release = force-unlinks card from bundle (use when bundle is lost or cancelled)</span>
      </div>

      {showReg   && <RegisterModal nextNumber={nextNumber} onClose={() => setShowReg(false)} onDone={handleDone} />}
      {showRange && <RegisterRangeModal nextNumber={nextNumber} onClose={() => setShowRange(false)} onDone={handleDone} />}
      {editCard  && <EditModal card={editCard} onClose={() => setEditCard(null)} onDone={handleDone} />}
    </div>
  )
}
