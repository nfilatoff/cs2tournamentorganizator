import type { FastifyInstance } from 'fastify';
import { E } from '../errors.js';
import { z } from 'zod';
import { db } from '../db.js';
import { config } from '../config.js';
import { createSession, destroySession, getSession, hashPassword, requireAdmin, verifyPassword } from '../auth.js';
import { fetchSteamProfile, steamLoginUrl, verifySteamCallback } from '../steam.js';

const loginBody = z.object({ username: z.string().min(1), password: z.string().min(1) });

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/auth/admin/login', async (req, reply) => {
    const body = loginBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send(E('needCredentials'));
    const admin = db.prepare('SELECT id, username, password_hash FROM admins WHERE username = ?')
      .get(body.data.username) as { id: number; username: string; password_hash: string } | undefined;
    const ok = admin ? await verifyPassword(body.data.password, admin.password_hash) : false;
    if (!admin || !ok) return reply.code(401).send(E('badCredentials'));
    createSession(reply, 'admin', admin.id);
    return { kind: 'admin', username: admin.username };
  });

  // Смена логина и/или пароля текущего администратора (нужен текущий пароль)
  app.post('/api/auth/admin/account', { preHandler: requireAdmin }, async (req, reply) => {
    const body = z.object({
      currentPassword: z.string().min(1),
      newUsername: z.string().trim().min(3).max(40).optional(),
      newPassword: z.string().min(8).max(200).optional(),
    }).safeParse(req.body);
    if (!body.success || (!body.data.newUsername && !body.data.newPassword)) return reply.code(400).send(E('badAccount'));
    const adminId = getSession(req)!.userId;
    const admin = db.prepare('SELECT id, username, password_hash FROM admins WHERE id = ?')
      .get(adminId) as { id: number; username: string; password_hash: string } | undefined;
    if (!admin || !(await verifyPassword(body.data.currentPassword, admin.password_hash))) {
      return reply.code(401).send(E('wrongPassword'));
    }
    try {
      if (body.data.newUsername) db.prepare('UPDATE admins SET username = ? WHERE id = ?').run(body.data.newUsername, admin.id);
    } catch {
      return reply.code(409).send(E('usernameTaken'));
    }
    if (body.data.newPassword) {
      db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(await hashPassword(body.data.newPassword), admin.id);
    }
    return { username: body.data.newUsername ?? admin.username };
  });

  app.get('/api/auth/steam', async (_req, reply) => reply.redirect(steamLoginUrl()));

  app.get('/api/auth/steam/callback', async (req, reply) => {
    const query = req.query as Record<string, string>;
    const steamId = await verifySteamCallback(query);
    if (!steamId) return reply.code(401).send(E('steamRejected'));

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
