# AI-AGENT-TOOLKIT:CODEX-SESSION-START-LAUNCHER v1

$hookArgs = @('--hook', '--sync-enabled', '--write', '--sync-source', 'codex-plugin')

$ErrorActionPreference = "Stop"
$warning = 'Toolkit SessionStart skipped optional maintenance safely. Run `setup toolkit` in Codex to repair the installed hook.'

try {
  $pluginRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
  $runtimePath = Join-Path $pluginRoot ".codex-plugin\session-start-runtime.json"
  $launcherPath = Join-Path $pluginRoot "repo\scripts\toolkit-codex-session-start.cjs"

  if (-not (Test-Path -LiteralPath $runtimePath -PathType Leaf)) { throw "runtime metadata unavailable" }
  if (-not (Test-Path -LiteralPath $launcherPath -PathType Leaf)) { throw "Node launcher unavailable" }

  $runtime = [System.IO.File]::ReadAllText($runtimePath) | ConvertFrom-Json
  if ([int]$runtime.schema -ne 1) { throw "runtime metadata schema is unsupported" }
  $nodeValue = [string]$runtime.node_path
  if (-not [System.IO.Path]::IsPathRooted($nodeValue)) { throw "Node path is not absolute" }
  $nodePath = [System.IO.Path]::GetFullPath($nodeValue)
  if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) { throw "Node executable unavailable" }

  & $nodePath $launcherPath @hookArgs
  if ($LASTEXITCODE -ne 0) { throw "Node launcher returned non-zero" }
} catch {
  Write-Output $warning
}

exit 0
