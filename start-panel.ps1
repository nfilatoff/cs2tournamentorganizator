# Запуск панели турниров (сайт + сервер) одной командой.
# Пример: .\start-panel.ps1
#         .\start-panel.ps1 -Port 3100 -PublicUrl 'http://192.168.0.4:3100' -DataDir 'D:\cs2tournamentorganizator\server\data-live'
param(
    [int]$Port = 3000,
    # Адрес панели, по которому до неё достучатся игровые серверы и игроки (IP этого ПК в сети)
    [string]$PublicUrl = '',
    # Папка с базой данных (по умолчанию server\data)
    [string]$DataDir = ''
)

Set-Location $PSScriptRoot

if (-not $PublicUrl) { $PublicUrl = "http://192.168.0.4:$Port" }

# Собрать, если ещё не собрано
if (-not (Test-Path 'server\dist\index.js') -or -not (Test-Path 'web\dist\index.html')) {
    npm run build
}

$env:PORT = "$Port"
$env:PUBLIC_URL = $PublicUrl
if ($DataDir) { $env:DATA_DIR = $DataDir }

Write-Host "Панель: $PublicUrl"
npm start
