import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type MapItem, type TournamentDetails } from '../api';
import { useI18n } from '../i18n';
import { roundLabel } from '../rounds';

const MAX_MAPS = 7;
interface RoundDef { key: string; bracket: 'W' | 'L' | 'GF'; fromEnd: number }
type GroupFormat = 'round_robin' | 'swiss' | 'gsl';

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
  const [vetoEnabled, setVetoEnabled] = useState(true);
  const [maps, setMaps] = useState<MapItem[]>([]);
  const [picked, setPicked] = useState<number[]>([]);
  const [rounds, setRounds] = useState<RoundDef[]>([]);
  const [error, setError] = useState('');

  // Групповой этап
  const [withGroups, setWithGroups] = useState(false);
  const [groupFormat, setGroupFormat] = useState<GroupFormat>('round_robin');
  const [groupsCount, setGroupsCount] = useState(2);
  const [advance, setAdvance] = useState(2);
  const [swissRounds, setSwissRounds] = useState('');
  const [groupBo, setGroupBo] = useState(1);
  const [hasPlayoff, setHasPlayoff] = useState(true);

  const groupsN = groupFormat === 'swiss' ? 1 : groupsCount;
  // Сколько команд выходит в плей-офф: именно по этому размеру строится сетка
  const playoffSize = withGroups ? (groupFormat === 'swiss' ? advance : groupsN * advance) : maxTeams;
  const showPlayoff = !withGroups || hasPlayoff;

  useEffect(() => {
    api<MapItem[]>('/api/maps').then(setMaps).catch((e) => setError(err(e)));
  }, [err]);

  // В GSL ровно по 4 команды в группе
  useEffect(() => {
    if (withGroups && groupFormat === 'gsl') setMaxTeams(groupsN * 4);
  }, [withGroups, groupFormat, groupsN]);

  useEffect(() => {
    if (playoffSize < 2 || playoffSize > 64 || !showPlayoff) { setRounds([]); return; }
    api<RoundDef[]>(`/api/tournaments/rounds-preview?format=${format}&maxTeams=${playoffSize}`)
      .then(setRounds)
      .catch(() => setRounds([]));
  }, [format, playoffSize, showPlayoff]);

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
        body: {
          name, format, teamSize, maxTeams, defaultBestOf: defaultBo, boConfig: cfg, grandFinalReset: reset, autoDispatch, vetoEnabled, mapIds: picked,
          stageMode: withGroups ? 'groups' : 'playoff',
          ...(withGroups ? {
            groupFormat, groupsCount: groupsN, advance, groupBestOf: groupBo, hasPlayoff,
            ...(groupFormat === 'swiss' && swissRounds ? { swissRounds: Number(swissRounds) } : {}),
          } : {}),
        },
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
        <label>{t('form.teamSize')}
          <select value={teamSize} onChange={(e) => setTeamSize(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}v{n}</option>)}
          </select>
        </label>
        <label>{t('tournaments.teams')}
          <input type="number" min={2} max={64} value={maxTeams} onChange={(e) => setMaxTeams(Number(e.target.value))}
            readOnly={withGroups && groupFormat === 'gsl'} style={{ width: 90 }} />
        </label>
      </div>

      <div className="card">
        <h2>{t('form.stages')}</h2>
        <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={withGroups} onChange={(e) => setWithGroups(e.target.checked)} />
          {t('form.withGroups')}
        </label>
        {withGroups && (
          <>
            <div className="row" style={{ marginTop: 10 }}>
              <label>{t('form.groupFormat')}
                <select value={groupFormat} onChange={(e) => setGroupFormat(e.target.value as GroupFormat)}>
                  <option value="round_robin">{t('gf.round_robin')}</option>
                  <option value="swiss">{t('gf.swiss')}</option>
                  <option value="gsl">{t('gf.gsl')}</option>
                </select>
              </label>
              {groupFormat !== 'swiss' && (
                <label>{t('form.groupsCount')}
                  <input type="number" min={1} max={16} value={groupsCount} onChange={(e) => setGroupsCount(Number(e.target.value))} style={{ width: 80 }} />
                </label>
              )}
              <label>{groupFormat === 'swiss' ? t('form.advanceSwiss') : t('form.advance')}
                <input type="number" min={1} max={32} value={advance} onChange={(e) => setAdvance(Number(e.target.value))} style={{ width: 80 }} />
              </label>
              {groupFormat === 'swiss' && (
                <label>{t('form.swissRounds')}
                  <input type="number" min={1} max={15} value={swissRounds} placeholder={t('form.auto')} onChange={(e) => setSwissRounds(e.target.value)} style={{ width: 90 }} />
                </label>
              )}
              <label>{t('form.groupBo')}
                <select value={groupBo} onChange={(e) => setGroupBo(Number(e.target.value))}>
                  {[1, 3, 5].map((n) => <option key={n} value={n}>BO{n}</option>)}
                </select>
              </label>
            </div>
            <p className="muted">{t(`gf.${groupFormat}.hint` as 'gf.swiss.hint')}</p>
            <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <input type="checkbox" checked={hasPlayoff} onChange={(e) => setHasPlayoff(e.target.checked)} />
              {t('form.hasPlayoff')}
            </label>
          </>
        )}
      </div>

      {showPlayoff && (
        <div className="card">
          <h2>{withGroups ? t('form.playoff') : t('form.series')}</h2>
          <div className="row">
            <label>{t('tournaments.format')}
              <select value={format} onChange={(e) => setFormat(e.target.value as 'single' | 'double')}>
                <option value="single">{t('format.single')}</option>
                <option value="double">{t('format.double')}</option>
              </select>
            </label>
            <label>{t('form.defaultBo')}
              <select value={defaultBo} onChange={(e) => setDefaultBo(Number(e.target.value))}>
                {[1, 3, 5].map((n) => <option key={n} value={n}>BO{n}</option>)}
              </select>
            </label>
          </div>
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
      )}

      <div className="card">
        <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={autoDispatch} onChange={(e) => setAutoDispatch(e.target.checked)} />
          {t('form.autoDispatch')}
        </label>
        <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }}>
          <input type="checkbox" checked={vetoEnabled} onChange={(e) => setVetoEnabled(e.target.checked)} />
          {t('form.vetoEnabled')}
        </label>
        <p className="muted">{t('form.vetoHint')}</p>
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
