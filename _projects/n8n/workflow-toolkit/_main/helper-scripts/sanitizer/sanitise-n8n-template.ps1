param(
  [switch]$PreserveUnicode,
  [switch]$AllowEmpty,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

trap {
  Write-Host ""
  Write-Host "== " -NoNewline -ForegroundColor DarkGray
  Write-Host "Sanitise failed" -NoNewline -ForegroundColor Red
  Write-Host " ==" -ForegroundColor DarkGray
  Write-Host ($_.Exception.Message) -ForegroundColor Red
  exit 1
}

if (-not $PSScriptRoot) {
  throw "This script must be run from a .ps1 file."
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

$RepoRoot = Resolve-RepoRootFromScript
Set-Location $RepoRoot

$InputDir = ".to-sanitise"
$OutputDir = ".sanitised"
$InputDirFull = Join-Path $RepoRoot $InputDir
$OutputDirFull = Join-Path $RepoRoot $OutputDir
$ScriptFolderName = Split-Path -Leaf $PSScriptRoot
$WrapperDisplayPath = Join-Path $ScriptFolderName "_sanitise-n8n-template.cmd"
$StripperScript = Join-Path $PSScriptRoot "prepare-n8n-template.js"

function Write-Section($Title) {
  Write-Host ""
  Write-Host "== " -NoNewline -ForegroundColor DarkGray
  Write-Host $Title -NoNewline -ForegroundColor Cyan
  Write-Host " ==" -ForegroundColor DarkGray
}

function Get-StatusColor($Status) {
  switch (([string]$Status).Trim().ToUpperInvariant()) {
    { $_ -in @("OK", "VALID", "READY", "DONE", "FOUND", "MATCH", "CREATE", "EXPORT", "IMPORT", "RESTART", "CLEAR") } { return "Green" }
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

function Test-CommandExists($Command) {
  $null -ne (Get-Command $Command -ErrorAction SilentlyContinue)
}

function Get-OutputFileName($InputFile) {
  $baseName = [System.IO.Path]::GetFileNameWithoutExtension($InputFile.Name)
  $baseName = $baseName -replace '\.live-export$', ''
  $baseName = $baseName -replace '\.live-import$', ''
  $baseName = $baseName -replace '\.template$', ''
  return "$baseName.template.json"
}

Write-Section "n8n template sanitiser"
Write-Host ("Run from   : {0}" -f $WrapperDisplayPath)
Write-Host ("Input dir  : {0}" -f $InputDir)
Write-Host ("Output dir : {0}" -f $OutputDir)
Write-Host ("Mode       : {0}" -f ($(if ($DryRun) { "Dry run" } else { "Overwrite sanitised templates" })))

if (-not (Test-CommandExists "node")) {
  throw "Node.js was not found on PATH. Install Node.js or open a shell where node is available."
}

if (-not (Test-Path -LiteralPath $StripperScript -PathType Leaf)) {
  throw "Missing stripper script: $StripperScript"
}

if (-not (Test-Path -LiteralPath $InputDirFull -PathType Container)) {
  New-Item -ItemType Directory -Force -Path $InputDirFull | Out-Null
  Write-Step "CREATE" "Created input folder: $InputDir"
}

if (-not (Test-Path -LiteralPath $OutputDirFull -PathType Container)) {
  New-Item -ItemType Directory -Force -Path $OutputDirFull | Out-Null
  Write-Step "CREATE" "Created output folder: $OutputDir"
}

$workflowFiles = Get-ChildItem -Path $InputDirFull -Filter "*.json" -File | Sort-Object Name

if (-not $workflowFiles -or $workflowFiles.Count -eq 0) {
  Write-Section "Nothing to sanitise"
  Write-Host "Put your non-stripped n8n export JSON here:"
  Write-Host "  $InputDir"
  Write-Host ""
  Write-Host ("Then go into the {0} folder and run:" -f $ScriptFolderName)
  Write-Host "  _sanitise-n8n-template.cmd"
  exit 0
}

Write-Section "Workflows"

$preparedCount = 0
$failedCount = 0

foreach ($workflowFile in $workflowFiles) {
  $outputFile = Join-Path $OutputDirFull (Get-OutputFileName $workflowFile)
  $outputName = [System.IO.Path]::GetFileName($outputFile)
  $willOverwrite = Test-Path -LiteralPath $outputFile -PathType Leaf

  Write-Step "CHECK" "$($workflowFile.Name) -> $outputName"
  if ($willOverwrite -and -not $DryRun) {
    Write-Step "OVERWR" "Existing $outputName will be overwritten."
  }

  if ($DryRun) {
    Write-Step "PLAN" "Would sanitise $($workflowFile.Name)."
    continue
  }

  $nodeArgs = @(
    $StripperScript,
    $workflowFile.FullName,
    $outputFile
  )

  if ($PreserveUnicode) {
    $nodeArgs += "--preserve-unicode"
  }

  if ($AllowEmpty) {
    $nodeArgs += "--allow-empty"
  }

  & node @nodeArgs
  if ($LASTEXITCODE -ne 0) {
    $failedCount += 1
    Write-Step "FAIL" "$($workflowFile.Name) could not be sanitised."
    continue
  }

  $preparedCount += 1
  Write-Step "DONE" "$($workflowFile.Name) sanitised."
}

Write-Section "Summary"
Write-Host ("Sanitised : {0}" -f $preparedCount)
Write-Host ("Failed    : {0}" -f $failedCount)

if ($DryRun) {
  Write-Host "No template files were written."
}

Write-Section "Manual move needed"
Write-Host "Cleaned template files are in:"
Write-Host "  $OutputDir"
Write-Host ""
Write-Host "Next: Review/import-test them, then manually move the good ones into your chosen folder."
Write-Host "Preferred final folder style:"
Write-Host "  templates\<category>\<workflow-name>.template.json"
Write-Host ""
Write-Host "Do not blindly commit files from $OutputDir. Check placeholders, sticky notes, and import behaviour first."

if ($failedCount -gt 0) {
  exit 1
}

exit 0
