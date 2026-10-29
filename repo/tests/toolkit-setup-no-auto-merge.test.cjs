'use strict';

// Rule-refresh pull requests always stop for the owner to merge. No setup question, default,
// "all recommended" answer or flag may turn on any automatic merge.
const assert = require('node:assert/strict');
const test = require('node:test');
const core = require('../scripts/setup-toolkit-core.cjs');

const MERGE = /merge/i;

function bankFor(host, extra = []) {
  const current = {
    ...core.documentationFixtureState(),
    ...(host === 'claude-code' ? { agentProfile: { supported: true, topology: 'root-only' }, claudeSubagentDepth: { state: 'default' }, claudeSettings: [] } : {}),
  };
  return core.plannedQuestionBank(core.parseArgs(['--plan', '--host', host, '--yes-recommended', ...extra]), current);
}

for (const host of ['codex', 'claude-code']) {
  test(`${host}: no question, choice or recommendation is about merging`, () => {
    const { specs } = bankFor(host);
    for (const spec of specs) {
      const text = [spec.id, spec.key, spec.title, spec.whatThisControls, spec.recommended_outcome, spec.recommendation_reason,
        ...spec.choices.flatMap((choice) => [choice.value, choice.label, choice.consequence])].join('\n');
      assert.doesNotMatch(text, /auto-?merge|merge the (?:refresh )?pull request/i, spec.id);
    }
  });

  for (const extra of [[], ['--auto-main'], ['--profile', 'auto-main']]) test(`${host} ${extra.join(' ') || '(no profile)'}: "all recommended" leaves no merge setting on`, () => {
    const { args } = bankFor(host, extra);
    for (const [key, value] of Object.entries(args.setupChoices)) assert.equal(MERGE.test(key), false, key);
    for (const [key, value] of Object.entries(args)) {
      if (MERGE.test(key)) assert.notEqual(value, true, key);
    }
    const plan = JSON.stringify(core.setupPlan({ ...args, questionBank: [] }));
    assert.doesNotMatch(plan, /auto-?merge.{0,40}(?:true|enable)/i);
  });
}

test('the old auto-merge flags are rejected', () => {
  for (const flag of ['--enable-refresh-pr-auto-merge', '--disable-refresh-pr-auto-merge', '--keep-refresh-pr-auto-merge', '--refresh-pr-auto-merge']) {
    assert.throws(() => core.parseArgs([flag]), /Unknown|Unsupported/i, flag);
  }
});

test('no script, skill or plugin hook runs a pull request merge', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const root = path.resolve(__dirname, '..', '..');
  const hits = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(full); continue; }
      if (!/\.(?:cjs|js|mjs|ps1|sh|cmd|json|md)$/.test(entry.name)) continue;
      // The attribution guard names gh pr merge only to check its message for AI attribution.
      if (entry.name === 'toolkit-attribution-guard.cjs') continue;
      // The merge hold names merge commands only to refuse them, and must never run one itself: it
      // loads only these modules and starts no process and makes no network call.
      if (path.relative(root, full).split(path.sep).join('/') === 'repo/scripts/toolkit-merge-hold.cjs') {
        const source = fs.readFileSync(full, 'utf8');
        const loads = [...source.matchAll(/\brequire\s*\(([^)]*)\)/g)].map((match) => match[1].trim());
        assert.deepEqual(loads.sort(), ["'./toolkit-governance-gate.cjs'", "'./toolkit-governance-state.cjs'", "'./toolkit-shell-call.cjs'", "'node:crypto'", "'node:fs'", "'node:path'"]);
        assert.doesNotMatch(source, /\bimport\s*\(|child_process|(?<![.\w])(?:spawn|exec|execFile|fork)(?:Sync)?\s*\(|\bfetch\s*\(|node:https?\b|node:net\b/);
        // The shell-call reader it loads only reads its input.
        const reader = fs.readFileSync(path.join(root, 'repo', 'scripts', 'toolkit-shell-call.cjs'), 'utf8');
        assert.deepEqual([...reader.matchAll(/\brequire\s*\(([^)]*)\)/g)].map((match) => match[1].trim()), ["'node:os'", "'node:path'"]);
        assert.doesNotMatch(reader, /\bimport\s*\(|child_process|(?<![.\w])(?:spawn|exec|execFile|fork)(?:Sync)?\s*\(|\bfetch\s*\(|node:https?\b|node:net\b/);
        continue;
      }
      const text = fs.readFileSync(full, 'utf8');
      if (/gh\s+pr\s+merge|enablePullRequestAutoMerge|merge\s+--auto\b|--auto-merge\b/i.test(text)) hits.push(path.relative(root, full));
    }
  };
  for (const dir of ['repo/scripts', 'skills', '.claude-plugin', '.codex-plugin']) walk(path.join(root, dir));
  assert.deepEqual(hits, []);
});
