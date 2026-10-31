import { createSocket } from 'node:dgram';
import { networkInterfaces } from 'node:os';

// Адрес этого компьютера в локальной сети определяется сам: его не нужно назначать вручную, и смена IP
// (DHCP, другой роутер) подхватывается без перезапуска.

// Сервер CS2 на этом же компьютере: игрокам показывается текущий LAN-адрес, а панель говорит с ним по тому же LAN-адресу (сервер запускается с -ip этого адреса)
export const AUTO_HOST = 'auto';
export const isAutoHost = (host: string) => host.trim().toLowerCase() === AUTO_HOST;

// Виртуальные адаптеры (Hyper-V, WSL, VPN), которые не годятся для игроков в клубе
const VIRTUAL = /vEthernet|VirtualBox|VMware|Hyper-V|WSL|Loopback|Tailscale|ZeroTier|Radmin|Hamachi|TAP|WireGuard|OpenVPN|Docker/i;

const isPrivate = (ip: string) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
const usable = (ip: string) => !/^(127\.|169\.254\.|0\.)/.test(ip);

// Адрес, с которого уходит трафик по маршруту по умолчанию. UDP connect ничего не отправляет,
// он только выбирает интерфейс по таблице маршрутов Windows.
function routeAddress(): Promise<string | null> {
  return new Promise((resolve) => {
    const s = createSocket('udp4');
    const done = (ip: string | null) => { try { s.close(); } catch { /* уже закрыт */ } resolve(ip); };
    s.once('error', () => done(null));
    try {
      s.connect(53, '1.1.1.1', () => {
        try { done(s.address().address); } catch { done(null); }
      });
    } catch {
      done(null);
    }
  });
}

// Запасной вариант без маршрута по умолчанию: первый частный адрес физического адаптера
function interfaceAddress(): string | null {
  const list = Object.entries(networkInterfaces()).flatMap(([name, addrs]) =>
    (addrs ?? []).filter((a) => a.family === 'IPv4' && !a.internal && usable(a.address)).map((a) => ({ name, ip: a.address })));
  const rank = (x: { name: string; ip: string }) => (VIRTUAL.test(x.name) ? 2 : 0) + (isPrivate(x.ip) ? 0 : 1);
  return list.sort((a, b) => rank(a) - rank(b))[0]?.ip ?? null;
}

export async function detectLanAddress(): Promise<string> {
  const viaRoute = await routeAddress();
  if (viaRoute && usable(viaRoute)) return viaRoute;
  return interfaceAddress() ?? '127.0.0.1';
}

let current = '127.0.0.1';

export function lanAddress(): string {
  return current;
}

// Что показывать игрокам для подключения
export function publicHost(host: string): string {
  return isAutoHost(host) ? current : host;
}

// Куда подключается сама панель (RCON)
export function rconHost(host: string): string {
  return isAutoHost(host) ? current : host;
}

export async function startNetworkWatch(onChange?: (ip: string) => void): Promise<void> {
  current = await detectLanAddress();
  setInterval(() => {
    void detectLanAddress().then((ip) => {
      if (ip === current) return;
      current = ip;
      onChange?.(ip);
    });
  }, 30_000).unref();
}
