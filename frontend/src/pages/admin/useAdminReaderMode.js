import { useEffect } from 'react'
import { API_BASE, adminHeaders } from './AdminPage.jsx'

/** Tell the backend which admin UI owns the NFC reader. */
export function useAdminReaderMode(mode) {
  useEffect(() => {
    const body = JSON.stringify({ mode: mode || 'IDLE' })
    fetch(`${API_BASE}/v1/admin/admin-reader/mode`, {
      method: 'POST',
      headers: adminHeaders(),
      body,
    }).catch(() => {})

    return () => {
      fetch(`${API_BASE}/v1/admin/admin-reader/mode`, {
        method: 'POST',
        headers: adminHeaders(),
        body: JSON.stringify({ mode: 'IDLE' }),
      }).catch(() => {})
    }
  }, [mode])
}

export async function fetchAdminReaderMode() {
  const res = await fetch(`${API_BASE}/v1/admin/admin-reader/mode`, {
    headers: adminHeaders(),
  })
  if (!res.ok) return { mode: 'IDLE' }
  return res.json()
}
