import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { E, encode, errBody } from '../errors.js';
import { z } from 'zod';
import { db, tx } from '../db.js';
import { getSession, requireAdmin } from '../auth.js';
import {
  boFn, clearRuntime, commit, getMatchRowByCode, getTournament, loadMatchRows, loadMatches, saveMatches, teamName,
  type MatchRow, type TournamentRow,
} from '../tournamentStore.js';
import { dispatchAll, dispatchOne, endMatchOnServer, getServer, release, withRcon } from '../dispatcher.js';
import type { MapRef } from '../arenapro.js';
import {
  buildBracket, champion, forceWinner, minTeams, reportResult, roundFromEnd, undoResult,
  type BracketId, type Entry, type Format,
} from '../bracket.js';

const BEST_OF = z.union([z.literal(1), z.literal(3), z.literal(5)]);
const MAX_MAPS = 7;

const tournamentBody = z.object({
  name: z.string().trim().min(2).max(80),
  format: z.enum(['single', 'double']),
  teamSize: z.number().int().min(1).max(5),
  maxTeams: z.number().int().min(minTeams('single')).max(64),
  defaultBestOf: BEST_OF.default(1),
  boConfig: z.record(z.string().regex(/^(W\d+|L\d+|GF)$/), BEST_OF).default({}),
  grandFinalReset: z.boolean().default(true),
  autoDispatch: z.boolean().default(true),
  mapIds: z.array(z.number().int()).max(MAX_MAPS),
});

// Раунды для формы создания: ключ BO и подпись для заданных формата и числа команд.
function previewRounds(format: Format, maxTeams: number) {
  const ids = Array.from({ length: Math.max(maxTeams, minTeams(format)) }, (_, i) => i + 1);
  const ms = buildBracket(ids, format);
  const seen = new Map<string, { bracket: BracketId; fromEnd: number }>();
  for (const bracket of ['W', 'L', 'GF'] as const) {
    const rounds = [...new Set(ms.filter((m) => m.bracket === bracket).map((m) => m.round))].sort((x, y) => x - y);
    for (const r of rounds) {
      const fromEnd = roundFromEnd(ms, { bracket, round: r });
      const key = bracket === 'GF' ? 'GF' : `${bracket}${fromEnd}`;
      if (!seen.has(key)) seen.set(key, { bracket, fromEnd });
    }
  }
  return [...seen].map(([key, v]) => ({ key, ...v }));
}

function entryDto(e: Entry) {
  if (e.k === 'team') return { type: 'team' as const, id: e.id, name: teamName(e.id) };
  return { type: e.k };
}

function details(t: TournamentRow) {
  const teams = db.prepare(`
    SELECT tt.team_id, tt.seed, tt.roster, te.name FROM tournament_teams tt JOIN teams te ON te.id = tt.team_id
    WHERE tt.tournament_id = ? ORDER BY COALESCE(tt.seed, 9999), tt.registered_at
  `).all(t.id) as unknown as { team_id: number; seed: number | null; roster: string; name: string }[];
  const maps = db.prepare(`
    SELECT m.id, m.name, m.workshop_id, m.map_file, m.image_url FROM tournament_maps tm JOIN maps m ON m.id = tm.map_id
    WHERE tm.tournament_id = ? ORDER BY tm.position
  `).all(t.id) as unknown as { id: number; name: string; workshop_id: string | null; map_file: string | null; image_url: string | null }[];
  const ms = loadMatches(t.id);
  const rows = new Map(loadMatchRows(t.id).map((r) => [r.code, r]));
  const servers = new Map((db.prepare('SELECT id, name, host, port FROM game_servers').all() as unknown as
    { id: number; name: string; host: string; port: number }[]).map((s) => [s.id, s]));
  return {
    id: t.id, name: t.name, format: t.format, teamSize: t.team_size, maxTeams: t.max_teams,
    defaultBestOf: t.default_best_of, boConfig: JSON.parse(t.bo_config) as Record<string, number>,
    grandFinalReset: !!t.grand_final_reset, autoDispatch: !!t.auto_dispatch, status: t.status,
    champion: t.champion_team_id ? { id: t.champion_team_id, name: teamName(t.champion_team_id) } : null,
    teams: teams.map((x) => ({ id: x.team_id, name: x.name, seed: x.seed, roster: JSON.parse(x.roster) as number[] })),
    maps: maps.map((m) => ({ id: m.id, name: m.name, workshopId: m.workshop_id, mapFile: m.map_file, imageUrl: m.image_url })),
    matches: ms.map((m) => ({
      code: m.code, bracket: m.bracket, round: m.round, position: m.position,
      roundFromEnd: roundFromEnd(ms, m),
      a: entryDto(m.a), b: entryDto(m.b), status: m.status, winner: m.winner,
      bestOf: m.bestOf, scoreA: m.scoreA, scoreB: m.scoreB, forced: m.forced,
      ...runtimeDto(rows.get(m.code), servers),
    })),
  };
}

function runtimeDto(r: MatchRow | undefined, servers: Map<number, { id: number; name: string; host: string; port: number }>) {
  if (!r) return {};
  const refs = r.maps_json ? (JSON.parse(r.maps_json) as MapRef[]) : [];
  const played = db.prepare('SELECT map_no, score_a, score_b, winner FROM match_maps WHERE match_id = ? ORDER BY map_no')
    .all(r.id) as unknown as { map_no: number; score_a: number; score_b: number; winner: 'a' | 'b' | null }[];
  const server = r.server_id ? servers.get(r.server_id) : undefined;
  return {
    matchId: r.id,
    server: server ?? null,
    live: !!r.live,
    paused: !!r.paused,
    note: r.note,
    seriesA: r.series_a,
    seriesB: r.series_b,
    curMap: r.live ? { no: r.cur_map_no, name: refs[r.cur_map_no]?.name ?? null, scoreA: r.cur_score_a, scoreB: r.cur_score_b } : null,
    playedMaps: played.map((p) => ({ no: p.map_no, name: refs[p.map_no]?.name ?? null, scoreA: p.score_a, scoreB: p.score_b, winner: p.winner })),
  };
}

function setMaps(tid: number, mapIds: number[]): boolean {
  const unique = [...new Set(mapIds)];
  const found = db.prepare(`SELECT id FROM maps WHERE id IN (${unique.map(() => '?').join(',') || 'NULL'})`)
    .all(...unique) as unknown as { id: number }[];
  if (found.length !== unique.length) return false;
  db.prepare('DELETE FROM tournament_maps WHERE tournament_id = ?').run(tid);
  const ins = db.prepare('INSERT INTO tournament_maps (tournament_id, map_id, position) VALUES (?, ?, ?)');
  unique.forEach((id, i) => ins.run(tid, id, i + 1));
  return true;
}

// Матч закончен вручную: останавливаем его на сервере и освобождаем сервер.
async function freeServerOf(row: MatchRow | undefined): Promise<void> {
  if (!row || row.server_id === null) return;
  const s = getServer(row.server_id);
  if (s) await endMatchOnServer(s);
  clearRuntime(row.id);
}

async function requireTournament(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
  const t = getTournament(Number(req.params.id));
  if (!t) await reply.code(404).send(E('tournamentNotFound'));
  return t;
}

export async function tournamentRoutes(app: FastifyInstance): Promise<void> {
  // --- Публичные ---
  app.get('/api/tournaments', async () => {
    const rows = db.prepare(`
      SELECT t.*, (SELECT COUNT(*) FROM tournament_teams tt WHERE tt.tournament_id = t.id) AS team_count
      FROM tournaments t ORDER BY t.id DESC
    `).all() as unknown as (TournamentRow & { team_count: number })[];
    return rows.map((t) => ({
      id: t.id, name: t.name, format: t.format, teamSize: t.team_size, maxTeams: t.max_teams,
      status: t.status, teamCount: t.team_count,
    }));
  });

  app.get('/api/tournaments/rounds-preview', async (req, reply) => {
    const q = z.object({ format: z.enum(['single', 'double']), maxTeams: z.coerce.number().int().min(2).max(64) })
      .safeParse(req.query);
    if (!q.success) return reply.code(400).send(E('badParams'));
    return previewRounds(q.data.format, q.data.maxTeams);
  });

  app.get<{ Params: { id: string } }>('/api/tournaments/:id', async (req, reply) => {
    const t = await requireTournament(req, reply);
    return t ? details(t) : undefined;
  });

  // --- Админ ---
  app.post('/api/tournaments', { preHandler: requireAdmin }, async (req, reply) => {
    const body = tournamentBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send(E('badTournament'));
    const d = body.data;
    if (d.maxTeams < minTeams(d.format)) {
      return reply.code(400).send(E('minTeams', { n: minTeams(d.format) }));
    }
    const id = tx(() => {
      const res = db.prepare(`INSERT INTO tournaments
        (name, format, team_size, max_teams, default_best_of, bo_config, grand_final_reset, auto_dispatch) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(d.name, d.format, d.teamSize, d.maxTeams, d.defaultBestOf, JSON.stringify(d.boConfig), d.grandFinalReset ? 1 : 0, d.autoDispatch ? 1 : 0);
      const tid = Number(res.lastInsertRowid);
      if (!setMaps(tid, d.mapIds)) throw new Error('map');
      return tid;
    });
    return reply.code(201).send(details(getTournament(id)!));
  });

  app.put<{ Params: { id: string } }>('/api/tournaments/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const t = await requireTournament(req, reply);
    if (!t) return;
    if (t.status !== 'registration') return reply.code(409).send(E('alreadyStarted'));
    const body = tournamentBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send(E('badTournament'));
    const d = body.data;
    if (d.maxTeams < minTeams(d.format)) {
      return reply.code(400).send(E('minTeams', { n: minTeams(d.format) }));
    }
    const registered = (db.prepare('SELECT COUNT(*) AS n FROM tournament_teams WHERE tournament_id = ?')
      .get(t.id) as { n: number }).n;
    if (registered > d.maxTeams) return reply.code(409).send(E('tooManyRegistered'));
    if (d.teamSize !== t.team_size && registered > 0) {
      return reply.code(409).send(E('teamSizeLocked'));
    }
    tx(() => {
      db.prepare(`UPDATE tournaments SET name = ?, format = ?, team_size = ?, max_teams = ?, default_best_of = ?,
        bo_config = ?, grand_final_reset = ?, auto_dispatch = ? WHERE id = ?`)
        .run(d.name, d.format, d.teamSize, d.maxTeams, d.defaultBestOf, JSON.stringify(d.boConfig), d.grandFinalReset ? 1 : 0, d.autoDispatch ? 1 : 0, t.id);
      if (!setMaps(t.id, d.mapIds)) throw new Error('map');
    });
    return details(getTournament(t.id)!);
  });

  app.delete<{ Params: { id: string } }>('/api/tournaments/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const t = await requireTournament(req, reply);
    if (!t) return;
    db.prepare('DELETE FROM tournaments WHERE id = ?').run(t.id);
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/tournaments/:id/start', { preHandler: requireAdmin }, async (req, reply) => {
    const t = await requireTournament(req, reply);
    if (!t) return;
    if (t.status !== 'registration') return reply.code(409).send(E('alreadyStarted'));
    const body = z.object({ shuffle: z.boolean().default(false) }).safeParse(req.body ?? {});
    const shuffle = body.success ? body.data.shuffle : false;

    const teamIds = (db.prepare('SELECT team_id FROM tournament_teams WHERE tournament_id = ? ORDER BY registered_at, rowid')
      .all(t.id) as unknown as { team_id: number }[]).map((r) => r.team_id);
    if (teamIds.length < minTeams(t.format)) {
      return reply.code(409).send(E('needMinTeams', { n: minTeams(t.format) }));
    }
    const mapCount = (db.prepare('SELECT COUNT(*) AS n FROM tournament_maps WHERE tournament_id = ?').get(t.id) as { n: number }).n;
    if (mapCount === 0) return reply.code(409).send(E('needMaps'));

    if (shuffle) {
      for (let i = teamIds.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [teamIds[i], teamIds[j]] = [teamIds[j]!, teamIds[i]!];
      }
    }
    const ms = buildBracket(teamIds, t.format, { grandFinalReset: !!t.grand_final_reset, bestOf: boFn(t) });
    tx(() => {
      const seedUpd = db.prepare('UPDATE tournament_teams SET seed = ? WHERE tournament_id = ? AND team_id = ?');
      teamIds.forEach((id, i) => seedUpd.run(i + 1, t.id, id));
      const ins = db.prepare(`INSERT INTO matches
        (tournament_id, code, bracket, round, position, src_a, src_b, entry_a, entry_b, winner, status, best_of, score_a, score_b)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const m of ms) {
        ins.run(t.id, m.code, m.bracket, m.round, m.position, JSON.stringify(m.srcA), JSON.stringify(m.srcB),
          JSON.stringify(m.a), JSON.stringify(m.b), m.winner, m.status, m.bestOf, m.scoreA, m.scoreB);
      }
      db.prepare("UPDATE tournaments SET status = 'running' WHERE id = ?").run(t.id);
    });
    void dispatchAll();
    return details(getTournament(t.id)!);
  });

  app.post<{ Params: { id: string; code: string } }>(
    '/api/tournaments/:id/matches/:code/result',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const t = getTournament(Number(req.params.id));
      if (!t) return reply.code(404).send(E('tournamentNotFound'));
      if (t.status !== 'running') return reply.code(409).send(E('notRunning'));
      const body = z.object({ scoreA: z.number().int().min(0), scoreB: z.number().int().min(0) }).safeParse(req.body);
      if (!body.success) return reply.code(400).send(E('needScore'));
      const ms = loadMatches(t.id);
      const row = getMatchRowByCode(t.id, req.params.code);
      try {
        reportResult(ms, req.params.code, body.data.scoreA, body.data.scoreB);
      } catch (e) {
        return reply.code(400).send(errBody(e));
      }
      commit(t, ms);
      await freeServerOf(row);
      void dispatchAll();
      return details(getTournament(t.id)!);
    },
  );

  // Админ: назначить победителя без счёта
  app.post<{ Params: { id: string; code: string } }>(
    '/api/tournaments/:id/matches/:code/winner',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const t = getTournament(Number(req.params.id));
      if (!t) return reply.code(404).send(E('tournamentNotFound'));
      if (t.status !== 'running') return reply.code(409).send(E('notRunning'));
      const body = z.object({ winner: z.enum(['a', 'b']) }).safeParse(req.body);
      if (!body.success) return reply.code(400).send(E('needWinner'));
      const ms = loadMatches(t.id);
      const row = getMatchRowByCode(t.id, req.params.code);
      try {
        forceWinner(ms, req.params.code, body.data.winner);
      } catch (e) {
        return reply.code(400).send(errBody(e));
      }
      commit(t, ms);
      await freeServerOf(row);
      void dispatchAll();
      return details(getTournament(t.id)!);
    },
  );

  // Админ: отменить результат матча (в том числе в завершённом турнире)
  app.post<{ Params: { id: string; code: string } }>(
    '/api/tournaments/:id/matches/:code/undo',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const t = getTournament(Number(req.params.id));
      if (!t) return reply.code(404).send(E('tournamentNotFound'));
      if (t.status === 'registration') return reply.code(409).send(E('notStarted'));
      const ms = loadMatches(t.id);
      try {
        undoResult(ms, req.params.code);
      } catch (e) {
        return reply.code(400).send(errBody(e));
      }
      commit(t, ms);
      void dispatchAll();
      return details(getTournament(t.id)!);
    },
  );

  // --- Управление матчем на сервере (админ) ---
  const liveMatch = (req: FastifyRequest<{ Params: { id: string; code: string } }>) => {
    const t = getTournament(Number(req.params.id));
    const row = t ? getMatchRowByCode(t.id, req.params.code) : undefined;
    return { t, row, server: row?.server_id ? getServer(row.server_id) : undefined };
  };
  const ctrl = { preHandler: requireAdmin };

  app.post<{ Params: { id: string; code: string } }>('/api/tournaments/:id/matches/:code/dispatch', ctrl, async (req, reply) => {
    const { t, row } = liveMatch(req);
    if (!t || !row) return reply.code(404).send(E('matchNotFound'));
    const body = z.object({ serverId: z.number().int().optional() }).safeParse(req.body ?? {});
    try {
      await dispatchOne(row.id, body.success ? body.data.serverId : undefined);
    } catch (e) {
      return reply.code(409).send(errBody(e));
    }
    return details(getTournament(t.id)!);
  });

  app.post<{ Params: { id: string; code: string } }>('/api/tournaments/:id/matches/:code/pause', ctrl, async (req, reply) => {
    const { t, row, server } = liveMatch(req);
    if (!t || !row) return reply.code(404).send(E('matchNotFound'));
    if (!server) return reply.code(409).send(E('matchNotOnServer'));
    const body = z.object({ paused: z.boolean() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send(E('badRequest'));
    try {
      await withRcon(server, (r) => r.exec(body.data.paused ? 'css_forcepause' : 'css_forceunpause'));
    } catch (e) {
      return reply.code(502).send(E('serverNoReply', { reason: errBody(e) }));
    }
    return details(getTournament(t.id)!);
  });

  // Переиграть текущую карту с первого раунда: восстановление бэкапа нулевого раунда.
  app.post<{ Params: { id: string; code: string } }>('/api/tournaments/:id/matches/:code/restart-map', ctrl, async (req, reply) => {
    const { t, row, server } = liveMatch(req);
    if (!t || !row) return reply.code(404).send(E('matchNotFound'));
    if (!server || !row.live) return reply.code(409).send(E('mapNotStarted'));
    try {
      const out = await withRcon(server, (r) => r.exec('css_restore 0'));
      db.prepare('UPDATE matches SET cur_score_a = 0, cur_score_b = 0 WHERE id = ?').run(row.id);
      return { ...details(getTournament(t.id)!), serverReply: out.trim() };
    } catch (e) {
      return reply.code(502).send(E('serverNoReply', { reason: errBody(e) }));
    }
  });

  // Переиграть матч целиком: остановить на сервере, сбросить счёт серии и запустить заново.
  app.post<{ Params: { id: string; code: string } }>('/api/tournaments/:id/matches/:code/restart-match', ctrl, async (req, reply) => {
    const { t, row, server } = liveMatch(req);
    if (!t || !row) return reply.code(404).send(E('matchNotFound'));
    if (!server) return reply.code(409).send(E('matchNotOnServer'));
    await endMatchOnServer(server);
    release(t.id, row.id, encode(E('noteRestarted')));
    void dispatchAll();
    return details(getTournament(t.id)!);
  });

  app.post<{ Params: { id: string } }>('/api/tournaments/:id/auto-dispatch', ctrl, async (req, reply) => {
    const t = await requireTournament(req, reply);
    if (!t) return;
    const body = z.object({ enabled: z.boolean() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send(E('badRequest'));
    db.prepare('UPDATE tournaments SET auto_dispatch = ? WHERE id = ?').run(body.data.enabled ? 1 : 0, t.id);
    if (body.data.enabled) void dispatchAll();
    return details(getTournament(t.id)!);
  });

  // --- Регистрация команд: капитан или админ ---
  app.post<{ Params: { id: string } }>('/api/tournaments/:id/teams', async (req, reply) => {
    const session = getSession(req);
    if (!session) return reply.code(401).send(E('needLogin'));
    const t = await requireTournament(req, reply);
    if (!t) return;
    if (t.status !== 'registration') return reply.code(409).send(E('registrationClosed'));
    const body = z.object({ teamId: z.number().int(), playerIds: z.array(z.number().int()).optional() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send(E('needTeam'));

    const team = db.prepare('SELECT id, captain_id FROM teams WHERE id = ?')
      .get(body.data.teamId) as { id: number; captain_id: number } | undefined;
    if (!team) return reply.code(404).send(E('teamNotFound'));
    if (session.kind === 'player' && team.captain_id !== session.userId) {
      return reply.code(403).send(E('onlyCaptainRegister'));
    }
    const memberIds = (db.prepare('SELECT player_id FROM team_members WHERE team_id = ? ORDER BY joined_at, player_id')
      .all(team.id) as unknown as { player_id: number }[]).map((r) => r.player_id);
    const roster = body.data.playerIds ?? memberIds.slice(0, t.team_size);
    if (roster.length !== t.team_size || new Set(roster).size !== roster.length || !roster.every((p) => memberIds.includes(p))) {
      return reply.code(400).send(E('rosterSize', { n: t.team_size }));
    }
    const count = (db.prepare('SELECT COUNT(*) AS n FROM tournament_teams WHERE tournament_id = ?').get(t.id) as { n: number }).n;
    if (count >= t.max_teams) return reply.code(409).send(E('noSlots'));
    if (db.prepare('SELECT 1 FROM tournament_teams WHERE tournament_id = ? AND team_id = ?').get(t.id, team.id)) {
      return reply.code(409).send(E('alreadyRegistered'));
    }
    const others = db.prepare('SELECT roster FROM tournament_teams WHERE tournament_id = ?')
      .all(t.id) as unknown as { roster: string }[];
    const taken = new Set(others.flatMap((o) => JSON.parse(o.roster) as number[]));
    if (roster.some((p) => taken.has(p))) {
      return reply.code(409).send(E('playerTaken'));
    }
    db.prepare('INSERT INTO tournament_teams (tournament_id, team_id, roster) VALUES (?, ?, ?)')
      .run(t.id, team.id, JSON.stringify(roster));
    return reply.code(201).send(details(t));
  });

  app.delete<{ Params: { id: string; teamId: string } }>('/api/tournaments/:id/teams/:teamId', async (req, reply) => {
    const session = getSession(req);
    if (!session) return reply.code(401).send(E('needLogin'));
    const t = getTournament(Number(req.params.id));
    if (!t) return reply.code(404).send(E('tournamentNotFound'));
    if (t.status !== 'registration') return reply.code(409).send(E('registrationClosed'));
    const teamId = Number(req.params.teamId);
    if (session.kind === 'player') {
      const team = db.prepare('SELECT captain_id FROM teams WHERE id = ?').get(teamId) as { captain_id: number } | undefined;
      if (team?.captain_id !== session.userId) return reply.code(403).send(E('onlyCaptainUnregister'));
    }
    db.prepare('DELETE FROM tournament_teams WHERE tournament_id = ? AND team_id = ?').run(t.id, teamId);
    return details(t);
  });
}
