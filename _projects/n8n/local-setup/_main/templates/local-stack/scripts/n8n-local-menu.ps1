$ErrorActionPreference = 'Stop'

$script:StackRoot = (Get-Location).Path
$script:CoreServices = @('postgres', 'n8n')
$script:Services = @('n8n', 'postgres', 'ngrok')
$script:ExitRequested = $false
$script:ServiceImageDefaults = @{
  n8n = 'docker.n8n.io/n8nio/n8n:stable'
  postgres = 'postgres:16-alpine'
  ngrok = 'ngrok/ngrok:latest'
}
$script:ServiceImages = @{
  n8n = $script:ServiceImageDefaults.n8n
  postgres = $script:ServiceImageDefaults.postgres
  ngrok = $script:ServiceImageDefaults.ngrok
}
$script:ServiceImageMetadata = @{}

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
      $statusLine = "- $WhenRunning"
      $parts = $statusLine -split '(https?://\S+)'
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
  } else {
    Write-Host $statusPrefix -NoNewline -ForegroundColor DarkCyan
    Write-Host 'stopped' -NoNewline -ForegroundColor Yellow
    if ($WhenStopped) {
      Write-Host (' ' * 1) -NoNewline
      $statusLine = "- $WhenStopped"
      $parts = $statusLine -split '(https?://\S+)'
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
  $result = $Default
  foreach ($line in Get-Content -LiteralPath $envPath) {
    if ($line -match $pattern) {
      $value = $Matches[1].Trim()
      $value = $value.Trim('"').Trim("'")
      if ($value.Length -gt 0) {
        $result = $value
      }
    }
  }

  return $result
}

function Get-ImageVersionFromImageRef {
  param([string]$ImageRef)

  $ref = ([string]$ImageRef).Trim()
  if (-not $ref) {
    return ''
  }

  $target = $ref
  $slashIndex = $target.LastIndexOf('/')
  if ($slashIndex -ge 0 -and $slashIndex -lt ($target.Length - 1)) {
    $target = $target.Substring($slashIndex + 1)
  }

  if ($target -match '^(?<Name>[^:]+):(?<Tag>[^@]+)$') {
    return $Matches.Tag
  }

  return ''
}

function Test-VersionLikeImageTag {
  param([string]$Tag)

  $value = ([string]$Tag).Trim()
  return ($value -match '^v?\d+(\.\d+){1,3}([.-][0-9A-Za-z]+)?$')
}

function Get-ServiceRuntimeVersion {
  param(
    [string]$Service,
    [string]$ContainerId
  )

  $container = ([string]$ContainerId).Trim()
  if (-not $container) {
    return ''
  }

  $output = ''
  try {
    switch ($Service) {
      'n8n' {
        $output = (& docker exec $container node -p "require('/usr/local/lib/node_modules/n8n/package.json').version" 2>$null | Select-Object -First 1)
        if ($LASTEXITCODE -ne 0 -or -not ([string]$output).Trim()) {
          $output = (& docker exec $container n8n --version 2>$null | Select-Object -First 1)
        }
      }
      'postgres' {
        $output = (& docker exec $container postgres --version 2>$null | Select-Object -First 1)
      }
      'ngrok' {
        $output = (& docker exec $container ngrok version 2>$null | Select-Object -First 1)
      }
    }

    if ($LASTEXITCODE -ne 0) {
      return ''
    }
  } catch {
    return ''
  }

  $value = ([string]$output).Trim()
  if (-not $value) {
    return ''
  }

  if ($value -match '(?<Version>\d+\.\d+(\.\d+){0,2}([.-][0-9A-Za-z]+)?)') {
    return $Matches.Version
  }

  return $value
}

function Get-ImageLabelVersion {
  param([string]$ImageRef)

  $image = ([string]$ImageRef).Trim()
  if (-not $image) {
    return ''
  }

  $labels = @(
    'org.opencontainers.image.version',
    'org.label-schema.version'
  )

  foreach ($label in $labels) {
    try {
      $value = (& docker image inspect $image --format "{{index .Config.Labels `"$label`"}}" 2>$null | Select-Object -First 1)
      if ($LASTEXITCODE -eq 0) {
        $value = ([string]$value).Trim()
        if ($value) {
          return $value
        }
      }
    } catch {
      continue
    }
  }

  return ''
}

function Initialize-ServiceImages {
  $script:ServiceImages = @{
    n8n = Get-EnvValue -Name 'N8N_IMAGE' -Default $script:ServiceImageDefaults.n8n
    postgres = Get-EnvValue -Name 'POSTGRES_IMAGE' -Default $script:ServiceImageDefaults.postgres
    ngrok = Get-EnvValue -Name 'NGROK_IMAGE' -Default $script:ServiceImageDefaults.ngrok
  }
}

function Get-ComposeProjectName {
  try {
    $configJson = (& docker compose config --format json 2>$null)
    if ($LASTEXITCODE -eq 0 -and $configJson) {
      $config = (($configJson | Out-String).Trim() | ConvertFrom-Json)
      $name = ([string]$config.name).Trim()
      if ($name) {
        return $name
      }
    }
  } catch {
  }

  $folderName = (Split-Path -Leaf $script:StackRoot).TrimStart('.').ToLowerInvariant()
  $folderName = $folderName -replace '[^a-z0-9_-]', ''
  if ($folderName) {
    return $folderName
  }

  return 'n8n-local'
}

function Test-ComposeVolumeExists {
  param([string]$VolumeName)

  $projectName = Get-ComposeProjectName
  $fullName = "${projectName}_${VolumeName}"

  try {
    & docker volume inspect $fullName *> $null
    return ($LASTEXITCODE -eq 0)
  } catch {
    return $false
  }
}

function Test-FirstLocalStart {
  $requiredVolumes = @('n8n_data', 'postgres_data')
  foreach ($volume in $requiredVolumes) {
    if (-not (Test-ComposeVolumeExists -VolumeName $volume)) {
      return $true
    }
  }

  return $false
}

function Test-LocalImageExists {
  param([string]$Image)

  $imageRef = ([string]$Image).Trim()
  if (-not $imageRef) {
    return $false
  }

  try {
    & docker image inspect $imageRef *> $null
    return ($LASTEXITCODE -eq 0)
  } catch {
    return $false
  }
}

function Test-ServiceImagesAvailable {
  param(
    [string[]]$Services,
    [switch]$AllowPull
  )

  if ($AllowPull) {
    return $true
  }

  Initialize-ServiceImages
  $missing = New-Object System.Collections.Generic.List[string]

  foreach ($service in $Services) {
    $image = $script:ServiceImages[$service]
    if (-not (Test-LocalImageExists -Image $image)) {
      $missing.Add("$service -> $image")
    }
  }

  if ($missing.Count -eq 0) {
    return $true
  }

  Write-ErrorMessage 'Configured image is not available locally:'
  foreach ($item in $missing) {
    Write-ErrorMessage "  $item"
  }
  Write-ErrorMessage 'Run Update for that service to pull the image and restart it.'
  return $false
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

  Initialize-ServiceImages
  $script:ServiceImageMetadata = @{}
  $ids = @{}
  foreach ($service in $Services) {
    $imageId = ''
    $imageRef = ''
    $imageDigest = ''
    $imageVersion = ''
    $imageVersionSource = ''

    try {
      $containerId = (& docker compose ps -q $service 2>$null | Select-Object -First 1)
      $containerId = ([string]$containerId).Trim()
      if ($LASTEXITCODE -eq 0 -and $containerId) {
        $imageRef = (& docker inspect $containerId --format '{{.Config.Image}}' 2>$null | Select-Object -First 1)
        if ($LASTEXITCODE -ne 0) {
          $imageRef = ''
        }
        $imageId = (& docker inspect $containerId --format '{{.Image}}' 2>$null | Select-Object -First 1)
        if ($LASTEXITCODE -ne 0) {
          $imageId = ''
        }
        $imageDigest = (& docker inspect $containerId --format '{{index .RepoDigests 0}}' 2>$null | Select-Object -First 1)
        if ($LASTEXITCODE -ne 0) {
          $imageDigest = ''
        }
        $imageVersion = (& docker inspect $containerId --format '{{index .Config.Labels "org.opencontainers.image.version"}}' 2>$null | Select-Object -First 1)
        if ($LASTEXITCODE -ne 0) {
          $imageVersion = ''
        } else {
          $imageVersion = ([string]$imageVersion).Trim()
          if ($imageVersion) {
            $imageVersionSource = 'container-label'
          }
        }

        $runtimeVersion = Get-ServiceRuntimeVersion -Service $service -ContainerId $containerId
        if ($runtimeVersion) {
          $imageVersion = $runtimeVersion
          $imageVersionSource = 'runtime'
        }
      }
    } catch {
      $imageId = ''
      $imageRef = ''
      $imageDigest = ''
      $imageVersion = ''
      $imageVersionSource = ''
    }

    $image = $script:ServiceImages[$service]
    if (-not $image) {
      $ids[$service] = Resolve-ServiceImageValue -ImageId $imageId -ImageRef $imageRef -ImageDigest $imageDigest
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

    if (-not $imageId -and -not $imageRef) {
      $imageRef = $image
    }

    if ((-not $imageVersion) -and $imageId) {
      $imageVersion = Get-ImageLabelVersion -ImageRef $imageId
      if ($imageVersion) {
        $imageVersionSource = 'running-image-label'
      }
    }

    if ((-not $imageVersion) -and $image) {
      $imageVersion = Get-ImageLabelVersion -ImageRef $image
      if ($imageVersion) {
        $imageVersionSource = 'configured-label'
      }
    }

    if (-not $imageVersion) {
      $imageVersion = Get-ImageVersionFromImageRef -ImageRef $image
      if ($imageVersion) {
        $imageVersionSource = 'configured-tag'
      }
    }

    $script:ServiceImageMetadata[$service] = @{
      Version = ([string]$imageVersion).Trim()
      VersionSource = $imageVersionSource
      Digest = ([string]$imageDigest).Trim()
      RunningImageRef = ([string]$imageRef).Trim()
    }

    $ids[$service] = Resolve-ServiceImageValue -ImageId $imageId -ImageRef $imageRef -ImageDigest $imageDigest
  }
  return $ids
}

function Resolve-ServiceImageValue {
  param(
    [string]$ImageId,
    [string]$ImageRef,
    [string]$ImageDigest
  )

  $trimmedImageId = ([string]$ImageId).Trim()
  if ($trimmedImageId) {
    return $trimmedImageId
  }
  if ($ImageDigest) {
    return ([string]$ImageDigest).Trim()
  }
  return ([string]$ImageRef).Trim()
}

function Get-ShortImageId {
  param([string]$ImageId)

  $value = ([string]$ImageId).Trim()
  if (-not $value) {
    return 'not found'
  }

  if ($value -match '^sha256:([0-9a-f]{64})$') {
    $value = $Matches[1]
  } elseif ($value -match '@sha256:([0-9a-f]{64})$') {
    $value = $Matches[1]
  }

  if ($value -match '^.+://') {
    return $value
  }

  if ($value.Length -gt 64 -and $value.Contains(':')) {
    return $value
  }

  if ($value.Length -gt 12) {
    return $value.Substring(0, 12)
  }
  return $value
}

function Get-ComposeServiceRows {
  $rows = New-Object System.Collections.Generic.List[object]

  try {
    $formatted = @(& docker compose ps --format '{{.Service}}|{{.Image}}|{{.State}}' 2>$null)
    if ($LASTEXITCODE -eq 0 -and $formatted.Count -gt 0) {
      foreach ($line in $formatted) {
        $parts = ([string]$line).Split('|')
        if ($parts.Count -ge 3) {
          $rows.Add([pscustomobject]@{
            Service = $parts[0].Trim()
            Image = $parts[1].Trim()
            State = $parts[2].Trim()
            ContainerId = ''
            Name = ''
          })
        }
      }
    }
  } catch {
  }

  if ($rows.Count -gt 0) {
    return $rows.ToArray()
  }

  try {
    $jsonOutput = @(& docker compose ps --format json 2>$null)
    if ($LASTEXITCODE -ne 0 -or $jsonOutput.Count -eq 0) {
      return @()
    }

    $json = ($jsonOutput -join "`n").Trim()
    if (-not $json) {
      return @()
    }

    $parsed = $json | ConvertFrom-Json
    foreach ($item in @($parsed)) {
      $rows.Add([pscustomobject]@{
        Service = ([string]$item.Service).Trim()
        Image = ([string]$item.Image).Trim()
        State = ([string]$item.State).Trim()
        ContainerId = ([string]$item.ID).Trim()
        Name = ([string]$item.Name).Trim()
      })
    }
  } catch {
  }

  return $rows.ToArray()
}

function Get-RunningServiceImage {
  param(
    [string]$Service,
    [object[]]$Rows = @()
  )

  try {
    $row = @($Rows | Where-Object { $_.Service -eq $Service } | Select-Object -First 1)
    if ($row.Count -gt 0) {
      $state = ([string]$row[0].State).Trim().ToLowerInvariant()
      $image = ([string]$row[0].Image).Trim()
      if ($state -eq 'running' -or $state -like 'running*') {
        if ($image) {
          return $image
        }

        $container = ([string]$row[0].ContainerId).Trim()
        if (-not $container) {
          $container = ([string]$row[0].Name).Trim()
        }
        if ($container) {
          $inspectedImage = (& docker inspect $container --format '{{.Config.Image}}' 2>$null | Select-Object -First 1)
          if ($LASTEXITCODE -eq 0) {
            return ([string]$inspectedImage).Trim()
          }
        }
      }
      return ''
    }
  } catch {
  }

  return ''
}

function Get-ImageVersionLines {
  param([string[]]$RunningServices = @())

  $lines = New-Object System.Collections.Generic.List[string]
  $rows = Get-ComposeServiceRows

  foreach ($service in $script:Services) {
    $label = "  {0,-8}: " -f $service
    $runningImage = Get-RunningServiceImage -Service $service -Rows $rows
    if ($runningImage) {
      $lines.Add("$label$runningImage")
    } elseif ($RunningServices -contains $service) {
      $lines.Add("$($label)failed to detect")
    } else {
      $lines.Add("$($label)stopped")
    }
  }

  return $lines.ToArray()
}

function Write-ImageVersions {
  param([string[]]$RunningServices = @())

  Write-Host ''
  Write-Host 'Container images:' -ForegroundColor Cyan
  foreach ($line in Get-ImageVersionLines -RunningServices $RunningServices) {
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
    'Running container images at backup time:',
    ''
  ) + (Get-ImageVersionLines -RunningServices (Get-RunningServices))

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
  Write-Info 'Use the Update menu when you want pulled images applied automatically.'

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
    Write-Warning "Updates were pulled: $($updated -join ', ')"
    Write-Warning 'Use the Update menu to recreate selected containers automatically.'
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
  $upArgs = @('up', '-d', '--pull', 'never', '--force-recreate')

  if (-not $isAll) {
    $pullArgs += $Services
    $upArgs += $Services
  }

  Write-Header 'Update And Restart'
  Write-Info 'Pulling selected image(s), then recreating selected container(s) automatically.'
  if ((Invoke-Compose -Arguments $pullArgs) -ne 0) { return }
  if ((Invoke-Compose -Arguments $upArgs) -ne 0) { return }
  [void](Invoke-Compose -Arguments @('ps'))
  Write-Success 'Selected services were pulled and recreated.'
}

function Start-LocalStack {
  param([switch]$ForceRecreateN8n)

  Write-Header 'Start Local n8n Stack'
  if (-not (Test-StackFiles)) { return }
  if (-not (Test-DockerReady)) { return }

  $isFirstStart = Test-FirstLocalStart
  if (-not (Test-ServiceImagesAvailable -Services $script:CoreServices -AllowPull:$isFirstStart)) { return }

  if (-not (Set-ActiveWebhookUrl -Url (Get-LocalWebhookUrl) -Mode 'localhost')) { return }

  $postgresArgs = @('up', '-d')
  if (-not $isFirstStart) {
    $postgresArgs += @('--pull', 'never')
  }
  $postgresArgs += 'postgres'

  if ((Invoke-Compose -Arguments $postgresArgs) -ne 0) { return }

  $n8nArgs = @('up', '-d')
  if (-not $isFirstStart) {
    $n8nArgs += @('--pull', 'never')
  }
  if ($ForceRecreateN8n) {
    $n8nArgs += '--force-recreate'
  }
  $n8nArgs += 'n8n'

  if ((Invoke-Compose -Arguments $n8nArgs) -eq 0) {
    [void](Invoke-Compose -Arguments @('ps'))
    Write-Success 'Local n8n stack started.'
    Write-Host ''
    Write-Host "n8n: $(Get-LocalN8nUrl)" -ForegroundColor DarkYellow
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
    Write-Success 'n8n is already running. It will be recreated so current non-image .env values are applied.'
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

  $isFirstStart = Test-FirstLocalStart
  if (-not (Test-ServiceImagesAvailable -Services $script:Services -AllowPull:$isFirstStart)) { return }

  $publicWebhookUrl = Get-NgrokWebhookUrl -Domain $domain
  if (-not (Set-ActiveWebhookUrl -Url $publicWebhookUrl -Mode 'ngrok')) {
    return
  }

  $upArgs = @('up', '-d')
  if (-not $isFirstStart) {
    $upArgs += @('--pull', 'never')
  }
  $upArgs += @('--force-recreate', 'n8n', 'ngrok')

  if ((Invoke-Compose -Arguments $upArgs) -eq 0) {
    [void](Invoke-Compose -Arguments @('ps'))
    Write-Success 'n8n and ngrok tunnel started. n8n was recreated so current non-image .env values are applied.'
    Write-Host ''
    Write-Host "Public URL should be: $publicWebhookUrl" -ForegroundColor DarkYellow
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
      if (-not (Test-ServiceImagesAvailable -Services @('n8n'))) { return }
      [void](Invoke-Compose -Arguments @('up', '-d', '--pull', 'never', '--force-recreate', 'n8n'))
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
    Write-Info 'Recreating only the n8n app container so current non-image .env values are applied.'
    Write-Info 'Postgres data and n8n files stay in Docker volumes.'
    if (-not (Test-ServiceImagesAvailable -Services @('n8n'))) { return }
    [void](Invoke-Compose -Arguments @('up', '-d', '--pull', 'never', '--force-recreate', 'n8n'))
    [void](Invoke-Compose -Arguments @('ps'))
  }
}

function Show-Status {
  Write-Header 'Compose Status Details'
  Write-Info 'Shows service state, health, container names, and ports.'
  if ((Test-StackFiles) -and (Test-DockerReady)) {
    [void](Invoke-Compose -Arguments @('ps'))
    $runningServices = Get-RunningServices
    Write-ImageVersions -RunningServices $runningServices
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
  Write-Info 'Choose what to update. The launcher pulls images, then recreates selected containers automatically.'
  Write-Host 'Choose what to update:' -ForegroundColor Cyan
  Write-Host '  1. All services'
  Write-Host '  2. n8n only'
  Write-Host '  3. postgres only'
  Write-Host '  4. ngrok only'
  Write-Host '  5. Cancel'
  Write-Host ''

  $choice = Read-Host 'Enter a number'
  $selection = @()
  switch ($choice) {
    '1' { $selection = $script:Services }
    '2' { $selection = @('n8n') }
    '3' { $selection = @('postgres') }
    '4' { $selection = @('ngrok') }
    '5' {
      Write-Warning 'Update cancelled.'
      return
    }
    default {
      Write-Warning 'Choose a number from 1 to 5.'
      return
    }
  }

  Apply-Update -Services $selection

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
      Write-Success "Container image log written to: $imageLogPath"
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
  Write-CommandListItem -Number '2' -Name 'Restart n8n' -Description 'Recreates only the n8n app container for non-image .env changes.'
  Write-CommandListItem -Number '3' -Name 'Stop n8n' -Description 'Stops ngrok only, or stops the local stack.'
  Write-CommandListItem -Number '4' -Name 'Update' -Description 'Pulls images and recreates selected containers automatically.'
  Write-CommandListItem -Number '5' -Name 'Show Compose status' -Description 'Shows service state, health, container names, and ports.'
  Write-CommandListItem -Number '6' -Name 'View logs' -Description 'Shows recent logs for all services or one service.'
  Write-CommandListItem -Number '7' -Name 'Back up' -Description 'Writes a timestamped backup folder under .\backups.'
  Write-Host ''
  Write-Host 'Updates are user-approved. After you choose what to update, selected containers are recreated automatically.' -ForegroundColor Yellow
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
      Write-Host $webhookUrl -ForegroundColor DarkYellow
    }

    Write-ImageVersions -RunningServices $runningServices

    if (($runningServices -notcontains 'ngrok') -and $webhookUrl -and $webhookUrl -ne $expectedWebhookUrl) {
      Write-Host ''
      Write-Warning 'WEBHOOK_URL is still using ngrok, but ngrok is stopped.'
      Write-Warning 'Local n8n still works. Public webhooks and OAuth callbacks will not.'
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
