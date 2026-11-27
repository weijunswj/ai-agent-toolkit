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
  test(`${host}: setup asks no merge question; task auto-merge lives in each repository's governance`, () => {
    const { specs, args } = bankFor(host);
    assert.deepEqual(specs.filter(spec => /auto-?merge/i.test(`${spec.id} ${spec.title}`)).map(row => row.id), []);
    assert.equal(args.setupChoices.taskAutoMerge, undefined);
    assert.doesNotMatch(JSON.stringify(args), /refreshPrAutoMerge|taskAutoMerge/);
  });
}

test('the old auto-merge flags are rejected', () => {
  for (const flag of ['--enable-refresh-pr-auto-merge', '--disable-refresh-pr-auto-merge', '--keep-refresh-pr-auto-merge', '--refresh-pr-auto-merge', '--task-auto-merge', '--task-auto-merge=after-gates']) {
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
      // The merge hold must never run a merge. Its only GitHub operation is bounded GET metadata
      // through the existing transport, to verify the exact bound evidence store and pinned PR.
      if (path.relative(root, full).split(path.sep).join('/') === 'repo/scripts/toolkit-merge-hold.cjs') {
        const source = fs.readFileSync(full, 'utf8');
        const loads = [...source.matchAll(/\brequire\s*\(([^)]*)\)/g)].map((match) => match[1].trim());
        // Repository identity already loads through governance state; its direct import normalises the target identity.
        assert.deepEqual(loads.sort(), ["'../../skills/github-program-reconciler/scripts/programme-state.cjs'", "'../../skills/github-program-reconciler/scripts/resolve-executable.cjs'", "'./toolkit-auto-merge-eligible.cjs'", "'./toolkit-copies-proof.cjs'", "'./toolkit-governance-binding.cjs'", "'./toolkit-governance-gate.cjs'", "'./toolkit-governance-state.cjs'", "'./toolkit-projects-cloud.cjs'", "'./toolkit-projects-delivery.cjs'", "'./toolkit-repository-identity.cjs'", "'./toolkit-shell-call.cjs'", "'node:crypto'", "'node:fs'", "'node:path'"]);
        assert.doesNotMatch(source, /\bimport\s*\(|child_process|(?<![.\w])(?:spawn|exec|execFile|fork)(?:Sync)?\s*\(|\bfetch\s*\(|node:https?\b|node:net\b/);
        assert.deepEqual([...source.matchAll(/\.request\('([A-Z]+)',\s*([^)]*)\)/g)].map(match => [match[1], match[2]]), [['GET', 'apiPath']]);
        // The Projects cloud reader it loads only parses host text and the head of the session
        // transcript, through a reader that loads only node:fs and writes nothing.
        const cloud = fs.readFileSync(path.join(root, 'repo', 'scripts', 'toolkit-projects-cloud.cjs'), 'utf8');
        assert.deepEqual([...cloud.matchAll(/\brequire\s*\(([^)]*)\)/g)].map((match) => match[1].trim()), ["'./toolkit-transcript-head.cjs'"]);
        assert.doesNotMatch(cloud, /\bimport\s*\(|child_process|\bfetch\s*\(|node:https?\b|node:net\b/);
        const head = fs.readFileSync(path.join(root, 'repo', 'scripts', 'toolkit-transcript-head.cjs'), 'utf8');
        assert.deepEqual([...head.matchAll(/\brequire\s*\(([^)]*)\)/g)].map((match) => match[1].trim()), ["'node:fs'"]);
        assert.deepEqual([...new Set([...head.matchAll(/\bfs\.(\w+)/g)].map((match) => match[1]))].sort(), ['closeSync', 'openSync', 'readSync', 'statSync']);
        assert.deepEqual([...head.matchAll(/fs\.openSync\(([^)]*)\)/g)].map((match) => match[1]), ["file, 'r'"]);
        assert.doesNotMatch(head, /\bimport\s*\(|child_process|\bfetch\s*\(|node:https?\b|node:net\b/);
        // The merge-scope check it loads starts only git, with read-only subcommands, and loads only
        // Node's own modules. Its one file read is the pull request body its CLI is handed; it writes nothing.
        const scope = fs.readFileSync(path.join(root, 'repo', 'scripts', 'toolkit-auto-merge-eligible.cjs'), 'utf8');
        assert.deepEqual([...scope.matchAll(/\brequire\s*\(([^)]*)\)/g)].map((match) => match[1].trim()), ["'node:fs'", "'node:path'", "'node:child_process'"]);
        assert.deepEqual([...new Set([...scope.matchAll(/\bfs\.(\w+)/g)].map((match) => match[1]))], ['readFileSync']);
        assert.deepEqual([...scope.matchAll(/(?<![.\w])(?:spawn|exec|execFile|fork)(?:Sync)?\s*\(([^,]*)/g)].map((match) => match[1].trim()), ["'git'"]);
        const subcommands = new Set([...scope.matchAll(/\bgit\(cwd, \['([\w-]+)'/g)].map((match) => match[1]));
        assert.deepEqual([...subcommands].sort(), ['cat-file', 'diff', 'merge-base', 'rev-parse', 'show']);
        assert.doesNotMatch(scope, /\bimport\s*\(|\bfetch\s*\(|node:https?\b|node:net\b/);
        // The copy proof it loads for a refresh's standing merge starts only git, with read-only
        // subcommands, and takes from the refresh module only its snapshot, its render of the changes
        // and two names: never the code that writes to GitHub.
        const proof = fs.readFileSync(path.join(root, 'repo', 'scripts', 'toolkit-copies-proof.cjs'), 'utf8');
        assert.deepEqual([...new Set([...proof.matchAll(/\brequire\s*\(([^)]*)\)/g)].map((match) => match[1].trim()))].sort(), ["'./toolkit-auto-merge-eligible.cjs'", "'./toolkit-cloud-workflows-refresh.cjs'", "'./toolkit-cloud-workflows.cjs'", "'./toolkit-governance-state.cjs'", "'node:child_process'", "'node:fs'", "'node:path'"]);
        assert.deepEqual([...proof.matchAll(/(?<![.\w])(?:spawn|exec|execFile|fork)(?:Sync)?\s*\(([^,]*)/g)].map((match) => match[1].trim()), ["'git'"]);
        assert.deepEqual([...new Set([...proof.matchAll(/\bgit\([\w.#]+, \['([\w-]+)'/g)].map((match) => match[1]))].sort(), ['cat-file', 'diff', 'log', 'merge-base']);
        assert.deepEqual([...new Set([...proof.matchAll(/this\.#refresh\.(\w+)/g)].map((match) => match[1]))].sort(), ['BranchSnapshot', 'GUARD_CONFIG', 'TITLE', 'changes']);
        assert.doesNotMatch(proof, /\bimport\s*\(|\bfetch\s*\(|node:https?\b|node:net\b|ghApi|publish|refreshPr/);
        // The shell-call reader it loads only reads its input.
        const reader = fs.readFileSync(path.join(root, 'repo', 'scripts', 'toolkit-shell-call.cjs'), 'utf8');
        assert.deepEqual([...reader.matchAll(/\brequire\s*\(([^)]*)\)/g)].map((match) => match[1].trim()), ["'node:os'", "'node:path'"]);
        assert.doesNotMatch(reader, /\bimport\s*\(|child_process|(?<![.\w])(?:spawn|exec|execFile|fork)(?:Sync)?\s*\(|\bfetch\s*\(|node:https?\b|node:net\b/);
        // The standalone shell diagnostic must not gain file, subprocess or network imports.
        const diagnostic = fs.readFileSync(path.join(root, 'repo', 'scripts', 'toolkit-session-shell-check.cjs'), 'utf8');
        assert.doesNotMatch(diagnostic, /\brequire\b|\bimport\b/);
        continue;
      }
      // The merge train's land prints the merge command for the agent to run (merge_step), so the merge
      // guard asks the owner, or after their yes; the script itself never runs a merge. Proof:
      // the command text appears once, as mergeStep's printed template, the script starts only git,
      // the manifest's bump command and read-only `gh api`, and it holds no other merge text.
      if (path.relative(root, full).split(path.sep).join('/') === 'repo/scripts/toolkit-merge-train.cjs') {
        // LF first: a CRLF checkout (Windows CI) must read the same lines and function bounds.
        const source = fs.readFileSync(full, 'utf8').replace(/\r\n/g, '\n');
        const named = source.split('\n').filter(line => /gh\s+pr\s+merge/i.test(line)).map(line => line.trim());
        assert.deepEqual(named, ["const command = `gh pr merge ${merge.pr}${merge.repository ? ` --repo ${merge.repository}` : ''} --merge --match-head-commit ${merge.head}`;"]);
        const step = source.slice(source.indexOf('function mergeStep('), source.indexOf('\n}\n', source.indexOf('function mergeStep(')));
        assert.deepEqual(step.split('\n').filter(line => line.includes('${command}')).map(line => line.trim().startsWith('if (merge.route') || line.trim().startsWith('return ')), [true, true], 'the command is only returned as text');
        assert.deepEqual([...source.matchAll(/\bspawnSync\(\s*([^,]+),\s*(\[?[^,\]]*)/g)].map(match => [match[1].trim(), match[2].trim()]), [['\'git\'', 'args'], ['argv[0]', 'argv.slice(1)'], ['\'gh\'', "['api'"], ['\'gh\'', "['api'"]], 'git, the bump command, and read-only gh api reads of a pull request and of main\'s check runs');
        assert.doesNotMatch(source, /(?<![.\w])(?:spawn|exec|execFile|fork|execSync|execFileSync)\s*\(|\bimport\s*\(|\bfetch\s*\(|node:https?\b|enablePullRequestAutoMerge|merge\s+--auto\b|--auto-merge\b/i);
        continue;
      }
      // The refresh landing check prints the pinned merge command for the controller to run, so the
      // merge hold checks it; the script never runs a merge. Proof: the command text appears only in
      // its header and as the one printed template, it starts only git (a fetch and a rev-parse), and
      // every GitHub read passes no method, so each is a GET.
      if (path.relative(root, full).split(path.sep).join('/') === 'repo/scripts/toolkit-cloud-workflows-land.cjs') {
        const source = fs.readFileSync(full, 'utf8').replace(/\r\n/g, '\n');
        const named = source.split('\n').filter(line => /gh\s+pr\s+merge/i.test(line)).map(line => line.trim());
        assert.deepEqual(named, ['//   land      every condition holds: run `gh pr merge N --merge --match-head-commit <full head>` from', 'const merge = `gh pr merge ${pr.number} --merge --match-head-commit ${head}`;']);
        assert.deepEqual([...source.matchAll(/\bspawnSync\(\s*([^,]+),\s*\[\s*'([\w-]+)'/g)].map(match => [match[1].trim(), match[2]]), [["'git'", 'fetch'], ["'git'", 'rev-parse']]);
        assert.doesNotMatch(source, /\bmethod\b|(?<![.\w])(?:spawn|exec|execFile|fork|execSync|execFileSync)\s*\(|\bimport\s*\(|\bfetch\s*\(|node:https?\b|enablePullRequestAutoMerge|merge\s+--auto\b|--auto-merge\b/i);
        continue;
      }
      const text = fs.readFileSync(full, 'utf8');
      if (/gh\s+pr\s+merge|enablePullRequestAutoMerge|merge\s+--auto\b|--auto-merge\b/i.test(text)) hits.push(path.relative(root, full));
    }
  };
  for (const dir of ['repo/scripts', 'skills', '.claude-plugin', '.codex-plugin']) walk(path.join(root, dir));
  assert.deepEqual(hits, []);
});
