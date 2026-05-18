param(
  [string]$WorkflowDir = "n8n-workflows",
  [string]$BindingsFile = ".n8n-local\n8n-credential-bindings.json",
  [string]$Container = "n8n",
  [string]$PreparedDir = ".tmp\n8n-live-import",
  [string]$CredentialExportDir = ".tmp\n8n-live-credential-exports",
  [string]$ContainerDir = "/tmp",
  [ValidateSet("CreateNew", "UpdateArchived", "Block")]
  [string]$ArchivedByNameMode = "CreateNew",
  [string]$ProjectId,
  [string]$UserId,
  [switch]$AllowMissingCredentialBindings,
  [switch]$SkipCredentialBindingRefresh,
  [switch]$RestartContainerAfterImport,
  [switch]$ForceImport,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

trap {
  Write-Host ""
  Write-Host "== Import failed =="
  Write-Host ($_.Exception.Message)
  exit 1
}

if (-not $PSScriptRoot) {
  throw "This script must be run from a .ps1 file."
}

if (-not [string]::IsNullOrWhiteSpace($ProjectId) -and -not [string]::IsNullOrWhiteSpace($UserId)) {
  throw "ProjectId and UserId cannot both be set. Choose one import target."
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

  # Generic import extension point:
  # keep this script project-agnostic. If a target repo needs import/export
  # cleanup, repair, or normalisation, add scripts/n8n-workflow-hooks.* in that
  # repo instead of hardcoding workflow-specific rules here.
  if (-not [string]::IsNullOrWhiteSpace($env:N8N_WORKFLOW_HOOK_SCRIPT)) {
    foreach ($hookPath in @($env:N8N_WORKFLOW_HOOK_SCRIPT -split ';')) {
      Add-HookScriptCandidate $hookPath $true
    }
  }

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

  $containerResult = Invoke-CapturedCommand "docker" @("inspect", $Container)
  if ($containerResult.ExitCode -ne 0) {
    throw "n8n container '$Container' is not reachable.`n$($containerResult.Output -join "`n")"
  }
  Write-Step "OK" "Container '$Container' is reachable."
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
    Write-Host ($syncResult.Output -join "`n")
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
    $workflowId = $workflowInfo.Id
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
        Write-Host "[WARN] This import updates a previously active or scheduled workflow."
        Write-Host "[WARN] On non multi-main n8n instances, cron triggers may keep running until n8n is restarted."
        Write-Host "[WARN] Restart the n8n container after import before trusting activation state."
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
  Write-Host "1. Confirm Docker and the n8n container are reachable."
  Write-Host "2. Run this helper folder's export-n8n-workflows-live.ps1 if you want to refresh repo JSON and credential bindings together."
  Write-Host "3. Use -AllowMissingCredentialBindings only if you intentionally want changed workflows imported without restored credentials."
  Write-Host "4. Deleting archived workflows is not supported by these CLI helper scripts yet."
}

function Write-WorkflowActionSummary($PlannedImports, $StatusLabel) {
  if ($PlannedImports.Count -eq 0) {
    return
  }

  Write-Section "Workflow Actions"

  foreach ($item in $PlannedImports) {
    Write-Step $StatusLabel $item.File
    Write-Host ("  Action          : {0}" -f $item.Action)
    Write-Host ("  Target          : {0}" -f $item.TargetId)
    Write-Host ("  Restart warning : {0}" -f $item.RequiresRestartWarning)

    if (-not [string]::IsNullOrWhiteSpace($item.Note)) {
      Write-Host ("  Note            : {0}" -f $item.Note)
    }

    Write-Host ""
  }
}

$WorkflowDirPath = Resolve-WorkflowDirPath
$BindingsFilePath = Join-Path $RepoRoot $BindingsFile
$PreparedDirPath = Join-Path $RepoRoot $PreparedDir
$CredentialExportDirPath = Join-Path $RepoRoot $CredentialExportDir

Write-Section "n8n workflow import"
Write-Host ("Repo root        : {0}" -f $RepoRoot)
Write-Host ("Workflow dir     : {0}" -f (Get-DisplayPath $WorkflowDirPath))
Write-Host ("Prepared dir     : {0}" -f (Get-DisplayPath $PreparedDirPath))
Write-Host ("Bindings file    : {0}" -f (Get-DisplayPath $BindingsFilePath))
Write-Host ("Container        : {0}" -f $Container)
Write-Host ("Mode             : {0}" -f ($(if ($DryRun) { "Dry run" } else { "Import" })))
Write-Host ("Archived by name : {0}" -f $ArchivedByNameMode)
Write-Host ("ProjectId        : {0}" -f ($(if ([string]::IsNullOrWhiteSpace($ProjectId)) { "(not set)" } else { $ProjectId })))
Write-Host ("UserId           : {0}" -f ($(if ([string]::IsNullOrWhiteSpace($UserId)) { "(not set)" } else { $UserId })))
Write-Host ("Restart warning  : {0}" -f ($(if ($RestartContainerAfterImport) { "Restart container after successful import when needed" } else { "Warn only" })))
Write-Host ("Force import     : {0}" -f ($(if ($ForceImport) { "Yes" } else { "No" })))

$bindingsFileExists = Test-Path -Path $BindingsFilePath -PathType Leaf
if (-not $bindingsFileExists) {
  Write-Step "WARN" "Credential bindings file is missing. Existing live credentials cannot be restored unless live workflows are exportable first."
}

Invoke-ProjectWorkflowHook "before-import-validation" @{
  "archived-by-name-mode" = $ArchivedByNameMode
  "bindings-file" = $BindingsFilePath
  "container" = $Container
  "dry-run" = [string]([bool]$DryRun)
  "force-import" = [string]([bool]$ForceImport)
  "prepared-dir" = $PreparedDirPath
  "workflow-dir" = $WorkflowDirPath
}

$workflowFiles = Get-RootWorkflowFiles $WorkflowDirPath

Write-Section "Workflow JSON Validation"
$validationResult = Invoke-CapturedCommand "node" @((Join-Path $HelperScriptDir "validate-n8n-workflows.cjs"), $WorkflowDirPath)
if ($validationResult.ExitCode -ne 0) {
  throw "Workflow JSON validation failed before live import.`n$($validationResult.Output -join "`n")"
}
Write-Step "VALID" ($validationResult.StdOut -join "`n")

Invoke-LivePreflight
$liveWorkflows = Get-LiveWorkflows
Write-Step "LIVE" "Read $($liveWorkflows.Count) workflow(s) from live n8n."

New-Item -ItemType Directory -Force -Path $PreparedDirPath | Out-Null

$preflight = Invoke-WorkflowPreflight $workflowFiles $bindingsFileExists $liveWorkflows

$missingCredentialBlockers = @($preflight.BlockedWorkflows | Where-Object { $_.Kind -eq "MissingCredentialBindings" })
if (
  $missingCredentialBlockers.Count -gt 0 -and
  -not $SkipCredentialBindingRefresh -and
  -not $DryRun
) {
  if (Export-CredentialBindingsOnly $workflowFiles $liveWorkflows) {
    $bindingsFileExists = Test-Path -Path $BindingsFilePath -PathType Leaf
    if ($bindingsFileExists) {
      Write-Step "RETRY" "Credential bindings are now available; rerunning workflow check."
      $preflight = Invoke-WorkflowPreflight $workflowFiles $bindingsFileExists $liveWorkflows
    }
  }
}

if ($preflight.BlockedWorkflows.Count -gt 0) {
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
    if (-not $bindingsFileExists) {
      Write-Host "3. Reattach credentials in n8n after import if any imported nodes need them."
    }
  } else {
    Write-Host "1. No import is needed right now."
  }
  Write-Host "Deleting archived workflows is not supported by these CLI helper scripts yet."
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

Write-Section "Import"

$importedCount = 0
foreach ($plannedImport in $preflight.PlannedImports) {
  $copyResult = Invoke-CapturedCommand "docker" @("cp", $plannedImport.PreparedFile, "${Container}:$($plannedImport.ContainerFile)")
  if ($copyResult.ExitCode -ne 0) {
    throw "Failed to copy $($plannedImport.PreparedFile) into container $Container.`n$($copyResult.Output -join "`n")"
  }

  $importArgs = @("exec", $Container, "n8n", "import:workflow", "--input=$($plannedImport.ContainerFile)")
  if (-not [string]::IsNullOrWhiteSpace($ProjectId)) {
    $importArgs += "--projectId=$ProjectId"
  } elseif (-not [string]::IsNullOrWhiteSpace($UserId)) {
    $importArgs += "--userId=$UserId"
  }

  $importResult = Invoke-CapturedCommand "docker" $importArgs
  if ($importResult.ExitCode -ne 0) {
    throw "Failed to import $($plannedImport.PreparedFile) into container $Container.`n$($importResult.Output -join "`n")"
  }

  $importedCount += 1
  Write-Step "IMPORT" "$($plannedImport.File) imported into live n8n."
  if ($plannedImport.UpdatesArchivedWorkflow) {
    Write-Step "ARCHIVE" "$($plannedImport.File) updated an archived live workflow. Unarchive it in n8n if you want it active/usable."
  }
}

$warningImports = @($preflight.PlannedImports | Where-Object { $_.RequiresRestartWarning })
if ($importedCount -gt 0 -and $warningImports.Count -gt 0) {
  if ($RestartContainerAfterImport) {
    Write-Section "Container Restart"
    $restartResult = Invoke-CapturedCommand "docker" @("restart", $Container)
    if ($restartResult.ExitCode -ne 0) {
      throw "Imports succeeded, but docker restart $Container failed.`n$($restartResult.Output -join "`n")"
    }
    Write-Step "RESTART" "Ran docker restart $Container because $($warningImports.Count) imported workflow(s) were previously active or scheduled."
  } else {
    Write-Step "WARN" "$($warningImports.Count) imported workflow(s) were previously active or scheduled. Restart the n8n container before trusting activation state."
  }
}

Write-Section "Summary"
Write-Host ("Imported          : {0}" -f $importedCount)
Write-Host ("Skipped           : {0}" -f $preflight.SkippedCount)
Write-Host ("Name matched      : {0}" -f $preflight.NameMatchedWorkflowCount)
Write-Host ("New live          : {0}" -f $preflight.MissingLiveWorkflowCount)
Write-Host ("Restart warnings  : {0}" -f $preflight.RestartWarningCount)
Write-Host "n8n may leave imported workflows inactive."

Write-WorkflowActionSummary $preflight.PlannedImports "Done"

Write-Section "Next Action Steps"
if ($importedCount -gt 0) {
  Write-Host "1. Open n8n and confirm imported workflows still have the expected credential assignments."
  Write-Host "2. Activate only the workflows you intentionally want published."
  if (@($preflight.PlannedImports | Where-Object { $_.UpdatesArchivedWorkflow }).Count -gt 0) {
    Write-Host "3. One or more archived workflows were updated; unarchive them in n8n if you want to use them."
  }
} else {
  Write-Host "1. No live workflow changes were imported."
}
Write-Host "Deleting archived workflows is not supported by these CLI helper scripts yet."
