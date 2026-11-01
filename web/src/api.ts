export class ApiError extends Error {
  constructor(public status: number, public code: string, public params?: Record<string, unknown>) {
    super(code);
  }
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? 'GET',
    headers: init?.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; params?: Record<string, unknown> };
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'internal', data.params);
  return data as T;
}

export type Me =
  | { kind: null }
  | { kind: 'admin'; username: string }
  | {
    kind: 'player'; id: number; steamId: string; name: string; avatarUrl: string | null;
    steamName: string | null; customName: string | null; adminName: string | null;
  };

export type GameMode = 'competitive' | 'wingman' | 'casual' | 'deathmatch';
export interface ServerSettings {
  managed: boolean; startMap: string; gameMode: GameMode; maxPlayers: number; hostname: string; svPassword: string;
  lan: boolean; gslt: string; tvEnable: boolean; tvPort: number | null; autostart: boolean; extraCfg: string;
}
export interface GameServer {
  id: number; name: string; host: string; address: string; auto: boolean; port: number; managed: boolean; settings: ServerSettings; tvPort: number;
  process: { running: boolean; pid: number | null; startedAt: number | null; lastExit: { code: number | null; at: number } | null };
}
export interface LauncherInfo { cs2Path: string; detected: string | null; exe: string | null; defaultHost: string; nextPort: number }
export interface MapItem {
  id: number;
  name: string;
  workshopId: string | null;
  mapFile: string | null;
  imageUrl: string | null;
}

export interface Member {
  id: number; name: string; steamId: string; avatarUrl: string | null;
  steamName: string | null; customName: string | null; adminName: string | null;
}
export interface Team { id: number; name: string; joinCode: string; captainId: number; members: Member[] }

export interface TournamentSummary {
  id: number; name: string; format: 'single' | 'double'; teamSize: number; maxTeams: number;
  status: 'registration' | 'running' | 'finished'; teamCount: number;
}

export type EntryDto = { type: 'team'; id: number; name: string; seed: number | null } | { type: 'tbd' } | { type: 'bye' };

export interface MatchDto {
  code: string; bracket: 'W' | 'L' | 'GF' | 'G'; round: number; position: number; roundFromEnd: number;
  stage: 'group' | 'playoff'; groupNo: number | null;
  from: ({ kind: 'winner' | 'loser' | 'slot'; code: string } | null)[];
  a: EntryDto; b: EntryDto; status: 'pending' | 'ready' | 'live' | 'done' | 'bye' | 'skipped';
  winner: 'a' | 'b' | null; bestOf: number; scoreA: number; scoreB: number; forced: boolean;
  matchId?: number;
  veto?: { done: boolean; step: number; total: number } | null;
  server?: { id: number; name: string; host: string; port: number } | null;
  live?: boolean;
  paused?: boolean;
  note?: string | null;
  walkover?: boolean;
  seriesA?: number;
  seriesB?: number;
  curMap?: { no: number; name: string | null; scoreA: number; scoreB: number } | null;
  playedMaps?: { no: number; name: string | null; scoreA: number; scoreB: number; winner: 'a' | 'b' | null }[];
}

export interface TournamentDetails extends Omit<TournamentSummary, 'teamCount'> {
  defaultBestOf: number;
  boConfig: Record<string, number>;
  grandFinalReset: boolean;
  autoDispatch: boolean;
  vetoEnabled: boolean;
  vetoSides: boolean;
  pauses: PauseLimits;
  groupConfig: GroupConfig;
  groups: GroupsInfo | null;
  champion: { id: number; name: string } | null;
  teams: { id: number; name: string; seed: number | null; roster: number[] }[];
  maps: MapItem[];
  matches: MatchDto[];
}

export interface PauseLimits { tactical: number; tacticalTime: number; technical: number }

export interface ServerStatus {
  online: boolean;
  error?: { error: string; params?: Record<string, unknown> };
  gamestate?: string;
  paused?: boolean;
  serverMatchId?: number | null;
  panelMatch: { code: string; tournament_id: number } | null;
  lastError: { error: string; params?: Record<string, unknown> } | null;
}

export interface StandingRow {
  teamId: number; name: string; played: number; wins: number; losses: number; points: number;
  mapsFor: number; mapsAgainst: number; mapDiff: number; buchholz: number; seed: number; rank: number;
  tiedBySeed: boolean; qualified: boolean;
}

export interface GroupConfig {
  stageMode: 'playoff' | 'groups';
  phase: 'playoff' | 'groups' | 'groups_done';
  format: 'round_robin' | 'swiss' | 'gsl' | null;
  groupsCount: number;
  advance: number;
  swissRounds: number | null;
  bestOf: number;
  hasPlayoff: boolean;
}

export interface GroupsInfo {
  swissTotal: number | null;
  tables: { no: number; standings: StandingRow[] }[];
}

export interface PlayoffPreview {
  ties: boolean;
  order: { id: number; name: string; group: number | null; rank: number | null; tiedBySeed: boolean }[];
  matches: MatchDto[];
}

export interface Preview {
  matches: MatchDto[];
  groupAssignment?: { no: number; teams: { id: number; name: string; seed: number }[] }[];
}

export interface VetoDto {
  bestOf: number;
  status: 'veto' | 'done';
  locked: boolean;
  running: boolean;
  teams: { a: { id: number; name: string }; b: { id: number; name: string } };
  pool: { id: number; name: string; imageUrl: string | null }[];
  template: { kind: 'ban' | 'pick' | 'decider'; team: 'a' | 'b' | null }[];
  actions: { mapId: number; kind: 'ban' | 'pick' | 'decider'; by: 'a' | 'b' | null; side?: 'ct' | 't' }[];
  remaining: number[];
  next: { type: 'ban' | 'pick' | 'side'; team: 'a' | 'b' } | { type: 'done' };
  you: 'a' | 'b' | 'admin' | null;
  started: boolean;
  adminControl: boolean;
  ready: { a: boolean; b: boolean };
  deadline: number | null;
  turnSeconds: number;
  now: number;
  canAct: boolean;
  result: { mapId: number; name: string; side: string; pickedBy: 'a' | 'b' | null }[] | null;
}

export type MatchPhase = 'waiting' | 'veto' | 'queued' | 'warmup' | 'live' | 'done' | 'skipped';

export interface MatchPlayer {
  id: number; name: string; steamId: string; avatarUrl: string | null; captain: boolean;
  // null: неизвестно (матч не на сервере или уже идёт)
  online: boolean | null;
}

export interface MatchTeam { id: number; name: string; seed: number | null; players: MatchPlayer[] }

export interface MatchDetails {
  tournament: { id: number; name: string; format: 'single' | 'double'; teamSize: number; status: string };
  code: string; bracket: 'W' | 'L' | 'GF' | 'G'; stage: 'group' | 'playoff'; groupNo: number | null; roundFromEnd: number;
  bestOf: number; status: MatchDto['status']; phase: MatchPhase;
  winner: 'a' | 'b' | null; scoreA: number; scoreB: number; forced: boolean; walkover: boolean;
  series: { a: number; b: number };
  paused: boolean;
  teams: { a: MatchTeam | null; b: MatchTeam | null };
  maps: { no: number; name: string; imageUrl: string | null; side: string; score: { a: number; b: number } | null; winner: 'a' | 'b' | null; current: boolean }[];
  veto: { done: boolean; step: number; total: number } | null;
  server: { name: string; host: string; port: number } | null;
  lobby: {
    deadline: number | null; startsAt: number | null; captainReady: { a: boolean; b: boolean };
    known: boolean; joinTime: number; startDelay: number;
  } | null;
  now: number;
  you: { side: 'a' | 'b' | null; captain: boolean } | null;
  admin: boolean;
  note: { error: string; params?: Record<string, unknown> } | null;
}

export interface HomeTournament {
  id: number; name: string; format: 'single' | 'double'; teamSize: number; maxTeams: number;
  status: 'registration' | 'running' | 'finished'; teamCount: number; stageMode: string;
}

export interface HomeMatch {
  tournamentId: number; tournamentName: string; code: string; stage: string; bestOf: number;
  team: string; opponent: string | null; side: 'a' | 'b';
  state: 'live' | 'veto' | 'queued' | 'waiting';
  veto?: { done: boolean; step: number; total: number; yourTurn: boolean } | null;
  server?: { id: number; name: string; host: string; port: number } | null;
  started?: boolean; paused?: boolean; map?: string | null; score?: { a: number; b: number } | null;
}

type ErrObj = { error: string; params?: Record<string, unknown> } | null;

export type AttentionItem =
  | { type: 'veto'; tournamentId: number; tournamentName: string; code: string; a: string | null; b: string | null; step: number; total: number; count: number }
  | { type: 'queued'; tournamentId: number; tournamentName: string; code: string; a: string | null; b: string | null; reason: 'manual' | 'noServer'; count: number }
  | { type: 'note'; tournamentId: number; tournamentName: string; code: string; a: string | null; b: string | null; note: ErrObj }
  | { type: 'paused'; tournamentId: number; tournamentName: string; code: string; a: string | null; b: string | null }
  | { type: 'playoff'; tournamentId: number; tournamentName: string }
  | { type: 'serverError'; server: string; error: ErrObj };

export type HomeDto =
  | { kind: 'guest'; tournaments: HomeTournament[] }
  | {
    kind: 'player'; tournaments: HomeTournament[];
    player: {
      teams: { id: number; name: string; captain: boolean }[];
      registered: { tournamentId: number; tournamentName: string; teamName: string }[];
      matches: HomeMatch[];
      open: { tournamentId: number; tournamentName: string; teams: { id: number; name: string }[] }[];
    };
  }
  | {
    kind: 'admin'; tournaments: HomeTournament[];
    admin: {
      servers: { total: number; free: number; busy: number; list: { id: number; name: string; address: string; state: 'free' | 'busy' | 'problem'; match: string | null }[] };
      attention: AttentionItem[];
      running: { id: number; name: string; total: number; done: number; live: number; phase: string; stageMode: string }[];
    };
  };
