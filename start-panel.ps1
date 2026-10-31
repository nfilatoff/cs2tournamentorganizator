# Запуск панели турниров (сайт + сервер) из этого репозитория одной командой.
# Перед запуском панель пересобирается, поэтому после правок кода всегда работает свежая версия.
# Пример: .\start-panel.ps1
#         .\start-panel.ps1 -Port 3100 -PublicUrl 'http://192.168.0.4:3100' -DataDir 'D:\cs2tournamentorganizator\server\data-live'
#
# Постоянные настройки этого компьютера лежат в panel.local.json рядом со скриптом (файл не попадает в git):
#   { "Port": 3100, "PublicUrl": "http://192.168.0.4:3100", "DataDir": "server\\data-live", "Cs2Path": "D:\\cs2-server\\cs2" }
# Параметры командной строки важнее файла.
param(
    [ValidateRange(0, 65535)][int]$Port = 0,
    # Адрес панели, по которому до неё достучатся игровые серверы и игроки (IP этого ПК в сети)
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
if (-not $Port) { $Port = if ($local -and $local.Port) { [int]$local.Port } else { 3000 } }
if (-not $PublicUrl -and $local -and $local.PublicUrl) { $PublicUrl = $local.PublicUrl }
if (-not $PublicUrl) { $PublicUrl = "http://192.168.0.4:$Port" }
if (-not $DataDir -and $local -and $local.DataDir) { $DataDir = $local.DataDir }
if (-not $Cs2Path -and $local -and $local.Cs2Path) { $Cs2Path = $local.Cs2Path }
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
    $env:PUBLIC_URL = $PublicUrl
    if ($DataDir) { $env:DATA_DIR = & $resolve $DataDir }
    if ($Cs2Path) { $env:CS2_PATH = & $resolve $Cs2Path }

    Write-Host "Панель: $PublicUrl"
    if ($env:DATA_DIR) { Write-Host "База: $env:DATA_DIR" }
    & $npm start
    if ($LASTEXITCODE -ne 0) { throw 'Panel exited with an error.' }
} finally {
    Pop-Location
}
