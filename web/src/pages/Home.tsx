import type { Me } from '../api';

export function Home({ me }: { me: Me }) {
  return (
    <div className="card">
      <h1>CS2 Турниры</h1>
      {me.kind === null && <p className="muted">Войдите через Steam, чтобы создать команду и участвовать в турнирах.</p>}
      {me.kind === 'player' && <p>Привет, {me.name}! Турниры и команды появятся на следующих этапах.</p>}
      {me.kind === 'admin' && <p>Добавьте серверы и карты, затем можно будет создавать турниры.</p>}
    </div>
  );
}
