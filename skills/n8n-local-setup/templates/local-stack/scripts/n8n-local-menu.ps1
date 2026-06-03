$ErrorActionPreference = 'Stop'

$script:MenuArguments = @($args)
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

function Resolve-LocalPath {
  param([string]$Path)

  $value = ([string]$Path).Trim().Trim('"')
  if (-not $value) {
    return ''
  }

  return [System.IO.Path]::GetFullPath($value)
}

function Get-ComposeGlobalArguments {
  $composeGlobalArgs = @()
  $explicitEnvFile = Get-MenuArgumentValue -Name 'env-file'
  if ($explicitEnvFile) {
    $composeGlobalArgs += @('--env-file', (Resolve-LocalPath -Path $explicitEnvFile))
  }
  return $composeGlobalArgs
}

function Resolve-RestoreEnvFile {
  $explicitEnvFile = Get-MenuArgumentValue -Name 'env-file'
  if ($explicitEnvFile) {
    $envPath = Resolve-LocalPath -Path $explicitEnvFile
    if (Test-Path -LiteralPath $envPath -PathType Leaf) {
      return [pscustomobject]@{ Path = $envPath; Source = 'explicit --env-file' }
    }
    return [pscustomobject]@{ Error = "No .env file found at --env-file path. Rerun with --env-file <path>." }
  }

  $explicitStackDir = Get-MenuArgumentValue -Name 'stack-dir'
  if ($explicitStackDir) {
    $stackDir = Resolve-LocalPath -Path $explicitStackDir
    $envPath = Join-Path $stackDir '.env'
    if (Test-Path -LiteralPath $envPath -PathType Leaf) {
      return [pscustomobject]@{ Path = $envPath; Source = 'explicit --stack-dir' }
    }
    return [pscustomobject]@{ Error = "No .env file found under --stack-dir. Rerun with --env-file <path>." }
  }

  $knownEnvPath = Join-Path $script:StackRoot '.env'
  if (Test-Path -LiteralPath $knownEnvPath -PathType Leaf) {
    return [pscustomobject]@{ Path = ([System.IO.Path]::GetFullPath($knownEnvPath)); Source = 'launcher stack directory' }
  }

  $candidateEnvPaths = New-Object System.Collections.Generic.List[string]
  $composeFiles = @(
    (Join-Path $script:StackRoot 'docker-compose.yml'),
    (Join-Path $script:StackRoot 'docker-compose.yaml'),
    (Join-Path $script:StackRoot 'compose.yml'),
    (Join-Path $script:StackRoot 'compose.yaml')
  )

  foreach ($composeFile in $composeFiles) {
    if (-not (Test-Path -LiteralPath $composeFile -PathType Leaf)) { continue }
    $candidate = Join-Path (Split-Path -Parent $composeFile) '.env'
    if (Test-Path -LiteralPath $candidate -PathType Leaf) {
      $resolved = [System.IO.Path]::GetFullPath($candidate)
      if (-not ($candidateEnvPaths -contains $resolved)) {
        $candidateEnvPaths.Add($resolved)
      }
    }
  }

  if ($candidateEnvPaths.Count -eq 1) {
    return [pscustomobject]@{ Path = $candidateEnvPaths[0]; Source = 'single .env beside selected local Docker Compose file' }
  }

  if ($candidateEnvPaths.Count -gt 1) {
    return [pscustomobject]@{ Error = 'More than one plausible .env file was found. Rerun with --env-file <path>.' }
  }

  return [pscustomobject]@{ Error = 'No .env file was found. Rerun with --env-file <path>.' }
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

  $allArguments = @((Get-ComposeGlobalArguments) + $Arguments)
  $display = "docker compose $($allArguments -join ' ')"
  Write-Info $display
  $exitCode = Invoke-NativeCommand -Command { & docker compose @allArguments }
  if ($exitCode -ne 0) {
    Write-ErrorMessage "Command failed with exit code $exitCode."
  }
  return $exitCode
}

function Invoke-ComposeCapture {
  param([string[]]$Arguments)

  $allArguments = @((Get-ComposeGlobalArguments) + $Arguments)
  $previousComposeProgress = $env:COMPOSE_PROGRESS
  $previousComposeAnsi = $env:COMPOSE_ANSI
  try {
    $env:COMPOSE_PROGRESS = 'plain'
    $env:COMPOSE_ANSI = 'never'
    $output = @(& docker compose @allArguments 2>&1)
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

function Test-ComposeOneOffCreateOnlyFailure {
  param([object]$Result)

  if ($null -eq $Result -or $Result.ExitCode -eq 0) {
    return $false
  }

  $text = (($Result.Output | ForEach-Object { [string]$_ }) -join "`n").Trim()
  if (-not $text) {
    return $false
  }

  $hasCreateLine = ($text -match 'Container .+ Creating')
  $hasN8nOutput = ($text -match 'Starting entity import|Error details|Migration timestamp mismatch|Migrations file not found|bad decrypt|N8N_ENCRYPTION_KEY|one-off ok')
  $hasDockerError = ($text -match 'Error response from daemon|Cannot connect to the Docker daemon|invalid mount|mount denied|no such image|pull access denied|is already in use|permission denied|failed to create|failed to solve')

  return ($hasCreateLine -and -not $hasN8nOutput -and -not $hasDockerError)
}

function Get-ComposeProjectName {
  if ($env:COMPOSE_PROJECT_NAME) {
    return ([string]$env:COMPOSE_PROJECT_NAME).Trim()
  }

  $result = Invoke-ComposeCapture -Arguments @('config', '--format', 'json')
  if ($result.ExitCode -eq 0) {
    try {
      $config = ($result.Output -join "`n") | ConvertFrom-Json
      if ($config.name) {
        return ([string]$config.name).Trim()
      }
    } catch {
      # Fall through to the local directory fallback below.
    }
  }

  $fallback = ((Split-Path -Leaf $script:StackRoot).ToLowerInvariant() -replace '[^a-z0-9_-]', '')
  return $fallback
}

function Clear-StoppedN8nOneOffContainers {
  $projectName = Get-ComposeProjectName
  if (-not $projectName) {
    Write-Warning 'Could not resolve the Docker Compose project name; skipping one-off n8n container cleanup.'
    return
  }

  Write-Info 'Looking for stopped or created one-off n8n containers to clean; volumes are not removed.'
  $listArgs = @(
    'ps', '-a',
    '--filter', "label=com.docker.compose.project=$projectName",
    '--filter', 'label=com.docker.compose.service=n8n',
    '--filter', 'label=com.docker.compose.oneoff=True',
    '--filter', 'status=created',
    '--filter', 'status=exited',
    '--filter', 'status=dead',
    '--format', '{{.ID}}'
  )

  try {
    $listOutput = @(& docker @listArgs 2>&1)
    $listExitCode = $LASTEXITCODE
  } catch {
    $listOutput = @([string]$_.Exception.Message)
    $listExitCode = 1
  }

  if ($listExitCode -ne 0) {
    Write-Warning 'Could not list one-off n8n containers before retry.'
    foreach ($line in $listOutput) {
      if ($line) { Write-Warning ([string]$line) }
    }
    return
  }

  $containerIds = @(
    $listOutput |
      ForEach-Object { ([string]$_).Trim() } |
      Where-Object { $_ -match '^[0-9a-fA-F]{12,64}$' }
  )

  if ($containerIds.Count -eq 0) {
    Write-Info 'No stopped or created one-off n8n containers were found.'
    return
  }

  Write-Info "Removing $($containerIds.Count) stopped or created one-off n8n container(s)."
  $inspectArgs = @('inspect', '--format', '{{.Name}} {{.State.Status}} {{.State.Error}}') + $containerIds
  $inspectOutput = @(& docker @inspectArgs 2>&1)
  foreach ($line in $inspectOutput) {
    if ($line) { Write-Warning ([string]$line) }
  }

  $removeArgs = @('rm', '-f') + $containerIds
  Write-Info 'docker rm -f <stopped-or-created-n8n-one-off-containers>'
  $removeOutput = @(& docker @removeArgs 2>&1)
  if ($LASTEXITCODE -ne 0) {
    Write-Warning 'Could not remove stopped or created one-off n8n containers before retry.'
    foreach ($line in $removeOutput) {
      if ($line) { Write-Warning ([string]$line) }
    }
    return
  }

  Write-Success 'Stopped or created one-off n8n containers were cleaned before retry.'
}

function Invoke-N8nOneOffCapture {
  param(
    [string[]]$Arguments,
    [string]$Context = 'n8n one-off command'
  )

  $result = Invoke-ComposeCapture -Arguments $Arguments
  if ($result.ExitCode -eq 0) {
    return $result
  }

  if (-not (Test-ComposeOneOffCreateOnlyFailure -Result $result)) {
    return $result
  }

  Write-Warning "$Context failed while Docker was creating the one-off n8n container; cleaning stopped containers and retrying once."
  Clear-StoppedN8nOneOffContainers
  $retry = Invoke-ComposeCapture -Arguments $Arguments
  if ($retry.ExitCode -ne 0 -and (Test-ComposeOneOffCreateOnlyFailure -Result $retry)) {
    Write-ErrorMessage 'Docker could not create or start the one-off n8n container.'
    Write-Info 'This failed before n8n import or key repair ran, so it is usually Docker/image/container state rather than backup version or encryption key.'
    Write-Info 'Restart Docker Desktop or verify the configured N8N_IMAGE is available locally, then retry.'
  }
  return $retry
}

function Test-StackFiles {
  param([string]$EnvPath = '')

  $composeExists = Test-Path -LiteralPath (Join-Path $script:StackRoot 'docker-compose.yml')
  $envPath = $EnvPath
  if (-not $envPath) {
    $envPath = Join-Path $script:StackRoot '.env'
  }
  $envExists = Test-Path -LiteralPath $envPath
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

  if ($envExists -and -not (Test-LocalPortConfig -EnvPath $envPath)) {
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
  param([string]$EnvPath = '')

  if (-not (Test-Path -LiteralPath (Join-Path $script:StackRoot 'docker-compose.yml'))) {
    return @()
  }

  $envPathToCheck = $EnvPath
  if (-not $envPathToCheck) {
    $envPathToCheck = Join-Path $script:StackRoot '.env'
  }
  if (-not (Test-Path -LiteralPath $envPathToCheck)) {
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

    $composeArgs = @((Get-ComposeGlobalArguments) + @('ps', '--services', '--filter', 'status=running'))
    $services = @(& docker compose @composeArgs 2>$null)
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

function Write-N8nServiceStatus {
  param([string[]]$RunningServices)

  if ($RunningServices -contains 'n8n') {
    if (Test-N8nStableReady -RequiredSuccesses 2 -DelaySeconds 1) {
      Write-ServiceStatus -Name 'n8n' -RunningServices $RunningServices -WhenRunning "local editor: $(Get-LocalN8nUrl)"
    } else {
      $statusLabelWidth = 22
      $statusPrefix = ("  {0,-$statusLabelWidth}: " -f 'n8n')
      $logs = @(Get-N8nRecentLogLines -Tail 60)
      Write-Host $statusPrefix -NoNewline -ForegroundColor DarkCyan
      Write-Host 'not ready' -NoNewline -ForegroundColor Red
      if (Test-N8nDatabaseImageMismatchLog -LogLines $logs) {
        Write-Host ' - logs show database schema / image mismatch; check backup N8N_IMAGE' -ForegroundColor White
      } elseif (Test-N8nEncryptionKeyMismatchLog -LogLines $logs) {
        Write-Host ' - logs show encryption-key mismatch; choose Restart n8n to self-heal' -ForegroundColor White
      } else {
        Write-Host " - container is running but editor is not reachable; choose View logs" -ForegroundColor White
      }
    }
  } else {
    Write-ServiceStatus -Name 'n8n' -RunningServices $RunningServices
  }
}

function Get-EnvValue {
  param(
    [string]$Name,
    [string]$Default = '',
    [string]$EnvPath = ''
  )

  $envPath = $EnvPath
  if (-not $envPath) {
    $envPath = Join-Path $script:StackRoot '.env'
  }
  if (-not (Test-Path -LiteralPath $envPath)) {
    return $Default
  }

  $value = Read-EnvFileValue -Path $envPath -Name $Name
  if ($value) {
    return $value
  }

  return $Default
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

  if (-not (Test-Path -LiteralPath $Path)) {
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
  if (Test-Path -LiteralPath $Path) {
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

function Wait-ForServiceImagesAvailable {
  param(
    [string[]]$Services,
    [int]$MaxAttempts = 30,
    [int]$DelaySeconds = 2
  )

  Initialize-ServiceImages
  $missing = New-Object System.Collections.Generic.List[string]

  for ($attempt = 1; $attempt -le $MaxAttempts; $attempt += 1) {
    $missing.Clear()
    foreach ($service in $Services) {
      $image = $script:ServiceImages[$service]
      if (-not (Test-LocalImageExists -Image $image)) {
        $missing.Add("$service -> $image")
      }
    }

    if ($missing.Count -eq 0) {
      return $true
    }

    if ($attempt -lt $MaxAttempts) {
      Start-Sleep -Seconds $DelaySeconds
    }
  }

  Write-ErrorMessage 'Configured image is still not available locally after waiting:'
  foreach ($item in $missing) {
    Write-ErrorMessage "  $item"
  }
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

function Get-LocalN8nProbeUrls {
  $port = Get-LocalN8nPort
  return @(
    "http://127.0.0.1:$port",
    "http://localhost:$port"
  )
}

function Test-N8nHttpReady {
  param(
    [int]$Attempts = 1,
    [int]$DelaySeconds = 0,
    [int]$TimeoutSeconds = 3
  )

  for ($attempt = 1; $attempt -le $Attempts; $attempt += 1) {
    foreach ($url in (Get-LocalN8nProbeUrls)) {
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

function Test-N8nStableReady {
  param(
    [int]$RequiredSuccesses = 3,
    [int]$DelaySeconds = 2
  )

  for ($attempt = 1; $attempt -le $RequiredSuccesses; $attempt += 1) {
    if (-not (Test-N8nHttpReady -TimeoutSeconds 2)) {
      return $false
    }
    if ($attempt -lt $RequiredSuccesses -and $DelaySeconds -gt 0) {
      Start-Sleep -Seconds $DelaySeconds
    }
  }

  $logs = @(Get-N8nRecentLogLines -Tail 60)
  if (Test-N8nDatabaseImageMismatchLog -LogLines $logs) {
    return $false
  }
  if (Test-N8nEncryptionKeyMismatchLog -LogLines $logs) {
    return $false
  }
  return $true
}

function Get-N8nRecentLogLines {
  param([int]$Tail = 80)

  $result = Invoke-ComposeCapture -Arguments @('logs', '--tail', ([string]$Tail), 'n8n')
  return @($result.Output)
}

function Test-N8nEncryptionKeyMismatchLog {
  param([string[]]$LogLines)

  $text = (($LogLines | Select-Object -Last 80) -join "`n")
  return ($text -match 'Mismatching encryption keys' -or $text -match 'settings file .*/home/node/\.n8n/config.*N8N_ENCRYPTION_KEY')
}

function Test-N8nDatabaseImageMismatchLog {
  param([string[]]$LogLines)

  $text = (($LogLines | Select-Object -Last 80) -join "`n")
  return ($text -match 'McpRegistryServerEntity\.id does not exist' -or $text -match 'different migration states' -or $text -match 'Migration timestamp mismatch')
}

function Repair-N8nConfigEncryptionKey {
  Write-Warning 'n8n config encryption key does not match the active .env key. Attempting local self-heal.'
  Write-Info 'Stopping n8n before updating /home/node/.n8n/config inside the local Docker volume.'
  Write-Info 'Repair scope: writes only /home/node/.n8n/config inside the container volume; your .env values are not changed.'
  [void](Invoke-Compose -Arguments @('stop', '--timeout', '10', 'n8n'))

  $nodeScript = @'
const fs = require(`fs`);
const path = require(`path`);
const configPath = `/home/node/.n8n/config`;
const key = process.env.N8N_ENCRYPTION_KEY;
if (!key || key === `replace-with-32-random-character`) {
  console.error(`N8N_ENCRYPTION_KEY is missing or still uses the placeholder.`);
  process.exit(2);
}
let config = {};
const configDir = path.dirname(configPath);
if (!fs.existsSync(configDir)) {
  fs.mkdirSync(configDir, { recursive: true });
}
if (fs.existsSync(configPath)) {
  try {
    const fileText = fs.readFileSync(configPath, `utf8`);
    if (fileText.trim()) {
      config = JSON.parse(fileText);
    }
  } catch (error) {
    console.warn(`Could not parse existing n8n config file. Recreating with current encryption key.`);
  }
}
if (!config || typeof config !== `object` || Array.isArray(config)) {
  config = {};
}
if (config.encryptionKey === key) {
  process.exit(0);
}
config.encryptionKey = key;
fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
'@

  $exitCode = Invoke-Compose -Arguments @('run', '--rm', '--pull', 'never', '--no-deps', '-T', '--entrypoint', 'node', 'n8n', '-e', $nodeScript)
  if ($exitCode -ne 0) {
    Write-ErrorMessage 'Could not update the local n8n config encryption key.'
    return $false
  }

  Write-Success 'Local n8n config encryption key was synced to the active .env key.'
  return $true
}

function Wait-ForN8nReady {
  param(
    [string]$Context = 'n8n startup',
    [switch]$AllowSelfHeal
  )

  Write-Info "Waiting for n8n editor to respond at $(Get-LocalN8nUrl)."
  $readyStreak = 0
  for ($attempt = 1; $attempt -le 20; $attempt += 1) {
    if (Test-N8nHttpReady) {
      $readyStreak += 1
      if ($readyStreak -ge 3) {
        $logs = @(Get-N8nRecentLogLines -Tail 60)
        if (-not (Test-N8nDatabaseImageMismatchLog -LogLines $logs) -and -not (Test-N8nEncryptionKeyMismatchLog -LogLines $logs)) {
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

  $logs = @(Get-N8nRecentLogLines)
  if ($AllowSelfHeal -and (Test-N8nEncryptionKeyMismatchLog -LogLines $logs)) {
    if (Repair-N8nConfigEncryptionKey) {
      Write-Info 'Recreating n8n after local config self-heal.'
      if ((Invoke-Compose -Arguments @('up', '-d', '--pull', 'never', '--force-recreate', 'n8n')) -ne 0) {
        return $false
      }
      $readyStreak = 0
      for ($attempt = 1; $attempt -le 20; $attempt += 1) {
        if (Test-N8nHttpReady) {
          $readyStreak += 1
          if ($readyStreak -ge 3) {
            $logs = @(Get-N8nRecentLogLines -Tail 60)
            if (-not (Test-N8nDatabaseImageMismatchLog -LogLines $logs) -and -not (Test-N8nEncryptionKeyMismatchLog -LogLines $logs)) {
              Write-Success 'n8n editor is responding after self-heal and stayed reachable.'
              return $true
            }
            break
          }
        } else {
          $readyStreak = 0
        }
        Start-Sleep -Seconds 2
      }
    }
  }

  Write-ErrorMessage "$Context did not produce a reachable n8n editor at $(Get-LocalN8nUrl)."
  if (Test-N8nEncryptionKeyMismatchLog -LogLines $logs) {
    Write-ErrorMessage 'Recent logs show mismatching encryption keys between /home/node/.n8n/config and N8N_ENCRYPTION_KEY.'
    Write-Info 'Use View logs for details. If this continues, the restored data likely belongs to a different N8N_ENCRYPTION_KEY than the active .env.'
  } elseif (Test-N8nDatabaseImageMismatchLog -LogLines $logs) {
    Write-ErrorMessage 'Recent logs show a database schema / n8n image version mismatch.'
    Write-Info 'Restore can auto-apply N8N_IMAGE only when the backup .env includes it.'
    Write-Info 'Use a backup folder or zip that includes SECRET-DO-NOT-COMMIT.env / .env with the source N8N_IMAGE, or set N8N_IMAGE manually to the source n8n image and retry.'
  } else {
    Write-Info 'Use View logs to inspect the n8n startup error.'
  }
  return $false
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
  param([string]$EnvPath = '')

  $port = Get-EnvValue -Name 'N8N_LOCAL_PORT' -Default '5678' -EnvPath $EnvPath
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
    if (-not (Wait-ForN8nReady -Context 'Local n8n start' -AllowSelfHeal)) { return }
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
    if (-not (Wait-ForN8nReady -Context 'n8n and ngrok start' -AllowSelfHeal)) { return }
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
      if ((Invoke-Compose -Arguments @('up', '-d', '--pull', 'never', '--force-recreate', 'n8n')) -eq 0) {
        [void](Wait-ForN8nReady -Context 'n8n restart after stopping ngrok' -AllowSelfHeal)
      }
    }

    Write-Success 'ngrok tunnel stopped. Your reserved ngrok domain was not deleted or released.'
  }
}

function Wait-ForServicesStopped {
  param(
    [string[]]$Services = $script:Services,
    [int]$MaxAttempts = 12,
    [int]$DelayMilliseconds = 500
  )

  for ($attempt = 1; $attempt -le $MaxAttempts; $attempt += 1) {
    $runningServices = Get-RunningServices
    $remainingServices = @()
    foreach ($service in $Services) {
      if ($runningServices -contains $service) {
        $remainingServices += $service
      }
    }

    if ($remainingServices.Count -eq 0) {
      return $true
    }

    if ($attempt -lt $MaxAttempts) {
      Start-Sleep -Milliseconds $DelayMilliseconds
    }
  }

  return $false
}

function Stop-LocalStackServices {
  param([string]$Context = '')

  if ((Invoke-Compose -Arguments @('down')) -ne 0) {
    if ($Context) {
      Write-ErrorMessage "${Context}: failed to run docker compose down."
    }
    return $false
  }

  if (Wait-ForServicesStopped -Services @('n8n', 'postgres', 'ngrok')) {
    return $true
  }

  Write-Warning 'Compose down did not fully stop services. Trying direct compose stop.'
  [void](Invoke-Compose -Arguments @('stop', 'n8n', 'postgres', 'ngrok'))

  if (Wait-ForServicesStopped -Services @('n8n', 'postgres', 'ngrok')) {
    return $true
  }

  Write-Warning 'Some local services are still running. Trying immediate compose kill.'
  [void](Invoke-Compose -Arguments @('kill', 'n8n', 'postgres', 'ngrok'))

  return (Wait-ForServicesStopped -Services @('n8n', 'postgres', 'ngrok'))
}

function Stop-Stack {
  Write-Header 'Stop Local n8n Stack'
  if ((Test-StackFiles) -and (Test-DockerReady)) {
    if (Stop-LocalStackServices) {
      Write-Success 'Stack stopped. Docker volumes were not removed.'
      return
    }

    Write-ErrorMessage 'Unable to stop all stack services automatically. Run `docker compose down --remove-orphans` from the stack folder.'
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
    [void](Wait-ForN8nReady -Context 'n8n restart' -AllowSelfHeal)
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
  Write-Host '  1. n8n + ngrok tunnel'
  Write-Host '  2. Stop ngrok tunnel'
  Write-Host '  3. Cancel'
  Write-Host ''

  $choice = Read-Host 'Enter a number'
  switch ($choice) {
    '1' { Stop-Stack }
    '2' { Stop-NgrokTunnel }
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

function Test-PlaceholderEncryptionKey {
  param([string]$Value)

  $key = ([string]$Value).Trim()
  return (-not $key -or $key -eq 'replace-with-32-random-character')
}

function Write-BackupSecretFile {
  param(
    [string]$BackupDir,
    [string]$EnvPath = ''
  )

  $sourceEnvPath = $EnvPath
  if (-not $sourceEnvPath) {
    $sourceEnvPath = Join-Path $script:StackRoot '.env'
  }
  if (-not (Test-Path -LiteralPath $sourceEnvPath -PathType Leaf)) {
    Write-Warning 'No .env file was found to include in the backup. Saved credentials may not decrypt after restore.'
    return ''
  }

  $encryptionKey = Read-EnvFileValue -Path $sourceEnvPath -Name 'N8N_ENCRYPTION_KEY'
  if (-not ([string]$encryptionKey).Trim()) {
    Write-Warning 'N8N_ENCRYPTION_KEY is missing from .env. Saved credentials may not decrypt after restore.'
  }
  if (([string]$encryptionKey).Trim() -and (Test-PlaceholderEncryptionKey -Value $encryptionKey)) {
    Write-Warning 'N8N_ENCRYPTION_KEY still uses the placeholder, but the backup will include it because existing saved credentials may depend on that exact value.'
  }

  $secretPath = Join-Path $BackupDir 'SECRET-DO-NOT-COMMIT.env'
  Copy-Item -LiteralPath $sourceEnvPath -Destination $secretPath -Force
  Write-Success "Private backup .env written to: $secretPath"
  return $secretPath
}

function Write-RestoreManifest {
  param(
    [string]$BackupDir,
    [string]$BackupType,
    [string[]]$Files
  )

  $manifestPath = Join-Path $BackupDir 'restore-manifest.json'
  $manifest = [ordered]@{
    backupType = $BackupType
    createdAt = (Get-Date -Format o)
    localOnly = $true
    files = $Files
    notes = @(
      'Use the current local Compose Postgres connection settings as the restore target.',
      'Keep SECRET-DO-NOT-COMMIT.env with this folder. It is the private backup .env.',
      'Restore reads N8N_ENCRYPTION_KEY from that file and patches only that key automatically.',
      'Restore replaces the current local n8n database state.'
    )
  }

  $manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding ascii
  return $manifestPath
}

function Write-RestoreReadme {
  param(
    [string]$BackupDir,
    [string]$BackupType
  )

  $readmePath = Join-Path $BackupDir 'HOW TO USE THIS RESTORE FOLDER.txt'
  $content = @(
    'How to use this restore folder',
    '',
    "Backup type: $BackupType",
    '',
    'Keep SECRET-DO-NOT-COMMIT.env in this folder. It is the private backup .env.',
    'Open _n8n-local.cmd, choose Advanced / Recovery: Restore local n8n from backup, and paste the full path to database.sql.',
    'Type PROCEED when asked.',
    'Saved credentials require the same N8N_ENCRYPTION_KEY that created the backup.',
    'Restore also reads N8N_IMAGE from SECRET-DO-NOT-COMMIT.env when present and applies that image pin for schema compatibility.',
    'Do not commit this folder, backup files, or SECRET-DO-NOT-COMMIT.env.'
  )

  Set-Content -LiteralPath $readmePath -Value $content -Encoding ascii
  return $readmePath
}

function Backup-Postgres {
  param(
    [switch]$Required,
    [string]$EnvPath = '',
    [string]$BackupDir = ''
  )

  Write-Header 'Backup Postgres Database'
  if (-not (Test-StackFiles -EnvPath $EnvPath)) { return $false }
  if (-not (Test-DockerReady)) { return $false }

  $postgresUser = Get-EnvValue -Name 'POSTGRES_USER' -Default 'n8n' -EnvPath $EnvPath
  $postgresDb = Get-EnvValue -Name 'POSTGRES_DB' -Default 'n8n' -EnvPath $EnvPath
  $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $backupRoot = Join-Path $script:StackRoot 'backups'
  if (-not $BackupDir) {
    $BackupDir = Join-Path $backupRoot "n8n-postgres-$timestamp"
  }
  $backupDir = $BackupDir
  $backupPath = Join-Path $backupDir 'database.sql'

  New-Item -ItemType Directory -Force -Path $backupDir | Out-Null

  Write-Info 'Running pg_dump from the postgres service.'
  $containerBackupPath = "/tmp/n8n-backup-$timestamp.sql"
  $composeArgs = @((Get-ComposeGlobalArguments) + @('exec', '-T', 'postgres', 'pg_dump', '-U', $postgresUser, '-f', $containerBackupPath, $postgresDb))
  $exitCode = Invoke-NativeCommand -Command { & docker compose @composeArgs }
  if ($exitCode -eq 0) {
    $copyArgs = @((Get-ComposeGlobalArguments) + @('cp', "postgres:$containerBackupPath", $backupPath))
    $exitCode = Invoke-NativeCommand -Command { & docker compose @copyArgs }
  }
  $cleanupArgs = @((Get-ComposeGlobalArguments) + @('exec', '-T', 'postgres', 'rm', '-f', $containerBackupPath))
  [void](Invoke-NativeCommand -Quiet -Command { & docker compose @cleanupArgs })
  if ($exitCode -eq 0) {
    if (-not (Test-PostgresSqlBackupFile -Path $backupPath)) {
      if ($Required) {
        Write-ErrorMessage 'Required backup failed. No update was applied.'
      }
      return $false
    }
    Write-Success "Backup written to: $backupPath"
    $secretPath = Write-BackupSecretFile -BackupDir $backupDir -EnvPath $EnvPath
    $files = @('database.sql', 'HOW TO USE THIS RESTORE FOLDER.txt', 'restore-manifest.json')
    if ($secretPath) {
      $files += 'SECRET-DO-NOT-COMMIT.env'
    }
    $manifestPath = Write-RestoreManifest -BackupDir $backupDir -BackupType 'postgres-sql' -Files $files
    $readmePath = Write-RestoreReadme -BackupDir $backupDir -BackupType 'postgres-sql'
    Write-Success "Restore manifest written to: $manifestPath"
    Write-Success "Restore instructions written to: $readmePath"
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

function Test-PostgresSqlBackupFile {
  param([string]$Path)

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    Write-ErrorMessage "Postgres SQL backup file was not found: $Path"
    return $false
  }

  $item = Get-Item -LiteralPath $Path
  if ($item.Length -eq 0) {
    Write-ErrorMessage "Postgres SQL backup file is empty: $Path"
    return $false
  }

  $stream = [System.IO.File]::OpenRead($Path)
  try {
    $bytesToRead = [int][Math]::Min($stream.Length, 65536)
    $buffer = [byte[]]::new($bytesToRead)
    $bytesRead = $stream.Read($buffer, 0, $buffer.Length)
  } finally {
    $stream.Dispose()
  }

  $prefix = [System.Text.Encoding]::UTF8.GetString($buffer, 0, $bytesRead)
  if ($prefix -match "(?m)^Usage:\s+docker compose \[OPTIONS\] COMMAND") {
    Write-ErrorMessage 'Postgres SQL backup file contains docker compose help output instead of a Postgres dump.'
    return $false
  }

  $looksLikePgDump = ($prefix -match 'PostgreSQL database dump')
  $looksLikeSql = ($prefix -match "(?m)^\s*(SET|SELECT|CREATE|ALTER|COPY|INSERT)\b")
  if (-not $looksLikePgDump -and -not $looksLikeSql) {
    Write-ErrorMessage 'Postgres SQL backup file does not look like a PostgreSQL database dump or SQL restore file.'
    return $false
  }

  return $true
}

function Get-RestoreEntityFileNames {
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

function Test-RestoreEntityFileName {
  param([string]$Name)

  $leaf = (Split-Path -Leaf ([string]$Name)).ToLowerInvariant()
  return ((Get-RestoreEntityFileNames) -contains $leaf)
}

function New-RestoreStagingDirectory {
  $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  $importRoot = Join-Path $script:StackRoot 'import'
  $stagingDir = Join-Path $importRoot "restore-$timestamp"
  New-Item -ItemType Directory -Force -Path $stagingDir | Out-Null
  return $stagingDir
}

function Enable-ZipSupport {
  try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction Stop
  } catch {
  }
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

function Expand-GzipFileToRestoreStaging {
  param([string]$SourcePath)

  $stagingDir = New-RestoreStagingDirectory
  $targetPath = Join-Path $stagingDir ((Split-Path -Leaf $SourcePath) -replace '\.gz$', '')
  $inputStream = [System.IO.File]::OpenRead($SourcePath)
  $gzipStream = New-Object System.IO.Compression.GzipStream($inputStream, [System.IO.Compression.CompressionMode]::Decompress)
  $outputStream = [System.IO.File]::Create($targetPath)
  try {
    $gzipStream.CopyTo($outputStream)
  } finally {
    $outputStream.Dispose()
    $gzipStream.Dispose()
    $inputStream.Dispose()
  }
  return $targetPath
}

function Test-PathInsideDirectory {
  param(
    [string]$Path,
    [string]$Directory
  )

  $resolvedPath = [System.IO.Path]::GetFullPath($Path)
  $resolvedDirectory = [System.IO.Path]::GetFullPath($Directory)
  if (-not $resolvedDirectory.EndsWith([System.IO.Path]::DirectorySeparatorChar)) {
    $resolvedDirectory = $resolvedDirectory + [System.IO.Path]::DirectorySeparatorChar
  }
  return $resolvedPath.StartsWith($resolvedDirectory, [System.StringComparison]::OrdinalIgnoreCase)
}

function Find-RestoreEntityDirectory {
  param([string]$Root)

  $entityFiles = @(
    Get-ChildItem -LiteralPath $Root -File -Recurse -ErrorAction SilentlyContinue |
      Where-Object { Test-RestoreEntityFileName -Name $_.Name }
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

function New-RestoreEntityImportDirectory {
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

function Expand-RestoreEntitiesZipToStaging {
  param([string]$ZipPath)

  $stagingDir = New-RestoreStagingDirectory
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

  $entityDir = Find-RestoreEntityDirectory -Root $stagingDir
  if (-not $entityDir) {
    return [pscustomobject]@{ Error = 'Zip restore package did not contain n8n export:entities output files.' }
  }

  $importDir = New-RestoreEntityImportDirectory -EntityDir $entityDir -StagingDir $stagingDir
  if (-not $importDir) {
    return [pscustomobject]@{ Error = 'Zip restore package did not contain migrations.jsonl in the detected n8n entity export directory.' }
  }
  Write-Info "Backup zip extracted under: $stagingDir"
  Write-Info 'Using a clean entities.zip rebuilt from all extracted n8n entity JSONL files; nested zip artifacts are ignored.'
  return [pscustomobject]@{
    StagingPath = $stagingDir
    EntityDir = $importDir
    SourceEntityDir = $entityDir
  }
}

function Get-RestoreBackupType {
  param([string]$Path)

  $inputPath = ([string]$Path).Trim().Trim('"')
  if (-not $inputPath) {
    return [pscustomobject]@{ Type = 'unsupported'; Label = 'missing input'; Reason = 'No backup path was provided.' }
  }

  if (-not (Test-Path -LiteralPath $inputPath)) {
    return [pscustomobject]@{ Type = 'unsupported'; Label = 'missing input'; Reason = 'Backup path does not exist.' }
  }

  $item = Get-Item -LiteralPath $inputPath
  if (-not $item.PSIsContainer) {
    $name = $item.Name.ToLowerInvariant()
    if ($name -match '\.sql$') {
      return [pscustomobject]@{ Type = 'postgres-sql'; Label = 'Postgres SQL backup'; InputPath = $item.FullName }
    }
    if ($name -match '\.zip$') {
      $entries = @(Get-ZipEntryNames -ZipPath $item.FullName)
      $hasEntities = @($entries | Where-Object { Test-RestoreEntityFileName -Name $_ }).Count -gt 0
      $hasCredentialEntities = @($entries | Where-Object { (Split-Path -Leaf $_).ToLowerInvariant() -eq 'credentialsentity.jsonl' }).Count -gt 0
      if ($hasEntities) {
        return [pscustomobject]@{ Type = 'zip-package'; Label = 'zip backup package'; InputPath = $item.FullName; NeedsStaging = $true; HasCredentialEntities = $hasCredentialEntities }
      }

      Write-Warning 'Unknown zip backup. Filename-level detection found these entries:'
      foreach ($entryName in $entries) {
        Write-Warning "  $entryName"
      }
      return [pscustomobject]@{ Type = 'unsupported'; Label = 'unknown zip'; Reason = 'Unknown zip backup package.' }
    }
    return [pscustomobject]@{ Type = 'unsupported'; Label = 'unsupported file type'; Reason = 'Restore input must use one of these extensions: .sql, .zip.' }
  }

  return [pscustomobject]@{ Type = 'unsupported'; Label = 'unsupported restore path'; Reason = 'Restore input must be a backup file (.sql or .zip), not a folder.' }
}

function Prepare-RestoreBackupInput {
  param([string]$Path)

  $detected = Get-RestoreBackupType -Path $Path
  if ($detected.NeedsStaging) {
    $expanded = Expand-RestoreEntitiesZipToStaging -ZipPath $detected.InputPath
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

function Get-RestoreEnvBackupNames {
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

function Find-RestoreEnvBackupFileInDirectory {
  param([string]$Directory)

  foreach ($fileName in Get-RestoreEnvBackupNames) {
    $matches = @(Get-ChildItem -LiteralPath $Directory -File -Recurse -Filter $fileName -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($matches.Count -gt 0) {
      return $matches[0].FullName
    }
  }

  return ''
}

function Find-RestoreBackupEnvValue {
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
    $secretFile = Find-RestoreEnvBackupFileInDirectory -Directory $item.FullName
    if ($secretFile) {
      return (Read-EnvFileValue -Path $secretFile -Name $Name)
    }
    return ''
  }

  if ($item.Name.ToLowerInvariant() -match '\.zip$') {
    Enable-ZipSupport
    $zip = [System.IO.Compression.ZipFile]::OpenRead($item.FullName)
    try {
      foreach ($fileName in Get-RestoreEnvBackupNames) {
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

  foreach ($fileName in Get-RestoreEnvBackupNames) {
    $siblingSecret = Join-Path (Split-Path -Parent $item.FullName) $fileName
    if ((Test-Path -LiteralPath $siblingSecret) -and -not (Test-SameResolvedPath -Left $siblingSecret -Right $TargetEnvPath)) {
      return (Read-EnvFileValue -Path $siblingSecret -Name $Name)
    }
  }

  return ''
}

function Find-RestoreBackupSecret {
  param(
    [string]$Path,
    [string]$TargetEnvPath = ''
  )

  return (Find-RestoreBackupEnvValue -Path $Path -Name 'N8N_ENCRYPTION_KEY' -TargetEnvPath $TargetEnvPath)
}

function Write-MissingRestoreEnvError {
  param([string]$SecretSearchPath)

  $path = ([string]$SecretSearchPath).Trim().Trim('"')
  if (-not $path) {
    $path = 'the selected backup input'
  }
  Write-ErrorMessage "No backup .env or SECRET-DO-NOT-COMMIT.env with N8N_ENCRYPTION_KEY was found in $path."
  Write-Info 'Restore cancelled before stopping services or changing the database.'
  Write-Info 'Keep SECRET-DO-NOT-COMMIT.env with database.sql, or include the backup .env / SECRET-DO-NOT-COMMIT.env in the entities zip.'
}

function Write-MissingCredentialRestoreKeyError {
  Write-ErrorMessage 'Credential entities were found, but no source backup N8N_ENCRYPTION_KEY was found.'
  Write-Info 'Include the backup .env or SECRET-DO-NOT-COMMIT.env with the .zip, then run restore again.'
  Write-Info 'The file must contain the N8N_ENCRYPTION_KEY from the n8n instance that created the export.'
}

function Set-LocalEncryptionKeyForRestore {
  param(
    [string]$BackupEncryptionKey,
    [string]$EnvPath
  )

  if (-not $BackupEncryptionKey) {
    return $true
  }

  $currentKey = Get-EnvValue -Name 'N8N_ENCRYPTION_KEY' -EnvPath $EnvPath
  if ($currentKey -eq $BackupEncryptionKey) {
    Write-Success 'Resolved local Compose N8N_ENCRYPTION_KEY already matches the backup secret file.'
    return $true
  }

  Set-EnvFileValue -Path $EnvPath -Name 'N8N_ENCRYPTION_KEY' -Value $BackupEncryptionKey
  Write-Success 'Resolved local Compose N8N_ENCRYPTION_KEY updated from the backup secret file.'
  return $true
}

function Test-TrustedRestoreN8nImageRef {
  param([string]$Image)

  $imageRef = ([string]$Image).Trim()
  if (-not $imageRef) {
    return $true
  }

  $officialTagged = '^docker\.n8n\.io/n8nio/n8n:[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$'
  $officialDigest = '^docker\.n8n\.io/n8nio/n8n@sha256:[a-fA-F0-9]{64}$'
  return ($imageRef -match $officialTagged -or $imageRef -match $officialDigest)
}

function Write-UntrustedRestoreN8nImageError {
  param([string]$Image)

  $imageRef = ([string]$Image).Trim()
  Write-ErrorMessage "Backup N8N_IMAGE is not an allowed official n8n image reference: $imageRef"
  Write-Info 'Restore accepts only docker.n8n.io/n8nio/n8n:<tag> or docker.n8n.io/n8nio/n8n@sha256:<digest> from backup .env files.'
  Write-Info 'If you intentionally need another image, set N8N_IMAGE manually in the active local .env after verifying the image yourself, then rerun restore without a backup-provided N8N_IMAGE.'
}

function Set-LocalN8nImageForRestore {
  param(
    [string]$BackupN8nImage,
    [string]$EnvPath
  )

  $image = ([string]$BackupN8nImage).Trim()
  if (-not $image) {
    Write-Warning 'No backup N8N_IMAGE was found in the backup .env. If n8n later reports a database schema / image version mismatch, set N8N_IMAGE to the source backup image and retry.'
    return $true
  }

  if (-not (Test-TrustedRestoreN8nImageRef -Image $image)) {
    Write-UntrustedRestoreN8nImageError -Image $image
    return $false
  }

  $currentImage = Read-EnvFileValue -Path $EnvPath -Name 'N8N_IMAGE'
  if ($currentImage -eq $image) {
    Write-Success 'Resolved local Compose N8N_IMAGE already matches the backup .env.'
    return $true
  }

  Write-Info "Backup .env N8N_IMAGE detected: $image"
  Write-Info 'Updating local Compose N8N_IMAGE to match the backup .env for restore schema compatibility.'
  Set-EnvFileValue -Path $EnvPath -Name 'N8N_IMAGE' -Value $image
  Initialize-ServiceImages
  return $true
}

function Get-RestoreEntityLatestMigration {
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
      # Ignore malformed lines here; n8n import performs the authoritative validation.
    }
  }

  return $latest
}

function Get-N8nImageLatestMigration {
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

function Find-N8nImageForEntityMigration {
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
    $imageMigration = Get-N8nImageLatestMigration -Image $image
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

function Resolve-N8nImageForEntityRestore {
  param([object]$Backup)

  $entityDir = $Backup.SourceEntityDir
  if (-not $entityDir) {
    $entityDir = $Backup.InputDir
  }

  $migration = Get-RestoreEntityLatestMigration -EntityDir $entityDir
  if ($null -eq $migration) {
    Write-Warning 'Could not read migrations.jsonl to infer the source n8n image for this entities export.'
    return ''
  }

  Write-Info "Entities export latest migration: $($migration.Name)$($migration.Timestamp)."
  $image = Find-N8nImageForEntityMigration -Migration $migration
  if ($image) {
    Write-Info "Matched entities export migration to N8N_IMAGE=$image."
    return $image
  }

  Write-Warning 'No local or known n8n image mapping matched the entities export migration.'
  return ''
}

function Restore-PreRestoreEnvValueBackup {
  param(
    [string]$SecretBackupPath,
    [string]$EnvPath,
    [string]$Name
  )

  if (-not $SecretBackupPath -or -not (Test-Path -LiteralPath $SecretBackupPath -PathType Leaf)) {
    return $true
  }

  $previousValue = Read-EnvFileValue -Path $SecretBackupPath -Name $Name
  if (-not $previousValue) {
    return $true
  }

  $currentValue = Read-EnvFileValue -Path $EnvPath -Name $Name
  if ($currentValue -eq $previousValue) {
    return $true
  }

  Set-EnvFileValue -Path $EnvPath -Name $Name -Value $previousValue
  Write-Success "Pre-restore $Name restored from SECRET-DO-NOT-COMMIT.env."
  return $true
}

function Copy-RestoreFileToPostgres {
  param(
    [string]$SourcePath,
    [string]$ContainerPath
  )

  $composeArgs = @((Get-ComposeGlobalArguments) + @('cp', $SourcePath, "postgres:$ContainerPath"))
  return (Invoke-NativeCommand -Command { & docker compose @composeArgs })
}

function Clear-PostgresPublicSchema {
  param(
    [string]$PostgresUser,
    [string]$PostgresDb
  )

  $replaceSql = 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
  $composeArgs = @((Get-ComposeGlobalArguments) + @('exec', '-T', 'postgres', 'psql', '-U', $PostgresUser, '-d', $PostgresDb, '-v', 'ON_ERROR_STOP=1', '-c', $replaceSql))
  return (Invoke-NativeCommand -Command { & docker compose @composeArgs })
}

function Restore-PostgresSqlBackup {
  param(
    [object]$Backup,
    [string]$EnvPath = ''
  )

  $postgresUser = Get-EnvValue -Name 'POSTGRES_USER' -Default 'n8n' -EnvPath $EnvPath
  $postgresDb = Get-EnvValue -Name 'POSTGRES_DB' -Default 'n8n' -EnvPath $EnvPath

  if ((Invoke-Compose -Arguments @('up', '-d', '--pull', 'never', 'postgres')) -ne 0) { return $false }

  $restorePath = $Backup.InputPath
  if ($Backup.Type -eq 'postgres-sql-gzip') {
    $restorePath = Expand-GzipFileToRestoreStaging -SourcePath $Backup.InputPath
  }

  $timestamp = Get-Date -Format 'yyyyMMddHHmmss'
  $containerPath = "/tmp/n8n-restore-$timestamp"

  if ($Backup.Type -eq 'postgres-archive') {
    $containerPath = "$containerPath.backup"
    if ((Copy-RestoreFileToPostgres -SourcePath $restorePath -ContainerPath $containerPath) -ne 0) { return $false }
    if ((Clear-PostgresPublicSchema -PostgresUser $postgresUser -PostgresDb $postgresDb) -ne 0) { return $false }
    $restoreArgs = @((Get-ComposeGlobalArguments) + @('exec', '-T', 'postgres', 'pg_restore', '-U', $postgresUser, '-d', $postgresDb, '--clean', '--if-exists', '--no-owner', '--no-privileges', $containerPath))
    $restoreExit = Invoke-NativeCommand -Command { & docker compose @restoreArgs }
    $cleanupArgs = @((Get-ComposeGlobalArguments) + @('exec', '-T', 'postgres', 'rm', '-f', $containerPath))
    [void](Invoke-NativeCommand -Quiet -Command { & docker compose @cleanupArgs })
    return ($restoreExit -eq 0)
  }

  $containerPath = "$containerPath.sql"
  if (-not (Test-PostgresSqlBackupFile -Path $restorePath)) {
    return $false
  }
  if ((Copy-RestoreFileToPostgres -SourcePath $restorePath -ContainerPath $containerPath) -ne 0) { return $false }
  if ((Clear-PostgresPublicSchema -PostgresUser $postgresUser -PostgresDb $postgresDb) -ne 0) { return $false }
  $restoreArgs = @((Get-ComposeGlobalArguments) + @('exec', '-T', 'postgres', 'psql', '-U', $postgresUser, '-d', $postgresDb, '-v', 'ON_ERROR_STOP=1', '-f', $containerPath))
  $restoreExit = Invoke-NativeCommand -Command { & docker compose @restoreArgs }
  $cleanupArgs = @((Get-ComposeGlobalArguments) + @('exec', '-T', 'postgres', 'rm', '-f', $containerPath))
  [void](Invoke-NativeCommand -Quiet -Command { & docker compose @cleanupArgs })
  return ($restoreExit -eq 0)
}

function Restore-PreRestorePostgresBackup {
  param(
    [string]$BackupDir,
    [string]$EnvPath = ''
  )

  $backupPath = Join-Path $BackupDir 'database.sql'
  if (-not (Test-PostgresSqlBackupFile -Path $backupPath)) {
    Write-ErrorMessage "Pre-restore database backup is not usable: $backupPath"
    return $false
  }

  Write-Warning 'Restore failed. Rolling back to the pre-restore database backup now.'
  $backup = [pscustomobject]@{
    Type = 'postgres-sql'
    InputPath = $backupPath
  }

  if (Restore-PostgresSqlBackup -Backup $backup -EnvPath $EnvPath) {
    Write-Success 'Pre-restore database rollback completed.'
    return $true
  }

  Write-ErrorMessage "Pre-restore database rollback failed. Use this backup folder manually: $BackupDir"
  return $false
}

function Restore-PreRestoreEncryptionKeyBackup {
  param(
    [string]$SecretBackupPath,
    [string]$EnvPath
  )

  return (Restore-PreRestoreEnvValueBackup -SecretBackupPath $SecretBackupPath -EnvPath $EnvPath -Name 'N8N_ENCRYPTION_KEY')
}

function Restore-PreRestoreN8nImageBackup {
  param(
    [string]$SecretBackupPath,
    [string]$EnvPath
  )

  return (Restore-PreRestoreEnvValueBackup -SecretBackupPath $SecretBackupPath -EnvPath $EnvPath -Name 'N8N_IMAGE')
}

function Restore-PreviousStackServices {
  param(
    [string[]]$PreviousServices,
    [switch]$StartN8nWhenNone
  )

  $toRestore = @(
    $PreviousServices | ForEach-Object { ([string]$_).Trim() } |
      Where-Object { $_ -in @('n8n', 'ngrok') } |
      Sort-Object -Unique
  )

  if ($toRestore.Count -eq 0) {
    if ($StartN8nWhenNone) {
      Write-Info 'No local n8n services were detected before restore. Starting n8n so you can verify the restored data.'
      Start-LocalStack -ForceRecreateN8n
      return
    }
    Write-Info 'No local n8n services were running before restore.'
    return
  }

  Write-Info 'Restarting services that were running before restore.'
  if (($toRestore -contains 'n8n') -and ($toRestore -contains 'ngrok')) {
    Start-N8nWithNgrok
    return
  }

  if ($toRestore -contains 'n8n') {
    Start-LocalStack -ForceRecreateN8n
    return
  }

  if ($toRestore -contains 'ngrok') {
    Start-N8nWithNgrok
    return
  }
}

function Update-N8nImageForRestore {
  Write-Info 'Refreshing n8n image for restore. This can take a while when N8N_IMAGE changed.'
  $pullSucceeded = ((Invoke-Compose -Arguments @('pull', 'n8n')) -eq 0)
  if (-not $pullSucceeded) {
    Write-Warning 'Could not refresh the n8n image; continuing only if the configured image is already cached.'
  }

  Write-Info 'Verifying configured n8n image is available locally before continuing.'
  if (Wait-ForServiceImagesAvailable -Services @('n8n')) {
    Write-Success 'Configured n8n image is available locally.'
    return $true
  }

  if ($pullSucceeded) {
    Write-ErrorMessage 'docker compose pull finished, but the configured n8n image is not available locally.'
  }
  return $false
}

function Restore-N8nEntitiesBackup {
  param(
    [object]$Backup,
    [string]$BackupEncryptionKey = '',
    [string]$EnvPath = '',
    [switch]$ImageAlreadyRefreshed
  )

  if ($Backup.HasCredentialEntities -and -not $BackupEncryptionKey) {
    Write-MissingCredentialRestoreKeyError
    return $false
  }

  $previousN8nImageEnv = $env:N8N_IMAGE
  $restoreN8nImage = ([string]$Backup.RestoreN8nImage).Trim()
  if ($restoreN8nImage) {
    if (-not (Test-TrustedRestoreN8nImageRef -Image $restoreN8nImage)) {
      Write-UntrustedRestoreN8nImageError -Image $restoreN8nImage
      return $false
    }
    $env:N8N_IMAGE = $restoreN8nImage
  }

  try {
    if ((Invoke-Compose -Arguments @('up', '-d', '--pull', 'never', 'postgres')) -ne 0) { return $false }
    if (-not $ImageAlreadyRefreshed) {
      if (-not (Update-N8nImageForRestore)) {
        return $false
      }
    }

    $postgresUser = Get-EnvValue -Name 'POSTGRES_USER' -Default 'n8n' -EnvPath $EnvPath
    $postgresDb = Get-EnvValue -Name 'POSTGRES_DB' -Default 'n8n' -EnvPath $EnvPath
    Write-Warning 'Resetting the local n8n Postgres schema so entities import can run at the export migration state.'
    if ((Clear-PostgresPublicSchema -PostgresUser $postgresUser -PostgresDb $postgresDb) -ne 0) {
      return $false
    }

    $inputDir = $Backup.InputDir
    $mountValue = "${inputDir}:/restore"
    $importArgs = @('run', '--rm', '--pull', 'never', '--no-deps', '-T', '-v', $mountValue, 'n8n', 'import:entities', '--inputDir', '/restore', '--truncateTables')
    $composeArgs = @((Get-ComposeGlobalArguments) + $importArgs)
    Write-Info "docker compose $($composeArgs -join ' ')"
    $exitCode = Invoke-Compose -Arguments $importArgs

    if ($Backup.HasCredentialEntities) {
      if ($exitCode -ne 0) {
        Write-ErrorMessage 'The entities import failed while encrypted credential data was present.'
        Write-Info 'Review the n8n import output above. Common causes are wrong N8N_ENCRYPTION_KEY, missing migrations.jsonl, or an incompatible N8N_IMAGE.'
      }
    }
    return ($exitCode -eq 0)
  } finally {
    if ($null -eq $previousN8nImageEnv) {
      Remove-Item Env:\N8N_IMAGE -ErrorAction SilentlyContinue
    } else {
      $env:N8N_IMAGE = $previousN8nImageEnv
    }
  }
}

function Restore-LocalN8nFromBackupMenu {
  Write-Header 'Advanced / Recovery: Restore local n8n from backup'
  Write-Warning 'Local recovery only. Do not use this for production or remote n8n restore.'
  Write-Warning 'This is for database/environment restore, not normal workflow JSON import.'
  Write-Host ''
  $backupPath = (Read-Host 'Enter the local restore backup file path (.sql or .zip)').Trim().Trim('"')
  Write-Host ''
  if (-not $backupPath) {
    Write-Warning 'Restore cancelled.'
    return
  }
  if (-not (Test-Path -LiteralPath $backupPath)) {
    Write-ErrorMessage 'Backup path does not exist.'
    return
  }

  $detected = Get-RestoreBackupType -Path $backupPath
  if ($detected.Type -eq 'unsupported') {
    Write-ErrorMessage $detected.Reason
    return
  }

  $envResolution = Resolve-RestoreEnvFile
  if ($envResolution.Error) {
    Write-ErrorMessage $envResolution.Error
    return
  }
  $resolvedEnvPath = $envResolution.Path

  $backupEncryptionKey = Find-RestoreBackupSecret -Path $backupPath -TargetEnvPath $resolvedEnvPath
  $backupN8nImage = Find-RestoreBackupEnvValue -Path $backupPath -Name 'N8N_IMAGE' -TargetEnvPath $resolvedEnvPath
  $secretSearchPath = $backupPath
  if (-not $backupEncryptionKey -and $detected.StagingPath) {
    $backupEncryptionKey = Find-RestoreBackupSecret -Path $detected.StagingPath -TargetEnvPath $resolvedEnvPath
    $secretSearchPath = $detected.StagingPath
  }
  if (-not $backupN8nImage -and $detected.StagingPath) {
    $backupN8nImage = Find-RestoreBackupEnvValue -Path $detected.StagingPath -Name 'N8N_IMAGE' -TargetEnvPath $resolvedEnvPath
  }
  if (-not $backupEncryptionKey) {
    Write-MissingRestoreEnvError -SecretSearchPath $secretSearchPath
    return
  }

  if (-not (Test-StackFiles -EnvPath $resolvedEnvPath)) { return }
  if (-not (Test-DockerReady)) { return }

  $runningServices = Get-RunningServices -EnvPath $resolvedEnvPath
  $preRestoreServices = @(
    $runningServices | ForEach-Object { ([string]$_).Trim() } |
      Where-Object { $_ -in @('n8n', 'ngrok') } |
      Sort-Object -Unique
  )
  if ($preRestoreServices.Count -gt 0) {
    Write-Info 'Restore requires the local stack to be stopped. Stopping local n8n services now.'
    if (-not (Stop-LocalStackServices -Context 'Restore')) {
      Write-ErrorMessage 'Restore cancelled because local services could not be stopped.'
      return
    }
    $runningServices = @()
  }

  Write-Host ''
  Write-Host "Detected backup type: $($detected.Label)." -ForegroundColor Cyan
  Write-Host "Resolved .env path: $resolvedEnvPath" -ForegroundColor Cyan
  Write-Host "Resolved .env source: $($envResolution.Source)" -ForegroundColor Cyan
  Write-Host ''
  Write-Warning 'This restore will replace the active local n8n database state with the backup state.'
  Write-Warning 'It will also update local Compose N8N_ENCRYPTION_KEY and, when present, N8N_IMAGE from the backup .env.'
  Write-Host ''
  $approval = Read-Host 'Type PROCEED to continue'
  Write-Host ''
  if ($approval -ne 'PROCEED') {
    Write-Warning 'Restore cancelled. No restore changes were applied.'
    return
  }

  $detected = Prepare-RestoreBackupInput -Path $backupPath
  if ($detected.Type -eq 'unsupported') {
    Write-ErrorMessage $detected.Reason
    return
  }
  if (-not $backupEncryptionKey -and $detected.StagingPath) {
    $backupEncryptionKey = Find-RestoreBackupSecret -Path $detected.StagingPath -TargetEnvPath $resolvedEnvPath
  }
  if (-not $backupN8nImage -and $detected.StagingPath) {
    $backupN8nImage = Find-RestoreBackupEnvValue -Path $detected.StagingPath -Name 'N8N_IMAGE' -TargetEnvPath $resolvedEnvPath
  }
  if (-not $backupN8nImage -and $detected.Type -eq 'n8n-entities') {
    $backupN8nImage = Resolve-N8nImageForEntityRestore -Backup $detected
  }
  if ($detected.Type -eq 'n8n-entities' -and -not $backupN8nImage) {
    Write-ErrorMessage 'Could not determine the n8n image version required by this entities export.'
    Write-Info 'Include the backup .env / SECRET-DO-NOT-COMMIT.env with N8N_IMAGE, or use a Postgres SQL backup.'
    return
  }
  if ($backupN8nImage -and -not (Test-TrustedRestoreN8nImageRef -Image $backupN8nImage)) {
    Write-UntrustedRestoreN8nImageError -Image $backupN8nImage
    return
  }
  if ($detected.HasCredentialEntities -and -not $backupEncryptionKey) {
    Write-MissingCredentialRestoreKeyError
    return
  }
  if ($backupN8nImage) {
    $detected | Add-Member -NotePropertyName RestoreN8nImage -NotePropertyValue $backupN8nImage -Force
  }

  if ($runningServices -notcontains 'postgres') {
    Write-Info 'Starting Postgres so the current database can be backed up before restore.'
    if ((Invoke-Compose -Arguments @('up', '-d', '--pull', 'never', 'postgres')) -ne 0) { return }
  }

  $preRestoreRoot = Join-Path (Join-Path $script:StackRoot 'backups') "pre-restore-$(Get-Date -Format 'yyyyMMdd-HHmmss')"
  if (-not (Backup-Postgres -Required -EnvPath $resolvedEnvPath -BackupDir $preRestoreRoot)) {
    Write-ErrorMessage 'Restore cancelled because the current local n8n database backup did not complete.'
    return
  }
  $preRestoreSecretPath = Join-Path $preRestoreRoot 'SECRET-DO-NOT-COMMIT.env'
  Write-Success 'Pre-restore database backup created; rollback .env saved if present.'

  if (-not (Set-LocalN8nImageForRestore -BackupN8nImage $backupN8nImage -EnvPath $resolvedEnvPath)) { return }
  if (-not (Set-LocalEncryptionKeyForRestore -BackupEncryptionKey $backupEncryptionKey -EnvPath $resolvedEnvPath)) { return }

  $ok = $false
  switch ($detected.Type) {
    'postgres-sql' { $ok = Restore-PostgresSqlBackup -Backup $detected -EnvPath $resolvedEnvPath }
    'n8n-entities' {
      $n8nImageRefreshed = Update-N8nImageForRestore
      if (-not $n8nImageRefreshed) { return }
      if (-not (Repair-N8nConfigEncryptionKey)) {
        Write-Warning 'Could not sync local n8n config encryption key before restore completion. Startup will attempt one more repair pass.'
      }
      $ok = Restore-N8nEntitiesBackup -Backup $detected -BackupEncryptionKey $backupEncryptionKey -EnvPath $resolvedEnvPath -ImageAlreadyRefreshed:$n8nImageRefreshed
    }
    default {
      Write-ErrorMessage 'Unsupported backup type after detection.'
      return
    }
  }

  if ($ok) {
    Write-Success 'Local n8n restore completed.'
    if ($detected.Type -eq 'n8n-entities') {
      [void](Restore-PreRestoreN8nImageBackup -SecretBackupPath $preRestoreSecretPath -EnvPath $resolvedEnvPath)
    }
    Restore-PreviousStackServices -PreviousServices $preRestoreServices -StartN8nWhenNone
    Write-Info 'Verify workflows and saved credentials in n8n.'
  } else {
    Write-ErrorMessage 'Restore failed.'
    $rollbackOk = Restore-PreRestorePostgresBackup -BackupDir $preRestoreRoot -EnvPath $resolvedEnvPath
    [void](Restore-PreRestoreEncryptionKeyBackup -SecretBackupPath $preRestoreSecretPath -EnvPath $resolvedEnvPath)
    [void](Restore-PreRestoreN8nImageBackup -SecretBackupPath $preRestoreSecretPath -EnvPath $resolvedEnvPath)
    if ($rollbackOk) {
      Restore-PreviousStackServices -PreviousServices $preRestoreServices
      Write-Info 'Verify the rollback database state and saved credentials.'
    } else {
      Write-ErrorMessage 'Automatic rollback did not complete. Use the pre-restore backup folder as the manual rollback path.'
    }
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
  Write-CommandListItem -Number '8' -Name 'Advanced / Recovery: Restore local n8n from backup' -Description 'Restores a local database or entities backup after pre-restore backups and approval.'
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
    Write-N8nServiceStatus -RunningServices $runningServices
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
  Write-Host '  8. Advanced / Recovery: Restore local n8n from backup'
  Write-Host '  9. Command list'
  Write-Host '  10. Exit'
  Write-Host ''
}

Initialize-MenuRuntime

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
    '8' { Invoke-MenuAction { Restore-LocalN8nFromBackupMenu } }
    '9' { Invoke-MenuAction { Show-CommandList } }
    '10' { Clear-MenuScreen; Write-Success 'Bye.'; $script:ExitRequested = $true }
    default {
      Invoke-MenuAction { Write-Warning 'Choose a number from 1 to 10.' }
    }
  }
}

exit 0
