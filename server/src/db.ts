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
