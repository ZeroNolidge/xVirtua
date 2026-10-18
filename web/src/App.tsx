import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { TabBar } from './components/TabBar';
import { useAuth } from './lib/auth';
import { Home } from './pages/Home';
import { Login } from './pages/Login';
import { FinishSignIn } from './pages/FinishSignIn';
import { Consent } from './pages/Consent';
import { Progress } from './pages/Progress';
import { Invites } from './pages/faculty/Invites';
import { Lookup } from './pages/Lookup';
import { Briefing } from './pages/Briefing';
import { Session } from './pages/Session';
import { SessionDone } from './pages/SessionDone';
import { Loading, NotInvited, SettingUp } from './pages/StatusScreens';
import { useEffect } from 'react';
import { applyWaitingUpdate } from './lib/pwa';
import { prewarmConversation } from './lib/session';

export function App() {
  return (
    <div className="app">
      <Routes>
        {/* The email link must work regardless of auth state. */}
        <Route path="/auth/finish" element={<FinishSignIn />} />
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
  useEffect(applyWaitingUpdate, [pathname]);
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
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/lookup" element={<Lookup />} />
          <Route path="/scenario/:id" element={<Briefing />} />
          <Route path="/session/:id" element={<Session />} />
          <Route path="/session/:id/done" element={<SessionDone />} />
          <Route path="/progress" element={<Progress />} />
          <Route path="/faculty" element={isFaculty ? <Invites /> : <Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      {!inSession && <TabBar />}
    </>
  );
}
