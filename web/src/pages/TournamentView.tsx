import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, isAdmin, type Me, type Preview, type Team, type TournamentDetails } from '../api';
import { useI18n } from '../i18n';
import { ActionMenu } from '../components/ActionMenu';
import { IconDown, IconShuffle, IconTrophy, IconUp } from '../components/Icons';
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
    if (isAdmin(me)) {
      api<Team[]>('/api/admin/teams').then(setAllTeams).catch(() => undefined);
    } else if (me.kind === 'player') {
      api<Team[]>('/api/teams/mine').then((ts) => setMyTeams(ts.filter((x) => x.captainId === me.id))).catch(() => undefined);
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

  const admin = isAdmin(me);
  const registeredIds = new Set(tr.teams.map((x) => x.id));
  const selectable = (admin ? allTeams : myTeams).filter((x) => !registeredIds.has(x.id));
  const chosen = selectable.find((x) => x.id === teamId) ?? selectable[0];
  const effectiveRoster = roster.length > 0 ? roster : chosen?.members.slice(0, tr.teamSize).map((m) => m.id) ?? [];

  const mine = me.kind === 'player' ? tr.teams.find((x) => x.roster.includes(me.id)) : undefined;
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
    onRestoreRound: (code, round) => act(() => api(url(code, 'restore-round'), { method: 'POST', body: { round } })),
    onRestartMatch: (code) => act(() => api(url(code, 'restart-match'), { method: 'POST', body: {} })),
  } : undefined;

  const inReg = tr.status === 'registration';
  const teamsCard = (
    <div className="card">
      <h2>{t(tr.teamSize === 1 ? 'view.players' : 'view.teams', { n: tr.teams.length, max: tr.maxTeams })}</h2>
      <div className="plainlist">
        {tr.teams.map((x, i) => (
          <div key={x.id} className="plainrow">
            <span className="seed">{x.seed ?? ''}</span>
            <b className="grow">{x.name}</b>
            {admin && inReg && (
              <span className="rowactions">
                <button className="iconbtn" title={t('seeding.up')} aria-label={t('seeding.up')} disabled={i === 0} onClick={() => move(i, -1)}><IconUp /></button>
                <button className="iconbtn" title={t('seeding.down')} aria-label={t('seeding.down')} disabled={i === tr.teams.length - 1} onClick={() => move(i, 1)}><IconDown /></button>
                <button className="ghost small" onClick={() => act(() => api(`/api/tournaments/${tr.id}/teams/${x.id}`, { method: 'DELETE' }))}>{t('view.removeTeam')}</button>
              </span>
            )}
          </div>
        ))}
        {tr.teams.length === 0 && <div className="emptybox">{t('view.noTeams')}</div>}
      </div>
      {admin && inReg && tr.teams.length > 1 && (
        <div className="cardnote">
          <button className="ghost" onClick={() => act(() => api(`/api/tournaments/${tr.id}/seeding/shuffle`, { method: 'POST', body: {} }))}><IconShuffle />{t('seeding.shuffle')}</button>
          <span className="muted small">{t('seeding.hint')}</span>
        </div>
      )}
      {admin && inReg && tr.teams.length < tr.maxTeams && <NewTeamForm tr={tr} onDone={setTr} />}
      {inReg && me.kind === 'player' && tr.teamSize === 1 && (
        // 1v1: игрок участвует сам, команда не нужна
        mine ? (
          <div className="cardnote">
            <span className="muted">{t('view.soloJoined')}</span>
            <button className="ghost" onClick={() => act(() => api(`/api/tournaments/${tr.id}/teams/${mine.id}`, { method: 'DELETE' }))}>{t('view.soloLeave')}</button>
          </div>
        ) : (
          <div className="stack">
            <p className="muted flat">{t('view.soloHint')}</p>
            <div><button className="big" onClick={() => act(() => api(`/api/tournaments/${tr.id}/solo`, { method: 'POST', body: {} }))}>{t('view.soloJoin')}</button></div>
          </div>
        )
      )}
      {inReg && me.kind !== null && !(me.kind === 'player' && tr.teamSize === 1) && (
        selectable.length > 0 && chosen ? (
          <div className="stack">
            <label>{admin ? t('view.pickTeam') : t('view.yourTeam')}
              <select value={chosen.id} onChange={(e) => { setTeamId(Number(e.target.value)); setRoster([]); }}>
                {selectable.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </label>
            {chosen.members.length > tr.teamSize && (
              <div>
                <span className="muted">{t('view.roster', { n: tr.teamSize })}:</span>
                {chosen.members.map((m) => (
                  <label key={m.id} className="check">
                    <input type="checkbox" checked={effectiveRoster.includes(m.id)}
                      onChange={(e) => setRoster(e.target.checked ? [...effectiveRoster, m.id] : effectiveRoster.filter((x) => x !== m.id))} />
                    {m.name}
                  </label>
                ))}
              </div>
            )}
            <div><button className={admin ? 'ghost' : ''} onClick={register}>{t('view.register')}</button></div>
          </div>
        ) : (
          <p className="muted">{admin ? t('view.adminNeedTeam') : t('view.needTeam', { n: tr.teamSize })}</p>
        )
      )}
    </div>
  );

  const mapsCard = (
    <div className="card">
      <h2>{t('view.mapPool')}</h2>
      <div className="maps">
        {tr.maps.map((m, i) => (
          <div key={m.id} className="mapchip">
            {m.imageUrl && <img className="thumb" src={m.imageUrl} alt="" />}
            <span>{i + 1}. {m.name}</span>
          </div>
        ))}
      </div>
    </div>
  );

  const settings = admin && tr.status !== 'finished' && (
    <PausesEditor value={tr.pauses}
      onSave={(pauses) => act(() => api(`/api/tournaments/${tr.id}/pauses`, { method: 'PUT', body: pauses }))} />
  );
  const pausesNote = !admin && (
    <p className="muted">{t('pauses.summary', { tactical: tr.pauses.tactical, time: tr.pauses.tacticalTime, technical: tr.pauses.technical || '∞' })}</p>
  );

  return (
    <>
      <div className="pagehead tourhead">
        <div>
          <h1>{tr.name}</h1>
          <div className="sub">
            <span className={`pill ${tr.status}`}>{t(`status.${tr.status}`)}</span>
            <span>{t(`format.${tr.format}`)}</span>
            <span>{tr.teamSize}v{tr.teamSize}</span>
            {tr.teamSize <= 2 && <span>{t(tr.wingmanRounds === 24 ? 'form.rounds24' : 'form.rounds16')}</span>}
            <span>{t('view.upTo', { n: tr.maxTeams })}</span>
          </div>
        </div>
        <div className="headactions">
          {admin && tr.status === 'running' && (
            <label className="check">
              <input type="checkbox" checked={tr.autoDispatch}
                onChange={(e) => act(() => api(`/api/tournaments/${tr.id}/auto-dispatch`, { method: 'POST', body: { enabled: e.target.checked } }))} />
              {t('view.autoDispatch')}
            </label>
          )}
          {admin && inReg && <button onClick={() => act(() => api(`/api/tournaments/${tr.id}/start`, { method: 'POST', body: {} }))}>{t('view.start')}</button>}
          {admin && (
            <ActionMenu label={t('match.actions')}>
              <button className="menuitem dangertext" onClick={async () => { await api(`/api/tournaments/${tr.id}`, { method: 'DELETE' }); navigate('/tournaments'); }}>{t('common.delete')}</button>
            </ActionMenu>
          )}
        </div>
      </div>
      {tr.champion && <div className="champion"><IconTrophy /><span className="muted">{t('view.winner')}</span><b>{tr.champion.name}</b></div>}
      {error && <p className="error">{error}</p>}

      {inReg && (
        <>
          <div className="grid2">{teamsCard}{mapsCard}</div>
          {settings}
          {pausesNote}
          {(preview.groupAssignment || preview.matches.length > 0) && (
            <section className="section">
              <h2>{t('preview.title')}</h2>
              <p className="muted lead">{preview.groupAssignment ? t('preview.groupsHint') : t('preview.hint')}</p>
              {preview.groupAssignment
                ? <GroupAssignment groups={preview.groupAssignment} />
                : <BracketTree matches={preview.matches} format={tr.format} />}
            </section>
          )}
        </>
      )}
      {!inReg && (
        <>
          {tr.groups && <p className="muted lead">{t(`phase.${tr.groupConfig.phase}` as 'phase.groups')}</p>}
          {tr.matches.some((m) => m.stage === 'playoff') && <BracketTree title={tr.name} matches={tr.matches} format={tr.format} actions={actions} />}
          {admin && tr.groupConfig.phase === 'groups_done' && tr.groupConfig.hasPlayoff && <PlayoffPanel tr={tr} onDone={setTr} />}
          {admin && tr.groupConfig.stageMode === 'groups' && tr.groupConfig.phase === 'playoff' && (
            <p>
              <button className="ghost" onClick={() => confirm(t('playoff.confirmReset')) && act(() => api(`/api/tournaments/${tr.id}/playoff/reset`, { method: 'POST', body: {} }))}>
                {t('playoff.reset')}
              </button>
            </p>
          )}
          {tr.groups && <GroupsView tr={tr} actions={actions} />}
          <details className="fold">
            <summary>{t('view.details')}<IconDown /></summary>
            <div className="foldbody">
              <div className="grid2">{teamsCard}{mapsCard}</div>
              {settings}
              {pausesNote}
            </div>
          </details>
        </>
      )}
    </>
  );
}
