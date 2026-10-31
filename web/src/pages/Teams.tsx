import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, type Me, type Team } from '../api';
import { useI18n } from '../i18n';

export function Teams({ me }: { me: Me }) {
  const { t, err } = useI18n();
  const [teams, setTeams] = useState<Team[]>([]);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api<Team[]>('/api/teams/mine').then(setTeams).catch((e) => setError(err(e)));
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

  if (me.kind !== 'player') return <p className="muted">{t('teams.onlyPlayers')}</p>;

  return (
    <>
      <h1>{t('teams.title')}</h1>
      <div className="grid2">
        <form className="card row" onSubmit={create}>
          <label style={{ flex: 1 }}>{t('teams.createLabel')}<input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('common.name')} required /></label>
          <button type="submit">{t('teams.create')}</button>
        </form>
        <form className="card row" onSubmit={join}>
          <label style={{ flex: 1 }}>{t('teams.joinLabel')}<input value={code} onChange={(e) => setCode(e.target.value)} placeholder={t('teams.codePlaceholder')} required /></label>
          <button type="submit">{t('teams.join')}</button>
        </form>
      </div>
      <p className="muted">{t('teams.hint')}</p>
      {error && <p className="error">{error}</p>}
      {teams.map((team) => {
        const isCaptain = team.captainId === me.id;
        return (
          <div className="card" key={team.id}>
            <h2>{team.name}</h2>
            <p className="muted">{t('teams.inviteCode')}: <code>{team.joinCode}</code></p>
            <table>
              <tbody>
                {team.members.map((m) => (
                  <tr key={m.id}>
                    <td>{m.name}{m.id === team.captainId && ` (${t('teams.captain')})`}</td>
                    <td style={{ textAlign: 'right' }}>
                      {isCaptain && m.id !== team.captainId && (
                        <>
                          <button className="ghost" onClick={() => run(() => api(`/api/teams/${team.id}/captain`, { method: 'POST', body: { playerId: m.id } }))}>{t('teams.makeCaptain')}</button>{' '}
                          <button className="ghost" onClick={() => run(() => api(`/api/teams/${team.id}/kick`, { method: 'POST', body: { playerId: m.id } }))}>{t('teams.kick')}</button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              <button className="ghost" onClick={() => run(() => api(`/api/teams/${team.id}/leave`, { method: 'POST', body: {} }))}>{t('teams.leave')}</button>{' '}
              {isCaptain && <button className="danger" onClick={() => run(() => api(`/api/teams/${team.id}`, { method: 'DELETE' }))}>{t('teams.deleteTeam')}</button>}
            </p>
          </div>
        );
      })}
      {teams.length === 0 && <p className="muted">{t('teams.empty')}</p>}
    </>
  );
}
