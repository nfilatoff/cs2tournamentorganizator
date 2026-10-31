import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db, tx } from '../db.js';
import { getSession, requireAdmin } from '../auth.js';
import {
  buildBracket, champion, forceWinner, minTeams, reportResult, roundFromEnd, roundLabel, undoResult,
  type BMatch, type BracketId, type Entry, type Format, type Source, type Status,
} from '../bracket.js';

interface TournamentRow {
  id: number; name: string; format: Format; team_size: number; max_teams: number;
  default_best_of: number; bo_config: string; grand_final_reset: number;
  status: 'registration' | 'running' | 'finished'; champion_team_id: number | null;
}
interface MatchRow {
  code: string; bracket: BracketId; round: number; position: number;
  src_a: string; src_b: string; entry_a: string; entry_b: string;
  winner: 'a' | 'b' | null; status: Status; best_of: number; score_a: number; score_b: number; forced: number;
}

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
  mapIds: z.array(z.number().int()).max(MAX_MAPS),
});

const getTournament = (id: number) =>
  db.prepare('SELECT * FROM tournaments WHERE id = ?').get(id) as unknown as TournamentRow | undefined;

function loadMatches(tid: number): BMatch[] {
  const rows = db.prepare('SELECT * FROM matches WHERE tournament_id = ? ORDER BY id').all(tid) as unknown as MatchRow[];
  return rows.map((r) => ({
    code: r.code, bracket: r.bracket, round: r.round, position: r.position,
    srcA: JSON.parse(r.src_a) as Source, srcB: JSON.parse(r.src_b) as Source,
    a: JSON.parse(r.entry_a) as Entry, b: JSON.parse(r.entry_b) as Entry,
    winner: r.winner, status: r.status, bestOf: r.best_of, scoreA: r.score_a, scoreB: r.score_b, forced: !!r.forced,
  }));
}

function saveMatches(tid: number, ms: BMatch[]): void {
  const upd = db.prepare(`UPDATE matches SET entry_a = ?, entry_b = ?, winner = ?, status = ?, score_a = ?, score_b = ?, forced = ?
    WHERE tournament_id = ? AND code = ?`);
  for (const m of ms) {
    upd.run(JSON.stringify(m.a), JSON.stringify(m.b), m.winner, m.status, m.scoreA, m.scoreB, m.forced ? 1 : 0, tid, m.code);
  }
}

function boFn(t: TournamentRow) {
  const cfg = JSON.parse(t.bo_config) as Record<string, number>;
  return (bracket: BracketId, fromEnd: number) =>
    cfg[bracket === 'GF' ? 'GF' : `${bracket}${fromEnd}`] ?? t.default_best_of;
}

// Раунды для формы создания: ключ BO и подпись для заданных формата и числа команд.
function previewRounds(format: Format, maxTeams: number) {
  const ids = Array.from({ length: Math.max(maxTeams, minTeams(format)) }, (_, i) => i + 1);
  const ms = buildBracket(ids, format);
  const seen = new Map<string, string>();
  for (const bracket of ['W', 'L', 'GF'] as const) {
    const rounds = [...new Set(ms.filter((m) => m.bracket === bracket).map((m) => m.round))].sort((x, y) => x - y);
    for (const r of rounds) {
      const fromEnd = roundFromEnd(ms, { bracket, round: r });
      const key = bracket === 'GF' ? 'GF' : `${bracket}${fromEnd}`;
      if (!seen.has(key)) seen.set(key, roundLabel(bracket, fromEnd, format));
    }
  }
  return [...seen].map(([key, label]) => ({ key, label }));
}

function teamName(id: number): string {
  const r = db.prepare('SELECT name FROM teams WHERE id = ?').get(id) as { name: string } | undefined;
  return r?.name ?? `Команда ${id}`;
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
  return {
    id: t.id, name: t.name, format: t.format, teamSize: t.team_size, maxTeams: t.max_teams,
    defaultBestOf: t.default_best_of, boConfig: JSON.parse(t.bo_config) as Record<string, number>,
    grandFinalReset: !!t.grand_final_reset, status: t.status,
    champion: t.champion_team_id ? { id: t.champion_team_id, name: teamName(t.champion_team_id) } : null,
    teams: teams.map((x) => ({ id: x.team_id, name: x.name, seed: x.seed, roster: JSON.parse(x.roster) as number[] })),
    maps: maps.map((m) => ({ id: m.id, name: m.name, workshopId: m.workshop_id, mapFile: m.map_file, imageUrl: m.image_url })),
    matches: ms.map((m) => ({
      code: m.code, bracket: m.bracket, round: m.round, position: m.position,
      roundLabel: roundLabel(m.bracket, roundFromEnd(ms, m), t.format),
      a: entryDto(m.a), b: entryDto(m.b), status: m.status, winner: m.winner,
      bestOf: m.bestOf, scoreA: m.scoreA, scoreB: m.scoreB, forced: m.forced,
    })),
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

// Сохраняет матчи и пересчитывает статус турнира: есть чемпион — завершён, иначе идёт.
function commit(t: TournamentRow, ms: BMatch[]): void {
  tx(() => {
    saveMatches(t.id, ms);
    const champ = champion(ms, t.format);
    db.prepare('UPDATE tournaments SET status = ?, champion_team_id = ? WHERE id = ?')
      .run(champ !== null ? 'finished' : 'running', champ, t.id);
  });
}

async function requireTournament(req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) {
  const t = getTournament(Number(req.params.id));
  if (!t) await reply.code(404).send({ error: 'Турнир не найден' });
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
    if (!q.success) return reply.code(400).send({ error: 'Некорректные параметры' });
    return previewRounds(q.data.format, q.data.maxTeams);
  });

  app.get<{ Params: { id: string } }>('/api/tournaments/:id', async (req, reply) => {
    const t = await requireTournament(req, reply);
    return t ? details(t) : undefined;
  });

  // --- Админ ---
  app.post('/api/tournaments', { preHandler: requireAdmin }, async (req, reply) => {
    const body = tournamentBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Некорректные данные турнира' });
    const d = body.data;
    if (d.maxTeams < minTeams(d.format)) {
      return reply.code(400).send({ error: `Минимум команд для этого формата: ${minTeams(d.format)}` });
    }
    const id = tx(() => {
      const res = db.prepare(`INSERT INTO tournaments
        (name, format, team_size, max_teams, default_best_of, bo_config, grand_final_reset) VALUES (?, ?, ?, ?, ?, ?, ?)`)
        .run(d.name, d.format, d.teamSize, d.maxTeams, d.defaultBestOf, JSON.stringify(d.boConfig), d.grandFinalReset ? 1 : 0);
      const tid = Number(res.lastInsertRowid);
      if (!setMaps(tid, d.mapIds)) throw new Error('map');
      return tid;
    });
    return reply.code(201).send(details(getTournament(id)!));
  });

  app.put<{ Params: { id: string } }>('/api/tournaments/:id', { preHandler: requireAdmin }, async (req, reply) => {
    const t = await requireTournament(req, reply);
    if (!t) return;
    if (t.status !== 'registration') return reply.code(409).send({ error: 'Турнир уже начался' });
    const body = tournamentBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Некорректные данные турнира' });
    const d = body.data;
    if (d.maxTeams < minTeams(d.format)) {
      return reply.code(400).send({ error: `Минимум команд для этого формата: ${minTeams(d.format)}` });
    }
    const registered = (db.prepare('SELECT COUNT(*) AS n FROM tournament_teams WHERE tournament_id = ?')
      .get(t.id) as { n: number }).n;
    if (registered > d.maxTeams) return reply.code(409).send({ error: 'Уже зарегистрировано больше команд' });
    if (d.teamSize !== t.team_size && registered > 0) {
      return reply.code(409).send({ error: 'Нельзя менять размер команды при наличии заявок' });
    }
    tx(() => {
      db.prepare(`UPDATE tournaments SET name = ?, format = ?, team_size = ?, max_teams = ?, default_best_of = ?,
        bo_config = ?, grand_final_reset = ? WHERE id = ?`)
        .run(d.name, d.format, d.teamSize, d.maxTeams, d.defaultBestOf, JSON.stringify(d.boConfig), d.grandFinalReset ? 1 : 0, t.id);
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
    if (t.status !== 'registration') return reply.code(409).send({ error: 'Турнир уже начался' });
    const body = z.object({ shuffle: z.boolean().default(false) }).safeParse(req.body ?? {});
    const shuffle = body.success ? body.data.shuffle : false;

    const teamIds = (db.prepare('SELECT team_id FROM tournament_teams WHERE tournament_id = ? ORDER BY registered_at, rowid')
      .all(t.id) as unknown as { team_id: number }[]).map((r) => r.team_id);
    if (teamIds.length < minTeams(t.format)) {
      return reply.code(409).send({ error: `Нужно минимум ${minTeams(t.format)} команды(ы)` });
    }
    const mapCount = (db.prepare('SELECT COUNT(*) AS n FROM tournament_maps WHERE tournament_id = ?').get(t.id) as { n: number }).n;
    if (mapCount === 0) return reply.code(409).send({ error: 'Добавьте карты в пул турнира' });

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
    return details(getTournament(t.id)!);
  });

  app.post<{ Params: { id: string; code: string } }>(
    '/api/tournaments/:id/matches/:code/result',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const t = getTournament(Number(req.params.id));
      if (!t) return reply.code(404).send({ error: 'Турнир не найден' });
      if (t.status !== 'running') return reply.code(409).send({ error: 'Турнир не идёт' });
      const body = z.object({ scoreA: z.number().int().min(0), scoreB: z.number().int().min(0) }).safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'Укажите счёт' });
      const ms = loadMatches(t.id);
      try {
        reportResult(ms, req.params.code, body.data.scoreA, body.data.scoreB);
      } catch (e) {
        return reply.code(400).send({ error: (e as Error).message });
      }
      commit(t, ms);
      return details(getTournament(t.id)!);
    },
  );

  // Админ: назначить победителя без счёта
  app.post<{ Params: { id: string; code: string } }>(
    '/api/tournaments/:id/matches/:code/winner',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const t = getTournament(Number(req.params.id));
      if (!t) return reply.code(404).send({ error: 'Турнир не найден' });
      if (t.status !== 'running') return reply.code(409).send({ error: 'Турнир не идёт' });
      const body = z.object({ winner: z.enum(['a', 'b']) }).safeParse(req.body);
      if (!body.success) return reply.code(400).send({ error: 'Укажите победителя' });
      const ms = loadMatches(t.id);
      try {
        forceWinner(ms, req.params.code, body.data.winner);
      } catch (e) {
        return reply.code(400).send({ error: (e as Error).message });
      }
      commit(t, ms);
      return details(getTournament(t.id)!);
    },
  );

  // Админ: отменить результат матча (в том числе в завершённом турнире)
  app.post<{ Params: { id: string; code: string } }>(
    '/api/tournaments/:id/matches/:code/undo',
    { preHandler: requireAdmin },
    async (req, reply) => {
      const t = getTournament(Number(req.params.id));
      if (!t) return reply.code(404).send({ error: 'Турнир не найден' });
      if (t.status === 'registration') return reply.code(409).send({ error: 'Турнир не начался' });
      const ms = loadMatches(t.id);
      try {
        undoResult(ms, req.params.code);
      } catch (e) {
        return reply.code(400).send({ error: (e as Error).message });
      }
      commit(t, ms);
      return details(getTournament(t.id)!);
    },
  );

  // --- Регистрация команд: капитан или админ ---
  app.post<{ Params: { id: string } }>('/api/tournaments/:id/teams', async (req, reply) => {
    const session = getSession(req);
    if (!session) return reply.code(401).send({ error: 'Нужен вход' });
    const t = await requireTournament(req, reply);
    if (!t) return;
    if (t.status !== 'registration') return reply.code(409).send({ error: 'Регистрация закрыта' });
    const body = z.object({ teamId: z.number().int(), playerIds: z.array(z.number().int()).optional() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Укажите команду' });

    const team = db.prepare('SELECT id, captain_id FROM teams WHERE id = ?')
      .get(body.data.teamId) as { id: number; captain_id: number } | undefined;
    if (!team) return reply.code(404).send({ error: 'Команда не найдена' });
    if (session.kind === 'player' && team.captain_id !== session.userId) {
      return reply.code(403).send({ error: 'Регистрировать команду может только капитан' });
    }
    const memberIds = (db.prepare('SELECT player_id FROM team_members WHERE team_id = ? ORDER BY joined_at, player_id')
      .all(team.id) as unknown as { player_id: number }[]).map((r) => r.player_id);
    const roster = body.data.playerIds ?? memberIds.slice(0, t.team_size);
    if (roster.length !== t.team_size || new Set(roster).size !== roster.length || !roster.every((p) => memberIds.includes(p))) {
      return reply.code(400).send({ error: `Нужно выбрать ровно ${t.team_size} игроков из команды` });
    }
    const count = (db.prepare('SELECT COUNT(*) AS n FROM tournament_teams WHERE tournament_id = ?').get(t.id) as { n: number }).n;
    if (count >= t.max_teams) return reply.code(409).send({ error: 'Все места заняты' });
    if (db.prepare('SELECT 1 FROM tournament_teams WHERE tournament_id = ? AND team_id = ?').get(t.id, team.id)) {
      return reply.code(409).send({ error: 'Команда уже зарегистрирована' });
    }
    const others = db.prepare('SELECT roster FROM tournament_teams WHERE tournament_id = ?')
      .all(t.id) as unknown as { roster: string }[];
    const taken = new Set(others.flatMap((o) => JSON.parse(o.roster) as number[]));
    if (roster.some((p) => taken.has(p))) {
      return reply.code(409).send({ error: 'Кто-то из игроков уже заявлен в другой команде этого турнира' });
    }
    db.prepare('INSERT INTO tournament_teams (tournament_id, team_id, roster) VALUES (?, ?, ?)')
      .run(t.id, team.id, JSON.stringify(roster));
    return reply.code(201).send(details(t));
  });

  app.delete<{ Params: { id: string; teamId: string } }>('/api/tournaments/:id/teams/:teamId', async (req, reply) => {
    const session = getSession(req);
    if (!session) return reply.code(401).send({ error: 'Нужен вход' });
    const t = getTournament(Number(req.params.id));
    if (!t) return reply.code(404).send({ error: 'Турнир не найден' });
    if (t.status !== 'registration') return reply.code(409).send({ error: 'Регистрация закрыта' });
    const teamId = Number(req.params.teamId);
    if (session.kind === 'player') {
      const team = db.prepare('SELECT captain_id FROM teams WHERE id = ?').get(teamId) as { captain_id: number } | undefined;
      if (team?.captain_id !== session.userId) return reply.code(403).send({ error: 'Только капитан может снять заявку' });
    }
    db.prepare('DELETE FROM tournament_teams WHERE tournament_id = ? AND team_id = ?').run(t.id, teamId);
    return details(t);
  });
}
