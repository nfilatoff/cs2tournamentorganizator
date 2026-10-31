import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type MapItem, type TournamentDetails } from '../api';
import { useI18n } from '../i18n';
import { roundLabel } from '../rounds';

const MAX_MAPS = 7;
interface RoundDef { key: string; bracket: 'W' | 'L' | 'GF'; fromEnd: number }

export function TournamentForm() {
  const { t, err } = useI18n();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [format, setFormat] = useState<'single' | 'double'>('double');
  const [teamSize, setTeamSize] = useState(2);
  const [maxTeams, setMaxTeams] = useState(12);
  const [defaultBo, setDefaultBo] = useState(1);
  const [boConfig, setBoConfig] = useState<Record<string, number>>({});
  const [reset, setReset] = useState(true);
  const [autoDispatch, setAutoDispatch] = useState(true);
  const [maps, setMaps] = useState<MapItem[]>([]);
  const [picked, setPicked] = useState<number[]>([]);
  const [rounds, setRounds] = useState<RoundDef[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    api<MapItem[]>('/api/maps').then(setMaps).catch((e) => setError(err(e)));
  }, [err]);

  useEffect(() => {
    if (maxTeams < 2) return;
    api<RoundDef[]>(`/api/tournaments/rounds-preview?format=${format}&maxTeams=${maxTeams}`)
      .then(setRounds)
      .catch(() => setRounds([]));
  }, [format, maxTeams]);

  const togglePick = (id: number) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < MAX_MAPS ? [...p, id] : p));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    // Оставляем только ключи раундов, которые есть в текущей сетке
    const valid = new Set(rounds.map((r) => r.key));
    const cfg = Object.fromEntries(Object.entries(boConfig).filter(([k]) => valid.has(k)));
    try {
      const created = await api<TournamentDetails>('/api/tournaments', {
        method: 'POST',
        body: { name, format, teamSize, maxTeams, defaultBestOf: defaultBo, boConfig: cfg, grandFinalReset: reset, autoDispatch, mapIds: picked },
      });
      navigate(`/tournaments/${created.id}`);
    } catch (e2) {
      setError(err(e2));
    }
  };

  return (
    <form onSubmit={submit}>
      <h1>{t('form.title')}</h1>
      <div className="card row">
        <label style={{ flex: 1, minWidth: 220 }}>{t('common.name')}<input value={name} onChange={(e) => setName(e.target.value)} required /></label>
        <label>{t('tournaments.format')}
          <select value={format} onChange={(e) => setFormat(e.target.value as 'single' | 'double')}>
            <option value="single">{t('format.single')}</option>
            <option value="double">{t('format.double')}</option>
          </select>
        </label>
        <label>{t('form.teamSize')}
          <select value={teamSize} onChange={(e) => setTeamSize(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}v{n}</option>)}
          </select>
        </label>
        <label>{t('tournaments.teams')}<input type="number" min={2} max={64} value={maxTeams} onChange={(e) => setMaxTeams(Number(e.target.value))} style={{ width: 90 }} /></label>
      </div>

      <div className="card">
        <h2>{t('form.series')}</h2>
        <label>{t('form.defaultBo')}
          <select value={defaultBo} onChange={(e) => setDefaultBo(Number(e.target.value))}>
            {[1, 3, 5].map((n) => <option key={n} value={n}>BO{n}</option>)}
          </select>
        </label>
        <table>
          <tbody>
            {rounds.map((r) => (
              <tr key={r.key}>
                <td>{roundLabel(t, r.bracket, r.fromEnd, format)}</td>
                <td style={{ textAlign: 'right' }}>
                  <select value={boConfig[r.key] ?? defaultBo} onChange={(e) => setBoConfig({ ...boConfig, [r.key]: Number(e.target.value) })}>
                    {[1, 3, 5].map((n) => <option key={n} value={n}>BO{n}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {format === 'double' && (
          <label style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
            <input type="checkbox" checked={reset} onChange={(e) => setReset(e.target.checked)} />
            {t('form.reset')}
          </label>
        )}
        <p className="muted">{t('form.roundsHint')}</p>
      </div>

      <div className="card">
        <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={autoDispatch} onChange={(e) => setAutoDispatch(e.target.checked)} />
          {t('form.autoDispatch')}
        </label>
      </div>

      <div className="card">
        <h2>{t('form.mapPool', { n: picked.length, max: MAX_MAPS })}</h2>
        {maps.length === 0 && <p className="muted">{t('form.addMapsFirst')}</p>}
        <div className="maps">
          {maps.map((m) => (
            <label key={m.id} className={`mapchip${picked.includes(m.id) ? ' on' : ''}`}>
              <input type="checkbox" checked={picked.includes(m.id)} onChange={() => togglePick(m.id)} />
              {m.imageUrl && <img className="thumb" src={m.imageUrl} alt="" />}
              <span>{m.name}</span>
            </label>
          ))}
        </div>
      </div>

      {error && <p className="error">{error}</p>}
      <button type="submit">{t('form.submit')}</button>
    </form>
  );
}
