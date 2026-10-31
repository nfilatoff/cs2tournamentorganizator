import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Me, type TournamentSummary } from '../api';

export const STATUS_LABEL = { registration: 'Регистрация', running: 'Идёт', finished: 'Завершён' } as const;
export const FORMAT_LABEL = { single: 'Single elimination', double: 'Double elimination' } as const;

export function Tournaments({ me }: { me: Me }) {
  const [list, setList] = useState<TournamentSummary[]>([]);
  useEffect(() => {
    api<TournamentSummary[]>('/api/tournaments').then(setList).catch(() => setList([]));
  }, []);

  return (
    <>
      <div className="between">
        <h1>Турниры</h1>
        {me.kind === 'admin' && <Link to="/tournaments/new"><button>Создать турнир</button></Link>}
      </div>
      <div className="card">
        <table>
          <thead><tr><th>Название</th><th>Формат</th><th>Команд</th><th>Статус</th></tr></thead>
          <tbody>
            {list.map((t) => (
              <tr key={t.id}>
                <td><Link to={`/tournaments/${t.id}`}>{t.name}</Link></td>
                <td>{FORMAT_LABEL[t.format]}, {t.teamSize}v{t.teamSize}</td>
                <td>{t.teamCount}/{t.maxTeams}</td>
                <td>{STATUS_LABEL[t.status]}</td>
              </tr>
            ))}
            {list.length === 0 && <tr><td colSpan={4} className="muted">Турниров пока нет</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
