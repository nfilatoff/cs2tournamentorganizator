import type { Key } from './i18n';

type T = (key: Key, params?: Record<string, string | number>) => string;

// Название раунда по сетке и номеру с конца (1 = финал сетки)
export function roundLabel(t: T, bracket: 'W' | 'L' | 'GF', fromEnd: number, format: 'single' | 'double'): string {
  if (bracket === 'GF') return t('round.gf');
  if (bracket === 'W') {
    const set = format === 'double' ? 'upper' : 'single';
    if (fromEnd === 1) return t(`round.${set}.1` as Key);
    if (fromEnd === 2) return t(`round.${set}.2` as Key);
    if (fromEnd === 3) return t(`round.${set}.3` as Key);
    return t(`round.${set}.n` as Key, { n: fromEnd });
  }
  if (fromEnd === 1) return t('round.lower.1');
  if (fromEnd === 2) return t('round.lower.2');
  return t('round.lower.n', { n: fromEnd });
}
