#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const RESULT_SCHEMA = 'tk.security.protected-toolkit-invariant-result/v1';
const SAFE_ID = /^TK023-INV-[A-Z0-9-]{1,64}$/;
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const MAX_FILES = 256;
const MAX_BYTES = 2 * 1024 * 1024;

function parseArgs(argv) {
  const result = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith('--')) {
      result._.push(value);
      continue;
    }
    const key = value.slice(2);
    const next = argv[index + 1];
    if (next && !next.startsWith('--')) {
      result[key] = next;
      index += 1;
    } else {
      result[key] = true;
    }
  }
  return result;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function digest(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(
    typeof value === 'string' ? value : JSON.stringify(canonical(value))
  );
  return `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`;
}

function containedFile(root, relative) {
  if (
    typeof relative !== 'string' ||
    path.isAbsolute(relative) ||
    relative.replace(/\\/g, '/').split('/').includes('..')
  ) throw new Error('TK023_INVARIANT_INPUT_PATH_INVALID');
  const resolvedRoot = path.resolve(root);
  const full = path.resolve(resolvedRoot, relative);
  const relation = path.relative(resolvedRoot, full);
  if (!relation || relation === '..' || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation)) {
    throw new Error('TK023_INVARIANT_INPUT_OUTSIDE_ROOT');
  }
  const stat = fs.lstatSync(full);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_BYTES) {
    throw new Error('TK023_INVARIANT_INPUT_REDIRECTED_OR_OVERSIZE');
  }
  const real = fs.realpathSync.native(full);
  const realRelation = path.relative(resolvedRoot, real);
  if (!realRelation || realRelation === '..' || realRelation.startsWith(`..${path.sep}`) || path.isAbsolute(realRelation)) {
    throw new Error('TK023_INVARIANT_INPUT_REDIRECTED');
  }
  return full;
}

function readText(root, relative, records) {
  const full = containedFile(root, relative);
  const bytes = fs.readFileSync(full);
  records.push({ path: relative.replace(/\\/g, '/'), sha256: digest(bytes) });
  return bytes.toString('utf8');
}

function readJson(root, relative, records) {
  return JSON.parse(readText(root, relative, records));
}

function workflowTexts(root, records) {
  const directory = path.join(root, '.github', 'workflows');
  if (!fs.existsSync(directory)) throw new Error('TK023_INVARIANT_WORKFLOW_DIRECTORY_MISSING');
  const names = fs.readdirSync(directory)
    .filter((name) => /\.ya?ml$/i.test(name))
    .sort((left, right) => left.localeCompare(right, 'en'));
  if (names.length > MAX_FILES) throw new Error('TK023_INVARIANT_WORKFLOW_BOUND');
  return names.map((name) => readText(root, `.github/workflows/${name}`, records));
}

function exactPermissions(document) {
  const expected = {
    actions: 'write',
    checks: 'write',
    statuses: 'write',
    contents: 'read',
    pull_requests: 'read',
    metadata: 'read'
  };
  return JSON.stringify(canonical(document?.app?.permissions)) === JSON.stringify(canonical(expected)) &&
    document?.app?.commit_status_publication === false &&
    Array.isArray(document?.app?.forbidden_permissions) &&
    document.app.forbidden_permissions.includes('contents_write') &&
    document.app.forbidden_permissions.includes('workflows_write') &&
    document.app.forbidden_permissions.includes('administration');
}

function checkProperty(id, context) {
  if (id === 'TK023-INV-APP-PERMISSION-BOUNDARY') {
    const document = context.fixture?.document || readJson(
      context.authorityRoot,
      '_projects/cicd/repository-security-gate/_main/config/required-check-producers.json',
      context.records
    );
    return exactPermissions(document);
  }
  if (id === 'TK023-INV-CANDIDATE-WORKFLOWS-NONPUBLISHING') {
    const texts = context.fixture?.texts || workflowTexts(context.candidateRoot, context.records);
    return texts.every((text) =>
      !/\b(?:checks|statuses)\s*:\s*write\b/i.test(text) &&
      !/\/(?:check-runs|statuses)(?:\/|["'])/i.test(text) &&
      !/^\s*name\s*:\s*(?:Repository security gate|Validate|Validate Toolkit)\s*$/im.test(text) &&
      !/\bpull_request_target\s*:/i.test(text)
    );
  }
  if (id === 'TK023-INV-STATIC-TERMINAL-STRUCTURE') {
    const text = context.fixture?.text || readText(
      context.authorityRoot,
      '.github/workflows/repository-security-gate.yml',
      context.records
    );
    const required = [
      ['repository-security-terminal', 'TK-023 authority / repository security terminal'],
      ['validate-terminal', 'TK-023 authority / validate terminal'],
      ['validate-toolkit-terminal', 'TK-023 authority / validate toolkit terminal']
    ];
    return required.every(([job, name]) => {
      const start = text.indexOf(`\n  ${job}:\n`);
      if (start < 0) return false;
      const tail = text.slice(start + 1);
      const nextMatch = /\n  [A-Za-z0-9_-]+:\n/.exec(tail.slice(`  ${job}:\n`.length));
      const next = nextMatch ? start + 1 + `  ${job}:\n`.length + nextMatch.index : text.length;
      const block = text.slice(start, next);
      return block.includes(`name: ${name}`) &&
        block.includes('if: ${{ always() }}') &&
        !block.includes('continue-on-error:') &&
        !block.includes('\n    uses:');
    });
  }
  if (id === 'TK023-INV-SUPPRESSION-AUTHORITY-ONLY') {
    const trusted = context.fixture?.trusted || readText(
      context.authorityRoot,
      '_projects/cicd/repository-security-gate/_main/tools/trusted-security-gate.cjs',
      context.records
    );
    const core = context.fixture?.core || readText(
      context.authorityRoot,
      '_projects/cicd/repository-security-gate/_main/tools/security-gate.cjs',
      context.records
    );
    return trusted.includes("active_suppressions: binding(authorityRoot, 'skills/repository-security-gate/config/active-suppressions.json')") &&
      trusted.includes("'--trusted-authority-file'") &&
      core.includes("const ACTIVE_SUPPRESSIONS_PATH = path.join(PACK_ROOT, 'config', 'active-suppressions.json')") &&
      core.includes("const SUPPRESSION_PROPOSALS_PATH = 'repo/security/security-gate-suppression-proposals.json'");
  }
  if (id === 'TK023-INV-REPORT-PRIVACY') {
    const policy = context.fixture?.policy || readJson(
      context.authorityRoot,
      '_projects/cicd/repository-security-gate/_main/config/security-policy.json',
      context.records
    );
    const schema = context.fixture?.schema || readJson(
      context.authorityRoot,
      '_projects/cicd/repository-security-gate/_main/schemas/report.schema.json',
      context.records
    );
    const forbidden = ['source', 'excerpt', 'environment', 'raw_output', 'absolute_path', 'secret'];
    return schema.additionalProperties === false &&
      forbidden.every((field) => policy?.forbidden_report_fields?.includes(field)) &&
      forbidden.every((field) => !Object.prototype.hasOwnProperty.call(schema.properties || {}, field));
  }
  if (id === 'TK023-INV-PROTECTED-GENERATOR-DATA-ONLY') {
    const lock = context.fixture?.lock || readJson(
      context.authorityRoot,
      '_projects/cicd/repository-security-gate/_main/config/protected-generator-lock.json',
      context.records
    );
    const authority = context.fixture?.authority || readJson(
      context.authorityRoot,
      '_projects/cicd/repository-security-gate/_main/config/required-check-producers.json',
      context.records
    );
    return lock.network === false &&
      lock.candidate_writeback === false &&
      Array.isArray(lock.runtime?.external_packages) &&
      lock.runtime.external_packages.length === 0 &&
      authority.generated_surface?.writeback === false;
  }
  if (id === 'TK023-INV-APP-PUBLISHER-UNIQUE') {
    const config = context.fixture?.config || readJson(
      context.authorityRoot,
      '_projects/cicd/repository-security-gate/_main/config/required-check-producers.json',
      context.records
    );
    const files = context.fixture?.files || (config.app?.source_files || []).map((relative) => ({
      path: relative,
      text: readText(context.authorityRoot, `${config.app.source_root}/${relative}`, context.records)
    }));
    const checkPublishers = files.filter((item) => /\/check-runs\b/.test(item.text));
    const statusPublishers = files.filter((item) => /\/statuses\b/.test(item.text));
    return config.app?.publisher_module === 'src/check-publisher.mjs' &&
      checkPublishers.length === 1 &&
      checkPublishers[0].path === config.app.publisher_module &&
      statusPublishers.length === 0;
  }
  throw new Error('TK023_INVARIANT_ID_UNKNOWN');
}

function runOne(id, authorityRoot, candidateRoot, fixture) {
  if (!SAFE_ID.test(id)) throw new Error('TK023_INVARIANT_ID_INVALID');
  const records = [];
  let status = 'PASS';
  let diagnostic = 'TK023_INVARIANT_PROPERTY_SATISFIED';
  try {
    if (!checkProperty(id, { authorityRoot, candidateRoot, records, fixture })) {
      status = 'FINDINGS';
      diagnostic = 'TK023_INVARIANT_PROPERTY_VIOLATED';
    }
  } catch {
    status = 'UNVERIFIED';
    diagnostic = 'TK023_INVARIANT_INPUT_UNVERIFIED';
  }
  const inputManifest = [...records].sort((left, right) => left.path.localeCompare(right.path, 'en'));
  return {
    schema: RESULT_SCHEMA,
    invariant_id: id,
    status,
    diagnostic_id: diagnostic,
    input_manifest_digest: digest(inputManifest),
    input_count: inputManifest.length
  };
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const command = args._[0];
  if (command === 'run') {
    const result = runOne(
      String(args.id || ''),
      path.resolve(args['authority-root'] || ''),
      path.resolve(args['candidate-root'] || ''),
      null
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
    process.exitCode = result.status === 'PASS' ? 0 : result.status === 'FINDINGS' ? 1 : 2;
    return;
  }
  if (command === 'self-test') {
    const fixturePath = path.resolve(args.fixtures || '');
    const document = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
    if (document.schema !== 'tk.security.protected-toolkit-invariant-negative-fixtures/v1') {
      throw new Error('TK023_INVARIANT_FIXTURE_SCHEMA_INVALID');
    }
    const results = document.cases.map((fixture) =>
      runOne(fixture.id, path.dirname(fixturePath), path.dirname(fixturePath), fixture.input)
    );
    if (results.some((result) => result.status !== 'FINDINGS')) {
      throw new Error('TK023_INVARIANT_NEGATIVE_FIXTURE_DID_NOT_FAIL');
    }
    process.stdout.write(`${JSON.stringify({ status: 'PASS', count: results.length, digest: digest(results) })}\n`);
    return;
  }
  throw new Error('Usage: protected-toolkit-invariants.cjs <run|self-test>');
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write('TK023_PROTECTED_INVARIANT_FAILED\n');
    process.exitCode = 2;
  }
}

module.exports = { checkProperty, runOne };
