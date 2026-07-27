'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const inventory = require('../scripts/check-workflow-inventory.cjs');
const fixture = function(name) {
  return 'repo/tests/fixtures/workflow-inventory/' + name;
};

test('real workflow inventory and auto-sync preflight rewrite pass', function() {
  assert.deepEqual(inventory.runInventory(), { workflows: 7, privileged: 2 });
});

test('symbolic GitHub workspace roots admit reviewed checkout identities only', function() {
  const checkouts = new Map([['trusted', { id: 'trusted', generation: 1, path: 'trusted' }]]);
  assert.deepEqual(inventory.structuralPath('${{ github.workspace }}', checkouts, new Map(), 'fixture'), { kind: 'WORKSPACE_ROOT' });
  assert.deepEqual(inventory.structuralPath('${{ github.workspace }}/trusted', checkouts, new Map(), 'fixture'), {
    kind: 'CHECKOUT_PATH', checkout_id: 'trusted', generation: 1, components: 'trusted'
  });
  assert.throws(function() { inventory.structuralPath('${{ runner.temp }}/trusted', checkouts, new Map(), 'fixture'); }, /WF_STRUCTURAL_EXPRESSION/);
});

test('environment alias reassignment and shadowing fail closed', function() {
  const aliases = new Map([['$TRUSTED_ROOT', '${{ github.workspace }}/trusted']]);
  const checkouts = new Map([['trusted', { id: 'trusted', generation: 1, path: 'trusted' }]]);
  assert.deepEqual(inventory.structuralPath('$TRUSTED_ROOT', checkouts, aliases, 'fixture').checkout_id, 'trusted');
  aliases.set('$TRUSTED_ROOT', '/unreviewed');
  assert.throws(function() { inventory.structuralPath('$TRUSTED_ROOT', checkouts, aliases, 'fixture'); }, /WF_STRUCTURAL_EXPRESSION/);
});

test('PATH removal and replacement invalidate setup-node identity', function() {
  const state = new inventory.ExecutableIdentityState();
  state.setup({ node_sha256: 'a', path_identity_digest: 'p' });
  assert.equal(state.admitNode('a'), true);
  state.mutatePath('q');
  assert.throws(function() { state.admitNode('a'); }, /WF_SETUP_NODE_IDENTITY/);
  state.setup({ node_sha256: 'b', path_identity_digest: 'r' });
  state.clearEnvironment();
  assert.throws(function() { state.admitNode('b'); }, /WF_SETUP_NODE_IDENTITY/);
});

test('command -p, xargs, find -exec and find -execdir are rejected', function() {
  assert.throws(function() { inventory.validateWrapper(['command', '-p', 'node', 'x.cjs'], 'fixture'); }, /WF_COMMAND_P_REJECTED/);
  assert.throws(function() { inventory.validateWrapper(['xargs', 'node'], 'fixture'); }, /WF_XARGS_REJECTED/);
  assert.throws(function() { inventory.validateWrapper(['find', '.', '-exec', 'node', '{}'], 'fixture'); }, /WF_FIND_EXEC_REJECTED/);
  assert.throws(function() { inventory.validateWrapper(['find', '.', '-execdir', 'node', '{}'], 'fixture'); }, /WF_FIND_EXEC_REJECTED/);
});

test('PowerShell pipeline chains segment and unsupported constructs fail closed', function() {
  assert.deepEqual(inventory.segments('node a.cjs && node b.cjs || node c.cjs', 'pwsh', 'fixture').length, 3);
  assert.deepEqual(inventory.segments('& "./script.ps1"', 'pwsh', 'fixture')[0], ['./script.ps1']);
  assert.deepEqual(inventory.segments('. "./script.ps1"', 'pwsh', 'fixture')[0], ['dot-source', './script.ps1']);
  for (const command of ['& $dynamic', '{ node a.cjs }', '$(node a.cjs)', 'node a.cjs > out', '@\"x\"@', '(node a.cjs)']) {
    assert.throws(function() { inventory.segments(command, 'pwsh', 'fixture'); });
  }
});

test('PowerShell normal script preserves environment and location but not lexical scope', function() {
  const state = new inventory.PowerShellState({ lexical: [['outer', 'one']], environment: [['A', 'one']], location: 'root' });
  state.invokeScript([
    { kind: 'lexical', name: 'outer', value: 'two' },
    { kind: 'environment', name: 'A', value: 'two' },
    { kind: 'push-location', value: 'child' },
    { kind: 'pop-location' },
    { kind: 'set-location', value: 'next' }
  ], false);
  assert.equal(state.lexical.get('outer'), 'one');
  assert.equal(state.environment.get('A'), 'two');
  assert.equal(state.location, 'next');
});

test('PowerShell dot sourcing propagates lexical environment and location state', function() {
  const state = new inventory.PowerShellState({ location: 'root' });
  state.invokeScript([{ kind: 'lexical', name: 'f', value: 'defined' }, { kind: 'environment', name: 'A', value: 'x' }, { kind: 'set-location', value: 'next' }], true);
  assert.equal(state.lexical.get('f'), 'defined');
  assert.equal(state.environment.get('A'), 'x');
  assert.equal(state.location, 'next');
});

test('PowerShell child process and separate runspace inherit isolated environment and location copies', function() {
  const parent = new inventory.PowerShellState({ environment: [['A', 'one']], location: 'root', lexical: [['f', 'defined']] });
  for (const child of [parent.childProcess(), parent.separateRunspace()]) {
    assert.equal(child.environment.get('A'), 'one');
    assert.equal(child.location, 'root');
    assert.equal(child.lexical.has('f'), false);
    child.invokeScript([{ kind: 'environment', name: 'A', value: 'two' }, { kind: 'set-location', value: 'child' }], false);
    assert.equal(parent.environment.get('A'), 'one');
    assert.equal(parent.location, 'root');
  }
});

test('runner command-file identities are step-scoped append-only and runner-temp is non-executable', function() {
  const state = new inventory.RunnerIdentityState('job');
  state.beginStep('one');
  assert.equal(state.commandFile('output', 'one').access, 'append-only');
  assert.throws(function() { state.commandFile('output', 'one', 'suffix'); }, /WF_RUNNER_FILE_LIFETIME/);
  state.beginStep('two');
  assert.throws(function() { state.commandFile('output', 'one'); }, /WF_RUNNER_FILE_LIFETIME/);
  assert.deepEqual(state.tempPath('a/b'), { kind: 'RUNNER_TEMP_PATH', job_id: 'job', components: 'a/b', executable: false });
  assert.throws(function() { state.tempPath('../escape'); }, /WF_PATH_INVALID/);
});

test('nearest package root is derived from the execution directory by path components', function() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-package-root-'));
  const nested = path.join(root, 'packages', 'one', 'src');
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), '{}');
  fs.writeFileSync(path.join(root, 'packages', 'one', 'package.json'), '{}');
  try {
    assert.equal(inventory.derivePackageRoot(root, nested, 'fixture'), path.join(root, 'packages', 'one'));
    assert.throws(function() { inventory.derivePackageRoot(root, path.dirname(root), 'fixture'); }, /WF_PACKAGE_ROOT_ESCAPE/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('package scripts resolve recursively from the nearest package root with separate memo and active stacks', function() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-package-graph-'));
  const packageRoot = path.join(root, 'packages', 'one');
  const nested = path.join(packageRoot, 'src');
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(packageRoot, 'package.json'), JSON.stringify({
    scripts: {
      check: 'npm run shared && npm run lint',
      shared: 'node shared.cjs',
      lint: 'npm run shared'
    }
  }));
  try {
    const graph = inventory.resolvePackageScriptGraph(root, nested, 'check', 'fixture');
    assert.equal(graph.package_root, packageRoot);
    assert.deepEqual(graph.visited.map(function(entry) { return entry.script_name; }), ['check', 'shared', 'lint']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('package-script cycles and unsupported prefix or workspace roots fail closed', function() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-package-cycle-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    scripts: {
      cycle: 'npm run cycle',
      prefix: 'npm --prefix child run check',
      workspace: 'npm run check --workspace=child'
    }
  }));
  try {
    assert.throws(function() { inventory.resolvePackageScriptGraph(root, root, 'cycle', 'fixture'); }, /WF_PACKAGE_SCRIPT_CYCLE/);
    assert.throws(function() { inventory.resolvePackageScriptGraph(root, root, 'prefix', 'fixture'); }, /WF_PACKAGE_SCRIPT_ROOT_OVERRIDE/);
    assert.throws(function() { inventory.resolvePackageScriptGraph(root, root, 'workspace', 'fixture'); }, /WF_PACKAGE_SCRIPT_ARGUMENTS/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('dependency-tree and checkout replacement commands invalidate installation authority', function() {
  assert.equal(inventory.mutatesDependencyTree(['rm', '-rf', 'node_modules']), true);
  assert.equal(inventory.mutatesDependencyTree(['Remove-Item', 'package-lock.json']), true);
  assert.equal(inventory.mutatesDependencyTree(['git', 'reset', '--hard']), true);
  assert.equal(inventory.mutatesDependencyTree(['node', 'repo/tests/check.cjs']), false);
});

test('tokenizer wrapper grammar preserves quoted paths and rejects dynamic or unknown wrapper options', function() {
  assert.deepEqual(inventory.tokenize('bash -eu \"scripts/a b.sh\"', 'fixture'), ['bash', '-eu', 'scripts/a b.sh']);
  assert.doesNotThrow(function() { inventory.validateWrapper(['bash', '-eu', 'scripts/a b.sh'], 'fixture'); });
  assert.throws(function() { inventory.validateWrapper(['bash', '--mystery', 'script.sh'], 'fixture'); }, /WF_WRAPPER_OPTION/);
  assert.throws(function() { inventory.tokenize('bash $(choose-script)', 'fixture'); }, /WF_DYNAMIC_COMMAND/);
});

test('command graph preserves unconditional, success-only, failure-only and pipeline operators', function() {
  const graph = inventory.parseCommandGraph('true; npm ci --ignore-scripts && node x.cjs || false | true', 'bash', 'fixture');
  assert.equal(graph.type, 'sequence');
  assert.equal(graph.members[1].type, 'or');
  assert.equal(graph.members[1].left.type, 'and');
  assert.equal(graph.members[1].right.type, 'pipeline');
});

test('whole workflow rejects npm ci failure-only Node execution', function() {
  assert.throws(function() { inventory.analyzeWorkflowFixture(fixture('cfg-or-install.yml')); }, /WF_NODE_WITHOUT_INSTALL/);
});

test('whole workflow rejects failed installation followed by failure-only execution', function() {
  assert.throws(function() { inventory.analyzeWorkflowFixture(fixture('cfg-continued-install-failure.yml')); }, /WF_NODE_WITHOUT_INSTALL/);
});

test('whole workflow rejects pipeline-derived installation authority', function() {
  assert.throws(function() { inventory.analyzeWorkflowFixture(fixture('cfg-pipeline-install.yml')); }, /WF_NODE_WITHOUT_INSTALL/);
});

test('whole workflow rejects subshell-only installation authority', function() {
  assert.throws(function() { inventory.analyzeWorkflowFixture(fixture('cfg-subshell-install.yml')); }, /WF_NODE_WITHOUT_INSTALL/);
});

test('whole workflow rejects a branch join where only one path installs dependencies', function() {
  assert.throws(function() { inventory.analyzeWorkflowFixture(fixture('cfg-branch-join.yml')); }, /WF_NODE_WITHOUT_INSTALL/);
});

test('whole workflow admits Node only on the successful npm ci path', function() {
  assert.equal(inventory.analyzeWorkflowFixture(fixture('cfg-success-install.yml')), true);
});

test('env PATH replacement is applied before child executable identity resolution', function() {
  assert.throws(function() { inventory.analyzeWorkflowFixture(fixture('cfg-env-path-replacement.yml')); }, /WF_NODE_WITHOUT_SETUP/);
});

test('env non-PATH assignment preserves accepted child executable identity', function() {
  assert.equal(inventory.analyzeWorkflowFixture(fixture('cfg-env-safe.yml')), true);
});

test('composite local action closure discovers hidden repository Node execution', function() {
  assert.throws(function() { inventory.analyzeWorkflowFixture(fixture('local-composite-workflow.yml')); }, /WF_NODE_WITHOUT_INSTALL/);
});

test('local action.yaml metadata is resolved and traversed', function() {
  assert.throws(function() { inventory.analyzeWorkflowFixture(fixture('local-action-yaml-workflow.yml')); }, /WF_NODE_WITHOUT_INSTALL/);
});

test('ambiguous local action.yml and action.yaml metadata fails closed', function() {
  assert.throws(function() { inventory.analyzeWorkflowFixture(fixture('local-action-ambiguous-workflow.yml')); }, /WF_LOCAL_ACTION_METADATA_AMBIGUOUS/);
});

test('unsupported local Docker action fails closed', function() {
  assert.throws(function() { inventory.analyzeWorkflowFixture(fixture('local-docker-workflow.yml')); }, /WF_LOCAL_DOCKER_UNSUPPORTED/);
});

test('local JavaScript action pre entry point is recursively inspected', function() {
  assert.throws(function() { inventory.analyzeWorkflowFixture(fixture('local-js-pre-workflow.yml')); }, /WF_LOCAL_JS_PROCESS_EXECUTION:.*:pre/);
});

test('local JavaScript action main entry point is recursively inspected', function() {
  assert.throws(function() { inventory.analyzeWorkflowFixture(fixture('local-js-main-workflow.yml')); }, /WF_LOCAL_JS_PROCESS_EXECUTION:.*:main/);
});

test('local JavaScript action post entry point is recursively inspected', function() {
  assert.throws(function() { inventory.analyzeWorkflowFixture(fixture('local-js-post-workflow.yml')); }, /WF_LOCAL_JS_PROCESS_EXECUTION:.*:post/);
});

test('Bash wrapper closure discovers hidden repository Node execution', function() {
  assert.throws(function() { inventory.analyzeWorkflowFixture(fixture('wrapper-bash-workflow.yml')); }, /WF_NODE_WITHOUT_INSTALL/);
});

test('PowerShell wrapper closure discovers hidden repository Node execution', function() {
  assert.throws(function() { inventory.analyzeWorkflowFixture(fixture('wrapper-powershell-workflow.yml')); }, /WF_NODE_WITHOUT_INSTALL/);
});

test('CMD wrapper closure discovers hidden repository Node execution', function() {
  assert.throws(function() { inventory.analyzeWorkflowFixture(fixture('wrapper-cmd-workflow.yml')); }, /WF_NODE_WITHOUT_INSTALL/);
});

test('recursive wrapper cycles fail closed through the active stack', function() {
  assert.throws(function() { inventory.analyzeWorkflowFixture(fixture('wrapper-cycle-workflow.yml')); }, /WF_WRAPPER_CYCLE/);
});

test('package-script parent directory is restored so nested same-named wrapper is correctly inspected', function() {
  assert.equal(inventory.analyzeWorkflowFixture(fixture('cfg-package-parent-dir.yml')), true);
});

test('static launcher allowlist unwraps command concealment of repository Node execution', function() {
  assert.throws(function() {
    inventory.analyzeWorkflowFixture(fixture('cfg-launcher-command.yml'));
  }, /WF_NODE_WITHOUT_INSTALL/);
});

test('static launcher allowlist unwraps timeout concealment of repository Node execution', function() {
  assert.throws(function() {
    inventory.analyzeWorkflowFixture(fixture('cfg-launcher-timeout.yml'));
  }, /WF_NODE_WITHOUT_INSTALL/);
});

test('static launcher allowlist unwraps nice concealment of repository Node execution', function() {
  assert.throws(function() {
    inventory.analyzeWorkflowFixture(fixture('cfg-launcher-nice.yml'));
  }, /WF_NODE_WITHOUT_INSTALL/);
});

test('static launcher allowlist recursively unwraps nested launcher concealment', function() {
  assert.throws(function() {
    inventory.analyzeWorkflowFixture(fixture('cfg-launcher-nested.yml'));
  }, /WF_NODE_WITHOUT_INSTALL/);
});

test('env assignments around a launcher are correctly propagated before unwrapping', function() {
  assert.throws(function() {
    inventory.analyzeWorkflowFixture(fixture('cfg-launcher-env-nested.yml'));
  }, /WF_NODE_WITHOUT_INSTALL/);
});

test('loader alias capture through variable assignment is rejected', function() {
  assert.throws(function() {
    inventory.analyzeWorkflowFixture(fixture('local-js-capture-alias-workflow.yml'));
  }, /WF_LOCAL_JS_LOADER_ALIAS/);
});

test('createRequire loader creation is rejected', function() {
  assert.throws(function() {
    inventory.analyzeWorkflowFixture(fixture('local-js-create-require-workflow.yml'));
  }, /WF_LOCAL_JS_LOADER_CREATION/);
});

test('loader passed as function argument is rejected', function() {
  assert.throws(function() {
    inventory.analyzeWorkflowFixture(fixture('local-js-pass-loader-workflow.yml'));
  }, /WF_LOCAL_JS_LOADER_ALIAS/);
});

test('loader stored in object property is rejected', function() {
  assert.throws(function() {
    inventory.analyzeWorkflowFixture(fixture('local-js-store-loader-workflow.yml'));
  }, /WF_LOCAL_JS_LOADER_ALIAS/);
});

test('loader reassignment is rejected', function() {
  assert.throws(function() {
    inventory.analyzeWorkflowFixture(fixture('local-js-reassign-loader-workflow.yml'));
  }, /WF_LOCAL_JS_LOADER_ALIAS/);
});

test('destructured createRequire from node:module is rejected', function() {
  assert.throws(function() {
    inventory.analyzeWorkflowFixture(fixture('local-js-destructure-create-require-workflow.yml'));
  }, /WF_LOCAL_JS_LOADER_CREATION/);
});

test('unwrapStaticLauncher rejects timeout with missing command', function() {
  assert.throws(function() {
    inventory.unwrapStaticLauncher(['timeout'], 'fixture');
  }, /WF_LAUNCHER_MISSING_COMMAND/);
  assert.throws(function() {
    inventory.unwrapStaticLauncher(['timeout', '10'], 'fixture');
  }, /WF_LAUNCHER_MISSING_COMMAND/);
});

test('unwrapStaticLauncher rejects command with no trailing command', function() {
  assert.throws(function() {
    inventory.unwrapStaticLauncher(['command', '-v'], 'fixture');
  }, /WF_LAUNCHER_MISSING_COMMAND/);
});

test('unwrapStaticLauncher rejects nice with missing command', function() {
  assert.throws(function() {
    inventory.unwrapStaticLauncher(['nice'], 'fixture');
  }, /WF_LAUNCHER_MISSING_COMMAND/);
  assert.throws(function() {
    inventory.unwrapStaticLauncher(['nice', '-n', '-5'], 'fixture');
  }, /WF_LAUNCHER_MISSING_COMMAND/);
});

test('non-delegating unknown executable is not treated as a launcher', function() {
  const tokens = inventory.unwrapStaticLauncher(['echo', 'hello'], 'fixture');
  assert.deepEqual(tokens, ['echo', 'hello']);
});

test('static launcher times out over-recursion depth', function() {
  const tokens = ['timeout', '10', 'command'];
  assert.deepEqual(inventory.unwrapStaticLauncher(tokens, 'fixture'), ['command']);
});

test('checkLoaderAliases rejects createRequire identifier', function() {
  assert.throws(function() {
    const src = 'const r = createRequire(import.meta.url);';
    const acorn = require('acorn');
    const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'module' });
    inventory.checkLoaderAliases(ast, 'fixture');
  }, /WF_LOCAL_JS_LOADER_CREATION/);
});

test('checkLoaderAliases rejects require used in assignment right-hand side', function() {
  assert.throws(function() {
    const src = 'const r = require;';
    const acorn = require('acorn');
    const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'module' });
    inventory.checkLoaderAliases(ast, 'fixture');
  }, /WF_LOCAL_JS_LOADER_ALIAS/);
});

test('checkLoaderAliases does not reject direct literal require call', function() {
  const src = 'require("node:path");';
  const acorn = require('acorn');
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'module' });
  assert.doesNotThrow(function() { inventory.checkLoaderAliases(ast, 'fixture'); });
});
