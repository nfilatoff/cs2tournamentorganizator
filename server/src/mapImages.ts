import type { FastifyInstance } from 'fastify';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';

// Превью официальных карт CS2. Скачиваются один раз и хранятся рядом с базой, чтобы работать и без интернета.
const UPSTREAM = 'https://raw.githubusercontent.com/ghostcap-gaming/cs2-map-images/main/cs2';
const cacheDir = join(config.dataDir, 'map-images');
const FILE_RE = /^[a-z0-9_]+$/i;

// Ссылка на картинку карты: своя (Workshop) или превью официальной карты по имени файла.
export function mapImageUrl(r: { image_url: string | null; map_file: string | null }): string | null {
  if (r.image_url) return r.image_url;
  return r.map_file && FILE_RE.test(r.map_file) ? `/api/map-images/${r.map_file.toLowerCase()}` : null;
}

const pretty = (file: string) => file.replace(/^[a-z]+_/i, '').replace(/_/g, ' ').toUpperCase();

// Заглушка, если превью нет: название карты на градиенте, цвет зависит от имени
function placeholder(file: string): string {
  let h = 0;
  for (const c of file) h = (h * 31 + c.charCodeAt(0)) % 360;
  const name = pretty(file).replace(/[<>&"]/g, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">`
    + `<stop offset="0" stop-color="hsl(${h},45%,32%)"/><stop offset="1" stop-color="hsl(${(h + 40) % 360},40%,14%)"/></linearGradient></defs>`
    + `<rect width="640" height="360" fill="url(#g)"/><text x="320" y="200" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" `
    + `font-size="64" font-weight="700" fill="#fff" fill-opacity=".9">${name}</text></svg>`;
}

// Одновременные запросы одной карты ждут одну загрузку
const pending = new Map<string, Promise<Buffer | null>>();
// После неудачи не пытаемся скачать заново каждую минуту
const failedAt = new Map<string, number>();
const RETRY_MS = 10 * 60_000;

async function download(file: string): Promise<Buffer | null> {
  if (Date.now() - (failedAt.get(file) ?? 0) < RETRY_MS) return null;
  try {
    const res = await fetch(`${UPSTREAM}/${file}.png`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok || !res.headers.get('content-type')?.startsWith('image/')) throw new Error(String(res.status));
    const buf = Buffer.from(await res.arrayBuffer());
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, `${file}.png`), buf);
    return buf;
  } catch {
    failedAt.set(file, Date.now());
    return null;
  }
}

export async function mapImageRoutes(app: FastifyInstance): Promise<void> {
  // Без авторизации: картинки видят игроки на странице вето и гости
  app.get<{ Params: { file: string } }>('/api/map-images/:file', async (req, reply) => {
    const file = req.params.file.toLowerCase();
    if (!FILE_RE.test(file)) return reply.code(404).send();
    const cached = join(cacheDir, `${file}.png`);
    let buf: Buffer | null = existsSync(cached) ? readFileSync(cached) : null;
    if (!buf) {
      let p = pending.get(file);
      if (!p) {
        p = download(file).finally(() => pending.delete(file));
        pending.set(file, p);
      }
      buf = await p;
    }
    if (buf) return reply.header('cache-control', 'public, max-age=604800').type('image/png').send(buf);
    return reply.header('cache-control', 'public, max-age=600').type('image/svg+xml').send(placeholder(file));
  });
}
