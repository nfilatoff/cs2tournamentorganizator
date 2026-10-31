import { config } from './config.js';

const OPENID_ENDPOINT = 'https://steamcommunity.com/openid/login';
const OPENID_NS = 'http://specs.openid.net/auth/2.0';
const RETURN_TO = (origin: string) => `${origin}/api/auth/steam/callback`;

// Адрес сайта, по которому игрок его открыл: Steam вернёт его туда же. Закреплённый PUBLIC_URL важнее.
export function siteOrigin(req: { protocol: string; headers: { host?: string } }): string {
  if (config.fixedUrl) return config.fixedUrl;
  const host = req.headers.host ?? '';
  return /^[a-z0-9.-]+(:\d{1,5})?$/i.test(host) ? `${req.protocol}://${host}` : config.publicUrl;
}

export function steamLoginUrl(origin: string): string {
  const params = new URLSearchParams({
    'openid.ns': OPENID_NS,
    'openid.mode': 'checkid_setup',
    'openid.return_to': RETURN_TO(origin),
    'openid.realm': origin,
    'openid.identity': `${OPENID_NS}/identifier_select`,
    'openid.claimed_id': `${OPENID_NS}/identifier_select`,
  });
  return `${OPENID_ENDPOINT}?${params}`;
}

// Проверяет ответ Steam и возвращает SteamID64 или null.
export async function verifySteamCallback(query: Record<string, string>, origin: string): Promise<string | null> {
  const claimed = query['openid.claimed_id'] ?? '';
  const match = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/.exec(claimed);
  if (!match) return null;
  if (query['openid.return_to'] !== RETURN_TO(origin)) return null;

  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (k.startsWith('openid.')) body.set(k, v);
  body.set('openid.mode', 'check_authentication');

  const res = await fetch(OPENID_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await res.text();
  return /is_valid\s*:\s*true/.test(text) ? match[1]! : null;
}

// Публичный XML-профиль: без API-ключа, достаточно для ника и аватара.
export async function fetchSteamProfile(steamId: string): Promise<{ name: string; avatar: string | null; ok: boolean }> {
  const fallback = { name: `Player ${steamId.slice(-6)}`, avatar: null, ok: false };
  try {
    const res = await fetch(`https://steamcommunity.com/profiles/${steamId}?xml=1`);
    const xml = await res.text();
    const name = /<steamID><!\[CDATA\[(.*?)\]\]><\/steamID>/s.exec(xml)?.[1];
    const avatar = /<avatarMedium><!\[CDATA\[(.*?)\]\]><\/avatarMedium>/s.exec(xml)?.[1];
    return { name: name ?? fallback.name, avatar: avatar ?? null, ok: !!name };
  } catch {
    return fallback;
  }
}

// Название и превью Workshop-карты через публичный API (ключ не нужен).
export async function fetchWorkshopItem(id: string): Promise<{ title: string; preview: string | null } | null> {
  try {
    const res = await fetch('https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ itemcount: '1', 'publishedfileids[0]': id }),
    });
    const json = (await res.json()) as {
      response?: { publishedfiledetails?: { result: number; title?: string; preview_url?: string }[] };
    };
    const d = json.response?.publishedfiledetails?.[0];
    if (!d || d.result !== 1 || !d.title) return null;
    return { title: d.title.replace(/\s+/g, ' ').trim(), preview: d.preview_url ?? null };
  } catch {
    return null;
  }
}

// Принимает ссылку Steam Workshop или просто числовой ID.
export function parseWorkshopId(input: string): string | null {
  const s = input.trim();
  if (/^\d{5,}$/.test(s)) return s;
  const m = /[?&]id=(\d+)/.exec(s);
  return m ? m[1]! : null;
}
