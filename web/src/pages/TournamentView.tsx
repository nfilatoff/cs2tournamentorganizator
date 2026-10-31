import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, type EntryDto, type MatchDto, type Me, type Team, type TournamentDetails } from '../api';
import { FORMAT_LABEL, STATUS_LABEL } from './Tournaments';

const BRACKET_TITLE = { W: 'Верхняя сетка', L: 'Нижняя сетка', GF: 'Гранд-финал' } as const;

function Slot({ entry, score, won }: { entry: EntryDto; score: number; won: boolean }) {
  const text = entry.type === 'team' ? entry.name : entry.type === 'bye' ? 'bye' : 'ожидается';
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
  const [a, setA] = useState(0);
  const [b, setB] = useState(0);
  const need = Math.ceil(m.bestOf / 2);
  const inPlay = m.status === 'ready' || m.status === 'live';
  return (
    <div className={`match ${m.status}`}>
      <div className="mhead"><span>{m.code}</span><span>{m.forced ? 'решение админа' : `BO${m.bestOf}`}</span></div>
      <Slot entry={m.a} score={m.status === 'live' ? m.seriesA ?? 0 : m.scoreA} won={m.winner === 'a' && m.status === 'done'} />
      <Slot entry={m.b} score={m.status === 'live' ? m.seriesB ?? 0 : m.scoreB} won={m.winner === 'b' && m.status === 'done'} />
      {m.status === 'live' && (
        <div className="livebox">
          <div>
            {m.live
              ? <>Идёт: <b>{m.curMap?.name ?? 'карта'}</b> {m.curMap?.scoreA}:{m.curMap?.scoreB}{m.paused && ' · пауза'}</>
              : 'Ожидание игроков на сервере'}
          </div>
          {m.server && <div>Сервер: <b>{m.server.name}</b>, <code>connect {m.server.host}:{m.server.port}</code></div>}
        </div>
      )}
      {m.status === 'done' && m.playedMaps && m.playedMaps.length > 0 && (
        <div className="livebox muted">{m.playedMaps.map((p) => `${p.name ?? 'карта'} ${p.scoreA}:${p.scoreB}`).join(' · ')}</div>
      )}
      {admin && m.note && <div className="livebox error">{m.note}</div>}
      {admin && m.status === 'ready' && (
        <div className="result">
          <button onClick={() => actions.onDispatch(m.code)}>Запустить на сервере</button>
        </div>
      )}
      {admin && m.status === 'live' && (
        <div className="result wrap">
          <button className="ghost" onClick={() => actions.onPause(m.code, !m.paused)}>{m.paused ? 'Снять паузу' : 'Пауза'}</button>
          {m.live && <button className="ghost" onClick={() => confirm('Переиграть текущую карту с первого раунда?') && actions.onRestartMap(m.code)}>Переиграть карту</button>}
          <button className="ghost" onClick={() => confirm('Переиграть матч целиком? Счёт серии сбросится.') && actions.onRestartMatch(m.code)}>Переиграть матч</button>
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
            <span className="muted">Победа:</span>
            <button className="ghost" onClick={() => actions.onWinner(m.code, 'a')}>A</button>
            <button className="ghost" onClick={() => actions.onWinner(m.code, 'b')}>B</button>
          </div>
        </>
      )}
      {admin && m.status === 'done' && (
        <div className="result">
          <button className="ghost" onClick={() => actions.onUndo(m.code)}>Отменить результат</button>
        </div>
      )}
    </div>
  );
}

function Bracket({ t, admin, actions }: { t: TournamentDetails; admin: boolean; actions: Actions }) {
  const visible = t.matches.filter((m) => m.status !== 'bye' && m.status !== 'skipped');
  return (
    <>
      {(['W', 'L', 'GF'] as const).map((br) => {
        const ms = visible.filter((m) => m.bracket === br);
        if (ms.length === 0) return null;
        const rounds = [...new Set(ms.map((m) => m.round))].sort((x, y) => x - y);
        return (
          <div className="card" key={br}>
            <h2>{t.format === 'single' && br === 'W' ? 'Сетка' : BRACKET_TITLE[br]}</h2>
            <div className="bracket">
              {rounds.map((r) => {
                const col = ms.filter((m) => m.round === r);
                return (
                  <div className="col" key={r}>
                    <div className="roundname">{col[0]!.roundLabel}</div>
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
  const { id } = useParams();
  const navigate = useNavigate();
  const [t, setT] = useState<TournamentDetails | null>(null);
  const [myTeams, setMyTeams] = useState<Team[]>([]);
  const [teamId, setTeamId] = useState<number | null>(null);
  const [roster, setRoster] = useState<number[]>([]);
  const [shuffle, setShuffle] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api<TournamentDetails>(`/api/tournaments/${id}`).then(setT).catch((e: Error) => setError(e.message));
  }, [id]);
  useEffect(load, [load]);

  // Пока турнир идёт, обновляем состояние матчей (счёт, серверы)
  const running = t?.status === 'running';
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [running, load]);

  useEffect(() => {
    if (me.kind !== 'player') return;
    api<Team[]>('/api/teams/mine').then((ts) => setMyTeams(ts.filter((x) => x.captainId === me.id))).catch(() => undefined);
  }, [me]);

  const act = async (fn: () => Promise<TournamentDetails | unknown>) => {
    setError('');
    try {
      const res = await fn();
      if (res && typeof res === 'object' && 'matches' in res) setT(res as TournamentDetails);
      else load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (!t) return error ? <p className="error">{error}</p> : null;

  const admin = me.kind === 'admin';
  const registeredIds = new Set(t.teams.map((x) => x.id));
  const selectable = myTeams.filter((x) => !registeredIds.has(x.id));
  const chosen = selectable.find((x) => x.id === teamId) ?? selectable[0];
  const effectiveRoster = roster.length > 0 ? roster : chosen?.members.slice(0, t.teamSize).map((m) => m.id) ?? [];

  const register = () => chosen && act(() => api(`/api/tournaments/${t.id}/teams`, {
    method: 'POST', body: { teamId: chosen.id, playerIds: effectiveRoster },
  }));

  return (
    <>
      <div className="between">
        <h1>{t.name}</h1>
        {admin && <button className="danger" onClick={async () => { await api(`/api/tournaments/${t.id}`, { method: 'DELETE' }); navigate('/tournaments'); }}>Удалить</button>}
      </div>
      <p className="muted">
        {FORMAT_LABEL[t.format]}, {t.teamSize}v{t.teamSize}, до {t.maxTeams} команд · {STATUS_LABEL[t.status]}
      </p>
      {t.champion && <div className="card champion">🏆 Победитель: <b>{t.champion.name}</b></div>}
      {error && <p className="error">{error}</p>}

      <div className="grid2">
        <div className="card">
          <h2>Команды ({t.teams.length}/{t.maxTeams})</h2>
          <table>
            <tbody>
              {t.teams.map((x) => (
                <tr key={x.id}>
                  <td>{x.seed ? `#${x.seed} ` : ''}{x.name}</td>
                  <td style={{ textAlign: 'right' }}>
                    {admin && t.status === 'registration' && (
                      <button className="ghost" onClick={() => act(() => api(`/api/tournaments/${t.id}/teams/${x.id}`, { method: 'DELETE' }))}>Снять</button>
                    )}
                  </td>
                </tr>
              ))}
              {t.teams.length === 0 && <tr><td className="muted">Заявок пока нет</td></tr>}
            </tbody>
          </table>
          {t.status === 'registration' && me.kind === 'player' && (
            selectable.length > 0 && chosen ? (
              <div style={{ marginTop: 12 }}>
                <label>Ваша команда
                  <select value={chosen.id} onChange={(e) => { setTeamId(Number(e.target.value)); setRoster([]); }}>
                    {selectable.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                </label>
                {chosen.members.length > t.teamSize && (
                  <div style={{ marginTop: 8 }}>
                    <span className="muted">Состав ({t.teamSize}):</span>
                    {chosen.members.map((m) => (
                      <label key={m.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <input type="checkbox" checked={effectiveRoster.includes(m.id)}
                          onChange={(e) => setRoster(e.target.checked ? [...effectiveRoster, m.id] : effectiveRoster.filter((x) => x !== m.id))} />
                        {m.name}
                      </label>
                    ))}
                  </div>
                )}
                <p><button onClick={register}>Зарегистрировать команду</button></p>
              </div>
            ) : (
              <p className="muted">Чтобы участвовать, создайте команду на странице «Команды» (в ней должно быть {t.teamSize} игрок(а)).</p>
            )
          )}
        </div>
        <div className="card">
          <h2>Пул карт</h2>
          <div className="maps">
            {t.maps.map((m, i) => (
              <div key={m.id} className="mapchip on">
                {m.imageUrl && <img className="thumb" src={m.imageUrl} alt="" />}
                <span>{i + 1}. {m.name}</span>
              </div>
            ))}
          </div>
          {admin && t.status === 'registration' && (
            <div style={{ marginTop: 16 }}>
              <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <input type="checkbox" checked={shuffle} onChange={(e) => setShuffle(e.target.checked)} />
                Случайный посев
              </label>
              <p><button onClick={() => act(() => api(`/api/tournaments/${t.id}/start`, { method: 'POST', body: { shuffle } }))}>Начать турнир</button></p>
            </div>
          )}
        </div>
      </div>

      {admin && t.status === 'running' && (
        <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 }}>
          <input type="checkbox" checked={t.autoDispatch}
            onChange={(e) => act(() => api(`/api/tournaments/${t.id}/auto-dispatch`, { method: 'POST', body: { enabled: e.target.checked } }))} />
          Автозапуск матчей на свободных серверах
        </label>
      )}

      {t.status !== 'registration' && (
        <Bracket t={t} admin={admin} actions={{
          onResult: (code, scoreA, scoreB) => act(() => api(`/api/tournaments/${t.id}/matches/${code}/result`, { method: 'POST', body: { scoreA, scoreB } })),
          onWinner: (code, winner) => act(() => api(`/api/tournaments/${t.id}/matches/${code}/winner`, { method: 'POST', body: { winner } })),
          onUndo: (code) => act(() => api(`/api/tournaments/${t.id}/matches/${code}/undo`, { method: 'POST', body: {} })),
          onDispatch: (code) => act(() => api(`/api/tournaments/${t.id}/matches/${code}/dispatch`, { method: 'POST', body: {} })),
          onPause: (code, paused) => act(() => api(`/api/tournaments/${t.id}/matches/${code}/pause`, { method: 'POST', body: { paused } })),
          onRestartMap: (code) => act(() => api(`/api/tournaments/${t.id}/matches/${code}/restart-map`, { method: 'POST', body: {} })),
          onRestartMatch: (code) => act(() => api(`/api/tournaments/${t.id}/matches/${code}/restart-match`, { method: 'POST', body: {} })),
        }} />
      )}
    </>
  );
}
