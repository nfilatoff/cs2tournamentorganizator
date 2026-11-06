// Простые английские слова для подтверждения опасных действий: их легко прочитать и набрать на любой раскладке
const WORDS = [
  'apple', 'river', 'green', 'house', 'cloud', 'stone', 'bread', 'light', 'music', 'chair',
  'table', 'water', 'smile', 'plant', 'horse', 'beach', 'train', 'world', 'paper', 'tiger',
  'lemon', 'piano', 'ocean', 'storm', 'glass', 'sugar', 'pizza', 'robot', 'money', 'clock',
];

export const randomWord = (): string => WORDS[Math.floor(Math.random() * WORDS.length)]!;
