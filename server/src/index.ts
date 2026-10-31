import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import { db } from './db.js';
import { hashPassword } from './auth.js';
import { authRoutes } from './routes/auth.js';
import { serverRoutes } from './routes/servers.js';
import { mapRoutes } from './routes/maps.js';
import { teamRoutes } from './routes/teams.js';
import { tournamentRoutes } from './routes/tournaments.js';
import { arenaproRoutes } from './routes/arenapro.js';
import { dispatchAll, startDispatchTimer } from './dispatcher.js';

async function ensureAdmin(): Promise<void> {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM admins').get() as { n: number };
  if (n > 0) return;
  const password = process.env.ADMIN_PASSWORD ?? randomBytes(9).toString('base64url');
  db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)')
    .run('admin', await hashPassword(password));
  console.log('\n=== Создан администратор ===');
  console.log('Логин: admin');
  console.log(process.env.ADMIN_PASSWORD ? 'Пароль: из ADMIN_PASSWORD' : `Пароль: ${password}`);
  console.log('Смените его после первого входа.\n');
}

const app = Fastify({ logger: { level: 'info' } });
await app.register(cookie);
await app.register(authRoutes);
await app.register(serverRoutes);
await app.register(mapRoutes);
await app.register(teamRoutes);
await app.register(tournamentRoutes);
await app.register(arenaproRoutes);

app.get('/api/health', async () => ({ ok: true }));

// В продакшене отдаём собранный фронтенд из web/dist.
const webDist = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'web', 'dist');
if (existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Не найдено' });
    return reply.sendFile('index.html');
  });
}

await ensureAdmin();
await app.listen({ port: config.port, host: config.host });
startDispatchTimer();
void dispatchAll();
