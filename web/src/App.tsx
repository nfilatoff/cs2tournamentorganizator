import { useCallback, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { api, type Me } from './api';
import { LANGS, useI18n, type Lang } from './i18n';
import { Login } from './pages/Login';
import { Servers } from './pages/Servers';
import { Maps } from './pages/Maps';
import { Home } from './pages/Home';
import { Teams } from './pages/Teams';
import { Tournaments } from './pages/Tournaments';
import { TournamentForm } from './pages/TournamentForm';
import { TournamentView } from './pages/TournamentView';

export function App() {
  const { t, lang, setLang } = useI18n();
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
        <span className="brand">{t('app.brand')}</span>
        <nav>
          <NavLink to="/">{t('nav.home')}</NavLink>
          <NavLink to="/tournaments">{t('nav.tournaments')}</NavLink>
          {me.kind !== null && <NavLink to="/teams">{t('nav.teams')}</NavLink>}
          {me.kind === 'admin' && <NavLink to="/servers">{t('nav.servers')}</NavLink>}
          {me.kind === 'admin' && <NavLink to="/maps">{t('nav.maps')}</NavLink>}
        </nav>
        <select value={lang} onChange={(e) => setLang(e.target.value as Lang)} aria-label={t('app.language')}>
          {LANGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
        </select>
        {me.kind === 'admin' && <span className="muted">{me.username}</span>}
        {me.kind === 'player' && <span className="muted">{me.name}</span>}
        {me.kind ? (
          <button className="ghost" onClick={logout}>{t('app.logout')}</button>
        ) : (
          <NavLink to="/login">{t('app.login')}</NavLink>
        )}
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Home me={me} />} />
          <Route path="/tournaments" element={<Tournaments me={me} />} />
          <Route path="/tournaments/new" element={me.kind === 'admin' ? <TournamentForm /> : <Navigate to="/login" />} />
          <Route path="/tournaments/:id" element={<TournamentView me={me} />} />
          <Route path="/teams" element={me.kind !== null ? <Teams me={me} /> : <Navigate to="/login" />} />
          <Route path="/login" element={<Login onLogin={refresh} />} />
          <Route path="/servers" element={me.kind === 'admin' ? <Servers /> : <Navigate to="/login" />} />
          <Route path="/maps" element={me.kind === 'admin' ? <Maps /> : <Navigate to="/login" />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </>
  );
}
