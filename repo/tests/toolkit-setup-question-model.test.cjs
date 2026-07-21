'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../scripts/setup-toolkit-core.cjs');
const setupQuestionDocs = require('../scripts/generate-setup-question-docs.cjs');

const repoRoot = path.resolve(__dirname, '..', '..');
const expectedCodexRows = [
  ['update-source', 'Update source'],
  ['automatic-updates', 'Automatic updates'],
  ['update-reports', 'Update reports'],
  ['report-retention', 'Report retention'],
  ['codex-toolkit-maintenance', 'Codex Toolkit maintenance'],
  ['opencode-integration', 'OpenCode'],
  ['antigravity-integration', 'Antigravity'],
];

function assertGeneratedDocumentationEqual(actual, expected) {
  assert.equal(
    setupQuestionDocs.normalizeTextForComparison(actual),
    setupQuestionDocs.normalizeTextForComparison(expected),
  );
}

function allRows() {
  return core.setupQuestionDocumentationSpecs();
}

function managedState(overrides = {}) {
  const standardPath = path.resolve(repoRoot, '..', 'tk013-standard-source');
  const customPath = path.resolve(repoRoot, '..', 'tk013-custom-source');
  return {
    currentPath: customPath,
    selectedPath: customPath,
    defaultPath: standardPath,
    exists: true,
    git: true,
    dirty: false,
    branch: core.DEFAULT_REPO_BRANCH,
    remote: core.DEFAULT_REPO_REMOTE,
    ...overrides,
  };
}

function stateWithManaged(managed) {
  return {
    managed,
    audit: { repo_auto_update: {}, targets: {} },
    runtime: { runtime: 'unknown' },
    delegation: { status: 'unsupported', helper_count: null },
    nativePlugin: { status: 'unknown' },
  };
}

function updateSourceRow(managed, argv = ['--plan', '--host', 'codex']) {
  const args = core.parseArgs(argv);
  return core.setupQuestionSpecs(args, stateWithManaged(managed)).find((row) => row.id === 'update-source');
}

async function runInjectedTTY(responses, configure = () => {}) {
  const args = core.parseArgs(['--execute', '--host', 'codex']);
  const current = stateWithManaged(managedState());
  current.audit.update_report_enabled = true;
  current.audit.update_report_retention_days = 7;
  current.audit.codex_plugin_auto_refresh_enabled = false;
  configure({ args, current });
  const prompts = [];
  let bank = '';
  const answers = [...responses];
  const result = await core.answerSetupQuestionBank(args, current, {
    isTTY: true,
    write(text) { bank += text; return true; },
    createReadlineInterface() {
      return {
        async question(prompt) {
          prompts.push(prompt);
          if (!answers.length) throw new Error(`TTY fixture exhausted at prompt: ${prompt}`);
          return answers.shift();
        },
        close() {},
      };
    },
  });
  return { args, current, prompts, bank, result, remaining: answers };
}

test('all ordinary Codex questions expose complete canonical semantics', () => {
  const rows = allRows();
  assert.deepEqual(rows.map((row) => [row.id, row.title]), expectedCodexRows);
  for (const row of rows) {
    assert.ok(row.whatThisControls.trim(), `${row.id} controls`);
    assert.ok(row.currentState.effectiveBehavior.trim(), `${row.id} current`);
    assert.equal(row.currentState.effectiveBehavior, row.current);
    assert.ok(row.recommendation.outcome.trim(), `${row.id} recommendation`);
    assert.ok(row.recommendation.reason.trim(), `${row.id} reason`);
    assert.equal(row.recommendation.value, row.recommended);
    assert.ok(row.afterApplying.trim(), `${row.id} after applying`);
    assert.ok(row.privacySafeFallback.trim(), `${row.id} privacy fallback`);
    assert.ok(row.availability.status, `${row.id} availability`);
    assert.ok(row.choices.some((choice) => choice.value === row.recommendation.value), `${row.id} recommendation available`);
    for (const choice of row.choices) assert.ok(choice.consequence.trim(), `${row.id}/${choice.value} consequence`);
    const keep = row.choices.find((choice) => choice.value === 'keep');
    if (keep) assert.match(keep.consequence, new RegExp(row.current.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('terminal, piped, plan, JSON, approval and generated docs share canonical row metadata', () => {
  const rows = allRows();
  const markdown = core.renderSetupQuestionBank(rows);
  const terminal = core.renderSetupQuestionBankTerminal(rows);
  const generated = core.renderSetupQuestionDocumentation(rows);
  const generatedFile = fs.readFileSync(path.join(repoRoot, 'repo/docs/SETUP-QUESTIONS.generated.md'), 'utf8');
  assertGeneratedDocumentationEqual(generatedFile, core.renderSetupQuestionDocumentation());
  for (const row of rows) {
    for (const output of [markdown, terminal, generated]) {
      assert.match(output, new RegExp(row.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.ok(output.includes(row.whatThisControls));
      assert.ok(output.includes(row.recommendation.reason));
      for (const choice of row.choices) assert.ok(output.includes(choice.consequence));
    }
  }
  assert.match(markdown, /\*\*What this controls:\*\*[\s\S]*\*\*Current:\*\*[\s\S]*\*\*Recommended:\*\*[\s\S]*\*\*Why:\*\*[\s\S]*\*\*Choices:\*\*[\s\S]*\*\*After applying:\*\*/);
  assert.match(terminal, /What this controls:[\s\S]*\n\nCurrent:[\s\S]*\n\nVerification:[\s\S]*\n\nRecommended:[\s\S]*\n\nWhy:[\s\S]*\n\nChoices:\n  A\. /);
  const plan = core.setupPlan({ host: 'codex', setupChoices: core.parseArgs(['--plan']).setupChoices, questionBank: rows });
  assert.deepEqual(plan.question_bank, rows);
  const json = JSON.parse(JSON.stringify(plan));
  assert.equal(json.question_bank[0].whatThisControls, rows[0].whatThisControls);
  assert.equal(json.question_bank[0].choices[0].consequence, rows[0].choices[0].consequence);
  assert.doesNotMatch(JSON.stringify(json.question_bank), /setup-toolkit-question-bank:begin|\*\*Current:\*\*/);
});

test('generated document consistency treats only CRLF and LF as equivalent', () => {
  const expected = core.renderSetupQuestionDocumentation();
  const crlf = expected.replace(/\n/g, '\r\n');
  assert.doesNotThrow(() => assertGeneratedDocumentationEqual(expected, expected));
  assert.doesNotThrow(() => assertGeneratedDocumentationEqual(crlf, expected));

  const firstLineFeed = expected.indexOf('\n');
  assert.ok(firstLineFeed >= 0);
  const loneCarriageReturn = `${expected.slice(0, firstLineFeed)}\r${expected.slice(firstLineFeed + 1)}`;
  for (const drifted of [
    `${expected}\nUnexpected drift.\n`,
    expected.slice(0, -20),
    loneCarriageReturn,
  ]) {
    assert.throws(() => assertGeneratedDocumentationEqual(drifted, expected));
  }
});

test('headings, choice effects and native mutation surfaces remain distinct', () => {
  const byId = Object.fromEntries(allRows().map((row) => [row.id, row]));
  assert.equal(byId['update-source'].title, 'Update source');
  assert.equal(byId['automatic-updates'].title, 'Automatic updates');
  assert.notEqual(byId['update-source'].title, byId['automatic-updates'].title);
  assert.match(byId['update-source'].choices.find((choice) => choice.value === 'custom').consequence, /not migrated or deleted/i);
  assert.match(byId['automatic-updates'].choices.find((choice) => choice.value === 'disable').consequence, /manual `setup toolkit`/i);
  assert.match(byId['update-reports'].whatThisControls, /private absolute paths/i);
  assert.match(byId['report-retention'].whatThisControls, /does not modify project files, application logs, or unrelated operational logs/i);
  assert.equal(byId['codex-helper-agents'], undefined);
  assert.match(byId['codex-toolkit-maintenance'].choices.find((choice) => choice.value === 'disable').consequence, /not uninstalled/i);
  assert.match(byId['opencode-integration'].afterApplying, /skill folders/i);
  assert.match(byId['antigravity-integration'].afterApplying, /plugin metadata and skill folders/i);
  assert.notEqual(byId['opencode-integration'].whatThisControls, byId['antigravity-integration'].whatThisControls);
});

test('legacy migration stays advanced while ordinary setup and authoritative guidance omit helper capacity', () => {
  const args = core.parseArgs(['--plan', '--host', 'codex']);
  const current = stateWithManaged(managedState());
  current.runtime = { runtime: 'multi-agent-v2' };
  current.delegation = { status: 'migration-required', helper_count: 1 };
  const rows = core.setupQuestionSpecs(args, current);
  assert.equal(rows.some((row) => row.id === 'codex-helper-agents'), false);
  assert.equal(args.setupChoices.codexHelperCapacity, 'keep');
  const rendered = `${core.renderSetupQuestionBank(rows)}\n${core.renderSetupQuestionBankTerminal(rows)}`;
  assert.doesNotMatch(rendered, /\bmigrate\b|PR #237|helper-agent quantit/i);

  const skill = fs.readFileSync(path.join(repoRoot, '_projects/development/toolkit-local-bridge/curated_output_for_ai/skills/toolkit-setup/SKILL.md'), 'utf8');
  assert.doesNotMatch(skill, /exception is a visible `migrate` choice/i);
  assert.match(skill, /advanced compatibility\/repair operation/i);
  assert.match(skill, /ordinary setup preserves that state without adding a helper-capacity row/i);
});

test('unknown and unsupported state is honest and never recommends unavailable choices', () => {
  const args = core.parseArgs(['--plan', '--host', 'codex']);
  const current = {
    managed: { currentPath: 'C:\\Synthetic Private\\missing', selectedPath: '', defaultPath: 'C:\\Elsewhere', exists: false, git: false, dirty: false, branch: '', remote: '' },
    audit: { repo_auto_update: {}, targets: { opencode: { detected: true }, ag2: { detected: true } } },
    runtime: { runtime: 'unknown' },
    delegation: { status: 'unsupported', helper_count: null },
    nativePlugin: { status: 'unknown' },
  };
  const rows = core.setupQuestionSpecs(args, current);
  for (const row of rows) assert.ok(row.choices.some((choice) => choice.value === row.recommended));
  assert.equal(rows.some((row) => row.id === 'codex-helper-agents'), false);
  assert.equal(args.setupChoices.codexHelperCapacity, 'keep');
  const output = `${core.renderSetupQuestionBank(rows)}\n${JSON.stringify(rows)}`;
  assert.doesNotMatch(output, /Synthetic Private|C:\\|USERPROFILE|CODEX_HOME|GH_TOKEN|GITHUB_TOKEN/);
});

test('representative recommendations are all selectable and deterministic', () => {
  const first = allRows();
  const second = allRows();
  assert.deepEqual(second, first);
  for (const row of first) assert.ok(row.choices.map((choice) => choice.value).includes(row.recommended));
});

test('Update source keep availability uses one verified preservation predicate', () => {
  const unsafePath = path.join(repoRoot, '.tmp', 'managed-source');
  const invalidStates = [
    ['no configured source', managedState({ currentPath: '', selectedPath: path.resolve(repoRoot, '..', 'fallback-only') }), /No Toolkit update source is configured/i],
    ['missing source', managedState({ exists: false, git: false }), /cannot be found/i],
    ['non-Git source', managedState({ git: false }), /not a verified Toolkit Git checkout/i],
    ['dirty source', managedState({ dirty: true }), /local changes/i],
    ['wrong branch', managedState({ branch: 'review-branch' }), /different branch/i],
    ['wrong remote', managedState({ remote: 'https://example.invalid/private/repo' }), /unexpected remote/i],
    ['unsafe source', managedState({ currentPath: unsafePath, selectedPath: unsafePath }), /cannot safely preserve/i],
  ];

  for (const [label, managed, currentPattern] of invalidStates) {
    const row = updateSourceRow(managed);
    assert.deepEqual(row.choices.map((choice) => choice.value), ['default', 'custom'], label);
    assert.equal(row.recommended, 'default', label);
    assert.ok(row.choices.some((choice) => choice.value === row.recommended), label);
    assert.match(row.current, currentPattern, label);
    const output = `${core.renderSetupQuestionBank([row])}\n${core.renderSetupQuestionBankTerminal([row])}\n${JSON.stringify(row)}`;
    assert.doesNotMatch(output, /Keep the current update source/i, label);
    assert.doesNotMatch(output, /example\.invalid|tk013-|\.tmp[\\/]managed-source/i, label);
  }

  const standardPath = path.resolve(repoRoot, '..', 'tk013-standard-source');
  const standard = managedState({ currentPath: standardPath, selectedPath: standardPath, defaultPath: standardPath });
  const standardRow = updateSourceRow(standard);
  assert.equal(core.canPreserveManagedCheckout(stateWithManaged(standard), core.parseArgs(['--plan'])), true);
  assert.deepEqual(standardRow.choices.map((choice) => choice.value), ['default', 'keep', 'custom']);
  assert.equal(standardRow.recommended, 'keep');

  const custom = managedState();
  const customRow = updateSourceRow(custom);
  assert.equal(core.canPreserveManagedCheckout(stateWithManaged(custom), core.parseArgs(['--plan'])), true);
  assert.deepEqual(customRow.choices.map((choice) => choice.value), ['default', 'keep', 'custom']);
  assert.equal(customRow.recommended, 'default');
  assert.match(customRow.choices.find((choice) => choice.value === 'keep').consequence, /separate clean custom checkout/i);

});

test('Update source renderers and generated documentation use corrected canonical choices', () => {
  const args = core.parseArgs(['--plan', '--host', 'codex']);
  const current = stateWithManaged(managedState({ currentPath: '', exists: false, git: false }));
  const planned = core.plannedQuestionBank(args, current);
  const row = planned.specs.find((spec) => spec.id === 'update-source');
  const plan = core.setupPlan({ ...planned.args, questionBank: planned.specs });
  const markdown = core.renderSetupQuestionBank(planned.specs);
  const terminal = core.renderSetupQuestionBankTerminal(planned.specs);
  assert.deepEqual(row.choices.map((choice) => choice.value), ['default', 'custom']);
  assert.equal(plan.question_bank.find((spec) => spec.id === 'update-source').choices.length, 2);
  assert.doesNotMatch(`${markdown}\n${terminal}\n${JSON.stringify(plan.question_bank)}`, /Keep the current update source/i);
  assert.throws(
    () => core.plannedQuestionBank(core.parseArgs(['--plan', '--managed-checkout', 'keep']), current),
    /Update source must be one of: default, custom/i,
  );

  const generatedRow = core.setupQuestionDocumentationSpecs().find((spec) => spec.id === 'update-source');
  assert.equal(core.canPreserveManagedCheckout({ managed: {
    currentPath: core.defaultManagedSourcePath(),
    defaultPath: core.defaultManagedSourcePath(),
    exists: true,
    git: true,
    dirty: false,
    branch: core.DEFAULT_REPO_BRANCH,
    remote: core.DEFAULT_REPO_REMOTE,
  } }, core.parseArgs(['--plan'])), true);
  assert.ok(generatedRow.choices.some((choice) => choice.value === 'keep'));
  assertGeneratedDocumentationEqual(
    fs.readFileSync(path.join(repoRoot, 'repo/docs/SETUP-QUESTIONS.generated.md'), 'utf8'),
    core.renderSetupQuestionDocumentation(),
  );
});

test('resolved Codex and Claude banks expose contiguous deterministic presentation metadata', () => {
  const codexArgs = core.parseArgs(['--plan', '--host', 'codex']);
  const codexCurrent = stateWithManaged(managedState({ currentPath: '', exists: false, git: false }));
  codexCurrent.audit.codex_plugin_auto_refresh_enabled = false;
  const codex = core.setupQuestionSpecs(codexArgs, codexCurrent);
  assert.equal(codex[0].presentation.total_visible_question_count, 5);
  assert.equal(codex[0].presentation.total_visible_section_count, 2);
  assert.deepEqual(codex.map((row) => row.presentation.question_ref), ['1.1', '1.2', '1.3', '1.4', '2.1']);

  const claudeArgs = core.parseArgs(['--plan', '--host', 'claude-code']);
  const claudeCurrent = stateWithManaged(managedState({ currentPath: '', exists: false, git: false }));
  claudeCurrent.agentCapability = { launch_supported: false, resource_counter_supported: false };
  claudeCurrent.agentProfile = { supported: false, topology: 'root-only' };
  claudeCurrent.nativePlugin = { status: 'unknown', trusted: false, hook_active: false };
  const claude = core.setupQuestionSpecs(claudeArgs, claudeCurrent);
  assert.equal(claude[0].presentation.total_visible_question_count, 6);
  assert.equal(claude[0].presentation.total_visible_section_count, 3);
  assert.deepEqual(claude.map((row) => row.presentation.question_ref), ['1.1', '1.2', '1.3', '1.4', '2.1', '3.1']);
});

test('quick index, detailed bank, recommendations, and choices share one indexed ordering', () => {
  const rows = allRows();
  const rendered = core.renderSetupQuestionBank(rows);
  const quickIndex = rendered.slice(rendered.indexOf('Quick index'), rendered.indexOf('Review every visible choice'));
  const references = rows.map((row) => row.presentation.question_ref);
  assert.equal(new Set(references).size, rows.length);
  let previousIndex = -1;
  for (const row of rows) {
    const quickLine = `${row.presentation.question_ref} ${row.title} - Recommended: ${row.presentation.recommended_choice_ref}`;
    const quickPosition = quickIndex.indexOf(quickLine);
    assert.ok(quickPosition > previousIndex, row.id);
    previousIndex = quickPosition;
    assert.match(rendered, new RegExp(`### ${row.presentation.question_ref.replace('.', '\\.')} ${row.title}`));
    assert.equal(new Set(row.choices.map((choice) => choice.presentation_ref)).size, row.choices.length);
    assert.equal(
      row.choices.find((choice) => choice.value === row.recommended).presentation_ref,
      row.presentation.recommended_choice_ref,
    );
  }
  assert.doesNotMatch(rendered, /## \d+\. Automatic updates\s+### \d+\.\d+ Automatic updates/);
});

test('conditional questions renumber without gaps and change the bound bank identity', () => {
  const withTargets = allRows();
  const withoutTargets = withTargets.filter((row) => !['opencode-integration', 'antigravity-integration'].includes(row.id));
  const renumbered = core.withPresentationMetadata(withoutTargets.map((row) => ({ ...row, presentation: undefined })));
  assert.deepEqual(renumbered.map((row) => row.presentation.question_ref), ['1.1', '1.2', '1.3', '1.4', '2.1']);
  assert.notEqual(renumbered[0].presentation.bank_identity, withTargets[0].presentation.bank_identity);
});

test('spreadsheet-style choice references are bounded and never wrap', () => {
  assert.equal(core.spreadsheetChoiceReference(1), 'A');
  assert.equal(core.spreadsheetChoiceReference(26), 'Z');
  assert.equal(core.spreadsheetChoiceReference(27), 'AA');
  assert.equal(core.spreadsheetChoiceReference(52), 'AZ');
  assert.equal(core.spreadsheetChoiceReference(702), 'ZZ');
  assert.throws(() => core.spreadsheetChoiceReference(703), /A-ZZ/);
});

test('all recommended and changed-only answers resolve to canonical values', () => {
  const rows = allRows();
  const reference = rows[0].presentation.bank_reference;
  const all = core.parseConciseQuestionBankAnswer(`  ${reference.toLowerCase()}: ALL recommended  `, rows);
  assert.equal(all.mode, 'all-recommended');
  assert.deepEqual(all.selections.map((selection) => selection.canonical_value), rows.map((row) => row.recommended));
  core.assertQuestionBankAnswerBinding(all, rows);

  const changed = core.parseConciseQuestionBankAnswer(`${reference}: 1.2=b, 3.1 = d`, rows);
  assert.equal(changed.mode, 'recommended-except');
  assert.equal(changed.selections.find((selection) => selection.question_ref === '1.2').canonical_value, 'disable');
  assert.equal(changed.selections.find((selection) => selection.question_ref === '3.1').canonical_value, 'skip');
  assert.equal(changed.selections.find((selection) => selection.question_ref === '1.1').canonical_value, rows[0].recommended);
  core.assertQuestionBankAnswerBinding(changed, rows);
});

test('indexed answer parser rejects duplicates, unknowns, malformed modes, and stale banks', () => {
  const rows = allRows();
  const reference = rows[0].presentation.bank_reference;
  assert.equal(core.parseConciseQuestionBankAnswer('', rows), null);
  assert.equal(core.parseConciseQuestionBankAnswer('enable\ndisable', rows), null);
  assert.equal(core.parseConciseQuestionBankAnswer('C:\\Toolkit path with spaces', rows), null);
  assert.throws(() => core.parseConciseQuestionBankAnswer('1.2=B', rows), /require the displayed bank reference/);
  assert.throws(() => core.parseConciseQuestionBankAnswer(`BAD: all recommended`, rows), /malformed or truncated/);
  assert.throws(() => core.parseConciseQuestionBankAnswer(`0000-0000-0000-0000: all recommended`, rows), /stale or belongs/);
  assert.throws(() => core.parseConciseQuestionBankAnswer(`${reference}: 1.2=B, 1.2=C`, rows), /repeats question reference/);
  assert.throws(() => core.parseConciseQuestionBankAnswer(`${reference}: 9.9=A`, rows), /unavailable question/);
  assert.throws(() => core.parseConciseQuestionBankAnswer(`${reference}: 1.2=Z`, rows), /unavailable choice/);
  assert.throws(() => core.parseConciseQuestionBankAnswer(`${reference}: 1.2=B; 3.1=D`, rows), /malformed separators/);
  assert.throws(() => core.parseConciseQuestionBankAnswer(`${reference}: all recommended, 1.2=B`, rows), /mixes or malforms/);

  const parsed = core.parseConciseQuestionBankAnswer(`${reference}: 1.2=B`, rows);
  const changedBank = core.withPresentationMetadata(rows.slice(0, -1).map((row) => ({ ...row, presentation: undefined })));
  assert.throws(() => core.assertQuestionBankAnswerBinding(parsed, changedBank), /exact rendered bank/);
});

test('bank reference covers host, order, recommendations and approval-visible semantics', () => {
  const rows = allRows();
  const reference = rows[0].presentation.bank_reference;
  assert.match(reference, /^[0-9A-HJKMNP-TV-Z]{4}(?:-[0-9A-HJKMNP-TV-Z]{4}){3}$/);
  assert.doesNotMatch(reference, /[\\/:]|secret|user|home/i);

  const payload = core.questionBankApprovalPayload(rows);
  assert.equal(payload.schema, 'ai-agent-toolkit.setup-question-bank-approval.v2');
  assert.equal(payload.host, 'codex');
  assert.deepEqual(payload.sections.map((section) => section.title), ['Updates and reports', 'Computer performance', 'Other coding apps']);
  assert.ok(payload.questions.every((question) => question.what_this_controls));
  assert.ok(payload.questions.every((question) => question.recommendation.choice_ref && question.recommendation.label));

  const changedHost = core.withPresentationMetadata(rows, 'claude-code');
  const changedRecommendation = core.withPresentationMetadata(rows.map((row, index) => index === 0
    ? { ...row, recommended: row.choices.find((choice) => choice.value !== row.recommended).value }
    : row), 'codex');
  const reordered = core.withPresentationMetadata([rows[1], rows[0], ...rows.slice(2)], 'codex');
  const mutateFirst = (change) => core.withPresentationMetadata(rows.map((row, index) => index === 0
    ? change({ ...row, presentation: undefined, currentState: { ...row.currentState }, choices: row.choices.map((choice) => ({ ...choice })) })
    : { ...row, presentation: undefined }), 'codex');
  const approvalVisibleMutations = [
    mutateFirst((row) => ({ ...row, whatThisControls: `${row.whatThisControls} Changed displayed scope.` })),
    mutateFirst((row) => ({ ...row, title: `${row.title} changed` })),
    mutateFirst((row) => ({ ...row, current: `${row.current} Changed displayed state.` })),
    mutateFirst((row) => ({ ...row, currentState: { ...row.currentState, verification: 'changed-verification' } })),
    mutateFirst((row) => ({ ...row, recommendation_reason: `${row.recommendation_reason} Changed reason.` })),
    mutateFirst((row) => ({ ...row, recommended_outcome: `${row.recommended_outcome} Changed outcome.` })),
    mutateFirst((row) => ({ ...row, choices: row.choices.map((choice, index) => index === 0 ? { ...choice, label: `${choice.label} changed` } : choice) })),
    mutateFirst((row) => ({ ...row, choices: row.choices.map((choice, index) => index === 0 ? { ...choice, consequence: `${choice.consequence} Changed consequence.` } : choice) })),
    mutateFirst((row) => ({ ...row, afterApplying: `${row.afterApplying} Changed effect.` })),
    mutateFirst((row) => ({ ...row, availability: { ...row.availability, condition: `${row.availability.condition} Changed condition.` } })),
    mutateFirst((row) => ({ ...row, selected: row.choices.find((choice) => choice.value !== (row.selected || '')).value })),
  ];
  for (const changed of [changedHost, changedRecommendation, reordered, ...approvalVisibleMutations]) {
    assert.notEqual(changed[0].presentation.bank_reference, reference);
    assert.throws(
      () => core.parseConciseQuestionBankAnswer(`${reference}: all recommended`, changed),
      /stale or belongs/,
    );
  }

  const identical = core.withPresentationMetadata(rows.map((row) => ({ ...row, presentation: undefined })), 'codex');
  assert.equal(identical[0].presentation.bank_identity, rows[0].presentation.bank_identity);
  assert.equal(identical[0].presentation.bank_reference, reference);
});

test('display letters and canonical textual values resolve without becoming stored identities', () => {
  const automatic = allRows().find((row) => row.id === 'automatic-updates');
  assert.equal(core.resolveDisplayedChoiceAnswer(automatic, 'b'), 'disable');
  assert.equal(core.resolveDisplayedChoiceAnswer(automatic, 'DISABLE'), 'disable');
  assert.equal(core.resolveDisplayedChoiceAnswer(automatic, ''), automatic.recommended);
});

test('TTY all recommended and changed-only commands execute after exactly one complete bank', async () => {
  const all = await runInjectedTTY(['all recommended']);
  assert.equal(all.result.answer_source, 'interactive all recommended');
  assert.equal((all.bank.match(/setup-toolkit-question-bank:begin/g) || []).length, 1);
  assert.equal((all.bank.match(/setup-toolkit-question-bank:complete/g) || []).length, 1);
  assert.match(all.bank, /enter either:[\s\S]*all recommended[\s\S]*press Enter to answer questions one at a time/i);

  const specs = core.setupQuestionSpecs(core.parseArgs(['--execute', '--host', 'codex']), stateWithManaged(managedState()));
  const automatic = specs.find((row) => row.id === 'automatic-updates');
  const off = automatic.choices.find((choice) => choice.value === 'disable');
  const changed = await runInjectedTTY([`${automatic.presentation.question_ref}=${off.presentation_ref}`]);
  assert.equal(changed.result.answer_source, 'interactive recommended except listed changes');
  assert.equal(changed.args.setupChoices.repoAutoUpdate, 'disable');
});

test('TTY blank enters one-at-a-time mode and invalid answers are re-prompted', async () => {
  const journey = await runInjectedTTY(['', 'Z', 'A', 'disable', 'enable', 'default', 'enable']);
  assert.equal(journey.result.answer_source, 'interactive');
  assert.match(journey.prompts[0], /all recommended/);
  assert.match(journey.prompts[1], /1\.1 Update source/);
  assert.match(journey.prompts[2], /1\.1 Update source/);
  assert.match(journey.prompts[3], /1\.2 Automatic updates/);
  assert.equal(journey.args.setupChoices.managedCheckout, 'default');
  assert.equal(journey.args.setupChoices.repoAutoUpdate, 'disable');
  assert.equal(journey.remaining.length, 0);
});

test('TTY malformed concise input can be corrected and secondary details are collected', async () => {
  const corrected = await runInjectedTTY(['1.2=B, 1.2=C', '9.9=A', '1.2=B; 2.1=A', '1.2=B']);
  assert.equal(corrected.args.setupChoices.repoAutoUpdate, 'disable');
  assert.equal(corrected.prompts.filter((prompt) => /all recommended/.test(prompt)).length, 4);

  const rows = core.setupQuestionSpecs(core.parseArgs(['--execute', '--host', 'codex']), stateWithManaged(managedState()));
  const updateSource = rows.find((row) => row.id === 'update-source');
  const customSource = updateSource.choices.find((choice) => choice.value === 'custom');
  const customPath = path.resolve(repoRoot, '..', 'tty-approved-custom-source');
  const sourceJourney = await runInjectedTTY([
    `${updateSource.presentation.question_ref}=${customSource.presentation_ref}`,
    customPath,
  ]);
  assert.equal(sourceJourney.args.repoRoot, customPath);

  const retention = rows.find((row) => row.id === 'report-retention');
  const customRetention = retention.choices.find((choice) => choice.value === 'custom');
  const retentionJourney = await runInjectedTTY([
    `${retention.presentation.question_ref}=${customRetention.presentation_ref}`,
    '14',
  ]);
  assert.equal(retentionJourney.args.updateReportRetentionDays, 14);
  assert.equal(retentionJourney.args.updateReportRetentionDaysExplicit, true);
});
