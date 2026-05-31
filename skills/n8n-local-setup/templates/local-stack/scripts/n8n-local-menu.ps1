$ErrorActionPreference = 'Stop'

$script:StackRoot = (Get-Location).Path
$script:CoreServices = @('postgres', 'n8n')
$script:Services = @('n8n', 'postgres', 'ngrok')
$script:ExitRequested = $false
$script:ServiceImages = @{
  n8n = 'docker.n8n.io/n8nio/n8n:stable'
  postgres = 'postgres:16-alpine'
  ngrok = 'ngrok/ngrok:latest'
}
$script:NgrokDockerDesktopGuide = 'https://dashboard.ngrok.com/get-started/setup/docker-desktop'

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

function Pause-Menu {
  Write-Host ''
  Write-Host 'Press Enter to return to the menu...' -ForegroundColor DarkCyan
  [void](Read-Host)
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

function Invoke-Compose {
  param([string[]]$Arguments)

  $display = "docker compose $($Arguments -join ' ')"
  Write-Info $display
  & docker compose @Arguments
  $exitCode = $LASTEXITCODE
  if ($exitCode -ne 0) {
    Write-ErrorMessage "Command failed with exit code $exitCode."
  }
  return $exitCode
}

function Test-StackFiles {
  $composeExists = Test-Path -LiteralPath (Join-Path $script:StackRoot 'docker-compose.yml')
  $envExists = Test-Path -LiteralPath (Join-Path $script:StackRoot '.env')

  if (-not $composeExists) {
    Write-ErrorMessage 'docker-compose.yml is missing from this folder.'
  }

  if (-not $envExists) {
    Write-Warning '.env is missing. Copy .env.example to .env, then fill the placeholders.'
  }

  return ($composeExists -and $envExists)
}

function Test-DockerDesktopCli {
  try {
    & docker desktop --help *> $null
    return ($LASTEXITCODE -eq 0)
  } catch {
    return $false
  }
}

function Test-DockerReady {
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-ErrorMessage 'Docker CLI was not found. Install Docker Desktop, then reopen this menu.'
    return $false
  }

  & docker info *> $null
  if ($LASTEXITCODE -eq 0) {
    return $true
  }

  Write-Warning 'Docker is installed, but it does not appear to be running.'

  if (Test-DockerDesktopCli) {
    $choice = Read-Host 'Try starting Docker Desktop now? (y/N)'
    if ($choice -match '^(y|yes)$') {
      Write-Info 'Starting Docker Desktop...'
      & docker desktop start
      Write-Warning 'Wait for Docker Desktop to finish starting, then run the menu action again.'
    }
  } else {
    Write-Info 'Start Docker Desktop manually, then run the menu action again.'
  }

  return $false
}

function Get-EnvValue {
  param(
    [string]$Name,
    [string]$Default = ''
  )

  $envPath = Join-Path $script:StackRoot '.env'
  if (-not (Test-Path -LiteralPath $envPath)) {
    return $Default
  }

  $pattern = "^\s*$([regex]::Escape($Name))\s*=\s*(.*)\s*$"
  foreach ($line in Get-Content -LiteralPath $envPath) {
    if ($line -match $pattern) {
      $value = $Matches[1].Trim()
      $value = $value.Trim('"').Trim("'")
      if ($value.Length -gt 0) {
        return $value
      }
    }
  }

  return $Default
}

function Get-ServiceImageIds {
  param([string[]]$Services = $script:Services)

  $ids = @{}
  foreach ($service in $Services) {
    $image = $script:ServiceImages[$service]
    if (-not $image) {
      $ids[$service] = ''
      continue
    }

    try {
      $imageId = (& docker image inspect $image --format '{{.Id}}' 2>$null | Select-Object -First 1)
      if ($LASTEXITCODE -ne 0) {
        $imageId = ''
      }
      $ids[$service] = ([string]$imageId).Trim()
    } catch {
      $ids[$service] = ''
    }
  }
  return $ids
}

function Check-Updates {
  param([string[]]$Services = $script:Services)

  if (-not (Test-StackFiles)) { return @() }
  if (-not (Test-DockerReady)) { return @() }

  Write-Header 'Check For Updates'
  Write-Info 'This compares local image tag IDs before and after docker compose pull.'
  Write-Info 'This may pull newer images into the local Docker cache.'
  Write-Info 'It does not restart or recreate running services.'

  $before = Get-ServiceImageIds -Services $Services
  $pullArgs = @('pull')
  if ($Services.Count -lt $script:Services.Count) {
    $pullArgs += $Services
  }

  if ((Invoke-Compose -Arguments $pullArgs) -ne 0) {
    Write-ErrorMessage 'Update check failed.'
    return @()
  }

  $after = Get-ServiceImageIds -Services $Services
  $updated = New-Object System.Collections.Generic.List[string]

  foreach ($service in $Services) {
    if ($before[$service] -and $after[$service] -and ($before[$service] -ne $after[$service])) {
      $updated.Add($service)
    } elseif ((-not $before[$service]) -and $after[$service]) {
      $updated.Add($service)
    }
  }

  if ($updated.Count -eq 0) {
    Write-Success 'Images are already current. No action needed.'
  } else {
    Write-Warning "Updates were pulled but not applied: $($updated -join ', ')"
    Write-Warning 'Use Update selected services or Update all services to recreate containers when ready.'
  }

  return $updated.ToArray()
}

function Read-ServiceSelection {
  param(
    [string]$Prompt,
    [string]$CancelWord = 'cancel'
  )

  Write-Host ''
  Write-Host 'Choices: all, n8n, postgres, ngrok, ' -NoNewline -ForegroundColor DarkCyan
  Write-Host $CancelWord -ForegroundColor Yellow
  $choice = (Read-Host $Prompt).Trim().ToLowerInvariant()

  switch ($choice) {
    'all' { return $script:Services }
    'n8n' { return @('n8n') }
    'postgres' { return @('postgres') }
    'ngrok' { return @('ngrok') }
    default { return @() }
  }
}

function Apply-Update {
  param([string[]]$Services)

  if (-not $Services -or $Services.Count -eq 0) {
    Write-Warning 'Update cancelled.'
    return
  }

  if (-not (Test-StackFiles)) { return }
  if (-not (Test-DockerReady)) { return }

  if ($Services -contains 'postgres') {
    Write-Warning 'Postgres is pinned to major version 16, but database updates should be backed up first.'
    $confirm = Read-Host 'Continue with Postgres update? (y/N)'
    if ($confirm -notmatch '^(y|yes)$') {
      Write-Warning 'Update cancelled before touching Postgres.'
      return
    }
  }

  $isAll = ($Services.Count -eq $script:Services.Count)
  $pullArgs = @('pull')
  $upArgs = @('up', '-d', '--force-recreate')

  if (-not $isAll) {
    $pullArgs += $Services
    $upArgs += $Services
  }

  Write-Header 'Apply Updates'
  if ((Invoke-Compose -Arguments $pullArgs) -ne 0) { return }
  if ((Invoke-Compose -Arguments $upArgs) -ne 0) { return }
  [void](Invoke-Compose -Arguments @('ps'))
  Write-Success 'Selected services were recreated.'
}

function Start-LocalStack {
  Write-Header 'Start Local n8n Stack'
  if (-not (Test-StackFiles)) { return }
  if (-not (Test-DockerReady)) { return }

  if ((Invoke-Compose -Arguments @('up', '-d', 'postgres', 'n8n')) -eq 0) {
    [void](Invoke-Compose -Arguments @('ps'))
    Write-Success 'Local n8n stack started.'
    Write-Host ''
    Write-Host 'n8n: http://localhost:5678' -ForegroundColor Green
    Write-Host 'Use the ngrok Docker Desktop extension for the beginner public tunnel path.' -ForegroundColor Cyan
  }
}

function Stop-Stack {
  Write-Header 'Stop Local n8n Stack'
  if ((Test-StackFiles) -and (Test-DockerReady)) {
    [void](Invoke-Compose -Arguments @('down'))
    Write-Success 'Stack stopped. Docker volumes were not removed.'
  }
}

function Restart-Stack {
  Write-Header 'Restart Local n8n Stack'
  if ((Test-StackFiles) -and (Test-DockerReady)) {
    [void](Invoke-Compose -Arguments @('restart', 'postgres', 'n8n'))
  }
}

function Show-Status {
  Write-Header 'Stack Status'
  if ((Test-StackFiles) -and (Test-DockerReady)) {
    [void](Invoke-Compose -Arguments @('ps'))
  }
}

function Show-Logs {
  param([string]$Service = '')

  Write-Header 'Live Logs'
  Write-Warning 'This view follows logs live. Press Ctrl+C to return to the menu.'

  if ((Test-StackFiles) -and (Test-DockerReady)) {
    $args = @('logs', '-f')
    if ($Service) {
      $args += $Service
    }
    [void](Invoke-Compose -Arguments $args)
  }
}

function Update-SelectedServices {
  Write-Header 'Update Selected Services'
  $selection = Read-ServiceSelection -Prompt 'Which service should be updated?'
  Apply-Update -Services $selection
}

function Update-AllServices {
  Write-Header 'Update All Services'
  Apply-Update -Services $script:Services
}

function Open-N8n {
  Write-Header 'Open Local n8n URL'
  Start-Process "http://localhost:5678"
  Write-Success 'Opened local n8n in your browser.'
}

function Open-NgrokDockerDesktopGuide {
  Write-Header 'Open ngrok Docker Desktop Extension Guide'
  Start-Process $script:NgrokDockerDesktopGuide
  Write-Success 'Opened the ngrok Docker Desktop extension guide in your browser.'
}

function Backup-Postgres {
  Write-Header 'Backup Postgres Database'
  if (-not (Test-StackFiles)) { return }
  if (-not (Test-DockerReady)) { return }

  $postgresUser = Get-EnvValue -Name 'POSTGRES_USER' -Default 'n8n'
  $postgresDb = Get-EnvValue -Name 'POSTGRES_DB' -Default 'n8n'
  $backupDir = Join-Path $script:StackRoot 'backups'
  $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $backupPath = Join-Path $backupDir "n8n-postgres-$timestamp.sql"

  New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

  Write-Info 'Running pg_dump from the postgres service.'
  & docker compose exec -T postgres pg_dump -U $postgresUser $postgresDb 1> $backupPath
  if ($LASTEXITCODE -eq 0) {
    Write-Success "Backup written to: $backupPath"
  } else {
    Write-ErrorMessage 'Backup failed. Check the Postgres logs for details.'
  }
}

function Show-Help {
  Write-Header 'Help / Command Reference'
  Write-Host 'Recommended entrypoint:' -ForegroundColor Cyan
  Write-Host '  _n8n-local.cmd' -ForegroundColor White
  Write-Host ''
  Write-Host 'Do not launch n8n directly from Docker Desktop. Launch it from _n8n-local.cmd instead.' -ForegroundColor Yellow
  Write-Host 'Docker Desktop direct launch bypasses guided checks, selected updates, backups, and clear status output.' -ForegroundColor Cyan
  Write-Host ''
  Write-Host 'Beginner public tunnel path:' -ForegroundColor Cyan
  Write-Host "  $script:NgrokDockerDesktopGuide"
  Write-Host ''
  Write-Host 'Raw commands behind the menu:' -ForegroundColor Cyan
  Write-Host '  Start local n8n stack:    docker compose up -d postgres n8n'
  Write-Host '  Check for updates:        docker compose pull'
  Write-Host '  Update all services:      docker compose up -d --force-recreate'
  Write-Host '  Update one service:       docker compose up -d --force-recreate <service>'
  Write-Host '  Stop local n8n stack:     docker compose down'
  Write-Host '  Restart local n8n stack:  docker compose restart postgres n8n'
  Write-Host '  Status:                   docker compose ps'
  Write-Host '  All logs:                 docker compose logs -f'
  Write-Host '  n8n logs:                 docker compose logs -f n8n'
  Write-Host '  Postgres logs:            docker compose logs -f postgres'
  Write-Host '  Compose ngrok logs:       docker compose logs -f ngrok'
  Write-Host '  Postgres backup:          docker compose exec -T postgres pg_dump'
  Write-Host ''
  Write-Host 'Updates are user-approved. Pulling images does not recreate or restart containers until you choose an update action.' -ForegroundColor Yellow
}

function Show-LaunchStatus {
  Write-Host 'Folder: ' -NoNewline -ForegroundColor DarkCyan
  Write-Host $script:StackRoot -ForegroundColor White

  if (Test-Path -LiteralPath (Join-Path $script:StackRoot 'docker-compose.yml')) {
    Write-Success 'docker-compose.yml found'
  } else {
    Write-ErrorMessage 'docker-compose.yml missing'
  }

  if (Test-Path -LiteralPath (Join-Path $script:StackRoot '.env')) {
    Write-Success '.env found'
  } else {
    Write-Warning '.env missing. Copy .env.example to .env before starting or updating.'
  }

  if (Get-Command docker -ErrorAction SilentlyContinue) {
    & docker info *> $null
    if ($LASTEXITCODE -eq 0) {
      Write-Success 'Docker appears available and running'
    } else {
      Write-Warning 'Docker CLI exists, but Docker does not appear to be running'
    }
  } else {
    Write-ErrorMessage 'Docker CLI was not found'
  }
}

function Show-MainMenu {
  Clear-Host
  Write-Header 'n8n Local Stack'
  Show-LaunchStatus
  Write-Host ''
  Write-Host 'Choose an action:' -ForegroundColor Cyan
  Write-Host '  1. Start local n8n stack'
  Write-Host '  2. Stop local n8n stack'
  Write-Host '  3. Restart local n8n stack'
  Write-Host '  4. Show status'
  Write-Host '  5. View all logs'
  Write-Host '  6. View n8n logs'
  Write-Host '  7. View Postgres logs'
  Write-Host '  8. View ngrok logs (advanced Compose tunnel)'
  Write-Host '  9. Backup Postgres database'
  Write-Host ' 10. Check for updates'
  Write-Host ' 11. Update selected services'
  Write-Host ' 12. Update all services'
  Write-Host ' 13. Open local n8n URL'
  Write-Host ' 14. Open ngrok Docker Desktop extension guide'
  Write-Host ' 15. Help / command reference'
  Write-Host ' 16. Exit'
  Write-Host ''
}

while (-not $script:ExitRequested) {
  Show-MainMenu
  $choice = Read-Host 'Enter a number'

  switch ($choice) {
    '1' { Invoke-MenuAction { Start-LocalStack } }
    '2' { Invoke-MenuAction { Stop-Stack } }
    '3' { Invoke-MenuAction { Restart-Stack } }
    '4' { Invoke-MenuAction { Show-Status } }
    '5' { Invoke-MenuAction { Show-Logs } }
    '6' { Invoke-MenuAction { Show-Logs -Service 'n8n' } }
    '7' { Invoke-MenuAction { Show-Logs -Service 'postgres' } }
    '8' { Invoke-MenuAction { Show-Logs -Service 'ngrok' } }
    '9' { Invoke-MenuAction { Backup-Postgres } }
    '10' { Invoke-MenuAction { [void](Check-Updates -Services $script:Services) } }
    '11' { Invoke-MenuAction { Update-SelectedServices } }
    '12' { Invoke-MenuAction { Update-AllServices } }
    '13' { Invoke-MenuAction { Open-N8n } }
    '14' { Invoke-MenuAction { Open-NgrokDockerDesktopGuide } }
    '15' { Invoke-MenuAction { Show-Help } }
    '16' { Clear-Host; Write-Success 'Bye.'; $script:ExitRequested = $true }
    default {
      Invoke-MenuAction { Write-Warning 'Choose a number from 1 to 16.' }
    }
  }
}

exit 0
