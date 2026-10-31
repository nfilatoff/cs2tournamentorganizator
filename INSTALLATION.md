# Установка

В этом документе описаны два способа установки панели турниров, сервера CS2 и плагина ArenaPro на Windows:

1. [Автоматическая установка скриптом `install-cs2.ps1`](#автоматическая-установка-скриптом-install-cs2ps1). Это рекомендуемый способ: один файл скачивает и настраивает всё сам.
2. [Ручная установка с нуля](#ручная-установка-с-нуля). Используйте её, если скрипт не работает в вашей среде, завершается ошибкой или нужна нестандартная схема (например, сервер CS2 на другом компьютере).

О назначении проекта и работе в панели рассказано в [README.md](README.md).

## Требования

| Что | Требование |
| --- | --- |
| ОС | Windows 10/11 x64 (подойдёт и Windows Server x64) |
| PowerShell | Windows PowerShell 5.1 x64 или PowerShell 7 x64 |
| Место на диске | Не менее 120 ГиБ свободного места для отдельной серверной копии CS2, инструментов и сборки |
| Сеть | Интернет на время установки; локальная сеть, в которой компьютер с панелью доступен игрокам |
| Права | Администратор Windows (для Visual C++ Redistributable и брандмауэра) |
| Для скрипта | Клиент CS2, установленный через Steam, на том диске, куда ставится сервер |

Порты по умолчанию: панель `3000/TCP`, игровой сервер `27015/UDP`, RCON `27015/TCP`, GOTV `27020/UDP`.

---

## Автоматическая установка скриптом install-cs2.ps1

### Что делает скрипт

Скрипт не требует заранее установленных Git, Node.js или .NET и не использует исходники рядом с собой: он клонирует проект с GitHub. Steam, клиент CS2 и его файлы скрипт не устанавливает и не изменяет: клиент нужен только чтобы определить диск. Установка проходит в 8 этапов:

1. Скачивает portable MinGit и клонирует репозиторий в `<папка установки>\panel`.
2. Скачивает Node.js 24 с nodejs.org и проверяет SHA256.
3. Устанавливает .NET SDK 10 официальным скриптом Microsoft в `tools`. Системный `PATH` не меняется.
4. Устанавливает Microsoft Visual C++ Redistributable x64 и проверяет подпись Microsoft.
5. Копирует файлы установленного клиента CS2 в отдельную серверную папку, затем SteamCMD (`app_update 730 validate`) проверяет их и докачивает только отличия: серверные файлы и обновления. Это намного быстрее, чем скачивать всю игру. Перед установкой закройте клиент CS2. С `-NoClientCopy` сервер скачивается SteamCMD целиком.
6. Устанавливает Metamod:Source 2.x (сборка не ниже 1467) и CounterStrikeSharp with runtime (не ниже 1.0.379), затем подключает Metamod в `gameinfo.gi`.
7. Выполняет `npm ci`, собирает панель, собирает ArenaPro и копирует плагин на сервер.
8. Создаёт конфиг сервера со случайным RCON-паролем, базу панели с администратором `admin` и уже добавленным сервером, файлы запуска и правила брандмауэра.

Процессы, службы и задания автозапуска скрипт не создаёт: панель и сервер вы запускаете сами.

### Шаг 1. Скачать скрипт

Скачайте только один файл: [install-cs2.ps1](https://raw.githubusercontent.com/nfilatoff/cs2tournamentorganizator/main/install-cs2.ps1). Можно сделать это из PowerShell:

```powershell
Invoke-WebRequest -UseBasicParsing 'https://raw.githubusercontent.com/nfilatoff/cs2tournamentorganizator/main/install-cs2.ps1' -OutFile "$env:USERPROFILE\Downloads\install-cs2.ps1"
cd "$env:USERPROFILE\Downloads"
```

### Шаг 2. Проверка без установки

Откройте PowerShell в папке со скриптом и выполните:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-cs2.ps1 -InstallRoot 'E:\LAN Server' -CheckOnly
```

Проверка ничего не скачивает, не создаёт папки и не меняет настройки, права администратора для неё не нужны. Она находит CS2, проверяет место на диске и печатает таблицу компонентов `OK / MISSING`. Если проверка завершилась ошибкой, исправьте причину (см. [«Частые ошибки скрипта»](#частые-ошибки-скрипта)) до установки.

### Шаг 3. Установка

Откройте **PowerShell x64 от имени администратора** (Пуск → PowerShell → «Запуск от имени администратора»), перейдите в папку со скриптом и выполните:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-cs2.ps1 -InstallRoot 'E:\LAN Server'
```

- `-InstallRoot` — новая пустая папка или папка предыдущей установки **на том же диске, где установлена CS2**. Если указать только букву диска (`E:`), будет использована `E:\CS2Tournament`. Без параметра скрипт спросит папку, а пустой ввод выберет `<диск CS2>:\CS2Tournament`.
- `-ExecutionPolicy Bypass` действует только для этого запуска. Политику системы скрипт не меняет.
- Загрузка CS2 через SteamCMD может занять долгое время. Не закрывайте окно.

В конце скрипт печатает пути к файлам запуска и адрес панели.

### Параметры скрипта

| Параметр | По умолчанию | Назначение |
| --- | --- | --- |
| `-InstallRoot` | `<диск CS2>:\CS2Tournament` | Папка установки на диске CS2 |
| `-Cs2Path` | Находится автоматически по реестру и библиотекам Steam | Папка клиента CS2 или полный путь к `cs2.exe`. Нужен, если найдено несколько установок или ни одной |
| `-ServerAddress` | `auto` | Закрепить IP этого компьютера в локальной сети. Без параметра панель сама определяет адрес при каждом запуске, и компьютеру не нужен постоянный IP |
| `-ServerPort` | `27015` | Порт игрового сервера и RCON |
| `-PanelPort` | `3000` | Порт панели |
| `-TvPort` | `27020` | Порт GOTV |
| `-RequiredFreeGB` | `120` | Минимум свободного места. Повысить можно, понизить ниже 120 нельзя |
| `-SkipFirewall` | — | Не создавать правила брандмауэра |
| `-Update` | — | Обновить существующую установку до последней версии проекта с GitHub (см. [«Обновление»](#обновление)) |
| `-UpdateGame` | — | Принудительно обновить и проверить файлы сервера через SteamCMD |
| `-NoClientCopy` | — | Не копировать файлы клиента CS2, а скачать сервер SteamCMD целиком |
| `-CheckOnly` | — | Только проверка, без изменений |
| `-RepositoryUrl`, `-RepositoryBranch` | Официальный репозиторий, ветка по умолчанию | Установка из публичного форка или с другой ветки/тега |

Три порта должны различаться. Пример со всеми основными параметрами:

```powershell
.\install-cs2.ps1 -Cs2Path 'E:\SteamLibrary\steamapps\common\Counter-Strike Global Offensive' -InstallRoot 'E:\LAN Server' -ServerAddress '192.168.1.20' -ServerPort 27016 -PanelPort 3100 -TvPort 27021
```

### Что получится после установки

```text
E:\LAN Server\
├─ cs2\                отдельная серверная CS2 с Metamod, CounterStrikeSharp и ArenaPro
├─ panel\              клон репозитория, зависимости и собранная панель
├─ tools\              Node.js, .NET SDK, SteamCMD, MinGit
├─ data\app.db         база панели
├─ credentials.txt     адрес панели, логин и начальный пароль admin, RCON-пароль
├─ installation.json   адрес и порты для файлов запуска
├─ start-panel.ps1     запуск панели
├─ start-server.ps1    запуск игрового сервера
├─ start-all.ps1       запуск обоих процессов в фоне
├─ downloads\, cache\, temp\
└─ logs\install.log, logs\steamcmd.log
```

Доступ к папке установки есть только у текущего пользователя Windows, администраторов и SYSTEM, так как в ней лежат пароли. Не публикуйте её и не загружайте на GitHub.

### Запуск после установки

Откройте два окна PowerShell **от той же учётной записи Windows**, которая выполняла установку:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File 'E:\LAN Server\start-panel.ps1'
```

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File 'E:\LAN Server\start-server.ps1'
```

Остановка выполняется клавишами `Ctrl+C` в соответствующем окне.

Также можно использовать `start-all.ps1`: он запускает оба процесса в фоне со скрытыми окнами и пишет вывод в `logs\start-panel.ps1.out.log` и аналогичные файлы. Фоновые процессы останавливаются через Диспетчер задач (`node.exe` панели и выделенный `cs2.exe` из папки `cs2`). Не запускайте `start-all.ps1` повторно поверх работающей установки.

### Первая проверка

1. Откройте адрес панели из `credentials.txt` (например, `http://192.168.1.20:3000`) и войдите как `admin` с начальным паролем.
2. Смените пароль в разделе «Аккаунт». Запись в `credentials.txt` после этого не обновляется.
3. В разделе «Серверы» уже есть сервер `Local ArenaPro`. Нажмите «Проверить»: панель должна получить его состояние по RCON.
4. В консоли игрового сервера выполните `meta list` и `css_plugins list`: должны быть загружены CounterStrikeSharp и ArenaPro.
5. Проведите тестовый матч до турнира.

### Повторный запуск и ремонт

Скрипт можно запускать повторно с тем же `-InstallRoot`. Перед этим **остановите панель и сервер**. Скрипт определяет, что уже установлено, печатает таблицу `OK / MISSING` и выполняет только недостающие шаги:

- прерванная загрузка CS2 продолжается с места остановки;
- аккаунты, пароли, `credentials.txt`, конфиги `cfg\ArenaPro`, CounterStrikeSharp и `metaplugins.ini` сохраняются;
- после обновления CS2 в Steam строка Metamod в `gameinfo.gi` восстанавливается;
- адрес и порты берутся из `installation.json`, а новые значения параметров игнорируются с предупреждением;
- без `-Update` проект в `panel\` с GitHub не обновляется.

Повторный запуск с `-CheckOnly` ничего не меняет и только показывает таблицу компонентов. Скрипт не допускает одновременного запуска двух установщиков для одной папки.

### Обновление

Когда на GitHub выходит новая версия, обновите установку той же командой с ключом `-Update`. Перед этим **остановите панель и игровой сервер**: скрипт проверяет процессы этой установки и не начнёт, пока они работают.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-cs2.ps1 -InstallRoot 'E:\LAN Server' -Update
```

Что делает `-Update`:

1. Забирает последнюю версию проекта в `panel\`. Если в отслеживаемых файлах `panel\` есть локальные правки, обновление останавливается и ничего не меняет.
2. Если версия изменилась, ставит зависимости npm, пересобирает панель и ArenaPro и устанавливает плагин на сервер.
3. Перезаписывает `start-panel.ps1`, `start-server.ps1` и `start-all.ps1` по `installation.json`: новая версия может запускаться иначе.
4. Сохраняет базу панели, аккаунты, пароли, `credentials.txt`, конфиги `cfg\ArenaPro`, CounterStrikeSharp и `metaplugins.ini`. Новые поля базы панель добавляет сама при первом запуске.
5. Доустанавливает компоненты, которых не хватает, как обычный повторный запуск.

Если версия на GitHub не изменилась, скрипт пишет `Project is up to date` и ничего не пересобирает. Установку, сделанную с тега (`-RepositoryBranch 'v1.2'`), обновляют, указывая новую ветку или тег: `-Update -RepositoryBranch 'main'`.

После патча CS2 в Steam обновите и файлы игрового сервера ключом `-UpdateGame`. Его можно указывать вместе с `-Update`:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-cs2.ps1 -InstallRoot 'E:\LAN Server' -Update -UpdateGame
```

После обновления запустите панель и сервер и проведите тестовый матч: установщик не заменяет проверку совместимости Metamod, CounterStrikeSharp и ArenaPro с новой версией CS2.

### Частые ошибки скрипта

| Сообщение | Что делать |
| --- | --- |
| `Run PowerShell as Administrator` | Запустите PowerShell от имени администратора. Для проверки без прав используйте `-CheckOnly` |
| `CS2 was not found` или найдено несколько установок | Укажите `-Cs2Path` с папкой игры или полным путём к `cs2.exe` |
| `INSTALLATION CANCELLED: insufficient space` | Освободите место на диске CS2. Другой диск скрипт не выбирает |
| `A fixed local physical drive is required` / `Junctions/symlinks...` | Используйте прямой путь на локальном диске с буквой, без сетевых дисков, SUBST и символических ссылок |
| `Close the CS2 game client` | Закройте игру CS2 (её файлы копируются на сервер) и запустите скрипт ещё раз |
| `Copying CS2 from the Steam client failed` | Посмотрите `logs\cs2-copy.log`. Можно запустить скрипт с `-NoClientCopy` |
| `SteamCMD did not confirm successful CS2 installation` | Посмотрите `logs\steamcmd.log` и запустите скрипт ещё раз: загрузка продолжится |
| `Stop this dedicated CS2 server...` | Остановите сервер и панель перед ремонтом |
| `Existing RCON config differs from the panel database` | RCON-пароль в `cfg\arenapro-server.cfg` не совпадает с базой. Верните одинаковое значение и повторите запуск |
| `has local changes` (при `-Update`) | В `panel\` изменены файлы проекта. Сохраните их отдельно или отмените (`git -C <папка>\panel status`) и повторите |
| `There is no installation to update` | В папке нет установки. Запустите скрипт без `-Update` |

Полный журнал установки находится в `logs\install.log`, вывод SteamCMD — в `logs\steamcmd.log`, копирования CS2 — в `logs\cs2-copy.log`. При сетевых ошибках загрузки повторяются до трёх раз. Ошибки сборки и установки прерывают скрипт с кодом 1; успешная установка и `-CheckOnly` возвращают 0. Автоматического отката нет: уже установленные компоненты остаются, и повторный запуск продолжает с места остановки.

### Как скрипт выбирает CS2, папку и место на диске

- Клиент CS2 ищется по путям Steam из реестра и всем библиотекам из `libraryfolders.vdf`, в том числе на других дисках. Если найдено несколько установок или ни одной, скрипт попросит указать `-Cs2Path`.
- Папка установки должна быть на том же диске, что и клиент CS2, и не может находиться внутри папки клиента или содержать её. Другой диск скрипт не выбирает. Посторонняя непустая папка не используется; папка прошлой установки (есть `logs\install.log` или `installation.json`) принимается для ремонта и обновления.
- Сетевые и съёмные диски, UNC-пути, `SUBST`, junction и символические ссылки в путях не поддерживаются.
- Для новой установки нужно не меньше 120 ГиБ свободного места или больше: размер установленной игры × 1,2 + 20 ГиБ. Для ремонта готовой установки хватает 8 ГиБ, для `-UpdateGame` — 20 ГиБ. Если Windows на другом диске, там нужно ещё 2 ГиБ для Visual C++ Redistributable.

### Безопасность и сеть

- Доступ к папке установки есть только у текущего пользователя Windows, администраторов и SYSTEM. Пароли лежат в `credentials.txt`, RCON-пароль также в конфиге сервера и базе панели. В командной строке и журнале установки пароли не появляются.
- Секреты незавершённой первичной настройки хранятся в `temp\bootstrap.json` до её успешного окончания. Не публикуйте этот файл и папку установки.
- Правила брандмауэра создаются для панели (TCP), RCON (TCP), игры (UDP) и GOTV (UDP): только для локальной подсети, профилей «Частная» и «Доменная» и конкретных программ. В общедоступном профиле сети они не действуют. Если брандмауэром вы управляете сами, используйте `-SkipFirewall`.
- Сервер настроен для локальной сети: `-insecure`, `sv_lan 1`, без GSLT. Роутер и переадресация портов не настраиваются. Публичный интернет-сервер требует отдельной настройки.
- Указывайте в `-RepositoryUrl` только проверенные репозитории: при сборке выполняется их код.

### Проверки самого установщика

Для разработчиков: офлайн-тесты установщика запускаются без интернета, игру не скачивают и не запускают. Нужны Git и Node.js 24.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\test-installer.ps1
```

Если ошибку не удаётся устранить, переходите к ручной установке. Уже скачанные скриптом компоненты в папке установки можно использовать повторно.

---

## Ручная установка с нуля

Здесь повторяются шаги скрипта, но выполняются они вручную. Для примера используется папка `D:\CS2Tournament` и IP `192.168.0.4`. Подставьте свои значения. Путь без пробелов избавит от лишних кавычек, но пробелы тоже допустимы.

Итоговая структура будет такой же, как у скрипта:

```text
D:\CS2Tournament\
├─ cs2\        серверная CS2
├─ panel\      репозиторий панели
├─ steamcmd\   SteamCMD
└─ data\       база панели
```

Все команды ниже выполняются в **PowerShell x64 от имени администратора**, если не сказано иное.

### 1. Установить системные компоненты

Нужны Git, Node.js 24 или новее, .NET SDK 10 и Visual C++ Redistributable x64. Проще всего установить их через `winget`:

```powershell
winget install --id Git.Git -e
winget install --id OpenJS.NodeJS.LTS -e
winget install --id Microsoft.DotNet.SDK.10 -e
winget install --id Microsoft.VCRedist.2015+.x64 -e
```

Если `winget` недоступен, скачайте установщики вручную:

- Git: <https://git-scm.com/download/win>
- Node.js 24: <https://nodejs.org/dist/latest-v24.x/> (файл `node-v24.*-x64.msi`)
- .NET SDK 10: <https://dotnet.microsoft.com/download/dotnet/10.0>
- Visual C++ Redistributable x64: <https://aka.ms/vc14/vc_redist.x64.exe>

**Закройте и снова откройте PowerShell**, чтобы обновился `PATH`, и проверьте версии:

```powershell
git --version
node --version      # v24.x или новее
npm.cmd --version
dotnet --version    # 10.x
```

### 2. Создать папку установки

```powershell
New-Item -ItemType Directory -Force 'D:\CS2Tournament\data', 'D:\CS2Tournament\steamcmd' | Out-Null
```

### 3. Скачать и собрать панель

```powershell
cd 'D:\CS2Tournament'
git clone https://github.com/nfilatoff/cs2tournamentorganizator.git panel
cd panel
npm.cmd ci
npm.cmd run build
```

`npm.cmd` используется вместо `npm`, потому что стандартная политика PowerShell блокирует `npm.ps1`. После сборки должны появиться файлы `server\dist\index.js` и `web\dist\index.html`.

### 4. Установить SteamCMD и серверную CS2

1. Скачайте и распакуйте SteamCMD:

   ```powershell
   Invoke-WebRequest -UseBasicParsing 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip' -OutFile 'D:\CS2Tournament\steamcmd\steamcmd.zip'
   Expand-Archive 'D:\CS2Tournament\steamcmd\steamcmd.zip' -DestinationPath 'D:\CS2Tournament\steamcmd' -Force
   ```

2. Скачайте сервер CS2 (это несколько десятков гигабайт, загрузка может занять долгое время):

   ```powershell
   & 'D:\CS2Tournament\steamcmd\steamcmd.exe' +force_install_dir 'D:\CS2Tournament\cs2' +login anonymous +app_update 730 validate +quit
   ```

   Первый запуск SteamCMD обновляет сам себя. Дождитесь сообщения `Success! App '730' fully installed.`. Если загрузка прервалась, выполните ту же команду ещё раз, и она продолжится.

3. Проверьте, что существует файл `D:\CS2Tournament\cs2\game\bin\win64\cs2.exe`.

Важно: серверная копия должна быть отдельной папкой, а не папкой клиента CS2 из Steam.

### 5. Установить Metamod:Source

1. Откройте <https://www.sourcemm.net/downloads.php?branch=master> и скачайте **Windows**-архив ветки 2.x (`mmsource-2.*-git<номер>-windows.zip`) со сборкой **не ниже 1467**. Более старые сборки не работают с текущим CounterStrikeSharp.
2. Распакуйте архив в папку `game\csgo` сервера:

   ```powershell
   Expand-Archive "$env:USERPROFILE\Downloads\mmsource-2.0.0-git1467-windows.zip" -DestinationPath 'D:\CS2Tournament\cs2\game\csgo' -Force
   ```

   Имя файла замените на скачанное. После распаковки должна появиться папка `game\csgo\addons\metamod`.

### 6. Установить CounterStrikeSharp

1. Откройте <https://github.com/roflmuffin/CounterStrikeSharp/releases> и скачайте из последнего релиза (версия **не ниже 1.0.379**) архив `counterstrikesharp-with-runtime-windows-<версия>.zip`. Нужна именно сборка **with-runtime**: в ней есть .NET runtime, без которого плагин не загрузится.
2. Распакуйте его туда же:

   ```powershell
   Expand-Archive "$env:USERPROFILE\Downloads\counterstrikesharp-with-runtime-windows-1.0.379.zip" -DestinationPath 'D:\CS2Tournament\cs2\game\csgo' -Force
   ```

   Должна появиться папка `game\csgo\addons\counterstrikesharp`.

### 7. Подключить Metamod в gameinfo.gi

Откройте в текстовом редакторе `D:\CS2Tournament\cs2\game\csgo\gameinfo.gi`. Сначала сохраните копию файла, например `gameinfo.gi.before-arenapro`. Найдите блок `SearchPaths` и добавьте строку `Game csgo/addons/metamod` **первой** внутри фигурных скобок:

```text
		SearchPaths
		{
			Game	csgo/addons/metamod
			Game_LowViolence	csgo_lv // Perfect World content override
			Game	csgo
			...
```

Сохраните файл в кодировке UTF-8 без BOM.

**Каждое обновление CS2 через SteamCMD (`validate`) может вернуть оригинальный `gameinfo.gi`.** После обновления сервера проверяйте, что строка на месте.

### 8. Собрать и установить ArenaPro

Из папки панели выполните:

```powershell
cd 'D:\CS2Tournament\panel'
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-plugin.ps1 -DeployTo 'D:\CS2Tournament\cs2\game\csgo'
```

Скрипт собирает плагин через `dotnet publish`, формирует пакет в `plugin-dist\` и копирует его на сервер:

- `addons\counterstrikesharp\plugins\ArenaPro\` — сам плагин;
- `addons\counterstrikesharp\gamedata\arenapro.json` — gamedata;
- `cfg\ArenaPro\` — конфиги плагина.

Если сервер запущен, сначала остановите его: работающий процесс блокирует `ArenaPro.dll`.

### 9. Создать конфиг сервера с RCON-паролем

Сгенерируйте случайный RCON-пароль и запишите конфиг сервера:

```powershell
$bytes = New-Object byte[] 24
[Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
$rcon = -join ($bytes | ForEach-Object { $_.ToString('x2') })

@"
hostname "CS2 ArenaPro LAN"
sv_lan 1
rcon_password "$rcon"
tv_enable 1
"@ | Set-Content -Encoding ascii 'D:\CS2Tournament\cs2\game\csgo\cfg\arenapro-server.cfg'

"RCON password: $rcon" | Set-Content -Encoding utf8 'D:\CS2Tournament\credentials.txt'
```

Пароль понадобится при добавлении сервера в панель. Не используйте в нём символы `"` и `;`. Пароль хранится в конфиге, а не в командной строке, поэтому его не видно в списке процессов.

### 10. Первый запуск игрового сервера

Запустите сервер в отдельном окне PowerShell. Указывайте **полный путь к `cs2.exe`**: команда `cs2.exe` сама по себе из произвольной папки не находится.

```powershell
cd 'D:\CS2Tournament\cs2'
& 'D:\CS2Tournament\cs2\game\bin\win64\cs2.exe' -dedicated -console -condebug -usercon -insecure -port 27015 `
    +sv_lan 1 +tv_port 27020 +game_type 0 +game_mode 2 +exec arenapro-server.cfg +map de_inferno
```

- без `-ip` сервер слушает все сетевые адаптеры, в том числе `127.0.0.1`, через который к нему подключается панель на этом же компьютере. `-ip <адрес>` нужен, только чтобы закрепить сервер за одним адаптером;
- `-usercon` нужен для управления по RCON;
- `-insecure` и `sv_lan 1` подходят для игры в локальной сети без GSLT;
- `+game_type 0 +game_mode 2` и `de_inferno` — стартовые режим и карта; матч дальше настраивает ArenaPro по конфигурации из панели.

Когда сервер загрузит карту, выполните в его консоли:

```text
meta list
css_plugins list
```

В выводе должны быть CounterStrikeSharp и ArenaPro. Если их нет, проверьте шаги 5–8, особенно строку в `gameinfo.gi`.

Чтобы не набирать команду каждый раз, сохраните её в файл `D:\CS2Tournament\start-server.ps1`.

### 11. Разрешить порты в брандмауэре

Разрешите входящие подключения только из локальной подсети и только для частного и доменного профилей сети:

```powershell
$cs2 = 'D:\CS2Tournament\cs2\game\bin\win64\cs2.exe'
$node = (Get-Command node.exe).Source
New-NetFirewallRule -DisplayName 'CS2Tournament Panel' -Direction Inbound -Action Allow -Profile Private,Domain -RemoteAddress LocalSubnet -Protocol TCP -LocalPort 3000 -Program $node
New-NetFirewallRule -DisplayName 'CS2Tournament RCON'  -Direction Inbound -Action Allow -Profile Private,Domain -RemoteAddress LocalSubnet -Protocol TCP -LocalPort 27015 -Program $cs2
New-NetFirewallRule -DisplayName 'CS2Tournament Game'  -Direction Inbound -Action Allow -Profile Private,Domain -RemoteAddress LocalSubnet -Protocol UDP -LocalPort 27015 -Program $cs2
New-NetFirewallRule -DisplayName 'CS2Tournament GOTV'  -Direction Inbound -Action Allow -Profile Private,Domain -RemoteAddress LocalSubnet -Protocol UDP -LocalPort 27020 -Program $cs2
```

Убедитесь, что сеть в Windows помечена как **частная** (Параметры → Сеть и Интернет → свойства подключения). В общедоступном профиле эти правила не действуют. Для каждого дополнительного сервера добавьте такие же правила с его портом.

### 12. Запустить панель

В отдельном окне PowerShell (права администратора не нужны):

```powershell
cd 'D:\CS2Tournament\panel'
.\start-panel.ps1 -DataDir 'D:\CS2Tournament\data' -Cs2Path 'D:\CS2Tournament\cs2'
```

Если PowerShell блокирует запуск скрипта, используйте `powershell -NoProfile -ExecutionPolicy Bypass -File .\start-panel.ps1 ...` с теми же параметрами.

- Адрес панели в сети определяется сам и печатается при запуске (строка `Panel URL`). `-PublicUrl` нужен, только чтобы закрепить другой адрес, например имя хоста.
- `-DataDir` — папка с базой `app.db`. Без параметра база будет в `panel\server\data`.

При первом запуске создаётся администратор `admin`, а его случайный пароль **выводится в консоль один раз**. Сразу запишите его. Чтобы задать пароль заранее, перед первым запуском выполните `$env:ADMIN_PASSWORD = 'ваш-пароль'`.

Если пароль потерян, восстановите доступ командой из папки `panel`:

```powershell
$env:DATA_DIR = 'D:\CS2Tournament\data'
npm.cmd run admin -- set-password 'новый-пароль'
```

### 13. Добавить сервер в панель

1. Откройте адрес из строки `Panel URL` (например, `http://192.168.0.4:3000`), войдите как `admin` и смените пароль в разделе «Аккаунт».
2. В разделе «Серверы» добавьте сервер: имя, адрес `auto` (сервер на этом компьютере), порт `27015` и RCON-пароль из шага 9.
3. Нажмите «Проверить». Панель должна показать состояние сервера.
4. Чтобы запускать серверы из панели, укажите в блоке «Запуск серверов на этом компьютере» папку `D:\CS2Tournament\cs2`. Другой вариант — перед запуском панели задать `$env:CS2_PATH = 'D:\CS2Tournament\cs2'`. Подробнее см. в [README.md](README.md#запуск-серверов-из-панели).
5. Проведите тестовый матч до турнира.

### Сервер CS2 на другом компьютере

Панель и игровые серверы могут работать на разных компьютерах одной сети. Соберите плагин на компьютере с панелью командой `npm.cmd run plugin:build`. На компьютере сервера установите Visual C++ Redistributable (шаг 1) и выполните шаги 4–7, затем скопируйте содержимое `plugin-dist\` в `game\csgo` сервера вместо шага 8 и выполните шаги 9–11. Node.js, Git и .NET SDK на компьютере сервера в этом случае не нужны. В панели добавьте такой сервер с IP его компьютера (не `auto`) и проверьте, что с компьютера сервера открывается адрес панели. Если у компьютера с панелью меняется IP, для таких серверов удобнее закрепить его в роутере или задать `PUBLIC_URL`.

### Обновление ручной установки

- **Панель:** остановите её, затем выполните в `D:\CS2Tournament\panel` команды `git pull`, `npm.cmd ci` и `npm.cmd run build` и запустите панель снова. Перед обновлением сделайте копию `data\app.db`.
- **ArenaPro:** остановите сервер и повторите шаг 8.
- **CS2:** остановите сервер, повторите команду SteamCMD из шага 4, затем проверьте `gameinfo.gi` (шаг 7). После крупных обновлений CS2 может понадобиться свежая версия Metamod и CounterStrikeSharp (шаги 5–6).

---

## Официальные источники

- SteamCMD: <https://developer.valvesoftware.com/wiki/SteamCMD>
- Выделенный сервер CS2: <https://developer.valvesoftware.com/wiki/Counter-Strike_2/Dedicated_Servers>
- Metamod:Source: <https://www.sourcemm.net/downloads.php?branch=master>
- CounterStrikeSharp: <https://docs.cssharp.dev/docs/guides/getting-started.html>
- Node.js 24: <https://nodejs.org/dist/latest-v24.x/>
- .NET SDK: <https://dotnet.microsoft.com/download/dotnet/10.0>
- Visual C++ Redistributable: <https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist>
