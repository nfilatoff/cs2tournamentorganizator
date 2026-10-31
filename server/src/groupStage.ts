// Жизненный цикл группового этапа: создание матчей, следующий тур Swiss, переход к плей-офф.
import { db, tx } from './db.js';
import { AppError } from './errors.js';
import { buildBracket, type BMatch, type Entry } from './bracket.js';
import {
  assignGroups, buildGsl, buildRoundRobin, defaultSwissRounds, groupMatch, gslOrder, pairSwissRound, playoffOrder,
  standings, type GroupResult, type StandRow, type SwissTeam,
} from './groups.js';
import {
  boFn, commit, deleteMatches, getTournament, insertMatches, loadMatches, type TournamentRow,
} from './tournamentStore.js';

const team = (id: number): Entry => ({ k: 'team', id });
const groupOf = (m: BMatch) => Number(/^G(\d+)-/.exec(m.code)?.[1] ?? 0);
const isDone = (m: BMatch) => m.status === 'done' || m.status === 'bye';

export function swissTotal(t: TournamentRow, teamCount: number): number {
  return t.swiss_rounds ?? defaultSwissRounds(teamCount);
}

export function seedsOf(tid: number): Map<number, number> {
  const rows = db.prepare('SELECT team_id, seed FROM tournament_teams WHERE tournament_id = ?')
    .all(tid) as unknown as { team_id: number; seed: number | null }[];
  return new Map(rows.map((r) => [r.team_id, r.seed ?? 9999]));
}

export function groupsOf(tid: number): Map<number, number[]> {
  const rows = db.prepare(`SELECT team_id, group_no FROM tournament_teams WHERE tournament_id = ? AND group_no IS NOT NULL
    ORDER BY COALESCE(seed, 9999)`).all(tid) as unknown as { team_id: number; group_no: number }[];
  const out = new Map<number, number[]>();
  for (const r of rows) out.set(r.group_no, [...(out.get(r.group_no) ?? []), r.team_id]);
  return out;
}

// Проверка перед стартом: хватает ли команд для выбранного формата групп
export function validateGroupStart(t: TournamentRow, count: number): void {
  const groups = t.groups_count;
  if (t.group_format === 'gsl') {
    if (count !== groups * 4) throw new AppError('gslNeedsTeams', { n: groups * 4 });
  } else if (t.group_format === 'round_robin') {
    const smallest = Math.floor(count / groups);
    if (smallest < Math.max(2, t.advance)) throw new AppError('groupTooSmall', { n: Math.max(2, t.advance) * groups });
  } else if (count < Math.max(2, t.advance)) {
    throw new AppError('groupTooSmall', { n: Math.max(2, t.advance) });
  }
}

// Создаёт группы и их матчи. teamIds: команды по порядку сидов.
export function createGroupMatches(t: TournamentRow, teamIds: number[]): void {
  const groups = assignGroups(teamIds, t.groups_count);
  const setGroup = db.prepare('UPDATE tournament_teams SET group_no = ? WHERE tournament_id = ? AND team_id = ?');
  groups.forEach((ids, g) => ids.forEach((id) => setGroup.run(g + 1, t.id, id)));
  groups.forEach((ids, g) => {
    if (t.group_format === 'gsl') insertMatches(t.id, buildGsl(g + 1, ids, t.group_best_of), 'group', g + 1);
    else if (t.group_format === 'round_robin') insertMatches(t.id, buildRoundRobin(g + 1, ids, t.group_best_of), 'group', g + 1);
  });
  if (t.group_format === 'swiss') insertSwissRound(t, 1, teamIds.map((id, i) => ({ id, seed: i + 1, points: 0, opponents: new Set<number>(), hadBye: false })));
  db.prepare("UPDATE tournaments SET phase = 'groups' WHERE id = ?").run(t.id);
}

function insertSwissRound(t: TournamentRow, round: number, teams: SwissTeam[]): void {
  const { pairs, bye } = pairSwissRound(teams, round);
  const ms: BMatch[] = pairs.map(([a, b], i) =>
    groupMatch(1, round, i + 1, team(a), team(b), { t: 'seed' }, { t: 'seed' }, t.group_best_of));
  ms.forEach((m) => { m.status = 'ready'; });
  if (bye !== null) {
    const m = groupMatch(1, round, pairs.length + 1, team(bye), { k: 'bye' }, { t: 'seed' }, { t: 'seed' }, t.group_best_of);
    m.status = 'bye';
    m.winner = 'a';
    ms.push(m);
  }
  insertMatches(t.id, ms, 'group', 1);
}

function resultsIn(ms: BMatch[], g: number): GroupResult[] {
  return ms.filter((m) => m.bracket === 'G' && groupOf(m) === g && m.status === 'done' && m.a.k === 'team' && m.b.k === 'team')
    .map((m) => ({
      a: (m.a as { id: number }).id, b: (m.b as { id: number }).id,
      scoreA: m.scoreA, scoreB: m.scoreB, winner: m.winner!,
    }));
}

function byesIn(ms: BMatch[], g: number): Map<number, number> {
  const out = new Map<number, number>();
  for (const m of ms) {
    if (m.bracket !== 'G' || groupOf(m) !== g || m.status !== 'bye') continue;
    const e = m.winner === 'a' ? m.a : m.b;
    if (e.k === 'team') out.set(e.id, (out.get(e.id) ?? 0) + 1);
  }
  return out;
}

// Таблица группы. В GSL после всех матчей места берутся из сетки группы.
export function tableOf(t: TournamentRow, g: number, ms: BMatch[], teamIds: number[], seeds: Map<number, number>): StandRow[] {
  const rows = standings(teamIds, seeds, resultsIn(ms, g), byesIn(ms, g));
  if (t.group_format === 'gsl') {
    const order = gslOrder(ms.filter((m) => m.bracket === 'G' && groupOf(m) === g));
    if (order) {
      const byId = new Map(rows.map((r) => [r.teamId, r]));
      return order.map((id, i) => ({ ...byId.get(id)!, rank: i + 1, tiedBySeed: false }));
    }
  }
  return rows;
}

function swissTeams(t: TournamentRow, ms: BMatch[], teamIds: number[], seeds: Map<number, number>): SwissTeam[] {
  const table = new Map(standings(teamIds, seeds, resultsIn(ms, 1), byesIn(ms, 1)).map((r) => [r.teamId, r]));
  const opponents = new Map<number, Set<number>>(teamIds.map((id) => [id, new Set<number>()]));
  for (const m of ms) {
    if (m.bracket !== 'G' || m.a.k !== 'team' || m.b.k !== 'team') continue;
    opponents.get(m.a.id)?.add(m.b.id);
    opponents.get(m.b.id)?.add(m.a.id);
  }
  const byes = byesIn(ms, 1);
  return teamIds.map((id) => ({
    id, seed: seeds.get(id) ?? 9999, points: table.get(id)?.points ?? 0,
    opponents: opponents.get(id)!, hadBye: (byes.get(id) ?? 0) > 0,
  }));
}

// Приводит групповой этап в актуальное состояние после любого изменения результатов.
export function advanceGroupStage(tid: number): void {
  const t = getTournament(tid);
  if (!t || t.stage_mode !== 'groups' || t.phase === 'playoff') return;
  const teamIds = [...(groupsOf(tid).get(1) ?? [])];
  const seeds = seedsOf(tid);

  let ms = loadMatches(tid);
  if (t.group_format === 'swiss') {
    const total = swissTotal(t, teamIds.length);
    for (;;) {
      const gm = ms.filter((m) => m.bracket === 'G');
      const last = gm.reduce((x, m) => Math.max(x, m.round), 0);
      if (last === 0 || last >= total || !gm.filter((m) => m.round === last).every(isDone)) break;
      insertSwissRound(t, last + 1, swissTeams(t, ms, teamIds, seeds));
      ms = loadMatches(tid);
    }
  }

  const gm = ms.filter((m) => m.bracket === 'G');
  if (gm.length === 0) return;
  const swissDone = t.group_format !== 'swiss' || gm.reduce((x, m) => Math.max(x, m.round), 0) >= swissTotal(t, teamIds.length);
  const allDone = gm.every(isDone) && swissDone;

  tx(() => {
    db.prepare('UPDATE tournaments SET phase = ? WHERE id = ?').run(allDone ? 'groups_done' : 'groups', tid);
    if (allDone && !t.has_playoff) {
      const champ = tableOf(t, 1, ms, teamIds, seeds)[0]?.teamId ?? null;
      db.prepare("UPDATE tournaments SET status = 'finished', champion_team_id = ? WHERE id = ?").run(champ, tid);
    } else if (t.status === 'finished') {
      db.prepare("UPDATE tournaments SET status = 'running', champion_team_id = NULL WHERE id = ?").run(tid);
    }
  });
}

// Сохраняет изменения матчей и обновляет состояние турнира (чемпион, групповой этап).
export function applyChanges(t: TournamentRow, ms: BMatch[]): void {
  commit(t, ms);
  advanceGroupStage(t.id);
}

// Перед отменой результата в группе: нельзя, если уже есть плей-офф; в Swiss удаляются несыгранные следующие туры.
export function prepareGroupUndo(t: TournamentRow, ms: BMatch[], code: string): void {
  const m = ms.find((x) => x.code === code);
  if (!m || m.bracket !== 'G') return;
  if (t.phase === 'playoff') throw new AppError('playoffExists');
  if (t.group_format === 'swiss') {
    const later = ms.filter((x) => x.bracket === 'G' && x.round > m.round);
    const played = later.filter((x) => x.status === 'done' || x.status === 'live');
    if (played.length > 0) throw new AppError('undoBlocked', { matches: played.map((x) => x.code).join(', ') });
    deleteMatches(t.id, later.map((x) => x.code));
    for (const x of later) ms.splice(ms.indexOf(x), 1);
  }
}

// ---------- Переход к плей-офф ----------

export function playoffSize(t: TournamentRow): number {
  return t.group_format === 'swiss' ? t.advance : t.groups_count * t.advance;
}

export interface Qualifier { teamId: number; group: number; rank: number; tiedBySeed: boolean }

// Предлагаемый порядок сидов плей-офф и признак «на границе прохода равенство только по сиду»
export function suggestedPlayoff(t: TournamentRow): { order: Qualifier[]; ties: boolean } {
  const ms = loadMatches(t.id);
  const seeds = seedsOf(t.id);
  const groups = groupsOf(t.id);
  const perGroup: StandRow[][] = [...groups.keys()].sort((x, y) => x - y)
    .map((g) => tableOf(t, g, ms, groups.get(g)!, seeds));
  const orderIds = playoffOrder(perGroup.map((rows) => rows.map((r) => r.teamId)), t.advance);
  const info = new Map<number, Qualifier>();
  perGroup.forEach((rows, gi) => rows.forEach((r) => info.set(r.teamId, { teamId: r.teamId, group: gi + 1, rank: r.rank, tiedBySeed: r.tiedBySeed })));
  const ties = perGroup.some((rows) => {
    const cut = rows[t.advance - 1];
    const next = rows[t.advance];
    return !!cut && !!next && cut.tiedBySeed && next.tiedBySeed;
  });
  return { order: orderIds.map((id) => info.get(id)!), ties };
}

export function checkPlayoffOrder(t: TournamentRow, order: number[]): void {
  const allowed = new Set(suggestedPlayoff(t).order.map((q) => q.teamId));
  const groups = groupsOf(t.id);
  const inTournament = new Set([...groups.values()].flat());
  if (order.length !== playoffSize(t) || new Set(order).size !== order.length || !order.every((id) => inTournament.has(id))) {
    throw new AppError('badPlayoffOrder', { n: playoffSize(t) });
  }
  void allowed;
}

export function generatePlayoff(t: TournamentRow, order: number[]): void {
  if (t.phase !== 'groups_done') throw new AppError('groupsNotFinished');
  checkPlayoffOrder(t, order);
  const ms = buildBracket(order, t.format, { grandFinalReset: !!t.grand_final_reset, bestOf: boFn(t) });
  tx(() => {
    insertMatches(t.id, ms, 'playoff');
    db.prepare('UPDATE tournament_teams SET playoff_seed = NULL WHERE tournament_id = ?').run(t.id);
    const upd = db.prepare('UPDATE tournament_teams SET playoff_seed = ? WHERE tournament_id = ? AND team_id = ?');
    order.forEach((id, i) => upd.run(i + 1, t.id, id));
    db.prepare("UPDATE tournaments SET phase = 'playoff', status = 'running' WHERE id = ?").run(t.id);
  });
}

// Отменить сформированный плей-офф, пока в нём нет сыгранных матчей
export function resetPlayoff(t: TournamentRow): void {
  if (t.phase !== 'playoff') throw new AppError('playoffNotCreated');
  const ms = loadMatches(t.id).filter((m) => m.bracket !== 'G');
  if (ms.some((m) => m.status === 'done' || m.status === 'live')) throw new AppError('playoffStarted');
  tx(() => {
    deleteMatches(t.id, ms.map((m) => m.code));
    db.prepare('UPDATE tournament_teams SET playoff_seed = NULL WHERE tournament_id = ?').run(t.id);
    db.prepare("UPDATE tournaments SET phase = 'groups_done', champion_team_id = NULL, status = 'running' WHERE id = ?").run(t.id);
  });
}
