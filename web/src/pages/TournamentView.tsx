import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, type Me, type Preview, type Team, type TournamentDetails } from '../api';
import { useI18n } from '../i18n';
import { BracketTree } from '../components/BracketTree';
import type { MatchActions } from '../components/MatchCard';
import { GroupAssignment, GroupsView, PlayoffPanel } from '../components/GroupsView';
import { NewTeamForm } from '../components/NewTeamForm';
import { PausesEditor } from '../components/PauseFields';

export function TournamentView({ me }: { me: Me }) {
  const { t, err } = useI18n();
  const { id } = useParams();
  const navigate = useNavigate();
  const [tr, setTr] = useState<TournamentDetails | null>(null);
  const [preview, setPreview] = useState<Preview>({ matches: [] });
  const [myTeams, setMyTeams] = useState<Team[]>([]);
  const [allTeams, setAllTeams] = useState<Team[]>([]);
  const [teamId, setTeamId] = useState<number | null>(null);
  const [roster, setRoster] = useState<number[]>([]);
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

  // До старта показываем, как сетка выглядит при текущей рассадке
  const seedKey = tr ? tr.teams.map((x) => `${x.id}:${x.seed}`).join(',') : '';
  const inRegistration = tr?.status === 'registration';
  useEffect(() => {
    if (!inRegistration) return;
    api<Preview>(`/api/tournaments/${id}/preview`).then(setPreview).catch(() => setPreview({ matches: [] }));
  }, [id, inRegistration, seedKey]);

  const act = async (fn: () => Promise<TournamentDetails | unknown>) => {
    setError('');
    try {
      const res = await fn();
      if (res && typeof res === 'object' && 'matches' in res && 'teams' in res) setTr(res as TournamentDetails);
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

  const move = (index: number, delta: number) => {
    const order = tr.teams.map((x) => x.id);
    const j = index + delta;
    if (j < 0 || j >= order.length) return;
    [order[index], order[j]] = [order[j]!, order[index]!];
    void act(() => api(`/api/tournaments/${tr.id}/seeding`, { method: 'PUT', body: { order } }));
  };

  const actions: MatchActions | undefined = admin ? {
    onResult: (code, scoreA, scoreB) => act(() => api(url(code, 'result'), { method: 'POST', body: { scoreA, scoreB } })),
    onWinner: (code, winner) => act(() => api(url(code, 'winner'), { method: 'POST', body: { winner } })),
    onUndo: (code) => act(() => api(url(code, 'undo'), { method: 'POST', body: {} })),
    onDispatch: (code) => act(() => api(url(code, 'dispatch'), { method: 'POST', body: {} })),
    onPause: (code, paused) => act(() => api(url(code, 'pause'), { method: 'POST', body: { paused } })),
    onRestartMap: (code) => act(() => api(url(code, 'restart-map'), { method: 'POST', body: {} })),
    onRestartMatch: (code) => act(() => api(url(code, 'restart-match'), { method: 'POST', body: {} })),
  } : undefined;

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
              {tr.teams.map((x, i) => (
                <tr key={x.id}>
                  <td>{x.seed ? `#${x.seed} ` : ''}{x.name}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {admin && tr.status === 'registration' && (
                      <>
                        <button className="ghost" title={t('seeding.up')} disabled={i === 0} onClick={() => move(i, -1)}>▲</button>{' '}
                        <button className="ghost" title={t('seeding.down')} disabled={i === tr.teams.length - 1} onClick={() => move(i, 1)}>▼</button>{' '}
                        <button className="ghost" onClick={() => act(() => api(`/api/tournaments/${tr.id}/teams/${x.id}`, { method: 'DELETE' }))}>{t('view.removeTeam')}</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {tr.teams.length === 0 && <tr><td className="muted">{t('view.noTeams')}</td></tr>}
            </tbody>
          </table>
          {admin && tr.status === 'registration' && tr.teams.length < tr.maxTeams && <NewTeamForm tr={tr} onDone={setTr} />}
          {admin && tr.status === 'registration' && tr.teams.length > 1 && (
            <p>
              <button className="ghost" onClick={() => act(() => api(`/api/tournaments/${tr.id}/seeding/shuffle`, { method: 'POST', body: {} }))}>🎲 {t('seeding.shuffle')}</button>
              <span className="muted"> {t('seeding.hint')}</span>
            </p>
          )}
          {tr.status === 'registration' && me.kind !== null && (
            selectable.length > 0 && chosen ? (
              <div style={{ marginTop: 12 }}>
                <label>{admin ? t('view.pickTeam') : t('view.yourTeam')}
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
            <p style={{ marginTop: 16 }}><button onClick={() => act(() => api(`/api/tournaments/${tr.id}/start`, { method: 'POST', body: {} }))}>{t('view.start')}</button></p>
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

      {admin && tr.status !== 'finished' && (
        <PausesEditor value={tr.pauses}
          onSave={(pauses) => act(() => api(`/api/tournaments/${tr.id}/pauses`, { method: 'PUT', body: pauses }))} />
      )}
      {!admin && (
        <p className="muted">{t('pauses.summary', { tactical: tr.pauses.tactical, time: tr.pauses.tacticalTime, technical: tr.pauses.technical || '∞' })}</p>
      )}

      {tr.status === 'registration' && (preview.groupAssignment || preview.matches.length > 0) && (
        <>
          <h2>{t('preview.title')}</h2>
          <p className="muted">{preview.groupAssignment ? t('preview.groupsHint') : t('preview.hint')}</p>
          {preview.groupAssignment
            ? <GroupAssignment groups={preview.groupAssignment} />
            : <BracketTree matches={preview.matches} format={tr.format} />}
        </>
      )}
      {tr.status !== 'registration' && (
        <>
          {tr.groups && <p className="muted">{t(`phase.${tr.groupConfig.phase}` as 'phase.groups')}</p>}
          {tr.groups && <GroupsView tr={tr} actions={actions} />}
          {admin && tr.groupConfig.phase === 'groups_done' && tr.groupConfig.hasPlayoff && <PlayoffPanel tr={tr} onDone={setTr} />}
          {admin && tr.groupConfig.stageMode === 'groups' && tr.groupConfig.phase === 'playoff' && (
            <p>
              <button className="ghost" onClick={() => confirm(t('playoff.confirmReset')) && act(() => api(`/api/tournaments/${tr.id}/playoff/reset`, { method: 'POST', body: {} }))}>
                {t('playoff.reset')}
              </button>
            </p>
          )}
          {tr.matches.some((m) => m.stage === 'playoff') && <BracketTree matches={tr.matches} format={tr.format} actions={actions} />}
        </>
      )}
    </>
  );
}
