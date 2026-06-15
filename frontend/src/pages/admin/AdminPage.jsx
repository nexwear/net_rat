import { useState } from 'react'
import { Link } from 'react-router-dom'
import NodesTab from './NodesTab.jsx'
import OtaTab from './OtaTab.jsx'
import './admin.css'

export const API_BASE = '/api'
export const ADMIN_SECRET = import.meta.env.VITE_ADMIN_SECRET || ''

export function adminHeaders() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${ADMIN_SECRET}`,
  }
}

export default function AdminPage() {
  const [tab, setTab] = useState('nodes')

  return (
    <div className="admin-layout">
      <header className="admin-header">
        <Link to="/" className="admin-back">← Factory Pilot</Link>
        <h1>Admin</h1>
        <nav className="admin-tabs">
          <button
            className={tab === 'nodes' ? 'tab active' : 'tab'}
            onClick={() => setTab('nodes')}
          >
            Nodes
          </button>
          <button
            className={tab === 'ota' ? 'tab active' : 'tab'}
            onClick={() => setTab('ota')}
          >
            OTA
          </button>
        </nav>
      </header>
      <main className="admin-main">
        {tab === 'nodes' ? <NodesTab /> : <OtaTab />}
      </main>
    </div>
  )
}
