'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const auditScript = path.join(repoRoot, 'repo', 'scripts', 'audit-published-surfaces.cjs');
const audit = require(auditScript);
const legacyProjectToken = '_' + 'projects';
const legacyCuratedToken = 'curated_' + 'output_for_ai';
const publisherReferencePaths = [];
const standalonePublisherPaths = [
  'skills/skill-product-review/SKILL.md',
  'skills/skill-product-review/README.md',
  'skills/skill-product-review/references/README.md'
];
const historicalEvidencePaths = [
  'repo/docs/RETIRED-SOURCE-PROVENANCE.md',
  'repo/docs/audits/2026-07-15-native-codex-uat-remediation-audit.md'
];
const primitiveIds = [
  'retired-projects-source-root',
  'retired-main-source-root',
  'retired-curated-output-root',
  'retired-project-module',
  'retired-project-to-skill',
  'retired-source-to-surface',
  'retired-project-manifest',
  'retired-source-manifest',
  'retired-toolkit-project-manifest',
  'retired-generated-skill',
  'retired-generated-copy',
  'retired-generated-publication',
  'retired-deterministic-publication',
  'retired-generated-surface-writeback',
  'retired-project-output-publication',
  'retired-generated-pack-manifest',
  'retired-pack-packaging',
  'retired-publisher-infrastructure',
  'retired-sync-toolkit-projects-command',
  'retired-package-skills-command',
  'retired-package-packs-command'
];

function readText(relPath, root = repoRoot) {
  return fs.readFileSync(path.join(root, relPath), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}

function copyRepo() {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'surface-audit-'));
  fs.cpSync(repoRoot, target, {
    recursive: true,
    filter(source) {
      const rel = path.relative(repoRoot, source).replace(/\\/g, '/');
      return !(
        rel === '.git' || rel.startsWith('.git/') ||
        rel === 'node_modules' || rel.startsWith('node_modules/') ||
        rel === '.tmp' || rel.startsWith('.tmp/') ||
        rel === '_dist' || rel.startsWith('_dist/')
      );
    }
  });
  return target;
}

function runAudit(cwd, args = []) {
  return spawnSync(process.execPath, [auditScript, '--workspace', cwd, ...args], {
    cwd: os.tmpdir(),
    encoding: 'utf8'
  });
}

function readPolicy(root = repoRoot) {
  return JSON.parse(readText('repo/contracts/topology-scope-policy.json', root));
}

function writePolicy(root, mutate) {
  const policy = readPolicy(root);
  mutate(policy);
  fs.writeFileSync(
    path.join(root, 'repo', 'contracts', 'topology-scope-policy.json'),
    `${JSON.stringify(policy, null, 2)}\n`,
    'utf8'
  );
}

function assertPolicyRejects(label, mutate, expected) {
  const cwd = copyRepo();
  try {
    mutate(cwd);
    const result = runAudit(cwd, ['--json']);
    assert.notEqual(result.status, 0, label);
    assert.match(result.stdout, expected, label);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
}

test('canonical surface snapshot and checked baseline are clean', () => {
  const snapshot = audit.snapshot();
  assert.equal(snapshot.schema_version, 2);
  assert.equal(snapshot.project_tree_present, false);
  assert.deepEqual(snapshot.pack_manifests, []);
  assert.equal(snapshot.skills.includes('skills/knowledge-index-updater'), false);
  assert.deepEqual(audit.validate(snapshot), []);
  const result = runAudit(repoRoot, ['--check']);
  assert.equal(result.status, 0, result.stderr);
});

test('policy v2 owns the closed primitive, identity, and exact scope contracts', () => {
  const policy = readPolicy();
  assert.deepEqual(audit.validateTopologyScopePolicy(), []);
  assert.equal(policy.schema_version, 2);
  assert.equal(policy.default_scope, 'active-toolkit');
  assert.equal(policy.normalization, 'nfkc-lower-separator-v1');
  assert.deepEqual(policy.primitive_definitions.map((definition) => definition.id), primitiveIds);
  assert.deepEqual(policy.standalone_identity_definitions.map((definition) => definition.id), [
    'current-toolkit-identity',
    'current-toolkit-repository-identity',
    'current-repository-deictic-identity'
  ]);
  assert.deepEqual(
    policy.entries.filter((entry) => entry.scope === 'standalone-publisher').map((entry) => entry.path),
    standalonePublisherPaths
  );
  assert.deepEqual(
    policy.entries.filter((entry) => entry.scope === 'historical-evidence').map((entry) => entry.path),
    historicalEvidencePaths
  );
  assert.deepEqual(
    policy.entries.filter((entry) => entry.scope === 'non-operative-example').map((entry) => entry.path),
    publisherReferencePaths
  );
  assert.equal(audit.policyScopeForPath('repo/docs/audits/unlisted.md'), 'active-toolkit');
});

test('retired publisher references have no non-operative compatibility exemptions', () => {
  assert.deepEqual(publisherReferencePaths.filter(audit.legacyReferenceAllowed), []);
  assert.equal(audit.legacyReferenceAllowed('skills/skill-product-review/README.md'), false);
  assert.equal(audit.legacyReferenceAllowed('skills/skill-product-review/references/examples.md'), false);
});

test('primitive matching is policy-derived, normalized, and reports every occurrence with stable spans', () => {
  const fixtures = new Map([
    ['retired-projects-source-root', '_projects'],
    ['retired-main-source-root', '_main'],
    ['retired-curated-output-root', 'CURATED-output_for_AI'],
    ['retired-project-module', 'project_modules'],
    ['retired-project-to-skill', 'project to skills'],
    ['retired-source-to-surface', 'source_to_surfaces'],
    ['retired-project-manifest', 'project manifests'],
    ['retired-source-manifest', 'source_manifest'],
    ['retired-toolkit-project-manifest', 'toolkit.project.json'],
    ['retired-generated-skill', 'generated-skills'],
    ['retired-generated-copy', 'generated copies'],
    ['retired-generated-publication', 'generated_writeback'],
    ['retired-deterministic-publication', 'deterministic-publishing'],
    ['retired-generated-surface-writeback', 'generated_surface-writeback'],
    ['retired-project-output-publication', 'project_output publishing'],
    ['retired-generated-pack-manifest', 'generated_pack_manifests'],
    ['retired-pack-packaging', 'pack_packaging'],
    ['retired-publisher-infrastructure', 'context_preserving_ai_publisher-infrastructure'],
    ['retired-sync-toolkit-projects-command', 'sync-toolkit-projects.cjs'],
    ['retired-package-skills-command', 'package-skills.cjs'],
    ['retired-package-packs-command', 'package-packs.cjs']
  ]);
  for (const [id, fixture] of fixtures) {
    assert.ok(audit.detectRetiredTopologyAtoms(fixture).some((atom) => atom.id === id), `${id}: ${fixture}`);
  }

  const source = 'project module\nordinary\nPROJECT_MODULE';
  const matches = audit.detectRetiredTopologyAtoms(source).filter((atom) => atom.id === 'retired-project-module');
  assert.equal(matches.length, 2);
  assert.deepEqual(matches.map((match) => match.lineNumber), [1, 3]);
  assert.deepEqual(matches.map((match) => source.slice(match.sourceSpan.start, match.sourceSpan.end)), ['project module', 'PROJECT_MODULE']);
  assert.ok(matches.every((match) => match.message.includes(match.id)));
});

test('active scope rejects primitive occurrences without heading, prose, order, or negation exemptions', () => {
  const fixtures = [
    'No project module is maintained.',
    '## Historical evidence\nEarlier operation used project modules.',
    '<!-- project module -->',
    '```text\nproject module\n```',
    'A generated skill appears before a project module.',
    'project\nmodule'
  ];
  for (const fixture of fixtures) {
    assert.notEqual(audit.activeTopologyFinding(fixture, 'repo/docs/fixture.md'), null, fixture);
  }
  assert.equal(audit.activeTopologyFinding('Maintain skills directly under `skills/**`.', 'repo/docs/fixture.md'), null);
});

test('standalone publisher P1 uses document-level identity and closed dispositions', () => {
  const rel = standalonePublisherPaths[0];
  const generic = 'A project module can maintain portable outputs for a target repository.';
  assert.equal(audit.activeTopologyFinding(generic, rel), null);

  const conflict = audit.activeTopologyFinding(`${generic}\nThis repository has separate instructions.`, rel);
  assert.ok(conflict);
  assert.equal(conflict.conflict, true);
  assert.equal(conflict.id, 'retired-project-module');
  assert.ok(conflict.identities.some((identity) => identity.id === 'current-repository-deictic-identity'));

  assert.notEqual(audit.activeTopologyFinding('Use _main for a target repository.', rel), null);
  assert.notEqual(audit.activeTopologyFinding('Run sync-toolkit-projects.cjs.', rel), null);
  assert.equal(audit.activeTopologyFinding('A project module is described here.', historicalEvidencePaths[0]), null);
  assert.notEqual(audit.activeTopologyFinding('This repository uses a project module.', 'skills/skill-product-review/references/examples.md'), null);
  assert.equal(audit.activeTopologyFinding('Use toolkit.project.json with a project module.', rel), null);
});

test('active scan membership is rule-derived and includes roots, docs, contracts, and nested skill entrypoints', () => {
  const activeFiles = audit.activePolicyFiles();
  for (const relPath of [
    'AGENTS.md',
    'CLAUDE.md',
    'GEMINI.md',
    'README.md',
    'repo/contracts/source-of-truth-contract.md',
    'repo/docs/FOR_AI_AGENTS.md',
    'skills/skill-product-review/SKILL.md',
    'skills/skill-product-review/README.md',
    'skills/frontend-art-direction/INSTALL.md'
  ]) assert.ok(activeFiles.includes(relPath), relPath);
  assert.equal(activeFiles.includes('repo/contracts/topology-scope-policy.json'), false);
  for (const relPath of activeFiles) {
    assert.deepEqual(audit.activeTopologyFindings(readText(relPath), relPath), [], relPath);
  }
});

test('retired structural and negation APIs are absent', () => {
  assert.equal(audit.structuralEvidenceUnits, undefined);
  assert.equal(audit.selfRepositoryIdentityMatches, undefined);
  assert.equal(audit.findAlias, undefined);
  assert.equal(audit.findAliasPairSameClause, undefined);
  assert.equal(audit.topologyAtomIds, undefined);
});

test('policy validation fails closed for malformed definitions and broad scopes', () => {
  const policyPath = path.join('repo', 'contracts', 'topology-scope-policy.json');
  const cases = [
    ['missing policy', (cwd) => fs.rmSync(path.join(cwd, policyPath)), /Missing topology scope policy/],
    ['malformed JSON', (cwd) => fs.writeFileSync(path.join(cwd, policyPath), '{\n', 'utf8'), /not valid JSON/],
    ['unknown top-level key', (cwd) => writePolicy(cwd, (policy) => { policy.unexpected = true; }), /unsupported or missing top-level keys/],
    ['wrong schema', (cwd) => writePolicy(cwd, (policy) => { policy.schema_version = 1; }), /schema_version/],
    ['definition removed', (cwd) => writePolicy(cwd, (policy) => { policy.primitive_definitions.pop(); }), /exactly 21 definitions/],
    ['empty aliases', (cwd) => writePolicy(cwd, (policy) => { policy.primitive_definitions[0].aliases = []; }), /non-empty array/],
    ['separator-only alias', (cwd) => writePolicy(cwd, (policy) => { policy.primitive_definitions[3].aliases[0] = '---'; }), /matchable characters/],
    ['duplicate normalized alias', (cwd) => writePolicy(cwd, (policy) => { policy.primitive_definitions[3].aliases[1] = 'project_module'; }), /duplicates normalized alias/],
    ['duplicate identity alias', (cwd) => writePolicy(cwd, (policy) => { policy.standalone_identity_definitions[0].aliases[1] = 'toolkit'; }), /duplicates normalized alias/],
    ['cross-class exact alias', (cwd) => writePolicy(cwd, (policy) => { policy.standalone_identity_definitions[2].aliases[0] = 'project module'; }), /duplicates normalized alias from primitive_definitions\.retired-project-module/],
    ['cross-class normalized alias', (cwd) => writePolicy(cwd, (policy) => { policy.standalone_identity_definitions[2].aliases[0] = 'project_module'; }), /duplicates normalized alias from primitive_definitions\.retired-project-module/],
    ['duplicate identity ID', (cwd) => writePolicy(cwd, (policy) => { policy.standalone_identity_definitions[1].id = policy.standalone_identity_definitions[0].id; }), /id is duplicated/],
    ['cross-class duplicate ID', (cwd) => writePolicy(cwd, (policy) => { policy.standalone_identity_definitions[0].id = policy.primitive_definitions[0].id; }), /id is duplicated/],
    ['unsupported matcher', (cwd) => writePolicy(cwd, (policy) => { policy.primitive_definitions[0].matcher_kind = 'regex'; }), /matcher_kind is unsupported/],
    ['unsupported disposition', (cwd) => writePolicy(cwd, (policy) => { policy.primitive_definitions[0].standalone_disposition = 'allowed'; }), /standalone_disposition is unsupported/],
    ['identity removed', (cwd) => writePolicy(cwd, (policy) => { policy.standalone_identity_definitions.pop(); }), /exactly 3 definitions/],
    ['duplicate path', (cwd) => writePolicy(cwd, (policy) => { policy.entries.push({ ...policy.entries[0] }); }), /duplicated/],
    ['unsupported scope', (cwd) => writePolicy(cwd, (policy) => { policy.entries[0].scope = 'active-toolkit'; }), /unsupported/],
    ['wildcard path', (cwd) => writePolicy(cwd, (policy) => { policy.entries[0].path = 'repo\/docs\/**'; }), /canonical|missing/],
    ['directory prefix', (cwd) => writePolicy(cwd, (policy) => { policy.entries[0].path = 'repo/docs/'; }), /canonical/],
    ['missing target', (cwd) => writePolicy(cwd, (policy) => { policy.entries[0].path = 'repo/docs/missing.md'; }), /target is missing/]
  ];
  for (const [label, mutate, expected] of cases) assertPolicyRejects(label, mutate, expected);
});

test('audit check rejects a cross-class policy alias collision', () => {
  const cwd = copyRepo();
  try {
    writePolicy(cwd, (policy) => {
      policy.standalone_identity_definitions[0].aliases.push('project module');
    });
    const result = runAudit(cwd, ['--check']);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /duplicates normalized alias from primitive_definitions\.retired-project-module/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});

test('copied workspaces reject new active primitive and legacy path residue', () => {
  const cwd = copyRepo();
  try {
    fs.writeFileSync(path.join(cwd, 'repo', 'docs', 'active-fixture.md'), 'No project module is used.\n', 'utf8');
    fs.writeFileSync(
      path.join(cwd, 'skills', 'n8n-environment-setup', 'references', 'legacy-fixture.md'),
      `${legacyProjectToken}/fixture/${legacyCuratedToken}/file.md\n`,
      'utf8'
    );
    const result = runAudit(cwd, ['--json']);
    assert.notEqual(result.status, 0);
    assert.match(result.stdout, /retired-project-module/);
    assert.match(result.stdout, /references the retired project\/publisher topology/);
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
  }
});
