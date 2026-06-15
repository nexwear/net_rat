import { Routes, Route, Link, Navigate } from 'react-router-dom'
import AdminPage from './pages/admin/AdminPage.jsx'
import LoginPage from './pages/auth/LoginPage.jsx'
import { isLoggedIn } from './auth.js'
import './App.css'

function RequireAuth({ children }) {
  return isLoggedIn() ? children : <Navigate to="/login" replace />
}

function Home() {
  return (
    <div className="home">
      <div className="home-inner">
        <div className="home-logo">
          <div className="home-wordmark">Nex<span>wear</span></div>
          <div className="home-tagline">Garment Intelligence Platform</div>
        </div>
        <div className="home-factory-pill">Net Rat Factory</div>
        <p className="home-description">
          Real-time garment-line traceability and productivity.<br />
          Track every bundle, every stitch, every stage.
        </p>
        <Link to="/admin" className="home-cta">
          Open Console
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 7h8M7.5 3.5 11 7l-3.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </Link>
      </div>
      <div className="home-footer">
        <span>Nexwear v2.0</span>
        <span>Net Rat Factory · Production</span>
      </div>
    </div>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/"        element={<Home />} />
      <Route path="/login"   element={<LoginPage />} />
      <Route path="/admin/*" element={<RequireAuth><AdminPage /></RequireAuth>} />
    </Routes>
  )
}
