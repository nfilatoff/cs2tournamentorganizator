import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ru } from './locales/ru';
import { en } from './locales/en';
import { es } from './locales/es';

export type Lang = 'ru' | 'en' | 'es';
export type Key = keyof typeof ru;
type Params = Record<string, string | number>;

const dicts: Record<Lang, Record<Key, string>> = { ru, en, es };

export const LANGS: { id: Lang; label: string }[] = [
  { id: 'ru', label: 'Русский' },
  { id: 'en', label: 'English' },
  { id: 'es', label: 'Español' },
];

const STORAGE_KEY = 'lang';

function detect(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'ru' || saved === 'en' || saved === 'es') return saved;
  } catch {
    // localStorage недоступен: берём язык браузера
  }
  // Язык системы доходит до страницы через список языков браузера (по умолчанию он совпадает с языком Windows).
  // Берём первый из них, который мы поддерживаем; иначе английский.
  const preferred = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const l of preferred) {
    const code = (l || '').slice(0, 2).toLowerCase();
    if (code === 'ru' || code === 'es' || code === 'en') return code;
  }
  return 'en';
}

const fill = (s: string, p?: Params) => (p ? s.replace(/\{(\w+)\}/g, (_, k: string) => String(p[k] ?? '')) : s);

// Тело ошибки API: код и параметры (значения-параметры могут быть вложенными ошибками)
export interface ErrorLike { error: string; params?: Record<string, unknown> }

export const isErrorLike = (v: unknown): v is ErrorLike =>
  typeof v === 'object' && v !== null && typeof (v as ErrorLike).error === 'string';

interface I18n {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: Key, params?: Params) => string;
  // Текст ошибки на текущем языке: ApiError, тело ошибки, строка JSON из БД или обычная ошибка
  err: (e: unknown) => string;
}

const Ctx = createContext<I18n | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(detect);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      // не критично
    }
    document.documentElement.lang = l;
  }, []);

  const value = useMemo<I18n>(() => {
    const dict = dicts[lang];
    const t = (key: Key, params?: Params) => fill(dict[key] ?? ru[key] ?? key, params);

    const fmtError = (b: ErrorLike): string => {
      const key = `e.${b.error}` as Key;
      const params: Params = {};
      for (const [k, v] of Object.entries(b.params ?? {})) {
        params[k] = isErrorLike(v) ? fmtError(v) : (v as string | number);
      }
      if (!(key in dict)) return fill(dict['e.internal'], { message: String(params.message ?? b.error) });
      return fill(dict[key], params);
    };

    const err = (e: unknown): string => {
      if (typeof e === 'string') {
        try {
          const parsed: unknown = JSON.parse(e);
          if (isErrorLike(parsed)) return fmtError(parsed);
        } catch {
          // обычная строка
        }
        return e;
      }
      if (e instanceof Error && 'code' in e && typeof (e as { code: unknown }).code === 'string') {
        const a = e as Error & { code: string; params?: Record<string, unknown> };
        return fmtError({ error: a.code, params: a.params });
      }
      if (isErrorLike(e)) return fmtError(e);
      return e instanceof Error ? e.message : String(e);
    };

    return { lang, setLang, t, err };
  }, [lang, setLang]);

  // Название вкладки и язык документа следуют выбранному языку
  useEffect(() => {
    document.title = value.t('app.brand');
    document.documentElement.lang = lang;
  }, [value, lang]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error('I18nProvider отсутствует');
  return v;
}
