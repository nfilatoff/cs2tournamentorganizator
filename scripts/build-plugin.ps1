# Builds the ArenaPro plugin and assembles a package in the CS2 server layout.
#   .\scripts\build-plugin.ps1                      -> builds into plugin-dist\
#   .\scripts\build-plugin.ps1 -DeployTo 'D:\cs2-server\cs2\game\csgo'
# Stop the game server before deploying: a running server locks ArenaPro.dll.
# Keep this file ASCII-only: Windows PowerShell 5.1 reads it in the ANSI code page.
param(
    [string]$DeployTo = '',
    # Reuse an already restored dependency graph (useful for offline builds).
    [switch]$NoRestore
)

$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$out = Join-Path $root 'plugin-dist'
$stage = Join-Path $root ('.plugin-build-' + [guid]::NewGuid().ToString('N'))

foreach ($directory in @($out, $stage)) {
    if (-not [IO.Path]::GetFullPath($directory).StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe package output path.' }
    if ((Test-Path -LiteralPath $directory) -and ((Get-Item -LiteralPath $directory -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Package output must not be a junction or symlink.' }
}

try {
    $publishArgs = @('publish', "$root\plugin\ArenaPro.csproj", '-c', 'Release', '-o', "$stage\addons\counterstrikesharp\plugins\ArenaPro")
    if ($NoRestore) { $publishArgs += '--no-restore' }
    & dotnet @publishArgs
    if ($LASTEXITCODE -ne 0) { throw 'dotnet publish failed; the previous plugin-dist package has been preserved.' }

    Copy-Item -LiteralPath "$root\plugin\cfg" -Destination "$stage\cfg" -Recurse

    # The plugin creates these server data files itself; do not overwrite local settings.
    foreach ($f in 'admins.json', 'database.json', 'savednades.json', 'whitelist.cfg') {
        Remove-Item -LiteralPath "$stage\cfg\ArenaPro\$f" -ErrorAction SilentlyContinue
    }

    New-Item -ItemType Directory -Force "$stage\addons\counterstrikesharp\gamedata" | Out-Null
    Copy-Item -LiteralPath "$root\plugin\gamedata\arenapro.json" -Destination "$stage\addons\counterstrikesharp\gamedata\"

    # Replace a previous package only after publish and packaging have succeeded.
    if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Recurse -Force }
    Move-Item -LiteralPath $stage -Destination $out
} finally {
    if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
}

Write-Host "Package: $out"

if ($DeployTo) {
    foreach ($item in Get-ChildItem -LiteralPath $out) {
        Copy-Item -LiteralPath $item.FullName -Destination $DeployTo -Recurse -Force
    }
    Write-Host "Deployed to $DeployTo"
}
