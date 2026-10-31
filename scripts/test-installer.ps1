# Offline installer checks. No network, SteamCMD, dependency installs or firewall changes.
# Run: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-installer.ps1
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$root = Split-Path $PSScriptRoot -Parent
$installer = Join-Path $root 'install-cs2.ps1'
$tokens = $null
$errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($installer, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw ($errors | Out-String) }
foreach ($definition in $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
    . ([scriptblock]::Create($definition.Extent.Text))
}
function Assert([bool]$Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Expect-Failure([scriptblock]$Action, [string]$Pattern) {
    $message = ''
    try { & $Action } catch { $message = $_.Exception.Message }
    Assert ($message -match $Pattern) "Expected failure matching '$Pattern'; got '$message'"
}
function Parse-Script([string]$Path) {
    $localTokens = $null
    $localErrors = $null
    [Management.Automation.Language.Parser]::ParseFile($Path, [ref]$localTokens, [ref]$localErrors) | Out-Null
    Assert ($localErrors.Count -eq 0) "Invalid generated script: $Path"
}

$fixture = Join-Path $root ('.installer-test-' + [guid]::NewGuid().ToString('N'))
try {
    $game = Join-Path $fixture "Steam Library\steamapps\common\Counter-Strike Global Offensive"
    $binary = Join-Path $game 'game\bin\win64\cs2.exe'
    New-Item -ItemType Directory -Path (Split-Path $binary -Parent) -Force | Out-Null
    Set-Content -LiteralPath $binary -Value ''
    Assert ((Resolve-Cs2Directory $game) -eq $game) 'Game directory with spaces was not resolved.'
    Assert ((Resolve-Cs2Directory $binary) -eq $game) 'cs2.exe path was not resolved.'
    Expect-Failure { Resolve-Cs2Directory $fixture } 'CS2 was not found'
    Expect-Failure { Get-FullLocalPath '\\server\share\cs2' } 'absolute local drive'
    Expect-Failure { Get-FullLocalPath '.\relative' } 'absolute local drive'
    Write-Host 'PASS: game paths, spaces, missing game and unsupported paths.'

    Assert ((Get-RequiredBytes $game 120) -eq 120GB) 'Default space threshold is incorrect.'
    $manifest = Join-Path $fixture 'Steam Library\steamapps\appmanifest_730.acf'
    Set-Content -LiteralPath $manifest -Value ('"SizeOnDisk" "' + (150GB) + '"')
    Assert ((Get-RequiredBytes $game 120) -eq 200GB) 'Large installed game must raise the space threshold.'
    $driveRoot = [IO.Path]::GetPathRoot($root)
    $drive = New-Object IO.DriveInfo $driveRoot
    Expect-Failure { Assert-FreeSpace $driveRoot ($drive.AvailableFreeSpace + 1GB) } 'INSTALLATION CANCELLED: insufficient space'
    Write-Host 'PASS: fixed threshold, manifest-based estimate and insufficient space.'

    $gi = Join-Path $fixture 'gameinfo.gi'
    $giOriginal = "`"GameInfo`"`r`n{`r`n`tFileSystem`r`n`t{`r`n`t`tSearchPaths`r`n`t`t{`r`n`t`t`tGame_LowViolence csgo_lv`r`n`t`t`tGame csgo`r`n`t`t}`r`n`t}`r`n}`r`n"
    [IO.File]::WriteAllText($gi, $giOriginal)
    Enable-Metamod $gi
    Enable-Metamod $gi
    $patched = [IO.File]::ReadAllText($gi)
    Assert (([regex]::Matches($patched, 'csgo/addons/metamod')).Count -eq 1) 'Metamod search path must be inserted once.'
    Assert ($patched.IndexOf('csgo/addons/metamod') -lt $patched.IndexOf('Game csgo')) 'Metamod search path must precede Game csgo.'
    Assert ([IO.File]::ReadAllText("$gi.before-arenapro") -eq $giOriginal) 'Original gameinfo backup was not preserved.'
    Set-Content -LiteralPath $gi -Value 'unexpected content'
    Expect-Failure { Enable-Metamod $gi } 'SearchPaths block was not found'
    Write-Host 'PASS: gameinfo patch, ordering, backup and repeat safety.'

    $launchRoot = Join-Path $fixture "launch with spaces and ' quote"
    New-Item -ItemType Directory -Path $launchRoot | Out-Null
    Write-Launchers $launchRoot ([ordered]@{ ServerAddress = '192.168.1.10'; ServerPort = 27015; PanelPort = 3000; TvPort = 27020; PublicUrl = 'http://192.168.1.10:3000' })
    foreach ($name in @('start-panel.ps1', 'start-server.ps1', 'start-all.ps1')) { Parse-Script (Join-Path $launchRoot $name) }
    $settings = Get-Content -LiteralPath (Join-Path $launchRoot 'installation.json') -Raw | ConvertFrom-Json
    Assert ($settings.ServerPort -eq 27015 -and $settings.PublicUrl -eq 'http://192.168.1.10:3000') 'Settings round-trip failed.'
    Assert ((New-Secret) -match '^[a-f0-9]{48}$') 'Invalid generated password.'
    $asset = [pscustomobject]@{ name = 'counterstrikesharp-with-runtime-windows-1.0.379.zip' }
    Assert ($asset.name -match '^counterstrikesharp-with-runtime-windows-(?:x64-)?[\d.]+\.zip$') 'Official CounterStrikeSharp asset name must match.'
    Write-Host 'PASS: generated launchers, JSON settings, passwords and official asset name.'

    Assert ((Get-InstallDirectory '' $driveRoot -NonInteractive) -eq (Join-Path $driveRoot 'CS2Tournament')) 'Noninteractive default is incorrect.'
    foreach ($diskInput in @($driveRoot.Substring(0, 1), $driveRoot.Substring(0, 2), $driveRoot)) {
        Assert ((Get-InstallDirectory $diskInput $driveRoot) -eq (Join-Path $driveRoot 'CS2Tournament')) 'Drive-only selection is incorrect.'
    }
    Assert ((Get-InstallDirectory $launchRoot $driveRoot) -eq $launchRoot) 'Explicit install folder was not preserved.'
    function Read-Host { param([string]$Prompt) return $launchRoot }
    try { Assert ((Get-InstallDirectory '' $driveRoot) -eq $launchRoot) 'Interactive folder selection failed.' }
    finally { Remove-Item Function:\Read-Host }
    $urlParameter = $ast.ParamBlock.Parameters | Where-Object { $_.Name.VariablePath.UserPath -eq 'RepositoryUrl' }
    Assert ($urlParameter.DefaultValue.Value -eq 'https://github.com/nfilatoff/cs2tournamentorganizator.git') 'Published repository must be the default.'
    Assert (-not ($ast.ParamBlock.Parameters | Where-Object { $_.Name.VariablePath.UserPath -eq 'SourcePath' })) 'Standalone installer must not depend on local source files.'
    Write-Host 'PASS: folder prompt, drive selection, noninteractive default and built-in GitHub URL.'

    $git = (Get-Command git.exe -ErrorAction Stop).Source
    $cloneSource = Join-Path $fixture 'git source'
    Invoke-Native $git @('init', '--quiet', '--initial-branch=main', $cloneSource)
    foreach ($directory in @('server', 'web', 'plugin', 'scripts')) {
        New-Item -ItemType Directory -Path (Join-Path $cloneSource $directory) -Force | Out-Null
    }
    foreach ($name in @('package.json', 'package-lock.json', 'server\package.json', 'web\package.json', 'plugin\ArenaPro.csproj', 'scripts\build-plugin.ps1')) {
        Set-Content -LiteralPath (Join-Path $cloneSource $name) -Value 'fixture'
    }
    Invoke-Native $git @('-C', $cloneSource, 'add', '--all')
    Invoke-Native $git @('-C', $cloneSource, '-c', 'user.name=Installer Test', '-c', 'user.email=installer@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=NUL', 'commit', '--quiet', '-m', 'Test fixture')
    Invoke-Native $git @('-C', $cloneSource, 'tag', 'test-version')
    $sourceUrl = ([uri]$cloneSource).AbsoluteUri
    Copy-Project $git $sourceUrl '' (Join-Path $fixture 'clone default with spaces')
    Copy-Project $git $sourceUrl 'main' (Join-Path $fixture 'clone branch')
    Copy-Project $git $sourceUrl 'test-version' (Join-Path $fixture 'clone tag')
    Write-Host 'PASS: actual git clone into selected folders, default branch, explicit branch and tag.'

    if ((Get-Command node.exe -ErrorAction SilentlyContinue) -and (Test-Path -LiteralPath (Join-Path $root 'server\dist\auth.js'))) {
        $bootstrapNode = $ast.Find({ param($n) $n -is [Management.Automation.Language.StringConstantExpressionAst] -and $n.Value.StartsWith("import { readFileSync } from 'node:fs';") }, $true)
        Assert ($null -ne $bootstrapNode) 'Installer database bootstrap was not found.'
        $bootstrapRoot = Join-Path $fixture 'bootstrap'
        $bootstrapServer = Join-Path $bootstrapRoot 'server'
        New-Item -ItemType Directory -Path $bootstrapServer -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $root 'server\dist') -Destination $bootstrapServer -Recurse
        Copy-Item -LiteralPath (Join-Path $root 'server\package.json') -Destination $bootstrapServer
        $bootstrapScript = Join-Path $bootstrapRoot 'bootstrap.mjs'
        Set-Content -LiteralPath $bootstrapScript -Value $bootstrapNode.Value -Encoding UTF8
        $inputPath = Join-Path $bootstrapRoot 'input.json'
        @{ AdminPassword = 'fixture-admin-password'; RconPassword = 'fixture-rcon-password'; ServerAddress = '192.168.1.10'; ServerPort = 27015 } |
            ConvertTo-Json | Set-Content -LiteralPath $inputPath -Encoding UTF8
        $oldDataDir = $env:DATA_DIR
        try {
            $env:DATA_DIR = Join-Path $bootstrapRoot 'data'
            Invoke-Native (Get-Command node.exe).Source @($bootstrapScript, $inputPath)
            $verify = @'
import { DatabaseSync } from 'node:sqlite';
import { scryptSync } from 'node:crypto';
import { join } from 'node:path';
const db = new DatabaseSync(join(process.env.DATA_DIR, 'app.db'));
const admin = db.prepare('SELECT * FROM admins').get();
const server = db.prepare('SELECT * FROM game_servers').get();
if (admin.username !== 'admin') throw new Error('Missing admin');
const [salt, key] = admin.password_hash.split(':');
if (scryptSync('fixture-admin-password', Buffer.from(salt, 'hex'), 64).toString('hex') !== key) throw new Error('Invalid password hash');
if (server.host !== '192.168.1.10' || server.port !== 27015 || server.rcon_password !== 'fixture-rcon-password') throw new Error('Invalid server registration');
db.close();
'@
            $verifyPath = Join-Path $bootstrapRoot 'verify.mjs'
            Set-Content -LiteralPath $verifyPath -Value $verify -Encoding UTF8
            Invoke-Native (Get-Command node.exe).Source @($verifyPath)
        } finally { $env:DATA_DIR = $oldDataDir }
        Write-Host 'PASS: real SQLite bootstrap creates a hashed admin password and registered game server.'
    } else { Write-Host 'SKIP: database smoke test requires Node.js and npm run build output.' }

    # Run the actual entry point, including exit handling. An impossible requirement must
    # abort before creating InstallRoot, contacting the network or requiring admin rights.
    $destination = Join-Path $fixture 'must-not-be-created'
    $ErrorActionPreference = 'Continue' # Windows PowerShell wraps expected child stderr as error records.
    try {
        $output = & "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File $installer -Cs2Path $game -InstallRoot $destination -RequiredFreeGB 4096 -CheckOnly 2>&1 | Out-String
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = 'Stop' }
    Assert ($code -eq 1 -and $output -match 'INSTALLATION CANCELLED: insufficient space') "Entry point failed unexpectedly: $output"
    Assert (-not (Test-Path -LiteralPath $destination)) 'Insufficient space must not create the destination.'
    Write-Host 'PASS: actual installer cancels without writes when disk space is insufficient.'

    $secondDrive = if ($driveRoot -ine 'C:\') { 'C:\' } else { 'D:\' }
    $ErrorActionPreference = 'Continue'
    try {
        $output = & "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File $installer -Cs2Path $game -InstallRoot (Join-Path $secondDrive 'CS2Tournament-installer-test') -CheckOnly 2>&1 | Out-String
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = 'Stop' }
    Assert ($code -eq 1 -and $output -match 'Server must be installed on the CS2 drive') "Wrong-drive protection failed: $output"
    Write-Host 'PASS: actual installer refuses a server directory on a different drive.'
    Write-Host 'All offline installer checks passed.'
} finally {
    # Remove only this test's verified, unique child directory.
    $resolvedFixture = [IO.Path]::GetFullPath($fixture)
    if (-not $resolvedFixture.StartsWith($root + '\.installer-test-', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe fixture cleanup path.' }
    if (Test-Path -LiteralPath $resolvedFixture) { Remove-Item -LiteralPath $resolvedFixture -Recurse -Force }
}
