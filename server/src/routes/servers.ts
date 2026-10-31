import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db } from '../db.js';
import { requireAdmin } from '../auth.js';

const serverBody = z.object({
  name: z.string().trim().min(1).max(60),
  host: z.string().trim().min(1).max(255),
  port: z.number().int().min(1).max(65535),
  rconPassword: z.string().min(1).max(255),
});

interface Row { id: number; name: string; host: string; port: number; rcon_password: string }

// RCON-пароль наружу не отдаём.
const toDto = (r: Row) => ({ id: r.id, name: r.name, host: r.host, port: r.port });

export async function serverRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAdmin);

  app.get('/api/servers', async () => {
    const rows = db.prepare('SELECT * FROM game_servers ORDER BY name').all() as unknown as Row[];
    return rows.map(toDto);
  });

  app.post('/api/servers', async (req, reply) => {
    const body = serverBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Некорректные данные сервера' });
    const { name, host, port, rconPassword } = body.data;
    try {
      const res = db.prepare('INSERT INTO game_servers (name, host, port, rcon_password) VALUES (?, ?, ?, ?)')
        .run(name, host, port, rconPassword);
      return reply.code(201).send({ id: Number(res.lastInsertRowid), name, host, port });
    } catch {
      return reply.code(409).send({ error: 'Сервер с таким адресом уже есть' });
    }
  });

  app.put<{ Params: { id: string } }>('/api/servers/:id', async (req, reply) => {
    const body = serverBody.partial({ rconPassword: true }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: 'Некорректные данные сервера' });
    const id = Number(req.params.id);
    const cur = db.prepare('SELECT * FROM game_servers WHERE id = ?').get(id) as Row | undefined;
    if (!cur) return reply.code(404).send({ error: 'Сервер не найден' });
    const { name, host, port, rconPassword } = body.data;
    try {
      db.prepare('UPDATE game_servers SET name = ?, host = ?, port = ?, rcon_password = ? WHERE id = ?')
        .run(name, host, port, rconPassword ?? cur.rcon_password, id);
    } catch {
      return reply.code(409).send({ error: 'Сервер с таким адресом уже есть' });
    }
    return { id, name, host, port };
  });

  app.delete<{ Params: { id: string } }>('/api/servers/:id', async (req, reply) => {
    const res = db.prepare('DELETE FROM game_servers WHERE id = ?').run(Number(req.params.id));
    if (res.changes === 0) return reply.code(404).send({ error: 'Сервер не найден' });
    return { ok: true };
  });
}
