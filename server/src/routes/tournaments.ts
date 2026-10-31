import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { E, encode, errBody, type ErrorBody } from '../errors.js';
import { z } from 'zod';
import { db, tx } from '../db.js';
import { getSession, requireAdmin } from '../auth.js';
import {
  boFn, clearRuntime, getMatchRowByCode, getTournament, insertMatches, loadMatches, saveMatches,
  type MatchRow, type TournamentRow,
} from '../tournamentStore.js';
import { dispatchAll, dispatchOne, endMatchOnServer, getServer, release, withRcon } from '../dispatcher.js';
import { details, playoffPreviewDto, previewDto, renumberSeeds } from '../tournamentDto.js';
import {
  advanceGroupStage, applyChanges, checkPlayoffOrder, createGroupMatches, generatePlayoff, prepareGroupUndo,
  resetPlayoff, suggestedPlayoff, validateGroupStart,
} from '../groupStage.js';
import {
  buildBracket, forceWinner, minTeams, reportResult, roundFromEnd, undoResult,
  type BracketId, type Format,
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
  stageMode: z.enum(['playoff', 'groups']).default('playoff'),
  groupFormat: z.enum(['round_robin', 'swiss', 'gsl']).optional(),
  groupsCount: z.number().int().min(1).max(16).default(1),
  advance: z.number().int().min(1).max(32).default(2),
  swissRounds: z.number().int().min(1).max(15).optional(),
  groupBestOf: BEST_OF.default(1),
  hasPlayoff: z.boolean().default(true),
});

// Проверка настроек группового этапа при создании и изменении турнира
function validateConfig(d: z.infer<typeof tournamentBody>): ErrorBody | null {
  if (d.stageMode === 'playoff') return null;
  if (!d.groupFormat) return E('badGroupConfig');
  if (d.groupFormat === 'swiss' && d.groupsCount !== 1) return E('badGroupConfig');
  if (d.groupFormat === 'gsl') {
    if (d.maxTeams !== d.groupsCount * 4) return E('gslNeedsTeams', { n: d.groupsCount * 4 });
    if (d.advance > 2) return E('badGroupConfig');
  }
  if (d.groupFormat === 'round_robin' && Math.floor(d.maxTeams / d.groupsCount) < Math.max(2, d.advance)) {
    return E('groupTooSmall', { n: Math.max(2, d.advance) * d.groupsCount });
  }
  if (d.groupFormat === 'swiss' && d.advance > d.maxTeams) return E('badGroupConfig');
  const size = d.groupFormat === 'swiss' ? d.advance : d.groupsCount * d.advance;
  if (d.hasPlayoff ? size < 2 || size > 64 : d.groupsCount !== 1) return E('badGroupConfig');
  return null;
}

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
    const cfgError = validateConfig(d);
    if (cfgError) return reply.code(400).send(cfgError);
    const id = tx(() => {
      const res = db.prepare(`INSERT INTO tournaments
        (name, format, team_size, max_teams, default_best_of, bo_config, grand_final_reset, auto_dispatch,
        stage_mode, group_format, groups_count, advance, swiss_rounds, group_best_of, has_playoff, phase)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(d.name, d.format, d.teamSize, d.maxTeams, d.defaultBestOf, JSON.stringify(d.boConfig), d.grandFinalReset ? 1 : 0, d.autoDispatch ? 1 : 0,
          d.stageMode, d.stageMode === 'groups' ? d.groupFormat ?? null : null, d.stageMode === 'groups' ? d.groupsCount : 1,
          d.advance, d.swissRounds ?? null, d.groupBestOf, d.hasPlayoff ? 1 : 0, d.stageMode === 'groups' ? 'groups' : 'playoff');
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
    const cfgError = validateConfig(d);
    if (cfgError) return reply.code(400).send(cfgError);
    const registered = (db.prepare('SELECT COUNT(*) AS n FROM tournament_teams WHERE tournament_id = ?')
      .get(t.id) as { n: number }).n;
    if (registered > d.maxTeams) return reply.code(409).send(E('tooManyRegistered'));
    if (d.teamSize !== t.team_size && registered > 0) {
      return reply.code(409).send(E('teamSizeLocked'));
    }
    tx(() => {
      db.prepare(`UPDATE tournaments SET name = ?, format = ?, team_size = ?, max_teams = ?, default_best_of = ?,
        bo_config = ?, grand_final_reset = ?, auto_dispatch = ?, stage_mode = ?, group_format = ?, groups_count = ?, advance = ?,
        swiss_rounds = ?, group_best_of = ?, has_playoff = ?, phase = ? WHERE id = ?`)
        .run(d.name, d.format, d.teamSize, d.maxTeams, d.defaultBestOf, JSON.stringify(d.boConfig), d.grandFinalReset ? 1 : 0, d.autoDispatch ? 1 : 0,
          d.stageMode, d.stageMode === 'groups' ? d.groupFormat ?? null : null, d.stageMode === 'groups' ? d.groupsCount : 1,
          d.advance, d.swissRounds ?? null, d.groupBestOf, d.hasPlayoff ? 1 : 0, d.stageMode === 'groups' ? 'groups' : 'playoff', t.id);
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

    const teamIds = (db.prepare('SELECT team_id FROM tournament_teams WHERE tournament_id = ? ORDER BY COALESCE(seed, 9999), registered_at, rowid')
      .all(t.id) as unknown as { team_id: number }[]).map((r) => r.team_id);
    if (t.stage_mode !== 'groups' && teamIds.length < minTeams(t.format)) {
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
    if (t.stage_mode === 'groups') {
      try {
        validateGroupStart(t, teamIds.length);
      } catch (e) {
        return reply.code(409).send(errBody(e));
      }
    }
    const ms = t.stage_mode === 'groups' ? [] : buildBracket(teamIds, t.format, { grandFinalReset: !!t.grand_final_reset, bestOf: boFn(t) });
    tx(() => {
      const seedUpd = db.prepare('UPDATE tournament_teams SET seed = ? WHERE tournament_id = ? AND team_id = ?');
      teamIds.forEach((id, i) => seedUpd.run(i + 1, t.id, id));
      if (t.stage_mode === 'groups') {
        createGroupMatches(t, teamIds);
      } else {
        insertMatches(t.id, ms, 'playoff');
        db.prepare('UPDATE tournament_teams SET playoff_seed = seed WHERE tournament_id = ?').run(t.id);
      }
      db.prepare("UPDATE tournaments SET status = 'running' WHERE id = ?").run(t.id);
    });
    advanceGroupStage(t.id);
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
      applyChanges(t, ms);
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
      applyChanges(t, ms);
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
        prepareGroupUndo(t, ms, req.params.code);
        undoResult(ms, req.params.code);
      } catch (e) {
        return reply.code(400).send(errBody(e));
      }
      applyChanges(t, ms);
      void dispatchAll();
      return details(getTournament(t.id)!);
    },
  );

  // --- Рассадка и предпросмотр сетки до старта ---
  app.get<{ Params: { id: string } }>('/api/tournaments/:id/preview', async (req, reply) => {
    const t = await requireTournament(req, reply);
    return t ? previewDto(t) : undefined;
  });

  app.put<{ Params: { id: string } }>('/api/tournaments/:id/seeding', { preHandler: requireAdmin }, async (req, reply) => {
    const t = await requireTournament(req, reply);
    if (!t) return;
    if (t.status !== 'registration') return reply.code(409).send(E('alreadyStarted'));
    const body = z.object({ order: z.array(z.number().int()) }).safeParse(req.body);
    const current = (db.prepare('SELECT team_id FROM tournament_teams WHERE tournament_id = ?').all(t.id) as unknown as { team_id: number }[])
      .map((r) => r.team_id);
    if (!body.success || body.data.order.length !== current.length
      || new Set(body.data.order).size !== current.length || !body.data.order.every((id) => current.includes(id))) {
      return reply.code(400).send(E('badSeeding'));
    }
    const upd = db.prepare('UPDATE tournament_teams SET seed = ? WHERE tournament_id = ? AND team_id = ?');
    tx(() => body.data.order.forEach((id, i) => upd.run(i + 1, t.id, id)));
    return details(getTournament(t.id)!);
  });

  app.post<{ Params: { id: string } }>('/api/tournaments/:id/seeding/shuffle', { preHandler: requireAdmin }, async (req, reply) => {
    const t = await requireTournament(req, reply);
    if (!t) return;
    if (t.status !== 'registration') return reply.code(409).send(E('alreadyStarted'));
    const ids = (db.prepare('SELECT team_id FROM tournament_teams WHERE tournament_id = ?').all(t.id) as unknown as { team_id: number }[])
      .map((r) => r.team_id);
    for (let i = ids.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    }
    const upd = db.prepare('UPDATE tournament_teams SET seed = ? WHERE tournament_id = ? AND team_id = ?');
    tx(() => ids.forEach((id, i) => upd.run(i + 1, t.id, id)));
    return details(getTournament(t.id)!);
  });

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

  // --- Плей-офф после группового этапа (админ) ---
  app.post<{ Params: { id: string } }>('/api/tournaments/:id/playoff/preview', ctrl, async (req, reply) => {
    const t = await requireTournament(req, reply);
    if (!t) return;
    if (t.phase !== 'groups_done') return reply.code(409).send(E('groupsNotFinished'));
    const body = z.object({ order: z.array(z.number().int()).optional() }).safeParse(req.body ?? {});
    try {
      if (body.success && body.data.order) checkPlayoffOrder(t, body.data.order);
      return playoffPreviewDto(t, body.success ? body.data.order : undefined);
    } catch (e) {
      return reply.code(400).send(errBody(e));
    }
  });

  app.post<{ Params: { id: string } }>('/api/tournaments/:id/playoff', ctrl, async (req, reply) => {
    const t = await requireTournament(req, reply);
    if (!t) return;
    const body = z.object({ order: z.array(z.number().int()).optional() }).safeParse(req.body ?? {});
    try {
      generatePlayoff(t, (body.success ? body.data.order : undefined) ?? suggestedPlayoff(t).order.map((q) => q.teamId));
    } catch (e) {
      return reply.code(409).send(errBody(e));
    }
    void dispatchAll();
    return details(getTournament(t.id)!);
  });

  app.post<{ Params: { id: string } }>('/api/tournaments/:id/playoff/reset', ctrl, async (req, reply) => {
    const t = await requireTournament(req, reply);
    if (!t) return;
    try {
      resetPlayoff(t);
    } catch (e) {
      return reply.code(409).send(errBody(e));
    }
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
    db.prepare(`INSERT INTO tournament_teams (tournament_id, team_id, roster, seed)
      VALUES (?, ?, ?, (SELECT COALESCE(MAX(seed), 0) + 1 FROM tournament_teams WHERE tournament_id = ?))`)
      .run(t.id, team.id, JSON.stringify(roster), t.id);
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
    renumberSeeds(t.id);
    return details(t);
  });
}
