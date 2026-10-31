import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db.js';
import { getSession, requireAdmin, requirePlayer } from '../auth.js';
import { E } from '../errors.js';
import { NICKNAME_RE, refreshName } from '../players.js';

const body = z.object({ nickname: z.string().trim().regex(NICKNAME_RE).nullable() });

interface Names { steam_name: string | null; custom_name: string | null; admin_name: string | null; name: string }

const namesDto = (r: Names) => ({
  name: r.name, steamName: r.steam_name, customName: r.custom_name, adminName: r.admin_name,
});

export async function profileRoutes(app: FastifyInstance): Promise<void> {
  // Игрок меняет свой ник. Ник, назначенный админом, на серверах всё равно главнее.
  app.put('/api/me/nickname', { preHandler: requirePlayer }, async (req, reply) => {
    const parsed = body.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(E('badNickname'));
    const id = getSession(req)!.userId;
    db.prepare('UPDATE players SET custom_name = ? WHERE id = ?').run(parsed.data.nickname || null, id);
    refreshName(id);
    return namesDto(db.prepare('SELECT name, steam_name, custom_name, admin_name FROM players WHERE id = ?').get(id) as unknown as Names);
  });

  // Админ назначает ник игрока (null снимает назначение)
  app.put<{ Params: { id: string } }>('/api/admin/players/:id/nickname', { preHandler: requireAdmin }, async (req, reply) => {
    const parsed = body.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(E('badNickname'));
    const id = Number(req.params.id);
    const res = db.prepare('UPDATE players SET admin_name = ? WHERE id = ?').run(parsed.data.nickname || null, id);
    if (res.changes === 0) return reply.code(404).send(E('playerNotFound'));
    refreshName(id);
    return namesDto(db.prepare('SELECT name, steam_name, custom_name, admin_name FROM players WHERE id = ?').get(id) as unknown as Names);
  });
}
