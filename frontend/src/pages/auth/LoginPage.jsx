import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { setAuth, isLoggedIn } from '../../auth.js'
import { getTheme, toggleTheme } from '../../theme.js'
import './login.css'

export default function LoginPage() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [theme, setTheme] = useState(getTheme)

  function handleTheme() { setTheme(toggleTheme()) }

  useEffect(() => {
    if (isLoggedIn()) navigate('/admin', { replace: true })
  }, [navigate])

  async function submit(e) {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Login failed')
      setAuth(data.token, data.user)
      navigate('/admin', { replace: true })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <span className="login-wordmark">Nex<span>wear</span></span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="login-factory">Net Rat Factory</span>
            <button
              type="button"
              onClick={handleTheme}
              title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
              style={{
                background: 'none', border: '1px solid var(--border)',
                borderRadius: 6, color: 'var(--text-3)', cursor: 'pointer',
                padding: '3px 6px', fontSize: 13, lineHeight: 1,
              }}
            >
              {theme === 'dark' ? '☀' : '☾'}
            </button>
          </div>
        </div>

        <div className="login-body">
          <h2>Sign in to Console</h2>
          <p className="login-sub">Enter your credentials to continue</p>

          <form onSubmit={submit} className="login-form">
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@nexwear.io"
                autoComplete="username"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
                required
              />
            </div>

            {error && <p className="login-error">{error}</p>}

            <button type="submit" className="login-btn" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>

      <div className="login-footer">Nexwear Console · Net Rat Factory · Production</div>
    </div>
  )
}
