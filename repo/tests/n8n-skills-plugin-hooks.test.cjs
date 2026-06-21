'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const auditScript = path.join(repoRoot, 'repo', 'scripts', 'audit-n8n-skills-plugin-hooks.cjs');
const repairScript = path.join(repoRoot, 'repo', 'scripts', 'repair-codex-plugin-windows-hooks.cjs');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeShell(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${text.trim()}\n`, 'utf8');
  fs.chmodSync(filePath, 0o755);
}

function makePluginRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-skills-plugin-'));
  fs.mkdirSync(path.join(root, 'hooks', 'pre-tool-use'), { recursive: true });
  fs.mkdirSync(path.join(root, 'hooks', 'post-tool-use'), { recursive: true });
  fs.mkdirSync(path.join(root, '.codex-plugin'), { recursive: true });
  return root;
}

function runAudit(pluginRoot, ...extraArgs) {
  return spawnSync(process.execPath, [auditScript, '--plugin-root', pluginRoot, '--windows', ...extraArgs], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
}

function runRepair(pluginRoot, ...extraArgs) {
  return spawnSync(process.execPath, [repairScript, '--plugin-root', pluginRoot, '--windows', '--write', ...extraArgs], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
}

function findBashForTests() {
  const candidates = process.platform === 'win32'
    ? [
        'C:\\Program Files\\Git\\bin\\bash.exe',
        'C:\\Program Files\\Git\\usr\\bin\\bash.exe',
        'bash.exe'
      ]
    : ['bash'];

  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
    if (!result.error && result.status === 0) return candidate;
  }
  return null;
}

function runShellHook(pluginRoot, relPath, input) {
  const bash = findBashForTests();
  assert.ok(bash, 'bash is required for hook execution verification');
  return spawnSync(bash, [path.join(pluginRoot, 'hooks', ...relPath.split('/'))], {
    cwd: pluginRoot,
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: {
      ...process.env,
      CLAUDE_PLUGIN_ROOT: pluginRoot.replace(/\\/g, '/')
    }
  });
}

function runPowerShellWrapperHook(pluginRoot, relPath, input) {
  return spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      path.join(pluginRoot, 'hooks', 'run-hook.ps1'),
      relPath
    ],
    {
      cwd: pluginRoot,
      input: JSON.stringify(input),
      encoding: 'utf8',
      env: {
        ...process.env,
        CLAUDE_PLUGIN_ROOT: pluginRoot.replace(/\\/g, '/')
      }
    }
  );
}

function writeSessionStartShellHookWithNodeFallback(pluginRoot) {
  fs.writeFileSync(
    path.join(pluginRoot, 'hooks', 'session-start.sh'),
    [
      'if command -v node >/dev/null 2>&1; then',
      '  node -e "console.log(JSON.stringify({hookSpecificOutput:{hookEventName:\'SessionStart\',additionalContext:\'using-n8n-skills\'}}))"',
      'fi'
    ].join('\n'),
    'utf8'
  );
}

function writeN8nOfficialLikePlugin(pluginRoot) {
  writeJson(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), {
    name: 'n8n-skills',
    version: '0.3.1',
    homepage: 'https://github.com/n8n-io/skills',
    repository: 'https://github.com/n8n-io/skills',
    author: { name: 'n8n', url: 'https://n8n.io' },
    hooks: './hooks/hooks.json'
  });
  writeJson(path.join(pluginRoot, 'hooks', 'hooks.json'), {
    hooks: {
      SessionStart: [
        {
          matcher: 'startup|resume|clear|compact',
          hooks: [
            {
              type: 'command',
              command: '${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh'
            }
          ]
        }
      ],
      PreToolUse: [
        {
          matcher: '^mcp__.*__validate_workflow$',
          hooks: [
            {
              type: 'command',
              command: '${CLAUDE_PLUGIN_ROOT}/hooks/pre-tool-use/validate-workflow.sh'
            }
          ]
        }
      ],
      PostToolUse: [
        {
          matcher: '^mcp__.*__validate_workflow$',
          hooks: [
            {
              type: 'command',
              command: '${CLAUDE_PLUGIN_ROOT}/hooks/post-tool-use/validate-workflow.sh'
            }
          ]
        }
      ]
    }
  });
  fs.mkdirSync(path.join(pluginRoot, 'skills', 'using-n8n-skills'), { recursive: true });
  fs.writeFileSync(
    path.join(pluginRoot, 'skills', 'using-n8n-skills', 'SKILL.md'),
    '# Using n8n Skills\n\nLoad the n8n workflow guidance.\n',
    'utf8'
  );
  writeShell(
    path.join(pluginRoot, 'hooks', 'session-start.sh'),
    `
#!/usr/bin/env bash
set -uo pipefail
PLUGIN_ROOT="\${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
META_SKILL="\${PLUGIN_ROOT}/skills/using-n8n-skills/SKILL.md"
INPUT="$(cat)"

if command -v jq >/dev/null 2>&1; then
  SOURCE="$(echo "\${INPUT}" | jq -r '.source // empty' 2>/dev/null)"
  SESSION_ID="$(echo "\${INPUT}" | jq -r '.session_id // empty' 2>/dev/null)"
fi

if [[ ! -r "\${META_SKILL}" ]]; then
  exit 0
fi

SKILL_BODY="$(cat "\${META_SKILL}")"
ADDITIONAL_CONTEXT="\${SKILL_BODY}"

if command -v jq >/dev/null 2>&1; then
  jq -n --arg ctx "\${ADDITIONAL_CONTEXT}" '{
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: $ctx
    }
  }'
elif command -v python3 >/dev/null 2>&1; then
  python3 -c '
import json, sys
ctx = sys.stdin.read()
print(json.dumps({
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": ctx
  }
}))
' <<< "\${ADDITIONAL_CONTEXT}"
else
  exit 0
fi
`
  );
  writeShell(
    path.join(pluginRoot, 'hooks', 'pre-tool-use', '_emit.sh'),
    `
#!/usr/bin/env bash
set -uo pipefail
MARKER_NAME="\${1:-}"
REMINDER="\${2:-}"
INPUT="$(cat)"

if command -v jq >/dev/null 2>&1; then
  SESSION_ID="$(echo "\${INPUT}" | jq -r '.session_id // empty' 2>/dev/null)"
elif command -v python3 >/dev/null 2>&1; then
  SESSION_ID="$(echo "\${INPUT}" | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d.get("session_id",""))' 2>/dev/null)"
else
  exit 0
fi

if [[ -z "\${SESSION_ID}" ]]; then
  exit 0
fi

STATE_DIR="\${TMPDIR:-/tmp}/n8n-skills-state"
mkdir -p "\${STATE_DIR}" 2>/dev/null || exit 0
MARKER="\${STATE_DIR}/\${SESSION_ID}-\${MARKER_NAME}.loaded"
if [[ -f "\${MARKER}" ]]; then
  exit 0
fi
touch "\${MARKER}" 2>/dev/null || exit 0

if command -v jq >/dev/null 2>&1; then
  jq -n --arg ctx "\${REMINDER}" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      additionalContext: $ctx
    }
  }'
elif command -v python3 >/dev/null 2>&1; then
  python3 -c '
import json, sys
ctx = sys.stdin.read()
print(json.dumps({
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "additionalContext": ctx
  }
}))
' <<< "\${REMINDER}"
fi
`
  );
  writeShell(
    path.join(pluginRoot, 'hooks', 'pre-tool-use', 'validate-workflow.sh'),
    `
#!/usr/bin/env bash
exec "$(dirname "$0")/_emit.sh" "lifecycle-connections" "Before validating, load n8n-workflow-lifecycle."
`
  );
  writeShell(
    path.join(pluginRoot, 'hooks', 'post-tool-use', 'validate-workflow.sh'),
    `
#!/usr/bin/env bash
set -uo pipefail

if ! command -v jq >/dev/null 2>&1; then
  exit 0
fi

INPUT="$(cat)"
CODE="$(echo "$INPUT" | jq -r '.tool_input.code // empty' 2>/dev/null)"

if [ -z "$CODE" ]; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PostToolUse",
      additionalContext: "[validate_workflow returned. Validation is necessary, not sufficient.]"
    }
  }'
  exit 0
fi

WARNINGS="[validate_workflow returned. Validation is necessary, not sufficient.]"

jq -n --arg ctx "$WARNINGS" '{
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: $ctx
  }
}'
`
  );
}

test('n8n plugin hook audit rejects Windows direct shell hooks and missing Node JSON fallback', () => {
  const pluginRoot = makePluginRoot();
  writeJson(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), {
    name: 'n8n-skills',
    version: '0.3.1',
    hooks: './hooks/hooks.json'
  });
  writeJson(path.join(pluginRoot, 'hooks', 'hooks.json'), {
    hooks: {
      SessionStart: [
        {
          matcher: 'startup|resume|clear|compact',
          hooks: [
            {
              type: 'command',
              command: '${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh'
            }
          ]
        }
      ],
      PreToolUse: [
        {
          matcher: '^mcp__.*__validate_workflow$',
          hooks: [
            {
              type: 'command',
              command: '${CLAUDE_PLUGIN_ROOT}/hooks/pre-tool-use/validate-workflow.sh'
            }
          ]
        }
      ]
    }
  });
  fs.writeFileSync(
    path.join(pluginRoot, 'hooks', 'session-start.sh'),
    'if command -v jq >/dev/null 2>&1; then jq -n "{}"; elif command -v python3 >/dev/null 2>&1; then python3 -c "print({})"; fi\n',
    'utf8'
  );
  fs.writeFileSync(
    path.join(pluginRoot, 'hooks', 'pre-tool-use', '_emit.sh'),
    'if command -v jq >/dev/null 2>&1; then jq -n "{}"; elif command -v python3 >/dev/null 2>&1; then python3 -c "print({})"; fi\n',
    'utf8'
  );

  const result = runAudit(pluginRoot);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /directly invokes a \.sh file without an interpreter/);
  assert.match(result.stderr, /hooks\/session-start\.sh must include a Node JSON fallback/);
  assert.match(result.stderr, /hooks\/pre-tool-use\/_emit\.sh must include a Node JSON fallback/);
});

test('n8n plugin hook audit accepts Windows-safe Node hook commands and parseable JSON output', () => {
  const pluginRoot = makePluginRoot();
  writeJson(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), {
    name: 'n8n-skills',
    version: '0.3.1',
    hooks: './hooks/hooks.json'
  });
  writeJson(path.join(pluginRoot, 'hooks', 'hooks.json'), {
    hooks: {
      SessionStart: [
        {
          matcher: 'startup|resume|clear|compact',
          hooks: [
            {
              type: 'command',
              command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/session-start.cjs"'
            }
          ]
        }
      ]
    }
  });
  const nodeHook = [
    "'use strict';",
    "const fs = require('node:fs');",
    'const input = fs.readFileSync(0, "utf8");',
    'const parsed = input.trim() ? JSON.parse(input) : {};',
    'process.stdout.write(JSON.stringify({',
    '  hookSpecificOutput: {',
    '    hookEventName: "SessionStart",',
    '    additionalContext: parsed.additionalContext || "using-n8n-skills"',
    '  }',
    '}));'
  ].join('\n');
  fs.writeFileSync(path.join(pluginRoot, 'hooks', 'session-start.cjs'), `${nodeHook}\n`, 'utf8');

  const audit = runAudit(pluginRoot);
  assert.equal(audit.status, 0, audit.stderr);

  const hook = spawnSync(process.execPath, [path.join(pluginRoot, 'hooks', 'session-start.cjs')], {
    input: JSON.stringify({ additionalContext: 'line1\n"quoted"' }),
    encoding: 'utf8'
  });
  assert.equal(hook.status, 0, hook.stderr);
  assert.deepEqual(JSON.parse(hook.stdout), {
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: 'line1\n"quoted"'
    }
  });
});

test('n8n plugin hook audit follows wrapper command shell-script arguments', () => {
  const pluginRoot = makePluginRoot();
  writeJson(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), {
    name: 'n8n-skills',
    version: '0.3.1',
    hooks: './hooks/hooks.json'
  });
  writeJson(path.join(pluginRoot, 'hooks', 'hooks.json'), {
    hooks: {
      PostToolUse: [
        {
          matcher: '^mcp__.*__validate_workflow$',
          hooks: [
            {
              type: 'command',
              command: 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.ps1" "post-tool-use/validate-workflow.sh"'
            }
          ]
        }
      ]
    }
  });
  fs.writeFileSync(
    path.join(pluginRoot, 'hooks', 'post-tool-use', 'validate-workflow.sh'),
    'if command -v jq >/dev/null 2>&1; then jq -n "{}"; elif command -v python3 >/dev/null 2>&1; then python3 -c "print({})"; fi\n',
    'utf8'
  );

  const result = runAudit(pluginRoot);

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    /hooks\/post-tool-use\/validate-workflow\.sh must include a Node JSON fallback/
  );
});

test('n8n plugin hook audit accepts wrapper command shell-script arguments with Node fallback', () => {
  const pluginRoot = makePluginRoot();
  writeJson(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), {
    name: 'n8n-skills',
    version: '0.3.1',
    hooks: './hooks/hooks.json'
  });
  writeJson(path.join(pluginRoot, 'hooks', 'hooks.json'), {
    hooks: {
      PostToolUse: [
        {
          matcher: '^mcp__.*__validate_workflow$',
          hooks: [
            {
              type: 'command',
              command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.cjs" "post-tool-use/validate-workflow.sh"'
            }
          ]
        }
      ]
    }
  });
  fs.writeFileSync(
    path.join(pluginRoot, 'hooks', 'post-tool-use', 'validate-workflow.sh'),
    [
      'if command -v jq >/dev/null 2>&1; then jq -n "{}";',
      'elif command -v python3 >/dev/null 2>&1; then python3 -c "print({})";',
      'elif command -v node >/dev/null 2>&1; then node -e "console.log(JSON.stringify({hookSpecificOutput:{hookEventName:\'PostToolUse\'}}))";',
      'fi'
    ].join(' '),
    'utf8'
  );

  const result = runAudit(pluginRoot);

  assert.equal(result.status, 0, result.stderr);
});

test('n8n plugin hook audit rejects WSL bash launcher commands on Windows', () => {
  const pluginRoot = makePluginRoot();
  writeJson(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), {
    name: 'n8n-skills',
    version: '0.3.1',
    hooks: './hooks/hooks.json'
  });
  writeJson(path.join(pluginRoot, 'hooks', 'hooks.json'), {
    hooks: {
      SessionStart: [
        {
          matcher: 'startup|resume|clear|compact',
          hooks: [
            {
              type: 'command',
              command: 'C:\\WINDOWS\\system32\\bash.exe "${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh"'
            }
          ]
        }
      ]
    }
  });
  writeSessionStartShellHookWithNodeFallback(pluginRoot);

  const result = runAudit(pluginRoot);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unsafe WSL bash launcher/i);
  assert.match(result.stderr, /C:\\WINDOWS\\system32\\bash\.exe/i);
  assert.doesNotMatch(result.stderr, /must include a Node JSON fallback/);
});

test('n8n plugin hook audit accepts explicit Git Bash launcher commands with Node fallback', () => {
  const pluginRoot = makePluginRoot();
  writeJson(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), {
    name: 'n8n-skills',
    version: '0.3.1',
    hooks: './hooks/hooks.json'
  });
  writeJson(path.join(pluginRoot, 'hooks', 'hooks.json'), {
    hooks: {
      SessionStart: [
        {
          matcher: 'startup|resume|clear|compact',
          hooks: [
            {
              type: 'command',
              command: '"C:\\Program Files\\Git\\bin\\bash.exe" "${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh"'
            }
          ]
        }
      ]
    }
  });
  writeSessionStartShellHookWithNodeFallback(pluginRoot);

  const result = runAudit(pluginRoot);

  assert.equal(result.status, 0, result.stderr);
});

test('n8n plugin hook audit rejects malformed plugin metadata JSON', () => {
  const pluginRoot = makePluginRoot();
  fs.writeFileSync(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), '{ invalid json\n', 'utf8');
  writeJson(path.join(pluginRoot, 'hooks', 'hooks.json'), { hooks: {} });

  const result = runAudit(pluginRoot);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\.codex-plugin\/plugin\.json is not valid JSON/);
});

test('Windows hook repair wraps direct shell hook commands and is idempotent', () => {
  const pluginRoot = makePluginRoot();
  writeJson(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), {
    name: 'generic-plugin',
    version: '1.0.0',
    hooks: './hooks/hooks.json'
  });
  writeJson(path.join(pluginRoot, 'hooks', 'hooks.json'), {
    hooks: {
      SessionStart: [
        {
          matcher: 'startup',
          hooks: [
            {
              type: 'command',
              command: '${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh'
            }
          ]
        }
      ]
    }
  });
  writeSessionStartShellHookWithNodeFallback(pluginRoot);

  const first = runRepair(pluginRoot);
  assert.equal(first.status, 0, first.stderr);

  const hooksPath = path.join(pluginRoot, 'hooks', 'hooks.json');
  const wrapperPath = path.join(pluginRoot, 'hooks', 'run-hook.ps1');
  const repairedHooks = readJson(hooksPath);
  const command = repairedHooks.hooks.SessionStart[0].hooks[0].command;
  assert.equal(
    command,
    'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PLUGIN_ROOT}/hooks/run-hook.ps1" "session-start.sh"'
  );
  assert.equal(fs.existsSync(wrapperPath), true);
  assert.match(fs.readFileSync(wrapperPath, 'utf8'), /Program Files\\Git\\bin\\bash\.exe/);
  assert.doesNotMatch(JSON.stringify(repairedHooks), /\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/session-start\.sh/);

  const hooksAfterFirstRepair = fs.readFileSync(hooksPath, 'utf8');
  const wrapperAfterFirstRepair = fs.readFileSync(wrapperPath, 'utf8');
  const second = runRepair(pluginRoot);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(fs.readFileSync(hooksPath, 'utf8'), hooksAfterFirstRepair);
  assert.equal(fs.readFileSync(wrapperPath, 'utf8'), wrapperAfterFirstRepair);

  const audit = runAudit(pluginRoot);
  assert.equal(audit.status, 0, audit.stderr);
});

test('Windows hook repair wrapper executes repaired hook through powershell.exe', () => {
  const pluginRoot = makePluginRoot();
  writeJson(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), {
    name: 'generic-plugin',
    version: '1.0.0',
    hooks: './hooks/hooks.json'
  });
  writeJson(path.join(pluginRoot, 'hooks', 'hooks.json'), {
    hooks: {
      SessionStart: [
        {
          matcher: 'startup',
          hooks: [
            {
              type: 'command',
              command: '${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh'
            }
          ]
        }
      ]
    }
  });
  writeSessionStartShellHookWithNodeFallback(pluginRoot);

  const repair = runRepair(pluginRoot);
  assert.equal(repair.status, 0, repair.stderr);

  const wrapper = runPowerShellWrapperHook(pluginRoot, 'session-start.sh', {
    session_id: `wrapper-${process.pid}-${Date.now()}`,
    source: 'startup'
  });
  assert.equal(wrapper.status, 0, wrapper.stderr);
  assert.equal(JSON.parse(wrapper.stdout).hookSpecificOutput.hookEventName, 'SessionStart');
});

test('Windows hook repair rejects WSL bash launcher commands', () => {
  const pluginRoot = makePluginRoot();
  writeJson(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), {
    name: 'generic-plugin',
    version: '1.0.0',
    hooks: './hooks/hooks.json'
  });
  writeJson(path.join(pluginRoot, 'hooks', 'hooks.json'), {
    hooks: {
      SessionStart: [
        {
          matcher: 'startup',
          hooks: [
            {
              type: 'command',
              command: 'C:\\WINDOWS\\system32\\bash.exe "${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh"'
            }
          ]
        }
      ]
    }
  });
  writeSessionStartShellHookWithNodeFallback(pluginRoot);

  const result = runRepair(pluginRoot);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /WSL bash launcher/i);
  assert.match(result.stderr, /C:\\WINDOWS\\system32\\bash\.exe/i);
  assert.equal(
    readJson(path.join(pluginRoot, 'hooks', 'hooks.json')).hooks.SessionStart[0].hooks[0].command,
    'C:\\WINDOWS\\system32\\bash.exe "${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh"'
  );
});

test('Windows hook repair accepts explicit Git Bash launcher commands', () => {
  const pluginRoot = makePluginRoot();
  writeJson(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), {
    name: 'generic-plugin',
    version: '1.0.0',
    hooks: './hooks/hooks.json'
  });
  const gitBashCommand = '"C:\\Program Files\\Git\\usr\\bin\\bash.exe" "${CLAUDE_PLUGIN_ROOT}/hooks/session-start.sh"';
  writeJson(path.join(pluginRoot, 'hooks', 'hooks.json'), {
    hooks: {
      SessionStart: [
        {
          matcher: 'startup',
          hooks: [
            {
              type: 'command',
              command: gitBashCommand
            }
          ]
        }
      ]
    }
  });
  writeSessionStartShellHookWithNodeFallback(pluginRoot);

  const result = runRepair(pluginRoot);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(readJson(path.join(pluginRoot, 'hooks', 'hooks.json')).hooks.SessionStart[0].hooks[0].command, gitBashCommand);
  assert.equal(runAudit(pluginRoot).status, 0);
});

test('n8n-skills Windows hook repair wraps hooks, adds Node fallbacks, and verifies unique sessions', () => {
  const bash = findBashForTests();
  if (!bash) {
    assert.fail('bash is required for n8n hook execution verification');
  }

  const pluginRoot = makePluginRoot();
  writeN8nOfficialLikePlugin(pluginRoot);

  const result = runRepair(pluginRoot);
  assert.equal(result.status, 0, result.stderr);

  const hooksText = fs.readFileSync(path.join(pluginRoot, 'hooks', 'hooks.json'), 'utf8');
  assert.doesNotMatch(hooksText, /\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/[^"]+\.sh/);
  assert.match(hooksText, /run-hook\.ps1/);

  for (const relPath of [
    'hooks/session-start.sh',
    'hooks/pre-tool-use/_emit.sh',
    'hooks/post-tool-use/validate-workflow.sh'
  ]) {
    const text = fs.readFileSync(path.join(pluginRoot, ...relPath.split('/')), 'utf8');
    assert.match(text, /AI-AGENT-TOOLKIT:N8N-NODE-FALLBACK/);
    assert.match(text, /JSON\.stringify/);
  }

  const unique = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const sessionStart = runShellHook(pluginRoot, 'session-start.sh', {
    session_id: `session-start-${unique}`,
    source: 'startup'
  });
  assert.equal(sessionStart.status, 0, sessionStart.stderr);
  assert.equal(JSON.parse(sessionStart.stdout).hookSpecificOutput.hookEventName, 'SessionStart');

  const preToolUse = runShellHook(pluginRoot, 'pre-tool-use/validate-workflow.sh', {
    session_id: `pre-tool-use-${unique}`,
    tool_input: {}
  });
  assert.equal(preToolUse.status, 0, preToolUse.stderr);
  assert.equal(JSON.parse(preToolUse.stdout).hookSpecificOutput.hookEventName, 'PreToolUse');

  const postToolUse = runShellHook(pluginRoot, 'post-tool-use/validate-workflow.sh', {
    session_id: `post-tool-use-${unique}`,
    tool_input: {
      code: ''
    }
  });
  assert.equal(postToolUse.status, 0, postToolUse.stderr);
  assert.equal(JSON.parse(postToolUse.stdout).hookSpecificOutput.hookEventName, 'PostToolUse');

  const secondUnique = `${unique}-second`;
  const secondPreToolUse = runShellHook(pluginRoot, 'pre-tool-use/validate-workflow.sh', {
    session_id: `pre-tool-use-${secondUnique}`,
    tool_input: {}
  });
  assert.equal(secondPreToolUse.status, 0, secondPreToolUse.stderr);
  assert.equal(JSON.parse(secondPreToolUse.stdout).hookSpecificOutput.hookEventName, 'PreToolUse');

  assert.equal(runAudit(pluginRoot).status, 0);
});
