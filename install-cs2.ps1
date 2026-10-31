#requires -Version 5.1
<#
.SYNOPSIS
Clones the project from GitHub and installs a LAN CS2 server and tournament panel.
.EXAMPLE
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-cs2.ps1 -CheckOnly
.EXAMPLE
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-cs2.ps1 -Cs2Path 'E:\SteamLibrary\steamapps\common\Counter-Strike Global Offensive'
.EXAMPLE
powershell -NoProfile -ExecutionPolicy Bypass -File .\install-cs2.ps1 -InstallRoot 'E:\LAN Server'
.NOTES
See install-cs2.txt. ASCII source is intentional for Windows PowerShell 5.1.
#>
[CmdletBinding()]
param(
    [string]$Cs2Path = '',
    [string]$InstallRoot = '',
    [string]$RepositoryUrl = 'https://github.com/nfilatoff/cs2tournamentorganizator.git',
    [string]$RepositoryBranch = '',
    # LAN IPv4 of this computer. Empty = 'auto': the panel detects the current address itself, so the computer needs no
    # fixed IP, and the local CS2 server is reached through 127.0.0.1.
    [string]$ServerAddress = '',
    [ValidateRange(1, 65535)][int]$ServerPort = 27015,
    [ValidateRange(1, 65535)][int]$PanelPort = 3000,
    [ValidateRange(1, 65535)][int]$TvPort = 27020,
    [ValidateRange(120, 4096)][int]$RequiredFreeGB = 120,
    [switch]$SkipFirewall,
    [switch]$UpdateGame,
    # Download the whole server with SteamCMD instead of starting from a copy of the Steam client's CS2.
    [switch]$NoClientCopy,
    [switch]$CheckOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Get-FullLocalPath([string]$Path) {
    if ($Path -notmatch '^[A-Za-z]:[\\/]') { throw "Use an absolute local drive path: $Path" }
    $full = [IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
    # Junctions, mount points and SUBST drives can make a drive-letter check misleading.
    $ancestor = $full
    while ($ancestor) {
        if (Test-Path -LiteralPath $ancestor) {
            $item = Get-Item -LiteralPath $ancestor -Force
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw "Junctions/symlinks/mounted folders are not supported: $ancestor. Use the physical drive path."
            }
        }
        $ancestor = Split-Path -Path $ancestor -Parent
    }
    $driveRoot = [IO.Path]::GetPathRoot($full)
    $disk = New-Object IO.DriveInfo $driveRoot
    $substitutions = & "$env:SystemRoot\System32\subst.exe"
    if ($disk.DriveType -ne [IO.DriveType]::Fixed -or ($substitutions -match ('^' + [regex]::Escape($driveRoot.Substring(0, 2)) + '\\:'))) {
        throw "A fixed local physical drive is required: $driveRoot"
    }
    return $full
}

function Resolve-Cs2Directory([string]$Path) {
    if ([IO.Path]::GetFileName($Path) -ieq 'cs2.exe') {
        $Path = Split-Path (Split-Path (Split-Path (Split-Path $Path -Parent) -Parent) -Parent) -Parent
    }
    $full = Get-FullLocalPath $Path
    if (-not (Test-Path -LiteralPath (Join-Path $full 'game\bin\win64\cs2.exe') -PathType Leaf)) {
        throw "CS2 was not found in '$full'. Specify -Cs2Path with the game directory or cs2.exe."
    }
    return $full
}

function Select-UniqueWindowsPath([string[]]$Paths) {
    $seen = New-Object 'Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
    foreach ($path in $Paths) {
        if ([string]::IsNullOrWhiteSpace($path)) { continue }
        $full = [IO.Path]::GetFullPath($path.Replace('/', '\'))
        if ($full.Length -gt 3) { $full = $full.TrimEnd('\') }
        if ($seen.Add($full)) { $full }
    }
}

function Find-Cs2Directories {
    $steamRoots = @()
    foreach ($key in @('HKCU:\Software\Valve\Steam', 'HKLM:\SOFTWARE\WOW6432Node\Valve\Steam', 'HKLM:\SOFTWARE\Valve\Steam')) {
        $entry = Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue
        foreach ($name in @('SteamPath', 'InstallPath')) {
            if ($entry -and $entry.PSObject.Properties[$name] -and $entry.$name) { $steamRoots += $entry.$name }
        }
    }
    if (${env:ProgramFiles(x86)}) { $steamRoots += Join-Path ${env:ProgramFiles(x86)} 'Steam' }
    $libraries = @($steamRoots)
    foreach ($steam in @(Select-UniqueWindowsPath $steamRoots)) {
        $vdf = Join-Path $steam 'steamapps\libraryfolders.vdf'
        if (-not (Test-Path -LiteralPath $vdf)) { continue }
        $content = Get-Content -LiteralPath $vdf -Raw
        foreach ($match in [regex]::Matches($content, '"(?:path|\d+)"\s+"([A-Za-z]:[^"\r\n]+)"')) {
            $libraries += $match.Groups[1].Value.Replace('\\', '\')
        }
    }
    foreach ($library in @(Select-UniqueWindowsPath $libraries)) {
        $manifest = Join-Path $library 'steamapps\appmanifest_730.acf'
        if (-not (Test-Path -LiteralPath $manifest)) { continue }
        $content = Get-Content -LiteralPath $manifest -Raw
        $match = [regex]::Match($content, '"installdir"\s+"([^"\r\n]+)"')
        if ($match.Success) {
            $candidate = Join-Path (Join-Path $library 'steamapps\common') $match.Groups[1].Value
            if (Test-Path -LiteralPath (Join-Path $candidate 'game\bin\win64\cs2.exe')) { $candidate }
        }
    }
}

function Assert-FreeSpace([string]$DriveRoot, [long]$RequiredBytes) {
    $drive = New-Object IO.DriveInfo $DriveRoot
    if (-not $drive.IsReady) { throw "Drive is unavailable: $DriveRoot" }
    $available = $drive.AvailableFreeSpace
    Write-Host ('Drive {0}: {1:N1} GiB free; {2:N1} GiB required.' -f $DriveRoot, ($available / 1GB), ($RequiredBytes / 1GB))
    if ($available -lt $RequiredBytes) {
        throw ('INSTALLATION CANCELLED: insufficient space on {0}. Required: {1:N1} GiB; available: {2:N1} GiB; missing: {3:N1} GiB. No fallback to another drive.' -f $DriveRoot, ($RequiredBytes / 1GB), ($available / 1GB), (($RequiredBytes - $available) / 1GB))
    }
}

function Assert-Project([string]$Directory) {
    foreach ($file in @('package.json', 'package-lock.json', 'server\package.json', 'server\src\index.ts', 'web\package.json', 'web\index.html', 'web\src\main.tsx', 'plugin\ArenaPro.csproj', 'plugin\gamedata\arenapro.json', 'scripts\build-plugin.ps1')) {
        if (-not (Test-Path -LiteralPath (Join-Path $Directory $file) -PathType Leaf)) {
            throw "Project file missing in the cloned repository: $Directory\$file. Check -RepositoryUrl and -RepositoryBranch."
        }
    }
}

function Test-ProjectComplete([string]$Directory) {
    try { Assert-Project $Directory; return $true } catch { return $false }
}

# Best guess of the current LAN address, for messages only (the panel detects it again at every start).
function Get-DisplayAddress {
    # Same choice as the panel: the source address of the default route (a UDP connect sends nothing).
    $socket = New-Object Net.Sockets.Socket([Net.Sockets.AddressFamily]::InterNetwork, [Net.Sockets.SocketType]::Dgram, [Net.Sockets.ProtocolType]::Udp)
    try {
        $socket.Connect('1.1.1.1', 53)
        $routed = $socket.LocalEndPoint.Address.ToString()
        if ($routed -notmatch '^(0\.|127\.|169\.254\.)') { return $routed }
    } catch {
        # No default route: fall back to the adapter list.
    } finally { $socket.Dispose() }
    $addresses = @(@(Get-LocalIPv4 -WithGateway) + @(Get-LocalIPv4) | Select-Object -Unique)
    if ($addresses.Count) { return $addresses[0] }
    return 'localhost'
}

function Get-LocalIPv4([switch]$WithGateway) {
    foreach ($adapter in [Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()) {
        if ($adapter.OperationalStatus -ne [Net.NetworkInformation.OperationalStatus]::Up -or $adapter.NetworkInterfaceType -eq [Net.NetworkInformation.NetworkInterfaceType]::Loopback) { continue }
        $properties = $adapter.GetIPProperties()
        if ($WithGateway -and -not @($properties.GatewayAddresses | Where-Object { $_.Address.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork -and $_.Address.ToString() -ne '0.0.0.0' }).Count) { continue }
        foreach ($address in $properties.UnicastAddresses) {
            if ($address.Address.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork -and $address.Address.ToString() -notmatch '^(127\.|169\.254\.)') { $address.Address.ToString() }
        }
    }
}

function Get-RequiredBytes([string]$GameDirectory, [int]$MinimumGB) {
    # The installed client's manifest gives a local size estimate, without a download.
    # A fresh server is a separate app 730 copy; allow 20% growth plus 20 GiB for tools/builds.
    $required = [long]$MinimumGB * 1GB
    $steamapps = Split-Path (Split-Path $GameDirectory -Parent) -Parent
    $manifest = Join-Path $steamapps 'appmanifest_730.acf'
    if (Test-Path -LiteralPath $manifest) {
        $match = [regex]::Match((Get-Content -LiteralPath $manifest -Raw), '"SizeOnDisk"\s+"(\d+)"')
        if ($match.Success) { $required = [long][Math]::Max($required, [Math]::Ceiling([long]$match.Groups[1].Value * 1.2) + 20GB) }
    }
    return $required
}

function Invoke-Download([string]$Url, [string]$Destination, [string]$Sha256 = '') {
    if (-not $Url.StartsWith('https://')) { throw "HTTPS download required: $Url" }
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try {
            Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Destination -Headers @{ 'User-Agent' = 'CS2TournamentInstaller' } -TimeoutSec 600
            if ($Sha256 -and (Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash -ine $Sha256) {
                throw "SHA256 mismatch: $Destination"
            }
            return
        } catch {
            if ($attempt -eq 3) { throw }
            Write-Warning "Download failed; retry $attempt of 3: $Url"
            Start-Sleep -Seconds 2
        }
    }
}

function Get-Release([string]$Repository) {
    return Invoke-RestMethod -Uri "https://api.github.com/repos/$Repository/releases/latest" -Headers @{ 'User-Agent' = 'CS2TournamentInstaller' } -TimeoutSec 60
}

function Save-Asset($Asset, [string]$Destination) {
    $hash = ''
    if ($Asset.PSObject.Properties['digest'] -and $Asset.digest -match '^sha256:([a-fA-F0-9]{64})$') { $hash = $Matches[1] }
    Invoke-Download $Asset.browser_download_url $Destination $hash
}

function Invoke-Native([string]$File, [string[]]$Arguments) {
    & $File @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Command failed (exit $LASTEXITCODE): $File" }
}

# A copied file is complete once its size and modification time match the client's: robocopy sets the time last
# (its file size is reserved in full up front, so the folder size says nothing about progress).
function Test-FileCopied([string]$Path, [long]$Length, [datetime]$TimeUtc) {
    $item = Get-Item -LiteralPath $Path -Force -ErrorAction SilentlyContinue
    return [bool]($item -and $item.Length -eq $Length -and $item.LastWriteTimeUtc -eq $TimeUtc)
}

# Files robocopy will copy (same exclusions as Copy-Cs2Client): those missing in the server folder or differing in
# size or time. On a rerun this is only what is left to copy.
function Get-ClientCopyPlan([string]$Source, [string]$Destination) {
    $skipDir = Join-Path $Source 'content'
    foreach ($file in Get-ChildItem -LiteralPath $Source -File -Recurse -Force -ErrorAction SilentlyContinue) {
        if ($file.FullName.StartsWith($skipDir + '\', [StringComparison]::OrdinalIgnoreCase)) { continue }
        if ($file.Name -ieq 'console.log' -or $file.Extension -in @('.dem', '.mdmp')) { continue }
        $target = Join-Path $Destination $file.FullName.Substring($Source.Length).TrimStart('\')
        if (Test-FileCopied $target $file.Length $file.LastWriteTimeUtc) { continue }
        [pscustomobject]@{ Path = $target; Length = $file.Length; TimeUtc = $file.LastWriteTimeUtc }
    }
}

# Copies the installed CS2 client into the server folder with robocopy and shows a progress bar by completed files.
# Returns the robocopy exit code.
function Copy-Cs2Client([string]$Source, [string]$Destination, [string]$LogPath) {
    Write-Host '  Comparing the client with the server folder...'
    $pending = New-Object Collections.Generic.List[object]
    foreach ($entry in @(Get-ClientCopyPlan $Source $Destination)) { $pending.Add($entry) }
    $total = 0L
    foreach ($entry in $pending) { $total += $entry.Length }
    Write-Host ('  To copy: {0} files, {1:N1} GiB' -f $pending.Count, ($total / 1GB))
    $total = [Math]::Max(1L, $total)
    $quote = { param($text) '"' + $text + '"' }
    # Windows PowerShell 5.1 passes Start-Process arguments as one command line, so paths are quoted here.
    $arguments = @((& $quote $Source), (& $quote $Destination), '/E', '/DCOPY:DA', '/COPY:DAT', '/MT:8', '/R:1', '/W:1', '/NP', '/NFL', '/NDL',
        '/XD', (& $quote (Join-Path $Source 'content')), '/XF', 'console.log', '*.dem', '*.mdmp', (& $quote "/LOG:$LogPath")) -join ' '
    $process = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\robocopy.exe') -ArgumentList $arguments -WindowStyle Hidden -PassThru
    $null = $process.Handle # keeps ExitCode available after the process ends
    $activity = 'Copying CS2 from the Steam client'
    $started = Get-Date
    $done = 0L
    $lastStep = -1
    while (-not $process.HasExited) {
        Start-Sleep -Seconds 2
        # Only files not yet seen complete are checked again.
        $left = New-Object Collections.Generic.List[object]
        foreach ($entry in $pending) {
            if (Test-FileCopied $entry.Path $entry.Length $entry.TimeUtc) { $done += $entry.Length } else { $left.Add($entry) }
        }
        $pending = $left
        $percent = [int][Math]::Floor([Math]::Min($done, $total) * 100 / $total)
        $elapsed = ((Get-Date) - $started).TotalSeconds
        $speed = if ($elapsed -gt 0) { $done / $elapsed } else { 0 }
        $status = '{0:N1} of {1:N1} GiB ({2}%), {3:N0} MiB/s' -f ($done / 1GB), ($total / 1GB), $percent, ($speed / 1MB)
        $progress = @{ Activity = $activity; Status = $status; PercentComplete = [Math]::Min(100, $percent) }
        if ($speed -gt 0 -and $done -lt $total) { $progress.SecondsRemaining = [int](($total - $done) / $speed) }
        Write-Progress @progress
        # A text line every 10% also reaches the console when the progress bar is not shown.
        $step = [int][Math]::Floor($percent / 10)
        if ($step -ne $lastStep) { Write-Host "  $status"; $lastStep = $step }
    }
    $process.WaitForExit()
    Write-Progress -Activity $activity -Completed
    return $process.ExitCode
}

function Invoke-WithPreservedFiles([string[]]$Paths, [scriptblock]$Action) {
    $savedFiles = @{}
    foreach ($path in $Paths) {
        if (Test-Path -LiteralPath $path -PathType Container) {
            foreach ($file in Get-ChildItem -LiteralPath $path -File -Recurse -Force) { $savedFiles[$file.FullName] = [IO.File]::ReadAllBytes($file.FullName) }
        } elseif (Test-Path -LiteralPath $path -PathType Leaf) { $savedFiles[$path] = [IO.File]::ReadAllBytes($path) }
    }
    try { & $Action } finally {
        foreach ($path in $savedFiles.Keys) {
            New-Item -ItemType Directory -Path (Split-Path $path -Parent) -Force | Out-Null
            [IO.File]::WriteAllBytes($path, $savedFiles[$path])
        }
    }
}

function Get-InstallDirectory([string]$Requested, [string]$GameDrive, [switch]$NonInteractive) {
    $default = Join-Path $GameDrive 'CS2Tournament'
    if (-not $Requested -and -not $NonInteractive) {
        $Requested = Read-Host "Installation folder or drive [$default]"
    }
    if ([string]::IsNullOrWhiteSpace($Requested)) { return $default }
    $Requested = $Requested.Trim().Trim('"')
    if ($Requested -match '^[A-Za-z]:?[\\/]?$') { return Join-Path ($Requested.Substring(0, 1) + ':\') 'CS2Tournament' }
    return $Requested
}

function Copy-Project([string]$GitExe, [string]$Url, [string]$Branch, [string]$Destination) {
    $cloneArgs = @('clone', '--depth', '1')
    if ($Branch) { $cloneArgs += @('--branch', $Branch) }
    $cloneArgs += @('--', $Url, $Destination)
    Invoke-Native $GitExe $cloneArgs
    Assert-Project $Destination
}

function Enable-Metamod([string]$GameInfo) {
    $text = [IO.File]::ReadAllText($GameInfo)
    if ($text -match '(?im)^\s*Game\s+csgo/addons/metamod\s*$') { return }
    $search = [regex]::new('(?im)^(\s*SearchPaths\s*\r?\n\s*\{)[^\S\r\n]*\r?\n')
    if (-not $search.IsMatch($text)) { throw "SearchPaths block was not found in $GameInfo" }
    Copy-Item -LiteralPath $GameInfo -Destination "$GameInfo.before-arenapro" -Force
    $text = $search.Replace($text, "`$1`r`n`t`t`tGame`tcsgo/addons/metamod`r`n", 1)
    [IO.File]::WriteAllText($GameInfo, $text, (New-Object Text.UTF8Encoding $false))
}

function New-Secret {
    $bytes = New-Object byte[] 24
    $rng = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
    return ([BitConverter]::ToString($bytes)).Replace('-', '').ToLowerInvariant()
}

function Protect-InstallDirectory([string]$Directory) {
    $acl = New-Object Security.AccessControl.DirectorySecurity
    $acl.SetAccessRuleProtection($true, $false)
    $currentSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    foreach ($sid in @($currentSid, (New-Object Security.Principal.SecurityIdentifier 'S-1-5-18'), (New-Object Security.Principal.SecurityIdentifier 'S-1-5-32-544'))) {
        $rule = New-Object Security.AccessControl.FileSystemAccessRule($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        $acl.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $Directory -AclObject $acl
}

function Write-Launchers([string]$Root, $Settings, [switch]$MissingOnly) {
    # Read JSON at runtime; never interpolate user paths/passwords into executable code.
    $common = @'
#requires -Version 5.1
$ErrorActionPreference = 'Stop'
$settings = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'installation.json') -Raw | ConvertFrom-Json
'@
    $server = $common + @'

$exe = Join-Path $PSScriptRoot 'cs2\game\bin\win64\cs2.exe'
Set-Location (Join-Path $PSScriptRoot 'cs2')
# Without a fixed address (auto) the server listens on every adapter, including 127.0.0.1 for the panel.
$extra = if ($settings.ServerAddress -and $settings.ServerAddress -ne 'auto') { @('-ip', $settings.ServerAddress) } else { @() }
# Optional Steam Web API key for Workshop maps: put it into authkey.txt next to this script.
$keyFile = Join-Path $PSScriptRoot 'authkey.txt'
if ((Test-Path -LiteralPath $keyFile) -and [IO.File]::ReadAllText($keyFile).Trim()) { $extra += @('-authkey', [IO.File]::ReadAllText($keyFile).Trim()) }
& $exe -dedicated -console -condebug -usercon -insecure @extra -port $settings.ServerPort +sv_lan 1 +tv_port $settings.TvPort +game_type 0 +game_mode 2 +exec arenapro-server.cfg +map de_inferno
if ($LASTEXITCODE -ne 0) { throw "CS2 exited with code $LASTEXITCODE" }
'@
    $panel = $common + @'

$env:PORT = [string]$settings.PanelPort
$env:HOST = '0.0.0.0'
# Empty PublicUrl: the panel detects its LAN address itself.
if ($settings.PublicUrl) { $env:PUBLIC_URL = $settings.PublicUrl }
$env:DATA_DIR = Join-Path $PSScriptRoot 'data'
Set-Location (Join-Path $PSScriptRoot 'panel')
& (Join-Path $PSScriptRoot 'tools\node\node.exe') 'server\dist\index.js'
if ($LASTEXITCODE -ne 0) { throw "Panel exited with code $LASTEXITCODE" }
'@
    $both = @'
#requires -Version 5.1
$ErrorActionPreference = 'Stop'
foreach ($name in @('start-panel.ps1', 'start-server.ps1')) {
    $scriptPath = Join-Path $PSScriptRoot $name
    $command = "& '" + $scriptPath.Replace("'", "''") + "'"
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($command))
    Start-Process -FilePath "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -WindowStyle Hidden -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $encoded) -RedirectStandardOutput (Join-Path $PSScriptRoot "logs\$name.out.log") -RedirectStandardError (Join-Path $PSScriptRoot "logs\$name.err.log")
}
Write-Host 'Started in the background. Logs: logs directory. Stop node.exe / dedicated cs2.exe in Task Manager, or launch each script in its own terminal and use Ctrl+C.'
'@
    foreach ($entry in @{ 'start-server.ps1' = $server; 'start-panel.ps1' = $panel; 'start-all.ps1' = $both; 'installation.json' = ($Settings | ConvertTo-Json) }.GetEnumerator()) {
        $path = Join-Path $Root $entry.Key
        if (-not $MissingOnly -or -not (Test-Path -LiteralPath $path)) { Set-Content -LiteralPath $path -Value $entry.Value -Encoding UTF8 }
    }
}

function Get-NodeVersionOk([string]$NodeExe) {
    if (-not (Test-Path -LiteralPath $NodeExe -PathType Leaf)) { return $false }
    try { $version = & $NodeExe --version; return $LASTEXITCODE -eq 0 -and $version -match '^v24\.' } catch { return $false }
}

function Get-DotnetOk([string]$DotnetExe) {
    if (-not (Test-Path -LiteralPath $DotnetExe -PathType Leaf)) { return $false }
    try { $versions = @(& $DotnetExe --list-sdks); return $LASTEXITCODE -eq 0 -and [bool]@($versions | Where-Object { $_ -match '^10\.' }).Count } catch { return $false }
}

function Test-VcRuntime {
    $entry = Get-ItemProperty -LiteralPath 'HKLM:\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\X64' -ErrorAction SilentlyContinue
    return [bool]($entry -and $entry.PSObject.Properties['Installed'] -and $entry.Installed -eq 1)
}

function Test-Cs2ServerInstalled([string]$ServerRoot) {
    if (-not (Test-Path -LiteralPath (Join-Path $ServerRoot 'game\bin\win64\cs2.exe') -PathType Leaf)) { return $false }
    $manifest = Join-Path $ServerRoot 'steamapps\appmanifest_730.acf'
    if (-not (Test-Path -LiteralPath $manifest)) { return $false }
    # StateFlags 4 = fully installed; anything else means an interrupted or pending update.
    return ((Get-Content -LiteralPath $manifest -Raw) -match '"StateFlags"\s+"4"')
}

function Test-MetamodInstalled([string]$GameDir) {
    foreach ($file in @('addons\metamod_x64.vdf', 'addons\metamod\bin\win64\server.dll', 'addons\metamod\bin\win64\metamod.2.cs2.dll')) {
        if (-not (Test-Path -LiteralPath (Join-Path $GameDir $file) -PathType Leaf)) { return $false }
    }
    try {
        $version = [Diagnostics.FileVersionInfo]::GetVersionInfo((Join-Path $GameDir 'addons\metamod\bin\win64\metamod.2.cs2.dll')).FileVersion
        $match = [regex]::Match($version, '^2\.\d+\.\d+(?:-dev\+|[.+])(\d+)')
        return $match.Success -and [int]$match.Groups[1].Value -ge 1467
    } catch { return $false }
}

function Test-CssInstalled([string]$GameDir) {
    $css = Join-Path $GameDir 'addons\counterstrikesharp'
    foreach ($file in @('bin\win64\counterstrikesharp.dll', 'api\CounterStrikeSharp.API.dll')) {
        if (-not (Test-Path -LiteralPath (Join-Path $css $file) -PathType Leaf)) { return $false }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $GameDir 'addons\metamod\counterstrikesharp.vdf'))) { return $false }
    $core = @(Get-ChildItem -Path (Join-Path $css 'dotnet\shared\Microsoft.NETCore.App\10.*\System.Private.CoreLib.dll') -ErrorAction SilentlyContinue)
    $host = @(Get-ChildItem -Path (Join-Path $css 'dotnet\host\fxr\10.*\hostfxr.dll') -ErrorAction SilentlyContinue)
    if (-not $core.Count -or -not $host.Count) { return $false }
    try {
        $version = [Diagnostics.FileVersionInfo]::GetVersionInfo((Join-Path $css 'api\CounterStrikeSharp.API.dll')).FileVersion
        return [version]$version -ge [version]'1.0.379'
    } catch { return $false }
}

function Test-FirewallRule([string]$Name, [string]$Program, [int]$Port, [string]$Protocol) {
    $rule = Get-NetFirewallRule -Name $Name -ErrorAction SilentlyContinue
    if (-not $rule -or [string]$rule.Enabled -ne 'True' -or [string]$rule.Action -ne 'Allow' -or [string]$rule.Direction -ne 'Inbound') { return $false }
    $application = $rule | Get-NetFirewallApplicationFilter
    $portFilter = $rule | Get-NetFirewallPortFilter
    $addressFilter = $rule | Get-NetFirewallAddressFilter
    return $application.Program -ieq $Program -and [string]$portFilter.LocalPort -eq [string]$Port -and [string]$portFilter.Protocol -eq $Protocol -and [string]$addressFilter.RemoteAddress -eq 'LocalSubnet' -and [string]$rule.Profile -eq 'Domain, Private'
}

function Remove-InsideRoot([string]$Root, [string]$Path) {
    # Only ever delete leftovers of an interrupted step, and only inside the installation folder.
    $full = [IO.Path]::GetFullPath($Path)
    if (-not $full.StartsWith($Root + '\', [StringComparison]::OrdinalIgnoreCase)) { throw "Unsafe cleanup path: $full" }
    Assert-NoReparsePoint $Root $full
    if (Test-Path -LiteralPath $full) { Remove-Item -LiteralPath $full -Recurse -Force }
}

function Assert-NoReparsePoint([string]$Root, [string]$Path, [switch]$AllowInternalLinks) {
    $rootFull = [IO.Path]::GetFullPath($Root).TrimEnd('\')
    $full = [IO.Path]::GetFullPath($Path).TrimEnd('\')
    if ($full -ine $rootFull -and -not $full.StartsWith($rootFull + '\', [StringComparison]::OrdinalIgnoreCase)) { throw "Path is outside the installation: $full" }
    $current = $full
    while ($current.Length -ge $rootFull.Length) {
        if (Test-Path -LiteralPath $current) {
            if ((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Refusing to follow a junction/symlink: $current" }
        }
        if ($current -ieq $rootFull) { break }
        $current = Split-Path $current -Parent
    }
    # Walk one level at a time: never recurse into a link while checking for links.
    if (Test-Path -LiteralPath $full -PathType Container) {
        $pending = New-Object 'Collections.Generic.Stack[string]'
        $pending.Push($full)
        while ($pending.Count) {
            foreach ($item in Get-ChildItem -LiteralPath $pending.Pop() -Force) {
                if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
                    # npm workspaces create junctions to panel/server and panel/web on Windows.
                    # Read-only root inspection may accept links staying inside this installation;
                    # recursive cleanup always uses the stricter default and never follows links.
                    $safe = $false
                    if ($AllowInternalLinks -and $item.PSObject.Properties['Target'] -and @($item.Target).Count) {
                        $safe = $true
                        foreach ($target in @($item.Target)) {
                            if (-not [IO.Path]::IsPathRooted($target)) { $target = Join-Path (Split-Path $item.FullName -Parent) $target }
                            $resolved = [IO.Path]::GetFullPath($target)
                            if (-not $resolved.StartsWith($rootFull + '\', [StringComparison]::OrdinalIgnoreCase)) { $safe = $false }
                        }
                    }
                    if (-not $safe) { throw "Refusing to follow a junction/symlink: $($item.FullName)" }
                    continue
                }
                if ($item.PSIsContainer) { $pending.Push($item.FullName) }
            }
        }
    }
}

function Get-RepairSpaceBytes([string]$ClientDirectory, [int]$MinimumGB, [string]$ServerRoot, [bool]$GameInstalled, [bool]$Update) {
    if ($GameInstalled -and -not $Update) { return 8GB }
    if ($GameInstalled -and $Update) { return 20GB }
    $required = Get-RequiredBytes $ClientDirectory $MinimumGB
    $game = Join-Path $ServerRoot 'game'
    if (Test-Path -LiteralPath $game) {
        Assert-NoReparsePoint (Split-Path $ServerRoot -Parent) $game
        $downloaded = (Get-ChildItem -LiteralPath $game -File -Recurse -Force | Measure-Object -Property Length -Sum).Sum
        if ($downloaded) { $required = [long][Math]::Max(8GB, $required - $downloaded) }
    }
    return $required
}

function Test-NpmComplete([string]$Project) {
    $lock = Join-Path $Project 'package-lock.json'
    $stamp = Join-Path $Project 'node_modules\.installer-lock.sha256'
    if (-not (Test-Path -LiteralPath $lock) -or -not (Test-Path -LiteralPath $stamp)) { return $false }
    if ([IO.File]::ReadAllText($stamp).Trim() -ne (Get-FileHash -LiteralPath $lock -Algorithm SHA256).Hash) { return $false }
    # PowerShell 5.1 ConvertFrom-Json cannot parse the empty package key in npm's
    # real lockfile. Use Node's JSON parser for the dependency graph.
    $runtime = Join-Path (Split-Path $Project -Parent) 'tools\node\node.exe'
    if (-not (Test-Path -LiteralPath $runtime)) {
        $command = Get-Command node.exe -ErrorAction SilentlyContinue
        if (-not $command) { return $false }
        $runtime = $command.Source
    }
    $code = @'
const fs = require('node:fs'), path = require('node:path');
const project = process.argv[1];
const read = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const supports = (values, platform) => !values || (!values.includes('!' + platform) && (!values.some(v => !v.startsWith('!')) || values.includes(platform)));
let ok = true;
try {
    for (const [name, info] of Object.entries(read(path.join(project, 'package-lock.json')).packages)) {
        if (!/(^|\/)node_modules\//.test(name) || info.link || !supports(info.os, process.platform) || !supports(info.cpu, process.arch)) continue;
        if (read(path.join(project, name, 'package.json')).version !== info.version) { ok = false; break; }
    }
    for (const file of ['node_modules/typescript/bin/tsc', 'node_modules/vite/bin/vite.js', 'node_modules/@esbuild/win32-x64/esbuild.exe']) {
        if (!fs.existsSync(path.join(project, file))) ok = false;
    }
} catch { ok = false; }
console.log(ok ? 'OK' : 'MISSING');
'@
    $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($code))
    try {
        $result = & $runtime --eval "eval(Buffer.from('$encoded','base64').toString())" $Project 2>$null
        return $LASTEXITCODE -eq 0 -and $result -eq 'OK'
    } catch { return $false }
}

function Test-ArenaProInstalled([string]$GameDir) {
    foreach ($file in @('addons\counterstrikesharp\plugins\ArenaPro\ArenaPro.dll', 'addons\counterstrikesharp\plugins\ArenaPro\ArenaPro.deps.json', 'addons\counterstrikesharp\plugins\ArenaPro\Dapper.dll', 'addons\counterstrikesharp\gamedata\arenapro.json', 'cfg\ArenaPro\config.cfg')) {
        if (-not (Test-Path -LiteralPath (Join-Path $GameDir $file) -PathType Leaf)) { return $false }
    }
    return $true
}

function Test-PanelDatabase([string]$NodeExe, [string]$DatabasePath, [string]$Address, [int]$Port, [string]$ConfigPath = '') {
    if (-not (Test-Path -LiteralPath $NodeExe) -or -not (Test-Path -LiteralPath $DatabasePath)) { return $false }
    $code = @'
const { DatabaseSync } = require('node:sqlite');
// immutable prevents even WAL/SHM creation during CheckOnly. A live/uncheckpointed
// WAL cannot be audited this way, so report it for verification after stopping the panel.
const fs = require('node:fs');
if (fs.existsSync(process.argv[1] + '-wal') && fs.statSync(process.argv[1] + '-wal').size > 0) {
    console.log('MISSING'); process.exit(0);
}
const uri = require('node:url').pathToFileURL(process.argv[1]).href + '?immutable=1';
const db = new DatabaseSync(uri, { readOnly: true });
const admin = db.prepare('SELECT COUNT(*) AS n FROM admins').get().n > 0;
const server = db.prepare('SELECT rcon_password FROM game_servers WHERE host = ? AND port = ?').get(process.argv[2], Number(process.argv[3]));
let configMatches = true;
if (process.argv[4] && require('node:fs').existsSync(process.argv[4])) {
    const match = require('node:fs').readFileSync(process.argv[4], 'utf8').match(/^\s*rcon_password\s+"([^"\r\n]*)"\s*$/m);
    configMatches = !!match && !!server && match[1] === server.rcon_password;
}
db.close();
console.log(admin && server && configMatches ? 'OK' : 'MISSING');
'@
    $encoded = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($code))
    try {
        $result = & $NodeExe --eval "eval(Buffer.from('$encoded','base64').toString())" $DatabasePath $Address ([string]$Port) $ConfigPath 2>$null
        return $LASTEXITCODE -eq 0 -and $result -eq 'OK'
    } catch { return $false }
}

$savedEnvironment = @{}
$transcribing = $false
$installMutex = $null
$mutexOwned = $false
try {
    if (-not [Environment]::Is64BitProcess -or [Environment]::OSVersion.Platform -ne 'Win32NT' -or $env:PROCESSOR_ARCHITECTURE -ne 'AMD64') {
        throw 'Use 64-bit Windows PowerShell on Windows x64.'
    }
    if (-not $Cs2Path) {
        $found = @(Select-UniqueWindowsPath @(Find-Cs2Directories))
        if ($found.Count -ne 1) { throw "Found $($found.Count) CS2 installations. Specify -Cs2Path explicitly. Candidates: $($found -join '; ')" }
        $Cs2Path = $found[0]
    }
    $Cs2Path = Resolve-Cs2Directory $Cs2Path
    $driveRoot = [IO.Path]::GetPathRoot($Cs2Path)
    $InstallRoot = Get-InstallDirectory $InstallRoot $driveRoot -NonInteractive:$CheckOnly
    $InstallRoot = Get-FullLocalPath $InstallRoot
    if ([IO.Path]::GetPathRoot($InstallRoot) -ine $driveRoot) { throw "Server must be installed on the CS2 drive ($driveRoot). Requested: $InstallRoot" }
    if ($InstallRoot -ieq $Cs2Path -or $InstallRoot.StartsWith($Cs2Path + '\', [StringComparison]::OrdinalIgnoreCase) -or $Cs2Path.StartsWith($InstallRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
        throw 'The server directory must be separate from the installed Steam game.'
    }
    # An existing folder is accepted only if it is an earlier run of this installer (resume/repair mode).
    $existing = $false
    if (Test-Path -LiteralPath $InstallRoot) {
        if (-not (Test-Path -LiteralPath $InstallRoot -PathType Container)) { throw "Installation path is a file: $InstallRoot" }
        if (@(Get-ChildItem -LiteralPath $InstallRoot -Force).Count) {
            $isOurs = (Test-Path -LiteralPath (Join-Path $InstallRoot 'logs\install.log')) -or (Test-Path -LiteralPath (Join-Path $InstallRoot 'installation.json'))
            if (-not $isOurs) {
                throw "Installation directory is not empty and is not a previous installation of this installer: $InstallRoot. Choose a new/empty directory."
            }
            $existing = $true
        }
    }
    if ($existing) { Assert-NoReparsePoint $InstallRoot $InstallRoot -AllowInternalLinks }

    $downloads = Join-Path $InstallRoot 'downloads'
    $panelRoot = Join-Path $InstallRoot 'panel'
    $gitRoot = Join-Path $InstallRoot 'tools\git'
    $gitExe = Join-Path $gitRoot 'cmd\git.exe'
    $nodeRoot = Join-Path $InstallRoot 'tools\node'
    $nodeExe = Join-Path $nodeRoot 'node.exe'
    $npm = Join-Path $nodeRoot 'npm.cmd'
    $dotnetRoot = Join-Path $InstallRoot 'tools\dotnet'
    $dotnetExe = Join-Path $dotnetRoot 'dotnet.exe'
    $steamRoot = Join-Path $InstallRoot 'tools\steamcmd'
    $serverRoot = Join-Path $InstallRoot 'cs2'
    $gameDir = Join-Path $serverRoot 'game\csgo'
    $settingsPath = Join-Path $InstallRoot 'installation.json'
    $dbPath = Join-Path $InstallRoot 'data\app.db'
    $credentialsPath = Join-Path $InstallRoot 'credentials.txt'
    $serverCfg = Join-Path $gameDir 'cfg\arenapro-server.cfg'

    # Ports and address of an existing installation win over defaults (they are already in the DB/launchers).
    $saved = $null
    if ($existing -and (Test-Path -LiteralPath $settingsPath)) {
        $saved = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
        foreach ($name in @('ServerAddress', 'ServerPort', 'PanelPort', 'TvPort', 'PublicUrl')) {
            if (-not $saved.PSObject.Properties[$name]) { throw "installation.json is incomplete: missing $name. Restore the saved settings before repairing." }
        }
        foreach ($name in @('ServerPort', 'PanelPort', 'TvPort')) {
            if ([int]$saved.$name -lt 1 -or [int]$saved.$name -gt 65535) { throw "Invalid $name in installation.json." }
        }
        $savedUrl = $null
        if ([string]$saved.PublicUrl -and (-not [uri]::TryCreate([string]$saved.PublicUrl, [UriKind]::Absolute, [ref]$savedUrl) -or $savedUrl.Scheme -notin @('http', 'https'))) { throw 'Invalid PublicUrl in installation.json.' }
        $requested = @{ ServerAddress = $ServerAddress; ServerPort = $ServerPort; PanelPort = $PanelPort; TvPort = $TvPort }
        foreach ($name in @($requested.Keys)) {
            if ($PSBoundParameters.ContainsKey($name) -and [string]$requested[$name] -ne [string]$saved.$name) {
                Write-Warning "$name differs from installation.json ($($saved.$name)); changing it on an existing installation is not supported. Using the saved value."
            }
        }
        $ServerAddress = [string]$saved.ServerAddress; $ServerPort = [int]$saved.ServerPort; $PanelPort = [int]$saved.PanelPort; $TvPort = [int]$saved.TvPort
    }

    # What is already in place (read-only).
    $state = [ordered]@{
        'Git'                = (Test-Path -LiteralPath $gitExe -PathType Leaf)
        'Project clone'      = (Test-ProjectComplete $panelRoot)
        'Node.js 24'         = (Get-NodeVersionOk $nodeExe)
        '.NET SDK 10'        = (Get-DotnetOk $dotnetExe)
        'VC++ runtime'       = (Test-VcRuntime)
        'SteamCMD'           = (Test-Path -LiteralPath (Join-Path $steamRoot 'steamcmd.exe') -PathType Leaf)
        'CS2 server'         = (Test-Cs2ServerInstalled $serverRoot)
        'Metamod'            = (Test-Path -LiteralPath $gameDir) -and (Test-MetamodInstalled $gameDir)
        'CounterStrikeSharp' = (Test-Path -LiteralPath $gameDir) -and (Test-CssInstalled $gameDir)
        'npm dependencies'   = (Test-NpmComplete $panelRoot)
        'Panel build'        = (Test-Path -LiteralPath (Join-Path $panelRoot 'server\dist\index.js')) -and (Test-Path -LiteralPath (Join-Path $panelRoot 'web\dist\index.html') -PathType Leaf) -and (Test-NpmComplete $panelRoot)
        'ArenaPro plugin'    = (Test-ArenaProInstalled $gameDir)
        'Server config'      = (Test-Path -LiteralPath $serverCfg -PathType Leaf)
        'Panel database'     = (Test-PanelDatabase $nodeExe $dbPath $ServerAddress $ServerPort $serverCfg)
        'Launchers'          = @('start-server.ps1', 'start-panel.ps1', 'start-all.ps1', 'installation.json' | Where-Object { -not (Test-Path -LiteralPath (Join-Path $InstallRoot $_)) }).Count -eq 0
    }

    # Free space matters only while the server itself still has to be downloaded.
    Assert-FreeSpace $driveRoot (Get-RepairSpaceBytes $Cs2Path $RequiredFreeGB $serverRoot $state['CS2 server'] ([bool]$UpdateGame))
    # VC++ setup also needs space on the Windows volume.
    $windowsDrive = [IO.Path]::GetPathRoot($env:SystemRoot)
    if (-not $state['VC++ runtime'] -and $windowsDrive -ine $driveRoot) { Assert-FreeSpace $windowsDrive (2GB) }
    if (@($ServerPort, $PanelPort, $TvPort | Select-Object -Unique).Count -ne 3) { throw 'ServerPort, PanelPort and TvPort must be different.' }
    if (-not $ServerAddress) { $ServerAddress = 'auto' }
    if ($ServerAddress -ne 'auto') {
        $parsedIp = $null
        if (-not [Net.IPAddress]::TryParse($ServerAddress, [ref]$parsedIp) -or $parsedIp.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork -or $ServerAddress -match '^(0\.|127\.|169\.254\.)') {
            throw 'ServerAddress must be a reachable LAN IPv4 address of this computer, or omitted for automatic detection.'
        }
        $localAddresses = @(Get-LocalIPv4)
        if ($ServerAddress -notin $localAddresses) { throw "ServerAddress is not assigned to this computer: $ServerAddress" }
    }
    $displayUrl = if ($ServerAddress -eq 'auto') { "http://$(Get-DisplayAddress):$PanelPort" } else { "http://${ServerAddress}:$PanelPort" }
    $state['Panel database'] = Test-PanelDatabase $nodeExe $dbPath $ServerAddress $ServerPort $serverCfg
    if ($RepositoryUrl -notmatch '^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(?:\.git)?/?$') {
        throw 'RepositoryUrl must be a public https://github.com/owner/repository URL without credentials.'
    }
    if ($RepositoryBranch.StartsWith('-')) { throw 'Invalid RepositoryBranch.' }
    $hashProvider = [Security.Cryptography.SHA256]::Create()
    try { $installId = ([BitConverter]::ToString($hashProvider.ComputeHash([Text.Encoding]::UTF8.GetBytes($InstallRoot.ToLowerInvariant())))).Replace('-', '').Substring(0, 16) } finally { $hashProvider.Dispose() }
    $firewallRules = @(
        @{ Name = 'Panel'; Port = $PanelPort; Protocol = 'TCP'; Program = $nodeExe },
        @{ Name = 'RCON'; Port = $ServerPort; Protocol = 'TCP'; Program = (Join-Path $serverRoot 'game\bin\win64\cs2.exe') },
        @{ Name = 'Game'; Port = $ServerPort; Protocol = 'UDP'; Program = (Join-Path $serverRoot 'game\bin\win64\cs2.exe') },
        @{ Name = 'GOTV'; Port = $TvPort; Protocol = 'UDP'; Program = (Join-Path $serverRoot 'game\bin\win64\cs2.exe') }
    )
    if (-not $SkipFirewall) {
        foreach ($rule in $firewallRules) { $state[('Firewall ' + $rule.Name)] = Test-FirewallRule "CS2Tournament-$installId-$($rule.Name)" $rule.Program $rule.Port $rule.Protocol }
    }
    if ($existing) {
        Write-Host 'Existing installation found; status of components:'
        foreach ($key in $state.Keys) { Write-Host ('  {0,-20} {1}' -f $key, $(if ($state[$key]) { 'OK' } else { 'MISSING - will be installed' })) }
    }
    Write-Host "Steam CS2: $Cs2Path"
    Write-Host "Separate server and panel: $InstallRoot"
    if (-not $state['CS2 server']) {
        Write-Host ('CS2 server files: ' + $(if ($NoClientCopy) { 'full SteamCMD download' } else { 'copy of the Steam client, then SteamCMD validates and downloads only the differences' }))
    }
    Write-Host "Repository: $RepositoryUrl"
    if ($ServerAddress -eq 'auto') { Write-Host "Panel URL: $displayUrl (now; the panel detects its LAN address at every start)" }
    else { Write-Host "Panel URL: $displayUrl" }
    if ($CheckOnly) {
        if ($existing) { Write-Host 'Preflight OK. Nothing was changed; components marked MISSING above would be installed on a normal run.' }
        else { Write-Host 'Preflight OK. Nothing was downloaded, installed or created.' }
        return
    }
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Run PowerShell as Administrator (required for VC++ Redistributable and Windows Firewall). Use -CheckOnly for a read-only preflight.'
    }
    foreach ($process in @(Get-Process cs2,node -ErrorAction SilentlyContinue)) {
        if ($process.Path -ieq (Join-Path $serverRoot 'game\bin\win64\cs2.exe')) { throw 'Stop this dedicated CS2 server before repairing/updating its files.' }
        if ($process.Path -ieq $nodeExe) { throw 'Stop this installation of the panel before repairing/updating its files.' }
    }
    $installMutex = New-Object Threading.Mutex($false, "Local\CS2Tournament-$installId")
    try { $mutexOwned = $installMutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $mutexOwned = $true }
    if (-not $mutexOwned) { throw 'Another installer is already working on this directory.' }
    if (-not $existing) {
        New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
        Protect-InstallDirectory $InstallRoot
    }
    foreach ($name in @('downloads', 'tools', 'logs', 'temp', 'cache', 'data')) {
        New-Item -ItemType Directory -Path (Join-Path $InstallRoot $name) -Force | Out-Null
    }
    Start-Transcript -LiteralPath (Join-Path $InstallRoot 'logs\install.log') -Append | Out-Null
    $transcribing = $true
    foreach ($name in @('PATH', 'TEMP', 'TMP', 'DOTNET_ROOT', 'DOTNET_CLI_HOME', 'NUGET_PACKAGES', 'npm_config_cache', 'DOTNET_CLI_TELEMETRY_OPTOUT', 'DOTNET_SKIP_FIRST_TIME_EXPERIENCE', 'DATA_DIR')) {
        $savedEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
    }
    $env:TEMP = $env:TMP = Join-Path $InstallRoot 'temp'
    $env:DOTNET_CLI_HOME = Join-Path $InstallRoot 'cache\dotnet-home'
    $env:NUGET_PACKAGES = Join-Path $InstallRoot 'cache\nuget'
    $env:npm_config_cache = Join-Path $InstallRoot 'cache\npm'
    $env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
    $env:DOTNET_SKIP_FIRST_TIME_EXPERIENCE = '1'
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

    Write-Host '[1/8] Portable Git and project clone...'
    if (-not $state['Git']) {
        Remove-InsideRoot $InstallRoot $gitRoot
        $gitRelease = Get-Release 'git-for-windows/git'
        $assets = @($gitRelease.assets | Where-Object { $_.name -match '^MinGit-[\d.]+-64-bit\.zip$' })
        if ($assets.Count -ne 1) { throw 'Cannot find a unique Windows x64 MinGit ZIP in the official release.' }
        $gitZip = Join-Path $downloads 'mingit.zip'
        Save-Asset $assets[0] $gitZip
        Expand-Archive -LiteralPath $gitZip -DestinationPath $gitRoot
    } else { Write-Host '  Git is already installed.' }
    if (-not $state['Project clone']) {
        # Keep incomplete clones/local files recoverable; replace only after a successful clone.
        $pendingClone = Join-Path $InstallRoot ('panel.pending-' + [guid]::NewGuid().ToString('N'))
        Copy-Project $gitExe $RepositoryUrl $RepositoryBranch $pendingClone
        if (Test-Path -LiteralPath $panelRoot) {
            $backup = Join-Path $InstallRoot ('panel.incomplete-' + [guid]::NewGuid().ToString('N'))
            Move-Item -LiteralPath $panelRoot -Destination $backup
            Write-Host "  Incomplete project preserved in $backup"
        }
        Move-Item -LiteralPath $pendingClone -Destination $panelRoot
    } else { Write-Host '  Project is already cloned (it is not updated; local files are kept).' }

    Write-Host '[2/8] Portable Node.js 24 (verified SHA256)...'
    if (-not $state['Node.js 24']) {
        Remove-InsideRoot $InstallRoot $nodeRoot
        $checksums = (Invoke-WebRequest -UseBasicParsing -Uri 'https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt' -TimeoutSec 60).Content
        $nodeMatch = [regex]::Match($checksums, '(?m)^([a-fA-F0-9]{64})\s+(node-v24\.[\d.]+-win-x64\.zip)\s*$')
        if (-not $nodeMatch.Success) { throw 'Node.js Windows x64 archive not found in official SHA256 manifest.' }
        $nodeZip = Join-Path $downloads 'node.zip'
        Invoke-Download "https://nodejs.org/dist/latest-v24.x/$($nodeMatch.Groups[2].Value)" $nodeZip $nodeMatch.Groups[1].Value
        $nodeExtracted = Join-Path $InstallRoot ('tools\' + $nodeMatch.Groups[2].Value.Replace('.zip', ''))
        Remove-InsideRoot $InstallRoot $nodeExtracted
        Expand-Archive -LiteralPath $nodeZip -DestinationPath (Join-Path $InstallRoot 'tools')
        Move-Item -LiteralPath $nodeExtracted -Destination $nodeRoot
    } else { Write-Host '  Node.js is already installed.' }
    $env:PATH = "$nodeRoot;$env:PATH"
    Invoke-Native $nodeExe @('--version')

    Write-Host '[3/8] Portable .NET SDK 10...'
    $env:DOTNET_ROOT = $dotnetRoot
    if (-not $state['.NET SDK 10']) {
        $dotnetScript = Join-Path $downloads 'dotnet-install.ps1'
        Invoke-Download 'https://dot.net/v1/dotnet-install.ps1' $dotnetScript
        Invoke-Native "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $dotnetScript, '-Channel', '10.0', '-Quality', 'GA', '-Architecture', 'x64', '-InstallDir', $env:DOTNET_ROOT, '-NoPath')
    } else { Write-Host '  .NET SDK is already installed.' }
    $env:PATH = "$env:DOTNET_ROOT;$env:PATH"
    Invoke-Native $dotnetExe @('--version')

    Write-Host '[4/8] Microsoft VC++ x64 runtime...'
    if (-not $state['VC++ runtime']) {
        $vcInstaller = Join-Path $downloads 'vc_redist.x64.exe'
        Invoke-Download 'https://aka.ms/vc14/vc_redist.x64.exe' $vcInstaller
        $signature = Get-AuthenticodeSignature -LiteralPath $vcInstaller
        if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') { throw 'VC++ installer does not have a valid Microsoft signature.' }
        $vc = Start-Process -FilePath $vcInstaller -ArgumentList @('/install', '/quiet', '/norestart') -WindowStyle Hidden -Wait -PassThru
        if ($vc.ExitCode -notin @(0, 1638, 3010)) { throw "VC++ setup failed: $($vc.ExitCode)" }
        if ($vc.ExitCode -eq 3010) { Write-Warning 'VC++ runtime installation requires a Windows restart before starting CS2.' }
    } else { Write-Host '  VC++ runtime is already installed.' }

    Write-Host '[5/8] SteamCMD and a separate CS2 server...'
    if (-not $state['SteamCMD']) {
        $steamZip = Join-Path $downloads 'steamcmd.zip'
        Invoke-Download 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip' $steamZip
        Remove-InsideRoot $InstallRoot $steamRoot
        Expand-Archive -LiteralPath $steamZip -DestinationPath $steamRoot
    } else { Write-Host '  SteamCMD is already installed.' }
    if (-not $state['CS2 server'] -and -not $NoClientCopy) {
        # Seeding the server from the client's files: app_update ... validate below checks them and downloads only what
        # differs (dedicated-server files, newer build) instead of the whole game. A rerun copies only changed files.
        foreach ($process in @(Get-Process cs2 -ErrorAction SilentlyContinue)) {
            if ($process.Path -and $process.Path.StartsWith($Cs2Path + '\', [StringComparison]::OrdinalIgnoreCase)) {
                throw 'Close the CS2 game client: its files are copied to the server. Or use -NoClientCopy.'
            }
        }
        Write-Host "  Copying CS2 from the Steam client ($Cs2Path)..."
        $copyLog = Join-Path $InstallRoot 'logs\cs2-copy.log'
        $copyExit = Copy-Cs2Client $Cs2Path $serverRoot $copyLog
        # Robocopy exit codes 0-7 mean success (files copied, skipped or extra); 8 and above are failures.
        if ($copyExit -ge 8) { throw "Copying CS2 from the Steam client failed (robocopy exit code $copyExit). See logs\cs2-copy.log, or rerun with -NoClientCopy." }
        Assert-FreeSpace $driveRoot (8GB)
    }
    if (-not $state['CS2 server'] -or $UpdateGame) {
        # A SteamCMD runscript preserves spaces in the installation path. Rerunning resumes/validates files.
        $steamScript = Join-Path $downloads 'install-steam.txt'
        [IO.File]::WriteAllLines($steamScript, @('@ShutdownOnFailedCommand 1', '@NoPromptForPassword 1', "force_install_dir `"$serverRoot`"", 'login anonymous', 'app_update 730 validate', 'quit'), (New-Object Text.UTF8Encoding $false))
        $steamLog = Join-Path $InstallRoot 'logs\steamcmd.log'
        Push-Location $steamRoot
        try {
            # A fresh SteamCMD updates itself on its first start and then exits with a non-zero code (often 7) even after a
            # successful run. Let it update on its own first; its exit code here does not matter.
            & (Join-Path $steamRoot 'steamcmd.exe') '+quit' 2>&1 | Tee-Object -FilePath (Join-Path $InstallRoot 'logs\steamcmd-update.log') | Out-Null
            & (Join-Path $steamRoot 'steamcmd.exe') '+runscript' $steamScript 2>&1 | Tee-Object -FilePath $steamLog
            $steamExit = $LASTEXITCODE
        } finally { Pop-Location }
        # The success line and the installed app manifest decide; the exit code alone is not reliable (see above).
        if (-not (Select-String -LiteralPath $steamLog -Pattern "Success! App '730' fully installed" -Quiet) -or -not (Test-Cs2ServerInstalled $serverRoot)) {
            throw "SteamCMD did not confirm successful CS2 installation (exit code $steamExit). See logs\steamcmd.log. The server has not been configured. Run the installer again to resume."
        }
        if ($steamExit -ne 0) { Write-Host "  SteamCMD exited with code $steamExit, but confirmed the installation; continuing." }
        Assert-FreeSpace $driveRoot (8GB)
        # Validation can restore the original gameinfo.gi; Metamod is re-enabled below in any case.
    } else { Write-Host '  CS2 server is already installed (use -UpdateGame to update/validate it).' }

    Write-Host '[6/8] Metamod 2.x and CounterStrikeSharp with runtime...'
    if (-not $state['Metamod']) {
        # Current CounterStrikeSharp requires Metamod 2.x, build >=1467 (KHook).
        $mmPage = (Invoke-WebRequest -UseBasicParsing -Uri 'https://www.sourcemm.net/downloads.php/?branch=master' -TimeoutSec 60).Content
        $mmMatch = [regex]::Match($mmPage, 'https://github\.com/alliedmodders/metamod-source/releases/download/2\.[^"\s<>]+/mmsource-2\.[^"\s<>]*-git(\d+)-windows\.zip')
        if (-not $mmMatch.Success -or [int]$mmMatch.Groups[1].Value -lt 1467) { throw 'Compatible Metamod 2.x Windows download was not found on the official site.' }
        $mmZip = Join-Path $downloads 'metamod.zip'
        Invoke-Download $mmMatch.Value $mmZip
        Invoke-WithPreservedFiles @((Join-Path $gameDir 'addons\metamod\metaplugins.ini')) { Expand-Archive -LiteralPath $mmZip -DestinationPath $gameDir -Force }
        if (-not (Test-MetamodInstalled $gameDir)) { throw 'Metamod extraction is incomplete.' }
    } else { Write-Host '  Metamod is already installed.' }
    if (-not $state['CounterStrikeSharp']) {
        $cssRelease = Get-Release 'roflmuffin/CounterStrikeSharp'
        if ([version]$cssRelease.tag_name.TrimStart('v') -lt [version]'1.0.379') { throw 'CounterStrikeSharp 1.0.379 or newer is required by this ArenaPro build.' }
        $cssAssets = @($cssRelease.assets | Where-Object { $_.name -match '^counterstrikesharp-with-runtime-windows-(?:x64-)?[\d.]+\.zip$' })
        if ($cssAssets.Count -ne 1) { throw 'Cannot find a unique CounterStrikeSharp with-runtime Windows x64 ZIP.' }
        $cssZip = Join-Path $downloads 'counterstrikesharp.zip'
        Save-Asset $cssAssets[0] $cssZip
        Invoke-WithPreservedFiles @((Join-Path $gameDir 'addons\counterstrikesharp\configs')) { Expand-Archive -LiteralPath $cssZip -DestinationPath $gameDir -Force }
        if (-not (Test-CssInstalled $gameDir)) { throw 'CounterStrikeSharp extraction is incomplete or its API/runtime is incompatible.' }
    } else { Write-Host '  CounterStrikeSharp is already installed.' }
    Enable-Metamod (Join-Path $gameDir 'gameinfo.gi') # no-op when already enabled; repairs it after a Steam update

    Write-Host '[7/8] Panel and ArenaPro build...'
    Push-Location $panelRoot
    try {
        if (-not (Test-NpmComplete $panelRoot)) {
            Invoke-Native $npm @('ci', '--no-audit', '--no-fund')
            [IO.File]::WriteAllText((Join-Path $panelRoot 'node_modules\.installer-lock.sha256'), (Get-FileHash -LiteralPath (Join-Path $panelRoot 'package-lock.json') -Algorithm SHA256).Hash)
        } else { Write-Host '  npm dependencies are already installed.' }
        if (-not $state['Panel build']) { Invoke-Native $npm @('run', 'build') }
        else { Write-Host '  Panel is already built.' }
        if (-not $state['ArenaPro plugin']) {
            Invoke-WithPreservedFiles @((Join-Path $gameDir 'cfg\ArenaPro')) { & (Join-Path $panelRoot 'scripts\build-plugin.ps1') -DeployTo $gameDir }
            if (-not (Test-ArenaProInstalled $gameDir)) { throw 'ArenaPro package was not completely deployed.' }
        } else { Write-Host '  ArenaPro is already deployed.' }
    } finally { Pop-Location }

    Write-Host '[8/8] LAN configuration, panel database, launchers and firewall...'
    # 'auto': no fixed URL, the panel detects its address at start (empty PublicUrl).
    $publicUrl = if ($saved) { [string]$saved.PublicUrl } elseif ($ServerAddress -eq 'auto') { '' } else { "http://${ServerAddress}:$PanelPort" }
    $settings = [ordered]@{ ServerAddress = $ServerAddress; ServerPort = $ServerPort; PanelPort = $PanelPort; TvPort = $TvPort; PublicUrl = $publicUrl }
    if (-not $state['Launchers']) { Write-Launchers $InstallRoot $settings -MissingOnly:$existing }
    else { Write-Host '  Launchers already exist.' }
    $newPanelDatabase = -not (Test-Path -LiteralPath $dbPath)
    if (-not $state['Panel database'] -or -not (Test-Path -LiteralPath $serverCfg) -or -not (Test-Path -LiteralPath $credentialsPath)) {
        # Persist pending secrets BEFORE touching SQLite. A failed bootstrap can be retried
        # with the same secrets, even if SQLite has already created its file/schema.
        $bootstrapInput = Join-Path $InstallRoot 'temp\bootstrap.json'
        if (-not (Test-Path -LiteralPath $bootstrapInput)) {
            $rconPassword = New-Secret
            $adminPassword = New-Secret
            if (Test-Path -LiteralPath $credentialsPath) {
                $rconLine = Select-String -LiteralPath $credentialsPath -Pattern '^RCON password: (.+)$' | Select-Object -First 1
                $adminLine = Select-String -LiteralPath $credentialsPath -Pattern '^Initial password: ([a-f0-9]{48})$' | Select-Object -First 1
                if ($rconLine) { $rconPassword = $rconLine.Matches[0].Groups[1].Value }
                if ($adminLine) { $adminPassword = $adminLine.Matches[0].Groups[1].Value }
            }
            if (Test-Path -LiteralPath $serverCfg) {
                $match = [regex]::Match([IO.File]::ReadAllText($serverCfg), '(?im)^\s*rcon_password\s+"([^"\r\n]*)"\s*$')
                if (-not $match.Success) { throw 'Cannot safely read rcon_password from the existing server config. Restore its quoted value before repairing.' }
                $rconPassword = $match.Groups[1].Value
            }
            @{ AdminPassword = $adminPassword; RconPassword = $rconPassword; ServerAddress = $ServerAddress; ServerPort = $ServerPort; PublicUrl = $(if ($settings.PublicUrl) { $settings.PublicUrl } else { $displayUrl }); ServerConfigPath = $serverCfg; CredentialsPath = $credentialsPath } |
                ConvertTo-Json | Set-Content -LiteralPath $bootstrapInput -Encoding UTF8
        }
        $pending = Get-Content -LiteralPath $bootstrapInput -Raw | ConvertFrom-Json
        if ($pending.ServerAddress -ne $ServerAddress -or $pending.ServerPort -ne $ServerPort) { throw 'Pending database initialization uses different server settings. Restore installation.json before retrying.' }
        # Upgrade pending input left by older installer versions, preserving its secrets.
        foreach ($entry in @{ PublicUrl = $(if ($settings.PublicUrl) { $settings.PublicUrl } else { $displayUrl }); ServerConfigPath = $serverCfg; CredentialsPath = $credentialsPath }.GetEnumerator()) {
            $pending | Add-Member -NotePropertyName $entry.Key -NotePropertyValue $entry.Value -Force
        }
        $pending | ConvertTo-Json | Set-Content -LiteralPath $bootstrapInput -Encoding UTF8
        # Use the application's compiled schema and hashing implementation; no live HTTP server is needed.
        $bootstrap = @'
import { readFileSync } from 'node:fs';
import { existsSync, writeFileSync } from 'node:fs';
import { db } from './server/dist/db.js';
import { hashPassword } from './server/dist/auth.js';
const input = JSON.parse(readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, ''));
db.exec('BEGIN IMMEDIATE');
try {
    const existingAdmin = db.prepare('SELECT username FROM admins ORDER BY id LIMIT 1').get();
    const hasAdmin = !!existingAdmin;
    const server = db.prepare('SELECT * FROM game_servers WHERE host = ? AND port = ?').get(input.ServerAddress, input.ServerPort);
    const rcon = server?.rcon_password ?? input.RconPassword;
    if (!rcon || /[";\r\n]/.test(rcon)) throw new Error('RCON password cannot be safely represented in the server config');
    if (input.ServerConfigPath && existsSync(input.ServerConfigPath)) {
        const match = readFileSync(input.ServerConfigPath, 'utf8').match(/^\s*rcon_password\s+"([^"\r\n]*)"\s*$/m);
        if (!match || match[1] !== rcon) throw new Error('Existing RCON config differs from the panel database; no passwords were changed');
    }
    if (!hasAdmin) db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run('admin', await hashPassword(input.AdminPassword));
    if (!server) db.prepare('INSERT INTO game_servers (name, host, port, rcon_password) VALUES (?, ?, ?, ?)').run('Local ArenaPro', input.ServerAddress, input.ServerPort, rcon);
    if (input.ServerConfigPath && !existsSync(input.ServerConfigPath)) {
        writeFileSync(input.ServerConfigPath, `hostname "CS2 ArenaPro LAN"\nsv_lan 1\nrcon_password "${rcon}"\ntv_enable 1\n`, { flag: 'wx' });
    }
    if (input.CredentialsPath && !existsSync(input.CredentialsPath)) {
        const password = hasAdmin ? 'unavailable (existing account; use the panel password reset command)' : input.AdminPassword;
        writeFileSync(input.CredentialsPath, `Panel: ${input.PublicUrl}\nLogin: ${existingAdmin?.username ?? 'admin'}\nInitial password: ${password}\nServer: ${input.ServerAddress === 'auto' ? 'this computer' : input.ServerAddress}:${input.ServerPort}\nRCON password: ${rcon}\n`, { flag: 'wx' });
    }
    db.exec('COMMIT');
} catch (error) { db.exec('ROLLBACK'); throw error; }
finally { db.close(); }
'@
        $bootstrapPath = Join-Path $panelRoot 'installer-bootstrap.mjs'
        Set-Content -LiteralPath $bootstrapPath -Value $bootstrap -Encoding UTF8
        $env:DATA_DIR = Join-Path $InstallRoot 'data'
        try {
            Invoke-Native $nodeExe @($bootstrapPath, $bootstrapInput)
            Remove-Item -LiteralPath $bootstrapInput -Force
        } finally {
            Remove-Item -LiteralPath $bootstrapPath -Force -ErrorAction SilentlyContinue
        }
    } else {
        Write-Host '  Panel database already exists; admin account and passwords are kept.'
    }
    if (-not $SkipFirewall) {
        foreach ($rule in $firewallRules) {
            $ruleName = "CS2Tournament-$installId-$($rule.Name)"
            if (Test-FirewallRule $ruleName $rule.Program $rule.Port $rule.Protocol) { continue }
            Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
            New-NetFirewallRule -Name $ruleName -DisplayName "CS2Tournament $PanelPort $($rule.Name)" -Direction Inbound -Action Allow -Profile Private,Domain -RemoteAddress LocalSubnet -Protocol $rule.Protocol -LocalPort $rule.Port -Program $rule.Program | Out-Null
        }
    }
    Write-Host 'Installation is complete.'
    if ($newPanelDatabase) { Write-Host "Credentials: $credentialsPath" }
    Write-Host "Start panel: & '$InstallRoot\start-panel.ps1'"
    Write-Host "Start server: & '$InstallRoot\start-server.ps1'"
    Write-Host 'Verify meta list and css_plugins list in the game server console before a tournament.'
} catch {
    Write-Error -Message $_.Exception.Message -ErrorAction Continue
    if ($transcribing) { Write-Host "Incomplete installation kept for diagnostics: $InstallRoot. See logs\install.log. Run the installer again with the same -InstallRoot to resume. Nothing is started automatically." }
    exit 1
} finally {
    foreach ($name in $savedEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process') }
    if ($transcribing) { Stop-Transcript | Out-Null }
    if ($mutexOwned) { $installMutex.ReleaseMutex() }
    if ($installMutex) { $installMutex.Dispose() }
}
