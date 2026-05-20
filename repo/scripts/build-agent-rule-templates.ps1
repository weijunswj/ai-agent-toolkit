$ErrorActionPreference = 'Stop'

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$TemplatesDir = Join-Path $RepoRoot '_projects\n8n\local-setup\_main\templates\agent-rules'
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
    [Parameter(Mandatory = $true)] [string] $Audience,
    [Parameter(Mandatory = $true)] [string] $DestinationFile
  )

  $bodyParts = @(
    "# $Title",
    "",
    "Use this generated template for $Audience.",
    "",
    "This template is inert while it keeps the ``.template.md`` filename. Copy or merge it into a target repo root as ``$DestinationFile`` only when the user explicitly wants those agent rules installed.",
    "",
    "If the target repo already has ``$DestinationFile``, do not overwrite it. Produce a merge/diff plan instead."
  )

  foreach ($partial in $PartialSources) {
    $bodyParts += ""
    $bodyParts += Read-Partial $partial
  }

  $content = (New-GeneratedNotice) + (($bodyParts -join "`n").TrimEnd()) + "`n"
  $target = Join-Path $TemplatesDir $FileName
  $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
  [System.IO.Directory]::CreateDirectory($TemplatesDir) | Out-Null
  [System.IO.File]::WriteAllText($target, $content, $utf8NoBom)
}

Write-GeneratedTemplate -FileName 'AGENTS.template.md' -Title 'AGENTS.md AI Coding Agent Rules Template' -Audience 'Codex or OpenCode' -DestinationFile 'AGENTS.md'
Write-GeneratedTemplate -FileName 'CLAUDE.template.md' -Title 'CLAUDE.md AI Coding Agent Rules Template' -Audience 'Claude Code' -DestinationFile 'CLAUDE.md'
Write-GeneratedTemplate -FileName 'GEMINI.template.md' -Title 'GEMINI.md AI Coding Agent Rules Template' -Audience 'Antigravity or Gemini CLI' -DestinationFile 'GEMINI.md'

Write-Host 'Generated _projects/n8n/local-setup/_main/templates/agent-rules/AGENTS.template.md, CLAUDE.template.md, and GEMINI.template.md.'
