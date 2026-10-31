import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type Me, type Team } from '../api';

export function Teams({ me }: { me: Me }) {
  const [teams, setTeams] = useState<Team[]>([]);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api<Team[]>('/api/teams/mine').then(setTeams).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const create = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api('/api/teams', { method: 'POST', body: { name } });
      setName('');
    });
  };
  const join = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api('/api/teams/join', { method: 'POST', body: { code } });
      setCode('');
    });
  };

  if (me.kind !== 'player') return <p className="muted">Команды создают игроки, вошедшие через Steam.</p>;

  return (
    <>
      <h1>Мои команды</h1>
      <div className="grid2">
        <form className="card row" onSubmit={create}>
          <label style={{ flex: 1 }}>Создать команду<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Название" required /></label>
          <button type="submit">Создать</button>
        </form>
        <form className="card row" onSubmit={join}>
          <label style={{ flex: 1 }}>Вступить по коду<input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Код от капитана" required /></label>
          <button type="submit">Вступить</button>
        </form>
      </div>
      {error && <p className="error">{error}</p>}
      {teams.map((t) => {
        const isCaptain = t.captainId === me.id;
        return (
          <div className="card" key={t.id}>
            <h2>{t.name}</h2>
            <p className="muted">Код приглашения: <code>{t.joinCode}</code></p>
            <table>
              <tbody>
                {t.members.map((m) => (
                  <tr key={m.id}>
                    <td>{m.name}{m.id === t.captainId && ' (капитан)'}</td>
                    <td style={{ textAlign: 'right' }}>
                      {isCaptain && m.id !== t.captainId && (
                        <button className="ghost" onClick={() => run(() => api(`/api/teams/${t.id}/kick`, { method: 'POST', body: { playerId: m.id } }))}>Исключить</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              <button className="ghost" onClick={() => run(() => api(`/api/teams/${t.id}/leave`, { method: 'POST', body: {} }))}>Покинуть</button>{' '}
              {isCaptain && <button className="danger" onClick={() => run(() => api(`/api/teams/${t.id}`, { method: 'DELETE' }))}>Удалить команду</button>}
            </p>
          </div>
        );
      })}
      {teams.length === 0 && <p className="muted">У вас пока нет команд.</p>}
    </>
  );
}
