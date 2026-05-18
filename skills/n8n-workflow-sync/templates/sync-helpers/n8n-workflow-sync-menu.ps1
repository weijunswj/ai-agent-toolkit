param(
  [switch]$UsePrevious,
  [switch]$Yes
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
      (Test-Path -LiteralPath (Join-Path $current ".gitignore")) -or
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

$DefaultWorkflowDir = "n8n-workflows"
$DefaultContainer = "n8n"
$DefaultBindingsFile = ".n8n-local\n8n-credential-bindings.json"
$PreviousCommandFile = Join-Path $RepoRoot ".n8n-local\n8n-sync-last-command.json"

function Write-Section($Title) {
  Write-Host ""
  Write-Host "== $Title =="
}

function Write-Step($Status, $Message) {
  Write-Host ("[{0}] {1}" -f $Status.PadRight(7), $Message)
}

function Read-Default($Prompt, $DefaultValue) {
  $value = Read-Host "$Prompt [$DefaultValue]"
  if ([string]::IsNullOrWhiteSpace($value)) {
    return $DefaultValue
  }
  return $value
}

function Read-YesNo($Prompt, [bool]$DefaultNo = $true) {
  $suffix = $(if ($DefaultNo) { "[y/N]" } else { "[Y/n]" })
  $value = Read-Host "$Prompt $suffix"
  if ([string]::IsNullOrWhiteSpace($value)) {
    return -not $DefaultNo
  }
  return $value -match '^(y|yes)$'
}

function Show-CommonSettingExplanations {
  Write-Section "Common Settings"
  Write-Host "WorkflowDir"
  Write-Host "- Meaning: Folder containing root-level n8n workflow JSON files."
  Write-Host "- Recommended default: n8n-workflows."
  Write-Host "- Effect: Import/export/validate only reads root-level *.json files in that folder."
  Write-Host "- Risk level: Low. The helper scripts support only n8n-workflows."
  Write-Host "- When to use it: Keep this as n8n-workflows."
  Write-Host ""
  Write-Host "Container"
  Write-Host "- Meaning: Docker container name running n8n."
  Write-Host "- Recommended default: n8n."
  Write-Host "- Effect: Live import/export commands run inside that container."
  Write-Host "- Risk level: Medium for real import/export because the live n8n instance is touched."
  Write-Host "- When to use it: Change when your n8n container has a different name."
  Write-Host ""
  Write-Host "BindingsFile"
  Write-Host "- Meaning: Local file storing credential binding metadata from live workflows."
  Write-Host "- Recommended default: .n8n-local\n8n-credential-bindings.json."
  Write-Host "- Effect: Import can restore credential references without committing credentials."
  Write-Host "- Risk level: Low if kept uncommitted. Do not commit .n8n-local."
  Write-Host "- When to use it: Change only if your repo intentionally stores local binding metadata elsewhere."
}

function Read-ExportMode {
  Write-Section "Export Mode"
  Write-Host "RepoTrackedOnly"
  Write-Host "- Meaning: Export only workflows already represented by root-level JSON files in n8n-workflows/."
  Write-Host "- Recommended: Yes, for normal day-to-day sync."
  Write-Host "- Effect: Updates tracked repo workflow files only."
  Write-Host "- Risk: Low. Avoids accidentally pulling every live workflow."
  Write-Host "- Use when: Repo already tracks the workflows you care about."
  Write-Host ""
  Write-Host "AllLive"
  Write-Host "- Meaning: Export all live non-archived workflows into n8n-workflows/."
  Write-Host "- Recommended: For first-time bootstrap or full live capture."
  Write-Host "- Effect: May create many new repo workflow JSON files."
  Write-Host "- Risk: Medium. Review changes before committing."
  Write-Host "- Use when: You built workflows in n8n UI and want repo JSON created."
  $value = Read-Default "Choose export mode: RepoTrackedOnly or AllLive" "RepoTrackedOnly"
  if ($value -ne "RepoTrackedOnly" -and $value -ne "AllLive") {
    Write-Step "WARN" "Unknown mode '$value'. Using RepoTrackedOnly."
    return "RepoTrackedOnly"
  }
  return $value
}

function Read-PublishedOnly {
  Write-Section "PublishedOnly"
  Write-Host "- Meaning: Export only published/live workflow versions when supported."
  Write-Host "- Recommended: No by default."
  Write-Host "- Effect: Draft-only changes may not be exported."
  Write-Host "- Risk: Medium if you expected draft changes."
  Write-Host "- Use when: Repo should reflect only what is currently published."
  return Read-YesNo "Use -PublishedOnly?" $true
}

function Read-IncludeArchived {
  Write-Section "IncludeArchived"
  Write-Host "- Meaning: Include archived workflows during AllLive export."
  Write-Host "- Recommended: No."
  Write-Host "- Effect: Archived workflows may be exported into repo."
  Write-Host "- Risk: Medium. Could bring back old/deprecated workflows."
  Write-Host "- Use when: You intentionally want archived workflows preserved in repo."
  return Read-YesNo "Use -IncludeArchived?" $true
}

function Read-PreserveTags {
  Write-Section "PreserveTags"
  Write-Host "- Meaning: Keep tags and tagIds in repo workflow JSON during export sync."
  Write-Host "- Recommended: No by default."
  Write-Host "- Effect: Repo JSON will include live tag metadata instead of stripping it."
  Write-Host "- Risk: Medium. Tags are not managed by import comparison/apply behavior yet, so preserving them may create live/repo drift."
  Write-Host "- Use when: You intentionally want tag metadata retained in repo exports for review or archival."
  return Read-YesNo "Use -PreserveTags?" $true
}

function Read-MissingLiveMode {
  Write-Section "MissingLiveMode"
  Write-Host "Fail"
  Write-Host "- Meaning: Stop when a repo-tracked workflow is missing live."
  Write-Host "- Recommended: Yes."
  Write-Host "- Risk: Low."
  Write-Host ""
  Write-Host "Skip"
  Write-Host "- Meaning: Export workflows that exist and skip missing ones."
  Write-Host "- Recommended: Only when missing workflows are expected."
  Write-Host "- Risk: Medium."
  Write-Host ""
  Write-Host "Report"
  Write-Host "- Meaning: Only show found/missing/archived status. Do not export."
  Write-Host "- Recommended: For investigation."
  Write-Host "- Risk: Low."
  $value = Read-Default "Choose MissingLiveMode: Fail, Skip, or Report" "Fail"
  if ($value -ne "Fail" -and $value -ne "Skip" -and $value -ne "Report") {
    Write-Step "WARN" "Unknown mode '$value'. Using Fail."
    return "Fail"
  }
  return $value
}

function Read-ArchivedByNameMode {
  Write-Section "ArchivedByNameMode"
  Write-Host "CreateNew"
  Write-Host "- Meaning: If only archived workflows match by name, create a new workflow instead of updating archived."
  Write-Host "- Recommended: Yes, default."
  Write-Host "- Effect: Avoids silently reviving/updating archived workflows."
  Write-Host "- Risk: Low to medium. May create a duplicate if you expected to reuse archived."
  Write-Host ""
  Write-Host "UpdateArchived"
  Write-Host "- Meaning: Update the archived workflow matched by name."
  Write-Host "- Recommended: Only when intentional."
  Write-Host "- Risk: Medium."
  Write-Host ""
  Write-Host "Block"
  Write-Host "- Meaning: Stop and require manual decision."
  Write-Host "- Recommended: Safest for production."
  Write-Host "- Risk: Low, but more manual."
  $value = Read-Default "Choose ArchivedByNameMode: CreateNew, UpdateArchived, or Block" "CreateNew"
  if ($value -ne "CreateNew" -and $value -ne "UpdateArchived" -and $value -ne "Block") {
    Write-Step "WARN" "Unknown mode '$value'. Using CreateNew."
    return "CreateNew"
  }
  return $value
}

function Read-ProjectId {
  Write-Section "ProjectId"
  Write-Host "- Meaning: Import workflows into a specific n8n project."
  Write-Host "- Recommended: Blank unless using n8n projects."
  Write-Host "- Effect: Passes --projectId."
  Write-Host "- Risk: Medium if wrong project is selected."
  return Read-Host "ProjectId, or blank"
}

function Read-UserId {
  Write-Section "UserId"
  Write-Host "- Meaning: Import workflows for a specific n8n user."
  Write-Host "- Recommended: Blank unless needed."
  Write-Host "- Effect: Passes --userId."
  Write-Host "- Risk: Medium if wrong user is selected."
  Write-Host "- Rule: ProjectId and UserId cannot both be set."
  return Read-Host "UserId, or blank"
}

function Read-AllowMissingCredentialBindings {
  Write-Section "AllowMissingCredentialBindings"
  Write-Host "- Meaning: Import even when local credential binding records are unavailable."
  Write-Host "- Recommended: No."
  Write-Host "- Effect: Imported workflows may need manual credential reassignment."
  Write-Host "- Risk: Medium to high."
  Write-Host "- Use when: First-time import or intentionally rebuilding credentials manually."
  return Read-YesNo "Use -AllowMissingCredentialBindings?" $true
}

function Read-SkipCredentialBindingRefresh {
  Write-Section "SkipCredentialBindingRefresh"
  Write-Host "- Meaning: Do not try to refresh credential bindings from live workflows before import."
  Write-Host "- Recommended: No."
  Write-Host "- Effect: Faster, but less safe when bindings are stale/missing."
  Write-Host "- Risk: Medium."
  Write-Host "- Use when: You know bindings are already current."
  return Read-YesNo "Use -SkipCredentialBindingRefresh?" $true
}

function Read-RestartContainerAfterImport {
  Write-Section "RestartContainerAfterImport"
  Write-Host "- Meaning: Restart Docker n8n after import when active/scheduled workflows were touched."
  Write-Host "- Recommended: No by default."
  Write-Host "- Effect: Runs docker restart <Container>."
  Write-Host "- Risk: Medium because it interrupts local n8n."
  Write-Host "- Use when: Schedule/cron trigger warning appears and this is local/staging."
  return Read-YesNo "Use -RestartContainerAfterImport?" $true
}

function Read-CommonSettings {
  Show-CommonSettingExplanations
  $container = Read-Default "Container" $DefaultContainer
  $bindingsFile = Read-Default "BindingsFile" $DefaultBindingsFile
  return [PSCustomObject]@{
    WorkflowDir = $DefaultWorkflowDir
    Container = $container
    BindingsFile = $bindingsFile
  }
}

function New-CommandRecord($CommandName, $Script, [string[]]$Args) {
  [PSCustomObject]@{
    commandName = $CommandName
    script = $Script
    args = $Args
    cwd = $RepoRoot
    createdAt = (Get-Date).ToUniversalTime().ToString("o")
    lastExitCode = $null
    lastRunAt = $null
  }
}

function Get-CommandLine($Record) {
  $parts = @($Record.script)
  foreach ($arg in @($Record.args)) {
    if ($arg -match '\s') {
      $parts += ('"{0}"' -f ($arg -replace '"', '\"'))
    } else {
      $parts += $arg
    }
  }
  return ($parts -join " ")
}

function Get-HelperScriptPath($Name) {
  return (Join-Path $HelperScriptDir $Name)
}

function Save-PreviousCommand($Record, $ExitCode) {
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $PreviousCommandFile) | Out-Null
  $Record.lastExitCode = $ExitCode
  $Record.lastRunAt = (Get-Date).ToUniversalTime().ToString("o")
  $Record | ConvertTo-Json -Depth 10 | Set-Content -Path $PreviousCommandFile -Encoding utf8
}

function Load-PreviousCommand {
  if (-not (Test-Path -Path $PreviousCommandFile -PathType Leaf)) {
    return $null
  }
  return Get-Content -Raw -Path $PreviousCommandFile | ConvertFrom-Json
}

function Show-PreviousCommand {
  $previous = Load-PreviousCommand
  if ($null -eq $previous) {
    Write-Step "INFO" "No previous command is saved."
    return
  }
  Write-Section "Previous Command"
  Write-Host ("Name       : {0}" -f $previous.commandName)
  Write-Host ("Command    : {0}" -f (Get-CommandLine $previous))
  Write-Host ("Cwd        : {0}" -f $previous.cwd)
  Write-Host ("Created at : {0}" -f $previous.createdAt)
  Write-Host ("Last run   : {0}" -f $previous.lastRunAt)
  Write-Host ("Last exit  : {0}" -f $previous.lastExitCode)
}

function Command-RequiresConfirmation($Record) {
  $isImportExport = $Record.commandName -match 'Import|Export'
  $isDryRun = @($Record.args) -contains "-DryRun"
  return $isImportExport -and -not $isDryRun
}

function Invoke-CommandRecord($Record, [bool]$SkipMenuConfirmation) {
  Write-Section "Command"
  Write-Host (Get-CommandLine $Record)

  if ((Command-RequiresConfirmation $Record) -and -not $SkipMenuConfirmation) {
    Write-Section "Previous command / real live action"
    Write-Host "- Meaning: Re-run the command shown above."
    Write-Host "- Recommended: Review the command before running it."
    Write-Host "- Effect: Real import/export can read or mutate live n8n depending on the script."
    Write-Host "- Risk: Same as the saved command."
    Write-Host "- Safety: The underlying script still performs its own checks."
    if (-not (Read-YesNo "Run this real import/export command now?" $true)) {
      Write-Step "CANCEL" "Command was not run."
      return
    }
  }

  if ($Record.script -match '\.ps1$') {
    & powershell -ExecutionPolicy Bypass -File $Record.script @($Record.args)
    $exitCode = $LASTEXITCODE
  } else {
    & node @($Record.args)
    $exitCode = $LASTEXITCODE
  }

  Save-PreviousCommand $Record $exitCode
  Write-Step "DONE" "Command finished with exit code $exitCode."
}

function Build-ExportCommand([bool]$DryRunMode) {
  $common = Read-CommonSettings
  $mode = Read-ExportMode
  $publishedOnly = Read-PublishedOnly
  $includeArchived = $false
  if ($mode -eq "AllLive") {
    $includeArchived = Read-IncludeArchived
  }
  $preserveTags = Read-PreserveTags
  $missingLiveMode = Read-MissingLiveMode

  $args = @(
    "-WorkflowDir", $common.WorkflowDir,
    "-Container", $common.Container,
    "-BindingsFile", $common.BindingsFile,
    "-Mode", $mode,
    "-MissingLiveMode", $missingLiveMode
  )
  if ($publishedOnly) { $args += "-PublishedOnly" }
  if ($includeArchived) { $args += "-IncludeArchived" }
  if ($preserveTags) { $args += "-PreserveTags" }
  if ($DryRunMode) { $args += "-DryRun" }

  return New-CommandRecord "Export live workflows to repo" (Get-HelperScriptPath "export-n8n-workflows-live.ps1") $args
}

function Build-ImportCommand([bool]$DryRunMode) {
  $common = Read-CommonSettings
  $archivedMode = Read-ArchivedByNameMode
  $projectId = Read-ProjectId
  $userId = Read-UserId
  if (-not [string]::IsNullOrWhiteSpace($projectId) -and -not [string]::IsNullOrWhiteSpace($userId)) {
    throw "ProjectId and UserId cannot both be set. Choose one import target before running import."
  }
  $allowMissingBindings = Read-AllowMissingCredentialBindings
  $skipRefresh = Read-SkipCredentialBindingRefresh
  $restartAfterImport = Read-RestartContainerAfterImport

  $args = @(
    "-WorkflowDir", $common.WorkflowDir,
    "-Container", $common.Container,
    "-BindingsFile", $common.BindingsFile,
    "-ArchivedByNameMode", $archivedMode
  )
  if (-not [string]::IsNullOrWhiteSpace($projectId)) { $args += @("-ProjectId", $projectId) }
  if (-not [string]::IsNullOrWhiteSpace($userId)) { $args += @("-UserId", $userId) }
  if ($allowMissingBindings) { $args += "-AllowMissingCredentialBindings" }
  if ($skipRefresh) { $args += "-SkipCredentialBindingRefresh" }
  if ($restartAfterImport) { $args += "-RestartContainerAfterImport" }
  if ($DryRunMode) { $args += "-DryRun" }

  return New-CommandRecord "Import repo workflows to live n8n" (Get-HelperScriptPath "import-n8n-workflows-live.ps1") $args
}

function Build-ValidateCommand {
  Show-CommonSettingExplanations
  $workflowDir = Read-Default "WorkflowDir" $DefaultWorkflowDir
  return New-CommandRecord "Validate repo workflow JSON" "node" @((Get-HelperScriptPath "validate-n8n-workflows.cjs"), $workflowDir)
}

function Invoke-UsePrevious {
  $previous = Load-PreviousCommand
  if ($null -eq $previous) {
    Write-Step "INFO" "No previous command is saved."
    return
  }
  Invoke-CommandRecord $previous ([bool]$Yes)
}

function Clear-PreviousCommand {
  if (Test-Path -Path $PreviousCommandFile -PathType Leaf) {
    Remove-Item -Path $PreviousCommandFile -Force
    Write-Step "CLEAR" "Removed $(Resolve-Path $PreviousCommandFile)."
  } else {
    Write-Step "INFO" "No previous command is saved."
  }
}

if ($UsePrevious) {
  Invoke-UsePrevious
  exit $LASTEXITCODE
}

while ($true) {
  Write-Section "n8n Workflow Sync Menu"
  Write-Host ("Repo root        : {0}" -f $RepoRoot)
  Write-Host ("Workflow dir     : {0}" -f $DefaultWorkflowDir)
  Write-Host ("Container        : {0}" -f $DefaultContainer)
  Write-Host ("Bindings file    : {0}" -f $DefaultBindingsFile)
  $previous = Load-PreviousCommand
  if ($null -eq $previous) {
    Write-Host "Previous command : (none)"
  } else {
    Write-Host ("Previous command : {0}" -f (Get-CommandLine $previous))
  }
  Write-Host ""
  Write-Host "1. Export live workflows to repo."
  Write-Host "2. Import repo workflows to live n8n."
  Write-Host "3. Validate repo workflow JSON."
  Write-Host "4. Dry-run export."
  Write-Host "5. Dry-run import."
  Write-Host "6. Use previous command."
  Write-Host "7. Show previous command."
  Write-Host "8. Clear previous command."
  Write-Host "0. Exit."

  $choice = Read-Host "Choose an option"
  switch ($choice) {
    "1" {
      $record = Build-ExportCommand $false
      Invoke-CommandRecord $record $false
    }
    "2" {
      $record = Build-ImportCommand $false
      Invoke-CommandRecord $record $false
    }
    "3" {
      $record = Build-ValidateCommand
      Invoke-CommandRecord $record $true
    }
    "4" {
      $record = Build-ExportCommand $true
      Invoke-CommandRecord $record $true
    }
    "5" {
      $record = Build-ImportCommand $true
      Invoke-CommandRecord $record $true
    }
    "6" {
      Invoke-UsePrevious
    }
    "7" {
      Show-PreviousCommand
    }
    "8" {
      Clear-PreviousCommand
    }
    "0" {
      exit 0
    }
    default {
      Write-Step "WARN" "Unknown option '$choice'."
    }
  }
}
