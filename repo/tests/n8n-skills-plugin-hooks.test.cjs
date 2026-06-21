'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const auditScript = path.join(repoRoot, 'repo', 'scripts', 'audit-n8n-skills-plugin-hooks.cjs');

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function makePluginRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'n8n-skills-plugin-'));
  fs.mkdirSync(path.join(root, 'hooks', 'pre-tool-use'), { recursive: true });
  fs.mkdirSync(path.join(root, '.codex-plugin'), { recursive: true });
  return root;
}

function runAudit(pluginRoot, ...extraArgs) {
  return spawnSync(process.execPath, [auditScript, '--plugin-root', pluginRoot, '--windows', ...extraArgs], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
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

test('n8n plugin hook audit rejects malformed plugin metadata JSON', () => {
  const pluginRoot = makePluginRoot();
  fs.writeFileSync(path.join(pluginRoot, '.codex-plugin', 'plugin.json'), '{ invalid json\n', 'utf8');
  writeJson(path.join(pluginRoot, 'hooks', 'hooks.json'), { hooks: {} });

  const result = runAudit(pluginRoot);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /\.codex-plugin\/plugin\.json is not valid JSON/);
});
