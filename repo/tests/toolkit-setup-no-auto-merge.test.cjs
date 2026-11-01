'use strict';

// Rule-refresh pull requests always stop for the owner to merge. No setup question, default,
// "all recommended" answer or flag may authorise a rule-refresh merge.
const assert = require('node:assert/strict');
const test = require('node:test');
const core = require('../scripts/setup-toolkit-core.cjs');


function bankFor(host, extra = []) {
  const current = {
    ...core.documentationFixtureState(),
    ...(host === 'claude-code' ? { agentProfile: { supported: true, topology: 'root-only' }, claudeSubagentDepth: { state: 'default' }, claudeSettings: [] } : {}),
  };
  return core.plannedQuestionBank(core.parseArgs(['--plan', '--host', host, '--yes-recommended', ...extra]), current);
}

for (const host of ['codex', 'claude-code']) {
  test(`${host}: only the task merge question is offered; refresh merging stays owner-only`, () => {
    const { specs, args } = bankFor(host);
    const rows = specs.filter(spec => /auto-?merge/i.test(spec.id));
    assert.deepEqual(rows.map(row => row.id), ['task-auto-merge']);
    assert.equal(args.setupChoices.taskAutoMerge, 'after-gates');
    assert.match(rows[0].afterApplying, /Rule-refresh.*typed merge/);
    assert.doesNotMatch(JSON.stringify(args), /refreshPrAutoMerge/);
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
        assert.deepEqual(loads.sort(), ["'./toolkit-auto-merge-eligible.cjs'", "'./toolkit-governance-gate.cjs'", "'./toolkit-governance-state.cjs'", "'./toolkit-projects-delivery.cjs'", "'./toolkit-shell-call.cjs'", "'node:crypto'", "'node:fs'", "'node:path'"]);
        assert.doesNotMatch(source, /\bimport\s*\(|child_process|(?<![.\w])(?:spawn|exec|execFile|fork)(?:Sync)?\s*\(|\bfetch\s*\(|node:https?\b|node:net\b/);
        // The merge-scope check it loads starts only git, with read-only subcommands, and loads only
        // Node's process module.
        const scope = fs.readFileSync(path.join(root, 'repo', 'scripts', 'toolkit-auto-merge-eligible.cjs'), 'utf8');
        assert.deepEqual([...scope.matchAll(/\brequire\s*\(([^)]*)\)/g)].map((match) => match[1].trim()), ["'node:child_process'"]);
        assert.deepEqual([...scope.matchAll(/(?<![.\w])(?:spawn|exec|execFile|fork)(?:Sync)?\s*\(([^,]*)/g)].map((match) => match[1].trim()), ["'git'"]);
        const subcommands = new Set([...scope.matchAll(/\bgit\(cwd, \['([\w-]+)'/g)].map((match) => match[1]));
        assert.deepEqual([...subcommands].sort(), ['cat-file', 'diff', 'merge-base', 'rev-parse', 'show']);
        assert.doesNotMatch(scope, /\bimport\s*\(|\bfetch\s*\(|node:https?\b|node:net\b/);
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
