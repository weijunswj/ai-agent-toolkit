#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SHA40 = /^[0-9a-f]{40}$/;

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function slash(value) {
  return String(value).replace(/\\/g, '/').split(path.sep).join('/');
}

function within(root, target) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) {
      args._.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

function git(root, args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
    env: trustedEnvironment()
  });
  if (result.error || result.status !== 0) throw new Error(`git ${args[0]} failed`);
  return result.stdout.trim();
}

function trustedEnvironment() {
  const env = {};
  for (const name of ['PATH', 'HOME', 'SystemRoot', 'WINDIR', 'ComSpec', 'PATHEXT', 'TEMP', 'TMP', 'LANG', 'LC_ALL']) {
    if (process.env[name]) env[name] = process.env[name];
  }
  env.CI = 'true';
  return env;
}

function regularContainedFile(root, relative) {
  const full = path.resolve(root, relative);
  if (!within(root, full) || !fs.existsSync(full)) throw new Error(`Trusted binding is missing: ${relative}`);
  const status = fs.lstatSync(full);
  if (!status.isFile() || status.isSymbolicLink()) throw new Error(`Trusted binding is redirected: ${relative}`);
  return full;
}

function binding(root, relative) {
  const full = regularContainedFile(root, relative);
  return {
    path: slash(relative),
    sha256: `sha256:${sha256(fs.readFileSync(full))}`
  };
}

function exactCommit(root, revision, label) {
  if (!SHA40.test(revision || '')) throw new Error(`${label} must be an exact 40-character commit`);
  const resolved = git(root, ['rev-parse', '--verify', `${revision}^{commit}`]).toLowerCase();
  if (resolved !== revision) throw new Error(`${label} did not resolve exactly`);
  return resolved;
}

function buildAuthority(args) {
  const authorityRoot = path.resolve(args['authority-root'] || '.');
  const candidateRoot = path.resolve(args['candidate-root'] || '');
  const reportRoot = path.resolve(args['report-root'] || '');
  const toolsRoot = path.resolve(args['tools-dir'] || '');
  const scannerRoot = path.resolve(args['scanner-home'] || '');
  const sandboxRoot = path.resolve(args['sandbox-home'] || '');
  const candidateHead = String(args['candidate-head'] || '').toLowerCase();
  const targetRepository = String(args['target-repository'] || '');
  const candidateRepository = String(args['candidate-repository'] || '');
  const mode = String(args['authority-mode'] || '');
  if (
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(targetRepository) ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(candidateRepository)
  ) {
    throw new Error('Target and candidate repositories must use exact owner/name identities');
  }
  if (!['protected-base', 'bootstrap-immutable-review'].includes(mode)) {
    throw new Error('Authority mode must be protected-base or bootstrap-immutable-review');
  }
  if (
    !fs.existsSync(candidateRoot) ||
    !fs.existsSync(reportRoot) ||
    !fs.existsSync(toolsRoot) ||
    !fs.existsSync(scannerRoot) ||
    !fs.existsSync(sandboxRoot)
  ) {
    throw new Error('Candidate and all operation-owned roots must already exist');
  }
  for (const [leftName, left, rightName, right] of [
    ['authority', authorityRoot, 'candidate', candidateRoot],
    ['authority', authorityRoot, 'report', reportRoot],
    ['authority', authorityRoot, 'tools', toolsRoot],
    ['authority', authorityRoot, 'scanner home', scannerRoot],
    ['authority', authorityRoot, 'invariant home', sandboxRoot],
    ['candidate', candidateRoot, 'report', reportRoot],
    ['candidate', candidateRoot, 'tools', toolsRoot],
    ['candidate', candidateRoot, 'scanner home', scannerRoot],
    ['candidate', candidateRoot, 'invariant home', sandboxRoot],
    ['report', reportRoot, 'scanner home', scannerRoot],
    ['report', reportRoot, 'invariant home', sandboxRoot],
    ['tools', toolsRoot, 'scanner home', scannerRoot],
    ['tools', toolsRoot, 'invariant home', sandboxRoot],
    ['scanner home', scannerRoot, 'invariant home', sandboxRoot]
  ]) {
    if (left === right || within(left, right) || within(right, left)) {
      throw new Error(`${leftName} and ${rightName} roots must be separate`);
    }
  }
  const commit = exactCommit(authorityRoot, git(authorityRoot, ['rev-parse', 'HEAD']).toLowerCase(), 'authority HEAD');
  const tree = git(authorityRoot, ['rev-parse', `${commit}^{tree}`]).toLowerCase();
  if (!SHA40.test(tree)) throw new Error('Authority tree identity is invalid');
  if (git(authorityRoot, ['status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching'])) {
    throw new Error('Trusted authority checkout must be clean');
  }
  exactCommit(candidateRoot, candidateHead, 'candidate head');
  if (git(candidateRoot, ['rev-parse', 'HEAD']).toLowerCase() !== candidateHead) {
    throw new Error('Candidate checkout does not match the exact event head');
  }
  const bindings = {
    workflow: binding(authorityRoot, '.github/workflows/repository-security-gate.yml'),
    runner: binding(authorityRoot, 'skills/repository-security-gate/tools/security-gate.cjs'),
    trusted_runner: binding(authorityRoot, 'skills/repository-security-gate/tools/trusted-security-gate.cjs'),
    policy: binding(authorityRoot, 'skills/repository-security-gate/config/security-policy.json'),
    rules: binding(authorityRoot, 'skills/repository-security-gate/rules/toolkit-rules.json'),
    tool_lock: binding(authorityRoot, 'skills/repository-security-gate/config/tool-lock.json'),
    installer: binding(authorityRoot, 'skills/repository-security-gate/tools/install-pinned-tools.cjs'),
    report_schema: binding(authorityRoot, 'skills/repository-security-gate/schemas/report.schema.json'),
    suppression_schema: binding(authorityRoot, 'skills/repository-security-gate/schemas/suppressions.schema.json'),
    invariant_schema: binding(authorityRoot, 'skills/repository-security-gate/schemas/consumer-invariants.schema.json')
  };
  const invokingWorkflowDigest = String(args['invoking-workflow-digest'] || '');
  const invokingWorkflowCommit = String(args['invoking-workflow-commit'] || '').toLowerCase();
  if (!/^sha256:[0-9a-f]{64}$/.test(invokingWorkflowDigest) || !SHA40.test(invokingWorkflowCommit)) {
    throw new Error('Invoking workflow digest and commit must be exact');
  }
  if (
    mode === 'protected-base' &&
    (invokingWorkflowDigest !== bindings.workflow.sha256 || invokingWorkflowCommit !== commit)
  ) {
    throw new Error('Protected workflow identity does not match the trusted authority checkout');
  }
  const policy = JSON.parse(fs.readFileSync(path.resolve(authorityRoot, bindings.policy.path), 'utf8'));
  const authority = {
    schema_version: 1,
    mode,
    commit,
    tree,
    gate_version: policy.policy_version,
    target_repository: targetRepository,
    candidate_repository: candidateRepository,
    candidate_head: candidateHead,
    bindings,
    invoking_workflow: {
      commit: invokingWorkflowCommit,
      sha256: invokingWorkflowDigest
    },
    checkout_topology: {
      trusted_gate: 'trusted-gate',
      scanned_candidate: 'candidate',
      operation_tools: 'operation/tools',
      operation_reports: 'operation/reports',
      operation_scanner_home: 'operation/scanner-home',
      operation_invariant_home: 'operation/invariant-home',
      executable_candidate_code: 'isolated-no-secret-no-network-worker-only'
    },
    promotion_contract: 'candidate gate changes are scanned as data and become authority only after protected merge',
    manifest_digest: null
  };
  const unsigned = { ...authority };
  delete unsigned.manifest_digest;
  authority.manifest_digest = `sha256:${sha256(JSON.stringify(unsigned))}`;
  return authority;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args._[0] !== 'run') throw new Error('Usage: trusted-security-gate.cjs run [trusted topology arguments]');
  const authority = buildAuthority(args);
  const reportRoot = path.resolve(args['report-root']);
  const authorityFile = path.join(reportRoot, 'trusted-authority.json');
  fs.writeFileSync(authorityFile, `${JSON.stringify(authority, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  const authorityRoot = path.resolve(args['authority-root']);
  const core = regularContainedFile(authorityRoot, 'skills/repository-security-gate/tools/security-gate.cjs');
  const forwarded = [
    'scan',
    '--mode', String(args.mode),
    '--repo', path.resolve(args['candidate-root']),
    '--target-repository', String(args['target-repository']),
    '--candidate-repository', String(args['candidate-repository']),
    '--head', String(args['candidate-head']),
    '--tools-dir', path.resolve(args['tools-dir']),
    '--report-root', reportRoot,
    '--trusted-authority-file', authorityFile
  ];
  if (args.base) forwarded.push('--base', String(args.base));
  if (args['artifact-digest']) forwarded.push('--artifact-digest', String(args['artifact-digest']));
  if (args['run-invariants']) forwarded.push('--run-invariants');
  if (args['preflight-failed']) forwarded.push('--preflight-failed');
  if (args['install-failed']) forwarded.push('--install-failed');
  if (args['sandbox-uid']) forwarded.push('--sandbox-uid', String(args['sandbox-uid']));
  if (args['sandbox-gid']) forwarded.push('--sandbox-gid', String(args['sandbox-gid']));
  if (args['sandbox-home']) forwarded.push('--sandbox-home', path.resolve(args['sandbox-home']));
  if (args['scanner-home']) forwarded.push('--scanner-home', path.resolve(args['scanner-home']));
  if (args.suppressions) forwarded.push('--suppressions', String(args.suppressions));
  const result = spawnSync(process.execPath, [core, ...forwarded], {
    cwd: authorityRoot,
    encoding: 'utf8',
    stdio: 'inherit',
    env: trustedEnvironment()
  });
  if (result.error) throw result.error;
  return Number.isInteger(result.status) ? result.status : 2;
}

if (require.main === module) {
  try {
    process.exitCode = main();
  } catch (error) {
    process.stderr.write(`SECURITY_GATE_UNVERIFIED: ${error.message}\n`);
    process.exitCode = 2;
  }
}

module.exports = { buildAuthority, main };
