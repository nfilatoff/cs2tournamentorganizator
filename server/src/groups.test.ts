import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assignGroups, buildGsl, buildRoundRobin, defaultSwissRounds, gslOrder, pairSwissRound, playoffOrder,
  roundRobinRounds, standings, type GroupResult, type SwissTeam,
} from './groups.js';
import { reportResult, seedOrder } from './bracket.js';

const ids = (n: number) => Array.from({ length: n }, (_, i) => i + 1);

test('assignGroups раскладывает сиды змейкой', () => {
  assert.deepEqual(assignGroups(ids(8), 2), [[1, 4, 5, 8], [2, 3, 6, 7]]);
  assert.deepEqual(assignGroups(ids(6), 3), [[1, 6], [2, 5], [3, 4]]);
  assert.deepEqual(assignGroups(ids(5), 1), [[1, 2, 3, 4, 5]]);
});

test('круговой турнир: каждая пара ровно один раз, для чётного и нечётного числа команд', () => {
  for (let n = 2; n <= 9; n++) {
    const rounds = roundRobinRounds(ids(n));
    assert.equal(rounds.length, n % 2 === 0 ? n - 1 : n, `n=${n}: число туров`);
    const seen = new Set<string>();
    for (const round of rounds) {
      const inRound = new Set<number>();
      for (const [a, b] of round) {
        const key = [a, b].sort((x, y) => x - y).join('-');
        assert.ok(!seen.has(key), `n=${n}: пара ${key} повторилась`);
        seen.add(key);
        assert.ok(!inRound.has(a) && !inRound.has(b), `n=${n}: команда играет дважды в туре`);
        inRound.add(a); inRound.add(b);
      }
    }
    assert.equal(seen.size, (n * (n - 1)) / 2, `n=${n}: число матчей`);
  }
});

test('buildRoundRobin создаёт готовые матчи', () => {
  const ms = buildRoundRobin(2, ids(4), 3);
  assert.equal(ms.length, 6);
  assert.ok(ms.every((m) => m.status === 'ready' && m.bracket === 'G' && m.bestOf === 3));
  assert.equal(ms[0]!.code, 'G2-1-1');
});

test('GSL: любой исход даёт полный набор из 4 мест и ровно 5 матчей', () => {
  for (let mask = 0; mask < 32; mask++) {
    const ms = buildGsl(1, [10, 20, 30, 40], 1);
    assert.equal(ms.filter((m) => m.status === 'ready').length, 2);
    let i = 0;
    while (ms.some((m) => m.status !== 'done')) {
      const m = ms.find((x) => x.status === 'ready');
      assert.ok(m, `mask=${mask}: нет готового матча`);
      reportResult(ms, m.code, (mask >> i) & 1 ? 1 : 0, (mask >> i) & 1 ? 0 : 1);
      i++;
    }
    assert.equal(i, 5, 'сыграно ровно 5 матчей');
    const order = gslOrder(ms)!;
    assert.deepEqual([...order].sort((a, b) => a - b), [10, 20, 30, 40], `mask=${mask}: места`);
  }
});

test('GSL: победитель матча победителей занимает 1 место', () => {
  const ms = buildGsl(1, [1, 2, 3, 4], 1);
  reportResult(ms, 'G1-1-1', 1, 0); // 1 победил 4
  reportResult(ms, 'G1-1-2', 1, 0); // 2 победил 3
  reportResult(ms, 'G1-2-1', 1, 0); // 1 победил 2
  reportResult(ms, 'G1-2-2', 1, 0); // 4 победил 3
  const d = ms.find((m) => m.code === 'G1-3-1')!;
  assert.deepEqual([d.a, d.b], [{ k: 'team', id: 2 }, { k: 'team', id: 4 }]);
  reportResult(ms, 'G1-3-1', 0, 1);
  assert.deepEqual(gslOrder(ms), [1, 4, 2, 3]);
});

function playSwiss(n: number, rnd: () => number) {
  const rounds = defaultSwissRounds(n);
  const points = new Map<number, number>(ids(n).map((id) => [id, 0]));
  const opponents = new Map<number, Set<number>>(ids(n).map((id) => [id, new Set()]));
  const hadBye = new Set<number>();
  const results: GroupResult[] = [];
  const byes = new Map<number, number>();
  for (let r = 1; r <= rounds; r++) {
    const teams: SwissTeam[] = ids(n).map((id) => ({ id, seed: id, points: points.get(id)!, opponents: opponents.get(id)!, hadBye: hadBye.has(id) }));
    const { pairs, bye } = pairSwissRound(teams, r);
    const inRound = new Set<number>();
    for (const [a, b] of pairs) {
      assert.ok(!inRound.has(a) && !inRound.has(b), `n=${n} r=${r}: команда в двух парах`);
      assert.ok(!opponents.get(a)!.has(b), `n=${n} r=${r}: повторная встреча ${a}-${b}`);
      inRound.add(a); inRound.add(b);
      opponents.get(a)!.add(b); opponents.get(b)!.add(a);
      const winner = rnd() < 0.5 ? 'a' : 'b';
      results.push({ a, b, scoreA: winner === 'a' ? 1 : 0, scoreB: winner === 'b' ? 1 : 0, winner });
      points.set(winner === 'a' ? a : b, points.get(winner === 'a' ? a : b)! + 3);
    }
    if (bye !== null) {
      assert.ok(!hadBye.has(bye), `n=${n} r=${r}: bye дважды у ${bye}`);
      hadBye.add(bye); inRound.add(bye);
      byes.set(bye, (byes.get(bye) ?? 0) + 1);
      points.set(bye, points.get(bye)! + 3);
    }
    assert.equal(inRound.size, n, `n=${n} r=${r}: не все команды заняты`);
  }
  return { results, byes };
}

test('Swiss: нет повторных встреч, каждый играет каждый тур, bye не дважды', () => {
  for (let n = 4; n <= 17; n++) {
    let seed = n * 13 + 7;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let rep = 0; rep < 5; rep++) playSwiss(n, rnd);
  }
});

test('таблица очков: очки, разница карт, личная встреча и сид', () => {
  const seeds = new Map([[1, 1], [2, 2], [3, 3]]);
  // 1 бьёт 2, 2 бьёт 3, 3 бьёт 1: у всех по 3 очка, решает разница карт
  const results: GroupResult[] = [
    { a: 1, b: 2, scoreA: 2, scoreB: 0, winner: 'a' },
    { a: 2, b: 3, scoreA: 2, scoreB: 1, winner: 'a' },
    { a: 3, b: 1, scoreA: 2, scoreB: 1, winner: 'a' },
  ];
  const rows = standings([1, 2, 3], seeds, results);
  assert.deepEqual(rows.map((r) => r.teamId), [1, 3, 2]);
  assert.equal(rows[0]!.points, 3);
  assert.equal(rows[0]!.mapDiff, 1);
  // личная встреча важнее разницы карт
  const two = standings([1, 2], new Map([[1, 2], [2, 1]]), [{ a: 1, b: 2, scoreA: 1, scoreB: 0, winner: 'a' }]);
  assert.deepEqual(two.map((r) => r.teamId), [1, 2]);
  // равенство по всему решает сид и помечается
  const tie = standings([1, 2], new Map([[1, 1], [2, 2]]), []);
  assert.deepEqual(tie.map((r) => r.teamId), [1, 2]);
  assert.ok(tie.every((r) => r.tiedBySeed));
});

test('bye в Swiss засчитывается победой', () => {
  const rows = standings([1, 2, 3], new Map([[1, 1], [2, 2], [3, 3]]), [], new Map([[3, 1]]));
  assert.equal(rows[0]!.teamId, 3);
  assert.equal(rows[0]!.points, 3);
  assert.equal(rows[0]!.wins, 1);
});

test('playoffOrder: в первом раунде соперники из разных групп', () => {
  const cases: [number, number][] = [[2, 2], [4, 2], [8, 2], [2, 4], [4, 4], [3, 2], [5, 2], [6, 2]];
  for (const [g, advance] of cases) {
    const perGroup = Array.from({ length: g }, (_, gi) => Array.from({ length: advance }, (_, r) => (gi + 1) * 100 + r + 1));
    const order = playoffOrder(perGroup, advance);
    assert.equal(order.length, g * advance);
    const groupOf = (id: number) => Math.floor(id / 100);
    const n = order.length;
    // для степени двойки первая пара i и n+1-i
    if ((n & (n - 1)) === 0) {
      const o = seedOrder(n);
      for (let i = 0; i < n; i += 2) {
        const a = order[o[i]! - 1]!;
        const b = order[o[i + 1]! - 1]!;
        assert.notEqual(groupOf(a), groupOf(b), `g=${g} adv=${advance}: ${a} против ${b}`);
      }
    }
  }
  // одна группа (Swiss): просто лучшие по таблице
  assert.deepEqual(playoffOrder([[5, 6, 7, 8]], 3), [5, 6, 7]);
});
