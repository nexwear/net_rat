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

const HEALTH_COLOR = { active: '#2caa4a', stale: '#e59f00', offline: '#c44' }
const MOD_LABEL = { INPUT: 'IN', OUTPUT_1: 'OUT1', OUTPUT_2: 'OUT2', ADMIN: 'ADM' }
const MOD_BG = {
  INPUT: '#1a3a6a', OUTPUT_1: '#2d1a5a', OUTPUT_2: '#3a1a2a', ADMIN: '#1a3a2a',
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
      border: `1px solid #2a2d3a`,
      borderLeft: `3px solid ${dot}`,
      borderRadius: 6,
      padding: '10px 12px',
      minWidth: 170,
      maxWidth: 220,
      flex: '1 1 170px',
      background: '#13151f',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
    }}>
      {/* header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{
          background: MOD_BG[node.moduleType] || '#1a1d27',
          color: '#c8d0f0',
          borderRadius: 4,
          padding: '1px 6px',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: 0.5,
        }}>
          {MOD_LABEL[node.moduleType] || node.moduleType}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: dot, fontWeight: 700 }}>●</span>
        <span style={{ fontSize: 10, color: '#7a8bb0' }}>{rssiIcon(node.rssi)}</span>
      </div>

      {/* node id */}
      <div style={{ fontFamily: 'monospace', fontSize: 10, color: '#556' }}>
        {node.nodeId}
      </div>

      {/* session */}
      {node.session ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 2 }}>
          <div style={{ fontSize: 11, color: '#aab', display: 'flex', gap: 4, alignItems: 'center' }}>
            <span style={{ color: '#7a8bb0' }}>Card</span>
            <span style={{ fontFamily: 'monospace', color: '#c8d0f0' }}>
              {node.session.cardUid?.slice(-6) || '—'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span style={{ fontSize: 18, fontWeight: 700, color: '#c8d0f0' }}>
              {node.session.countPass}
            </span>
            {node.session.declaredPieces > 0 && (
              <span style={{ fontSize: 11, color: '#7a8bb0' }}>
                / {node.session.declaredPieces}
              </span>
            )}
          </div>
          {node.session.declaredPieces > 0 && (
            <div style={{ background: '#1e2130', borderRadius: 3, height: 4, overflow: 'hidden' }}>
              <div style={{
                width: `${pct}%`, height: '100%',
                background: pct >= 100 ? '#2caa4a' : '#2563eb',
                borderRadius: 3,
                transition: 'width 0.4s',
              }} />
            </div>
          )}
          <div style={{ fontSize: 10, color: '#556' }}>
            ⏱ {elapsed(node.session.startTs)}
            {node.session.countCycle > 0 && (
              <span style={{ marginLeft: 6 }}>
                cycle {node.session.countCycle}
              </span>
            )}
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 11, color: '#556', marginTop: 2 }}>
          {health === 'offline' ? 'Offline' : 'Idle — no session'}
        </div>
      )}

      {/* footer */}
      <div style={{
        borderTop: '1px solid #1e2130', paddingTop: 4, marginTop: 2,
        display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#556',
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
      background: '#1a1d27',
      border: '1px solid #2a2d3a',
      borderRadius: 8,
      padding: '16px 18px',
      marginBottom: 16,
    }}>
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 12,
      }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>{line.name}</h3>
        <span style={{ fontSize: 11, color: '#7a8bb0' }}>
          {activeNodes}/{line.nodes.length} active
        </span>
        {sessionsOpen > 0 && (
          <span style={{ fontSize: 11, color: '#e59f00' }}>
            {sessionsOpen} session{sessionsOpen !== 1 ? 's' : ''} open
          </span>
        )}
        {totalPieces > 0 && (
          <span style={{ fontSize: 11, color: '#2caa4a' }}>
            {totalPieces} pcs counted
          </span>
        )}
      </div>

      {line.nodes.length === 0 ? (
        <p style={{ color: '#556', fontSize: 12, margin: 0 }}>
          No nodes on this line. Provision a device and assign it here.
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
  const labels = { connecting: ['Connecting…', '#e59f00'], open: ['Live', '#2caa4a'], closed: ['Disconnected', '#c44'], error: ['Error', '#c44'] }
  const [label, color] = labels[state] || ['—', '#888']
  return (
    <span style={{ fontSize: 11, color, fontWeight: 700, letterSpacing: 0.5 }}>
      ● {label}
    </span>
  )
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

      <div style={{ marginTop: 12, fontSize: 10, color: '#333' }}>
        Node staleness: <span style={{ color: '#2caa4a' }}>● active</span> &lt;30s ·{' '}
        <span style={{ color: '#e59f00' }}>● stale</span> &lt;2min ·{' '}
        <span style={{ color: '#c44' }}>● offline</span> ≥2min
      </div>
    </div>
  )
}
