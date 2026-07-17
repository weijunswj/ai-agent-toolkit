'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const config = require('../scripts/codex-delegation-config.cjs');

const V1 = config.RUNTIMES.V1;
const V2 = config.RUNTIMES.V2;

function tempConfig(label = 'repair case') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `toolkit-${label.replace(/\s+/g, '-')}-`));
  const codexHome = path.join(root, 'Codex Home With Spaces');
  const filePath = path.join(codexHome, 'config.toml');
  fs.mkdirSync(codexHome, { recursive: true });
  return { root, codexHome, filePath };
}

function write(filePath, text, mode) {
  fs.writeFileSync(filePath, text, mode == null ? undefined : { mode });
}

function v2Config(block, eol = '\n') {
  return `title = "preserve"${eol}${eol}[features.multi_agent_v2]${eol}${block}${eol}${eol}[unrelated]${eol}note = "byte exact"${eol}`;
}

function unmarkedV2(helperCount, eol) {
  return config.expectedV2Block(helperCount, eol)
    .split(eol)
    .filter((line) => !line.includes('AI-AGENT-TOOLKIT:'))
    .join(eol);
}

function v2Editor() {
  return async ({ originalBytes, helperCount }) => {
    const original = originalBytes.toString('utf8');
    const eol = original.includes('\r\n') ? '\r\n' : '\n';
    const block = unmarkedV2(helperCount, eol);
    let proposal;
    if (/^enabled\s*=\s*true(?:[ \t]*#.*)?$/m.test(original)) {
      const additions = block.split(eol).filter((line) => line !== 'enabled = true').join(eol);
      proposal = original.replace(/^(enabled\s*=\s*true(?:[ \t]*#.*)?\r?\n)/m, `$1${additions}${eol}`);
    } else {
      proposal = original.replace(/^(\[features\.multi_agent_v2\][ \t]*\r?\n)/m, `$1${block}${eol}`);
    }
    return { bytes: Buffer.from(proposal), editor: 'malformed repair fixture editor' };
  };
}

function malformedV2(kind, eol = '\n') {
  const block = config.expectedV2Block(1, eol);
  if (kind === 'missing-end') return block.replace(`${config.CODEX_HELPER_CAPACITY_END}${eol}`, '');
  if (kind === 'missing-begin') return block.replace(`${config.CODEX_HELPER_CAPACITY_BEGIN}${eol}`, '');
  if (kind === 'duplicate-begin') return block.replace(config.CODEX_HELPER_CAPACITY_BEGIN, `${config.CODEX_HELPER_CAPACITY_BEGIN}${eol}${config.CODEX_HELPER_CAPACITY_BEGIN}`);
  if (kind === 'reversed') {
    const normal = [config.CODEX_HELPER_CAPACITY_BEGIN, 'max_concurrent_threads_per_session = 2', config.CODEX_HELPER_CAPACITY_END].join(eol);
    const reversed = [config.CODEX_HELPER_CAPACITY_END, 'max_concurrent_threads_per_session = 2', config.CODEX_HELPER_CAPACITY_BEGIN].join(eol);
    return block.replace(normal, reversed);
  }
  throw new Error(`unknown fixture ${kind}`);
}

function missingFinalV2End(extraLine = '', eol = '\n') {
  const replacement = extraLine ? `${extraLine}${eol}` : '';
  return config.expectedV2Block(1, eol).replace(config.CODEX_HELPER_GUIDANCE_END, replacement);
}

function missingFirstV2Begin(extraLine = '', eol = '\n') {
  const prefix = extraLine ? `${extraLine}${eol}` : '';
  return config.expectedV2Block(1, eol)
    .replace(`${config.CODEX_V2_ENABLEMENT_BEGIN}${eol}`, '')
    .replace('enabled = true', `${prefix}enabled = true`);
}

function malformedLegacy(boundary, extraLine = '', eol = '\n') {
  const prefix = extraLine ? `${extraLine}${eol}` : '';
  const suffix = extraLine ? `${eol}${extraLine}` : '';
  if (boundary === 'missing-end') {
    return config.expectedLegacyBlock(1, eol).replace(`${eol}${config.CODEX_DELEGATION_END}`, suffix);
  }
  if (boundary === 'missing-begin') {
    return config.expectedLegacyBlock(1, eol)
      .replace(`${config.CODEX_DELEGATION_BEGIN}${eol}`, '')
      .replace('max_threads = 1', `${prefix}max_threads = 1`);
  }
  throw new Error(`unknown legacy boundary ${boundary}`);
}

function preview(filePath, codexHome, helperCount = 0) {
  return config.previewCodexDelegation(filePath, {
    runtime: V2,
    helperCount,
    codexHome,
    allowUserOwnedReplacement: true,
  });
}

function approved(previewResult) {
  return {
    approvedProposal: previewResult.approval_binding,
    backupGenerationId: previewResult.backup_generation_id,
  };
}

test('recognized missing, duplicate, and reversed V2 markers classify as bounded repair-required states', () => {
  for (const fixture of [
    ['missing-end', 'missing-end-marker'],
    ['missing-begin', 'missing-begin-marker'],
    ['duplicate-begin', 'duplicate-recognized-marker'],
    ['reversed', 'reversed-marker-order'],
  ]) {
    const state = config.codexDelegationConfigState(Buffer.from(v2Config(malformedV2(fixture[0]))), 'synthetic/config.toml', V2);
    assert.equal(state.status, 'repair-required', `${fixture[0]}: ${state.detail}`);
    assert.equal(state.ownership, 'toolkit-malformed-repairable');
    assert.ok(state.repair.kinds.includes(fixture[1]));
    assert.ok(state.repair.affected_ranges.length >= 7);
    assert.equal(state.repair.unrelated_bytes_unchanged, true);
    assert.notEqual(state.status, 'unconfigured');
    assert.notEqual(state.status, 'migration-required');
    assert.notEqual(state.ownership, 'toolkit-managed-v2');
    assert.notEqual(state.ownership, 'user-owned-compatible-v2');
  }
});

test('category-aware unmatched V2 boundaries reject content outside the old selected interval', () => {
  const unsafe = [
    ['missing final end with trailing user comment', missingFinalV2End('# user-owned trailing comment')],
    ['missing final end with trailing user assignment', missingFinalV2End('user_setting = "keep"')],
    ['missing first begin with leading user comment', missingFirstV2Begin('# user-owned leading comment')],
    ['missing first begin with leading user assignment', missingFirstV2Begin('user_setting = "keep"')],
    ['unsupported assignment after the final canonical assignment', missingFinalV2End('unsupported_setting = true')],
  ];
  for (const [label, block] of unsafe) {
    const state = config.codexDelegationConfigState(Buffer.from(v2Config(block)), 'synthetic/config.toml', V2);
    assert.equal(state.status, 'conflicting', `${label}: ${state.detail}`);
  }

  for (const [label, block, boundarySource] of [
    ['missing final end at table boundary', missingFinalV2End(), 'table-end'],
    ['missing first begin at table boundary', missingFirstV2Begin(), 'table-start'],
    ['missing capacity end before a valid next category', malformedV2('missing-end'), 'before:root-guidance'],
    ['missing capacity begin after a valid previous category', malformedV2('missing-begin'), 'after:enablement'],
  ]) {
    const state = config.codexDelegationConfigState(Buffer.from(v2Config(block)), 'synthetic/config.toml', V2);
    assert.equal(state.status, 'repair-required', `${label}: ${state.detail}`);
    assert.equal(state.repair.implied_category_spans.length, 1, label);
    assert.equal(state.repair.implied_category_spans[0].boundary_source, boundarySource, label);
  }
});

test('category-aware unmatched legacy boundaries reject leading and trailing user content', () => {
  const cases = [
    ['missing end with trailing comment', malformedLegacy('missing-end', '# user-owned trailing comment'), 'conflicting'],
    ['missing end with trailing assignment', malformedLegacy('missing-end', 'user_setting = "keep"'), 'conflicting'],
    ['missing begin with leading comment', malformedLegacy('missing-begin', '# user-owned leading comment'), 'conflicting'],
    ['missing begin with leading assignment', malformedLegacy('missing-begin', 'user_setting = "keep"'), 'conflicting'],
    ['safe missing end', malformedLegacy('missing-end'), 'repair-required'],
    ['safe missing begin', malformedLegacy('missing-begin'), 'repair-required'],
  ];
  for (const [label, block, expected] of cases) {
    const state = config.codexDelegationConfigState(Buffer.from(`[agents]\n${block}\n`), 'synthetic/config.toml', V1);
    assert.equal(state.status, expected, `${label}: ${state.detail}`);
    if (expected === 'repair-required') {
      assert.equal(state.repair.implied_category_spans[0].boundary_source, label.includes('end') ? 'table-end' : 'table-start');
    }
  }
});

test('duplicate and overlapping malformed category interpretations remain fail closed', () => {
  const doubleDuplicate = config.expectedV2Block(1, '\n')
    .replace(config.CODEX_HELPER_CAPACITY_BEGIN, `${config.CODEX_HELPER_CAPACITY_BEGIN}\n${config.CODEX_HELPER_CAPACITY_BEGIN}`)
    .replace(config.CODEX_ROOT_GUIDANCE_BEGIN, `${config.CODEX_ROOT_GUIDANCE_BEGIN}\n${config.CODEX_ROOT_GUIDANCE_BEGIN}`);
  const multipleCandidates = config.expectedV2Block(1, '\n')
    .replace(config.CODEX_HELPER_CAPACITY_BEGIN, `${config.CODEX_HELPER_CAPACITY_BEGIN}\n${config.CODEX_HELPER_CAPACITY_BEGIN}`)
    .replace(config.CODEX_HELPER_CAPACITY_END, `${config.CODEX_HELPER_CAPACITY_END}\n${config.CODEX_HELPER_CAPACITY_END}`);
  const overlapping = config.expectedV2Block(1, '\n')
    .replace(`${config.CODEX_HELPER_CAPACITY_END}\n`, '')
    .replace(`${config.CODEX_ROOT_GUIDANCE_BEGIN}\n`, '');
  const unknownInsideImplied = missingFinalV2End('# AI-AGENT-TOOLKIT:END CODEX-UNKNOWN-CATEGORY v1');
  for (const [label, block] of [
    ['two duplicated malformed categories', doubleDuplicate],
    ['multiple candidate spans in one category', multipleCandidates],
    ['overlapping category spans', overlapping],
    ['unknown marker inside implied span', unknownInsideImplied],
  ]) {
    const state = config.codexDelegationConfigState(Buffer.from(v2Config(block)), 'synthetic/config.toml', V2);
    assert.equal(state.status, 'conflicting', `${label}: ${state.detail}`);
  }
});

test('every newly rejected implied-span case invokes no editor, backup, replacement, or write', async () => {
  const cases = [
    ['v2 trailing comment', V2, v2Config(missingFinalV2End('# user-owned trailing comment'))],
    ['v2 trailing assignment', V2, v2Config(missingFinalV2End('user_setting = "keep"'))],
    ['v2 leading comment', V2, v2Config(missingFirstV2Begin('# user-owned leading comment'))],
    ['v2 leading assignment', V2, v2Config(missingFirstV2Begin('user_setting = "keep"'))],
    ['v2 unsupported trailing assignment', V2, v2Config(missingFinalV2End('unsupported_setting = true'))],
    ['v1 trailing comment', V1, `[agents]\n${malformedLegacy('missing-end', '# user-owned trailing comment')}\n`],
    ['v1 trailing assignment', V1, `[agents]\n${malformedLegacy('missing-end', 'user_setting = "keep"')}\n`],
    ['v1 leading comment', V1, `[agents]\n${malformedLegacy('missing-begin', '# user-owned leading comment')}\n`],
    ['v1 leading assignment', V1, `[agents]\n${malformedLegacy('missing-begin', 'user_setting = "keep"')}\n`],
    ['two duplicated categories', V2, v2Config(config.expectedV2Block(1, '\n')
      .replace(config.CODEX_HELPER_CAPACITY_BEGIN, `${config.CODEX_HELPER_CAPACITY_BEGIN}\n${config.CODEX_HELPER_CAPACITY_BEGIN}`)
      .replace(config.CODEX_ROOT_GUIDANCE_BEGIN, `${config.CODEX_ROOT_GUIDANCE_BEGIN}\n${config.CODEX_ROOT_GUIDANCE_BEGIN}`))],
    ['multiple duplicate candidates', V2, v2Config(config.expectedV2Block(1, '\n')
      .replace(config.CODEX_HELPER_CAPACITY_BEGIN, `${config.CODEX_HELPER_CAPACITY_BEGIN}\n${config.CODEX_HELPER_CAPACITY_BEGIN}`)
      .replace(config.CODEX_HELPER_CAPACITY_END, `${config.CODEX_HELPER_CAPACITY_END}\n${config.CODEX_HELPER_CAPACITY_END}`))],
    ['overlapping spans', V2, v2Config(config.expectedV2Block(1, '\n')
      .replace(`${config.CODEX_HELPER_CAPACITY_END}\n`, '')
      .replace(`${config.CODEX_ROOT_GUIDANCE_BEGIN}\n`, ''))],
    ['unknown marker in implied span', V2, v2Config(missingFinalV2End('# AI-AGENT-TOOLKIT:END CODEX-UNKNOWN-CATEGORY v1'))],
  ];
  for (const [label, runtime, original] of cases) {
    const { codexHome, filePath, root } = tempConfig(label);
    write(filePath, original);
    let editorCalled = false;
    let replacementCalled = false;
    const result = await config.configureCodexDelegation(filePath, {
      runtime,
      helperCount: 0,
      codexHome,
      allowUserOwnedReplacement: true,
      editor: async () => { editorCalled = true; throw new Error(`rejected state must not invoke editor: ${label}`); },
      beforeCommit: () => { replacementCalled = true; },
    });
    assert.equal(result.status, 'conflicting', `${label}: ${result.detail}`);
    assert.equal(editorCalled, false, label);
    assert.equal(replacementCalled, false, label);
    assert.deepEqual(fs.readFileSync(filePath), Buffer.from(original), label);
    assert.equal(fs.existsSync(path.join(root, '.ai-agent-toolkit')), false, label);
  }
});

test('incomplete exact PR 237 legacy material is repairable only inside one isolated V1 table', () => {
  const exact = config.expectedLegacyBlock(1, '\n').replace(config.CODEX_DELEGATION_END, '');
  const repairable = config.codexDelegationConfigState(Buffer.from(`[agents]\n${exact}\n`), 'synthetic/config.toml', V1);
  assert.equal(repairable.status, 'repair-required');
  assert.equal(repairable.repair.family, 'legacy');
  assert.equal(repairable.repair.remove_legacy_material, true);

  const interleaved = config.codexDelegationConfigState(Buffer.from(`[agents]\n${config.CODEX_DELEGATION_BEGIN}\nmax_threads = 1\n# user comment\nmax_depth = 1\n`), 'synthetic/config.toml', V1);
  assert.equal(interleaved.status, 'conflicting');
});

test('ambiguous malformed classes remain fail closed', () => {
  const cases = [
    ['legacy and current markers coexist', `[agents]\n${config.CODEX_DELEGATION_BEGIN}\nmax_threads = 1\nmax_depth = 1\n${config.CODEX_DELEGATION_END}\n\n[features.multi_agent_v2]\n${malformedV2('missing-end')}\n`],
    ['unsupported assignment inside markers', v2Config(malformedV2('missing-end').replace('max_concurrent_threads_per_session = 2', 'max_concurrent_threads_per_session = 2\nunsupported_setting = true'))],
    ['user comment interleaved', v2Config(malformedV2('missing-end').replace('max_concurrent_threads_per_session = 2', 'max_concurrent_threads_per_session = 2\n# user-owned comment'))],
    ['user assignment interleaved', v2Config(malformedV2('missing-end').replace('max_concurrent_threads_per_session = 2', 'max_concurrent_threads_per_session = 2\nuser_setting = "keep"'))],
    ['marker outside expected table', `[other]\n${config.CODEX_HELPER_CAPACITY_BEGIN}\n\n[features.multi_agent_v2]\n${unmarkedV2(1, '\n')}\n`],
    ['unknown marker', v2Config(malformedV2('missing-end').replace(config.CODEX_HELPER_CAPACITY_BEGIN, '# AI-AGENT-TOOLKIT:BEGIN CODEX-HELPER-CAPACITY v2'))],
    ['unknown marker family', v2Config(malformedV2('missing-end').replace(config.CODEX_HELPER_CAPACITY_BEGIN, '# AI-AGENT-TOOLKIT:BEGIN CODEX-UNRECOGNISED-LIMIT v1'))],
    ['unmarked guidance beside malformed capacity', v2Config(malformedV2('missing-end')
      .replace(`${config.CODEX_ROOT_GUIDANCE_BEGIN}\n`, '')
      .replace(`${config.CODEX_ROOT_GUIDANCE_END}\n`, '')
      .replace(`${config.CODEX_HELPER_GUIDANCE_BEGIN}\n`, '')
      .replace(`${config.CODEX_HELPER_GUIDANCE_END}`, ''))],
    ['unsupported child table', `${v2Config(malformedV2('missing-end'))}\n[features.multi_agent_v2.child]\nx = 1\n`],
    ['duplicate target table', `[features.multi_agent_v2]\n${malformedV2('missing-end')}\n[features.multi_agent_v2]\nx = 1\n`],
    ['dotted table shape', `[features]\nmulti_agent_v2.enabled = true\n${config.CODEX_HELPER_CAPACITY_BEGIN}\n`],
    ['inline table shape', `features = { multi_agent_v2 = { enabled = true } }\n${config.CODEX_HELPER_CAPACITY_BEGIN}\n`],
    ['explicit user-owned false enablement', v2Config(malformedV2('missing-end').replace('enabled = true', 'enabled = false'))],
  ];
  for (const [label, text] of cases) {
    const state = config.codexDelegationConfigState(Buffer.from(text), 'synthetic/config.toml', V2);
    assert.notEqual(state.status, 'repair-required', `${label}: ${state.detail}`);
    assert.ok(['conflicting', 'unsupported'].includes(state.status), `${label}: ${state.status}`);
  }
});

test('valid legacy migration and valid current ownership remain unchanged classifications', () => {
  const legacy = config.codexDelegationConfigState(Buffer.from(`[agents]\n${config.expectedLegacyBlock(1, '\n')}\n`), 'synthetic/config.toml', V2);
  assert.equal(legacy.status, 'migration-required');
  assert.equal(legacy.ownership, 'toolkit-managed-v1-legacy');
  const current = config.codexDelegationConfigState(Buffer.from(`[features.multi_agent_v2]\n${config.expectedV2Block(1, '\n')}\n`), 'synthetic/config.toml', V2);
  assert.equal(current.status, 'configured');
  assert.equal(current.ownership, 'toolkit-managed-v2');
});

test('approved repair supports root-only, one-helper, and custom outcomes with LF and CRLF byte preservation', async () => {
  for (const helperCount of [0, 1, 3]) {
    for (const eol of ['\n', '\r\n']) {
      const { codexHome, filePath } = tempConfig(`repair ${helperCount} ${eol.length}`);
      const original = v2Config(malformedV2('missing-end', eol), eol);
      write(filePath, original);
      const proposal = preview(filePath, codexHome, helperCount);
      assert.equal(proposal.status, 'preview', proposal.detail);
      assert.equal(proposal.requires_user_confirmation, true);
      assert.match(proposal.proposal_digest, /^[a-f0-9]{64}$/);
      assert.deepEqual(proposal.approval_binding.repair_identity.affected_ranges, proposal.repair.affected_ranges);
      const result = await config.configureCodexDelegation(filePath, {
        runtime: V2,
        helperCount,
        codexHome,
        allowUserOwnedReplacement: true,
        editor: v2Editor(),
        ...approved(proposal),
      });
      assert.equal(result.status, 'configured', result.detail);
      assert.equal(result.helper_count, helperCount);
      assert.equal(result.repaired_malformed_toolkit_material, true);
      const after = fs.readFileSync(filePath, 'utf8');
      assert.ok(after.startsWith(`title = "preserve"${eol}${eol}`));
      assert.ok(after.endsWith(`[unrelated]${eol}note = "byte exact"${eol}`));
      assert.equal(after.includes('\r\n'), eol === '\r\n');
      assert.ok(fs.existsSync(result.backup_metadata_path));

      const rerun = await config.configureCodexDelegation(filePath, { runtime: V2, helperCount, codexHome, editor: async () => { throw new Error('idempotent rerun must not edit'); } });
      assert.equal(rerun.changed, false);
      assert.equal(rerun.status, 'configured');
    }
  }
});

test('repair without an approval writes nothing and creates no backup', async () => {
  const { codexHome, filePath, root } = tempConfig('decline');
  const original = v2Config(malformedV2('missing-begin'));
  write(filePath, original);
  const result = await config.configureCodexDelegation(filePath, { runtime: V2, helperCount: 0, codexHome, editor: v2Editor() });
  assert.equal(result.status, 'approval-required');
  assert.equal(result.changed, false);
  assert.equal(fs.readFileSync(filePath, 'utf8'), original);
  assert.equal(fs.existsSync(path.join(root, '.ai-agent-toolkit')), false);
});

test('repair approval rejects affected-range, proposal, generation, runtime, helper-count, and byte drift before editor or backup', async () => {
  const variants = [
    ['range', (proposal) => ({ ...proposal.approval_binding, repair_identity: { ...proposal.approval_binding.repair_identity, affected_ranges: [] } }), V2, 0, null],
    ['implied-span', (proposal) => ({ ...proposal.approval_binding, repair_identity: { ...proposal.approval_binding.repair_identity, implied_category_spans: [] } }), V2, 0, null],
    ['proposal', (proposal) => ({ ...proposal.approval_binding, proposal_digest: '0'.repeat(64) }), V2, 0, null],
    ['generation', (proposal) => proposal.approval_binding, V2, 0, 'different-generation'],
    ['runtime', (proposal) => proposal.approval_binding, V1, 0, null],
    ['helper-count', (proposal) => proposal.approval_binding, V2, 1, null],
  ];
  for (const [label, bindingFor, runtime, helperCount, generation] of variants) {
    const { codexHome, filePath, root } = tempConfig(`drift ${label}`);
    const original = v2Config(malformedV2('duplicate-begin'));
    write(filePath, original);
    const proposal = preview(filePath, codexHome, 0);
    let editorCalled = false;
    const result = await config.configureCodexDelegation(filePath, {
      runtime,
      helperCount,
      codexHome,
      allowUserOwnedReplacement: true,
      approvedProposal: bindingFor(proposal),
      backupGenerationId: generation || proposal.backup_generation_id,
      editor: async () => { editorCalled = true; return v2Editor()({ originalBytes: Buffer.alloc(0), helperCount }); },
    });
    assert.ok(['approval-invalid', 'conflicting'].includes(result.status), `${label}: ${result.status}`);
    assert.equal(editorCalled, false);
    assert.equal(fs.readFileSync(filePath, 'utf8'), original);
    assert.equal(fs.existsSync(path.join(root, '.ai-agent-toolkit')), false);
  }

  const { codexHome, filePath, root } = tempConfig('drift bytes');
  write(filePath, v2Config(malformedV2('missing-end')));
  const proposal = preview(filePath, codexHome, 0);
  fs.appendFileSync(filePath, '# concurrent\n');
  let editorCalled = false;
  const result = await config.configureCodexDelegation(filePath, {
    runtime: V2, helperCount: 0, codexHome, allowUserOwnedReplacement: true,
    editor: async () => { editorCalled = true; return { bytes: Buffer.alloc(0) }; },
    ...approved(proposal),
  });
  assert.equal(result.status, 'approval-stale');
  assert.equal(editorCalled, false);
  assert.equal(fs.existsSync(path.join(root, '.ai-agent-toolkit')), false);
});

test('editor, backup, replacement, and final verification failures leave or restore exact original bytes', async () => {
  for (const failure of ['editor', 'backup', 'replacement', 'verification']) {
    const { codexHome, filePath, root } = tempConfig(`failure ${failure}`);
    const original = v2Config(malformedV2('missing-end'));
    write(filePath, original, 0o640);
    const proposal = preview(filePath, codexHome, 0);
    const options = {
      runtime: V2,
      helperCount: 0,
      codexHome,
      allowUserOwnedReplacement: true,
      editor: failure === 'editor' ? async () => { throw new Error('injected editor failure'); } : v2Editor(),
      ...approved(proposal),
    };
    if (failure === 'backup') {
      const blocker = path.join(root, 'backup-blocker');
      fs.writeFileSync(blocker, 'not a directory');
      options.backupRoot = blocker;
    }
    if (failure === 'replacement') options.beforeCommit = () => { throw new Error('injected replacement failure'); };
    if (failure === 'verification') options.afterReplace = () => { throw new Error('injected final verification failure'); };
    await assert.rejects(config.configureCodexDelegation(filePath, options), /injected|directory|EEXIST|ENOTDIR/i);
    assert.deepEqual(fs.readFileSync(filePath), Buffer.from(original));
  }
});

test('marker-only repair preserves compatible user-owned assignments and claims no ownership', async () => {
  const { codexHome, filePath } = tempConfig('marker only');
  const eol = '\r\n';
  const original = `[features.multi_agent_v2]${eol}${config.CODEX_HELPER_CAPACITY_END}${eol}${unmarkedV2(0, eol)}${eol}user_note = "preserve"${eol}`;
  write(filePath, original);
  const state = config.inspectCodexDelegationConfig(filePath, V2);
  assert.equal(state.status, 'repair-required', state.detail);
  assert.equal(state.repair.mode, 'markers-only-preserve-user-values');
  const proposal = preview(filePath, codexHome, 0);
  assert.equal(proposal.preserve_compatible_user_values, true);
  assert.equal(proposal.proposed_block, null);
  assert.deepEqual(proposal.affected_keys, []);
  const result = await config.configureCodexDelegation(filePath, {
    runtime: V2, helperCount: 0, codexHome, allowUserOwnedReplacement: true,
    editor: async () => { throw new Error('marker-only repair must not invoke editor'); },
    ...approved(proposal),
  });
  assert.equal(result.status, 'configured');
  assert.equal(result.ownership, 'user-owned-compatible-v2');
  assert.equal(result.preserved_compatible_user_values, true);
  const expected = original.replace(`${config.CODEX_HELPER_CAPACITY_END}${eol}`, '');
  assert.equal(fs.readFileSync(filePath, 'utf8'), expected);
  assert.doesNotMatch(expected, /AI-AGENT-TOOLKIT/);
});
