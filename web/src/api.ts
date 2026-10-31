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
  | { kind: 'player'; id: number; steamId: string; name: string; avatarUrl: string | null };

export interface GameServer { id: number; name: string; host: string; port: number }
export interface MapItem {
  id: number;
  name: string;
  workshopId: string | null;
  mapFile: string | null;
  imageUrl: string | null;
}

export interface Member { id: number; name: string; steamId: string; avatarUrl: string | null }
export interface Team { id: number; name: string; joinCode: string; captainId: number; members: Member[] }

export interface TournamentSummary {
  id: number; name: string; format: 'single' | 'double'; teamSize: number; maxTeams: number;
  status: 'registration' | 'running' | 'finished'; teamCount: number;
}

export type EntryDto = { type: 'team'; id: number; name: string; seed: number | null } | { type: 'tbd' } | { type: 'bye' };

export interface MatchDto {
  code: string; bracket: 'W' | 'L' | 'GF'; round: number; position: number; roundFromEnd: number;
  from: ({ kind: 'winner' | 'loser' | 'slot'; code: string } | null)[];
  a: EntryDto; b: EntryDto; status: 'pending' | 'ready' | 'live' | 'done' | 'bye' | 'skipped';
  winner: 'a' | 'b' | null; bestOf: number; scoreA: number; scoreB: number; forced: boolean;
  matchId?: number;
  server?: { id: number; name: string; host: string; port: number } | null;
  live?: boolean;
  paused?: boolean;
  note?: string | null;
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
  champion: { id: number; name: string } | null;
  teams: { id: number; name: string; seed: number | null; roster: number[] }[];
  maps: MapItem[];
  matches: MatchDto[];
}

export interface ServerStatus {
  online: boolean;
  error?: { error: string; params?: Record<string, unknown> };
  gamestate?: string;
  paused?: boolean;
  serverMatchId?: number | null;
  panelMatch: { code: string; tournament_id: number } | null;
  lastError: { error: string; params?: Record<string, unknown> } | null;
}
