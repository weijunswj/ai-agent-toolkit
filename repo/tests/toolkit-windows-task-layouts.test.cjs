'use strict';

// Kept separately so real Git layout qualification does not consume the task
// state-machine file's time budget. The moved row and its assertions are unchanged.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const windowsTasks = require('../scripts/toolkit-windows-tasks.cjs');
const { tempHome, NODE } = require('./support/windows-task-switch-world.cjs');

test('M5 L4: direct worktree targeting refuses on a real Git layout', t => {
  const real = require('../scripts/toolkit-governance-state.cjs');
  const home = tempHome(t), scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'tk-layouts-'));
  t.after(() => fs.rmSync(scratch, { recursive: true, force: true }));
  const git = (root, args) => require('node:child_process').execFileSync('git', ['-C', root, ...args], { timeout: 10000, encoding: 'utf8', windowsHide: true });
  const make = (name, remote) => { const root = path.join(scratch, name); fs.mkdirSync(root); git(root, ['init', '--quiet']); git(root, ['remote', 'add', 'origin', remote]); git(root, ['-c','user.name=Fixture','-c','user.email=fixture@example.com','commit','--quiet','--allow-empty','-m','fixture']); return root; };
  const managed = make('toolkit', 'https://github.com/weijunswj/ai-agent-toolkit.git');
  const project = make('project', 'https://github.com/example/widget.git');
  const linked = path.join(scratch, 'linked'); git(project, ['worktree','add','--quiet','-b','fixture-linked',linked]);
  const plain = path.join(scratch, 'plain'); fs.mkdirSync(plain);
  const deps = { identityReader: request => ({ ...request, checkout: windowsTasks.mainCheckout(request.checkout), toolkitRoot: windowsTasks.mainCheckout(request.toolkitRoot) }),
    governance: { ...real, readIdentity: root => root === plain ? { valid: false, root: null } : real.readIdentity(root), governanceState: () => ({ state: 'UNDECIDED', merged: { status: 'none', fresh: true } }) }, readObservation: () => ({ status: 'none', fresh: true }) };
  assert.throws(() => windowsTasks.desiredTasks({ checkout: linked, toolkitRoot: managed, home, nodePath: NODE, deps }), /main checkout/);
});
