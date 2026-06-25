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

function Add-PreflightResult {
  param(
    [string]$Name,
    [bool]$Passed,
    [string]$Failure
  )

  if ($Passed) {
    Write-Success $Name
    return $true
  }

  Write-ErrorMessage "$Name - $Failure"
  return $false
}

function Invoke-SafetyPreflight {
  Write-Header 'Production Safety Preflight'

  $ok = $true
  $composePath = Join-Path $script:StackRoot 'docker-compose.yml'
  $envPath = Get-EnvPath
  $ok = (Add-PreflightResult -Name 'docker-compose.yml exists' -Passed (Test-Path -LiteralPath $composePath -PathType Leaf) -Failure 'copy the production stack templates first') -and $ok
  $ok = (Add-PreflightResult -Name '.env exists' -Passed (Test-Path -LiteralPath $envPath -PathType Leaf) -Failure 'copy .env.example to .env and fill private values') -and $ok

  $values = Read-EnvFile
  $publicHost = Get-EnvValue -Name 'N8N_PUBLIC_HOST' -Values $values
  $publicUrl = Get-EnvValue -Name 'N8N_PUBLIC_URL' -Values $values
  $webhookUrl = Get-EnvValue -Name 'WEBHOOK_URL' -Values $values
  $editorUrl = Get-EnvValue -Name 'N8N_EDITOR_BASE_URL' -Values $values
  $proxyHops = Get-EnvValue -Name 'N8N_PROXY_HOPS' -Values $values

  $ok = (Add-PreflightResult -Name 'N8N_PUBLIC_HOST is hostname-only' -Passed (Test-HostnameOnly -HostName $publicHost) -Failure 'use a hostname like n8n.example.com, with no protocol, path, port, or slash') -and $ok
  $ok = (Add-PreflightResult -Name 'N8N_PUBLIC_URL starts with https:// and ends with /' -Passed ($publicUrl.StartsWith('https://') -and $publicUrl.EndsWith('/')) -Failure 'use a value shaped like https://n8n.example.com/') -and $ok
  $ok = (Add-PreflightResult -Name 'WEBHOOK_URL matches N8N_PUBLIC_URL' -Passed ($webhookUrl -eq $publicUrl) -Failure 'set WEBHOOK_URL to the exact public URL, including trailing slash') -and $ok
  $ok = (Add-PreflightResult -Name 'N8N_EDITOR_BASE_URL matches N8N_PUBLIC_URL' -Passed ($editorUrl -eq $publicUrl) -Failure 'set N8N_EDITOR_BASE_URL to the exact public URL, including trailing slash') -and $ok
  $ok = (Add-PreflightResult -Name 'N8N_PROXY_HOPS is 1' -Passed ($proxyHops -eq '1') -Failure 'set N8N_PROXY_HOPS=1 for this Cloudflare Tunnel path') -and $ok

  foreach ($secretName in @('CLOUDFLARED_TUNNEL_TOKEN', 'N8N_ENCRYPTION_KEY', 'POSTGRES_PASSWORD')) {
    $secretValue = Get-EnvValue -Name $secretName -Values $values
    $ok = (Add-PreflightResult -Name "$secretName is present and not a placeholder" -Passed (-not (Test-PlaceholderValue -Value $secretValue)) -Failure 'fill this privately in .env before starting production') -and $ok
  }

  $ok = (Add-PreflightResult -Name 'Postgres has no public port mapping' -Passed (-not (Test-ServiceHasPorts -ServiceName 'postgres')) -Failure 'remove ports: from the postgres service') -and $ok
  $ok = (Add-PreflightResult -Name 'n8n direct 5678 is not publicly mapped' -Passed (-not (Test-ServiceHasPorts -ServiceName 'n8n')) -Failure 'remove ports: from the n8n service; Cloudflare should reach http://n8n:5678 inside the Compose network') -and $ok

  if ($ok) {
    Write-Success 'Production preflight passed.'
  } else {
    Write-ErrorMessage 'Production preflight failed. Fix the items above before starting or updating.'
  }

  return $ok
}

function Start-ProductionStack {
  Write-Header 'Start Production Stack'
  if (-not (Invoke-SafetyPreflight)) { return }
  if (-not (Test-DockerReady)) { return }
  [void](Invoke-Compose -Arguments @('up', '-d', 'postgres', 'n8n', 'cloudflared'))
}

function Stop-ProductionStack {
  Write-Header 'Stop Production Stack'
  if (-not (Test-DockerReady)) { return }
  [void](Invoke-Compose -Arguments @('down'))
}

function Restart-N8n {
  Write-Header 'Restart n8n'
  if (-not (Invoke-SafetyPreflight)) { return }
  if (-not (Test-DockerReady)) { return }
  [void](Invoke-Compose -Arguments @('up', '-d', '--force-recreate', 'n8n'))
}

function Show-Status {
  Write-Header 'Status'
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
  param([switch]$Required)

  Write-Header 'Backup Postgres'
  if (-not (Invoke-SafetyPreflight)) { return $false }
  if (-not (Test-DockerReady)) { return $false }

  $values = Read-EnvFile
  $postgresUser = Get-EnvValue -Name 'POSTGRES_USER' -Values $values -Default 'n8n'
  $postgresDb = Get-EnvValue -Name 'POSTGRES_DB' -Values $values -Default 'n8n'
  $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $backupDir = Join-Path (Join-Path $script:StackRoot 'backups') "n8n-production-postgres-$timestamp"
  $backupPath = Join-Path $backupDir 'database.sql'
  $containerBackupPath = "/tmp/n8n-production-backup-$timestamp.sql"

  New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
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

function Show-UpdateMenu {
  Write-Header 'Check / Update Images'
  Write-Host 'Choose what to update:' -ForegroundColor Cyan
  Write-Host '  1. all services'
  Write-Host '  2. n8n only'
  Write-Host '  3. postgres only'
  Write-Host '  4. cloudflared only'
  Write-Host '  5. cancel'
  Write-Host ''
  $choice = Read-Host 'Enter a number'
  if ($choice -eq '5') { return }
  if (-not (Invoke-SafetyPreflight)) { return }
  if (-not (Test-DockerReady)) { return }

  $selected = @()
  $needsBackup = $false
  switch ($choice) {
    '1' { $selected = @('postgres', 'n8n', 'cloudflared'); $needsBackup = $true }
    '2' { $selected = @('n8n') }
    '3' { $selected = @('postgres'); $needsBackup = $true }
    '4' { $selected = @('cloudflared') }
    default {
      Write-Warning 'Choose a number from 1 to 5.'
      return
    }
  }

  if ($needsBackup) {
    if (-not (Backup-Postgres -Required)) {
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

function Show-CommandList {
  Write-Header 'Command List'
  Write-Host 'Recommended entrypoint:' -ForegroundColor Cyan
  Write-Host '  _n8n-production-cloudflare.cmd'
  Write-Host ''
  Write-Host 'Production requirements:' -ForegroundColor Cyan
  Write-Host '  Cloudflare public hostname service URL: http://n8n:5678'
  Write-Host '  No Postgres public ports'
  Write-Host '  No public direct n8n host port 5678'
  Write-Host '  Back up before updating Postgres'
  Write-Host ''
}

function Show-LaunchStatus {
  Write-Host 'Folder: ' -NoNewline -ForegroundColor DarkCyan
  Write-Host $script:StackRoot -ForegroundColor White

  $composePath = Join-Path $script:StackRoot 'docker-compose.yml'
  $envPath = Get-EnvPath
  if (Test-Path -LiteralPath $composePath -PathType Leaf) {
    Write-Success 'docker-compose.yml found'
  } else {
    Write-ErrorMessage 'docker-compose.yml missing'
  }

  if (Test-Path -LiteralPath $envPath -PathType Leaf) {
    Write-Success '.env found'
  } else {
    Write-Warning '.env missing. Copy .env.example to .env before starting production.'
  }

  $values = Read-EnvFile
  $publicUrl = Get-EnvValue -Name 'N8N_PUBLIC_URL' -Values $values
  if ($publicUrl) {
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
  Write-Host '  1. Safety preflight'
  Write-Host '  2. Start production stack'
  Write-Host '  3. Stop production stack'
  Write-Host '  4. Restart n8n'
  Write-Host '  5. View status'
  Write-Host '  6. View logs'
  Write-Host '  7. Backup Postgres'
  Write-Host '  8. Check/update images'
  Write-Host '  9. Print production URL'
  Write-Host '  10. Command list'
  Write-Host '  11. Exit'
  Write-Host ''
}

while (-not $script:ExitRequested) {
  Show-MainMenu
  $choice = Read-Host 'Enter a number'

  switch ($choice) {
    '1' { Invoke-MenuAction { [void](Invoke-SafetyPreflight) } }
    '2' { Invoke-MenuAction { Start-ProductionStack } }
    '3' { Invoke-MenuAction { Stop-ProductionStack } }
    '4' { Invoke-MenuAction { Restart-N8n } }
    '5' { Invoke-MenuAction { Show-Status } }
    '6' { Invoke-MenuAction { View-LogsMenu } }
    '7' { Invoke-MenuAction { [void](Backup-Postgres) } }
    '8' { Invoke-MenuAction { Show-UpdateMenu } }
    '9' { Invoke-MenuAction { Print-ProductionUrl } }
    '10' { Invoke-MenuAction { Show-CommandList } }
    '11' { Clear-MenuScreen; Write-Success 'Bye.'; $script:ExitRequested = $true }
    default {
      Invoke-MenuAction { Write-Warning 'Choose a number from 1 to 11.' }
    }
  }
}

exit 0
