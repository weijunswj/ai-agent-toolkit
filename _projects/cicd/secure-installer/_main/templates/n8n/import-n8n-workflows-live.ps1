param(
  [string]$WorkflowDir = "n8n-workflows",
  [string]$PortableCredentialsFile = "n8n-workflows/toolkit/portable-credentials.json",
  [string]$DeploymentPolicyFile = "n8n-workflows/toolkit/deployment-policy.json",
  [string]$ResourceBindingsFile = ".n8n-local/n8n-resource-bindings.json",
  [string]$WorkflowIdentityFile = ".n8n-local/n8n-workflow-identities.json",
  [string]$ReportsDir = ".n8n-local/reports",
  [string]$BindingsFile = ".n8n-local\n8n-credential-bindings.json",
  [string]$Container,
  [string]$ContainerName,
  [string]$ContainerId,
  [string]$ComposeProject,
  [string]$ComposeService,
  [string]$PreparedDir = ".tmp/n8n-live-import",
  [string]$CredentialExportDir = ".tmp/n8n-live-credential-exports",
  [string]$ContainerDir = "/tmp",
  [ValidateSet("CreateNew", "UpdateArchived", "Block")]
  [string]$ArchivedByNameMode = "CreateNew",
  [string]$ProjectId,
  [string]$UserId,
  [switch]$AllowMissingCredentialBindings,
  [switch]$SkipCredentialBindingRefresh,
  [switch]$RestartContainerAfterImport,
  [switch]$RequireConfirmation,
  [switch]$ForceImport,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$DeploymentPolicyFileWasExplicit = $PSBoundParameters.ContainsKey("DeploymentPolicyFile")
$script:PortablePolicyPreflightPassed = -not $DeploymentPolicyFileWasExplicit

trap {
  $failure = $_
  if ((Get-Variable -Name credentialMetadataFile -ErrorAction SilentlyContinue) -and (Test-Path -LiteralPath $credentialMetadataFile -PathType Leaf)) {
    Remove-Item -LiteralPath $credentialMetadataFile -Force -ErrorAction SilentlyContinue
  }
  try {
    if ($script:PortablePolicyPreflightPassed -and -not $script:OperationReportWritten -and (Get-Variable -Name ReportsDirPath -ErrorAction SilentlyContinue) -and (Test-Path -LiteralPath $PreparedDirPath -PathType Container)) {
      $failureCode = "N8N_INTERNAL_ERROR"
      $failurePhase = "internal"
      if ($failure.Exception.Message -match '^(N8N_[A-Z_]+):') {
        $failureCode = $Matches[1]
        $failurePhase = if ($failureCode -eq "N8N_CREDENTIAL_DISCOVERY_UNAVAILABLE" -or $failureCode -eq "N8N_CREDENTIAL_CLEANUP_FAILED") { "discover-target-credential-metadata" } else { "internal" }
      }
      $reportWorkflows = if (Get-Variable -Name preflight -ErrorAction SilentlyContinue) { @($preflight.PlannedImports) } else { @() }
      $reportCredentials = if (Get-Variable -Name preflight -ErrorAction SilentlyContinue) { @($preflight.ReportCredentials) } else { @() }
      Write-N8nOperationReport "FAILED" $failureCode $failurePhase ([bool]$script:MutationAttempted) ([bool]$script:MutationPerformed) $reportWorkflows $reportCredentials "MAP_FROM_FAILURE_CODE" "Use the deterministic supported action for this failure code." "unknown"
    }
  } catch {
    Write-Host "N8N_INTERNAL_ERROR: sanitized failure report could not be written." -ForegroundColor Red
  }
  Write-Host ""
  Write-Host "== " -NoNewline -ForegroundColor DarkGray
  Write-Host "Import failed" -NoNewline -ForegroundColor Red
  Write-Host " ==" -ForegroundColor DarkGray
  Write-Host ($failure.Exception.Message) -ForegroundColor Red
  exit 1
}

if (-not $PSScriptRoot) {
  throw "This script must be run from a .ps1 file."
}

if (-not [string]::IsNullOrWhiteSpace($ProjectId) -and -not [string]::IsNullOrWhiteSpace($UserId)) {
  throw "ProjectId and UserId cannot both be set. Choose one import target."
}

function Test-RepoRootPathIsUnsafe($Path) {
  if ([string]::IsNullOrWhiteSpace($Path)) {
    return $true
  }

  $fullPath = [System.IO.Path]::GetFullPath($Path).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
  $pathRoot = [System.IO.Path]::GetPathRoot($fullPath)
  if ([string]::IsNullOrWhiteSpace($pathRoot)) {
    return $true
  }

  $trimmedRoot = $pathRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
  return $fullPath -eq $trimmedRoot
}

function Assert-StrictRepoChildPath($Path, $Label) {
  $repoFull = [System.IO.Path]::GetFullPath($RepoRoot).TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
  $candidateFull = [System.IO.Path]::GetFullPath($Path)
  $prefix = $repoFull + [System.IO.Path]::DirectorySeparatorChar
  if (-not $candidateFull.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "N8N_POLICY_VALIDATION_FAILED: $Label must remain inside the resolved repository root."
  }
}

function Test-N8nRepoRootCandidate($Path) {
  if (Test-RepoRootPathIsUnsafe $Path) {
    return $false
  }

  $hasGit = Test-Path -LiteralPath (Join-Path $Path ".git")
  $hasWorkflowDir = Test-Path -LiteralPath (Join-Path $Path "n8n-workflows") -PathType Container
  $hasToolkitMarkers = (
    (Test-Path -LiteralPath (Join-Path $Path "repo/scripts/sync-toolkit-projects.cjs") -PathType Leaf) -and
    (Test-Path -LiteralPath (Join-Path $Path "_projects/n8n/workflow-toolkit/toolkit.project.json") -PathType Leaf)
  )

  return ($hasGit -and $hasWorkflowDir) -or ($hasGit -and $hasToolkitMarkers)
}

function Resolve-RepoRootFromScript {
  $current = (Resolve-Path -LiteralPath $PSScriptRoot).Path
  while ($true) {
    if (Test-RepoRootPathIsUnsafe $current) {
      throw "Refusing filesystem root as repo root: $current. Could not resolve safe repo root from $PSScriptRoot."
    }

    if (Test-N8nRepoRootCandidate $current) {
      return $current
    }

    $parent = Split-Path -Parent $current
    if ([string]::IsNullOrWhiteSpace($parent) -or $parent -eq $current) {
      throw "Could not resolve safe repo root from $PSScriptRoot. Run this helper from inside a Git repo with n8n-workflows/ at the root, or inside the ai-agent-toolkit repo."
    }
    $current = $parent
  }
}

$HelperScriptDir = (Resolve-Path $PSScriptRoot).Path
$RepoRoot = Resolve-RepoRootFromScript
Set-Location $RepoRoot

function Write-Section($Title) {
  Write-Host ""
  Write-Host "== " -NoNewline -ForegroundColor DarkGray
  Write-Host $Title -NoNewline -ForegroundColor Cyan
  Write-Host " ==" -ForegroundColor DarkGray
}

function Get-StatusColor($Status) {
  switch (([string]$Status).Trim().ToUpperInvariant()) {
    { $_ -in @("OK", "VALID", "READY", "DONE", "FOUND", "MATCH", "CREATE", "EXPORT", "IMPORT", "RESTART", "CLEAR", "WRITE", "SAVE") } { return "Green" }
    { $_ -in @("WARN", "ARCHIVE", "DUP", "MISSING", "RETRY") } { return "Yellow" }
    { $_ -in @("FAIL", "BLOCK", "CANCEL") } { return "Red" }
    "SKIP" { return "DarkGray" }
    { $_ -in @("LIVE", "CHECK", "PLAN", "INFO", "START", "HOOK", "ID", "CRED", "FORCE", "NOTE") } { return "Cyan" }
    default { return "Gray" }
  }
}

function Write-StatusTag($Status) {
  $statusText = ([string]$Status).PadRight(7)
  Write-Host "[" -NoNewline -ForegroundColor DarkGray
  Write-Host $statusText -NoNewline -ForegroundColor (Get-StatusColor $statusText)
  Write-Host "]" -NoNewline -ForegroundColor DarkGray
}

function Write-Step($Status, $Message) {
  Write-StatusTag $Status
  Write-Host " $Message"
}

function Write-CommandOutput($Lines, [string]$DefaultStatus = "INFO") {
  foreach ($line in @($Lines)) {
    if ([string]::IsNullOrWhiteSpace([string]$line)) {
      continue
    }

    $text = [string]$line
    if ($text -match '^==\s*(.+?)\s*==$') {
      Write-Section $Matches[1]
      continue
    }

    if ($text -match '^\[([^\]]+)\]\s*(.*)$') {
      Write-Step $Matches[1].Trim() $Matches[2]
      continue
    }

    if ($text -match '^Checked\s+') {
      Write-Step "VALID" $text
      continue
    }

    if ($text -match '^WARN:\s*(.*)$') {
      Write-Step "WARN" $Matches[1]
      continue
    }

    if ($text -match '^FAIL:\s*(.*)$') {
      Write-Step "FAIL" $Matches[1]
      continue
    }

    if ($text -match '^Summary:') {
      Write-Step $DefaultStatus $text
      continue
    }

    Write-Host $text
  }
}

function ConvertTo-NativeArgument([string]$Value) {
  if ($null -eq $Value) { $Value = "" }
  if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') { return $Value }
  $escaped = [regex]::Replace($Value, '(\\*)"', {
    param($match)
    return (-join ('\' * (($match.Groups[1].Value.Length * 2) + 1))) + '"'
  })
  $escaped = [regex]::Replace($escaped, '(\\+)$', {
    param($match)
    return $match.Value + $match.Value
  })
  return '"' + $escaped + '"'
}

function Invoke-CapturedCommand($Command, [string[]]$Arguments) {
  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo.FileName = $Command
  $process.StartInfo.Arguments = ($Arguments | ForEach-Object { ConvertTo-NativeArgument ([string]$_) }) -join " "
  $process.StartInfo.RedirectStandardOutput = $true
  $process.StartInfo.RedirectStandardError = $true
  $process.StartInfo.UseShellExecute = $false
  $process.StartInfo.CreateNoWindow = $true
  if (-not [string]::IsNullOrWhiteSpace($RepoRoot)) {
    $process.StartInfo.WorkingDirectory = $RepoRoot
  }
  $process.StartInfo.StandardOutputEncoding = [System.Text.Encoding]::UTF8
  $process.StartInfo.StandardErrorEncoding = [System.Text.Encoding]::UTF8

  [void]$process.Start()
  $stdoutTask = $process.StandardOutput.ReadToEndAsync()
  $stderrTask = $process.StandardError.ReadToEndAsync()
  $process.WaitForExit()
  $stdout = $stdoutTask.GetAwaiter().GetResult()
  $stderr = $stderrTask.GetAwaiter().GetResult()

  $stdoutLines = @($stdout -split "`r?`n" | Where-Object { $_ -ne "" })
  $stderrLines = @($stderr -split "`r?`n" | Where-Object { $_ -ne "" })

  [PSCustomObject]@{
    ExitCode = $process.ExitCode
    StdOut = $stdoutLines
    StdErr = $stderrLines
    Output = @($stdoutLines + $stderrLines)
  }
}

function Resolve-LiveContainerTarget {
  $resolverScript = Join-Path $HelperScriptDir "resolve-n8n-docker-target.cjs"
  if (-not (Test-Path -LiteralPath $resolverScript -PathType Leaf)) {
    throw "Trusted n8n Docker target resolver not found: $resolverScript"
  }

  $targetJsonPath = [System.IO.Path]::GetTempFileName()
  $candidatesJsonPath = [System.IO.Path]::GetTempFileName()
  $resolverArgs = @($resolverScript, "--json-output", $targetJsonPath, "--candidates-json-output", $candidatesJsonPath)
  if (-not [string]::IsNullOrWhiteSpace($ContainerId)) {
    $resolverArgs += @("--container-id", $ContainerId)
  }
  if (-not [string]::IsNullOrWhiteSpace($ContainerName)) {
    $resolverArgs += @("--container-name", $ContainerName)
  } elseif (-not [string]::IsNullOrWhiteSpace($Container)) {
    $resolverArgs += @("--container", $Container)
  }
  if (-not [string]::IsNullOrWhiteSpace($ComposeProject)) {
    $resolverArgs += @("--compose-project", $ComposeProject)
  }
  if (-not [string]::IsNullOrWhiteSpace($ComposeService)) {
    $resolverArgs += @("--compose-service", $ComposeService)
  }

  $target = $null
  try {
    & node @resolverArgs
    $resolverExitCode = $LASTEXITCODE
    if ($resolverExitCode -eq 3) {
      $parsedCandidates = Get-Content -LiteralPath $candidatesJsonPath -Raw | ConvertFrom-Json
      $candidates = if ($parsedCandidates -is [System.Array]) { $parsedCandidates } else { @($parsedCandidates) }
      $answer = Read-Host "Select n8n target number for this run"
      $trimmedAnswer = ([string]$answer).Trim()
      if ($trimmedAnswer -notmatch '^\d+$') {
        throw "Target selection terminated. Relaunch the helper and select a valid target number."
      }
      $selectedIndex = [int]$trimmedAnswer
      if ($selectedIndex -lt 1 -or $selectedIndex -gt $candidates.Count) {
        throw "Target selection terminated. Relaunch the helper and select a valid target number."
      }
      $target = $candidates[$selectedIndex - 1]
    } elseif ($resolverExitCode -ne 0) {
      throw "Could not resolve a running n8n Docker target. See resolver output above and rerun with an explicit target if needed."
    } else {
      $targetJson = Get-Content -LiteralPath $targetJsonPath -Raw
      $target = $targetJson | ConvertFrom-Json
    }
  } finally {
    Remove-Item -LiteralPath $targetJsonPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $candidatesJsonPath -Force -ErrorAction SilentlyContinue
  }

  if ($null -eq $target -or [string]::IsNullOrWhiteSpace([string]$target.container_id)) {
    throw "n8n Docker target resolver returned no container id."
  }

  $script:Container = [string]$target.container_id
  $script:ResolvedN8nTarget = $target
  $targetLabel = "{0} ({1})" -f $target.container_name, $target.container_id_prefix
  if (-not [string]::IsNullOrWhiteSpace([string]$target.compose_project) -or -not [string]::IsNullOrWhiteSpace([string]$target.compose_service)) {
    $targetLabel = "{0}/{1} -> {2}" -f $target.compose_project, $target.compose_service, $targetLabel
  }
  Write-Step "OK" "Using n8n Docker target $targetLabel."
}

function Write-Utf8NoBomText($Path, $Text) {
  $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText($Path, [string]$Text, $utf8NoBom)
}
function Get-PathStringComparison {
  if ([System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([System.Runtime.InteropServices.OSPlatform]::Windows)) {
    return [System.StringComparison]::OrdinalIgnoreCase
  }

  return [System.StringComparison]::Ordinal
}

function Get-NormalizedFullPath($Path) {
  $fullPath = [System.IO.Path]::GetFullPath($Path)
  $trimmedPath = $fullPath.TrimEnd([System.IO.Path]::DirectorySeparatorChar, [System.IO.Path]::AltDirectorySeparatorChar)
  if ([string]::IsNullOrWhiteSpace($trimmedPath)) {
    return $fullPath
  }

  return $trimmedPath
}

function Test-PathIsStrictChild($Path, $ParentPath) {
  $resolvedPath = Get-NormalizedFullPath $Path
  $resolvedParentPath = Get-NormalizedFullPath $ParentPath
  $comparison = Get-PathStringComparison

  if ($resolvedPath.Equals($resolvedParentPath, $comparison)) {
    return $false
  }

  $parentPrefix = $resolvedParentPath + [System.IO.Path]::DirectorySeparatorChar
  return $resolvedPath.StartsWith($parentPrefix, $comparison)
}

function Test-PathItemIsUnsafeLink($Item) {
  if ($null -eq $Item) {
    return $false
  }

  if (($Item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    return $true
  }

  $linkTypeProperty = $Item.PSObject.Properties["LinkType"]
  if ($linkTypeProperty -and -not [string]::IsNullOrWhiteSpace([string]$linkTypeProperty.Value)) {
    return $true
  }

  return $false
}

function Assert-RunDirectoryPathHasNoUnsafeLinks($Path, $TmpRoot) {
  $resolvedPath = Get-NormalizedFullPath $Path
  $resolvedTmpRoot = Get-NormalizedFullPath $TmpRoot
  $comparison = Get-PathStringComparison
  $current = $resolvedPath

  while (-not [string]::IsNullOrWhiteSpace($current)) {
    if (Test-Path -LiteralPath $current) {
      $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
      if (Test-PathItemIsUnsafeLink $item) {
        throw "Refusing to clear unsafe run directory because a path component is a symlink, junction, or reparse point: $current"
      }
    }

    if ($current.Equals($resolvedTmpRoot, $comparison)) {
      return
    }

    $parent = Split-Path -Parent $current
    if ([string]::IsNullOrWhiteSpace($parent) -or $parent.Equals($current, $comparison)) {
      break
    }
    $current = Get-NormalizedFullPath $parent
  }

  throw "Refusing to clear unsafe run directory because its path components could not be verified under .tmp/: $resolvedPath"
}

function Assert-RepoFilePathHasNoUnsafeLinks($Path, $Label) {
  $resolvedPath = Get-NormalizedFullPath $Path
  $resolvedRepoRoot = Get-NormalizedFullPath $RepoRoot
  $comparison = Get-PathStringComparison
  $current = $resolvedPath

  while (-not [string]::IsNullOrWhiteSpace($current)) {
    if (Test-Path -LiteralPath $current) {
      $item = Get-Item -LiteralPath $current -Force -ErrorAction Stop
      if (Test-PathItemIsUnsafeLink $item) {
        throw "N8N_POLICY_VALIDATION_FAILED: $Label contains a symlink, junction, or redirected path."
      }
    }
    if ($current.Equals($resolvedRepoRoot, $comparison)) {
      return
    }
    $parent = Split-Path -Parent $current
    if ([string]::IsNullOrWhiteSpace($parent) -or $parent.Equals($current, $comparison)) {
      break
    }
    $current = Get-NormalizedFullPath $parent
  }

  throw "N8N_POLICY_VALIDATION_FAILED: $Label could not be verified inside the repository boundary."
}

function Get-ByteSha256($Bytes) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    return ([System.BitConverter]::ToString($sha.ComputeHash($Bytes))).Replace("-", "")
  } finally {
    $sha.Dispose()
  }
}

function Read-SafeDeploymentPolicySnapshot {
  Assert-StrictRepoChildPath $DeploymentPolicyFilePath "Deployment policy"
  Assert-RepoFilePathHasNoUnsafeLinks $DeploymentPolicyFilePath "Deployment policy"
  try {
    $itemBefore = Get-Item -LiteralPath $DeploymentPolicyFilePath -Force -ErrorAction Stop
    if (
      $itemBefore -is [System.IO.FileInfo] -and
      -not $itemBefore.PSIsContainer -and
      -not (Test-PathItemIsUnsafeLink $itemBefore)
    ) {
      $bytes = [System.IO.File]::ReadAllBytes($DeploymentPolicyFilePath)
    } else {
      throw "not a safe regular file"
    }
    $itemAfter = Get-Item -LiteralPath $DeploymentPolicyFilePath -Force -ErrorAction Stop
  } catch {
    throw "N8N_POLICY_VALIDATION_FAILED: the explicitly configured deployment policy is unavailable or unreadable."
  }
  if (
    -not ($itemAfter -is [System.IO.FileInfo]) -or
    $itemAfter.PSIsContainer -or
    (Test-PathItemIsUnsafeLink $itemAfter) -or
    $itemBefore.FullName -ne $itemAfter.FullName -or
    $itemBefore.Length -ne $itemAfter.Length -or
    $itemBefore.CreationTimeUtc.Ticks -ne $itemAfter.CreationTimeUtc.Ticks -or
    $itemBefore.LastWriteTimeUtc.Ticks -ne $itemAfter.LastWriteTimeUtc.Ticks
  ) {
    throw "N8N_POLICY_VALIDATION_FAILED: the explicitly configured deployment policy changed identity while it was read."
  }
  $text = [System.Text.Encoding]::UTF8.GetString($bytes).TrimStart([char]0xFEFF)
  try {
    $null = $text | ConvertFrom-Json
  } catch {
    throw "N8N_POLICY_VALIDATION_FAILED: the explicitly configured deployment policy is invalid JSON."
  }
  return [PSCustomObject]@{
    Content = $text
    Hash = Get-ByteSha256 $bytes
    Length = [long]$itemAfter.Length
    CreationTimeUtcTicks = [long]$itemAfter.CreationTimeUtc.Ticks
    LastWriteTimeUtcTicks = [long]$itemAfter.LastWriteTimeUtc.Ticks
  }
}

function Assert-DeploymentPolicySnapshotCurrent($Snapshot) {
  $current = Read-SafeDeploymentPolicySnapshot
  if (
    $current.Hash -ne $Snapshot.Hash -or
    $current.Length -ne $Snapshot.Length -or
    $current.CreationTimeUtcTicks -ne $Snapshot.CreationTimeUtcTicks -or
    $current.LastWriteTimeUtcTicks -ne $Snapshot.LastWriteTimeUtcTicks
  ) {
    throw "N8N_POLICY_VALIDATION_FAILED: the explicitly configured deployment policy changed after validation."
  }
}

function Get-DisplayPath($Path) {
  $resolvedPath = Get-NormalizedFullPath $Path
  $rootPrefix = (Get-NormalizedFullPath $RepoRoot) + [System.IO.Path]::DirectorySeparatorChar
  if ($resolvedPath.StartsWith($rootPrefix, (Get-PathStringComparison))) {
    return $resolvedPath.Substring($rootPrefix.Length)
  }

  return $resolvedPath
}

function Resolve-ProjectWorkflowHookScripts {
  $candidates = New-Object System.Collections.Generic.List[object]

  function Add-HookScriptCandidate([string]$HookPath, [bool]$Required) {
    if ([string]::IsNullOrWhiteSpace($HookPath)) {
      return
    }

    if ([System.IO.Path]::IsPathRooted($HookPath)) {
      $fullPath = [System.IO.Path]::GetFullPath($HookPath)
    } else {
      $fullPath = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot $HookPath))
    }

    $candidates.Add([PSCustomObject]@{
      Path = $fullPath
      Required = $Required
    })
  }

  # Generic import extension point:
  # keep this script project-agnostic. If a target repo needs import/export
  # cleanup, repair, or normalisation, add scripts/n8n-workflow-hooks.* in that
  # repo instead of hardcoding workflow-specific rules here.
  if (-not [string]::IsNullOrWhiteSpace($env:N8N_WORKFLOW_HOOK_SCRIPT)) {
    foreach ($hookPath in @($env:N8N_WORKFLOW_HOOK_SCRIPT -split ';')) {
      Add-HookScriptCandidate $hookPath $true
    }
  }

  if ($env:N8N_WORKFLOW_HOOK_AUTOLOAD -match '^(?i:true|1|yes|on)$') {
    foreach ($relativePath in @(
      "scripts/n8n-workflow-hooks.cjs",
      "scripts/n8n-workflow-hooks.js",
      "scripts/n8n-workflow-hooks.ps1",
      ".n8n-local/n8n-workflow-hooks.cjs",
      ".n8n-local/n8n-workflow-hooks.js",
      ".n8n-local/n8n-workflow-hooks.ps1",
      ".n8n-workflow-hooks.cjs",
      ".n8n-workflow-hooks.js",
      ".n8n-workflow-hooks.ps1"
    )) {
      Add-HookScriptCandidate $relativePath $false
    }
  }

  $seen = @{}
  $existingScripts = @()
  foreach ($candidate in $candidates) {
    $script = $candidate.Path
    if ($seen.ContainsKey($script)) {
      continue
    }
    $seen[$script] = $true
    if (Test-Path -LiteralPath $script -PathType Leaf) {
      $existingScripts += $script
    } elseif ($candidate.Required) {
      throw "Configured n8n workflow hook script not found: $(Get-DisplayPath $script)"
    }
  }

  return $existingScripts
}

function Resolve-PowerShellHookCommand {
  $currentProcessPath = [System.Diagnostics.Process]::GetCurrentProcess().Path
  if (-not [string]::IsNullOrWhiteSpace($currentProcessPath) -and (Test-Path -LiteralPath $currentProcessPath -PathType Leaf)) {
    return $currentProcessPath
  }

  foreach ($candidate in @("pwsh", "powershell")) {
    $commandInfo = Get-Command $candidate -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($commandInfo -and -not [string]::IsNullOrWhiteSpace($commandInfo.Source)) {
      return $commandInfo.Source
    }
  }

  throw "Could not find a PowerShell host to run .ps1 n8n workflow hook scripts. Install pwsh or powershell."
}

function Invoke-ProjectWorkflowHook($HookName, [hashtable]$Context) {
  $hookScripts = @(Resolve-ProjectWorkflowHookScripts)
  if ($hookScripts.Count -eq 0) {
    return
  }

  $hookArgs = @($HookName, "--repo-root", $RepoRoot)
  foreach ($key in @($Context.Keys | Sort-Object)) {
    $value = $Context[$key]
    if ($null -eq $value -or [string]::IsNullOrWhiteSpace([string]$value)) {
      continue
    }
    $hookArgs += "--$key"
    $hookArgs += [string]$value
  }

  foreach ($hookScript in $hookScripts) {
    $extension = [System.IO.Path]::GetExtension($hookScript).ToLowerInvariant()
    if ($extension -eq ".cjs" -or $extension -eq ".js") {
      $command = "node"
      $arguments = @($hookScript) + $hookArgs
    } elseif ($extension -eq ".ps1") {
      $command = Resolve-PowerShellHookCommand
      $arguments = @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $hookScript) + $hookArgs
    } elseif ($extension -eq ".cmd" -or $extension -eq ".bat") {
      $command = $hookScript
      $arguments = $hookArgs
    } else {
      throw "Unsupported n8n workflow hook extension '$extension' for $hookScript. Use .cjs, .js, .ps1, .cmd, or .bat."
    }

    Write-Step "HOOK" "$HookName -> $(Get-DisplayPath $hookScript)"
    $hookResult = Invoke-CapturedCommand $command $arguments
    if ($hookResult.Output.Count -gt 0) {
      Write-Host ($hookResult.Output -join "`n")
    }
    if ($hookResult.ExitCode -ne 0) {
      throw "Project n8n workflow hook '$HookName' failed: $hookScript"
    }
  }
}

function Initialize-RunDirectory($Path) {
  $resolvedPath = Get-NormalizedFullPath $Path
  $tmpRoot = Get-NormalizedFullPath (Join-Path $RepoRoot ".tmp")
  if (-not (Test-PathIsStrictChild $resolvedPath $tmpRoot)) {
    throw "Refusing to clear unsafe run directory. Clearable run directories must be inside .tmp/ and must not be .tmp itself: $resolvedPath"
  }

  Assert-RunDirectoryPathHasNoUnsafeLinks $resolvedPath $tmpRoot

  if (Test-Path -LiteralPath $resolvedPath) {
    Remove-Item -LiteralPath $resolvedPath -Recurse -Force
  }
  New-Item -ItemType Directory -Force -Path $resolvedPath | Out-Null
}

function Resolve-WorkflowDirPath {
  if ($WorkflowDir -ne "n8n-workflows") {
    throw "Only n8n-workflows is supported. Pass -WorkflowDir n8n-workflows or move workflow JSON files into n8n-workflows/."
  }

  return (Join-Path $RepoRoot "n8n-workflows")
}

function Test-MissingLiveWorkflow($CommandResult) {
  return (($CommandResult.Output -join "`n") -match "No workflows found with specified filters")
}

function Get-FirstOutputLine($CommandResult) {
  $text = ($CommandResult.Output | Out-String).Trim()
  if ([string]::IsNullOrWhiteSpace($text)) {
    return "No output returned."
  }

  return ($text -split "`r?`n")[0]
}

function Read-RepoWorkflowInfo($WorkflowFile) {
  $workflow = Get-Content -Raw -Path $WorkflowFile.FullName | ConvertFrom-Json
  $workflowId = [string]$workflow.id
  $workflowName = [string]$workflow.name
  if ([string]::IsNullOrWhiteSpace($workflowName)) {
    throw "Workflow file $($WorkflowFile.FullName) does not contain a top-level name."
  }

  [PSCustomObject]@{
    File = $WorkflowFile
    Workflow = $workflow
    Id = $workflowId
    Name = $workflowName
  }
}

function Get-WorkflowCheckLabel($WorkflowFile, $WorkflowId) {
  if ([string]::IsNullOrWhiteSpace($WorkflowId)) {
    return "$($WorkflowFile.Name) (id: not set, matching by name)"
  }

  return "$($WorkflowFile.Name) ($WorkflowId)"
}

function New-WorkflowId {
  return [guid]::NewGuid().ToString("D")
}

function Invoke-LivePreflight {
  Write-Section "Live n8n Preflight"
  $dockerResult = Invoke-CapturedCommand "docker" @("version", "--format", "{{.Server.Version}}")
  if ($dockerResult.ExitCode -ne 0) {
    throw "Docker is not reachable.`n$($dockerResult.Output -join "`n")"
  }
  Write-Step "OK" "Docker is reachable."

  Resolve-LiveContainerTarget
}

function Get-LiveWorkflows {
  $result = Invoke-CapturedCommand "docker" @("exec", $Container, "n8n", "export:workflow", "--all", "--pretty")
  if ($result.ExitCode -ne 0) {
    if (Test-MissingLiveWorkflow $result) {
      return @()
    }
    throw "Failed to list live workflows from container $Container.`n$($result.Output -join "`n")"
  }

  $exportText = ($result.StdOut -join "`n").Trim()
  if ([string]::IsNullOrWhiteSpace($exportText)) {
    return @()
  }

  $workflows = $exportText | ConvertFrom-Json
  if ($workflows -isnot [array]) {
    $workflows = @($workflows)
  }

  return @($workflows)
}

function Test-NoCredentialsExportResult($CommandResult) {
  return (($CommandResult.Output -join "`n") -match "No credentials found")
}

function Get-SafeCredentialMetadata {
  Write-Section "Credential Metadata Discovery"
  $operationToken = ([Guid]::NewGuid().ToString("N"))
  $containerRoot = "$ContainerDir/ai-agent-toolkit-n8n"
  $containerOperationDir = "$containerRoot/$operationToken"
  $containerHelper = "$ContainerDir/ai-agent-toolkit-n8n-metadata-$operationToken.cjs"
  $encryptedExport = "$containerOperationDir/credentials.encrypted.json"
  $containerMetadata = "$containerOperationDir/credential-metadata.json"
  $localMetadata = Join-Path $PreparedDirPath "credential-metadata-$operationToken.json"
  $helperSource = Join-Path $HelperScriptDir "n8n-credential-metadata.cjs"
  $operationCreated = $false
  $cleanupFailure = $null

  try {
    $stageCheckScript = "const fs=require('node:fs'),path=require('node:path');const p=path.resolve(process.argv[1]),base=path.resolve(process.argv[2]);const s=fs.lstatSync(base);if(s.isSymbolicLink()||fs.realpathSync.native(base)!==base||fs.existsSync(p))process.exit(1);"
    $stageCheckResult = Invoke-CapturedCommand "docker" @("exec", $Container, "node", "-e", $stageCheckScript, $containerHelper, $ContainerDir)
    if ($stageCheckResult.ExitCode -ne 0) {
      throw "N8N_CREDENTIAL_DISCOVERY_UNAVAILABLE: Could not prove a safe target-local helper staging path."
    }

    $copyHelperResult = Invoke-CapturedCommand "docker" @("cp", $helperSource, "${Container}:$containerHelper")
    if ($copyHelperResult.ExitCode -ne 0) {
      throw "N8N_CREDENTIAL_DISCOVERY_UNAVAILABLE: Could not stage the credential-metadata extractor in the target container."
    }

    $initResult = Invoke-CapturedCommand "docker" @("exec", $Container, "node", $containerHelper, "init", $containerOperationDir, $containerRoot)
    if ($initResult.ExitCode -ne 0) {
      throw "N8N_CREDENTIAL_DISCOVERY_UNAVAILABLE: Toolkit-owned credential-metadata storage failed its path-safety checks."
    }
    $operationCreated = $true

    # Official n8n server CLI exports encrypted credential data by default. It stays
    # inside this restrictive target-local directory; only id, name, and type leave it.
    $exportResult = Invoke-CapturedCommand "docker" @("exec", $Container, "n8n", "export:credentials", "--all", "--output=$encryptedExport")
    if ($exportResult.ExitCode -eq 0) {
      $extractResult = Invoke-CapturedCommand "docker" @("exec", $Container, "node", $containerHelper, "extract", $encryptedExport, $containerMetadata, $containerOperationDir)
    } elseif (Test-NoCredentialsExportResult $exportResult) {
      $extractResult = Invoke-CapturedCommand "docker" @("exec", $Container, "node", $containerHelper, "empty", $containerMetadata, $containerOperationDir)
    } else {
      throw "N8N_CREDENTIAL_DISCOVERY_UNAVAILABLE: The supported encrypted credential export was unavailable. No database or undocumented API fallback was attempted."
    }
    if ($extractResult.ExitCode -ne 0) {
      throw "N8N_CREDENTIAL_DISCOVERY_UNAVAILABLE: Credential metadata extraction failed its safety checks."
    }

    $copyMetadataResult = Invoke-CapturedCommand "docker" @("cp", "${Container}:$containerMetadata", $localMetadata)
    if ($copyMetadataResult.ExitCode -ne 0) {
      throw "N8N_CREDENTIAL_DISCOVERY_UNAVAILABLE: Could not copy sanitized credential metadata from the target container."
    }

    $metadata = Get-Content -LiteralPath $localMetadata -Raw | ConvertFrom-Json
    Write-Step "SAFE" "Discovered metadata for $(@($metadata).Count) credential(s); encrypted values and target IDs were not printed."
    return $localMetadata
  } finally {
    if ($operationCreated) {
      $cleanupResult = Invoke-CapturedCommand "docker" @("exec", $Container, "node", $containerHelper, "cleanup", $containerOperationDir, $containerRoot)
      if ($cleanupResult.ExitCode -ne 0) {
        $cleanupFailure = "N8N_CREDENTIAL_CLEANUP_FAILED: Encrypted credential metadata temporary cleanup did not complete; import is blocked."
      }
    }
    $removeHelperScript = "const fs=require('node:fs');const p=process.argv[1];if(fs.existsSync(p)){const s=fs.lstatSync(p);if(!s.isFile()||s.isSymbolicLink())process.exit(1);fs.rmSync(p,{force:false});}"
    $null = Invoke-CapturedCommand "docker" @("exec", $Container, "node", "-e", $removeHelperScript, $containerHelper)
    if ($null -ne $cleanupFailure) {
      throw $cleanupFailure
    }
  }
}

function Assert-PortableDocumentsReadable {
  foreach ($document in @($PortableCredentialsFilePath, $DeploymentPolicyFilePath)) {
    if (Test-Path -LiteralPath $document -PathType Leaf) {
      try {
        $null = Get-Content -LiteralPath $document -Raw | ConvertFrom-Json
      } catch {
        throw "N8N_POLICY_VALIDATION_FAILED: portable credential or deployment policy document is invalid JSON."
      }
    }
  }
}

function Get-LocalWorkflowIdentityId($WorkflowFile, $WorkflowName) {
  $resultFile = Join-Path $PreparedDirPath "$($WorkflowFile.BaseName).identity-result.json"
  Remove-Item -LiteralPath $resultFile -Force -ErrorAction SilentlyContinue
  $result = Invoke-CapturedCommand "node" @(
    (Join-Path $HelperScriptDir "n8n-workflow-identity.cjs"),
    "resolve",
    "--state", $WorkflowIdentityFilePath,
    "--repo-root", $RepoRoot,
    "--workflow-file", $WorkflowFile.Name,
    "--workflow-name", $WorkflowName,
    "--result", $resultFile
  )
  if ($result.ExitCode -ne 0) {
    throw "N8N_POLICY_VALIDATION_FAILED: local target workflow identity could not be resolved safely."
  }
  $identity = Get-Content -LiteralPath $resultFile -Raw | ConvertFrom-Json
  Remove-Item -LiteralPath $resultFile -Force -ErrorAction SilentlyContinue
  if (-not [string]::IsNullOrWhiteSpace([string]$identity.targetWorkflowId)) {
    if (-not [string]::Equals([string]$identity.workflowFile, [string]$WorkflowFile.Name, [System.StringComparison]::Ordinal)) {
      throw "N8N_POLICY_VALIDATION_FAILED: local target workflow identity does not match the exact canonical workflow file."
    }
    if (-not [string]::Equals([string]$identity.workflowName, [string]$WorkflowName, [System.StringComparison]::Ordinal)) {
      throw "N8N_POLICY_VALIDATION_FAILED: local target workflow identity does not match the intended workflow name."
    }
  }
  return [string]$identity.targetWorkflowId
}

function Save-LocalWorkflowIdentity($PlannedImport) {
  $result = Invoke-CapturedCommand "node" @(
    (Join-Path $HelperScriptDir "n8n-workflow-identity.cjs"),
    "record",
    "--state", $WorkflowIdentityFilePath,
    "--repo-root", $RepoRoot,
    "--workflow-file", $PlannedImport.File,
    "--workflow-name", $PlannedImport.WorkflowName,
    "--target-workflow-id", $PlannedImport.TargetId
  )
  if ($result.ExitCode -ne 0) {
    throw "N8N_POSTCONDITION_FAILED: inactive import succeeded but dedicated local target workflow identity could not be recorded safely."
  }
  Write-Step "IDENTITY" "$($PlannedImport.File) target identity was recorded locally without printing its ID."
}

function Test-PortableTargetResolution($WorkflowFiles, $LiveWorkflows) {
  $blocked = @()
  foreach ($workflowFile in $WorkflowFiles) {
    $workflowInfo = Read-RepoWorkflowInfo $workflowFile
    $localWorkflowId = Get-LocalWorkflowIdentityId $workflowFile $workflowInfo.Name
    $workflowId = $localWorkflowId
    if ([string]::IsNullOrWhiteSpace($workflowId)) { $workflowId = $workflowInfo.Id }
    $workflowName = $workflowInfo.Name
    $target = $null
    $matchedByCanonicalId = $false

    if (-not [string]::IsNullOrWhiteSpace($workflowId)) {
      $idMatches = @($LiveWorkflows | Where-Object { [string]$_.id -eq $workflowId })
      if ($idMatches.Count -gt 1) {
        $blocked += [PSCustomObject]@{ File = $workflowFile.Name; WorkflowName = $workflowName; Reason = "N8N_WORKFLOW_MATCH_AMBIGUOUS: multiple target workflows matched the canonical workflow ID."; Kind = "N8N_WORKFLOW_MATCH_AMBIGUOUS" }
        continue
      }
      if ($idMatches.Count -eq 1) { $target = $idMatches[0]; $matchedByCanonicalId = $true }
      if ($idMatches.Count -eq 0 -and -not [string]::IsNullOrWhiteSpace($localWorkflowId)) {
        $blocked += [PSCustomObject]@{ File = $workflowFile.Name; WorkflowName = $workflowName; Reason = "N8N_POLICY_VALIDATION_FAILED: dedicated local target identity no longer exists; refusing a same-name fallback."; Kind = "N8N_POLICY_VALIDATION_FAILED" }
        continue
      }
    }
    if ($null -eq $target) {
      $nameResolution = Resolve-LiveWorkflowByName $workflowName $workflowFile.Name $LiveWorkflows
      if ($nameResolution.Status -eq "Blocked") {
        $blocked += [PSCustomObject]@{ File = $workflowFile.Name; WorkflowName = $workflowName; Reason = "N8N_WORKFLOW_MATCH_AMBIGUOUS: $($nameResolution.Reason)"; Kind = "N8N_WORKFLOW_MATCH_AMBIGUOUS" }
        continue
      }
      if ($nameResolution.Status -eq "Found" -or $nameResolution.Status -eq "FoundArchived") {
        $target = $nameResolution.Workflow
      }
    }
    if ($null -ne $target -and $target.active -eq $true) {
      $blocked += [PSCustomObject]@{ File = $workflowFile.Name; WorkflowName = $workflowName; Reason = "N8N_POLICY_VALIDATION_FAILED: target workflow is active, so inactive import cannot guarantee that no scheduled execution persists."; Kind = "N8N_POLICY_VALIDATION_FAILED" }
    } elseif ($null -ne $target -and $target.isArchived -eq $true -and -not $matchedByCanonicalId -and $ArchivedByNameMode -eq "Block") {
      $blocked += [PSCustomObject]@{ File = $workflowFile.Name; WorkflowName = $workflowName; Reason = "N8N_POLICY_VALIDATION_FAILED: archived target workflow is blocked by ArchivedByNameMode."; Kind = "N8N_POLICY_VALIDATION_FAILED" }
    }
  }
  return @($blocked)
}

function Get-RootWorkflowFiles($WorkflowDirPath) {
  if (-not (Test-Path -Path $WorkflowDirPath -PathType Container)) {
    throw "Workflow directory not found: n8n-workflows. Create n8n-workflows/ or run AllLive export to bootstrap from live n8n."
  }

  $workflowFiles = @(Get-ChildItem -Path $WorkflowDirPath -Filter "*.json" -File | Sort-Object Name)
  if (-not $workflowFiles) {
    throw "No root-level workflow JSON files found in $(Get-DisplayPath $WorkflowDirPath)."
  }

  return $workflowFiles
}

function Assert-NoCaseFoldedWorkflowFileCollisions($WorkflowFiles) {
  $seen = New-Object 'System.Collections.Generic.Dictionary[string,string]' -ArgumentList ([System.StringComparer]::OrdinalIgnoreCase)
  foreach ($workflowFile in @($WorkflowFiles)) {
    $name = [string]$workflowFile.Name
    if ($seen.ContainsKey($name) -and -not [string]::Equals($seen[$name], $name, [System.StringComparison]::Ordinal)) {
      throw "N8N_WORKFLOW_MATCH_AMBIGUOUS: case-folded workflow filename collision must be resolved before target lookup."
    }
    $seen[$name] = $name
  }
}

function Resolve-LiveWorkflowByName($WorkflowName, $WorkflowFileName, $LiveWorkflows) {
  $matches = @($LiveWorkflows | Where-Object { [string]$_.name -eq $WorkflowName })
  if ($matches.Count -eq 0) {
    return [PSCustomObject]@{ Status = "NotFound"; Workflow = $null; Reason = "No live workflow matched by name." }
  }

  $activeMatches = @($matches | Where-Object { $_.isArchived -ne $true })
  $archivedMatches = @($matches | Where-Object { $_.isArchived -eq $true })

  if ($activeMatches.Count -gt 1) {
    return [PSCustomObject]@{ Status = "Blocked"; Workflow = $null; Reason = "Multiple non-archived live workflows named '$WorkflowName' were found." }
  }

  if ($activeMatches.Count -eq 1) {
    if ($archivedMatches.Count -gt 0) {
      Write-Step "ARCHIVE" "Ignoring $($archivedMatches.Count) archived same-name workflow(s); $WorkflowFileName will use the non-archived workflow."
    }
    return [PSCustomObject]@{ Status = "Found"; Workflow = $activeMatches[0]; Reason = "Matched unique non-archived workflow by name." }
  }

  if ($archivedMatches.Count -eq 1) {
    if ($ArchivedByNameMode -eq "CreateNew") {
      Write-Step "ARCHIVE" "$WorkflowFileName only matched archived live workflow '$WorkflowName' as $($archivedMatches[0].id). CreateNew mode will create a new inactive workflow instead."
      return [PSCustomObject]@{ Status = "ArchivedCreateNew"; Workflow = $archivedMatches[0]; Reason = "Only archived workflow matched by name; creating new by mode." }
    }
    if ($ArchivedByNameMode -eq "UpdateArchived") {
      Write-Step "ARCHIVE" "$WorkflowFileName will update archived live workflow '$WorkflowName' as $($archivedMatches[0].id)."
      return [PSCustomObject]@{ Status = "FoundArchived"; Workflow = $archivedMatches[0]; Reason = "Only archived workflow matched by name; updating by mode." }
    }
    return [PSCustomObject]@{ Status = "Blocked"; Workflow = $null; Reason = "Only an archived workflow matched by name. ArchivedByNameMode Block requires manual unarchive, rename, or a different mode." }
  }

  if ($ArchivedByNameMode -eq "CreateNew") {
    Write-Step "ARCHIVE" "$WorkflowFileName matched $($archivedMatches.Count) archived same-name workflows and no non-archived workflow. CreateNew mode will create a new inactive workflow."
    return [PSCustomObject]@{ Status = "ArchivedCreateNew"; Workflow = $null; Reason = "Multiple archived workflows matched by name; creating new by mode." }
  }

  if ($ArchivedByNameMode -eq "UpdateArchived") {
    return [PSCustomObject]@{ Status = "Blocked"; Workflow = $null; Reason = "Multiple archived workflows matched by name. UpdateArchived is ambiguous." }
  }

  return [PSCustomObject]@{ Status = "Blocked"; Workflow = $null; Reason = "Multiple archived workflows matched by name. ArchivedByNameMode Block requires manual decision." }
}

function Write-WorkflowJson($Workflow, $Path) {
  Write-Utf8NoBomText -Path $Path -Text (($Workflow | ConvertTo-Json -Depth 100) + "`n")
}

function Set-PreparedWorkflowId($PreparedFile, $WorkflowId) {
  if ([string]::IsNullOrWhiteSpace($WorkflowId)) {
    return
  }

  $preparedWorkflow = Get-Content -Raw -Path $PreparedFile | ConvertFrom-Json
  if ($preparedWorkflow.PSObject.Properties.Name -contains "id") {
    $preparedWorkflow.id = $WorkflowId
  } else {
    $preparedWorkflow | Add-Member -MemberType NoteProperty -Name "id" -Value $WorkflowId
  }
  Write-Utf8NoBomText -Path $PreparedFile -Text (($preparedWorkflow | ConvertTo-Json -Depth 100) + "`n")
}

function Test-WorkflowHasScheduleTrigger($Workflow) {
  foreach ($node in @($Workflow.nodes)) {
    $type = [string]$node.type
    if ($type -eq "n8n-nodes-base.scheduleTrigger" -or $type -eq "n8n-nodes-base.cron") {
      return $true
    }
  }
  return $false
}

function Get-LiveCredentialNodeCount($Workflow) {
  if ($null -eq $Workflow) {
    return 0
  }
  return @($Workflow.nodes | Where-Object { $_.PSObject.Properties.Name -contains "credentials" }).Count
}

function Export-CredentialBindingsOnly($WorkflowFiles, $LiveWorkflows) {
  Write-Section "Credential Binding Refresh"
  Write-Step "START" "Exporting available live workflows only to refresh local credential bindings."

  Initialize-RunDirectory $CredentialExportDirPath
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $BindingsFilePath) | Out-Null

  $exportedCount = 0
  $skippedCount = 0
  foreach ($workflowFile in $WorkflowFiles) {
    $workflowInfo = Read-RepoWorkflowInfo $workflowFile
    $liveWorkflow = $null
    if (-not [string]::IsNullOrWhiteSpace($workflowInfo.Id)) {
      $liveWorkflow = $LiveWorkflows | Where-Object { [string]$_.id -eq $workflowInfo.Id } | Select-Object -First 1
    }
    if ($null -eq $liveWorkflow) {
      $nameMatch = Resolve-LiveWorkflowByName $workflowInfo.Name $workflowFile.Name $LiveWorkflows
      if ($nameMatch.Status -eq "Found" -or $nameMatch.Status -eq "FoundArchived") {
        $liveWorkflow = $nameMatch.Workflow
      }
    }

    if ($null -eq $liveWorkflow) {
      $skippedCount += 1
      Write-Step "SKIP" "$($workflowFile.Name) does not exist live for credential binding refresh."
      continue
    }

    $exportFile = Join-Path $CredentialExportDirPath "$($workflowFile.BaseName).live-export.json"
    Write-WorkflowJson $liveWorkflow $exportFile
    $exportedCount += 1
    Write-Step "EXPORT" "$($workflowFile.Name) exported for credential binding refresh."
  }

  $syncResult = Invoke-CapturedCommand "node" @((Join-Path $HelperScriptDir "sync-n8n-live-exports.cjs"), $CredentialExportDirPath, $WorkflowDirPath, $BindingsFilePath, "--credentials-only", "--allow-missing-exports")
  if ($syncResult.ExitCode -ne 0) {
    Write-Step "FAIL" "Could not save refreshed credential bindings."
    Write-CommandOutput $syncResult.Output
    return $false
  }

  Write-Step "DONE" "Credential bindings refreshed at $(Get-DisplayPath $BindingsFilePath). Exported $exportedCount, skipped $skippedCount."
  return $true
}

function Invoke-WorkflowPreflight($WorkflowFiles, [bool]$BindingsFileExists, $LiveWorkflows) {
  $plannedImports = @()
  $blockedWorkflows = @()
  $skippedCount = 0
  $comparisonWarningCount = 0
  $missingLiveWorkflowCount = 0
  $nameMatchedWorkflowCount = 0
  $restartWarningCount = 0

  Write-Section "Workflow Check"

  foreach ($workflowFile in $WorkflowFiles) {
    $preparedFile = Join-Path $PreparedDirPath "$($workflowFile.BaseName).live-import.json"
    $liveCompareFile = Join-Path $PreparedDirPath "$($workflowFile.BaseName).live-compare.json"
    $containerFile = "$ContainerDir/$($workflowFile.BaseName).live-import.json"
    $workflowInfo = Read-RepoWorkflowInfo $workflowFile
    $repoWorkflow = $workflowInfo.Workflow
    $workflowId = Get-LocalWorkflowIdentityId $workflowFile $workflowInfo.Name
    if ([string]::IsNullOrWhiteSpace($workflowId)) { $workflowId = $workflowInfo.Id }
    $workflowName = $workflowInfo.Name
    $workflowStatus = "ComparisonFailed"
    $liveWorkflowForCredentialCheck = $null
    $liveWorkflowIdForImport = $null
    $hasBodyChanges = $true
    $credentialDriftStatus = "UNKNOWN"
    $shouldImport = $true
    $wasArchivedInLive = $false
    $willUpdateArchivedWorkflow = $false
    $plannedAction = "Import"
    $targetLiveId = $workflowId
    $actionNote = ""
    $hasWorkflowId = -not [string]::IsNullOrWhiteSpace($workflowId)
    $generatedWorkflowIdForImport = $null
    $requiresRestartWarning = $false

    Write-Step "CHECK" (Get-WorkflowCheckLabel $workflowFile $workflowId)

    if (Test-Path -Path $preparedFile -PathType Leaf) {
      Remove-Item -Path $preparedFile -Force
    }
    if (Test-Path -Path $liveCompareFile -PathType Leaf) {
      Remove-Item -Path $liveCompareFile -Force
    }

    if ($hasWorkflowId) {
      $idMatches = @($LiveWorkflows | Where-Object { [string]$_.id -eq $workflowId })
      if ($idMatches.Count -gt 1) {
        $blockedWorkflows += [PSCustomObject]@{
          File = $workflowFile.Name
          Reason = "Multiple live workflows matched repo id $workflowId."
          Kind = "DuplicateLiveId"
        }
        continue
      }

      if ($idMatches.Count -eq 1) {
        $liveWorkflowForCredentialCheck = $idMatches[0]
        Write-WorkflowJson $liveWorkflowForCredentialCheck $liveCompareFile
        if ($liveWorkflowForCredentialCheck.isArchived -eq $true) {
          $workflowStatus = "ExistingArchivedById"
          $wasArchivedInLive = $true
          $willUpdateArchivedWorkflow = $true
          $plannedAction = "Update archived by repo id"
          $actionNote = "Exact repo id exists live but is archived. Unarchive this workflow in n8n if you want to use it."
          Write-Step "ARCHIVE" "$($workflowFile.Name) ($workflowId) is archived in live n8n; import will update that archived workflow because the ID match is explicit."
        } else {
          $workflowStatus = "ExistingById"
          $plannedAction = "Update by repo id"
        }
      }
    }

    if ($workflowStatus -eq "ComparisonFailed") {
      $liveWorkflowByName = Resolve-LiveWorkflowByName $workflowName $workflowFile.Name $LiveWorkflows
      if ($liveWorkflowByName.Status -eq "Blocked") {
        $blockedWorkflows += [PSCustomObject]@{
          File = $workflowFile.Name
          Reason = $liveWorkflowByName.Reason
          Kind = "ArchivedOrDuplicateName"
        }
        continue
      }

      if ($liveWorkflowByName.Status -eq "Found" -or $liveWorkflowByName.Status -eq "FoundArchived") {
        $workflowStatus = "ExistingByName"
        $nameMatchedWorkflowCount += 1
        $liveWorkflowIdForImport = [string]$liveWorkflowByName.Workflow.id
        $liveWorkflowForCredentialCheck = $liveWorkflowByName.Workflow
        $willUpdateArchivedWorkflow = $liveWorkflowByName.Status -eq "FoundArchived"
        $targetLiveId = $liveWorkflowIdForImport
        Write-WorkflowJson $liveWorkflowByName.Workflow $liveCompareFile
        if ($willUpdateArchivedWorkflow) {
          $plannedAction = "Update archived by name"
          $actionNote = "ArchivedByNameMode UpdateArchived selected. Unarchive this workflow in n8n if you want to use it."
          Write-Step "MATCH" "$($workflowFile.Name) matched archived live workflow '$workflowName' by name as $liveWorkflowIdForImport."
        } else {
          $plannedAction = "Update by name"
          Write-Step "MATCH" "$($workflowFile.Name) matched live workflow '$workflowName' by name as $liveWorkflowIdForImport."
        }
      } else {
        $workflowStatus = "MissingLive"
        $missingLiveWorkflowCount += 1
        $plannedAction = "Create new"
        if ($liveWorkflowByName.Status -eq "ArchivedCreateNew" -or -not $hasWorkflowId) {
          $generatedWorkflowIdForImport = New-WorkflowId
          $targetLiveId = $generatedWorkflowIdForImport
          Write-Step "CREATE" "$(Get-WorkflowCheckLabel $workflowFile $workflowId) will be imported as a new inactive workflow with generated id $generatedWorkflowIdForImport."
        } else {
          $targetLiveId = $workflowId
          Write-Step "CREATE" "$(Get-WorkflowCheckLabel $workflowFile $workflowId) does not exist in live n8n; it will be imported as a new inactive workflow."
        }

        if (-not $BindingsFileExists) {
          $actionNote = "Reattach credentials in n8n if this workflow needs them."
          Write-Step "WARN" "$($workflowFile.Name) will import without restored credential bindings. Reattach credentials in n8n after import if needed."
        }
      }
    }

    if ($null -ne $liveWorkflowForCredentialCheck) {
      if ($liveWorkflowForCredentialCheck.active -eq $true -or (Test-WorkflowHasScheduleTrigger $repoWorkflow) -or (Test-WorkflowHasScheduleTrigger $liveWorkflowForCredentialCheck)) {
        $requiresRestartWarning = $true
        $restartWarningCount += 1
        Write-Step "WARN" "This import updates a previously active or scheduled workflow."
        Write-Step "WARN" "On non multi-main n8n instances, cron triggers may keep running until n8n is restarted."
        Write-Step "WARN" "Restart the n8n container after import before trusting activation state."
      }
    }

    if ($workflowStatus -eq "ExistingById" -or $workflowStatus -eq "ExistingByName" -or $workflowStatus -eq "ExistingArchivedById") {
      $comparisonResult = Invoke-CapturedCommand "node" @((Join-Path $HelperScriptDir "should-import-n8n-workflow.cjs"), $workflowFile.FullName, $liveCompareFile)
      if ($comparisonResult.ExitCode -ne 0) {
        throw "Failed to compare repo workflow with live workflow for $($workflowFile.FullName).`n$($comparisonResult.Output -join "`n")"
      }

      if ($comparisonResult.StdOut -contains "UNCHANGED") {
        $hasBodyChanges = $false
      }

      $credentialDriftResult = Invoke-CapturedCommand "node" @((Join-Path $HelperScriptDir "compare-n8n-workflow-credentials.cjs"), $workflowFile.FullName, $liveCompareFile, $BindingsFilePath)
      if ($credentialDriftResult.ExitCode -ne 0) {
        throw "Failed to compare live credentials for $($workflowFile.FullName).`n$($credentialDriftResult.Output -join "`n")"
      }

      $credentialDriftStatus = ($credentialDriftResult.StdOut | Select-Object -First 1).Trim()
      if ($credentialDriftStatus -ne "MATCH" -and $credentialDriftStatus -ne "DIFF" -and $credentialDriftStatus -ne "UNKNOWN") {
        throw "Unexpected credential drift result for $($workflowFile.Name): $credentialDriftStatus"
      }

      $liveCredentialCountForWarning = Get-LiveCredentialNodeCount $liveWorkflowForCredentialCheck
      if ($credentialDriftStatus -eq "UNKNOWN" -and $liveCredentialCountForWarning -gt 0) {
        Write-Step "WARN" "$($workflowFile.Name) has $liveCredentialCountForWarning live credential-bound node(s), but credential drift is UNKNOWN because local binding metadata is missing, unavailable, or ambiguous."
      }

      if (-not $hasBodyChanges -and $credentialDriftStatus -eq "DIFF") {
        Write-Step "CRED" "$($workflowFile.Name) has credential binding changes; it will be imported."
      }

      if (-not $hasBodyChanges -and $credentialDriftStatus -ne "DIFF" -and $ForceImport) {
        Write-Step "FORCE" "$($workflowFile.Name) has no meaningful workflow or credential changes, but ForceImport is set."
      }

      if (-not $hasBodyChanges -and $credentialDriftStatus -ne "DIFF" -and -not $ForceImport) {
        Write-Step "SKIP" "$($workflowFile.Name) has no meaningful workflow or credential changes."
        $skippedCount += 1
        $shouldImport = $false
      }
    }

    if (-not $shouldImport) {
      continue
    }

    $liveCredentialCount = Get-LiveCredentialNodeCount $liveWorkflowForCredentialCheck
    if ($liveCredentialCount -gt 0 -and -not $AllowMissingCredentialBindings) {
      $bindingsUnavailable = (-not $BindingsFileExists) -or $credentialDriftStatus -eq "UNKNOWN"
      if ($bindingsUnavailable) {
        if ($DryRun) {
          Write-Step "WARN" "$($workflowFile.Name) would need $BindingsFilePath to restore $liveCredentialCount live credential-bound node(s) during a real import."
        } else {
          Write-Step "BLOCK" "$($workflowFile.Name) changed, but $liveCredentialCount live credential-bound node(s) need available local credential bindings."
          $blockedWorkflows += [PSCustomObject]@{
            File = $workflowFile.Name
            Reason = "Missing or unavailable credential bindings for $liveCredentialCount live credential-bound node(s)."
            Kind = "MissingCredentialBindings"
          }
          continue
        }
      }
    }

    $prepareArgs = @(
      (Join-Path $HelperScriptDir "prepare-n8n-live-import.cjs"),
      $workflowFile.FullName,
      $BindingsFilePath,
      $preparedFile
    )

    if (Test-Path -Path $liveCompareFile -PathType Leaf) {
      $prepareArgs += $liveCompareFile
    }

    $prepareResult = Invoke-CapturedCommand "node" $prepareArgs
    if ($prepareResult.ExitCode -ne 0) {
      throw "Failed to prepare live import file for $($workflowFile.FullName).`n$($prepareResult.Output -join "`n")"
    }

    if (-not [string]::IsNullOrWhiteSpace($liveWorkflowIdForImport)) {
      Set-PreparedWorkflowId $preparedFile $liveWorkflowIdForImport
      if ($willUpdateArchivedWorkflow) {
        Write-Step "ID" "$($workflowFile.Name) will update archived live workflow id $liveWorkflowIdForImport. Unarchive that workflow in n8n if you want it active/usable."
      } else {
        Write-Step "ID" "$($workflowFile.Name) will update existing live workflow id $liveWorkflowIdForImport instead of creating a duplicate."
      }
    } elseif (-not [string]::IsNullOrWhiteSpace($generatedWorkflowIdForImport)) {
      Set-PreparedWorkflowId $preparedFile $generatedWorkflowIdForImport
      Write-Step "ID" "$($workflowFile.Name) prepared import payload will create new live workflow id $generatedWorkflowIdForImport."
    } elseif ($willUpdateArchivedWorkflow) {
      Write-Step "ID" "$($workflowFile.Name) will update archived live workflow id $workflowId. Unarchive that workflow in n8n if you want it active/usable."
    }

    Write-Step "READY" "$($workflowFile.Name) prepared import payload."
    $plannedImports += [PSCustomObject]@{
      File = $workflowFile.Name
      PreparedFile = $preparedFile
      ContainerFile = $containerFile
      IsArchivedInLive = $wasArchivedInLive
      UpdatesArchivedWorkflow = $willUpdateArchivedWorkflow
      RequiresRestartWarning = $requiresRestartWarning
      Action = $plannedAction
      TargetId = $targetLiveId
      Note = $actionNote
    }
  }

  [PSCustomObject]@{
    PlannedImports = $plannedImports
    BlockedWorkflows = $blockedWorkflows
    SkippedCount = $skippedCount
    ComparisonWarningCount = $comparisonWarningCount
    MissingLiveWorkflowCount = $missingLiveWorkflowCount
    NameMatchedWorkflowCount = $nameMatchedWorkflowCount
    RestartWarningCount = $restartWarningCount
  }
}

function Get-PlannedTargetUniquenessBlockers($PlannedImports) {
  $blockers = @()
  $duplicateGroups = @(
    $PlannedImports |
      Where-Object { -not [string]::IsNullOrWhiteSpace([string]$_.TargetId) } |
      Group-Object -Property TargetId |
      Where-Object { $_.Count -gt 1 }
  )
  foreach ($group in $duplicateGroups) {
    foreach ($planned in @($group.Group)) {
      $blockers += [PSCustomObject]@{
        File = [string]$planned.File
        Reason = "N8N_WORKFLOW_MATCH_AMBIGUOUS: multiple canonical workflows resolve to one target workflow."
        Kind = "N8N_WORKFLOW_MATCH_AMBIGUOUS"
      }
    }
  }
  return @($blockers)
}

function Invoke-PortableWorkflowPreflight($WorkflowFiles, $LiveWorkflows, $CredentialMetadataFile) {
  $plannedImports = @()
  $resolvedTargetPlans = @()
  $blockedWorkflows = @()
  $requiredCredentialMisses = @()
  $optionalCredentialMisses = @()
  $unsafeCredentialFailures = @()
  $skippedCount = 0
  $missingLiveWorkflowCount = 0
  $nameMatchedWorkflowCount = 0

  Write-Section "Portable Workflow Preparation"

  foreach ($workflowFile in $WorkflowFiles) {
    $preparedFile = Join-Path $PreparedDirPath "$($workflowFile.BaseName).live-import.json"
    $resultFile = Join-Path $PreparedDirPath "$($workflowFile.BaseName).prepare-result.json"
    $liveCompareFile = Join-Path $PreparedDirPath "$($workflowFile.BaseName).live-compare.json"
    $containerFile = "$ContainerDir/$($workflowFile.BaseName).live-import.json"
    $workflowInfo = Read-RepoWorkflowInfo $workflowFile
    $repoWorkflow = $workflowInfo.Workflow
    $workflowId = Get-LocalWorkflowIdentityId $workflowFile $workflowInfo.Name
    if ([string]::IsNullOrWhiteSpace($workflowId)) { $workflowId = $workflowInfo.Id }
    $workflowName = $workflowInfo.Name
    $targetWorkflow = $null
    $targetWorkflowId = $null
    $plannedAction = "Create new"
    $updatesArchivedWorkflow = $false
    $matchedByCanonicalId = $false

    Write-Step "CHECK" "$($workflowFile.Name) (portable selector; target identity kept internal)"

    if (-not [string]::IsNullOrWhiteSpace($workflowId)) {
      $idMatches = @($LiveWorkflows | Where-Object { [string]$_.id -eq $workflowId })
      if ($idMatches.Count -gt 1) {
        $blockedWorkflows += [PSCustomObject]@{ File = $workflowFile.Name; Reason = "N8N_WORKFLOW_MATCH_AMBIGUOUS: multiple target workflows matched the canonical workflow ID."; Kind = "N8N_WORKFLOW_MATCH_AMBIGUOUS" }
        continue
      }
      if ($idMatches.Count -eq 1) {
        $targetWorkflow = $idMatches[0]
        $matchedByCanonicalId = $true
        $targetWorkflowId = [string]$targetWorkflow.id
        $plannedAction = "Update by canonical workflow ID"
      }
    }

    if ($null -eq $targetWorkflow) {
      $nameResolution = Resolve-LiveWorkflowByName $workflowName $workflowFile.Name $LiveWorkflows
      if ($nameResolution.Status -eq "Blocked") {
        $blockedWorkflows += [PSCustomObject]@{ File = $workflowFile.Name; Reason = "N8N_WORKFLOW_MATCH_AMBIGUOUS: $($nameResolution.Reason)"; Kind = "N8N_WORKFLOW_MATCH_AMBIGUOUS" }
        continue
      }
      if ($nameResolution.Status -eq "Found" -or $nameResolution.Status -eq "FoundArchived") {
        $targetWorkflow = $nameResolution.Workflow
        $targetWorkflowId = [string]$targetWorkflow.id
        $nameMatchedWorkflowCount += 1
        $plannedAction = if ($nameResolution.Status -eq "FoundArchived") { "Update archived by unique workflow name" } else { "Update by unique workflow name" }
      } else {
        $missingLiveWorkflowCount += 1
        $targetWorkflowId = New-WorkflowId
      }
    }

    if ($null -ne $targetWorkflow) {
      $updatesArchivedWorkflow = $targetWorkflow.isArchived -eq $true
      if ($targetWorkflow.active -eq $true) {
        $blockedWorkflows += [PSCustomObject]@{ File = $workflowFile.Name; Reason = "N8N_POLICY_VALIDATION_FAILED: target workflow is active, so inactive import cannot guarantee that no scheduled execution persists."; Kind = "N8N_POLICY_VALIDATION_FAILED" }
        continue
      }
      if ($updatesArchivedWorkflow -and -not $matchedByCanonicalId -and $ArchivedByNameMode -eq "Block") {
        $blockedWorkflows += [PSCustomObject]@{ File = $workflowFile.Name; Reason = "Archived target workflow is blocked by ArchivedByNameMode."; Kind = "N8N_POLICY_VALIDATION_FAILED" }
        continue
      }
      if ($updatesArchivedWorkflow -and -not $matchedByCanonicalId -and $ArchivedByNameMode -eq "CreateNew") {
        $targetWorkflow = $null
        $targetWorkflowId = New-WorkflowId
        $updatesArchivedWorkflow = $false
        $plannedAction = "Create new beside archived name match"
        $missingLiveWorkflowCount += 1
      }
    }

    $resolvedTargetPlans += [PSCustomObject]@{
      File = $workflowFile.Name
      WorkflowName = $workflowName
      TargetId = $targetWorkflowId
      Action = $plannedAction
    }

    if ($null -ne $targetWorkflow) {
      Write-WorkflowJson $targetWorkflow $liveCompareFile
    } elseif (Test-Path -LiteralPath $liveCompareFile -PathType Leaf) {
      Remove-Item -LiteralPath $liveCompareFile -Force
    }

    $prepareArgs = @(
      (Join-Path $HelperScriptDir "prepare-n8n-live-import.cjs"),
      "--portable",
      "--workflow", $workflowFile.FullName,
      "--output", $preparedFile,
      "--result", $resultFile,
      "--credential-metadata", $CredentialMetadataFile,
      "--target-workflow-id", $targetWorkflowId
    )
    if ($null -eq $targetWorkflow) {
      $prepareArgs += "--allow-unresolved-import"
    }
    if (Test-Path -LiteralPath $PortableCredentialsFilePath -PathType Leaf) {
      $prepareArgs += @("--portable-credentials", $PortableCredentialsFilePath)
    }
    if (Test-Path -LiteralPath $EffectiveDeploymentPolicyFilePath -PathType Leaf) {
      $prepareArgs += @("--deployment-policy", $EffectiveDeploymentPolicyFilePath)
    }
    if (Test-Path -LiteralPath $ResourceBindingsFilePath -PathType Leaf) {
      $prepareArgs += @("--resource-bindings", $ResourceBindingsFilePath)
    }
    if ($null -ne $targetWorkflow) {
      $prepareArgs += @("--live-workflow", $liveCompareFile)
    }

    $prepareResult = Invoke-CapturedCommand "node" $prepareArgs
    if ($prepareResult.ExitCode -ne 0) {
      $preparation = if (Test-Path -LiteralPath $resultFile -PathType Leaf) { Get-Content -LiteralPath $resultFile -Raw | ConvertFrom-Json } else { $null }
      $code = if ($null -ne $preparation -and $preparation.code) { [string]$preparation.code } else { "N8N_INTERNAL_ERROR" }
      foreach ($requirement in @($preparation.details.credentials)) {
        $credentialIssue = [PSCustomObject]@{
          WorkflowFile = $workflowFile.Name
          NodeName = [string]$requirement.nodeName
          NodeType = [string]$requirement.nodeType
          LogicalName = [string]$requirement.logicalName
          CredentialType = [string]$requirement.credentialType
          Required = if ($null -eq $requirement.required) { $true } else { [bool]$requirement.required }
          MatchCount = [int]$requirement.matchCount
          Code = if ($requirement.code) { [string]$requirement.code } else { $code }
        }
        if (-not $credentialIssue.Required -and $credentialIssue.Code -eq "N8N_CREDENTIAL_MISSING") {
          $optionalCredentialMisses += $credentialIssue
        } elseif ($credentialIssue.Required -and $credentialIssue.Code -eq "N8N_CREDENTIAL_MISSING") {
          $requiredCredentialMisses += $credentialIssue
        } else {
          $unsafeCredentialFailures += $credentialIssue
        }
      }
      $blockedWorkflows += [PSCustomObject]@{ File = $workflowFile.Name; Reason = "$code`: portable preparation failed. Inspect the sanitized operation report."; Kind = $code }
      continue
    }

    $preparation = Get-Content -LiteralPath $resultFile -Raw | ConvertFrom-Json
    foreach ($requirement in @($preparation.credentialResolution.blockingRequirements)) {
      $requiredCredentialMisses += [PSCustomObject]@{
        WorkflowFile = $workflowFile.Name
        NodeName = [string]$requirement.nodeName
        NodeType = [string]$requirement.nodeType
        LogicalName = [string]$requirement.logicalName
        CredentialType = [string]$requirement.credentialType
        Required = if ($null -eq $requirement.required) { $true } else { [bool]$requirement.required }
        MatchCount = [int]$requirement.matchCount
        Code = [string]$requirement.code
      }
    }
    foreach ($requirement in @($preparation.credentialResolution.optionalRequirements)) {
      $optionalCredentialMisses += [PSCustomObject]@{
        WorkflowFile = $workflowFile.Name
        NodeName = [string]$requirement.nodeName
        NodeType = [string]$requirement.nodeType
        LogicalName = [string]$requirement.logicalName
        CredentialType = [string]$requirement.credentialType
        Required = $false
        MatchCount = [int]$requirement.matchCount
        Code = [string]$requirement.code
      }
    }
    foreach ($requirement in @($preparation.credentialResolution.unsafeRequirements)) {
      $unsafeCredentialFailures += [PSCustomObject]@{
        WorkflowFile = $workflowFile.Name
        NodeName = [string]$requirement.nodeName
        NodeType = [string]$requirement.nodeType
        LogicalName = [string]$requirement.logicalName
        CredentialType = [string]$requirement.credentialType
        Required = if ($null -eq $requirement.required) { $true } else { [bool]$requirement.required }
        MatchCount = [int]$requirement.matchCount
        Code = [string]$requirement.code
      }
    }

    $shouldImport = $true
    if ($null -ne $targetWorkflow) {
      $comparisonResult = Invoke-CapturedCommand "node" @((Join-Path $HelperScriptDir "should-import-n8n-workflow.cjs"), $preparedFile, $liveCompareFile)
      if ($comparisonResult.ExitCode -ne 0) {
        throw "N8N_INTERNAL_ERROR: effective prepared/live comparison failed for $($workflowFile.Name)."
      }
      if ($comparisonResult.StdOut -contains "UNCHANGED" -and -not $ForceImport) {
        $shouldImport = $false
        $skippedCount += 1
        Write-Step "SKIP" "$($workflowFile.Name) effective prepared payload is unchanged."
      }
    }

    if ($shouldImport) {
      Write-Step "READY" "$($workflowFile.Name) passed canonical, credential, resource, validation, invariant, and comparison gates."
      $plannedImports += [PSCustomObject]@{
        File = $workflowFile.Name
        WorkflowName = $workflowName
        PreparedFile = $preparedFile
        PreparedHash = (Get-FileHash -LiteralPath $preparedFile -Algorithm SHA256).Hash
        ContainerFile = $containerFile
        TargetId = $targetWorkflowId
        UpdatesArchivedWorkflow = $updatesArchivedWorkflow
        Action = $plannedAction
        RequiredCredentialMisses = @($preparation.credentialResolution.blockingRequirements)
        OptionalCredentialMisses = @($preparation.credentialResolution.optionalRequirements)
      }
    }
  }

  $targetUniquenessBlockers = Get-PlannedTargetUniquenessBlockers $resolvedTargetPlans
  if ($targetUniquenessBlockers.Count -gt 0) {
    $blockedWorkflows += $targetUniquenessBlockers
    $plannedImports = @()
  }

  return [PSCustomObject]@{
    PlannedImports = @($plannedImports)
    BlockedWorkflows = @($blockedWorkflows)
    RequiredCredentialMisses = @($requiredCredentialMisses)
    OptionalCredentialMisses = @($optionalCredentialMisses)
    UnsafeCredentialFailures = @($unsafeCredentialFailures)
    ReportCredentials = @($requiredCredentialMisses) + @($optionalCredentialMisses) + @($unsafeCredentialFailures)
    SkippedCount = $skippedCount
    ComparisonWarningCount = 0
    MissingLiveWorkflowCount = $missingLiveWorkflowCount
    NameMatchedWorkflowCount = $nameMatchedWorkflowCount
    RestartWarningCount = 0
  }
}

function Write-BlockedSummary($PreflightResult) {
  Write-Section "Summary"
  Write-Host ("Ready       : {0}" -f $PreflightResult.PlannedImports.Count)
  Write-Host ("Skipped     : {0}" -f $PreflightResult.SkippedCount)
  Write-Host ("Blocked     : {0}" -f $PreflightResult.BlockedWorkflows.Count)
  Write-Host "Live n8n was not changed."

  Write-Section "Blocked Workflows"
  foreach ($blocked in $PreflightResult.BlockedWorkflows) {
    Write-Step "BLOCK" "$($blocked.File): $($blocked.Reason)"
  }

  Write-Section "Next Action Steps"
  Write-Host "1. Run the menu's Explain last n8n failure action or inspect the sanitized latest report."
  Write-Host "2. Follow its one supported next action, then rerun this unchanged command."
}

function Write-WorkflowActionSummary($PlannedImports, $StatusLabel) {
  if ($PlannedImports.Count -eq 0) {
    return
  }

  Write-Section "Workflow Actions"

  foreach ($item in $PlannedImports) {
    Write-Step $StatusLabel $item.File
    Write-Host ("  Action          : {0}" -f $item.Action)
    Write-Host "  Target          : resolved internally"

    if (-not [string]::IsNullOrWhiteSpace($item.Note)) {
      Write-Host ("  Note            : {0}" -f $item.Note)
    }

    Write-Host ""
  }
}

function Write-N8nOperationReport($Result, $Code, $Phase, [bool]$Attempted, [bool]$Performed, $Workflows, $Credentials, $NextActionCode, $NextActionMessage, $ActiveState) {
  if ([string]::IsNullOrWhiteSpace($ReportsDirPath)) { return }
  $reportInput = Join-Path $PreparedDirPath "operation-report-input.json"
  $safeWorkflows = @($Workflows | ForEach-Object {
    [ordered]@{ workflowFile = [string]$_.File; workflowName = [string]$_.WorkflowName }
  })
  $safeCredentials = @($Credentials | ForEach-Object {
    [ordered]@{
      logicalName = [string]$_.LogicalName
      credentialType = [string]$_.CredentialType
      required = if ($null -eq $_.Required) { $true } else { [bool]$_.Required }
      matchCount = [int]$_.MatchCount
      nodeName = [string]$_.NodeName
      nodeType = [string]$_.NodeType
    }
  })
  $document = [ordered]@{
    operationType = "import"
    result = $Result
    code = $Code
    phase = $Phase
    workflows = $safeWorkflows
    credentials = $safeCredentials
    resources = @()
    mutation = [ordered]@{ attempted = $Attempted; performed = $Performed }
    activeState = $ActiveState
    executionState = "not_executed"
    nextAction = [ordered]@{ code = $NextActionCode; message = $NextActionMessage }
    unchangedScope = @("activation", "execution", "credentials", "secrets", "production configuration")
  }
  Write-Utf8NoBomText $reportInput (($document | ConvertTo-Json -Depth 8) + "`n")
  $reportResult = Invoke-CapturedCommand "node" @((Join-Path $HelperScriptDir "n8n-workflow-operation-report.cjs"), "write", "--report-root", $ReportsDirPath, "--input", $reportInput)
  Remove-Item -LiteralPath $reportInput -Force -ErrorAction SilentlyContinue
  if ($reportResult.ExitCode -ne 0) {
    throw "N8N_INTERNAL_ERROR: Failed to write the sanitized operation report."
  }
  $script:OperationReportWritten = $true
}

$WorkflowDirPath = Resolve-WorkflowDirPath
$BindingsFilePath = Join-Path $RepoRoot $BindingsFile
$PortableCredentialsFilePath = Join-Path $RepoRoot $PortableCredentialsFile
$DeploymentPolicyFilePath = Join-Path $RepoRoot $DeploymentPolicyFile
$ResourceBindingsFilePath = Join-Path $RepoRoot $ResourceBindingsFile
$WorkflowIdentityFilePath = Join-Path $RepoRoot $WorkflowIdentityFile
$ReportsDirPath = Join-Path $RepoRoot $ReportsDir
$PreparedDirPath = Join-Path $RepoRoot $PreparedDir
$CredentialExportDirPath = Join-Path $RepoRoot $CredentialExportDir
Assert-StrictRepoChildPath $WorkflowIdentityFilePath "Workflow identity state"
$deploymentPolicySnapshot = $null
if ($DeploymentPolicyFileWasExplicit) {
  $deploymentPolicySnapshot = Read-SafeDeploymentPolicySnapshot
}

Write-Section "n8n workflow import"
Write-Host ("Repo root        : {0}" -f $RepoRoot)
Write-Host ("Workflow dir     : {0}" -f (Get-DisplayPath $WorkflowDirPath))
Write-Host ("Prepared dir     : {0}" -f (Get-DisplayPath $PreparedDirPath))
Write-Host ("Credentials      : {0}" -f (Get-DisplayPath $PortableCredentialsFilePath))
Write-Host ("Resource policy  : {0}" -f (Get-DisplayPath $DeploymentPolicyFilePath))
Write-Host ("Local resources  : {0}" -f (Get-DisplayPath $ResourceBindingsFilePath))
Write-Host ("Local identity   : {0}" -f (Get-DisplayPath $WorkflowIdentityFilePath))
Write-Host ("Docker target    : {0}" -f ($(if ([string]::IsNullOrWhiteSpace($Container) -and [string]::IsNullOrWhiteSpace($ContainerName) -and [string]::IsNullOrWhiteSpace($ContainerId) -and [string]::IsNullOrWhiteSpace($ComposeProject) -and [string]::IsNullOrWhiteSpace($ComposeService)) { "auto-detect or prompt" } else { "explicit override requested" })))
Write-Host ("Mode             : {0}" -f ($(if ($DryRun) { "Dry run" } else { "Import" })))
Write-Host ("Archived by name : {0}" -f $ArchivedByNameMode)
Write-Host ("ProjectId        : {0}" -f ($(if ([string]::IsNullOrWhiteSpace($ProjectId)) { "(not set)" } else { $ProjectId })))
Write-Host ("UserId           : {0}" -f ($(if ([string]::IsNullOrWhiteSpace($UserId)) { "(not set)" } else { $UserId })))
Write-Host "Inactive import  : Required; activation, execution, and container restart are out of scope"
Write-Host ("Force import     : {0}" -f ($(if ($ForceImport) { "Yes" } else { "No" })))

if ($RestartContainerAfterImport) {
  throw "N8N_POLICY_VALIDATION_FAILED: -RestartContainerAfterImport is no longer supported. This helper never restarts n8n."
}

if (-not $DryRun) {
  Invoke-ProjectWorkflowHook "before-import-validation" @{
    "archived-by-name-mode" = $ArchivedByNameMode
    "bindings-file" = $BindingsFilePath
    "container" = $Container
    "dry-run" = [string]([bool]$DryRun)
    "force-import" = [string]([bool]$ForceImport)
    "prepared-dir" = $PreparedDirPath
    "workflow-dir" = $WorkflowDirPath
  }
}

if ($DeploymentPolicyFileWasExplicit) {
  Assert-DeploymentPolicySnapshotCurrent $deploymentPolicySnapshot
}

$workflowFiles = Get-RootWorkflowFiles $WorkflowDirPath
Assert-NoCaseFoldedWorkflowFileCollisions $workflowFiles

Write-Section "Workflow JSON Validation"
$validationResult = Invoke-CapturedCommand "node" @((Join-Path $HelperScriptDir "validate-n8n-workflows.cjs"), $WorkflowDirPath)
if ($validationResult.ExitCode -ne 0) {
  throw "Workflow JSON validation failed before live import.`n$($validationResult.Output -join "`n")"
}
Write-CommandOutput $validationResult.StdOut "VALID"

Assert-PortableDocumentsReadable

$transportResult = Invoke-CapturedCommand "node" @((Join-Path $HelperScriptDir "n8n-workflow-transport.cjs"), "capabilities", "docker-server-cli")
if ($transportResult.ExitCode -ne 0) {
  throw "N8N_POLICY_VALIDATION_FAILED: supported Docker/server CLI transport contract is unavailable."
}
Write-Step "TRANSPORT" "Selected supported Docker/server CLI transport; helper preparation and validation remain mandatory."

Invoke-LivePreflight
$liveWorkflows = Get-LiveWorkflows
Write-Step "LIVE" "Read $($liveWorkflows.Count) workflow(s) from live n8n."

if ($DeploymentPolicyFileWasExplicit) {
  Assert-DeploymentPolicySnapshotCurrent $deploymentPolicySnapshot
  $script:PortablePolicyPreflightPassed = $true
}
Initialize-RunDirectory $PreparedDirPath
$EffectiveDeploymentPolicyFilePath = $DeploymentPolicyFilePath
if ($DeploymentPolicyFileWasExplicit) {
  $EffectiveDeploymentPolicyFilePath = Join-Path $PreparedDirPath "deployment-policy.snapshot.json"
  Write-Utf8NoBomText $EffectiveDeploymentPolicyFilePath ($deploymentPolicySnapshot.Content.TrimEnd() + "`n")
}
$targetResolutionBlockers = Test-PortableTargetResolution $workflowFiles $liveWorkflows
if ($targetResolutionBlockers.Count -gt 0) {
  $targetGate = [PSCustomObject]@{
    PlannedImports = @()
    BlockedWorkflows = @($targetResolutionBlockers)
    RequiredCredentialMisses = @()
    OptionalCredentialMisses = @()
    UnsafeCredentialFailures = @()
    ReportCredentials = @()
    SkippedCount = 0
  }
  Write-N8nOperationReport "BLOCKED" ([string]$targetResolutionBlockers[0].Kind) "resolve-target-workflow-and-node" $false $false $targetResolutionBlockers @() "MAP_FROM_FAILURE_CODE" "Use the deterministic supported action for this failure code." "unchanged"
  Write-BlockedSummary $targetGate
  exit 1
}
$credentialMetadataFile = Get-SafeCredentialMetadata

$preflight = Invoke-PortableWorkflowPreflight $workflowFiles $liveWorkflows $credentialMetadataFile
Remove-Item -LiteralPath $credentialMetadataFile -Force -ErrorAction SilentlyContinue

if ($preflight.BlockedWorkflows.Count -gt 0) {
  $firstBlockCode = [string]$preflight.BlockedWorkflows[0].Kind
  Write-N8nOperationReport "BLOCKED" $firstBlockCode "prepare" $false $false $preflight.BlockedWorkflows $preflight.ReportCredentials "MAP_FROM_FAILURE_CODE" "Use the deterministic supported action for this failure code." "unchanged"
  Write-BlockedSummary $preflight
  exit 1
}

if ($DryRun) {
  Write-Section "Summary"
  Write-Host ("Would import      : {0}" -f $preflight.PlannedImports.Count)
  Write-Host ("Skipped           : {0}" -f $preflight.SkippedCount)
  Write-Host ("Name matched      : {0}" -f $preflight.NameMatchedWorkflowCount)
  Write-Host ("New live          : {0}" -f $preflight.MissingLiveWorkflowCount)
  Write-Host ("Restart warnings  : {0}" -f $preflight.RestartWarningCount)
  Write-Host "Live n8n was not changed."

  Write-WorkflowActionSummary $preflight.PlannedImports "Planned"

  Write-Section "Next Action Steps"
  if ($preflight.PlannedImports.Count -gt 0) {
    Write-Host "1. Review the planned imports above."
    Write-Host "2. Run this import command again without -DryRun when ready."
  } else {
    Write-Host "1. No import is needed right now."
  }
  Write-N8nOperationReport "DRY_RUN" "N8N_IMPORT_NO_CHANGES" "plan" $false $false $preflight.PlannedImports $preflight.ReportCredentials "RERUN_WITHOUT_DRY_RUN" "Rerun this unchanged command without -DryRun when ready." "unchanged"
  exit 0
}

if ($preflight.PlannedImports.Count -eq 0) {
  Write-Section "Summary"
  Write-Host "Imported          : 0"
  Write-Host ("Skipped           : {0}" -f $preflight.SkippedCount)
  Write-Host ("Name matched      : {0}" -f $preflight.NameMatchedWorkflowCount)
  Write-Host ("New live          : {0}" -f $preflight.MissingLiveWorkflowCount)
  Write-Host ("Restart warnings  : {0}" -f $preflight.RestartWarningCount)
  Write-Host "Live n8n was not changed."

  if ($preflight.RequiredCredentialMisses.Count -gt 0) {
    Write-N8nOperationReport "ACTION_REQUIRED" "N8N_CREDENTIAL_MISSING" "credential-resolution" $false $false @() $preflight.RequiredCredentialMisses "CREATE_CREDENTIALS_AND_RERUN" "Create each reported logical credential name and type, then rerun this unchanged command." "inactive"
  } else {
    Write-N8nOperationReport "SUCCESS" "N8N_IMPORT_NO_CHANGES" "effective-comparison" $false $false @() $preflight.OptionalCredentialMisses "NONE" "No action is required; the effective inactive payload is unchanged." "inactive"
  }

  Write-Section "Next Action Steps"
  Write-Host "1. No import is needed right now."
  exit 0
}

Invoke-ProjectWorkflowHook "before-live-import" @{
  "archived-by-name-mode" = $ArchivedByNameMode
  "bindings-file" = $BindingsFilePath
  "container" = $Container
  "dry-run" = [string]([bool]$DryRun)
  "force-import" = [string]([bool]$ForceImport)
  "prepared-dir" = $PreparedDirPath
  "workflow-dir" = $WorkflowDirPath
}

foreach ($plannedImport in $preflight.PlannedImports) {
  if (-not (Test-Path -LiteralPath $plannedImport.PreparedFile -PathType Leaf)) {
    throw "N8N_CANONICAL_INVARIANT_FAILED: before-live-import hook removed a prepared workflow payload."
  }
  $currentPreparedHash = (Get-FileHash -LiteralPath $plannedImport.PreparedFile -Algorithm SHA256).Hash
  if (-not [string]::Equals([string]$plannedImport.PreparedHash, [string]$currentPreparedHash, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "N8N_CANONICAL_INVARIANT_FAILED: before-live-import hook changed a prepared workflow after canonical invariant validation."
  }
}

Write-Section "Prepared Workflow Re-Validation"
$preparedValidationResult = Invoke-CapturedCommand "node" @((Join-Path $HelperScriptDir "validate-n8n-workflows.cjs"), "--mode", "prepared-import", $PreparedDirPath)
if ($preparedValidationResult.ExitCode -ne 0) {
  throw "Prepared workflow JSON validation failed after before-live-import hook.`n$($preparedValidationResult.Output -join "`n")"
}
Write-CommandOutput $preparedValidationResult.StdOut "VALID"

Write-Section "Import"

$importedCount = 0
foreach ($plannedImport in $preflight.PlannedImports) {
  $copyResult = Invoke-CapturedCommand "docker" @("cp", $plannedImport.PreparedFile, "${Container}:$($plannedImport.ContainerFile)")
  if ($copyResult.ExitCode -ne 0) {
    throw "Failed to copy $($plannedImport.PreparedFile) into container $Container.`n$($copyResult.Output -join "`n")"
  }

  $importArgs = @("exec", $Container, "n8n", "import:workflow", "--input=$($plannedImport.ContainerFile)", "--activeState=false")
  if (-not [string]::IsNullOrWhiteSpace($ProjectId)) {
    $importArgs += "--projectId=$ProjectId"
  } elseif (-not [string]::IsNullOrWhiteSpace($UserId)) {
    $importArgs += "--userId=$UserId"
  }

  $script:MutationAttempted = $true
  $importResult = Invoke-CapturedCommand "docker" $importArgs
  if ($importResult.ExitCode -ne 0) {
    throw "Failed to import $($plannedImport.PreparedFile) into container $Container.`n$($importResult.Output -join "`n")"
  }

  $importedCount += 1
  $script:MutationPerformed = $true
  Write-Step "IMPORT" "$($plannedImport.File) imported inactive."
  if ($plannedImport.UpdatesArchivedWorkflow) {
    Write-Step "ARCHIVE" "$($plannedImport.File) updated an archived live workflow. Unarchive it in n8n if you want it active/usable."
  }

  $postImportWorkflows = Get-LiveWorkflows
  $postconditionMatches = @($postImportWorkflows | Where-Object { [string]$_.id -eq [string]$plannedImport.TargetId })
  if ($postconditionMatches.Count -ne 1 -or $postconditionMatches[0].active -ne $false) {
    Write-N8nOperationReport "FAILED" "N8N_POSTCONDITION_FAILED" "verify-postcondition" $true $true @($plannedImport) $preflight.ReportCredentials "STOP_AND_ESCALATE" "Do not activate or execute the workflow; inspect the sanitized report and escalate the Toolkit defect." "unknown"
    throw "N8N_POSTCONDITION_FAILED: imported workflow was not uniquely observable as inactive."
  }
  Write-Step "VERIFY" "$($plannedImport.File) postcondition is inactive; no workflow was executed."
  Save-LocalWorkflowIdentity $plannedImport
}

Write-Section "Summary"
Write-Host ("Imported          : {0}" -f $importedCount)
Write-Host ("Skipped           : {0}" -f $preflight.SkippedCount)
Write-Host ("Name matched      : {0}" -f $preflight.NameMatchedWorkflowCount)
Write-Host ("New live          : {0}" -f $preflight.MissingLiveWorkflowCount)
Write-Host "Postcondition     : every imported workflow is inactive"

Write-WorkflowActionSummary $preflight.PlannedImports "Done"

Write-Section "Next Action Steps"
if ($importedCount -gt 0) {
  if ($preflight.RequiredCredentialMisses.Count -gt 0) {
    Write-Host "Create the following credentials with exactly these logical names and types, then rerun this unchanged command:"
    foreach ($credential in $preflight.RequiredCredentialMisses) {
      Write-Host ("- {0} ({1})" -f $credential.LogicalName, $credential.CredentialType)
    }
    Write-N8nOperationReport "ACTION_REQUIRED" "N8N_CREDENTIAL_MISSING" "postcondition" $true $true $preflight.PlannedImports $preflight.RequiredCredentialMisses "CREATE_CREDENTIALS_AND_RERUN" "Create each reported logical credential name and type, then rerun this unchanged command." "inactive"
  } else {
    Write-Host "No further import action is required. Activation remains a separate operator decision outside this helper."
    Write-N8nOperationReport "SUCCESS" "N8N_IMPORT_SUCCESS" "receipt" $true $true $preflight.PlannedImports $preflight.OptionalCredentialMisses "NONE" "No further import action is required." "inactive"
  }
} else {
  Write-Host "1. No live workflow changes were imported."
}
