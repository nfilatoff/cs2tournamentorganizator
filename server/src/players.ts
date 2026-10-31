import { db } from './db.js';

// Ник игрока на серверах и в интерфейсе: назначенный админом, иначе свой, иначе из Steam.
// Результат хранится в players.name, поэтому весь остальной код продолжает читать одно поле.
export function refreshName(id: number): void {
  db.prepare(`UPDATE players SET name = COALESCE(NULLIF(admin_name, ''), NULLIF(custom_name, ''), NULLIF(steam_name, ''), name)
    WHERE id = ?`).run(id);
}

// Допустимый ник: без кавычек, точки с запятой, обратной косой и управляющих символов (они ломают конфиг матча)
export const NICKNAME_RE = /^[^\u0000-\u001f"';\\]{1,32}$/;
