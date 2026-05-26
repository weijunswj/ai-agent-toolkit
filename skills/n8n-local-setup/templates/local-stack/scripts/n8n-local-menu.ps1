$ErrorActionPreference = 'Stop'

$script:StackRoot = (Get-Location).Path
$script:Services = @('n8n', 'ngrok', 'postgres')
$script:ServiceImages = @{
  n8n = 'docker.n8n.io/n8nio/n8n:stable'
  ngrok = 'ngrok/ngrok:latest'
  postgres = 'postgres:16-alpine'
}

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
  Write-Info 'This compares local image tag IDs before and after pull.'
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
    Write-Warning 'Use Update selected services to recreate containers when ready.'
  }

  return $updated.ToArray()
}

function Read-ServiceSelection {
  param(
    [string]$Prompt,
    [string]$CancelWord = 'cancel'
  )

  Write-Host ''
  Write-Host 'Choices: all, n8n, ngrok, postgres, ' -NoNewline -ForegroundColor DarkCyan
  Write-Host $CancelWord -ForegroundColor Yellow
  $choice = (Read-Host $Prompt).Trim().ToLowerInvariant()

  switch ($choice) {
    'all' { return $script:Services }
    'n8n' { return @('n8n') }
    'ngrok' { return @('ngrok') }
    'postgres' { return @('postgres') }
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

function Start-Stack {
  Write-Header 'Start Stack'
  if (-not (Test-StackFiles)) { return }
  if (-not (Test-DockerReady)) { return }

  $check = Read-Host 'Check for updates before starting? (Y/n)'
  if ($check -notmatch '^(n|no)$') {
    $updated = @(Check-Updates -Services $script:Services)
    if ($updated.Count -gt 0) {
      $selection = Read-ServiceSelection -Prompt 'Update before starting?'
      if ($selection.Count -gt 0) {
        Apply-Update -Services $selection
      } else {
        Write-Warning 'Skipping updates for now.'
      }
    }
  }

  if ((Invoke-Compose -Arguments @('up', '-d')) -eq 0) {
    [void](Invoke-Compose -Arguments @('ps'))
    Write-Success 'Stack started.'
    Write-Host ''
    Write-Host 'n8n:             http://localhost:5678' -ForegroundColor Green
    Write-Host 'ngrok inspector: http://127.0.0.1:4040' -ForegroundColor Green
  }
}

function Update-SelectedServices {
  Write-Header 'Update Selected Services'
  $selection = Read-ServiceSelection -Prompt 'Which service should be updated?'
  Apply-Update -Services $selection
}

function Restart-Stack {
  Write-Header 'Restart Stack'
  if ((Test-StackFiles) -and (Test-DockerReady)) {
    [void](Invoke-Compose -Arguments @('restart'))
  }
}

function Stop-Stack {
  Write-Header 'Stop Stack'
  if ((Test-StackFiles) -and (Test-DockerReady)) {
    [void](Invoke-Compose -Arguments @('down'))
    Write-Success 'Stack stopped. Docker volumes were not removed.'
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

function Open-N8n {
  Write-Header 'Open n8n'
  Start-Process "http://localhost:5678"
  Write-Success 'Opened n8n in your browser.'
}

function Open-NgrokInspector {
  Write-Header 'Open ngrok Inspector'
  Start-Process "http://127.0.0.1:4040"
  Write-Success 'Opened the local ngrok inspector in your browser.'
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
  Write-Host '  n8n-local.cmd' -ForegroundColor White
  Write-Host ''
  Write-Host 'Docker Desktop can view containers and logs, but Docker Desktop Play bypasses the menu and update checks.' -ForegroundColor Yellow
  Write-Host 'Start through n8n-local.cmd when you want guided checks, selected updates, backups, and clear status output.' -ForegroundColor Cyan
  Write-Host ''
  Write-Host 'Raw commands behind the menu:' -ForegroundColor Cyan
  Write-Host '  Start stack:              docker compose up -d'
  Write-Host '  Check for updates:        docker compose pull'
  Write-Host '  Update all services:      docker compose up -d --force-recreate'
  Write-Host '  Update one service:       docker compose up -d --force-recreate <service>'
  Write-Host '  Stop stack:               docker compose down'
  Write-Host '  Restart stack:            docker compose restart'
  Write-Host '  Status:                   docker compose ps'
  Write-Host '  All logs:                 docker compose logs -f'
  Write-Host '  n8n logs:                 docker compose logs -f n8n'
  Write-Host '  ngrok logs:               docker compose logs -f ngrok'
  Write-Host '  Postgres logs:            docker compose logs -f postgres'
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
  Write-Host '  1. Start stack'
  Write-Host '  2. Check for updates'
  Write-Host '  3. Update selected services'
  Write-Host '  4. Restart stack'
  Write-Host '  5. Stop stack'
  Write-Host '  6. Show status'
  Write-Host '  7. View all logs'
  Write-Host '  8. View n8n logs'
  Write-Host '  9. View ngrok logs'
  Write-Host ' 10. View Postgres logs'
  Write-Host ' 11. Open n8n'
  Write-Host ' 12. Open ngrok inspector'
  Write-Host ' 13. Backup Postgres database'
  Write-Host ' 14. Help / command reference'
  Write-Host ' 15. Exit'
  Write-Host ''
}

while ($true) {
  Show-MainMenu
  $choice = Read-Host 'Enter a number'

  switch ($choice) {
    '1' { Start-Stack; Pause-Menu }
    '2' { [void](Check-Updates -Services $script:Services); Pause-Menu }
    '3' { Update-SelectedServices; Pause-Menu }
    '4' { Restart-Stack; Pause-Menu }
    '5' { Stop-Stack; Pause-Menu }
    '6' { Show-Status; Pause-Menu }
    '7' { Show-Logs; Pause-Menu }
    '8' { Show-Logs -Service 'n8n'; Pause-Menu }
    '9' { Show-Logs -Service 'ngrok'; Pause-Menu }
    '10' { Show-Logs -Service 'postgres'; Pause-Menu }
    '11' { Open-N8n; Pause-Menu }
    '12' { Open-NgrokInspector; Pause-Menu }
    '13' { Backup-Postgres; Pause-Menu }
    '14' { Show-Help; Pause-Menu }
    '15' { Clear-Host; Write-Success 'Bye.'; return }
    default {
      Write-Warning 'Choose a number from 1 to 15.'
      Pause-Menu
    }
  }
}
