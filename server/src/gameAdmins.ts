// Админы ArenaPro на игровых серверах. Список хранится в панели, а на сервер попадает файлом
// cfg/ArenaPro/admins.json в папке CS2 (её используют все серверы, запускаемые панелью) и командой reload_admins по RCON.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { db, getSetting, setSetting } from './db.js';
import { withRcon, type ServerRow } from './dispatcher.js';
import { cs2Root } from './serverProcess.js';

export type GameAdminRole = 'full' | 'prac';

// Только тренировки: .prac/.exitprac (@custom/prac) и смена карты (@css/map)
const ROLE_FLAGS: Record<GameAdminRole, string> = { full: '', prac: '@custom/prac @css/map' };

export const STEAM_ID = /^7656119\d{10}$/;

export interface GameAdminRow { steam_id: string; name: string; flags: string }

export const roleOf = (flags: string): GameAdminRole => (flags.trim() === '' ? 'full' : 'prac');
export const flagsOf = (role: GameAdminRole): string => ROLE_FLAGS[role];

function adminsFile(): string | null {
  const root = cs2Root();
  return root ? join(root, 'game', 'csgo', 'cfg', 'ArenaPro', 'admins.json') : null;
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
  return db.prepare('SELECT steam_id, name, flags FROM game_admins ORDER BY created_at, steam_id').all() as unknown as GameAdminRow[];
}

export interface SyncResult { file: string | null; reloaded: string[]; failed: string[] }

// Записывает admins.json и просит работающие серверы перечитать его
export async function syncGameAdmins(): Promise<SyncResult> {
  const file = adminsFile();
  if (file) {
    mkdirSync(dirname(file), { recursive: true });
    const data = Object.fromEntries(listGameAdmins().map((a) => [a.steam_id, a.flags]));
    writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  }
  const servers = db.prepare('SELECT * FROM game_servers ORDER BY id').all() as unknown as ServerRow[];
  const reloaded: string[] = [];
  const failed: string[] = [];
  await Promise.all(servers.map(async (s) => {
    try {
      await withRcon(s, (r) => r.exec('reload_admins'));
      reloaded.push(s.name);
    } catch {
      // Выключенный сервер прочитает файл при запуске; внешний сервер в другой папке нужно обновить вручную
      failed.push(s.name);
    }
  }));
  return { file, reloaded, failed };
}
