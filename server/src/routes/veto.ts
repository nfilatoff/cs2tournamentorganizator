import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db } from '../db.js';
import { getSession, isPanelAdmin, requireAdmin } from '../auth.js';
import { E, errBody } from '../errors.js';
import { tournamentMapPool } from '../arenapro.js';
import { dispatchAll, endMatchOnServer, getServer, release } from '../dispatcher.js';
import { getMatchRowByCode, getTournament, teamName, type MatchRow, type TournamentRow } from '../tournamentStore.js';
import { expireVetoTurns, loadVeto, saveVeto, VETO_TURN_S, vetoApplies } from '../vetoStore.js';
import { mapImageUrl } from '../mapImages.js';
import {
  applyAction, autoComplete, isDone, markReady, nextAction, remaining, vetoResult, vetoStarted, vetoTemplate, type Team, type VetoState,
} from '../veto.js';

type Params = { Params: { id: string; code: string } };

function teamIdOf(json: string): number {
  return (JSON.parse(json) as { id: number }).id;
}

function captainOf(teamId: number): number | null {
  const r = db.prepare('SELECT captain_id FROM teams WHERE id = ?').get(teamId) as { captain_id: number } | undefined;
  return r?.captain_id ?? null;
}

// За какую сторону может ходить зашедший: капитан своей команды или админ (за любую)
function actingRole(req: FastifyRequest, row: MatchRow): 'a' | 'b' | 'admin' | null {
  const s = getSession(req);
  if (!s) return null;
  if (s.kind === 'admin') return 'admin';
  // Игрок-админ, который сам играет в этом матче, ходит в вето как капитан своей команды
  if (captainOf(teamIdOf(row.entry_a)) === s.userId) return 'a';
  if (captainOf(teamIdOf(row.entry_b)) === s.userId) return 'b';
  return isPanelAdmin(s) ? 'admin' : null;
}

function dto(req: FastifyRequest, t: TournamentRow, row: MatchRow, state: VetoState) {
  const pool = tournamentMapPool(t.id);
  const byId = new Map(pool.map((m) => [m.id, m]));
  const images = new Map((db.prepare(`SELECT m.id, m.image_url, m.map_file FROM tournament_maps tm JOIN maps m ON m.id = tm.map_id
    WHERE tm.tournament_id = ?`).all(t.id) as unknown as { id: number; image_url: string | null; map_file: string | null }[]).map((r) => [r.id, mapImageUrl(r)]));
  const next = nextAction(state);
  const role = actingRole(req, row);
  const a = teamIdOf(row.entry_a);
  const b = teamIdOf(row.entry_b);
  const done = isDone(state);
  const started = vetoStarted(state);
  return {
    bestOf: row.best_of,
    status: done ? 'done' as const : 'veto' as const,
    locked: row.server_id !== null || row.status !== 'ready',
    // Матч уже идёт на сервере: админ может сбросить вето, тогда матч останавливается
    running: row.status === 'live' && row.server_id !== null,
    teams: { a: { id: a, name: teamName(a) }, b: { id: b, name: teamName(b) } },
    pool: state.poolIds.map((id) => ({ id, name: byId.get(id)?.name ?? `#${id}`, imageUrl: images.get(id) ?? null })),
    template: vetoTemplate(state.poolIds.length, state.bestOf),
    actions: state.actions,
    remaining: remaining(state),
    next,
    you: role,
    // До начала вето капитаны подтверждают готовность, потом у каждого хода есть ограничение по времени
    started,
    ready: { a: started || !!state.ready?.a, b: started || !!state.ready?.b },
    deadline: started && !done && !state.adminControl && state.turnStartedAt !== undefined ? state.turnStartedAt + VETO_TURN_S * 1000 : null,
    turnSeconds: VETO_TURN_S,
    now: Date.now(),
    // Админ по умолчанию только наблюдает; ходить за команды он может, взяв управление
    adminControl: !!state.adminControl,
    canAct: started && next.type !== 'done' && (role === 'admin' ? !!state.adminControl : !state.adminControl && role === next.team),
    result: done ? vetoResult(state).map((p) => ({ ...p, name: byId.get(p.mapId)?.name ?? `#${p.mapId}` })) : null,
  };
}

export async function vetoRoutes(app: FastifyInstance): Promise<void> {
  const load = async (req: FastifyRequest<Params>) => {
    const t = getTournament(Number(req.params.id));
    const row = t ? getMatchRowByCode(t.id, req.params.code) : undefined;
    if (!t || !row) return { ok: false as const, error: E('matchNotFound'), code: 404 as const };
    if (!vetoApplies(t, row)) return { ok: false as const, error: E('vetoNotAvailable'), code: 409 as const };
    return { ok: true as const, t, row };
  };

  app.get<Params>('/api/tournaments/:id/matches/:code/veto', async (req, reply) => {
    const r = await load(req);
    if (!r.ok) return reply.code(r.code).send(r.error);
    try {
      return dto(req, r.t, r.row, loadVeto(r.t, r.row));
    } catch (e) {
      return reply.code(409).send(errBody(e));
    }
  });

  // Ход капитана (бан, пик или выбор стороны). Админ может ходить за любую команду.
  app.post<Params>('/api/tournaments/:id/matches/:code/veto/act', async (req, reply) => {
    const r = await load(req);
    if (!r.ok) return reply.code(r.code).send(r.error);
    const { t, row } = r;
    const role = actingRole(req, row);
    if (!role) return reply.code(403).send(E('vetoNotYourTurn'));
    if (row.server_id !== null || row.status !== 'ready') return reply.code(409).send(E('vetoLocked'));
    const body = z.object({ mapId: z.number().int().optional(), side: z.enum(['ct', 't']).optional() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send(E('badRequest'));
    try {
      const state = loadVeto(t, row);
      if (!vetoStarted(state)) return reply.code(409).send(E('vetoNotStarted'));
      if (role === 'admin' && !state.adminControl) return reply.code(409).send(E('vetoNoControl'));
      if (role !== 'admin' && state.adminControl) return reply.code(409).send(E('vetoAdminControl'));
      const next = nextAction(state);
      if (next.type === 'done') return reply.code(409).send(E('vetoDone'));
      const team: Team = role === 'admin' ? next.team : (role as Team);
      const updated = { ...applyAction(state, team, body.data), turnStartedAt: Date.now() };
      saveVeto(row.id, updated);
      if (isDone(updated)) void dispatchAll();
      return dto(req, t, { ...row, veto_json: JSON.stringify(updated) }, updated);
    } catch (e) {
      return reply.code(409).send(errBody(e));
    }
  });

  // Капитан подтверждает готовность к вето; админ ставит готовность за выбранную команду или сразу за обе
  app.post<Params>('/api/tournaments/:id/matches/:code/veto/ready', async (req, reply) => {
    const r = await load(req);
    if (!r.ok) return reply.code(r.code).send(r.error);
    const { t, row } = r;
    const role = actingRole(req, row);
    if (!role) return reply.code(403).send(E('vetoNotYourTurn'));
    if (row.server_id !== null || row.status !== 'ready') return reply.code(409).send(E('vetoLocked'));
    const body = z.object({ team: z.enum(['a', 'b']).optional() }).safeParse(req.body ?? {});
    if (!body.success) return reply.code(400).send(E('badRequest'));
    try {
      const updated = markReady(loadVeto(t, row), role === 'admin' ? body.data.team ?? 'both' : role, Date.now());
      saveVeto(row.id, updated);
      return dto(req, t, { ...row, veto_json: JSON.stringify(updated) }, updated);
    } catch (e) {
      return reply.code(409).send(errBody(e));
    }
  });

  // Админ берёт управление вето (ходит за обе команды) или возвращает его капитанам
  app.post<Params>('/api/tournaments/:id/matches/:code/veto/control', { preHandler: requireAdmin }, async (req, reply) => {
    const r = await load(req);
    if (!r.ok) return reply.code(r.code).send(r.error);
    const { t, row } = r;
    if (row.server_id !== null || row.status !== 'ready') return reply.code(409).send(E('vetoLocked'));
    const body = z.object({ on: z.boolean() }).safeParse(req.body);
    if (!body.success) return reply.code(400).send(E('badRequest'));
    const state = loadVeto(t, row);
    // Капитанам после возврата управления даём полное время на текущий ход
    const updated: VetoState = body.data.on
      ? { ...state, adminControl: true }
      : { ...state, adminControl: false, ...(vetoStarted(state) ? { turnStartedAt: Date.now() } : {}) };
    saveVeto(row.id, updated);
    return dto(req, t, { ...row, veto_json: JSON.stringify(updated) }, updated);
  });

  // Ход, на который у капитана вышло время, делается случайно, даже если страницу никто не открыл
  setInterval(() => {
    try {
      if (expireVetoTurns()) void dispatchAll();
    } catch (e) {
      app.log.error({ err: e }, 'veto timeout');
    }
  }, 1000).unref();

  // Админ: завершить вето случайными ходами
  app.post<Params>('/api/tournaments/:id/matches/:code/veto/auto', { preHandler: requireAdmin }, async (req, reply) => {
    const r = await load(req);
    if (!r.ok) return reply.code(r.code).send(r.error);
    const { t, row } = r;
    if (row.server_id !== null || row.status !== 'ready') return reply.code(409).send(E('vetoLocked'));
    try {
      const updated = autoComplete(loadVeto(t, row));
      saveVeto(row.id, updated);
      void dispatchAll();
      return dto(req, t, { ...row, veto_json: JSON.stringify(updated) }, updated);
    } catch (e) {
      return reply.code(409).send(errBody(e));
    }
  });

  // Админ: начать вето заново. Если матч уже запущен на сервере, он останавливается и возвращается в "готов".
  app.post<Params>('/api/tournaments/:id/matches/:code/veto/reset', { preHandler: requireAdmin }, async (req, reply) => {
    const r = await load(req);
    if (!r.ok) return reply.code(r.code).send(r.error);
    const { t } = r;
    let row = r.row;
    if (row.status === 'live' && row.server_id !== null) {
      const server = getServer(row.server_id);
      if (server) await endMatchOnServer(server);
      release(t.id, row.id);
      row = getMatchRowByCode(t.id, row.code)!;
    }
    if (row.server_id !== null || row.status !== 'ready') return reply.code(409).send(E('vetoLocked'));
    saveVeto(row.id, null);
    return dto(req, t, { ...row, veto_json: null }, loadVeto(t, { ...row, veto_json: null }));
  });
}
