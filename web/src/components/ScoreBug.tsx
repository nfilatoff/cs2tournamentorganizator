import type { ReactNode } from 'react';

// Плашка счёта: две команды по краям, тёмные вставки со счётом в центре, кромки сторон только у матча в игре
export function ScoreBug({ a, b, scoreA, scoreB, active, big }: {
  a: ReactNode;
  b: ReactNode;
  scoreA?: number;
  scoreB?: number;
  active?: boolean;
  big?: boolean;
}) {
  return (
    <span className={`bug${active ? ' active' : ''}${big ? ' big' : ''}`}>
      <span className="bugname a">{a}</span>
      <span className="bugscore"><b>{scoreA ?? '–'}</b><b>{scoreB ?? '–'}</b></span>
      <span className="bugname b">{b}</span>
    </span>
  );
}
