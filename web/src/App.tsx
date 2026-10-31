import { useCallback, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { api, type Me } from './api';
import { Login } from './pages/Login';
import { Servers } from './pages/Servers';
import { Maps } from './pages/Maps';
import { Home } from './pages/Home';

export function App() {
  const [me, setMe] = useState<Me | null>(null);

  const refresh = useCallback(() => {
    api<Me>('/api/auth/me').then(setMe).catch(() => setMe({ kind: null }));
  }, []);
  useEffect(refresh, [refresh]);

  if (!me) return null;

  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST', body: {} });
    refresh();
  };

  return (
    <>
      <header>
        <span className="brand">CS2 Турниры</span>
        <nav>
          <NavLink to="/">Главная</NavLink>
          {me.kind === 'admin' && <NavLink to="/servers">Серверы</NavLink>}
          {me.kind === 'admin' && <NavLink to="/maps">Карты</NavLink>}
        </nav>
        {me.kind === 'admin' && <span className="muted">{me.username}</span>}
        {me.kind === 'player' && <span className="muted">{me.name}</span>}
        {me.kind ? (
          <button className="ghost" onClick={logout}>Выйти</button>
        ) : (
          <NavLink to="/login">Войти</NavLink>
        )}
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Home me={me} />} />
          <Route path="/login" element={<Login onLogin={refresh} />} />
          <Route path="/servers" element={me.kind === 'admin' ? <Servers /> : <Navigate to="/login" />} />
          <Route path="/maps" element={me.kind === 'admin' ? <Maps /> : <Navigate to="/login" />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </>
  );
}
