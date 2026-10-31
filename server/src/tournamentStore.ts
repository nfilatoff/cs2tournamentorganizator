import { db, tx } from './db.js';
import {
  champion, type BMatch, type BracketId, type Entry, type Format, type Source, type Status,
} from './bracket.js';

export interface TournamentRow {
  id: number; name: string; format: Format; team_size: number; max_teams: number;
  default_best_of: number; bo_config: string; grand_final_reset: number; auto_dispatch: number;
  status: 'registration' | 'running' | 'finished'; champion_team_id: number | null;
}

export interface MatchRow {
  id: number; tournament_id: number;
  code: string; bracket: BracketId; round: number; position: number;
  src_a: string; src_b: string; entry_a: string; entry_b: string;
  winner: 'a' | 'b' | null; status: Status; best_of: number; score_a: number; score_b: number; forced: number;
  server_id: number | null; maps_json: string | null; live: number; paused: number;
  cur_map_no: number; cur_score_a: number; cur_score_b: number; series_a: number; series_b: number; note: string | null;
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

export function saveMatches(tid: number, ms: BMatch[]): void {
  const upd = db.prepare(`UPDATE matches SET entry_a = ?, entry_b = ?, winner = ?, status = ?, score_a = ?, score_b = ?, forced = ?
    WHERE tournament_id = ? AND code = ?`);
  for (const m of ms) {
    upd.run(JSON.stringify(m.a), JSON.stringify(m.b), m.winner, m.status, m.scoreA, m.scoreB, m.forced ? 1 : 0, tid, m.code);
  }
}

// Сбрасывает данные матча на сервере (после результата, отмены или перезапуска).
export function clearRuntime(matchId: number): void {
  db.prepare(`UPDATE matches SET server_id = NULL, live = 0, paused = 0, cur_map_no = 0, cur_score_a = 0, cur_score_b = 0,
    series_a = 0, series_b = 0 WHERE id = ?`).run(matchId);
}

export function boFn(t: TournamentRow) {
  const cfg = JSON.parse(t.bo_config) as Record<string, number>;
  return (bracket: BracketId, fromEnd: number) =>
    cfg[bracket === 'GF' ? 'GF' : `${bracket}${fromEnd}`] ?? t.default_best_of;
}

export function teamName(id: number): string {
  const r = db.prepare('SELECT name FROM teams WHERE id = ?').get(id) as { name: string } | undefined;
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
