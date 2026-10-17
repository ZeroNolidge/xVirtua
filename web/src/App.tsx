import { Navigate, Route, Routes } from 'react-router-dom';
import { TabBar } from './components/TabBar';
import { useAuth } from './lib/auth';
import { Home } from './pages/Home';
import { Placeholder } from './pages/Placeholder';
import { Login } from './pages/Login';
import { FinishSignIn } from './pages/FinishSignIn';
import { Consent } from './pages/Consent';
import { Progress } from './pages/Progress';
import { Invites } from './pages/faculty/Invites';
import { Loading, NotInvited, SettingUp } from './pages/StatusScreens';

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
  return (
    <>
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/lookup" element={<Placeholder title="Plain words" phase={2} />} />
          <Route path="/progress" element={<Progress />} />
          <Route path="/faculty" element={isFaculty ? <Invites /> : <Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <TabBar />
    </>
  );
}
