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
  assert.match(terminal, /What this controls:[\s\S]*\n\nCurrent:[\s\S]*\n\nRecommended:[\s\S]*\n\nWhy:[\s\S]*\n\nChoices:\n  - /);
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
