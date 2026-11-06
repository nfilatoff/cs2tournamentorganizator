import { useState, type FormEvent } from 'react';
import { api, type TournamentDetails } from '../api';
import { useI18n } from '../i18n';
import { IconClose, IconDown } from './Icons';

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
    <details className="subfold">
      <summary>{t('view.newTeam')}<IconDown /></summary>
      <form onSubmit={submit} className="stack">
        <label>{t('common.name')}<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
        <p className="muted flat">{t('view.newTeamHint', { n: tr.teamSize })}</p>
        {rows.map((r, i) => (
          <div className="row" key={i}>
            <label className="fill">{i === 0 ? t('adminTeams.steamId') : ''}
              <input value={r.steamId} onChange={(e) => setRow(i, { steamId: e.target.value })} placeholder="7656119…" pattern="\d{17}" required />
            </label>
            <label className="fill">{i === 0 ? t('adminTeams.nick') : ''}
              <input value={r.name} onChange={(e) => setRow(i, { name: e.target.value })} required />
            </label>
            {rows.length > tr.teamSize && <button type="button" className="iconbtn" aria-label={t('common.delete')} onClick={() => setRows((x) => x.filter((_, j) => j !== i))}><IconClose /></button>}
          </div>
        ))}
        {rows.length < 10 && <div><button type="button" className="ghost" onClick={() => setRows((x) => [...x, empty()])}>{t('view.addSub')}</button></div>}
        {error && <p className="error">{error}</p>}
        <div><button type="submit" className="ghost">{t('view.createRegister')}</button></div>
      </form>
    </details>
  );
}
