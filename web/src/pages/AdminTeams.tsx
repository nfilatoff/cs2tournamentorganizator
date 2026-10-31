import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type Team } from '../api';
import { useI18n } from '../i18n';

interface PlayerRow { steamId: string; name: string }
const emptyRow = (): PlayerRow => ({ steamId: '', name: '' });

export function AdminTeams() {
  const { t, err } = useI18n();
  const [teams, setTeams] = useState<Team[]>([]);
  const [name, setName] = useState('');
  const [rows, setRows] = useState<PlayerRow[]>([emptyRow(), emptyRow()]);
  const [adding, setAdding] = useState<Record<number, PlayerRow>>({});
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api<Team[]>('/api/admin/teams').then(setTeams).catch((e) => setError(err(e)));
  }, [err]);
  useEffect(load, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
      load();
    } catch (e) {
      setError(err(e));
    }
  };

  const setRow = (i: number, patch: Partial<PlayerRow>) =>
    setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const create = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await api('/api/admin/teams', { method: 'POST', body: { name, players: rows } });
      setName('');
      setRows([emptyRow(), emptyRow()]);
    });
  };

  const addMember = (teamId: number) => {
    const row = adding[teamId] ?? emptyRow();
    void run(async () => {
      await api(`/api/admin/teams/${teamId}/members`, { method: 'POST', body: row });
      setAdding((a) => ({ ...a, [teamId]: emptyRow() }));
    });
  };

  return (
    <>
      <h1>{t('adminTeams.title')}</h1>
      <p className="muted">{t('adminTeams.hint')}</p>

      <form className="card" onSubmit={create}>
        <h2>{t('adminTeams.create')}</h2>
        <label>{t('common.name')}<input value={name} onChange={(e) => setName(e.target.value)} required style={{ maxWidth: 320 }} /></label>
        <p className="muted">{t('adminTeams.captainHint')}</p>
        {rows.map((r, i) => (
          <div className="row" key={i} style={{ marginBottom: 6 }}>
            <label style={{ flex: 1, minWidth: 200 }}>{i === 0 ? t('adminTeams.steamId') : ''}
              <input value={r.steamId} onChange={(e) => setRow(i, { steamId: e.target.value })} placeholder="7656119…" pattern="\d{17}" required />
            </label>
            <label style={{ flex: 1, minWidth: 140 }}>{i === 0 ? t('adminTeams.nick') : ''}
              <input value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} required />
            </label>
            {rows.length > 1 && <button type="button" className="ghost" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>✕</button>}
          </div>
        ))}
        {rows.length < 10 && <p><button type="button" className="ghost" onClick={() => setRows((x) => [...x, emptyRow()])}>{t('adminTeams.addPlayer')}</button></p>}
        {error && <p className="error">{error}</p>}
        <button type="submit">{t('teams.create')}</button>
      </form>

      {teams.map((team) => (
        <div className="card" key={team.id}>
          <div className="between">
            <h2>{team.name}</h2>
            <button className="danger" onClick={() => confirm(t('adminTeams.confirmDelete', { name: team.name })) && run(() => api(`/api/admin/teams/${team.id}`, { method: 'DELETE' }))}>{t('teams.deleteTeam')}</button>
          </div>
          <table>
            <tbody>
              {team.members.map((m) => (
                <tr key={m.id}>
                  <td>{m.name}{m.id === team.captainId && ` (${t('teams.captain')})`}</td>
                  <td className="muted">{m.steamId}</td>
                  <td style={{ textAlign: 'right' }}>
                    {m.id !== team.captainId && (
                      <>
                        <button className="ghost" onClick={() => run(() => api(`/api/admin/teams/${team.id}/captain`, { method: 'POST', body: { playerId: m.id } }))}>{t('teams.makeCaptain')}</button>{' '}
                        <button className="ghost" onClick={() => run(() => api(`/api/admin/teams/${team.id}/members/${m.id}`, { method: 'DELETE' }))}>{t('teams.kick')}</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="row" style={{ marginTop: 8 }}>
            <label>{t('adminTeams.steamId')}
              <input value={adding[team.id]?.steamId ?? ''} onChange={(e) => setAdding((a) => ({ ...a, [team.id]: { ...(a[team.id] ?? emptyRow()), steamId: e.target.value } }))} placeholder="7656119…" />
            </label>
            <label>{t('adminTeams.nick')}
              <input value={adding[team.id]?.name ?? ''} onChange={(e) => setAdding((a) => ({ ...a, [team.id]: { ...(a[team.id] ?? emptyRow()), name: e.target.value } }))} />
            </label>
            <button className="ghost" type="button" onClick={() => addMember(team.id)}>{t('adminTeams.addMember')}</button>
          </div>
        </div>
      ))}
      {teams.length === 0 && <p className="muted">{t('adminTeams.empty')}</p>}
    </>
  );
}
