$ErrorActionPreference = 'Stop'

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$TemplatesDir = Join-Path $RepoRoot 'templates\agent-rules'
$PartialsDir = Join-Path $RepoRoot 'projects\n8n\local-setup\exports\templates\agent-rules\partials'

$PartialFiles = @(
  'ai-coding-agent-execution.md',
  'n8n-mcp-rules.md',
  'skill-routing-rules.md'
)

function Read-Partial($Name) {
  $path = Join-Path $PartialsDir $Name
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Missing partial: $path"
  }
  return ((Get-Content -LiteralPath $path -Raw) -replace "`r`n", "`n").TrimEnd()
}

function New-GeneratedNotice {
  $sources = ($PartialFiles | ForEach-Object { "- projects/n8n/local-setup/exports/templates/agent-rules/partials/$_" }) -join "`n"
  return @"
<!--
GENERATED FILE. DO NOT EDIT DIRECTLY.

Edit these source files instead:
$sources

Then regenerate with:
- scripts/build-agent-rule-templates.ps1
-->


"@
}

function Write-GeneratedTemplate {
  param(
    [Parameter(Mandatory = $true)] [string] $FileName,
    [Parameter(Mandatory = $true)] [string] $Title,
    [Parameter(Mandatory = $true)] [string] $Audience
  )

  $bodyParts = @(
    "# $Title",
    "",
    "Use this generated template for $Audience."
  )

  foreach ($partial in $PartialFiles) {
    $bodyParts += ""
    $bodyParts += Read-Partial $partial
  }

  $content = (New-GeneratedNotice) + (($bodyParts -join "`n").TrimEnd()) + "`n"
  $target = Join-Path $TemplatesDir $FileName
  $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
  [System.IO.File]::WriteAllText($target, $content, $utf8NoBom)
}

Write-GeneratedTemplate -FileName 'AGENTS.md' -Title 'AGENTS.md AI Coding Agent Rules' -Audience 'Codex or OpenCode'
Write-GeneratedTemplate -FileName 'CLAUDE.md' -Title 'CLAUDE.md AI Coding Agent Rules' -Audience 'Claude Code'
Write-GeneratedTemplate -FileName 'GEMINI.md' -Title 'GEMINI.md AI Coding Agent Rules' -Audience 'Antigravity or Gemini CLI'

Write-Host 'Generated templates/agent-rules/AGENTS.md, CLAUDE.md, and GEMINI.md.'
