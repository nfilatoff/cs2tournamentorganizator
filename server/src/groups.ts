// Групповой этап: круговой турнир, швейцарская система, GSL-группа (double elimination на 4 команды),
// таблицы очков и формирование сетки плей-офф. Чистая логика без БД.
import { settle, type BMatch, type Entry } from './bracket.js';

export type GroupFormat = 'round_robin' | 'swiss' | 'gsl';

const TBD: Entry = { k: 'tbd' };
const team = (id: number): Entry => ({ k: 'team', id });

export function groupMatch(
  group: number, round: number, position: number,
  a: Entry, b: Entry, srcA: BMatch['srcA'], srcB: BMatch['srcB'], bestOf: number,
): BMatch {
  return {
    code: `G${group}-${round}-${position}`, bracket: 'G', round, position, srcA, srcB, a, b,
    winner: null, status: 'pending', bestOf, scoreA: 0, scoreB: 0, forced: false,
  };
}

// Раскладка по группам «змейкой»: сиды 1..G по группам, следующие G в обратном порядке и т. д.
export function assignGroups(teamIds: number[], groups: number): number[][] {
  const out: number[][] = Array.from({ length: groups }, () => []);
  teamIds.forEach((id, i) => {
    const row = Math.floor(i / groups);
    const col = i % groups;
    out[row % 2 === 0 ? col : groups - 1 - col]!.push(id);
  });
  return out;
}

// ---------- Круговой турнир ----------

// Метод круга: каждый играет с каждым по одному разу. При нечётном числе команд кто-то пропускает тур.
export function roundRobinRounds(ids: number[]): [number, number][][] {
  const list: (number | null)[] = [...ids];
  if (list.length % 2 === 1) list.push(null);
  const n = list.length;
  const rounds: [number, number][][] = [];
  for (let r = 0; r < n - 1; r++) {
    const pairs: [number, number][] = [];
    for (let i = 0; i < n / 2; i++) {
      const a = list[i];
      const b = list[n - 1 - i];
      if (a !== null && a !== undefined && b !== null && b !== undefined) pairs.push([a, b]);
    }
    rounds.push(pairs);
    list.splice(1, 0, list.pop()!); // вращение: первый элемент неподвижен
  }
  return rounds;
}

export function buildRoundRobin(group: number, ids: number[], bestOf: number): BMatch[] {
  const out: BMatch[] = [];
  roundRobinRounds(ids).forEach((pairs, r) => {
    pairs.forEach(([a, b], p) => {
      out.push(groupMatch(group, r + 1, p + 1, team(a), team(b), { t: 'seed' }, { t: 'seed' }, bestOf));
    });
  });
  settle(out);
  return out;
}

// ---------- GSL: double elimination на 4 команды ----------
// Два стартовых матча, матч победителей, матч проигравших и решающий матч. Выходят две команды.
export function buildGsl(group: number, ids: number[], bestOf: number): BMatch[] {
  if (ids.length !== 4) throw new Error('GSL needs exactly 4 teams');
  const c = (round: number, pos: number) => `G${group}-${round}-${pos}`;
  const ms = [
    groupMatch(group, 1, 1, team(ids[0]!), team(ids[3]!), { t: 'seed' }, { t: 'seed' }, bestOf),
    groupMatch(group, 1, 2, team(ids[1]!), team(ids[2]!), { t: 'seed' }, { t: 'seed' }, bestOf),
    groupMatch(group, 2, 1, TBD, TBD, { t: 'winner', code: c(1, 1) }, { t: 'winner', code: c(1, 2) }, bestOf),
    groupMatch(group, 2, 2, TBD, TBD, { t: 'loser', code: c(1, 1) }, { t: 'loser', code: c(1, 2) }, bestOf),
    groupMatch(group, 3, 1, TBD, TBD, { t: 'loser', code: c(2, 1) }, { t: 'winner', code: c(2, 2) }, bestOf),
  ];
  settle(ms);
  return ms;
}

// Итоговые места в GSL-группе (1-е, 2-е, 3-е, 4-е) или null, пока не сыграны все матчи.
export function gslOrder(ms: BMatch[]): number[] | null {
  if (ms.length !== 5 || ms.some((m) => m.status !== 'done')) return null;
  const win = (m: BMatch) => { const e = m.winner === 'a' ? m.a : m.b; return e.k === 'team' ? e.id : -1; };
  const lose = (m: BMatch) => { const e = m.winner === 'a' ? m.b : m.a; return e.k === 'team' ? e.id : -1; };
  const [, , w, l, d] = ms as [BMatch, BMatch, BMatch, BMatch, BMatch];
  return [win(w), win(d), lose(d), lose(l)];
}

// ---------- Швейцарская система ----------

export interface SwissTeam { id: number; seed: number; points: number; opponents: Set<number>; hadBye: boolean }

export function defaultSwissRounds(teams: number): number {
  return Math.max(1, Math.ceil(Math.log2(Math.max(teams, 2))));
}

function matchAll(order: SwissTeam[], avoidRematch: boolean): [number, number][] | null {
  if (order.length === 0) return [];
  const [first, ...rest] = order as [SwissTeam, ...SwissTeam[]];
  for (let i = 0; i < rest.length; i++) {
    const other = rest[i]!;
    if (avoidRematch && first.opponents.has(other.id)) continue;
    const tail = matchAll(rest.filter((_, j) => j !== i), avoidRematch);
    if (tail) return [[first.id, other.id], ...tail];
  }
  return null;
}

// Пары следующего тура: команды с равными очками играют между собой, повторных встреч нет.
// При нечётном числе команд свободный тур (bye) получает самая слабая команда, у которой его ещё не было.
export function pairSwissRound(teams: SwissTeam[], round: number): { pairs: [number, number][]; bye: number | null } {
  const bySeed = [...teams].sort((a, b) => a.seed - b.seed);
  const ranked = round === 1
    ? bySeed
    : [...teams].sort((a, b) => b.points - a.points || a.seed - b.seed);

  let bye: number | null = null;
  let field = ranked;
  const tryPair = (list: SwissTeam[]): [number, number][] | null => {
    if (round === 1) {
      // Первый тур: сильнейшая половина против слабейшей (1 играет с n/2+1)
      const half = list.length / 2;
      return list.slice(0, half).map((t, i) => [t.id, list[i + half]!.id] as [number, number]);
    }
    return matchAll(list, true) ?? matchAll(list, false);
  };

  if (field.length % 2 === 1) {
    const candidates = [...ranked].reverse().filter((t) => !t.hadBye);
    const pool = candidates.length > 0 ? candidates : [...ranked].reverse();
    for (const c of pool) {
      const rest = ranked.filter((t) => t.id !== c.id);
      const pairs = tryPair(rest);
      if (pairs) { bye = c.id; field = rest; return { pairs, bye }; }
    }
  }
  return { pairs: tryPair(field) ?? [], bye };
}

// ---------- Таблица очков ----------

export interface GroupResult { a: number; b: number; scoreA: number; scoreB: number; winner: 'a' | 'b' }

export interface StandRow {
  teamId: number;
  played: number;
  wins: number;
  losses: number;
  points: number;
  mapsFor: number;
  mapsAgainst: number;
  mapDiff: number;
  buchholz: number;
  seed: number;
  rank: number;
  // Место определено только сидом: равенство по всем критериям
  tiedBySeed: boolean;
}

const WIN_POINTS = 3;

// Критерии: очки, личные встречи между равными по очкам, разница карт, выигранные карты, Бухгольц, сид.
export function standings(
  teamIds: number[], seeds: Map<number, number>, results: GroupResult[], byes: Map<number, number> = new Map(),
): StandRow[] {
  const rows = new Map<number, StandRow>(teamIds.map((id) => [id, {
    teamId: id, played: 0, wins: 0, losses: 0, points: 0, mapsFor: 0, mapsAgainst: 0, mapDiff: 0, buchholz: 0,
    seed: seeds.get(id) ?? 9999, rank: 0, tiedBySeed: false,
  }]));
  const opponents = new Map<number, number[]>(teamIds.map((id) => [id, []]));

  for (const r of results) {
    const winner = r.winner === 'a' ? r.a : r.b;
    const loser = r.winner === 'a' ? r.b : r.a;
    const ws = r.winner === 'a' ? r.scoreA : r.scoreB;
    const ls = r.winner === 'a' ? r.scoreB : r.scoreA;
    const w = rows.get(winner);
    const l = rows.get(loser);
    if (!w || !l) continue;
    w.played++; l.played++;
    w.wins++; l.losses++;
    w.points += WIN_POINTS;
    w.mapsFor += ws; w.mapsAgainst += ls;
    l.mapsFor += ls; l.mapsAgainst += ws;
    opponents.get(winner)!.push(loser);
    opponents.get(loser)!.push(winner);
  }
  for (const [id, n] of byes) {
    const row = rows.get(id);
    if (!row) continue;
    row.played += n; row.wins += n; row.points += WIN_POINTS * n;
  }
  for (const row of rows.values()) {
    row.mapDiff = row.mapsFor - row.mapsAgainst;
    row.buchholz = (opponents.get(row.teamId) ?? []).reduce((s, o) => s + (rows.get(o)?.points ?? 0), 0);
  }

  const list = [...rows.values()].sort((x, y) => y.points - x.points || x.seed - y.seed);
  // Внутри блоков с равными очками: личные встречи, затем остальные критерии
  const ordered: StandRow[] = [];
  for (let i = 0; i < list.length;) {
    let j = i;
    while (j < list.length && list[j]!.points === list[i]!.points) j++;
    const block = list.slice(i, j);
    if (block.length > 1) {
      const ids = new Set(block.map((b) => b.teamId));
      const h2h = new Map<number, number>(block.map((b) => [b.teamId, 0]));
      for (const r of results) {
        if (!ids.has(r.a) || !ids.has(r.b)) continue;
        const winner = r.winner === 'a' ? r.a : r.b;
        h2h.set(winner, (h2h.get(winner) ?? 0) + 1);
      }
      block.sort((x, y) =>
        (h2h.get(y.teamId)! - h2h.get(x.teamId)!) || y.mapDiff - x.mapDiff || y.mapsFor - x.mapsFor
        || y.buchholz - x.buchholz || x.seed - y.seed);
      for (let k = 0; k + 1 < block.length; k++) {
        const x = block[k]!; const y = block[k + 1]!;
        if (h2h.get(x.teamId) === h2h.get(y.teamId) && x.mapDiff === y.mapDiff && x.mapsFor === y.mapsFor && x.buchholz === y.buchholz) {
          x.tiedBySeed = true; y.tiedBySeed = true;
        }
      }
    }
    ordered.push(...block);
    i = j;
  }
  ordered.forEach((row, idx) => { row.rank = idx + 1; });
  return ordered;
}

// ---------- Выход из групп в плей-офф ----------

// Порядок сидов плей-офф: лучшие места всех групп идут первыми, а соперники по первому раунду
// (сид i против сида N+1-i) всегда из разных групп. perGroup: команды групп по местам, 1-е место первым.
export function playoffOrder(perGroup: number[][], advance: number): number[] {
  const g = perGroup.length;
  if (g === 1) return perGroup[0]!.slice(0, advance);
  // Порядок групп в «нижних» блоках: сдвиг на одну группу, чтобы не встретить свою же группу в первом раунде
  const lower = Array.from({ length: g }, (_, j) => ((g - j - 1 + 1) % g));
  const out: number[] = [];
  for (let rank = 0; rank < advance; rank++) {
    const upperHalf = rank < advance / 2;
    const order = upperHalf || (advance % 2 === 1 && rank === (advance - 1) / 2)
      ? Array.from({ length: g }, (_, j) => j)
      : lower;
    for (const gi of order) {
      const id = perGroup[gi]?.[rank];
      if (id !== undefined) out.push(id);
    }
  }
  return out;
}
