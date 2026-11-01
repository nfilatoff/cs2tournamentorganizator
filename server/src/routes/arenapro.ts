import type { FastifyInstance } from 'fastify';
import { E, encode, errBody } from '../errors.js';
import { config, panelUrlFor } from '../config.js';
import { getServer } from '../dispatcher.js';
import { db, tx } from '../db.js';
import { buildMatchConfig, captainSteamId, rosterOf, tokenMatches, type MapRef } from '../arenapro.js';
import { forceWinner, reportResult } from '../bracket.js';
import { forgetLobby } from '../lobby.js';
import { dispatchAll } from '../dispatcher.js';
import { applyChanges } from '../groupStage.js';
import {
  clearRuntime, getMatchRow, getTournament, loadMatches, teamName,
} from '../tournamentStore.js';

interface TeamPart { id?: string; name?: string; score?: number; series_score?: number }
export interface ArenaEvent {
  event: string;
  matchid: number;
  map_number?: number;
  team1?: TeamPart;
  team2?: TeamPart;
  winner?: { side?: string; team?: string };
  team1_series_score?: number;
  team2_series_score?: number;
}

// Обрабатывает событие игрового сервера. События чужих и уже закрытых матчей игнорируются.
export function handleEvent(ev: ArenaEvent): void {
  const row = getMatchRow(ev.matchid);
  if (!row || row.server_id === null || row.status !== 'live') return;
  const mapNo = ev.map_number ?? 0;

  switch (ev.event) {
    case 'going_live':
      forgetLobby(row.id);
      db.prepare('UPDATE matches SET live = 1, cur_map_no = ?, cur_score_a = 0, cur_score_b = 0 WHERE id = ?')
        .run(mapNo, row.id);
      break;

    case 'round_end':
      db.prepare(`UPDATE matches SET live = 1, cur_map_no = ?, cur_score_a = ?, cur_score_b = ?, series_a = ?, series_b = ?
        WHERE id = ?`).run(mapNo, ev.team1?.score ?? 0, ev.team2?.score ?? 0,
        ev.team1?.series_score ?? row.series_a, ev.team2?.series_score ?? row.series_b, row.id);
      break;

    case 'map_result': {
      const winner = ev.winner?.team === 'team1' ? 'a' : ev.winner?.team === 'team2' ? 'b' : null;
      tx(() => {
        db.prepare(`INSERT INTO match_maps (match_id, map_no, score_a, score_b, winner) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(match_id, map_no) DO UPDATE SET score_a = excluded.score_a, score_b = excluded.score_b, winner = excluded.winner`)
          .run(row.id, mapNo, ev.team1?.score ?? 0, ev.team2?.score ?? 0, winner);
        // The last round_end still has the series score from before this map was won.
        db.prepare(`UPDATE matches SET cur_map_no = ?, cur_score_a = ?, cur_score_b = ?, series_a = ?, series_b = ? WHERE id = ?`)
          .run(mapNo, ev.team1?.score ?? 0, ev.team2?.score ?? 0,
            ev.team1?.series_score ?? row.series_a, ev.team2?.series_score ?? row.series_b, row.id);
      });
      break;
    }

    case 'game_paused':
      db.prepare('UPDATE matches SET paused = 1 WHERE id = ?').run(row.id);
      break;
    case 'game_unpaused':
      db.prepare('UPDATE matches SET paused = 0 WHERE id = ?').run(row.id);
      break;

    case 'series_end': {
      const s1 = ev.team1_series_score ?? 0;
      const s2 = ev.team2_series_score ?? 0;
      const t = getTournament(row.tournament_id);
      if (!t) return;
      const ms = loadMatches(t.id);
      // Ни одна карта не начиналась: за отведённое время матч не стартовал, и плагин присудил победу по числу игроков
      const played = db.prepare('SELECT 1 FROM match_maps WHERE match_id = ? LIMIT 1').get(row.id);
      const walkover = !row.live && !played && s1 !== s2;
      try {
        if (walkover) forceWinner(ms, row.code, s1 > s2 ? 'a' : 'b');
        else reportResult(ms, row.code, s1, s2);
      } catch (e) {
        db.prepare('UPDATE matches SET note = ? WHERE id = ?')
          .run(encode(E('noteBadResult', { s1, s2, reason: errBody(e) })), row.id);
        return;
      }
      tx(() => {
        applyChanges(t, ms);
        clearRuntime(row.id);
        db.prepare('UPDATE matches SET note = NULL, walkover = ? WHERE id = ?').run(walkover ? 1 : 0, row.id);
      });
      forgetLobby(row.id);
      // Сервер освободился, а победитель мог открыть следующий матч
      void dispatchAll();
      break;
    }
  }
}

export async function arenaproRoutes(app: FastifyInstance): Promise<void> {
  // Игровой сервер забирает конфиг матча по этой ссылке (arenapro_loadmatch_url)
  app.get<{ Params: { id: string } }>('/api/arenapro/config/:id', async (req, reply) => {
    if (!tokenMatches(req.headers.authorization)) return reply.code(401).send(E('noAccess'));
    const row = getMatchRow(Number(req.params.id));
    if (!row || !row.maps_json) return reply.code(404).send(E('matchNotFound'));
    const t = getTournament(row.tournament_id)!;
    const entry = (json: string) => JSON.parse(json) as { k: string; id?: number };
    const a = entry(row.entry_a);
    const b = entry(row.entry_b);
    if (a.k !== 'team' || b.k !== 'team') return reply.code(409).send(E('opponentsTbd'));
    return buildMatchConfig({
      matchId: row.id,
      teamSize: t.team_size,
      teamA: { id: a.id!, name: teamName(a.id!), players: rosterOf(t.id, a.id!), captain: captainSteamId(t.id, a.id!) },
      teamB: { id: b.id!, name: teamName(b.id!), players: rosterOf(t.id, b.id!), captain: captainSteamId(t.id, b.id!) },
      maps: JSON.parse(row.maps_json) as MapRef[],
      pauses: { tactical: t.tactical_pauses, tacticalTime: t.tactical_pause_time, technical: t.tech_pauses },
      wingmanRounds: t.wingman_rounds,
      adminCode: row.admin_code,
      panelUrl: (() => {
        const server = row.server_id ? getServer(row.server_id) : undefined;
        return server ? panelUrlFor(server.host) : config.publicUrl;
      })(),
    });
  });

  // Сюда сервер шлёт события матча (arenapro_remote_log_url)
  app.post('/api/arenapro/events', async (req, reply) => {
    if (!tokenMatches(req.headers.authorization)) return reply.code(401).send(E('noAccess'));
    const ev = req.body as ArenaEvent | undefined;
    if (!ev || typeof ev.event !== 'string' || typeof ev.matchid !== 'number') {
      return reply.code(400).send(E('badEvent'));
    }
    try {
      handleEvent(ev);
    } catch (e) {
      req.log.error(e, 'ошибка обработки события');
      return reply.code(500).send(E('processingFailed'));
    }
    return { ok: true };
  });
}
