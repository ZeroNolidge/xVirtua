import { Route, Routes } from 'react-router-dom';
import { TabBar } from './components/TabBar';
import { Home } from './pages/Home';
import { Placeholder } from './pages/Placeholder';

export function App() {
  return (
    <div className="app">
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Placeholder title="Sign in" phase={1} />} />
          <Route path="/consent" element={<Placeholder title="Before you start" phase={1} />} />
          <Route path="/lookup" element={<Placeholder title="Plain words" phase={2} />} />
          <Route path="/progress" element={<Placeholder title="Your progress" phase={5} />} />
          <Route path="/faculty/*" element={<Placeholder title="Faculty" phase={6} />} />
          <Route path="*" element={<Placeholder title="Not found" phase={0} />} />
        </Routes>
      </main>
      <TabBar />
    </div>
  );
}
