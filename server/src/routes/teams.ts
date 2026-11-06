import { randomBytes } from 'node:crypto';
import { E } from '../errors.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, tx } from '../db.js';
import { getSession, requirePlayer } from '../auth.js';

export const MAX_MEMBERS = 10;

export interface TeamRow { id: number; name: string; join_code: string; captain_id: number }
interface MemberRow { player_id: number; name: string; steam_id: string; avatar_url: string | null; steam_name: string | null; custom_name: string | null; admin_name: string | null }

function playerId(req: Parameters<typeof getSession>[0]): number {
  return getSession(req)!.userId;
}

export function members(teamId: number): MemberRow[] {
  return db.prepare(`
    SELECT tm.player_id, p.name, p.steam_id, p.avatar_url, p.steam_name, p.custom_name, p.admin_name
    FROM team_members tm JOIN players p ON p.id = tm.player_id
    WHERE tm.team_id = ? ORDER BY tm.joined_at, tm.player_id
  `).all(teamId) as unknown as MemberRow[];
}

export function teamDto(t: TeamRow) {
  return {
    id: t.id,
    name: t.name,
    joinCode: t.join_code,
    captainId: t.captain_id,
    members: members(t.id).map((m) => ({
      id: m.player_id, name: m.name, steamId: m.steam_id, avatarUrl: m.avatar_url,
      steamName: m.steam_name, customName: m.custom_name, adminName: m.admin_name,
    })),
  };
}

// Игрок состоит в составе команды, заявленной в незавершённом турнире.
export function inActiveRoster(teamId: number, pid: number): boolean {
  const rows = db.prepare(`
    SELECT tt.roster FROM tournament_teams tt JOIN tournaments t ON t.id = tt.tournament_id
    WHERE tt.team_id = ? AND t.status != 'finished'
  `).all(teamId) as unknown as { roster: string }[];
  return rows.some((r) => (JSON.parse(r.roster) as number[]).includes(pid));
}

export function inActiveTournament(teamId: number): boolean {
  return !!db.prepare(`
    SELECT 1 FROM tournament_teams tt JOIN tournaments t ON t.id = tt.tournament_id
    WHERE tt.team_id = ? AND t.status != 'finished'
  `).get(teamId);
}

export const getTeam = (id: number) =>
  db.prepare('SELECT * FROM teams WHERE id = ? AND deleted_name IS NULL').get(id) as unknown as TeamRow | undefined;

// На команду из завершённых турниров ссылается их история, поэтому её запись остаётся: команда пропадает из списков
// и освобождает название, а в истории показывается под прежним именем. Заглушка длиннее допустимого названия и не в
// верхнем регистре, как коды приглашения, поэтому не совпадёт ни с названием новой команды, ни с вводом кода.
export function deleteTeam(team: TeamRow): void {
  tx(() => {
    const inHistory = db.prepare(`SELECT 1 FROM tournament_teams WHERE team_id = ?
      UNION ALL SELECT 1 FROM tournaments WHERE champion_team_id = ?`).get(team.id, team.id);
    if (!inHistory) {
      db.prepare('DELETE FROM teams WHERE id = ?').run(team.id);
      return;
    }
    const stub = `deleted-team-${team.id}-${randomBytes(8).toString('hex')}`;
    db.prepare('DELETE FROM team_members WHERE team_id = ?').run(team.id);
    db.prepare('UPDATE teams SET deleted_name = ?, name = ?, join_code = ? WHERE id = ?').run(team.name, stub, stub, team.id);
  });
}

export async function teamRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requirePlayer);

  app.get('/api/teams/mine', async (req) => {
    const rows = db.prepare(`
      SELECT t.* FROM teams t JOIN team_members tm ON tm.team_id = t.id
      WHERE tm.player_id = ? ORDER BY t.name
    `).all(playerId(req)) as unknown as TeamRow[];
    return rows.map(teamDto);
  });

  app.post('/api/teams', async (req, reply) => {
    const body = z.object({ name: z.string().trim().min(2).max(30) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send(E('teamNameLength'));
    const pid = playerId(req);
    try {
      const team = tx(() => {
        const code = randomBytes(5).toString('hex').toUpperCase();
        const res = db.prepare('INSERT INTO teams (name, join_code, captain_id) VALUES (?, ?, ?)')
          .run(body.data.name, code, pid);
        const id = Number(res.lastInsertRowid);
        db.prepare('INSERT INTO team_members (team_id, player_id) VALUES (?, ?)').run(id, pid);
        return db.prepare('SELECT * FROM teams WHERE id = ?').get(id) as unknown as TeamRow;
      });
      return reply.code(201).send(teamDto(team));
    } catch {
      return reply.code(409).send(E('teamNameTaken'));
    }
  });

  app.post('/api/teams/join', async (req, reply) => {
    const body = z.object({ code: z.string().trim().min(1) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send(E('needCode'));
    const team = db.prepare('SELECT * FROM teams WHERE join_code = ?')
      .get(body.data.code.toUpperCase()) as unknown as TeamRow | undefined;
    if (!team) return reply.code(404).send(E('codeNotFound'));
    const pid = playerId(req);
    if (members(team.id).some((m) => m.player_id === pid)) {
      return reply.code(409).send(E('alreadyMember'));
    }
    if (members(team.id).length >= MAX_MEMBERS) return reply.code(409).send(E('teamFull'));
    db.prepare('INSERT INTO team_members (team_id, player_id) VALUES (?, ?)').run(team.id, pid);
    return teamDto(team);
  });

  app.post<{ Params: { id: string } }>('/api/teams/:id/leave', async (req, reply) => {
    const id = Number(req.params.id);
    const pid = playerId(req);
    const team = getTeam(id);
    if (!team || !members(id).some((m) => m.player_id === pid)) {
      return reply.code(404).send(E('notMember'));
    }
    if (inActiveRoster(id, pid)) {
      return reply.code(409).send(E('selfInActiveRoster'));
    }
    const rest = members(id).filter((m) => m.player_id !== pid);
    if (rest.length === 0 && inActiveTournament(id)) {
      return reply.code(409).send(E('teamInTournament'));
    }
    tx(() => {
      db.prepare('DELETE FROM team_members WHERE team_id = ? AND player_id = ?').run(id, pid);
      if (rest.length === 0) {
        deleteTeam(team);
      } else if (team.captain_id === pid) {
        db.prepare('UPDATE teams SET captain_id = ? WHERE id = ?').run(rest[0]!.player_id, id);
      }
    });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/teams/:id/kick', async (req, reply) => {
    const body = z.object({ playerId: z.number().int() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send(E('needPlayer'));
    const id = Number(req.params.id);
    const team = getTeam(id);
    if (!team || team.captain_id !== playerId(req)) return reply.code(403).send(E('onlyCaptainKick'));
    if (body.data.playerId === team.captain_id) return reply.code(400).send(E('cannotKickCaptain'));
    if (inActiveRoster(id, body.data.playerId)) {
      return reply.code(409).send(E('playerInActiveRoster'));
    }
    db.prepare('DELETE FROM team_members WHERE team_id = ? AND player_id = ?').run(id, body.data.playerId);
    return { ok: true };
  });

  // Капитан передаёт роль другому участнику команды
  app.post<{ Params: { id: string } }>('/api/teams/:id/captain', async (req, reply) => {
    const body = z.object({ playerId: z.number().int() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send(E('needPlayer'));
    const id = Number(req.params.id);
    const team = getTeam(id);
    if (!team || team.captain_id !== playerId(req)) return reply.code(403).send(E('onlyCaptainAssign'));
    if (!members(id).some((m) => m.player_id === body.data.playerId)) return reply.code(400).send(E('notTeamMember'));
    db.prepare('UPDATE teams SET captain_id = ? WHERE id = ?').run(body.data.playerId, id);
    return teamDto({ ...team, captain_id: body.data.playerId });
  });

  app.delete<{ Params: { id: string } }>('/api/teams/:id', async (req, reply) => {
    const id = Number(req.params.id);
    const team = getTeam(id);
    if (!team || team.captain_id !== playerId(req)) return reply.code(403).send(E('onlyCaptainDelete'));
    if (inActiveTournament(id)) return reply.code(409).send(E('teamInTournament'));
    deleteTeam(team);
    return { ok: true };
  });
}
