export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? 'GET',
    headers: init?.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? 'Ошибка запроса');
  return data as T;
}

export type Me =
  | { kind: null }
  | { kind: 'admin'; username: string }
  | { kind: 'player'; id: number; steamId: string; name: string; avatarUrl: string | null };

export interface GameServer { id: number; name: string; host: string; port: number }
export interface MapItem {
  id: number;
  name: string;
  workshopId: string | null;
  mapFile: string | null;
  imageUrl: string | null;
}
