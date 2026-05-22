param(
  [string] $Workspace = ''
)

$ErrorActionPreference = 'Stop'

if ($Workspace) {
  $RepoRoot = (Resolve-Path -LiteralPath $Workspace).Path
} else {
  $RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
}

$SpecFile = Join-Path $PSScriptRoot 'agent-rule-template-specs.json'
$SpecDocument = Get-Content -LiteralPath $SpecFile -Raw | ConvertFrom-Json

function Test-JsonProperty {
  param(
    [Parameter(Mandatory = $true)] $Object,
    [Parameter(Mandatory = $true)] [string] $Name
  )

  return $null -ne $Object.PSObject.Properties[$Name]
}

function Get-JsonPropertyValue {
  param(
    [Parameter(Mandatory = $true)] $Object,
    [Parameter(Mandatory = $true)] [string] $Name
  )

  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property) {
    return $null
  }
  return $property.Value
}

function Convert-InstallExample {
  param(
    [Parameter(Mandatory = $true)] $ExampleDefinition
  )

  return @{
    Heading = $ExampleDefinition.heading
    Path = $ExampleDefinition.path
    Commands = @($ExampleDefinition.commands)
  }
}

function Convert-TemplateDefinition {
  param(
    [Parameter(Mandatory = $true)] $TemplateDefinition
  )

  $template = @{
    FileName = $TemplateDefinition.fileName
    Title = $TemplateDefinition.title
    Audience = $TemplateDefinition.audience
    DestinationFile = $TemplateDefinition.destination
  }

  foreach ($key in @('destinationDisplay', 'activeNameText', 'installSubject', 'installMode')) {
    if (Test-JsonProperty -Object $TemplateDefinition -Name $key) {
      $pascalKey = ($key.Substring(0, 1).ToUpperInvariant() + $key.Substring(1))
      if ($key -eq 'destinationDisplay') { $pascalKey = 'DestinationDisplay' }
      if ($key -eq 'activeNameText') { $pascalKey = 'ActiveNameText' }
      if ($key -eq 'installSubject') { $pascalKey = 'InstallSubject' }
      if ($key -eq 'installMode') { $pascalKey = 'InstallMode' }
      $template[$pascalKey] = Get-JsonPropertyValue -Object $TemplateDefinition -Name $key
    }
  }

  if (Test-JsonProperty -Object $TemplateDefinition -Name 'installExamples') {
    $template.InstallExamples = @($TemplateDefinition.installExamples | ForEach-Object { Convert-InstallExample $_ })
  }
  if (Test-JsonProperty -Object $TemplateDefinition -Name 'output') {
    $template.Output = $TemplateDefinition.output
  }
  if (Test-JsonProperty -Object $TemplateDefinition -Name 'publishedOutput') {
    $template.PublishedOutput = $TemplateDefinition.publishedOutput
  }
  if (Test-JsonProperty -Object $TemplateDefinition -Name 'sourceBaselineTemplatePaths') {
    $template.SourceBaselineTemplatePaths = @($TemplateDefinition.sourceBaselineTemplatePaths)
  }
  if (Test-JsonProperty -Object $TemplateDefinition -Name 'baselineTemplatePaths') {
    $template.BaselineTemplatePaths = @($TemplateDefinition.baselineTemplatePaths)
  }

  return $template
}

function Convert-AgentRuleTemplateSpec {
  param(
    [Parameter(Mandatory = $true)] $SpecDefinition
  )

  $partialSources = @()
  foreach ($sourceId in @($SpecDefinition.payloadSources)) {
    $source = Get-JsonPropertyValue -Object $SpecDocument.partialSources -Name $sourceId
    if ($null -eq $source) {
      throw "Unknown agent-rule partial source id: $sourceId"
    }
    $partialSources += @{
      Name = $source.name
      Path = Join-Path $RepoRoot $source.rel
      Rel = $source.rel
    }
  }

  $spec = @{
    ProjectId = $SpecDefinition.projectId
    PartialSources = @($partialSources)
    Templates = @($SpecDefinition.templates | ForEach-Object { Convert-TemplateDefinition $_ })
  }
  if (Test-JsonProperty -Object $SpecDefinition -Name 'sourceSideOutputDir') {
    $spec.SourceSideOutputDir = $SpecDefinition.sourceSideOutputDir
  }
  return $spec
}

$AgentRuleTemplateSpecs = @($SpecDocument.templateSpecs | ForEach-Object { Convert-AgentRuleTemplateSpec $_ })

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

  if (-not $Template.ContainsKey('Output') -or [string]::IsNullOrWhiteSpace($Template.Output)) {
    return
  }
  if (-not $Spec.ContainsKey('SourceSideOutputDir') -or [string]::IsNullOrWhiteSpace($Spec.SourceSideOutputDir)) {
    throw "Source-side agent-rule template $($Template.FileName) has output but no sourceSideOutputDir."
  }

  $normalizedOutput = $Template.Output.Replace('\', '/')
  $normalizedOutputDir = $Spec.SourceSideOutputDir.Replace('\', '/').TrimEnd('/')
  if (-not $normalizedOutput.StartsWith("$normalizedOutputDir/")) {
    throw "Source-side agent-rule template $($Template.FileName) output must stay under $($Spec.SourceSideOutputDir): $($Template.Output)"
  }

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
    $outputRelPath = $Template.Output
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
  $target = Join-Path $RepoRoot $Template.Output
  $targetDir = Split-Path -Parent $target
  $utf8NoBom = [System.Text.UTF8Encoding]::new($false)
  [System.IO.Directory]::CreateDirectory($targetDir) | Out-Null
  [System.IO.File]::WriteAllText($target, $content, $utf8NoBom)
}

foreach ($spec in $AgentRuleTemplateSpecs) {
  foreach ($template in $spec.Templates) {
    Write-GeneratedTemplate -Spec $spec -Template $template
  }
}

Write-Host 'Generated agent-rule templates from shared template specs.'
