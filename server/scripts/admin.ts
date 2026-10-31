// Управление администраторами из терминала (если пароль забыт или нужен ещё один админ).
// Запуск из корня проекта:
//   npm run admin -- list
//   npm run admin -- set-password <новый пароль> [логин]
//   npm run admin -- set-username <старый логин> <новый логин>
//   npm run admin -- create <логин> <пароль>
// Остановите панель или запускайте команду с той же папкой данных (DATA_DIR), что и у панели.
import { db } from '../src/db.js';
import { hashPassword } from '../src/auth.js';

const [cmd, a, b] = process.argv.slice(2);
const admins = () => db.prepare('SELECT id, username FROM admins ORDER BY id').all() as unknown as { id: number; username: string }[];

function usage(): never {
  console.error('Команды: list | set-password <пароль> [логин] | set-username <старый> <новый> | create <логин> <пароль>');
  process.exit(2);
}

function checkPassword(p: string | undefined): string {
  if (!p || p.length < 8) {
    console.error('Пароль должен быть не короче 8 символов.');
    process.exit(1);
  }
  return p;
}

switch (cmd) {
  case 'list':
    for (const x of admins()) console.log(x.username);
    break;
  case 'set-password': {
    const password = checkPassword(a);
    const list = admins();
    const target = b ? list.find((x) => x.username === b) : list.length === 1 ? list[0] : undefined;
    if (!target) {
      console.error(b ? `Админ «${b}» не найден.` : 'Админов несколько: укажите логин третьим аргументом.');
      process.exit(1);
    }
    db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(await hashPassword(password), target.id);
    db.prepare("DELETE FROM sessions WHERE kind = 'admin' AND user_id = ?").run(target.id);
    console.log(`Пароль админа «${target.username}» изменён, все его сессии завершены.`);
    break;
  }
  case 'set-username': {
    if (!a || !b || b.length < 3) usage();
    try {
      const res = db.prepare('UPDATE admins SET username = ? WHERE username = ?').run(b, a);
      if (res.changes === 0) { console.error(`Админ «${a}» не найден.`); process.exit(1); }
    } catch {
      console.error(`Логин «${b}» уже занят.`);
      process.exit(1);
    }
    console.log(`Логин изменён: ${a} → ${b}`);
    break;
  }
  case 'create': {
    if (!a || a.length < 3) usage();
    const password = checkPassword(b);
    try {
      db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run(a, await hashPassword(password));
    } catch {
      console.error(`Админ «${a}» уже существует.`);
      process.exit(1);
    }
    console.log(`Админ «${a}» создан.`);
    break;
  }
  default:
    usage();
}
