import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db.js';
import { config } from '../config.js';
import { createSession, destroySession, getSession, verifyPassword } from '../auth.js';
import { fetchSteamProfile, steamLoginUrl, verifySteamCallback } from '../steam.js';

const loginBody = z.object({ username: z.string().min(1), password: z.string().min(1) });

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/admin/login', async (req, reply) => {
    const body = loginBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Укажите логин и пароль' });
    const admin = db.prepare('SELECT id, username, password_hash FROM admins WHERE username = ?')
      .get(body.data.username) as { id: number; username: string; password_hash: string } | undefined;
    const ok = admin ? await verifyPassword(body.data.password, admin.password_hash) : false;
    if (!admin || !ok) return reply.code(401).send({ error: 'Неверный логин или пароль' });
    createSession(reply, 'admin', admin.id);
    return { kind: 'admin', username: admin.username };
  });

  app.get('/api/auth/steam', async (_req, reply) => reply.redirect(steamLoginUrl()));

  app.get('/api/auth/steam/callback', async (req, reply) => {
    const query = req.query as Record<string, string>;
    const steamId = await verifySteamCallback(query);
    if (!steamId) return reply.code(401).send({ error: 'Steam не подтвердил вход' });

    const existing = db.prepare('SELECT id FROM players WHERE steam_id = ?').get(steamId) as { id: number } | undefined;
    let playerId: number;
    if (existing) {
      playerId = existing.id;
    } else {
      const profile = await fetchSteamProfile(steamId);
      const res = db.prepare('INSERT INTO players (steam_id, name, avatar_url) VALUES (?, ?, ?)')
        .run(steamId, profile.name, profile.avatar);
      playerId = Number(res.lastInsertRowid);
    }
    createSession(reply, 'player', playerId);
    return reply.redirect(`${config.publicUrl}/`);
  });

  app.get('/api/auth/me', async (req) => {
    const s = getSession(req);
    if (!s) return { kind: null };
    if (s.kind === 'admin') {
      const a = db.prepare('SELECT username FROM admins WHERE id = ?').get(s.userId) as { username: string } | undefined;
      return a ? { kind: 'admin', username: a.username } : { kind: null };
    }
    const p = db.prepare('SELECT id, steam_id, name, avatar_url FROM players WHERE id = ?')
      .get(s.userId) as { id: number; steam_id: string; name: string; avatar_url: string | null } | undefined;
    return p
      ? { kind: 'player', id: p.id, steamId: p.steam_id, name: p.name, avatarUrl: p.avatar_url }
      : { kind: null };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    destroySession(req, reply);
    return { ok: true };
  });
}
