$ErrorActionPreference = 'Stop'

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..\..\..\..')
$Generator = Join-Path $RepoRoot 'repo\scripts\build-agent-rule-templates.ps1'

if (-not (Test-Path -LiteralPath $Generator -PathType Leaf)) {
    throw "Missing toolkit agent-rule template generator: $Generator"
}

& $Generator
