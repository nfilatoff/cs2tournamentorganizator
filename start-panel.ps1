# Запуск панели турниров (сайт + сервер) одной командой.
# Пример: .\start-panel.ps1
#         .\start-panel.ps1 -Port 3100 -PublicUrl 'http://192.168.0.4:3100' -DataDir 'D:\cs2tournamentorganizator\server\data-live'
param(
    [ValidateRange(1, 65535)][int]$Port = 3000,
    # Адрес панели, по которому до неё достучатся игровые серверы и игроки (IP этого ПК в сети)
    [string]$PublicUrl = '',
    # Папка с базой данных (по умолчанию server\data)
    [string]$DataDir = ''
)

$ErrorActionPreference = 'Stop'

if (-not $PublicUrl) { $PublicUrl = "http://192.168.0.4:$Port" }

Push-Location $PSScriptRoot
try {
    # npm.cmd works under the default Windows PowerShell execution policy.
    $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
    $nodeVersion = & node.exe --version
    if ($LASTEXITCODE -ne 0 -or [version]$nodeVersion.TrimStart('v') -lt [version]'24.0.0') { throw 'Node.js 24 or newer is required.' }

    if (-not (Test-Path 'server\dist\index.js') -or -not (Test-Path 'web\dist\index.html')) {
        & $npm run build
        if ($LASTEXITCODE -ne 0) { throw 'Panel build failed.' }
    }

    $env:PORT = "$Port"
    $env:PUBLIC_URL = $PublicUrl
    if ($DataDir) { $env:DATA_DIR = $DataDir }

    Write-Host "Панель: $PublicUrl"
    & $npm start
    if ($LASTEXITCODE -ne 0) { throw 'Panel exited with an error.' }
} finally {
    Pop-Location
}
