$ErrorActionPreference = 'Stop'

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')

$AgentRuleTemplateSpecs = @(
  @{
    ProjectId = 'n8n.local-setup'
    SourceSideOutputDir = '_projects/n8n/local-setup/_main/templates/agent-rules'
    PartialSources = @(
      @{
        Name = 'ai-coding-agent-execution.md'
        Rel = '_projects/n8n/local-setup/_main/templates/partials/ai-coding-agent-execution.md'
      },
      @{
        Name = 'n8n-mcp-rules.md'
        Rel = '_projects/n8n/local-setup/_main/templates/partials/n8n-mcp-rules.md'
      },
      @{
        Name = 'skill-routing-rules.md'
        Rel = 'skills/n8n-local-setup/templates/agent-rules/partials/skill-routing-rules.md'
      }
    )
    Templates = @(
      @{
        FileName = 'AGENTS.template.md'
        Title = 'AGENTS.md AI Coding Agent Rules Template'
        Audience = 'Codex or OpenCode'
        DestinationFile = 'AGENTS.md'
        InstallGuidance = @(
          'This template is inert while it keeps the `.template.md` filename. Copy or merge it into a target repo root as `{destination}` only when the user explicitly wants those agent rules installed.',
          'If the target repo already has `{destination}`, do not overwrite it. Produce a merge/diff plan instead.'
        )
      },
      @{
        FileName = 'CLAUDE.template.md'
        Title = 'CLAUDE.md AI Coding Agent Rules Template'
        Audience = 'Claude Code'
        DestinationFile = 'CLAUDE.md'
        InstallGuidance = @(
          'This template is inert while it keeps the `.template.md` filename. Copy or merge it into a target repo root as `{destination}` only when the user explicitly wants those agent rules installed.',
          'If the target repo already has `{destination}`, do not overwrite it. Produce a merge/diff plan instead.'
        )
      },
      @{
        FileName = 'GEMINI.template.md'
        Title = 'GEMINI.md AI Coding Agent Rules Template'
        Audience = 'Antigravity or Gemini CLI'
        DestinationFile = 'GEMINI.md'
        InstallGuidance = @(
          'This template is inert while it keeps the `.template.md` filename. Copy or merge it into a target repo root as `{destination}` only when the user explicitly wants those agent rules installed.',
          'If the target repo already has `{destination}`, do not overwrite it. Produce a merge/diff plan instead.'
        )
      }
    )
  }
)

function Read-Partial($Source) {
  $path = Join-Path $RepoRoot $Source.Rel
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

function Write-GeneratedTemplate {
  param(
    [Parameter(Mandatory = $true)] [hashtable] $Spec,
    [Parameter(Mandatory = $true)] [hashtable] $Template
  )

  $bodyParts = @(
    "# $($Template.Title)",
    "",
    "Use this generated template for $($Template.Audience).",
    ""
  )
  for ($index = 0; $index -lt $Template.InstallGuidance.Count; $index++) {
    $bodyParts += $Template.InstallGuidance[$index].Replace('{destination}', $Template.DestinationFile)
    if ($index -lt ($Template.InstallGuidance.Count - 1)) {
      $bodyParts += ""
    }
  }

  foreach ($partial in $Spec.PartialSources) {
    $bodyParts += ""
    $bodyParts += Read-Partial $partial
  }

  $content = (New-GeneratedNotice -Spec $Spec) + (($bodyParts -join "`n").TrimEnd()) + "`n"
  $templatesDir = Join-Path $RepoRoot $Spec.SourceSideOutputDir
  $target = Join-Path $templatesDir $Template.FileName
  $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
  [System.IO.Directory]::CreateDirectory($templatesDir) | Out-Null
  [System.IO.File]::WriteAllText($target, $content, $utf8NoBom)
}

foreach ($spec in $AgentRuleTemplateSpecs) {
  foreach ($template in $spec.Templates) {
    Write-GeneratedTemplate -Spec $spec -Template $template
  }
}

Write-Host 'Generated _projects/n8n/local-setup/_main/templates/agent-rules/AGENTS.template.md, CLAUDE.template.md, and GEMINI.template.md.'
