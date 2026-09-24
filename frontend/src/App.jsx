import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ToastProvider } from "./context/ToastContext";
import { GameProvider } from "./context/GameContext";
import api from "./services/api";

import Home from "./pages/Home";
import Games from "./pages/Games";
import CustomBets from "./pages/CustomBets";
import Dashboard from "./pages/Dashboard";
import Admin from "./pages/Admin";

import Layout from "./components/layout/layout";
import MaintenanceLock from "./components/common/MaintenanceLock";
import BackToTop from "./components/common/BackToTop";

// custom bets layout
import CustomBetsLayout from "./components/customBets/Layout/CustomBetsLayout";

function PageGate({ pageKey, children }) {
  const location = useLocation();
  const { user } = useAuth();

  if (user?.role === "owner") return children;

  const canBypassDisabled = Boolean(user?.can_bypass_disabled);

  const [pages, setPages] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      try {
        const res = await api.get("/pages");
        if (!mounted) return;
        setPages(res.data?.data ?? []);
      } catch (e) {
        console.warn("Failed to load /pages for gating:", e);
        if (!mounted) return;
        setPages(null);
      } finally {
        if (mounted) setLoaded(true);
      }
    };
    run();
    return () => {
      mounted = false;
    };
  }, []);

  const pageMap = useMemo(() => {
    const m = new Map();
    (pages ?? []).forEach((p) => m.set(p.page_key, p));
    return m;
  }, [pages]);

  if (!loaded) return children;

  const p = pageMap.get(pageKey);
  if (!p) return children;

  const enabled = Boolean(p.is_enabled) || canBypassDisabled;
  if (enabled) return children;

  return <Navigate to="/" replace state={{ from: location.pathname, blocked: pageKey }} />;
}

function AppRoutes() {
  return (
    <Routes>
      {/* Custom Bets section (separate UI) */}
      <Route
        path="/custom-bets"
        element={
          <PageGate pageKey="custom_bets">
            <CustomBetsLayout />
          </PageGate>
        }
      >
        <Route index element={<CustomBets />} />
        <Route path="markets" element={<CustomBets view="markets" />} />
        {/* ✅ NEW bet page */}
        <Route path="bet/:betId" element={<CustomBets view="bet" />} />
      </Route>

      {/* Everything else in casino layout */}
      <Route
        path="*"
        element={
          <Layout>
            <Routes>
              <Route path="/" element={<Home />} />

              <Route
                path="/games"
                element={
                  <PageGate pageKey="games">
                    <Games />
                  </PageGate>
                }
              />
              <Route
                path="/games/:gameName"
                element={
                  <PageGate pageKey="games">
                    <Games />
                  </PageGate>
                }
              />

              <Route
                path="/dashboard"
                element={
                  <PageGate pageKey="dashboard">
                    <Dashboard />
                  </PageGate>
                }
              />

              <Route
                path="/admin"
                element={
                  <PageGate pageKey="admin">
                    <Admin />
                  </PageGate>
                }
              />

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Layout>
        }
      />
    </Routes>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <GameProvider>
            <MaintenanceLock />
            <AppRoutes />
            <BackToTop />
          </GameProvider>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;