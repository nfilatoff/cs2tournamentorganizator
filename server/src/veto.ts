// Вето карт: баны и пики по очереди, выбор стороны соперником. Чистая логика без БД.
//
// Порядок как в профессиональных турнирах (пул 7 карт, первой ходит команда A):
//   BO1: 6 банов, оставшаяся карта играется на ноже.
//   BO3: бан, бан, пик, пик, бан, бан, решающая карта (нож).
//   BO5: бан, бан, пик, пик, пик, пик, решающая карта (нож).
// После каждого пика соперник выбирает сторону на этой карте.
import { AppError } from './errors.js';

export type Team = 'a' | 'b';
export type Side = 'ct' | 't';
export type StepKind = 'ban' | 'pick' | 'decider';

export interface TemplateStep { kind: StepKind; team: Team | null }

export interface VetoAction {
  mapId: number;
  kind: StepKind;
  by: Team | null;
  // Сторона, которую выбрал соперник пикнувшей команды (только для пиков)
  side?: Side;
}

// sides: false отключает выбор стороны, тогда пики играются на ноже (в старых сохранённых вето поля нет, это значит true).
// ready: какие капитаны подтвердили готовность; вето начинается, когда готовы оба.
// turnStartedAt: когда начался текущий ход (мс), от него считается время на ход.
export interface VetoState {
  poolIds: number[]; bestOf: number; actions: VetoAction[]; sides?: boolean;
  ready?: { a?: boolean; b?: boolean }; turnStartedAt?: number;
}

export type Next =
  | { type: 'ban' | 'pick' | 'side'; team: Team }
  | { type: 'done' };

const other = (t: Team): Team => (t === 'a' ? 'b' : 'a');

// Шаги вето для пула из poolSize карт. Каждый шаг убирает одну карту, последний шаг — решающая карта.
export function vetoTemplate(poolSize: number, bestOf: number): TemplateStep[] {
  if (poolSize < bestOf) throw new AppError('poolTooSmall', { have: poolSize, need: bestOf });
  const picks = bestOf - 1;
  const bans = poolSize - picks - 1;
  const kinds: StepKind[] = [];
  if (bestOf === 1) {
    for (let i = 0; i < bans; i++) kinds.push('ban');
  } else {
    const leading = Math.min(bans, 2);
    for (let i = 0; i < leading; i++) kinds.push('ban');
    for (let i = 0; i < picks; i++) kinds.push('pick');
    for (let i = 0; i < bans - leading; i++) kinds.push('ban');
  }
  kinds.push('decider');
  return kinds.map((kind, i) => ({ kind, team: kind === 'decider' ? null : i % 2 === 0 ? 'a' : 'b' }));
}

export function newVeto(poolIds: number[], bestOf: number, sides = true): VetoState {
  return { poolIds: [...poolIds], bestOf, actions: [], ...(sides ? {} : { sides: false }), ready: {} };
}

// Вето началось, когда оба капитана готовы. В старых сохранённых вето готовности нет: там начавшимся считается вето с ходами.
export const vetoStarted = (s: VetoState): boolean => (s.ready ? !!s.ready.a && !!s.ready.b : s.actions.length > 0);

// Капитан (или админ за обе команды) подтверждает готовность. С готовностью второго начинается первый ход.
export function markReady(s: VetoState, team: Team | 'both', now: number): VetoState {
  if (vetoStarted(s)) return s;
  const ready = { ...s.ready, ...(team === 'both' ? { a: true, b: true } : { [team]: true }) };
  const next = { ...s, ready };
  return vetoStarted(next) ? { ...next, turnStartedAt: now } : next;
}

const hasSides = (s: VetoState): boolean => s.sides !== false;
const pendingSide = (s: VetoState): boolean => {
  const last = s.actions[s.actions.length - 1];
  return hasSides(s) && !!last && last.kind === 'pick' && !last.side;
};

export const remaining = (s: VetoState): number[] => {
  const used = new Set(s.actions.map((a) => a.mapId));
  return s.poolIds.filter((id) => !used.has(id));
};

export function nextAction(s: VetoState): Next {
  const tpl = vetoTemplate(s.poolIds.length, s.bestOf);
  const last = s.actions[s.actions.length - 1];
  if (pendingSide(s)) return { type: 'side', team: other(last!.by!) };
  const step = tpl[s.actions.length];
  if (!step) return { type: 'done' };
  if (step.kind === 'decider') return { type: 'done' };
  return { type: step.kind, team: step.team! };
}

// Решающая карта назначается сама, когда осталась одна карта
function settleDecider(s: VetoState): VetoState {
  const tpl = vetoTemplate(s.poolIds.length, s.bestOf);
  const step = tpl[s.actions.length];
  const left = remaining(s);
  if (!pendingSide(s) && step?.kind === 'decider' && left.length === 1) {
    return { ...s, actions: [...s.actions, { mapId: left[0]!, kind: 'decider', by: null }] };
  }
  return s;
}

export const isDone = (s: VetoState): boolean => {
  const settled = settleDecider(s);
  return nextAction(settled).type === 'done' && settled.actions.length === vetoTemplate(s.poolIds.length, s.bestOf).length;
};

// Применяет ход команды. Бросает AppError, если ход не её, карта недоступна или сторона не требуется.
export function applyAction(s: VetoState, team: Team, input: { mapId?: number; side?: Side }): VetoState {
  const base = settleDecider(s);
  const next = nextAction(base);
  if (next.type === 'done') throw new AppError('vetoDone');
  if (next.team !== team) throw new AppError('vetoNotYourTurn');

  if (next.type === 'side') {
    if (input.side !== 'ct' && input.side !== 't') throw new AppError('vetoBadSide');
    const actions = base.actions.map((a, i) => (i === base.actions.length - 1 ? { ...a, side: input.side } : a));
    return settleDecider({ ...base, actions });
  }
  if (input.mapId === undefined || !remaining(base).includes(input.mapId)) throw new AppError('vetoBadMap');
  return settleDecider({ ...base, actions: [...base.actions, { mapId: input.mapId, kind: next.type, by: team }] });
}

// Случайный ход за команду, чья сейчас очередь (вышло время на ход или админ завершает вето)
export function randomStep(s: VetoState, rnd: () => number = Math.random): VetoState {
  const cur = settleDecider(s);
  const next = nextAction(cur);
  if (next.type === 'done') return cur;
  if (next.type === 'side') return applyAction(cur, next.team, { side: rnd() < 0.5 ? 'ct' : 't' });
  const left = remaining(cur);
  return applyAction(cur, next.team, { mapId: left[Math.floor(rnd() * left.length)]! });
}

// Админ завершает вето случайными ходами за обе команды
export function autoComplete(s: VetoState, rnd: () => number = Math.random): VetoState {
  let cur = settleDecider(s);
  for (let guard = 0; guard < 50 && nextAction(cur).type !== 'done'; guard++) cur = randomStep(cur, rnd);
  return cur;
}

export type MapSide = 'team1_ct' | 'team1_t' | 'team2_ct' | 'team2_t' | 'knife';

export interface PlayedMap { mapId: number; side: MapSide; pickedBy: Team | null }

// Карты матча по порядку игры: пики в порядке выбора, затем решающая карта (нож).
// team1 в конфиге матча — это команда A.
export function vetoResult(s: VetoState): PlayedMap[] {
  if (!isDone(s)) throw new AppError('vetoPending');
  const settled = settleDecider(s);
  const out: PlayedMap[] = [];
  for (const a of settled.actions) {
    if (a.kind === 'ban') continue;
    if (a.kind === 'decider') {
      out.push({ mapId: a.mapId, side: 'knife', pickedBy: null });
      continue;
    }
    if (!hasSides(s)) {
      out.push({ mapId: a.mapId, side: 'knife', pickedBy: a.by });
      continue;
    }
    // Сторону выбирал соперник пикнувшей команды: team1 это A, team2 это B
    const chooser = other(a.by!);
    out.push({ mapId: a.mapId, side: `${chooser === 'a' ? 'team1' : 'team2'}_${a.side!}` as MapSide, pickedBy: a.by });
  }
  return out;
}
