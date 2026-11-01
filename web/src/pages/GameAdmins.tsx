import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { useI18n } from '../i18n';

type Role = 'full' | 'prac';

interface GameAdminsDto {
  admins: { steamId: string; name: string; role: Role }[];
  players: { steamId: string; name: string }[];
  sync?: { file: string | null; reloaded: string[]; failed: string[] };
}

// Админы ArenaPro на игровых серверах: кто может включать тренировку, менять карту и управлять матчем в игре
export function GameAdmins() {
  const { t, err } = useI18n();
  const [d, setD] = useState<GameAdminsDto | null>(null);
  const [steamId, setSteamId] = useState('');
  const [role, setRole] = useState<Role>('full');
  const [error, setError] = useState('');

  useEffect(() => {
    api<GameAdminsDto>('/api/game-admins').then(setD).catch((e) => setError(err(e)));
  }, [err]);

  const run = async (fn: () => Promise<GameAdminsDto>): Promise<boolean> => {
    setError('');
    try {
      setD(await fn());
      return true;
    } catch (e) {
      setError(err(e));
      return false;
    }
  };

  const add = async (e: FormEvent) => {
    e.preventDefault();
    // Игрок, выбранный из списка, приходит как «ник (SteamID)»
    const id = steamId.match(/7656119\d{10}/)?.[0] ?? steamId.trim();
    if (await run(() => api<GameAdminsDto>('/api/game-admins', { method: 'POST', body: { steamId: id, role } }))) setSteamId('');
  };
  const setAdminRole = (id: string, r: string) => run(() => api<GameAdminsDto>('/api/game-admins', { method: 'POST', body: { steamId: id, role: r } }));

  if (!d) return error ? <p className="error">{error}</p> : null;
  const sync = d.sync;

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>{t('gadmins.title')}</h1>
          <div className="sub">{t('gadmins.hint')}</div>
        </div>
        <button className="ghost" onClick={() => run(() => api<GameAdminsDto>('/api/game-admins/sync', { method: 'POST', body: {} }))}>{t('gadmins.sync')}</button>
      </div>

      <form className="card row" onSubmit={add}>
        <label style={{ flex: 1, minWidth: 260 }}>{t('gadmins.steamId')}
          <input list="gadmins-players" value={steamId} onChange={(e) => setSteamId(e.target.value)} placeholder="7656119…" required />
          <datalist id="gadmins-players">
            {d.players.map((p) => <option key={p.steamId} value={`${p.name} (${p.steamId})`} />)}
          </datalist>
        </label>
        <label>{t('gadmins.role')}
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="full">{t('gadmins.role.full')}</option>
            <option value="prac">{t('gadmins.role.prac')}</option>
          </select>
        </label>
        <button type="submit">{t('gadmins.add')}</button>
      </form>
      {error && <p className="error">{error}</p>}

      {sync && (
        <div className="card">
          {sync.file
            ? <p style={{ marginTop: 0 }}>{t('gadmins.written')} <code>{sync.file}</code></p>
            : <p className="error" style={{ marginTop: 0 }}>{t('gadmins.noFolder')}</p>}
          {sync.reloaded.length > 0 && <p className="muted small">{t('gadmins.reloaded', { list: sync.reloaded.join(', ') })}</p>}
          {sync.failed.length > 0 && <p className="muted small" style={{ marginBottom: 0 }}>{t('gadmins.offline', { list: sync.failed.join(', ') })}</p>}
        </div>
      )}

      <div className="card tablewrap">
        <table>
          <thead><tr><th>{t('gadmins.player')}</th><th>SteamID64</th><th>{t('gadmins.role')}</th><th /></tr></thead>
          <tbody>
            {d.admins.map((a) => (
              <tr key={a.steamId}>
                <td>{a.name || <span className="muted">—</span>}</td>
                <td><code>{a.steamId}</code></td>
                <td>
                  <select value={a.role} onChange={(e) => setAdminRole(a.steamId, e.target.value)}>
                    <option value="full">{t('gadmins.role.full')}</option>
                    <option value="prac">{t('gadmins.role.prac')}</option>
                  </select>
                </td>
                <td className="actions">
                  <button className="danger" onClick={() => confirm(t('gadmins.confirmRemove', { name: a.name || a.steamId }))
                    && run(() => api<GameAdminsDto>(`/api/game-admins/${a.steamId}`, { method: 'DELETE' }))}>{t('common.delete')}</button>
                </td>
              </tr>
            ))}
            {d.admins.length === 0 && <tr><td colSpan={4} className="muted">{t('gadmins.empty')}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
