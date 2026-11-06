import { useCallback, useEffect, useState } from 'react';
import { api, type Team } from '../api';
import { useI18n } from '../i18n';
import { ConfirmDeleteDialog } from '../components/ConfirmDeleteDialog';

interface PlayerRow { steamId: string; name: string }
const emptyRow = (): PlayerRow => ({ steamId: '', name: '' });

// Компактный список всех команд. Новые команды админ создаёт прямо в турнире, а здесь только правит существующие.
export function AdminTeams() {
  const { t, err } = useI18n();
  const [teams, setTeams] = useState<Team[]>([]);
  const [filter, setFilter] = useState('');
  const [adding, setAdding] = useState<Record<number, PlayerRow>>({});
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingDelete, setPendingDelete] = useState<{ question: string; action: () => Promise<unknown> } | null>(null);

  const load = useCallback(() => {
    api<Team[]>('/api/admin/teams').then(setTeams).catch((e) => setError(err(e)));
  }, [err]);
  useEffect(load, [load]);

  const run = async (fn: () => Promise<unknown>) => {
    setError('');
    setNotice('');
    try {
      await fn();
      load();
    } catch (e) {
      setError(err(e));
    }
  };

  const addMember = (teamId: number) => {
    const row = adding[teamId] ?? emptyRow();
    void run(async () => {
      await api(`/api/admin/teams/${teamId}/members`, { method: 'POST', body: row });
      setAdding((a) => ({ ...a, [teamId]: emptyRow() }));
    });
  };

  const deleteAll = async () => {
    const r = await api<{ deleted: number; skipped: number }>('/api/admin/teams/delete-all', { method: 'POST', body: {} });
    setNotice(t(r.skipped > 0 ? 'adminTeams.deleteAllSkipped' : 'adminTeams.deleteAllDone', r));
  };

  const shown = teams.filter((x) => x.name.toLowerCase().includes(filter.trim().toLowerCase()));

  return (
    <>
      <div className="between">
        <h1>{t('adminTeams.title')}</h1>
        <div className="row">
          <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder={t('adminTeams.search')} style={{ maxWidth: 240 }} />
          {teams.length > 0 && <button className="danger" onClick={() => setPendingDelete({ question: t('adminTeams.confirmDeleteAll', { count: teams.length }), action: deleteAll })}>{t('adminTeams.deleteAll')}</button>}
        </div>
      </div>
      <p className="muted">{t('adminTeams.hint')}</p>
      {error && <p className="error">{error}</p>}
      {notice && <p>{notice}</p>}

      <div className="card">
        {shown.map((team) => (
          <details key={team.id} className="teamrow">
            <summary>
              <b>{team.name}</b>
              <span className="muted"> · {team.members.map((m) => m.name).join(', ')}</span>
            </summary>
            <table>
              <tbody>
                {team.members.map((m) => (
                  <tr key={m.id}>
                    <td>
                      {m.name}{m.id === team.captainId && ` (${t('teams.captain')})`}
                      <div className="muted" style={{ fontSize: 12 }}>
                        {[m.steamName && `${t('nick.steam')}: ${m.steamName}`, m.customName && `${t('nick.player')}: ${m.customName}`, m.adminName && `${t('nick.admin')}: ${m.adminName}`].filter(Boolean).join(' · ')}
                      </div>
                    </td>
                    <td className="muted">{m.steamId}</td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="ghost" onClick={() => { const v = prompt(t('nick.prompt'), m.adminName ?? ''); if (v !== null) void run(() => api(`/api/admin/players/${m.id}/nickname`, { method: 'PUT', body: { nickname: v.trim() || null } })); }}>{t('nick.setAdmin')}</button>{' '}
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
            <div className="row" style={{ margin: '8px 0' }}>
              <label>{t('adminTeams.steamId')}
                <input value={adding[team.id]?.steamId ?? ''} onChange={(e) => setAdding((a) => ({ ...a, [team.id]: { ...(a[team.id] ?? emptyRow()), steamId: e.target.value } }))} placeholder="7656119…" />
              </label>
              <label>{t('adminTeams.nick')}
                <input value={adding[team.id]?.name ?? ''} onChange={(e) => setAdding((a) => ({ ...a, [team.id]: { ...(a[team.id] ?? emptyRow()), name: e.target.value } }))} />
              </label>
              <button className="ghost" type="button" onClick={() => addMember(team.id)}>{t('adminTeams.addMember')}</button>
              <button className="danger" onClick={() => setPendingDelete({ question: t('adminTeams.confirmDelete', { name: team.name }), action: () => api(`/api/admin/teams/${team.id}`, { method: 'DELETE' }) })}>{t('teams.deleteTeam')}</button>
            </div>
          </details>
        ))}
        {shown.length === 0 && <p className="muted">{t('adminTeams.empty')}</p>}
      </div>

      {pendingDelete && (
        <ConfirmDeleteDialog
          question={pendingDelete.question}
          onCancel={() => setPendingDelete(null)}
          onConfirm={() => { setPendingDelete(null); void run(pendingDelete.action); }}
        />
      )}
    </>
  );
}
