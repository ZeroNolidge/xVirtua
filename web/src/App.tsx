import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { TabBar } from './components/TabBar';
import { UpdateBanner } from './components/UpdateBanner';
import { useAuth } from './lib/auth';
import { Home } from './pages/Home';
import { Login } from './pages/Login';
import { FinishSignIn } from './pages/FinishSignIn';
import { Consent } from './pages/Consent';
import { Privacy } from './pages/Privacy';
import { Loading, NotInvited, SettingUp } from './pages/StatusScreens';
import { applyWaitingUpdate } from './lib/pwa';
import { prewarmConversation } from './lib/session';

// Loaded on demand, so the first screen downloads less.
const named = <K extends string>(load: () => Promise<Record<K, React.ComponentType>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })));
const Progress = named(() => import('./pages/Progress'), 'Progress');
const Lookup = named(() => import('./pages/Lookup'), 'Lookup');
const Briefing = named(() => import('./pages/Briefing'), 'Briefing');
const Session = named(() => import('./pages/Session'), 'Session');
const SessionDone = named(() => import('./pages/SessionDone'), 'SessionDone');
const Invites = named(() => import('./pages/faculty/Invites'), 'Invites');

export function App() {
  return (
    <div className="app">
      <UpdateBanner />
      <Routes>
        {/* The email link must work regardless of auth state. */}
        <Route path="/auth/finish" element={<FinishSignIn />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="*" element={<Gate />} />
      </Routes>
    </div>
  );
}

function Gate() {
  const { status } = useAuth();
  switch (status) {
    case 'loading':
      return <Loading />;
    case 'signedOut':
      return <Login />;
    case 'notInvited':
      return <NotInvited />;
    case 'claiming':
      return <SettingUp />;
    case 'needsConsent':
      return <Consent />;
    case 'ready':
      return <SignedInApp />;
  }
}

function SignedInApp() {
  const { claims } = useAuth();
  const isFaculty = claims?.role === 'faculty';
  // Hide the tab bar during a live conversation so it can't be left by accident.
  const { pathname } = useLocation();
  const inSession = /^\/session\/[^/]+$/.test(pathname);
  // Effects must return nothing or a cleanup function, so wrap plain calls.
  useEffect(() => {
    applyWaitingUpdate();
  }, [pathname]);
  // Wake the conversation servers on open and whenever the app comes back to the foreground.
  useEffect(() => {
    prewarmConversation();
    const onVisible = () => document.visibilityState === 'visible' && prewarmConversation();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);
  return (
    <>
      <main>
        <Suspense fallback={<Loading />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/lookup" element={<Lookup />} />
            <Route path="/scenario/:id" element={<Briefing />} />
            <Route path="/session/:id" element={<Session />} />
            <Route path="/session/:id/done" element={<SessionDone />} />
            <Route path="/progress" element={<Progress />} />
            <Route
              path="/faculty"
              element={isFaculty ? <Invites /> : <Navigate to="/" replace />}
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </main>
      {!inSession && <TabBar />}
    </>
  );
}
