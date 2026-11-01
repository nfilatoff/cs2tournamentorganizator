import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db.js';
import { PANEL_FULL, getSession, isFullAdmin, requireAdmin, requireFullAdmin } from '../auth.js';
import { E } from '../errors.js';
import {
  STEAM_ID, flagsOf, importExistingAdmins, listGameAdmins, renewServerAdminCode, roleOf, serverAdminCode, syncGameAdmins,
  type SyncResult,
} from '../gameAdmins.js';

function dto(canManage: boolean, sync?: SyncResult) {
  const admins = listGameAdmins().map((a) => {
    const player = db.prepare('SELECT name FROM players WHERE steam_id = ?').get(a.steam_id) as { name: string } | undefined;
    return { steamId: a.steam_id, name: player?.name ?? a.name, role: roleOf(a.flags), panel: a.panel };
  });
  // Игроки, которые уже входили в панель через Steam: из них удобно выбирать
  const players = db.prepare('SELECT steam_id, name FROM players ORDER BY name COLLATE NOCASE').all() as unknown as { steam_id: string; name: string }[];
  // Админ без полных прав только видит список (и код для тренировок, чтобы самому войти на сервере)
  return {
    admins, canManage, serverCode: serverAdminCode(),
    players: canManage ? players.map((p) => ({ steamId: p.steam_id, name: p.name })) : [],
    ...(sync ? { sync } : {}),
  };
}

export async function gameAdminRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAdmin);

  app.get('/api/game-admins', async (req) => {
    importExistingAdmins();
    return dto(isFullAdmin(getSession(req)));
  });

  // Добавить админа или поменять его права
  app.post('/api/game-admins', { preHandler: requireFullAdmin }, async (req, reply) => {
    const body = z.object({
      steamId: z.string().trim().regex(STEAM_ID),
      name: z.string().trim().max(64).default(''),
      role: z.enum(['full', 'prac']).default('full'),
      // 0 — нет прав в панели, 1 — админ панели, 2 — полный админ
      panel: z.union([z.literal(0), z.literal(1), z.literal(2)]).optional(),
    }).safeParse(req.body);
    if (!body.success) return reply.code(400).send(E('badSteamId'));
    importExistingAdmins();
    const { steamId, name, role, panel } = body.data;
    // panel не передан: права в панели не меняются. Полный админ на сервере всегда с полными правами.
    const level = panel ?? (db.prepare('SELECT panel FROM game_admins WHERE steam_id = ?').get(steamId) as { panel: number } | undefined)?.panel ?? 0;
    db.prepare(`INSERT INTO game_admins (steam_id, name, flags, panel) VALUES (?, ?, ?, ?)
      ON CONFLICT(steam_id) DO UPDATE SET flags = excluded.flags, panel = excluded.panel,
        name = CASE WHEN excluded.name = '' THEN name ELSE excluded.name END`)
      .run(steamId, name, flagsOf(level === PANEL_FULL ? 'full' : role), level);
    return dto(true, await syncGameAdmins());
  });

  app.delete<{ Params: { steamId: string } }>('/api/game-admins/:steamId', { preHandler: requireFullAdmin }, async (req) => {
    db.prepare('DELETE FROM game_admins WHERE steam_id = ?').run(req.params.steamId);
    return dto(true, await syncGameAdmins());
  });

  // Новый код админа для серверов без матча
  app.post('/api/game-admins/code', { preHandler: requireFullAdmin }, async () => {
    renewServerAdminCode();
    return dto(true, await syncGameAdmins());
  });

  // Записать файл и перезагрузить админов на серверах заново (например, после добавления сервера)
  app.post('/api/game-admins/sync', { preHandler: requireFullAdmin }, async () => dto(true, await syncGameAdmins()));
}
