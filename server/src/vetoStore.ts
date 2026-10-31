import { db } from './db.js';
import { AppError } from './errors.js';
import { pickMaps, tournamentMapPool, type MapRef } from './arenapro.js';
import { isDone, newVeto, vetoResult, type VetoState } from './veto.js';
import type { MatchRow, TournamentRow } from './tournamentStore.js';

// Вето проводится, когда оно включено в турнире и известны обе команды матча
export function vetoApplies(t: TournamentRow, row: MatchRow): boolean {
  if (!t.veto_enabled) return false;
  const known = (json: string) => (JSON.parse(json) as { k: string }).k === 'team';
  return known(row.entry_a) && known(row.entry_b);
}

export function loadVeto(t: TournamentRow, row: MatchRow, pool: MapRef[] = tournamentMapPool(t.id)): VetoState {
  if (row.veto_json) return JSON.parse(row.veto_json) as VetoState;
  return newVeto(pool.map((m) => m.id), row.best_of);
}

export function saveVeto(matchId: number, state: VetoState | null): void {
  db.prepare('UPDATE matches SET veto_json = ? WHERE id = ?').run(state ? JSON.stringify(state) : null, matchId);
}

// Можно ли запускать матч на сервере: вето отключено или уже завершено
export function vetoComplete(t: TournamentRow, row: MatchRow): boolean {
  if (!t.veto_enabled) return true;
  return isDone(loadVeto(t, row));
}

// Карты матча по порядку игры, со сторонами из вето. Без вето: первые карты пула, стороны на ноже.
export function matchMaps(t: TournamentRow, row: MatchRow): MapRef[] {
  const pool = tournamentMapPool(t.id);
  if (!t.veto_enabled) return pickMaps(pool, row.best_of);
  const state = loadVeto(t, row, pool);
  if (!isDone(state)) throw new AppError('vetoPending');
  const byId = new Map(pool.map((m) => [m.id, m]));
  return vetoResult(state).map((p) => ({ ...byId.get(p.mapId)!, side: p.side }));
}

export function vetoSummary(t: TournamentRow, row: MatchRow, poolSize: number) {
  if (!vetoApplies(t, row)) return null;
  const state = row.veto_json ? (JSON.parse(row.veto_json) as VetoState) : null;
  return { done: state ? isDone(state) : false, step: state?.actions.length ?? 0, total: poolSize };
}
