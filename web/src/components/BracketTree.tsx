import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { MatchDto } from '../api';
import { useI18n } from '../i18n';
import { roundLabel } from '../rounds';
import { MatchCard, type MatchActions } from './MatchCard';

interface Props {
  matches: MatchDto[];
  format: 'single' | 'double';
  actions?: MatchActions;
}

interface Pos { col: number; row: number }

// Вертикальный центр матча в «полустроках»: у первого раунда шаг 2, дальше среднее между питающими матчами.
function layout(ms: MatchDto[]): { pos: Map<string, Pos>; rows: number; rounds: number[] } {
  const rounds = [...new Set(ms.map((m) => m.round))].sort((x, y) => x - y);
  const byCode = new Map(ms.map((m) => [m.code, m]));
  const center = new Map<string, number>();
  const calc = (m: MatchDto): number => {
    const known = center.get(m.code);
    if (known !== undefined) return known;
    const feeders = m.from
      .filter((f): f is { kind: 'winner'; code: string } => !!f && f.kind === 'winner' && byCode.has(f.code))
      .map((f) => calc(byCode.get(f.code)!));
    const c = feeders.length > 0 ? feeders.reduce((s, x) => s + x, 0) / feeders.length : 2 * (m.position - 1) + 1;
    center.set(m.code, c);
    return c;
  };
  const pos = new Map<string, Pos>();
  let rows = 0;
  for (const m of ms) {
    const c = calc(m);
    pos.set(m.code, { col: rounds.indexOf(m.round), row: Math.round(c) });
    rows = Math.max(rows, Math.round(c) + 1);
  }
  return { pos, rows, rounds };
}

function Section({ title, ms, format, bracket, actions }: {
  title: string; ms: MatchDto[]; format: 'single' | 'double'; bracket: 'W' | 'L' | 'GF'; actions?: MatchActions;
}) {
  const { t } = useI18n();
  const { pos, rows, rounds } = useMemo(() => layout(ms), [ms]);
  const wrap = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<string, HTMLDivElement>());
  const [paths, setPaths] = useState<string[]>([]);

  // Линии строятся по реальным размерам карточек, поэтому не ломаются, когда карточка растёт
  const draw = () => {
    const box = wrap.current?.getBoundingClientRect();
    if (!box) return;
    const out: string[] = [];
    for (const m of ms) {
      const to = cards.current.get(m.code)?.getBoundingClientRect();
      if (!to) continue;
      for (const f of m.from) {
        if (!f || f.kind !== 'winner') continue;
        const fromEl = cards.current.get(f.code)?.getBoundingClientRect();
        if (!fromEl) continue;
        const x1 = fromEl.right - box.left;
        const y1 = fromEl.top + fromEl.height / 2 - box.top;
        const x2 = to.left - box.left;
        const y2 = to.top + to.height / 2 - box.top;
        const mid = (x1 + x2) / 2;
        out.push(`M${x1} ${y1} H${mid} V${y2} H${x2}`);
      }
    }
    // Тот же набор линий не должен вызывать повторную отрисовку
    setPaths((prev) => (prev.join('|') === out.join('|') ? prev : out));
  };

  useLayoutEffect(draw);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  });

  const colTemplate = `repeat(${rounds.length}, 230px)`;
  return (
    <div className="card">
      <h2>{title}</h2>
      <div className="treescroll">
        <div className="treehead" style={{ gridTemplateColumns: colTemplate }}>
          {rounds.map((r) => {
            const sample = ms.find((m) => m.round === r)!;
            return <div className="roundname" key={r}>{roundLabel(t, bracket, sample.roundFromEnd, format)}</div>;
          })}
        </div>
        <div className="tree" ref={wrap} style={{ gridTemplateColumns: colTemplate, gridTemplateRows: `repeat(${rows}, minmax(38px, auto))` }}>
          <svg className="links" aria-hidden>
            {paths.map((d, i) => <path key={i} d={d} />)}
          </svg>
          {ms.map((m) => {
            const p = pos.get(m.code)!;
            return (
              <div
                key={m.code}
                className="treecell"
                style={{ gridColumn: p.col + 1, gridRow: `${p.row} / span 2` }}
              >
                <div ref={(el) => { if (el) cards.current.set(m.code, el); else cards.current.delete(m.code); }} className="cardwrap">
                  <MatchCard m={m} actions={actions} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Сетка как дерево: колонки по раундам, линии от питающих матчей, у команд видны сиды
export function BracketTree({ matches, format, actions }: Props): ReactNode {
  const { t } = useI18n();
  const visible = matches.filter((m) => m.status !== 'skipped');
  const title = (br: 'W' | 'L' | 'GF') =>
    format === 'single' && br === 'W' ? t('bracket.single') : br === 'W' ? t('bracket.upper') : br === 'L' ? t('bracket.lower') : t('bracket.gf');
  return (
    <>
      {(['W', 'L', 'GF'] as const).map((br) => {
        const ms = visible.filter((m) => m.bracket === br);
        return ms.length === 0 ? null : <Section key={br} title={title(br)} ms={ms} format={format} bracket={br} actions={actions} />;
      })}
    </>
  );
}
