import { db } from './db.js';

// Стандартный пул CS2 (карты есть в установке игры). Остальные официальные и Workshop-карты добавляются вручную.
export const DEFAULT_MAPS: { file: string; name: string }[] = [
  { file: 'de_ancient', name: 'Ancient' },
  { file: 'de_anubis', name: 'Anubis' },
  { file: 'de_dust2', name: 'Dust II' },
  { file: 'de_inferno', name: 'Inferno' },
  { file: 'de_mirage', name: 'Mirage' },
  { file: 'de_nuke', name: 'Nuke' },
  { file: 'de_overpass', name: 'Overpass' },
  { file: 'de_train', name: 'Train' },
  { file: 'de_vertigo', name: 'Vertigo' },
];

// Добавляет недостающие карты стандартного пула, существующие не трогает. Возвращает число добавленных.
export function addDefaultMaps(): number {
  const have = new Set((db.prepare('SELECT map_file FROM maps WHERE map_file IS NOT NULL').all() as unknown as { map_file: string }[])
    .map((r) => r.map_file));
  const ins = db.prepare('INSERT INTO maps (name, map_file) VALUES (?, ?)');
  let added = 0;
  for (const m of DEFAULT_MAPS) {
    if (have.has(m.file)) continue;
    ins.run(m.name, m.file);
    added++;
  }
  return added;
}

// При самом первом запуске библиотека карт не пустая
export function seedDefaultMapsIfEmpty(): void {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM maps').get() as { n: number };
  if (n === 0) addDefaultMaps();
}
