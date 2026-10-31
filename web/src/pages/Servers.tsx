import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type GameServer, type ServerStatus } from '../api';
import { useI18n } from '../i18n';

export function Servers() {
  const { t, err } = useI18n();
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
      setStatus((p) => ({ ...p, [id]: { online: false, error: { error: 'internal', params: { message: err(e) } }, panelMatch: null, lastError: null } }));
    }
  };

  const load = useCallback(() => {
    api<GameServer[]>('/api/servers').then(setServers).catch((e) => setError(err(e)));
  }, [err]);
  useEffect(load, [load]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await api('/api/servers', { method: 'POST', body: { name, host, port: Number(port), rconPassword: rcon } });
      setName('');
      setRcon('');
      load();
    } catch (e2) {
      setError(err(e2));
    }
  };

  const remove = async (id: number) => {
    setError('');
    try {
      await api(`/api/servers/${id}`, { method: 'DELETE' });
      load();
    } catch (e) {
      setError(err(e));
    }
  };

  return (
    <>
      <h1>{t('servers.title')}</h1>
      <p className="muted">{t('servers.hint')}</p>
      <form className="card row" onSubmit={add}>
        <label>{t('servers.name')}<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
        <label>{t('servers.address')}<input value={host} onChange={(e) => setHost(e.target.value)} required /></label>
        <label>{t('servers.port')}<input type="number" value={port} onChange={(e) => setPort(e.target.value)} required style={{ width: 90 }} /></label>
        <label>{t('servers.rcon')}<input type="password" value={rcon} onChange={(e) => setRcon(e.target.value)} required /></label>
        <button type="submit">{t('common.add')}</button>
      </form>
      {error && <p className="error">{error}</p>}
      <div className="card">
        <table>
          <thead><tr><th>{t('servers.name')}</th><th>{t('servers.address')}</th><th>{t('servers.state')}</th><th /></tr></thead>
          <tbody>
            {servers.map((s) => {
              const st = status[s.id];
              return (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>{s.host}:{s.port}</td>
                  <td>
                    {st === 'loading' && <span className="muted">{t('servers.checking')}</span>}
                    {st && st !== 'loading' && (st.online
                      ? <span>{t('servers.online', { state: st.gamestate ?? '' })}{st.panelMatch ? ` · ${t('servers.matchOn', { code: st.panelMatch.code })}` : ` · ${t('servers.free')}`}</span>
                      : <span className="error">{t('servers.unreachable', { error: err(st.error) })}</span>)}
                    {st && st !== 'loading' && st.lastError && <div className="muted">{t('servers.lastError', { error: err(st.lastError) })}</div>}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <button className="ghost" onClick={() => check(s.id)}>{t('servers.check')}</button>{' '}
                    <button className="danger" onClick={() => remove(s.id)}>{t('common.delete')}</button>
                  </td>
                </tr>
              );
            })}
            {servers.length === 0 && <tr><td colSpan={4} className="muted">{t('servers.empty')}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
