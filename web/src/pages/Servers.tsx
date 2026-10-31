import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type GameServer, type ServerStatus } from '../api';

export function Servers() {
  const [servers, setServers] = useState<GameServer[]>([]);
  const [name, setName] = useState('');
  const [host, setHost] = useState('127.0.0.1');
  const [port, setPort] = useState('27015');
  const [rcon, setRcon] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState<Record<number, ServerStatus | 'loading'>>({});

  const check = async (id: number) => {
    setStatus((p) => ({ ...p, [id]: 'loading' }));
    try {
      const st = await api<ServerStatus>(`/api/servers/${id}/status`);
      setStatus((p) => ({ ...p, [id]: st }));
    } catch (e) {
      setStatus((p) => ({ ...p, [id]: { online: false, error: (e as Error).message, panelMatch: null, lastError: null } }));
    }
  };

  const load = useCallback(() => {
    api<GameServer[]>('/api/servers').then(setServers).catch((e: Error) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api('/api/servers', { method: 'POST', body: { name, host, port: Number(port), rconPassword: rcon } });
      setName('');
      setRcon('');
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const remove = async (id: number) => {
    await api(`/api/servers/${id}`, { method: 'DELETE' });
    load();
  };

  return (
    <>
      <h1>Серверы CS2</h1>
      <form className="card row" onSubmit={add}>
        <label>Название<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
        <label>Адрес<input value={host} onChange={(e) => setHost(e.target.value)} required /></label>
        <label>Порт<input type="number" value={port} onChange={(e) => setPort(e.target.value)} required style={{ width: 90 }} /></label>
        <label>RCON-пароль<input type="password" value={rcon} onChange={(e) => setRcon(e.target.value)} required /></label>
        <button type="submit">Добавить</button>
      </form>
      {error && <p className="error">{error}</p>}
      <div className="card">
        <table>
          <thead><tr><th>Название</th><th>Адрес</th><th>Состояние</th><th /></tr></thead>
          <tbody>
            {servers.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>{s.host}:{s.port}</td>
                <td>
                  {status[s.id] === 'loading' && <span className="muted">проверка…</span>}
                  {status[s.id] && status[s.id] !== 'loading' && (() => {
                    const st = status[s.id] as ServerStatus;
                    return st.online
                      ? <span>онлайн · {st.gamestate}{st.panelMatch ? ` · матч ${st.panelMatch.code}` : ' · свободен'}</span>
                      : <span className="error">недоступен: {st.error}</span>;
                  })()}
                </td>
                <td style={{ textAlign: 'right' }}><button className="ghost" onClick={() => check(s.id)}>Проверить</button>{' '}<button className="danger" onClick={() => remove(s.id)}>Удалить</button></td>
              </tr>
            ))}
            {servers.length === 0 && <tr><td colSpan={4} className="muted">Серверов пока нет</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
