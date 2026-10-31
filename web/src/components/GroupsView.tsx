import { useEffect, useState } from 'react';
import { api, type MatchDto, type PlayoffPreview, type StandingRow, type TournamentDetails } from '../api';
import { useI18n } from '../i18n';
import { BracketTree, Canvas, gslLayout } from './BracketTree';
import { MatchCard, type MatchActions } from './MatchCard';

const groupName = (no: number) => String.fromCharCode(64 + no);

// В GSL нет очков: показывается только результат (победы и поражения), а места появляются, когда группа сыграна
function GslStandings({ rows, complete, advance }: { rows: StandingRow[]; complete: boolean; advance: number }) {
  const { t } = useI18n();
  return (
    <table className="standings">
      <thead><tr><th>#</th><th>{t('st.team')}</th><th>{t('st.wl')}</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.teamId} className={complete && r.rank <= advance ? 'qualified' : ''}>
            <td>{complete ? r.rank : '–'}</td>
            <td>{r.name}</td>
            <td>{r.wins}-{r.losses}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Standings({ rows, swiss, advance }: { rows: StandingRow[]; swiss: boolean; advance: number }) {
  const { t } = useI18n();
  return (
    <table className="standings">
      <thead>
        <tr>
          <th>#</th><th>{t('st.team')}</th><th title={t('st.playedHint')}>{t('st.played')}</th>
          <th>{t('st.wl')}</th><th>{t('st.points')}</th><th title={t('st.mapsHint')}>{t('st.maps')}</th>
          {swiss && <th title={t('st.buchholzHint')}>{t('st.buchholz')}</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.teamId} className={r.rank <= advance ? 'qualified' : ''}>
            <td>{r.rank}</td>
            <td>{r.name}{r.tiedBySeed && <span className="muted" title={t('st.tieHint')}> *</span>}</td>
            <td>{r.played}</td>
            <td>{r.wins}-{r.losses}</td>
            <td><b>{r.points}</b></td>
            <td>{r.mapsFor}:{r.mapsAgainst}</td>
            {swiss && <td>{r.buchholz}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function roundTitle(t: ReturnType<typeof useI18n>['t'], format: string | null, round: number): string {
  if (format === 'gsl') return t(`gsl.r${round}` as 'gsl.r1');
  return t('group.round', { n: round });
}

// Таблицы групп и их матчи по турам
export function GroupsView({ tr, actions }: { tr: TournamentDetails; actions?: MatchActions }) {
  const { t } = useI18n();
  if (!tr.groups) return null;
  const cfg = tr.groupConfig;
  const swiss = cfg.format === 'swiss';
  return (
    <>
      {tr.groups.tables.map((g) => {
        const ms = tr.matches.filter((m) => m.stage === 'group' && m.groupNo === g.no);
        const rounds = [...new Set(ms.map((m) => m.round))].sort((a, b) => a - b);
        return (
          <div className="card" key={g.no}>
            <h2>
              {swiss ? t('group.swiss', { n: tr.groups!.swissTotal ?? 0 }) : t('group.title', { name: groupName(g.no) })}
              <span className="muted"> · {t(`gf.${cfg.format ?? 'round_robin'}` as 'gf.swiss')}</span>
            </h2>
            {cfg.format === 'gsl' ? (
              <>
                <GslStandings rows={g.standings} complete={ms.every((m) => m.status === 'done' || m.status === 'bye')} advance={cfg.advance} />
                <p className="muted">{t('group.gslNote', { n: cfg.advance })}</p>
                <Canvas layout={gslLayout(ms, (r) => roundTitle(t, 'gsl', r))} actions={actions} />
              </>
            ) : (
              <>
                <Standings rows={g.standings} swiss={swiss} advance={cfg.advance} />
                <p className="muted">{t('group.advanceNote', { n: cfg.advance })}</p>
              </>
            )}
            {cfg.format !== 'gsl' && rounds.map((r) => (
              <div key={r}>
                <div className="roundname" style={{ margin: '12px 0 6px' }}>{roundTitle(t, cfg.format, r)}</div>
                <div className="matchlist">
                  {ms.filter((m) => m.round === r).map((m) => <MatchCard key={m.code} m={m} actions={actions} />)}
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}

// До старта: в какие группы попадут команды при текущей рассадке
export function GroupAssignment({ groups }: { groups: { no: number; teams: { id: number; name: string; seed: number }[] }[] }) {
  const { t } = useI18n();
  return (
    <div className="grid2">
      {groups.map((g) => (
        <div className="card" key={g.no}>
          <h2>{t('group.title', { name: groupName(g.no) })}</h2>
          <table><tbody>{g.teams.map((x) => <tr key={x.id}><td>#{x.seed} {x.name}</td></tr>)}</tbody></table>
        </div>
      ))}
    </div>
  );
}

// После групп: выбор порядка сидов плей-офф, предпросмотр сетки и её создание
export function PlayoffPanel({ tr, onDone }: { tr: TournamentDetails; onDone: (t: TournamentDetails) => void }) {
  const { t, err } = useI18n();
  const [order, setOrder] = useState<number[] | null>(null);
  const [preview, setPreview] = useState<PlayoffPreview | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api<PlayoffPreview>(`/api/tournaments/${tr.id}/playoff/preview`, { method: 'POST', body: order ? { order } : {} })
      .then((p) => {
        setPreview(p);
        if (!order) setOrder(p.order.map((x) => x.id));
      })
      .catch((e) => setError(err(e)));
  }, [tr.id, order, err]);

  const move = (i: number, d: number) => {
    if (!order) return;
    const j = i + d;
    if (j < 0 || j >= order.length) return;
    const next = [...order];
    [next[i], next[j]] = [next[j]!, next[i]!];
    setOrder(next);
  };

  const generate = async () => {
    setError('');
    try {
      onDone(await api<TournamentDetails>(`/api/tournaments/${tr.id}/playoff`, { method: 'POST', body: { order: order ?? undefined } }));
    } catch (e) {
      setError(err(e));
    }
  };

  return (
    <div className="card">
      <h2>{t('playoff.title')}</h2>
      <p className="muted">{t('playoff.hint')}</p>
      {preview?.ties && <p className="error">{t('playoff.ties')}</p>}
      <table>
        <tbody>
          {(order ?? []).map((id, i) => {
            const q = preview?.order.find((x) => x.id === id);
            return (
              <tr key={id}>
                <td>#{i + 1}</td>
                <td>{q?.name}</td>
                <td className="muted">{q?.group ? t('playoff.from', { group: groupName(q.group), rank: q.rank ?? 0 }) : ''}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="ghost" disabled={i === 0} onClick={() => move(i, -1)}>▲</button>{' '}
                  <button className="ghost" disabled={i === (order?.length ?? 0) - 1} onClick={() => move(i, 1)}>▼</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {error && <p className="error">{error}</p>}
      <p><button onClick={generate}>{t('playoff.generate')}</button></p>
      {preview && preview.matches.length > 0 && <BracketTree matches={preview.matches as MatchDto[]} format={tr.format} />}
    </div>
  );
}
