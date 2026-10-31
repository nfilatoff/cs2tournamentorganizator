// Отладочный инструмент: npx tsx scripts/rcon-cli.ts <host> <port> <password> "<команда>" ["<команда>" ...]
import { Rcon } from '../src/rcon.js';

const [host, port, password, ...commands] = process.argv.slice(2);
if (!host || !port || !password || commands.length === 0) {
  console.error('Использование: rcon-cli <host> <port> <password> "<команда>" ...');
  process.exit(2);
}

const rcon = await Rcon.connect(host, Number(port), password);
for (const c of commands) {
  console.log(`> ${c}`);
  console.log((await rcon.exec(c)).trimEnd() || '(пустой ответ)');
}
rcon.close();
