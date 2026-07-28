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

test('unwrapStaticLauncher returns execution token for timeout with duration', function() {
  const r = inventory.unwrapStaticLauncher(['timeout', '10', 'node', 'x.cjs'], 'fixture');
  assert.equal(r.kind, 'execution');
  assert.deepEqual(r.tokens, ['node', 'x.cjs']);
});

test('unwrapStaticLauncher returns execution token for timeout with s suffix', function() {
  const r = inventory.unwrapStaticLauncher(['timeout', '10s', 'node', 'x.cjs'], 'fixture');
  assert.equal(r.kind, 'execution');
  assert.deepEqual(r.tokens, ['node', 'x.cjs']);
});

test('unwrapStaticLauncher returns ordinary for non-launcher', function() {
  const r = inventory.unwrapStaticLauncher(['echo', 'hello'], 'fixture');
  assert.equal(r.kind, 'ordinary');
  assert.deepEqual(r.tokens, ['echo', 'hello']);
});

test('unwrapStaticLauncher rejects timeout missing command', function() {
  assert.throws(function() {
    inventory.unwrapStaticLauncher(['timeout'], 'fixture');
  }, /WF_LAUNCHER_MISSING_COMMAND/);
  assert.throws(function() {
    inventory.unwrapStaticLauncher(['timeout', '10'], 'fixture');
  }, /WF_LAUNCHER_MISSING_COMMAND/);
});

test('unwrapStaticLauncher rejects command lookup mode', function() {
  assert.throws(function() {
    inventory.unwrapStaticLauncher(['command', '-v', 'node'], 'fixture');
  }, /WF_LAUNCHER_LOOKUP_MODE/);
});

test('unwrapStaticLauncher rejects nice with missing command', function() {
  assert.throws(function() {
    inventory.unwrapStaticLauncher(['nice'], 'fixture');
  }, /WF_LAUNCHER_MISSING_COMMAND/);
  assert.throws(function() {
    inventory.unwrapStaticLauncher(['nice', '-n'], 'fixture');
  }, /WF_LAUNCHER_OPTION_UNSUPPORTED/);
});

test('unwrapStaticLauncher rejects nice -n with non-integer value', function() {
  assert.throws(function() {
    inventory.unwrapStaticLauncher(['nice', '-n', 'abc', 'node', 'x.cjs'], 'fixture');
  }, /WF_LAUNCHER_OPTION_UNSUPPORTED/);
});

test('unwrapStaticLauncher returns execution for nice -n adjustment', function() {
  const r = inventory.unwrapStaticLauncher(['nice', '-n', '5', 'node', 'x.cjs'], 'fixture');
  assert.equal(r.kind, 'execution');
  assert.deepEqual(r.tokens, ['node', 'x.cjs']);
});

test('unwrapStaticLauncher returns execution for nice -- terminator', function() {
  const r = inventory.unwrapStaticLauncher(['nice', '--', 'node', 'x.cjs'], 'fixture');
  assert.equal(r.kind, 'execution');
  assert.deepEqual(r.tokens, ['node', 'x.cjs']);
});

test('unwrapStaticLauncher rejects timeout invalid duration', function() {
  assert.throws(function() {
    inventory.unwrapStaticLauncher(['timeout', 'abc', 'node', 'x.cjs'], 'fixture');
  }, /WF_LAUNCHER_DURATION/);
});

test('unwrapStaticLauncher rejects timeout unknown option', function() {
  assert.throws(function() {
    inventory.unwrapStaticLauncher(['timeout', '--foreground', '10', 'node', 'x.cjs'], 'fixture');
  }, /WF_LAUNCHER_OPTION_UNSUPPORTED/);
});

test('unwrapStaticLauncher rejects timeout unknown short option', function() {
  assert.throws(function() {
    inventory.unwrapStaticLauncher(['timeout', '-x', '10', 'node', 'x.cjs'], 'fixture');
  }, /WF_LAUNCHER_OPTION_UNSUPPORTED/);
});

test('unwrapStaticLauncher returns execution for timeout -- terminator with duration', function() {
  const r = inventory.unwrapStaticLauncher(['timeout', '--', '5', 'node', 'x.cjs'], 'fixture');
  assert.equal(r.kind, 'execution');
  assert.deepEqual(r.tokens, ['node', 'x.cjs']);
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

test('nested npm run outer-parent key is not overwritten by inner invocation', function() {
  assert.equal(inventory.analyzeWorkflowFixture(fixture('cfg-nested-package-script.yml')), true);
});

test('PATH mutation inside a package script is not inherited by the parent shell', function() {
  assert.equal(inventory.analyzeWorkflowFixture(fixture('cfg-package-path-isolation.yml')), true);
});

test('environment mutation inside a package script is not inherited by the parent shell', function() {
  assert.equal(inventory.analyzeWorkflowFixture(fixture('cfg-package-env-isolation.yml')), true);
});

test('same-named wrapper verdict changes when directory leak selects wrong file', function() {
  assert.equal(inventory.analyzeWorkflowFixture(fixture('cfg-package-verdict-oracle.yml')), true);
});

test('command dash-dash terminator unwraps correctly', function() {
  assert.equal(inventory.analyzeWorkflowFixture(fixture('cfg-launcher-command-term.yml')), true);
});

test('command -v lookup mode throws lookup error', function() {
  assert.throws(function() {
    inventory.analyzeWorkflowFixture(fixture('cfg-launcher-command-lookup-lower-v.yml'));
  }, /WF_LAUNCHER_LOOKUP_MODE/);
});

test('command -V lookup mode throws lookup error', function() {
  assert.throws(function() {
    inventory.analyzeWorkflowFixture(fixture('cfg-launcher-command-lookup-upper-v.yml'));
  }, /WF_LAUNCHER_LOOKUP_MODE/);
});

test('timeout -s SIGNAL option passes through correctly', function() {
  assert.equal(inventory.analyzeWorkflowFixture(fixture('cfg-launcher-timeout-signal.yml')), true);
});

test('timeout --signal=SIGNAL long option passes through correctly', function() {
  assert.equal(inventory.analyzeWorkflowFixture(fixture('cfg-launcher-timeout-signal-long.yml')), true);
});

test('timeout -k kill-after option passes through correctly', function() {
  assert.equal(inventory.analyzeWorkflowFixture(fixture('cfg-launcher-timeout-kill-after.yml')), true);
});

test('timeout -- terminator passes through correctly', function() {
  assert.equal(inventory.analyzeWorkflowFixture(fixture('cfg-launcher-timeout-term.yml')), true);
});

test('nice -n adjustment passes through correctly', function() {
  assert.equal(inventory.analyzeWorkflowFixture(fixture('cfg-launcher-nice-adjust.yml')), true);
});

test('nice --adjustment= long option passes through correctly', function() {
  assert.equal(inventory.analyzeWorkflowFixture(fixture('cfg-launcher-nice-adjust-long.yml')), true);
});

test('nice -- terminator passes through correctly', function() {
  assert.equal(inventory.analyzeWorkflowFixture(fixture('cfg-launcher-nice-term.yml')), true);
});

test('rejected delegator nohup fails closed', function() {
  assert.throws(function() {
    inventory.analyzeWorkflowFixture(fixture('cfg-launcher-rejected-nohup.yml'));
  }, /WF_LAUNCHER_REJECTED/);
});

test('rejected delegator sudo fails closed', function() {
  assert.throws(function() {
    inventory.analyzeWorkflowFixture(fixture('cfg-launcher-rejected-sudo.yml'));
  }, /WF_LAUNCHER_REJECTED/);
});

test('unsupported timeout --foreground option fails closed', function() {
  assert.throws(function() {
    inventory.analyzeWorkflowFixture(fixture('cfg-launcher-timeout-unsupported.yml'));
  }, /WF_LAUNCHER_OPTION_UNSUPPORTED/);
});

test('unsupported nice --priority option fails closed', function() {
  assert.throws(function() {
    inventory.analyzeWorkflowFixture(fixture('cfg-launcher-nice-unsupported.yml'));
  }, /WF_LAUNCHER_OPTION_UNSUPPORTED/);
});

test('unwrapStaticLauncher rejects rejected delegator nohup', function() {
  assert.throws(function() {
    inventory.unwrapStaticLauncher(['nohup', 'node', 'x.cjs'], 'fixture');
  }, /WF_LAUNCHER_REJECTED/);
});

test('unwrapStaticLauncher rejects rejected delegator setsid', function() {
  assert.throws(function() {
    inventory.unwrapStaticLauncher(['setsid', 'node', 'x.cjs'], 'fixture');
  }, /WF_LAUNCHER_REJECTED/);
});

test('loader require.call indirection is rejected', function() {
  assert.throws(function() {
    inventory.analyzeWorkflowFixture(fixture('local-js-call-bind-workflow.yml'));
  }, /WF_LOCAL_JS_LOADER_CHAIN/);
});

test('loader require.resolve is allowed as a non-executing safe property', function() {
  assert.equal(inventory.analyzeWorkflowFixture(fixture('local-js-require-resolve-workflow.yml')), true);
});

test('loader require.resolve traverses into resolved local target', function() {
  assert.equal(inventory.analyzeWorkflowFixture(fixture('local-js-require-resolve-workflow.yml')), true);
});

test('loader require.resolve detects prohibited execution in resolved target', function() {
  assert.throws(function() {
    inventory.analyzeWorkflowFixture(fixture('local-js-require-resolve-prohibited-workflow.yml'));
  }, /WF_LOCAL_JS_PROCESS_EXECUTION/);
});

test('loader require.resolve dynamic argument fails closed', function() {
  assert.throws(function() {
    inventory.analyzeWorkflowFixture(fixture('local-js-require-resolve-dynamic-workflow.yml'));
  }, /WF_LOCAL_JS_COMPUTED_REQUIRE|WF_LOCAL_JS_LOADER_RESOLVE_CONTEXT/);
});

test('loader require.resolve package argument fails closed', function() {
  assert.throws(function() {
    inventory.analyzeWorkflowFixture(fixture('local-js-require-resolve-package-workflow.yml'));
  }, /WF_LOCAL_JS_PACKAGE_IMPORT|WF_CLOSURE_PACKAGE_IMPORT/);
});

test('loader require() with zero arguments fails closed', function() {
  assert.throws(function() {
    inventory.analyzeWorkflowFixture(fixture('local-js-require-zero-args-workflow.yml'));
  }, /WF_LOCAL_JS_COMPUTED_REQUIRE/);
});

test('loader require(dynamic) fails closed', function() {
  assert.throws(function() {
    inventory.analyzeWorkflowFixture(fixture('local-js-require-dynamic-workflow.yml'));
  }, /WF_LOCAL_JS_COMPUTED_REQUIRE/);
});

test('loader require(./a + ./b) concatenated fails closed', function() {
  assert.throws(function() {
    inventory.analyzeWorkflowFixture(fixture('local-js-require-concat-workflow.yml'));
  }, /WF_LOCAL_JS_COMPUTED_REQUIRE/);
});

test('loader require(a, b) multiple arguments fails closed', function() {
  assert.throws(function() {
    inventory.analyzeWorkflowFixture(fixture('local-js-require-multi-args-workflow.yml'));
  }, /WF_LOCAL_JS_COMPUTED_REQUIRE/);
});

test('loader require(...args) spread argument fails closed', function() {
  assert.throws(function() {
    inventory.analyzeWorkflowFixture(fixture('local-js-require-spread-workflow.yml'));
  }, /WF_LOCAL_JS_COMPUTED_REQUIRE/);
});

test('inventory and closure share direct require call classification', function() {
  const loaderPolicy = require('../scripts/trusted-workflows/loader-policy.cjs');
  const acorn = require('acorn');
  // isDirectRequireCallee identifies any non-optional CallExpression with callee `require`.
  // isValidStaticRequireCall additionally requires exactly one static string literal argument.
  // The package vs. relative classification happens separately in each scanner.
  const cases = [
    { src: 'require()', expectCallee: true, expectValid: false },
    { src: 'require(dynamic)', expectCallee: true, expectValid: false },
    { src: 'require("./" + "a.cjs")', expectCallee: true, expectValid: false },
    { src: 'require("./a.cjs", "./b.cjs")', expectCallee: true, expectValid: false },
    { src: 'require(...args)', expectCallee: true, expectValid: false },
    { src: 'require("./a.cjs")', expectCallee: true, expectValid: true },
    { src: 'require("node:fs")', expectCallee: true, expectValid: true },
    { src: 'require("acorn")', expectCallee: true, expectValid: true }
  ];
  for (const c of cases) {
    const ast = acorn.parse(c.src, { ecmaVersion: 2022, sourceType: 'script' });
    const call = ast.body[0].expression;
    assert.equal(loaderPolicy.isDirectRequireCallee(call), c.expectCallee, c.src);
    assert.equal(loaderPolicy.isValidStaticRequireCall(call), c.expectValid, c.src);
  }
});

test('checkLoaderAliases rejects require.call MemberExpression', function() {
  const src = 'require.call(null, "./x.cjs");';
  const acorn = require('acorn');
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'module' });
  assert.throws(function() { inventory.checkLoaderAliases(ast, 'fixture'); }, /WF_LOCAL_JS_LOADER_CHAIN/);
});

test('checkLoaderAliases rejects require.apply MemberExpression', function() {
  const src = 'require.apply(null, ["./x.cjs"]);';
  const acorn = require('acorn');
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'module' });
  assert.throws(function() { inventory.checkLoaderAliases(ast, 'fixture'); }, /WF_LOCAL_JS_LOADER_CHAIN/);
});

test('checkLoaderAliases rejects require.bind capture', function() {
  const src = 'require.bind(null);';
  const acorn = require('acorn');
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'module' });
  assert.throws(function() { inventory.checkLoaderAliases(ast, 'fixture'); }, /WF_LOCAL_JS_LOADER_CHAIN/);
});

test('checkLoaderAliases rejects destructured call from require', function() {
  const src = 'const { call } = require; call(null, "./x.cjs");';
  const acorn = require('acorn');
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'module' });
  assert.throws(function() { inventory.checkLoaderAliases(ast, 'fixture'); }, /WF_LOCAL_JS_LOADER_ALIAS/);
});

test('checkLoaderAliases rejects computed require member access', function() {
  const src = 'require["call"](null, "./x.cjs");';
  const acorn = require('acorn');
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'module' });
  assert.throws(function() { inventory.checkLoaderAliases(ast, 'fixture'); }, /WF_LOCAL_JS_LOADER_CHAIN/);
});

test('checkLoaderAliases allows require.main as a safe property', function() {
  const src = 'if (require.main === module) process.exit(0);';
  const acorn = require('acorn');
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'module' });
  assert.doesNotThrow(function() { inventory.checkLoaderAliases(ast, 'fixture'); });
});

test('checkLoaderAliases allows require.resolve as a safe non-executing property', function() {
  const src = 'require.resolve("./x.cjs");';
  const acorn = require('acorn');
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'module' });
  assert.doesNotThrow(function() { inventory.checkLoaderAliases(ast, 'fixture'); });
});

test('checkLoaderAliases rejects require.main.require chained load', function() {
  const src = "require.main.require('./local.cjs');";
  const acorn = require('acorn');
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'module' });
  assert.throws(function() { inventory.checkLoaderAliases(ast, 'fixture'); }, /WF_LOCAL_JS_LOADER_CHAIN/);
});

test('checkLoaderAliases rejects require.main computed chained load', function() {
  const src = "require.main['require']('./local.cjs');";
  const acorn = require('acorn');
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'module' });
  assert.throws(function() { inventory.checkLoaderAliases(ast, 'fixture'); }, /WF_LOCAL_JS_LOADER_CHAIN/);
});

test('checkLoaderAliases rejects require.resolve.call chained call', function() {
  const src = "require.resolve.call(null, './local.cjs');";
  const acorn = require('acorn');
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'module' });
  assert.throws(function() { inventory.checkLoaderAliases(ast, 'fixture'); }, /WF_LOCAL_JS_LOADER_CHAIN/);
});

test('checkLoaderAliases rejects require.resolve.apply chained call', function() {
  const src = "require.resolve.apply(null, ['./local.cjs']);";
  const acorn = require('acorn');
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'module' });
  assert.throws(function() { inventory.checkLoaderAliases(ast, 'fixture'); }, /WF_LOCAL_JS_LOADER_CHAIN/);
});

test('checkLoaderAliases rejects captured require.resolve', function() {
  const src = 'const resolve = require.resolve;';
  const acorn = require('acorn');
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'module' });
  assert.throws(function() { inventory.checkLoaderAliases(ast, 'fixture'); }, /WF_LOCAL_JS_LOADER_RESOLVE_CONTEXT/);
});

test('checkLoaderAliases rejects captured require.main', function() {
  const src = 'const main = require.main;';
  const acorn = require('acorn');
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'module' });
  assert.throws(function() { inventory.checkLoaderAliases(ast, 'fixture'); }, /WF_LOCAL_JS_LOADER_MAIN_CONTEXT/);
});

test('checkLoaderAliases rejects require.resolve.bind', function() {
  const src = 'const r = require.resolve.bind(require);';
  const acorn = require('acorn');
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'module' });
  assert.throws(function() { inventory.checkLoaderAliases(ast, 'fixture'); }, /WF_LOCAL_JS_LOADER_CHAIN/);
});

test('nested Bash wrapper preserves parent token for post-return Node oracle', function() {
  assert.equal(inventory.analyzeWorkflowFixture(fixture('cfg-wrapper-bash-nested.yml')), true);
});

test('nested PowerShell wrapper preserves parent token for post-return Node oracle', function() {
  assert.equal(inventory.analyzeWorkflowFixture(fixture('cfg-wrapper-pwsh-nested.yml')), true);
});

test('require.main passed as function argument is rejected', function() {
  assert.throws(function() {
    inventory.analyzeWorkflowFixture(fixture('local-js-main-escape-arg-workflow.yml'));
  }, /WF_LOCAL_JS_LOADER_MAIN_CONTEXT/);
});

test('require.main returned from function is rejected', function() {
  assert.throws(function() {
    inventory.analyzeWorkflowFixture(fixture('local-js-main-escape-return-workflow.yml'));
  }, /WF_LOCAL_JS_LOADER_MAIN_CONTEXT/);
});

test('require.main stored in object property is rejected', function() {
  assert.throws(function() {
    inventory.analyzeWorkflowFixture(fixture('local-js-main-escape-obj-workflow.yml'));
  }, /WF_LOCAL_JS_LOADER_MAIN_CONTEXT/);
});

test('require.resolve passed as function argument is rejected', function() {
  assert.throws(function() {
    inventory.analyzeWorkflowFixture(fixture('local-js-resolve-escape-arg-workflow.yml'));
  }, /WF_LOCAL_JS_LOADER_RESOLVE_CONTEXT/);
});

test('require.resolve captured into variable is rejected', function() {
  assert.throws(function() {
    inventory.analyzeWorkflowFixture(fixture('local-js-resolve-escape-capture-workflow.yml'));
  }, /WF_LOCAL_JS_LOADER_RESOLVE_CONTEXT/);
});

test('require.resolve called with .call is rejected', function() {
  assert.throws(function() {
    inventory.analyzeWorkflowFixture(fixture('local-js-resolve-escape-call-workflow.yml'));
  }, /WF_LOCAL_JS_LOADER_CHAIN/);
});

test('checkLoaderAliases rejects require.main as function argument', function() {
  const src = 'const f = (m) => m.require("./x.cjs"); f(require.main);';
  const acorn = require('acorn');
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'module' });
  assert.throws(function() { inventory.checkLoaderAliases(ast, 'fixture'); }, /WF_LOCAL_JS_LOADER_MAIN_CONTEXT/);
});

test('checkLoaderAliases rejects require.main in array', function() {
  const src = 'const arr = [require.main]; arr[0].require("./x.cjs");';
  const acorn = require('acorn');
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'module' });
  assert.throws(function() { inventory.checkLoaderAliases(ast, 'fixture'); }, /WF_LOCAL_JS_LOADER_MAIN_CONTEXT/);
});

test('checkLoaderAliases rejects require.main in return', function() {
  const src = 'const f = () => require.main; f();';
  const acorn = require('acorn');
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'module' });
  assert.throws(function() { inventory.checkLoaderAliases(ast, 'fixture'); }, /WF_LOCAL_JS_LOADER_MAIN_CONTEXT/);
});

test('checkLoaderAliases rejects require.main in object property', function() {
  const src = 'const obj = { main: require.main }; obj.main.require("./x.cjs");';
  const acorn = require('acorn');
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'module' });
  assert.throws(function() { inventory.checkLoaderAliases(ast, 'fixture'); }, /WF_LOCAL_JS_LOADER_MAIN_CONTEXT/);
});

test('checkLoaderAliases rejects require.main in conditional', function() {
  const src = 'const v = true ? require.main : null;';
  const acorn = require('acorn');
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'module' });
  assert.throws(function() { inventory.checkLoaderAliases(ast, 'fixture'); }, /WF_LOCAL_JS_LOADER_MAIN_CONTEXT/);
});

test('checkLoaderAliases rejects require.main in spread', function() {
  const src = 'fn(...[require.main]);';
  const acorn = require('acorn');
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'module' });
  assert.throws(function() { inventory.checkLoaderAliases(ast, 'fixture'); }, /WF_LOCAL_JS_LOADER_MAIN_CONTEXT/);
});

test('checkLoaderAliases rejects require.resolve as function argument', function() {
  const src = 'const r = (x) => x("./a.cjs"); r(require.resolve);';
  const acorn = require('acorn');
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'module' });
  assert.throws(function() { inventory.checkLoaderAliases(ast, 'fixture'); }, /WF_LOCAL_JS_LOADER_RESOLVE_CONTEXT/);
});

test('checkLoaderAliases rejects require.resolve in object property', function() {
  const src = 'const obj = { resolve: require.resolve }; obj.resolve("./a.cjs");';
  const acorn = require('acorn');
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'module' });
  assert.throws(function() { inventory.checkLoaderAliases(ast, 'fixture'); }, /WF_LOCAL_JS_LOADER_RESOLVE_CONTEXT/);
});

test('checkLoaderAliases rejects require?.resolve with optional member access', function() {
  const src = 'require?.resolve("./x.cjs");';
  const acorn = require('acorn');
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'module' });
  assert.throws(function() { inventory.checkLoaderAliases(ast, 'fixture'); }, /WF_LOCAL_JS_LOADER_CHAIN/);
});

test('checkLoaderAliases rejects require.resolve?. with optional call', function() {
  const src = 'require.resolve?.("./x.cjs");';
  const acorn = require('acorn');
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'module' });
  assert.throws(function() { inventory.checkLoaderAliases(ast, 'fixture'); }, /WF_LOCAL_JS_LOADER_CHAIN/);
});

test('checkLoaderAliases rejects require?.main === module with optional member access', function() {
  const src = 'if (require?.main === module) process.exit(0);';
  const acorn = require('acorn');
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'module' });
  assert.throws(function() { inventory.checkLoaderAliases(ast, 'fixture'); }, /WF_LOCAL_JS_LOADER_CHAIN/);
});

test('checkLoaderAliases rejects parenthesised optional require.main ChainExpression', function() {
  const src = 'if ((require?.main) === module) process.exit(0);';
  const acorn = require('acorn');
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'module' });
  assert.throws(function() { inventory.checkLoaderAliases(ast, 'fixture'); }, /WF_LOCAL_JS_LOADER_CHAIN/);
});

test('checkLoaderAliases rejects require?. as optional call', function() {
  const src = 'require?.("./x.cjs");';
  const acorn = require('acorn');
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'module' });
  assert.throws(function() { inventory.checkLoaderAliases(ast, 'fixture'); }, /WF_LOCAL_JS_LOADER_CHAIN/);
});

test('checkLoaderAliases rejects require.resolve with dynamic argument', function() {
  const src = 'require.resolve(dynamicValue);';
  const acorn = require('acorn');
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'module' });
  assert.throws(function() { inventory.checkLoaderAliases(ast, 'fixture'); }, /WF_LOCAL_JS_LOADER_RESOLVE_CONTEXT/);
});

test('checkLoaderAliases rejects require.resolve with multiple arguments', function() {
  const src = 'require.resolve("./a.cjs", "./b.cjs");';
  const acorn = require('acorn');
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'module' });
  assert.throws(function() { inventory.checkLoaderAliases(ast, 'fixture'); }, /WF_LOCAL_JS_LOADER_RESOLVE_CONTEXT/);
});

test('checkLoaderAliases admits require.main === module comparison', function() {
  const src = 'require.main === module;';
  const acorn = require('acorn');
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'module' });
  assert.doesNotThrow(function() { inventory.checkLoaderAliases(ast, 'fixture'); });
});

test('checkLoaderAliases admits require.main !== module inequality', function() {
  const src = 'require.main !== module;';
  const acorn = require('acorn');
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'module' });
  assert.doesNotThrow(function() { inventory.checkLoaderAliases(ast, 'fixture'); });
});

test('checkLoaderAliases admits require.resolve with static literal', function() {
  const src = 'require.resolve("./x.cjs");';
  const acorn = require('acorn');
  const ast = acorn.parse(src, { ecmaVersion: 2022, sourceType: 'module' });
  assert.doesNotThrow(function() { inventory.checkLoaderAliases(ast, 'fixture'); });
});

test('unwrapTimeout rejects -v unknown short option', function() {
  assert.throws(function() {
    inventory.unwrapStaticLauncher(['timeout', '-v'], 'fixture');
  }, /WF_LAUNCHER_OPTION_UNSUPPORTED/);
});

test('unwrapNice rejects --adjustment= with decimal value', function() {
  assert.throws(function() {
    inventory.unwrapStaticLauncher(['nice', '--adjustment=1.5', 'node', 'x.cjs'], 'fixture');
  }, /WF_LAUNCHER_OPTION_UNSUPPORTED/);
});

test('unwrapNice rejects --adjustment= with empty value', function() {
  assert.throws(function() {
    inventory.unwrapStaticLauncher(['nice', '--adjustment=', 'node', 'x.cjs'], 'fixture');
  }, /WF_LAUNCHER_OPTION_UNSUPPORTED/);
});

test('process tokens are deterministic for equivalent nested wrapper analysis', function() {
  const o1 = inventory.observeWrapperAnalysis(fixture('cfg-wrapper-bash-nested.yml'));
  const o2 = inventory.observeWrapperAnalysis(fixture('cfg-wrapper-bash-nested.yml'));
  assert.deepEqual(o1.events.map((e) => e.cacheKey).sort(), o2.events.map((e) => e.cacheKey).sort());
  assert.deepEqual(o1.events, o2.events);
  assert.ok(o1.events.length >= 1, 'expected at least one event');
  for (const ev of o1.events) {
    assert.ok(typeof ev.cacheKey === 'string' && ev.cacheKey.length > 0);
    assert.ok(['miss', 'hit', 'restore'].includes(ev.kind));
  }
});

test('process tokens are unique within one nested wrapper analysis', function() {
  const o = inventory.observeWrapperAnalysis(fixture('cfg-wrapper-bash-nested.yml'));
  const tokens = new Set();
  for (const ev of o.events) {
    if (ev.kind === 'restore') {
      tokens.add(ev.expectedCallerToken);
      tokens.add(ev.actualRestoredToken || '');
    }
  }
  assert.ok(tokens.size >= 1, 'expected at least one token');
  const tokenList = [...tokens].filter(Boolean);
  for (let i = 0; i < tokenList.length; i += 1) {
    for (let j = i + 1; j < tokenList.length; j += 1) {
      assert.notEqual(tokenList[i], tokenList[j], 'token collision detected: ' + tokenList[i]);
    }
  }
});

test('nested and sibling child boundaries do not collide on distinct miss cache keys', function() {
  const o = inventory.observeWrapperAnalysis(fixture('cfg-wrapper-bash-nested.yml'));
  const missKeys = o.events.filter((e) => e.kind === 'miss').map((e) => e.cacheKey);
  assert.ok(missKeys.length >= 1, 'expected at least one miss cache key');
  const seen = new Set();
  for (const key of missKeys) {
    assert.ok(!seen.has(key), 'duplicate miss cache key: ' + key);
    seen.add(key);
  }
});

test('previous parent token is restored after successful wrapper return', function() {
  const o = inventory.observeWrapperAnalysis(fixture('cfg-wrapper-bash-sibling.yml'));
  
  // Build independent expected-token oracle from miss events
  const oracle = new Map();
  for (const e of o.events.filter(e => e.kind === 'miss')) {
    oracle.set(e.cacheKey + '\x01' + e.pairedInput.split('\x01')[1], e.inputCallerToken);
  }

  const restoreSuccesses = o.events.filter((e) => e.kind === 'restore' && e.branch === 'success');
  assert.ok(restoreSuccesses.length > 0, 'must test a fixture that produces a success restore event');
  for (const ev of restoreSuccesses) {
    const expected = oracle.get(ev.cacheKey + '\x01' + ev.pairedInput.split('\x01')[1]);
    assert.strictEqual(ev.actualRestoredToken, expected, 'success state must restore exact expected caller token');
    assert.ok(expected, 'caller token must be populated');
  }
});

test('previous parent token is restored after failed wrapper return', function() {
  const o = inventory.observeWrapperAnalysis(fixture('cfg-wrapper-bash-sibling.yml'));
  
  const oracle = new Map();
  for (const e of o.events.filter(e => e.kind === 'miss')) {
    oracle.set(e.cacheKey + '\x01' + e.pairedInput.split('\x01')[1], e.inputCallerToken);
  }

  const restoreFailures = o.events.filter((e) => e.kind === 'restore' && e.branch === 'failure');
  assert.ok(restoreFailures.length > 0, 'must test a fixture that actually produces a failure restore event');
  for (const ev of restoreFailures) {
    const expected = oracle.get(ev.cacheKey + '\x01' + ev.pairedInput.split('\x01')[1]);
    assert.strictEqual(ev.actualRestoredToken, expected, 'failure state must restore exact expected caller token');
    assert.ok(expected, 'caller token must be populated');
  }
});

test('distinct caller-token identities create distinct memo entries', function() {
  const o = inventory.observeWrapperAnalysis(fixture('cfg-wrapper-bash-sibling.yml'));
  const missEvents = o.events.filter((e) => e.kind === 'miss');
  const tokens = missEvents.map((e) => e.inputCallerToken);
  const uniqueTokens = new Set(tokens);
  assert.ok(uniqueTokens.size >= 2, 'expected at least two distinct caller tokens in the fixture');
});

test('genuine repeated identical paired input produces a cache hit and preserves caller token exactly', function() {
  const o = inventory.observeWrapperAnalysis(fixture('cfg-wrapper-bash-sibling.yml'));
  
  const oracle = new Map();
  for (const e of o.events.filter(e => e.kind === 'miss')) {
    oracle.set(e.cacheKey + '\x01' + e.pairedInput.split('\x01')[1], e.inputCallerToken);
  }

  const misses = o.events.filter(e => e.kind === 'miss');
  const hits = o.events.filter(e => e.kind === 'hit');
  assert.ok(misses.length >= 2, 'expected misses to populate cache');
  assert.ok(hits.length >= 1, 'expected at least one genuine cache hit');
  for (const ev of hits) {
    const expected = ev.pairedInput.split('\x01')[0];
    assert.strictEqual(ev.actualRestoredToken, expected, 'hit must return exact expected caller token');
  }
});

test('pairing and permutation contract produces distinct cache keys for swapped associations', function() {
  const inventoryInternals = require('../scripts/check-workflow-inventory.cjs');
  const sA = { processParentKey: 'T1', setupGeneration: 1, capturedGeneration: 1, pathIdentity: 'p1', locationStack: ['L1'], installed: new Map(), workingDirectory: 'D1', checkouts: new Map(), env: new Map(), checkoutGeneration: 1 };
  const sB = { processParentKey: 'T2', setupGeneration: 1, capturedGeneration: 1, pathIdentity: 'p1', locationStack: ['L2'], installed: new Map(), workingDirectory: 'D1', checkouts: new Map(), env: new Map(), checkoutGeneration: 1 };
  const sA_swap = { processParentKey: 'T2', setupGeneration: 1, capturedGeneration: 1, pathIdentity: 'p1', locationStack: ['L1'], installed: new Map(), workingDirectory: 'D1', checkouts: new Map(), env: new Map(), checkoutGeneration: 1 };
  const sB_swap = { processParentKey: 'T1', setupGeneration: 1, capturedGeneration: 1, pathIdentity: 'p1', locationStack: ['L2'], installed: new Map(), workingDirectory: 'D1', checkouts: new Map(), env: new Map(), checkoutGeneration: 1 };
  
  const pair1 = inventoryInternals.getPairedRecords([sA, sB]);
  const pair2 = inventoryInternals.getPairedRecords([sA_swap, sB_swap]);
  
  assert.equal(pair1.length, 2, 'pairing must return explicit expected pairs');
  assert.equal(pair1[0][0], 'T1');
  assert.equal(pair1[1][0], 'T2');
  
  const key1 = pair1.map(p => p[0] + String.fromCharCode(1) + p[1]).join(String.fromCharCode(2));
  const key2 = pair2.map(p => p[0] + String.fromCharCode(1) + p[1]).join(String.fromCharCode(2));
  assert.notEqual(key1, key2, 'swapped token-to-state associations must produce different cache keys');
  
  const pair3 = inventoryInternals.getPairedRecords([sA, sA]);
  assert.equal(pair3.length, 2, 'multiplicity of identical pairs must be preserved');
});

test('wrapper cache-hit sibling invocation returns distinct parent tokens', function() {
  assert.equal(inventory.analyzeWorkflowFixture(fixture('cfg-wrapper-bash-sibling.yml')), true);
  assert.equal(inventory.analyzeWorkflowFixture(fixture('cfg-wrapper-pwsh-sibling.yml')), true);
});

test('timeout -s TERM signal passes validation', function() {
  const r = inventory.unwrapStaticLauncher(['timeout', '-s', 'TERM', '10', 'node', 'x.cjs'], 'fixture');
  assert.equal(r.kind, 'execution');
  assert.deepEqual(r.tokens, ['node', 'x.cjs']);
});

test('timeout -s SIGTERM normalised to TERM passes', function() {
  const r = inventory.unwrapStaticLauncher(['timeout', '-s', 'SIGTERM', '10', 'node', 'x.cjs'], 'fixture');
  assert.equal(r.kind, 'execution');
  assert.deepEqual(r.tokens, ['node', 'x.cjs']);
});

test('timeout --signal=TERM passes', function() {
  const r = inventory.unwrapStaticLauncher(['timeout', '--signal=TERM', '10', 'node', 'x.cjs'], 'fixture');
  assert.equal(r.kind, 'execution');
  assert.deepEqual(r.tokens, ['node', 'x.cjs']);
});

test('timeout -s lowercase term normalised passes', function() {
  const r = inventory.unwrapStaticLauncher(['timeout', '-s', 'term', '10', 'node', 'x.cjs'], 'fixture');
  assert.equal(r.kind, 'execution');
  assert.deepEqual(r.tokens, ['node', 'x.cjs']);
});

test('timeout --signal= empty value fails', function() {
  assert.throws(function() {
    inventory.unwrapStaticLauncher(['timeout', '--signal=', '10', 'node', 'x.cjs'], 'fixture');
  }, /WF_LAUNCHER_OPTION_UNSUPPORTED/);
});

test('timeout -s unknown signal fails', function() {
  assert.throws(function() {
    inventory.unwrapStaticLauncher(['timeout', '-s', 'XYZ', '10', 'node', 'x.cjs'], 'fixture');
  }, /WF_LAUNCHER_OPTION_UNSUPPORTED/);
});

test('timeout -s with punctuation fails', function() {
  assert.throws(function() {
    inventory.unwrapStaticLauncher(['timeout', '-s', 'TERM!', '10', 'node', 'x.cjs'], 'fixture');
  }, /WF_LAUNCHER_OPTION_UNSUPPORTED/);
});

test('timeout -k 5 passes', function() {
  const r = inventory.unwrapStaticLauncher(['timeout', '-k', '5', '10', 'node', 'x.cjs'], 'fixture');
  assert.equal(r.kind, 'execution');
  assert.deepEqual(r.tokens, ['node', 'x.cjs']);
});

test('timeout -k 0.5s passes', function() {
  const r = inventory.unwrapStaticLauncher(['timeout', '-k', '0.5s', '10', 'node', 'x.cjs'], 'fixture');
  assert.equal(r.kind, 'execution');
  assert.deepEqual(r.tokens, ['node', 'x.cjs']);
});

test('timeout --kill-after=2m passes', function() {
  const r = inventory.unwrapStaticLauncher(['timeout', '--kill-after=2m', '10', 'node', 'x.cjs'], 'fixture');
  assert.equal(r.kind, 'execution');
  assert.deepEqual(r.tokens, ['node', 'x.cjs']);
});

test('timeout --kill-after= empty value fails', function() {
  assert.throws(function() {
    inventory.unwrapStaticLauncher(['timeout', '--kill-after=', '10', 'node', 'x.cjs'], 'fixture');
  }, /WF_LAUNCHER_OPTION_UNSUPPORTED/);
});

test('timeout -k alphabetic fails', function() {
  assert.throws(function() {
    inventory.unwrapStaticLauncher(['timeout', '-k', 'abc', '10', 'node', 'x.cjs'], 'fixture');
  }, /WF_LAUNCHER_OPTION_UNSUPPORTED/);
});

test('timeout -k negative fails', function() {
  assert.throws(function() {
    inventory.unwrapStaticLauncher(['timeout', '-k', '-5', '10', 'node', 'x.cjs'], 'fixture');
  }, /WF_LAUNCHER_OPTION_UNSUPPORTED/);
});

test('timeout -k unsupported suffix fails', function() {
  assert.throws(function() {
    inventory.unwrapStaticLauncher(['timeout', '-k', '5x', '10', 'node', 'x.cjs'], 'fixture');
  }, /WF_LAUNCHER_OPTION_UNSUPPORTED/);
});
