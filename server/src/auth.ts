import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { db } from './db.js';
import { config } from './config.js';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, 64);
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, keyHex] = stored.split(':');
  if (!saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, 'hex');
  const actual = await scrypt(password, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(expected, actual);
}

export type Kind = 'admin' | 'player';
export interface Session { kind: Kind; userId: number }

const COOKIE = 'sid';

export function createSession(reply: FastifyReply, kind: Kind, userId: number): void {
  const token = randomBytes(32).toString('hex');
  const expiresAt = Date.now() + config.sessionTtlMs;
  db.prepare('INSERT INTO sessions (token, kind, user_id, expires_at) VALUES (?, ?, ?, ?)')
    .run(token, kind, userId, expiresAt);
  reply.setCookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: config.sessionTtlMs / 1000,
  });
}

export function destroySession(req: FastifyRequest, reply: FastifyReply): void {
  const token = req.cookies[COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  reply.clearCookie(COOKIE, { path: '/' });
}

export function getSession(req: FastifyRequest): Session | null {
  const token = req.cookies[COOKIE];
  if (!token) return null;
  const row = db.prepare('SELECT kind, user_id, expires_at FROM sessions WHERE token = ?')
    .get(token) as { kind: Kind; user_id: number; expires_at: number } | undefined;
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  return { kind: row.kind, userId: row.user_id };
}

export async function requireAdmin(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (getSession(req)?.kind !== 'admin') await reply.code(401).send({ error: 'Нужен вход администратора' });
}

export async function requirePlayer(req: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (getSession(req)?.kind !== 'player') await reply.code(401).send({ error: 'Нужен вход через Steam' });
}
