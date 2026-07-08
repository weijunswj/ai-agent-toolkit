$ErrorActionPreference = 'Stop'

$script:StackRoot = (Get-Location).Path
$script:ExitRequested = $false
$script:Services = @('postgres', 'n8n', 'cloudflared')
$script:MenuArguments = @($args)
$script:ProductionBackupTaskPrefix = 'n8n-production-cloudflare-backup'

function Get-MenuArgumentValue {
  param([string]$Name)

  $longName = "--$Name"
  $dashName = "-$Name"
  for ($index = 0; $index -lt $script:MenuArguments.Count; $index += 1) {
    $value = [string]$script:MenuArguments[$index]
    if ($value -eq $longName -or $value -eq $dashName) {
      if (($index + 1) -lt $script:MenuArguments.Count) {
        return ([string]$script:MenuArguments[$index + 1]).Trim()
      }
      return ''
    }

    if ($value.StartsWith("$longName=", [System.StringComparison]::OrdinalIgnoreCase)) {
      return $value.Substring($longName.Length + 1).Trim()
    }

    if ($value.StartsWith("$dashName=", [System.StringComparison]::OrdinalIgnoreCase)) {
      return $value.Substring($dashName.Length + 1).Trim()
    }
  }

  return ''
}

function Test-MenuFlag {
  param([string]$Name)

  $longName = "--$Name"
  $dashName = "-$Name"
  foreach ($value in $script:MenuArguments) {
    $text = [string]$value
    if ($text -eq $longName -or $text -eq $dashName) {
      return $true
    }
  }

  return $false
}

function Resolve-LocalPath {
  param([string]$Path)

  $value = ([string]$Path).Trim().Trim('"')
  if (-not $value) {
    return ''
  }

  return [System.IO.Path]::GetFullPath($value)
}

function Initialize-MenuRuntime {
  $explicitStackDir = Get-MenuArgumentValue -Name 'stack-dir'
  if (-not $explicitStackDir) {
    return
  }

  $stackDir = Resolve-LocalPath -Path $explicitStackDir
  if (Test-Path -LiteralPath $stackDir -PathType Container) {
    $script:StackRoot = $stackDir
    Set-Location -LiteralPath $script:StackRoot
  }
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

function Invoke-ComposeCapture {
  param([string[]]$Arguments)

  $previousComposeProgress = $env:COMPOSE_PROGRESS
  $previousComposeAnsi = $env:COMPOSE_ANSI
  try {
    $env:COMPOSE_PROGRESS = 'plain'
    $env:COMPOSE_ANSI = 'never'
    $output = @(& docker compose @Arguments 2>&1)
    return [pscustomobject]@{
      ExitCode = $LASTEXITCODE
      Output = @($output | ForEach-Object { [string]$_ })
    }
  } catch {
    return [pscustomobject]@{
      ExitCode = 1
      Output = @([string]$_.Exception.Message)
    }
  } finally {
    if ($null -eq $previousComposeProgress) {
      Remove-Item Env:\COMPOSE_PROGRESS -ErrorAction SilentlyContinue
    } else {
      $env:COMPOSE_PROGRESS = $previousComposeProgress
    }

    if ($null -eq $previousComposeAnsi) {
      Remove-Item Env:\COMPOSE_ANSI -ErrorAction SilentlyContinue
    } else {
      $env:COMPOSE_ANSI = $previousComposeAnsi
    }
  }
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
    $label = "  {0,-10}: " -f $service
    $runningImage = Get-RunningServiceImage -Service $service -Rows $rows
    if ($runningImage) {
      $lines.Add("$label$runningImage")
    } elseif ($RunningServices -contains $service) {
      $lines.Add("$($label)running, image unknown")
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

function Read-EnvTextValue {
  param(
    [string]$Text,
    [string]$Name
  )

  $pattern = "^\s*$([regex]::Escape($Name))\s*=\s*(.*)\s*$"
  foreach ($line in (([string]$Text) -split "\r?\n")) {
    if ($line -match $pattern) {
      $value = $Matches[1].Trim()
      $value = $value.Trim('"').Trim("'")
      if ($value.Length -gt 0) {
        return $value
      }
    }
  }

  return ''
}

function Read-EnvFileValue {
  param(
    [string]$Path,
    [string]$Name
  )

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    return ''
  }

  return (Read-EnvTextValue -Text (Get-Content -LiteralPath $Path -Raw) -Name $Name)
}

function Set-EnvFileValue {
  param(
    [string]$Path,
    [string]$Name,
    [string]$Value
  )

  $lines = New-Object System.Collections.Generic.List[string]
  if (Test-Path -LiteralPath $Path -PathType Leaf) {
    foreach ($line in Get-Content -LiteralPath $Path) {
      $lines.Add($line)
    }
  }

  $pattern = "^\s*$([regex]::Escape($Name))\s*="
  $replacement = "$Name=$Value"
  $updated = $false
  for ($index = 0; $index -lt $lines.Count; $index += 1) {
    if ($lines[$index] -match $pattern) {
      $lines[$index] = $replacement
      $updated = $true
      break
    }
  }

  if (-not $updated) {
    $lines.Add($replacement)
  }

  Set-Content -LiteralPath $Path -Value $lines.ToArray() -Encoding ascii
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

function Get-ProductionN8nProbeUrls {
  $port = Get-LocalN8nPort
  return @(
    "http://127.0.0.1:$port",
    "http://localhost:$port"
  )
}

function Test-ProductionN8nHttpReady {
  param(
    [int]$Attempts = 1,
    [int]$DelaySeconds = 0,
    [int]$TimeoutSeconds = 3
  )

  for ($attempt = 1; $attempt -le $Attempts; $attempt += 1) {
    foreach ($url in (Get-ProductionN8nProbeUrls)) {
      try {
        $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec $TimeoutSeconds
        return ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500)
      } catch {
        if ($_.Exception.Response) {
          return $true
        }
      }
    }

    if ($attempt -lt $Attempts -and $DelaySeconds -gt 0) {
      Start-Sleep -Seconds $DelaySeconds
    }
  }
  return $false
}

function Get-ProductionN8nRecentLogLines {
  param([int]$Tail = 80)

  $result = Invoke-ComposeCapture -Arguments @('logs', '--tail', ([string]$Tail), 'n8n')
  return @($result.Output)
}

function Test-ProductionN8nEncryptionKeyMismatchLog {
  param([string[]]$LogLines)

  $text = (($LogLines | Select-Object -Last 80) -join "`n")
  return ($text -match 'Mismatching encryption keys' -or $text -match 'settings file .*/home/node/\.n8n/config.*N8N_ENCRYPTION_KEY')
}

function Test-ProductionN8nDatabaseImageMismatchLog {
  param([string[]]$LogLines)

  $text = (($LogLines | Select-Object -Last 80) -join "`n")
  return ($text -match 'McpRegistryServerEntity\.id does not exist' -or $text -match 'different migration states' -or $text -match 'Migration timestamp mismatch')
}

function Wait-ForProductionN8nReady {
  param([string]$Context = 'production n8n startup')

  Write-Info "Waiting for n8n editor to respond at $(Get-LocalN8nUrl)."
  $readyStreak = 0
  for ($attempt = 1; $attempt -le 20; $attempt += 1) {
    if (Test-ProductionN8nHttpReady) {
      $readyStreak += 1
      if ($readyStreak -ge 3) {
        $logs = @(Get-ProductionN8nRecentLogLines -Tail 60)
        if (-not (Test-ProductionN8nDatabaseImageMismatchLog -LogLines $logs) -and -not (Test-ProductionN8nEncryptionKeyMismatchLog -LogLines $logs)) {
          Write-Success 'n8n editor is responding and stayed reachable.'
          return $true
        }
        break
      }
    } else {
      $readyStreak = 0
    }
    Start-Sleep -Seconds 2
  }

  $logs = @(Get-ProductionN8nRecentLogLines)
  Write-ErrorMessage "$Context did not produce a reachable n8n editor at $(Get-LocalN8nUrl)."
  if (Test-ProductionN8nEncryptionKeyMismatchLog -LogLines $logs) {
    Write-ErrorMessage 'Recent logs show mismatching encryption keys between /home/node/.n8n/config and N8N_ENCRYPTION_KEY.'
    Write-Info 'Use View logs for details. If this continues, the restored data likely belongs to a different N8N_ENCRYPTION_KEY than the active .env.'
  } elseif (Test-ProductionN8nDatabaseImageMismatchLog -LogLines $logs) {
    Write-ErrorMessage 'Recent logs show a database schema / n8n image version mismatch.'
    Write-Info 'Restore can auto-apply N8N_IMAGE only when the backup .env includes it.'
    Write-Info 'Use a backup zip that includes SECRET-DO-NOT-COMMIT.env / .env with the source N8N_IMAGE, or set N8N_IMAGE manually to the source n8n image and retry.'
  } else {
    Write-Info 'Use View logs to inspect the n8n startup error.'
  }
  return $false
}

function Normalize-N8nUrl {
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

function Get-CloudflareN8nUrl {
  param([hashtable]$Values = $null)

  if ($null -eq $Values) {
    $Values = Read-EnvFile
  }
  return (Normalize-N8nUrl -Url (Get-EnvValue -Name 'N8N_PUBLIC_URL' -Values $Values))
}

function Get-ActiveWebhookUrl {
  $activePath = Join-Path $script:StackRoot '.env.active'
  if (Test-Path -LiteralPath $activePath -PathType Leaf) {
    foreach ($line in Get-Content -LiteralPath $activePath) {
      if ($line -match '^\s*WEBHOOK_URL\s*=\s*(.*)\s*$') {
        return (Normalize-N8nUrl -Url $Matches[1].Trim().Trim('"').Trim("'"))
      }
    }
  }
  return ''
}

function Set-ActiveN8nUrl {
  param(
    [string]$Url,
    [string]$Mode,
    [string]$HostName = ''
  )

  $activeUrl = Normalize-N8nUrl -Url $Url
  if (-not $activeUrl) {
    Write-ErrorMessage 'Cannot choose an empty n8n URL.'
    return $false
  }

  try {
    $uri = [Uri]$activeUrl
  } catch {
    Write-ErrorMessage "Cannot parse n8n URL: $activeUrl"
    return $false
  }

  if (-not $HostName) {
    $HostName = $uri.Host
  }

  $activePath = Join-Path $script:StackRoot '.env.active'
  $content = @(
    '# Generated by _n8n-production-cloudflare.cmd. Do not edit by hand.',
    "# Active mode: $Mode",
    "WEBHOOK_URL=$activeUrl",
    "N8N_EDITOR_BASE_URL=$activeUrl",
    "N8N_HOST=$HostName",
    "N8N_PROTOCOL=$($uri.Scheme)"
  )

  Set-Content -LiteralPath $activePath -Value $content -Encoding ascii
  Write-Info "Active n8n URL is now $activeUrl"
  return $true
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
      Write-Warning 'N8N_ENCRYPTION_KEY is missing or still a placeholder. The launcher allows this, but replace it before saving credentials you care about.'
    } else {
      Write-Success 'N8N_ENCRYPTION_KEY is set'
    }
  }

  $postgresPassword = Get-EnvValue -Name 'POSTGRES_PASSWORD' -Values $values
  if (-not $FromCloudflarePreflight) {
    if (Test-PlaceholderValue -Value $postgresPassword) {
      Write-Warning 'POSTGRES_PASSWORD is missing or still a placeholder. The launcher allows this, but replace it before saving production data you care about.'
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
  if (Test-PlaceholderValue -Value $n8nKey) {
    Write-Warning 'N8N_ENCRYPTION_KEY is missing or still a placeholder. The launcher allows this, but replace it before saving credentials you care about.'
  } else {
    Write-Success 'N8N_ENCRYPTION_KEY is set'
  }

  $postgresPassword = Get-EnvValue -Name 'POSTGRES_PASSWORD' -Values $values
  if (Test-PlaceholderValue -Value $postgresPassword) {
    Write-Warning 'POSTGRES_PASSWORD is missing or still a placeholder. The launcher allows this, but replace it before saving production data you care about.'
  } else {
    Write-Success 'POSTGRES_PASSWORD is set'
  }

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
  $values = Read-EnvFile
  if (-not (Set-ActiveN8nUrl -Url (Get-LocalN8nUrl -Values $values) -Mode 'localhost' -HostName 'localhost')) { return }
  if ((Invoke-Compose -Arguments @('up', '-d', 'postgres', 'n8n')) -ne 0) { return }
  if (-not (Wait-ForProductionN8nReady -Context 'Production localhost n8n start')) { return }
  Write-Success "Local editor: $(Get-LocalN8nUrl -Values $values)"
  Write-Info 'For public Cloudflare access, fill the Cloudflare values in .env, then use Start Cloudflare tunnel.'
}

function Start-LocalhostOnly {
  Start-ProductionStack

  $runningServices = Get-RunningServices
  if ($runningServices -contains 'cloudflared') {
    Write-Warning 'Cloudflare tunnel is running. Stopping it so n8n is localhost only.'
    [void](Invoke-Compose -Arguments @('stop', 'cloudflared'))
  }
}

function Start-N8nWithCloudflare {
  Write-Header 'Start n8n With Cloudflare Tunnel'
  if (-not (Invoke-BasePreflight)) { return }
  if (-not (Test-DockerReady)) { return }

  $runningServices = Get-RunningServices
  if ($runningServices -contains 'n8n') {
    Write-Success 'n8n is already running. It will be recreated so current non-image .env values are applied.'
  } else {
    Write-Info 'n8n is not running yet. It will be started with the tunnel after checks finish.'
  }

  if ($runningServices -contains 'cloudflared') {
    Write-Success 'Cloudflare tunnel is already running. Current .env values will still be applied.'
  }

  Write-Info 'Starting or refreshing Cloudflare tunnel now.'
  Start-CloudflareTunnel
}

function Start-CloudflareTunnel {
  Write-Header 'Start Cloudflare Tunnel'
  if (-not (Invoke-SafetyPreflight)) { return }
  if (-not (Test-DockerReady)) { return }
  $values = Read-EnvFile
  $publicUrl = Get-CloudflareN8nUrl -Values $values
  $publicHost = Get-EnvValue -Name 'N8N_PUBLIC_HOST' -Values $values
  if (-not (Set-ActiveN8nUrl -Url $publicUrl -Mode 'cloudflare' -HostName $publicHost)) { return }
  if ((Invoke-Compose -Arguments @('up', '-d', '--force-recreate', 'n8n', 'cloudflared')) -ne 0) { return }
  if (-not (Wait-ForProductionN8nReady -Context 'Production Cloudflare n8n start')) { return }
  Write-Success 'n8n and Cloudflare tunnel started. n8n was recreated so current non-image .env values are applied.'
  Write-Host ''
  Write-Host "Public URL should be: $publicUrl" -ForegroundColor DarkYellow
}

function Stop-ProductionStack {
  Write-Header 'Stop n8n'
  if (-not (Test-DockerReady)) { return }
  [void](Invoke-Compose -Arguments @('down'))
}

function Stop-CloudflareTunnel {
  Write-Header 'Stop Cloudflare Tunnel'
  if (-not (Test-DockerReady)) { return }

  $wasN8nRunning = (Get-RunningServices) -contains 'n8n'
  [void](Invoke-Compose -Arguments @('stop', 'cloudflared'))

  $values = Read-EnvFile
  if (-not (Set-ActiveN8nUrl -Url (Get-LocalN8nUrl -Values $values) -Mode 'localhost' -HostName 'localhost')) {
    return
  }

  if ($wasN8nRunning) {
    Write-Info 'Recreating n8n so WEBHOOK_URL is now local.'
    [void](Invoke-Compose -Arguments @('up', '-d', '--pull', 'never', '--force-recreate', 'n8n'))
  }

  Write-Success 'Cloudflare tunnel stopped. Your Cloudflare tunnel and DNS route were not deleted.'
}

function Restart-N8n {
  Write-Header 'Restart n8n'
  if (-not (Invoke-BasePreflight)) { return }
  if (-not (Test-DockerReady)) { return }
  $values = Read-EnvFile
  if (-not (Set-ActiveN8nUrl -Url (Get-LocalN8nUrl -Values $values) -Mode 'localhost' -HostName 'localhost')) { return }
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
  }
  $backupPath = Join-Path $BackupDir 'database.sql'
  $containerBackupPath = "/tmp/n8n-production-backup-$timestamp.sql"

  New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
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

  $readmePath = Join-Path $BackupDir 'README-PRIVATE.txt'
  Set-Content -LiteralPath $readmePath -Encoding ascii -Value @(
    'Private production n8n Postgres backup.',
    '',
    'Keep this backup private. Do not commit it.',
    'database.sql contains the full n8n database state for this stack.',
    'SECRET-DO-NOT-COMMIT.env is a private copy of the backup .env when available.',
    'Saved credentials require the same N8N_ENCRYPTION_KEY that created the backup.'
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

function Get-ProductionBackupDefaultRoot {
  return (Join-Path $script:StackRoot 'backups')
}

function Get-ProductionBackupConfigPath {
  return (Join-Path (Get-ProductionBackupDefaultRoot) 'production-cloudflare-backup-config.json')
}

function Convert-ProductionBackupDayValue {
  param(
    [string]$Value,
    [string]$Name,
    [int]$Min = 1,
    [int]$Max = 3650
  )

  $text = ([string]$Value).Trim()
  if (-not $text) {
    return [pscustomobject]@{ Ok = $false; Error = "$Name is required."; Value = 0 }
  }

  $days = 0
  if (-not [int]::TryParse($text, [ref]$days)) {
    return [pscustomobject]@{ Ok = $false; Error = "$Name must be a whole number."; Value = 0 }
  }

  if ($days -lt $Min -or $days -gt $Max) {
    return [pscustomobject]@{ Ok = $false; Error = "$Name must be between $Min and $Max days."; Value = 0 }
  }

  return [pscustomobject]@{ Ok = $true; Error = ''; Value = $days }
}

function Read-ProductionBackupDayInput {
  param(
    [string]$Prompt,
    [int]$Default,
    [string]$Name
  )

  while ($true) {
    $value = (Read-Host "$Prompt [$Default]").Trim()
    if (-not $value) {
      $value = [string]$Default
    }

    $parsed = Convert-ProductionBackupDayValue -Value $value -Name $Name
    if ($parsed.Ok) {
      return $parsed.Value
    }

    Write-Warning $parsed.Error
  }
}

function Read-ProductionBackupRecommendedInput {
  param(
    [string]$Prompt,
    [string]$DefaultText
  )

  return (Read-Host "$Prompt [$DefaultText]")
}

function Get-ProductionBackupTaskName {
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes([System.IO.Path]::GetFullPath($script:StackRoot).ToLowerInvariant())
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $hash = [System.BitConverter]::ToString($sha.ComputeHash($bytes)).Replace('-', '').ToLowerInvariant()
    return "$($script:ProductionBackupTaskPrefix)-$($hash.Substring(0, 12))"
  } catch {
    return $script:ProductionBackupTaskPrefix
  }
}

function Get-ProductionBackupScriptPath {
  return (Join-Path $script:StackRoot 'scripts\n8n-production-cloudflare-menu.ps1')
}

function Get-ProductionBackupScheduleActionArguments {
  $scriptPath = Get-ProductionBackupScriptPath
  return "-NoProfile -ExecutionPolicy Bypass -File `"$scriptPath`" --stack-dir `"$script:StackRoot`" --run-production-backup --scheduled"
}

function Read-ProductionBackupConfig {
  $configPath = Get-ProductionBackupConfigPath
  if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
    return $null
  }

  try {
    return (Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json)
  } catch {
    Write-ErrorMessage "Could not read automatic backup config: $($_.Exception.Message)"
    return $null
  }
}

function Test-ProductionBackupAutomaticEnabled {
  param([object]$Config)
  return ($null -ne $Config -and [bool]$Config.enabled -and [string]$Config.taskName)
}

function Write-ProductionBackupAutomaticStatus {
  param([object]$Config)

  Write-Host 'Automatic backups: ' -NoNewline -ForegroundColor DarkCyan
  if (-not (Test-ProductionBackupAutomaticEnabled -Config $Config)) {
    Write-Host 'Not set up' -ForegroundColor Yellow
    return
  }

  $scheduledTime = 'around 3:00 AM local time'
  if ($Config.scheduledTime) {
    $scheduledTime = [string]$Config.scheduledTime
  }

  Write-Host 'Enabled' -ForegroundColor Green
  Write-Host "  Cadence: every $($Config.cadenceDays) day(s)" -ForegroundColor Cyan
  Write-Host "  Retention: $($Config.retentionDays) day(s)" -ForegroundColor Cyan
  Write-Host "  Task: $($Config.taskName)" -ForegroundColor Cyan
  Write-Host "  Destination: $($Config.backupRoot)" -ForegroundColor Cyan
  Write-Host "  Scheduled time: $scheduledTime" -ForegroundColor Cyan
}

function Save-ProductionBackupConfig {
  param([object]$Config)

  $configPath = Get-ProductionBackupConfigPath
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $configPath) | Out-Null
  $Config | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $configPath -Encoding ascii
  Write-Success "Automatic backup config saved to: $configPath"
}

function New-ProductionBackupConfigFromPrompts {
  Write-Header 'Automatic Backup Settings'
  Write-Info 'Automatic production Cloudflare backups create restore-compatible zip packages.'
  Write-Warning 'Scheduled backups only run when Windows Task Scheduler, Docker Desktop, and this production stack are available.'

  $cadenceDays = Read-ProductionBackupDayInput -Prompt 'Backup cadence in days' -Default 1 -Name 'Backup cadence'
  $defaultRetentionDays = Get-ProductionBackupRetentionDays
  if ($null -eq $defaultRetentionDays) {
    $defaultRetentionDays = 30
  }
  $retentionDays = Read-ProductionBackupDayInput -Prompt 'Retention period in days' -Default $defaultRetentionDays -Name 'Retention period'

  $defaultRoot = Get-ProductionBackupDefaultRoot
  while ($true) {
    $backupRoot = (Read-ProductionBackupRecommendedInput -Prompt 'Backup destination' -DefaultText $defaultRoot).Trim().Trim('"')
    if (-not $backupRoot) {
      $backupRoot = $defaultRoot
    }

    $safeRoot = Test-ProductionBackupRoot -Path $backupRoot
    if ($safeRoot.Ok) {
      $backupRoot = $safeRoot.Path
      break
    }

    Write-Warning $safeRoot.Error
  }

  $taskName = Get-ProductionBackupTaskName

  return [ordered]@{
    enabled = $true
    scheduler = 'Windows Task Scheduler'
    taskName = $taskName
    cadenceDays = $cadenceDays
    retentionDays = $retentionDays
    backupRoot = $backupRoot
    backupMode = 'production-cloudflare-postgres-package'
    scheduledTime = 'around 3:00 AM local time'
    configuredAt = (Get-Date -Format o)
  }
}

function Register-ProductionBackupSchedule {
  param([object]$Config)

  if (-not (Get-Command Register-ScheduledTask -ErrorAction SilentlyContinue)) {
    Write-ErrorMessage 'Windows Task Scheduler cmdlets are not available in this PowerShell session.'
    Write-Info 'The config was not scheduled. Use Back up now from this menu instead.'
    return $false
  }

  $taskName = [string]$Config.taskName
  if (-not $taskName) {
    $taskName = Get-ProductionBackupTaskName
  }

  $actionArgs = Get-ProductionBackupScheduleActionArguments
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $actionArgs
  $trigger = New-ScheduledTaskTrigger -Daily -DaysInterval ([int]$Config.cadenceDays) -At 3am
  $description = "Production Cloudflare n8n backup packages for stack: $script:StackRoot"

  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Description $description -Force | Out-Null
  Write-Success "Scheduled task created or updated: $taskName"
  Write-Info 'Backups run around 3:00 AM local time on the configured cadence when the production stack is available.'
  return $true
}

function Configure-ProductionBackupSchedule {
  $config = New-ProductionBackupConfigFromPrompts
  if ($null -eq $config) {
    return $false
  }

  if (-not (Register-ProductionBackupSchedule -Config $config)) {
    return $false
  }

  Save-ProductionBackupConfig -Config $config
  return $true
}

function Test-ProductionBackupRoot {
  param([string]$Path)

  try {
    $resolved = [System.IO.Path]::GetFullPath($Path)
    $stack = [System.IO.Path]::GetFullPath($script:StackRoot)
    $userProfileRoot = [System.IO.Path]::GetFullPath([Environment]::GetFolderPath('UserProfile'))
  } catch {
    return [pscustomobject]@{ Ok = $false; Path = ''; Error = $_.Exception.Message }
  }

  if ($resolved -eq [System.IO.Path]::GetPathRoot($resolved)) {
    return [pscustomobject]@{ Ok = $false; Path = $resolved; Error = 'Refusing to use a drive root as the backup root.' }
  }
  if ($resolved.TrimEnd('\') -eq $stack.TrimEnd('\')) {
    return [pscustomobject]@{ Ok = $false; Path = $resolved; Error = 'Refusing to use the stack root itself as the backup root.' }
  }
  if ($userProfileRoot -and $resolved.TrimEnd('\') -eq $userProfileRoot.TrimEnd('\')) {
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

function Enable-ZipSupport {
  try {
    Add-Type -AssemblyName System.IO.Compression -ErrorAction Stop
    Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop
  } catch {
  }
}

function New-ZipPackageFromDirectory {
  param(
    [string]$SourceDir,
    [string]$ZipPath,
    [string[]]$ExcludeLeafNames = @()
  )

  Enable-ZipSupport
  if (Test-Path -LiteralPath $ZipPath) {
    Remove-Item -LiteralPath $ZipPath -Force
  }

  $sourceRoot = [System.IO.Path]::GetFullPath($SourceDir)
  if (-not $sourceRoot.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
    $sourceRoot = $sourceRoot + [System.IO.Path]::DirectorySeparatorChar
  }
  $resolvedZipPath = [System.IO.Path]::GetFullPath($ZipPath)
  $excluded = @{}
  foreach ($name in $ExcludeLeafNames) {
    $leaf = ([string]$name).Trim().ToLowerInvariant()
    if ($leaf) {
      $excluded[$leaf] = $true
    }
  }

  $zip = [System.IO.Compression.ZipFile]::Open($resolvedZipPath, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    $files = @(
      Get-ChildItem -LiteralPath $SourceDir -File -Recurse -ErrorAction SilentlyContinue |
        Sort-Object FullName
    )
    foreach ($file in $files) {
      $fullPath = [System.IO.Path]::GetFullPath($file.FullName)
      if ($fullPath -ieq $resolvedZipPath) { continue }
      if ($excluded.ContainsKey($file.Name.ToLowerInvariant())) { continue }
      $entryName = ($fullPath.Substring($sourceRoot.Length) -replace '\\', '/')
      [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $fullPath, $entryName, [System.IO.Compression.CompressionLevel]::Optimal)
    }
  } finally {
    $zip.Dispose()
  }

  if (-not (Test-Path -LiteralPath $ZipPath -PathType Leaf)) {
    Write-ErrorMessage "Zip package was not created: $ZipPath"
    return ''
  }

  return $ZipPath
}

function Convert-ProductionBackupFolderToZipPackage {
  param(
    [string]$BackupDir,
    [string]$ZipFileName
  )

  $zipPath = Join-Path $BackupDir $ZipFileName
  $createdZip = New-ZipPackageFromDirectory -SourceDir $BackupDir -ZipPath $zipPath
  if (-not $createdZip) {
    return ''
  }

  Get-ChildItem -LiteralPath $BackupDir -Force -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -ne (Split-Path -Leaf $zipPath) } |
    ForEach-Object {
      Remove-Item -LiteralPath $_.FullName -Recurse -Force
    }

  Write-Success "Backup zip package: $zipPath"
  return $zipPath
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

function Get-ZipEntryNames {
  param([string]$ZipPath)

  Enable-ZipSupport
  $zip = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
  try {
    $names = New-Object System.Collections.Generic.List[string]
    foreach ($entry in $zip.Entries) {
      if ($entry.FullName) {
        $names.Add(($entry.FullName -replace '\\', '/'))
      }
    }
    return $names.ToArray()
  } finally {
    $zip.Dispose()
  }
}

function Get-RestoreZipLimits {
  return [pscustomobject]@{
    MaxFiles = 1000
    MaxCompressedBytes = 268435456
    MaxEntryBytes = 134217728
    MaxTotalBytes = 536870912
    MaxCompressionRatio = 100
  }
}

function Test-RestoreZipEntryLimits {
  param([object]$Zip)

  $limits = Get-RestoreZipLimits
  $fileCount = 0
  $totalCompressedBytes = [int64]0
  $totalBytes = [int64]0

  foreach ($entry in $Zip.Entries) {
    if (-not $entry.FullName) { continue }
    $entryName = ($entry.FullName -replace '\\', '/')
    if ($entryName.EndsWith('/')) { continue }

    $fileCount += 1
    if ($fileCount -gt $limits.MaxFiles) {
      return [pscustomobject]@{ Error = "Zip restore package contains too many files. Limit: $($limits.MaxFiles)." }
    }

    if ($entry.Length -gt $limits.MaxEntryBytes) {
      return [pscustomobject]@{ Error = "Zip restore package contains an entry larger than the allowed restore limit. Limit: $($limits.MaxEntryBytes) bytes." }
    }

    $totalBytes += [int64]$entry.Length
    if ($totalBytes -gt $limits.MaxTotalBytes) {
      return [pscustomobject]@{ Error = "Zip restore package expands beyond the allowed restore limit. Limit: $($limits.MaxTotalBytes) bytes." }
    }

    if ($entry.CompressedLength -gt 0) {
      $totalCompressedBytes += [int64]$entry.CompressedLength
      $ratio = ([double]$entry.Length / [double]$entry.CompressedLength)
      if ($ratio -gt $limits.MaxCompressionRatio) {
        return [pscustomobject]@{ Error = "Zip restore package contains an entry with an unsafe compression ratio. Limit: $($limits.MaxCompressionRatio):1." }
      }
    } elseif ($entry.Length -gt 0) {
      return [pscustomobject]@{ Error = 'Zip restore package contains a compressed entry with no recorded compressed size.' }
    }

    if ($totalCompressedBytes -gt $limits.MaxCompressedBytes) {
      return [pscustomobject]@{ Error = "Zip restore package compressed data is too large. Limit: $($limits.MaxCompressedBytes) bytes." }
    }
  }

  return [pscustomobject]@{ Ok = $true }
}

function New-ProductionRestoreStagingDirectory {
  $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $unique = [guid]::NewGuid().ToString('N').Substring(0, 8)
  $importRoot = Join-Path $script:StackRoot 'import'
  $stagingDir = Join-Path $importRoot "production-restore-$timestamp-$unique"
  New-Item -ItemType Directory -Force -Path $stagingDir | Out-Null
  return $stagingDir
}

function Get-ProductionRestoreEntityFileNames {
  return @(
    'workflowentity.jsonl',
    'credentialsentity.jsonl',
    'settings.jsonl',
    'project.jsonl',
    'user.jsonl',
    'tagentity.jsonl',
    'workflowtagmapping.jsonl',
    'sharedworkflow.jsonl',
    'sharedcredentials.jsonl'
  )
}

function Test-ProductionRestoreEntityFileName {
  param([string]$Name)

  $leaf = (Split-Path -Leaf ([string]$Name)).ToLowerInvariant()
  return ((Get-ProductionRestoreEntityFileNames) -contains $leaf)
}

function Find-ProductionRestoreEntityDirectory {
  param([string]$Root)

  $entityFiles = @(
    Get-ChildItem -LiteralPath $Root -File -Recurse -ErrorAction SilentlyContinue |
      Where-Object { Test-ProductionRestoreEntityFileName -Name $_.Name }
  )

  if ($entityFiles.Count -eq 0) {
    return ''
  }

  $bestMatch = @(
    $entityFiles |
      Group-Object -Property DirectoryName |
      Sort-Object -Property Count -Descending |
      Select-Object -First 1
  )

  if ($bestMatch.Count -eq 0) {
    return ''
  }

  return $bestMatch[0].Name
}

function New-ProductionRestoreEntityImportDirectory {
  param(
    [string]$EntityDir,
    [string]$StagingDir
  )

  $importDir = Join-Path $StagingDir 'entities-import'
  New-Item -ItemType Directory -Force -Path $importDir | Out-Null
  $zipSourceDir = Join-Path $StagingDir 'entities-zip-source'
  New-Item -ItemType Directory -Force -Path $zipSourceDir | Out-Null

  $importFiles = @(
    Get-ChildItem -LiteralPath $EntityDir -File -ErrorAction SilentlyContinue |
      Where-Object { $_.Name.ToLowerInvariant().EndsWith('.jsonl') }
  )

  $hasMigrationsFile = @($importFiles | Where-Object { $_.Name -ieq 'migrations.jsonl' }).Count -gt 0
  if (-not $hasMigrationsFile) {
    return ''
  }

  $hasWorkflowsTagsFile = @($importFiles | Where-Object { $_.Name -ieq 'workflows_tags.jsonl' }).Count -gt 0
  $copiedCount = 0
  foreach ($file in $importFiles) {
    if ($hasWorkflowsTagsFile -and $file.Name -ieq 'workflowtagmapping.jsonl') {
      Write-Warning 'Skipping workflowtagmapping.jsonl because workflows_tags.jsonl is also present; both files import into the workflows_tags table.'
      continue
    }

    Copy-Item -LiteralPath $file.FullName -Destination (Join-Path $zipSourceDir $file.Name) -Force
    $copiedCount += 1
  }

  $zipPath = Join-Path $importDir 'entities.zip'
  if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
  }

  [System.IO.Compression.ZipFile]::CreateFromDirectory($zipSourceDir, $zipPath)
  Write-Info "Rebuilt clean entities.zip with $copiedCount JSONL file(s)."
  return $importDir
}

function Expand-ProductionRestoreEntitiesZipToStaging {
  param(
    [string]$ZipPath,
    [int]$Depth = 0
  )

  $stagingDir = New-ProductionRestoreStagingDirectory
  $stagingRoot = [System.IO.Path]::GetFullPath($stagingDir)

  Enable-ZipSupport
  $zip = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
  try {
    $limitCheck = Test-RestoreZipEntryLimits -Zip $zip
    if ($limitCheck.Error) {
      return [pscustomobject]@{ Error = $limitCheck.Error }
    }

    foreach ($entry in $zip.Entries) {
      if (-not $entry.FullName) { continue }
      $entryName = ($entry.FullName -replace '\\', '/')
      if ($entryName.StartsWith('/') -or $entryName -match '^[A-Za-z]:') {
        return [pscustomobject]@{ Error = 'Zip restore package contains an unsafe absolute path entry.' }
      }

      $targetPath = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($stagingRoot, $entryName))
      if (-not (Test-PathInsideDirectory -Path $targetPath -Directory $stagingRoot)) {
        return [pscustomobject]@{ Error = 'Zip restore package contains an unsafe path traversal entry.' }
      }
    }

    foreach ($entry in $zip.Entries) {
      if (-not $entry.FullName) { continue }
      $entryName = ($entry.FullName -replace '\\', '/')
      $targetPath = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($stagingRoot, $entryName))
      if ($entryName.EndsWith('/')) {
        New-Item -ItemType Directory -Force -Path $targetPath | Out-Null
        continue
      }

      $targetDir = Split-Path -Parent $targetPath
      if ($targetDir) {
        New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
      }
      [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $targetPath, $true)
    }
  } finally {
    $zip.Dispose()
  }

  $entityDir = Find-ProductionRestoreEntityDirectory -Root $stagingDir
  if (-not $entityDir) {
    if ($Depth -lt 3) {
      $nestedZips = @(
        Get-ChildItem -LiteralPath $stagingDir -File -Recurse -Filter '*.zip' -ErrorAction SilentlyContinue |
          Sort-Object FullName
      )
      foreach ($nestedZip in $nestedZips) {
        Write-Info "Trying nested entity zip: $($nestedZip.FullName)"
        $nestedExpanded = Expand-ProductionRestoreEntitiesZipToStaging -ZipPath $nestedZip.FullName -Depth ($Depth + 1)
        if (-not $nestedExpanded.Error) {
          return $nestedExpanded
        }
      }
    }
    return [pscustomobject]@{ Error = 'Zip restore package did not contain n8n export:entities output files.' }
  }

  $importDir = New-ProductionRestoreEntityImportDirectory -EntityDir $entityDir -StagingDir $stagingDir
  if (-not $importDir) {
    return [pscustomobject]@{ Error = 'Zip restore package did not contain migrations.jsonl in the detected n8n entity export directory.' }
  }

  Write-Info "Backup zip extracted under: $stagingDir"
  Write-Info 'Using a clean entities.zip rebuilt from all extracted n8n entity JSONL files.'
  return [pscustomobject]@{
    StagingPath = $stagingDir
    EntityDir = $importDir
    SourceEntityDir = $entityDir
  }
}

function Expand-ProductionRestorePackageZipToStaging {
  param([string]$ZipPath)

  $stagingDir = New-ProductionRestoreStagingDirectory
  $stagingRoot = [System.IO.Path]::GetFullPath($stagingDir)

  Enable-ZipSupport
  $zip = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
  try {
    $limitCheck = Test-RestoreZipEntryLimits -Zip $zip
    if ($limitCheck.Error) {
      return [pscustomobject]@{ Error = $limitCheck.Error }
    }

    foreach ($entry in $zip.Entries) {
      if (-not $entry.FullName) { continue }
      $entryName = ($entry.FullName -replace '\\', '/')
      if ($entryName.StartsWith('/') -or $entryName -match '^[A-Za-z]:') {
        return [pscustomobject]@{ Error = 'Zip restore package contains an unsafe absolute path entry.' }
      }

      $targetPath = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($stagingRoot, $entryName))
      if (-not (Test-PathInsideDirectory -Path $targetPath -Directory $stagingRoot)) {
        return [pscustomobject]@{ Error = 'Zip restore package contains an unsafe path traversal entry.' }
      }
    }

    foreach ($entry in $zip.Entries) {
      if (-not $entry.FullName) { continue }
      $entryName = ($entry.FullName -replace '\\', '/')
      $targetPath = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($stagingRoot, $entryName))
      if ($entryName.EndsWith('/')) {
        New-Item -ItemType Directory -Force -Path $targetPath | Out-Null
        continue
      }

      $targetDir = Split-Path -Parent $targetPath
      if ($targetDir) {
        New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
      }
      [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $targetPath, $true)
    }
  } finally {
    $zip.Dispose()
  }

  $databaseSql = @(Get-ChildItem -LiteralPath $stagingDir -File -Recurse -Filter 'database.sql' -ErrorAction SilentlyContinue | Select-Object -First 1)
  if ($databaseSql.Count -eq 0) {
    return [pscustomobject]@{ Error = 'Zip restore package did not contain database.sql.' }
  }

  Write-Info "Backup zip extracted under: $stagingDir"
  Write-Info 'Using database.sql from the production restore-compatible backup package.'
  return [pscustomobject]@{
    StagingPath = $stagingDir
    DatabaseSqlPath = $databaseSql[0].FullName
  }
}

function Get-ProductionRestoreBackupType {
  param([string]$Path)

  $inputPath = ([string]$Path).Trim().Trim('"')
  if (-not $inputPath) {
    return [pscustomobject]@{ Type = 'unsupported'; Label = 'missing input'; Reason = 'No backup path was provided.' }
  }

  if (-not (Test-Path -LiteralPath $inputPath)) {
    return [pscustomobject]@{ Type = 'unsupported'; Label = 'missing input'; Reason = 'Backup path does not exist.' }
  }

  $item = Get-Item -LiteralPath $inputPath
  if ($item.PSIsContainer) {
    return [pscustomobject]@{ Type = 'unsupported'; Label = 'unsupported restore folder'; Reason = 'Please select a .zip backup package.' }
  }

  $name = $item.Name.ToLowerInvariant()
  if ($name -match '\.zip$') {
    $entries = @(Get-ZipEntryNames -ZipPath $item.FullName)
    $hasDatabaseSql = @($entries | Where-Object { (Split-Path -Leaf $_).ToLowerInvariant() -eq 'database.sql' }).Count -gt 0
    $hasRestoreManifest = @($entries | Where-Object { (Split-Path -Leaf $_).ToLowerInvariant() -eq 'restore-manifest.json' }).Count -gt 0
    $hasEntities = @($entries | Where-Object { Test-ProductionRestoreEntityFileName -Name $_ }).Count -gt 0
    $hasMigrations = @($entries | Where-Object { (Split-Path -Leaf $_).ToLowerInvariant() -eq 'migrations.jsonl' }).Count -gt 0
    $hasCredentialEntities = @($entries | Where-Object { (Split-Path -Leaf $_).ToLowerInvariant() -eq 'credentialsentity.jsonl' }).Count -gt 0
    $hasNestedZip = @($entries | Where-Object { (Split-Path -Leaf $_).ToLowerInvariant().EndsWith('.zip') }).Count -gt 0

    if ($hasDatabaseSql) {
      $label = 'production backup zip package'
      if (-not $hasRestoreManifest) {
        Write-Warning 'Zip package contains database.sql but is missing restore-manifest.json. Continuing with database.sql restore.'
        $label = 'production backup zip package without manifest'
      }
      return [pscustomobject]@{ Type = 'postgres-package-zip'; Label = $label; InputPath = $item.FullName; NeedsPackageStaging = $true }
    }
    if ($hasEntities -and $hasMigrations) {
      return [pscustomobject]@{ Type = 'zip-package'; Label = 'n8n entity export zip'; InputPath = $item.FullName; NeedsStaging = $true; HasCredentialEntities = $hasCredentialEntities }
    }
    if ($hasEntities -and -not $hasMigrations) {
      return [pscustomobject]@{ Type = 'unsupported'; Label = 'incomplete entity zip'; Reason = 'Entity zip contains n8n JSONL files but is missing migrations.jsonl, which n8n import:entities requires.' }
    }
    if ($hasNestedZip) {
      return [pscustomobject]@{ Type = 'zip-package'; Label = 'zip backup package with nested entity zip'; InputPath = $item.FullName; NeedsStaging = $true; HasCredentialEntities = $true }
    }

    Write-Warning 'Unknown zip backup. Filename-level detection found these entries:'
    foreach ($entryName in $entries) {
      Write-Warning "  $entryName"
    }
    return [pscustomobject]@{ Type = 'unsupported'; Label = 'unknown zip'; Reason = 'Zip package contained no database.sql and no supported n8n entity JSONL files to import.' }
  }

  return [pscustomobject]@{ Type = 'unsupported'; Label = 'unsupported file type'; Reason = 'Please select a .zip backup package.' }
}

function Prepare-ProductionRestoreBackupInput {
  param([string]$Path)

  $detected = Get-ProductionRestoreBackupType -Path $Path
  if ($detected.NeedsPackageStaging) {
    $expanded = Expand-ProductionRestorePackageZipToStaging -ZipPath $detected.InputPath
    if ($expanded.Error) {
      return [pscustomobject]@{ Type = 'unsupported'; Label = 'unsupported zip'; Reason = $expanded.Error }
    }
    $packageDetected = [pscustomobject]@{
      Type = 'postgres-sql'
      Label = 'production backup zip package'
      InputPath = $expanded.DatabaseSqlPath
      HasCredentialEntities = $false
    }
    $packageDetected | Add-Member -NotePropertyName StagingPath -NotePropertyValue $expanded.StagingPath -Force
    $detected = $packageDetected
  }

  if ($detected.NeedsStaging) {
    $expanded = Expand-ProductionRestoreEntitiesZipToStaging -ZipPath $detected.InputPath
    if ($expanded.Error) {
      return [pscustomobject]@{ Type = 'unsupported'; Label = 'unsupported zip'; Reason = $expanded.Error }
    }
    $stagingDetected = [pscustomobject]@{
      Type = 'n8n-entities'
      Label = 'n8n entities backup'
      InputDir = $expanded.EntityDir
      SourceEntityDir = $expanded.SourceEntityDir
      HasCredentialEntities = $detected.HasCredentialEntities
    }
    $stagingDetected | Add-Member -NotePropertyName StagingPath -NotePropertyValue $expanded.StagingPath -Force
    $detected = $stagingDetected
  }

  return $detected
}

function Write-ProductionBackupRestoreNotes {
  param([string]$BackupDir)

  Set-Content -LiteralPath (Join-Path $BackupDir 'HOW TO USE THIS RESTORE FOLDER.txt') -Encoding ascii -Value @(
    'How to use this restore folder',
    '',
    'Backup type: postgres-sql',
    '',
    'database.sql is the full n8n Postgres database backup for this stack.',
    'It contains workflows, encrypted credential records, settings, users/projects, and other database-backed n8n state.',
    '',
    'SECRET-DO-NOT-COMMIT.env is included inside the backup zip when available.',
    'Saved credentials require the same N8N_ENCRYPTION_KEY that created the backup.',
    '',
    'Open _n8n-production-cloudflare.cmd, choose Advanced / Recovery: Restore local n8n from backup, and paste the full path to the .zip file in this folder.',
    'Type PROCEED when asked.',
    'Restore replaces the current production Cloudflare n8n database state.',
    'Do not commit this folder, backup files, or SECRET-DO-NOT-COMMIT.env.'
  )
}

function Write-ProductionBackupSecretFile {
  param([string]$BackupDir)

  $sourceEnvPath = Join-Path $script:StackRoot '.env'
  if (-not (Test-Path -LiteralPath $sourceEnvPath -PathType Leaf)) {
    Write-Warning 'No .env file was found to include in the backup. Saved credentials may not decrypt after restore.'
    return ''
  }

  $values = Read-EnvFile
  $encryptionKey = Get-EnvValue -Name 'N8N_ENCRYPTION_KEY' -Values $values
  if (Test-PlaceholderValue -Value $encryptionKey) {
    Write-Warning 'N8N_ENCRYPTION_KEY is missing or still a placeholder, but the backup will include .env because existing saved credentials may depend on that exact value.'
  }

  $secretPath = Join-Path $BackupDir 'SECRET-DO-NOT-COMMIT.env'
  Copy-Item -LiteralPath $sourceEnvPath -Destination $secretPath -Force
  Write-Success "Private backup .env written to: $secretPath"
  return $secretPath
}

function Write-ProductionBackupManifest {
  param(
    [string]$BackupDir,
    [string]$Timestamp,
    [string]$Status,
    [string[]]$Errors = @(),
    [int]$RetentionDays = 30
  )

  $manifestPath = Join-Path $BackupDir 'restore-manifest.json'
  $files = @(Get-ProductionBackupFileList -BackupDir $BackupDir)
  $files = @($files + 'restore-manifest.json' | Sort-Object -Unique)
  $manifest = [ordered]@{
    template = 'n8n-production-cloudflare-menu.ps1'
    createdAt = (Get-Date -Format o)
    timestamp = $Timestamp
    status = $Status
    backupType = 'postgres-sql'
    stackRoot = $script:StackRoot
    retentionDays = $RetentionDays
    backupOptions = [ordered]@{
      includeWorkflows = $false
      includeCredentials = $false
      exportDecryptedCredentials = $false
      includeDatabase = $true
    }
    outputs = [ordered]@{
      database = 'database.sql'
      secretEnv = 'SECRET-DO-NOT-COMMIT.env'
      log = 'backup.log'
      restoreNotes = 'HOW TO USE THIS RESTORE FOLDER.txt'
    }
    filesGenerated = $files
    errors = @($Errors)
    warnings = @(
      'Keep this backup folder private and out of Git.',
      'database.sql is the full n8n Postgres database backup for this stack.',
      'Saved credentials require the original N8N_ENCRYPTION_KEY from SECRET-DO-NOT-COMMIT.env.'
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

function Backup-N8nProductionNow {
  param(
    [switch]$Required,
    [switch]$Scheduled
  )

  if ($Scheduled) {
    Write-Header 'Scheduled Back Up'
  } else {
    Write-Header 'Back Up Now'
  }
  if (-not (Invoke-BasePreflight)) { return $false }
  if (-not (Test-DockerReady)) { return $false }

  $config = Read-ProductionBackupConfig
  $automaticEnabled = Test-ProductionBackupAutomaticEnabled -Config $config
  if ($Scheduled -and -not $automaticEnabled) {
    Write-ErrorMessage 'No automatic backup config found. Choose Back up, then Set up automatic backups.'
    return $false
  }

  $backupRoot = Get-ProductionBackupDefaultRoot
  if ($automaticEnabled -and [string]$config.backupRoot) {
    $backupRoot = [string]$config.backupRoot
  }

  if ($automaticEnabled -and $config.retentionDays) {
    $retention = Convert-ProductionBackupDayValue -Value ([string]$config.retentionDays) -Name 'Retention period'
    if (-not $retention.Ok) {
      Write-ErrorMessage $retention.Error
      return $false
    }
    $retentionDays = $retention.Value
  } else {
    $retentionDays = Get-ProductionBackupRetentionDays
    if ($null -eq $retentionDays) { return $false }
  }

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
  $errors = New-Object System.Collections.Generic.List[string]

  New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
  Add-ProductionBackupLog -BackupDir $backupDir -Message "Starting production n8n backup in $backupDir"
  Write-Info 'Back up creates one restore-compatible Postgres database dump, writes restore notes, and applies retention cleanup.'
  Write-Info 'database.sql contains the full n8n database state, including workflows and encrypted credential records.'

  $ok = $true
  if (-not (Backup-Postgres -Required -BackupDir $backupDir -SkipPreflight)) {
    $errors.Add('Postgres database backup failed.')
    $ok = $false
  }

  if ($ok) {
    [void](Write-ProductionBackupSecretFile -BackupDir $backupDir)
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
  $zipPath = Convert-ProductionBackupFolderToZipPackage -BackupDir $backupDir -ZipFileName "n8n-production-$timestamp.zip"
  if (-not $zipPath) {
    Write-ErrorMessage 'Production backup zip package was not created.'
    if ($Required) { Write-ErrorMessage 'Required backup failed. No update was applied.' }
    return $false
  }
  [void](Invoke-ProductionBackupRetentionCleanup -BackupRoot $safeRoot.Path -RetentionDays $retentionDays)
  Write-Success "Backup package folder: $backupDir"
  Write-Success 'Manifest included in zip package.'
  Write-Warning 'Keep this backup private. Do not commit backups, logs, database dumps, or production .env files.'
  return $true
}

function Show-ProductionBackupMenu {
  Write-Header 'Back up'
  $config = Read-ProductionBackupConfig
  Write-ProductionBackupAutomaticStatus -Config $config
  Write-Host ''
  Write-Host 'Choose a backup action:' -ForegroundColor Cyan
  Write-Host '  1. Back up now'
  Write-Host '  2. Set up automatic backups'
  Write-Host '  3. Back'
  Write-Host ''

  $choice = (Read-Host 'Enter a number').Trim()
  switch ($choice) {
    '1' { [void](Backup-N8nProductionNow) }
    '2' { [void](Configure-ProductionBackupSchedule) }
    '3' { return }
    default { Write-Warning 'Choose a number from 1 to 3.' }
  }
}

function Test-ProductionPostgresSqlBackupFile {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    Write-ErrorMessage "Database restore file does not exist: $Path"
    return $false
  }

  $extension = [System.IO.Path]::GetExtension($Path)
  if ($extension -ne '.sql') {
    Write-ErrorMessage 'Production restore expected the staged database.sql extracted from a backup zip.'
    return $false
  }

  try {
    $sample = (Get-Content -LiteralPath $Path -TotalCount 40 -ErrorAction Stop) -join "`n"
  } catch {
    Write-ErrorMessage "Could not read database restore file: $($_.Exception.Message)"
    return $false
  }

  if ($sample -notmatch '(?i)(PostgreSQL database dump|CREATE TABLE|COPY\s+|INSERT INTO|SET\s+)') {
    Write-ErrorMessage 'The selected .sql file does not look like a Postgres SQL backup.'
    return $false
  }

  return $true
}

function Resolve-ProductionRestoreBackup {
  param([string]$Path)

  $detected = Prepare-ProductionRestoreBackupInput -Path $Path
  if ($detected.Type -eq 'unsupported') {
    return [pscustomobject]@{ Ok = $false; Path = ''; InputPath = ''; Label = ''; Type = 'unsupported'; Error = $detected.Reason }
  }

  if ($detected.Type -eq 'postgres-sql') {
    return [pscustomobject]@{ Ok = $true; Path = $detected.StagingPath; InputPath = $detected.InputPath; Label = $detected.Label; Type = $detected.Type; Error = ''; HasCredentialEntities = $false }
  }

  if ($detected.Type -eq 'n8n-entities') {
    return [pscustomobject]@{
      Ok = $true
      Path = $detected.StagingPath
      InputPath = ''
      InputDir = $detected.InputDir
      SourceEntityDir = $detected.SourceEntityDir
      Label = $detected.Label
      Type = $detected.Type
      Error = ''
      HasCredentialEntities = $detected.HasCredentialEntities
    }
  }

  return [pscustomobject]@{ Ok = $false; Path = ''; InputPath = ''; Label = ''; Type = 'unsupported'; Error = 'Unsupported production restore backup type after detection.' }
}

function Get-ProductionRestoreEnvBackupNames {
  return @('SECRET-DO-NOT-COMMIT.env', '.env')
}

function Test-SameResolvedPath {
  param(
    [string]$Left,
    [string]$Right
  )

  if (-not $Left -or -not $Right) {
    return $false
  }

  try {
    $trimChars = [char[]]@('\', '/')
    $leftPath = [System.IO.Path]::GetFullPath($Left).TrimEnd($trimChars)
    $rightPath = [System.IO.Path]::GetFullPath($Right).TrimEnd($trimChars)
    return ($leftPath -ieq $rightPath)
  } catch {
    return $false
  }
}

function Find-ProductionRestoreBackupEnvValue {
  param(
    [string]$Path,
    [string]$Name,
    [string]$TargetEnvPath = ''
  )

  $inputPath = ([string]$Path).Trim().Trim('"')
  if (-not $inputPath -or -not (Test-Path -LiteralPath $inputPath)) {
    return ''
  }

  $item = Get-Item -LiteralPath $inputPath
  if ($item.PSIsContainer) {
    foreach ($fileName in Get-ProductionRestoreEnvBackupNames) {
      $match = @(Get-ChildItem -LiteralPath $item.FullName -File -Recurse -Filter $fileName -ErrorAction SilentlyContinue | Select-Object -First 1)
      if ($match.Count -gt 0) {
        return (Read-EnvFileValue -Path $match[0].FullName -Name $Name)
      }
    }
    return ''
  }

  if ($item.Name.ToLowerInvariant() -match '\.zip$') {
    Enable-ZipSupport
    $zip = [System.IO.Compression.ZipFile]::OpenRead($item.FullName)
    try {
      foreach ($fileName in Get-ProductionRestoreEnvBackupNames) {
        foreach ($entry in $zip.Entries) {
          if ((Split-Path -Leaf $entry.FullName) -eq $fileName) {
            $reader = New-Object System.IO.StreamReader($entry.Open())
            try {
              return (Read-EnvTextValue -Text $reader.ReadToEnd() -Name $Name)
            } finally {
              $reader.Dispose()
            }
          }
        }
      }
    } finally {
      $zip.Dispose()
    }
  }

  foreach ($fileName in Get-ProductionRestoreEnvBackupNames) {
    $siblingSecret = Join-Path (Split-Path -Parent $item.FullName) $fileName
    if ((Test-Path -LiteralPath $siblingSecret -PathType Leaf) -and -not (Test-SameResolvedPath -Left $siblingSecret -Right $TargetEnvPath)) {
      return (Read-EnvFileValue -Path $siblingSecret -Name $Name)
    }
  }

  return ''
}

function Set-ProductionEncryptionKeyForRestore {
  param(
    [string]$BackupEncryptionKey,
    [string]$EnvPath
  )

  if (-not $BackupEncryptionKey) {
    Write-Warning 'No backup N8N_ENCRYPTION_KEY was found beside or inside the selected zip. Database restore can continue, but saved credentials may not decrypt unless .env already has the original key.'
    return $true
  }

  $currentKey = Read-EnvFileValue -Path $EnvPath -Name 'N8N_ENCRYPTION_KEY'
  if ($currentKey -eq $BackupEncryptionKey) {
    Write-Success 'Production .env N8N_ENCRYPTION_KEY already matches the backup secret file.'
    return $true
  }

  Set-EnvFileValue -Path $EnvPath -Name 'N8N_ENCRYPTION_KEY' -Value $BackupEncryptionKey
  Write-Success 'Production .env N8N_ENCRYPTION_KEY updated from the backup secret file.'
  return $true
}

function Write-MissingProductionCredentialRestoreKeyError {
  Write-ErrorMessage 'Credential entities were found, but no source backup N8N_ENCRYPTION_KEY was found.'
  Write-Info 'Include the backup .env or SECRET-DO-NOT-COMMIT.env with the .zip, then run restore again.'
  Write-Info 'The file must contain the N8N_ENCRYPTION_KEY from the n8n instance that created the export.'
}

function Test-TrustedProductionRestoreN8nImageRef {
  param([string]$Image)

  $rawImage = [string]$Image
  $imageRef = $rawImage.Trim()
  if (-not $imageRef) { return $true }
  if ($rawImage -ne $imageRef -or $imageRef -match '\s') { return $false }

  $officialTagged = '\Adocker\.n8n\.io/n8nio/n8n:[A-Za-z0-9][A-Za-z0-9_.-]{0,127}\z'
  $officialDigest = '\Adocker\.n8n\.io/n8nio/n8n@sha256:[a-fA-F0-9]{64}\z'
  return ($imageRef -match $officialTagged -or $imageRef -match $officialDigest)
}

function Write-UntrustedProductionRestoreN8nImageError {
  param([string]$Image)

  $imageRef = ([string]$Image).Trim()
  Write-ErrorMessage "Backup N8N_IMAGE is not an allowed official n8n image reference: $imageRef"
  Write-Info 'Restore accepts only docker.n8n.io/n8nio/n8n:<tag> or docker.n8n.io/n8nio/n8n@sha256:<digest> from backup .env files.'
  Write-Info 'If you intentionally need another image, set N8N_IMAGE manually in the production .env after verifying the image yourself, then rerun restore without a backup-provided N8N_IMAGE.'
}

function Get-ProductionRestoreEntityLatestMigration {
  param([string]$EntityDir)

  $migrationPath = Join-Path $EntityDir 'migrations.jsonl'
  if (-not (Test-Path -LiteralPath $migrationPath -PathType Leaf)) {
    return $null
  }

  $latest = $null
  foreach ($line in Get-Content -LiteralPath $migrationPath) {
    $text = ([string]$line).Trim()
    if (-not $text) { continue }
    try {
      $entry = $text | ConvertFrom-Json
      $timestamp = [int64]0
      if ($entry.timestamp -and [int64]::TryParse(([string]$entry.timestamp), [ref]$timestamp)) {
        if ($null -eq $latest -or $timestamp -gt $latest.Timestamp) {
          $latest = [pscustomobject]@{
            Id = ([string]$entry.id)
            Name = ([string]$entry.name)
            Timestamp = $timestamp
          }
        }
      }
    } catch {
      # n8n import performs the authoritative validation.
    }
  }

  return $latest
}

function Get-ProductionN8nImageLatestMigration {
  param([string]$Image)

  $nodeScript = @'
const fs = require(`fs`);
const dir = `/usr/local/lib/node_modules/n8n/node_modules/@n8n/db/dist/migrations/common`;
const files = fs.readdirSync(dir)
  .filter((name) => name.endsWith(`.js`) && !name.endsWith(`.js.map`))
  .sort();
const latest = files[files.length - 1] || ``;
const match = latest.match(/^(\d+)-(.+)\.js$/);
if (!match) process.exit(2);
console.log(`${match[1]}|${match[2]}`);
'@

  try {
    $output = @(& docker run --rm --entrypoint node $Image -e $nodeScript 2>$null)
    if ($LASTEXITCODE -ne 0 -or $output.Count -eq 0) {
      return $null
    }
    $parts = ([string]$output[0]).Trim() -split '\|', 2
    if ($parts.Count -ne 2) {
      return $null
    }
    return [pscustomobject]@{
      Image = $Image
      Timestamp = [int64]$parts[0]
      Name = $parts[1]
    }
  } catch {
    return $null
  }
}

function Find-ProductionN8nImageForEntityMigration {
  param([object]$Migration)

  if ($null -eq $Migration) {
    return ''
  }

  $images = @(
    & docker image ls 'docker.n8n.io/n8nio/n8n' --format '{{.Repository}}:{{.Tag}}' 2>$null |
      ForEach-Object { ([string]$_).Trim() } |
      Where-Object { $_ -and $_ -notmatch ':<none>$' } |
      Sort-Object -Unique
  )

  $matches = New-Object System.Collections.Generic.List[object]
  foreach ($image in $images) {
    $imageMigration = Get-ProductionN8nImageLatestMigration -Image $image
    if ($null -ne $imageMigration -and $imageMigration.Timestamp -eq $Migration.Timestamp) {
      $matches.Add($imageMigration)
    }
  }

  if ($matches.Count -gt 0) {
    $ranked = @(
      $matches |
        Sort-Object `
          @{ Expression = { if ($_.Image -match ':(\d+\.\d+\.\d+)$') { [version]$Matches[1] } else { [version]'0.0.0' } }; Descending = $true },
          @{ Expression = { if ($_.Image -match ':stable$|:latest$') { 1 } else { 0 } } }
    )
    return ([string]$ranked[0].Image)
  }

  if ($Migration.Timestamp -eq 1784000000006) {
    return 'docker.n8n.io/n8nio/n8n:2.22.5'
  }

  return ''
}

function Resolve-ProductionN8nImageForEntityRestore {
  param([object]$Backup)

  $entityDir = $Backup.SourceEntityDir
  if (-not $entityDir) {
    $entityDir = $Backup.InputDir
  }

  $migration = Get-ProductionRestoreEntityLatestMigration -EntityDir $entityDir
  if ($null -eq $migration) {
    Write-Warning 'Could not read migrations.jsonl to infer the source n8n image for this entities export.'
    return ''
  }

  Write-Info "Entities export latest migration: $($migration.Name)$($migration.Timestamp)."
  $image = Find-ProductionN8nImageForEntityMigration -Migration $migration
  if ($image) {
    Write-Info "Matched entities export migration to N8N_IMAGE=$image."
    return $image
  }

  Write-Warning 'No local or known n8n image mapping matched the entities export migration.'
  return ''
}

function Update-ProductionN8nImageForRestore {
  Write-Info 'Refreshing n8n image for restore. This can take a while when N8N_IMAGE changed.'
  if ((Invoke-Compose -Arguments @('pull', 'n8n')) -ne 0) {
    Write-Warning 'Could not refresh the n8n image; continuing only if the configured image is already cached.'
  }

  return $true
}

function Clear-ProductionPostgresPublicSchema {
  param(
    [string]$PostgresUser,
    [string]$PostgresDb
  )

  $clearSql = 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
  return (Invoke-Compose -Arguments @('exec', '-T', 'postgres', 'psql', '-U', $PostgresUser, '-d', $PostgresDb, '-v', 'ON_ERROR_STOP=1', '-c', $clearSql))
}

function Test-ProductionEntityImportApplied {
  param(
    [string]$PostgresUser,
    [string]$PostgresDb
  )

  $checkSql = @'
DO $$
DECLARE
  table_names text[] := ARRAY[
    'workflow_entity',
    'credentials_entity',
    'settings',
    'project',
    'user',
    'tag_entity',
    'workflows_tags',
    'shared_workflow',
    'shared_credentials',
    'data_table',
    'data_table_column'
  ];
  table_name text;
  table_count bigint;
  total_rows bigint := 0;
BEGIN
  FOREACH table_name IN ARRAY table_names LOOP
    IF to_regclass(format('public.%I', table_name)) IS NOT NULL THEN
      EXECUTE format('SELECT count(*) FROM public.%I', table_name) INTO table_count;
      total_rows := total_rows + table_count;
    END IF;
  END LOOP;

  RAISE NOTICE 'ENTITY_RESTORE_ROW_COUNT=%', total_rows;
  IF total_rows <= 0 THEN
    RAISE EXCEPTION 'Entity import completed, but no supported n8n entity rows were found.';
  END IF;
END $$;
'@

  $result = Invoke-ComposeCapture -Arguments @('exec', '-T', 'postgres', 'psql', '-U', $PostgresUser, '-d', $PostgresDb, '-v', 'ON_ERROR_STOP=1', '-c', $checkSql)
  if ($result.ExitCode -ne 0) {
    Write-ErrorMessage 'Entity import did not leave any supported n8n rows in Postgres.'
    Write-Info 'This usually means the zip did not contain importable n8n entity data for this n8n version, or n8n skipped every entity file.'
    foreach ($line in @($result.Output | Select-Object -Last 20)) {
      Write-Info $line
    }
    return $false
  }

  $rowCountLine = @($result.Output | Where-Object { $_ -match 'ENTITY_RESTORE_ROW_COUNT=' } | Select-Object -Last 1)
  if ($rowCountLine.Count -gt 0) {
    Write-Success (($rowCountLine[0] -replace '^.*ENTITY_RESTORE_ROW_COUNT=', 'Entity restore row count: ').Trim())
  } else {
    Write-Success 'Entity import left supported n8n rows in Postgres.'
  }
  return $true
}

function Restore-ProductionPostgresSqlBackup {
  param([object]$Backup)

  if (-not (Test-ProductionPostgresSqlBackupFile -Path $Backup.InputPath)) {
    return $false
  }

  $values = Read-EnvFile
  $postgresUser = Get-EnvValue -Name 'POSTGRES_USER' -Values $values -Default 'n8n'
  $postgresDb = Get-EnvValue -Name 'POSTGRES_DB' -Values $values -Default 'n8n'
  $timestamp = Get-Date -Format 'yyyyMMddHHmmss'
  $containerPath = "/tmp/n8n-production-restore-$timestamp.sql"

  if ((Invoke-Compose -Arguments @('up', '-d', '--pull', 'never', 'postgres')) -ne 0) { return $false }
  if ((Invoke-Compose -Arguments @('cp', $Backup.InputPath, "postgres:$containerPath")) -ne 0) { return $false }

  $clearExit = Clear-ProductionPostgresPublicSchema -PostgresUser $postgresUser -PostgresDb $postgresDb
  if ($clearExit -ne 0) {
    [void](Invoke-Compose -Arguments @('exec', '-T', 'postgres', 'rm', '-f', $containerPath))
    return $false
  }

  $restoreExit = Invoke-Compose -Arguments @('exec', '-T', 'postgres', 'psql', '-U', $postgresUser, '-d', $postgresDb, '-v', 'ON_ERROR_STOP=1', '-f', $containerPath)
  [void](Invoke-Compose -Arguments @('exec', '-T', 'postgres', 'rm', '-f', $containerPath))
  return ($restoreExit -eq 0)
}

function Restore-ProductionN8nEntitiesBackup {
  param(
    [object]$Backup,
    [string]$BackupEncryptionKey = '',
    [switch]$ImageAlreadyRefreshed
  )

  if ($Backup.HasCredentialEntities -and -not $BackupEncryptionKey) {
    Write-MissingProductionCredentialRestoreKeyError
    return $false
  }

  $previousN8nImageEnv = $env:N8N_IMAGE
  $restoreN8nImage = ([string]$Backup.RestoreN8nImage).Trim()
  if ($restoreN8nImage) {
    if (-not (Test-TrustedProductionRestoreN8nImageRef -Image $restoreN8nImage)) {
      Write-UntrustedProductionRestoreN8nImageError -Image $restoreN8nImage
      return $false
    }
    $env:N8N_IMAGE = $restoreN8nImage
  }

  try {
    if ((Invoke-Compose -Arguments @('up', '-d', '--pull', 'never', 'postgres')) -ne 0) { return $false }
    if (-not $ImageAlreadyRefreshed) {
      if (-not (Update-ProductionN8nImageForRestore)) {
        return $false
      }
    }

    $values = Read-EnvFile
    $postgresUser = Get-EnvValue -Name 'POSTGRES_USER' -Values $values -Default 'n8n'
    $postgresDb = Get-EnvValue -Name 'POSTGRES_DB' -Values $values -Default 'n8n'
    Write-Warning 'Resetting the production Cloudflare n8n Postgres schema so entities import can run at the export migration state.'
    if ((Clear-ProductionPostgresPublicSchema -PostgresUser $postgresUser -PostgresDb $postgresDb) -ne 0) {
      return $false
    }

    $inputDir = $Backup.InputDir
    $mountValue = "${inputDir}:/restore"
    $importArgs = @('run', '--rm', '--pull', 'never', '--no-deps', '-T', '-v', $mountValue, 'n8n', 'import:entities', '--inputDir', '/restore', '--truncateTables')
    Write-Info "docker compose $($importArgs -join ' ')"
    $exitCode = Invoke-Compose -Arguments $importArgs

    if ($Backup.HasCredentialEntities -and $exitCode -ne 0) {
      Write-ErrorMessage 'The entities import failed while encrypted credential data was present.'
      Write-Info 'Review the n8n import output above. Common causes are wrong N8N_ENCRYPTION_KEY, missing migrations.jsonl, or an incompatible N8N_IMAGE.'
    }
    if ($exitCode -ne 0) {
      return $false
    }

    return (Test-ProductionEntityImportApplied -PostgresUser $postgresUser -PostgresDb $postgresDb)
  } finally {
    if ($null -eq $previousN8nImageEnv) {
      Remove-Item Env:\N8N_IMAGE -ErrorAction SilentlyContinue
    } else {
      $env:N8N_IMAGE = $previousN8nImageEnv
    }
  }
}

function Restore-PreviousProductionServices {
  param(
    [string[]]$PreviousServices,
    [switch]$StartN8nWhenNone
  )

  $toRestore = @(
    $PreviousServices | ForEach-Object { ([string]$_).Trim() } |
      Where-Object { $_ -in @('n8n', 'cloudflared') } |
      Sort-Object -Unique
  )

  if ($toRestore.Count -eq 0) {
    if ($StartN8nWhenNone) {
      Write-Info 'No production n8n services were detected before restore. Starting localhost n8n so you can verify the restored data.'
      Start-ProductionStack
      return
    }
    Write-Info 'No production n8n services were running before restore.'
    return
  }

  Write-Info 'Restarting services that were running before restore.'
  if ($toRestore -contains 'cloudflared') {
    Start-N8nWithCloudflare
    return
  }

  if ($toRestore -contains 'n8n') {
    Start-ProductionStack
  }
}

function Restore-ProductionCloudflareFromBackupMenu {
  Write-Header 'Advanced / Recovery: Restore local n8n from backup'
  Write-Warning 'This restore replaces the production Cloudflare stack database with a selected backup.'
  Write-Warning 'Select a .zip backup package. Full account/login restore requires database.sql; older entity zips import best effort.'
  Write-Host ''

  $backupPath = (Read-Host 'Enter the production restore .zip path').Trim().Trim('"')
  Write-Host ''
  if (-not $backupPath) {
    Write-Warning 'Restore cancelled.'
    return
  }
  if (-not (Test-Path -LiteralPath $backupPath)) {
    Write-ErrorMessage 'Backup path does not exist.'
    return
  }

  $envPath = Get-EnvPath
  $backupEncryptionKey = Find-ProductionRestoreBackupEnvValue -Path $backupPath -Name 'N8N_ENCRYPTION_KEY' -TargetEnvPath $envPath
  $backupN8nImage = Find-ProductionRestoreBackupEnvValue -Path $backupPath -Name 'N8N_IMAGE' -TargetEnvPath $envPath
  $detected = Resolve-ProductionRestoreBackup -Path $backupPath
  if (-not $detected.Ok) {
    Write-ErrorMessage $detected.Error
    return
  }
  if (-not $backupEncryptionKey -and $detected.Path) {
    $backupEncryptionKey = Find-ProductionRestoreBackupEnvValue -Path $detected.Path -Name 'N8N_ENCRYPTION_KEY' -TargetEnvPath $envPath
  }
  if (-not $backupN8nImage -and $detected.Path) {
    $backupN8nImage = Find-ProductionRestoreBackupEnvValue -Path $detected.Path -Name 'N8N_IMAGE' -TargetEnvPath $envPath
  }
  if ($backupN8nImage -and -not (Test-TrustedProductionRestoreN8nImageRef -Image $backupN8nImage)) {
    Write-UntrustedProductionRestoreN8nImageError -Image $backupN8nImage
    return
  }
  if ($detected.HasCredentialEntities -and -not $backupEncryptionKey) {
    Write-MissingProductionCredentialRestoreKeyError
    return
  }

  if (-not (Invoke-BasePreflight)) { return }
  if (-not (Test-DockerReady)) { return }

  if (-not $backupN8nImage -and $detected.Type -eq 'n8n-entities') {
    $backupN8nImage = Resolve-ProductionN8nImageForEntityRestore -Backup $detected
  }
  if ($detected.Type -eq 'n8n-entities' -and -not $backupN8nImage) {
    Write-ErrorMessage 'Could not determine the n8n image version required by this entities export.'
    Write-Info 'Include the backup .env / SECRET-DO-NOT-COMMIT.env with N8N_IMAGE, or use a Postgres SQL backup.'
    return
  }
  if ($backupN8nImage) {
    $detected | Add-Member -NotePropertyName RestoreN8nImage -NotePropertyValue $backupN8nImage -Force
  }

  $preRestoreServices = @(
    Get-RunningServices | ForEach-Object { ([string]$_).Trim() } |
      Where-Object { $_ -in @('n8n', 'cloudflared') } |
      Sort-Object -Unique
  )

  Write-Host "Detected backup type: $($detected.Label)." -ForegroundColor Cyan
  if ($detected.Type -eq 'n8n-entities') {
    Write-Host "Entity import folder staged from zip: $($detected.InputDir)" -ForegroundColor Cyan
  } else {
    Write-Host "Database restore file staged from zip: $($detected.InputPath)" -ForegroundColor Cyan
  }
  Write-Host ''
  Write-Warning 'This restore will replace the active production Cloudflare n8n database state.'
  Write-Warning 'The launcher will first create a pre-restore database backup for rollback.'
  Write-Host ''
  $approval = Read-Host 'Type PROCEED to continue'
  Write-Host ''
  if ($approval -ne 'PROCEED') {
    Write-Warning 'Restore cancelled. No restore changes were applied.'
    return
  }

  if ($preRestoreServices.Count -gt 0) {
    Write-Info 'Stopping n8n and Cloudflare tunnel before database restore.'
    [void](Invoke-Compose -Arguments @('stop', 'n8n', 'cloudflared'))
  }

  $preRestoreName = "pre-restore-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
  $preRestoreRoot = Join-Path (Join-Path $script:StackRoot 'backups') $preRestoreName
  $preRestoreZipPath = Join-Path $preRestoreRoot "$preRestoreName.zip"
  if (-not (Backup-Postgres -Required -BackupDir $preRestoreRoot -SkipPreflight)) {
    Write-ErrorMessage 'Restore cancelled because the current production database backup did not complete.'
    return
  }
  [void](Write-ProductionBackupSecretFile -BackupDir $preRestoreRoot)
  Write-ProductionBackupRestoreNotes -BackupDir $preRestoreRoot
  [void](Write-ProductionBackupManifest -BackupDir $preRestoreRoot -Timestamp $preRestoreName.Replace('pre-restore-', '') -Status 'success' -Errors @() -RetentionDays (Get-ProductionBackupRetentionDays))
  $createdPreRestoreZip = Convert-ProductionBackupFolderToZipPackage -BackupDir $preRestoreRoot -ZipFileName "$preRestoreName.zip"
  if (-not $createdPreRestoreZip) {
    Write-ErrorMessage 'Restore cancelled because the current production database backup zip was not created.'
    return
  }
  $preRestoreExpanded = Expand-ProductionRestorePackageZipToStaging -ZipPath $preRestoreZipPath
  if ($preRestoreExpanded.Error) {
    Write-ErrorMessage "Pre-restore backup zip could not be staged for rollback: $($preRestoreExpanded.Error)"
    return
  }
  $preRestoreEncryptionKey = Find-ProductionRestoreBackupEnvValue -Path $preRestoreZipPath -Name 'N8N_ENCRYPTION_KEY' -TargetEnvPath $envPath
  Write-Success "Pre-restore database backup package created: $preRestoreZipPath"
  if (-not (Set-ProductionEncryptionKeyForRestore -BackupEncryptionKey $backupEncryptionKey -EnvPath $envPath)) { return }

  $ok = $false
  switch ($detected.Type) {
    'postgres-sql' { $ok = Restore-ProductionPostgresSqlBackup -Backup $detected }
    'n8n-entities' {
      $n8nImageRefreshed = Update-ProductionN8nImageForRestore
      if (-not $n8nImageRefreshed) { return }
      $ok = Restore-ProductionN8nEntitiesBackup -Backup $detected -BackupEncryptionKey $backupEncryptionKey -ImageAlreadyRefreshed:$n8nImageRefreshed
    }
    default {
      Write-ErrorMessage 'Unsupported production restore backup type after detection.'
      return
    }
  }

  if ($ok) {
    Write-Success 'Production Cloudflare n8n database restore completed.'
    Restore-PreviousProductionServices -PreviousServices $preRestoreServices -StartN8nWhenNone
    Write-Info 'Verify workflows and saved credentials in n8n.'
    return
  }

  Write-ErrorMessage 'Restore failed. Rolling back to the pre-restore database backup now.'
  $rollback = [pscustomobject]@{
    InputPath = $preRestoreExpanded.DatabaseSqlPath
  }
  if (Restore-ProductionPostgresSqlBackup -Backup $rollback) {
    if ($preRestoreEncryptionKey) {
      Set-EnvFileValue -Path $envPath -Name 'N8N_ENCRYPTION_KEY' -Value $preRestoreEncryptionKey
      Write-Success 'Pre-restore production .env N8N_ENCRYPTION_KEY restored.'
    }
    Write-Success 'Pre-restore database rollback completed.'
    Restore-PreviousProductionServices -PreviousServices $preRestoreServices
    Write-Info 'Verify the rollback database state and saved credentials.'
  } else {
    Write-ErrorMessage "Automatic rollback did not complete. Use this pre-restore backup zip as the manual rollback path: $preRestoreZipPath"
  }
}

function Show-UpdateMenu {
  param([switch]$StartCloudflareAfter)

  Write-Header 'Update'
  Write-Info 'Choose what to update. The launcher pulls images, then recreates selected containers automatically.'
  Write-Host 'Choose what to update:' -ForegroundColor Cyan
  Write-Host '  1. All services'
  Write-Host '  2. n8n only'
  Write-Host '  3. postgres only'
  Write-Host '  4. cloudflared only'
  Write-Host '  5. Cancel'
  Write-Host ''

  $choice = Read-Host 'Enter a number'
  $selected = @()
  $needsBackup = $false
  $needsCloudflarePreflight = $false
  switch ($choice) {
    '1' { $selected = @('postgres', 'n8n', 'cloudflared'); $needsBackup = $true; $needsCloudflarePreflight = $true }
    '2' { $selected = @('n8n') }
    '3' { $selected = @('postgres'); $needsBackup = $true }
    '4' { $selected = @('cloudflared'); $needsCloudflarePreflight = $true }
    '5' {
      Write-Warning 'Update cancelled.'
      return
    }
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

  if ($StartCloudflareAfter) {
    Start-N8nWithCloudflare
  }
}

function Update-AllThenStartCloudflare {
  Write-Header 'Update All, Then Start With Cloudflare Tunnel'
  Write-Info 'This runs the Update menu first.'
  Show-UpdateMenu -StartCloudflareAfter
}

function Show-StartMenu {
  Write-Header 'Start n8n'
  Write-Host 'Choose how to start:' -ForegroundColor Cyan
  Write-Host '  1. Localhost only'
  Write-Host '  2. Start Cloudflare tunnel'
  Write-Host '  3. Update all, then start with Cloudflare tunnel'
  Write-Host '  4. Cancel'
  Write-Host ''

  $choice = Read-Host 'Enter a number'
  switch ($choice) {
    '1' { Start-LocalhostOnly }
    '2' { Start-N8nWithCloudflare }
    '3' { Update-AllThenStartCloudflare }
    '4' { Write-Warning 'Start cancelled.' }
    default { Write-Warning 'Choose a number from 1 to 4.' }
  }
}

function Show-StopMenu {
  Write-Header 'Stop n8n'
  Write-Host 'Choose what to stop:' -ForegroundColor Cyan
  Write-Host '  1. n8n + Cloudflare tunnel'
  Write-Host '  2. Stop Cloudflare tunnel'
  Write-Host '  3. Cancel'
  Write-Host ''

  $choice = Read-Host 'Enter a number'
  switch ($choice) {
    '1' { Stop-ProductionStack }
    '2' { Stop-CloudflareTunnel }
    '3' { Write-Warning 'Stop cancelled.' }
    default { Write-Warning 'Choose a number from 1 to 3.' }
  }
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
  Write-Host '  Back up creates a restore-compatible zip with database.sql, manifest, restore notes, and a log'
  Write-Host ''
  Write-Host 'The launcher writes the active n8n URL into .env.active automatically.' -ForegroundColor Cyan
  Write-Host ''
  Write-Host 'Use the numbered menu options for normal work:' -ForegroundColor Cyan
  Write-CommandListItem -Number '1' -Name 'Start n8n' -Description 'Starts localhost only, or opens Start Cloudflare tunnel.'
  Write-CommandListItem -Number '2' -Name 'Restart n8n' -Description 'Recreates only the n8n app container for non-image .env changes.'
  Write-CommandListItem -Number '3' -Name 'Stop n8n' -Description 'Stops Cloudflare only, or stops the production stack.'
  Write-CommandListItem -Number '4' -Name 'Update' -Description 'Pulls selected images and recreates selected containers; backs up before database-impacting updates.'
  Write-CommandListItem -Number '5' -Name 'Show Compose status' -Description 'Shows service state and image details from Docker Compose.'
  Write-CommandListItem -Number '6' -Name 'View logs' -Description 'Shows recent logs for all services or one service.'
  Write-CommandListItem -Number '7' -Name 'Back up' -Description 'Opens manual and automatic production backup actions.'
  Write-CommandListItem -Number '8' -Name 'Advanced / Recovery: Restore local n8n from backup' -Description 'Restores a production backup zip after pre-restore backup and approval.'
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

    $activeUrl = Get-ActiveWebhookUrl
    if ($activeUrl) {
      $activeLabel = "  {0,-22}: " -f 'active n8n URL'
      Write-Host $activeLabel -NoNewline -ForegroundColor DarkCyan
      Write-Host $activeUrl -ForegroundColor DarkYellow
    }

    if ($publicUrl) {
      $urlLabel = "  {0,-22}: " -f 'production URL'
      Write-Host $urlLabel -NoNewline -ForegroundColor DarkCyan
      Write-Host $publicUrl -ForegroundColor DarkYellow
    }

    Write-ImageVersions -RunningServices $runningServices

    if (($runningServices -notcontains 'cloudflared') -and $activeUrl -and $activeUrl -ne $localUrl) {
      Write-Host ''
      Write-Warning 'Active n8n URL is still using Cloudflare, but cloudflared is stopped.'
      Write-Warning 'Local n8n still works. Public webhooks and OAuth callbacks will not.'
    }
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
  Write-Host '  8. Advanced / Recovery: Restore local n8n from backup'
  Write-Host '  9. Command list'
  Write-Host '  10. Exit'
  Write-Host ''
}

Initialize-MenuRuntime

if (Test-MenuFlag -Name 'run-production-backup') {
  if (Backup-N8nProductionNow -Scheduled:(Test-MenuFlag -Name 'scheduled')) { exit 0 }
  exit 1
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
    '7' { Invoke-MenuAction { Show-ProductionBackupMenu } }
    '8' { Invoke-MenuAction { Restore-ProductionCloudflareFromBackupMenu } }
    '9' { Invoke-MenuAction { Show-CommandList } }
    '10' { Clear-MenuScreen; Write-Success 'Bye.'; $script:ExitRequested = $true }
    default {
      Invoke-MenuAction { Write-Warning 'Choose a number from 1 to 10.' }
    }
  }
}

exit 0
