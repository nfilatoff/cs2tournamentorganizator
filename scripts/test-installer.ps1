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
# PowerShell variable names ignore case: assigning $host, $pid, $input... fails at run time, only on the code path reached
# ($null = ... is the usual way to discard output and is allowed).
$reserved = @('host', 'pid', 'pshome', 'shellid', 'home', 'input', 'args', 'error', 'true', 'false', 'this', 'executioncontext')
$misused = @($ast.FindAll({ param($node) $node -is [Management.Automation.Language.AssignmentStatementAst] -and $node.Left -is [Management.Automation.Language.VariableExpressionAst] }, $true) |
    Where-Object { $_.Left.VariablePath.UserPath.ToLowerInvariant() -in $reserved } | ForEach-Object { "line $($_.Extent.StartLineNumber): $($_.Extent.Text)" })
if ($misused.Count) { throw "Installer assigns automatic PowerShell variables: $($misused -join '; ')" }
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
    $unique = @(Select-UniqueWindowsPath @($game.ToLowerInvariant(), $game.ToUpperInvariant(), ($game.Replace('\', '/') + '/')))
    Assert ($unique.Count -eq 1) 'The same Windows game path must not count as multiple installations.'
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
    $autoRoot = Join-Path $fixture 'launch auto'
    New-Item -ItemType Directory -Path $autoRoot | Out-Null
    Write-Launchers $autoRoot ([ordered]@{ ServerAddress = 'auto'; ServerPort = 27015; PanelPort = 3000; TvPort = 27020; PublicUrl = '' })
    foreach ($name in @('start-panel.ps1', 'start-server.ps1')) { Parse-Script (Join-Path $autoRoot $name) }
    $autoServer = Get-Content -LiteralPath (Join-Path $autoRoot 'start-server.ps1') -Raw
    $autoPanel = Get-Content -LiteralPath (Join-Path $autoRoot 'start-panel.ps1') -Raw
    Assert ($autoServer -match "-ne 'auto'" -and $autoPanel -match 'if \(\$settings\.PublicUrl\)') 'Auto-address launchers must skip -ip and PUBLIC_URL.'
    Write-Host 'PASS: auto-address launchers pass no fixed IP or panel URL.'
    $clientRoot = Join-Path $fixture "client with spaces\Counter-Strike Global Offensive"
    foreach ($file in @('game\bin\win64\cs2.exe', 'game\csgo\pak01_000.vpk', 'game\csgo\console.log', 'game\csgo\match.dem', 'content\csgo\big.vmat')) {
        New-Item -ItemType File -Path (Join-Path $clientRoot $file) -Force | Out-Null
        Set-Content -LiteralPath (Join-Path $clientRoot $file) -Value 'data'
    }
    $copyRoot = Join-Path $fixture 'server copy\cs2'
    $copyLog = Join-Path $fixture 'cs2-copy.log'
    $copyExit = Copy-Cs2Client $clientRoot $copyRoot $copyLog
    $copied = @(Get-ChildItem -LiteralPath $copyRoot -File -Recurse | ForEach-Object { $_.FullName.Substring($copyRoot.Length) }) | Sort-Object
    Assert ($copyExit -lt 8 -and ($copied -join ',') -eq '\game\bin\win64\cs2.exe,\game\csgo\pak01_000.vpk' -and (Test-Path -LiteralPath $copyLog)) "Client copy failed: exit $copyExit, files $($copied -join ',')"
    Assert (@(Get-ClientCopyPlan $clientRoot $copyRoot).Count -eq 0) 'Copied files must be recognized as complete.'
    Set-Content -LiteralPath (Join-Path $clientRoot 'game\csgo\pak01_000.vpk') -Value 'changed data'
    $plan = @(Get-ClientCopyPlan $clientRoot $copyRoot)
    Assert ($plan.Count -eq 1 -and $plan[0].Path -like '*pak01_000.vpk') 'Only the changed file must be planned for copying.'
    Assert ((Copy-Cs2Client $clientRoot $copyRoot $copyLog) -lt 8 -and @(Get-ClientCopyPlan $clientRoot $copyRoot).Count -eq 0) 'Repeated client copy must bring the changed file over.'
    Write-Host 'PASS: client copy skips content, demos and logs, and its progress plan tracks completed and changed files.'
    $launcher = Join-Path $launchRoot 'start-server.ps1'
    Add-Content -LiteralPath $launcher -Value '# keep local launcher changes'
    $launcherHash = (Get-FileHash -LiteralPath $launcher).Hash
    Remove-Item -LiteralPath (Join-Path $launchRoot 'start-panel.ps1')
    Write-Launchers $launchRoot $settings -MissingOnly
    Assert ((Get-FileHash -LiteralPath $launcher).Hash -eq $launcherHash) 'Repair must preserve an existing launcher.'
    Assert (Test-Path -LiteralPath (Join-Path $launchRoot 'start-panel.ps1')) 'Missing launcher was not repaired.'
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
    foreach ($directory in @('server\src', 'web\src', 'plugin\gamedata', 'scripts')) {
        New-Item -ItemType Directory -Path (Join-Path $cloneSource $directory) -Force | Out-Null
    }
    foreach ($name in @('package.json', 'package-lock.json', 'server\package.json', 'server\src\index.ts', 'web\package.json', 'web\index.html', 'web\src\main.tsx', 'plugin\ArenaPro.csproj', 'plugin\gamedata\arenapro.json', 'scripts\build-plugin.ps1')) {
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
    # -Update on the shallow clone: up to date, a new commit, local changes, and a clone on a tag.
    $updated = Join-Path $fixture 'clone branch'
    Assert (-not (Update-Project $git $updated '')) 'An up-to-date clone must report no change.'
    Set-Content -LiteralPath (Join-Path $cloneSource 'web\index.html') -Value 'fixture v2'
    Invoke-Native $git @('-C', $cloneSource, '-c', 'user.name=Installer Test', '-c', 'user.email=installer@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=NUL', 'commit', '--quiet', '--all', '-m', 'Fixture v2')
    Assert (Update-Project $git $updated '') 'A new commit must update the clone.'
    Assert ((Get-Content -LiteralPath (Join-Path $updated 'web\index.html') -Raw).Trim() -eq 'fixture v2') 'The updated clone must contain the new commit.'
    Set-Content -LiteralPath (Join-Path $updated 'web\index.html') -Value 'local edit'
    Expect-Failure { Update-Project $git $updated '' } 'local changes'
    Assert ((Get-Content -LiteralPath (Join-Path $updated 'web\index.html') -Raw).Trim() -eq 'local edit') 'A refused update must keep local changes.'
    Expect-Failure { Update-Project $git (Join-Path $fixture 'clone tag') '' } 'RepositoryBranch'
    Assert (Update-Project $git (Join-Path $fixture 'clone tag') 'main') 'A tag clone must update to an explicit branch.'
    Write-Host 'PASS: -Update pulls new commits into the shallow clone and refuses to overwrite local changes.'
    Assert (Test-ProjectComplete $cloneSource) 'Complete source fixture was not detected.'
    Remove-Item -LiteralPath (Join-Path $cloneSource 'plugin\ArenaPro.csproj')
    Assert (-not (Test-ProjectComplete $cloneSource)) 'A partial clone must not be reported as complete.'

    $partialNpm = Join-Path $fixture 'partial npm'
    New-Item -ItemType Directory -Path (Join-Path $partialNpm 'node_modules') -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $partialNpm 'package-lock.json') -Value '{"packages":{}}'
    Assert (-not (Test-NpmComplete $partialNpm)) 'An interrupted npm install must not be accepted.'
    foreach ($name in @('node_modules\typescript\bin\tsc', 'node_modules\vite\bin\vite.js', 'node_modules\@esbuild\win32-x64\esbuild.exe')) {
        $path = Join-Path $partialNpm $name
        New-Item -ItemType Directory -Path (Split-Path $path -Parent) -Force | Out-Null
        Set-Content -LiteralPath $path -Value 'fixture'
    }
    Set-Content -LiteralPath (Join-Path $partialNpm 'package-lock.json') -Value '{"packages":{"":{"name":"fixture"},"node_modules/server":{"resolved":"server","link":true}}}'
    [IO.File]::WriteAllText((Join-Path $partialNpm 'node_modules\.installer-lock.sha256'), (Get-FileHash -LiteralPath (Join-Path $partialNpm 'package-lock.json') -Algorithm SHA256).Hash)
    Assert (Test-NpmComplete $partialNpm) 'A completed npm install with workspace links must be accepted.'
    Remove-Item -LiteralPath (Join-Path $partialNpm 'node_modules\vite\bin\vite.js')
    Assert (-not (Test-NpmComplete $partialNpm)) 'Missing build tools must trigger npm repair even with a completion marker.'
    Assert ((Get-RepairSpaceBytes $game 120 (Join-Path $fixture 'server') $true $false) -eq 8GB) 'Repairing installed CS2 must not require a new 120 GiB download.'
    Assert ((Get-RepairSpaceBytes $game 120 (Join-Path $fixture 'server') $true $true) -eq 20GB) 'Updating installed CS2 must use the update reserve.'
    Write-Host 'PASS: interrupted project/npm detection and repair/update disk-space estimates.'

    $cleanupRoot = Join-Path $fixture 'cleanup-root'
    $outside = Join-Path $fixture 'outside-cleanup-root'
    New-Item -ItemType Directory -Path $cleanupRoot, $outside | Out-Null
    $sentinel = Join-Path $outside 'keep.txt'
    Set-Content -LiteralPath $sentinel -Value 'must survive'
    $junction = Join-Path $cleanupRoot 'junction'
    New-Item -ItemType Junction -Path $junction -Target $outside | Out-Null
    try {
        Expect-Failure { Remove-InsideRoot $cleanupRoot (Join-Path $junction 'keep.txt') } 'junction/symlink'
        Expect-Failure { Assert-NoReparsePoint $cleanupRoot $cleanupRoot } 'junction/symlink'
        Expect-Failure { Assert-NoReparsePoint $cleanupRoot $cleanupRoot -AllowInternalLinks } 'junction/symlink'
        Assert (Test-Path -LiteralPath $sentinel) 'Cleanup followed a junction outside the install root.'
    } finally { [IO.Directory]::Delete($junction) }
    $inside = Join-Path $cleanupRoot 'workspace'
    New-Item -ItemType Directory -Path $inside | Out-Null
    New-Item -ItemType Junction -Path $junction -Target $inside | Out-Null
    try {
        Assert-NoReparsePoint $cleanupRoot $cleanupRoot -AllowInternalLinks
        Expect-Failure { Remove-InsideRoot $cleanupRoot $junction } 'junction/symlink'
    } finally { [IO.Directory]::Delete($junction) }
    Write-Host 'PASS: cleanup refuses junctions and preserves external files.'
    $configDir = Join-Path $fixture 'preserved config'
    New-Item -ItemType Directory -Path $configDir | Out-Null
    $configFile = Join-Path $configDir 'core.json'
    Set-Content -LiteralPath $configFile -Value 'existing settings'
    $configHash = (Get-FileHash -LiteralPath $configFile).Hash
    Invoke-WithPreservedFiles @($configDir) { Set-Content -LiteralPath $configFile -Value 'archive defaults' }
    Assert ((Get-FileHash -LiteralPath $configFile).Hash -eq $configHash) 'Framework repair overwrote existing settings.'
    Expect-Failure { Invoke-WithPreservedFiles @($configDir) { Set-Content -LiteralPath $configFile -Value 'partial extract'; throw 'simulated extraction failure' } } 'simulated extraction failure'
    Assert ((Get-FileHash -LiteralPath $configFile).Hash -eq $configHash) 'Failed extraction lost existing settings.'
    Write-Host 'PASS: existing plugin/framework settings survive repair and extraction failures.'

    & {
        $mockProgram = 'D:\Fixture\node.exe'
        $mockEnabled = 'True'
        function Get-NetFirewallRule { param($Name) [pscustomobject]@{ Enabled = $mockEnabled; Action = 'Allow'; Direction = 'Inbound'; Profile = 'Domain, Private' } }
        function Get-NetFirewallApplicationFilter { param([Parameter(ValueFromPipeline)]$InputObject) process { [pscustomobject]@{ Program = $mockProgram } } }
        function Get-NetFirewallPortFilter { param([Parameter(ValueFromPipeline)]$InputObject) process { [pscustomobject]@{ LocalPort = '3000'; Protocol = 'TCP' } } }
        function Get-NetFirewallAddressFilter { param([Parameter(ValueFromPipeline)]$InputObject) process { [pscustomobject]@{ RemoteAddress = 'LocalSubnet' } } }
        Assert (Test-FirewallRule 'fixture' 'd:\fixture\node.exe' 3000 'TCP') 'Matching firewall rule was not detected.'
        $mockProgram = 'D:\Other installation\node.exe'
        Assert (-not (Test-FirewallRule 'fixture' 'D:\Fixture\node.exe' 3000 'TCP')) 'Same-named firewall rule for another executable must not be accepted.'
        $mockProgram = 'D:\Fixture\node.exe'
        $mockEnabled = 'False'
        Assert (-not (Test-FirewallRule 'fixture' 'D:\Fixture\node.exe' 3000 'TCP')) 'Disabled firewall rule must not be accepted.'
    }
    Write-Host 'PASS: firewall matching rejects disabled and unrelated same-named rules (mocked; no firewall changes).'

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
            $dbPath = Join-Path $env:DATA_DIR 'app.db'
            $dbFilesBefore = @(Get-ChildItem -LiteralPath $env:DATA_DIR -File | ForEach-Object { $_.Name + ':' + (Get-FileHash -LiteralPath $_.FullName).Hash }) -join '|'
            Assert (Test-PanelDatabase (Get-Command node.exe).Source $dbPath '192.168.1.10' 27015) 'Initialized panel database was not detected.'
            $dbFilesAfter = @(Get-ChildItem -LiteralPath $env:DATA_DIR -File | ForEach-Object { $_.Name + ':' + (Get-FileHash -LiteralPath $_.FullName).Hash }) -join '|'
            Assert ($dbFilesBefore -eq $dbFilesAfter) 'Database check must not change the database or leave journal files.'
            $mismatchConfig = Join-Path $bootstrapRoot 'mismatch.cfg'
            Set-Content -LiteralPath $mismatchConfig -Value 'rcon_password "different-password"'
            Assert (-not (Test-PanelDatabase (Get-Command node.exe).Source $dbPath '192.168.1.10' 27015 $mismatchConfig)) 'Mismatched RCON config must not be reported healthy.'
            # Retrying with different generated candidates must preserve existing accounts and RCON.
            @{ AdminPassword = 'replacement-must-not-be-used'; RconPassword = 'replacement-rcon'; ServerAddress = '192.168.1.10'; ServerPort = 27015 } |
                ConvertTo-Json | Set-Content -LiteralPath $inputPath -Encoding UTF8
            Invoke-Native (Get-Command node.exe).Source @($bootstrapScript, $inputPath)
            Invoke-Native (Get-Command node.exe).Source @($verifyPath)

            # Fail AFTER database inserts by making the credentials directory unavailable.
            # The file/schema remains, but the inserts must roll back and retry must repair it.
            $env:DATA_DIR = Join-Path $bootstrapRoot 'interrupted-data'
            $credentialFile = Join-Path $bootstrapRoot 'missing-dir\credentials.txt'
            @{ AdminPassword = 'fixture-admin-password'; RconPassword = 'fixture-rcon-password'; ServerAddress = '192.168.1.10'; ServerPort = 27015; CredentialsPath = $credentialFile; PublicUrl = 'http://192.168.1.10:3000' } |
                ConvertTo-Json | Set-Content -LiteralPath $inputPath -Encoding UTF8
            $ErrorActionPreference = 'Continue'
            try { & (Get-Command node.exe).Source $bootstrapScript $inputPath 2>$null; $bootstrapCode = $LASTEXITCODE }
            finally { $ErrorActionPreference = 'Stop' }
            Assert ($bootstrapCode -ne 0) 'Expected the simulated credential-write failure.'
            $interruptedDb = Join-Path $env:DATA_DIR 'app.db'
            Assert (-not (Test-PanelDatabase (Get-Command node.exe).Source $interruptedDb '192.168.1.10' 27015)) 'An empty/interrupted database must be marked missing.'
            New-Item -ItemType Directory -Path (Split-Path $credentialFile -Parent) | Out-Null
            Invoke-Native (Get-Command node.exe).Source @($bootstrapScript, $inputPath)
            Invoke-Native (Get-Command node.exe).Source @($verifyPath)
            $credentialsHash = (Get-FileHash -LiteralPath $credentialFile).Hash
            Invoke-Native (Get-Command node.exe).Source @($bootstrapScript, $inputPath)
            Assert ((Get-FileHash -LiteralPath $credentialFile).Hash -eq $credentialsHash) 'Credentials must not be rewritten on retry.'
            Write-Host 'PASS: bootstrap retry, rollback, incomplete database repair and password preservation.'
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

    # A previous installation with the game present must reach the read-only report,
    # even when the configured fresh-install minimum is an impossible 4096 GiB.
    $resumeRoot = Join-Path $fixture 'resume'
    foreach ($directory in @('logs', 'cs2\game\bin\win64', 'cs2\steamapps')) { New-Item -ItemType Directory -Path (Join-Path $resumeRoot $directory) -Force | Out-Null }
    Set-Content -LiteralPath (Join-Path $resumeRoot 'logs\install.log') -Value 'previous attempt'
    Set-Content -LiteralPath (Join-Path $resumeRoot 'cs2\game\bin\win64\cs2.exe') -Value ''
    Set-Content -LiteralPath (Join-Path $resumeRoot 'cs2\steamapps\appmanifest_730.acf') -Value '"StateFlags" "4"'
    $address = @(Get-LocalIPv4)[0]
    @{ ServerAddress = $address; ServerPort = 27015; PanelPort = 3000; TvPort = 27020; PublicUrl = "http://${address}:3000" } | ConvertTo-Json |
        Set-Content -LiteralPath (Join-Path $resumeRoot 'installation.json') -Encoding UTF8
    $before = @(Get-ChildItem -LiteralPath $resumeRoot -File -Recurse | ForEach-Object { $_.FullName + ':' + (Get-FileHash -LiteralPath $_.FullName).Hash }) -join '|'
    $ErrorActionPreference = 'Continue'
    try {
        $output = & "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File $installer -Cs2Path $game -InstallRoot $resumeRoot -RequiredFreeGB 4096 -CheckOnly -SkipFirewall 2>&1 | Out-String
        $code = $LASTEXITCODE
    } finally { $ErrorActionPreference = 'Stop' }
    Assert ($code -eq 0 -and $output -match 'Existing installation found' -and $output -match 'Preflight OK') "Resume preflight failed: $output"
    $after = @(Get-ChildItem -LiteralPath $resumeRoot -File -Recurse | ForEach-Object { $_.FullName + ':' + (Get-FileHash -LiteralPath $_.FullName).Hash }) -join '|'
    Assert ($before -eq $after) 'Resume -CheckOnly changed installation files.'
    Write-Host 'PASS: existing-install CheckOnly reports components without downloads, writes or the fresh-game space threshold.'
    Write-Host 'All offline installer checks passed.'
} finally {
    # Remove only this test's verified, unique child directory.
    $resolvedFixture = [IO.Path]::GetFullPath($fixture)
    if (-not $resolvedFixture.StartsWith($root + '\.installer-test-', [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe fixture cleanup path.' }
    if (Test-Path -LiteralPath $resolvedFixture) { Remove-Item -LiteralPath $resolvedFixture -Recurse -Force }
}
