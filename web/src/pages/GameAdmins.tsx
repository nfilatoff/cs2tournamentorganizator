import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api';
import { useI18n } from '../i18n';

type Role = 'full' | 'prac';
// Права в панели при входе через Steam: 0 — нет, 1 — админ панели, 2 — полный админ
type Panel = 0 | 1 | 2;
const PANEL_LEVELS: Panel[] = [0, 1, 2];

interface GameAdminsDto {
  admins: { steamId: string; name: string; role: Role; panel: Panel }[];
  canManage: boolean;
  serverCode: string;
  players: { steamId: string; name: string }[];
  sync?: { file: string | null; reloaded: string[]; failed: string[] };
}

// Админы ArenaPro на игровых серверах и их права в панели. Менять список может только полный админ, остальные его видят.
export function GameAdmins() {
  const { t, err } = useI18n();
  const [d, setD] = useState<GameAdminsDto | null>(null);
  const [steamId, setSteamId] = useState('');
  const [role, setRole] = useState<Role>('full');
  const [panel, setPanel] = useState<Panel>(0);
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
  const save = (body: { steamId: string; role: Role; panel?: Panel }) =>
    run(() => api<GameAdminsDto>('/api/game-admins', { method: 'POST', body }));

  const add = async (e: FormEvent) => {
    e.preventDefault();
    // Игрок, выбранный из списка, приходит как «ник (SteamID)»
    const id = steamId.match(/7656119\d{10}/)?.[0] ?? steamId.trim();
    if (await save({ steamId: id, role, panel })) setSteamId('');
  };

  if (!d) return error ? <p className="error">{error}</p> : null;
  const sync = d.sync;
  const roleText = (r: Role) => (r === 'full' ? t('gadmins.role.full') : t('gadmins.role.prac'));
  const panelText = (p: Panel) => t(`gadmins.panel.${p}`);

  return (
    <>
      <div className="pagehead">
        <div>
          <h1>{t('gadmins.title')}</h1>
          <div className="sub">{t('gadmins.hint')}</div>
          <div className="sub">{t('gadmins.levels')}</div>
        </div>
        {d.canManage && (
          <button className="ghost" onClick={() => run(() => api<GameAdminsDto>('/api/game-admins/sync', { method: 'POST', body: {} }))}>{t('gadmins.sync')}</button>
        )}
      </div>

      {d.canManage ? (
        <form className="card row" onSubmit={add}>
          <label style={{ flex: 1, minWidth: 260 }}>{t('gadmins.steamId')}
            <input list="gadmins-players" value={steamId} onChange={(e) => setSteamId(e.target.value)} placeholder="7656119…" required />
            <datalist id="gadmins-players">
              {d.players.map((p) => <option key={p.steamId} value={`${p.name} (${p.steamId})`} />)}
            </datalist>
          </label>
          <label>{t('gadmins.role')}
            <select value={panel === 2 ? 'full' : role} disabled={panel === 2} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="full">{t('gadmins.role.full')}</option>
              <option value="prac">{t('gadmins.role.prac')}</option>
            </select>
          </label>
          <label>{t('gadmins.panel')}
            <select value={panel} onChange={(e) => setPanel(Number(e.target.value) as Panel)}>
              {PANEL_LEVELS.map((p) => <option key={p} value={p}>{panelText(p)}</option>)}
            </select>
          </label>
          <button type="submit">{t('gadmins.add')}</button>
        </form>
      ) : (
        <p className="muted">{t('gadmins.readOnly')}</p>
      )}
      {error && <p className="error">{error}</p>}

      <div className="card">
        <h2>{t('gadmins.codeTitle')}</h2>
        <p className="muted" style={{ marginTop: 0 }}>{t('gadmins.codeHint')}</p>
        <div className="mconnect">
          <code>arenapro_auth {d.serverCode}</code>
          {d.canManage && (
            <button className="ghost" onClick={() => confirm(t('gadmins.confirmNewCode'))
              && run(() => api<GameAdminsDto>('/api/game-admins/code', { method: 'POST', body: {} }))}>{t('gadmins.newCode')}</button>
          )}
        </div>
      </div>

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
          <thead>
            <tr><th>{t('gadmins.player')}</th><th>SteamID64</th><th>{t('gadmins.role')}</th><th>{t('gadmins.panelShort')}</th>{d.canManage && <th />}</tr>
          </thead>
          <tbody>
            {d.admins.map((a) => (
              <tr key={a.steamId}>
                <td>{a.name || <span className="muted">—</span>}</td>
                <td><code>{a.steamId}</code></td>
                <td>
                  {d.canManage ? (
                    <select value={a.role} disabled={a.panel === 2} onChange={(e) => save({ steamId: a.steamId, role: e.target.value as Role })}>
                      <option value="full">{t('gadmins.role.full')}</option>
                      <option value="prac">{t('gadmins.role.prac')}</option>
                    </select>
                  ) : roleText(a.role)}
                </td>
                <td>
                  {d.canManage ? (
                    <select value={a.panel} onChange={(e) => save({ steamId: a.steamId, role: a.role, panel: Number(e.target.value) as Panel })}>
                      {PANEL_LEVELS.map((p) => <option key={p} value={p}>{panelText(p)}</option>)}
                    </select>
                  ) : panelText(a.panel)}
                </td>
                {d.canManage && (
                  <td className="actions">
                    <button className="danger" onClick={() => confirm(t('gadmins.confirmRemove', { name: a.name || a.steamId }))
                      && run(() => api<GameAdminsDto>(`/api/game-admins/${a.steamId}`, { method: 'DELETE' }))}>{t('common.delete')}</button>
                  </td>
                )}
              </tr>
            ))}
            {d.admins.length === 0 && <tr><td colSpan={5} className="muted">{t('gadmins.empty')}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
