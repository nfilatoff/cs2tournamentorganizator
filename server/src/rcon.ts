import net from 'node:net';
import { AppError } from './errors.js';

// Клиент Source RCON (TCP). Подходит для CS2.
const AUTH = 3;
const AUTH_RESPONSE = 2;
const EXEC = 2;

function packet(id: number, type: number, body: string): Buffer {
  const b = Buffer.from(body, 'utf8');
  const buf = Buffer.alloc(14 + b.length);
  buf.writeInt32LE(10 + b.length, 0);
  buf.writeInt32LE(id, 4);
  buf.writeInt32LE(type, 8);
  b.copy(buf, 12);
  return buf;
}

interface Packet { id: number; type: number; body: string }

export class Rcon {
  private buffer = Buffer.alloc(0);
  private waiters: ((p: Packet) => void)[] = [];
  private queue: Packet[] = [];
  private nextId = 10;
  private failure: Error | null = null;

  private constructor(private socket: net.Socket) {
    socket.on('data', (d: Buffer) => this.onData(d));
    socket.on('error', (e) => this.fail(e));
    socket.on('close', () => this.fail(new AppError('rconClosed')));
  }

  static async connect(host: string, port: number, password: string, timeoutMs = 5000): Promise<Rcon> {
    const socket = await new Promise<net.Socket>((resolve, reject) => {
      const s = net.connect({ host, port });
      const timer = setTimeout(() => { s.destroy(); reject(new AppError('rconConnectTimeout')); }, timeoutMs);
      s.once('connect', () => { clearTimeout(timer); resolve(s); });
      s.once('error', (e) => { clearTimeout(timer); reject(e); });
    });
    const rcon = new Rcon(socket);
    socket.write(packet(1, AUTH, password));
    // Сервер может прислать пустой RESPONSE перед AUTH_RESPONSE
    for (;;) {
      const p = await rcon.read(timeoutMs);
      if (p.type !== AUTH_RESPONSE) continue;
      if (p.id === -1) { rcon.close(); throw new AppError('rconBadPassword'); }
      break;
    }
    return rcon;
  }

  private fail(e: Error): void {
    if (this.failure) return;
    this.failure = e;
    const w = this.waiters.splice(0);
    // Будим ожидающих пустым пакетом; read() увидит failure
    w.forEach((fn) => fn({ id: -2, type: -1, body: '' }));
  }

  private onData(d: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, d]);
    while (this.buffer.length >= 4) {
      const size = this.buffer.readInt32LE(0);
      if (this.buffer.length < 4 + size) break;
      const id = this.buffer.readInt32LE(4);
      const type = this.buffer.readInt32LE(8);
      const body = this.buffer.subarray(12, 4 + size - 2).toString('utf8');
      this.buffer = this.buffer.subarray(4 + size);
      const p = { id, type, body };
      const w = this.waiters.shift();
      if (w) w(p); else this.queue.push(p);
    }
  }

  private read(timeoutMs: number): Promise<Packet> {
    return new Promise((resolve, reject) => {
      const take = (p: Packet) => {
        clearTimeout(timer);
        if (this.failure) reject(this.failure); else resolve(p);
      };
      const q = this.queue.shift();
      if (q) return resolve(q);
      if (this.failure) return reject(this.failure);
      const timer = setTimeout(() => {
        this.waiters = this.waiters.filter((x) => x !== take);
        reject(new AppError('rconTimeout'));
      }, timeoutMs);
      this.waiters.push(take);
    });
  }

  // Выполняет команду и собирает ответ. CS2 не поддерживает маркерный пакет, поэтому
  // ответ считается полным, когда данные перестали приходить на idleMs.
  async exec(command: string, opts: { firstWaitMs?: number; idleMs?: number } = {}): Promise<string> {
    const { firstWaitMs = 1000, idleMs = 200 } = opts;
    const id = this.nextId++;
    this.socket.write(packet(id, EXEC, command));
    let out = '';
    let wait = firstWaitMs;
    for (;;) {
      let p: Packet;
      try {
        p = await this.read(wait);
      } catch (e) {
        if (e instanceof AppError && e.code === 'rconTimeout') return out;
        throw e;
      }
      if (p.id === id) {
        out += p.body;
        wait = idleMs;
      }
    }
  }

  close(): void {
    this.socket.destroy();
  }
}
