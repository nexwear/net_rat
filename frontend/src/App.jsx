import { Routes, Route, Link } from 'react-router-dom'
import AdminPage from './pages/admin/AdminPage.jsx'
import './App.css'

function Home() {
  return (
    <section id="center">
      <h1>Factory Pilot</h1>
      <p>Garment-line traceability &amp; productivity system.</p>
      <Link to="/admin" className="counter">Open Admin</Link>
    </section>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/admin/*" element={<AdminPage />} />
    </Routes>
  )
}
