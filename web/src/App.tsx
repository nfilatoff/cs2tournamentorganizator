import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { api, type Me } from './api';
import { LANGS, useI18n, type Lang } from './i18n';
import { Login } from './pages/Login';
import { Servers } from './pages/Servers';
import { Maps } from './pages/Maps';
import { Home } from './pages/Home';
import { Teams } from './pages/Teams';
import { AdminTeams } from './pages/AdminTeams';
import { Account } from './pages/Account';
import { Profile } from './pages/Profile';
import { Tournaments } from './pages/Tournaments';
import { TournamentForm } from './pages/TournamentForm';
import { TournamentView } from './pages/TournamentView';
import { MatchPage } from './pages/MatchPage';
import { GameAdmins } from './pages/GameAdmins';
import { IconHome, IconLogin, IconLogout, IconMap, IconServer, IconShield, IconTrophy, IconUsers } from './components/Icons';

// Вето теперь идёт в комнате матча: старые ссылки ведут туда же
function VetoRedirect() {
  const { id, code } = useParams();
  return <Navigate to={`/tournaments/${id}/matches/${code}`} replace />;
}

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
    <div className="shell">
      <aside className="sidebar">
        <Link to="/" className="logo" title="Arena Pro"><img src="/logo-mark.png" alt="Arena Pro" /></Link>
        <nav>
          <NavLink to="/" end className="navitem"><IconHome />{t('nav.home')}</NavLink>
          <NavLink to="/tournaments" className="navitem"><IconTrophy />{t('nav.tournaments')}</NavLink>
          {me.kind !== null && <NavLink to="/teams" className="navitem"><IconUsers />{t('nav.teams')}</NavLink>}
          {me.kind === 'admin' && <NavLink to="/servers" className="navitem"><IconServer />{t('nav.servers')}</NavLink>}
          {me.kind === 'admin' && <NavLink to="/maps" className="navitem"><IconMap />{t('nav.maps')}</NavLink>}
          {me.kind === 'admin' && <NavLink to="/game-admins" className="navitem"><IconShield />{t('nav.gameAdmins')}</NavLink>}
        </nav>
        <div className="grow" />
        <select value={lang} onChange={(e) => setLang(e.target.value as Lang)} aria-label={t('app.language')}>
          {LANGS.map((l) => <option key={l.id} value={l.id}>{l.id.toUpperCase()}</option>)}
        </select>
        {me.kind === 'admin' && <NavLink to="/account" className="userchip" title={me.username}>{me.username.slice(0, 1).toUpperCase()}</NavLink>}
        {me.kind === 'player' && <NavLink to="/profile" className="userchip" title={me.name}>{me.name.slice(0, 1).toUpperCase()}</NavLink>}
        {me.kind ? (
          <button className="iconbtn" onClick={logout} title={t('app.logout')} aria-label={t('app.logout')}><IconLogout /></button>
        ) : (
          <NavLink to="/login" className="navitem"><IconLogin />{t('app.login')}</NavLink>
        )}
      </aside>
      <div className="content">
        <header className="topbar">
          <Link to="/" className="wordmark">Arena <b>Pro</b><small>Gaming Club · CS2</small></Link>
          <span className="spacer" />
          {me.kind === 'admin' && <span className="who">{t('app.admin')}: <b>{me.username}</b></span>}
          {me.kind === 'player' && <span className="who"><b>{me.name}</b></span>}
          {!me.kind && <NavLink to="/login"><button>{t('app.login')}</button></NavLink>}
        </header>
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/tournaments" element={<Tournaments me={me} />} />
          <Route path="/tournaments/new" element={me.kind === 'admin' ? <TournamentForm /> : <Navigate to="/login" />} />
          <Route path="/tournaments/:id" element={<TournamentView me={me} />} />
          <Route path="/tournaments/:id/matches/:code/veto" element={<VetoRedirect />} />
          <Route path="/tournaments/:id/matches/:code" element={<MatchPage />} />
          <Route path="/teams" element={me.kind === 'admin' ? <AdminTeams /> : me.kind === 'player' ? <Teams me={me} /> : <Navigate to="/login" />} />
          <Route path="/login" element={<Login onLogin={refresh} />} />
          <Route path="/servers" element={me.kind === 'admin' ? <Servers /> : <Navigate to="/login" />} />
          <Route path="/account" element={me.kind === 'admin' ? <Account username={me.username} onChanged={refresh} /> : <Navigate to="/login" />} />
          <Route path="/profile" element={me.kind === 'player' ? <Profile me={me} onChanged={refresh} /> : <Navigate to="/login" />} />
          <Route path="/game-admins" element={me.kind === 'admin' ? <GameAdmins /> : <Navigate to="/login" />} />
          <Route path="/maps" element={me.kind === 'admin' ? <Maps /> : <Navigate to="/login" />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
      </div>
    </div>
  );
}
