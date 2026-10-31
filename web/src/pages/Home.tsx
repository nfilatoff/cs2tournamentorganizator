import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type HomeDto, type HomeMatch } from '../api';
import { useI18n } from '../i18n';

function Copy({ text }: { text: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1500);
    } catch {
      // буфер обмена недоступен (например, не HTTPS): текст можно выделить вручную
    }
  };
  return <button className="ghost" onClick={copy}>{done ? t('home.copied') : t('home.copy')}</button>;
}

function MyMatch({ m }: { m: HomeMatch }) {
  const { t } = useI18n();
  const mine = m.state === 'veto' && m.veto?.yourTurn;
  return (
    <div className={`card${mine ? ' mine' : ''}`}>
      <div className="between">
        <h2>{m.team} <span className="muted">vs</span> {m.opponent ?? t('match.tbd')}</h2>
        <span className="muted">BO{m.bestOf} · <Link to={`/tournaments/${m.tournamentId}/matches/${m.code}`}>{m.code}</Link></span>
      </div>
      <p className="muted"><Link to={`/tournaments/${m.tournamentId}`}>{m.tournamentName}</Link></p>

      {m.state === 'veto' && m.veto && (
        <p>
          <b>{mine ? t('home.yourTurn') : t('home.state.veto', { step: m.veto.step, total: m.veto.total })}</b>{' '}
          <Link to={`/tournaments/${m.tournamentId}/matches/${m.code}/veto`}><button>{t('home.openVeto')}</button></Link>
        </p>
      )}
      {m.state === 'queued' && <p>{t('home.state.queued')}</p>}
      {m.state === 'waiting' && <p className="muted">{t('home.state.waiting')}</p>}
      {m.state === 'live' && (
        <>
          <p>
            {m.started && m.map
              ? t('match.playing', { map: m.map, a: m.score?.a ?? 0, b: m.score?.b ?? 0 })
              : t('match.waiting')}
            {m.paused && ` · ${t('match.paused')}`}
          </p>
          {m.server && (
            <p>
              {t('home.connect')} <code>connect {m.server.host}:{m.server.port}</code>{' '}
              <Copy text={`connect ${m.server.host}:${m.server.port}`} />
              <span className="muted"> · {m.server.name}</span>
            </p>
          )}
          <p><Link to={`/tournaments/${m.tournamentId}/matches/${m.code}`}><button>{t('home.openMatch')}</button></Link></p>
        </>
      )}
    </div>
  );
}

const attentionKey = (a: { type: string; reason?: string; count?: number }) => {
  const base = a.type === 'queued' ? (a.reason === 'noServer' ? 'home.att.queuedNoServer' : 'home.att.queuedManual') : `home.att.${a.type}`;
  return (a.count ?? 1) > 1 ? `${base}Many` : base;
};

export function Home() {
  const { t, err } = useI18n();
  const [d, setD] = useState<HomeDto | null>(null);

  const load = useCallback(() => {
    api<HomeDto>('/api/home')
      .then((x) => setD((prev) => (prev && JSON.stringify(prev) === JSON.stringify(x) ? prev : x)))
      .catch(() => undefined);
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [load]);

  if (!d) return null;

  const tournaments = (
    <div className="card">
      <h2>{t('home.tournaments')}</h2>
      <table>
        <tbody>
          {d.tournaments.map((x) => (
            <tr key={x.id}>
              <td><Link to={`/tournaments/${x.id}`}>{x.name}</Link></td>
              <td className="muted">{t(`format.${x.format}`)}, {x.teamSize}v{x.teamSize}</td>
              <td>{x.teamCount}/{x.maxTeams}</td>
              <td>{t(`status.${x.status}`)}</td>
            </tr>
          ))}
          {d.tournaments.length === 0 && <tr><td className="muted">{t('home.noTournaments')}</td></tr>}
        </tbody>
      </table>
    </div>
  );

  if (d.kind === 'guest') {
    return (
      <>
        <div className="card">
          <h1>{t('app.brand')}</h1>
          <p className="muted">{t('home.guest')}</p>
          <a href="/api/auth/steam"><button>{t('login.steam')}</button></a>
        </div>
        {tournaments}
      </>
    );
  }

  if (d.kind === 'player') {
    const p = d.player;
    return (
      <>
        <h1>{t('home.myMatches')}</h1>
        {p.matches.length === 0 && <div className="card"><p className="muted">{t('home.noMatches')}</p></div>}
        {p.matches.map((m) => <MyMatch key={`${m.tournamentId}-${m.code}`} m={m} />)}

        {p.open.length > 0 && (
          <div className="card">
            <h2>{t('home.canRegister')}</h2>
            <table>
              <tbody>
                {p.open.map((o) => (
                  <tr key={o.tournamentId}>
                    <td>{o.tournamentName}</td>
                    <td className="muted">{o.teams.map((x) => x.name).join(', ')}</td>
                    <td style={{ textAlign: 'right' }}><Link to={`/tournaments/${o.tournamentId}`}><button>{t('home.register')}</button></Link></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {p.registered.length > 0 && (
          <div className="card">
            <h2>{t('home.registered')}</h2>
            <table>
              <tbody>
                {p.registered.map((r) => (
                  <tr key={r.tournamentId}>
                    <td><Link to={`/tournaments/${r.tournamentId}`}>{r.tournamentName}</Link></td>
                    <td className="muted">{r.teamName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="card">
          <div className="between">
            <h2>{t('home.myTeams')}</h2>
            <Link to="/teams"><button className="ghost">{t('nav.teams')}</button></Link>
          </div>
          {p.teams.length === 0
            ? <p className="muted">{t('teams.empty')}</p>
            : <p>{p.teams.map((x) => `${x.name}${x.captain ? ` (${t('teams.captain')})` : ''}`).join(', ')}</p>}
        </div>
        {tournaments}
      </>
    );
  }

  const a = d.admin;
  return (
    <>
      <div className="card">
        <h2>{t('home.attention')}</h2>
        {a.attention.length === 0 && <p className="muted">{t('home.allGood')}</p>}
        <ul className="attention">
          {a.attention.map((x, i) => {
            const link = 'tournamentId' in x
              ? (x.type === 'veto' ? `/tournaments/${x.tournamentId}/matches/${x.code}/veto` : `/tournaments/${x.tournamentId}`)
              : '/servers';
            const text = t(attentionKey(x) as 'home.att.veto', {
              n: 'count' in x ? x.count : 1,
              tournament: 'tournamentName' in x ? x.tournamentName : '',
              code: 'code' in x ? x.code : '',
              a: 'a' in x ? x.a ?? '?' : '', b: 'b' in x ? x.b ?? '?' : '',
              step: 'step' in x ? x.step : 0, total: 'total' in x ? x.total : 0,
              text: 'note' in x ? err(x.note) : '',
              server: 'server' in x ? x.server : '', error: 'error' in x ? err(x.error) : '',
            });
            return <li key={i}><Link to={link}>{text}</Link></li>;
          })}
        </ul>
      </div>

      <div className="grid2">
        <div className="card">
          <div className="between">
            <h2>{t('home.servers')}</h2>
            <Link to="/servers"><button className="ghost">{t('nav.servers')}</button></Link>
          </div>
          <p>{t('home.serversSummary', { free: a.servers.free, busy: a.servers.busy, total: a.servers.total })}</p>
          <table>
            <tbody>
              {a.servers.list.map((s) => (
                <tr key={s.id}>
                  <td>{s.name} <span className="muted">{s.address}</span></td>
                  <td className={s.state === 'problem' ? 'error' : ''}>{t(`home.server.${s.state}`)}</td>
                  <td className="muted">{s.match ?? ''}</td>
                </tr>
              ))}
              {a.servers.list.length === 0 && <tr><td className="muted">{t('servers.empty')}</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h2>{t('home.running')}</h2>
          <table>
            <tbody>
              {a.running.map((r) => (
                <tr key={r.id}>
                  <td><Link to={`/tournaments/${r.id}`}>{r.name}</Link></td>
                  <td>{t('home.progress', { done: r.done, total: r.total })}</td>
                  <td className="muted">{r.live > 0 ? t('home.liveCount', { n: r.live }) : ''}</td>
                </tr>
              ))}
              {a.running.length === 0 && <tr><td className="muted">{t('home.noRunning')}</td></tr>}
            </tbody>
          </table>
          <p>
            <Link to="/tournaments/new"><button>{t('tournaments.create')}</button></Link>{' '}
            <Link to="/teams"><button className="ghost">{t('nav.teams')}</button></Link>{' '}
            <Link to="/maps"><button className="ghost">{t('nav.maps')}</button></Link>
          </p>
        </div>
      </div>
      {tournaments}
    </>
  );
}
