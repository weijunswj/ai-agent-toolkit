$ErrorActionPreference = 'Stop'

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$TemplatesDir = Join-Path $RepoRoot 'skills\n8n-local-setup\templates\agent-rules'
$ProjectMainPartialsDir = Join-Path $RepoRoot '_projects\n8n\local-setup\_main\templates\partials'
$ToolkitPartialsDir = Join-Path $RepoRoot 'skills\n8n-local-setup\templates\agent-rules\partials'

$PartialSources = @(
  @{
    Name = 'ai-coding-agent-execution.md'
    Path = Join-Path $ProjectMainPartialsDir 'ai-coding-agent-execution.md'
    Rel = '_projects/n8n/local-setup/_main/templates/partials/ai-coding-agent-execution.md'
  },
  @{
    Name = 'n8n-mcp-rules.md'
    Path = Join-Path $ProjectMainPartialsDir 'n8n-mcp-rules.md'
    Rel = '_projects/n8n/local-setup/_main/templates/partials/n8n-mcp-rules.md'
  },
  @{
    Name = 'skill-routing-rules.md'
    Path = Join-Path $ToolkitPartialsDir 'skill-routing-rules.md'
    Rel = 'skills/n8n-local-setup/templates/agent-rules/partials/skill-routing-rules.md'
  }
)

function Read-Partial($Source) {
  $path = $Source.Path
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Missing partial: $path"
  }
  return ((Get-Content -LiteralPath $path -Raw) -replace "`r`n", "`n").TrimEnd()
}

function New-GeneratedNotice {
  $notice = @(
    '<!--',
    'Generated from toolkit project source. Do not edit directly.',
    'Project: n8n.local-setup'
  )
  foreach ($source in $PartialSources) {
    $notice += "Source: $($source.Rel)"
  }
  $notice += 'Update the project source and run sync.'
  $notice += '-->'
  $notice += ''
  return ($notice -join "`n")
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

  foreach ($partial in $PartialSources) {
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

Write-Host 'Generated skills/n8n-local-setup/templates/agent-rules/AGENTS.md, CLAUDE.md, and GEMINI.md.'
