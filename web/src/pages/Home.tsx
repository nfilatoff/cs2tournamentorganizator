import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type HomeDto, type HomeMatch } from '../api';
import { copyText } from '../clipboard';
import { useI18n } from '../i18n';
import { IconChevron } from '../components/Icons';
import { TournamentRows } from '../components/TournamentRows';

function Copy({ text }: { text: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  const copy = async () => {
    if (!(await copyText(text))) return;
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  };
  return <button className="ghost" onClick={copy}>{done ? t('home.copied') : t('home.copy')}</button>;
}

function MyMatch({ m }: { m: HomeMatch }) {
  const { t } = useI18n();
  const mine = m.state === 'veto' && m.veto?.yourTurn;
  const room = `/tournaments/${m.tournamentId}/matches/${m.code}`;
  return (
    <div className={`card mymatch${mine ? ' mine' : ''}`}>
      <div className="mymain">
        <div className="meta">
          <span className={`pill ${m.state}`}>{t(`mp.phase.${m.state}`)}</span>
          <Link to={`/tournaments/${m.tournamentId}`}>{m.tournamentName}</Link>
          <span>BO{m.bestOf} · {m.code}</span>
        </div>
        <div className="vs">
          <span>{m.team}</span>
          {m.state === 'live' && m.started && m.score
            ? <span className="vsscore"><b>{m.score.a}</b><b>{m.score.b}</b></span>
            : <span className="vsword">vs</span>}
          <span>{m.opponent ?? t('match.tbd')}</span>
        </div>
        <div className="state">
          {m.state === 'veto' && m.veto && (
            <b className={mine ? 'yourturn' : 'muted'}>
              {mine ? t('home.yourTurn') : t('home.state.veto', { step: m.veto.step, total: m.veto.total })}
            </b>
          )}
          {m.state === 'queued' && <span>{t('home.state.queued')}</span>}
          {m.state === 'waiting' && <span className="muted">{t('home.state.waiting')}</span>}
          {m.state === 'live' && (
            <>
              <div>
                {m.started && m.map
                  ? t('match.playing', { map: m.map, a: m.score?.a ?? 0, b: m.score?.b ?? 0 })
                  : t('match.waiting')}
                {m.paused && ` · ${t('match.paused')}`}
              </div>
              {m.server && (
                <div className="mconnect">
                  <code>connect {m.server.host}:{m.server.port}</code>
                  <Copy text={`connect ${m.server.host}:${m.server.port}`} />
                  <span className="muted small">{m.server.name}</span>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      <Link className={`btn${mine || m.state === 'live' ? ' big' : ' ghost'}`} to={room}>
        {m.state === 'veto' ? t('home.openVeto') : t('home.openMatch')}
      </Link>
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

  // Регистрация открыта только у ещё не начатых турниров; идущие показываются отдельно (админу они уже есть в «Идущих турнирах»)
  const registering = d.tournaments.filter((x) => x.status === 'registration');
  const started = d.tournaments.filter((x) => x.status === 'running');
  const tournaments = (
    <>
      <section className="section">
        <h2>{t('home.tournaments')}</h2>
        <TournamentRows list={registering} empty={t('home.noTournaments')} />
      </section>
      {d.kind !== 'admin' && started.length > 0 && (
        <section className="section">
          <h2>{t('home.running')}</h2>
          <TournamentRows list={started} empty="" />
        </section>
      )}
    </>
  );

  if (d.kind === 'guest') {
    return (
      <>
        <div className="hero">
          <div>
            <h1>Arena Pro · CS2</h1>
            <p>{t('home.heroTag')}</p>
            <p className="muted">{t('home.guest')}</p>
            <a className="btn big" href="/api/auth/steam">{t('login.steam')}</a>
          </div>
          <img className="heroimg" src="/logo-mark.png" alt="Arena Pro Gaming Club" />
        </div>
        {tournaments}
      </>
    );
  }

  if (d.kind === 'player') {
    const p = d.player;
    return (
      <div className="dash">
        <div className="dashmain">
          <section className="section">
            <h1>{t('home.myMatches')}</h1>
            {p.matches.length === 0 && <div className="emptybox">{t('home.noMatches')}</div>}
            {p.matches.map((m) => <MyMatch key={`${m.tournamentId}-${m.code}`} m={m} />)}
          </section>
          {tournaments}
        </div>
        <div className="dashside">
          {p.open.length > 0 && (
            <section className="section">
              <h2>{t('home.canRegister')}</h2>
              <div className="plainlist">
                {p.open.map((o) => (
                  <div key={o.tournamentId} className="plainrow">
                    <span className="grow">
                      <b>{o.tournamentName}</b>
                      <span className="muted small">{o.teams.map((x) => x.name).join(', ')}</span>
                    </span>
                    <Link className="btn" to={`/tournaments/${o.tournamentId}`}>{t('home.register')}</Link>
                  </div>
                ))}
              </div>
            </section>
          )}
          {p.registered.length > 0 && (
            <section className="section">
              <h2>{t('home.registered')}</h2>
              <div className="plainlist">
                {p.registered.map((r) => (
                  <Link key={r.tournamentId} to={`/tournaments/${r.tournamentId}`} className="plainrow">
                    <span className="grow"><b>{r.tournamentName}</b><span className="muted small">{r.teamName}</span></span>
                  </Link>
                ))}
              </div>
            </section>
          )}
          <section className="section">
            <div className="between">
              <h2>{t('home.myTeams')}</h2>
              <Link className="btn ghost" to="/teams">{t('nav.teams')}</Link>
            </div>
            {p.teams.length === 0
              ? <div className="emptybox">{t('teams.empty')}</div>
              : (
                <div className="plainlist">
                  {p.teams.map((x) => (
                    <div key={x.name} className="plainrow"><b className="grow">{x.name}</b>{x.captain && <span className="muted small">{t('teams.captain')}</span>}</div>
                  ))}
                </div>
              )}
          </section>
        </div>
      </div>
    );
  }

  const a = d.admin;
  return (
    <>
      <div className="pagehead">
        <h1>{t('nav.home')}</h1>
        <Link className="btn" to="/tournaments/new">{t('tournaments.create')}</Link>
      </div>
      <div className="dash">
        <div className="dashmain">
          <section className="section">
            <h2>{t('home.attention')}</h2>
            {a.attention.length === 0 && <div className="emptybox">{t('home.allGood')}</div>}
            <ul className="attention">
              {a.attention.map((x, i) => {
                const link = 'tournamentId' in x
                  ? (x.type === 'veto' ? `/tournaments/${x.tournamentId}/matches/${x.code}` : `/tournaments/${x.tournamentId}`)
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
                return <li key={i}><Link to={link}><span>{text}</span><IconChevron /></Link></li>;
              })}
            </ul>
          </section>

          <section className="section">
            <h2>{t('home.running')}</h2>
            {a.running.length === 0 && <div className="emptybox">{t('home.noRunning')}</div>}
            <div className="tlist">
              {a.running.map((r) => (
                <Link key={r.id} to={`/tournaments/${r.id}`} className="trow">
                  <span className="tmain"><span className="tname">{r.name}</span></span>
                  <span className="tslots">
                    <span>{t('home.progress', { done: r.done, total: r.total })}</span>
                    <span className="bar"><i style={{ width: `${(r.done / Math.max(1, r.total)) * 100}%` }} /></span>
                  </span>
                  {r.live > 0 ? <span className="pill live">{t('home.liveCount', { n: r.live })}</span> : <span />}
                  <span className="tgo"><IconChevron /></span>
                </Link>
              ))}
            </div>
          </section>
          {tournaments}
        </div>

        <aside className="dashside">
          <section className="section">
            <div className="between">
              <h2>{t('home.servers')}</h2>
              <Link className="iconbtn" to="/servers" aria-label={t('nav.servers')} title={t('nav.servers')}><IconChevron /></Link>
            </div>
            <p className="muted lead">{t('home.serversSummary', { free: a.servers.free, busy: a.servers.busy, total: a.servers.total })}</p>
            <div className="plainlist">
              {a.servers.list.map((s) => (
                <div key={s.id} className="plainrow">
                  <span className="grow">
                    <b>{s.name}</b>
                    <span className="muted small">{s.address}{s.match ? ` · ${s.match}` : ''}</span>
                  </span>
                  <span className={`pill ${s.state === 'busy' ? 'live' : s.state === 'free' ? 'ok' : 'bad'}`}>{t(`home.server.${s.state}`)}</span>
                </div>
              ))}
              {a.servers.list.length === 0 && <div className="emptybox">{t('servers.empty')}</div>}
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}
