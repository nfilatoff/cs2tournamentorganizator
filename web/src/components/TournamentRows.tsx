import { Link } from 'react-router-dom';
import type { TournamentSummary } from '../api';
import { useI18n } from '../i18n';
import { IconTrophy } from './Icons';

type Row = Pick<TournamentSummary, 'id' | 'name' | 'format' | 'teamSize' | 'maxTeams' | 'status' | 'teamCount'>;

// Список турниров строками: формат, заполненность слотов и статус
export function TournamentRows({ list, empty }: { list: Row[]; empty: string }) {
  const { t } = useI18n();
  if (list.length === 0) return empty ? <div className="emptybox">{empty}</div> : null;
  return (
    <div className="tlist">
      {list.map((x) => (
        <Link key={x.id} to={`/tournaments/${x.id}`} className="trow">
          <span className="ticon"><IconTrophy /></span>
          <span style={{ minWidth: 0 }}>
            <div className="tname">{x.name}</div>
            <div className="tmeta">{t(`format.${x.format}`)} · {x.teamSize}v{x.teamSize}</div>
          </span>
          <span className="tslots">
            <b>{x.teamCount}</b>/{x.maxTeams}
            <div className="bar"><i style={{ width: `${Math.min(100, (x.teamCount / Math.max(1, x.maxTeams)) * 100)}%` }} /></div>
          </span>
          <span className={`pill ${x.status}`}>{t(`status.${x.status}`)}</span>
        </Link>
      ))}
    </div>
  );
}
