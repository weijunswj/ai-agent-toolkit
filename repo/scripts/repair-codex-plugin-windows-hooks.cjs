#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { auditPluginRoot } = require('./audit-n8n-skills-plugin-hooks.cjs');

const WRAPPER_MARKER = 'AI-AGENT-TOOLKIT-WINDOWS-HOOK-WRAPPER v1';
const N8N_NODE_FALLBACK_MARKER = 'AI-AGENT-TOOLKIT:N8N-NODE-FALLBACK v1';

function normalizeRelPath(value) {
  return String(value || '').replace(/\\/g, '/');
}

function stripOuterQuotes(value) {
  const trimmed = String(value || '').trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function tokenizeCommand(command) {
  const tokens = [];
  let current = '';
  let quote = '';
  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];
    if (quote) {
      if (char === quote) {
        quote = '';
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }
  if (quote) throw new Error(`unclosed quote in hook command: ${command}`);
  if (current) tokens.push(current);
  return tokens;
}

function readJsonFile(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error.message}`);
  }
}

function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function collectHookCommandEntries(hooksJson) {
  const entries = [];

  function visit(value, pathParts) {
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, [...pathParts, String(index)]));
      return;
    }
    if (!value || typeof value !== 'object') return;

    if (value.type === 'command' && typeof value.command === 'string') {
      entries.push({
        path: pathParts.join('.'),
        node: value,
        command: value.command
      });
    }

    for (const [key, child] of Object.entries(value)) {
      if (key === 'command') continue;
      visit(child, [...pathParts, key]);
    }
  }

  visit(hooksJson, ['hooks.json']);
  return entries;
}

function shellScriptRefToPluginRelPath(rawRef) {
  let ref = normalizeRelPath(stripOuterQuotes(rawRef).trim()).replace(/^\.\//, '');
  const pluginRootMatch = ref.match(/^\$\{(?:CLAUDE_PLUGIN_ROOT|PLUGIN_ROOT)\}\/+(.+)$/i);
  if (pluginRootMatch) ref = normalizeRelPath(pluginRootMatch[1]);

  if (/^[A-Za-z]:\//.test(ref) || ref.startsWith('/')) return null;
  if (!ref.endsWith('.sh')) return null;
  if (!ref.startsWith('hooks/')) ref = `hooks/${ref}`;
  return normalizeRelPath(ref);
}

function hookRelArg(pluginRelPath) {
  const normalized = normalizeRelPath(pluginRelPath);
  const withoutHooks = normalized.startsWith('hooks/') ? normalized.slice('hooks/'.length) : normalized;
  if (
    !withoutHooks ||
    withoutHooks.startsWith('/') ||
    /^[A-Za-z]:\//.test(withoutHooks) ||
    withoutHooks.split('/').includes('..') ||
    !withoutHooks.endsWith('.sh')
  ) {
    return null;
  }
  return withoutHooks;
}

function commandPathToken(token) {
  return normalizeRelPath(stripOuterQuotes(token)).toLowerCase();
}

function isBareBash(token) {
  const normalized = commandPathToken(token);
  return normalized === 'bash' || normalized === 'bash.exe';
}

function isWslBash(token) {
  return /^[a-z]:\/windows\/system32\/bash\.exe$/i.test(commandPathToken(token));
}

function isAcceptedGitBash(token) {
  const normalized = commandPathToken(token);
  return (
    normalized === 'c:/program files/git/bin/bash.exe' ||
    normalized === 'c:/program files/git/usr/bin/bash.exe'
  );
}

function isToolkitWrapperCommand(command) {
  const tokens = tokenizeCommand(command);
  if (!tokens.length) return false;
  const first = commandPathToken(tokens[0]);
  return (
    (first === 'powershell.exe' || first === 'powershell') &&
    command.includes('${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.ps1')
  );
}

function shellScriptRefsInTokens(tokens) {
  return tokens
    .map((token) => shellScriptRefToPluginRelPath(token))
    .filter(Boolean);
}

function repairCommandForHookRel(hookRel) {
  return `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "\${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.ps1" "${hookRel}"`;
}

function classifyHookCommand(entry, pluginRoot) {
  let tokens;
  try {
    tokens = tokenizeCommand(entry.command);
  } catch (error) {
    return { error: `${entry.path}: ${error.message}` };
  }

  if (!tokens.length) return { ok: true };
  if (isToolkitWrapperCommand(entry.command)) return { ok: true, usesWrapper: true };

  const first = tokens[0];
  if (isWslBash(first)) {
    return {
      error: `${entry.path} uses the WSL bash launcher on Windows and must not be trusted as Git Bash: ${entry.command}`
    };
  }

  if (isAcceptedGitBash(first)) return { ok: true };

  if (isBareBash(first)) {
    const relPath = tokens[1] ? shellScriptRefToPluginRelPath(tokens[1]) : null;
    const hookArg = relPath ? hookRelArg(relPath) : null;
    if (hookArg && tokens.length === 2) {
      const scriptPath = path.join(pluginRoot, ...relPath.split('/'));
      if (!fs.existsSync(scriptPath)) {
        return {
          error: `${entry.path} references missing hook script ${relPath}; cannot repair ${entry.command}`
        };
      }
      return { repairTo: repairCommandForHookRel(hookArg), relPath };
    }
    return {
      error: `${entry.path} uses bare bash on Windows and cannot be repaired safely. Use Git Bash explicitly or a Toolkit wrapper: ${entry.command}`
    };
  }

  const directRelPath = shellScriptRefToPluginRelPath(first);
  const directHookArg = directRelPath ? hookRelArg(directRelPath) : null;
  if (directHookArg) {
    if (tokens.length !== 1) {
      return {
        error: `${entry.path} directly invokes a .sh hook with additional arguments; repair cannot preserve this safely: ${entry.command}`
      };
    }
    const scriptPath = path.join(pluginRoot, ...directRelPath.split('/'));
    if (!fs.existsSync(scriptPath)) {
      return {
        error: `${entry.path} references missing hook script ${directRelPath}; cannot repair ${entry.command}`
      };
    }
    return { repairTo: repairCommandForHookRel(directHookArg), relPath: directRelPath };
  }

  const shellRefs = shellScriptRefsInTokens(tokens);
  if (shellRefs.length > 0) {
    return {
      error: `${entry.path} references .sh hooks through an unsupported command shape; use the Toolkit wrapper or explicit Git Bash: ${entry.command}`
    };
  }

  return { ok: true };
}

function wrapperText() {
  return [
    `# ${WRAPPER_MARKER}`,
    'param(',
    '  [Parameter(Mandatory = $true, Position = 0)]',
    '  [string]$HookScript,',
    '  [Parameter(ValueFromRemainingArguments = $true)]',
    '  [string[]]$HookArgs',
    ')',
    '$ErrorActionPreference = "Stop"',
    '',
    'if ($env:CLAUDE_PLUGIN_ROOT) {',
    '  $pluginRoot = $env:CLAUDE_PLUGIN_ROOT',
    '} elseif ($env:PLUGIN_ROOT) {',
    '  $pluginRoot = $env:PLUGIN_ROOT',
    '} else {',
    '  $pluginRoot = Split-Path -Parent (Split-Path -Parent $PSCommandPath)',
    '}',
    '',
    '$pluginRoot = [System.IO.Path]::GetFullPath($pluginRoot)',
    '$hooksRoot = [System.IO.Path]::GetFullPath((Join-Path $pluginRoot "hooks"))',
    '$candidate = [System.IO.Path]::GetFullPath((Join-Path $hooksRoot $HookScript))',
    '$hooksRootWithSeparator = $hooksRoot.TrimEnd("\\", "/") + [System.IO.Path]::DirectorySeparatorChar',
    'if (-not $candidate.StartsWith($hooksRootWithSeparator, [System.StringComparison]::OrdinalIgnoreCase)) {',
    '  throw "Hook script must stay inside plugin hooks directory: $HookScript"',
    '}',
    'if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {',
    '  throw "Hook script not found: $candidate"',
    '}',
    '',
    '$bashCandidates = @(',
    '  "C:\\Program Files\\Git\\bin\\bash.exe",',
    '  "C:\\Program Files\\Git\\usr\\bin\\bash.exe"',
    ')',
    '$bash = $bashCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1',
    'if (-not $bash) {',
    '  throw "Git Bash was not found. Install Git for Windows or make C:\\Program Files\\Git\\bin\\bash.exe available."',
    '}',
    '$bashDir = [System.IO.DirectoryInfo](Split-Path -Parent $bash)',
    'if ($bashDir.Name -ieq "bin" -and $bashDir.Parent -and $bashDir.Parent.Name -ieq "usr") {',
    '  $gitRoot = $bashDir.Parent.Parent.FullName',
    '} else {',
    '  $gitRoot = $bashDir.Parent.FullName',
    '}',
    '$gitPathEntries = @(',
    '  (Join-Path $gitRoot "usr\\bin"),',
    '  (Join-Path $gitRoot "bin"),',
    '  (Join-Path $gitRoot "mingw64\\bin")',
    ') | Where-Object { Test-Path -LiteralPath $_ -PathType Container }',
    '',
    '$env:CLAUDE_PLUGIN_ROOT = $pluginRoot.Replace("\\", "/")',
    'if (-not $env:PLUGIN_ROOT) {',
    '  $env:PLUGIN_ROOT = $env:CLAUDE_PLUGIN_ROOT',
    '}',
    '',
    'function ConvertTo-WindowsProcessArgument {',
    '  param([AllowNull()][string]$Value)',
    '  if ($null -eq $Value) { return \'""\' }',
    '  if ($Value.Length -eq 0) { return \'""\' }',
    '  if ($Value -notmatch \'[\\s"]\') { return $Value }',
    '',
    '  $result = \'"\'',
    '  $backslashes = 0',
    '  foreach ($char in $Value.ToCharArray()) {',
    '    if ($char -eq "\\") {',
    '      $backslashes += 1',
    '      continue',
    '    }',
    '    if ($char -eq \'"\') {',
    '      $result += "\\" * (($backslashes * 2) + 1)',
    '      $result += \'"\'',
    '      $backslashes = 0',
    '      continue',
    '    }',
    '    if ($backslashes -gt 0) {',
    '      $result += "\\" * $backslashes',
    '      $backslashes = 0',
    '    }',
    '    $result += $char',
    '  }',
    '  if ($backslashes -gt 0) {',
    '    $result += "\\" * ($backslashes * 2)',
    '  }',
    '  $result += \'"\'',
    '  return $result',
    '}',
    '',
    '$psi = [System.Diagnostics.ProcessStartInfo]::new()',
    '$psi.FileName = $bash',
    '$psi.UseShellExecute = $false',
    '$psi.RedirectStandardInput = $true',
    'foreach ($pathKey in @("PATH", "Path")) {',
    '  if ($psi.Environment.ContainsKey($pathKey)) {',
    '    $psi.Environment.Remove($pathKey) | Out-Null',
    '  }',
    '}',
    '$existingPath = [Environment]::GetEnvironmentVariable("PATH")',
    '$psi.Environment["PATH"] = (($gitPathEntries + @($existingPath)) | Where-Object { $_ }) -join [System.IO.Path]::PathSeparator',
    '$processArgs = @("-c", \'export PATH="/usr/bin:/bin:/mingw64/bin:${PATH:-}"; exec "$@"\', "toolkit-hook", $candidate.Replace("\\", "/"))',
    'foreach ($arg in $HookArgs) {',
    '  $processArgs += $arg',
    '}',
    '$psi.Arguments = (($processArgs | ForEach-Object { ConvertTo-WindowsProcessArgument $_ }) -join " ")',
    '',
    '$process = [System.Diagnostics.Process]::Start($psi)',
    '$stdin = [Console]::In.ReadToEnd()',
    '$process.StandardInput.Write($stdin)',
    '$process.StandardInput.Close()',
    '$process.WaitForExit()',
    'exit $process.ExitCode',
    ''
  ].join('\r\n');
}

function ensureWrapper(pluginRoot, actions, options) {
  const wrapperPath = path.join(pluginRoot, 'hooks', 'run-hook.ps1');
  const desired = wrapperText();
  if (fs.existsSync(wrapperPath)) {
    const existing = fs.readFileSync(wrapperPath, 'utf8');
    if (!existing.includes(WRAPPER_MARKER)) {
      throw new Error(`hooks/run-hook.ps1 already exists but is not Toolkit-managed; refusing to overwrite it`);
    }
    if (existing === desired) return;
  }

  actions.push('write hooks/run-hook.ps1');
  if (options.write) fs.writeFileSync(wrapperPath, desired, 'utf8');
}

function isN8nSkillsPlugin(pluginRoot, options) {
  if (options.n8n) return true;
  const manifests = [
    path.join(pluginRoot, '.codex-plugin', 'plugin.json'),
    path.join(pluginRoot, 'plugin.json')
  ];
  for (const manifestPath of manifests) {
    if (!fs.existsSync(manifestPath)) continue;
    const manifest = readJsonFile(manifestPath, normalizeRelPath(path.relative(pluginRoot, manifestPath)));
    const text = JSON.stringify(manifest);
    if (
      manifest.name === 'n8n-skills' &&
      /github\.com\/n8n-io\/skills|n8n\.io/i.test(text)
    ) {
      return true;
    }
  }
  return normalizeRelPath(pluginRoot).toLowerCase().includes('/n8n-io/n8n-skills/');
}

function replaceOrThrow(text, pattern, replacement, label) {
  if (!pattern.test(text)) throw new Error(`Could not apply n8n Node fallback patch to ${label}; upstream hook shape changed`);
  return text.replace(pattern, replacement);
}

function patchSessionStartText(text) {
  if (text.includes(N8N_NODE_FALLBACK_MARKER)) return text;
  let next = replaceOrThrow(
    text,
    /INPUT="\$\(cat\)"/,
    [
      'INPUT="$(cat)"',
      '',
      `# ${N8N_NODE_FALLBACK_MARKER}`,
      'if command -v node >/dev/null 2>&1; then',
      '  N8N_NODE_SOURCE="$(printf \'%s\' "${INPUT}" | node -e \'const fs=require("fs");let raw=fs.readFileSync(0,"utf8");let data={};try{data=raw.trim()?JSON.parse(raw):{};}catch{}process.stdout.write(String(data.source||""));\')"',
      '  N8N_NODE_SESSION_ID="$(printf \'%s\' "${INPUT}" | node -e \'const fs=require("fs");let raw=fs.readFileSync(0,"utf8");let data={};try{data=raw.trim()?JSON.parse(raw):{};}catch{}process.stdout.write(String(data.session_id||""));\')"',
      '  if [[ "${N8N_NODE_SOURCE}" == "clear" || "${N8N_NODE_SOURCE}" == "compact" ]] && [[ -n "${N8N_NODE_SESSION_ID}" ]]; then',
      '    STATE_DIR="${TMPDIR:-/tmp}/n8n-skills-state"',
      '    rm -f "${STATE_DIR}/${N8N_NODE_SESSION_ID}-"*.loaded 2>/dev/null || true',
      '  fi',
      'fi'
    ].join('\n'),
    'hooks/session-start.sh input parser'
  );

  next = replaceOrThrow(
    next,
    /if command -v jq >\/dev\/null 2>&1; then\s*\n\s*jq -n --arg ctx "\$\{ADDITIONAL_CONTEXT\}"/,
    [
      'if command -v node >/dev/null 2>&1; then',
      '  printf \'%s\' "${ADDITIONAL_CONTEXT}" | node -e \'const fs=require("fs");const ctx=fs.readFileSync(0,"utf8");process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:"SessionStart",additionalContext:ctx}}));\'',
      '  exit 0',
      'fi',
      '',
      'if command -v jq >/dev/null 2>&1; then',
      '  jq -n --arg ctx "${ADDITIONAL_CONTEXT}"'
    ].join('\n'),
    'hooks/session-start.sh output emitter'
  );
  return next;
}

function patchPreEmitText(text) {
  if (text.includes(N8N_NODE_FALLBACK_MARKER)) return text;
  let next = replaceOrThrow(
    text,
    /if command -v jq >\/dev\/null 2>&1; then\s*\n\s*SESSION_ID="\$\(echo "\$\{INPUT\}" \| jq -r '\.session_id \/\/ empty' 2>\/dev\/null\)"\s*\nelif command -v python3 >\/dev\/null 2>&1; then\s*\n\s*SESSION_ID="\$\(echo "\$\{INPUT\}" \| python3 -c 'import json,sys; d=json\.load\(sys\.stdin\); print\(d\.get\("session_id",""\)\)' 2>\/dev\/null\)"\s*\nelse\s*\n\s*exit 0\s*\nfi/,
    [
      `# ${N8N_NODE_FALLBACK_MARKER}`,
      'SESSION_ID=""',
      'if command -v node >/dev/null 2>&1; then',
      '  SESSION_ID="$(printf \'%s\' "${INPUT}" | node -e \'const fs=require("fs");let raw=fs.readFileSync(0,"utf8");let data={};try{data=raw.trim()?JSON.parse(raw):{};}catch{}process.stdout.write(String(data.session_id||""));\')"',
      'elif command -v jq >/dev/null 2>&1; then',
      '  SESSION_ID="$(echo "${INPUT}" | jq -r \'.session_id // empty\' 2>/dev/null)"',
      'elif command -v python3 >/dev/null 2>&1; then',
      '  SESSION_ID="$(echo "${INPUT}" | python3 -c \'import json,sys; d=json.load(sys.stdin); print(d.get("session_id",""))\' 2>/dev/null)"',
      'else',
      '  exit 0',
      'fi'
    ].join('\n'),
    'hooks/pre-tool-use/_emit.sh session parser'
  );

  next = replaceOrThrow(
    next,
    /if command -v jq >\/dev\/null 2>&1; then\s*\n\s*jq -n --arg ctx "\$\{REMINDER\}"/,
    [
      'if command -v node >/dev/null 2>&1; then',
      '  printf \'%s\' "${REMINDER}" | node -e \'const fs=require("fs");const ctx=fs.readFileSync(0,"utf8");process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:"PreToolUse",additionalContext:ctx}}));\'',
      '  exit 0',
      'fi',
      '',
      'if command -v jq >/dev/null 2>&1; then',
      '  jq -n --arg ctx "${REMINDER}"'
    ].join('\n'),
    'hooks/pre-tool-use/_emit.sh output emitter'
  );
  return next;
}

function patchGetNodeText(text) {
  if (text.includes(N8N_NODE_FALLBACK_MARKER)) return text;
  let next = replaceOrThrow(
    text,
    /if ! command -v jq >\/dev\/null 2>&1; then[\s\S]+?NODE_NAMES="\$\(echo "\$\{INPUT\}" \| jq -r '[\s\S]+?' 2>\/dev\/null\)"\s*\n\s*STATE_DIR=/,
    [
      `# ${N8N_NODE_FALLBACK_MARKER}`,
      'if command -v node >/dev/null 2>&1; then',
      '  SESSION_ID="$(printf \'%s\' "${INPUT}" | node -e \'const fs=require("fs");let raw=fs.readFileSync(0,"utf8");let data={};try{data=raw.trim()?JSON.parse(raw):{};}catch{}process.stdout.write(String(data.session_id||""));\')"',
      '  NODE_NAMES="$(printf \'%s\' "${INPUT}" | node -e \'const fs=require("fs");let raw=fs.readFileSync(0,"utf8");let data={};try{data=raw.trim()?JSON.parse(raw):{};}catch{}const ids=(data.tool_input&&data.tool_input.ids)||[];for(const item of ids){if(item&&typeof item==="object")console.log(item.name||"");else console.log(String(item||""));}\')"',
      'elif command -v jq >/dev/null 2>&1; then',
      '  SESSION_ID="$(echo "${INPUT}" | jq -r \'.session_id // empty\' 2>/dev/null)"',
      '  NODE_NAMES="$(echo "${INPUT}" | jq -r \'',
      '    (.tool_input.ids // []) |',
      '    map(if type == "object" then .name else . end) |',
      '    .[]',
      '  \' 2>/dev/null)"',
      'else',
      '  exit 0',
      'fi',
      '[ -z "${SESSION_ID}" ] && exit 0',
      '',
      'STATE_DIR='
    ].join('\n'),
    'hooks/pre-tool-use/get-node.sh JSON parser'
  );

  next = replaceOrThrow(
    next,
    /jq -n --arg ctx "\$\{WARNINGS\}" '\{\s*\n\s*hookSpecificOutput: \{\s*\n\s*hookEventName: "PreToolUse",\s*\n\s*additionalContext: \$ctx\s*\n\s*\}\s*\n\s*\}'/,
    [
      'if command -v node >/dev/null 2>&1; then',
      '  printf \'%s\' "${WARNINGS}" | node -e \'const fs=require("fs");const ctx=fs.readFileSync(0,"utf8");process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:"PreToolUse",additionalContext:ctx}}));\'',
      '  exit 0',
      'fi',
      '',
      'jq -n --arg ctx "${WARNINGS}" \'{',
      '  hookSpecificOutput: {',
      '    hookEventName: "PreToolUse",',
      '    additionalContext: $ctx',
      '  }',
      '}\''
    ].join('\n'),
    'hooks/pre-tool-use/get-node.sh output emitter'
  );
  return next;
}

function patchPostValidateText(text) {
  if (text.includes(N8N_NODE_FALLBACK_MARKER)) return text;
  let next = replaceOrThrow(
    text,
    /if ! command -v jq >\/dev\/null 2>&1; then\s*\n\s*exit 0\s*\nfi\s*\n\s*INPUT="\$\(cat\)"\s*\nCODE="\$\(echo "\$INPUT" \| jq -r '\.tool_input\.code \/\/ empty' 2>\/dev\/null\)"/,
    [
      `# ${N8N_NODE_FALLBACK_MARKER}`,
      'INPUT="$(cat)"',
      'if command -v node >/dev/null 2>&1; then',
      '  CODE="$(printf \'%s\' "$INPUT" | node -e \'const fs=require("fs");let raw=fs.readFileSync(0,"utf8");let data={};try{data=raw.trim()?JSON.parse(raw):{};}catch{}process.stdout.write(String((data.tool_input&&data.tool_input.code)||""));\')"',
      'elif command -v jq >/dev/null 2>&1; then',
      '  CODE="$(echo "$INPUT" | jq -r \'.tool_input.code // empty\' 2>/dev/null)"',
      'else',
      '  exit 0',
      'fi',
      '',
      'emit_post_tool_use() {',
      '  if command -v node >/dev/null 2>&1; then',
      '    printf \'%s\' "$1" | node -e \'const fs=require("fs");const ctx=fs.readFileSync(0,"utf8");process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:"PostToolUse",additionalContext:ctx}}));\'',
      '  elif command -v jq >/dev/null 2>&1; then',
      '    jq -n --arg ctx "$1" \'{ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: $ctx } }\'',
      '  elif command -v python3 >/dev/null 2>&1; then',
      '    python3 -c \'',
      'import json, sys',
      'ctx = sys.stdin.read()',
      'print(json.dumps({"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":ctx}}))',
      '\' <<< "$1"',
      '  fi',
      '}'
    ].join('\n'),
    'hooks/post-tool-use/validate-workflow.sh JSON parser'
  );

  next = replaceOrThrow(
    next,
    /if \[ -z "\$CODE" \]; then[\s\S]+?\n\s*exit 0\s*\nfi/,
    [
      'if [ -z "$CODE" ]; then',
      '  emit_post_tool_use "[validate_workflow returned. Validation is necessary, not sufficient.] If n8n-workflow-lifecycle is not already in your context, load it via the Skill tool and walk references/VALIDATION_CHECKLIST.md section 2 before publish."',
      '  exit 0',
      'fi'
    ].join('\n'),
    'hooks/post-tool-use/validate-workflow.sh empty-code emitter'
  );

  next = replaceOrThrow(
    next,
    /jq -n --arg ctx "\$WARNINGS" '\{\s*\n\s*hookSpecificOutput: \{\s*\n\s*hookEventName: "PostToolUse",\s*\n\s*additionalContext: \$ctx\s*\n\s*\}\s*\n\s*\}'/,
    'emit_post_tool_use "$WARNINGS"',
    'hooks/post-tool-use/validate-workflow.sh output emitter'
  );
  return next;
}

function patchFile(pluginRoot, relPath, transform, actions, options, required = true) {
  const filePath = path.join(pluginRoot, ...relPath.split('/'));
  if (!fs.existsSync(filePath)) {
    if (required) throw new Error(`Required n8n hook file is missing: ${relPath}`);
    return;
  }
  const before = fs.readFileSync(filePath, 'utf8');
  const after = transform(before);
  if (after === before) return;
  actions.push(`patch ${relPath}`);
  if (options.write) fs.writeFileSync(filePath, after, 'utf8');
}

function patchN8nHookInternals(pluginRoot, actions, options) {
  patchFile(pluginRoot, 'hooks/session-start.sh', patchSessionStartText, actions, options);
  patchFile(pluginRoot, 'hooks/pre-tool-use/_emit.sh', patchPreEmitText, actions, options);
  patchFile(pluginRoot, 'hooks/pre-tool-use/get-node.sh', patchGetNodeText, actions, options, false);
  patchFile(pluginRoot, 'hooks/post-tool-use/validate-workflow.sh', patchPostValidateText, actions, options);
}

function repairPluginRoot(pluginRoot, options = {}) {
  const effectiveOptions = {
    windows: options.windows ?? process.platform === 'win32',
    write: Boolean(options.write),
    n8n: Boolean(options.n8n)
  };
  const actions = [];
  const errors = [];
  const hooksJsonPath = path.join(pluginRoot, 'hooks', 'hooks.json');

  if (!fs.existsSync(pluginRoot)) throw new Error(`Plugin root does not exist: ${pluginRoot}`);
  if (!fs.existsSync(hooksJsonPath)) throw new Error(`hooks/hooks.json is missing under plugin root: ${pluginRoot}`);

  const hooksJson = readJsonFile(hooksJsonPath, 'hooks/hooks.json');
  const entries = collectHookCommandEntries(hooksJson);
  let needsWrapper = false;
  let changedHooksJson = false;

  if (effectiveOptions.windows) {
    for (const entry of entries) {
      const decision = classifyHookCommand(entry, pluginRoot);
      if (decision.error) {
        errors.push(decision.error);
        continue;
      }
      if (decision.usesWrapper) needsWrapper = true;
      if (decision.repairTo && decision.repairTo !== entry.command) {
        entry.node.command = decision.repairTo;
        changedHooksJson = true;
        needsWrapper = true;
        actions.push(`rewrite ${entry.path}`);
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join('\n'));
  }

  if (needsWrapper) ensureWrapper(pluginRoot, actions, effectiveOptions);
  if (isN8nSkillsPlugin(pluginRoot, effectiveOptions)) {
    patchN8nHookInternals(pluginRoot, actions, effectiveOptions);
  }

  if (changedHooksJson && effectiveOptions.write) writeJsonFile(hooksJsonPath, hooksJson);

  if (!effectiveOptions.write && actions.length > 0) {
    return {
      plugin_root: pluginRoot,
      windows: effectiveOptions.windows,
      write: effectiveOptions.write,
      repaired: true,
      actions
    };
  }

  const auditErrors = auditPluginRoot(pluginRoot, { windows: effectiveOptions.windows });
  if (auditErrors.length > 0) {
    throw new Error([
      'Plugin hook repair did not produce a Windows-safe install:',
      ...auditErrors.map((error) => `- ${error}`)
    ].join('\n'));
  }

  return {
    plugin_root: pluginRoot,
    windows: effectiveOptions.windows,
    write: effectiveOptions.write,
    repaired: actions.length > 0,
    actions
  };
}

function parseArgs(argv = process.argv.slice(2)) {
  const options = {
    pluginRoot: '',
    windows: process.platform === 'win32',
    write: false,
    n8n: false,
    help: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index] || '';
    if (arg === '--plugin-root') options.pluginRoot = next();
    else if (arg.startsWith('--plugin-root=')) options.pluginRoot = arg.slice('--plugin-root='.length);
    else if (arg === '--windows') options.windows = true;
    else if (arg === '--no-windows') options.windows = false;
    else if (arg === '--write') options.write = true;
    else if (arg === '--dry-run') options.write = false;
    else if (arg === '--n8n' || arg === '--n8n-skills') options.n8n = true;
    else if (arg === '--plugin-id') options.n8n = next() === 'n8n-skills@n8n-io';
    else if (arg.startsWith('--plugin-id=')) options.n8n = arg.slice('--plugin-id='.length) === 'n8n-skills@n8n-io';
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (!options.pluginRoot) options.pluginRoot = arg;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function usage() {
  return [
    'Usage: node repo/scripts/repair-codex-plugin-windows-hooks.cjs --plugin-root <path> [--windows] [--write]',
    '',
    'Audits and repairs an installed Codex plugin hook folder for Windows-safe shell hook execution.',
    'Dry-run is the default. Add --write after a plugin install or update to apply the repair.',
    '',
    'For n8n-skills@n8n-io, the repair also adds Node JSON parsing/emitting fallbacks to official hook internals.'
  ].join('\n');
}

function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(`FAIL: ${error.message}`);
    console.error(usage());
    return 2;
  }

  if (options.help) {
    console.log(usage());
    return 0;
  }
  if (!options.pluginRoot) {
    console.error('FAIL: --plugin-root <path> is required.');
    console.error(usage());
    return 2;
  }

  try {
    const result = repairPluginRoot(path.resolve(options.pluginRoot), options);
    const summary = result.actions.length > 0
      ? result.actions.join(', ')
      : 'no changes needed';
    console.log(`OK: Windows hook repair ${options.write ? 'applied' : 'checked'} for ${result.plugin_root}: ${summary}`);
    if (!options.write && result.actions.length > 0) {
      console.log(JSON.stringify(result, null, 2));
    }
    return 0;
  } catch (error) {
    console.error(`FAIL: ${error.message}`);
    return 1;
  }
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  N8N_NODE_FALLBACK_MARKER,
  WRAPPER_MARKER,
  classifyHookCommand,
  collectHookCommandEntries,
  repairPluginRoot,
  tokenizeCommand
};
