import { randomInt } from 'node:crypto';

// Без похожих символов (0/O, 1/I/L): код читают с экрана и вводят в консоли игры
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function newAdminCode(length = 6): string {
  return Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
}
