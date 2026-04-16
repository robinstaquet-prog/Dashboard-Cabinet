import { useState, useCallback } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import LoginPage from './pages/LoginPage'
import AppLayout from './components/layout/AppLayout'
import { AppProvider } from './store/AppContext'
import type { AppData } from './data/schema'

import PatientsListPage from './pages/PatientsListPage'
import PatientFilePage from './pages/PatientFilePage'
import NewPatientPage from './pages/NewPatientPage'
import SessionEntryPage from './pages/SessionEntryPage'
import StatisticsPage from './pages/StatisticsPage'
import NumerisationPage from './pages/NumerisationPage'
import PatientEditPage from './pages/PatientEditPage'

interface AuthSession {
  data: AppData
  key: CryptoKey
}

export default function App() {
  const [session, setSession] = useState<AuthSession | null>(null)

  const handleUnlock = useCallback((data: AppData, key: CryptoKey) => {
    setSession({ data, key })
  }, [])

  const handleLock = useCallback(() => {
    setSession(null)
  }, [])

  if (!session) {
    return <LoginPage onUnlock={handleUnlock} />
  }

  return (
    <AppProvider initialData={session.data} cryptoKey={session.key} onLock={handleLock}>
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<Navigate to="/patients" replace />} />
            <Route path="/patients" element={<PatientsListPage />} />
            <Route path="/patients/nouveau" element={<NewPatientPage />} />
            <Route path="/patients/:id" element={<PatientFilePage />} />
            <Route path="/patients/:id/nouvelle-seance" element={<SessionEntryPage />} />
            <Route path="/patients/:id/modifier" element={<PatientEditPage />} />
            <Route path="/statistiques" element={<StatisticsPage />} />
            <Route path="/numerisation" element={<NumerisationPage />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AppProvider>
  )
}
