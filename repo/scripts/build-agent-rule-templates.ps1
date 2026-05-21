$ErrorActionPreference = 'Stop'

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')

$AgentRuleTemplateSpecs = @(
  @{
    ProjectId = 'development.ai-coding-agent-rules'
    SourceSideOutputDir = '_projects/development/ai-coding-agent-rules/_main/templates/agent-rules'
    PartialSources = @(
      @{
        Name = 'ai-coding-agent-execution.md'
        Path = Join-Path $RepoRoot '_projects\development\ai-coding-agent-rules\_main\templates\partials\ai-coding-agent-execution.md'
        Rel = '_projects/development/ai-coding-agent-rules/_main/templates/partials/ai-coding-agent-execution.md'
      },
      @{
        Name = 'toolkit-skill-routing.md'
        Path = Join-Path $RepoRoot '_projects\development\ai-coding-agent-rules\_main\templates\partials\toolkit-skill-routing.md'
        Rel = '_projects/development/ai-coding-agent-rules/_main/templates/partials/toolkit-skill-routing.md'
      }
    )
    Templates = @(
      @{
        FileName = 'AGENTS.template.md'
        Title = 'AGENTS.template.md AI coding agent rules'
        Audience = 'Codex or OpenCode'
        DestinationFile = 'AGENTS.md'
        InstallSubject = 'generic Codex/OpenCode rules'
        InstallExamples = @(
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
      },
      @{
        FileName = 'CLAUDE.template.md'
        Title = 'CLAUDE.template.md AI coding agent rules'
        Audience = 'Claude Code'
        DestinationFile = 'CLAUDE.md'
        InstallSubject = 'generic Claude Code rules'
        InstallExamples = @(
          @{
            Heading = 'Claude Code global rules example'
            Path = 'C:\Users\<your-user>\.claude\CLAUDE.md'
            Commands = @('mkdir $HOME\.claude -Force', 'notepad $HOME\.claude\CLAUDE.md')
          }
        )
      },
      @{
        FileName = 'GEMINI.template.md'
        Title = 'GEMINI.template.md AI coding agent rules'
        Audience = 'Gemini CLI or Antigravity'
        DestinationFile = 'GEMINI.md'
        InstallSubject = 'generic Gemini CLI/Antigravity rules'
        InstallExamples = @(
          @{
            Heading = 'Gemini CLI and Antigravity global rules example'
            Path = 'C:\Users\<your-user>\.gemini\GEMINI.md'
            Commands = @('mkdir $HOME\.gemini -Force', 'notepad $HOME\.gemini\GEMINI.md')
          }
        )
      }
    )
  },
  @{
    ProjectId = 'n8n.local-setup'
    SourceSideOutputDir = '_projects/n8n/local-setup/_main/templates/agent-rules'
    PartialSources = @(
      @{
        Name = 'n8n-mcp-rules.md'
        Path = Join-Path $RepoRoot '_projects\n8n\local-setup\_main\templates\partials\n8n-mcp-rules.md'
        Rel = '_projects/n8n/local-setup/_main/templates/partials/n8n-mcp-rules.md'
      }
    )
    Templates = @(
      @{
        FileName = 'n8n-mcp-rules.template.md'
        Title = 'n8n-mcp-rules.template.md n8n MCP workflow rules add-on'
        Audience = 'Codex, OpenCode, Claude Code, Gemini CLI, or Antigravity after generic agent rules are installed'
        DestinationFile = 'AGENTS.md, CLAUDE.md, or GEMINI.md'
        DestinationDisplay = '`AGENTS.md`, `CLAUDE.md`, or `GEMINI.md`'
        ActiveNameText = 'it is not named `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md`'
        InstallMode = 'add_on'
        BaselineTemplatePaths = @(
          'skills/ai-coding-agent-rules/templates/agent-rules/AGENTS.template.md',
          'skills/ai-coding-agent-rules/templates/agent-rules/CLAUDE.template.md',
          'skills/ai-coding-agent-rules/templates/agent-rules/GEMINI.template.md'
        )
      }
    )
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
  param(
    [Parameter(Mandatory = $true)] [hashtable] $Spec
  )

  $notice = @(
    '<!--',
    'Generated from toolkit project source. Do not edit directly.',
    "Project: $($Spec.ProjectId)"
  )
  foreach ($source in $Spec.PartialSources) {
    $notice += "Source: $($source.Rel)"
  }
  $notice += 'Update the project source and run sync.'
  $notice += '-->'
  $notice += ''
  return ($notice -join "`n")
}

function Format-RepoRootLink {
  param(
    [Parameter(Mandatory = $true)] [string] $RelPath
  )

  return "[$RelPath](/$RelPath)"
}

function Write-GeneratedTemplate {
  param(
    [Parameter(Mandatory = $true)] [hashtable] $Spec,
    [Parameter(Mandatory = $true)] [hashtable] $Template
  )

  $destinationDisplay = if ($Template.ContainsKey('DestinationDisplay')) { $Template.DestinationDisplay } else { "``$($Template.DestinationFile)``" }
  $activeNameText = if ($Template.ContainsKey('ActiveNameText')) { $Template.ActiveNameText } else { "it is not named $destinationDisplay" }

  $bodyParts = @(
    "# $($Template.Title)",
    "",
    "Use this generated template for $($Template.Audience).",
    "",
    "This file is inert while it keeps the ``.template.md`` filename. It is safe to keep inside a skill folder because $activeNameText."
  )

  if ($Template.ContainsKey('InstallMode') -and $Template.InstallMode -eq 'add_on') {
    $bodyParts += ""
    $bodyParts += "This is an n8n-specific add-on. It does not include the generic AI coding agent baseline rules."
    $bodyParts += ""
    $bodyParts += "First install or copy the generic baseline rules from:"
    $bodyParts += ""
    foreach ($baselinePath in @($Template.BaselineTemplatePaths)) {
      $bodyParts += "- $(Format-RepoRootLink $baselinePath)"
    }
    $bodyParts += ""
    $bodyParts += "Then merge the fenced payload from this file under the generic rules in the same active instruction file."
    $bodyParts += ""
    $bodyParts += "Do not use this add-on alone to create a fresh active instruction file."
    $bodyParts += ""
    $bodyParts += "If the target repo already has $destinationDisplay, do not overwrite it. Merge manually or produce a diff/merge plan."
  } else {
    $bodyParts += ""
    $bodyParts += "Copy or merge the fenced payload into the target repo root as $destinationDisplay only when the user explicitly wants $($Template.InstallSubject) installed."
    $bodyParts += ""
    $bodyParts += "If the target repo already has $destinationDisplay, do not overwrite it. Merge manually or produce a diff/merge plan."

    foreach ($example in @($Template.InstallExamples)) {
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
      foreach ($command in @($example.Commands)) {
        $bodyParts += $command
      }
      $bodyParts += '```'
    }
  }

  $payloadParts = @()
  foreach ($partial in $Spec.PartialSources) {
    $payloadParts += Read-Partial $partial
  }

  $bodyParts += ""
  $bodyParts += "---"
  $bodyParts += ""
  $bodyParts += '````````md'
  $bodyParts += (($payloadParts -join "`n`n").TrimEnd())
  $bodyParts += '````````'

  $content = (New-GeneratedNotice $Spec) + (($bodyParts -join "`n").TrimEnd()) + "`n"
  $targetDir = Join-Path $RepoRoot $Spec.SourceSideOutputDir
  $target = Join-Path $targetDir $Template.FileName
  $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
  [System.IO.Directory]::CreateDirectory($targetDir) | Out-Null
  [System.IO.File]::WriteAllText($target, $content, $utf8NoBom)
}

foreach ($spec in $AgentRuleTemplateSpecs) {
  foreach ($template in $spec.Templates) {
    Write-GeneratedTemplate -Spec $spec -Template $template
  }
}

Write-Host 'Generated generic AI coding agent templates and n8n MCP add-on template.'
