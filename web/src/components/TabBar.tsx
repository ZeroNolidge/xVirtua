import { NavLink } from 'react-router-dom';

const tabs = [
  { to: '/', label: 'Practice' },
  { to: '/lookup', label: 'Plain words' },
  { to: '/progress', label: 'Progress' },
  { to: '/faculty', label: 'Faculty' },
];

export function TabBar() {
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
