$ErrorActionPreference = 'Stop'

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$TemplatesDir = Join-Path $RepoRoot '_projects\n8n\local-setup\_main\templates\agent-rules'
$ProjectMainPartialsDir = Join-Path $RepoRoot '_projects\n8n\local-setup\_main\templates\partials'

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
    [Parameter(Mandatory = $true)] [string] $DestinationFile,
    [Parameter(Mandatory = $true)] [string] $InstallSubject,
    [Parameter(Mandatory = $true)] [hashtable[]] $InstallExamples
  )

  $bodyParts = @(
    "# $Title",
    "",
    "Use this generated template for $Audience.",
    "",
    "This file is inert while it keeps the ``.template.md`` filename. It is safe to keep inside a skill folder because it is not named ``$DestinationFile``.",
    "",
    "Copy or merge the fenced payload into the target repo root as ``$DestinationFile`` only when the user explicitly wants $InstallSubject installed.",
    "",
    "If the target repo already has ``$DestinationFile``, do not overwrite it. Merge manually or produce a diff/merge plan."
  )

  foreach ($example in $InstallExamples) {
    $bodyParts += ""
    $bodyParts += "## $($example.Heading)"
    $bodyParts += ""
    $bodyParts += "Copy or merge the fenced payload into:"
    $bodyParts += ""
    $bodyParts += '```text'
    $bodyParts += $example.Path
    $bodyParts += '```'
    $bodyParts += ""
    $bodyParts += "Or create it with PowerShell:"
    $bodyParts += ""
    $bodyParts += '```text'
    foreach ($command in $example.Commands) {
      $bodyParts += $command
    }
    $bodyParts += '```'
  }

  $payloadParts = @()
  foreach ($partial in $PartialSources) {
    $payloadParts += Read-Partial $partial
  }

  $bodyParts += ""
  $bodyParts += "---"
  $bodyParts += ""
  $bodyParts += '````````md'
  $bodyParts += (($payloadParts -join "`n`n").TrimEnd())
  $bodyParts += '````````'

  $content = (New-GeneratedNotice) + (($bodyParts -join "`n").TrimEnd()) + "`n"
  $target = Join-Path $TemplatesDir $FileName
  $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
  [System.IO.Directory]::CreateDirectory($TemplatesDir) | Out-Null
  [System.IO.File]::WriteAllText($target, $content, $utf8NoBom)
}

Write-GeneratedTemplate -FileName 'AGENTS.template.md' -Title 'AGENTS.template.md AI coding agent and n8n MCP workflow rules' -Audience 'Codex or OpenCode' -DestinationFile 'AGENTS.md' -InstallSubject 'Codex/OpenCode rules' -InstallExamples @(
  @{
    Heading = 'Codex global rules example'
    Path = 'C:\Users\<your-user>\.codex\AGENTS.md'
    Commands = @('mkdir $HOME\.codex -Force', 'notepad $HOME\.codex\AGENTS.md')
  },
  @{
    Heading = 'OpenCode global rules example'
    Path = 'C:\Users\<your-user>\.config\opencode\AGENTS.md'
    Commands = @('mkdir $HOME\.config\opencode -Force', 'notepad $HOME\.config\opencode\AGENTS.md')
  }
)
Write-GeneratedTemplate -FileName 'CLAUDE.template.md' -Title 'CLAUDE.template.md AI coding agent and n8n MCP workflow rules' -Audience 'Claude Code' -DestinationFile 'CLAUDE.md' -InstallSubject 'Claude Code rules' -InstallExamples @(
  @{
    Heading = 'Claude Code global rules example'
    Path = 'C:\Users\<your-user>\.claude\CLAUDE.md'
    Commands = @('mkdir $HOME\.claude -Force', 'notepad $HOME\.claude\CLAUDE.md')
  }
)
Write-GeneratedTemplate -FileName 'GEMINI.template.md' -Title 'GEMINI.template.md AI coding agent and n8n MCP workflow rules' -Audience 'Gemini CLI or Antigravity' -DestinationFile 'GEMINI.md' -InstallSubject 'Gemini CLI/Antigravity rules' -InstallExamples @(
  @{
    Heading = 'Gemini CLI and Antigravity global rules example'
    Path = 'C:\Users\<your-user>\.gemini\GEMINI.md'
    Commands = @('mkdir $HOME\.gemini -Force', 'notepad $HOME\.gemini\GEMINI.md')
  }
)

Write-Host 'Generated _projects/n8n/local-setup/_main/templates/agent-rules/AGENTS.template.md, CLAUDE.template.md, and GEMINI.template.md.'
