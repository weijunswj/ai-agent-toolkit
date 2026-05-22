param(
  [string] $Workspace = ''
)

$ErrorActionPreference = 'Stop'

if ($Workspace) {
  $RepoRoot = (Resolve-Path -LiteralPath $Workspace).Path
} else {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}

$AgentRuleTemplateSpecs = @(
  @{
    ProjectId = 'development.ai-coding-agent-rules'
    SourceSideOutputDir = '_projects/development/ai-coding-agent-rules/_main'
    PartialSources = @(
      @{
        Name = 'ai-coding-agent-execution.md'
        Path = Join-Path $RepoRoot '_projects\development\ai-coding-agent-rules\_main\_partials\ai-coding-agent-execution.md'
        Rel = '_projects/development/ai-coding-agent-rules/_main/_partials/ai-coding-agent-execution.md'
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
    ProjectId = 'development.ai-coding-agent-rules'
    SourceSideOutputDir = '_projects/development/ai-coding-agent-rules/_main'
    PartialSources = @(
      @{
        Name = 'toolkit-skill-routing.md'
        Path = Join-Path $RepoRoot '_projects\development\ai-coding-agent-rules\_main\_partials\toolkit-skill-routing.md'
        Rel = '_projects/development/ai-coding-agent-rules/_main/_partials/toolkit-skill-routing.md'
      }
    )
    Templates = @(
      @{
        FileName = 'TOOLKIT-SKILL-ROUTING.template.md'
        Title = 'TOOLKIT-SKILL-ROUTING.template.md optional toolkit skill-routing add-on'
        Audience = 'Codex, OpenCode, Claude Code, Gemini CLI, or Antigravity when this toolkit''s skills folders are installed or copied'
        DestinationFile = 'AGENTS.md, CLAUDE.md, or GEMINI.md'
        DestinationDisplay = '`AGENTS.md`, `CLAUDE.md`, or `GEMINI.md`'
        ActiveNameText = 'it is not named `AGENTS.md`, `CLAUDE.md`, or `GEMINI.md`'
        InstallMode = 'toolkit_add_on'
        SourceBaselineTemplatePaths = @(
          '_projects/development/ai-coding-agent-rules/_main/AGENTS.template.md',
          '_projects/development/ai-coding-agent-rules/_main/CLAUDE.template.md',
          '_projects/development/ai-coding-agent-rules/_main/GEMINI.template.md'
        )
        BaselineTemplatePaths = @(
          'skills/ai-coding-agent-rules/AGENTS.template.md',
          'skills/ai-coding-agent-rules/CLAUDE.template.md',
          'skills/ai-coding-agent-rules/GEMINI.template.md'
        )
      }
    )
  },
  @{
    ProjectId = 'n8n.local-setup'
    SourceSideOutputDir = '_projects/n8n/local-setup/_main/agent-rules'
    PartialSources = @(
      @{
        Name = 'n8n-mcp-rules.md'
        Path = Join-Path $RepoRoot '_projects\n8n\local-setup\_main\_partials\n8n-mcp-rules.md'
        Rel = '_projects/n8n/local-setup/_main/_partials/n8n-mcp-rules.md'
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
        SourceBaselineTemplatePaths = @(
          '_projects/development/ai-coding-agent-rules/_main/AGENTS.template.md',
          '_projects/development/ai-coding-agent-rules/_main/CLAUDE.template.md',
          '_projects/development/ai-coding-agent-rules/_main/GEMINI.template.md'
        )
        BaselineTemplatePaths = @(
          'skills/ai-coding-agent-rules/AGENTS.template.md',
          'skills/ai-coding-agent-rules/CLAUDE.template.md',
          'skills/ai-coding-agent-rules/GEMINI.template.md'
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

function Get-RelativePath {
  param(
    [Parameter(Mandatory = $true)] [string] $FromFile,
    [Parameter(Mandatory = $true)] [string] $ToFile
  )

  $fromParts = @($FromFile.Replace('\', '/').Split('/') | Where-Object { $_ -ne '' })
  $toParts = @($ToFile.Replace('\', '/').Split('/') | Where-Object { $_ -ne '' })
  $fromDirs = if ($fromParts.Count -gt 1) { @($fromParts[0..($fromParts.Count - 2)]) } else { @() }

  $common = 0
  while ($common -lt $fromDirs.Count -and $common -lt $toParts.Count -and $fromDirs[$common] -eq $toParts[$common]) {
    $common += 1
  }

  $resultParts = @()
  for ($i = $common; $i -lt $fromDirs.Count; $i += 1) {
    $resultParts += '..'
  }
  for ($i = $common; $i -lt $toParts.Count; $i += 1) {
    $resultParts += $toParts[$i]
  }

  if ($resultParts.Count -eq 0) {
    return $toParts[-1]
  }
  return ($resultParts -join '/')
}

function Format-RelativeMarkdownLink {
  param(
    [Parameter(Mandatory = $true)] [string] $FromFile,
    [Parameter(Mandatory = $true)] [string] $ToFile
  )

  return "[$ToFile]($(Get-RelativePath -FromFile $FromFile -ToFile $ToFile))"
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

  if ($Template.ContainsKey('InstallMode') -and ($Template.InstallMode -eq 'add_on' -or $Template.InstallMode -eq 'toolkit_add_on')) {
    $outputRelPath = "$($Spec.SourceSideOutputDir)/$($Template.FileName)"
    $baselineTemplatePaths = if ($Template.ContainsKey('SourceBaselineTemplatePaths')) { @($Template.SourceBaselineTemplatePaths) } else { @($Template.BaselineTemplatePaths) }
    $bodyParts += ""
    if ($Template.InstallMode -eq 'toolkit_add_on') {
      $bodyParts += "This optional add-on contains toolkit skill-routing rules only."
      $bodyParts += ""
      $bodyParts += "Use it only when the target environment has this toolkit's ``skills/`` folders installed or copied."
      $bodyParts += ""
      $bodyParts += "Do not use it as a standalone replacement for generic AGENTS/CLAUDE/GEMINI rules."
      $bodyParts += ""
      $bodyParts += "First install or copy the generic baseline rules from:"
    } else {
      $bodyParts += "This is an n8n-specific add-on. It does not include the generic AI coding agent baseline rules."
      $bodyParts += ""
      $bodyParts += "First install or copy the generic baseline rules from:"
    }
    $bodyParts += ""
    foreach ($baselinePath in $baselineTemplatePaths) {
      $bodyParts += "- $(Format-RelativeMarkdownLink -FromFile $outputRelPath -ToFile $baselinePath)"
    }
    $bodyParts += ""
    if ($Template.InstallMode -eq 'toolkit_add_on') {
      $bodyParts += "Then merge the fenced payload from this file under the generic baseline in the same active instruction file."
      $bodyParts += ""
      $bodyParts += "Do not overwrite existing active instruction files. Merge manually or produce a diff/merge plan."
    } else {
      $bodyParts += "Then merge the fenced payload from this file under the generic rules in the same active instruction file."
      $bodyParts += ""
      $bodyParts += "Do not use this add-on alone to create a fresh active instruction file."
      $bodyParts += ""
      $bodyParts += "If the target repo already has $destinationDisplay, do not overwrite it. Merge manually or produce a diff/merge plan."
    }
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

Write-Host 'Generated generic AI coding agent templates, optional toolkit skill-routing add-on, and n8n MCP add-on template.'
