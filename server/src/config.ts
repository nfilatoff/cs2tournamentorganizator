import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { isAutoHost, lanAddress } from './network.js';

const dataDir = resolve(process.env.DATA_DIR ?? './data');
mkdirSync(dataDir, { recursive: true });

const port = Number(process.env.PORT ?? 3000);
// Задаётся, только если адрес нужно закрепить (например, имя хоста вместо IP). Иначе определяется сам.
const fixedUrl = process.env.PUBLIC_URL?.trim().replace(/\/$/, '') || null;

export const config = {
  port,
  host: process.env.HOST ?? '0.0.0.0',
  dataDir,
  fixedUrl,
  // Адрес, по которому панель открывается из LAN, например http://192.168.1.10:3000
  get publicUrl(): string {
    return fixedUrl ?? `http://${lanAddress()}:${port}`;
  },
  sessionTtlMs: 1000 * 60 * 60 * 24 * 7,
};

// Адрес панели для игрового сервера: сервер на этом же компьютере ходит через 127.0.0.1, так ему не важен LAN-адрес
export function panelUrlFor(serverHost: string): string {
  return isAutoHost(serverHost) ? `http://127.0.0.1:${port}` : config.publicUrl;
}
