# Builds the ArenaPro plugin and assembles a package in the CS2 server layout.
#   .\scripts\build-plugin.ps1                      -> builds into plugin-dist\
#   .\scripts\build-plugin.ps1 -DeployTo 'D:\cs2-server\cs2\game\csgo'
# Stop the game server before deploying: a running server locks ArenaPro.dll.
# Keep this file ASCII-only: Windows PowerShell 5.1 reads it in the ANSI code page.
param(
    [string]$DeployTo = ''
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$out = Join-Path $root 'plugin-dist'

if (Test-Path $out) { Remove-Item $out -Recurse -Force }

dotnet publish "$root\plugin\ArenaPro.csproj" -c Release -o "$out\addons\counterstrikesharp\plugins\ArenaPro"
if ($LASTEXITCODE -ne 0) { throw 'dotnet publish failed' }

Copy-Item "$root\plugin\cfg" "$out\cfg" -Recurse

# The plugin creates these server data files itself; shipping them would overwrite local settings on update.
foreach ($f in 'admins.json', 'database.json', 'savednades.json', 'whitelist.cfg') {
    Remove-Item "$out\cfg\ArenaPro\$f" -ErrorAction SilentlyContinue
}

New-Item -ItemType Directory -Force "$out\addons\counterstrikesharp\gamedata" | Out-Null
Copy-Item "$root\plugin\gamedata\arenapro.json" "$out\addons\counterstrikesharp\gamedata\"

Write-Host "Package: $out"

if ($DeployTo) {
    Copy-Item "$out\*" $DeployTo -Recurse -Force
    Write-Host "Deployed to $DeployTo"
}
