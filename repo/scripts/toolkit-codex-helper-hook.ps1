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

  try { $runtime = [System.IO.File]::ReadAllText($runtimePath) | ConvertFrom-Json } catch { throw "runtime metadata unreadable" }
  if ([int]$runtime.schema -ne 1) { throw "runtime metadata schema is unsupported" }
  $nodeValue = [string]$runtime.node_path
  if (-not [System.IO.Path]::IsPathRooted($nodeValue)) { throw "Node path is not absolute" }
  $nodePath = [System.IO.Path]::GetFullPath($nodeValue)
  if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) { throw "Node executable unavailable" }
} catch {
  $reason = "Toolkit helper hook could not start ($($_.Exception.Message)). Run ``setup toolkit`` in Codex to repair the installed hook."
  # Without Node no Toolkit check can run, so this launcher decides alone, before the guarded call starts.
  # Codex blocks a PreToolUse call on exit 2 with the reason on stderr; any other failure lets the call run
  # (hooks page, https://learn.chatgpt.com/docs/hooks.md, read 2026-10-23). A helper launch, or input that
  # cannot be read, is blocked: the governance check cannot run. A shell command is blocked only when it
  # could commit, push, open, edit or merge a pull request, call the GitHub API, start a host session or
  # touch Toolkit's merge approvals: the commands the attribution check and the merge hold look at. This
  # is a wider match than theirs, written to let none of theirs through. Other shell commands run, and the
  # non-zero exit shows Codex's hook failure notice.
  $toolName = $null; $command = ''
  try {
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $toolName = [string]$request.tool_name
    if ($null -ne $request.tool_input) { $command = [string]$request.tool_input.command + ' ' + [string]$request.tool_input.cmd }
  } catch { $toolName = $null }
  $guardedShell = $command -match '(?s)\bgit\b.*\b(?:commit|push)\b' -or $command -match '\bgh\s+pr\s+(?:create|edit|merge)\b' -or $command -match '(?s)\bgh\b.*\b(?:merge|sync|alias|api)\b' -or $command -match 'merge-approvals|user-state|TOOLKIT_HOST_SESSION|toolkit-(?:merge-hold|governance-hook|codex-helper-hook)' -or $command -match '\b(?:claude|codex)\b'
  if ($toolName -eq 'Bash' -and -not $guardedShell) {
    [Console]::Error.WriteLine($reason)
    exit 1
  }
  $deny = @{ hookSpecificOutput = @{ hookEventName = 'PreToolUse'; permissionDecision = 'deny'; permissionDecisionReason = $reason } }
  [Console]::Out.WriteLine(($deny | ConvertTo-Json -Compress -Depth 4))
  [Console]::Error.WriteLine($reason)
  exit 2
}

& $nodePath $hookPath
exit $LASTEXITCODE
