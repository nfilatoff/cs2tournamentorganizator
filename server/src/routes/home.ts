import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { getSession } from '../auth.js';
import { decode } from '../errors.js';
import {
  loadMatchRows, teamName, type MatchRow, type TournamentRow,
} from '../tournamentStore.js';
import { loadVeto, vetoApplies } from '../vetoStore.js';
import { isDone, nextAction } from '../veto.js';
import { tournamentMapPool } from '../arenapro.js';
import { publicHost } from '../network.js';

const teamIdOf = (json: string): number | null => {
  const e = JSON.parse(json) as { k: string; id?: number };
  return e.k === 'team' ? e.id ?? null : null;
};

interface ServerRowInfo {
  id: number; name: string; host: string; port: number; cooldown_until: number; last_error: string | null;
}

function vetoInfo(t: TournamentRow, row: MatchRow, playerId: number | null) {
  const state = loadVeto(t, row);
  const done = isDone(state);
  let yourTurn = false;
  if (playerId !== null && !done) {
    const next = nextAction(state);
    if (next.type !== 'done') {
      const teamId = teamIdOf(next.team === 'a' ? row.entry_a : row.entry_b);
      const cap = teamId === null ? null : (db.prepare('SELECT captain_id FROM teams WHERE id = ?').get(teamId) as { captain_id: number } | undefined)?.captain_id;
      yourTurn = cap === playerId;
    }
  }
  return { done, step: state.actions.length, total: tournamentMapPool(t.id).length, yourTurn };
}

function playerBlock(pid: number) {
  const teams = db.prepare(`SELECT t.id, t.name, t.captain_id FROM teams t JOIN team_members tm ON tm.team_id = t.id
    WHERE tm.player_id = ? ORDER BY t.name`).all(pid) as unknown as { id: number; name: string; captain_id: number }[];

  const active = db.prepare(`SELECT tt.team_id, tt.roster, t.* FROM tournament_teams tt JOIN tournaments t ON t.id = tt.tournament_id
    WHERE t.status != 'finished'`).all() as unknown as (TournamentRow & { team_id: number; roster: string })[];

  const registered: { tournamentId: number; tournamentName: string; teamName: string }[] = [];
  const matches: unknown[] = [];
  const servers = new Map((db.prepare('SELECT id, name, host, port FROM game_servers').all() as unknown as
    { id: number; name: string; host: string; port: number }[]).map((s) => [s.id, { ...s, host: publicHost(s.host) }]));

  for (const r of active) {
    if (!(JSON.parse(r.roster) as number[]).includes(pid)) continue;
    const t = r as unknown as TournamentRow;
    if (t.status === 'registration') {
      registered.push({ tournamentId: t.id, tournamentName: t.name, teamName: teamName(r.team_id) });
      continue;
    }
    const rows = loadMatchRows(t.id).filter((m) => ['live', 'ready', 'pending'].includes(m.status));
    let waiting = false;
    for (const m of rows) {
      const a = teamIdOf(m.entry_a);
      const b = teamIdOf(m.entry_b);
      if (a !== r.team_id && b !== r.team_id) continue;
      const side = a === r.team_id ? 'a' : 'b';
      const oppId = side === 'a' ? b : a;
      const base = {
        tournamentId: t.id, tournamentName: t.name, code: m.code, stage: m.stage, bestOf: m.best_of,
        team: teamName(r.team_id), opponent: oppId === null ? null : teamName(oppId), side,
      };
      if (m.status === 'live') {
        const srv = m.server_id ? servers.get(m.server_id) : undefined;
        const refs = m.maps_json ? (JSON.parse(m.maps_json) as { name: string }[]) : [];
        matches.push({
          ...base, state: 'live', server: srv ?? null, started: !!m.live, paused: !!m.paused,
          map: m.live ? refs[m.cur_map_no]?.name ?? null : null,
          score: m.live ? { a: m.cur_score_a, b: m.cur_score_b } : null, series: { a: m.series_a, b: m.series_b },
        });
      } else if (m.status === 'ready') {
        const veto = vetoApplies(t, m) ? vetoInfo(t, m, pid) : null;
        matches.push({ ...base, state: veto && !veto.done ? 'veto' : 'queued', veto });
      } else if (!waiting) {
        waiting = true; // ближайший будущий матч, соперник ещё неизвестен
        matches.push({ ...base, state: 'waiting' });
      }
    }
  }

  // Турниры, где капитан может зарегистрировать свою команду
  const open = (db.prepare(`SELECT t.*, (SELECT COUNT(*) FROM tournament_teams tt WHERE tt.tournament_id = t.id) AS n
    FROM tournaments t WHERE t.status = 'registration' ORDER BY t.id DESC`).all() as unknown as (TournamentRow & { n: number })[])
    .flatMap((t) => {
      if (t.n >= t.max_teams) return [];
      const mine = db.prepare(`SELECT te.id, te.name FROM teams te WHERE te.captain_id = ?
        AND (SELECT COUNT(*) FROM team_members tm WHERE tm.team_id = te.id) >= ?
        AND te.id NOT IN (SELECT team_id FROM tournament_teams WHERE tournament_id = ?)`)
        .all(pid, t.team_size, t.id) as unknown as { id: number; name: string }[];
      return mine.length > 0 ? [{ tournamentId: t.id, tournamentName: t.name, teams: mine }] : [];
    });

  return {
    teams: teams.map((x) => ({ id: x.id, name: x.name, captain: x.captain_id === pid })),
    registered, matches, open,
  };
}

function adminBlock() {
  const now = Date.now();
  const servers = db.prepare('SELECT id, name, host, port, cooldown_until, last_error FROM game_servers ORDER BY name')
    .all() as unknown as ServerRowInfo[];
  const busyBy = new Map((db.prepare(`SELECT m.server_id, m.code, t.name AS tname FROM matches m JOIN tournaments t ON t.id = m.tournament_id
    WHERE m.server_id IS NOT NULL`).all() as unknown as { server_id: number; code: string; tname: string }[])
    .map((r) => [r.server_id, r]));

  const serverList = servers.map((s) => {
    const busy = busyBy.get(s.id);
    return {
      id: s.id, name: s.name, address: `${publicHost(s.host)}:${s.port}`,
      state: busy ? 'busy' as const : s.cooldown_until > now ? 'problem' as const : 'free' as const,
      match: busy ? `${busy.tname} · ${busy.code}` : null,
      lastError: s.cooldown_until > now ? decode(s.last_error) : null,
    };
  });
  const freeServers = serverList.filter((s) => s.state === 'free').length;

  const running = db.prepare("SELECT * FROM tournaments WHERE status = 'running' ORDER BY id DESC").all() as unknown as TournamentRow[];
  const attention: unknown[] = [];
  const progress: unknown[] = [];
  // Однотипные пункты одного турнира (например, десять матчей группы ждут вето) сводятся в один
  const grouped = new Map<string, { count: number }>();
  const addGrouped = (key: string, item: Record<string, unknown>) => {
    const existing = grouped.get(key);
    if (existing) existing.count++;
    else {
      const entry = { ...item, count: 1 };
      grouped.set(key, entry);
      attention.push(entry);
    }
  };

  for (const t of running) {
    const rows = loadMatchRows(t.id);
    const real = rows.filter((m) => m.status !== 'bye' && m.status !== 'skipped');
    progress.push({
      id: t.id, name: t.name, total: real.length, done: real.filter((m) => m.status === 'done').length,
      live: real.filter((m) => m.status === 'live').length, phase: t.phase, stageMode: t.stage_mode,
    });
    if (t.phase === 'groups_done' && t.has_playoff) attention.push({ type: 'playoff', tournamentId: t.id, tournamentName: t.name });
    for (const m of rows) {
      const where = { tournamentId: t.id, tournamentName: t.name, code: m.code };
      const a = teamIdOf(m.entry_a);
      const b = teamIdOf(m.entry_b);
      const names = { a: a === null ? null : teamName(a), b: b === null ? null : teamName(b) };
      if (m.status === 'live' && m.paused) attention.push({ type: 'paused', ...where, ...names });
      if (m.status !== 'ready') continue;
      if (m.note) attention.push({ type: 'note', ...where, ...names, note: decode(m.note) });
      if (vetoApplies(t, m)) {
        const v = vetoInfo(t, m, null);
        if (!v.done) { addGrouped(`veto:${t.id}`, { type: 'veto', ...where, ...names, step: v.step, total: v.total }); continue; }
      }
      if (!t.auto_dispatch) addGrouped(`queued:${t.id}:manual`, { type: 'queued', ...where, ...names, reason: 'manual' });
      else if (freeServers === 0) addGrouped(`queued:${t.id}:noServer`, { type: 'queued', ...where, ...names, reason: 'noServer' });
    }
  }
  for (const s of serverList) {
    if (s.state === 'problem') attention.push({ type: 'serverError', server: s.name, error: s.lastError });
  }

  return {
    servers: { total: serverList.length, free: freeServers, busy: serverList.filter((s) => s.state === 'busy').length, list: serverList },
    attention, running: progress,
  };
}

export async function homeRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/home', async (req) => {
    const s = getSession(req);
    const tournaments = (db.prepare(`SELECT t.*, (SELECT COUNT(*) FROM tournament_teams tt WHERE tt.tournament_id = t.id) AS team_count
      FROM tournaments t WHERE t.status != 'finished' ORDER BY (t.status = 'running') DESC, t.id DESC LIMIT 12`)
      .all() as unknown as (TournamentRow & { team_count: number })[]).map((t) => ({
      id: t.id, name: t.name, format: t.format, teamSize: t.team_size, maxTeams: t.max_teams, status: t.status,
      teamCount: t.team_count, stageMode: t.stage_mode,
    }));
    if (s?.kind === 'player') return { kind: 'player' as const, tournaments, player: playerBlock(s.userId) };
    if (s?.kind === 'admin') return { kind: 'admin' as const, tournaments, admin: adminBlock() };
    return { kind: 'guest' as const, tournaments };
  });
}
