import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, tx } from '../db.js';
import { requireAdmin } from '../auth.js';
import { E } from '../errors.js';
import {
  MAX_MEMBERS, deleteTeam, getTeam, inActiveRoster, inActiveTournament, members, teamDto, type TeamRow,
} from './teams.js';

const playerBody = z.object({
  steamId: z.string().regex(/^\d{17}$/),
  name: z.string().trim().min(1).max(40),
});
export const teamBody = z.object({
  name: z.string().trim().min(2).max(30),
  players: z.array(playerBody).min(1).max(MAX_MEMBERS),
});

// Игрок с таким SteamID уже мог входить через Steam: тогда его запись сохраняется как есть.
function ensurePlayer(p: z.infer<typeof playerBody>): number {
  const existing = db.prepare('SELECT id FROM players WHERE steam_id = ?').get(p.steamId) as { id: number } | undefined;
  if (existing) return existing.id;
  const res = db.prepare("INSERT INTO players (steam_id, name, admin_name, source) VALUES (?, ?, ?, 'admin')").run(p.steamId, p.name, p.name);
  return Number(res.lastInsertRowid);
}

// Создаёт команду и игроков (если их ещё нет). Капитан — первый игрок списка. Бросает ошибку SQLite при занятом названии.
export function createTeamWithPlayers(name: string, players: z.infer<typeof playerBody>[]): TeamRow {
  return tx(() => {
    const ids = players.map(ensurePlayer);
    const res = db.prepare('INSERT INTO teams (name, join_code, captain_id) VALUES (?, ?, ?)')
      .run(name, randomBytes(5).toString('hex').toUpperCase(), ids[0]!);
    const teamId = Number(res.lastInsertRowid);
    const ins = db.prepare('INSERT INTO team_members (team_id, player_id) VALUES (?, ?)');
    for (const id of ids) ins.run(teamId, id);
    return getTeam(teamId)!;
  });
}

const listTeams = () =>
  db.prepare('SELECT * FROM teams WHERE deleted_name IS NULL ORDER BY name').all() as unknown as TeamRow[];

export async function adminTeamRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAdmin);

  app.get('/api/admin/teams', async () => listTeams().map(teamDto));

  // Удаляет все команды, кроме заявленных в незавершённых турнирах: без них эти турниры не смогут продолжиться
  app.post('/api/admin/teams/delete-all', async () => tx(() => {
    const teams = listTeams();
    const deletable = teams.filter((team) => !inActiveTournament(team.id));
    deletable.forEach(deleteTeam);
    return { deleted: deletable.length, skipped: teams.length - deletable.length };
  }));

  // Админ создаёт команду сам: игроки задаются SteamID64 и ником, капитан — первый в списке
  app.post('/api/admin/teams', async (req, reply) => {
    const body = teamBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send(E('badTeam'));
    const unique = new Set(body.data.players.map((p) => p.steamId));
    if (unique.size !== body.data.players.length) return reply.code(400).send(E('duplicatePlayer'));
    try {
      const team = createTeamWithPlayers(body.data.name, body.data.players);
      return reply.code(201).send(teamDto(team));
    } catch {
      return reply.code(409).send(E('teamNameTaken'));
    }
  });

  app.put<{ Params: { id: string } }>('/api/admin/teams/:id', async (req, reply) => {
    const body = z.object({ name: z.string().trim().min(2).max(30) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send(E('teamNameLength'));
    const team = getTeam(Number(req.params.id));
    if (!team) return reply.code(404).send(E('teamNotFound'));
    try {
      db.prepare('UPDATE teams SET name = ? WHERE id = ?').run(body.data.name, team.id);
    } catch {
      return reply.code(409).send(E('teamNameTaken'));
    }
    return teamDto({ ...team, name: body.data.name });
  });

  app.post<{ Params: { id: string } }>('/api/admin/teams/:id/members', async (req, reply) => {
    const body = playerBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send(E('badTeam'));
    const team = getTeam(Number(req.params.id));
    if (!team) return reply.code(404).send(E('teamNotFound'));
    const list = members(team.id);
    if (list.length >= MAX_MEMBERS) return reply.code(409).send(E('teamFull'));
    const pid = ensurePlayer(body.data);
    if (list.some((m) => m.player_id === pid)) return reply.code(409).send(E('alreadyMember'));
    db.prepare('INSERT INTO team_members (team_id, player_id) VALUES (?, ?)').run(team.id, pid);
    return teamDto(team);
  });

  app.delete<{ Params: { id: string; playerId: string } }>('/api/admin/teams/:id/members/:playerId', async (req, reply) => {
    const team = getTeam(Number(req.params.id));
    if (!team) return reply.code(404).send(E('teamNotFound'));
    const pid = Number(req.params.playerId);
    if (pid === team.captain_id) return reply.code(400).send(E('cannotKickCaptain'));
    if (inActiveRoster(team.id, pid)) return reply.code(409).send(E('playerInActiveRoster'));
    db.prepare('DELETE FROM team_members WHERE team_id = ? AND player_id = ?').run(team.id, pid);
    return teamDto(team);
  });

  app.post<{ Params: { id: string } }>('/api/admin/teams/:id/captain', async (req, reply) => {
    const body = z.object({ playerId: z.number().int() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send(E('needPlayer'));
    const team = getTeam(Number(req.params.id));
    if (!team) return reply.code(404).send(E('teamNotFound'));
    if (!members(team.id).some((m) => m.player_id === body.data.playerId)) return reply.code(400).send(E('notTeamMember'));
    db.prepare('UPDATE teams SET captain_id = ? WHERE id = ?').run(body.data.playerId, team.id);
    return teamDto({ ...team, captain_id: body.data.playerId });
  });

  app.delete<{ Params: { id: string } }>('/api/admin/teams/:id', async (req, reply) => {
    const team = getTeam(Number(req.params.id));
    if (!team) return reply.code(404).send(E('teamNotFound'));
    if (inActiveTournament(team.id)) return reply.code(409).send(E('teamInTournament'));
    deleteTeam(team);
    return { ok: true };
  });
}
