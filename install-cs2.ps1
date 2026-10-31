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
    [string]$ServerAddress = '',
    [ValidateRange(1, 65535)][int]$ServerPort = 27015,
    [ValidateRange(1, 65535)][int]$PanelPort = 3000,
    [ValidateRange(1, 65535)][int]$TvPort = 27020,
    [ValidateRange(120, 4096)][int]$RequiredFreeGB = 120,
    [switch]$SkipFirewall,
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
    foreach ($steam in @($steamRoots | Select-Object -Unique)) {
        $vdf = Join-Path $steam 'steamapps\libraryfolders.vdf'
        if (-not (Test-Path -LiteralPath $vdf)) { continue }
        $content = Get-Content -LiteralPath $vdf -Raw
        foreach ($match in [regex]::Matches($content, '"(?:path|\d+)"\s+"([A-Za-z]:[^"\r\n]+)"')) {
            $libraries += $match.Groups[1].Value.Replace('\\', '\')
        }
    }
    foreach ($library in @($libraries | Select-Object -Unique)) {
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
    foreach ($file in @('package.json', 'package-lock.json', 'server\package.json', 'web\package.json', 'plugin\ArenaPro.csproj', 'scripts\build-plugin.ps1')) {
        if (-not (Test-Path -LiteralPath (Join-Path $Directory $file) -PathType Leaf)) {
            throw "Project file missing in the cloned repository: $Directory\$file. Check -RepositoryUrl and -RepositoryBranch."
        }
    }
}

function Get-LanAddress {
    $addresses = @(Get-LocalIPv4 -WithGateway | Select-Object -Unique)
    if ($addresses.Count -ne 1) { throw 'Cannot select a LAN IPv4 address unambiguously. Specify -ServerAddress, for example 192.168.1.20.' }
    return $addresses[0]
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

function Clone-Project([string]$GitExe, [string]$Url, [string]$Branch, [string]$Destination) {
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

function Write-Launchers([string]$Root, $Settings) {
    # Read JSON at runtime; never interpolate user paths/passwords into executable code.
    $common = @'
#requires -Version 5.1
$ErrorActionPreference = 'Stop'
$settings = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'installation.json') -Raw | ConvertFrom-Json
'@
    $server = $common + @'

$exe = Join-Path $PSScriptRoot 'cs2\game\bin\win64\cs2.exe'
Set-Location (Join-Path $PSScriptRoot 'cs2')
& $exe -dedicated -console -condebug -usercon -insecure -ip $settings.ServerAddress -port $settings.ServerPort +sv_lan 1 +tv_port $settings.TvPort +game_type 0 +game_mode 2 +exec arenapro-server.cfg +map de_inferno
if ($LASTEXITCODE -ne 0) { throw "CS2 exited with code $LASTEXITCODE" }
'@
    $panel = $common + @'

$env:PORT = [string]$settings.PanelPort
$env:HOST = '0.0.0.0'
$env:PUBLIC_URL = $settings.PublicUrl
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
    Set-Content -LiteralPath (Join-Path $Root 'start-server.ps1') -Value $server -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $Root 'start-panel.ps1') -Value $panel -Encoding UTF8
    Set-Content -LiteralPath (Join-Path $Root 'start-all.ps1') -Value $both -Encoding UTF8
    $Settings | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $Root 'installation.json') -Encoding UTF8
}

$savedEnvironment = @{}
$transcribing = $false
try {
    if (-not [Environment]::Is64BitProcess -or [Environment]::OSVersion.Platform -ne 'Win32NT' -or $env:PROCESSOR_ARCHITECTURE -ne 'AMD64') {
        throw 'Use 64-bit Windows PowerShell on Windows x64.'
    }
    if (-not $Cs2Path) {
        $found = @(Find-Cs2Directories | Select-Object -Unique)
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
    if (Test-Path -LiteralPath $InstallRoot) {
        if (-not (Test-Path -LiteralPath $InstallRoot -PathType Container) -or @(Get-ChildItem -LiteralPath $InstallRoot -Force).Count) {
            throw "Installation directory is not empty: $InstallRoot. Choose a new/empty directory; existing files will not be overwritten."
        }
    }
    Assert-FreeSpace $driveRoot (Get-RequiredBytes $Cs2Path $RequiredFreeGB)
    # VC++ setup also needs space on the Windows volume.
    $windowsDrive = [IO.Path]::GetPathRoot($env:SystemRoot)
    if ($windowsDrive -ine $driveRoot) { Assert-FreeSpace $windowsDrive (2GB) }
    if (@($ServerPort, $PanelPort, $TvPort | Select-Object -Unique).Count -ne 3) { throw 'ServerPort, PanelPort and TvPort must be different.' }
    if (-not $ServerAddress) { $ServerAddress = Get-LanAddress }
    $parsedIp = $null
    if (-not [Net.IPAddress]::TryParse($ServerAddress, [ref]$parsedIp) -or $parsedIp.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork -or $ServerAddress -match '^(0\.|127\.|169\.254\.)') {
        throw 'ServerAddress must be a reachable LAN IPv4 address of this computer.'
    }
    $localAddresses = @(Get-LocalIPv4)
    if ($ServerAddress -notin $localAddresses) { throw "ServerAddress is not assigned to this computer: $ServerAddress" }
    if ($RepositoryUrl -notmatch '^https://github\.com/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(?:\.git)?/?$') {
        throw 'RepositoryUrl must be a public https://github.com/owner/repository URL without credentials.'
    }
    if ($RepositoryBranch.StartsWith('-')) { throw 'Invalid RepositoryBranch.' }
    Write-Host "Steam CS2: $Cs2Path"
    Write-Host "Separate server and panel: $InstallRoot"
    Write-Host "Repository: $RepositoryUrl"
    Write-Host "Panel URL: http://${ServerAddress}:$PanelPort"
    if ($CheckOnly) { Write-Host 'Preflight OK. Nothing was downloaded, installed or created.'; return }
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'Run PowerShell as Administrator (required for VC++ Redistributable and Windows Firewall). Use -CheckOnly for a read-only preflight.'
    }
    New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
    Protect-InstallDirectory $InstallRoot
    foreach ($name in @('downloads', 'tools', 'logs', 'temp', 'cache', 'data')) {
        New-Item -ItemType Directory -Path (Join-Path $InstallRoot $name) | Out-Null
    }
    Start-Transcript -LiteralPath (Join-Path $InstallRoot 'logs\install.log') | Out-Null
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
    $downloads = Join-Path $InstallRoot 'downloads'
    $panelRoot = Join-Path $InstallRoot 'panel'

    Write-Host '[1/8] Installing portable Git and cloning the project...'
    $gitRelease = Get-Release 'git-for-windows/git'
    $assets = @($gitRelease.assets | Where-Object { $_.name -match '^MinGit-[\d.]+-64-bit\.zip$' })
    if ($assets.Count -ne 1) { throw 'Cannot find a unique Windows x64 MinGit ZIP in the official release.' }
    $gitZip = Join-Path $downloads 'mingit.zip'
    Save-Asset $assets[0] $gitZip
    $gitRoot = Join-Path $InstallRoot 'tools\git'
    Expand-Archive -LiteralPath $gitZip -DestinationPath $gitRoot
    Clone-Project (Join-Path $gitRoot 'cmd\git.exe') $RepositoryUrl $RepositoryBranch $panelRoot

    Write-Host '[2/8] Installing portable Node.js 24 (verified SHA256)...'
    $checksums = (Invoke-WebRequest -UseBasicParsing -Uri 'https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt' -TimeoutSec 60).Content
    $nodeMatch = [regex]::Match($checksums, '(?m)^([a-fA-F0-9]{64})\s+(node-v24\.[\d.]+-win-x64\.zip)\s*$')
    if (-not $nodeMatch.Success) { throw 'Node.js Windows x64 archive not found in official SHA256 manifest.' }
    $nodeZip = Join-Path $downloads 'node.zip'
    Invoke-Download "https://nodejs.org/dist/latest-v24.x/$($nodeMatch.Groups[2].Value)" $nodeZip $nodeMatch.Groups[1].Value
    Expand-Archive -LiteralPath $nodeZip -DestinationPath (Join-Path $InstallRoot 'tools')
    Move-Item -LiteralPath (Join-Path $InstallRoot ('tools\' + $nodeMatch.Groups[2].Value.Replace('.zip', ''))) -Destination (Join-Path $InstallRoot 'tools\node')
    $nodeRoot = Join-Path $InstallRoot 'tools\node'
    $nodeExe = Join-Path $nodeRoot 'node.exe'
    $npm = Join-Path $nodeRoot 'npm.cmd'
    $env:PATH = "$nodeRoot;$env:PATH"
    Invoke-Native $nodeExe @('--version')

    Write-Host '[3/8] Installing portable .NET SDK 10...'
    $dotnetScript = Join-Path $downloads 'dotnet-install.ps1'
    Invoke-Download 'https://dot.net/v1/dotnet-install.ps1' $dotnetScript
    $env:DOTNET_ROOT = Join-Path $InstallRoot 'tools\dotnet'
    Invoke-Native "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $dotnetScript, '-Channel', '10.0', '-Quality', 'GA', '-Architecture', 'x64', '-InstallDir', $env:DOTNET_ROOT, '-NoPath')
    $env:PATH = "$env:DOTNET_ROOT;$env:PATH"
    Invoke-Native (Join-Path $env:DOTNET_ROOT 'dotnet.exe') @('--version')

    Write-Host '[4/8] Installing Microsoft VC++ x64 runtime...'
    $vcInstaller = Join-Path $downloads 'vc_redist.x64.exe'
    Invoke-Download 'https://aka.ms/vc14/vc_redist.x64.exe' $vcInstaller
    $signature = Get-AuthenticodeSignature -LiteralPath $vcInstaller
    if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation') { throw 'VC++ installer does not have a valid Microsoft signature.' }
    $vc = Start-Process -FilePath $vcInstaller -ArgumentList @('/install', '/quiet', '/norestart') -WindowStyle Hidden -Wait -PassThru
    if ($vc.ExitCode -notin @(0, 1638, 3010)) { throw "VC++ setup failed: $($vc.ExitCode)" }
    if ($vc.ExitCode -eq 3010) { Write-Warning 'VC++ runtime installation requires a Windows restart before starting CS2.' }

    Write-Host '[5/8] Installing SteamCMD and a separate CS2 server (large download)...'
    Assert-FreeSpace $driveRoot (100GB)
    $steamZip = Join-Path $downloads 'steamcmd.zip'
    Invoke-Download 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip' $steamZip
    $steamRoot = Join-Path $InstallRoot 'tools\steamcmd'
    Expand-Archive -LiteralPath $steamZip -DestinationPath $steamRoot
    $serverRoot = Join-Path $InstallRoot 'cs2'
    # A SteamCMD runscript preserves spaces in the installation path.
    $steamScript = Join-Path $downloads 'install-steam.txt'
    [IO.File]::WriteAllLines($steamScript, @('@ShutdownOnFailedCommand 1', '@NoPromptForPassword 1', "force_install_dir `"$serverRoot`"", 'login anonymous', 'app_update 730 validate', 'quit'), (New-Object Text.UTF8Encoding $false))
    $steamLog = Join-Path $InstallRoot 'logs\steamcmd.log'
    Push-Location $steamRoot
    try {
        & (Join-Path $steamRoot 'steamcmd.exe') '+runscript' $steamScript 2>&1 | Tee-Object -FilePath $steamLog
        $steamExit = $LASTEXITCODE
    } finally { Pop-Location }
    if ($steamExit -ne 0 -or -not (Select-String -LiteralPath $steamLog -Pattern "Success! App '730' fully installed" -Quiet) -or -not (Test-Path -LiteralPath (Join-Path $serverRoot 'game\bin\win64\cs2.exe'))) {
        throw 'SteamCMD did not confirm successful CS2 installation. See logs\steamcmd.log. The server has not been configured.'
    }
    Assert-FreeSpace $driveRoot (8GB)

    Write-Host '[6/8] Installing Metamod 2.x and CounterStrikeSharp with runtime...'
    # Current CounterStrikeSharp requires Metamod 2.x, build >=1467 (KHook).
    $mmPage = (Invoke-WebRequest -UseBasicParsing -Uri 'https://www.sourcemm.net/downloads.php/?branch=master' -TimeoutSec 60).Content
    $mmMatch = [regex]::Match($mmPage, 'https://github\.com/alliedmodders/metamod-source/releases/download/2\.[^"\s<>]+/mmsource-2\.[^"\s<>]*-git(\d+)-windows\.zip')
    if (-not $mmMatch.Success -or [int]$mmMatch.Groups[1].Value -lt 1467) { throw 'Compatible Metamod 2.x Windows download was not found on the official site.' }
    $mmZip = Join-Path $downloads 'metamod.zip'
    Invoke-Download $mmMatch.Value $mmZip
    $gameDir = Join-Path $serverRoot 'game\csgo'
    Expand-Archive -LiteralPath $mmZip -DestinationPath $gameDir -Force
    $cssRelease = Get-Release 'roflmuffin/CounterStrikeSharp'
    if ([version]$cssRelease.tag_name.TrimStart('v') -lt [version]'1.0.379') { throw 'CounterStrikeSharp 1.0.379 or newer is required by this ArenaPro build.' }
    $cssAssets = @($cssRelease.assets | Where-Object { $_.name -match '^counterstrikesharp-with-runtime-windows-(?:x64-)?[\d.]+\.zip$' })
    if ($cssAssets.Count -ne 1) { throw 'Cannot find a unique CounterStrikeSharp with-runtime Windows x64 ZIP.' }
    $cssZip = Join-Path $downloads 'counterstrikesharp.zip'
    Save-Asset $cssAssets[0] $cssZip
    Expand-Archive -LiteralPath $cssZip -DestinationPath $gameDir -Force
    Enable-Metamod (Join-Path $gameDir 'gameinfo.gi')

    Write-Host '[7/8] Building panel and ArenaPro...'
    Push-Location $panelRoot
    try {
        Invoke-Native $npm @('ci', '--no-audit', '--no-fund')
        Invoke-Native $npm @('run', 'build')
        & (Join-Path $panelRoot 'scripts\build-plugin.ps1') -DeployTo $gameDir
        if (-not (Test-Path -LiteralPath (Join-Path $gameDir 'addons\counterstrikesharp\plugins\ArenaPro\ArenaPro.dll'))) { throw 'ArenaPro DLL was not deployed.' }
    } finally { Pop-Location }

    Write-Host '[8/8] Creating LAN configuration, panel database and launchers...'
    $rconPassword = New-Secret
    $adminPassword = New-Secret
    $settings = [ordered]@{ ServerAddress = $ServerAddress; ServerPort = $ServerPort; PanelPort = $PanelPort; TvPort = $TvPort; PublicUrl = "http://${ServerAddress}:$PanelPort" }
    Write-Launchers $InstallRoot $settings
    @('hostname "CS2 ArenaPro LAN"', 'sv_lan 1', "rcon_password `"$rconPassword`"", 'tv_enable 1') |
        Set-Content -LiteralPath (Join-Path $gameDir 'cfg\arenapro-server.cfg') -Encoding ASCII
    # Use the application's compiled schema and hashing implementation; no live HTTP server is needed.
    $bootstrap = @'
import { readFileSync } from 'node:fs';
import { db } from './server/dist/db.js';
import { hashPassword } from './server/dist/auth.js';
const input = JSON.parse(readFileSync(process.argv[2], 'utf8').replace(/^\uFEFF/, ''));
if (db.prepare('SELECT COUNT(*) AS n FROM admins').get().n !== 0) throw new Error('Refusing to replace existing admins');
db.prepare('INSERT INTO admins (username, password_hash) VALUES (?, ?)').run('admin', await hashPassword(input.AdminPassword));
db.prepare('INSERT INTO game_servers (name, host, port, rcon_password) VALUES (?, ?, ?, ?)').run('Local ArenaPro', input.ServerAddress, input.ServerPort, input.RconPassword);
db.close();
'@
    $bootstrapPath = Join-Path $panelRoot 'installer-bootstrap.mjs'
    Set-Content -LiteralPath $bootstrapPath -Value $bootstrap -Encoding UTF8
    $bootstrapInput = Join-Path $InstallRoot 'temp\bootstrap.json'
    @{ AdminPassword = $adminPassword; RconPassword = $rconPassword; ServerAddress = $ServerAddress; ServerPort = $ServerPort } |
        ConvertTo-Json | Set-Content -LiteralPath $bootstrapInput -Encoding UTF8
    $env:DATA_DIR = Join-Path $InstallRoot 'data'
    try { Invoke-Native $nodeExe @($bootstrapPath, $bootstrapInput) } finally {
        Remove-Item -LiteralPath $bootstrapPath, $bootstrapInput -Force -ErrorAction SilentlyContinue
    }
    # Write secrets directly, without placing them in the transcript or command line.
    $credentialsPath = Join-Path $InstallRoot 'credentials.txt'
    [IO.File]::WriteAllLines($credentialsPath, @("Panel: $($settings.PublicUrl)", 'Login: admin', "Initial password: $adminPassword", "Server: ${ServerAddress}:$ServerPort", "RCON password: $rconPassword"))
    if (-not $SkipFirewall) {
        foreach ($rule in @(
            @{ Name = 'Panel'; Port = $PanelPort; Protocol = 'TCP'; Program = $nodeExe },
            @{ Name = 'RCON'; Port = $ServerPort; Protocol = 'TCP'; Program = (Join-Path $serverRoot 'game\bin\win64\cs2.exe') },
            @{ Name = 'Game'; Port = $ServerPort; Protocol = 'UDP'; Program = (Join-Path $serverRoot 'game\bin\win64\cs2.exe') },
            @{ Name = 'GOTV'; Port = $TvPort; Protocol = 'UDP'; Program = (Join-Path $serverRoot 'game\bin\win64\cs2.exe') }
        )) {
            New-NetFirewallRule -DisplayName "CS2Tournament $PanelPort $($rule.Name)" -Direction Inbound -Action Allow -Profile Private,Domain -RemoteAddress LocalSubnet -Protocol $rule.Protocol -LocalPort $rule.Port -Program $rule.Program | Out-Null
        }
    }
    Write-Host "Installation complete. Credentials: $credentialsPath"
    Write-Host "Start panel: & '$InstallRoot\start-panel.ps1'"
    Write-Host "Start server: & '$InstallRoot\start-server.ps1'"
    Write-Host 'Verify meta list and css_plugins list in the game server console before a tournament.'
} catch {
    Write-Error -Message $_.Exception.Message -ErrorAction Continue
    if ($transcribing) { Write-Host "Incomplete installation kept for diagnostics: $InstallRoot. See logs\install.log. Nothing is started automatically." }
    exit 1
} finally {
    foreach ($name in $savedEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $savedEnvironment[$name], 'Process') }
    if ($transcribing) { Stop-Transcript | Out-Null }
}
