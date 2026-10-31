// Переименование MatchZy -> ArenaPro во всём репозитории (git-tracked файлы).
// Сохраняет ссылки на оригинальный репозиторий автора и файл LICENSE.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const repo = process.argv[2];
const dry = process.argv[3] === '--dry';
const git = (...a) => execFileSync('git', a, { cwd: repo, encoding: 'utf8', maxBuffer: 1 << 28 });

const files = git('ls-files', '-z').split('\0').filter(Boolean);
const SKIP_CONTENT = new Set(['LICENSE']);

// URL, содержащие shobhit-pathak, не трогаем (ссылки на оригинал, картинки, документация)
const urlRe = /https?:\/\/[^\s)"'>\]`]*shobhit-pathak[^\s)"'>\]`]*/gi;
// Строка с авторством в коде тоже не трогаем
const keepRe = /MatchZy by WD-/g;

const rename = (s) =>
  s.replace(/MATCHZY/g, 'ARENAPRO')
    .replace(/MatchZy/g, 'ArenaPro')
    .replace(/matchZy/g, 'arenaPro')
    .replace(/matchzy/g, 'arenapro')
    .replace(/Matchzy/g, 'Arenapro');

let changedFiles = 0;
let replaced = 0;

for (const f of files) {
  const abs = join(repo, f);
  let buf;
  try { buf = readFileSync(abs); } catch { continue; }
  if (buf.includes(0)) continue; // бинарный
  if (SKIP_CONTENT.has(f)) continue;

  const bom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  const text = buf.subarray(bom ? 3 : 0).toString('utf8');
  if (!/matchzy/i.test(text)) continue;

  const kept = [];
  let t = text.replace(urlRe, (m) => { kept.push(m); return `\u0000K${kept.length - 1}\u0000`; });
  t = t.replace(keepRe, (m) => { kept.push(m); return `\u0000K${kept.length - 1}\u0000`; });
  const out = rename(t).replace(/\u0000K(\d+)\u0000/g, (_, i) => kept[Number(i)]);
  if (out === text) continue;

  replaced += (text.match(/matchzy/gi) ?? []).length - (out.match(/matchzy/gi) ?? []).length;
  changedFiles++;
  if (!dry) writeFileSync(abs, Buffer.concat([bom ? Buffer.from([0xef, 0xbb, 0xbf]) : Buffer.alloc(0), Buffer.from(out, 'utf8')]));
}

// Переименование файлов и папок (по компонентам пути)
const moves = [];
for (const f of files) {
  const nf = rename(f);
  if (nf !== f) moves.push([f, nf]);
}
if (!dry) {
  for (const [from, to] of moves) {
    mkdirSync(join(repo, dirname(to)), { recursive: true });
    git('mv', '-k', from, to);
  }
}
console.log(JSON.stringify({ dry, changedFiles, replaced, moves: moves.length }));
for (const [a, b] of moves.slice(0, 40)) console.log(`  ${a} -> ${b}`);
