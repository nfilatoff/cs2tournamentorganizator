import { db, tx } from './db.js';
import { AppError, E, encode, errBody } from './errors.js';
import { panelUrlFor } from './config.js';
import { rconHost } from './network.js';
import { Rcon } from './rcon.js';
import { eventToken } from './arenapro.js';
import { matchMaps, vetoComplete } from './vetoStore.js';
import {
  clearRuntime, getMatchRow, getTournament, loadMatches, saveMatches, teamName, type MatchRow,
} from './tournamentStore.js';

export interface ServerRow {
  id: number; name: string; host: string; port: number; rcon_password: string;
  cooldown_until: number; last_error: string | null;
}

const COOLDOWN_MS = 30_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function getServer(id: number): ServerRow | undefined {
  return db.prepare('SELECT * FROM game_servers WHERE id = ?').get(id) as unknown as ServerRow | undefined;
}

export async function withRcon<T>(server: ServerRow, fn: (r: Rcon) => Promise<T>): Promise<T> {
  const rcon = await Rcon.connect(rconHost(server.host), server.port, server.rcon_password, 4000);
  try {
    return await fn(rcon);
  } finally {
    rcon.close();
  }
}

export interface ServerStatus { gamestate: string; paused: boolean; matchId: number | null; raw: unknown }

export function parseStatus(text: string): ServerStatus | null {
  const m = /\{.*\}/s.exec(text);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as { gamestate?: string; paused?: boolean; matchid?: number | null };
    return { gamestate: j.gamestate ?? 'none', paused: !!j.paused, matchId: j.matchid ?? null, raw: j };
  } catch {
    return null;
  }
}

// Завершает матч на сервере. Ошибки связи не фатальны: сервер мог быть уже выключен.
export async function endMatchOnServer(server: ServerRow): Promise<void> {
  try {
    await withRcon(server, (r) => r.exec('get5_endmatch'));
  } catch {
    // сервер недоступен, матч в панели всё равно освобождается
  }
}

// Резервирует матч за сервером: статус "идёт", чтобы никто другой его не взял.
function reserve(tid: number, row: MatchRow, serverId: number, mapsJson: string): boolean {
  return tx(() => {
    const ms = loadMatches(tid);
    const m = ms.find((x) => x.code === row.code);
    if (!m || m.status !== 'ready') return false;
    m.status = 'live';
    saveMatches(tid, ms);
    db.prepare('UPDATE matches SET server_id = ?, maps_json = ?, note = NULL, dispatched_at = ?, walkover = 0 WHERE id = ?')
      .run(serverId, mapsJson, Date.now(), row.id);
    return true;
  });
}

// Возвращает матч в "готов" и освобождает сервер.
export function release(tid: number, matchId: number, note: string | null = null): void {
  tx(() => {
    const row = getMatchRow(matchId);
    if (!row) return;
    const ms = loadMatches(tid);
    const m = ms.find((x) => x.code === row.code);
    if (m && m.status === 'live') {
      m.status = 'ready';
      saveMatches(tid, ms);
    }
    clearRuntime(matchId);
    db.prepare('DELETE FROM match_maps WHERE match_id = ?').run(matchId);
    db.prepare('UPDATE matches SET note = ? WHERE id = ?').run(note, matchId);
  });
}

// Запускает матч на сервере. Бросает ошибку с понятным текстом, если не получилось.
async function startOnServer(tid: number, row: MatchRow, server: ServerRow): Promise<void> {
  const t = getTournament(tid)!;
  const maps = matchMaps(t, row);
  if (!reserve(tid, row, server.id, JSON.stringify(maps))) throw new AppError('matchTaken');

  try {
    const url = `${panelUrlFor(server.host)}/api/arenapro/config/${row.id}`;
    await withRcon(server, async (r) => {
      await r.exec('get5_endmatch'); // сбросить то, что осталось на сервере от прошлого матча
      await r.exec(`arenapro_loadmatch_url "${url}" Authorization "Bearer ${eventToken()}"`, { firstWaitMs: 2500 });
      // Конфиг загружается асинхронно: ждём, пока сервер подтвердит наш matchid
      for (let i = 0; i < 12; i++) {
        await sleep(1000);
        const st = parseStatus(await r.exec('get5_status'));
        if (st && st.matchId === row.id && st.gamestate !== 'none') return;
      }
      throw new AppError('serverNoConfirm');
    });
    db.prepare('UPDATE game_servers SET last_error = NULL WHERE id = ?').run(server.id);
    void t;
  } catch (e) {
    const reason = errBody(e);
    release(tid, row.id, encode(E('noteStartFailed', { server: server.name, reason })));
    db.prepare('UPDATE game_servers SET cooldown_until = ?, last_error = ? WHERE id = ?')
      .run(Date.now() + COOLDOWN_MS, encode(reason), server.id);
    throw e;
  }
}

function freeServers(): ServerRow[] {
  return db.prepare(`
    SELECT * FROM game_servers
    WHERE cooldown_until < ? AND id NOT IN (SELECT server_id FROM matches WHERE server_id IS NOT NULL)
    ORDER BY id
  `).all(Date.now()) as unknown as ServerRow[];
}

let busy = false;

// Раздаёт готовые матчи свободным серверам (только турниры с автозапуском).
export async function dispatchAll(): Promise<void> {
  if (busy) return;
  busy = true;
  try {
    const waiting = db.prepare(`
      SELECT m.* FROM matches m JOIN tournaments t ON t.id = m.tournament_id
      WHERE t.status = 'running' AND t.auto_dispatch = 1 AND m.status = 'ready' AND m.server_id IS NULL
      ORDER BY m.tournament_id, m.id
    `).all() as unknown as MatchRow[];
    for (const row of waiting) {
      // Пока капитаны не закончили вето, матч не запускается
      const t = getTournament(row.tournament_id);
      try {
        if (!t || !vetoComplete(t, row)) continue;
      } catch {
        continue;
      }
      const server = freeServers()[0];
      if (!server) return;
      try {
        await startOnServer(row.tournament_id, row, server);
      } catch {
        // причина записана в матче и сервере, идём к следующему
      }
    }
  } finally {
    busy = false;
  }
}

// Ручной запуск конкретного матча (на выбранном или любом свободном сервере).
export async function dispatchOne(matchId: number, serverId?: number): Promise<void> {
  const row = getMatchRow(matchId);
  if (!row) throw new AppError('matchNotFound');
  if (row.status !== 'ready' || row.server_id !== null) throw new AppError('matchNotReadyToStart');
  const t = getTournament(row.tournament_id);
  if (t && !vetoComplete(t, row)) throw new AppError('vetoPending');
  let server: ServerRow | undefined;
  if (serverId !== undefined) {
    server = getServer(serverId);
    if (!server) throw new AppError('serverNotFound');
    if (freeServers().every((s) => s.id !== server!.id)) {
      throw new AppError('serverCooldown');
    }
  } else {
    server = freeServers()[0];
    if (!server) throw new AppError('noFreeServers');
  }
  await startOnServer(row.tournament_id, row, server);
}

export function startDispatchTimer(): void {
  setInterval(() => { void dispatchAll(); }, 10_000).unref();
}

export { teamName };
