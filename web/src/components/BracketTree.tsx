import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { MatchDto } from '../api';
import { useI18n } from '../i18n';
import { roundLabel } from '../rounds';
import { IconClose, IconExpand } from './Icons';
import { MatchCard, type MatchActions } from './MatchCard';

interface Props {
  matches: MatchDto[];
  format: 'single' | 'double';
  actions?: MatchActions;
  title?: string;
}

interface Pos { col: number; row: number }
interface Head { col: number; row: number; label: string }

// Вертикальный центр матча в «полустроках»: у первого раунда шаг 2, дальше среднее между питающими матчами.
function centersOf(ms: MatchDto[]): Map<string, number> {
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
  ms.forEach(calc);
  return center;
}

const maxOf = (m: Map<string, number>) => Math.max(0, ...m.values());
const roundsOf = (ms: MatchDto[]) => [...new Set(ms.map((m) => m.round))].sort((a, b) => a - b);

interface Layout { ms: MatchDto[]; pos: Map<string, Pos>; heads: Head[]; cols: number; rows: number; loserLinks?: boolean }

// Сетка на выбывание: колонки по раундам
function singleLayout(ms: MatchDto[], label: (m: MatchDto) => string): Layout {
  const c = centersOf(ms);
  const rounds = roundsOf(ms);
  const pos = new Map<string, Pos>();
  ms.forEach((m) => pos.set(m.code, { col: rounds.indexOf(m.round) + 1, row: Math.round(c.get(m.code)!) + 1 }));
  const heads = rounds.map((r, i) => ({ col: i + 1, row: 1, label: label(ms.find((m) => m.round === r)!) }));
  return { ms, pos, heads, cols: rounds.length, rows: Math.round(maxOf(c)) + 2 };
}

// Double elimination одним полотном, как на FastCup: верхняя сетка сверху, нижняя под ней, гранд-финал справа.
// Раунды верхней сетки стоят в тех же колонках, что и раунды нижней, в которые падают их проигравшие.
function doubleLayout(
  w: MatchDto[], l: MatchDto[], g: MatchDto[], wLabel: (n: number) => string, lLabel: (n: number) => string, gLabel: (m: MatchDto) => string,
): Layout {
  const k = Math.max(0, ...w.map((m) => m.round));
  const wCol = (r: number) => (r <= 2 ? r : 2 * (r - 1));
  const cW = centersOf(w);
  const rowsW = Math.round(maxOf(cW)) + 1;
  const pos = new Map<string, Pos>();
  const heads: Head[] = [];

  w.forEach((m) => pos.set(m.code, { col: wCol(m.round), row: Math.round(cW.get(m.code)!) + 1 }));
  roundsOf(w).forEach((r) => heads.push({ col: wCol(r), row: 1, label: wLabel(r) }));

  let lastRow = rowsW + 1;
  let wFinalRow = Math.round(cW.get(`W${k}-1`) ?? 1) + 1;
  let lFinalRow = wFinalRow;
  if (l.length > 0) {
    const lTop = rowsW + 3; // между сетками остаётся пустая строка, дальше строка заголовков
    const cL = centersOf(l);
    l.forEach((m) => pos.set(m.code, { col: m.round, row: Math.round(cL.get(m.code)!) + lTop }));
    roundsOf(l).forEach((r) => heads.push({ col: r, row: lTop, label: lLabel(r) }));
    lastRow = Math.round(maxOf(cL)) + lTop + 1;
    const lastL = Math.max(...l.map((m) => m.round));
    lFinalRow = Math.round(cL.get(`L${lastL}-1`) ?? 1) + lTop;
  }

  const gfBase = k <= 1 ? 1 : 2 * (k - 1);
  const gfRow = Math.round((wFinalRow + lFinalRow) / 2);
  roundsOf(g).forEach((r) => heads.push({ col: gfBase + r, row: 1, label: gLabel(g.find((m) => m.round === r)!) }));
  g.forEach((m) => pos.set(m.code, { col: gfBase + m.round, row: gfRow }));

  const cols = Math.max(...[...pos.values()].map((p) => p.col));
  return { ms: [...w, ...l, ...g], pos, heads, cols, rows: lastRow + 1 };
}

// Группа GSL: два стартовых матча, матч победителей, матч проигравших и решающий матч
export function gslLayout(ms: MatchDto[], label: (round: number) => string): Layout {
  const spots: Record<string, Pos> = {};
  const g = ms[0]?.groupNo ?? 1;
  spots[`G${g}-1-1`] = { col: 1, row: 2 };
  spots[`G${g}-1-2`] = { col: 1, row: 4 };
  spots[`G${g}-2-1`] = { col: 2, row: 3 };
  spots[`G${g}-2-2`] = { col: 2, row: 7 };
  spots[`G${g}-3-1`] = { col: 3, row: 5 };
  const pos = new Map(ms.map((m) => [m.code, spots[m.code] ?? { col: m.round, row: 2 * m.position }]));
  return {
    ms, pos, cols: 3, rows: 9, loserLinks: true,
    heads: [1, 2, 3].map((r) => ({ col: r, row: 1, label: label(r) })),
  };
}

interface Link { d: string; dashed: boolean; settled: boolean }

function Canvas({ layout, actions, scale, offsetX }: { layout: Layout; actions?: MatchActions; scale?: number; offsetX?: number }) {
  const wrap = useRef<HTMLDivElement>(null);
  const cards = useRef(new Map<string, HTMLDivElement>());
  const [paths, setPaths] = useState<Link[]>([]);
  const statusOf = new Map(layout.ms.map((m) => [m.code, m.status]));

  // Линии строятся по реальным размерам карточек, поэтому не ломаются, когда карточка растёт
  const draw = () => {
    const el = wrap.current;
    const box = el?.getBoundingClientRect();
    if (!el || !box) return;
    // На большом экране холст увеличен трансформацией, а координаты линий остаются в его собственном масштабе
    const k = el.offsetWidth > 0 ? box.width / el.offsetWidth : 1;
    const out: Link[] = [];
    for (const m of layout.ms) {
      const to = cards.current.get(m.code)?.getBoundingClientRect();
      if (!to) continue;
      for (const f of m.from) {
        // Проигравшие рисуются только в гранд-финал (двух команд): в остальных случаях это лишний шум
        if (!f || !(f.kind === 'winner' || (f.kind === 'loser' && (m.bracket === 'GF' || layout.loserLinks)))) continue;
        const src = cards.current.get(f.code)?.getBoundingClientRect();
        if (!src) continue;
        const x1 = (src.right - box.left) / k;
        const y1 = (src.top + src.height / 2 - box.top) / k;
        const x2 = (to.left - box.left) / k;
        const y2 = (to.top + to.height / 2 - box.top) / k;
        const mid = (x1 + x2) / 2;
        out.push({ d: `M${x1} ${y1} H${mid} V${y2} H${x2}`, dashed: f.kind === 'loser', settled: statusOf.get(f.code) === 'done' });
      }
    }
    // Тот же набор линий не должен вызывать повторную отрисовку
    const key = (p: Link[]) => p.map((x) => x.d + x.dashed + x.settled).join('|');
    setPaths((prev) => (key(prev) === key(out) ? prev : out));
  };

  useLayoutEffect(draw);
  // Широкая сетка открывается на идущем матче, а не обрезает его у края
  useEffect(() => {
    const el = wrap.current;
    const scroller = el?.parentElement;
    const target = el?.querySelector('.match.live') ?? el?.querySelector('.match.ready');
    if (!scroller || !target || scale) return;
    const box = scroller.getBoundingClientRect();
    const r = target.getBoundingClientRect();
    if (r.right > box.right) scroller.scrollLeft += r.left - box.left - 16;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  });

  return (
    <div className="treescroll">
      <div
        className="tree"
        ref={wrap}
        style={{
          gridTemplateColumns: `repeat(${layout.cols}, 216px)`,
          gridTemplateRows: `repeat(${layout.rows}, minmax(24px, auto))`,
          ...(scale ? { transform: `translateX(${offsetX ?? 0}px) scale(${scale})`, transformOrigin: 'top left' } : {}),
        }}
      >
        <svg className="links" aria-hidden>
          {paths.map((p, i) => <path key={i} d={p.d} className={`${p.dashed ? 'dashed' : ''}${p.settled ? ' settled' : ''}`} />)}
        </svg>
        {layout.heads.map((h, i) => (
          <div key={i} className="roundname treehead" style={{ gridColumn: h.col, gridRow: h.row }}>{h.label}</div>
        ))}
        {layout.ms.map((m) => {
          const p = layout.pos.get(m.code)!;
          return (
            <div key={m.code} className="treecell" style={{ gridColumn: p.col, gridRow: `${p.row} / span 2` }}>
              <div ref={(el) => { if (el) cards.current.set(m.code, el); else cards.current.delete(m.code); }} className="cardwrap">
                <MatchCard m={m} actions={actions} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Сетка плей-офф деревом: линии от питающих матчей, у команд видны сиды.
// Single elimination: колонки по раундам. Double elimination: верхняя и нижняя сетки на одном полотне.
// С title сетку можно вывести на большой экран: в полноэкранном режиме нет действий, а холст подгоняется под экран.
export function BracketTree({ matches, format, actions, title }: Props): ReactNode {
  const { t } = useI18n();
  const root = useRef<HTMLDivElement>(null);
  const stageBody = useRef<HTMLDivElement>(null);
  const [onStage, setOnStage] = useState(false);
  const [scale, setScale] = useState(1);
  const [offsetX, setOffsetX] = useState(0);

  // Режим показа работает и там, где браузер не даёт полноэкранный режим: сетка всё равно занимает всё окно
  const enterStage = () => {
    setOnStage(true);
    root.current?.requestFullscreen?.().catch(() => undefined);
  };
  const exitStage = () => {
    setOnStage(false);
    if (document.fullscreenElement) void document.exitFullscreen();
  };
  useEffect(() => {
    const sync = () => { if (!document.fullscreenElement) setOnStage(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOnStage(false); };
    document.addEventListener('fullscreenchange', sync);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  useLayoutEffect(() => {
    const body = stageBody.current;
    if (!onStage || !body) return;
    const fit = () => {
      const tree = body.querySelector<HTMLElement>('.tree');
      if (!tree) return;
      const k = Math.min(body.clientWidth / tree.offsetWidth, body.clientHeight / tree.offsetHeight, 2.5);
      setScale(k);
      // Сетка, упёршаяся в высоту экрана, стоит по центру, а не прижата влево
      setOffsetX(Math.max(0, (body.clientWidth - tree.offsetWidth * k) / 2));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(body);
    return () => ro.disconnect();
  }, [onStage, matches]);

  const visible = matches.filter((m) => m.status !== 'skipped' && m.bracket !== 'G');
  const layout = useMemo(() => {
    const w = visible.filter((m) => m.bracket === 'W');
    if (format === 'single') {
      return singleLayout(w, (m) => roundLabel(t, 'W', m.roundFromEnd, 'single'));
    }
    const gfLabel = (m: MatchDto) => (m.code === 'GF-2' ? t('round.gfReset') : t('round.gf'));
    return doubleLayout(
      w, visible.filter((m) => m.bracket === 'L'), visible.filter((m) => m.bracket === 'GF'),
      (n) => t('round.wb', { n }), (n) => t('round.lb', { n }), gfLabel,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matches, format, t]);

  if (layout.ms.length === 0) return null;
  return (
    <div className={`card bracketcard${onStage ? ' stage' : ''}`} ref={root}>
      {title && (
        <div className="stagehead">
          {onStage && <img src="/logo-mark.png" alt="" />}
          {onStage && <h1>{title}</h1>}
          <span className="grow" />
          {onStage
            ? <button className="ghost" onClick={exitStage}><IconClose />{t('view.stageExit')}</button>
            : <button className="ghost" onClick={enterStage}><IconExpand />{t('view.stage')}</button>}
        </div>
      )}
      <div className="stagebody" ref={stageBody}>
        <Canvas layout={layout} actions={onStage ? undefined : actions} scale={onStage ? scale : undefined} offsetX={onStage ? offsetX : undefined} />
      </div>
    </div>
  );
}

export { Canvas, type Layout, type Pos };
