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
const supportedFixtureRoot = path.join(repoRoot, 'repo', 'tests', 'fixtures', 'n8n-skills-1.0.1');
const currentManifestPath = path.join(
  repoRoot,
  '_projects',
  'n8n',
  'skills-plugin-compatibility',
  '_main',
  'plugins',
  'n8n-skills',
  '.codex-plugin',
  'plugin.json'
);
const {
  N8N_SKILLS_COMPATIBILITY,
  N8N_SKILLS_COMPATIBILITY_ADAPTERS,
  classifyN8nSkillsCompatibility,
  n8nSkillsCompatibilityFingerprints,
  reconcileN8nSkillsPlugin
} = require('../scripts/repair-codex-plugin-windows-hooks.cjs');

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

function copySupportedFixture(pluginRoot = makePluginRoot()) {
  fs.cpSync(supportedFixtureRoot, pluginRoot, { recursive: true, force: true });
  return pluginRoot;
}

function copyCurrentSupportedFixture(pluginRoot = makePluginRoot()) {
  copySupportedFixture(pluginRoot);
  fs.copyFileSync(currentManifestPath, path.join(pluginRoot, '.codex-plugin', 'plugin.json'));
  return pluginRoot;
}

function toCrlfBytes(bytes) {
  const output = [];
  for (let index = 0; index < bytes.length; index += 1) {
    if (bytes[index] === 0x0a && (index === 0 || bytes[index - 1] !== 0x0d)) output.push(0x0d);
    output.push(bytes[index]);
  }
  return Buffer.from(output);
}

function convertExistingContractTextFilesToCrlf(pluginRoot) {
  let converted = 0;
  for (const relPath of N8N_SKILLS_COMPATIBILITY.text_eol_paths) {
    const filePath = path.join(pluginRoot, ...relPath.split('/'));
    if (!fs.existsSync(filePath)) continue;
    fs.writeFileSync(filePath, toCrlfBytes(fs.readFileSync(filePath)));
    converted += 1;
  }
  return converted;
}

function copySupportedCrlfFixture(pluginRoot = makePluginRoot()) {
  copySupportedFixture(pluginRoot);
  assert.equal(convertExistingContractTextFilesToCrlf(pluginRoot), 12);
  return pluginRoot;
}

function assertAllExistingContractTextFilesUseCrlf(pluginRoot) {
  for (const relPath of N8N_SKILLS_COMPATIBILITY.text_eol_paths) {
    const filePath = path.join(pluginRoot, ...relPath.split('/'));
    if (!fs.existsSync(filePath)) continue;
    const bytes = fs.readFileSync(filePath);
    assert.equal(bytes.includes(Buffer.from('\r\n')), true, relPath);
    assert.equal(/(^|[^\r])\n/.test(bytes.toString('latin1')), false, relPath);
  }
}

function snapshotFiles(root) {
  const result = new Map();
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) walk(fullPath);
      else if (entry.isFile()) result.set(path.relative(root, fullPath), fs.readFileSync(fullPath));
    }
  }
  walk(root);
  return result;
}

function assertSnapshotEqual(actualRoot, expected, message) {
  const actual = snapshotFiles(actualRoot);
  assert.deepEqual([...actual.keys()].sort(), [...expected.keys()].sort(), message);
  for (const [relPath, bytes] of expected) {
    assert.deepEqual(actual.get(relPath), bytes, `${message}: ${relPath}`);
  }
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

function runRepairedAudit(pluginRoot) {
  return process.platform === 'win32'
    ? runAudit(pluginRoot, '--verify-output')
    : runAudit(pluginRoot);
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

function powershellForTests() {
  if (process.platform === 'win32') {
    return 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
  }
  return 'powershell.exe';
}

function runPowerShellWrapperHook(pluginRoot, relPath, input, envOverrides = {}) {
  return spawnSync(
    powershellForTests(),
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
        CLAUDE_PLUGIN_ROOT: pluginRoot.replace(/\\/g, '/'),
        ...envOverrides
      }
    }
  );
}

function hasWindowsPowerShellForTests() {
  if (process.platform !== 'win32') return false;
  const result = spawnSync(
    powershellForTests(),
    ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major'],
    { encoding: 'utf8' }
  );
  return !result.error && result.status === 0;
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

test('n8n plugin hook audit verifies runtime hook JSON output when requested', () => {
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
  fs.writeFileSync(
    path.join(pluginRoot, 'hooks', 'session-start.cjs'),
    [
      "'use strict';",
      'process.stdout.write(JSON.stringify({',
      '  hookSpecificOutput: {',
      '    hookEventName: "SessionStart",',
      '    additionalContext: "using-n8n-skills"',
      '  }',
      '}));'
    ].join('\n'),
    'utf8'
  );

  const audit = runAudit(pluginRoot, '--verify-output');

  assert.equal(audit.status, 0, audit.stderr);
  assert.match(audit.stdout, /verified hook JSON output/i);
});

test('n8n plugin hook audit rejects invalid runtime hook JSON output when verification is requested', () => {
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
  fs.writeFileSync(path.join(pluginRoot, 'hooks', 'session-start.cjs'), 'process.stdout.write("not json");\n', 'utf8');

  const audit = runAudit(pluginRoot, '--verify-output');

  assert.notEqual(audit.status, 0);
  assert.match(audit.stderr, /did not emit valid hook JSON/i);
});

test('n8n plugin hook audit rejects empty SessionStart context during output verification', () => {
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
  fs.writeFileSync(
    path.join(pluginRoot, 'hooks', 'session-start.cjs'),
    [
      "'use strict';",
      'process.stdout.write(JSON.stringify({',
      '  hookSpecificOutput: {',
      '    hookEventName: "SessionStart",',
      '    additionalContext: ""',
      '  }',
      '}));'
    ].join('\n'),
    'utf8'
  );

  const audit = runAudit(pluginRoot, '--verify-output');

  assert.notEqual(audit.status, 0);
  assert.match(audit.stderr, /SessionStart.*additionalContext.*using-n8n-skills/i);
});

test('n8n plugin hook audit rejects command-not-found stderr during output verification', () => {
  const pluginRoot = makePluginRoot();
  writeJson(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), {
    name: 'n8n-skills',
    version: '0.3.1',
    hooks: './hooks/hooks.json'
  });
  writeJson(path.join(pluginRoot, 'hooks', 'hooks.json'), {
    hooks: {
      PreToolUse: [
        {
          matcher: '^mcp__.*__validate_workflow$',
          hooks: [
            {
              type: 'command',
              command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/pre-tool-use.cjs"'
            }
          ]
        }
      ]
    }
  });
  fs.writeFileSync(
    path.join(pluginRoot, 'hooks', 'pre-tool-use.cjs'),
    [
      "'use strict';",
      'console.error("dirname: command not found");',
      'process.stdout.write(JSON.stringify({',
      '  hookSpecificOutput: {',
      '    hookEventName: "PreToolUse",',
      '    additionalContext: "Before validating, load n8n-workflow-lifecycle."',
      '  }',
      '}));'
    ].join('\n'),
    'utf8'
  );

  const audit = runAudit(pluginRoot, '--verify-output');

  assert.notEqual(audit.status, 0);
  assert.match(audit.stderr, /command-not-found stderr/i);
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

test('n8n plugin hook audit rejects temporary Codex marketplace checkout paths', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-marketplace-temp-'));
  const pluginRoot = path.join(root, '.codex', '.tmp', 'marketplaces', 'n8n-io', 'plugins', 'n8n-skills');
  fs.mkdirSync(path.join(pluginRoot, 'hooks'), { recursive: true });
  writeJson(path.join(pluginRoot, 'hooks', 'hooks.json'), { hooks: {} });

  const result = runAudit(pluginRoot);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /temporary marketplace checkout/i);
  assert.match(result.stderr, /installed n8n-skills cache/i);
});

test('n8n-skills Windows hook repair rejects temporary Codex marketplace checkout paths', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-marketplace-temp-'));
  const pluginRoot = path.join(root, '.codex', '.tmp', 'marketplaces', 'n8n-io', 'plugins', 'n8n-skills');
  fs.mkdirSync(path.join(pluginRoot, 'hooks'), { recursive: true });
  writeJson(path.join(pluginRoot, 'hooks', 'hooks.json'), { hooks: {} });

  const result = runRepair(pluginRoot, '--plugin-id', 'n8n-skills@n8n-io');

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Refusing to repair temporary marketplace checkout/i);
  assert.match(result.stderr, /plugins\/cache\/n8n-io\/n8n-skills\/<version>/i);
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
    'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${PLUGIN_ROOT}/hooks/run-hook.ps1" "session-start.sh"'
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

test('Windows hook repair uses Codex PLUGIN_ROOT for Codex cache paths', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'generic-plugin-codex-cache-'));
  const pluginRoot = path.join(root, '.codex', 'plugins', 'cache', 'example-org', 'generic-hooks', '1.0.0');
  writeJson(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), {
    name: 'generic-hooks',
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

  const result = runRepair(pluginRoot);
  assert.equal(result.status, 0, result.stderr);

  const repairedCommand = readJson(path.join(pluginRoot, 'hooks', 'hooks.json')).hooks.SessionStart[0].hooks[0].command;
  assert.equal(
    repairedCommand,
    'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${PLUGIN_ROOT}/hooks/run-hook.ps1" "session-start.sh"'
  );
  assert.doesNotMatch(repairedCommand, /CLAUDE_PLUGIN_ROOT/);
  assert.equal(runAudit(pluginRoot).status, 0);
});

test('Windows hook repair wrapper executes repaired hook through powershell.exe', (t) => {
  if (!hasWindowsPowerShellForTests()) {
    t.skip('powershell.exe wrapper execution verification requires Windows PowerShell');
    return;
  }

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

  const pluginRoot = copySupportedFixture();

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

  if (hasWindowsPowerShellForTests()) {
    const wrapperSessionStart = runPowerShellWrapperHook(pluginRoot, 'session-start.sh', {
      session_id: `wrapper-session-start-${unique}`,
      source: 'startup'
    });
    assert.equal(wrapperSessionStart.status, 0, wrapperSessionStart.stderr);
    assert.equal(JSON.parse(wrapperSessionStart.stdout).hookSpecificOutput.hookEventName, 'SessionStart');

    const nodeOnlyPath = [path.dirname(process.execPath), os.tmpdir()].join(path.delimiter);
    const wrapperWithHostilePath = runPowerShellWrapperHook(
      pluginRoot,
      'pre-tool-use/validate-workflow.sh',
      {
        session_id: `wrapper-path-${unique}`,
        tool_input: {}
      },
      {
        PATH: nodeOnlyPath,
        Path: nodeOnlyPath
      }
    );
    assert.equal(wrapperWithHostilePath.status, 0, wrapperWithHostilePath.stderr);
    assert.doesNotMatch(wrapperWithHostilePath.stderr, /command not found/i);
    assert.equal(JSON.parse(wrapperWithHostilePath.stdout).hookSpecificOutput.hookEventName, 'PreToolUse');
  }

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

test('supported LF and native CRLF fixtures share exact canonical compatibility fingerprints', () => {
  const lfRoot = copySupportedFixture();
  const crlfRoot = copySupportedCrlfFixture();
  assertAllExistingContractTextFilesUseCrlf(crlfRoot);

  assert.equal(classifyN8nSkillsCompatibility(lfRoot).status, 'repair-required');
  assert.equal(classifyN8nSkillsCompatibility(crlfRoot).status, 'repair-required');
  assert.deepEqual(
    n8nSkillsCompatibilityFingerprints(crlfRoot, N8N_SKILLS_COMPATIBILITY.pristine_sha256),
    n8nSkillsCompatibilityFingerprints(lfRoot, N8N_SKILLS_COMPATIBILITY.pristine_sha256)
  );
});

test('supported native CRLF refresh repairs to healthy and remains byte-idempotent', () => {
  const pluginRoot = copySupportedCrlfFixture();
  const first = reconcileN8nSkillsPlugin(pluginRoot, { windows: true, write: true });
  assert.equal(first.status, 'repaired');
  assert.equal(classifyN8nSkillsCompatibility(pluginRoot).status, 'healthy');
  assert.equal(runRepairedAudit(pluginRoot).status, 0);

  const mixedRepaired = snapshotFiles(pluginRoot);
  const second = reconcileN8nSkillsPlugin(pluginRoot, { windows: true, write: true });
  assert.equal(second.status, 'healthy');
  assert.equal(second.repaired, false);
  assertSnapshotEqual(pluginRoot, mixedRepaired, 'mixed-EOL repaired state must be a byte-idempotent no-op');

  assert.equal(convertExistingContractTextFilesToCrlf(pluginRoot), 13);
  assertAllExistingContractTextFilesUseCrlf(pluginRoot);
  assert.equal(classifyN8nSkillsCompatibility(pluginRoot).status, 'healthy');
  const crlfRepaired = snapshotFiles(pluginRoot);
  const third = reconcileN8nSkillsPlugin(pluginRoot, { windows: true, write: true });
  assert.equal(third.status, 'healthy');
  assert.equal(third.repaired, false);
  assertSnapshotEqual(pluginRoot, crlfRepaired, 'all-CRLF repaired state must be a byte-idempotent no-op');
});

test('canonical compatibility accepts only CRLF-to-LF equivalence', () => {
  const cases = [
    {
      name: 'non-EOL content drift',
      mutate(pluginRoot) {
        const filePath = path.join(pluginRoot, 'hooks', 'session-start.sh');
        const bytes = fs.readFileSync(filePath);
        const marker = Buffer.from('#!/usr/bin/env bash');
        const index = bytes.indexOf(marker);
        assert.notEqual(index, -1);
        bytes[index + marker.length - 1] = 0x78;
        fs.writeFileSync(filePath, bytes);
      }
    },
    {
      name: 'non-EOL whitespace drift',
      mutate(pluginRoot) {
        const filePath = path.join(pluginRoot, 'hooks', 'pre-tool-use', 'create-workflow.sh');
        const bytes = fs.readFileSync(filePath);
        fs.writeFileSync(filePath, Buffer.concat([bytes.subarray(0, bytes.length - 1), Buffer.from(' \n')]));
      }
    },
    {
      name: 'lone CR drift',
      mutate(pluginRoot) {
        const filePath = path.join(pluginRoot, 'hooks', 'pre-tool-use', 'execute-workflow.sh');
        fs.appendFileSync(filePath, Buffer.from('\r'));
      }
    },
    {
      name: 'BOM drift',
      mutate(pluginRoot) {
        const filePath = path.join(pluginRoot, 'hooks', 'session-start.sh');
        fs.writeFileSync(filePath, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), fs.readFileSync(filePath)]));
      }
    }
  ];

  for (const entry of cases) {
    const pluginRoot = copySupportedCrlfFixture();
    entry.mutate(pluginRoot);
    const before = snapshotFiles(pluginRoot);
    assert.equal(classifyN8nSkillsCompatibility(pluginRoot).status, 'identity-unverified', entry.name);
    assert.throws(
      () => reconcileN8nSkillsPlugin(pluginRoot, { windows: true, write: true }),
      /source identity|partially repaired|fingerprint/i,
      entry.name
    );
    assertSnapshotEqual(pluginRoot, before, entry.name + ' must fail closed without writes');
  }
});

test('supported n8n Skills 1.0.1 compatibility inspection is exact and write-free', () => {
  const pluginRoot = copySupportedFixture();
  const before = snapshotFiles(pluginRoot);

  const classification = classifyN8nSkillsCompatibility(pluginRoot);
  assert.equal(classification.status, 'repair-required');
  assert.equal(classification.plugin_id, 'n8n-skills@n8n-io');
  assert.equal(classification.version, '1.0.1');
  assert.equal(classification.upstream_commit, 'c350f8b4bd8417108bce266d88e21b8a1bb966db');

  const inspection = reconcileN8nSkillsPlugin(pluginRoot, { windows: true, write: false });
  assert.equal(inspection.status, 'repair-required');
  assert.ok(inspection.actions.length > 0);
  assertSnapshotEqual(pluginRoot, before, 'inspection-only reconciliation must not write');
});

test('current n8n Skills 1.0.2 adapter is exact, repairable, verified, and idempotent', () => {
  const pluginRoot = copyCurrentSupportedFixture();
  const pristine = snapshotFiles(pluginRoot);
  const classification = classifyN8nSkillsCompatibility(pluginRoot);
  assert.equal(classification.status, 'repair-required');
  assert.equal(classification.version, '1.0.2');
  assert.equal(classification.adapter_id, 'n8n-skills-1.0.2-windows-hooks-v1');
  assert.equal(classification.upstream_commit, 'eb18fc3ab3e2820c748c2d84386fb5496efc1516');

  const inspection = reconcileN8nSkillsPlugin(pluginRoot, { windows: true, write: false });
  assert.ok(inspection.actions.length > 0);
  assertSnapshotEqual(pluginRoot, pristine, 'current-version inspection must not write');

  const repaired = reconcileN8nSkillsPlugin(pluginRoot, { windows: true, write: true });
  assert.equal(repaired.status, 'repaired');
  const healthy = classifyN8nSkillsCompatibility(pluginRoot);
  assert.equal(healthy.status, 'healthy');
  assert.equal(healthy.compatibility_scope, 'declared-windows-hook-contract');
  assert.match(healthy.reason, /unrelated plugin content.*not attested/i);
  assert.equal(healthy.version, '1.0.2');
  assert.equal(readJson(path.join(pluginRoot, '.codex-plugin', 'plugin.json')).version, '1.0.2');
  const repairedSnapshot = snapshotFiles(pluginRoot);
  const second = reconcileN8nSkillsPlugin(pluginRoot, { windows: true, write: true });
  assert.equal(second.status, 'healthy');
  assert.equal(second.repaired, false);
  assertSnapshotEqual(pluginRoot, repairedSnapshot, 'current-version healthy rerun must be byte-identical');
});

test('supported refresh is repaired, verified, and byte-idempotent', () => {
  const pluginRoot = copySupportedFixture();
  const envPath = path.join(pluginRoot, '.env');
  fs.writeFileSync(envPath, 'fixture sentinel must never be inspected or changed\n', 'utf8');
  const envBefore = fs.readFileSync(envPath);
  assert.notEqual(runAudit(pluginRoot).status, 0, 'pristine upstream fixture must reproduce the Windows failure');

  const first = reconcileN8nSkillsPlugin(pluginRoot, { windows: true, write: true });
  assert.equal(first.status, 'repaired');
  assert.equal(classifyN8nSkillsCompatibility(pluginRoot).status, 'healthy');
  assert.equal(runRepairedAudit(pluginRoot).status, 0);
  assert.deepEqual(fs.readFileSync(envPath), envBefore);
  const hooksText = fs.readFileSync(path.join(pluginRoot, 'hooks', 'hooks.json'), 'utf8');
  assert.match(hooksText, /run-hook\.ps1/);
  assert.doesNotMatch(hooksText, /"command":\s*"\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/[^\"]+\.sh"/);

  const repaired = snapshotFiles(pluginRoot);
  const second = reconcileN8nSkillsPlugin(pluginRoot, { windows: true, write: true });
  assert.equal(second.status, 'healthy');
  assert.equal(second.repaired, false);
  assertSnapshotEqual(pluginRoot, repaired, 'healthy reconciliation must be byte-idempotent');

  fs.cpSync(supportedFixtureRoot, pluginRoot, { recursive: true, force: true });
  assert.equal(classifyN8nSkillsCompatibility(pluginRoot).status, 'repair-required');
  const refreshed = reconcileN8nSkillsPlugin(pluginRoot, { windows: true, write: true });
  assert.equal(refreshed.status, 'repaired');
  assert.equal(classifyN8nSkillsCompatibility(pluginRoot).status, 'healthy');
  assert.equal(runRepairedAudit(pluginRoot).status, 0);
  assert.deepEqual(fs.readFileSync(envPath), envBefore);
  assertSnapshotEqual(pluginRoot, repaired, 'refresh reconciliation must restore the deterministic repaired bytes');
});

test('unknown and partially repaired n8n Skills shapes fail closed', () => {
  const unknownRoot = copySupportedFixture();
  const unknownManifest = readJson(path.join(unknownRoot, '.codex-plugin', 'plugin.json'));
  unknownManifest.version = '1.0.3';
  writeJson(path.join(unknownRoot, '.codex-plugin', 'plugin.json'), unknownManifest);
  const unknownBefore = snapshotFiles(unknownRoot);
  assert.equal(classifyN8nSkillsCompatibility(unknownRoot).status, 'unsupported-version');
  assert.throws(
    () => reconcileN8nSkillsPlugin(unknownRoot, { windows: true, write: true }),
    /exact adapter|unsupported/i
  );
  assertSnapshotEqual(unknownRoot, unknownBefore, 'unknown versions must not be modified');

  const partialRoot = copySupportedFixture();
  reconcileN8nSkillsPlugin(partialRoot, { windows: true, write: true });
  fs.copyFileSync(
    path.join(supportedFixtureRoot, 'hooks', 'session-start.sh'),
    path.join(partialRoot, 'hooks', 'session-start.sh')
  );
  const partialBefore = snapshotFiles(partialRoot);
  assert.equal(classifyN8nSkillsCompatibility(partialRoot).status, 'partial-repair');
  assert.throws(
    () => reconcileN8nSkillsPlugin(partialRoot, { windows: true, write: true }),
    /mixture|partially repaired|source identity/i
  );
  assertSnapshotEqual(partialRoot, partialBefore, 'ambiguous supported-version state must not be modified');

  const missingRoot = copySupportedFixture();
  fs.unlinkSync(path.join(missingRoot, 'hooks', 'pre-tool-use', 'execute-workflow.sh'));
  const missingBefore = snapshotFiles(missingRoot);
  assert.equal(classifyN8nSkillsCompatibility(missingRoot).status, 'unsupported-layout');
  assert.throws(() => reconcileN8nSkillsPlugin(missingRoot, { windows: true, write: true }), /layout|missing/i);
  assertSnapshotEqual(missingRoot, missingBefore, 'missing required hook state must not be modified');
});

test('current adapter rejects wrong identity, unknown versions, malformed manifests, and layout drift', () => {
  const cases = [
    {
      name: 'wrong source identity',
      expected: 'identity-unverified',
      mutate(root) {
        const manifestPath = path.join(root, '.codex-plugin', 'plugin.json');
        const manifest = readJson(manifestPath);
        manifest.repository = 'https://github.com/example/not-official';
        writeJson(manifestPath, manifest);
      }
    },
    {
      name: 'unknown older version',
      expected: 'unsupported-version',
      mutate(root) {
        const manifestPath = path.join(root, '.codex-plugin', 'plugin.json');
        const manifest = readJson(manifestPath);
        manifest.version = '0.9.9';
        writeJson(manifestPath, manifest);
      }
    },
    {
      name: 'unsupported hook path',
      expected: 'unsupported-layout',
      mutate(root) {
        const manifestPath = path.join(root, '.codex-plugin', 'plugin.json');
        const manifest = readJson(manifestPath);
        manifest.hooks = './hooks/hooks-v2.json';
        writeJson(manifestPath, manifest);
      }
    },
    {
      name: 'unexpected critical hook file',
      expected: 'unsupported-layout',
      mutate(root) {
        fs.writeFileSync(path.join(root, 'hooks', 'unexpected-critical.sh'), '#!/usr/bin/env bash\n', 'utf8');
      }
    },
    {
      name: 'malformed hook manifest',
      expected: 'malformed',
      mutate(root) {
        fs.writeFileSync(path.join(root, 'hooks', 'hooks.json'), '{not-json\n', 'utf8');
      }
    }
  ];

  for (const entry of cases) {
    const root = copyCurrentSupportedFixture();
    entry.mutate(root);
    const before = snapshotFiles(root);
    const classification = classifyN8nSkillsCompatibility(root);
    assert.equal(classification.status, entry.expected, entry.name);
    assert.equal(classification.mutation_allowed, false, entry.name);
    assert.ok(classification.code, entry.name);
    assert.ok(classification.next_action, entry.name);
    assert.throws(() => reconcileN8nSkillsPlugin(root, { windows: true, write: true }), /./, entry.name);
    assertSnapshotEqual(root, before, `${entry.name} must fail closed`);
  }
});

test('current adapter rejects a redirected hooks root before any repair', (t) => {
  const root = copyCurrentSupportedFixture();
  const realHooks = path.join(root, 'real-hooks');
  const hooksRoot = path.join(root, 'hooks');
  fs.renameSync(hooksRoot, realHooks);
  try {
    fs.symlinkSync(realHooks, hooksRoot, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (error.code === 'EPERM' || error.code === 'EACCES') {
      t.skip(`directory link creation is unavailable: ${error.code}`);
      return;
    }
    throw error;
  }

  const classification = classifyN8nSkillsCompatibility(root);
  assert.equal(classification.status, 'unsupported-layout');
  assert.match(classification.reason, /redirected|symbolic link|junction/i);
  assert.throws(() => reconcileN8nSkillsPlugin(root, { windows: true, write: true }), /redirected|symbolic link|junction/i);
  assert.equal(fs.existsSync(path.join(realHooks, 'run-hook.ps1')), false);
});

test('current partial repair is distinct and never rewritten', () => {
  const root = copyCurrentSupportedFixture();
  reconcileN8nSkillsPlugin(root, { windows: true, write: true });
  fs.copyFileSync(
    path.join(supportedFixtureRoot, 'hooks', 'pre-tool-use', '_emit.sh'),
    path.join(root, 'hooks', 'pre-tool-use', '_emit.sh')
  );
  const before = snapshotFiles(root);
  assert.equal(classifyN8nSkillsCompatibility(root).status, 'partial-repair');
  assert.throws(() => reconcileN8nSkillsPlugin(root, { windows: true, write: true }), /mixture/i);
  assertSnapshotEqual(root, before, 'current partial repair must remain unchanged');
});

test('source-watch records the authoritative n8n Skills compatibility baseline without mutation authority', () => {
  const sourceLockPath = path.join(repoRoot, '_projects', 'n8n', 'skills-plugin-compatibility', 'SOURCE-LOCK.json');
  const before = fs.readFileSync(sourceLockPath);
  const sourceLock = JSON.parse(before.toString('utf8'));
  assert.equal(sourceLock.source_repo, 'n8n-io/skills');
  assert.equal(sourceLock.source_ref, 'main');
  assert.equal(sourceLock.source_commit, 'eb18fc3ab3e2820c748c2d84386fb5496efc1516');
  assert.equal(sourceLock.source_update_policy, 'manual_review_required');
  assert.deepEqual(sourceLock.upstream_root_surface_paths, ['skills/using-n8n-skills-official/SKILL.md']);
  assert.deepEqual(sourceLock.files.map((entry) => entry.source_path), [
    '.codex-plugin/plugin.json',
    '.agents/plugins/marketplace.json',
    '.claude-plugin/marketplace.json',
    '.claude-plugin/plugin.json',
    'hooks/hooks.json',
    'hooks/session-start.sh',
    'hooks/pre-tool-use/_emit.sh',
    'hooks/pre-tool-use/create-workflow.sh',
    'hooks/pre-tool-use/execute-workflow.sh',
    'hooks/pre-tool-use/get-node.sh',
    'hooks/pre-tool-use/test-workflow.sh',
    'hooks/pre-tool-use/update-workflow.sh',
    'hooks/pre-tool-use/validate-workflow.sh',
    'hooks/post-tool-use/validate-workflow.sh',
    'skills/using-n8n-skills-official/SKILL.md',
    'README.md',
    'LICENSE'
  ]);
  assert.match(sourceLock.notes, /report-only/i);
  assert.ok(sourceLock.files.every((entry) => /^[0-9a-f]{40}$/.test(entry.source_blob_sha)));
  assert.deepEqual(fs.readFileSync(sourceLockPath), before, 'source-watch metadata inspection must not mutate its lock');

  const advisory = readJson(path.join(repoRoot, 'repo', 'source-watch', 'advisory-targets.json'));
  assert.equal(
    advisory.targets.some((entry) => entry.id === 'n8n-skills-hook-compatibility'),
    false,
    'active SOURCE-LOCK tracking replaces the temporary advisory target'
  );
  assert.deepEqual(Object.keys(N8N_SKILLS_COMPATIBILITY_ADAPTERS).sort(), ['1.0.1', '1.0.2']);
});
