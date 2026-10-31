# Запуск панели турниров (сайт + сервер) из этого репозитория одной командой.
# Перед запуском панель пересобирается, поэтому после правок кода всегда работает свежая версия.
# Адрес панели в локальной сети определяется сам при каждом запуске: компьютеру не нужен постоянный IP.
# Пример: .\start-panel.ps1
#         .\start-panel.ps1 -Port 3100 -DataDir 'server\data-live' -Cs2Path 'D:\cs2-server\cs2'
#
# Постоянные настройки этого компьютера лежат в panel.local.json рядом со скриптом (файл не попадает в git):
#   { "Port": 3100, "DataDir": "server\\data-live", "Cs2Path": "D:\\cs2-server\\cs2" }
# Параметры командной строки важнее файла.
param(
    [ValidateRange(0, 65535)][int]$Port = 0,
    # Закрепить адрес панели для игроков и серверов (например, имя хоста вместо IP); по умолчанию определяется сам
    [string]$PublicUrl = '',
    # Папка с базой данных (по умолчанию server\data); относительный путь считается от папки скрипта
    [string]$DataDir = '',
    # Папка серверной CS2 (в ней game\bin\win64\cs2.exe) для серверов, которые панель запускает сама
    [string]$Cs2Path = '',
    # Не пересобирать панель перед запуском
    [switch]$NoBuild
)

$ErrorActionPreference = 'Stop'

$localFile = Join-Path $PSScriptRoot 'panel.local.json'
$local = if (Test-Path -LiteralPath $localFile) { Get-Content -LiteralPath $localFile -Raw -Encoding UTF8 | ConvertFrom-Json } else { $null }
$setting = { param($name) if ($local -and $local.PSObject.Properties[$name]) { $local.$name } else { $null } }
if (-not $Port) { $Port = if (& $setting 'Port') { [int](& $setting 'Port') } else { 3000 } }
if (-not $PublicUrl) { $PublicUrl = [string](& $setting 'PublicUrl') }
if (-not $DataDir) { $DataDir = [string](& $setting 'DataDir') }
if (-not $Cs2Path) { $Cs2Path = [string](& $setting 'Cs2Path') }
$resolve = { param($p) if ([IO.Path]::IsPathRooted($p)) { $p } else { Join-Path $PSScriptRoot $p } }

Push-Location $PSScriptRoot
try {
    # npm.cmd works under the default Windows PowerShell execution policy.
    $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
    $nodeVersion = & node.exe --version
    if ($LASTEXITCODE -ne 0 -or [version]$nodeVersion.TrimStart('v') -lt [version]'24.0.0') { throw 'Node.js 24 or newer is required.' }

    if (-not $NoBuild -or -not (Test-Path 'server\dist\index.js') -or -not (Test-Path 'web\dist\index.html')) {
        & $npm run build
        if ($LASTEXITCODE -ne 0) { throw 'Panel build failed.' }
    }

    $env:PORT = "$Port"
    if ($PublicUrl) { $env:PUBLIC_URL = $PublicUrl } else { Remove-Item Env:PUBLIC_URL -ErrorAction SilentlyContinue }
    if ($DataDir) { $env:DATA_DIR = & $resolve $DataDir }
    if ($Cs2Path) { $env:CS2_PATH = & $resolve $Cs2Path }

    # Адрес панели печатает сама панель при старте (строка "Panel URL")
    if ($env:DATA_DIR) { Write-Host "База: $env:DATA_DIR" }
    & $npm start
    if ($LASTEXITCODE -ne 0) { throw 'Panel exited with an error.' }
} finally {
    Pop-Location
}
