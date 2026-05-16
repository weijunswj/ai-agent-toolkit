param(
  [switch]$PreserveUnicode,
  [switch]$AllowEmpty,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

trap {
  Write-Host ""
  Write-Host "== Sanitise failed =="
  Write-Host ($_.Exception.Message)
  exit 1
}

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

$RepoRoot = Resolve-RepoRootFromScript
Set-Location $RepoRoot

$InputDir = ".to-sanitise"
$OutputDir = ".sanitised"
$InputDirFull = Join-Path $RepoRoot $InputDir
$OutputDirFull = Join-Path $RepoRoot $OutputDir
$StripperScript = Join-Path $PSScriptRoot "prepare-n8n-template.js"

function Write-Section($Title) {
  Write-Host ""
  Write-Host "== $Title =="
}

function Write-Step($Status, $Message) {
  Write-Host ("[{0}] {1}" -f $Status.PadRight(7), $Message)
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
Write-Host ("Script dir : {0}" -f $PSScriptRoot)
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
  Write-Host "Then go into the scripts folder and run:"
  Write-Host "  sanitise-n8n-template.cmd"
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
