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

// ─── Node tile ────────────────────────────────────────────────────────────────

function NodeTile({ node }) {
  const health = nodeHealth(node)
  const dot = HEALTH_COLOR[health]
  const pct = node.session?.declaredPieces > 0
    ? Math.min(100, Math.round((node.session.countPass / node.session.declaredPieces) * 100))
    : 0

  return (
    <div style={{
      border: `1px solid var(--border)`,
      borderLeft: `3px solid ${dot}`,
      borderRadius: 8,
      padding: '12px 14px',
      minWidth: 180,
      maxWidth: 240,
      flex: '1 1 180px',
      background: 'var(--surface)',
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      {/* header */}
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

      {/* node id */}
      <div style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--text-3)' }}>
        {node.nodeId}
      </div>

      {/* session */}
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
                width: `${pct}%`, height: '100%',
                background: pct >= 100 ? 'var(--success)' : 'var(--brand)',
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

      {/* footer */}
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
  const activeNodes = line.nodes.filter((n) => nodeHealth(n) === 'active').length
  const totalPieces = line.nodes.reduce((sum, n) => sum + (n.session?.countPass ?? 0), 0)
  const sessionsOpen = line.nodes.filter((n) => n.session).length

  return (
    <div style={{
      background: 'var(--surface)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      padding: '16px 20px',
      marginBottom: 14,
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
          <span className="badge badge-yellow">
            {sessionsOpen} open
          </span>
        )}
        {totalPieces > 0 && (
          <span className="badge badge-green">
            {totalPieces} pcs
          </span>
        )}
      </div>

      {line.nodes.length === 0 ? (
        <p style={{ color: 'var(--text-3)', fontSize: 12, margin: 0 }}>
          No nodes assigned. Provision a device and approve it here.
        </p>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {line.nodes.map((n) => (
            <NodeTile key={n.nodeId} node={n} />
          ))}
        </div>
      )}
    </div>
  )
}

// ─── WS status chip ──────────────────────────────────────────────────────────

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
  const [lines, setLines] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [wsState, setWsState] = useState('connecting')
  const [lastUpdate, setLastUpdate] = useState(null)
  const wsRef = useRef(null)
  const reconnectTimer = useRef(null)

  const fetchSnapshot = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/v1/admin/dashboard`, { headers: adminHeaders() })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed')
      setLines(data)
      setError('')
      setLastUpdate(new Date())
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  // Incremental node update helper
  const patchNode = useCallback((nodeId, updater) => {
    setLines((prev) => prev.map((line) => ({
      ...line,
      nodes: line.nodes.map((n) => n.nodeId === nodeId ? updater(n) : n),
    })))
    setLastUpdate(new Date())
  }, [])

  // WebSocket connection with auto-reconnect
  const connectWs = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const ws = new WebSocket(`${proto}://${window.location.host}/api/ws`)
    wsRef.current = ws
    setWsState('connecting')

    ws.onopen = () => {
      setWsState('open')
      clearTimeout(reconnectTimer.current)
    }

    ws.onclose = () => {
      setWsState('closed')
      reconnectTimer.current = setTimeout(connectWs, 4_000)
    }

    ws.onerror = () => {
      setWsState('error')
      ws.close()
    }

    ws.onmessage = (event) => {
      try {
        const { type, payload } = JSON.parse(event.data)
        handleMessage(type, payload)
      } catch {}
    }
  }, []) // eslint-disable-line

  function handleMessage(type, payload) {
    if (type === 'node_heartbeat') {
      patchNode(payload.nodeId, (n) => ({
        ...n,
        lastSeenAt: payload.lastSeenAt,
        rssi: payload.rssi,
        fwVersion: payload.fwVersion || n.fwVersion,
      }))
    } else if (type === 'session_update') {
      if (payload.type === 'UPDATE') {
        patchNode(payload.nodeId, (n) => ({
          ...n,
          session: n.session ? {
            ...n.session,
            countPass: payload.countPass,
            countCycle: payload.countCycle,
          } : n.session,
        }))
      } else if (payload.type === 'CLOSE') {
        patchNode(payload.nodeId, (n) => ({ ...n, session: null }))
      }
    } else if (type === 'scan_event') {
      // TAP events change session structure — re-fetch the snapshot
      fetchSnapshot()
    } else if (type === 'alert_raised') {
      // Could flash something — for now just refresh
    }
  }

  useEffect(() => {
    fetchSnapshot()
    connectWs()

    // Periodic full-sync every 30 s as fallback
    const syncInterval = setInterval(fetchSnapshot, 30_000)

    return () => {
      clearInterval(syncInterval)
      clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [fetchSnapshot, connectWs])

  if (loading) return <p className="loading">Loading dashboard…</p>
  if (error) return <p className="error">{error}</p>

  return (
    <div>
      <div className="section-header" style={{ marginBottom: 16 }}>
        <h2>Live Line Dashboard</h2>
        <WsChip state={wsState} />
        {lastUpdate && (
          <span style={{ fontSize: 11, color: '#556' }}>
            updated {new Date(lastUpdate).toLocaleTimeString()}
          </span>
        )}
        <button onClick={fetchSnapshot} className="btn-sm">Refresh</button>
      </div>

      {lines.length === 0 ? (
        <p className="empty">No lines configured. Create a factory and line in the database.</p>
      ) : (
        lines.map((line) => <LineCard key={line.id} line={line} />)
      )}

      <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-3)', display: 'flex', gap: 16 }}>
        <span><span style={{ color: 'var(--success)' }}>●</span> Active &lt;30s</span>
        <span><span style={{ color: 'var(--warning)' }}>●</span> Stale &lt;2 min</span>
        <span><span style={{ color: 'var(--danger)' }}>●</span> Offline ≥2 min</span>
      </div>
    </div>
  )
}
