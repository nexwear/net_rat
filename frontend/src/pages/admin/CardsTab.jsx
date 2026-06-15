import { useState, useEffect, useCallback, useRef } from 'react'
import { API_BASE, adminHeaders } from './AdminPage.jsx'
import { useAdminReaderMode } from './useAdminReaderMode.js'

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

function RegisterModal({ nextNumber, cards, initialUid, onClose, onDone, onRefresh }) {
  const inputRef = useRef(null)
  const seenScanRef = useRef(new Set())
  const [mode, setMode] = useState(initialUid ? 'manual' : 'scan') // scan | admin | manual
  useAdminReaderMode(mode === 'admin' ? 'REGISTER' : 'IDLE')
  const [uid, setUid]     = useState(initialUid || '')
  const [num, setNum]     = useState(String(nextNumber || ''))
  const [label, setLabel] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [lookup, setLookup]   = useState(null) // existing card preview before register

  useEffect(() => {
    if (mode === 'scan') inputRef.current?.focus()
  }, [mode])

  // Admin reader: poll ASSIGN_SCAN and fill UID
  useEffect(() => {
    if (mode !== 'admin') return undefined
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
          applyScannedUid(s.card_uid, {
            card_number: s.card_number,
            status: s.card_status,
            label: s.card_label,
          })
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
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  function applyScannedUid(scanned, fromApi) {
    const normalized = scanned.trim().toUpperCase()
    if (!normalized) return
    setUid(normalized)
    setError('')
    const existing = cards.find((c) => c.uid === normalized) || (fromApi?.card_number != null ? {
      uid: normalized,
      card_number: fromApi.card_number,
      status: fromApi.status,
      label: fromApi.label,
    } : null)
    if (existing?.card_number != null) {
      setLookup(existing)
      return
    }
    setLookup(null)
    if (mode === 'scan' || mode === 'admin') submitUid(normalized)
  }

  function handleScanKey(e) {
    if (e.key !== 'Enter') return
    applyScannedUid(uid)
    setUid('')
  }

  async function submitUid(forcedUid) {
    const scanned = (forcedUid || uid).trim().toUpperCase()
    if (!scanned) return setError('Card UID required')
    setLoading(true); setError('')
    try {
      const res = await fetch(`${API_BASE}/v1/admin/cards`, {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify({
          uid: scanned,
          cardNumber: num ? Number(num) : undefined,
          label: label.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      if (res.status === 200 && data.card_number) {
        setLookup({ ...data, uid: scanned })
      } else {
        setLookup({ ...data, uid: scanned, newlyRegistered: true })
        onRefresh?.()
      }
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
      if (mode === 'scan') setTimeout(() => inputRef.current?.focus(), 50)
    }
  }

  async function submit() {
    await submitUid()
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Register Card</h2>

        <div className="reconfig-tabs" style={{ marginBottom: 14 }}>
          {[
            ['scan', 'USB Scan'],
            ['admin', 'Admin reader'],
            ['manual', 'Type UID'],
          ].map(([k, lbl]) => (
            <button
              key={k}
              type="button"
              className={mode === k ? 'rtab active' : 'rtab'}
              onClick={() => { setMode(k); setError(''); setLookup(null) }}
            >
              {lbl}
            </button>
          ))}
        </div>

        {mode === 'scan' && (
          <>
            <label>Scan card UID</label>
            <input
              ref={inputRef}
              value={uid}
              onChange={(e) => setUid(e.target.value.toUpperCase())}
              onKeyDown={handleScanKey}
              placeholder="Hold card to USB reader…"
              style={{ fontFamily: 'var(--mono)', fontWeight: 700, letterSpacing: '0.06em' }}
              disabled={loading}
              autoComplete="off"
            />
            <p style={{ fontSize: 11, color: 'var(--text-3)', margin: '4px 0 0' }}>
              Reader sends UID + Enter — registers automatically with the next number.
            </p>
          </>
        )}

        {mode === 'admin' && (
          <div style={{
            background: 'var(--surface-2)', borderRadius: 8, padding: '12px 14px',
            border: '1px solid var(--brand)', marginBottom: 4,
          }}>
            <p style={{ fontSize: 12, color: 'var(--brand)', fontWeight: 600, margin: '0 0 4px' }}>
              {loading ? 'Registering…' : 'Waiting for admin reader tap…'}
            </p>
            <p style={{ fontSize: 11, color: 'var(--text-3)', margin: 0 }}>
              Tap the card on the admin room NFC reader.
            </p>
          </div>
        )}

        {mode === 'manual' && (
          <>
            <label>Card UID (hex)</label>
            <input value={uid} onChange={(e) => setUid(e.target.value)}
              placeholder="e.g. A1B2C3D4" autoFocus />

            <label>Card Number (auto-assigns if blank)</label>
            <input type="number" min="1" value={num} onChange={(e) => setNum(e.target.value)}
              placeholder={String(nextNumber)} />

            <label>Label (optional)</label>
            <input value={label} onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Red card, Bin A…" />
          </>
        )}

        {lookup && (
          <div style={{
            marginTop: 10, padding: '10px 12px', borderRadius: 8,
            background: 'var(--surface-1)', border: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', gap: 10,
          }}>
            <span style={{ fontSize: 22, fontWeight: 800, fontFamily: 'var(--mono)' }}>
              {fmt(lookup.card_number)}
            </span>
            <div style={{ flex: 1, fontSize: 12 }}>
              <div style={{ fontWeight: 600 }}>
                {lookup.newlyRegistered ? 'New card registered' : 'Already registered'}
              </div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-3)' }}>{lookup.uid}</div>
            </div>
            <CardStatusBadge status={lookup.status || 'AVAILABLE'} />
          </div>
        )}

        {error && <p className="error">{error}</p>}

        <div className="modal-actions">
          <button onClick={onClose} disabled={loading}>Cancel</button>
          {mode === 'manual' && (
            <button className="btn-sm btn-primary" onClick={submit} disabled={loading}>
              {loading ? 'Registering…' : 'Register'}
            </button>
          )}
          {lookup && (
            <button className="btn-sm btn-primary" onClick={onDone}>Done</button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Scan lookup in registered cards list ─────────────────────────────────────

function ScanLookupBar({ cards, onHighlight, onRegister }) {
  const inputRef = useRef(null)
  const seenScanRef = useRef(new Set())
  const [mode, setMode] = useState('usb') // usb | admin
  useAdminReaderMode(mode === 'admin' ? 'BUNDLE' : 'IDLE')
  const [uid, setUid] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    if (mode !== 'admin') return undefined
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
          resolveUid(s.card_uid, s)
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
  }, [mode]) // eslint-disable-line react-hooks/exhaustive-deps

  function resolveUid(scanned, fromApi) {
    const normalized = scanned.trim().toUpperCase()
    if (!normalized) return
    setError('')
    const existing = cards.find((c) => c.uid === normalized)
    if (existing) {
      setResult({ type: 'found', card: existing })
      onHighlight(existing.uid)
      return
    }
    if (fromApi?.card_number != null) {
      const card = {
        uid: normalized,
        card_number: fromApi.card_number,
        status: fromApi.card_status,
        label: fromApi.card_label,
      }
      setResult({ type: 'found', card })
      onHighlight(normalized)
      return
    }
    setResult({ type: 'missing', uid: normalized })
    onHighlight(null)
  }

  function handleKey(e) {
    if (e.key !== 'Enter') return
    resolveUid(uid)
    setUid('')
    setTimeout(() => inputRef.current?.focus(), 50)
  }

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      padding: '12px 14px',
      marginBottom: 16,
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Scan registered card</span>
        <div className="reconfig-tabs" style={{ margin: 0 }}>
          {[
            ['usb', 'USB'],
            ['admin', 'Admin reader'],
          ].map(([k, lbl]) => (
            <button
              key={k}
              type="button"
              className={mode === k ? 'rtab active' : 'rtab'}
              onClick={() => { setMode(k); setResult(null); setError('') }}
              style={{ padding: '4px 10px', fontSize: 11 }}
            >
              {lbl}
            </button>
          ))}
        </div>
      </div>

      {mode === 'usb' ? (
        <input
          ref={inputRef}
          value={uid}
          onChange={(e) => setUid(e.target.value.toUpperCase())}
          onKeyDown={handleKey}
          placeholder="Scan card to find in list…"
          style={{
            fontFamily: 'var(--mono)', fontWeight: 700, letterSpacing: '0.06em',
            background: 'var(--surface-1)', border: '1px solid var(--border)',
            borderRadius: 6, padding: '8px 10px', color: 'var(--text)', outline: 'none',
          }}
          autoComplete="off"
        />
      ) : (
        <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0 }}>
          Tap a card on the admin reader to look it up in the registry.
        </p>
      )}

      {error && <p className="error" style={{ margin: 0 }}>{error}</p>}

      {result?.type === 'found' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
          <span style={{ fontSize: 20, fontWeight: 800, fontFamily: 'var(--mono)' }}>
            {fmt(result.card.card_number)}
          </span>
          <div>
            {result.card.label && (
              <div style={{ color: 'var(--text-2)', fontWeight: 600 }}>{result.card.label}</div>
            )}
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-3)' }}>{result.card.uid}</div>
          </div>
          <CardStatusBadge status={result.card.status} />
        </div>
      )}

      {result?.type === 'missing' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12 }}>
          <span style={{ color: 'var(--text-3)' }}>Not registered:</span>
          <span className="mono">{result.uid}</span>
          <button className="btn-sm btn-primary" onClick={() => onRegister(result.uid)}>
            Register
          </button>
        </div>
      )}
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

export function AdminReaderBanner() {
  const [info, setInfo] = useState(null)

  useEffect(() => {
    let cancelled = false

    async function check() {
      try {
        const res = await fetch(`${API_BASE}/v1/admin/nodes`, { headers: adminHeaders() })
        const nodes = await res.json()
        if (!Array.isArray(nodes) || cancelled) return

        const fresh = (n) => n.last_seen_at && (Date.now() - new Date(n.last_seen_at)) < 120000
        const adminOnline = nodes.filter((n) => n.module_type === 'ADMIN' && n.status === 'ACTIVE' && fresh(n))
        if (adminOnline.length > 0) {
          setInfo({ ok: true, label: adminOnline[0].label || adminOnline[0].id })
          return
        }

        const inputTapping = nodes.filter((n) => n.module_type === 'INPUT' && n.status === 'ACTIVE' && fresh(n))
        if (inputTapping.length > 0) {
          const n = inputTapping[0]
          setInfo({
            ok: false,
            message: `Reader "${n.label || n.id}" is registered as INPUT, not ADMIN. Open Nodes → Reconfig → set Module Type to ADMIN, then reboot the device.`,
          })
          return
        }

        setInfo({
          ok: false,
          message: 'No admin NFC reader online. Check WiFi and that the node is approved as ADMIN in the Nodes tab.',
        })
      } catch (e) {
        if (!cancelled) setInfo({ ok: false, message: e.message })
      }
    }

    check()
    const id = setInterval(check, 10000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  if (!info) return null

  return (
    <div style={{
      marginBottom: 12, padding: '10px 14px', borderRadius: 8, fontSize: 12, lineHeight: 1.5,
      background: info.ok ? 'rgba(34,197,94,0.08)' : 'rgba(245,158,11,0.1)',
      border: `1px solid ${info.ok ? 'rgba(34,197,94,0.35)' : 'rgba(245,158,11,0.4)'}`,
      color: info.ok ? 'var(--success)' : 'var(--warning)',
    }}>
      {info.ok
        ? <>Admin reader online: <strong>{info.label}</strong></>
        : <>{info.message}</>}
    </div>
  )
}

// ─── Scan & auto-assign numbers (admin reader + USB) ─────────────────────────

function AutoAssignPanel({ cards, nextNumber, onRegistered }) {
  const seenRef = useRef(new Set())
  const usbRef = useRef(null)
  const [source, setSource] = useState('admin') // admin | usb
  useAdminReaderMode(source === 'admin' ? 'REGISTER' : 'IDLE')
  const [usbUid, setUsbUid] = useState('')
  const [last, setLast] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (source === 'usb') usbRef.current?.focus()
  }, [source])

  // Admin NFC reader: backend auto-registers on ASSIGN_SCAN
  useEffect(() => {
    if (source !== 'admin') return undefined
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
          if (!s.event_id || !s.card_uid || seenRef.current.has(s.event_id)) continue
          seenRef.current.add(s.event_id)
          const existing = cards.find((c) => c.uid === s.card_uid)
          setLast({
            uid: s.card_uid,
            cardNumber: s.card_number,
            status: s.card_status || 'AVAILABLE',
            label: s.card_label,
            ts: s.ts,
            type: existing ? 'existing' : 'new',
          })
          onRegistered()
          return
        }
      } catch (e) {
        if (!cancelled) setError(e.message)
      }
    }

    poll()
    const id = setInterval(poll, 1200)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [source, cards, onRegistered])

  async function registerUsb(scanned) {
    const uid = scanned.trim().toUpperCase()
    if (!uid) return
    setError('')
    setLoading(true)
    try {
      const existing = cards.find((c) => c.uid === uid)
      if (existing) {
        setLast({
          uid: existing.uid,
          cardNumber: existing.card_number,
          status: existing.status,
          label: existing.label,
          type: 'existing',
        })
        setLoading(false)
        return
      }
      const res = await fetch(`${API_BASE}/v1/admin/cards`, {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify({ uid }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setLast({
        uid: data.uid || uid,
        cardNumber: data.card_number,
        status: data.status || 'AVAILABLE',
        label: data.label,
        type: res.status === 201 ? 'new' : 'existing',
      })
      onRegistered()
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
      setTimeout(() => usbRef.current?.focus(), 50)
    }
  }

  const STAT_COLOR = { AVAILABLE: 'var(--success)', IN_USE: 'var(--warning)', LOST: 'var(--danger)' }

  return (
    <div style={{
      background: 'var(--surface)',
      border: '2px solid var(--brand)',
      borderRadius: 12,
      padding: '18px 20px',
      marginBottom: 20,
      display: 'flex',
      flexDirection: 'column',
      gap: 14,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{
            width: 10, height: 10, borderRadius: '50%',
            background: 'var(--brand)',
            boxShadow: '0 0 8px var(--brand)',
            animation: 'pulse 1.5s infinite',
            flexShrink: 0,
          }} />
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--brand)' }}>
              Scan &amp; Assign — hold card on reader
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
              Each tap reads the UID and assigns the next number ({fmt(nextNumber)}, {fmt(nextNumber + 1)}…). Only active while this panel is open — register mode on the server.
            </div>
          </div>
        </div>
        <div style={{
          background: 'var(--brand-subtle)', border: '1px solid var(--brand)',
          borderRadius: 8, padding: '8px 14px', textAlign: 'center', minWidth: 72,
        }}>
          <div style={{ fontSize: 10, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Next</div>
          <div style={{ fontSize: 24, fontWeight: 800, fontFamily: 'var(--mono)', color: 'var(--brand)' }}>
            {fmt(nextNumber)}
          </div>
        </div>
      </div>

      <div className="reconfig-tabs" style={{ margin: 0 }}>
        {[
          ['admin', 'Admin NFC reader'],
          ['usb', 'USB reader'],
        ].map(([k, lbl]) => (
          <button
            key={k}
            type="button"
            className={source === k ? 'rtab active' : 'rtab'}
            onClick={() => { setSource(k); setError('') }}
          >
            {lbl}
          </button>
        ))}
      </div>

      {source === 'admin' ? (
        <>
          <AdminReaderBanner />
          <p style={{ fontSize: 13, color: 'var(--text-2)', margin: 0, fontWeight: 500 }}>
            {loading ? 'Processing…' : 'Place card on the admin room reader and hold until it beeps.'}
          </p>
        </>
      ) : (
        <input
          ref={usbRef}
          value={usbUid}
          onChange={(e) => setUsbUid(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            const val = usbUid.trim().toUpperCase()
            if (!val) return
            setUsbUid('')
            registerUsb(val)
          }}
          placeholder="Scan card with USB reader…"
          disabled={loading}
          autoComplete="off"
          style={{
            fontFamily: 'var(--mono)', fontWeight: 700, letterSpacing: '0.08em',
            background: 'var(--surface-1)', border: '1px solid var(--brand)',
            borderRadius: 8, color: 'var(--text)', fontSize: 15,
            padding: '12px 14px', outline: 'none', width: '100%',
          }}
        />
      )}

      {error && <p className="error" style={{ margin: 0 }}>{error}</p>}

      {last && (
        <div style={{
          display: 'flex', gap: 14, alignItems: 'center',
          background: last.type === 'new' ? 'rgba(34,197,94,0.1)' : 'var(--surface-1)',
          border: `1px solid ${last.type === 'new' ? 'rgba(34,197,94,0.35)' : 'var(--border)'}`,
          borderRadius: 10, padding: '14px 16px',
        }}>
          <span style={{
            fontSize: 36, fontWeight: 800, fontFamily: 'var(--mono)', lineHeight: 1,
            color: last.type === 'new' ? 'var(--success)' : (STAT_COLOR[last.status] || 'var(--text)'),
          }}>
            {fmt(last.cardNumber)}
          </span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>
              {last.type === 'new' ? 'Registered' : 'Already registered'}
            </div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text-3)', marginTop: 2 }}>
              {last.uid}
            </div>
            {last.ts && (
              <div style={{ fontSize: 11, color: 'var(--text-3)', marginTop: 2 }}>
                {new Date(last.ts).toLocaleTimeString()}
              </div>
            )}
          </div>
          <span className="badge" style={{
            background: last.status === 'AVAILABLE' ? 'rgba(34,197,94,0.12)'
                       : last.status === 'IN_USE'    ? 'rgba(245,158,11,0.12)'
                       : 'rgba(239,68,68,0.12)',
            color: STAT_COLOR[last.status] || 'var(--text-3)',
          }}>
            {last.status || 'AVAILABLE'}
          </span>
        </div>
      )}
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
  const [autoAssign, setAutoAssign] = useState(false)
  const [highlightUid, setHighlightUid] = useState(null)
  const [registerUid, setRegisterUid] = useState(null)

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
        <button
          className="btn-sm btn-primary"
          onClick={() => setAutoAssign((v) => !v)}
          style={autoAssign ? {
            boxShadow: '0 0 0 2px var(--brand)',
            background: 'var(--brand)',
          } : {}}
        >
          {autoAssign ? '● Scan & Assign ON' : 'Scan & Assign'}
        </button>
        <button className="btn-sm" onClick={() => setShowReg(true)}>+ Register Card</button>
        <button className="btn-sm" onClick={() => setShowRange(true)}>+ Register Range</button>
        <button className="btn-sm" onClick={load}>Refresh</button>
      </div>

      {autoAssign && (
        <AutoAssignPanel cards={cards} nextNumber={nextNumber} onRegistered={load} />
      )}

      {/* Scan lookup in registered list */}
      {!loading && cards.length > 0 && !autoAssign && (
        <ScanLookupBar
          cards={cards}
          onHighlight={setHighlightUid}
          onRegister={(uid) => { setRegisterUid(uid); setShowReg(true) }}
        />
      )}

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
            ? 'No cards registered. Use Scan in Register Card, or Register Range.'
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
                <tr
                  key={c.uid}
                  style={highlightUid === c.uid ? {
                    background: 'rgba(99, 102, 241, 0.12)',
                    outline: '2px solid var(--brand)',
                    outlineOffset: -2,
                  } : undefined}
                >
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

      {showReg && (
        <RegisterModal
          nextNumber={nextNumber}
          cards={cards}
          onClose={() => { setShowReg(false); setRegisterUid(null) }}
          onDone={handleDone}
          onRefresh={load}
          initialUid={registerUid}
        />
      )}
      {showRange && <RegisterRangeModal nextNumber={nextNumber} onClose={() => setShowRange(false)} onDone={handleDone} />}
      {editCard  && <EditModal card={editCard} onClose={() => setEditCard(null)} onDone={handleDone} />}
    </div>
  )
}
