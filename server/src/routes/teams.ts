import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, tx } from '../db.js';
import { getSession, requirePlayer } from '../auth.js';

const MAX_MEMBERS = 10;

interface TeamRow { id: number; name: string; join_code: string; captain_id: number }
interface MemberRow { player_id: number; name: string; steam_id: string; avatar_url: string | null }

function playerId(req: Parameters<typeof getSession>[0]): number {
  return getSession(req)!.userId;
}

function members(teamId: number): MemberRow[] {
  return db.prepare(`
    SELECT tm.player_id, p.name, p.steam_id, p.avatar_url
    FROM team_members tm JOIN players p ON p.id = tm.player_id
    WHERE tm.team_id = ? ORDER BY tm.joined_at, tm.player_id
  `).all(teamId) as unknown as MemberRow[];
}

function teamDto(t: TeamRow) {
  return {
    id: t.id,
    name: t.name,
    joinCode: t.join_code,
    captainId: t.captain_id,
    members: members(t.id).map((m) => ({
      id: m.player_id, name: m.name, steamId: m.steam_id, avatarUrl: m.avatar_url,
    })),
  };
}

// Игрок состоит в составе команды, заявленной в незавершённом турнире.
function inActiveRoster(teamId: number, pid: number): boolean {
  const rows = db.prepare(`
    SELECT tt.roster FROM tournament_teams tt JOIN tournaments t ON t.id = tt.tournament_id
    WHERE tt.team_id = ? AND t.status != 'finished'
  `).all(teamId) as unknown as { roster: string }[];
  return rows.some((r) => (JSON.parse(r.roster) as number[]).includes(pid));
}

function inActiveTournament(teamId: number): boolean {
  return !!db.prepare(`
    SELECT 1 FROM tournament_teams tt JOIN tournaments t ON t.id = tt.tournament_id
    WHERE tt.team_id = ? AND t.status != 'finished'
  `).get(teamId);
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
    if (!body.success) return reply.code(400).send({ error: 'Название команды: от 2 до 30 символов' });
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
      return reply.code(409).send({ error: 'Команда с таким названием уже есть' });
    }
  });

  app.post('/api/teams/join', async (req, reply) => {
    const body = z.object({ code: z.string().trim().min(1) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Введите код команды' });
    const team = db.prepare('SELECT * FROM teams WHERE join_code = ?')
      .get(body.data.code.toUpperCase()) as unknown as TeamRow | undefined;
    if (!team) return reply.code(404).send({ error: 'Команда с таким кодом не найдена' });
    const pid = playerId(req);
    if (members(team.id).some((m) => m.player_id === pid)) {
      return reply.code(409).send({ error: 'Вы уже в этой команде' });
    }
    if (members(team.id).length >= MAX_MEMBERS) return reply.code(409).send({ error: 'В команде нет мест' });
    db.prepare('INSERT INTO team_members (team_id, player_id) VALUES (?, ?)').run(team.id, pid);
    return teamDto(team);
  });

  app.post<{ Params: { id: string } }>('/api/teams/:id/leave', async (req, reply) => {
    const id = Number(req.params.id);
    const pid = playerId(req);
    const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(id) as unknown as TeamRow | undefined;
    if (!team || !members(id).some((m) => m.player_id === pid)) {
      return reply.code(404).send({ error: 'Вы не состоите в этой команде' });
    }
    if (inActiveRoster(id, pid)) {
      return reply.code(409).send({ error: 'Вы в составе команды на незавершённом турнире' });
    }
    const rest = members(id).filter((m) => m.player_id !== pid);
    if (rest.length === 0 && inActiveTournament(id)) {
      return reply.code(409).send({ error: 'Команда участвует в турнире' });
    }
    tx(() => {
      db.prepare('DELETE FROM team_members WHERE team_id = ? AND player_id = ?').run(id, pid);
      if (rest.length === 0) {
        db.prepare('DELETE FROM teams WHERE id = ?').run(id);
      } else if (team.captain_id === pid) {
        db.prepare('UPDATE teams SET captain_id = ? WHERE id = ?').run(rest[0]!.player_id, id);
      }
    });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/teams/:id/kick', async (req, reply) => {
    const body = z.object({ playerId: z.number().int() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Укажите игрока' });
    const id = Number(req.params.id);
    const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(id) as unknown as TeamRow | undefined;
    if (!team || team.captain_id !== playerId(req)) return reply.code(403).send({ error: 'Только капитан может исключать игроков' });
    if (body.data.playerId === team.captain_id) return reply.code(400).send({ error: 'Капитана исключить нельзя' });
    if (inActiveRoster(id, body.data.playerId)) {
      return reply.code(409).send({ error: 'Игрок в составе команды на незавершённом турнире' });
    }
    db.prepare('DELETE FROM team_members WHERE team_id = ? AND player_id = ?').run(id, body.data.playerId);
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/api/teams/:id', async (req, reply) => {
    const id = Number(req.params.id);
    const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(id) as unknown as TeamRow | undefined;
    if (!team || team.captain_id !== playerId(req)) return reply.code(403).send({ error: 'Только капитан может удалить команду' });
    if (inActiveTournament(id)) return reply.code(409).send({ error: 'Команда участвует в турнире' });
    db.prepare('DELETE FROM teams WHERE id = ?').run(id);
    return { ok: true };
  });
}
