import { randomBytes, timingSafeEqual } from 'node:crypto';
import { AppError } from './errors.js';
import { db, getSetting, setSetting } from './db.js';

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
  // Сторона из вето (team1_ct, team2_t, knife ...); без вето играется нож
  side?: string;
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
  if (pool.length < bestOf) throw new AppError('poolTooSmall', { have: pool.length, need: bestOf });
  return pool.slice(0, bestOf);
}

interface RosterPlayer { steamId: string; name: string }

// Сколько секунд у игроков есть, чтобы зайти на сервер и начать матч. Потом побеждает команда, у которой
// больше игроков на сервере (поровну: случайная). См. arenapro_ready_mode 2 в плагине.
export const JOIN_TIME_S = 600;
// Обратный отсчёт после .ready обоих капитанов до старта матча
export const START_DELAY_S = 10;

// SteamID капитана, если он играет в этом составе: он пишет .ready за команду
export function captainSteamId(tid: number, teamId: number): string | undefined {
  const tt = db.prepare('SELECT roster FROM tournament_teams WHERE tournament_id = ? AND team_id = ?')
    .get(tid, teamId) as { roster: string } | undefined;
  const cap = db.prepare('SELECT p.id, p.steam_id FROM teams t JOIN players p ON p.id = t.captain_id WHERE t.id = ?')
    .get(teamId) as { id: number; steam_id: string } | undefined;
  if (!tt || !cap || !(JSON.parse(tt.roster) as number[]).includes(cap.id)) return undefined;
  return cap.steam_id;
}

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
  teamA: { id: number; name: string; players: RosterPlayer[]; captain?: string };
  teamB: { id: number; name: string; players: RosterPlayer[]; captain?: string };
  maps: MapRef[];
  pauses: { tactical: number; tacticalTime: number; technical: number };
  // Адрес панели, по которому этот сервер шлёт события (см. panelUrlFor)
  panelUrl: string;
}

// Лимиты пауз турнира. Значения из конфига матча перекрывают live.cfg на время серии.
function pauseCvars(p: MatchConfigInput['pauses']): Record<string, string> {
  const cvars: Record<string, string> = {
    mp_team_timeout_max: String(p.tactical),
    mp_team_timeout_time: String(p.tacticalTime),
    arenapro_max_tech_pauses: String(p.technical),
  };
  // Без тактических пауз в овертайме они тоже не добавляются
  if (p.tactical === 0) {
    Object.assign(cvars, { mp_team_timeout_ot_max: '0', mp_team_timeout_ot_add_each: '0', mp_team_timeout_ot_add_once: '0' });
  }
  return cvars;
}

export function buildMatchConfig(i: MatchConfigInput) {
  const players = (list: RosterPlayer[]) => Object.fromEntries(list.map((p) => [p.steamId, clean(p.name)]));
  const team = (x: MatchConfigInput['teamA']) => ({
    id: String(x.id), name: clean(x.name), players: players(x.players), ...(x.captain ? { captain: x.captain } : {}),
  });
  return {
    matchid: i.matchId,
    team1: team(i.teamA),
    team2: team(i.teamB),
    num_maps: i.maps.length,
    maplist: i.maps.map((m) => m.ref),
    map_sides: i.maps.map((m) => m.side ?? 'knife'),
    skip_veto: true,
    clinch_series: true,
    players_per_team: i.teamSize,
    wingman: i.teamSize === 2,
    min_players_to_ready: i.teamSize,
    cvars: {
      ...pauseCvars(i.pauses),
      // Все игроки зашли и оба капитана написали .ready: отсчёт START_DELAY_S и старт.
      // Через JOIN_TIME_S без старта побеждает команда, у которой больше игроков на сервере.
      arenapro_ready_mode: '2',
      arenapro_join_start_delay: String(START_DELAY_S),
      arenapro_time_to_start: String(JOIN_TIME_S),
      arenapro_remote_log_url: `${i.panelUrl}/api/arenapro/events`,
      arenapro_remote_log_header_key: 'Authorization',
      arenapro_remote_log_header_value: `Bearer ${eventToken()}`,
    },
  };
}
