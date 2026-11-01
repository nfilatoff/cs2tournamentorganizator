import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readSync, renameSync, fstatSync, writeFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { join, resolve } from 'node:path';
import { db, getSetting } from './db.js';
import { AUTO_HOST, isAutoHost, lanAddress } from './network.js';
import { AppError } from './errors.js';
import { getServer, withRcon, type ServerRow } from './dispatcher.js';
import { onServerFreed } from './tournamentStore.js';

// Запуск процессов CS2 на компьютере с панелью. Серверы с флагом managed панель запускает сама:
// пишет для каждого свой cfg в game/csgo/cfg/tournament-panel и стартует cs2.exe в отдельном окне.

export const GAME_MODES = {
  competitive: { type: 0, mode: 1 },
  wingman: { type: 0, mode: 2 },
  casual: { type: 0, mode: 0 },
  deathmatch: { type: 1, mode: 2 },
} as const;
export type GameMode = keyof typeof GAME_MODES;

export interface ManagedRow extends ServerRow {
  managed: number; start_map: string; game_mode: GameMode; max_players: number; hostname: string | null;
  sv_password: string | null; lan: number; gslt: string | null; tv_enable: number; tv_port: number | null;
  autostart: number; extra_cfg: string | null; auto_started: number;
}

const CFG_DIR = 'tournament-panel';

// Папка с установленным CS2 (в ней game\bin\win64\cs2.exe)
function candidates(): string[] {
  const list = [getSetting('cs2_path'), process.env.CS2_PATH].filter((x): x is string => !!x);
  // Установщик кладёт панель в <папка>\panel, а сервер в <папка>\cs2; npm -w server запускается из panel\server
  list.push(resolve(process.cwd(), '..', 'cs2'), resolve(process.cwd(), '..', '..', 'cs2'));
  return list;
}

export function exeIn(root: string): string {
  return process.platform === 'win32'
    ? join(root, 'game', 'bin', 'win64', 'cs2.exe')
    : join(root, 'game', 'bin', 'linuxsteamrt64', 'cs2');
}

export function cs2Root(): string | null {
  return candidates().find((root) => existsSync(exeIn(root))) ?? null;
}

// Значения в cfg и командной строке: без кавычек, точек с запятой и переводов строк
const SAFE = /^[^"';\r\n]*$/;
const safe = (s: string) => SAFE.test(s);

export function tvPortOf(s: ManagedRow): number {
  return s.tv_port ?? s.port + 100;
}

function cfgText(s: ManagedRow): string {
  if (!safe(s.rcon_password) || /\s/.test(s.rcon_password)) throw new AppError('badCfgValue', { field: 'rcon' });
  const lines = [
    '// Создано панелью турниров. Меняйте настройки в разделе «Серверы», а не в этом файле.',
    // Этот файл заменяет server.cfg (servercfgfile), поэтому общий server.cfg выполняется отсюда
    'execifexists server.cfg',
    `hostname "${s.hostname || s.name}"`,
    `rcon_password "${s.rcon_password}"`,
    `sv_password "${s.sv_password ?? ''}"`,
    `sv_lan ${s.lan ? 1 : 0}`,
    `tv_enable ${s.tv_enable ? 1 : 0}`,
  ];
  if (s.extra_cfg) lines.push('', '// Дополнительные настройки', ...s.extra_cfg.split(/\r?\n/).filter((l) => l.trim()));
  return lines.join('\r\n') + '\r\n';
}

function cfgName(id: number): string {
  return `${CFG_DIR}/server-${id}.cfg`;
}

// Перезаписывает cfg сервера. Возвращает путь для exec.
export function writeCfg(root: string, s: ManagedRow): string {
  const dir = join(root, 'game', 'csgo', 'cfg', CFG_DIR);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `server-${s.id}.cfg`), cfgText(s), 'utf8');
  return cfgName(s.id);
}

// Стартовая карта: имя файла стандартной карты или workshop:<id>
export function mapArgs(startMap: string): string[] {
  const ws = /^workshop:(\d+)$/.exec(startMap);
  return ws ? ['+host_workshop_map', ws[1]!] : ['+map', startMap];
}

function launchArgs(s: ManagedRow, cfg: string): string[] {
  const gm = GAME_MODES[s.game_mode] ?? GAME_MODES.competitive;
  const args = ['-dedicated', '-console', '-condebug', '-usercon', '-insecure', '-port', String(s.port), '-maxplayers', String(s.max_players)];
  // Без -ip CS2 сам выбирает один адаптер для RCON (часто VPN), поэтому адрес закрепляем: для auto это LAN-адрес
  // компьютера, к которому панель потом и подключается (rconHost)
  const bind = isAutoHost(s.host) ? lanAddress() : s.host;
  if (isIP(bind) === 4 && !bind.startsWith('127.')) args.push('-ip', bind);
  if (s.tv_enable) args.push('+tv_port', String(tvPortOf(s)));
  if (s.gslt) args.push('+sv_setsteamaccount', s.gslt);
  // servercfgfile: CS2 выполняет cfg сервера при каждой загрузке карты после конфига режима (gamemode_*.cfg),
  // иначе режим перебивает дополнительные настройки (например, ботов и mp_teammates_are_enemies в бою насмерть)
  args.push('+game_type', String(gm.type), '+game_mode', String(gm.mode), '+servercfgfile', cfg, '+exec', cfg, ...mapArgs(s.start_map));
  return args;
}

function logPath(id: number): string | null {
  const root = cs2Root();
  return root ? join(root, 'panel-logs', `server-${id}.log`) : null;
}

// Лог текущего запуска перезаписывается, предыдущий остаётся в .old
function openLog(id: number): number {
  const file = logPath(id)!;
  mkdirSync(join(file, '..'), { recursive: true });
  if (existsSync(file)) {
    try { renameSync(file, `${file}.old`); } catch { /* занят: дописываем в него */ }
  }
  return openSync(file, 'a');
}

// Последние строки вывода сервера
export function readServerLog(id: number, maxBytes = 96 * 1024): string {
  const file = logPath(id);
  if (!file || !existsSync(file)) return '';
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    const len = Math.min(size, maxBytes);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    const text = buf.toString('utf8');
    // Обрезанная первая строка не показывается
    return len < size ? text.slice(text.indexOf('\n') + 1) : text;
  } finally {
    closeSync(fd);
  }
}

interface Proc { child: ChildProcess; startedAt: number }
const procs = new Map<number, Proc>();
const lastExit = new Map<number, { code: number | null; at: number }>();

export function getManaged(id: number): ManagedRow | undefined {
  return db.prepare('SELECT * FROM game_servers WHERE id = ?').get(id) as unknown as ManagedRow | undefined;
}

export async function rconAlive(s: ServerRow): Promise<boolean> {
  try {
    await withRcon(s, (r) => r.exec('echo ping'));
    return true;
  } catch (e) {
    // Неверный пароль: на порту уже работает другой сервер
    return e instanceof AppError && e.code === 'rconBadPassword';
  }
}

export function processInfo(id: number): { running: boolean; pid: number | null; startedAt: number | null; lastExit: { code: number | null; at: number } | null } {
  const p = procs.get(id);
  return { running: !!p, pid: p?.child.pid ?? null, startedAt: p?.startedAt ?? null, lastExit: lastExit.get(id) ?? null };
}

function busyMatch(id: number): boolean {
  return !!db.prepare('SELECT 1 FROM matches WHERE server_id = ?').get(id);
}

// auto: сервер запускает панель под матч (после матча он выключается); иначе его запустил админ и он работает, пока тот не остановит
export async function startServer(id: number, auto = false): Promise<void> {
  const s = getManaged(id);
  if (!s) throw new AppError('serverNotFound');
  if (!s.managed) throw new AppError('serverNotManaged');
  if (procs.has(id)) throw new AppError('serverAlreadyRunning');
  const root = cs2Root();
  if (!root) throw new AppError('cs2NotFound');
  // Процесс мог быть запущен вручную или до перезапуска панели
  if (await rconAlive(s)) throw new AppError('serverAlreadyRunning');

  const cfg = writeCfg(root, s);
  const args = launchArgs(s, cfg);
  // Окно cs2.exe остаётся пустым, поэтому вывод сервера (в том числе строки плагина) пишется в файл, его показывает панель
  const logFd = openLog(id);
  let child: ChildProcess;
  try {
    child = spawn(exeIn(root), args, { cwd: root, detached: true, stdio: ['ignore', logFd, logFd] });
  } finally {
    closeSync(logFd);
  }
  await new Promise<void>((ok, fail) => {
    child.once('spawn', ok);
    child.once('error', (e) => fail(new AppError('serverStartFailed', { message: e.message })));
  });
  child.unref();
  procs.set(id, { child, startedAt: Date.now() });
  lastExit.delete(id);
  child.once('exit', (code) => {
    if (procs.get(id)?.child === child) procs.delete(id);
    lastExit.set(id, { code, at: Date.now() });
  });
  db.prepare('UPDATE game_servers SET cooldown_until = 0, last_error = NULL, auto_started = ? WHERE id = ?').run(auto ? 1 : 0, id);
}

// Для матча: если сервер панели не запущен, запускает его и ждёт, пока он начнёт отвечать по RCON
export async function ensureRunning(id: number): Promise<void> {
  const s = getManaged(id);
  if (!s || !s.managed) return;
  if (await rconAlive(s)) return;
  if (!procs.has(id)) await startServer(id, true);
  for (let i = 0; i < 60; i++) {
    await sleep(2000);
    if (await rconAlive(s)) return;
  }
  throw new AppError('serverNoConfirm');
}

// Сервер, который запускала панель под матч, выключается, когда ему больше не назначен матч
async function stopIfIdleAuto(id: number): Promise<void> {
  const s = getManaged(id);
  if (!s || !s.managed || !s.auto_started || busyMatch(id)) return;
  try {
    await stopServer(id, true);
  } catch {
    // уже выключен или недоступен
  }
  db.prepare('UPDATE game_servers SET auto_started = 0 WHERE id = ? AND NOT EXISTS (SELECT 1 FROM matches WHERE server_id = ?)').run(id, id);
}

// Пауза, чтобы игроки успели увидеть итог; повторная проверка защищает сервер, на который сразу назначили следующий матч
const STOP_DELAY_MS = 10_000;
onServerFreed((id) => { setTimeout(() => { void stopIfIdleAuto(id); }, STOP_DELAY_MS).unref(); });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function stopServer(id: number, force = false): Promise<void> {
  const s = getManaged(id);
  if (!s) throw new AppError('serverNotFound');
  if (!force && busyMatch(id)) throw new AppError('serverBusy');
  const p = procs.get(id);
  let rconError: unknown = null;
  try {
    await withRcon(s, (r) => r.exec('quit'));
  } catch (e) {
    // RCON недоступен: остаётся только завершить процесс, если он наш
    rconError = e;
  }
  if (!p) {
    if (rconError instanceof AppError && rconError.code === 'rconBadPassword') throw rconError;
    if (rconError) throw new AppError('serverNotRunning');
    return;
  }
  for (let i = 0; i < 20 && procs.has(id); i++) await sleep(500);
  if (procs.get(id) === p) {
    if (process.platform === 'win32' && p.child.pid) {
      // Убиваем всё дерево: cmd и запущенный им cs2.exe
      spawn('taskkill', ['/pid', String(p.child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).unref();
    } else {
      p.child.kill();
    }
    procs.delete(id);
  }
}

// Перечитать cfg на работающем сервере (если на нём нет матча)
export async function applyCfg(id: number): Promise<boolean> {
  const s = getManaged(id);
  const root = cs2Root();
  if (!s?.managed || !root) return false;
  const cfg = writeCfg(root, s);
  if (busyMatch(id)) return false;
  try {
    await withRcon(s, (r) => r.exec(`exec ${cfg}`));
    return true;
  } catch {
    return false;
  }
}

export async function changeMap(id: number, map: string): Promise<void> {
  const s = getServer(id);
  if (!s) throw new AppError('serverNotFound');
  if (busyMatch(id)) throw new AppError('serverBusy');
  const [cmd, arg] = mapArgs(map);
  await withRcon(s, (r) => r.exec(`${cmd!.slice(1)} ${arg}`));
}

// Адрес по умолчанию для нового сервера: этот компьютер (LAN-адрес определяется сам, см. network.ts)
export function defaultHost(): string {
  return AUTO_HOST;
}

export function nextPort(): number {
  const r = db.prepare('SELECT MAX(port) AS p FROM game_servers').get() as { p: number | null };
  return r.p ? r.p + 1 : 27015;
}

// Серверы с автозапуском стартуют вместе с панелью
export async function autostartServers(log: (msg: string) => void): Promise<void> {
  // Остались от прошлого запуска панели без матча: выключаем
  const leftovers = db.prepare('SELECT id FROM game_servers WHERE managed = 1 AND auto_started = 1').all() as unknown as { id: number }[];
  for (const r of leftovers) await stopIfIdleAuto(r.id);
  const rows = db.prepare('SELECT id, name FROM game_servers WHERE managed = 1 AND autostart = 1').all() as unknown as { id: number; name: string }[];
  for (const r of rows) {
    try {
      await startServer(r.id);
      log(`CS2 server started: ${r.name}`);
    } catch (e) {
      if (e instanceof AppError && e.code === 'serverAlreadyRunning') continue;
      log(`CS2 server ${r.name} not started: ${e instanceof AppError ? e.code : String(e)}`);
    }
  }
}
