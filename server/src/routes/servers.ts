import type { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { E, decode, errBody } from '../errors.js';
import { z } from 'zod';
import { db, getSetting, setSetting } from '../db.js';
import { requireAdmin } from '../auth.js';
import { getServer, parseStatus, withRcon } from '../dispatcher.js';
import {
  GAME_MODES, applyCfg, changeMap, cs2Root, defaultHost, exeIn, getManaged, nextPort, processInfo, startServer, stopServer,
  tvPortOf, type ManagedRow,
} from '../serverProcess.js';

// Без кавычек, точек с запятой и переводов строк: значения попадают в cfg сервера
const cfgValue = (max: number) => z.string().trim().max(max).regex(/^[^"';\r\n]*$/);
const mapRef = z.string().trim().regex(/^([a-z0-9_]+|workshop:\d+)$/i);
// Строки дополнительного cfg: "квар значение", без точек с запятой
const extraCfg = z.string().max(4000).refine((s) => s.split(/\r?\n/).every((l) => !l.trim() || /^\s*[a-z0-9_]+(\s+[^;\r\n]*)?$/i.test(l)));

const settingsBody = z.object({
  managed: z.boolean(),
  startMap: mapRef,
  gameMode: z.enum(Object.keys(GAME_MODES) as [keyof typeof GAME_MODES]),
  maxPlayers: z.number().int().min(2).max(64),
  hostname: cfgValue(63),
  svPassword: cfgValue(63),
  lan: z.boolean(),
  gslt: z.string().trim().regex(/^[A-Z0-9]*$/i).max(64),
  tvEnable: z.boolean(),
  tvPort: z.number().int().min(1).max(65535).nullable(),
  autostart: z.boolean(),
  extraCfg,
});

const serverBody = z.object({
  name: z.string().trim().min(1).max(60),
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  // Для управляемого сервера пароль можно не задавать: панель сгенерирует
  rconPassword: z.string().max(255).regex(/^[^"';\s]*$/).optional(),
  settings: settingsBody.partial().optional(),
});

// RCON-пароль наружу не отдаём.
const toDto = (r: ManagedRow) => ({
  id: r.id, name: r.name, host: r.host, port: r.port,
  managed: !!r.managed,
  settings: {
    managed: !!r.managed, startMap: r.start_map, gameMode: r.game_mode, maxPlayers: r.max_players, hostname: r.hostname ?? '',
    svPassword: r.sv_password ?? '', lan: !!r.lan, gslt: r.gslt ?? '', tvEnable: !!r.tv_enable, tvPort: r.tv_port,
    autostart: !!r.autostart, extraCfg: r.extra_cfg ?? '',
  },
  tvPort: tvPortOf(r),
  process: processInfo(r.id),
});

type Settings = z.infer<typeof settingsBody>;

function saveSettings(id: number, s: Partial<Settings>): void {
  const cols: Record<keyof Settings, [string, (v: never) => unknown]> = {
    managed: ['managed', (v: boolean) => (v ? 1 : 0)],
    startMap: ['start_map', (v: string) => v],
    gameMode: ['game_mode', (v: string) => v],
    maxPlayers: ['max_players', (v: number) => v],
    hostname: ['hostname', (v: string) => v || null],
    svPassword: ['sv_password', (v: string) => v || null],
    lan: ['lan', (v: boolean) => (v ? 1 : 0)],
    gslt: ['gslt', (v: string) => v || null],
    tvEnable: ['tv_enable', (v: boolean) => (v ? 1 : 0)],
    tvPort: ['tv_port', (v: number | null) => v],
    autostart: ['autostart', (v: boolean) => (v ? 1 : 0)],
    extraCfg: ['extra_cfg', (v: string) => v.trim() || null],
  };
  for (const [key, value] of Object.entries(s) as [keyof Settings, unknown][]) {
    if (value === undefined) continue;
    const [col, conv] = cols[key];
    db.prepare(`UPDATE game_servers SET ${col} = ? WHERE id = ?`).run(conv(value as never) as never, id);
  }
}

const launcherInfo = () => {
  const root = cs2Root();
  return {
    cs2Path: getSetting('cs2_path') ?? '',
    detected: root,
    exe: root ? exeIn(root) : null,
    defaultHost: defaultHost(),
    nextPort: nextPort(),
  };
};

export async function serverRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAdmin);

  app.get('/api/servers', async () => {
    const rows = db.prepare('SELECT * FROM game_servers ORDER BY name').all() as unknown as ManagedRow[];
    return rows.map(toDto);
  });

  // Где панель ищет CS2 и что предложить для нового сервера
  app.get('/api/servers/launcher', async () => launcherInfo());

  app.put('/api/servers/launcher', async (req, reply) => {
    const body = z.object({ cs2Path: z.string().trim().max(500) }).safeParse(req.body);
    if (!body.success) return reply.code(400).send(E('badRequest'));
    let p = body.data.cs2Path;
    // Можно указать и путь к cs2.exe: берём папку игры
    const m = /^(.*?)[\\/]game[\\/]bin[\\/][^\\/]+[\\/]cs2(\.exe)?$/i.exec(p);
    if (m) p = m[1]!;
    if (p && !existsSync(exeIn(p))) return reply.code(400).send(E('cs2NotFound'));
    setSetting('cs2_path', p);
    return launcherInfo();
  });

  app.post('/api/servers', async (req, reply) => {
    const body = serverBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send(E('badServer'));
    const { name, host, port, settings } = body.data;
    let rconPassword = body.data.rconPassword ?? '';
    if (!rconPassword) {
      if (!settings?.managed) return reply.code(400).send(E('badServer'));
      rconPassword = randomBytes(12).toString('hex');
    }
    let id: number;
    try {
      const res = db.prepare('INSERT INTO game_servers (name, host, port, rcon_password) VALUES (?, ?, ?, ?)')
        .run(name, host, port, rconPassword);
      id = Number(res.lastInsertRowid);
    } catch {
      return reply.code(409).send(E('serverExists'));
    }
    if (settings) saveSettings(id, settings);
    return reply.code(201).send(toDto(getManaged(id)!));
  });

  app.put<{ Params: { id: string } }>('/api/servers/:id', async (req, reply) => {
    const body = serverBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send(E('badServer'));
    const id = Number(req.params.id);
    const cur = getManaged(id);
    if (!cur) return reply.code(404).send(E('serverNotFound'));
    const { name, host, port, rconPassword, settings } = body.data;
    try {
      db.prepare('UPDATE game_servers SET name = ?, host = ?, port = ?, rcon_password = ? WHERE id = ?')
        .run(name, host, port, rconPassword || cur.rcon_password, id);
    } catch {
      return reply.code(409).send(E('serverExists'));
    }
    if (settings) saveSettings(id, settings);
    // Имя, пароли и доп. настройки применяются сразу, если сервер запущен и свободен; остальное — при следующем запуске
    const applied = await applyCfg(id);
    return { ...toDto(getManaged(id)!), applied };
  });

  app.delete<{ Params: { id: string } }>('/api/servers/:id', async (req, reply) => {
    try {
      const res = db.prepare('DELETE FROM game_servers WHERE id = ?').run(Number(req.params.id));
      if (res.changes === 0) return reply.code(404).send(E('serverNotFound'));
    } catch {
      return reply.code(409).send(E('serverBusy'));
    }
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/api/servers/:id/start', async (req, reply) => {
    try {
      await startServer(Number(req.params.id));
    } catch (e) {
      return reply.code(409).send(errBody(e));
    }
    return toDto(getManaged(Number(req.params.id))!);
  });

  app.post<{ Params: { id: string } }>('/api/servers/:id/stop', async (req, reply) => {
    try {
      await stopServer(Number(req.params.id));
    } catch (e) {
      return reply.code(409).send(errBody(e));
    }
    return toDto(getManaged(Number(req.params.id))!);
  });

  app.post<{ Params: { id: string } }>('/api/servers/:id/restart', async (req, reply) => {
    const id = Number(req.params.id);
    try {
      await stopServer(id).catch((e: unknown) => {
        if (!(e instanceof Error && 'code' in e && e.code === 'serverNotRunning')) throw e;
      });
      // Порт освобождается не сразу после выхода процесса
      await new Promise((r) => setTimeout(r, 2000));
      await startServer(id);
    } catch (e) {
      return reply.code(409).send(errBody(e));
    }
    return toDto(getManaged(id)!);
  });

  app.post<{ Params: { id: string } }>('/api/servers/:id/map', async (req, reply) => {
    const body = z.object({ map: mapRef }).safeParse(req.body);
    if (!body.success) return reply.code(400).send(E('badRequest'));
    try {
      await changeMap(Number(req.params.id), body.data.map);
    } catch (e) {
      return reply.code(409).send(errBody(e));
    }
    return { ok: true };
  });

  // Проверка связи: RCON и состояние матча на сервере
  app.get<{ Params: { id: string } }>('/api/servers/:id/status', async (req, reply) => {
    const server = getServer(Number(req.params.id));
    if (!server) return reply.code(404).send(E('serverNotFound'));
    const busy = db.prepare('SELECT code, tournament_id FROM matches WHERE server_id = ?').get(server.id) as
      { code: string; tournament_id: number } | undefined;
    try {
      const st = await withRcon(server, async (r) => parseStatus(await r.exec('get5_status')));
      return {
        online: true,
        gamestate: st?.gamestate ?? 'unknown',
        paused: st?.paused ?? false,
        serverMatchId: st?.matchId ?? null,
        panelMatch: busy ?? null,
        lastError: decode(server.last_error),
      };
    } catch (e) {
      return { online: false, error: errBody(e), panelMatch: busy ?? null, lastError: decode(server.last_error) };
    }
  });
}
