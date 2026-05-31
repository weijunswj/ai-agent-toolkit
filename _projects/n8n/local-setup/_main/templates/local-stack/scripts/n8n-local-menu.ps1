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

  $statusLabelWidth = 22
  $isRunning = $RunningServices -contains $Name
  $statusPrefix = ("  {0,-$statusLabelWidth}: " -f $Name)

  if ($isRunning) {
    Write-Host $statusPrefix -NoNewline -ForegroundColor DarkCyan
    Write-Host 'running' -NoNewline -ForegroundColor Green
    if ($WhenRunning) {
      Write-Host (' ' * 1) -NoNewline
      Write-Host "- $WhenRunning" -ForegroundColor White
    } else {
      Write-Host ''
    }
  } else {
    Write-Host $statusPrefix -NoNewline -ForegroundColor DarkCyan
    Write-Host 'stopped' -NoNewline -ForegroundColor Yellow
    if ($WhenStopped) {
      Write-Host (' ' * 1) -NoNewline
      Write-Host "- $WhenStopped" -ForegroundColor White
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
  return (Normalize-WebhookUrl -Url "$(Get-LocalN8nUrl)/")
}

function Normalize-WebhookUrl {
  param([string]$Url)

  $value = ([string]$Url).Trim()
  if (-not $value) {
    return ''
  }
  if (-not $value.EndsWith('/')) {
    $value = "$value/"
  }
  return $value
}

function Get-LocalWebhookUrl {
  return (Get-ExpectedLocalWebhookUrl)
}

function Get-NgrokWebhookUrl {
  param([string]$Domain)

  return (Normalize-WebhookUrl -Url "https://$Domain")
}

function Get-ActiveWebhookUrl {
  $activePath = Join-Path $script:StackRoot '.env.active'
  if (Test-Path -LiteralPath $activePath) {
    $pattern = '^\s*WEBHOOK_URL\s*=\s*(.*)\s*$'
    foreach ($line in Get-Content -LiteralPath $activePath) {
      if ($line -match $pattern) {
        return (Normalize-WebhookUrl -Url $Matches[1].Trim().Trim('"').Trim("'"))
      }
    }
  }

  $legacy = Get-EnvValue -Name 'WEBHOOK_URL'
  if ($legacy) {
    return (Normalize-WebhookUrl -Url $legacy)
  }

  return ''
}

function Set-ActiveWebhookUrl {
  param(
    [string]$Url,
    [string]$Mode
  )

  $activeUrl = Normalize-WebhookUrl -Url $Url
  if (-not $activeUrl) {
    Write-ErrorMessage 'Cannot choose an empty WEBHOOK_URL.'
    return $false
  }

  $activePath = Join-Path $script:StackRoot '.env.active'
  $content = @(
    '# Generated by _n8n-local.cmd. Do not edit by hand.',
    "# Active mode: $Mode",
    "WEBHOOK_URL=$activeUrl"
  )

  Set-Content -LiteralPath $activePath -Value $content -Encoding ascii
  Write-Info "Active WEBHOOK_URL for n8n is now $activeUrl"
  return $true
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
    $imageId = ''

    try {
      $containerId = (& docker compose ps -q $service 2>$null | Select-Object -First 1)
      $containerId = ([string]$containerId).Trim()
      if ($LASTEXITCODE -eq 0 -and $containerId) {
        $imageId = (& docker inspect $containerId --format '{{.Image}}' 2>$null | Select-Object -First 1)
        if ($LASTEXITCODE -ne 0) {
          $imageId = ''
        }
      }
    } catch {
      $imageId = ''
    }

    $image = $script:ServiceImages[$service]
    if (-not $image) {
      $ids[$service] = ([string]$imageId).Trim()
      continue
    }

    if (-not $imageId) {
      try {
        $imageId = (& docker image inspect $image --format '{{.Id}}' 2>$null | Select-Object -First 1)
        if ($LASTEXITCODE -ne 0) {
          $imageId = ''
        }
      } catch {
        $imageId = ''
      }
    }

    $ids[$service] = ([string]$imageId).Trim()
  }
  return $ids
}

function Get-ShortImageId {
  param([string]$ImageId)

  $value = ([string]$ImageId).Trim() -replace '^sha256:', ''
  if (-not $value) {
    return 'not found'
  }
  if ($value.Length -gt 12) {
    return $value.Substring(0, 12)
  }
  return $value
}

function Get-ImageVersionLines {
  $lines = New-Object System.Collections.Generic.List[string]
  $imageIds = Get-ServiceImageIds -Services $script:Services

  foreach ($service in $script:Services) {
    $image = $script:ServiceImages[$service]
    $imageId = Get-ShortImageId -ImageId $imageIds[$service]
    $label = "  {0,-8}: " -f $service
    $lines.Add("$label$image ($imageId)")
  }

  return $lines.ToArray()
}

function Write-ImageVersions {
  Write-Host ''
  Write-Host 'Image versions:' -ForegroundColor Cyan
  foreach ($line in Get-ImageVersionLines) {
    Write-Host $line -ForegroundColor White
  }
}

function Write-BackupImageLog {
  param([string]$BackupPath)

  $logPath = Join-Path (Split-Path -Parent $BackupPath) 'image-versions.txt'
  $content = @(
    '# n8n local backup image log',
    "Backup file: $BackupPath",
    "Created: $(Get-Date -Format o)",
    '',
    'Service image tags and local image IDs at backup time:',
    ''
  ) + (Get-ImageVersionLines)

  try {
    Set-Content -LiteralPath $logPath -Value $content -Encoding ascii
    return $logPath
  } catch {
    Write-Warning "Backup image log could not be written: $($_.Exception.Message)"
    return ''
  }
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
  param([string]$Prompt)

  Write-Host ''
  Write-Host 'Choices:' -ForegroundColor DarkCyan
  Write-Host '  1. all'
  Write-Host '  2. n8n'
  Write-Host '  3. postgres'
  Write-Host '  4. ngrok'
  Write-Host '  5. cancel'
  $choice = (Read-Host $Prompt).Trim()

  switch ($choice) {
    '1' { return $script:Services }
    '2' { return @('n8n') }
    '3' { return @('postgres') }
    '4' { return @('ngrok') }
    '5' { return @() }
    default {
      Write-Warning 'Choose a number from 1 to 5.'
      return @()
    }
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
  param([switch]$ForceRecreateN8n)

  Write-Header 'Start Local n8n Stack'
  if (-not (Test-StackFiles)) { return }
  if (-not (Test-DockerReady)) { return }

  if (-not (Set-ActiveWebhookUrl -Url (Get-LocalWebhookUrl) -Mode 'localhost')) { return }

  if ((Invoke-Compose -Arguments @('up', '-d', 'postgres')) -ne 0) { return }

  $n8nArgs = @('up', '-d')
  if ($ForceRecreateN8n) {
    $n8nArgs += '--force-recreate'
  }
  $n8nArgs += 'n8n'

  if ((Invoke-Compose -Arguments $n8nArgs) -eq 0) {
    [void](Invoke-Compose -Arguments @('ps'))
    Write-Success 'Local n8n stack started.'
    Write-Host ''
    Write-Host "n8n: $(Get-LocalN8nUrl)" -ForegroundColor Green
    Write-Host 'For public ngrok webhooks, fill the ngrok values in .env, then use Start ngrok tunnel.' -ForegroundColor Cyan
  }
}

function Start-LocalhostOnly {
  Start-LocalStack -ForceRecreateN8n

  $runningServices = Get-RunningServices
  if ($runningServices -contains 'ngrok') {
    Write-Warning 'ngrok tunnel is running. Stopping it so n8n is localhost only.'
    [void](Invoke-Compose -Arguments @('stop', 'ngrok'))
  }
}

function Start-N8nWithNgrok {
  Write-Header 'Start n8n With ngrok Tunnel'
  if (-not (Test-StackFiles)) { return }
  if (-not (Test-DockerReady)) { return }

  $runningServices = Get-RunningServices
  if ($runningServices -contains 'n8n') {
    Write-Success 'n8n is already running. It will be recreated so current .env values are applied.'
  } else {
    Write-Info 'n8n is not running yet. It will be started with the tunnel after checks finish.'
  }

  $runningServices = Get-RunningServices
  if ($runningServices -contains 'ngrok') {
    Write-Success 'ngrok tunnel is already running. Current .env values will still be applied.'
  }

  Write-Info 'Starting or refreshing ngrok tunnel now.'
  Start-NgrokTunnel
}

function Start-NgrokTunnel {
  Write-Header 'Start ngrok Tunnel'
  if (-not (Test-StackFiles)) { return }
  if (-not (Test-DockerReady)) { return }

  $authtoken = Get-EnvValue -Name 'NGROK_AUTHTOKEN'
  $domain = Get-EnvValue -Name 'NGROK_DOMAIN'

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

  $publicWebhookUrl = Get-NgrokWebhookUrl -Domain $domain
  if (-not (Set-ActiveWebhookUrl -Url $publicWebhookUrl -Mode 'ngrok')) {
    return
  }

  if ((Invoke-Compose -Arguments @('up', '-d', '--force-recreate', 'n8n', 'ngrok')) -eq 0) {
    [void](Invoke-Compose -Arguments @('ps'))
    Write-Success 'n8n and ngrok tunnel started. n8n was recreated so .env values are applied.'
    Write-Host ''
    Write-Host "Public URL should be: $publicWebhookUrl" -ForegroundColor Green
  }
}

function Stop-NgrokTunnel {
  Write-Header 'Stop ngrok Tunnel'
  if ((Test-StackFiles) -and (Test-DockerReady)) {
    $wasN8nRunning = (Get-RunningServices) -contains 'n8n'

    [void](Invoke-Compose -Arguments @('stop', 'ngrok'))

    if (-not (Set-ActiveWebhookUrl -Url (Get-LocalWebhookUrl) -Mode 'localhost')) {
      return
    }

    if ($wasN8nRunning) {
      Write-Info 'Recreating n8n so WEBHOOK_URL is now local.'
      [void](Invoke-Compose -Arguments @('up', '-d', '--force-recreate', 'n8n'))
    }

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
    if (-not (Set-ActiveWebhookUrl -Url (Get-LocalWebhookUrl) -Mode 'localhost')) { return }
    Write-Info 'Recreating only the n8n app container so current .env values are applied.'
    Write-Info 'Postgres data and n8n files stay in Docker volumes.'
    [void](Invoke-Compose -Arguments @('up', '-d', '--force-recreate', 'n8n'))
    [void](Invoke-Compose -Arguments @('ps'))
  }
}

function Show-Status {
  Write-Header 'Compose Status Details'
  Write-Info 'Shows service state, health, container names, and ports.'
  if ((Test-StackFiles) -and (Test-DockerReady)) {
    [void](Invoke-Compose -Arguments @('ps'))
    Write-ImageVersions
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
  Write-Host '  1. all'
  Write-Host '  2. n8n'
  Write-Host '  3. postgres'
  Write-Host '  4. ngrok'
  Write-Host '  5. cancel'

  $choice = (Read-Host 'Enter a number').Trim()
  switch ($choice) {
    '1' { Show-Logs }
    '2' { Show-Logs -Service 'n8n' }
    '3' { Show-Logs -Service 'postgres' }
    '4' { Show-Logs -Service 'ngrok' }
    '5' { Write-Warning 'Log view cancelled.' }
    default { Write-Warning 'Choose a number from 1 to 5.' }
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
    '4' { Write-Warning 'Start cancelled.' }
    default { Write-Warning 'Choose a number from 1 to 4.' }
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
    '3' { Write-Warning 'Stop cancelled.' }
    default { Write-Warning 'Choose a number from 1 to 3.' }
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
    '5' { Write-Warning 'Update cancelled.' }
    default {
      Write-Warning 'Choose a number from 1 to 5.'
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
  $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $backupRoot = Join-Path $script:StackRoot 'backups'
  $backupDir = Join-Path $backupRoot "n8n-postgres-$timestamp"
  $backupPath = Join-Path $backupDir 'database.sql'

  New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

  Write-Info 'Running pg_dump from the postgres service.'
  $exitCode = Invoke-NativeCommand -Command { & docker compose exec -T postgres pg_dump -U $postgresUser $postgresDb 1> $backupPath }
  if ($exitCode -eq 0) {
    Write-Success "Backup written to: $backupPath"
    $imageLogPath = Write-BackupImageLog -BackupPath $backupPath
    if ($imageLogPath) {
      Write-Success "Image versions written to: $imageLogPath"
    }
    Write-Success "Backup folder: $backupDir"
    return $true
  } else {
    Write-ErrorMessage 'Backup failed. Check the Postgres logs for details.'
    if ($Required) {
      Write-ErrorMessage 'Required backup failed. No update was applied.'
    }
    return $false
  }
}

function Write-CommandListItem {
  param(
    [string]$Number,
    [string]$Name,
    [string]$Description
  )

  $itemLabelWidth = 19
  $itemPrefix = ("  {0}. {1,-$itemLabelWidth}: " -f $Number, $Name)
  Write-Host $itemPrefix -NoNewline
  Write-Host $Description
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
  Write-Host ''
  Write-Host 'The launcher writes the active WEBHOOK_URL into .env.active automatically.' -ForegroundColor Cyan
  Write-Host ''
  Write-Host 'Use the numbered menu options for normal work:' -ForegroundColor Cyan
  Write-CommandListItem -Number '1' -Name 'Start n8n' -Description 'Starts local n8n, or starts n8n with ngrok.'
  Write-CommandListItem -Number '2' -Name 'Restart n8n' -Description 'Recreates only the n8n app container so .env changes are applied.'
  Write-CommandListItem -Number '3' -Name 'Stop n8n' -Description 'Stops ngrok only, or stops the local stack.'
  Write-CommandListItem -Number '4' -Name 'Update' -Description 'Checks for image updates before applying them.'
  Write-CommandListItem -Number '5' -Name 'Show Compose status' -Description 'Shows service state, health, container names, and ports.'
  Write-CommandListItem -Number '6' -Name 'View logs' -Description 'Shows recent logs for all services or one service.'
  Write-CommandListItem -Number '7' -Name 'Back up' -Description 'Writes a timestamped backup folder under .\backups.'
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

    $webhookUrl = Get-ActiveWebhookUrl
    $expectedWebhookUrl = Get-LocalWebhookUrl
    if ($webhookUrl) {
      $webhookLabel = "  {0,-22}: " -f 'active WEBHOOK_URL'
      Write-Host $webhookLabel -NoNewline -ForegroundColor DarkCyan
      Write-Host $webhookUrl -ForegroundColor White
    }

    Write-ImageVersions

    if (($runningServices -notcontains 'ngrok') -and $webhookUrl -and $webhookUrl -ne $expectedWebhookUrl) {
      Write-Host ''
      Write-Warning 'WEBHOOK_URL is public while ngrok is stopped.'
      Write-Warning 'The local editor still opens, but public webhook and OAuth links need ngrok running.'
    }
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
