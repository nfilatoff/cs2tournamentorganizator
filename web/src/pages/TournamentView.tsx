import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, type EntryDto, type MatchDto, type Me, type Team, type TournamentDetails } from '../api';
import { useI18n } from '../i18n';
import { roundLabel } from '../rounds';

function Slot({ entry, score, won }: { entry: EntryDto; score: number; won: boolean }) {
  const { t } = useI18n();
  const text = entry.type === 'team' ? entry.name : entry.type === 'bye' ? t('match.bye') : t('match.tbd');
  return (
    <div className={`slot${won ? ' won' : ''}${entry.type !== 'team' ? ' empty' : ''}`}>
      <span>{text}</span>
      <b>{entry.type === 'team' ? score : ''}</b>
    </div>
  );
}

interface Actions {
  onResult: (code: string, a: number, b: number) => void;
  onWinner: (code: string, winner: 'a' | 'b') => void;
  onUndo: (code: string) => void;
  onDispatch: (code: string) => void;
  onPause: (code: string, paused: boolean) => void;
  onRestartMap: (code: string) => void;
  onRestartMatch: (code: string) => void;
}

function MatchCard({ m, admin, actions }: { m: MatchDto; admin: boolean; actions: Actions }) {
  const { t, err } = useI18n();
  const [a, setA] = useState(0);
  const [b, setB] = useState(0);
  const need = Math.ceil(m.bestOf / 2);
  const inPlay = m.status === 'ready' || m.status === 'live';
  return (
    <div className={`match ${m.status}`}>
      <div className="mhead"><span>{m.code}</span><span>{m.forced ? t('match.byAdmin') : `BO${m.bestOf}`}</span></div>
      <Slot entry={m.a} score={m.status === 'live' ? m.seriesA ?? 0 : m.scoreA} won={m.winner === 'a' && m.status === 'done'} />
      <Slot entry={m.b} score={m.status === 'live' ? m.seriesB ?? 0 : m.scoreB} won={m.winner === 'b' && m.status === 'done'} />
      {m.status === 'live' && (
        <div className="livebox">
          <div>
            {m.live
              ? <>{t('match.playing', { map: m.curMap?.name ?? t('match.map'), a: m.curMap?.scoreA ?? 0, b: m.curMap?.scoreB ?? 0 })}{m.paused && ` · ${t('match.paused')}`}</>
              : t('match.waiting')}
          </div>
          {m.server && <div>{t('match.server')}: <b>{m.server.name}</b>, <code>connect {m.server.host}:{m.server.port}</code></div>}
        </div>
      )}
      {m.status === 'done' && m.playedMaps && m.playedMaps.length > 0 && (
        <div className="livebox muted">{m.playedMaps.map((p) => `${p.name ?? t('match.map')} ${p.scoreA}:${p.scoreB}`).join(' · ')}</div>
      )}
      {admin && m.note && <div className="livebox error">{err(m.note)}</div>}
      {admin && m.status === 'ready' && (
        <div className="result">
          <button onClick={() => actions.onDispatch(m.code)}>{t('match.dispatch')}</button>
        </div>
      )}
      {admin && m.status === 'live' && (
        <div className="result wrap">
          <button className="ghost" onClick={() => actions.onPause(m.code, !m.paused)}>{m.paused ? t('match.unpause') : t('match.pause')}</button>
          {m.live && <button className="ghost" onClick={() => confirm(t('match.confirmRestartMap')) && actions.onRestartMap(m.code)}>{t('match.restartMap')}</button>}
          <button className="ghost" onClick={() => confirm(t('match.confirmRestartMatch')) && actions.onRestartMatch(m.code)}>{t('match.restartMatch')}</button>
        </div>
      )}
      {admin && inPlay && (
        <>
          <div className="result">
            <input type="number" min={0} max={need} value={a} onChange={(e) => setA(Number(e.target.value))} />
            <span>:</span>
            <input type="number" min={0} max={need} value={b} onChange={(e) => setB(Number(e.target.value))} />
            <button onClick={() => actions.onResult(m.code, a, b)}>OK</button>
          </div>
          <div className="result">
            <span className="muted">{t('match.victory')}:</span>
            <button className="ghost" onClick={() => actions.onWinner(m.code, 'a')}>A</button>
            <button className="ghost" onClick={() => actions.onWinner(m.code, 'b')}>B</button>
          </div>
        </>
      )}
      {admin && m.status === 'done' && (
        <div className="result">
          <button className="ghost" onClick={() => actions.onUndo(m.code)}>{t('match.undo')}</button>
        </div>
      )}
    </div>
  );
}

function Bracket({ tr, admin, actions }: { tr: TournamentDetails; admin: boolean; actions: Actions }) {
  const { t } = useI18n();
  const visible = tr.matches.filter((m) => m.status !== 'bye' && m.status !== 'skipped');
  const title = (br: 'W' | 'L' | 'GF') =>
    tr.format === 'single' && br === 'W' ? t('bracket.single') : br === 'W' ? t('bracket.upper') : br === 'L' ? t('bracket.lower') : t('bracket.gf');
  return (
    <>
      {(['W', 'L', 'GF'] as const).map((br) => {
        const ms = visible.filter((m) => m.bracket === br);
        if (ms.length === 0) return null;
        const rounds = [...new Set(ms.map((m) => m.round))].sort((x, y) => x - y);
        return (
          <div className="card" key={br}>
            <h2>{title(br)}</h2>
            <div className="bracket">
              {rounds.map((r) => {
                const col = ms.filter((m) => m.round === r);
                return (
                  <div className="col" key={r}>
                    <div className="roundname">{roundLabel(t, br, col[0]!.roundFromEnd, tr.format)}</div>
                    {col.map((m) => <MatchCard key={m.code} m={m} admin={admin} actions={actions} />)}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </>
  );
}

export function TournamentView({ me }: { me: Me }) {
  const { t, err } = useI18n();
  const { id } = useParams();
  const navigate = useNavigate();
  const [tr, setTr] = useState<TournamentDetails | null>(null);
  const [myTeams, setMyTeams] = useState<Team[]>([]);
  const [allTeams, setAllTeams] = useState<Team[]>([]);
  const [teamId, setTeamId] = useState<number | null>(null);
  const [roster, setRoster] = useState<number[]>([]);
  const [shuffle, setShuffle] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api<TournamentDetails>(`/api/tournaments/${id}`).then(setTr).catch((e) => setError(err(e)));
  }, [id, err]);
  useEffect(load, [load]);

  // Пока турнир идёт, обновляем состояние матчей (счёт, серверы)
  const running = tr?.status === 'running';
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [running, load]);

  useEffect(() => {
    if (me.kind === 'player') {
      api<Team[]>('/api/teams/mine').then((ts) => setMyTeams(ts.filter((x) => x.captainId === me.id))).catch(() => undefined);
    } else if (me.kind === 'admin') {
      api<Team[]>('/api/admin/teams').then(setAllTeams).catch(() => undefined);
    }
  }, [me]);

  const act = async (fn: () => Promise<TournamentDetails | unknown>) => {
    setError('');
    try {
      const res = await fn();
      if (res && typeof res === 'object' && 'matches' in res) setTr(res as TournamentDetails);
      else load();
    } catch (e) {
      setError(err(e));
    }
  };

  if (!tr) return error ? <p className="error">{error}</p> : null;

  const admin = me.kind === 'admin';
  const registeredIds = new Set(tr.teams.map((x) => x.id));
  const selectable = (admin ? allTeams : myTeams).filter((x) => !registeredIds.has(x.id));
  const chosen = selectable.find((x) => x.id === teamId) ?? selectable[0];
  const effectiveRoster = roster.length > 0 ? roster : chosen?.members.slice(0, tr.teamSize).map((m) => m.id) ?? [];

  const register = () => chosen && act(() => api(`/api/tournaments/${tr.id}/teams`, {
    method: 'POST', body: { teamId: chosen.id, playerIds: effectiveRoster },
  }));
  const url = (code: string, action: string) => `/api/tournaments/${tr.id}/matches/${code}/${action}`;

  return (
    <>
      <div className="between">
        <h1>{tr.name}</h1>
        {admin && <button className="danger" onClick={async () => { await api(`/api/tournaments/${tr.id}`, { method: 'DELETE' }); navigate('/tournaments'); }}>{t('common.delete')}</button>}
      </div>
      <p className="muted">
        {t(`format.${tr.format}`)}, {tr.teamSize}v{tr.teamSize}, {t('view.upTo', { n: tr.maxTeams })} · {t(`status.${tr.status}`)}
      </p>
      {tr.champion && <div className="card champion">🏆 {t('view.winner')}: <b>{tr.champion.name}</b></div>}
      {error && <p className="error">{error}</p>}

      <div className="grid2">
        <div className="card">
          <h2>{t('view.teams', { n: tr.teams.length, max: tr.maxTeams })}</h2>
          <table>
            <tbody>
              {tr.teams.map((x) => (
                <tr key={x.id}>
                  <td>{x.seed ? `#${x.seed} ` : ''}{x.name}</td>
                  <td style={{ textAlign: 'right' }}>
                    {admin && tr.status === 'registration' && (
                      <button className="ghost" onClick={() => act(() => api(`/api/tournaments/${tr.id}/teams/${x.id}`, { method: 'DELETE' }))}>{t('view.removeTeam')}</button>
                    )}
                  </td>
                </tr>
              ))}
              {tr.teams.length === 0 && <tr><td className="muted">{t('view.noTeams')}</td></tr>}
            </tbody>
          </table>
          {tr.status === 'registration' && me.kind !== null && (
            selectable.length > 0 && chosen ? (
              <div style={{ marginTop: 12 }}>
                <label>{t('view.yourTeam')}
                  <select value={chosen.id} onChange={(e) => { setTeamId(Number(e.target.value)); setRoster([]); }}>
                    {selectable.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                </label>
                {chosen.members.length > tr.teamSize && (
                  <div style={{ marginTop: 8 }}>
                    <span className="muted">{t('view.roster', { n: tr.teamSize })}:</span>
                    {chosen.members.map((m) => (
                      <label key={m.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <input type="checkbox" checked={effectiveRoster.includes(m.id)}
                          onChange={(e) => setRoster(e.target.checked ? [...effectiveRoster, m.id] : effectiveRoster.filter((x) => x !== m.id))} />
                        {m.name}
                      </label>
                    ))}
                  </div>
                )}
                <p><button onClick={register}>{t('view.register')}</button></p>
              </div>
            ) : (
              <p className="muted">{admin ? t('view.adminNeedTeam') : t('view.needTeam', { n: tr.teamSize })}</p>
            )
          )}
        </div>
        <div className="card">
          <h2>{t('view.mapPool')}</h2>
          <div className="maps">
            {tr.maps.map((m, i) => (
              <div key={m.id} className="mapchip on">
                {m.imageUrl && <img className="thumb" src={m.imageUrl} alt="" />}
                <span>{i + 1}. {m.name}</span>
              </div>
            ))}
          </div>
          {admin && tr.status === 'registration' && (
            <div style={{ marginTop: 16 }}>
              <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={shuffle} onChange={(e) => setShuffle(e.target.checked)} />
                {t('view.randomSeeding')}
              </label>
              <p><button onClick={() => act(() => api(`/api/tournaments/${tr.id}/start`, { method: 'POST', body: { shuffle } }))}>{t('view.start')}</button></p>
            </div>
          )}
        </div>
      </div>

      {admin && tr.status === 'running' && (
        <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 }}>
          <input type="checkbox" checked={tr.autoDispatch}
            onChange={(e) => act(() => api(`/api/tournaments/${tr.id}/auto-dispatch`, { method: 'POST', body: { enabled: e.target.checked } }))} />
          {t('view.autoDispatch')}
        </label>
      )}

      {tr.status !== 'registration' && (
        <Bracket tr={tr} admin={admin} actions={{
          onResult: (code, scoreA, scoreB) => act(() => api(url(code, 'result'), { method: 'POST', body: { scoreA, scoreB } })),
          onWinner: (code, winner) => act(() => api(url(code, 'winner'), { method: 'POST', body: { winner } })),
          onUndo: (code) => act(() => api(url(code, 'undo'), { method: 'POST', body: {} })),
          onDispatch: (code) => act(() => api(url(code, 'dispatch'), { method: 'POST', body: {} })),
          onPause: (code, paused) => act(() => api(url(code, 'pause'), { method: 'POST', body: { paused } })),
          onRestartMap: (code) => act(() => api(url(code, 'restart-map'), { method: 'POST', body: {} })),
          onRestartMatch: (code) => act(() => api(url(code, 'restart-match'), { method: 'POST', body: {} })),
        }} />
      )}
    </>
  );
}
