import { useState, type FormEvent } from 'react';
import { api, type TournamentDetails } from '../api';
import { useI18n } from '../i18n';

interface Row { steamId: string; name: string }
const empty = (): Row => ({ steamId: '', name: '' });

// Админ создаёт команду прямо в турнире: она сразу регистрируется. В состав идут первые игроки списка.
export function NewTeamForm({ tr, onDone }: { tr: TournamentDetails; onDone: (t: TournamentDetails) => void }) {
  const { t, err } = useI18n();
  const [name, setName] = useState('');
  const [rows, setRows] = useState<Row[]>(() => Array.from({ length: tr.teamSize }, empty));
  const [error, setError] = useState('');

  const setRow = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      onDone(await api<TournamentDetails>(`/api/tournaments/${tr.id}/teams/new`, { method: 'POST', body: { name, players: rows } }));
      setName('');
      setRows(Array.from({ length: tr.teamSize }, empty));
    } catch (e2) {
      setError(err(e2));
    }
  };

  return (
    <details style={{ marginTop: 12 }}>
      <summary><b>{t('view.newTeam')}</b></summary>
      <form onSubmit={submit} style={{ marginTop: 8 }}>
        <label>{t('common.name')}<input value={name} onChange={(e) => setName(e.target.value)} required style={{ maxWidth: 320 }} /></label>
        <p className="muted">{t('view.newTeamHint', { n: tr.teamSize })}</p>
        {rows.map((r, i) => (
          <div className="row" key={i} style={{ marginBottom: 6 }}>
            <label style={{ flex: 1, minWidth: 180 }}>{i === 0 ? t('adminTeams.steamId') : ''}
              <input value={r.steamId} onChange={(e) => setRow(i, { steamId: e.target.value })} placeholder="7656119…" pattern="\d{17}" required />
            </label>
            <label style={{ flex: 1, minWidth: 120 }}>{i === 0 ? t('adminTeams.nick') : ''}
              <input value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} required />
            </label>
            {rows.length > tr.teamSize && <button type="button" className="ghost" onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>✕</button>}
          </div>
        ))}
        {rows.length < 10 && <p><button type="button" className="ghost" onClick={() => setRows((x) => [...x, empty()])}>{t('view.addSub')}</button></p>}
        {error && <p className="error">{error}</p>}
        <button type="submit">{t('view.createRegister')}</button>
      </form>
    </details>
  );
}
