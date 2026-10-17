import { NavLink } from 'react-router-dom';
import { useAuth } from '../lib/auth';

export function TabBar() {
  const { claims } = useAuth();
  const tabs = [
    { to: '/', label: 'Practice' },
    { to: '/lookup', label: 'Plain words' },
    { to: '/progress', label: 'Progress' },
    ...(claims?.role === 'faculty' ? [{ to: '/faculty', label: 'Faculty' }] : []),
  ];
  return (
    <nav className="tabbar" aria-label="Main">
      {tabs.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.to === '/'}
          className={({ isActive }) => (isActive ? 'active' : '')}
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
