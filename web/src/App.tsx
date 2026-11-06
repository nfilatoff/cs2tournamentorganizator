import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { api, isAdmin, type Me } from './api';
import { useI18n } from './i18n';
import { LanguageSwitcher } from './components/LanguageSwitcher';
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
  const { t } = useI18n();
  const [me, setMe] = useState<Me | null>(null);

  const refresh = useCallback(() => {
    api<Me>('/api/auth/me').then(setMe).catch(() => setMe({ kind: null }));
  }, []);
  useEffect(refresh, [refresh]);

  if (!me) return null;
  const admin = isAdmin(me);

  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST', body: {} });
    refresh();
  };

  return (
    <div className="shell">
      <aside className="rail">
        <Link to="/" className="logo" aria-label="Arena Pro">
          <img src="/logo-mark.png" alt="" />
          <span className="wordmark">Arena Pro<small>Gaming Club · CS2</small></span>
        </Link>
        <nav>
          <NavLink to="/" end className="navitem" title={t('nav.home')}><IconHome /><span>{t('nav.home')}</span></NavLink>
          <NavLink to="/tournaments" className="navitem" title={t('nav.tournaments')}><IconTrophy /><span>{t('nav.tournaments')}</span></NavLink>
          {me.kind !== null && <NavLink to="/teams" className="navitem" title={t('nav.teams')}><IconUsers /><span>{t('nav.teams')}</span></NavLink>}
          {admin && <NavLink to="/servers" className="navitem" title={t('nav.servers')}><IconServer /><span>{t('nav.servers')}</span></NavLink>}
          {admin && <NavLink to="/maps" className="navitem" title={t('nav.maps')}><IconMap /><span>{t('nav.maps')}</span></NavLink>}
          {admin && <NavLink to="/game-admins" className="navitem" title={t('nav.gameAdmins')}><IconShield /><span>{t('nav.gameAdmins')}</span></NavLink>}
        </nav>
        <div className="railfoot">
          <LanguageSwitcher />
          {me.kind ? (
            <div className="whoami">
              <NavLink to={me.kind === 'admin' ? '/account' : '/profile'} className="userchip" title={me.kind === 'admin' ? me.username : me.name}>
                <span className="initial">{(me.kind === 'admin' ? me.username : me.name).slice(0, 1).toUpperCase()}</span>
                <span className="userinfo">
                  <b>{me.kind === 'admin' ? me.username : me.name}</b>
                  {(me.kind === 'admin' || me.admin) && <small>{t('app.admin')}</small>}
                </span>
              </NavLink>
              <button className="iconbtn" onClick={logout} title={t('app.logout')} aria-label={t('app.logout')}><IconLogout /></button>
            </div>
          ) : (
            <NavLink to="/login" className="navitem" title={t('app.login')}><IconLogin /><span>{t('app.login')}</span></NavLink>
          )}
        </div>
      </aside>
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/tournaments" element={<Tournaments me={me} />} />
          <Route path="/tournaments/new" element={admin ? <TournamentForm /> : <Navigate to="/login" />} />
          <Route path="/tournaments/:id" element={<TournamentView me={me} />} />
          <Route path="/tournaments/:id/matches/:code/veto" element={<VetoRedirect />} />
          <Route path="/tournaments/:id/matches/:code" element={<MatchPage />} />
          <Route path="/teams" element={admin ? <AdminTeams /> : me.kind === 'player' ? <Teams me={me} /> : <Navigate to="/login" />} />
          <Route path="/login" element={<Login onLogin={refresh} />} />
          <Route path="/servers" element={admin ? <Servers /> : <Navigate to="/login" />} />
          <Route path="/account" element={me.kind === 'admin' ? <Account username={me.username} onChanged={refresh} /> : <Navigate to="/login" />} />
          <Route path="/profile" element={me.kind === 'player' ? <Profile me={me} onChanged={refresh} /> : <Navigate to="/login" />} />
          <Route path="/game-admins" element={admin ? <GameAdmins /> : <Navigate to="/login" />} />
          <Route path="/maps" element={admin ? <Maps /> : <Navigate to="/login" />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </main>
    </div>
  );
}
