import { useEffect } from 'react'
import { Routes, Route, useLocation } from 'react-router'
import { Toaster } from "@/components/ui/sonner"
import Home from './pages/Home'
import SearchPage from './pages/SearchPage'
import DevelopersPage from './pages/DevelopersPage'
import LibraryPage from './pages/LibraryPage'
import AlertsPage from './pages/AlertsPage'
import TermsPage from './pages/TermsPage'
import PricingPage from './pages/PricingPage'
import RegisterHelpPage from './pages/RegisterHelpPage'
import NameCheckPage from './pages/NameCheckPage'
import StatsPage from './pages/StatsPage'
import ReportSuccessPage from './pages/ReportSuccessPage'
import Login from "./pages/Login"
import OAuthAuthorizePage from "./pages/OAuthAuthorizePage"
import NotFound from "./pages/NotFound"

function usePageviewBeacon() {
  const { pathname } = useLocation()
  useEffect(() => {
    if (import.meta.env.DEV) return
    const body = JSON.stringify({ path: pathname, ref: document.referrer })
    navigator.sendBeacon?.('/api/pv', new Blob([body], { type: 'application/json' }))
  }, [pathname])
}

export default function App() {
  usePageviewBeacon()
  return (
    <>
      <Toaster />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/developers" element={<DevelopersPage />} />
        <Route path="/library" element={<LibraryPage />} />
        <Route path="/alerts" element={<AlertsPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/register-help" element={<RegisterHelpPage />} />
        <Route path="/namecheck" element={<NameCheckPage />} />
        <Route path="/stats" element={<StatsPage />} />
        <Route path="/report/success" element={<ReportSuccessPage />} />
        <Route path="/login" element={<Login />} />
        <Route path="/oauth/authorize" element={<OAuthAuthorizePage />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  )
}
