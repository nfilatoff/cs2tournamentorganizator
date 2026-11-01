import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Me, type TournamentSummary } from '../api';
import { useI18n } from '../i18n';
import { TournamentRows } from '../components/TournamentRows';

export function Tournaments({ me }: { me: Me }) {
  const { t } = useI18n();
  const [list, setList] = useState<TournamentSummary[]>([]);
  useEffect(() => {
    api<TournamentSummary[]>('/api/tournaments').then(setList).catch(() => setList([]));
  }, []);

  return (
    <>
      <div className="pagehead">
        <h1>{t('tournaments.title')}</h1>
        {me.kind === 'admin' && <Link to="/tournaments/new"><button>{t('tournaments.create')}</button></Link>}
      </div>
      <TournamentRows list={list} empty={t('tournaments.empty')} />
    </>
  );
}
