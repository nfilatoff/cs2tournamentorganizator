// Ошибки API передаются кодами, а текст на нужном языке подставляет интерфейс (web/src/locales).
export type ErrorParams = Record<string, string | number | ErrorBody>;

export interface ErrorBody {
  error: string;
  params?: ErrorParams;
}

export class AppError extends Error {
  constructor(public code: string, public params?: ErrorParams) {
    super(code);
  }
}

export const E = (code: string, params?: ErrorParams): ErrorBody => ({ error: code, params });

export function errBody(e: unknown): ErrorBody {
  if (e instanceof AppError) return E(e.code, e.params);
  return E('internal', { message: e instanceof Error ? e.message : String(e) });
}

// Для сохранения в БД (заметки к матчу и т. п.)
export const encode = (b: ErrorBody): string => JSON.stringify(b);

export function decode(s: string | null): ErrorBody | null {
  if (!s) return null;
  try {
    const v = JSON.parse(s) as ErrorBody;
    if (typeof v.error === 'string') return v;
  } catch {
    // старое текстовое значение
  }
  return E('internal', { message: s });
}
