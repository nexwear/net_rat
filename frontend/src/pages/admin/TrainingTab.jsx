import { useState, useEffect, useCallback, useRef } from 'react'
import { API_BASE, adminHeaders } from './AdminPage.jsx'

// Only rotary stations have a count_cycle to learn pulses-per-piece from.
const TRAINABLE = ['INPUT', 'OUTPUT_1']

const selectStyle = {
  background: 'var(--surface-1)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: '9px 11px',
  color: 'var(--text)',
  fontSize: 13,
  minWidth: 180,
}
const labelStyle = {
  display: 'block',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--text-3)',
  marginBottom: 6,
}

async function api(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, { headers: adminHeaders(), ...opts })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

export default function TrainingTab() {
  const [nodes, setNodes] = useState([])
  const [models, setModels] = useState([])
  const [sizes, setSizes] = useState([])
  const [nodeId, setNodeId] = useState('')
  const [garmentModelId, setGarmentModelId] = useState('0')
  const [sizeCode, setSizeCode] = useState('0')

  const [training, setTraining] = useState(null) // active run state
  const [live, setLive] = useState(null)          // {cycle, pass, cardUid} when idle
  const [calibration, setCalibration] = useState(null)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showRecompute, setShowRecompute] = useState(false)

  const trainingId = training?.id || null

  // ── Initial master data ────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const [n, m, s] = await Promise.all([
          api('/v1/admin/nodes'),
          api('/v1/admin/garment-models'),
          api('/v1/admin/sizes'),
        ])
        setNodes(n.filter((x) => TRAINABLE.includes(x.module_type) && x.status === 'ACTIVE'))
        setModels(m)
        setSizes(s)
      } catch (e) {
        setError(e.message)
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const selectedNode = nodes.find((n) => n.id === nodeId)

  // ── Load saved calibration for the chosen combo ─────────────────────────────
  const loadCalibration = useCallback(async () => {
    if (!selectedNode) return setCalibration(null)
    try {
      const q = new URLSearchParams({
        garmentModelId,
        sizeCode,
        moduleType: selectedNode.module_type,
      })
      setCalibration(await api(`/v1/admin/training/calibration?${q}`))
    } catch {
      setCalibration(null)
    }
  }, [selectedNode, garmentModelId, sizeCode])

  useEffect(() => { loadCalibration() }, [loadCalibration])

  // ── Polling: active run → /training/:id, else node live → /training/live ─────
  const pollRef = useRef()
  useEffect(() => {
    async function tick() {
      try {
        if (trainingId) {
          setTraining(await api(`/v1/admin/training/${trainingId}`))
        } else if (nodeId) {
          const snap = await api(`/v1/admin/training/live/${nodeId}`)
          setLive(snap.live)
          if (snap.training) setTraining(snap.training) // resume an in-progress run
        }
      } catch { /* transient */ }
    }
    tick()
    pollRef.current = setInterval(tick, 1400)
    return () => clearInterval(pollRef.current)
  }, [trainingId, nodeId])

  // ── Actions ─────────────────────────────────────────────────────────────────
  async function act(fn) {
    setBusy(true); setError('')
    try { await fn() } catch (e) { setError(e.message) } finally { setBusy(false) }
  }

  const start = () => act(async () => {
    setResult(null)
    setTraining(await api('/v1/admin/training/start', {
      method: 'POST',
      body: JSON.stringify({ nodeId, garmentModelId, sizeCode }),
    }))
  })

  const mark = useCallback(() => act(async () => {
    if (!trainingId) return
    setTraining(await api(`/v1/admin/training/${trainingId}/mark`, { method: 'POST' }))
  }), [trainingId])

  const undo = () => act(async () => {
    setTraining(await api(`/v1/admin/training/${trainingId}/undo`, { method: 'POST' }))
  })

  const finish = (save) => act(async () => {
    const r = await api(`/v1/admin/training/${trainingId}/finish`, {
      method: 'POST', body: JSON.stringify({ save }),
    })
    setResult(save ? r : null)
    setTraining(null)
    await loadCalibration()
  })

  // Spacebar = mark a piece (fast tapping), unless typing in a field.
  useEffect(() => {
    function onKey(e) {
      if (e.code !== 'Space' || !trainingId || busy) return
      const tag = (e.target.tagName || '').toLowerCase()
      if (tag === 'input' || tag === 'select' || tag === 'textarea' || tag === 'button') return
      e.preventDefault()
      mark()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [trainingId, busy, mark])

  if (loading) return <p className="loading">Loading…</p>

  const sessionOpen = !!(training?.live || live)
  const liveCycle = training?.live?.cycle ?? live?.cycle ?? null
  const livePass = training?.live?.pass ?? live?.pass ?? null
  const liveAmps = training?.live?.amps ?? live?.amps ?? null
  // Rotations accumulated toward the in-progress piece (since the last mark, or
  // the baseline at start) — watch this climb, then mark when the garment is done.
  const lastMarkCycle = training
    ? (training.marks.length ? training.marks[training.marks.length - 1].cycle : training.baselineCycle)
    : null
  const pieceRot =
    training && liveCycle != null && lastMarkCycle != null
      ? Math.max(0, liveCycle - lastMarkCycle)
      : null

  return (
    <div>
      <div className="section-header">
        <h2>PPP Training</h2>
        <button className="btn-sm" onClick={() => setShowRecompute(true)} disabled={!!training}>
          Recompute from history
        </button>
      </div>
      <p className="tab-help" style={{ marginTop: 0 }}>
        Calibrate pulses-per-piece for a rotary station. Pick the node + garment + size,
        have the operator tap their card to start a session, then tap <b>Piece Completed</b>
        {' '}(or press <b>Space</b>) each time a garment is finished. <b>Finish &amp; Save</b> writes
        the median rotations-per-piece into the calibration table.
      </p>

      {error && <p className="error">{error}</p>}

      {/* ── Setup ───────────────────────────────────────────── */}
      <div className="card" style={{ padding: 18, marginBottom: 18 }}>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <label style={labelStyle}>Node (rotary station)</label>
            <select style={selectStyle} value={nodeId} disabled={!!training}
              onChange={(e) => { setNodeId(e.target.value); setResult(null) }}>
              <option value="">— select —</option>
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>
                  {(n.label ? `${n.label} · ` : '') + n.id} ({n.module_type})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Garment Model</label>
            <select style={selectStyle} value={garmentModelId} disabled={!!training}
              onChange={(e) => setGarmentModelId(e.target.value)}>
              <option value="0">Any / unspecified</option>
              {models.map((m) => <option key={m.id} value={m.id}>{m.style}</option>)}
            </select>
          </div>
          <div>
            <label style={labelStyle}>Size</label>
            <select style={selectStyle} value={sizeCode} disabled={!!training}
              onChange={(e) => setSizeCode(e.target.value)}>
              <option value="0">Any / unspecified</option>
              {sizes.map((s) => <option key={s.code} value={s.code}>{s.label}</option>)}
            </select>
          </div>
          {!training && (
            <button className="btn-primary" onClick={start} disabled={busy || !nodeId}>
              {busy ? 'Starting…' : 'Start Training'}
            </button>
          )}
        </div>

        {nodes.length === 0 && (
          <p className="empty" style={{ marginBottom: 0 }}>
            No active INPUT / OUTPUT_1 nodes. Approve a rotary station first.
          </p>
        )}

        {selectedNode && (
          <p className="mono" style={{ marginTop: 14, marginBottom: 0 }}>
            Current calibration ({selectedNode.module_type}):{' '}
            {calibration
              ? <b style={{ color: 'var(--text)' }}>
                  {Math.round(calibration.pulses_per_piece)} pulses/piece
                  <span style={{ color: 'var(--text-3)' }}> · {calibration.sample_count} samples</span>
                </b>
              : <span style={{ color: 'var(--text-3)' }}>none yet (using default 400)</span>}
          </p>
        )}
      </div>

      {/* ── Live sensor readout (visible as soon as a node is chosen) ── */}
      {selectedNode && (
        <div className="card" style={{ padding: 18, marginBottom: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, gap: 10, flexWrap: 'wrap' }}>
            <h3 style={{ margin: 0, fontSize: 14 }}>
              Live sensor — {selectedNode.label || selectedNode.id}
            </h3>
            <span className={sessionOpen ? 'badge badge-green' : 'badge badge-yellow'}>
              {sessionOpen ? `SESSION OPEN${live?.cardUid || training?.live?.cardUid ? ` · card ${(training?.live?.cardUid || live?.cardUid)}` : ''}` : 'waiting for card tap'}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <Stat label="Live rotations" value={liveCycle != null ? liveCycle : '—'} accent />
            {training && <Stat label="This piece (rot)" value={pieceRot != null ? pieceRot : '—'} accent />}
            <Stat label="Node pieces" value={livePass != null ? livePass : '—'} />
            <Stat label="Current" value={liveAmps != null ? `${Number(liveAmps).toFixed(2)} A` : '—'} />
          </div>
          {!sessionOpen && (
            <p className="warn-text" style={{ marginBottom: 0, marginTop: 12 }}>
              No open session — have the operator tap their bundle-assigned card on this node
              so rotations start streaming. Then start training and mark each finished piece.
            </p>
          )}
        </div>
      )}

      {/* ── Save result banner ──────────────────────────────── */}
      {result?.saved && (
        <p className="success" style={{ fontSize: 14 }}>
          ✓ Saved <b>{Math.round(result.resultPpp)} pulses/piece</b> from {result.validPieces} pieces.
          The line will use it immediately for new bundles.
        </p>
      )}

      {/* ── Active run ──────────────────────────────────────── */}
      {training && (
        <div className="card" style={{ padding: 20 }}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 18 }}>
            <Stat label="Pieces marked" value={training.pieceCount} />
            <Stat label="Running PPP (median)"
              value={training.runningPpp != null ? Math.round(training.runningPpp) : '—'} accent />
            <Stat label="Last piece"
              value={training.lastDelta != null ? `${training.lastDelta} rot` : '—'} />
          </div>

          {!sessionOpen && (
            <p className="warn-text" style={{ marginTop: 0 }}>
              No open session on this node yet — have the operator tap their (bundle-assigned)
              card so rotations start counting, then mark pieces.
            </p>
          )}

          <button
            onClick={mark}
            disabled={busy || !sessionOpen}
            style={{
              width: '100%', padding: '26px 0', fontSize: 20, fontWeight: 700,
              letterSpacing: '0.02em', color: '#fff', cursor: 'pointer',
              background: sessionOpen ? 'var(--brand)' : 'var(--border)',
              border: 'none', borderRadius: 'var(--radius-lg)',
              opacity: busy ? 0.7 : 1, transition: 'background .15s, opacity .15s',
            }}
          >
            ✓ PIECE COMPLETED
            <span style={{ display: 'block', fontSize: 11, fontWeight: 500, opacity: 0.85, marginTop: 4 }}>
              tap when a garment is finished — or press the Space bar
            </span>
          </button>

          <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
            <button className="btn-sm" onClick={undo} disabled={busy || training.pieceCount === 0}>
              Undo last
            </button>
            <span style={{ flex: 1 }} />
            <button className="btn-sm" onClick={() => finish(false)} disabled={busy}>
              Cancel (discard)
            </button>
            <button className="btn-primary" onClick={() => finish(true)}
              disabled={busy || training.validPieces === 0}>
              Finish &amp; Save{training.runningPpp != null ? ` (${Math.round(training.runningPpp)} PPP)` : ''}
            </button>
          </div>

          {training.marks.length > 0 && (
            <div className="table-wrap" style={{ marginTop: 18 }}>
              <table className="admin-table">
                <thead>
                  <tr><th>Piece</th><th>Rotations</th><th>Cumulative</th><th>Marked</th></tr>
                </thead>
                <tbody>
                  {[...training.marks].reverse().map((m) => (
                    <tr key={m.pieceIndex}>
                      <td>#{m.pieceIndex}</td>
                      <td className={m.delta > 0 ? '' : 'pending-op'}>
                        {m.delta != null ? m.delta : '—'}{m.delta <= 0 ? ' (ignored)' : ''}
                      </td>
                      <td className="mono">{m.cycle}</td>
                      <td>{m.at ? new Date(m.at).toLocaleTimeString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {showRecompute && (
        <RecomputeModal
          models={models}
          sizes={sizes}
          onClose={() => setShowRecompute(false)}
          onApplied={() => { setShowRecompute(false); loadCalibration() }}
        />
      )}
    </div>
  )
}

// Batch calibration from all historical bundles. Dry-run preview, then Apply.
function RecomputeModal({ models, sizes, onClose, onApplied }) {
  const [includeDeclared, setIncludeDeclared] = useState(false)
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [applied, setApplied] = useState(false)

  const modelName = (id) =>
    !id ? 'Any' : (models.find((m) => m.id === id)?.style || `#${id}`)
  const sizeName = (code) =>
    !code ? 'Any' : (sizes.find((s) => s.code === code)?.label || code)

  const run = useCallback(async (apply) => {
    setBusy(true); setError('')
    try {
      const r = await api('/v1/admin/training/recompute', {
        method: 'POST', body: JSON.stringify({ apply, includeDeclared }),
      })
      setPreview(r)
      if (apply) { setApplied(true); setTimeout(onApplied, 1200) }
    } catch (e) { setError(e.message) } finally { setBusy(false) }
  }, [includeDeclared, onApplied])

  useEffect(() => { run(false) }, [run])

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <h2>Recompute calibration from history</h2>
        <p className="info-text" style={{ marginTop: 0 }}>
          Median rotations-per-piece across every finished bundle, using the OUTPUT_2
          ground-truth count. This <b>overwrites</b> matching calibration rows.
        </p>

        <label className="check-row">
          <input type="checkbox" checked={includeDeclared}
            onChange={(e) => setIncludeDeclared(e.target.checked)} disabled={busy || applied} />
          Also use declared pieces when a bundle has no OUTPUT_2 count (less accurate)
        </label>

        {error && <p className="error">{error}</p>}

        {preview && (
          <>
            <p className="mono" style={{ margin: '12px 0 8px' }}>
              {preview.groups} calibration group{preview.groups === 1 ? '' : 's'} from{' '}
              {preview.totalSamples} bundle-station samples
            </p>
            {preview.rows.length === 0 ? (
              <p className="empty">
                No completed bundles with both upstream rotations and a ground-truth count yet.
              </p>
            ) : (
              <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
                <table className="admin-table">
                  <thead>
                    <tr><th>Garment</th><th>Size</th><th>Station</th><th>PPP</th><th>Range</th><th>n</th></tr>
                  </thead>
                  <tbody>
                    {preview.rows.map((r, i) => (
                      <tr key={i}>
                        <td>{modelName(r.garmentModelId)}</td>
                        <td>{sizeName(r.sizeCode)}</td>
                        <td>{r.moduleType}</td>
                        <td><b style={{ color: 'var(--text)' }}>{r.ppp}</b></td>
                        <td className="mono">{r.minPpp}–{r.maxPpp}</td>
                        <td>{r.samples}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {applied && <p className="success">✓ Calibration updated.</p>}

        <div className="modal-actions">
          <button onClick={onClose} disabled={busy}>{applied ? 'Close' : 'Cancel'}</button>
          <button className="btn-primary" onClick={() => run(true)}
            disabled={busy || applied || !preview || preview.rows.length === 0}>
            {busy ? 'Working…' : `Apply to ${preview?.rows.length || 0} group(s)`}
          </button>
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value, accent, badge }) {
  return (
    <div style={{
      flex: '1 1 130px', minWidth: 130, padding: '12px 14px',
      background: 'var(--surface-1)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
    }}>
      <div style={labelStyle}>{label}</div>
      {badge
        ? <span className={badge}>{value}</span>
        : <div style={{ fontSize: 24, fontWeight: 700, color: accent ? 'var(--brand)' : 'var(--text)' }}>
            {value}
          </div>}
    </div>
  )
}
