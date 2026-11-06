import { db, tx } from './db.js';
import {
  champion, type BMatch, type BracketId, type Entry, type Format, type Source, type Status,
} from './bracket.js';

export interface TournamentRow {
  id: number; name: string; format: Format; team_size: number; max_teams: number;
  default_best_of: number; bo_config: string; grand_final_reset: number; auto_dispatch: number;
  status: 'registration' | 'running' | 'finished'; champion_team_id: number | null;
  stage_mode: 'playoff' | 'groups'; group_format: 'round_robin' | 'swiss' | 'gsl' | null; groups_count: number;
  advance: number; swiss_rounds: number | null; group_best_of: number; has_playoff: number;
  phase: 'playoff' | 'groups' | 'groups_done'; veto_enabled: number; veto_sides: number;
  tactical_pauses: number; tactical_pause_time: number; tech_pauses: number; wingman_rounds: number;
}

export interface MatchRow {
  id: number; tournament_id: number;
  code: string; bracket: BracketId; round: number; position: number;
  src_a: string; src_b: string; entry_a: string; entry_b: string;
  winner: 'a' | 'b' | null; status: Status; best_of: number; score_a: number; score_b: number; forced: number;
  server_id: number | null; maps_json: string | null; live: number; paused: number;
  cur_map_no: number; cur_score_a: number; cur_score_b: number; series_a: number; series_b: number; note: string | null;
  stage: 'group' | 'playoff'; group_no: number | null; veto_json: string | null;
  dispatched_at: number | null; walkover: number; admin_code: string | null;
}

export const getTournament = (id: number) =>
  db.prepare('SELECT * FROM tournaments WHERE id = ?').get(id) as unknown as TournamentRow | undefined;

export function loadMatchRows(tid: number): MatchRow[] {
  return db.prepare('SELECT * FROM matches WHERE tournament_id = ? ORDER BY id').all(tid) as unknown as MatchRow[];
}

export function getMatchRow(id: number): MatchRow | undefined {
  return db.prepare('SELECT * FROM matches WHERE id = ?').get(id) as unknown as MatchRow | undefined;
}

export function getMatchRowByCode(tid: number, code: string): MatchRow | undefined {
  return db.prepare('SELECT * FROM matches WHERE tournament_id = ? AND code = ?').get(tid, code) as unknown as MatchRow | undefined;
}

export function toBMatch(r: MatchRow): BMatch {
  return {
    code: r.code, bracket: r.bracket, round: r.round, position: r.position,
    srcA: JSON.parse(r.src_a) as Source, srcB: JSON.parse(r.src_b) as Source,
    a: JSON.parse(r.entry_a) as Entry, b: JSON.parse(r.entry_b) as Entry,
    winner: r.winner, status: r.status, bestOf: r.best_of, scoreA: r.score_a, scoreB: r.score_b, forced: !!r.forced,
  };
}

export function loadMatches(tid: number): BMatch[] {
  return loadMatchRows(tid).map(toBMatch);
}

// Вставляет новые матчи турнира (стадия playoff или group)
export function insertMatches(tid: number, ms: BMatch[], stage: 'group' | 'playoff', groupNo: number | null = null): void {
  const ins = db.prepare(`INSERT INTO matches
    (tournament_id, code, bracket, round, position, src_a, src_b, entry_a, entry_b, winner, status, best_of, score_a, score_b, stage, group_no)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const m of ms) {
    ins.run(tid, m.code, m.bracket, m.round, m.position, JSON.stringify(m.srcA), JSON.stringify(m.srcB),
      JSON.stringify(m.a), JSON.stringify(m.b), m.winner, m.status, m.bestOf, m.scoreA, m.scoreB, stage, groupNo);
  }
}

export function deleteMatches(tid: number, codes: string[]): void {
  const del = db.prepare('DELETE FROM matches WHERE tournament_id = ? AND code = ?');
  for (const c of codes) del.run(tid, c);
}

export function saveMatches(tid: number, ms: BMatch[]): void {
  const upd = db.prepare(`UPDATE matches SET entry_a = ?, entry_b = ?, winner = ?, status = ?, score_a = ?, score_b = ?, forced = ?
    WHERE tournament_id = ? AND code = ?`);
  for (const m of ms) {
    upd.run(JSON.stringify(m.a), JSON.stringify(m.b), m.winner, m.status, m.scoreA, m.scoreB, m.forced ? 1 : 0, tid, m.code);
  }
}

// Сбрасывает данные матча на сервере (после результата, отмены или перезапуска).
export function clearRuntime(matchId: number): void {
  const prev = db.prepare('SELECT server_id FROM matches WHERE id = ?').get(matchId) as { server_id: number | null } | undefined;
  db.prepare(`UPDATE matches SET server_id = NULL, live = 0, paused = 0, cur_map_no = 0, cur_score_a = 0, cur_score_b = 0,
    series_a = 0, series_b = 0 WHERE id = ?`).run(matchId);
  if (prev?.server_id != null) serverFreedHook?.(prev.server_id);
}

// Вызывается, когда матч освободил сервер. Подписывается serverProcess (сервер, запущенный под матч, выключается).
let serverFreedHook: ((serverId: number) => void) | null = null;
export function onServerFreed(hook: (serverId: number) => void): void {
  serverFreedHook = hook;
}

export function boFn(t: TournamentRow) {
  const cfg = JSON.parse(t.bo_config) as Record<string, number>;
  return (bracket: BracketId, fromEnd: number) =>
    cfg[bracket === 'GF' ? 'GF' : `${bracket}${fromEnd}`] ?? t.default_best_of;
}

export function teamName(id: number): string {
  const r = db.prepare('SELECT COALESCE(deleted_name, name) AS name FROM teams WHERE id = ?').get(id) as { name: string } | undefined;
  return r?.name ?? `Team ${id}`;
}

// Сохраняет матчи и пересчитывает статус турнира: есть чемпион — завершён, иначе идёт.
export function commit(t: TournamentRow, ms: BMatch[]): void {
  tx(() => {
    saveMatches(t.id, ms);
    const champ = champion(ms, t.format);
    db.prepare('UPDATE tournaments SET status = ?, champion_team_id = ? WHERE id = ?')
      .run(champ !== null ? 'finished' : 'running', champ, t.id);
  });
}
