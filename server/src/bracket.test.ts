import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBracket, champion, reportResult, seedOrder, type BMatch, type Format } from './bracket.js';

const ids = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
const real = (ms: BMatch[]) => ms.filter((m) => m.status !== 'bye' && m.status !== 'skipped');

// Играет турнир до конца. pick решает, победит ли сторона a (true) или b.
function play(n: number, format: Format, reset: boolean, pick: (m: BMatch) => boolean) {
  const ms = buildBracket(ids(n), format, { grandFinalReset: reset });
  const losses = new Map<number, number>();
  const wins = new Map<number, number>();
  for (let guard = 0; guard < 1000; guard++) {
    const m = ms.find((x) => x.status === 'ready');
    if (!m) break;
    assert.equal(m.a.k, 'team');
    assert.equal(m.b.k, 'team');
    assert.notDeepEqual(m.a, m.b, `${m.code}: команда играет сама с собой`);
    const aWins = pick(m);
    const need = Math.ceil(m.bestOf / 2);
    reportResult(ms, m.code, aWins ? need : 0, aWins ? 0 : need);
    const [w, l] = aWins ? [m.a, m.b] : [m.b, m.a];
    if (w.k === 'team') wins.set(w.id, (wins.get(w.id) ?? 0) + 1);
    if (l.k === 'team') losses.set(l.id, (losses.get(l.id) ?? 0) + 1);
  }
  return { ms, losses, wins };
}

test('seedOrder', () => {
  assert.deepEqual(seedOrder(4), [1, 4, 2, 3]);
  assert.deepEqual(seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
});

test('single elimination: n-1 матчей и чемпион для любого n', () => {
  for (let n = 2; n <= 33; n++) {
    for (const pickA of [true, false]) {
      const { ms } = play(n, 'single', true, () => pickA);
      assert.equal(real(ms).length, n - 1, `n=${n}`);
      assert.ok(champion(ms, 'single') !== null, `n=${n}: нет чемпиона`);
      assert.ok(ms.every((m) => m.status === 'done' || m.status === 'bye'), `n=${n}: остались несыгранные`);
    }
  }
});

test('double elimination: каждый вылетает после двух поражений', () => {
  for (let n = 3; n <= 33; n++) {
    for (const reset of [true, false]) {
      for (const mode of ['a', 'b', 'rnd'] as const) {
        let seed = n * 7 + 1;
        const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % 2) === 0;
        const { ms, losses } = play(n, 'double', reset, (m) => (mode === 'a' ? true : mode === 'b' ? false : rnd()));
        const label = `n=${n} reset=${reset} mode=${mode}`;
        const champ = champion(ms, 'double');
        assert.ok(champ !== null, `${label}: нет чемпиона`);
        assert.ok(ms.every((m) => ['done', 'bye', 'skipped'].includes(m.status)), `${label}: остались несыгранные`);
        // Без переигровки проигравший гранд-финал чемпиону нижней сетки остаётся с одним поражением.
        const gf1 = ms.find((m) => m.code === 'GF-1')!;
        const runnerUp = !reset && gf1.winner === 'b' && gf1.a.k === 'team' ? gf1.a.id : null;
        for (let t = 1; t <= n; t++) {
          const l = losses.get(t) ?? 0;
          assert.ok(l <= 2, `${label}: команда ${t} проиграла ${l} раз`);
          if (t !== champ) assert.equal(l, t === runnerUp ? 1 : 2, `${label}: команда ${t} вылетела с ${l} поражениями`);
        }
        const played = real(ms).length;
        const gf2Played = ms.some((m) => m.code === 'GF-2' && m.status === 'done');
        assert.equal(played, 2 * n - 2 + (gf2Played ? 1 : 0), `${label}: число матчей`);
      }
    }
  }
});

test('BO3: счёт проверяется', () => {
  const ms = buildBracket(ids(4), 'single', { bestOf: () => 3 });
  const m = ms.find((x) => x.status === 'ready')!;
  assert.throws(() => reportResult(ms, m.code, 1, 1));
  assert.throws(() => reportResult(ms, m.code, 3, 0));
  reportResult(ms, m.code, 2, 1);
  assert.equal(m.status, 'done');
  assert.equal(m.winner, 'a');
  assert.throws(() => reportResult(ms, m.code, 2, 0), /уже сыгран|не готов/);
});

test('bye получают лучшие сиды', () => {
  const ms = buildBracket(ids(6), 'single');
  const byes = ms.filter((m) => m.status === 'bye' && m.round === 1);
  assert.equal(byes.length, 2);
  const w2 = ms.filter((m) => m.round === 2).flatMap((m) => [m.a, m.b]);
  assert.ok(w2.some((e) => e.k === 'team' && e.id === 1));
  assert.ok(w2.some((e) => e.k === 'team' && e.id === 2));
});
