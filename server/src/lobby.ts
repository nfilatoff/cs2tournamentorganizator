import { db } from './db.js';
import { getServer, withRcon, type ServerRow } from './dispatcher.js';

// Что происходит на сервере до старта матча: кто зашёл, готовы ли капитаны, сколько осталось времени.
// Панель узнаёт это опросом get5_status (поля players, captain_ready, ready_time_left, start_countdown — расширение ArenaPro).
export interface Lobby {
  players: { a: string[]; b: string[] };
  captainReady: { a: boolean; b: boolean };
  // Время сервера пересчитано в момент по часам панели
  deadline: number | null;
  startsAt: number | null;
  at: number;
}

interface StatusTeam { players?: string[]; captain_ready?: boolean }
interface Status {
  matchid?: number | null; gamestate?: string;
  team1?: StatusTeam; team2?: StatusTeam;
  ready_time_left?: number | null; start_countdown?: number | null;
}

const lobbies = new Map<number, Lobby>();

export function getLobby(matchId: number): Lobby | undefined {
  return lobbies.get(matchId);
}

export function forgetLobby(matchId: number): void {
  lobbies.delete(matchId);
}

export function parseLobby(text: string, matchId: number, now = Date.now()): Lobby | null {
  const m = /\{.*\}/s.exec(text);
  if (!m) return null;
  let s: Status;
  try {
    s = JSON.parse(m[0]) as Status;
  } catch {
    return null;
  }
  if (s.matchid !== matchId) return null;
  // team1 в конфиге матча — всегда сторона A панели (см. buildMatchConfig)
  return {
    players: { a: s.team1?.players ?? [], b: s.team2?.players ?? [] },
    captainReady: { a: !!s.team1?.captain_ready, b: !!s.team2?.captain_ready },
    deadline: typeof s.ready_time_left === 'number' ? now + s.ready_time_left * 1000 : null,
    startsAt: typeof s.start_countdown === 'number' ? now + s.start_countdown * 1000 : null,
    at: now,
  };
}

async function poll(matchId: number, server: ServerRow): Promise<void> {
  try {
    const text = await withRcon(server, (r) => r.exec('get5_status'));
    const lobby = parseLobby(text, matchId);
    if (lobby) lobbies.set(matchId, lobby);
  } catch {
    // сервер не ответил: показываем последнее известное состояние
  }
}

let busy = false;

// Опрашивает серверы, где матч загружен, но ещё не начался
async function pollAll(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const rows = db.prepare(`SELECT id, server_id FROM matches WHERE status = 'live' AND live = 0 AND server_id IS NOT NULL`)
      .all() as unknown as { id: number; server_id: number }[];
    const waiting = new Set(rows.map((r) => r.id));
    for (const id of lobbies.keys()) if (!waiting.has(id)) lobbies.delete(id);
    await Promise.allSettled(rows.map((r) => {
      const server = getServer(r.server_id);
      return server ? poll(r.id, server) : Promise.resolve();
    }));
  } finally {
    busy = false;
  }
}

export function startLobbyTimer(): void {
  setInterval(() => { void pollAll(); }, 3000).unref();
}
