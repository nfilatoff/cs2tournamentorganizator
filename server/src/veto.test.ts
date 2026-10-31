import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AppError } from './errors.js';
import {
  applyAction, autoComplete, isDone, newVeto, nextAction, remaining, vetoResult, vetoTemplate,
} from './veto.js';

const pool = (n: number) => Array.from({ length: n }, (_, i) => i + 1);
const kinds = (n: number, bo: number) => vetoTemplate(n, bo).map((s) => `${s.team ?? '-'}:${s.kind}`).join(' ');

test('шаблоны для пула из 7 карт совпадают с профессиональными', () => {
  assert.equal(kinds(7, 1), 'a:ban b:ban a:ban b:ban a:ban b:ban -:decider');
  assert.equal(kinds(7, 3), 'a:ban b:ban a:pick b:pick a:ban b:ban -:decider');
  assert.equal(kinds(7, 5), 'a:ban b:ban a:pick b:pick a:pick b:pick -:decider');
});

test('шаблон: каждая карта получает ровно один шаг, пиков bestOf-1, решающая одна', () => {
  for (let n = 1; n <= 7; n++) {
    for (const bo of [1, 3, 5]) {
      if (bo > n) { assert.throws(() => vetoTemplate(n, bo)); continue; }
      const tpl = vetoTemplate(n, bo);
      assert.equal(tpl.length, n, `n=${n} bo=${bo}`);
      assert.equal(tpl.filter((s) => s.kind === 'pick').length, bo - 1);
      assert.equal(tpl.filter((s) => s.kind === 'decider').length, 1);
      assert.equal(tpl[tpl.length - 1]!.kind, 'decider');
    }
  }
});

test('BO3: полное вето с выбором сторон', () => {
  let s = newVeto(pool(7), 3);
  s = applyAction(s, 'a', { mapId: 1 });            // A банит 1
  s = applyAction(s, 'b', { mapId: 2 });            // B банит 2
  s = applyAction(s, 'a', { mapId: 3 });            // A пикает 3
  assert.deepEqual(nextAction(s), { type: 'side', team: 'b' });
  s = applyAction(s, 'b', { side: 'ct' });          // B выбирает CT на карте 3
  s = applyAction(s, 'b', { mapId: 4 });            // B пикает 4
  assert.deepEqual(nextAction(s), { type: 'side', team: 'a' });
  s = applyAction(s, 'a', { side: 't' });           // A выбирает T на карте 4
  s = applyAction(s, 'a', { mapId: 5 });            // A банит 5
  s = applyAction(s, 'b', { mapId: 6 });            // B банит 6
  assert.ok(isDone(s));
  assert.deepEqual(remaining(s), []);
  assert.deepEqual(vetoResult(s), [
    { mapId: 3, side: 'team2_ct', pickedBy: 'a' },
    { mapId: 4, side: 'team1_t', pickedBy: 'b' },
    { mapId: 7, side: 'knife', pickedBy: null },
  ]);
});

test('BO1: остаётся одна карта на ноже', () => {
  let s = newVeto(pool(7), 1);
  for (let i = 1; i <= 6; i++) s = applyAction(s, i % 2 === 1 ? 'a' : 'b', { mapId: i });
  assert.ok(isDone(s));
  assert.deepEqual(vetoResult(s), [{ mapId: 7, side: 'knife', pickedBy: null }]);
});

test('недопустимые ходы отклоняются', () => {
  const s0 = newVeto(pool(7), 3);
  const code = (fn: () => unknown) => { try { fn(); } catch (e) { return (e as AppError).code; } return 'ok'; };
  assert.equal(code(() => applyAction(s0, 'b', { mapId: 1 })), 'vetoNotYourTurn');
  assert.equal(code(() => applyAction(s0, 'a', { mapId: 99 })), 'vetoBadMap');
  assert.equal(code(() => applyAction(s0, 'a', {})), 'vetoBadMap');
  assert.equal(code(() => applyAction(s0, 'a', { side: 'ct' })), 'vetoBadMap');
  const s1 = applyAction(applyAction(applyAction(s0, 'a', { mapId: 1 }), 'b', { mapId: 2 }), 'a', { mapId: 3 });
  assert.equal(code(() => applyAction(s1, 'a', { side: 'ct' })), 'vetoNotYourTurn');
  assert.equal(code(() => applyAction(s1, 'b', { mapId: 4 })), 'vetoBadSide', 'после пика нужна сторона');
  assert.equal(code(() => applyAction(s1, 'b', { side: 'x' as never })), 'vetoBadSide');
  const s2 = applyAction(s0, 'a', { mapId: 1 });
  assert.equal(code(() => applyAction(s2, 'b', { mapId: 1 })), 'vetoBadMap', 'забаненную карту выбрать нельзя');
  assert.equal(code(() => vetoResult(s0)), 'vetoPending');
});

test('autoComplete завершает любое вето корректно', () => {
  let seed = 11;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let n = 1; n <= 7; n++) {
    for (const bo of [1, 3, 5]) {
      if (bo > n) continue;
      const s = autoComplete(newVeto(pool(n), bo), rnd);
      assert.ok(isDone(s), `n=${n} bo=${bo}`);
      const res = vetoResult(s);
      assert.equal(res.length, bo, `n=${n} bo=${bo}: карт в серии`);
      assert.equal(new Set(res.map((r) => r.mapId)).size, bo, 'карты не повторяются');
      assert.equal(res[res.length - 1]!.side, 'knife');
      for (const r of res.slice(0, -1)) assert.match(r.side, /^team[12]_(ct|t)$/);
      // каждая карта пула использована ровно в одном шаге
      assert.equal(s.actions.length, n);
    }
  }
});

test('если банов нет (пул равен серии), начинаются сразу пики', () => {
  const s = newVeto(pool(3), 3);
  assert.deepEqual(nextAction(s), { type: 'pick', team: 'a' });
});
