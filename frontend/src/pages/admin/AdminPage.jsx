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
import { getTheme, toggleTheme } from '../../theme.js'
import './admin.css'

export const API_BASE = '/api'
export { authHeaders as adminHeaders, apiFetch }

// ── SVG icon helper ───────────────────────────────────────────────────────────

function Icon({ d, size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  )
}

const IC = {
  dashboard: 'M2 2h5v5H2zM9 2h5v5H9zM2 9h5v5H2zM9 9h5v5H9z',
  nodes:     'M8 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM5.5 10a3.5 3.5 0 0 1 5 0M3 7.5A6 6 0 0 1 13 7.5',
  bundles:   'M8 1L2 4.5v7L8 15l6-3.5v-7L8 1zM2 4.5l6 3.5m0 0l6-3.5m-6 3.5V15',
  cards:     'M1 5a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V5zm0 3h14M4 11h3',
  ota:       'M8 2v8m-3-4 3-4 3 4M3.5 13A5 5 0 0 1 8 3a5 5 0 0 1 4.5 10',
  alerts:    'M8 1a5 5 0 0 0-5 5v2.5L2 10h12l-1-1.5V6a5 5 0 0 0-5-5zM6.5 13a1.5 1.5 0 0 0 3 0',
  users:     'M5.5 7a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM1 14a4.5 4.5 0 0 1 9 0M11.5 5.5a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM15 14a3.5 3.5 0 0 0-7 0',
  sun:       'M8 1v1m0 12v1M1 8H2m12 0h1M3.22 3.22l.7.7m8.16 8.16.7.7M3.22 12.78l.7-.7m8.16-8.16.7-.7M8 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  moon:      'M12 3a6 6 0 0 1-6 9A6 6 0 1 0 12 3z',
  logout:    'M10 2h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1h-3M7 11l4-3-4-3M11 8H3',
}

// ── Role config ───────────────────────────────────────────────────────────────

const ROLE_PERMS = {
  SUPER_ADMIN:     ['dashboard','nodes','bundles','cards','ota','alerts','users'],
  FACTORY_ADMIN:   ['dashboard','nodes','bundles','cards','ota','alerts','users'],
  LINE_SUPERVISOR: ['dashboard','nodes','alerts'],
  ADMIN_OPERATOR:  ['dashboard','nodes','bundles','cards'],
  AUDITOR:         ['dashboard'],
  CONTRACTOR:      ['dashboard'],
}

const ALL_TABS = [
  {
    key:  'dashboard',
    label: 'Dashboard',
    icon:  IC.dashboard,
    help:  'Live view of all production lines, nodes, and active sessions — refreshes automatically.',
  },
  {
    key:  'nodes',
    label: 'Nodes',
    icon:  IC.nodes,
    help:  'Approve new ESP32 reader nodes, monitor signal strength and firmware, and push remote configuration changes.',
  },
  {
    key:  'bundles',
    label: 'Bundles',
    icon:  IC.bundles,
    help:  'A bundle is a batch of garments moving through the line. Create one, assign an NFC card, then track it through each production stage.',
  },
  {
    key:  'cards',
    label: 'Cards',
    icon:  IC.cards,
    help:  'Register NFC cards with a friendly number (001, 002…). Use Scan Mode with a USB RFID reader to register or look up cards instantly.',
  },
  {
    key:  'ota',
    label: 'OTA Updates',
    icon:  IC.ota,
    help:  'Upload firmware binaries and roll them out to nodes over the air. Control rollout percentage and pause/resume at any time.',
  },
  {
    key:  'alerts',
    label: 'Alerts',
    icon:  IC.alerts,
    help:  'Real-time alerts from the production floor. Acknowledge alerts to dismiss them — high severity items need immediate attention.',
  },
  {
    key:  'users',
    label: 'Users',
    icon:  IC.users,
    help:  'Manage console accounts. Each role controls which tabs and actions the user can access.',
  },
]

function tabsForRole(role) {
  const allowed = ROLE_PERMS[role] || ['dashboard']
  return ALL_TABS.filter((t) => allowed.includes(t.key))
}

const ROLE_LABEL = {
  SUPER_ADMIN:     'Super Admin',
  FACTORY_ADMIN:   'Factory Admin',
  LINE_SUPERVISOR: 'Line Supervisor',
  ADMIN_OPERATOR:  'Operator',
  AUDITOR:         'Auditor',
  CONTRACTOR:      'Contractor',
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const navigate = useNavigate()
  const user = getUser()
  const tabs = tabsForRole(user?.role)
  const [tab, setTab] = useState(tabs[0]?.key || 'dashboard')
  const [theme, setTheme] = useState(getTheme)

  function handleToggleTheme() {
    const next = toggleTheme()
    setTheme(next)
  }

  function logout() {
    clearAuth()
    navigate('/login', { replace: true })
  }

  const currentTab = tabs.find((t) => t.key === tab) || tabs[0]

  return (
    <div className="admin-layout">
      <header className="admin-header">
        {/* Brand */}
        <Link to="/" className="admin-brand">
          <span className="admin-wordmark">Nex<span>wear</span></span>
        </Link>

        <span className="admin-factory-badge">Net Rat</span>
        <span className="admin-divider" />

        {/* Tabs */}
        <nav className="admin-tabs">
          {tabs.map(({ key, label, icon }) => (
            <button
              key={key}
              className={tab === key ? 'tab active' : 'tab'}
              onClick={() => setTab(key)}
            >
              <Icon d={icon} />
              {label}
            </button>
          ))}
        </nav>

        <span style={{ flex: 1 }} />

        {/* Theme toggle */}
        <button className="icon-btn" onClick={handleToggleTheme} title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'} style={{ marginRight: 8 }}>
          <Icon d={theme === 'dark' ? IC.sun : IC.moon} size={15} />
        </button>

        {/* User */}
        {user && (
          <div className="admin-user">
            <span className="admin-user-name">{user.name || user.email}</span>
            <span className="admin-user-role">{ROLE_LABEL[user.role] || user.role}</span>
          </div>
        )}

        <button className="icon-btn" onClick={logout} title="Sign out" style={{ marginLeft: 4 }}>
          <Icon d={IC.logout} size={15} />
        </button>
      </header>

      <main className="admin-main">
        {/* Tab context line */}
        {currentTab?.help && (
          <p className="tab-help">{currentTab.help}</p>
        )}

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
