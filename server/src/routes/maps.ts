import type { FastifyInstance } from 'fastify';
import { E } from '../errors.js';
import { z } from 'zod';
import { db } from '../db.js';
import { requireAdmin } from '../auth.js';
import { fetchWorkshopItem, parseWorkshopId } from '../steam.js';
import { addDefaultMaps } from '../defaultMaps.js';
import { mapImageUrl } from '../mapImages.js';

interface Row { id: number; name: string; workshop_id: string | null; map_file: string | null; image_url: string | null }

const toDto = (r: Row) => ({
  id: r.id,
  name: r.name,
  workshopId: r.workshop_id,
  mapFile: r.map_file,
  imageUrl: mapImageUrl(r),
});

const addBody = z.union([
  // Workshop-карта: ссылка или ID. Название можно не указывать, оно подтянется из Steam.
  z.object({ workshop: z.string().min(1), name: z.string().trim().min(1).max(80).optional() }),
  // Стандартная карта: de_inferno и т.п.
  z.object({ mapFile: z.string().trim().regex(/^[a-z0-9_]+$/i), name: z.string().trim().min(1).max(80) }),
]);

export async function mapRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAdmin);

  app.get('/api/maps', async () => {
    const rows = db.prepare('SELECT * FROM maps ORDER BY name').all() as unknown as Row[];
    return rows.map(toDto);
  });

  app.post('/api/maps', async (req, reply) => {
    const body = addBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send(E('badMap'));

    let name: string;
    let workshopId: string | null = null;
    let mapFile: string | null = null;
    let imageUrl: string | null = null;

    if ('workshop' in body.data) {
      workshopId = parseWorkshopId(body.data.workshop);
      if (!workshopId) return reply.code(400).send(E('noWorkshopId'));
      const item = await fetchWorkshopItem(workshopId);
      name = (body.data.name ?? item?.title ?? `Workshop ${workshopId}`).trim();
      imageUrl = item?.preview ?? null;
    } else {
      mapFile = body.data.mapFile;
      name = body.data.name;
      if (db.prepare('SELECT 1 FROM maps WHERE map_file = ?').get(mapFile)) return reply.code(409).send(E('mapExists'));
    }

    try {
      const res = db.prepare('INSERT INTO maps (name, workshop_id, map_file, image_url) VALUES (?, ?, ?, ?)')
        .run(name, workshopId, mapFile, imageUrl);
      return reply.code(201).send(toDto({
        id: Number(res.lastInsertRowid), name, workshop_id: workshopId, map_file: mapFile, image_url: imageUrl,
      }));
    } catch {
      return reply.code(409).send(E('mapExists'));
    }
  });

  // Добавляет недостающие карты стандартного пула CS2
  app.post('/api/maps/defaults', async () => ({ added: addDefaultMaps() }));

  app.delete<{ Params: { id: string } }>('/api/maps/:id', async (req, reply) => {
    try {
      const res = db.prepare('DELETE FROM maps WHERE id = ?').run(Number(req.params.id));
      if (res.changes === 0) return reply.code(404).send(E('mapNotFound'));
    } catch {
      return reply.code(409).send(E('mapInPool'));
    }
    return { ok: true };
  });
}
