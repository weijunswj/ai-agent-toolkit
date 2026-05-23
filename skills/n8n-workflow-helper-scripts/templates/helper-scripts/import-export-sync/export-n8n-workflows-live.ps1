param(
  [string]$WorkflowDir = "n8n-workflows",
  [ValidateSet("RepoTrackedOnly", "AllLive")]
  [string]$Mode = "RepoTrackedOnly",
  [ValidateSet("Fail", "Skip", "Report")]
  [string]$MissingLiveMode = "Fail",
  [string]$Container = "n8n",
  [string]$ExportDir = ".tmp\n8n-live-exports",
  [string]$BindingsFile = ".n8n-local\n8n-credential-bindings.json",
  [switch]$IncludeArchived,
  [switch]$PublishedOnly,
  [switch]$PreserveTags,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

if (-not $PSScriptRoot) {
  throw "This script must be run from a .ps1 file."
}

function Resolve-RepoRootFromScript {
  $current = (Resolve-Path $PSScriptRoot).Path
  while ($true) {
    if (
      (Test-Path -LiteralPath (Join-Path $current ".git")) -or
      (Test-Path -LiteralPath (Join-Path $current "n8n-workflows"))
    ) {
      return $current
    }

    $parent = Split-Path -Parent $current
    if ([string]::IsNullOrWhiteSpace($parent) -or $parent -eq $current) {
      return (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
    }
    $current = $parent
  }
}

$HelperScriptDir = (Resolve-Path $PSScriptRoot).Path
$RepoRoot = Resolve-RepoRootFromScript
Set-Location $RepoRoot

function Write-Section($Title) {
  Write-Host ""
  Write-Host "== $Title =="
}

function Write-Step($Status, $Message) {
  Write-Host ("[{0}] {1}" -f $Status.PadRight(7), $Message)
}

function Invoke-CapturedCommand($Command, [string[]]$Arguments) {
  $process = [System.Diagnostics.Process]::new()
  $process.StartInfo.FileName = $Command
  $process.StartInfo.Arguments = ($Arguments | ForEach-Object {
    '"' + ($_ -replace '\\', '\\' -replace '"', '\"') + '"'
  }) -join " "
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

function Write-Utf8NoBomText($Path, $Text) {
  $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText($Path, [string]$Text, $utf8NoBom)
}

function Get-DisplayPath($Path) {
  $resolvedPath = [System.IO.Path]::GetFullPath($Path)
  $rootPrefix = $RepoRoot.TrimEnd('\') + '\'
  if ($resolvedPath.StartsWith($rootPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
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

  # Generic export extension point:
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
  $resolvedPath = [System.IO.Path]::GetFullPath($Path)
  $tmpRoot = [System.IO.Path]::GetFullPath((Join-Path $RepoRoot ".tmp")).TrimEnd('\')
  $tmpPrefix = $tmpRoot + '\'
  $resolvedTrimmed = $resolvedPath.TrimEnd('\')
  if ($resolvedTrimmed -eq $tmpRoot -or -not $resolvedPath.StartsWith($tmpPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to clear unsafe run directory. Clearable run directories must be inside .tmp/ and must not be .tmp itself: $resolvedPath"
  }

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

function Read-RepoWorkflowInfo($WorkflowFile) {
  $workflow = Get-Content -Raw -Path $WorkflowFile.FullName | ConvertFrom-Json
  $workflowId = [string]$workflow.id
  $workflowName = [string]$workflow.name
  if ([string]::IsNullOrWhiteSpace($workflowName)) {
    throw "Workflow file $($WorkflowFile.FullName) does not contain a top-level name."
  }

  [PSCustomObject]@{
    File = $WorkflowFile
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

function Invoke-LivePreflight {
  Write-Section "Live n8n Preflight"
  $dockerResult = Invoke-CapturedCommand "docker" @("version", "--format", "{{.Server.Version}}")
  if ($dockerResult.ExitCode -ne 0) {
    throw "Docker is not reachable.`n$($dockerResult.Output -join "`n")"
  }
  Write-Step "OK" "Docker is reachable."

  $containerResult = Invoke-CapturedCommand "docker" @("inspect", $Container)
  if ($containerResult.ExitCode -ne 0) {
    throw "n8n container '$Container' is not reachable.`n$($containerResult.Output -join "`n")"
  }
  Write-Step "OK" "Container '$Container' is reachable."
}

function Get-LiveWorkflows {
  $arguments = @("exec", $Container, "n8n", "export:workflow", "--all", "--pretty")
  if ($PublishedOnly) {
    $arguments += "--published"
  }

  $result = Invoke-CapturedCommand "docker" $arguments
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

function Get-RootWorkflowFiles($WorkflowDirPath, [bool]$RequireExisting) {
  if (-not (Test-Path -Path $WorkflowDirPath -PathType Container)) {
    if ($RequireExisting) {
      throw "Workflow directory not found: n8n-workflows. Create n8n-workflows/ or run AllLive export to bootstrap from live n8n."
    }
    return @()
  }

  return @(Get-ChildItem -Path $WorkflowDirPath -Filter "*.json" -File | Sort-Object Name)
}

function Write-DuplicateNameReport($LiveWorkflows) {
  $duplicates = @(
    $LiveWorkflows |
      Group-Object -Property name |
      Where-Object { $_.Name -and $_.Count -gt 1 }
  )
  foreach ($duplicate in $duplicates) {
    Write-Step "DUP" "Live workflow name '$($duplicate.Name)' appears $($duplicate.Count) time(s). ID matching remains safe; name fallback will block if ambiguous."
  }
}

function Resolve-LiveMatch($RepoWorkflow, $LiveWorkflows) {
  $id = $RepoWorkflow.Id
  if (-not [string]::IsNullOrWhiteSpace($id)) {
    $idMatches = @($LiveWorkflows | Where-Object { [string]$_.id -eq $id })
    if ($idMatches.Count -gt 1) {
      return [PSCustomObject]@{ Status = "Duplicate"; Workflow = $null; Message = "Multiple live workflows matched id $id." }
    }
    if ($idMatches.Count -eq 1) {
      if ($idMatches[0].isArchived -eq $true -and -not $IncludeArchived) {
        return [PSCustomObject]@{ Status = "Archived"; Workflow = $idMatches[0]; Message = "Matched by id, but live workflow is archived." }
      }
      return [PSCustomObject]@{ Status = "Found"; Workflow = $idMatches[0]; Message = "Matched by id." }
    }
  }

  $nameMatches = @($LiveWorkflows | Where-Object { [string]$_.name -eq $RepoWorkflow.Name })
  if ($nameMatches.Count -eq 0) {
    $message = "No live workflow matched id or name."
    if ($PublishedOnly) {
      $message = "No published live workflow matched id or name. If this workflow only has a draft version, rerun without -PublishedOnly."
    }
    return [PSCustomObject]@{ Status = "Missing"; Workflow = $null; Message = $message }
  }

  $activeMatches = @($nameMatches | Where-Object { $_.isArchived -ne $true })
  $archivedMatches = @($nameMatches | Where-Object { $_.isArchived -eq $true })

  if ($activeMatches.Count -gt 1) {
    return [PSCustomObject]@{ Status = "Duplicate"; Workflow = $null; Message = "Multiple non-archived live workflows are named '$($RepoWorkflow.Name)'." }
  }

  if ($activeMatches.Count -eq 1) {
    if ($archivedMatches.Count -gt 0) {
      Write-Step "ARCHIVE" "Ignoring $($archivedMatches.Count) archived same-name workflow(s) while exporting '$($RepoWorkflow.Name)'."
    }
    return [PSCustomObject]@{ Status = "Found"; Workflow = $activeMatches[0]; Message = "Matched by unique non-archived name." }
  }

  if ($IncludeArchived -and $archivedMatches.Count -eq 1) {
    return [PSCustomObject]@{ Status = "Found"; Workflow = $archivedMatches[0]; Message = "Matched by unique archived name because -IncludeArchived is set." }
  }

  return [PSCustomObject]@{ Status = "Archived"; Workflow = $null; Message = "Only archived live workflow(s) matched by name." }
}

function Get-SafeWorkflowFileBase($Name, $Id) {
  $base = ([string]$Name).ToLowerInvariant() -replace '[^a-z0-9]+', '-'
  $base = $base.Trim('-')
  if ([string]::IsNullOrWhiteSpace($base)) {
    $base = "workflow"
  }
  if ($base.Length -gt 80) {
    $base = $base.Substring(0, 80).Trim('-')
  }
  if ([string]::IsNullOrWhiteSpace($base)) {
    $base = "workflow"
  }
  return $base
}

function Get-StableIdSuffix($Id) {
  $clean = ([string]$Id) -replace '[^A-Za-z0-9]', ''
  if ($clean.Length -gt 8) {
    return $clean.Substring(0, 8).ToLowerInvariant()
  }
  if ($clean.Length -gt 0) {
    return $clean.ToLowerInvariant()
  }
  return ([guid]::NewGuid().ToString("N")).Substring(0, 8)
}

function Write-LiveWorkflowExportFile($Workflow, $ExportFile) {
  Write-Utf8NoBomText -Path $ExportFile -Text (($Workflow | ConvertTo-Json -Depth 100) + "`n")
}

$WorkflowDirPath = Resolve-WorkflowDirPath
$ExportDirPath = Join-Path $RepoRoot $ExportDir
$BindingsFilePath = Join-Path $RepoRoot $BindingsFile

Write-Section "n8n workflow export"
Write-Host ("Repo root        : {0}" -f $RepoRoot)
Write-Host ("Workflow dir     : {0}" -f (Get-DisplayPath $WorkflowDirPath))
Write-Host ("Export dir       : {0}" -f (Get-DisplayPath $ExportDirPath))
Write-Host ("Bindings file    : {0}" -f (Get-DisplayPath $BindingsFilePath))
Write-Host ("Container        : {0}" -f $Container)
Write-Host ("Mode             : {0}" -f $Mode)
Write-Host ("Dry run          : {0}" -f ([bool]$DryRun))
Write-Host ("Published only   : {0}" -f ([bool]$PublishedOnly))
Write-Host ("Include archived : {0}" -f ([bool]$IncludeArchived))
Write-Host ("Preserve tags    : {0}" -f ([bool]$PreserveTags))
if ($Mode -eq "RepoTrackedOnly") {
  Write-Host ("Missing live     : {0}" -f $MissingLiveMode)
} else {
  Write-Host "Missing live     : Not used in AllLive mode."
}

Invoke-LivePreflight
$liveWorkflows = Get-LiveWorkflows
Write-Step "LIVE" "Read $($liveWorkflows.Count) workflow(s) from live n8n."
if ($PublishedOnly) {
  Write-Step "NOTE" "PublishedOnly is set. n8n may omit workflows with no published version."
}
Write-DuplicateNameReport $liveWorkflows

if ($Mode -eq "RepoTrackedOnly") {
  $workflowFiles = Get-RootWorkflowFiles $WorkflowDirPath $true
  if (-not $workflowFiles) {
    throw "No root-level workflow JSON files found in $(Get-DisplayPath $WorkflowDirPath)."
  }

  $plannedExports = @()
  $missingCount = 0
  $duplicateCount = 0
  $archivedCount = 0

  Write-Section "Repo-tracked workflow check"
  foreach ($workflowFile in $workflowFiles) {
    $workflowInfo = Read-RepoWorkflowInfo $workflowFile
    $match = Resolve-LiveMatch $workflowInfo $liveWorkflows
    Write-Step "CHECK" (Get-WorkflowCheckLabel $workflowFile $workflowInfo.Id)

    if ($match.Status -eq "Found") {
      $exportFile = Join-Path $ExportDirPath "$($workflowFile.BaseName).live-export.json"
      $plannedExports += [PSCustomObject]@{
        RepoFile = $workflowFile
        ExportFile = $exportFile
        Workflow = $match.Workflow
        Action = "Export"
        Note = $match.Message
      }
      Write-Step "FOUND" "$($workflowFile.Name) -> live id $($match.Workflow.id). $($match.Message)"
      continue
    }

    if ($match.Status -eq "Duplicate") {
      $duplicateCount += 1
      Write-Step "DUP" "$($workflowFile.Name): $($match.Message)"
      continue
    }

    if ($match.Status -eq "Archived") {
      $archivedCount += 1
      Write-Step "ARCHIVE" "$($workflowFile.Name): $($match.Message)"
      continue
    }

    $missingCount += 1
    Write-Step "MISSING" "$($workflowFile.Name): $($match.Message)"
  }

  if ($MissingLiveMode -eq "Report") {
    Write-Section "Summary"
    Write-Host ("Found      : {0}" -f $plannedExports.Count)
    Write-Host ("Missing    : {0}" -f $missingCount)
    Write-Host ("Archived   : {0}" -f $archivedCount)
    Write-Host ("Duplicated : {0}" -f $duplicateCount)
    Write-Host "Report mode does not export or write files."
    exit 0
  }

  if ($duplicateCount -gt 0) {
    throw "RepoTrackedOnly export cannot continue while duplicate live workflow name matches are unresolved."
  }

  if (($missingCount + $archivedCount) -gt 0 -and $MissingLiveMode -eq "Fail") {
    throw "RepoTrackedOnly export found $missingCount missing and $archivedCount archived repo-tracked workflow(s). Rerun with -MissingLiveMode Skip to export existing workflows only, or -MissingLiveMode Report to inspect."
  }

  if ($DryRun) {
    Write-Section "Planned Actions"
    foreach ($planned in $plannedExports) {
      Write-Step "PLAN" "$($planned.RepoFile.Name) -> $(Get-DisplayPath $planned.ExportFile)"
    }
    if (($missingCount + $archivedCount) -gt 0 -and $MissingLiveMode -eq "Skip") {
      Write-Step "SKIP" "Would skip $missingCount missing and $archivedCount archived workflow(s)."
    }

    Write-Section "Summary"
    Write-Host ("Would export : {0}" -f $plannedExports.Count)
    Write-Host "No workflow files or credential bindings were changed."
    exit 0
  }

  if ($plannedExports.Count -eq 0) {
    Write-Section "Summary"
    Write-Host "Exported : 0"
    Write-Host "No live exports were written and no workflow files were changed."
    exit 0
  }

  Initialize-RunDirectory $ExportDirPath
  foreach ($planned in $plannedExports) {
    Write-LiveWorkflowExportFile $planned.Workflow $planned.ExportFile
    Write-Step "EXPORT" "$($planned.RepoFile.Name) -> $(Get-DisplayPath $planned.ExportFile)"
  }

  Invoke-ProjectWorkflowHook "before-export-sync" @{
    "bindings-file" = $BindingsFilePath
    "container" = $Container
    "dry-run" = [string]([bool]$DryRun)
    "export-dir" = $ExportDirPath
    "mode" = $Mode
    "workflow-dir" = $WorkflowDirPath
  }

  $syncArgs = @((Join-Path $HelperScriptDir "sync-n8n-live-exports.cjs"), $ExportDirPath, $WorkflowDirPath, $BindingsFilePath, "--sync-exported-only")
  if ($PreserveTags) {
    $syncArgs += "--preserve-tags"
  }
  $syncResult = Invoke-CapturedCommand "node" $syncArgs
  if ($syncResult.ExitCode -ne 0) {
    Write-Host ($syncResult.Output -join "`n")
    throw "Failed to sync live exports into $(Get-DisplayPath $WorkflowDirPath)."
  }
  Write-Host ($syncResult.Output -join "`n")

  Invoke-ProjectWorkflowHook "after-export-sync" @{
    "bindings-file" = $BindingsFilePath
    "container" = $Container
    "dry-run" = [string]([bool]$DryRun)
    "export-dir" = $ExportDirPath
    "mode" = $Mode
    "workflow-dir" = $WorkflowDirPath
  }

  Write-Section "Summary"
  Write-Host ("Exported : {0}" -f $plannedExports.Count)
  Write-Host "Credential bindings were refreshed under .n8n-local."
  Write-Section "Next Action Steps"
  Write-Host "1. Review workflow JSON changes before committing."
  Write-Host "2. Keep .n8n-local and .tmp uncommitted."
  exit 0
}

$existingFiles = Get-RootWorkflowFiles $WorkflowDirPath $false
$existingById = @{}
$existingNameGroups = @{}
foreach ($workflowFile in $existingFiles) {
  $workflowInfo = Read-RepoWorkflowInfo $workflowFile
  if (-not [string]::IsNullOrWhiteSpace($workflowInfo.Id) -and -not $existingById.ContainsKey($workflowInfo.Id)) {
    $existingById[$workflowInfo.Id] = $workflowFile
  }
  if (-not $existingNameGroups.ContainsKey($workflowInfo.Name)) {
    $existingNameGroups[$workflowInfo.Name] = @()
  }
  $existingNameGroups[$workflowInfo.Name] += $workflowFile
}

$liveForExport = @($liveWorkflows | Where-Object { $IncludeArchived -or $_.isArchived -ne $true })
$skippedArchived = $liveWorkflows.Count - $liveForExport.Count
$usedBaseNames = @{}
foreach ($workflowFile in $existingFiles) {
  $usedBaseNames[$workflowFile.BaseName] = $true
}

$plannedAllLive = @()
foreach ($workflow in $liveForExport) {
  $targetFile = $null
  $matchNote = "New repo workflow file."

  if ($workflow.id -and $existingById.ContainsKey([string]$workflow.id)) {
    $targetFile = $existingById[[string]$workflow.id]
    $matchNote = "Updates existing repo file matched by workflow id."
  } elseif ($existingNameGroups.ContainsKey([string]$workflow.name) -and $existingNameGroups[[string]$workflow.name].Count -eq 1) {
    $targetFile = $existingNameGroups[[string]$workflow.name][0]
    $matchNote = "Updates existing repo file matched by unique workflow name."
  }

  if ($null -eq $targetFile) {
    $baseName = Get-SafeWorkflowFileBase $workflow.name $workflow.id
    if ($usedBaseNames.ContainsKey($baseName)) {
      $baseName = "$baseName-$(Get-StableIdSuffix $workflow.id)"
    }
    while ($usedBaseNames.ContainsKey($baseName)) {
      $baseName = "$baseName-$(Get-StableIdSuffix $workflow.id)"
    }
    $usedBaseNames[$baseName] = $true
    $targetFile = Join-Path $WorkflowDirPath "$baseName.json"
  } else {
    $existingBaseName = [System.IO.Path]::GetFileNameWithoutExtension([System.IO.Path]::GetFileName([string]$targetFile))
    $usedBaseNames[$existingBaseName] = $true
  }

  $targetBaseName = [System.IO.Path]::GetFileNameWithoutExtension([System.IO.Path]::GetFileName([string]$targetFile))
  $exportFile = Join-Path $ExportDirPath "$targetBaseName.live-export.json"
  $plannedAllLive += [PSCustomObject]@{
    RepoFile = $targetFile
    ExportFile = $exportFile
    Workflow = $workflow
    Note = $matchNote
  }
}

Write-Section "All live workflow plan"
foreach ($planned in $plannedAllLive) {
  Write-Step "PLAN" "$($planned.Workflow.name) ($($planned.Workflow.id)) -> $(Get-DisplayPath $planned.RepoFile). $($planned.Note)"
}
if ($skippedArchived -gt 0) {
  Write-Step "ARCHIVE" "Skipped $skippedArchived archived workflow(s). Use -IncludeArchived to include them."
}

if ($DryRun) {
  Write-Section "Summary"
  Write-Host ("Would export : {0}" -f $plannedAllLive.Count)
  Write-Host ("Skipped archived : {0}" -f $skippedArchived)
  Write-Host "No workflow files or credential bindings were changed."
  exit 0
}

if ($plannedAllLive.Count -eq 0) {
  Write-Section "Summary"
  Write-Host "Exported          : 0"
  Write-Host ("Skipped archived  : {0}" -f $skippedArchived)
  Write-Host "No live exports were written and no workflow files were changed."
  exit 0
}

New-Item -ItemType Directory -Force -Path $WorkflowDirPath | Out-Null
Initialize-RunDirectory $ExportDirPath
foreach ($planned in $plannedAllLive) {
  Write-LiveWorkflowExportFile $planned.Workflow $planned.ExportFile
  Write-Step "EXPORT" "$($planned.Workflow.name) -> $(Get-DisplayPath $planned.ExportFile)"
}

Invoke-ProjectWorkflowHook "before-export-sync" @{
  "bindings-file" = $BindingsFilePath
  "container" = $Container
  "dry-run" = [string]([bool]$DryRun)
  "export-dir" = $ExportDirPath
  "mode" = $Mode
  "workflow-dir" = $WorkflowDirPath
}

$syncAllArgs = @((Join-Path $HelperScriptDir "sync-n8n-live-exports.cjs"), $ExportDirPath, $WorkflowDirPath, $BindingsFilePath, "--create-missing-workflows", "--sync-exported-only")
if ($PreserveTags) {
  $syncAllArgs += "--preserve-tags"
}
$syncAllResult = Invoke-CapturedCommand "node" $syncAllArgs
if ($syncAllResult.ExitCode -ne 0) {
  Write-Host ($syncAllResult.Output -join "`n")
  throw "Failed to sync all live exports into $(Get-DisplayPath $WorkflowDirPath)."
}
Write-Host ($syncAllResult.Output -join "`n")

Invoke-ProjectWorkflowHook "after-export-sync" @{
  "bindings-file" = $BindingsFilePath
  "container" = $Container
  "dry-run" = [string]([bool]$DryRun)
  "export-dir" = $ExportDirPath
  "mode" = $Mode
  "workflow-dir" = $WorkflowDirPath
}

Write-Section "Summary"
Write-Host ("Exported          : {0}" -f $plannedAllLive.Count)
Write-Host ("Skipped archived  : {0}" -f $skippedArchived)
Write-Host "Credential bindings were refreshed under .n8n-local."

Write-Section "Next Action Steps"
Write-Host "1. Review all workflow JSON changes before committing."
Write-Host "2. Keep .n8n-local and .tmp uncommitted."
Write-Host "3. Historical version export is intentionally unsupported by this helper."
