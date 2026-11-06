# Справочник команд и флагов

Все команды, флаги и настройки проекта на одной странице. Подробные объяснения остаются в [INSTALLATION.md](INSTALLATION.md), [README.md](README.md), [PRACTICE.md](PRACTICE.md) и [документации плагина](plugin/documentation/docs/configuration.md).

Примеры используют папку установки `D:\cs2-server`: подставьте свою.

**Содержание**

- [Что запускать чаще всего](#что-запускать-чаще-всего)
- [Установщик install-cs2.ps1](#установщик-install-cs2ps1)
- [Запуск панели и серверов](#запуск-панели-и-серверов)
- [Переменные окружения панели](#переменные-окружения-панели)
- [Администраторы панели](#администраторы-панели)
- [Разработка и сборка](#разработка-и-сборка)
- [Команды в чате игры](#команды-в-чате-игры)
- [Консоль игры и сервера](#консоль-игры-и-сервера)
- [Настройки плагина ArenaPro](#настройки-плагина-arenapro)
- [Файлы конфигурации](#файлы-конфигурации)

## Что запускать чаще всего

Перед установкой обновлений остановите панель и игровые серверы.

| Задача | Команда |
| --- | --- |
| Обновить панель и плагин с GitHub | `powershell -NoProfile -ExecutionPolicy Bypass -File .\install-cs2.ps1 -InstallRoot 'D:\cs2-server' -Update` |
| То же и обновить CS2 из Steam | `powershell -NoProfile -ExecutionPolicy Bypass -File .\install-cs2.ps1 -InstallRoot 'D:\cs2-server' -Update -UpdateGame` |
| Проверить установку, ничего не меняя | `powershell -NoProfile -ExecutionPolicy Bypass -File .\install-cs2.ps1 -InstallRoot 'D:\cs2-server' -CheckOnly` |
| Запустить панель | `powershell -NoProfile -ExecutionPolicy Bypass -File 'D:\cs2-server\start-panel.ps1'` |
| Запустить игровой сервер | `powershell -NoProfile -ExecutionPolicy Bypass -File 'D:\cs2-server\start-server.ps1'` |
| Сбросить пароль администратора (из папки `panel`) | `npm.cmd run admin -- set-password 'новый-пароль'` |
| Включить админа на сервере (консоль игры) | `arenapro_auth КОД` |

## Установщик install-cs2.ps1

Устанавливает сервер CS2 и панель или обновляет готовую установку. Для всего, кроме `-CheckOnly`, нужен PowerShell от имени администратора.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-cs2.ps1 [параметры]
```

| Параметр | По умолчанию | Назначение |
| --- | --- | --- |
| `-InstallRoot <путь>` | `<диск CS2>:\CS2Tournament` | Папка установки на том же диске, что и клиент CS2 |
| `-Cs2Path <путь>` | Находится по реестру и библиотекам Steam | Папка клиента CS2 или полный путь к `cs2.exe` |
| `-ServerAddress <IP>` | `auto` | Закрепить IP компьютера в локальной сети |
| `-ServerPort <порт>` | `27015` | Порт игрового сервера и RCON |
| `-PanelPort <порт>` | `3000` | Порт панели |
| `-TvPort <порт>` | `27020` | Порт GOTV |
| `-RequiredFreeGB <число>` | `120` | Минимум свободного места: от 120 до 4096 |
| `-SkipFirewall` | выключен | Не создавать правила брандмауэра |
| `-Update` | выключен | Забрать проект с GitHub, пересобрать панель и ArenaPro, установить плагин. **CS2 не обновляет** |
| `-UpdateGame` | выключен | Обновить и проверить файлы CS2 через SteamCMD (нужно 20 ГиБ) |
| `-NoClientCopy` | выключен | Скачать сервер SteamCMD целиком, не копируя клиент CS2 |
| `-CheckOnly` | выключен | Только показать таблицу компонентов, без изменений |
| `-RepositoryUrl <url>` | Официальный репозиторий | Установка из проверенного форка |
| `-RepositoryBranch <имя>` | Ветка по умолчанию или текущая ветка установки | Ветка или тег |

Адрес и порты существующей установки берутся из `installation.json`: при повторном запуске новые значения этих параметров игнорируются.

Примеры:

```powershell
# Новая установка с указанием клиента CS2
.\install-cs2.ps1 -Cs2Path 'E:\SteamLibrary\steamapps\common\Counter-Strike Global Offensive' -InstallRoot 'E:\LAN Server'

# Все основные параметры сразу
.\install-cs2.ps1 -Cs2Path 'E:\SteamLibrary\steamapps\common\Counter-Strike Global Offensive' -InstallRoot 'E:\LAN Server' -ServerAddress '192.168.1.20' -ServerPort 27016 -PanelPort 3100 -TvPort 27021

# Перейти с тега на ветку main
.\install-cs2.ps1 -InstallRoot 'E:\LAN Server' -Update -RepositoryBranch 'main'
```

## Запуск панели и серверов

### start-panel.ps1

В папке установки файл создаётся установщиком и настраивается через `installation.json`, параметров у него нет. Описанные ниже параметры есть у `start-panel.ps1` из репозитория.

| Параметр | По умолчанию | Назначение |
| --- | --- | --- |
| `-Port <порт>` | `3000` | Порт панели |
| `-PublicUrl <url>` | Определяется сам | Закрепить адрес панели для игроков и серверов |
| `-DataDir <путь>` | `server\data` | Папка с базой `app.db`; относительный путь считается от папки скрипта |
| `-Cs2Path <путь>` | — | Папка серверной CS2 для серверов, которые запускает панель |
| `-NoBuild` | выключен | Не пересобирать панель перед запуском |

Постоянные значения можно записать в `panel.local.json` рядом со скриптом (файл не попадает в git). Параметры командной строки важнее файла.

```powershell
.\start-panel.ps1 -Port 3100 -DataDir 'server\data-live' -Cs2Path 'D:\cs2-server\cs2'
```

```json
{ "Port": 3100, "DataDir": "server\\data-live", "Cs2Path": "D:\\cs2-server\\cs2", "PublicUrl": "http://panel.local:3100" }
```

### start-server.ps1 и start-all.ps1

Создаются установщиком в папке установки, параметров не имеют и берут настройки из `installation.json`.

| Файл | Что делает |
| --- | --- |
| `start-server.ps1` | Запускает игровой сервер в текущем окне, остановка: `Ctrl+C` |
| `start-all.ps1` | Запускает панель и сервер в фоне, вывод пишет в `logs\`. Останавливаются через Диспетчер задач. Не запускайте повторно поверх работающих процессов |

## Переменные окружения панели

Задаются перед запуском панели, например: `$env:VETO_TURN_S = 15; .\start-panel.ps1`

| Переменная | По умолчанию | Назначение |
| --- | --- | --- |
| `PORT` | `3000` | Порт панели |
| `HOST` | `0.0.0.0` | Адрес, на котором слушает сервер |
| `PUBLIC_URL` | `http://<LAN-адрес>:<PORT>` | Закреплённый адрес панели |
| `DATA_DIR` | `server/data` при запуске через npm | Папка `app.db` и превью карт |
| `ADMIN_PASSWORD` | Случайный пароль | Пароль `admin` при создании первой учётной записи |
| `CS2_PATH` | — | Папка выделенного сервера CS2 |
| `JOIN_TIME_S` | `600` | Секунды на подключение к матчу |
| `VETO_TURN_S` | `30` | Секунды на ход в вето |

## Администраторы панели

Выполняются из корня репозитория, а в установке скриптом — из папки `panel`. Если панель использует свой `DATA_DIR`, задайте его и перед этими командами.

```powershell
npm.cmd run admin -- list
npm.cmd run admin -- set-password 'новый-пароль'
npm.cmd run admin -- set-password 'новый-пароль' логин
npm.cmd run admin -- set-username старый_логин новый_логин
npm.cmd run admin -- create логин 'пароль-не-короче-8-символов'
```

`set-password` без логина работает, только если администратор один.

## Разработка и сборка

| Команда | Что делает |
| --- | --- |
| `npm.cmd ci` | Установить зависимости |
| `npm.cmd run dev:server` | API с перезапуском при изменениях |
| `npm.cmd run dev:web` | Интерфейс Vite на порту 5173 (запросы `/api` идут на `localhost:3000`) |
| `npm.cmd run build` | Собрать интерфейс и сервер |
| `npm.cmd start` | Запустить собранную панель |
| `npm.cmd test -w server` | Тесты панели |
| `npm.cmd run plugin:test` | Тесты ArenaPro, нужен .NET SDK |
| `npm.cmd run plugin:build` | Собрать пакет ArenaPro в `plugin-dist\` |
| `npm.cmd audit` | Проверить уязвимости зависимостей панели |
| `dotnet list plugin/ArenaPro.csproj package --vulnerable --include-transitive` | Проверить уязвимости зависимостей плагина |

Скрипты в папке `scripts`:

| Команда | Что делает |
| --- | --- |
| `scripts\build-plugin.ps1` | Собрать плагин в `plugin-dist\` |
| `scripts\build-plugin.ps1 -DeployTo 'D:\cs2-server\cs2\game\csgo'` | Собрать и установить на сервер (сначала остановите сервер) |
| `scripts\build-plugin.ps1 -NoRestore` | Собрать без обращения к NuGet |
| `scripts\test-installer.ps1` | Офлайн-проверки установщика |

Скрипты запускаются так: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-plugin.ps1`

## Команды в чате игры

Команды пишутся в чат и начинаются с `.` или `!`: `.ready` и `!ready` работают одинаково. Исключения:

- **Только с точкой:** `.r`, `.ur`, `.p`, `.up`, `.rt`, `.cts`, `.ts`, `.reloadmap`, `.reload_admins`.
- **Только с `!`:** `!wl`, `!rmap`, `!sleep`, `!save_nades_as_global`.

`.help` выводит список команд прямо в игре.

### Для всех игроков

| Команда | Псевдонимы | Что делает |
| --- | --- | --- |
| `.ready` | `.r` | Отметиться готовым |
| `.unready` | `.ur`, `.notready` | Снять готовность |
| `.forceready` | | Отметить готовой всю свою команду (только в загруженном матче, см. `arenapro_allow_force_ready`) |
| `.stay` | | Победитель ножевого раунда остаётся на своей стороне |
| `.switch` | `.swap` | Победитель ножевого раунда меняет сторону |
| `.pause` | `.p` | Пауза в закупке |
| `.unpause` | `.up` | Снять паузу (обычно должны обе команды) |
| `.tech` | | Техническая пауза |
| `.tac` | | Тактический таймаут |
| `.stop` | | Откатить текущий раунд, должны написать обе команды (нужен `arenapro_stop_command_available`) |
| `.coach <сторона>` | | Стать тренером: `.coach t` или `.coach ct` |
| `.uncoach` | | Перестать быть тренером |
| `.pick <карта>` | | Выбрать карту в вето на сервере |
| `.ban <карта>` | | Убрать карту в вето на сервере |
| `.help` | | Показать доступные команды |

В турнирах панели вето проходит в комнате матча, поэтому `.pick` и `.ban` там не нужны.

### Для админов

Сначала админ вводит код в консоли игры: `arenapro_auth КОД`. В столбце «Флаг» указано, какой флаг нужен админу с ограниченными правами. Админу без флагов доступно всё.

| Команда | Псевдонимы | Флаг | Что делает |
| --- | --- | --- | --- |
| `.start` | `.force`, `.forcestart` | `@css/config` | Начать матч без готовности |
| `.restart` | `.rr` | `@css/config` | Сбросить матч и начать заново |
| `.endmatch [team1\|team2]` | `.forceend` | `@css/config` | Завершить матч: без победителя или с указанной победившей командой |
| `.forcepause` | `.fp` | `@css/config` | Поставить паузу, которую игроки не смогут снять |
| `.forceunpause` | `.fup` | `@css/config` | Снять паузу без согласия команд |
| `.restore <раунд>` | | `@css/config` | Восстановить начало раунда с этим номером |
| `.skipveto` | `.sv` | `@css/config` | Пропустить вето |
| `.roundknife` | `.rk` | `@css/config` | Включить или выключить ножевой раунд |
| `.playout` | | `@css/config` | Играть все раунды, даже если победитель уже ясен |
| `.whitelist` | `!wl` | `@css/config` | Включить или выключить белый список |
| `.globalnades` | `!save_nades_as_global` | `@css/config` | Сделать сохранённые раскидки общими или личными |
| `.readyrequired <число>` | | `@css/config` | Сколько игроков должны быть готовы; `0` — все, кто на сервере |
| `.settings` | | `@css/config` | Показать текущие настройки |
| `.team1 <название>` | | `@css/config` | Название команды 1 (по умолчанию CT) |
| `.team2 <название>` | | `@css/config` | Название команды 2 (по умолчанию T) |
| `.reload_admins` | | `@css/config` | Перечитать `admins.json` |
| `.addreadytime <секунды>` | | `@css/map` | Дать командам больше времени на готовность |
| `.map <карта>` | | `@css/map` | Сменить карту: `.map de_mirage` |
| `.reloadmap` | `!rmap` | `@css/map` | Перезагрузить текущую карту |
| `.prac` | `.tactics` | `@css/map` или `@custom/prac` | Включить режим тренировки |
| `.exitprac` | | `@css/map` или `@custom/prac` | Выйти из тренировки в режим матча |
| `.match` | | `@css/map` или `@custom/prac` | Включить режим матча |
| `.dryrun` | `.dry` | `@css/map` или `@custom/prac` | Прогон раунда с настоящей экономикой и временем закупки |
| `!sleep` | | `@css/map` или `@custom/prac` | Включить режим сна, если матч не начат |
| `.asay <текст>` | | `@css/chat` | Написать всем от имени админа |
| `.rcon <команда>` | | `@css/rcon` | Выполнить команду на сервере. Это полный доступ к консоли |

### В режиме тренировки

Эти команды работают только после `.prac` и не требуют прав админа.

**Гранаты**

| Команда | Псевдонимы | Что делает |
| --- | --- | --- |
| `.rethrow` | `.throw`, `.rt` | Повторить последнюю гранату |
| `.rethrowsmoke` | `.throwsmoke` | Повторить последний дым |
| `.rethrowflash` | `.throwflash` | Повторить последнюю флешку |
| `.rethrownade` | `.thrownade`, `.rethrowgrenade`, `.throwgrenade` | Повторить последнюю осколочную |
| `.rethrowmolotov` | `.throwmolotov` | Повторить последний молотов |
| `.rethrowdecoy` | `.throwdecoy` | Повторить последнюю ложную |
| `.throwindex 1 2 …` | `.throwidx` | Бросить гранаты из истории по номерам |
| `.lastindex` | | Показать номер последней гранаты |
| `.delay <секунды>` | | Задержка последней гранаты для `.rethrow` и `.throwindex` |
| `.last` | | Вернуться туда, откуда брошена последняя граната |
| `.back <номер>` | | Вернуться к позиции из истории бросков |
| `.savenade <имя> [описание]` | `.sn` | Сохранить раскидку |
| `.loadnade <имя>` | `.ln` | Встать на сохранённую раскидку |
| `.listnades [фильтр]` | `.lin` | Список раскидок |
| `.deletenade <имя>` | `.delnade`, `.dn` | Удалить раскидку |
| `.importnade <код>` | `.in` | Добавить раскидку по коду |
| `.clear` | | Убрать дымы и молотовы |
| `.fastforward` | `.ff` | Промотать время на 20 секунд |
| `.noflash` | `.noblind` | Не слепнуть от флешек |
| `.traj` | `.pip` | Показывать траекторию гранаты |
| `.impacts` | | Показывать места попаданий пуль |

**Боты, позиции и прочее**

| Команда | Псевдонимы | Что делает |
| --- | --- | --- |
| `.bot` | | Поставить бота на своём месте |
| `.crouchbot` | `.cbot` | Поставить присевшего бота |
| `.boost` | | Поставить бота и встать ему на голову |
| `.crouchboost` | | То же с присевшим ботом |
| `.nobots` | | Убрать всех ботов |
| `.spawn <номер>` | | Встать на спавн своей стороны |
| `.ctspawn <номер>` | `.cts` | Встать на спавн CT |
| `.tspawn <номер>` | `.ts` | Встать на спавн T |
| `.bestspawn`, `.worstspawn` | | Ближайший или самый дальний спавн своей стороны |
| `.bestctspawn`, `.worstctspawn` | | Ближайший или самый дальний спавн CT |
| `.besttspawn`, `.worsttspawn` | | Ближайший или самый дальний спавн T |
| `.showspawns`, `.hidespawns` | | Показать или скрыть спавны |
| `.savepos` | | Запомнить свою позицию |
| `.loadpos` | | Вернуться на запомненную позицию |
| `.ct`, `.t`, `.spec` | | Перейти за CT, T или в наблюдатели |
| `.fas` | `.watchme` | Перевести всех, кроме себя, в наблюдатели |
| `.god` | | Бессмертие |
| `.timer` | | Секундомер: первый раз запускает, второй останавливает |
| `.break` | | Разбить всё разрушаемое на карте |
| `.solid` | | Столкновения с союзниками (`mp_solid_teammates`) |

## Консоль игры и сервера

### Консоль игры (`~`)

| Команда | Что делает |
| --- | --- |
| `password <пароль>` | Ввести пароль сервера перед подключением |
| `connect <адрес>:<порт>` | Подключиться к серверу |
| `arenapro_auth <код>` | Включить свои команды админа. После 5 неверных попыток ввод блокируется на 5 минут |

### Консоль сервера и RCON

Команды с пометкой «админ» можно вызвать и из консоли игры, если у игрока есть права. Остальные работают только из консоли сервера или через RCON.

| Команда | Что делает |
| --- | --- |
| `arenapro_loadmatch <файл>` | Загрузить матч из JSON, путь считается от папки `csgo` |
| `arenapro_loadmatch_url "<url>" ["заголовок"] ["значение"]` | Загрузить матч по ссылке. Старое имя: `get5_loadmatch_url` |
| `arenapro_loadbackup <файл>` | Админ: восстановить матч из файла бэкапа. Старое имя: `get5_loadbackup` |
| `arenapro_loadbackup_url "<url>" ["заголовок"] ["значение"]` | Восстановить матч из бэкапа по ссылке. Старое имя: `get5_loadbackup_url` |
| `arenapro_listbackups [matchid]` | Админ: список бэкапов матча, по умолчанию текущего. Старое имя: `get5_listbackups` |
| `arenapro_addplayer <steam64> <team1\|team2\|spec> [имя]` | Добавить игрока в команду. Старое имя: `get5_addplayer` |
| `arenapro_removeplayer <steam64>` | Убрать игрока из всех команд. Старое имя: `get5_removeplayer` |
| `arenapro_add_ready_time <секунды>` | Админ: дать больше времени на готовность. Старое имя: `get5_add_ready_time` |
| `get5_endmatch [team1\|team2]` | Админ: то же, что `.endmatch` |
| `sm_pause`, `sm_unpause` | Админ: то же, что `.forcepause` и `.forceunpause` |
| `reload_admins` | Админ: перечитать `admins.json` |
| `get5_status` | Состояние матча в JSON |
| `get5_web_available` | Проверка совместимости с Get5 Web, ответ в JSON |
| `version` | Версия сервера CS2 |
| `meta list` | Список плагинов Metamod |
| `css_plugins list` | Список плагинов CounterStrikeSharp |

Перечитать настройки плагина без перезапуска:

```
exec ArenaPro/config.cfg; execifexists ArenaPro/config_override.cfg
```

## Настройки плагина ArenaPro

Настройки задаются в `cfg\ArenaPro\config_override.cfg`. Файл `config.cfg` обновления перезаписывают. Формат: `имя значение`, например `arenapro_stop_command_available true`.

Турнирные матчи панель настраивает сама: на время матча она задаёт `arenapro_ready_mode 2`, `arenapro_time_to_start`, `arenapro_join_start_delay`, `arenapro_kick_on_series_end_delay`, `arenapro_admin_auth_code`, настройки пауз и `arenapro_remote_log_*`. Значения из `config.cfg` в таких матчах для этих настроек не действуют.

### Матч и готовность

| Настройка | По умолчанию | Назначение |
| --- | --- | --- |
| `arenapro_autostart_mode` | `1` | Режим при запуске: `0` — никакой, `1` — матч, `2` — тренировка |
| `arenapro_knife_enabled_default` | `true` | Ножевой раунд включён |
| `arenapro_playout_enabled_default` | `false` | Играть все раунды |
| `arenapro_minimum_ready_required` | `2` | Сколько игроков должны быть готовы; `0` — все на сервере |
| `arenapro_ready_mode` | `0` | Загруженный матч: `0` — игроки пишут `.ready`; `1` — готова команда, игроки которой зашли; `2` — как `1`, и капитан пишет `.ready` |
| `arenapro_join_start_delay` | `10` | Секунды от готовности всех при режимах `1` и `2` до старта |
| `arenapro_time_to_start` | `0` | Секунды на готовность перед ножом или стартом; `0` — без ограничения. Старое имя: `get5_time_to_start` |
| `arenapro_time_to_start_veto` | `0` | То же перед вето. Старое имя: `get5_time_to_start_veto` |
| `arenapro_allow_force_ready` | `true` | Разрешить `.forceready`. Старое имя: `get5_allow_force_ready` |
| `arenapro_kick_when_no_match_loaded` | `false` | Выкидывать всех, если матч не загружен |
| `arenapro_kick_on_series_end_delay` | `5` | Через сколько секунд после серии выкинуть игроков; `0` — не выкидывать |
| `arenapro_reset_cvars_on_series_end` | `true` | Вернуть значения `cvars` из конфига матча после серии |
| `arenapro_whitelist_enabled_default` | `false` | Белый список включён |

### Паузы и откат раундов

| Настройка | По умолчанию | Назначение |
| --- | --- | --- |
| `arenapro_use_pause_command_for_tactical_pause` | `false` | `.pause` работает как тактический таймаут |
| `arenapro_enable_tech_pause` | `true` | Разрешить `.tech`. Старое имя: `get5_allow_technical_pause` |
| `arenapro_tech_pause_flag` | пусто | Флаг, нужный для технической паузы; пусто — доступно всем |
| `arenapro_max_tech_pauses` | `0` | Технических пауз на команду за карту; `0` — без ограничения. Старое имя: `get5_max_tech_pauses` |
| `arenapro_tech_pause_time` | `0` | Через сколько секунд паузу может снять одна команда; `0` — всегда обе. Старое имя: `get5_tech_pause_time` |
| `arenapro_stop_command_available` | `false` | Разрешить `.stop` |
| `arenapro_stop_command_no_damage` | `false` | Запретить `.stop` после урона по соперникам |
| `arenapro_pause_after_restore` | `true` | Ставить паузу после восстановления раунда |

### Админы и сообщения

| Настройка | По умолчанию | Назначение |
| --- | --- | --- |
| `arenapro_admin_auth_code` | пусто | Код для `arenapro_auth`; пусто — код не нужен |
| `arenapro_everyone_is_admin` | `false` | Все игроки становятся админами. Не включайте на турнирном сервере: это даёт всем `.rcon` |
| `arenapro_chat_prefix` | `[{Green}ArenaPro{Default}]` | Префикс сообщений плагина |
| `arenapro_admin_chat_prefix` | `[{Red}ADMIN{Default}]` | Префикс сообщений `.asay` |
| `arenapro_chat_messages_timer_delay` | `13` | Секунды между напоминаниями в чате |
| `arenapro_show_credits_on_match_start` | `false` | Показывать сообщение об авторе при старте матча |
| `arenapro_match_start_message` | пусто | Сообщение при старте матча; `$$$` переносит строку |
| `arenapro_hostname_format` | `ArenaPro \| {TEAM1} vs {TEAM2}` | Имя сервера; `""` — не менять |
| `arenapro_enable_damage_report` | `true` | Отчёт об уроне после раунда |

### Тренировка

| Настройка | По умолчанию | Назначение |
| --- | --- | --- |
| `arenapro_save_nades_as_global_enabled` | `false` | Сохранённые раскидки видны всем |
| `arenapro_max_saved_last_grenades` | `512` | Длина истории гранат на игрока за карту; `0` — без ограничения |
| `arenapro_smoke_color_enabled` | `false` | Дым цвета игрока |

### Демозаписи

| Настройка | По умолчанию | Назначение |
| --- | --- | --- |
| `arenapro_demo_recording_enabled` | `true` | Записывать демо с начала матча |
| `arenapro_demo_path` | `ArenaPro/` | Папка демозаписей от `csgo`, должна заканчиваться на `/` |
| `arenapro_demo_name_format` | `{TIME}_{MATCH_ID}_{MAP}_{TEAM1}_vs_{TEAM2}` | Имя файла. Доступны `{TIME}`, `{MATCH_ID}`, `{MAP}`, `{MAPNUMBER}`, `{TEAM1}`, `{TEAM2}` |
| `arenapro_demo_upload_url` | пусто | Куда отправлять демо после карты. Старое имя: `get5_demo_upload_url` |
| `arenapro_demo_upload_header_key` | пусто | Имя HTTP-заголовка при отправке. Старое имя: `get5_demo_upload_header_key` |
| `arenapro_demo_upload_header_value` | пусто | Значение HTTP-заголовка при отправке. Старое имя: `get5_demo_upload_header_value` |

### Отправка событий и бэкапов

| Настройка | По умолчанию | Назначение |
| --- | --- | --- |
| `arenapro_remote_log_url` | пусто | Куда отправлять события матча. Старое имя: `get5_remote_log_url` |
| `arenapro_remote_log_header_key` | пусто | Имя HTTP-заголовка. Старое имя: `get5_remote_log_header_key` |
| `arenapro_remote_log_header_value` | пусто | Значение HTTP-заголовка. Старое имя: `get5_remote_log_header_value` |
| `arenapro_remote_backup_url` | пусто | Куда отправлять бэкапы. Старое имя: `get5_remote_backup_url` |
| `arenapro_remote_backup_header_key` | `Authorization` | Имя HTTP-заголовка. Старое имя: `get5_remote_backup_header_key` |
| `arenapro_remote_backup_header_value` | пусто | Значение HTTP-заголовка. Старое имя: `get5_remote_backup_header_value` |

## Файлы конфигурации

Файлы плагина лежат в `cs2\game\csgo\cfg\ArenaPro\`. Свои настройки пишите в файлы `*_override.cfg`: обновления их не трогают.

| Файл | Когда применяется | Свои настройки |
| --- | --- | --- |
| `config.cfg` | При загрузке плагина | `config_override.cfg` |
| `warmup.cfg` | Разминка | `warmup_override.cfg` |
| `knife.cfg` | Ножевой раунд | `knife_override.cfg` |
| `live.cfg` | Старт матча | `live_override.cfg` |
| `live_wingman.cfg` | Старт матча в «Напарниках» | `live_wingman_override.cfg` |
| `prac.cfg` | Режим тренировки | `prac_override.cfg` |
| `dryrun.cfg` | `.dryrun` | `dryrun_override.cfg` |
| `sleep.cfg` | `!sleep` | `sleep_override.cfg` |
| `panel.cfg` | При загрузке плагина, после `config.cfg`. Файл пишет панель, вручную не правьте | — |

| Другие файлы | Назначение |
| --- | --- |
| `admins.json` | Админы плагина. Для серверов панели список ведётся в разделе «Админы» |
| `whitelist.cfg` | Белый список: один Steam64 на строку |
| `database.json` | Статистика: SQLite или MySQL |
| `savednades.json` | Сохранённые раскидки |
| `<папка установки>\installation.json` | Адрес и порты для файлов запуска |
| `<папка установки>\credentials.txt` | Начальные пароли |
| `<папка установки>\data\app.db` | База панели |
| `<папка установки>\logs\` | `install.log`, `steamcmd.log`, `cs2-copy.log` и вывод `start-all.ps1` |
| `panel.local.json` | Настройки `start-panel.ps1` из репозитория |

Флаги прав для `admins.json`: `@css/root` — всё, `@css/config` — настройки матча, `@css/map` — смена карты и тренировка, `@custom/prac` — тренировка, `@css/rcon` — `.rcon`, `@css/chat` — `.asay`.
