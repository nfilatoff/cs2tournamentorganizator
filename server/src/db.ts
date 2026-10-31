import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { config } from './config.js';

export const db = new DatabaseSync(join(config.dataDir, 'app.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS players (
  id INTEGER PRIMARY KEY,
  steam_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  avatar_url TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('admin', 'player')),
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS game_servers (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  rcon_password TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE (host, port)
);

CREATE TABLE IF NOT EXISTS teams (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  join_code TEXT NOT NULL UNIQUE,
  captain_id INTEGER NOT NULL REFERENCES players(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS team_members (
  team_id INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id),
  joined_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (team_id, player_id)
);

CREATE TABLE IF NOT EXISTS tournaments (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  format TEXT NOT NULL CHECK (format IN ('single', 'double')),
  team_size INTEGER NOT NULL,
  max_teams INTEGER NOT NULL,
  default_best_of INTEGER NOT NULL DEFAULT 1,
  -- JSON: { "W1": 3, "L2": 1, "GF": 5 }; ключ = сетка + номер раунда с конца
  bo_config TEXT NOT NULL DEFAULT '{}',
  grand_final_reset INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'registration' CHECK (status IN ('registration', 'running', 'finished')),
  champion_team_id INTEGER REFERENCES teams(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS tournament_maps (
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  map_id INTEGER NOT NULL REFERENCES maps(id),
  position INTEGER NOT NULL,
  PRIMARY KEY (tournament_id, map_id)
);

CREATE TABLE IF NOT EXISTS tournament_teams (
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  team_id INTEGER NOT NULL REFERENCES teams(id),
  seed INTEGER,
  -- JSON: ID игроков, которые играют на турнире
  roster TEXT NOT NULL,
  registered_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (tournament_id, team_id)
);

CREATE TABLE IF NOT EXISTS matches (
  id INTEGER PRIMARY KEY,
  tournament_id INTEGER NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  bracket TEXT NOT NULL,
  round INTEGER NOT NULL,
  position INTEGER NOT NULL,
  src_a TEXT NOT NULL,
  src_b TEXT NOT NULL,
  entry_a TEXT NOT NULL,
  entry_b TEXT NOT NULL,
  winner TEXT,
  status TEXT NOT NULL,
  best_of INTEGER NOT NULL,
  score_a INTEGER NOT NULL DEFAULT 0,
  score_b INTEGER NOT NULL DEFAULT 0,
  forced INTEGER NOT NULL DEFAULT 0,
  UNIQUE (tournament_id, code)
);

CREATE TABLE IF NOT EXISTS maps (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  -- Для Workshop-карт: ID из ссылки; для стандартных карт: NULL
  workshop_id TEXT UNIQUE,
  -- Для стандартных карт: имя, например de_inferno
  map_file TEXT,
  image_url TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
`);

const matchCols = db.prepare('PRAGMA table_info(matches)').all() as unknown as { name: string }[];
if (!matchCols.some((c) => c.name === 'forced')) {
  db.exec('ALTER TABLE matches ADD COLUMN forced INTEGER NOT NULL DEFAULT 0');
}

export function tx<T>(fn: () => T): T {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

function addColumn(table: string, column: string, definition: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as unknown as { name: string }[];
  if (!cols.some((c) => c.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Результаты отдельных карт серии, приходят с сервера
CREATE TABLE IF NOT EXISTS match_maps (
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  map_no INTEGER NOT NULL,
  score_a INTEGER NOT NULL,
  score_b INTEGER NOT NULL,
  winner TEXT,
  PRIMARY KEY (match_id, map_no)
);
`);

// Состояние матча на игровом сервере (id матча в панели = matchid в ArenaPro)
addColumn('matches', 'server_id', 'INTEGER REFERENCES game_servers(id)');
addColumn('matches', 'maps_json', 'TEXT');
addColumn('matches', 'live', 'INTEGER NOT NULL DEFAULT 0');
addColumn('matches', 'paused', 'INTEGER NOT NULL DEFAULT 0');
addColumn('matches', 'cur_map_no', 'INTEGER NOT NULL DEFAULT 0');
addColumn('matches', 'cur_score_a', 'INTEGER NOT NULL DEFAULT 0');
addColumn('matches', 'cur_score_b', 'INTEGER NOT NULL DEFAULT 0');
addColumn('matches', 'series_a', 'INTEGER NOT NULL DEFAULT 0');
addColumn('matches', 'series_b', 'INTEGER NOT NULL DEFAULT 0');
addColumn('matches', 'note', 'TEXT');
addColumn('tournaments', 'auto_dispatch', 'INTEGER NOT NULL DEFAULT 1');
addColumn('game_servers', 'cooldown_until', 'INTEGER NOT NULL DEFAULT 0');
addColumn('game_servers', 'last_error', 'TEXT');

export function getSetting(key: string): string | undefined {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return r?.value;
}

export function setSetting(key: string, value: string): void {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

// Групповой этап: настройки турнира, группа команды и стадия матча
addColumn('tournaments', 'stage_mode', "TEXT NOT NULL DEFAULT 'playoff'");
addColumn('tournaments', 'group_format', 'TEXT');
addColumn('tournaments', 'groups_count', 'INTEGER NOT NULL DEFAULT 1');
addColumn('tournaments', 'advance', 'INTEGER NOT NULL DEFAULT 2');
addColumn('tournaments', 'swiss_rounds', 'INTEGER');
addColumn('tournaments', 'group_best_of', 'INTEGER NOT NULL DEFAULT 1');
addColumn('tournaments', 'has_playoff', 'INTEGER NOT NULL DEFAULT 1');
addColumn('tournaments', 'phase', "TEXT NOT NULL DEFAULT 'playoff'");
addColumn('tournament_teams', 'group_no', 'INTEGER');
addColumn('tournament_teams', 'playoff_seed', 'INTEGER');
addColumn('matches', 'stage', "TEXT NOT NULL DEFAULT 'playoff'");
addColumn('matches', 'group_no', 'INTEGER');

// Вето карт
addColumn('matches', 'veto_json', 'TEXT');
addColumn('tournaments', 'veto_enabled', 'INTEGER NOT NULL DEFAULT 1');
addColumn('tournaments', 'veto_sides', 'INTEGER NOT NULL DEFAULT 1');

db.exec("UPDATE maps SET name = trim(replace(replace(name, char(10), ' '), char(13), ' '))");

// Ники игрока: из Steam, собственный и назначенный админом (players.name хранит итоговый)
addColumn('players', 'steam_name', 'TEXT');
addColumn('players', 'custom_name', 'TEXT');
addColumn('players', 'admin_name', 'TEXT');
addColumn('players', 'source', "TEXT NOT NULL DEFAULT 'steam'");
db.exec("UPDATE players SET steam_name = name WHERE steam_name IS NULL AND source = 'steam'");

// Паузы: тактические таймауты (по умолчанию как в live.cfg) и технические паузы (0 = без ограничений) на карту
addColumn('tournaments', 'tactical_pauses', 'INTEGER NOT NULL DEFAULT 3');
addColumn('tournaments', 'tactical_pause_time', 'INTEGER NOT NULL DEFAULT 30');
addColumn('tournaments', 'tech_pauses', 'INTEGER NOT NULL DEFAULT 0');

// Серверы, которые панель запускает сама на этом компьютере (см. serverProcess.ts)
addColumn('game_servers', 'managed', 'INTEGER NOT NULL DEFAULT 0');
addColumn('game_servers', 'start_map', "TEXT NOT NULL DEFAULT 'de_inferno'");
addColumn('game_servers', 'game_mode', "TEXT NOT NULL DEFAULT 'competitive'");
addColumn('game_servers', 'max_players', 'INTEGER NOT NULL DEFAULT 12');
addColumn('game_servers', 'hostname', 'TEXT');
addColumn('game_servers', 'sv_password', 'TEXT');
addColumn('game_servers', 'lan', 'INTEGER NOT NULL DEFAULT 1');
addColumn('game_servers', 'gslt', 'TEXT');
addColumn('game_servers', 'tv_enable', 'INTEGER NOT NULL DEFAULT 1');
addColumn('game_servers', 'tv_port', 'INTEGER');
addColumn('game_servers', 'autostart', 'INTEGER NOT NULL DEFAULT 0');
addColumn('game_servers', 'extra_cfg', 'TEXT');

// Когда матч отправлен на сервер (от этого момента идёт время на подключение) и закончился ли он неявкой
addColumn('matches', 'dispatched_at', 'INTEGER');
addColumn('matches', 'walkover', 'INTEGER NOT NULL DEFAULT 0');
