$ErrorActionPreference = 'Stop'

$script:StackRoot = (Get-Location).Path
$script:ExitRequested = $false
$script:Services = @('postgres', 'n8n', 'cloudflared')

function Write-Header {
  param([string]$Title)

  Write-Host ''
  Write-Host '============================================================' -ForegroundColor DarkCyan
  Write-Host "  $Title" -ForegroundColor Cyan
  Write-Host '============================================================' -ForegroundColor DarkCyan
}

function Write-Info {
  param([string]$Message)
  Write-Host "[INFO] $Message" -ForegroundColor Cyan
}

function Write-Success {
  param([string]$Message)
  Write-Host "[OK]   $Message" -ForegroundColor Green
}

function Write-Warning {
  param([string]$Message)
  Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Write-ErrorMessage {
  param([string]$Message)
  Write-Host "[ERR]  $Message" -ForegroundColor Red
}

function Clear-MenuScreen {
  try {
    [Console]::Clear()
  } catch {
    Clear-Host
  }
}

function Pause-Menu {
  Write-Host ''
  Write-Host 'Press Enter to clear completed output and return to the menu...' -ForegroundColor DarkCyan
  [void](Read-Host)
  Clear-MenuScreen
}

function Invoke-MenuAction {
  param([scriptblock]$Action)

  try {
    & $Action
  } catch {
    Write-ErrorMessage $_.Exception.Message
  }

  Pause-Menu
}

function Invoke-NativeCommand {
  param(
    [scriptblock]$Command,
    [switch]$Quiet
  )

  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & $Command | Out-Host
    $exitCode = $LASTEXITCODE
  } catch {
    if (-not $Quiet) {
      Write-ErrorMessage $_.Exception.Message
    }
    $exitCode = 1
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }

  return $exitCode
}

function Invoke-Compose {
  param([string[]]$Arguments)

  $display = "docker compose $($Arguments -join ' ')"
  Write-Info $display
  $exitCode = Invoke-NativeCommand -Command { & docker compose @Arguments }
  if ($exitCode -ne 0) {
    Write-ErrorMessage "Command failed with exit code $exitCode."
  }
  return $exitCode
}

function Test-DockerReady {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-ErrorMessage 'Docker CLI was not found. Install Docker Desktop or Docker Engine before running this stack.'
    return $false
  }

  try {
    & docker compose version *> $null
    if ($LASTEXITCODE -ne 0) {
      Write-ErrorMessage 'Docker Compose was not found or did not answer.'
      return $false
    }
  } catch {
    Write-ErrorMessage 'Docker Compose was not found or did not answer.'
    return $false
  }

  if ((Invoke-NativeCommand -Quiet -Command { & docker info *> $null }) -ne 0) {
    Write-ErrorMessage 'Docker is installed, but the Docker engine is not running.'
    return $false
  }

  return $true
}

function Get-RunningServices {
  if (-not (Test-Path -LiteralPath (Join-Path $script:StackRoot 'docker-compose.yml') -PathType Leaf)) {
    return @()
  }

  if (-not (Test-Path -LiteralPath (Get-EnvPath) -PathType Leaf)) {
    return @()
  }

  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    return @()
  }

  try {
    & docker info *> $null
    if ($LASTEXITCODE -ne 0) {
      return @()
    }

    $services = @(& docker compose ps --services --filter status=running 2>$null)
    if ($LASTEXITCODE -ne 0) {
      return @()
    }
  } catch {
    return @()
  }

  return @($services | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ })
}

function Write-ServiceStatus {
  param(
    [string]$Name,
    [string[]]$RunningServices,
    [string]$WhenRunning = '',
    [string]$WhenStopped = ''
  )

  $statusLabelWidth = 22
  $isRunning = $RunningServices -contains $Name
  $statusPrefix = ("  {0,-$statusLabelWidth}: " -f $Name)

  Write-Host $statusPrefix -NoNewline -ForegroundColor DarkCyan
  if ($isRunning) {
    Write-Host 'running' -NoNewline -ForegroundColor Green
    $suffix = $WhenRunning
  } else {
    Write-Host 'stopped' -NoNewline -ForegroundColor Yellow
    $suffix = $WhenStopped
  }

  if ($suffix) {
    Write-Host ' - ' -NoNewline
    $parts = $suffix -split '(https?://\S+)'
    foreach ($part in $parts) {
      if ([string]::IsNullOrWhiteSpace($part)) { continue }
      if ($part -match '^https?://\S+$') {
        Write-Host $part -NoNewline -ForegroundColor DarkYellow
      } else {
        Write-Host $part -NoNewline -ForegroundColor White
      }
    }
    Write-Host ''
  } else {
    Write-Host ''
  }
}

function Get-RunningServiceImage {
  param([string]$Service)

  try {
    $containerId = (& docker compose ps -q $Service 2>$null | Select-Object -First 1)
    $containerId = ([string]$containerId).Trim()
    if ($LASTEXITCODE -ne 0 -or -not $containerId) {
      return ''
    }

    $image = (& docker inspect $containerId --format '{{.Config.Image}}' 2>$null | Select-Object -First 1)
    if ($LASTEXITCODE -ne 0) {
      return ''
    }
    return ([string]$image).Trim()
  } catch {
    return ''
  }
}

function Write-ImageVersions {
  param([string[]]$RunningServices = @())

  Write-Host ''
  Write-Host 'Container images:' -ForegroundColor Cyan
  foreach ($service in $script:Services) {
    $label = "  {0,-10}: " -f $service
    if ($RunningServices -contains $service) {
      $image = Get-RunningServiceImage -Service $service
      if (-not $image) { $image = 'failed to detect' }
    } else {
      $image = 'stopped'
    }
    Write-Host "$label$image" -ForegroundColor White
  }
}

function Get-EnvPath {
  return (Join-Path $script:StackRoot '.env')
}

function Read-EnvFile {
  $envPath = Get-EnvPath
  $values = @{}
  if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) {
    return $values
  }

  foreach ($line in (Get-Content -LiteralPath $envPath)) {
    $text = ([string]$line).Trim()
    if (-not $text -or $text.StartsWith('#')) { continue }
    $equalsIndex = $text.IndexOf('=')
    if ($equalsIndex -le 0) { continue }
    $name = $text.Substring(0, $equalsIndex).Trim()
    $value = $text.Substring($equalsIndex + 1).Trim().Trim('"').Trim("'")
    $values[$name] = $value
  }

  return $values
}

function Get-EnvValue {
  param(
    [string]$Name,
    [hashtable]$Values,
    [string]$Default = ''
  )

  if ($Values.ContainsKey($Name)) {
    return ([string]$Values[$Name]).Trim()
  }
  return $Default
}

function Get-LocalN8nPort {
  param([hashtable]$Values = $null)

  if ($null -eq $Values) {
    $Values = Read-EnvFile
  }
  return (Get-EnvValue -Name 'N8N_LOCAL_PORT' -Values $Values -Default '5678')
}

function Get-LocalN8nUrl {
  param([hashtable]$Values = $null)

  $port = Get-LocalN8nPort -Values $Values
  return "http://localhost:$port/"
}

function Test-LocalPortConfig {
  param([hashtable]$Values)

  $portText = Get-LocalN8nPort -Values $Values
  $port = 0
  if (-not [int]::TryParse($portText, [ref]$port)) {
    return $false
  }
  return ($port -ge 1 -and $port -le 65535)
}

function Test-PlaceholderValue {
  param([string]$Value)

  $text = ([string]$Value).Trim()
  if (-not $text) { return $true }
  $lower = $text.ToLowerInvariant()
  return (
    $lower.Contains('replace-with') -or
    $lower.Contains('placeholder') -or
    $lower.Contains('change-me') -or
    $lower.Contains('<') -or
    $lower.Contains('>')
  )
}

function Test-HostnameOnly {
  param([string]$HostName)

  $value = ([string]$HostName).Trim()
  if (-not $value) { return $false }
  if ($value -match '://') { return $false }
  if ($value -match '[/:?#\s]') { return $false }
  if ($value.StartsWith('.') -or $value.EndsWith('.')) { return $false }
  if ($value.Length -gt 253) { return $false }

  $labels = $value.Split('.')
  if ($labels.Count -lt 2) { return $false }
  foreach ($label in $labels) {
    if (-not $label -or $label.Length -gt 63) { return $false }
    if ($label.StartsWith('-') -or $label.EndsWith('-')) { return $false }
    if ($label -notmatch '^[A-Za-z0-9-]+$') { return $false }
  }

  return $true
}

function Test-PublicUrlMatchesHost {
  param(
    [string]$PublicUrl,
    [string]$PublicHost
  )

  try {
    $uri = [Uri]$PublicUrl
  } catch {
    return $false
  }

  return ($uri.Scheme -eq 'https' -and $uri.Host -eq $PublicHost)
}

function Get-ServiceBlock {
  param([string]$ServiceName)

  $composePath = Join-Path $script:StackRoot 'docker-compose.yml'
  if (-not (Test-Path -LiteralPath $composePath -PathType Leaf)) {
    return @()
  }

  $lines = @(Get-Content -LiteralPath $composePath)
  $start = -1
  for ($index = 0; $index -lt $lines.Count; $index += 1) {
    if ($lines[$index] -match "^\s{2}$([regex]::Escape($ServiceName)):\s*$") {
      $start = $index
      break
    }
  }
  if ($start -lt 0) { return @() }

  $block = New-Object System.Collections.Generic.List[string]
  for ($index = $start; $index -lt $lines.Count; $index += 1) {
    if ($index -gt $start -and $lines[$index] -match '^\s{2}[A-Za-z0-9_-]+:\s*$') {
      break
    }
    $block.Add([string]$lines[$index])
  }

  return @($block)
}

function Test-ServiceHasPorts {
  param([string]$ServiceName)

  $block = Get-ServiceBlock -ServiceName $ServiceName
  foreach ($line in $block) {
    if ($line -match '^\s{4}ports:\s*$') {
      return $true
    }
  }
  return $false
}

function Get-ServicePortMappings {
  param([string]$ServiceName)

  $block = Get-ServiceBlock -ServiceName $ServiceName
  $ports = New-Object System.Collections.Generic.List[string]
  $insidePorts = $false
  foreach ($line in $block) {
    if ($line -match '^\s{4}ports:\s*$') {
      $insidePorts = $true
      continue
    }
    if ($insidePorts -and $line -match '^\s{4}[A-Za-z0-9_-]+:\s*') {
      break
    }
    if ($insidePorts -and $line -match '^\s{6}-\s*"?([^"]+)"?\s*$') {
      $ports.Add($matches[1].Trim())
    }
  }
  return @($ports)
}

function Test-ServiceHasUnsafePublicPorts {
  param([string]$ServiceName)

  foreach ($portMapping in (Get-ServicePortMappings -ServiceName $ServiceName)) {
    if ($portMapping -notmatch '^(127\.0\.0\.1|localhost):') {
      return $true
    }
  }
  return $false
}

function Add-PreflightResult {
  param(
    [string]$Name,
    [bool]$Passed,
    [string]$Why,
    [string]$Fix
  )

  if ($Passed) {
    Write-Success $Name
    return $true
  }

  Write-ErrorMessage $Name
  if ($Why) {
    Write-Host "       Why it failed: $Why" -ForegroundColor Red
  }
  if ($Fix) {
    Write-Host "       Fix: $Fix" -ForegroundColor Red
  }
  return $false
}

function Invoke-BasePreflight {
  param([switch]$FromCloudflarePreflight)

  if (-not $FromCloudflarePreflight) {
    Write-Header 'Base n8n Preflight'
  }
  $ok = $true
  $composePath = Join-Path $script:StackRoot 'docker-compose.yml'
  $envPath = Get-EnvPath
  $ok = (Add-PreflightResult -Name 'docker-compose.yml exists' -Passed (Test-Path -LiteralPath $composePath -PathType Leaf) -Why 'The launcher cannot know which services and ports to run without the Compose file.' -Fix 'Copy the production stack templates into this folder first.') -and $ok
  $ok = (Add-PreflightResult -Name '.env exists' -Passed (Test-Path -LiteralPath $envPath -PathType Leaf) -Why 'The launcher needs private database and n8n settings from .env before starting containers.' -Fix 'Copy .env.example to .env and fill the Step 1 private values.') -and $ok

  $values = Read-EnvFile
  $ok = (Add-PreflightResult -Name 'N8N_LOCAL_PORT is a valid local port' -Passed (Test-LocalPortConfig -Values $values) -Why 'Docker needs a valid localhost port for the n8n editor.' -Fix 'Use a whole number from 1 to 65535, such as 5678 or 5679.') -and $ok

  $n8nKey = Get-EnvValue -Name 'N8N_ENCRYPTION_KEY' -Values $values
  if (-not $FromCloudflarePreflight) {
    if (Test-PlaceholderValue -Value $n8nKey) {
      Write-Warning 'N8N_ENCRYPTION_KEY is missing or still a placeholder. Local n8n start is allowed, but replace it before saving credentials or starting the Cloudflare tunnel.'
    } else {
      Write-Success 'N8N_ENCRYPTION_KEY is set'
    }
  }

  $postgresPassword = Get-EnvValue -Name 'POSTGRES_PASSWORD' -Values $values
  if (-not $FromCloudflarePreflight) {
    if (Test-PlaceholderValue -Value $postgresPassword) {
      Write-Warning 'POSTGRES_PASSWORD is missing or still a placeholder. Local n8n start is allowed, but replace it before saving production data or starting the Cloudflare tunnel.'
    } else {
      Write-Success 'POSTGRES_PASSWORD is set'
    }
  }

  $ok = (Add-PreflightResult -Name 'Postgres has no public port mapping' -Passed (-not (Test-ServiceHasPorts -ServiceName 'postgres')) -Why 'A production database should not be exposed directly from this local machine.' -Fix 'Remove any ports: block from the postgres service.') -and $ok
  $ok = (Add-PreflightResult -Name 'n8n browser port is loopback-only' -Passed (-not (Test-ServiceHasUnsafePublicPorts -ServiceName 'n8n')) -Why 'n8n may have a local browser port, but it must not bind to every network interface.' -Fix 'Use a loopback mapping like 127.0.0.1:${N8N_LOCAL_PORT:-5678}:5678; do not use 5678:5678 or 0.0.0.0:5678:5678.') -and $ok

  if (-not $FromCloudflarePreflight) {
    if ($ok) {
      Write-Success 'Base n8n preflight passed.'
    } else {
      Write-ErrorMessage 'Base n8n preflight failed. Fix the items above before starting local n8n.'
    }
  }

  return $ok
}

function Invoke-SafetyPreflight {
  Write-Header 'Production Cloudflare Preflight'

  $ok = Invoke-BasePreflight -FromCloudflarePreflight

  $values = Read-EnvFile
  $publicHost = Get-EnvValue -Name 'N8N_PUBLIC_HOST' -Values $values
  $publicUrl = Get-EnvValue -Name 'N8N_PUBLIC_URL' -Values $values

  $ok = (Add-PreflightResult -Name 'N8N_PUBLIC_HOST is hostname-only' -Passed (Test-HostnameOnly -HostName $publicHost) -Why 'Cloudflare routes a hostname, not a full URL.' -Fix 'Use your n8n subdomain, such as n8n.example.com, with no https://, path, port, or slash.') -and $ok
  $ok = (Add-PreflightResult -Name 'N8N_PUBLIC_URL starts with https:// and ends with /' -Passed ($publicUrl.StartsWith('https://') -and $publicUrl.EndsWith('/')) -Why 'n8n needs the public HTTPS editor and webhook base URL exactly.' -Fix 'Use a value shaped like https://n8n.example.com/.') -and $ok
  $ok = (Add-PreflightResult -Name 'N8N_PUBLIC_URL host matches N8N_PUBLIC_HOST' -Passed (Test-PublicUrlMatchesHost -PublicUrl $publicUrl -PublicHost $publicHost) -Why 'The public URL and Cloudflare hostname must describe the same n8n site.' -Fix 'Make N8N_PUBLIC_URL use the same hostname as N8N_PUBLIC_HOST.') -and $ok

  $n8nKey = Get-EnvValue -Name 'N8N_ENCRYPTION_KEY' -Values $values
  $ok = (Add-PreflightResult -Name 'N8N_ENCRYPTION_KEY is present and not a placeholder' -Passed (-not (Test-PlaceholderValue -Value $n8nKey)) -Why 'Public production n8n should not use a missing or template encryption key for saved credentials.' -Fix 'Replace it privately in .env with a long random value, then keep the same value forever for this stack.') -and $ok

  $postgresPassword = Get-EnvValue -Name 'POSTGRES_PASSWORD' -Values $values
  $ok = (Add-PreflightResult -Name 'POSTGRES_PASSWORD is present and not a placeholder' -Passed (-not (Test-PlaceholderValue -Value $postgresPassword)) -Why 'Public production Postgres should not use a missing or template database password.' -Fix 'Replace it privately in .env with a strong random password.') -and $ok

  $tunnelToken = Get-EnvValue -Name 'CLOUDFLARED_TUNNEL_TOKEN' -Values $values
  $ok = (Add-PreflightResult -Name 'CLOUDFLARED_TUNNEL_TOKEN is present and not a placeholder' -Passed (-not (Test-PlaceholderValue -Value $tunnelToken)) -Why 'cloudflared cannot attach this stack to your Cloudflare Tunnel without a real tunnel token.' -Fix 'Create or open the Cloudflare Tunnel, copy its token into .env, or use Start n8n to run locally without Cloudflare.') -and $ok

  if ($ok) {
    Write-Success 'Production Cloudflare preflight passed.'
  } else {
    Write-ErrorMessage 'Production Cloudflare preflight failed. Fix the items above before starting the tunnel or updating cloudflared.'
  }

  return $ok
}

function Start-ProductionStack {
  Write-Header 'Start n8n'
  if (-not (Invoke-BasePreflight)) { return }
  if (-not (Test-DockerReady)) { return }
  [void](Invoke-Compose -Arguments @('up', '-d', 'postgres', 'n8n'))
  $values = Read-EnvFile
  Write-Success "Local editor: $(Get-LocalN8nUrl -Values $values)"
  Write-Info 'Cloudflare tunnel is not started by this action. Choose Start Cloudflare tunnel after Step 2 is filled.'
}

function Start-CloudflareTunnel {
  Write-Header 'Start Cloudflare Tunnel'
  if (-not (Invoke-SafetyPreflight)) { return }
  if (-not (Test-DockerReady)) { return }
  [void](Invoke-Compose -Arguments @('up', '-d', 'postgres', 'n8n', 'cloudflared'))
}

function Stop-ProductionStack {
  Write-Header 'Stop n8n'
  if (-not (Test-DockerReady)) { return }
  [void](Invoke-Compose -Arguments @('down'))
}

function Restart-N8n {
  Write-Header 'Restart n8n'
  if (-not (Invoke-BasePreflight)) { return }
  if (-not (Test-DockerReady)) { return }
  [void](Invoke-Compose -Arguments @('up', '-d', '--force-recreate', 'n8n'))
}

function Show-Status {
  Write-Header 'Compose Status'
  if (-not (Test-DockerReady)) { return }
  [void](Invoke-Compose -Arguments @('ps'))
  Write-Host ''
  [void](Invoke-Compose -Arguments @('images'))
}

function View-LogsMenu {
  Write-Header 'View Logs'
  Write-Host 'Choose logs:' -ForegroundColor Cyan
  Write-Host '  1. all'
  Write-Host '  2. n8n'
  Write-Host '  3. postgres'
  Write-Host '  4. cloudflared'
  Write-Host '  5. cancel'
  Write-Host ''
  $choice = Read-Host 'Enter a number'
  if ($choice -eq '5') { return }
  if (-not (Test-DockerReady)) { return }

  $args = @('logs', '--tail', '200')
  switch ($choice) {
    '1' { }
    '2' { $args += 'n8n' }
    '3' { $args += 'postgres' }
    '4' { $args += 'cloudflared' }
    default {
      Write-Warning 'Choose a number from 1 to 5.'
      return
    }
  }

  [void](Invoke-Compose -Arguments $args)
}

function Backup-Postgres {
  param(
    [switch]$Required,
    [string]$BackupDir = '',
    [switch]$SkipPreflight
  )

  Write-Header 'Backup Postgres'
  if (-not $SkipPreflight) {
    if (-not (Invoke-BasePreflight)) { return $false }
    if (-not (Test-DockerReady)) { return $false }
  }

  $values = Read-EnvFile
  $postgresUser = Get-EnvValue -Name 'POSTGRES_USER' -Values $values -Default 'n8n'
  $postgresDb = Get-EnvValue -Name 'POSTGRES_DB' -Values $values -Default 'n8n'
  $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  if (-not $BackupDir) {
    $BackupDir = Join-Path (Join-Path $script:StackRoot 'backups') "n8n-production-postgres-$timestamp"
    $databaseDir = $BackupDir
  } else {
    $databaseDir = Join-Path $BackupDir 'database'
  }
  $backupPath = Join-Path $databaseDir 'database.sql'
  $containerBackupPath = "/tmp/n8n-production-backup-$timestamp.sql"

  New-Item -ItemType Directory -Force -Path $databaseDir | Out-Null
  Write-Info 'Ensuring Postgres is running before backup.'
  if ((Invoke-Compose -Arguments @('up', '-d', 'postgres')) -ne 0) { return $false }

  Write-Info 'Running pg_dump from the postgres service.'
  if ((Invoke-Compose -Arguments @('exec', '-T', 'postgres', 'pg_dump', '-U', $postgresUser, '-f', $containerBackupPath, $postgresDb)) -ne 0) {
    if ($Required) { Write-ErrorMessage 'Required backup failed. No update was applied.' }
    return $false
  }

  $copyExit = Invoke-Compose -Arguments @('cp', "postgres:$containerBackupPath", $backupPath)
  [void](Invoke-Compose -Arguments @('exec', '-T', 'postgres', 'rm', '-f', $containerBackupPath))
  if ($copyExit -ne 0 -or -not (Test-Path -LiteralPath $backupPath -PathType Leaf)) {
    if ($Required) { Write-ErrorMessage 'Required backup failed. No update was applied.' }
    return $false
  }

  $readmePath = Join-Path $backupDir 'README-PRIVATE.txt'
  Set-Content -LiteralPath $readmePath -Encoding ascii -Value @(
    'Private production n8n Postgres backup.',
    '',
    'Keep this backup private. Do not commit it.',
    'This folder intentionally does not include .env or N8N_ENCRYPTION_KEY.',
    'A full restore also needs the production N8N_ENCRYPTION_KEY stored in your password manager.'
  )

  Write-Success "Backup written to: $backupPath"
  Write-Warning 'Keep this backup private. Do not commit backups or production .env files.'
  return $true
}

function Get-ProductionBackupRetentionDays {
  $values = Read-EnvFile
  $raw = Get-EnvValue -Name 'N8N_BACKUP_RETENTION_DAYS' -Values $values -Default '30'
  $days = 0
  if (-not [int]::TryParse($raw, [ref]$days) -or $days -lt 1 -or $days -gt 3650) {
    Write-ErrorMessage 'N8N_BACKUP_RETENTION_DAYS must be a whole number from 1 to 3650.'
    return $null
  }
  return $days
}

function Test-ProductionBackupRoot {
  param([string]$Path)

  try {
    $resolved = [System.IO.Path]::GetFullPath($Path)
    $stack = [System.IO.Path]::GetFullPath($script:StackRoot)
    $home = [System.IO.Path]::GetFullPath([Environment]::GetFolderPath('UserProfile'))
  } catch {
    return [pscustomobject]@{ Ok = $false; Path = ''; Error = $_.Exception.Message }
  }

  if ($resolved -eq [System.IO.Path]::GetPathRoot($resolved)) {
    return [pscustomobject]@{ Ok = $false; Path = $resolved; Error = 'Refusing to use a drive root as the backup root.' }
  }
  if ($resolved.TrimEnd('\') -eq $stack.TrimEnd('\')) {
    return [pscustomobject]@{ Ok = $false; Path = $resolved; Error = 'Refusing to use the stack root itself as the backup root.' }
  }
  if ($home -and $resolved.TrimEnd('\') -eq $home.TrimEnd('\')) {
    return [pscustomobject]@{ Ok = $false; Path = $resolved; Error = 'Refusing to use the user profile root as the backup root.' }
  }

  return [pscustomobject]@{ Ok = $true; Path = $resolved; Error = '' }
}

function Test-PathInsideDirectory {
  param(
    [string]$Path,
    [string]$Directory
  )

  try {
    $resolvedPath = [System.IO.Path]::GetFullPath($Path)
    $resolvedDirectory = [System.IO.Path]::GetFullPath($Directory)
  } catch {
    return $false
  }

  if (-not $resolvedDirectory.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
    $resolvedDirectory = $resolvedDirectory + [System.IO.Path]::DirectorySeparatorChar
  }

  return $resolvedPath.StartsWith($resolvedDirectory, [System.StringComparison]::OrdinalIgnoreCase)
}

function Add-ProductionBackupLog {
  param(
    [string]$BackupDir,
    [string]$Message
  )

  $line = "{0} {1}" -f (Get-Date -Format o), $Message
  Add-Content -LiteralPath (Join-Path $BackupDir 'backup.log') -Encoding ascii -Value $line
}

function Get-ProductionBackupFileList {
  param([string]$BackupDir)

  if (-not (Test-Path -LiteralPath $BackupDir -PathType Container)) {
    return @()
  }

  $root = [System.IO.Path]::GetFullPath($BackupDir)
  if (-not $root.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
    $root = $root + [System.IO.Path]::DirectorySeparatorChar
  }

  return @(
    Get-ChildItem -LiteralPath $BackupDir -File -Recurse -ErrorAction SilentlyContinue |
      ForEach-Object {
        $full = [System.IO.Path]::GetFullPath($_.FullName)
        ($full.Substring($root.Length) -replace '\\', '/')
      } |
      Sort-Object
  )
}

function Write-ProductionBackupRestoreNotes {
  param([string]$BackupDir)

  Set-Content -LiteralPath (Join-Path $BackupDir 'RESTORE-NOTES.txt') -Encoding ascii -Value @(
    'Production n8n restore notes',
    '',
    'Keep this folder private. Do not commit backups, exports, logs, database dumps, or credential files.',
    '',
    'Before restore:',
    '1. Confirm owner approval and a maintenance window.',
    '2. Take a new current-state backup.',
    '3. Confirm the target n8n instance uses the correct N8N_ENCRYPTION_KEY.',
    '4. Confirm the target n8n version can read this export.',
    '',
    'Workflow import shape:',
    '  docker compose cp workflows n8n:/tmp/n8n-restore-workflows',
    '  docker compose exec -T n8n n8n import:workflow --separate --input=/tmp/n8n-restore-workflows',
    '',
    'Credential import shape:',
    '  docker compose cp credentials n8n:/tmp/n8n-restore-credentials',
    '  docker compose exec -T n8n n8n import:credentials --separate --input=/tmp/n8n-restore-credentials',
    '',
    'Database restore is deployment-specific and destructive. Restore database/database.sql only after a current-state backup, owner approval, and verification that the target database should be replaced.',
    '',
    'Encrypted credential exports require the original N8N_ENCRYPTION_KEY. This production launcher does not create decrypted credential exports.'
  )
}

function Write-ProductionBackupManifest {
  param(
    [string]$BackupDir,
    [string]$Timestamp,
    [string]$Status,
    [string[]]$Errors = @(),
    [int]$RetentionDays = 30
  )

  $manifestPath = Join-Path $BackupDir 'manifest.json'
  $files = @(Get-ProductionBackupFileList -BackupDir $BackupDir)
  $files = @($files + 'manifest.json' | Sort-Object -Unique)
  $manifest = [ordered]@{
    template = 'n8n-production-cloudflare-menu.ps1'
    createdAt = (Get-Date -Format o)
    timestamp = $Timestamp
    status = $Status
    stackRoot = $script:StackRoot
    retentionDays = $RetentionDays
    backupOptions = [ordered]@{
      includeWorkflows = $true
      includeCredentials = $true
      exportDecryptedCredentials = $false
      includeDatabase = $true
    }
    outputs = [ordered]@{
      workflows = 'workflows/'
      credentials = 'credentials/'
      database = 'database/database.sql'
      log = 'backup.log'
      restoreNotes = 'RESTORE-NOTES.txt'
    }
    filesGenerated = $files
    errors = @($Errors)
    warnings = @(
      'Keep this backup folder private and out of Git.',
      'Encrypted credential exports require the original N8N_ENCRYPTION_KEY.',
      'This production launcher does not create decrypted credential exports.'
    )
  }

  $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding ascii
  return $manifestPath
}

function Invoke-ProductionBackupRetentionCleanup {
  param(
    [string]$BackupRoot,
    [int]$RetentionDays
  )

  $safeRoot = Test-ProductionBackupRoot -Path $BackupRoot
  if (-not $safeRoot.Ok) {
    Write-ErrorMessage $safeRoot.Error
    return $false
  }

  if (-not (Test-Path -LiteralPath $safeRoot.Path -PathType Container)) {
    return $true
  }

  $cutoff = (Get-Date).AddDays(-1 * $RetentionDays)
  $deletedCount = 0
  $backupFolders = @(
    Get-ChildItem -LiteralPath $safeRoot.Path -Directory -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -match '^n8n-production-\d{8}-\d{6}$' -and $_.LastWriteTime -lt $cutoff }
  )

  foreach ($folder in $backupFolders) {
    if (-not (Test-PathInsideDirectory -Path $folder.FullName -Directory $safeRoot.Path)) {
      Write-ErrorMessage "Refusing to delete a path outside the backup root: $($folder.FullName)"
      return $false
    }

    Remove-Item -LiteralPath $folder.FullName -Recurse -Force
    Write-Info "Deleted old production backup folder: $($folder.FullName)"
    $deletedCount += 1
  }

  if ($deletedCount -eq 0) {
    Write-Info 'No old production backup folders were eligible for retention cleanup.'
  }

  return $true
}

function Get-N8nCliProductionBackupSpecs {
  param([string]$ContainerBackupRoot)

  return @(
    [pscustomobject]@{
      Name = 'workflows'
      HostFolder = 'workflows'
      ContainerOutputDir = "$ContainerBackupRoot/workflows"
      ComposeArguments = @('exec', '-T', 'n8n', 'n8n', 'export:workflow', '--backup', "--output=$ContainerBackupRoot/workflows")
    },
    [pscustomobject]@{
      Name = 'credentials'
      HostFolder = 'credentials'
      ContainerOutputDir = "$ContainerBackupRoot/credentials"
      ComposeArguments = @('exec', '-T', 'n8n', 'n8n', 'export:credentials', '--backup', "--output=$ContainerBackupRoot/credentials")
    }
  )
}

function Backup-N8nProductionNow {
  param([switch]$Required)

  Write-Header 'Back Up Now'
  if (-not (Invoke-BasePreflight)) { return $false }
  if (-not (Test-DockerReady)) { return $false }

  $retentionDays = Get-ProductionBackupRetentionDays
  if ($null -eq $retentionDays) { return $false }

  $backupRoot = Join-Path $script:StackRoot 'backups'
  $safeRoot = Test-ProductionBackupRoot -Path $backupRoot
  if (-not $safeRoot.Ok) {
    Write-ErrorMessage $safeRoot.Error
    return $false
  }

  New-Item -ItemType Directory -Force -Path $safeRoot.Path | Out-Null
  if (-not (Invoke-ProductionBackupRetentionCleanup -BackupRoot $safeRoot.Path -RetentionDays $retentionDays)) {
    return $false
  }

  $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $backupDir = Join-Path $safeRoot.Path "n8n-production-$timestamp"
  $containerBackupRoot = "/tmp/n8n-production-backups/$timestamp"
  $errors = New-Object System.Collections.Generic.List[string]

  New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
  Add-ProductionBackupLog -BackupDir $backupDir -Message "Starting production n8n backup in $backupDir"
  Write-Info 'Back up exports workflows, exports credentials, dumps Postgres, writes a manifest, and applies retention cleanup.'
  Write-Info 'Decrypted credential export is disabled for this production launcher.'

  $ok = $true
  try {
    $specs = @(Get-N8nCliProductionBackupSpecs -ContainerBackupRoot $containerBackupRoot)
    foreach ($spec in $specs) {
      Add-ProductionBackupLog -BackupDir $backupDir -Message "Running n8n CLI export for $($spec.Name)."
      if ((Invoke-Compose -Arguments $spec.ComposeArguments) -ne 0) {
        $errors.Add("$($spec.Name) export failed.")
        $ok = $false
        break
      }

      $hostTarget = Join-Path $backupDir $spec.HostFolder
      if ((Invoke-Compose -Arguments @('cp', "n8n:$($spec.ContainerOutputDir)", $hostTarget)) -ne 0) {
        $errors.Add("$($spec.Name) copy failed.")
        $ok = $false
        break
      }
    }

    if ($ok -and -not (Backup-Postgres -Required -BackupDir $backupDir -SkipPreflight)) {
      $errors.Add('Postgres database backup failed.')
      $ok = $false
    }
  } finally {
    [void](Invoke-Compose -Arguments @('exec', '-T', 'n8n', 'rm', '-rf', $containerBackupRoot))
  }

  Write-ProductionBackupRestoreNotes -BackupDir $backupDir

  if (-not $ok) {
    Add-ProductionBackupLog -BackupDir $backupDir -Message 'Backup failed.'
    $manifestPath = Write-ProductionBackupManifest -BackupDir $backupDir -Timestamp $timestamp -Status 'failed' -Errors @($errors) -RetentionDays $retentionDays
    Write-ErrorMessage "Backup failed. Partial backup folder: $backupDir"
    Write-ErrorMessage "Manifest written to: $manifestPath"
    if ($Required) { Write-ErrorMessage 'Required backup failed. No update was applied.' }
    return $false
  }

  Add-ProductionBackupLog -BackupDir $backupDir -Message 'Backup completed successfully.'
  $manifestPath = Write-ProductionBackupManifest -BackupDir $backupDir -Timestamp $timestamp -Status 'success' -Errors @() -RetentionDays $retentionDays
  [void](Invoke-ProductionBackupRetentionCleanup -BackupRoot $safeRoot.Path -RetentionDays $retentionDays)
  Write-Success "Backup folder: $backupDir"
  Write-Success "Manifest written to: $manifestPath"
  Write-Warning 'Keep this backup private. Do not commit backups, logs, exports, database dumps, or production .env files.'
  return $true
}

function Show-UpdateMenu {
  Write-Header 'Update'
  Write-Host 'Choose what to update:' -ForegroundColor Cyan
  Write-Host '  1. all services'
  Write-Host '  2. n8n only'
  Write-Host '  3. postgres only'
  Write-Host '  4. cloudflared only'
  Write-Host '  5. cancel'
  Write-Host ''
  $choice = Read-Host 'Enter a number'
  if ($choice -eq '5') { return }

  $selected = @()
  $needsBackup = $false
  $needsCloudflarePreflight = $false
  switch ($choice) {
    '1' { $selected = @('postgres', 'n8n', 'cloudflared'); $needsBackup = $true; $needsCloudflarePreflight = $true }
    '2' { $selected = @('n8n') }
    '3' { $selected = @('postgres'); $needsBackup = $true }
    '4' { $selected = @('cloudflared'); $needsCloudflarePreflight = $true }
    default {
      Write-Warning 'Choose a number from 1 to 5.'
      return
    }
  }

  if ($needsCloudflarePreflight) {
    if (-not (Invoke-SafetyPreflight)) { return }
  } else {
    if (-not (Invoke-BasePreflight)) { return }
  }
  if (-not (Test-DockerReady)) { return }

  if ($needsBackup) {
    if (-not (Backup-N8nProductionNow -Required)) {
      return
    }
  }

  [void](Invoke-Compose -Arguments (@('pull') + $selected))
  [void](Invoke-Compose -Arguments (@('up', '-d', '--force-recreate') + $selected))
  [void](Invoke-Compose -Arguments @('ps'))
}

function Print-ProductionUrl {
  Write-Header 'Production URL'
  $values = Read-EnvFile
  $publicUrl = Get-EnvValue -Name 'N8N_PUBLIC_URL' -Values $values
  if ($publicUrl) {
    Write-Host $publicUrl -ForegroundColor Green
    return
  }
  Write-Warning 'N8N_PUBLIC_URL is not set in .env.'
}

function Write-CommandListItem {
  param(
    [string]$Number,
    [string]$Name,
    [string]$Description
  )

  $itemLabelWidth = 40
  $itemPrefix = ("  {0}. {1,-$itemLabelWidth}: " -f $Number, $Name)
  Write-Host $itemPrefix -NoNewline
  Write-Host $Description
}

function Show-CommandList {
  Write-Header 'Command List'
  Write-Host 'Recommended entrypoint:' -ForegroundColor Cyan
  Write-Host '  _n8n-production-cloudflare.cmd' -ForegroundColor White
  Write-Host ''
  Write-Host 'Do not launch production n8n directly from Docker Desktop. Launch it from _n8n-production-cloudflare.cmd instead.' -ForegroundColor Yellow
  Write-Host 'Docker Desktop direct launch skips production preflight, status, backups, update choices, and logs.' -ForegroundColor Cyan
  Write-Host ''
  Write-Host 'Production requirements:' -ForegroundColor Cyan
  Write-Host '  Cloudflare public hostname service URL: http://n8n:5678'
  Write-Host '  No Postgres public ports'
  Write-Host '  n8n local browser port must be loopback-only'
  Write-Host '  Back up before updating Postgres'
  Write-Host '  Back up creates n8n CLI exports, a database dump, manifest, restore notes, and a log'
  Write-Host ''
  Write-Host 'Use the numbered menu options for normal work:' -ForegroundColor Cyan
  Write-CommandListItem -Number '1' -Name 'Start n8n' -Description 'Runs base preflight, then starts Postgres and n8n for local browser access.'
  Write-CommandListItem -Number '2' -Name 'Restart n8n' -Description 'Runs base preflight, then recreates only the n8n app container.'
  Write-CommandListItem -Number '3' -Name 'Stop n8n' -Description 'Stops the production Cloudflare stack.'
  Write-CommandListItem -Number '4' -Name 'Update' -Description 'Pulls selected images and recreates selected containers; backs up before database-impacting updates.'
  Write-CommandListItem -Number '5' -Name 'Show Compose status' -Description 'Shows service state and image details from Docker Compose.'
  Write-CommandListItem -Number '6' -Name 'View logs' -Description 'Shows recent logs for all services or one service.'
  Write-CommandListItem -Number '7' -Name 'Back up' -Description 'Exports workflows and encrypted credentials, dumps Postgres, and writes restore notes.'
  Write-CommandListItem -Number '8' -Name 'Start Cloudflare tunnel' -Description 'Runs Cloudflare preflight, then starts Postgres, n8n, and cloudflared.'
  Write-CommandListItem -Number '9' -Name 'Advanced / Safety: Production preflight' -Description 'Checks Cloudflare, URL, secret-placeholder, and public-port safety settings.'
  Write-Host ''
  Write-Host 'Updates are user-approved. After you choose what to update, selected containers are recreated automatically.' -ForegroundColor Yellow
}

function Show-LaunchStatus {
  Write-Host 'Folder: ' -NoNewline -ForegroundColor DarkCyan
  Write-Host $script:StackRoot -ForegroundColor White
  $dockerReady = $false
  $composeExists = Test-Path -LiteralPath (Join-Path $script:StackRoot 'docker-compose.yml') -PathType Leaf
  $envExists = Test-Path -LiteralPath (Get-EnvPath) -PathType Leaf

  if ($composeExists) {
    Write-Success 'docker-compose.yml found'
  } else {
    Write-ErrorMessage 'docker-compose.yml missing'
  }

  if ($envExists) {
    Write-Success '.env found'
  } else {
    Write-Warning '.env missing. Copy .env.example to .env before starting production.'
  }

  if (Get-Command docker -ErrorAction SilentlyContinue) {
    if ((Invoke-NativeCommand -Quiet -Command { & docker info *> $null }) -eq 0) {
      Write-Success 'Docker appears available and running'
      $dockerReady = $true
    } else {
      Write-Warning 'Docker CLI exists, but Docker does not appear to be running'
    }
  } else {
    Write-ErrorMessage 'Docker CLI was not found'
  }

  $values = Read-EnvFile
  $publicUrl = Get-EnvValue -Name 'N8N_PUBLIC_URL' -Values $values
  $localUrl = Get-LocalN8nUrl -Values $values
  if ($dockerReady -and $composeExists -and $envExists) {
    $runningServices = Get-RunningServices
    $n8nWhenRunning = "local editor: $localUrl"
    Write-Host ''
    Write-Host 'Quick service status:' -ForegroundColor Cyan
    Write-ServiceStatus -Name 'postgres' -RunningServices $runningServices
    Write-ServiceStatus -Name 'n8n' -RunningServices $runningServices -WhenRunning $n8nWhenRunning -WhenStopped 'local editor is OFF'
    Write-ServiceStatus -Name 'cloudflared' -RunningServices $runningServices -WhenRunning 'public tunnel is ON' -WhenStopped 'public tunnel is OFF'

    $localLabel = "  {0,-22}: " -f 'local editor'
    Write-Host $localLabel -NoNewline -ForegroundColor DarkCyan
    Write-Host $localUrl -ForegroundColor DarkYellow

    if ($publicUrl) {
      $urlLabel = "  {0,-22}: " -f 'production URL'
      Write-Host $urlLabel -NoNewline -ForegroundColor DarkCyan
      Write-Host $publicUrl -ForegroundColor DarkYellow
    }

    Write-ImageVersions -RunningServices $runningServices
  } elseif ($publicUrl) {
    Write-Host 'Production URL: ' -NoNewline -ForegroundColor DarkCyan
    Write-Host $publicUrl -ForegroundColor White
  }
}

function Show-MainMenu {
  Clear-MenuScreen
  Write-Header 'n8n Production Cloudflare Tunnel Stack'
  Show-LaunchStatus
  Write-Host ''
  Write-Host 'Choose an action:' -ForegroundColor Cyan
  Write-Host '  1. Start n8n'
  Write-Host '  2. Restart n8n'
  Write-Host '  3. Stop n8n'
  Write-Host '  4. Update'
  Write-Host '  5. Show Compose status'
  Write-Host '  6. View logs'
  Write-Host '  7. Back up'
  Write-Host '  8. Start Cloudflare tunnel'
  Write-Host '  9. Advanced / Safety: Production preflight'
  Write-Host '  10. Command list'
  Write-Host '  11. Exit'
  Write-Host ''
}

while (-not $script:ExitRequested) {
  Show-MainMenu
  $choice = Read-Host 'Enter a number'

  switch ($choice) {
    '1' { Invoke-MenuAction { Start-ProductionStack } }
    '2' { Invoke-MenuAction { Restart-N8n } }
    '3' { Invoke-MenuAction { Stop-ProductionStack } }
    '4' { Invoke-MenuAction { Show-UpdateMenu } }
    '5' { Invoke-MenuAction { Show-Status } }
    '6' { Invoke-MenuAction { View-LogsMenu } }
    '7' { Invoke-MenuAction { [void](Backup-N8nProductionNow) } }
    '8' { Invoke-MenuAction { Start-CloudflareTunnel } }
    '9' { Invoke-MenuAction { [void](Invoke-SafetyPreflight) } }
    '10' { Invoke-MenuAction { Show-CommandList } }
    '11' { Clear-MenuScreen; Write-Success 'Bye.'; $script:ExitRequested = $true }
    default {
      Invoke-MenuAction { Write-Warning 'Choose a number from 1 to 11.' }
    }
  }
}

exit 0
