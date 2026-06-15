import { useState, useEffect, useCallback } from 'react'
import { API_BASE, adminHeaders } from './AdminPage.jsx'

const SEVERITY_COLORS = {
  HIGH: '#E24B4A',
  MED: '#e59f00',
  LOW: '#7a8bb0',
}

const TYPE_ICONS = {
  NODE_DOWN: '📵',
  NODE_RECOVERED: '✅',
  OTA_FAILED: '🔴',
  DISCREPANCY: '⚠️',
  SENSOR_DISAGREE: '⚖️',
  UNASSIGNED_CARD: '🃏',
  BUNDLE_STUCK: '⏳',
  LINE_STALLED: '🛑',
  QUEUE_OVERFLOW: '📦',
}

function timeSince(ts) {
  if (!ts) return '—'
  const sec = Math.floor((Date.now() - new Date(ts)) / 1000)
  if (sec < 60) return `${sec}s ago`
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  return `${Math.floor(sec / 86400)}d ago`
}

export default function AlertsTab() {
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showResolved, setShowResolved] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(
        `${API_BASE}/v1/admin/alerts${showResolved ? '?resolved=true' : ''}`,
        { headers: adminHeaders() }
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Failed to load alerts')
      setAlerts(data)
      setError('')
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [showResolved])

  useEffect(() => { load() }, [load])

  async function ack(id) {
    try {
      await fetch(`${API_BASE}/v1/admin/alerts/${id}/ack`, {
        method: 'POST',
        headers: adminHeaders(),
      })
      load()
    } catch (e) {
      console.error(e)
    }
  }

  const open = alerts.filter((a) => !a.resolved_at)
  const resolved = alerts.filter((a) => a.resolved_at)

  return (
    <div>
      <div className="section-header">
        <h2>
          Alerts
          {open.length > 0 && (
            <span style={{
              background: '#E24B4A', color: '#fff', borderRadius: 10,
              padding: '1px 7px', fontSize: 11, fontWeight: 700,
              marginLeft: 8, verticalAlign: 'middle',
            }}>
              {open.length} open
            </span>
          )}
        </h2>
        <label style={{ fontSize: 12, color: '#7a8bb0', display: 'flex', alignItems: 'center', gap: 6 }}>
          <input
            type="checkbox"
            checked={showResolved}
            onChange={(e) => setShowResolved(e.target.checked)}
            style={{ width: 'auto' }}
          />
          Show resolved
        </label>
        <button onClick={load} className="btn-sm">Refresh</button>
      </div>

      {loading && <p className="loading">Loading…</p>}
      {error && <p className="error">{error}</p>}

      {!loading && alerts.length === 0 && (
        <p className="empty">No alerts — all systems nominal.</p>
      )}

      {alerts.length > 0 && (
        <div className="table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Type</th>
                <th>Severity</th>
                <th>Node / Line</th>
                <th>Detail</th>
                <th>Raised</th>
                <th>State</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {alerts.map((a) => (
                <tr key={a.id} style={{ opacity: a.resolved_at ? 0.5 : 1 }}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <span style={{ marginRight: 5 }}>{TYPE_ICONS[a.type] || '❓'}</span>
                    {a.type}
                  </td>
                  <td>
                    <span style={{
                      color: SEVERITY_COLORS[a.severity] || '#888',
                      fontWeight: 700, fontSize: 11,
                    }}>
                      {a.severity}
                    </span>
                  </td>
                  <td className="mono" style={{ fontSize: 11 }}>
                    {a.node_id || '—'}
                    {a.line_id && <span style={{ color: '#7a8bb0' }}> L{a.line_id}</span>}
                  </td>
                  <td style={{ maxWidth: 300, fontSize: 12, color: '#ccc' }}>{a.detail || '—'}</td>
                  <td style={{ fontSize: 11, color: '#7a8bb0' }}>{timeSince(a.raised_at)}</td>
                  <td style={{ fontSize: 11 }}>
                    {a.resolved_at
                      ? <span style={{ color: '#2caa4a' }}>Resolved</span>
                      : a.acknowledged_at
                        ? <span style={{ color: '#7a8bb0' }}>Acked</span>
                        : <span style={{ color: '#e59f00' }}>Open</span>
                    }
                  </td>
                  <td>
                    {!a.resolved_at && !a.acknowledged_at && (
                      <button className="btn-sm" onClick={() => ack(a.id)}>Ack</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showResolved && resolved.length > 0 && (
        <p style={{ fontSize: 11, color: '#7a8bb0', marginTop: 8 }}>
          Showing {resolved.length} resolved alert{resolved.length !== 1 ? 's' : ''}.
        </p>
      )}
    </div>
  )
}
