import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { getSession, type Session } from '../auth.js';
import { decode, E } from '../errors.js';
import { JOIN_TIME_S, START_DELAY_S, tournamentMapPool, type MapRef } from '../arenapro.js';
import { roundFromEnd } from '../bracket.js';
import { getLobby } from '../lobby.js';
import { mapImageUrl } from '../mapImages.js';
import { isDone, vetoResult } from '../veto.js';
import { loadVeto, vetoApplies, vetoSummary } from '../vetoStore.js';
import {
  getMatchRowByCode, getTournament, loadMatches, teamName, type MatchRow, type TournamentRow,
} from '../tournamentStore.js';

type Side = 'a' | 'b';

const teamIdOf = (json: string): number | null => {
  const e = JSON.parse(json) as { k: string; id?: number };
  return e.k === 'team' ? e.id ?? null : null;
};

interface PlayerRow { id: number; name: string; steam_id: string; avatar_url: string | null }

function teamDto(t: TournamentRow, teamId: number | null, online: string[] | null) {
  if (teamId === null) return null;
  const tt = db.prepare('SELECT roster, seed FROM tournament_teams WHERE tournament_id = ? AND team_id = ?')
    .get(t.id, teamId) as { roster: string; seed: number | null } | undefined;
  const ids = tt ? (JSON.parse(tt.roster) as number[]) : [];
  const captainId = (db.prepare('SELECT captain_id FROM teams WHERE id = ?').get(teamId) as { captain_id: number } | undefined)?.captain_id;
  const rows = ids.length === 0 ? [] : db.prepare(`SELECT id, name, steam_id, avatar_url FROM players WHERE id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids) as unknown as PlayerRow[];
  const byId = new Map(rows.map((r) => [r.id, r]));
  return {
    id: teamId,
    name: teamName(teamId),
    seed: tt?.seed ?? null,
    players: ids.flatMap((id) => {
      const p = byId.get(id);
      return p ? [{
        id: p.id, name: p.name, steamId: p.steam_id, avatarUrl: p.avatar_url,
        captain: p.id === captainId, online: online ? online.includes(p.steam_id) : null,
      }] : [];
    }),
  };
}

// Карты матча: после отправки на сервер — что ушло в конфиг, до этого — итог вето
function mapsDto(t: TournamentRow, row: MatchRow) {
  const images = new Map((db.prepare('SELECT id, image_url, map_file FROM maps').all() as unknown as
    { id: number; image_url: string | null; map_file: string | null }[]).map((r) => [r.id, mapImageUrl(r)]));
  let refs: MapRef[] | null = row.maps_json ? (JSON.parse(row.maps_json) as MapRef[]) : null;
  if (!refs && vetoApplies(t, row)) {
    const state = loadVeto(t, row);
    if (isDone(state)) {
      const pool = new Map(tournamentMapPool(t.id).map((m) => [m.id, m]));
      refs = vetoResult(state).flatMap((p) => (pool.has(p.mapId) ? [{ ...pool.get(p.mapId)!, side: p.side }] : []));
    }
  }
  if (!refs) return [];
  const played = new Map((db.prepare('SELECT map_no, score_a, score_b, winner FROM match_maps WHERE match_id = ?')
    .all(row.id) as unknown as { map_no: number; score_a: number; score_b: number; winner: Side | null }[]).map((p) => [p.map_no, p]));
  return refs.map((m, i) => {
    const p = played.get(i);
    const current = !!row.live && row.cur_map_no === i;
    return {
      no: i, name: m.name, imageUrl: images.get(m.id) ?? null, side: m.side ?? 'knife',
      score: p ? { a: p.score_a, b: p.score_b } : current ? { a: row.cur_score_a, b: row.cur_score_b } : null,
      winner: p?.winner ?? null, current,
    };
  });
}

// Где матч сейчас: ждёт соперника, вето, очередь на сервер, подключение игроков, игра, завершён
function phaseOf(t: TournamentRow, row: MatchRow) {
  if (row.status === 'done') return 'done' as const;
  if (row.status === 'live') return row.live ? 'live' as const : 'warmup' as const;
  if (row.status === 'ready') {
    if (vetoApplies(t, row) && !isDone(loadVeto(t, row))) return 'veto' as const;
    return 'queued' as const;
  }
  if (row.status === 'pending') return 'waiting' as const;
  return 'skipped' as const;
}

export function matchDetails(t: TournamentRow, row: MatchRow, s: Session | null) {
  const phase = phaseOf(t, row);
  const lobby = phase === 'warmup' ? getLobby(row.id) : undefined;
  const ids = { a: teamIdOf(row.entry_a), b: teamIdOf(row.entry_b) };
  const server = row.server_id
    ? db.prepare('SELECT name, host, port FROM game_servers WHERE id = ?').get(row.server_id) as { name: string; host: string; port: number } | undefined
    : undefined;
  const ms = loadMatches(t.id);
  const bm = ms.find((m) => m.code === row.code);

  let you: { side: Side | null; captain: boolean } | null = null;
  if (s?.kind === 'player') {
    const inRoster = (teamId: number | null) => {
      if (teamId === null) return false;
      const tt = db.prepare('SELECT roster FROM tournament_teams WHERE tournament_id = ? AND team_id = ?').get(t.id, teamId) as { roster: string } | undefined;
      return !!tt && (JSON.parse(tt.roster) as number[]).includes(s.userId);
    };
    const side: Side | null = inRoster(ids.a) ? 'a' : inRoster(ids.b) ? 'b' : null;
    const cap = side && ids[side] !== null
      ? (db.prepare('SELECT captain_id FROM teams WHERE id = ?').get(ids[side]) as { captain_id: number }).captain_id === s.userId
      : false;
    you = { side, captain: cap };
  }

  return {
    tournament: { id: t.id, name: t.name, format: t.format, teamSize: t.team_size, status: t.status },
    code: row.code, bracket: row.bracket, stage: row.stage, groupNo: row.group_no,
    roundFromEnd: bm ? roundFromEnd(ms, bm) : 0,
    bestOf: row.best_of, status: row.status, phase,
    winner: row.winner, scoreA: row.score_a, scoreB: row.score_b, forced: !!row.forced, walkover: !!row.walkover,
    series: { a: row.series_a, b: row.series_b },
    paused: !!row.paused,
    teams: { a: teamDto(t, ids.a, lobby ? lobby.players.a : null), b: teamDto(t, ids.b, lobby ? lobby.players.b : null) },
    maps: mapsDto(t, row),
    veto: vetoSummary(t, row, tournamentMapPool(t.id).length),
    server: server && (phase === 'warmup' || phase === 'live') ? server : null,
    lobby: phase === 'warmup' ? {
      // Пока сервер не ответил, считаем от момента отправки матча
      deadline: lobby?.deadline ?? (row.dispatched_at ? row.dispatched_at + JOIN_TIME_S * 1000 : null),
      startsAt: lobby?.startsAt ?? null,
      captainReady: lobby?.captainReady ?? { a: false, b: false },
      known: !!lobby,
      joinTime: JOIN_TIME_S,
      startDelay: START_DELAY_S,
    } : null,
    now: Date.now(),
    you,
    admin: s?.kind === 'admin',
    note: s?.kind === 'admin' && row.note ? decode(row.note) : null,
  };
}

export async function matchRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string; code: string } }>('/api/tournaments/:id/matches/:code', async (req, reply) => {
    const t = getTournament(Number(req.params.id));
    const row = t ? getMatchRowByCode(t.id, req.params.code) : undefined;
    if (!t || !row) return reply.code(404).send(E('matchNotFound'));
    return matchDetails(t, row, getSession(req));
  });
}
