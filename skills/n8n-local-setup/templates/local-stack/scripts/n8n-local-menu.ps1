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
    if ([Console]::WindowHeight -gt 0 -and [Console]::BufferHeight -gt [Console]::WindowHeight) {
      [Console]::SetBufferSize([Console]::BufferWidth, [Console]::WindowHeight)
    }
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
    & $Command
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

function Test-StackFiles {
  $composeExists = Test-Path -LiteralPath (Join-Path $script:StackRoot 'docker-compose.yml')
  $envExists = Test-Path -LiteralPath (Join-Path $script:StackRoot '.env')
  $envExampleExists = Test-Path -LiteralPath (Join-Path $script:StackRoot '.env.example')
  $configValid = $true

  if (-not $composeExists) {
    Write-ErrorMessage 'docker-compose.yml is missing from this folder.'
  }

  if (-not $envExists) {
    if ($envExampleExists) {
      Write-Warning '.env is missing. If this is the template folder, copy the stack to %USERPROFILE%\.n8n-local first.'
      Write-Warning 'Then copy .env.example to .env in that local stack folder and fill the placeholders.'
    } else {
      Write-Warning '.env is missing. Copy .env.example to .env, then fill the placeholders.'
    }
  }

  if ($envExists -and -not (Test-LocalPortConfig)) {
    $configValid = $false
  }

  return ($composeExists -and $envExists -and $configValid)
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

  if ((Invoke-NativeCommand -Quiet -Command { & docker info *> $null }) -eq 0) {
    return $true
  }

  Write-Warning 'Docker is installed, but it does not appear to be running.'

  if (Test-DockerDesktopCli) {
    $choice = Read-Host 'Try starting Docker Desktop now? (y/N)'
    if ($choice -match '^(y|yes)$') {
      Write-Info 'Starting Docker Desktop...'
      if ((Invoke-NativeCommand -Command { & docker desktop start }) -eq 0) {
        Write-Warning 'Wait for Docker Desktop to finish starting, then run the menu action again.'
      } else {
        Write-Info 'If Docker Desktop did not open, start it manually, then run the menu action again.'
      }
    }
  } else {
    Write-Info 'Start Docker Desktop manually, then run the menu action again.'
  }

  return $false
}

function Get-RunningServices {
  if (-not (Test-Path -LiteralPath (Join-Path $script:StackRoot 'docker-compose.yml'))) {
    return @()
  }

  if (-not (Test-Path -LiteralPath (Join-Path $script:StackRoot '.env'))) {
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

    $services = @(& docker compose ps --services --filter 'status=running' 2>$null)
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

  $isRunning = $RunningServices -contains $Name
  if ($isRunning) {
    Write-Host "  ${Name}: " -NoNewline -ForegroundColor DarkCyan
    Write-Host 'running' -NoNewline -ForegroundColor Green
    if ($WhenRunning) {
      Write-Host " - $WhenRunning" -ForegroundColor White
    } else {
      Write-Host ''
    }
  } else {
    Write-Host "  ${Name}: " -NoNewline -ForegroundColor DarkCyan
    Write-Host 'stopped' -NoNewline -ForegroundColor Yellow
    if ($WhenStopped) {
      Write-Host " - $WhenStopped" -ForegroundColor White
    } else {
      Write-Host ''
    }
  }
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

function Get-LocalN8nPort {
  $port = Get-EnvValue -Name 'N8N_LOCAL_PORT' -Default '5678'
  if ($port -notmatch '^\d+$') {
    return '5678'
  }
  return $port
}

function Get-LocalN8nUrl {
  return "http://localhost:$(Get-LocalN8nPort)"
}

function Get-ExpectedLocalWebhookUrl {
  return "$(Get-LocalN8nUrl)/"
}

function Test-LocalPortConfig {
  $port = Get-EnvValue -Name 'N8N_LOCAL_PORT' -Default '5678'
  $portNumber = 0
  if (-not [int]::TryParse($port, [ref]$portNumber) -or $portNumber -lt 1 -or $portNumber -gt 65535) {
    Write-ErrorMessage 'N8N_LOCAL_PORT must be a number from 1 to 65535, like 5678 or 5679.'
    return $false
  }
  return $true
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
    Write-Warning 'Use the Update menu to recreate containers when ready.'
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
    Write-Warning 'This update includes Postgres, so the menu will run a database backup first.'
    if (-not (Backup-Postgres -Required)) {
      Write-ErrorMessage 'Update cancelled because the automatic Postgres backup did not complete.'
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
    Write-Host "n8n: $(Get-LocalN8nUrl)" -ForegroundColor Green
    Write-Host 'Use Start ngrok tunnel only after .env has NGROK_AUTHTOKEN, NGROK_DOMAIN, and WEBHOOK_URL.' -ForegroundColor Cyan
  }
}

function Start-LocalhostOnly {
  Start-LocalStack

  $runningServices = Get-RunningServices
  if ($runningServices -contains 'ngrok') {
    Write-Warning 'ngrok tunnel is running. Stopping it so n8n is localhost only.'
    [void](Invoke-Compose -Arguments @('stop', 'ngrok'))
  }

  $expectedWebhookUrl = Get-ExpectedLocalWebhookUrl
  $webhookUrl = Get-EnvValue -Name 'WEBHOOK_URL'
  if ($webhookUrl -and $webhookUrl -ne $expectedWebhookUrl) {
    Write-Warning "WEBHOOK_URL is currently $webhookUrl"
    Write-Warning "For localhost-only webhook URLs, set WEBHOOK_URL=$expectedWebhookUrl and choose Restart n8n."
  }
}

function Start-N8nWithNgrok {
  Write-Header 'Start n8n With ngrok Tunnel'
  if (-not (Test-StackFiles)) { return }
  if (-not (Test-DockerReady)) { return }

  $runningServices = Get-RunningServices
  if ($runningServices -contains 'n8n') {
    Write-Success 'n8n is already running.'
  } else {
    Write-Info 'n8n is not running yet. Starting Postgres and n8n first.'
    if ((Invoke-Compose -Arguments @('up', '-d', 'postgres', 'n8n')) -ne 0) { return }
  }

  $runningServices = Get-RunningServices
  if ($runningServices -contains 'ngrok') {
    Write-Success 'ngrok tunnel is already running.'
    return
  }

  Write-Info 'Starting ngrok tunnel now.'
  Start-NgrokTunnel
}

function Start-NgrokTunnel {
  Write-Header 'Start ngrok Tunnel'
  if (-not (Test-StackFiles)) { return }
  if (-not (Test-DockerReady)) { return }

  $authtoken = Get-EnvValue -Name 'NGROK_AUTHTOKEN'
  $domain = Get-EnvValue -Name 'NGROK_DOMAIN'
  $webhookUrl = Get-EnvValue -Name 'WEBHOOK_URL'
  $n8nHost = Get-EnvValue -Name 'N8N_HOST'
  $n8nProtocol = Get-EnvValue -Name 'N8N_PROTOCOL'

  if (-not $authtoken -or $authtoken -eq 'replace-with-ngrok-authtoken') {
    Write-ErrorMessage 'Set NGROK_AUTHTOKEN in .env before starting the tunnel.'
    return
  }

  if (-not $domain -or $domain -eq 'your-name.ngrok.app' -or $domain -eq 'your-reserved-domain.ngrok.app') {
    Write-ErrorMessage 'Set NGROK_DOMAIN in .env before starting the tunnel.'
    return
  }

  if ($domain -match '^https?://') {
    Write-ErrorMessage 'NGROK_DOMAIN must be the hostname only, like your-name.ngrok.app. Do not include https://.'
    return
  }

  if ($domain -match '/$') {
    Write-ErrorMessage 'NGROK_DOMAIN must not end with a slash. Use your-name.ngrok.app, not your-name.ngrok.app/.'
    return
  }

  if ($n8nHost -ne 'localhost') {
    Write-ErrorMessage 'Set N8N_HOST back to localhost for this guide. Do not put the ngrok domain in N8N_HOST.'
    return
  }

  if ($n8nProtocol -ne 'http') {
    Write-ErrorMessage 'Set N8N_PROTOCOL back to http for this local Docker setup. ngrok provides the public HTTPS URL.'
    return
  }

  $expectedWebhookUrl = "https://$domain/"
  if ($webhookUrl -ne $expectedWebhookUrl) {
    Write-ErrorMessage "Set WEBHOOK_URL in .env to $expectedWebhookUrl before starting the tunnel."
    Write-Info 'Keep N8N_HOST=localhost. For ngrok in this guide, change WEBHOOK_URL only.'
    return
  }

  if ((Invoke-Compose -Arguments @('up', '-d', 'ngrok')) -eq 0) {
    [void](Invoke-Compose -Arguments @('ps'))
    Write-Success 'ngrok tunnel started.'
    Write-Host ''
    Write-Host "Public URL should be: https://$domain" -ForegroundColor Green
    Write-Host 'If you changed WEBHOOK_URL, use Update -> n8n only to recreate n8n.' -ForegroundColor Cyan
  }
}

function Stop-NgrokTunnel {
  Write-Header 'Stop ngrok Tunnel'
  if ((Test-StackFiles) -and (Test-DockerReady)) {
    [void](Invoke-Compose -Arguments @('stop', 'ngrok'))
    Write-Success 'ngrok tunnel stopped. Your reserved ngrok domain was not deleted or released.'
  }
}

function Stop-Stack {
  Write-Header 'Stop Local n8n Stack'
  if ((Test-StackFiles) -and (Test-DockerReady)) {
    [void](Invoke-Compose -Arguments @('down'))
    Write-Success 'Stack stopped. Docker volumes were not removed.'
  }
}

function Restart-N8n {
  Write-Header 'Restart n8n'
  if ((Test-StackFiles) -and (Test-DockerReady)) {
    [void](Invoke-Compose -Arguments @('restart', 'n8n'))
  }
}

function Show-Status {
  Write-Header 'Compose Status Details'
  Write-Info 'Shows service state, health, container names, and ports.'
  if ((Test-StackFiles) -and (Test-DockerReady)) {
    [void](Invoke-Compose -Arguments @('ps'))
  }
}

function Show-Logs {
  param([string]$Service = '')

  Write-Header 'Recent Logs'
  Write-Info 'Showing the last 200 lines. This command returns to the menu when complete.'

  if ((Test-StackFiles) -and (Test-DockerReady)) {
    $args = @('logs', '--tail', '200')
    if ($Service) {
      $args += $Service
    }
    [void](Invoke-Compose -Arguments $args)
  }
}

function View-LogsMenu {
  Write-Header 'View Logs'
  Write-Host 'Choose logs to view:' -ForegroundColor Cyan
  Write-Host '  all'
  Write-Host '  n8n'
  Write-Host '  postgres'
  Write-Host '  ngrok'
  Write-Host '  cancel'

  $choice = (Read-Host 'Type one choice').Trim().ToLowerInvariant()
  switch ($choice) {
    'all' { Show-Logs }
    'n8n' { Show-Logs -Service 'n8n' }
    'postgres' { Show-Logs -Service 'postgres' }
    'ngrok' { Show-Logs -Service 'ngrok' }
    default { Write-Warning 'Log view cancelled.' }
  }
}

function Show-StartMenu {
  Write-Header 'Start n8n'
  Write-Host 'Choose how to start:' -ForegroundColor Cyan
  Write-Host '  1. Localhost only'
  Write-Host '  2. Start ngrok tunnel'
  Write-Host '  3. Update all, then start with ngrok tunnel'
  Write-Host '  4. Cancel'
  Write-Host ''

  $choice = Read-Host 'Enter a number'
  switch ($choice) {
    '1' { Start-LocalhostOnly }
    '2' { Start-N8nWithNgrok }
    '3' { Update-AllThenStartNgrok }
    default { Write-Warning 'Start cancelled.' }
  }
}

function Show-StopMenu {
  Write-Header 'Stop n8n'
  Write-Host 'Choose what to stop:' -ForegroundColor Cyan
  Write-Host '  1. Stop ngrok tunnel'
  Write-Host '  2. n8n + ngrok tunnel'
  Write-Host '  3. Cancel'
  Write-Host ''

  $choice = Read-Host 'Enter a number'
  switch ($choice) {
    '1' { Stop-NgrokTunnel }
    '2' { Stop-Stack }
    default { Write-Warning 'Stop cancelled.' }
  }
}

function Show-UpdateMenu {
  param([switch]$StartNgrokAfter)

  Write-Header 'Update'
  Write-Info 'Checking for updates first. Selection opens only after this check finishes.'
  $updated = Check-Updates -Services $script:Services

  if (-not $updated -or $updated.Count -eq 0) {
    Write-Success 'No service image updates were detected.'
    if ($StartNgrokAfter) {
      Write-Info 'Continuing to start n8n with ngrok tunnel.'
      Start-N8nWithNgrok
    }
    return
  }

  Write-Host ''
  Write-Host "Updates detected: $($updated -join ', ')" -ForegroundColor Yellow
  Write-Host ''
  Write-Host 'Choose what to update:' -ForegroundColor Cyan
  Write-Host '  1. All services'
  Write-Host '  2. n8n only'
  Write-Host '  3. postgres only'
  Write-Host '  4. ngrok only'
  Write-Host '  5. Cancel'
  Write-Host ''

  $choice = Read-Host 'Enter a number'
  switch ($choice) {
    '1' { Apply-Update -Services $script:Services }
    '2' { Apply-Update -Services @('n8n') }
    '3' { Apply-Update -Services @('postgres') }
    '4' { Apply-Update -Services @('ngrok') }
    default {
      Write-Warning 'Update cancelled.'
      return
    }
  }

  if ($StartNgrokAfter) {
    Start-N8nWithNgrok
  }
}

function Update-AllThenStartNgrok {
  Write-Header 'Update All, Then Start With ngrok Tunnel'
  Write-Info 'This runs the Update menu first.'
  Show-UpdateMenu -StartNgrokAfter
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
  Start-Process (Get-LocalN8nUrl)
  Write-Success 'Opened local n8n in your browser.'
}

function Backup-Postgres {
  param([switch]$Required)

  Write-Header 'Backup Postgres Database'
  if (-not (Test-StackFiles)) { return $false }
  if (-not (Test-DockerReady)) { return $false }

  $postgresUser = Get-EnvValue -Name 'POSTGRES_USER' -Default 'n8n'
  $postgresDb = Get-EnvValue -Name 'POSTGRES_DB' -Default 'n8n'
  $backupDir = Join-Path $script:StackRoot 'backups'
  $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $backupPath = Join-Path $backupDir "n8n-postgres-$timestamp.sql"

  New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

  Write-Info 'Running pg_dump from the postgres service.'
  $exitCode = Invoke-NativeCommand -Command { & docker compose exec -T postgres pg_dump -U $postgresUser $postgresDb 1> $backupPath }
  if ($exitCode -eq 0) {
    Write-Success "Backup written to: $backupPath"
    return $true
  } else {
    Write-ErrorMessage 'Backup failed. Check the Postgres logs for details.'
    if ($Required) {
      Write-ErrorMessage 'Required backup failed. No update was applied.'
    }
    return $false
  }
}

function Show-CommandList {
  Write-Header 'Command List'
  Write-Host 'Recommended entrypoint:' -ForegroundColor Cyan
  Write-Host '  _n8n-local.cmd' -ForegroundColor White
  Write-Host ''
  Write-Host 'Do not launch n8n directly from Docker Desktop. Launch it from _n8n-local.cmd instead.' -ForegroundColor Yellow
  Write-Host 'Docker Desktop direct launch skips the guided menu, status, update choices, backups, and logs.' -ForegroundColor Cyan
  Write-Host ''
  Write-Host 'Compose ngrok setup values in .env:' -ForegroundColor Cyan
  Write-Host '  NGROK_AUTHTOKEN=<copy from ngrok dashboard>'
  Write-Host '  NGROK_DOMAIN=<copy host only, no https://>'
  Write-Host '  WEBHOOK_URL=https://<your-ngrok-domain>/'
  Write-Host ''
  Write-Host 'Use the numbered menu options for normal work:' -ForegroundColor Cyan
  Write-Host '  Start n8n: starts local n8n, or starts n8n with ngrok.'
  Write-Host '  Restart n8n: restarts only the n8n app container.'
  Write-Host '  Stop n8n: stops ngrok only, or stops the local stack.'
  Write-Host '  Update: checks for image updates before letting you apply them.'
  Write-Host '  Show Compose status: shows service state, health, container names, and ports.'
  Write-Host '  View logs: shows recent logs for all services or one service.'
  Write-Host '  Back up: writes a local Postgres SQL backup under .\backups.'
  Write-Host ''
  Write-Host 'Updates are user-approved. Pulling images does not recreate or restart containers until you choose an update action.' -ForegroundColor Yellow
}

function Show-LaunchStatus {
  Write-Host 'Folder: ' -NoNewline -ForegroundColor DarkCyan
  Write-Host $script:StackRoot -ForegroundColor White
  $dockerReady = $false
  $composeExists = Test-Path -LiteralPath (Join-Path $script:StackRoot 'docker-compose.yml')
  $envExists = Test-Path -LiteralPath (Join-Path $script:StackRoot '.env')
  $configValid = $true

  if ($composeExists) {
    Write-Success 'docker-compose.yml found'
  } else {
    Write-ErrorMessage 'docker-compose.yml missing'
  }

  if ($envExists) {
    Write-Success '.env found'
    $configValid = Test-LocalPortConfig
  } else {
    Write-Warning '.env missing. Copy .env.example to .env before starting or updating.'
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

  if ($dockerReady -and $composeExists -and $envExists -and $configValid) {
    $runningServices = Get-RunningServices
    Write-Host ''
    Write-Host 'Quick service status:' -ForegroundColor Cyan
    Write-ServiceStatus -Name 'postgres' -RunningServices $runningServices
    Write-ServiceStatus -Name 'n8n' -RunningServices $runningServices -WhenRunning "local editor: $(Get-LocalN8nUrl)"
    Write-ServiceStatus -Name 'ngrok' -RunningServices $runningServices -WhenRunning 'public tunnel is ON' -WhenStopped 'public tunnel is OFF'
  }
}

function Show-MainMenu {
  Clear-MenuScreen
  Write-Header 'n8n Local Stack'
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
  Write-Host '  8. Command list'
  Write-Host '  9. Exit'
  Write-Host ''
}

while (-not $script:ExitRequested) {
  Show-MainMenu
  $choice = Read-Host 'Enter a number'

  switch ($choice) {
    '1' { Invoke-MenuAction { Show-StartMenu } }
    '2' { Invoke-MenuAction { Restart-N8n } }
    '3' { Invoke-MenuAction { Show-StopMenu } }
    '4' { Invoke-MenuAction { Show-UpdateMenu } }
    '5' { Invoke-MenuAction { Show-Status } }
    '6' { Invoke-MenuAction { View-LogsMenu } }
    '7' { Invoke-MenuAction { [void](Backup-Postgres) } }
    '8' { Invoke-MenuAction { Show-CommandList } }
    '9' { Clear-MenuScreen; Write-Success 'Bye.'; $script:ExitRequested = $true }
    default {
      Invoke-MenuAction { Write-Warning 'Choose a number from 1 to 9.' }
    }
  }
}

exit 0
