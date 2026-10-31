import { AppError } from './errors.js';
// Движок сеток: чистая логика без БД. Поддерживает single и double elimination
// для любого числа команд (недостающие места до степени двойки заполняются bye).

export type Format = 'single' | 'double';
export type BracketId = 'W' | 'L' | 'GF' | 'G';

export type Source =
  | { t: 'seed' }
  | { t: 'winner'; code: string }
  | { t: 'loser'; code: string }
  // Участник из слота другого матча (для переигровки гранд-финала)
  | { t: 'slot'; code: string; side: 'a' | 'b' };

export type Entry = { k: 'tbd' } | { k: 'team'; id: number } | { k: 'bye' };
export type Status = 'pending' | 'ready' | 'live' | 'done' | 'bye' | 'skipped';

export interface BMatch {
  code: string;
  bracket: BracketId;
  round: number;
  position: number;
  srcA: Source;
  srcB: Source;
  a: Entry;
  b: Entry;
  winner: 'a' | 'b' | null;
  status: Status;
  bestOf: number;
  scoreA: number;
  scoreB: number;
  // Победитель назначен админом, а не по счёту
  forced: boolean;
}

const TBD: Entry = { k: 'tbd' };
const BYE: Entry = { k: 'bye' };

export function bracketExponent(teamCount: number): number {
  return Math.max(1, Math.ceil(Math.log2(Math.max(teamCount, 2))));
}

// Порядок посева в первом раунде: 1 играет с последним, лучшие получают bye.
export function seedOrder(size: number): number[] {
  let order = [1, 2];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((x) => [x, n + 1 - x]);
  }
  return order;
}

function mk(bracket: BracketId, round: number, position: number, srcA: Source, srcB: Source): BMatch {
  const code = bracket === 'GF' ? `GF-${round}` : `${bracket}${round}-${position}`;
  return {
    code, bracket, round, position, srcA, srcB,
    a: TBD, b: TBD, winner: null, status: 'pending', bestOf: 1, scoreA: 0, scoreB: 0, forced: false,
  };
}

const win = (code: string): Source => ({ t: 'winner', code });
const lose = (code: string): Source => ({ t: 'loser', code });

export function minTeams(format: Format): number {
  return 2;
}

// teamIds: команды в порядке посева (первая = сид 1).
export function buildBracket(
  teamIds: number[],
  format: Format,
  opts: { grandFinalReset?: boolean; bestOf?: (bracket: BracketId, roundFromEnd: number) => number } = {},
): BMatch[] {
  if (teamIds.length < minTeams(format)) throw new AppError('tooFewTeams');
  const k = bracketExponent(teamIds.length);
  const size = 2 ** k;
  const order = seedOrder(size);
  const matches: BMatch[] = [];

  // Верхняя сетка
  for (let r = 1; r <= k; r++) {
    const count = size / 2 ** r;
    for (let i = 0; i < count; i++) {
      matches.push(
        r === 1
          ? mk('W', 1, i + 1, { t: 'seed' }, { t: 'seed' })
          : mk('W', r, i + 1, win(`W${r - 1}-${2 * i + 1}`), win(`W${r - 1}-${2 * i + 2}`)),
      );
    }
  }
  for (const m of matches) {
    if (m.round !== 1) continue;
    const seedA = order[2 * (m.position - 1)]!;
    const seedB = order[2 * (m.position - 1) + 1]!;
    m.a = seedA <= teamIds.length ? { k: 'team', id: teamIds[seedA - 1]! } : BYE;
    m.b = seedB <= teamIds.length ? { k: 'team', id: teamIds[seedB - 1]! } : BYE;
  }

  if (format === 'double') {
    // Нижняя сетка: на каждой стадии s две серии раундов по size / 2^(s+1) матчей.
    for (let s = 1; s <= k - 1; s++) {
      const count = size / 2 ** (s + 1);
      const odd = 2 * s - 1;
      const even = 2 * s;
      for (let i = 0; i < count; i++) {
        matches.push(
          s === 1
            ? mk('L', odd, i + 1, lose(`W1-${2 * i + 1}`), lose(`W1-${2 * i + 2}`))
            : mk('L', odd, i + 1, win(`L${odd - 1}-${2 * i + 1}`), win(`L${odd - 1}-${2 * i + 2}`)),
        );
      }
      for (let i = 0; i < count; i++) {
        // Проигравшие верхней сетки идут в обратном порядке, чтобы не встречаться повторно слишком рано.
        matches.push(mk('L', even, i + 1, win(`L${odd}-${i + 1}`), lose(`W${s + 1}-${count - i}`)));
      }
    }
    const lastL = 2 * k - 2;
    // На 2 командах нижней сетки нет: проигравший единственного матча сразу идёт в гранд-финал
    matches.push(mk('GF', 1, 1, win(`W${k}-1`), k === 1 ? lose('W1-1') : win(`L${lastL}-1`)));
    // На 2 командах переигровка обязательна: иначе чемпион определялся бы при счёте 1:1
    if ((opts.grandFinalReset ?? true) || k === 1) {
      matches.push(mk('GF', 2, 1, { t: 'slot', code: 'GF-1', side: 'a' }, { t: 'slot', code: 'GF-1', side: 'b' }));
    }
  }

  for (const m of matches) {
    m.bestOf = opts.bestOf?.(m.bracket, roundFromEnd(matches, m)) ?? 1;
  }
  settle(matches);
  return matches;
}

export function maxRound(matches: BMatch[], bracket: BracketId): number {
  return matches.reduce((acc, m) => (m.bracket === bracket ? Math.max(acc, m.round) : acc), 0);
}

// 1 = последний раунд своей сетки (финал), 2 = предпоследний и т.д.
export function roundFromEnd(matches: BMatch[], m: Pick<BMatch, 'bracket' | 'round'>): number {
  return maxRound(matches, m.bracket) - m.round + 1;
}

// Пересчитывает участников и статусы по источникам, пока есть изменения.
export function settle(matches: BMatch[]): void {
  const byCode = new Map(matches.map((m) => [m.code, m]));

  const outcome = (code: string, which: 'winner' | 'loser'): Entry => {
    const m = byCode.get(code);
    if (!m) return TBD;
    if (m.status === 'skipped') return BYE;
    if (m.status !== 'done' && m.status !== 'bye') return TBD;
    const w = m.winner === 'a' ? m.a : m.b;
    const l = m.winner === 'a' ? m.b : m.a;
    return which === 'winner' ? w : l;
  };

  const resolve = (src: Source, current: Entry): Entry => {
    switch (src.t) {
      case 'seed': return current;
      case 'winner': return outcome(src.code, 'winner');
      case 'loser': return outcome(src.code, 'loser');
      case 'slot': {
        const m = byCode.get(src.code);
        return m && m.status === 'done' ? (src.side === 'a' ? m.a : m.b) : TBD;
      }
    }
  };

  const same = (x: Entry, y: Entry) => x.k === y.k && (x.k !== 'team' || (y.k === 'team' && x.id === y.id));

  let changed = true;
  while (changed) {
    changed = false;
    for (const m of matches) {
      if (m.status === 'done' || m.status === 'live' || m.status === 'bye' || m.status === 'skipped') continue;
      const a = resolve(m.srcA, m.a);
      const b = resolve(m.srcB, m.b);
      let status: Status = 'pending';
      let winner: 'a' | 'b' | null = null;
      if (a.k === 'bye' && b.k === 'bye') { status = 'bye'; winner = 'a'; }
      else if (a.k === 'bye' && b.k === 'team') { status = 'bye'; winner = 'b'; }
      else if (b.k === 'bye' && a.k === 'team') { status = 'bye'; winner = 'a'; }
      else if (a.k === 'team' && b.k === 'team') status = 'ready';

      if (!same(a, m.a) || !same(b, m.b) || status !== m.status || winner !== m.winner) {
        m.a = a; m.b = b; m.status = status; m.winner = winner;
        changed = true;
      }
    }
  }
}

// Фиксирует результат матча и продвигает участников. Бросает ошибку при неверных данных.
export function reportResult(matches: BMatch[], code: string, scoreA: number, scoreB: number): void {
  const m = matches.find((x) => x.code === code);
  if (!m) throw new AppError('matchNotFound');
  if (m.status !== 'ready' && m.status !== 'live') throw new AppError('matchNotReady');
  const need = Math.ceil(m.bestOf / 2);
  const hi = Math.max(scoreA, scoreB);
  const lo = Math.min(scoreA, scoreB);
  if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB) || hi !== need || lo >= need || lo < 0) {
    throw new AppError('scoreInvalid', { bo: m.bestOf, need });
  }
  m.scoreA = scoreA;
  m.scoreB = scoreB;
  finish(matches, m, scoreA > scoreB ? 'a' : 'b', false);
}

// Админ назначает победителя без счёта (например, при неявке или сбое сервера).
export function forceWinner(matches: BMatch[], code: string, winner: 'a' | 'b'): void {
  const m = matches.find((x) => x.code === code);
  if (!m) throw new AppError('matchNotFound');
  if (m.status !== 'ready' && m.status !== 'live') throw new AppError('matchNotReady');
  finish(matches, m, winner, true);
}

function finish(matches: BMatch[], m: BMatch, winner: 'a' | 'b', forced: boolean): void {
  m.winner = winner;
  m.forced = forced;
  m.status = 'done';
  // Если чемпион верхней сетки выиграл первый гранд-финал, переигровка не нужна.
  if (m.code === 'GF-1' && m.winner === 'a') {
    const reset = matches.find((x) => x.code === 'GF-2');
    if (reset) reset.status = 'skipped';
  }
  settle(matches);
}

// Отменяет результат матча. Нельзя, если следующие матчи уже сыграны или идут:
// сначала нужно отменить их результаты.
export function undoResult(matches: BMatch[], code: string): void {
  const target = matches.find((x) => x.code === code);
  if (!target) throw new AppError('matchNotFound');
  if (target.status !== 'done') throw new AppError('noResult');

  const refs = (m: BMatch, c: string) =>
    [m.srcA, m.srcB].some((s) => s.t !== 'seed' && s.code === c);
  const dependents = new Set<string>();
  const queue = [code];
  while (queue.length > 0) {
    const cur = queue.pop()!;
    for (const m of matches) {
      if (refs(m, cur) && !dependents.has(m.code)) {
        dependents.add(m.code);
        queue.push(m.code);
      }
    }
  }
  const blocking = matches.filter((m) => dependents.has(m.code) && (m.status === 'done' || m.status === 'live'));
  if (blocking.length > 0) {
    throw new AppError('undoBlocked', { matches: blocking.map((m) => m.code).join(', ') });
  }

  for (const m of matches) {
    if (!dependents.has(m.code)) continue;
    m.status = 'pending';
    m.winner = null;
    m.forced = false;
    m.scoreA = 0;
    m.scoreB = 0;
    if (m.srcA.t !== 'seed') m.a = TBD;
    if (m.srcB.t !== 'seed') m.b = TBD;
  }
  target.status = 'pending';
  target.winner = null;
  target.forced = false;
  target.scoreA = 0;
  target.scoreB = 0;
  settle(matches);
}

// ID команды-чемпиона или null, если турнир не закончен.
export function champion(matches: BMatch[], format: Format): number | null {
  const entryOf = (m: BMatch | undefined): number | null => {
    if (!m || m.status !== 'done') return null;
    const e = m.winner === 'a' ? m.a : m.b;
    return e.k === 'team' ? e.id : null;
  };
  const get = (code: string) => matches.find((x) => x.code === code);
  if (format === 'single') {
    const k = maxRound(matches, 'W');
    const final = get(`W${k}-1`);
    return final && (final.status === 'done' || final.status === 'bye') ? entryOf({ ...final, status: 'done' }) : null;
  }
  const gf2 = get('GF-2');
  if (gf2 && gf2.status === 'done') return entryOf(gf2);
  const gf1 = get('GF-1');
  if (gf1 && gf1.status === 'done' && (gf1.winner === 'a' || !gf2)) return entryOf(gf1);
  return null;
}
