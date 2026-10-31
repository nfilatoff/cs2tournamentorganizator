import { randomBytes, timingSafeEqual } from 'node:crypto';
import { db, getSetting, setSetting } from './db.js';
import { config } from './config.js';

// Общий секрет между панелью и игровыми серверами: им подписаны и загрузка конфига, и события.
export function eventToken(): string {
  let t = getSetting('event_token');
  if (!t) {
    t = randomBytes(24).toString('hex');
    setSetting('event_token', t);
  }
  return t;
}

export function tokenMatches(header: string | undefined): boolean {
  if (!header) return false;
  const expected = Buffer.from(`Bearer ${eventToken()}`);
  const actual = Buffer.from(header);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export interface MapRef {
  id: number;
  name: string;
  // Что передаётся в maplist: ID Workshop-карты или имя файла стандартной карты
  ref: string;
}

export function tournamentMapPool(tid: number): MapRef[] {
  const rows = db.prepare(`
    SELECT m.id, m.name, m.workshop_id, m.map_file FROM tournament_maps tm JOIN maps m ON m.id = tm.map_id
    WHERE tm.tournament_id = ? ORDER BY tm.position
  `).all(tid) as unknown as { id: number; name: string; workshop_id: string | null; map_file: string | null }[];
  return rows.flatMap((r) => {
    const ref = r.workshop_id ?? r.map_file;
    return ref ? [{ id: r.id, name: r.name, ref }] : [];
  });
}

// Карты матча. Пока вето для капитанов не готово, берутся первые карты пула по порядку.
export function pickMaps(pool: MapRef[], bestOf: number): MapRef[] {
  if (pool.length < bestOf) throw new Error(`В пуле ${pool.length} карт, а нужно ${bestOf} для BO${bestOf}`);
  return pool.slice(0, bestOf);
}

interface RosterPlayer { steamId: string; name: string }

export function rosterOf(tid: number, teamId: number): RosterPlayer[] {
  const tt = db.prepare('SELECT roster FROM tournament_teams WHERE tournament_id = ? AND team_id = ?')
    .get(tid, teamId) as { roster: string } | undefined;
  if (!tt) return [];
  const ids = JSON.parse(tt.roster) as number[];
  if (ids.length === 0) return [];
  const rows = db.prepare(`SELECT steam_id, name FROM players WHERE id IN (${ids.map(() => '?').join(',')})`)
    .all(...ids) as unknown as { steam_id: string; name: string }[];
  return rows.map((r) => ({ steamId: r.steam_id, name: r.name }));
}

// В конфиге матча нельзя кавычки, точку с запятой и переводы строк.
const clean = (s: string, max = 40) => s.replace(/["';\\\r\n\t]/g, '').trim().slice(0, max) || 'Player';

export interface MatchConfigInput {
  matchId: number;
  teamSize: number;
  teamA: { id: number; name: string; players: RosterPlayer[] };
  teamB: { id: number; name: string; players: RosterPlayer[] };
  maps: MapRef[];
}

export function buildMatchConfig(i: MatchConfigInput) {
  const players = (list: RosterPlayer[]) => Object.fromEntries(list.map((p) => [p.steamId, clean(p.name)]));
  return {
    matchid: i.matchId,
    team1: { id: String(i.teamA.id), name: clean(i.teamA.name), players: players(i.teamA.players) },
    team2: { id: String(i.teamB.id), name: clean(i.teamB.name), players: players(i.teamB.players) },
    num_maps: i.maps.length,
    maplist: i.maps.map((m) => m.ref),
    map_sides: i.maps.map(() => 'knife'),
    skip_veto: true,
    clinch_series: true,
    players_per_team: i.teamSize,
    wingman: i.teamSize === 2,
    min_players_to_ready: i.teamSize,
    cvars: {
      arenapro_remote_log_url: `${config.publicUrl}/api/arenapro/events`,
      arenapro_remote_log_header_key: 'Authorization',
      arenapro_remote_log_header_value: `Bearer ${eventToken()}`,
    },
  };
}
