'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const config = require('../scripts/codex-delegation-config.cjs');

const V2 = config.RUNTIMES.V2;

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-codex-v2-'));
}

function configPath(root = tempRoot()) {
  return path.join(root, '.codex', 'config.toml');
}

function writeConfig(filePath, text) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, text);
}

function unmarkedV2Block(helperCount, eol) {
  return config.expectedV2Block(helperCount, eol)
    .split(eol)
    .filter((line) => !line.includes('AI-AGENT-TOOLKIT:'))
    .join(eol);
}

function v2Editor({ mutate } = {}) {
  return async ({ originalBytes, helperCount }) => {
    const original = originalBytes.toString('utf8');
    const eol = original.includes('\r\n') ? '\r\n' : '\n';
    const assignments = unmarkedV2Block(helperCount, eol);
    let proposal;
    if (/^\[features\.multi_agent_v2\][ \t]*$/m.test(original)) {
      if (/^enabled\s*=\s*true\s*$/m.test(original)) {
        const inserted = assignments.split(eol).filter((line) => line !== 'enabled = true').join(eol);
        proposal = original.replace(/^(enabled\s*=\s*true\s*\r?\n)/m, `$1${inserted}${eol}`);
      } else {
        proposal = original.replace(/^(\[features\.multi_agent_v2\][ \t]*\r?\n)/m, `$1${assignments}${eol}`);
      }
    } else {
      const separator = original ? (original.endsWith(eol) ? eol : `${eol}${eol}`) : '';
      proposal = `${original}${separator}[features.multi_agent_v2]${eol}${assignments}${eol}`;
    }
    return { bytes: Buffer.from(mutate ? mutate(proposal) : proposal), editor: 'V2 fixture editor' };
  };
}

function createRuntimeServer(root, features, options = {}) {
  const filePath = path.join(root, 'fake-codex-runtime.cjs');
  const featureJson = JSON.stringify(features);
  fs.writeFileSync(filePath, [
    "'use strict';",
    "const readline = require('node:readline');",
    `const features = ${featureJson};`,
    "const rl = readline.createInterface({ input: process.stdin });",
    "rl.on('line', (line) => {",
    "  const request = JSON.parse(line);",
    "  if (request.method === 'initialize') process.stdout.write(JSON.stringify({ id: request.id, result: {} }) + '\\n');",
    options.error
      ? "  if (request.method === 'experimentalFeature/list') process.stdout.write(JSON.stringify({ id: request.id, error: { message: 'fixture failure' } }) + '\\n');"
      : "  if (request.method === 'experimentalFeature/list') process.stdout.write(JSON.stringify({ id: request.id, result: { data: features } }) + '\\n');",
    '});',
    '',
  ].join('\n'));
  return filePath;
}

function createLingeringEditorServer(root) {
  const filePath = path.join(root, 'fake-lingering-editor.cjs');
  fs.writeFileSync(filePath, [
    "'use strict';",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const readline = require('node:readline');",
    "const rl = readline.createInterface({ input: process.stdin });",
    "rl.on('line', (line) => {",
    "  const request = JSON.parse(line);",
    "  if (request.method === 'initialize') process.stdout.write(JSON.stringify({ id: request.id, result: {} }) + '\\n');",
    "  if (request.method === 'config/batchWrite') {",
    "    const values = Object.fromEntries(request.params.edits.map((edit) => [edit.keyPath.split('.').at(-1), edit.value]));",
    "    const target = path.join(process.env.CODEX_HOME, 'config.toml');",
    "    fs.writeFileSync(target, '[features.multi_agent_v2]\\nenabled = true\\nmax_concurrent_threads_per_session = ' + values.max_concurrent_threads_per_session + '\\nroot_agent_usage_hint_text = ' + JSON.stringify(values.root_agent_usage_hint_text) + '\\nsubagent_usage_hint_text = ' + JSON.stringify(values.subagent_usage_hint_text) + '\\n');",
    "    process.stdout.write(JSON.stringify({ id: request.id, result: {} }) + '\\n');",
    "    setInterval(() => {}, 1000);",
    "  }",
    '});',
    '',
  ].join('\n'));
  return filePath;
}

async function configureV2(filePath, helperCount = 1, options = {}) {
  return config.configureCodexDelegation(filePath, {
    runtime: V2,
    helperCount,
    editor: v2Editor(),
    ...options,
  });
}

test('runtime detection prefers V2, then V1, then disabled', async () => {
  for (const fixture of [
    { v2: true, v1: true, expected: config.RUNTIMES.V2 },
    { v2: false, v1: true, expected: config.RUNTIMES.V1 },
    { v2: false, v1: false, expected: config.RUNTIMES.DISABLED },
  ]) {
    const root = tempRoot();
    const command = createRuntimeServer(root, [
      { name: 'multi_agent_v2', enabled: fixture.v2 },
      { name: 'multi_agent', enabled: fixture.v1 },
    ]);
    const result = await config.inspectCodexMultiAgentRuntime({ codexCommand: command, codexHome: path.join(root, 'home') });
    assert.equal(result.runtime, fixture.expected);
    assert.match(result.detector, /experimentalFeature\/list/);
  }
});

test('runtime detection reports unknown when effective feature state is incomplete', async () => {
  const root = tempRoot();
  const command = createRuntimeServer(root, [{ name: 'multi_agent_v2', enabled: true }]);
  const result = await config.inspectCodexMultiAgentRuntime({ codexCommand: command, codexHome: path.join(root, 'home') });
  assert.equal(result.runtime, config.RUNTIMES.UNKNOWN);
  assert.match(result.detail, /did not report both/);
});

test('RAM-safe V2 configuration allows one helper and two total threads', async () => {
  const filePath = configPath();
  writeConfig(filePath, 'model = "gpt-5.6"\n');
  const result = await configureV2(filePath);
  assert.equal(result.status, 'configured');
  assert.equal(result.helper_count, 1);
  assert.equal(result.total_threads, 2);
  assert.equal(result.ownership, 'toolkit-managed-v2');
  assert.match(result.detail, /root counts/);
  const text = fs.readFileSync(filePath, 'utf8');
  assert.match(text, /enabled = true/);
  assert.match(text, /max_concurrent_threads_per_session = 2/);
  assert.doesNotMatch(text, /max_threads|max_depth/);
});

test('custom V2 capacity translates helpers to total session threads', async () => {
  const filePath = configPath();
  const result = await configureV2(filePath, 3);
  assert.equal(result.helper_count, 3);
  assert.equal(result.total_threads, 4);
  assert.match(fs.readFileSync(filePath, 'utf8'), /max_concurrent_threads_per_session = 4/);
});

test('V2 guidance is compact, root-only by default, and honest about policy enforcement', async () => {
  const filePath = configPath();
  await configureV2(filePath);
  const text = fs.readFileSync(filePath, 'utf8');
  assert.match(text, /Stay root-only by default/);
  assert.match(text, /Do not spawn another helper/);
  assert.ok(config.CODEX_V2_ROOT_GUIDANCE.length < 400);
  assert.ok(config.CODEX_V2_HELPER_GUIDANCE.length < 300);
  const state = config.inspectCodexDelegationConfig(filePath, V2);
  assert.match(state.recursive_helper_control, /policy-only/);
  assert.equal(state.recursive_hard_block, false);
});

test('exact PR 237 V1 block migrates to V2 while unrelated bytes survive', async () => {
  const filePath = configPath();
  const original = [
    'model = "gpt-5.6"',
    '[agents]',
    config.CODEX_DELEGATION_BEGIN,
    'max_threads = 1',
    'max_depth = 1',
    config.CODEX_DELEGATION_END,
    '',
    '[agents.security-reviewer]',
    'description = "preserve me"',
    '',
  ].join('\n');
  writeConfig(filePath, original);
  const before = config.inspectCodexDelegationConfig(filePath, V2);
  assert.equal(before.status, 'migration-required');
  const result = await configureV2(filePath);
  assert.equal(result.migrated_legacy_block, true);
  const text = fs.readFileSync(filePath, 'utf8');
  assert.doesNotMatch(text, /max_threads|max_depth|CODEX-DELEGATION-LIMITS/);
  assert.match(text, /description = "preserve me"/);
  assert.match(text, /CODEX-HELPER-CAPACITY/);
});

test('non-exact or user-owned V1 settings are not migrated', async () => {
  for (const text of [
    '[agents]\nmax_threads = 1\nmax_depth = 1\n',
    `[agents]\n${config.CODEX_DELEGATION_BEGIN}\nmax_threads = 2\nmax_depth = 1\n${config.CODEX_DELEGATION_END}\n`,
    `[agents]\n${config.CODEX_DELEGATION_BEGIN}\nmax_threads = 1\nmax_depth = 1\n`,
  ]) {
    const filePath = configPath();
    writeConfig(filePath, text);
    const result = await configureV2(filePath);
    assert.equal(result.changed, false);
    assert.ok(['conflicting', 'unsupported'].includes(result.status));
    assert.equal(fs.readFileSync(filePath, 'utf8'), text);
  }
});

test('user-owned V2 enablement is preserved only when true', async () => {
  const compatiblePath = configPath();
  writeConfig(compatiblePath, '[features.multi_agent_v2]\nenabled = true\n');
  const compatible = await configureV2(compatiblePath);
  assert.equal(compatible.status, 'configured', compatible.detail);
  assert.equal((fs.readFileSync(compatiblePath, 'utf8').match(/enabled = true/g) || []).length, 1);

  const conflictingPath = configPath();
  const conflictingText = '[features.multi_agent_v2]\nenabled = false\n';
  writeConfig(conflictingPath, conflictingText);
  const conflicting = await configureV2(conflictingPath);
  assert.equal(conflicting.status, 'conflicting');
  assert.equal(conflicting.changed, false);
  assert.equal(fs.readFileSync(conflictingPath, 'utf8'), conflictingText);
});

test('official V2 boolean enablement migrates to the configured table', async () => {
  const filePath = configPath();
  const original = 'model = "gpt-5.6"\n\n[features]\nmulti_agent_v2 = true\n';
  writeConfig(filePath, original);
  const before = config.inspectCodexDelegationConfig(filePath, V2);
  assert.equal(before.status, 'enablement-migration-required');
  const result = await configureV2(filePath);
  assert.equal(result.status, 'configured', result.detail);
  assert.equal(result.migrated_v2_boolean_enablement, true);
  const text = fs.readFileSync(filePath, 'utf8');
  assert.doesNotMatch(text, /^multi_agent_v2\s*=\s*true$/m);
  assert.match(text, /\[features\.multi_agent_v2\]/);
  assert.match(text, /enabled = true/);
  assert.match(text, /max_concurrent_threads_per_session = 2/);
  assert.match(text, /model = "gpt-5.6"/);
});

test('repeated setup is idempotent and creates no second backup generation', async () => {
  const filePath = configPath();
  const first = await configureV2(filePath);
  const backupRoot = path.dirname(path.dirname(first.backup_metadata_path));
  const generations = fs.readdirSync(backupRoot).length;
  const second = await configureV2(filePath, 1, { editor: async () => { throw new Error('editor must not run'); } });
  assert.equal(second.changed, false);
  assert.equal(fs.readdirSync(backupRoot).length, generations);
});

test('proposal validation rejects unrelated editor mutations without writing', async () => {
  const filePath = configPath();
  const original = 'model = "gpt-5.6"\n';
  writeConfig(filePath, original);
  const result = await config.configureCodexDelegation(filePath, {
    runtime: V2,
    helperCount: 1,
    editor: v2Editor({ mutate: (text) => text.replace('model = "gpt-5.6"', 'model = "changed"') }),
  });
  assert.equal(result.status, 'conflicting');
  assert.equal(result.changed, false);
  assert.match(result.detail, /changed text before/);
  assert.equal(fs.readFileSync(filePath, 'utf8'), original);
});

test('exact restore commands quote hostile metadata paths for both shells', () => {
  const hostile = `C:\\Users\\O'Brien\\A & B;$(bad)\\restore.json`;
  const commands = config.restoreCommands(hostile);
  assert.match(commands.powershell, /O''Brien/);
  assert.match(commands.posix, /O'"'"'Brien/);
  assert.doesNotMatch(commands.powershell, /\["/);
});

test('temporary editor cleanup retries transient locks and removes residue', async () => {
  const root = tempRoot();
  let attempts = 0;
  const result = await config.cleanupTemporaryEditorDirectory(root, {
    delays: [0, 0, 0],
    remove(target) {
      attempts += 1;
      if (attempts < 3) throw Object.assign(new Error('locked'), { code: 'EPERM' });
      fs.rmSync(target, { recursive: true, force: true });
    },
  });
  assert.equal(result.attempts, 3);
  assert.equal(fs.existsSync(root), false);
});

test('persistent temporary editor cleanup failure is visible and preserves evidence', async () => {
  const root = tempRoot();
  await assert.rejects(
    config.cleanupTemporaryEditorDirectory(root, {
      delays: [0, 0],
      remove() { throw Object.assign(new Error('still locked'), { code: 'EBUSY' }); },
    }),
    (error) => error.cleanupPath === root && /preserved for safe manual inspection/.test(error.message)
  );
  assert.equal(fs.existsSync(root), true);
  fs.rmSync(root, { recursive: true, force: true });
});

test('lingering app-server is terminated before temporary editor cleanup', async () => {
  const root = tempRoot();
  const result = await config.editWithCodexAppServer(Buffer.alloc(0), {
    runtime: V2,
    helperCount: 1,
    codexCommand: createLingeringEditorServer(root),
    closeTimeoutMs: 25,
    forceExitTimeoutMs: 2000,
  });
  assert.match(result.bytes.toString('utf8'), /max_concurrent_threads_per_session = 2/);
  assert.equal(result.temporary_cleanup, 'removed after child exit');
});

test('remove deletes only an exact Toolkit-managed V2 block', async () => {
  const filePath = configPath();
  const original = 'model = "gpt-5.6"\n';
  writeConfig(filePath, original);
  await configureV2(filePath);
  const removed = config.removeCodexDelegation(filePath, { runtime: V2 });
  assert.equal(removed.status, 'removed');
  assert.equal(removed.changed, true);
  const text = fs.readFileSync(filePath, 'utf8');
  assert.ok(text.startsWith(original));
  assert.doesNotMatch(text, /CODEX-HELPER-CAPACITY|max_concurrent_threads_per_session|usage_hint_text/);
});

test('unknown and disabled runtime states do not write config', async () => {
  for (const runtime of [config.RUNTIMES.UNKNOWN, config.RUNTIMES.DISABLED]) {
    const filePath = configPath();
    const original = 'model = "gpt-5.6"\n';
    writeConfig(filePath, original);
    const result = await config.configureCodexDelegation(filePath, { runtime, helperCount: 1, editor: v2Editor() });
    assert.equal(result.changed, false);
    assert.equal(fs.readFileSync(filePath, 'utf8'), original);
  }
});
