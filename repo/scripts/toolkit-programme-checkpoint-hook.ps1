# AI-AGENT-TOOLKIT:PROGRAMME-CHECKPOINT-HOOK-LAUNCHER v1
# Codex runs this through the turn-end hook's Windows command (commandWindows): a full powershell.exe
# path and -File, so neither cmd.exe nor PowerShell looks for node or powershell in the opened folder. It
# starts Node from the absolute path setup recorded and lets Node read the hook input on stdin unchanged.
# Unlike the other launchers it never fails the hook: a turn-end hook must not block or continue a turn,
# and it prints nothing because Codex reads turn-end stdout as JSON.

$ErrorActionPreference = "Stop"

try {
  $pluginRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
  $runtimePath = Join-Path $pluginRoot ".codex-plugin\session-start-runtime.json"
  $hookPath = Join-Path $pluginRoot "repo\scripts\toolkit-programme-checkpoint-hook.cjs"

  if (-not (Test-Path -LiteralPath $runtimePath -PathType Leaf)) { exit 0 }
  if (-not (Test-Path -LiteralPath $hookPath -PathType Leaf)) { exit 0 }

  $runtime = [System.IO.File]::ReadAllText($runtimePath) | ConvertFrom-Json
  if ([int]$runtime.schema -ne 1) { exit 0 }
  $nodeValue = [string]$runtime.node_path
  if (-not [System.IO.Path]::IsPathRooted($nodeValue)) { exit 0 }
  $nodePath = [System.IO.Path]::GetFullPath($nodeValue)
  if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) { exit 0 }
} catch {
  exit 0
}

& $nodePath $hookPath | Out-Null
exit 0
