import { useState, useEffect, useRef, useCallback } from 'react'
import { API_BASE, adminHeaders } from './AdminPage.jsx'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ageMs(ts) {
  return ts ? Date.now() - new Date(ts) : Infinity
}

function nodeHealth(node) {
  if (node.status !== 'ACTIVE') return 'offline'
  const ms = ageMs(node.lastSeenAt)
  if (ms < 30_000) return 'active'
  if (ms < 120_000) return 'stale'
  return 'offline'
}

function elapsed(ts) {
  if (!ts) return '—'
  const s = Math.floor((Date.now() - new Date(ts)) / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  if (h > 0) return `${h}h ${m % 60}m`
  if (m > 0) return `${m}m ${s % 60}s`
  return `${s}s`
}

function rssiIcon(rssi) {
  if (rssi == null) return '〰'
  if (rssi > -60) return '▂▄▆█'
  if (rssi > -75) return '▂▄▆'
  if (rssi > -85) return '▂▄'
  return '▂'
}

const n = (v) => Number(v) || 0
const pct = (a, b) => n(b) > 0 ? Math.round((n(a) / n(b)) * 100) : null
const fmt = (v) => n(v).toLocaleString()

const HEALTH_COLOR = {
  active:  'var(--success)',
  stale:   'var(--warning)',
  offline: 'var(--danger)',
}
const MOD_LABEL = { INPUT: 'INPUT', OUTPUT_1: 'OUT 1', OUTPUT_2: 'OUT 2', ADMIN: 'ADMIN' }
const MOD_BG = {
  INPUT:    'rgba(59,130,246,0.1)',
  OUTPUT_1: 'rgba(139,92,246,0.1)',
  OUTPUT_2: 'rgba(236,72,153,0.1)',
  ADMIN:    'rgba(6,182,212,0.1)',
}
const MOD_COLOR = {
  INPUT:    'var(--brand)',
  OUTPUT_1: '#8b5cf6',
  OUTPUT_2: '#ec4899',
  ADMIN:    'var(--factory)',
}

// ─── Stats sub-components ────────────────────────────────────────────────────

function KpiCard({ title, value, sub, color, accent }) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      padding: '18px 20px',
      display: 'flex',
      flexDirection: 'column',
      gap: 5,
      borderTop: accent ? `3px solid ${accent}` : undefined,
      flex: '1 1 160px',
      boxShadow: 'var(--shadow-xs)',
      transition: 'box-shadow var(--t)',
    }}>
      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
        {title}
      </span>
      <span style={{ fontSize: 32, fontWeight: 800, color: color || 'var(--text)', letterSpacing: '-0.04em', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>
        {value ?? '—'}
      </span>
      {sub && <span style={{ fontSize: 11, color: 'var(--text-3)', lineHeight: 1.4 }}>{sub}</span>}
    </div>
  )
}

function YieldBar({ val }) {
  if (val == null) return <span style={{ color: 'var(--text-3)' }}>—</span>
  const color = val >= 95 ? 'var(--success)' : val >= 80 ? 'var(--warning)' : 'var(--danger)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 100 }}>
      <div style={{ flex: 1, background: 'var(--surface-2, #1e1e22)', borderRadius: 3, height: 5, overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(val, 100)}%`, height: '100%', background: color, borderRadius: 3 }} />
      </div>
      <span style={{ color, fontWeight: 700, fontSize: 12, minWidth: 38, textAlign: 'right' }}>{val}%</span>
    </div>
  )
}

function SummaryPanel({ title, children }) {
  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      padding: '16px 20px',
      flex: '1 1 260px',
      minWidth: 220,
      boxShadow: 'var(--shadow-xs)',
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: 12 }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function StatRow({ label, value, valueColor, dot }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--border-dim)' }}>
      {dot && <span style={{ color: dot, fontSize: 8, lineHeight: 1, flexShrink: 0 }}>●</span>}
      <span style={{ flex: 1, color: 'var(--text-2)', fontSize: 13 }}>{label}</span>
      <span style={{ fontWeight: 700, fontSize: 15, color: valueColor || 'var(--text)', fontVariantNumeric: 'tabular-nums', letterSpacing: '-0.02em' }}>
        {value}
      </span>
    </div>
  )
}

// ─── Analytics section ────────────────────────────────────────────────────────

function StatsSection({ stats }) {
  const b  = stats.bundles  || {}
  const s  = stats.sessions || {}
  const nd = stats.nodes    || {}
  const al = stats.alerts   || {}

  const inputToday  = n(s.input_today)
  const outputToday = n(s.output_today)
  const yieldPct    = pct(outputToday, inputToday)

  return (
    <div style={{ marginBottom: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* KPI row */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <KpiCard
          title="Active Bundles"
          value={fmt(b.in_progress)}
          sub={`${fmt(b.issued)} waiting to start`}
          accent="var(--warning)"
          color="var(--warning)"
        />
        <KpiCard
          title="Completed Today"
          value={fmt(b.completed_today)}
          sub={`${fmt(b.completed)} all-time`}
          accent="var(--success)"
          color="var(--success)"
        />
        <KpiCard
          title="Input Pieces Today"
          value={fmt(inputToday)}
          sub="pieces entering production"
          accent="var(--brand)"
        />
        <KpiCard
          title="Today's Yield"
          value={yieldPct != null ? `${yieldPct}%` : '—'}
          sub={`${fmt(outputToday)} output / ${fmt(inputToday)} input`}
          accent={yieldPct != null ? (yieldPct >= 95 ? 'var(--success)' : yieldPct >= 80 ? 'var(--warning)' : 'var(--danger)') : 'var(--border)'}
          color={yieldPct != null ? (yieldPct >= 95 ? 'var(--success)' : yieldPct >= 80 ? 'var(--warning)' : 'var(--danger)') : 'var(--text-3)'}
        />
      </div>

      {/* Status panels row */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>

        <SummaryPanel title="Bundle Status">
          <StatRow label="In Progress" value={fmt(b.in_progress)} dot="var(--warning)" />
          <StatRow label="Issued (not started)" value={fmt(b.issued)} dot="var(--text-3)" />
          <StatRow label="Completed" value={fmt(b.completed)} dot="var(--success)" />
          <StatRow label="Lost" value={fmt(b.lost)} dot="var(--danger)" valueColor={n(b.lost) > 0 ? 'var(--danger)' : undefined} />
        </SummaryPanel>

        <SummaryPanel title="Node Health">
          <StatRow label="Online (<30s)" value={fmt(nd.active)} dot="var(--success)" />
          <StatRow label="Stale (30s–2m)" value={fmt(nd.stale)} dot="var(--warning)" valueColor={n(nd.stale) > 0 ? 'var(--warning)' : undefined} />
          <StatRow label="Offline (>2m)" value={fmt(nd.offline)} dot="var(--danger)" valueColor={n(nd.offline) > 0 ? 'var(--danger)' : undefined} />
          <StatRow label="Pending Approval" value={fmt(nd.pending)} dot="var(--brand)" />
        </SummaryPanel>

        <SummaryPanel title="Alerts">
          <StatRow label="Open Alerts" value={fmt(al.open)} valueColor={n(al.open) > 0 ? 'var(--danger)' : undefined} />
          <StatRow label="High Severity" value={fmt(al.high_severity)} valueColor={n(al.high_severity) > 0 ? 'var(--danger)' : undefined} />
          <StatRow label="Unacknowledged" value={fmt(al.unacknowledged)} valueColor={n(al.unacknowledged) > 0 ? 'var(--warning)' : undefined} />
        </SummaryPanel>
      </div>

      {/* Line Performance */}
      {stats.lines?.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>
            Line Performance
          </div>
          <div className="table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Line</th>
                  <th>Active Bundles</th>
                  <th>Completed</th>
                  <th>Nodes Online</th>
                  <th>Input Pieces</th>
                  <th>Output Pieces</th>
                  <th>Yield</th>
                </tr>
              </thead>
              <tbody>
                {stats.lines.map((l) => {
                  const yld = pct(l.output_pieces, l.input_pieces)
                  return (
                    <tr key={l.id}>
                      <td style={{ fontWeight: 600, color: 'var(--text)' }}>{l.name}</td>
                      <td>
                        {n(l.active_bundles) > 0
                          ? <span className="badge badge-yellow">{fmt(l.active_bundles)}</span>
                          : <span style={{ color: 'var(--text-3)' }}>0</span>
                        }
                      </td>
                      <td>{fmt(l.completed_bundles)}</td>
                      <td>
                        <span style={{ fontWeight: 600, color: n(l.active_nodes) > 0 ? 'var(--success)' : 'var(--text-3)' }}>
                          {fmt(l.active_nodes)}
                        </span>
                        <span style={{ color: 'var(--text-3)', fontSize: 11 }}> / {fmt(l.total_nodes)}</span>
                      </td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(l.input_pieces)}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(l.output_pieces)}</td>
                      <td style={{ minWidth: 140 }}><YieldBar val={yld} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Contractor Output */}
      {stats.contractors?.length > 0 && (
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 10 }}>
            Contractor Output
          </div>
          <div className="table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Contractor</th>
                  <th>Assigned</th>
                  <th>Active</th>
                  <th>Completed</th>
                  <th>Declared Pcs</th>
                  <th>Input Pcs</th>
                  <th>Output Pcs</th>
                  <th>Yield</th>
                </tr>
              </thead>
              <tbody>
                {stats.contractors.map((c) => {
                  const yld = pct(c.output_pieces, c.input_pieces)
                  return (
                    <tr key={c.id}>
                      <td>
                        <span style={{ fontWeight: 600, color: 'var(--text)' }}>{c.contractor_name}</span>
                        {c.code && (
                          <span style={{ color: 'var(--text-3)', fontSize: 11, marginLeft: 6 }}>{c.code}</span>
                        )}
                      </td>
                      <td>{fmt(c.bundles_assigned)}</td>
                      <td>
                        {n(c.bundles_active) > 0
                          ? <span className="badge badge-yellow">{fmt(c.bundles_active)}</span>
                          : <span style={{ color: 'var(--text-3)' }}>0</span>
                        }
                      </td>
                      <td>
                        {n(c.bundles_completed) > 0
                          ? <span className="badge badge-green">{fmt(c.bundles_completed)}</span>
                          : <span style={{ color: 'var(--text-3)' }}>0</span>
                        }
                      </td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(c.declared_pieces)}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(c.input_pieces)}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{fmt(c.output_pieces)}</td>
                      <td style={{ minWidth: 140 }}><YieldBar val={yld} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Node tile ────────────────────────────────────────────────────────────────

function NodeTile({ node }) {
  const health = nodeHealth(node)
  const dot = HEALTH_COLOR[health]
  const pctVal = node.session?.declaredPieces > 0
    ? Math.min(100, Math.round((node.session.countPass / node.session.declaredPieces) * 100))
    : 0

  return (
    <div style={{
      border: `1px solid var(--border)`,
      borderLeft: `3px solid ${dot}`,
      borderRadius: 'var(--radius-lg)',
      padding: '12px 14px',
      minWidth: 180,
      maxWidth: 240,
      flex: '1 1 180px',
      background: 'var(--surface)',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
      boxShadow: 'var(--shadow-xs)',
      transition: 'box-shadow var(--t)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{
          background: MOD_BG[node.moduleType] || 'var(--surface-1)',
          color: MOD_COLOR[node.moduleType] || 'var(--text-2)',
          borderRadius: 4,
          padding: '2px 7px',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 0.5,
        }}>
          {MOD_LABEL[node.moduleType] || node.moduleType}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: dot, fontWeight: 700 }}>●</span>
        <span style={{ fontSize: 10, color: 'var(--text-3)', fontFamily: 'var(--mono)' }}>
          {rssiIcon(node.rssi)}
        </span>
      </div>

      <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-3)' }}>
        {node.nodeId}
      </div>

      {node.session ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontSize: 11, color: 'var(--text-3)', display: 'flex', gap: 5, alignItems: 'center' }}>
            <span>Card</span>
            <span style={{ fontFamily: 'var(--mono)', color: 'var(--text-2)', fontWeight: 600 }}>
              {node.session.cardUid?.slice(-8) || '—'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
            <span style={{ fontSize: 22, fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.02em' }}>
              {node.session.countPass}
            </span>
            {node.session.declaredPieces > 0 && (
              <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                / {node.session.declaredPieces} pcs
              </span>
            )}
          </div>
          {node.session.declaredPieces > 0 && (
            <div style={{ background: 'var(--surface-2)', borderRadius: 3, height: 4, overflow: 'hidden' }}>
              <div style={{
                width: `${pctVal}%`, height: '100%',
                background: pctVal >= 100 ? 'var(--success)' : 'var(--brand)',
                borderRadius: 3,
                transition: 'width 0.4s',
              }} />
            </div>
          )}
          <div style={{ fontSize: 10, color: 'var(--text-3)', display: 'flex', gap: 10 }}>
            <span>{elapsed(node.session.startTs)}</span>
            {node.session.countCycle > 0 && (
              <span>cycle {node.session.countCycle}</span>
            )}
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--text-3)' }}>
          {health === 'offline' ? 'Offline' : 'Idle'}
        </div>
      )}

      <div style={{
        borderTop: '1px solid var(--border-dim)',
        paddingTop: 7,
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: 10,
        color: 'var(--text-3)',
      }}>
        <span>{node.lastSeenAt ? elapsed(node.lastSeenAt) + ' ago' : 'never'}</span>
        <span>{node.fwVersion || '—'}</span>
      </div>
    </div>
  )
}

// ─── Line card ────────────────────────────────────────────────────────────────

function LineCard({ line }) {
  const activeNodes = line.nodes.filter((nd) => nodeHealth(nd) === 'active').length
  const totalPieces = line.nodes.reduce((sum, nd) => sum + (nd.session?.countPass ?? 0), 0)
  const sessionsOpen = line.nodes.filter((nd) => nd.session).length

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-lg)',
      padding: '16px 20px',
      marginBottom: 14,
      boxShadow: 'var(--shadow-xs)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14,
        paddingBottom: 12, borderBottom: '1px solid var(--border-dim)',
      }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>
          {line.name}
        </h3>
        <span style={{
          fontSize: 10, fontWeight: 600, color: 'var(--text-3)',
          background: 'var(--surface-1)', border: '1px solid var(--border)',
          borderRadius: 4, padding: '2px 7px', textTransform: 'uppercase', letterSpacing: '0.06em',
        }}>
          {activeNodes}/{line.nodes.length} active
        </span>
        {sessionsOpen > 0 && (
          <span className="badge badge-yellow">{sessionsOpen} open</span>
        )}
        {totalPieces > 0 && (
          <span className="badge badge-green">{totalPieces} pcs</span>
        )}
      </div>

      {line.nodes.length === 0 ? (
        <p style={{ color: 'var(--text-3)', fontSize: 12, margin: 0 }}>
          No nodes assigned. Provision a device and approve it here.
        </p>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {line.nodes.map((nd) => (
            <NodeTile key={nd.nodeId} node={nd} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── WS chip ──────────────────────────────────────────────────────────────────

function WsChip({ state }) {
  const map = {
    connecting: ['badge badge-yellow', 'Connecting'],
    open:       ['badge badge-green',  'Live'],
    closed:     ['badge badge-red',    'Disconnected'],
    error:      ['badge badge-red',    'Error'],
  }
  const [cls, label] = map[state] || ['badge badge-gray', '—']
  return <span className={cls}>● {label}</span>
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function DashboardTab() {
  const [lines,      setLines]      = useState([])
  const [stats,      setStats]      = useState(null)
  const [statsError, setStatsError] = useState('')
  const [loading,    setLoading]    = useState(true)
  const [wsState,    setWsState]    = useState('connecting')
  const [lastUpdate, setLastUpdate] = useState(null)
  const wsRef            = useRef(null)
  const reconnectTimer   = useRef(null)

  const fetchSnapshot = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/v1/admin/dashboard`, { headers: adminHeaders() })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setLines(data)
      setLastUpdate(new Date())
    } catch (e) {
      console.error('dashboard snapshot error', e)
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/v1/admin/dashboard/stats`, { headers: adminHeaders() })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setStats(data)
      setStatsError('')
    } catch (e) {
      setStatsError(e.message)
    }
  }, [])

  const patchNode = useCallback((nodeId, updater) => {
    setLines((prev) => prev.map((line) => ({
      ...line,
      nodes: line.nodes.map((nd) => nd.nodeId === nodeId ? updater(nd) : nd),
    })))
    setLastUpdate(new Date())
  }, [])

  const connectWs = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${window.location.host}/api/ws`)
    wsRef.current = ws
    setWsState('connecting')

    ws.onopen  = () => { setWsState('open'); clearTimeout(reconnectTimer.current) }
    ws.onclose = () => { setWsState('closed'); reconnectTimer.current = setTimeout(connectWs, 4_000) }
    ws.onerror = () => { setWsState('error'); ws.close() }

    ws.onmessage = (event) => {
      try {
        const { type, payload } = JSON.parse(event.data)
        handleMessage(type, payload)
      } catch {}
    }
  }, []) // eslint-disable-line

  function handleMessage(type, payload) {
    if (type === 'node_heartbeat') {
      patchNode(payload.nodeId, (nd) => ({
        ...nd,
        lastSeenAt: payload.lastSeenAt,
        rssi: payload.rssi,
        fwVersion: payload.fwVersion || nd.fwVersion,
      }))
    } else if (type === 'session_update') {
      if (payload.type === 'UPDATE') {
        patchNode(payload.nodeId, (nd) => ({
          ...nd,
          session: nd.session ? {
            ...nd.session,
            countPass: payload.countPass,
            countCycle: payload.countCycle,
          } : nd.session,
        }))
      } else if (payload.type === 'CLOSE') {
        patchNode(payload.nodeId, (nd) => ({ ...nd, session: null }))
        fetchStats()
      }
    } else if (type === 'scan_event') {
      fetchSnapshot()
      fetchStats()
    }
  }

  useEffect(() => {
    fetchSnapshot()
    fetchStats()
    connectWs()

    const syncInterval  = setInterval(fetchSnapshot, 30_000)
    const statsInterval = setInterval(fetchStats, 60_000)

    return () => {
      clearInterval(syncInterval)
      clearInterval(statsInterval)
      clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [fetchSnapshot, fetchStats, connectWs])

  if (loading) return <p className="loading">Loading dashboard…</p>

  return (
    <div>
      {/* Header row */}
      <div className="section-header" style={{ marginBottom: 18 }}>
        <h2>Factory Dashboard</h2>
        <WsChip state={wsState} />
        {lastUpdate && (
          <span style={{ fontSize: 11, color: 'var(--text-3)' }}>
            updated {new Date(lastUpdate).toLocaleTimeString()}
          </span>
        )}
        <button onClick={() => { fetchSnapshot(); fetchStats() }} className="btn-sm">Refresh</button>
      </div>

      {/* Analytics stats (KPI + tables) */}
      {statsError ? (
        <p className="error" style={{ marginBottom: 16 }}>Stats: {statsError}</p>
      ) : stats ? (
        <StatsSection stats={stats} />
      ) : (
        <p className="loading" style={{ marginBottom: 16 }}>Loading stats…</p>
      )}

      {/* Divider */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16,
        color: 'var(--text-3)', fontSize: 11, fontWeight: 700,
        textTransform: 'uppercase', letterSpacing: '0.06em',
      }}>
        <div style={{ flex: 1, height: 1, background: 'var(--border-dim)' }} />
        <span>Live Node View</span>
        <div style={{ flex: 1, height: 1, background: 'var(--border-dim)' }} />
      </div>

      {/* Live line cards */}
      {lines.length === 0 ? (
        <p className="empty">No lines configured yet.</p>
      ) : (
        lines.map((line) => <LineCard key={line.id} line={line} />)
      )}

      {/* Legend */}
      <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-3)', display: 'flex', gap: 16 }}>
        <span><span style={{ color: 'var(--success)' }}>●</span> Active &lt;30s</span>
        <span><span style={{ color: 'var(--warning)' }}>●</span> Stale &lt;2 min</span>
        <span><span style={{ color: 'var(--danger)' }}>●</span> Offline ≥2 min</span>
      </div>
    </div>
  )
}
