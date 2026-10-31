# Как обновлять ArenaPro с оригинала (MatchZy)

Плагин лежит в папке `plugin/` этого репозитория. Он получен из MatchZy автоматическим переименованием,
поэтому обновление делается не слиянием (были бы тысячи конфликтующих строк), а повтором переименования на новой версии оригинала.
Наши отличия от «чистого» переименования перечислены в [PATCHES.md](../PATCHES.md).

1. Скачайте нужную версию оригинала во временную папку (тег смотрите на странице релизов MatchZy):

   ```powershell
   git clone --branch <тег> https://github.com/shobhit-pathak/MatchZy.git $env:TEMP\matchzy-new
   ```

2. Примените переименование к скачанной копии (она остаётся отдельной, ваш `plugin/` не меняется):

   ```powershell
   node plugin\tools\rename.mjs $env:TEMP\matchzy-new
   ```

3. Сравните результат с `plugin/` и перенесите изменения (например, `git diff --no-index plugin $env:TEMP\matchzy-new`
   или любой инструмент сравнения папок). Не копируйте папку `.git`, не трогайте `plugin/NOTICE.md`, `plugin/tools/` и `plugin/PATCHES.md`.
4. Заново внесите наши правки из `PATCHES.md`.
5. Проверьте: `npm run plugin:test`, затем `npm run plugin:build`, затем запустите на тестовом сервере, подключитесь игроком и сыграйте матч.
6. Версию `CounterStrikeSharp.API` в `plugin/ArenaPro.csproj` держите равной версии CounterStrikeSharp, установленной на серверах.

Посмотреть, что изменилось в оригинале между версиями, можно так:

```powershell
git fetch upstream-matchzy --tags
git log --oneline <старый тег>..<новый тег>
```

(`upstream-matchzy` — удалённый репозиторий оригинала, он уже добавлен.)

Файл `plugin/LICENSE` (MIT, авторство оригинала) и `plugin/NOTICE.md` менять и удалять нельзя.
