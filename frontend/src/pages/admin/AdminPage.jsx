import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import DashboardTab from './DashboardTab.jsx'
import NodesTab from './NodesTab.jsx'
import OtaTab from './OtaTab.jsx'
import BundlesTab from './BundlesTab.jsx'
import CardsTab from './CardsTab.jsx'
import AlertsTab from './AlertsTab.jsx'
import UsersTab from './UsersTab.jsx'
import { getUser, clearAuth, authHeaders, apiFetch } from '../../auth.js'
import './admin.css'

export const API_BASE = '/api'

// Re-export for tab components that import from here
export { authHeaders as adminHeaders, apiFetch }

const ROLE_PERMS = {
  SUPER_ADMIN:     ['dashboard','nodes','bundles','cards','ota','alerts','users'],
  FACTORY_ADMIN:   ['dashboard','nodes','bundles','cards','ota','alerts','users'],
  LINE_SUPERVISOR: ['dashboard','nodes','alerts'],
  ADMIN_OPERATOR:  ['dashboard','nodes','bundles','cards'],
  AUDITOR:         ['dashboard'],
  CONTRACTOR:      ['dashboard'],
}

function tabsForRole(role) {
  const allowed = ROLE_PERMS[role] || ['dashboard']
  return [
    { key: 'dashboard', label: 'Dashboard' },
    { key: 'nodes',     label: 'Nodes'     },
    { key: 'bundles',   label: 'Bundles'   },
    { key: 'cards',     label: 'Cards'     },
    { key: 'ota',       label: 'OTA'       },
    { key: 'alerts',    label: 'Alerts'    },
    { key: 'users',     label: 'Users'     },
  ].filter((t) => allowed.includes(t.key))
}

const ROLE_LABEL = {
  SUPER_ADMIN:     'Super Admin',
  FACTORY_ADMIN:   'Factory Admin',
  LINE_SUPERVISOR: 'Line Supervisor',
  ADMIN_OPERATOR:  'Admin Operator',
  AUDITOR:         'Auditor',
  CONTRACTOR:      'Contractor',
}

export default function AdminPage() {
  const navigate = useNavigate()
  const user = getUser()
  const tabs = tabsForRole(user?.role)
  const [tab, setTab] = useState(tabs[0]?.key || 'dashboard')

  function logout() {
    clearAuth()
    navigate('/login', { replace: true })
  }

  return (
    <div className="admin-layout">
      <header className="admin-header">
        {/* Brand */}
        <Link to="/" className="admin-brand">
          <span className="admin-wordmark">Nex<span>wear</span></span>
        </Link>

        {/* Factory */}
        <span className="admin-factory-badge">Net Rat</span>

        <span className="admin-divider" />

        {/* Tabs */}
        <nav className="admin-tabs">
          {tabs.map(({ key, label }) => (
            <button
              key={key}
              className={tab === key ? 'tab active' : 'tab'}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </nav>

        <span style={{ flex: 1 }} />

        {/* User context */}
        {user && (
          <div className="admin-user">
            <span className="admin-user-name">{user.name || user.email}</span>
            <span className="admin-user-role">{ROLE_LABEL[user.role] || user.role}</span>
          </div>
        )}

        <button className="btn-sm" onClick={logout} style={{ flexShrink: 0 }}>
          Sign out
        </button>
      </header>

      <main className="admin-main">
        {tab === 'dashboard' && <DashboardTab />}
        {tab === 'nodes'     && <NodesTab />}
        {tab === 'bundles'   && <BundlesTab />}
        {tab === 'cards'     && <CardsTab />}
        {tab === 'ota'       && <OtaTab />}
        {tab === 'alerts'    && <AlertsTab />}
        {tab === 'users'     && <UsersTab />}
      </main>
    </div>
  )
}
