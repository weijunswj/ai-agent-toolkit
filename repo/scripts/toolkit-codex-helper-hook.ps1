# AI-AGENT-TOOLKIT:CODEX-HELPER-HOOK-LAUNCHER v1
# Codex runs this through the hook's Windows command (commandWindows): a full powershell.exe path and
# -File, so neither cmd.exe nor PowerShell looks for node or powershell in the opened folder. It starts
# Node from the absolute path setup recorded and lets Node read the hook input on stdin unchanged.

$ErrorActionPreference = "Stop"

try {
  $pluginRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
  $runtimePath = Join-Path $pluginRoot ".codex-plugin\session-start-runtime.json"
  $hookPath = Join-Path $pluginRoot "repo\scripts\toolkit-codex-helper-hook.cjs"

  if (-not (Test-Path -LiteralPath $runtimePath -PathType Leaf)) { throw "runtime metadata unavailable" }
  if (-not (Test-Path -LiteralPath $hookPath -PathType Leaf)) { throw "helper hook unavailable" }

  $runtime = [System.IO.File]::ReadAllText($runtimePath) | ConvertFrom-Json
  if ([int]$runtime.schema -ne 1) { throw "runtime metadata schema is unsupported" }
  $nodeValue = [string]$runtime.node_path
  if (-not [System.IO.Path]::IsPathRooted($nodeValue)) { throw "Node path is not absolute" }
  $nodePath = [System.IO.Path]::GetFullPath($nodeValue)
  if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) { throw "Node executable unavailable" }
} catch {
  [Console]::Error.WriteLine("Toolkit helper hook could not start ($($_.Exception.Message)). Run ``setup toolkit`` in Codex to repair the installed hook.")
  exit 1
}

& $nodePath $hookPath
exit $LASTEXITCODE
