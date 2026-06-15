import { useState } from 'react'
import { Link } from 'react-router-dom'
import DashboardTab from './DashboardTab.jsx'
import NodesTab from './NodesTab.jsx'
import OtaTab from './OtaTab.jsx'
import BundlesTab from './BundlesTab.jsx'
import AlertsTab from './AlertsTab.jsx'
import './admin.css'

export const API_BASE = '/api'
export const ADMIN_SECRET = import.meta.env.VITE_ADMIN_SECRET || ''

export function adminHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${ADMIN_SECRET}`,
  }
}

const TABS = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'nodes',     label: 'Nodes'     },
  { key: 'bundles',   label: 'Bundles'   },
  { key: 'ota',       label: 'OTA'       },
  { key: 'alerts',    label: 'Alerts'    },
]

export default function AdminPage() {
  const [tab, setTab] = useState('dashboard')

  return (
    <div className="admin-layout">
      <header className="admin-header">
        {/* Brand */}
        <Link to="/" className="admin-brand">
          <span className="admin-wordmark">Nex<span>wear</span></span>
        </Link>

        {/* Factory context */}
        <span className="admin-factory-badge">Net Rat</span>

        <span className="admin-divider" />

        {/* Navigation */}
        <nav className="admin-tabs">
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              className={tab === key ? 'tab active' : 'tab'}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </nav>
      </header>

      <main className="admin-main">
        {tab === 'dashboard' && <DashboardTab />}
        {tab === 'nodes'     && <NodesTab />}
        {tab === 'bundles'   && <BundlesTab />}
        {tab === 'ota'       && <OtaTab />}
        {tab === 'alerts'    && <AlertsTab />}
      </main>
    </div>
  )
}
