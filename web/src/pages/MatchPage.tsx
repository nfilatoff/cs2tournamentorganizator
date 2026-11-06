import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, type MatchDetails, type MatchPlayer, type MatchTeam } from '../api';
import { copyText } from '../clipboard';
import { useI18n } from '../i18n';
import { roundLabel } from '../rounds';
import { VetoPanel } from '../components/VetoPanel';
import { IconStar } from '../components/Icons';

type Side = 'a' | 'b';

function Copy({ text, label }: { text: string; label: string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  const copy = async () => {
    if (!(await copyText(text))) return;
    setDone(true);
    setTimeout(() => setDone(false), 1500);
  };
  return <button className="ghost" onClick={copy}>{done ? t('home.copied') : label}</button>;
}

// Тикающие часы с поправкой на разницу часов браузера и панели
function useClock(serverNow: number | undefined) {
  const [offset, setOffset] = useState(0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (serverNow !== undefined) setOffset(serverNow - Date.now());
  }, [serverNow]);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(timer);
  }, []);
  return now + offset;
}

const fmt = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function Avatar({ name, url }: { name: string; url: string | null }) {
  const cls = 'mavatar';
  if (url) return <img className={cls} src={url} alt="" />;
  return <div className={`${cls} letter`}>{name.slice(0, 1).toUpperCase()}</div>;
}

function PlayerRow({ p, side }: { p: MatchPlayer; side: Side }) {
  const { t } = useI18n();
  return (
    <div className={`mplayer ${side}`}>
      <Avatar name={p.name} url={p.avatarUrl} />
      <div className="mpinfo">
        <span className="mpname">
          {p.captain && <span className="cap" title={t('mp.captain')} aria-label={t('mp.captain')}><IconStar /></span>}
          {p.name}
        </span>
        {p.online !== null && (
          <span className={`mpstate${p.online ? ' on' : ''}`}>{p.online ? t('mp.onServer') : t('mp.notJoined')}</span>
        )}
      </div>
    </div>
  );
}

function TeamColumn({ team, side, teamSize }: { team: MatchTeam | null; side: Side; teamSize: number }) {
  const { t } = useI18n();
  return (
    <div className={`mcol ${side}`}>
      <h3>
        <span>{team ? team.name : t('match.tbd')}</span>
        {team && team.players.some((p) => p.online !== null) && (
          <small>{team.players.filter((p) => p.online).length}/{teamSize}</small>
        )}
      </h3>
      {team
        ? team.players.map((p) => <PlayerRow key={p.id} p={p} side={side} />)
        : Array.from({ length: teamSize }, (_, i) => <div key={i} className="mplayer empty" />)}
    </div>
  );
}

export function MatchPage() {
  const { t, err } = useI18n();
  const { id, code } = useParams();
  const [d, setD] = useState<MatchDetails | null>(null);
  const [error, setError] = useState('');

  const base = `/api/tournaments/${id}/matches/${code}`;
  const load = useCallback(() => {
    api<MatchDetails>(base).then((x) => { setD(x); setError(''); }).catch((e) => setError(err(e)));
  }, [base, err]);
  useEffect(load, [load]);

  // Пока игроки подключаются, состояние меняется быстро
  const phase = d?.phase;
  useEffect(() => {
    if (phase === 'done' || phase === 'skipped') return;
    const timer = setInterval(load, phase === 'warmup' ? 2000 : 5000);
    return () => clearInterval(timer);
  }, [phase, load]);

  const now = useClock(d?.now);

  if (!d) return error ? <p className="error">{error}</p> : null;

  const act = async (path: string, body: unknown = {}) => {
    setError('');
    try {
      await api(`${base}/${path}`, { method: 'POST', body });
      load();
    } catch (e) {
      setError(err(e));
    }
  };

  const name = (s: Side) => d.teams[s]?.name ?? t('match.tbd');
  const done = d.phase === 'done';
  const live = d.phase === 'live' || d.phase === 'warmup';
  const technical = done && (d.forced || d.walkover);
  // Техническая победа засчитывается серией всухую: 1:0 в BO1, 2:0 в BO3
  const score = (s: Side) => (technical ? (d.winner === s ? Math.ceil(d.bestOf / 2) : 0) : done ? (s === 'a' ? d.scoreA : d.scoreB) : d.series[s]);
  // В BO1 вместо счёта серии интереснее счёт карты
  const single = !technical && d.bestOf === 1 && d.maps[0]?.score;
  const bigScore = (s: Side) => (single ? d.maps[0]!.score![s] : score(s));
  const heroMap = d.maps.find((m) => m.current) ?? d.maps[0];
  const round = d.stage === 'group'
    ? `${t('group.title', { name: String.fromCharCode(64 + (d.groupNo ?? 1)) })}`
    : roundLabel(t, d.bracket as 'W' | 'L' | 'GF', d.roundFromEnd, d.tournament.format);
  const connect = d.server ? `connect ${d.server.host}:${d.server.port}` : '';
  const yourSide = d.you?.side ?? null;
  const online = (s: Side) => d.teams[s]?.players.filter((p) => p.online).length ?? 0;
  const lobby = d.lobby;
  const vetoVersion = d.veto ? `${d.veto.step}/${d.veto.done}/${d.phase}` : '';
  const left = lobby?.deadline ? lobby.deadline - now : null;
  const startsIn = lobby?.startsAt ? lobby.startsAt - now : null;

  const phaseText: Record<typeof d.phase, string> = {
    waiting: t('mp.phase.waiting'),
    veto: t('mp.phase.veto'),
    queued: t('mp.phase.queued'),
    warmup: t('mp.phase.warmup'),
    live: d.paused ? t('match.paused') : t('mp.phase.live'),
    done: t('mp.phase.done'),
    skipped: t('mp.phase.skipped'),
  };

  return (
    <>
      <div className={`mhero ${d.phase}`}>
        {heroMap?.imageUrl && <img className="mhero-bg" src={heroMap.imageUrl} alt="" />}
        <div className="mhero-top">
          <div className="crumbs">
            <Link to={`/tournaments/${d.tournament.id}`}>{d.tournament.name}</Link>
            <span className="sep">/</span><span>{round}</span>
            <span className="sep">/</span><span>{d.code}</span>
            <span className={`pill ${d.phase}`}>{phaseText[d.phase]}</span>
          </div>
          <div className="crumbs">
            {heroMap && <span>{heroMap.name}</span>}
            <span className="muted">BO{d.bestOf}</span>
          </div>
        </div>
        <div className="mhero-main">
          <div className="mteam a">
            {done && d.winner === 'a' && <div className="wlabel">{t('mp.winner')}</div>}
            {yourSide === 'a' && !done && <div className="you">{t('veto.yourTeam')}</div>}
            <span className="tname">{name('a')}</span>
          </div>
          <div className="mscore">
            <span className={done && d.winner === 'a' ? 'win' : done ? 'lose' : ''}>{d.phase === 'waiting' || d.phase === 'veto' || d.phase === 'queued' ? '–' : bigScore('a')}</span>
            <span className={done && d.winner === 'b' ? 'win' : done ? 'lose' : ''}>{d.phase === 'waiting' || d.phase === 'veto' || d.phase === 'queued' ? '–' : bigScore('b')}</span>
          </div>
          <div className="mteam b">
            {done && d.winner === 'b' && <div className="wlabel">{t('mp.winner')}</div>}
            {yourSide === 'b' && !done && <div className="you">{t('veto.yourTeam')}</div>}
            <span className="tname">{name('b')}</span>
          </div>
        </div>
        {done && (d.walkover || d.forced) && (
          <div className="mhero-note">{d.walkover ? t('mp.walkover') : t('match.byAdmin')}</div>
        )}
      </div>

      {error && <p className="error">{error}</p>}

      <div className="mgrid">
        <TeamColumn team={d.teams.a} side="a" teamSize={d.tournament.teamSize} />

        <div className="mcenter">
          {d.phase === 'warmup' && lobby && (
            <div className={`mbox lobby${yourSide ? ' mine' : ''}`}>
              {startsIn !== null && startsIn > 0 ? (
                <div className="countdown">{t('mp.startsIn')} <b>{Math.ceil(startsIn / 1000)}</b></div>
              ) : (
                left !== null && (
                  <div className="countdown">
                    {t('mp.joinLeft')} <b className={left < 120_000 ? 'hot' : ''}>{fmt(left)}</b>
                  </div>
                )
              )}
              <div className="teamstate">
                {(['a', 'b'] as const).map((s) => (
                  <div key={s}>
                    <b>{name(s)}</b>
                    <span>{t('mp.joined', { n: online(s), of: d.tournament.teamSize })}</span>
                    <span className={lobby.captainReady[s] ? 'ok' : 'muted'}>
                      {lobby.captainReady[s] ? t('mp.ready') : t('mp.notReady')}
                    </span>
                  </div>
                ))}
              </div>
              {!lobby.known && <p className="muted small">{t('mp.noStatus')}</p>}
            </div>
          )}

          {d.server && (
            <div className="mbox">
              <h4>{t('match.server')}</h4>
              <div className="mrow"><b>{d.server.name}</b></div>
              <div className="mconnect">
                <code>{connect}</code>
                <Copy text={connect} label={t('home.copy')} />
              </div>
              <a className="btn" href={`steam://connect/${d.server.host}:${d.server.port}`}>{t('mp.join')}</a>
            </div>
          )}

          {d.phase === 'warmup' && (
            <div className="mbox">
              <h4>{t('mp.howTo')}</h4>
              <ol className="steps">
                <li>{t('mp.step.connect')}</li>
                <li>{t('mp.step.wait', { n: d.tournament.teamSize })}</li>
                <li>{d.you?.captain ? <b>{t('mp.step.readyYou')}</b> : t('mp.step.ready')}</li>
                <li>{t('mp.step.start', { n: lobby?.startDelay ?? 10 })}</li>
              </ol>
              <p className="muted small">{t('mp.rule', { min: Math.round((lobby?.joinTime ?? 600) / 60) })}</p>
            </div>
          )}

          {d.phase === 'veto' && d.veto && (
            <VetoPanel base={base} active version={vetoVersion} onChange={load} />
          )}
          {(d.phase === 'queued' || d.phase === 'waiting') && (
            <div className="mbox"><p className="flat">{d.phase === 'queued' ? t('mp.queuedHint') : t('home.state.waiting')}</p></div>
          )}

          {d.maps.length > 0 && (
            <div className="mbox">
              <h4>{d.maps.length > 1 ? t('mp.maps') : t('mp.map')}</h4>
              {d.maps.map((m) => (
                <div key={m.no} className={`mmap${m.current ? ' current' : ''}`}>
                  {m.imageUrl ? <img src={m.imageUrl} alt="" /> : <div className="noimg" />}
                  <span className="mmname">{m.name}</span>
                  <span className="mmscore">
                    {m.score ? (
                      <>
                        <span className={m.winner === 'a' ? 'win' : ''}>{m.score.a}</span>:<span className={m.winner === 'b' ? 'win' : ''}>{m.score.b}</span>
                      </>
                    ) : (
                      <span className="muted small">
                        {m.side === 'knife'
                          ? t('mp.knife')
                          : `${m.side.startsWith('team1') ? name('a') : name('b')}: ${m.side.endsWith('_ct') ? 'CT' : 'T'}`}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}

          {d.veto && d.phase !== 'veto' && (
            <VetoPanel base={base} active={false} version={vetoVersion} onChange={load} />
          )}

          {d.admin && (
            <div className="mbox">
              <h4>{t('mp.admin')}</h4>
              {d.note && <p className="error">{err(d.note)}</p>}
              {d.adminCode && (
                <div className="stack tight">
                  <div className="muted small">{t('mp.adminCode')}</div>
                  <div className="mconnect">
                    <code>arenapro_auth {d.adminCode}</code>
                    <Copy text={`arenapro_auth ${d.adminCode}`} label={t('home.copy')} />
                  </div>
                </div>
              )}
              <div className="adminbar">
                {d.status === 'ready' && <button onClick={() => act('dispatch')}>{t('match.dispatch')}</button>}
                {d.status === 'live' && (
                  <>
                    <button className="ghost" onClick={() => act('pause', { paused: !d.paused })}>{d.paused ? t('match.unpause') : t('match.pause')}</button>
                    <button className="ghost" onClick={() => confirm(t('match.confirmRestartMatch')) && act('restart-match')}>{t('match.restartMatch')}</button>
                  </>
                )}
                {(d.status === 'ready' || d.status === 'live') && d.teams.a && d.teams.b && (
                  <>
                    <button className="ghost" onClick={() => confirm(t('mp.confirmWinner', { team: name('a') })) && act('winner', { winner: 'a' })}>{t('match.victory')}: {name('a')}</button>
                    <button className="ghost" onClick={() => confirm(t('mp.confirmWinner', { team: name('b') })) && act('winner', { winner: 'b' })}>{t('match.victory')}: {name('b')}</button>
                  </>
                )}
                {d.status === 'done' && <button className="ghost" onClick={() => act('undo')}>{t('match.undo')}</button>}
              </div>
            </div>
          )}

          <Link className="btn ghost backlink" to={`/tournaments/${d.tournament.id}`}>{t('mp.back')}</Link>
          {live && !d.server && <p className="muted small">{t('match.waiting')}</p>}
        </div>

        <TeamColumn team={d.teams.b} side="b" teamSize={d.tournament.teamSize} />
      </div>
    </>
  );
}
