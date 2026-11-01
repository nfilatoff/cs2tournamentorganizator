import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db.js';
import { requireAdmin } from '../auth.js';
import { E } from '../errors.js';
import {
  STEAM_ID, flagsOf, importExistingAdmins, listGameAdmins, roleOf, syncGameAdmins, type SyncResult,
} from '../gameAdmins.js';

function dto(sync?: SyncResult) {
  const admins = listGameAdmins().map((a) => {
    const player = db.prepare('SELECT name FROM players WHERE steam_id = ?').get(a.steam_id) as { name: string } | undefined;
    return { steamId: a.steam_id, name: player?.name ?? a.name, role: roleOf(a.flags) };
  });
  // Игроки, которые уже входили в панель через Steam: из них удобно выбирать
  const players = db.prepare('SELECT steam_id, name FROM players ORDER BY name COLLATE NOCASE').all() as unknown as { steam_id: string; name: string }[];
  return { admins, players: players.map((p) => ({ steamId: p.steam_id, name: p.name })), ...(sync ? { sync } : {}) };
}

export async function gameAdminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAdmin);

  app.get('/api/game-admins', async () => {
    importExistingAdmins();
    return dto();
  });

  // Добавить админа или поменять его права
  app.post('/api/game-admins', async (req, reply) => {
    const body = z.object({
      steamId: z.string().trim().regex(STEAM_ID),
      name: z.string().trim().max(64).default(''),
      role: z.enum(['full', 'prac']).default('full'),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send(E('badSteamId'));
    importExistingAdmins();
    const { steamId, name, role } = body.data;
    db.prepare(`INSERT INTO game_admins (steam_id, name, flags) VALUES (?, ?, ?)
      ON CONFLICT(steam_id) DO UPDATE SET flags = excluded.flags, name = CASE WHEN excluded.name = '' THEN name ELSE excluded.name END`)
      .run(steamId, name, flagsOf(role));
    return dto(await syncGameAdmins());
  });

  app.delete<{ Params: { steamId: string } }>('/api/game-admins/:steamId', async (req) => {
    db.prepare('DELETE FROM game_admins WHERE steam_id = ?').run(req.params.steamId);
    return dto(await syncGameAdmins());
  });

  // Записать файл и перезагрузить админов на серверах заново (например, после добавления сервера)
  app.post('/api/game-admins/sync', async () => dto(await syncGameAdmins()));
}
