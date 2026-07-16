'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
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
      if (/^enabled\s*=\s*true(?:[ \t]*#.*)?$/m.test(original)) {
        const inserted = assignments.split(eol).filter((line) => line !== 'enabled = true').join(eol);
        proposal = original.replace(/^(enabled\s*=\s*true(?:[ \t]*#.*)?\r?\n)/m, `$1${inserted}${eol}`);
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

function approvedOptions(preview) {
  return {
    approvedProposal: preview.approval_binding,
    backupGenerationId: preview.backup_generation_id,
  };
}

function backupRootFor(filePath) {
  return path.join(path.dirname(path.dirname(filePath)), '.ai-agent-toolkit', 'backups', 'codex-delegation');
}

test('runtime detection accepts V1-only and V2-only hosts with V2 precedence', async () => {
  for (const fixture of [
    { features: [{ name: 'multi_agent', enabled: true }], expected: config.RUNTIMES.V1 },
    { features: [{ name: 'multi_agent', enabled: false }], expected: config.RUNTIMES.DISABLED },
    { features: [{ name: 'multi_agent_v2', enabled: true }], expected: config.RUNTIMES.V2 },
    { features: [{ name: 'multi_agent_v2', enabled: false }, { name: 'multi_agent', enabled: true }], expected: config.RUNTIMES.V1 },
    { features: [{ name: 'multi_agent_v2', enabled: true }, { name: 'multi_agent', enabled: true }], expected: config.RUNTIMES.V2 },
    { features: [{ name: 'multi_agent_v2', enabled: false }, { name: 'multi_agent', enabled: false }], expected: config.RUNTIMES.DISABLED },
  ]) {
    const root = tempRoot();
    const command = createRuntimeServer(root, fixture.features);
    const result = await config.inspectCodexMultiAgentRuntime({ codexCommand: command, codexHome: path.join(root, 'home') });
    assert.equal(result.runtime, fixture.expected);
    assert.match(result.detector, /experimentalFeature\/list/);
  }
});

test('runtime detection reports unknown for missing values, duplicate rows, and unsupported methods', async () => {
  for (const fixture of [
    { features: [{ name: 'multi_agent', enabled: null }] },
    { features: [{ name: 'multi_agent', enabled: true }, { name: 'multi_agent', enabled: false }] },
    { features: [], error: true },
  ]) {
    const root = tempRoot();
    const command = createRuntimeServer(root, fixture.features, { error: fixture.error });
    const result = await config.inspectCodexMultiAgentRuntime({ codexCommand: command, codexHome: path.join(root, 'home') });
    assert.equal(result.runtime, config.RUNTIMES.UNKNOWN);
  }
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

test('V2 guidance is compact, productive root-first, and honest about launch enforcement', async () => {
  const filePath = configPath();
  await configureV2(filePath);
  const text = fs.readFileSync(filePath, 'utf8');
  assert.match(text, /Root-first/);
  assert.match(text, /Apply the same launch gate before any child/);
  assert.ok(config.CODEX_V2_ROOT_GUIDANCE.length < 500);
  assert.ok(config.CODEX_V2_HELPER_GUIDANCE.length < 400);
  assert.match(config.CODEX_V2_ROOT_GUIDANCE, /Capacity is only a backstop, not launch permission/);
  assert.match(config.CODEX_V2_ROOT_GUIDANCE, /independent, non-overlapping work with material benefit/);
  assert.match(config.CODEX_V2_ROOT_GUIDANCE, /verified medium non-fast child execution/);
  assert.match(config.CODEX_V2_ROOT_GUIDANCE, /meaningful concurrent root work/);
  assert.match(config.CODEX_V2_ROOT_GUIDANCE, /Otherwise stay root-only/);
  assert.match(config.CODEX_V2_HELPER_GUIDANCE, /Never inherit fast mode/);
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

test('V2 preserves user-owned legacy values while configuring only effective V2 keys', async () => {
  const filePath = configPath();
  const legacy = '[agents]\n# user-owned legacy values\nmax_threads = 6\nmax_depth = 2\n';
  writeConfig(filePath, legacy);
  const result = await configureV2(filePath);
  assert.equal(result.status, 'configured', result.detail);
  const text = fs.readFileSync(filePath, 'utf8');
  assert.ok(text.startsWith(legacy));
  assert.match(text, /max_concurrent_threads_per_session = 2/);
  assert.equal((text.match(/max_threads = 6/g) || []).length, 1);
  assert.equal((text.match(/max_depth = 2/g) || []).length, 1);
});

test('non-exact managed V1 ownership remains fail-closed under V2', async () => {
  for (const text of [
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

test('V2 root-only mode maps zero helpers to one total session thread', async () => {
  const filePath = configPath();
  const result = await configureV2(filePath, 0);
  assert.equal(result.helper_count, 0);
  assert.equal(result.total_threads, 1);
  assert.match(fs.readFileSync(filePath, 'utf8'), /max_concurrent_threads_per_session = 1/);
  assert.doesNotMatch(fs.readFileSync(filePath, 'utf8'), /max_threads|max_depth/);
});

test('table-form user-owned V2 enablement remains unmarked and survives removal byte-for-byte', async () => {
  const compatiblePath = configPath();
  const original = '[features.multi_agent_v2]\n# user enablement\nenabled = true # keep this byte-for-byte\nuser_owned_setting = "preserve"\n';
  writeConfig(compatiblePath, original);
  const compatible = await configureV2(compatiblePath);
  assert.equal(compatible.status, 'configured', compatible.detail);
  assert.equal(compatible.enablement_ownership, 'user-owned-table');
  assert.doesNotMatch(fs.readFileSync(compatiblePath, 'utf8'), /CODEX-V2-ENABLEMENT/);
  assert.equal((fs.readFileSync(compatiblePath, 'utf8').match(/enabled = true/g) || []).length, 1);
  const removed = config.removeCodexDelegation(compatiblePath, { runtime: V2, approveCapacityResetRisk: true });
  assert.equal(removed.status, 'removed');
  assert.equal(fs.readFileSync(compatiblePath, 'utf8'), original);

  const conflictingPath = configPath();
  const conflictingText = '[features.multi_agent_v2]\nenabled = false\n';
  writeConfig(conflictingPath, conflictingText);
  const conflicting = await configureV2(conflictingPath);
  assert.equal(conflicting.status, 'conflicting');
  assert.equal(conflicting.changed, false);
  assert.equal(fs.readFileSync(conflictingPath, 'utf8'), conflictingText);
});

test('unsupported V2 child tables are not replaceable or approvable', async () => {
  const filePath = configPath();
  const original = '[features.multi_agent_v2]\nenabled = true\n\n[features.multi_agent_v2.custom]\nvalue = "unsupported"\n';
  writeConfig(filePath, original);
  const state = config.inspectCodexDelegationConfig(filePath, V2);
  assert.equal(state.status, 'conflicting');
  assert.equal(config.canReplaceUserOwnedRuntimeControls(state, V2), false);
  const preview = config.previewCodexDelegation(filePath, {
    runtime: V2,
    helperCount: 1,
    allowUserOwnedReplacement: true,
  });
  assert.notEqual(preview.status, 'preview');
  let editorCalls = 0;
  const result = await config.configureCodexDelegation(filePath, {
    runtime: V2,
    helperCount: 1,
    allowUserOwnedReplacement: true,
    editor: async () => { editorCalls += 1; return { bytes: Buffer.from('unreachable') }; },
  });
  assert.equal(result.changed, false);
  assert.equal(editorCalls, 0);
  assert.equal(fs.readFileSync(filePath, 'utf8'), original);
  assert.equal(fs.existsSync(backupRootFor(filePath)), false);

  const parentOnlyPath = configPath();
  const parentOnly = '[features.multi_agent_v2]\nenabled = true\n';
  writeConfig(parentOnlyPath, parentOnly);
  const supported = config.previewCodexDelegation(parentOnlyPath, {
    runtime: V2,
    helperCount: 1,
    allowUserOwnedReplacement: true,
  });
  assert.equal(supported.status, 'preview');
  assert.equal(fs.readFileSync(parentOnlyPath, 'utf8'), parentOnly);
});

test('explicit false or non-boolean V2 enablement is not replaceable', async () => {
  for (const enabled of ['false', '"true"']) {
    const filePath = configPath();
    const original = `[features.multi_agent_v2]\nenabled = ${enabled}\nmax_concurrent_threads_per_session = 2\n`;
    writeConfig(filePath, original);
    const state = config.inspectCodexDelegationConfig(filePath, V2);
    assert.equal(state.status, 'conflicting');
    assert.equal(config.canReplaceUserOwnedRuntimeControls(state, V2), false);
    const preview = config.previewCodexDelegation(filePath, { runtime: V2, helperCount: 1, allowUserOwnedReplacement: true });
    assert.notEqual(preview.status, 'preview');
    let editorCalls = 0;
    const result = await config.configureCodexDelegation(filePath, {
      runtime: V2,
      helperCount: 1,
      allowUserOwnedReplacement: true,
      editor: async () => { editorCalls += 1; return { bytes: Buffer.from('unreachable') }; },
    });
    assert.equal(result.changed, false);
    assert.equal(editorCalls, 0);
    assert.equal(fs.readFileSync(filePath, 'utf8'), original);
    assert.equal(fs.existsSync(backupRootFor(filePath)), false);
  }
});

test('approved migrate remains guarded when no exact legacy state exists', async () => {
  const filePath = configPath();
  const original = 'model = "gpt-5.6"\n';
  writeConfig(filePath, original);
  const preview = config.previewCodexDelegation(filePath, { runtime: V2, helperCount: 1 });
  assert.equal(preview.status, 'preview');
  let editorCalls = 0;
  const result = await config.delegationResultForChoice('migrate', filePath, {
    runtime: V2,
    helperCount: 1,
    editor: async () => { editorCalls += 1; return { bytes: Buffer.from('unreachable') }; },
    ...approvedOptions(preview),
  });
  assert.equal(result.changed, false);
  assert.match(result.detail, /No exact Toolkit-managed legacy setting is available to migrate/);
  assert.equal(editorCalls, 0);
  assert.equal(fs.readFileSync(filePath, 'utf8'), original);
  assert.equal(fs.existsSync(backupRootFor(filePath)), false);
});

test('matching user-owned V2 controls are byte-preserving no-ops with root-inclusive arithmetic', async () => {
  for (const helperCount of [1, 0]) {
    const filePath = configPath();
    const original = [
      '[features.multi_agent_v2]',
      'enabled = true # user owned',
      `max_concurrent_threads_per_session = ${helperCount + 1}`,
      `root_agent_usage_hint_text = ${JSON.stringify(config.CODEX_V2_ROOT_GUIDANCE)}`,
      `subagent_usage_hint_text = ${JSON.stringify(config.CODEX_V2_HELPER_GUIDANCE)}`,
      '',
    ].join('\n');
    writeConfig(filePath, original);
    const preview = config.previewCodexDelegation(filePath, {
      runtime: V2,
      helperCount,
      allowUserOwnedReplacement: true,
    });
    assert.equal(preview.status, 'configured');
    assert.equal(preview.selected_outcome_matches, true);
    assert.equal(preview.requires_user_confirmation, false);
    const result = await config.configureCodexDelegation(filePath, {
      runtime: V2,
      helperCount,
      allowUserOwnedReplacement: true,
      editor: async () => { throw new Error('matching user-owned V2 config must not invoke editor'); },
    });
    assert.equal(result.changed, false);
    assert.equal(result.helper_count, helperCount);
    assert.equal(result.total_threads, helperCount + 1);
    assert.equal(fs.readFileSync(filePath, 'utf8'), original);
    assert.doesNotMatch(fs.readFileSync(filePath, 'utf8'), /AI-AGENT-TOOLKIT/);
    assert.equal(fs.existsSync(backupRootFor(filePath)), false);
  }
});

test('different or structurally incomplete user-owned V2 controls are not matching no-ops', () => {
  const filePath = configPath();
  const complete = [
    '[features.multi_agent_v2]',
    'enabled = true',
    'max_concurrent_threads_per_session = 1',
    `root_agent_usage_hint_text = ${JSON.stringify(config.CODEX_V2_ROOT_GUIDANCE)}`,
    `subagent_usage_hint_text = ${JSON.stringify(config.CODEX_V2_HELPER_GUIDANCE)}`,
    '',
  ].join('\n');
  writeConfig(filePath, complete);
  const different = config.previewCodexDelegation(filePath, { runtime: V2, helperCount: 1, allowUserOwnedReplacement: true });
  assert.equal(different.status, 'preview');
  assert.equal(different.requires_user_confirmation, true);
  assert.notEqual(different.selected_outcome_matches, true);

  const incompletePath = configPath();
  writeConfig(incompletePath, '[features.multi_agent_v2]\nenabled = true\nmax_concurrent_threads_per_session = 2\n');
  const incomplete = config.previewCodexDelegation(incompletePath, { runtime: V2, helperCount: 1, allowUserOwnedReplacement: true });
  assert.notEqual(incomplete.selected_outcome_matches, true);
  assert.equal(incomplete.requires_user_confirmation, true);
});

test('approved user-owned V2 control replacement preserves enablement and unrelated keys', async () => {
  const filePath = configPath();
  const original = [
    '[features.multi_agent_v2]',
    'enabled = true # user-owned enablement',
    'max_concurrent_threads_per_session = 6',
    'root_agent_usage_hint_text = "custom root"',
    'subagent_usage_hint_text = "custom helper"',
    'unrelated = "preserve"',
    '',
  ].join('\n');
  writeConfig(filePath, original);
  const preview = config.previewCodexDelegation(filePath, {
    runtime: V2,
    helperCount: 1,
    allowUserOwnedReplacement: true,
  });
  assert.equal(preview.status, 'preview');
  assert.equal(preview.requires_user_confirmation, true);
  assert.doesNotMatch(preview.affected_keys.join('\n'), /\.enabled$/m);
  assert.match(preview.affected_keys.join('\n'), /max_concurrent_threads_per_session/);

  const result = await config.configureCodexDelegation(filePath, {
    runtime: V2,
    helperCount: 1,
    allowUserOwnedReplacement: true,
    ...approvedOptions(preview),
    editor: async () => ({
      bytes: Buffer.from(original
        .replace('max_concurrent_threads_per_session = 6', 'max_concurrent_threads_per_session = 2')
        .replace('root_agent_usage_hint_text = "custom root"', `root_agent_usage_hint_text = ${JSON.stringify(config.CODEX_V2_ROOT_GUIDANCE)}`)
        .replace('subagent_usage_hint_text = "custom helper"', `subagent_usage_hint_text = ${JSON.stringify(config.CODEX_V2_HELPER_GUIDANCE)}`)),
      editor: 'approved V2 replacement fixture',
    }),
  });
  assert.equal(result.status, 'configured', result.detail);
  const configured = fs.readFileSync(filePath, 'utf8');
  assert.match(configured, /enabled = true # user-owned enablement/);
  assert.match(configured, /unrelated = "preserve"/);
  assert.match(configured, /max_concurrent_threads_per_session = 2/);
  assert.doesNotMatch(configured, /CODEX-V2-ENABLEMENT/);
  assert.ok(fs.existsSync(result.backup_metadata_path));
  config.restoreCodexDelegationBackup(result.backup_metadata_path, { configPath: filePath });
  assert.equal(fs.readFileSync(filePath, 'utf8'), original);
});

test('approved V2 proposal rejects affected-key drift before editor or backup', async () => {
  const filePath = configPath();
  const original = [
    '[features.multi_agent_v2]',
    'enabled = true',
    'max_concurrent_threads_per_session = 6',
    'root_agent_usage_hint_text = "custom root"',
    'subagent_usage_hint_text = "custom helper"',
    '',
  ].join('\n');
  writeConfig(filePath, original);
  const preview = config.previewCodexDelegation(filePath, { runtime: V2, helperCount: 1, allowUserOwnedReplacement: true });
  const drift = original.replace('max_concurrent_threads_per_session = 6', 'max_concurrent_threads_per_session = 5');
  writeConfig(filePath, drift);
  let editorCalls = 0;
  const result = await config.configureCodexDelegation(filePath, {
    runtime: V2,
    helperCount: 1,
    allowUserOwnedReplacement: true,
    editor: async () => { editorCalls += 1; return { bytes: Buffer.from('unreachable') }; },
    ...approvedOptions(preview),
  });
  assert.equal(result.status, 'approval-stale');
  assert.equal(result.changed, false);
  assert.match(result.detail, /configuration changed after you approved the proposal/i);
  assert.equal(editorCalls, 0);
  assert.equal(fs.readFileSync(filePath, 'utf8'), drift);
  assert.equal(fs.existsSync(backupRootFor(filePath)), false);
});

test('approved V2 proposal rejects unrelated-byte drift before editor or backup', async () => {
  const filePath = configPath();
  const original = [
    'sandbox_mode = "workspace-write"',
    '[features.multi_agent_v2]',
    'enabled = true',
    'max_concurrent_threads_per_session = 6',
    'root_agent_usage_hint_text = "custom root"',
    'subagent_usage_hint_text = "custom helper"',
    '',
  ].join('\n');
  writeConfig(filePath, original);
  const preview = config.previewCodexDelegation(filePath, { runtime: V2, helperCount: 1, allowUserOwnedReplacement: true });
  const drift = original.replace('sandbox_mode = "workspace-write"', 'sandbox_mode = "danger-full-access"');
  writeConfig(filePath, drift);
  let editorCalls = 0;
  const result = await config.configureCodexDelegation(filePath, {
    runtime: V2,
    helperCount: 1,
    allowUserOwnedReplacement: true,
    editor: async () => { editorCalls += 1; return { bytes: Buffer.from('unreachable') }; },
    ...approvedOptions(preview),
  });
  assert.equal(result.status, 'approval-stale');
  assert.equal(editorCalls, 0);
  assert.equal(fs.readFileSync(filePath, 'utf8'), drift);
  assert.equal(fs.existsSync(backupRootFor(filePath)), false);
});

test('approved Toolkit-managed V2 capacity change uses the reviewed snapshot and restores exactly', async () => {
  const filePath = configPath();
  await configureV2(filePath, 1);
  const approvedBytes = fs.readFileSync(filePath);
  const preview = config.previewCodexDelegation(filePath, { runtime: V2, helperCount: 0, allowUserOwnedReplacement: true });
  const result = await configureV2(filePath, 0, approvedOptions(preview));
  assert.equal(result.status, 'configured', result.detail);
  assert.equal(result.helper_count, 0);
  assert.match(fs.readFileSync(filePath, 'utf8'), /max_concurrent_threads_per_session = 1/);
  assert.ok(fs.existsSync(result.backup_metadata_path));
  config.restoreCodexDelegationBackup(result.backup_metadata_path, { configPath: filePath });
  assert.deepEqual(fs.readFileSync(filePath), approvedBytes);
});

test('official V2 boolean enablement migrates to the configured table', async () => {
  const filePath = configPath();
  const original = 'model = "gpt-5.6"\n\n[features]\nmulti_agent_v2 = true # user intent survives\n';
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
  assert.doesNotMatch(text, /CODEX-V2-ENABLEMENT/);
  const removed = config.removeCodexDelegation(filePath, { runtime: config.RUNTIMES.UNKNOWN, approveCapacityResetRisk: true });
  assert.equal(removed.status, 'removed');
  const afterRemoval = fs.readFileSync(filePath, 'utf8');
  assert.match(afterRemoval, /\[features\.multi_agent_v2\]\nenabled = true/);
  assert.match(afterRemoval, /# user intent survives/);
  assert.doesNotMatch(afterRemoval, /max_concurrent_threads_per_session|usage_hint_text|AI-AGENT-TOOLKIT/);
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

test('whole-file proposal validation rejects adversarial security-setting mutations', async () => {
  for (const mutate of [
    (text) => text.replace('approval_policy = "on-request"', 'approval_policy = "never"'),
    (text) => text.replace('sandbox_mode = "workspace-write"', 'sandbox_mode = "danger-full-access"'),
    (text) => text.replace('web_search = false', 'web_search = true'),
    (text) => `${text}\n[mcp_servers.attacker]\ncommand = "unexpected"\n`,
  ]) {
    const filePath = configPath();
    const original = 'approval_policy = "on-request"\nsandbox_mode = "workspace-write"\n[features]\nweb_search = false\n';
    writeConfig(filePath, original);
    const result = await config.configureCodexDelegation(filePath, {
      runtime: V2,
      helperCount: 1,
      editor: v2Editor({ mutate }),
    });
    assert.equal(result.status, 'conflicting');
    assert.equal(result.changed, false);
    assert.equal(fs.readFileSync(filePath, 'utf8'), original);
  }
});

test('exact restore commands quote absolute hostile script and metadata paths for both shells', () => {
  const hostile = `C:\\Users\\O'Brien\\A & B;$(bad)\\restore.json`;
  const commands = config.restoreCommands(hostile);
  assert.ok(path.isAbsolute(commands.setup_script_path));
  assert.match(commands.powershell, new RegExp(config.quotePowerShellArgument(commands.setup_script_path).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
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
  const blocked = config.removeCodexDelegation(filePath, { runtime: V2 });
  assert.equal(blocked.status, 'approval-required');
  const removed = config.removeCodexDelegation(filePath, { runtime: config.RUNTIMES.DISABLED, approveCapacityResetRisk: true });
  assert.equal(removed.status, 'removed');
  assert.equal(removed.changed, true);
  const text = fs.readFileSync(filePath, 'utf8');
  assert.ok(text.startsWith(original));
  assert.doesNotMatch(text, /CODEX-HELPER-CAPACITY|max_concurrent_threads_per_session|usage_hint_text/);
  const state = config.inspectCodexDelegationConfig(filePath, V2);
  assert.equal(state.enablement_ownership, 'absent');
});

test('visible removal preview binds approval to exact bytes and creates an exact backup', async () => {
  const driftPath = configPath();
  writeConfig(driftPath, 'model = "before"\n');
  await configureV2(driftPath);
  const stalePreview = config.previewCodexDelegationRemoval(driftPath, { runtime: V2, setupScriptPath: __filename });
  assert.equal(stalePreview.status, 'removal-preview');
  assert.match(stalePreview.detail, /higher host default/);
  fs.writeFileSync(driftPath, fs.readFileSync(driftPath, 'utf8').replace('model = "before"', 'model = "after"'));
  const stale = config.removeCodexDelegation(driftPath, {
    runtime: V2,
    approveCapacityResetRisk: true,
    approvedProposal: stalePreview.approval_binding,
    backupGenerationId: stalePreview.backup_generation_id,
  });
  assert.equal(stale.status, 'approval-stale');
  assert.equal(fs.existsSync(stalePreview.backup_metadata_path), false);
  assert.match(fs.readFileSync(driftPath, 'utf8'), /CODEX-HELPER-CAPACITY/);

  const appliedPath = configPath();
  writeConfig(appliedPath, 'model = "stable"\n');
  await configureV2(appliedPath);
  const preview = config.previewCodexDelegationRemoval(appliedPath, { runtime: V2, setupScriptPath: __filename });
  const removed = config.removeCodexDelegation(appliedPath, {
    runtime: V2,
    approveCapacityResetRisk: true,
    approvedProposal: preview.approval_binding,
    backupGenerationId: preview.backup_generation_id,
  });
  assert.equal(removed.status, 'removed');
  assert.equal(fs.existsSync(preview.backup_metadata_path), true);
  assert.doesNotMatch(fs.readFileSync(appliedPath, 'utf8'), /AI-AGENT-TOOLKIT|max_concurrent_threads_per_session/);
});

test('fresh Toolkit enablement is independently owned and removal restores absent enablement', async () => {
  const filePath = configPath();
  const original = 'model = "gpt-5.6"\r\n';
  writeConfig(filePath, original);
  const configured = await configureV2(filePath);
  assert.equal(configured.enablement_ownership, 'toolkit-managed');
  assert.match(fs.readFileSync(filePath, 'utf8'), /CODEX-V2-ENABLEMENT/);
  const removed = await config.delegationResultForChoice('remove', filePath, { runtime: config.RUNTIMES.UNKNOWN });
  assert.equal(removed.status, 'removed');
  const after = fs.readFileSync(filePath, 'utf8');
  assert.ok(after.startsWith(original));
  assert.doesNotMatch(after, /enabled\s*=|AI-AGENT-TOOLKIT|max_concurrent|usage_hint/);
});

test('keep never migrates an available legacy block or invokes the editor', async () => {
  const filePath = configPath();
  const original = `[agents]\n${config.expectedLegacyBlock(1)}\n`;
  writeConfig(filePath, original);
  const result = await config.delegationResultForChoice('keep', filePath, {
    runtime: V2,
    editor: async () => { throw new Error('keep must not invoke editor'); },
  });
  assert.equal(result.changed, false);
  assert.equal(result.status, 'kept');
  assert.equal(fs.readFileSync(filePath, 'utf8'), original);
  assert.equal(fs.existsSync(path.join(path.dirname(path.dirname(filePath)), '.ai-agent-toolkit')), false);
});

test('unknown runtime does not infer V1 from user TOML and obsolete ownership markers fail closed', async () => {
  const userPath = configPath();
  const userText = '[agents]\nmax_threads = 1\nmax_depth = 1\n';
  writeConfig(userPath, userText);
  const userState = config.inspectCodexDelegationConfig(userPath, config.RUNTIMES.UNKNOWN);
  assert.equal(userState.status, 'unsupported');
  assert.equal(config.removeCodexDelegation(userPath, { runtime: config.RUNTIMES.UNKNOWN, approveCapacityResetRisk: true }).changed, false);
  assert.equal(fs.readFileSync(userPath, 'utf8'), userText);

  const obsoletePath = configPath();
  const obsolete = '[features.multi_agent_v2]\n# AI-AGENT-TOOLKIT:BEGIN CODEX-HELPER-CAPACITY v2\nenabled = true\nmax_concurrent_threads_per_session = 2\n# AI-AGENT-TOOLKIT:END CODEX-HELPER-CAPACITY\n';
  writeConfig(obsoletePath, obsolete);
  const obsoleteState = config.inspectCodexDelegationConfig(obsoletePath, V2);
  assert.equal(obsoleteState.status, 'conflicting');
  assert.match(obsoleteState.detail, /ownership is ambiguous/);
  assert.equal(fs.readFileSync(obsoletePath, 'utf8'), obsolete);
});

test('generated PowerShell restore command executes outside the Toolkit checkout', { skip: process.platform !== 'win32' }, async () => {
  const hostileRoot = path.join(tempRoot(), `O'Brien & (restore);$x[1]`);
  const filePath = configPath(hostileRoot);
  const original = 'model = "before"\n';
  writeConfig(filePath, original);
  const result = await configureV2(filePath);
  const unrelated = tempRoot();
  const restored = spawnSync('powershell.exe', ['-NoProfile', '-Command', result.restore_commands.powershell], {
    cwd: unrelated,
    env: { ...process.env, CODEX_HOME: path.dirname(filePath), HOME: hostileRoot, USERPROFILE: hostileRoot },
    encoding: 'utf8',
  });
  assert.equal(restored.status, 0, restored.stderr || restored.stdout);
  assert.equal(fs.readFileSync(filePath, 'utf8'), original);
});

test('generated POSIX restore command executes outside the Toolkit checkout', { skip: process.platform === 'win32' }, async () => {
  const hostileRoot = path.join(tempRoot(), `O'Brien & (restore);$x[1]`);
  const filePath = configPath(hostileRoot);
  const original = 'model = "before"\n';
  writeConfig(filePath, original);
  const result = await configureV2(filePath);
  const restored = spawnSync('/bin/sh', ['-c', result.restore_commands.posix], {
    cwd: tempRoot(), env: { ...process.env, CODEX_HOME: path.dirname(filePath), HOME: hostileRoot }, encoding: 'utf8',
  });
  assert.equal(restored.status, 0, restored.stderr || restored.stdout);
  assert.equal(fs.readFileSync(filePath, 'utf8'), original);
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
