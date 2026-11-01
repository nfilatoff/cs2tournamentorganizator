// Админы ArenaPro на игровых серверах. Список хранится в панели, а на сервер попадает файлом
// cfg/ArenaPro/admins.json в папке CS2 (её используют все серверы, запускаемые панелью) и командой reload_admins по RCON.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { db, getSetting, setSetting } from './db.js';
import { withRcon, type ServerRow } from './dispatcher.js';
import { cs2Root } from './serverProcess.js';
import { newAdminCode } from './adminCodes.js';

export type GameAdminRole = 'full' | 'prac';

// Только тренировки: .prac/.exitprac (@custom/prac) и смена карты (@css/map)
const ROLE_FLAGS: Record<GameAdminRole, string> = { full: '', prac: '@custom/prac @css/map' };

export const STEAM_ID = /^7656119\d{10}$/;

export interface GameAdminRow { steam_id: string; name: string; flags: string; panel: number }

export const roleOf = (flags: string): GameAdminRole => (flags.trim() === '' ? 'full' : 'prac');
export const flagsOf = (role: GameAdminRole): string => ROLE_FLAGS[role];

function arenaproCfg(file: string): string | null {
  const root = cs2Root();
  return root ? join(root, 'game', 'csgo', 'cfg', 'ArenaPro', file) : null;
}
const adminsFile = () => arenaproCfg('admins.json');

// Код админа для серверов без матча (тренировки): общий для серверов в папке CS2 панели, плагин читает его из panel.cfg.
// Во время матча действует код этого матча из его конфига.
export function serverAdminCode(): string {
  let code = getSetting('server_admin_code');
  if (!code) {
    code = newAdminCode();
    setSetting('server_admin_code', code);
  }
  return code;
}

export function renewServerAdminCode(): void {
  setSetting('server_admin_code', newAdminCode());
}

// Один раз переносит в панель админов, которые уже были вписаны в admins.json вручную
export function importExistingAdmins(): void {
  if (getSetting('game_admins_imported')) return;
  const file = adminsFile();
  if (file && existsSync(file)) {
    try {
      const data = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
      for (const [steamId, flags] of Object.entries(data)) {
        if (!STEAM_ID.test(steamId) || typeof flags !== 'string') continue;
        db.prepare('INSERT OR IGNORE INTO game_admins (steam_id, flags) VALUES (?, ?)').run(steamId, flags.trim());
      }
    } catch {
      // Битый файл: панель перезапишет его своим списком
    }
  }
  setSetting('game_admins_imported', '1');
}

export function listGameAdmins(): GameAdminRow[] {
  return db.prepare('SELECT steam_id, name, flags, panel FROM game_admins ORDER BY created_at, steam_id').all() as unknown as GameAdminRow[];
}

export interface SyncResult { file: string | null; reloaded: string[]; failed: string[] }

// Записывает admins.json и panel.cfg и просит работающие серверы применить их
export async function syncGameAdmins(): Promise<SyncResult> {
  const file = adminsFile();
  const code = serverAdminCode();
  if (file) {
    mkdirSync(dirname(file), { recursive: true });
    const data = Object.fromEntries(listGameAdmins().map((a) => [a.steam_id, a.flags]));
    writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    writeFileSync(arenaproCfg('panel.cfg')!, [
      '// Создано панелью турниров при изменении раздела «Админы». Не меняйте вручную: файл перезаписывается.',
      `arenapro_admin_auth_code "${code}"`,
      '',
    ].join('\r\n'), 'utf8');
  }
  const servers = db.prepare(`SELECT s.*, (SELECT 1 FROM matches m WHERE m.server_id = s.id LIMIT 1) AS busy
    FROM game_servers s ORDER BY s.id`).all() as unknown as (ServerRow & { busy: number | null })[];
  const reloaded: string[] = [];
  const failed: string[] = [];
  await Promise.all(servers.map(async (s) => {
    try {
      await withRcon(s, async (r) => {
        await r.exec('reload_admins');
        // На сервере с матчем действует код матча
        if (!s.busy) await r.exec(`arenapro_admin_auth_code "${code}"`);
      });
      reloaded.push(s.name);
    } catch {
      // Выключенный сервер прочитает файл при запуске; внешний сервер в другой папке нужно обновить вручную
      failed.push(s.name);
    }
  }));
  return { file, reloaded, failed };
}
