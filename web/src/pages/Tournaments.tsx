import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Me, type TournamentSummary } from '../api';
import { useI18n } from '../i18n';

export function Tournaments({ me }: { me: Me }) {
  const { t } = useI18n();
  const [list, setList] = useState<TournamentSummary[]>([]);
  useEffect(() => {
    api<TournamentSummary[]>('/api/tournaments').then(setList).catch(() => setList([]));
  }, []);

  return (
    <>
      <div className="between">
        <h1>{t('tournaments.title')}</h1>
        {me.kind === 'admin' && <Link to="/tournaments/new"><button>{t('tournaments.create')}</button></Link>}
      </div>
      <div className="card">
        <table>
          <thead><tr><th>{t('common.name')}</th><th>{t('tournaments.format')}</th><th>{t('tournaments.teams')}</th><th>{t('tournaments.status')}</th></tr></thead>
          <tbody>
            {list.map((x) => (
              <tr key={x.id}>
                <td><Link to={`/tournaments/${x.id}`}>{x.name}</Link></td>
                <td>{t(`format.${x.format}`)}, {x.teamSize}v{x.teamSize}</td>
                <td>{x.teamCount}/{x.maxTeams}</td>
                <td>{t(`status.${x.status}`)}</td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={4} className="muted">{t('tournaments.empty')}</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
