'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const validateScript = path.join(repoRoot, 'repo', 'scripts', 'validate-toolkit.cjs');
const syncScript = path.join(repoRoot, 'repo', 'scripts', 'sync-toolkit-projects.cjs');
const contractScript = path.join(repoRoot, 'repo', 'scripts', 'sync-repo-doc-contract.cjs');
const auditScript = path.join(repoRoot, 'repo', 'scripts', 'audit-project-source-locks.cjs');
const validator = require(validateScript);
const safeSourceUpdate = require(path.join(repoRoot, 'repo', 'scripts', 'safe-source-update.cjs'));
const sourceWatcher = require(path.join(repoRoot, 'repo', 'scripts', 'watch-project-sources.cjs'));

function tempCopy() {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-validate-'));
  fs.cpSync(repoRoot, target, {
    recursive: true,
    filter(source) {
      const rel = path.relative(repoRoot, source).replace(/\\/g, '/');
      if (!rel) return true;
      return !(
        rel === '.git' ||
        rel.startsWith('.git/') ||
        rel === 'node_modules' ||
        rel.startsWith('node_modules/') ||
        rel === '_dist' ||
        rel.startsWith('_dist/')
      );
    }
  });
  return target;
}

function runValidate(cwd) {
  return spawnSync(process.execPath, [validateScript], { cwd, encoding: 'utf8' });
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function readTextFile(filePath) {
  return fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

function secureCicdPromptFromReadme(rootDir = repoRoot) {
  const readme = readTextFile(path.join(rootDir, '_projects', 'cicd', 'secure-installer', '_main', 'README.md'));
  const start = '# Copy this prompt into your AI coding agent';
  const end = '\n---\n\n## What the AI agent should generate';
  const startIndex = readme.indexOf(start);
  assert.notEqual(startIndex, -1, 'Secure CI/CD prompt start marker');
  const endIndex = readme.indexOf(end, startIndex + start.length);
  assert.notEqual(endIndex, -1, 'Secure CI/CD prompt end marker');
  return `${readme.slice(startIndex, endIndex).trimEnd()}\n`;
}

function replaceLast(text, search, replacement) {
  const index = text.lastIndexOf(search);
  assert.notEqual(index, -1, `missing text to replace: ${search}`);
  return `${text.slice(0, index)}${replacement}${text.slice(index + search.length)}`;
}

function moveWorkflowStepAfter(text, sourceName, targetName) {
  const sourceMarker = `      - name: ${sourceName}`;
  const targetMarker = `      - name: ${targetName}`;
  const sourceStart = text.indexOf(sourceMarker);
  assert.notEqual(sourceStart, -1, `missing source step: ${sourceName}`);
  const sourceEnd = text.indexOf('\n      - name:', sourceStart + sourceMarker.length);
  assert.notEqual(sourceEnd, -1, `missing source step end: ${sourceName}`);
  const sourceBlock = text.slice(sourceStart, sourceEnd);
  const withoutSource = `${text.slice(0, sourceStart)}${text.slice(sourceEnd + 1)}`;
  const targetStart = withoutSource.indexOf(targetMarker);
  assert.notEqual(targetStart, -1, `missing target step: ${targetName}`);
  const targetEnd = withoutSource.indexOf('\n      - name:', targetStart + targetMarker.length);
  assert.notEqual(targetEnd, -1, `missing target step end: ${targetName}`);
  return `${withoutSource.slice(0, targetEnd)}\n${sourceBlock}${withoutSource.slice(targetEnd)}`;
}

function manifestsById() {
  return new Map(validator.projectManifests().map((manifest) => [manifest.id, manifest]));
}

function manifestOutput(manifest, outputPath) {
  return (manifest.outputs || []).find((output) => output.output === outputPath);
}

function contractBlock(text) {
  const begin = '<!-- BEGIN SOURCE-OF-TRUTH-CONTRACT -->';
  const end = '<!-- END SOURCE-OF-TRUTH-CONTRACT -->';
  const beginMatches = text.match(new RegExp(begin, 'g')) || [];
  const endMatches = text.match(new RegExp(end, 'g')) || [];
  assert.equal(beginMatches.length, 1, 'begin marker count');
  assert.equal(endMatches.length, 1, 'end marker count');
  const start = text.indexOf(begin);
  const finish = text.indexOf(end);
  assert.ok(start < finish, 'contract markers are ordered');
  return text.slice(start + begin.length, finish).trim();
}

test('JSON registries parse in the current repo', () => {
  for (const file of [
    'skills.registry.json',
    'playbooks.registry.json',
    'templates.registry.json',
    'packs.registry.json',
    'projects.registry.json',
    'tools.registry.json',
    'source-repos.registry.json',
    'consumers.registry.json'
  ]) {
    assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path.join(repoRoot, 'mcp', 'registry', file), 'utf8')));
  }
});

test('skill discovery includes migrated skills', () => {
  const skills = validator.skillDirs();
  assert.ok(skills.includes('skills/context-preserving-ai-publisher'));
  assert.ok(skills.includes('skills/ui-ux-secure-frontend-design'));
  assert.ok(skills.includes('skills/windows-localhost-workflows'));
  assert.ok(skills.includes('skills/n8n-workflow-sync'));
  assert.ok(skills.includes('skills/n8n-local-setup'));
  assert.ok(skills.includes('skills/secure-cicd-installer'));
  assert.ok(skills.includes('skills/knowledge-index-updater'));

  const registry = JSON.parse(fs.readFileSync(path.join(repoRoot, 'mcp', 'registry', 'skills.registry.json'), 'utf8'));
  const registryPaths = registry.map((entry) => entry.path.replace(/\/$/, ''));
  for (const skill of skills) {
    assert.ok(registryPaths.includes(skill), `${skill} missing from skills registry`);
  }
});

test('project registry includes the initial project modules', () => {
  const registry = JSON.parse(fs.readFileSync(path.join(repoRoot, 'mcp', 'registry', 'projects.registry.json'), 'utf8'));
  const ids = registry.map((entry) => entry.id).sort();
  assert.deepEqual(ids, [
    'cicd.secure-installer',
    'design.ui-ux-pro-max',
    'meta.context-preserving-ai-publisher',
    'n8n.local-setup',
    'n8n.workflow-templates'
  ]);
  for (const entry of registry) {
    assert.ok(entry.project?.summary, entry.id);
    assert.ok(['skill', 'mcp', 'both', 'source_only'].includes(entry.surface?.publish_as), entry.id);
    assert.doesNotMatch(JSON.stringify(entry.root_surfaces), /(^|[^A-Za-z0-9_])for_ai\//);
  }
});

test('project metadata supports all declared publish_as values', () => {
  for (const publishAs of ['skill', 'mcp', 'both', 'source_only']) {
    const cwd = tempCopy();
    const manifestPath = path.join(cwd, '_projects', 'n8n', 'local-setup', 'toolkit.project.json');
    const manifest = readJsonFile(manifestPath);
    manifest.surface.publish_as = publishAs;
    if (publishAs === 'source_only') {
      manifest.surface.skill = { status: 'not_applicable' };
      manifest.surface.mcp = { status: 'not_applicable' };
    }
    writeJsonFile(manifestPath, manifest);
    const result = spawnSync(process.execPath, [syncScript, '--write'], { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, `${publishAs}\n${result.stderr}`);
  }
});

test('sync output declarations target skills and mcp, not legacy surfaces', () => {
  for (const manifest of validator.projectManifests()) {
    for (const output of manifest.outputs || []) {
      assert.match(output.output, /^(skills|mcp)\//, `${manifest.id}: ${output.output}`);
      assert.doesNotMatch(output.output, /(^|[^A-Za-z0-9_])for_ai\//);
    }
    for (const allowed of manifest.writes.allowed || []) {
      if (allowed === 'mcp/registry/projects.registry.json') continue;
      if (allowed.endsWith('/output/**')) continue;
      assert.match(allowed, /^(skills|mcp)\//, `${manifest.id}: ${allowed}`);
    }
  }
});

test('validator expects durable retired source provenance doc instead of migration checklist', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, 'repo', 'docs', 'MIGRATION_CHECKLIST.md')), false);
  assert.equal(fs.existsSync(path.join(repoRoot, 'repo', 'docs', 'RETIRED-SOURCE-PROVENANCE.md')), true);

  const cwd = tempCopy();
  fs.unlinkSync(path.join(cwd, 'repo', 'docs', 'RETIRED-SOURCE-PROVENANCE.md'));
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing expected file: repo\/docs\/RETIRED-SOURCE-PROVENANCE\.md/);
});

test('source-of-truth contract is synced into main entry points', () => {
  const partial = readTextFile(path.join(repoRoot, 'repo', 'docs', 'partials', 'source-of-truth-contract.md')).trim();
  for (const rel of ['README.md', 'AGENTS.md']) {
    const text = readTextFile(path.join(repoRoot, rel));
    assert.equal(contractBlock(text), partial, rel);
  }
});

test('source-of-truth contract sync script passes and catches drift', () => {
  let result = spawnSync(process.execPath, [contractScript, '--check'], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);

  const cwd = tempCopy();
  fs.writeFileSync(
    path.join(cwd, 'README.md'),
    readTextFile(path.join(cwd, 'README.md')).replace('This repo has a source layer and a published layer.', 'This repo has a source layer and a changed published layer.')
  );
  result = spawnSync(process.execPath, [contractScript, '--check'], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Stale source-of-truth contract block: README\.md/);
});

test('README is a user-facing map with the contract in the appendix', () => {
  const text = readTextFile(path.join(repoRoot, 'README.md'));
  const sections = [
    '## What this repo is',
    '## Quick Start',
    '## Projects',
    '## Skills',
    '## MCP',
    '## Folder Map',
    '## For Maintainers',
    '## Validation',
    '## Appendix: Source-of-Truth Contract'
  ];
  let previous = -1;
  for (const section of sections) {
    const index = text.indexOf(section);
    assert.notEqual(index, -1, section);
    assert.ok(index > previous, section);
    previous = index;
  }
  assert.ok(text.indexOf('<!-- BEGIN SOURCE-OF-TRUTH-CONTRACT -->') > text.indexOf('## Appendix: Source-of-Truth Contract'));
  assert.match(text, /`skills\/<skill-name>\/`/);
  assert.match(text, /`mcp\/`/);
  assert.doesNotMatch(text, /(^|[^A-Za-z0-9_])for_ai\//);
  for (const surface of ['packs', 'playbooks', 'templates', 'registries', 'registry', 'tools']) {
    assert.doesNotMatch(text, new RegExp(`\\|\\s+\`?${surface}/?\`?\\s+\\|`, 'i'));
  }
});

test('trusted maintenance scripts support an explicit workspace root', () => {
  const cwd = tempCopy();
  for (const script of [contractScript, syncScript, validateScript]) {
    const args = [script, '--workspace', cwd];
    if (script !== validateScript) args.push('--check');
    const result = spawnSync(process.execPath, args, { cwd: os.tmpdir(), encoding: 'utf8' });
    assert.equal(result.status, 0, `${path.basename(script)}\n${result.stderr}`);
  }
});

test('AGENTS.md gives future agents unambiguous source routing rules', () => {
  const text = readTextFile(path.join(repoRoot, 'AGENTS.md'));
  const mandatoryDocs = [
    'repo/docs/FOR_AI_AGENTS.md',
    'repo/docs/SOURCE-OF-TRUTH.md',
    'repo/docs/PROJECT-MODULE-STANDARD.md',
    'repo/docs/SURFACE-FIDELITY-AUDIT.md',
    'repo/docs/RETIRED-SOURCE-PROVENANCE.md',
    'repo/docs/THIRD-PARTY-SOURCE-NOTES.md',
    'repo/docs/WRITE-SAFETY-MODEL.md',
    'repo/docs/SAFE-UPDATES.md',
    'repo/docs/CLEANUP-POLICY.md',
    'repo/docs/HOW-TO-USE.md'
  ];

  assert.match(text, /curated_output_for_ai/);
  assert.match(text, /toolkit\.project\.json/);
  assert.match(text, /Do not edit generated `skills\/` or `mcp\/` outputs directly/);
  assert.match(text, /Do not generate curated files automatically from `_main`/);
  for (const doc of mandatoryDocs) {
    assert.ok(text.includes(`](${doc})`), `AGENTS.md links ${doc}`);
  }
  assert.match(
    text,
    /For new or changed project modules, `repo\/docs\/PROJECT-MODULE-STANDARD\.md` is the detailed rulebook\./
  );
});

test('Project Module Standard documents the playbook boundary', () => {
  const text = readTextFile(path.join(repoRoot, 'repo', 'docs', 'PROJECT-MODULE-STANDARD.md'));
  assert.match(text, /## Playbook Boundary/);
  assert.match(text, /Do not use `playbooks\/` as a default home for full working instructions\./);
  assert.match(text, /A playbook may exist only when it is a short reviewed operating overview, routing guide, or safety wrapper\./);
  assert.match(text, /publish it from `_projects\/\*\*\/_main\/\*\*` using exact `copy`, `extract`, or `concat`/);
});

test('curated playbook recipes are not full runtime skill references', () => {
  const offenders = [];
  for (const manifest of manifestsById().values()) {
    for (const output of manifest.outputs || []) {
      const sources = output.sources || [output.source].filter(Boolean);
      const usesPlaybookSource = sources.some((source) => source.includes('curated_output_for_ai/playbooks/'));
      const publishesRuntimeSkillSurface = /^skills\/[^/]+\/(references|templates)\//.test(output.output || '');
      if (!usesPlaybookSource || !publishesRuntimeSkillSurface) continue;

      const label = `${output.notes || ''} ${output.fidelity || ''}`;
      const explicitlyAllowed = /\b(overview|safety wrapper|routing guide)\b/i.test(label) && output.fidelity !== 'exact';
      if (!explicitlyAllowed) offenders.push(`${manifest.id}: ${output.output}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('validation workflow checks source-of-truth contract drift read-only', () => {
  const workflow = readTextFile(path.join(repoRoot, '.github', 'workflows', 'validate.yml'));
  assert.match(workflow, /node repo\/scripts\/sync-repo-doc-contract\.cjs --check/);
  assert.doesNotMatch(workflow, /sync-repo-doc-contract\.cjs --write/);
  assert.match(workflow, /^permissions:\n  contents: read$/m);
});

test('auto-sync generated surfaces workflow is accepted by validation', () => {
  const errors = validator.runValidation();
  assert.equal(errors.filter((error) => /auto-sync-generated-surfaces\.yml/.test(error)).length, 0, errors.join('\n'));
});

test('validator rejects contents write outside the auto-sync generated surfaces workflow', () => {
  const cwd = tempCopy();
  fs.writeFileSync(
    path.join(cwd, '.github', 'workflows', 'unsafe-write.yml'),
    [
      'name: Unsafe write',
      'on:',
      '  pull_request:',
      'permissions:',
      '  contents: write',
      'jobs:',
      '  unsafe:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: echo unsafe'
    ].join('\n')
  );
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unsafe-write\.yml uses contents: write/);
});

test('validator rejects git push outside the auto-sync generated surfaces workflow', () => {
  const cwd = tempCopy();
  fs.writeFileSync(
    path.join(cwd, '.github', 'workflows', 'unsafe-push.yml'),
    [
      'name: Unsafe push',
      'on:',
      '  pull_request:',
      'permissions:',
      '  contents: read',
      'jobs:',
      '  unsafe:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - run: git push origin HEAD:branch'
    ].join('\n')
  );
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unsafe-push\.yml contains forbidden commit\/push behavior/);
});

test('auto-sync generated surfaces workflow rejects forbidden events and missing guards', () => {
  const cases = [
    ['pull_request is forbidden', (text) => text.replace('pull_request_target:', 'pull_request:'), /must use pull_request_target/],
    ['push is forbidden', (text) => text.replace('pull_request_target:', 'push:\n  pull_request_target:'), /must not trigger on push/],
    ['schedule is forbidden', (text) => text.replace('pull_request_target:', 'schedule:\n  pull_request_target:'), /must not trigger on schedule/],
    ['workflow_run is forbidden', (text) => text.replace('pull_request_target:', 'workflow_run:\n  pull_request_target:'), /must not trigger on workflow_run/],
    ['extra permissions are forbidden', (text) => text.replace('  pull-requests: read', '  pull-requests: read\n  issues: write'), /must grant only contents: write and pull-requests: read/],
    ['same-repo guard is required', (text) => text.replaceAll('github.event.pull_request.head.repo.full_name == github.repository', 'true'), /missing same-repo PR guard/],
    ['head main guard is required', (text) => text.replaceAll("github.event.pull_request.head.ref != 'main'", 'true'), /missing head\.ref != main guard/],
    ['oversized PR file-list guard is required', (text) => text.replace('if (( changed_file_count > 3000 )); then', 'if false; then'), /preflight must reject PRs with more than 3000 changed files/],
    ['post-sync changed-path validation is required', (text) => text.replaceAll('Forbidden post-sync change outside generated output scope', 'Removed post-sync guard'), /missing post-sync changed-path validation/],
    ['_projects post-sync writes stay rejected', (text) => text.replaceAll('_projects/*|repo/*|.github/*|package.json|package-lock.json|pnpm-lock.yaml|yarn.lock|.gitignore|.gitattributes)', 'repo/*|.github/*|package.json|package-lock.json|pnpm-lock.yaml|yarn.lock|.gitignore|.gitattributes)'), /missing forbidden post-sync path rejection/],
    ['repo post-sync writes stay rejected', (text) => text.replaceAll('_projects/*|repo/*|.github/*|package.json|package-lock.json|pnpm-lock.yaml|yarn.lock|.gitignore|.gitattributes)', '_projects/*|.github/*|package.json|package-lock.json|pnpm-lock.yaml|yarn.lock|.gitignore|.gitattributes)'), /missing forbidden post-sync path rejection/],
    ['.github post-sync writes stay rejected', (text) => text.replaceAll('_projects/*|repo/*|.github/*|package.json|package-lock.json|pnpm-lock.yaml|yarn.lock|.gitignore|.gitattributes)', '_projects/*|repo/*|package.json|package-lock.json|pnpm-lock.yaml|yarn.lock|.gitignore|.gitattributes)'), /missing forbidden post-sync path rejection/]
  ];

  const workflowPath = path.join(repoRoot, '.github', 'workflows', 'auto-sync-generated-surfaces.yml');
  const original = readTextFile(workflowPath);
  for (const [name, mutate, expected] of cases) {
    const cwd = tempCopy();
    fs.writeFileSync(path.join(cwd, '.github', 'workflows', 'auto-sync-generated-surfaces.yml'), `${mutate(original)}\n`);
    const result = runValidate(cwd);
    assert.notEqual(result.status, 0, name);
    assert.match(result.stderr, expected, name);
  }
});

test('auto-sync generated surfaces workflow rejects forbidden commands and broad commit scopes', () => {
  const cases = [
    ['workflow_dispatch is forbidden', (text) => text.replace('pull_request_target:', 'workflow_dispatch:\n  pull_request_target:'), /must not trigger on workflow_dispatch/],
    ['source-watch script is forbidden', (text) => text.replace('node "$TRUSTED_ROOT/repo/scripts/sync-toolkit-projects.cjs" --workspace "$PR_ROOT" --write', 'node "$TRUSTED_ROOT/repo/scripts/watch-project-sources.cjs" --workspace "$PR_ROOT"'), new RegExp('must not run source-watch or source-update ' + 'scripts')],
    ['live n8n export is forbidden', (text) => text.replace('node "$TRUSTED_ROOT/repo/scripts/sync-toolkit-projects.cjs" --workspace "$PR_ROOT" --write', 'scr' + 'ipts/export-n8n-workflows-live.ps1'), /must not run live n8n import\/export/],
    ['git add scope is fixed', (text) => text.replace('/usr/bin/git -C "$PR_ROOT" add README.md AGENTS.md skills mcp', '/usr/bin/git -C "$PR_ROOT" add README.md AGENTS.md skills mcp repo'), /must commit only approved generated output paths/],
    ['commit bypasses hooks', (text) => text.replace('commit --no-verify -m', 'commit -m'), /must use git commit --no-verify/],
    ['final push resets remote', (text) => text.replace('/usr/bin/git -C "$PR_ROOT" remote set-url origin', 'echo remote'), /must set push remote with the GitHub token only in the final push step/]
  ];

  const workflowPath = path.join(repoRoot, '.github', 'workflows', 'auto-sync-generated-surfaces.yml');
  const original = readTextFile(workflowPath);
  for (const [name, mutate, expected] of cases) {
    const cwd = tempCopy();
    fs.writeFileSync(path.join(cwd, '.github', 'workflows', 'auto-sync-generated-surfaces.yml'), `${mutate(original)}\n`);
    const result = runValidate(cwd);
    assert.notEqual(result.status, 0, name);
    assert.match(result.stderr, expected, name);
  }
});

test('auto-sync generated surfaces workflow runs trusted scripts against the PR workspace', () => {
  const cases = [
    ['direct default-workspace script execution is forbidden', (text) => text.replace('node "$TRUSTED_ROOT/repo/scripts/sync-repo-doc-contract.cjs" --workspace "$PR_ROOT" --write', 'node repo/scripts/sync-repo-doc-contract.cjs --workspace "$PR_ROOT" --write'), /must not execute maintenance scripts from the default or PR workspace/],
    ['PR workspace script execution is forbidden', (text) => text.replace('node "$TRUSTED_ROOT/repo/scripts/sync-repo-doc-contract.cjs" --workspace "$PR_ROOT" --write', 'node "$PR_ROOT/repo/scripts/sync-repo-doc-contract.cjs" --workspace "$PR_ROOT" --write'), /must not execute maintenance scripts from the PR workspace/],
    ['trusted checkout is required', (text) => text.replace('      - name: Checkout trusted base revision', '      - name: Removed trusted checkout'), /must check out trusted base and PR workspaces only after preflight/],
    ['trusted checkout must use base SHA', (text) => text.replace('ref: ${{ github.event.pull_request.base.sha }}', 'ref: ${{ github.event.pull_request.base.ref }}'), /must check out the trusted base SHA to trusted\//],
    ['PR checkout path is required', (text) => text.replace('path: pr', 'path: pull-request'), /must check out the guarded PR head SHA to pr\//],
    ['sync scripts require explicit PR workspace', (text) => text.replace('node "$TRUSTED_ROOT/repo/scripts/sync-repo-doc-contract.cjs" --workspace "$PR_ROOT" --write', 'node "$TRUSTED_ROOT/repo/scripts/sync-repo-doc-contract.cjs" --write'), /must run trusted maintenance scripts with --workspace "\$PR_ROOT"/],
    ['static checks require explicit PR workspace', (text) => text.replace('node "$TRUSTED_ROOT/repo/scripts/sync-toolkit-projects.cjs" --workspace "$PR_ROOT" --check', 'node "$TRUSTED_ROOT/repo/scripts/sync-toolkit-projects.cjs" --check'), /must run trusted maintenance scripts with --workspace "\$PR_ROOT"/],
    ['git commands must target PR checkout', (text) => text.replace('/usr/bin/git -C "$PR_ROOT" diff --name-only', 'git diff --name-only'), /git commands must explicitly target the PR workspace/]
  ];

  const workflowPath = path.join(repoRoot, '.github', 'workflows', 'auto-sync-generated-surfaces.yml');
  const original = readTextFile(workflowPath);
  for (const [name, mutate, expected] of cases) {
    const cwd = tempCopy();
    fs.writeFileSync(path.join(cwd, '.github', 'workflows', 'auto-sync-generated-surfaces.yml'), `${mutate(original)}\n`);
    const result = runValidate(cwd);
    assert.notEqual(result.status, 0, name);
    assert.match(result.stderr, expected, name);
  }
});

test('auto-sync generated surfaces workflow pins and rechecks the guarded PR head SHA', () => {
  const cases = [
    ['missing HEAD_SHA env is rejected', (text) => text.replace('      HEAD_SHA: ${{ github.event.pull_request.head.sha }}\n', ''), /missing guarded PR head SHA environment variable/],
    ['PR checkout using head.ref is rejected', (text) => text.replace('ref: ${{ github.event.pull_request.head.sha }}', 'ref: ${{ github.event.pull_request.head.ref }}'), /must not check out the PR branch by mutable head\.ref/],
    ['PR checkout using head.sha is required', (text) => text.replace('ref: ${{ github.event.pull_request.head.sha }}', 'ref: ${{ github.event.pull_request.head.repo.full_name }}'), /must check out the guarded PR head SHA to pr\//],
    ['preflight current-head SHA query is required', (text) => text.replace('gh api "repos/${REPOSITORY_FULL_NAME}/pulls/${PR_NUMBER}" --jq \'.head.sha\'', 'echo "$HEAD_SHA"'), /preflight must verify the current PR head SHA from PR metadata/],
    ['preflight stale-run rejection is required', (text) => text.replace('if [[ "$current_head_sha" != "$HEAD_SHA" ]]; then', 'if false; then'), /preflight must reject stale runs when the PR head SHA changed/],
    ['post-checkout rev-parse verification is required', (text) => text.replace('/usr/bin/git -C "$PR_ROOT" rev-parse HEAD', 'echo "$HEAD_SHA"'), /must verify the checked-out PR commit matches HEAD_SHA/],
    ['post-checkout verification must run before sync', (text) => moveWorkflowStepAfter(text, 'Verify checked-out PR commit', 'Sync deterministic generated surfaces'), /must verify the checked-out PR commit before running sync/],
    ['final remote branch SHA check is required before push', (text) => text.replace('/usr/bin/git -C "$PR_ROOT" ls-remote origin "refs/heads/${HEAD_REF}"', 'echo "$HEAD_SHA"'), /final push must verify the PR branch still points to HEAD_SHA before pushing/],
    ['force push is rejected', (text) => text.replace('/usr/bin/git -C "$PR_ROOT" push origin "HEAD:${HEAD_REF}"', '/usr/bin/git -C "$PR_ROOT" push --force origin "HEAD:${HEAD_REF}"'), /must not force push generated output/]
  ];

  const workflowPath = path.join(repoRoot, '.github', 'workflows', 'auto-sync-generated-surfaces.yml');
  const original = readTextFile(workflowPath);
  for (const [name, mutate, expected] of cases) {
    const cwd = tempCopy();
    fs.writeFileSync(path.join(cwd, '.github', 'workflows', 'auto-sync-generated-surfaces.yml'), `${mutate(original)}\n`);
    const result = runValidate(cwd);
    assert.notEqual(result.status, 0, name);
    assert.match(result.stderr, expected, name);
  }
});

test('auto-sync generated surfaces workflow keeps static checks narrow', () => {
  const cases = [
    ['full validator against PR workspace is forbidden', (text) => text.replace('/usr/bin/git -C "$PR_ROOT" diff --cached --check', 'node "$TRUSTED_ROOT/repo/scripts/validate-toolkit.cjs" --workspace "$PR_ROOT"\n          /usr/bin/git -C "$PR_ROOT" diff --cached --check'), /must not run full validation against the PR workspace/],
    ['validate-toolkit workspace invocation is forbidden', (text) => text.replace('/usr/bin/git -C "$PR_ROOT" diff --cached --check', 'node "$TRUSTED_ROOT/repo/scripts/validate-toolkit.cjs" --workspace "$PR_ROOT"\n          /usr/bin/git -C "$PR_ROOT" diff --cached --check'), /must not run full validation against the PR workspace/],
    ['extra static command is forbidden', (text) => text.replace('/usr/bin/git -C "$PR_ROOT" diff --check', '/usr/bin/git -C "$PR_ROOT" diff --check\n          echo extra'), /static generated surface checks must be limited to sync freshness and git diff checks/],
    ['missing sync contract check is forbidden', (text) => text.replace('node "$TRUSTED_ROOT/repo/scripts/sync-repo-doc-contract.cjs" --workspace "$PR_ROOT" --check\n', ''), /static generated surface checks must be limited to sync freshness and git diff checks/]
  ];

  const workflowPath = path.join(repoRoot, '.github', 'workflows', 'auto-sync-generated-surfaces.yml');
  const original = readTextFile(workflowPath);
  for (const [name, mutate, expected] of cases) {
    const cwd = tempCopy();
    fs.writeFileSync(path.join(cwd, '.github', 'workflows', 'auto-sync-generated-surfaces.yml'), `${mutate(original)}\n`);
    const result = runValidate(cwd);
    assert.notEqual(result.status, 0, name);
    assert.match(result.stderr, expected, name);
  }
});

test('auto-sync generated surfaces workflow rejects PR-controlled test execution', () => {
  const staticCheckAnchor = '/usr/bin/git -C "$PR_ROOT" diff --cached --check';
  const cases = [
    ['validate:all is forbidden', (text) => text.replace(staticCheckAnchor, `npm run validate:all\n          ${staticCheckAnchor}`), /must not run npm run validate:all/],
    ['npm command is forbidden', (text) => text.replace(staticCheckAnchor, `npm ci\n          ${staticCheckAnchor}`), /must not run npm, pnpm, or yarn/],
    ['pnpm command is forbidden', (text) => text.replace(staticCheckAnchor, `pnpm test\n          ${staticCheckAnchor}`), /must not run npm, pnpm, or yarn/],
    ['yarn command is forbidden', (text) => text.replace(staticCheckAnchor, `yarn test\n          ${staticCheckAnchor}`), /must not run npm, pnpm, or yarn/],
    ['node test command is forbidden', (text) => text.replace(staticCheckAnchor, `node --test repo/tests/*.test.cjs\n          ${staticCheckAnchor}`), /must not run generated Node test suites/],
    ['python unit tests are forbidden', (text) => text.replace(staticCheckAnchor, 'python -m unittest discover -s skills/ui-ux-secure-frontend-design/tools/design-system-generator/' + 'tes' + `ts\n          ${staticCheckAnchor}`), new RegExp('must not run Python unit ' + 'tests')],
    ['generated tool tests are forbidden', (text) => text.replace(staticCheckAnchor, 'node skills/ui-ux-secure-frontend-design/tools/design-system-generator/' + 'tes' + `ts/run.js\n          ${staticCheckAnchor}`), new RegExp('must not run generated tool ' + 'tests')]
  ];

  const workflowPath = path.join(repoRoot, '.github', 'workflows', 'auto-sync-generated-surfaces.yml');
  const original = readTextFile(workflowPath);
  for (const [name, mutate, expected] of cases) {
    const cwd = tempCopy();
    fs.writeFileSync(path.join(cwd, '.github', 'workflows', 'auto-sync-generated-surfaces.yml'), `${mutate(original)}\n`);
    const result = runValidate(cwd);
    assert.notEqual(result.status, 0, name);
    assert.match(result.stderr, expected, name);
  }
});

test('auto-sync generated surfaces workflow keeps privileged preflight before checkout', () => {
  const cases = [
    ['checkout before preflight is forbidden', (text) => text.replace('      - name: Preflight guard', '      - name: Checkout PR head branch'), /must run preflight before any checkout/],
    ['persisted checkout credentials are forbidden', (text) => text.replace('persist-credentials: false', 'persist-credentials: true'), /must not use persisted checkout credentials/],
    ['base-sha git diff changed-file detection is forbidden', (text) => text.replace("gh api --paginate \\", 'git diff --name-only "$BASE_SHA" HEAD\n          gh api --paginate \\'), /must not compute PR changed files with git diff against the PR branch/],
    ['PR files API is required', (text) => text.replace('gh api --paginate \\', 'echo no api \\'), /must query PR changed files before checkout/],
    ['github token is not exposed to sync or validation', (text) => text.replace('node "$TRUSTED_ROOT/repo/scripts/sync-toolkit-projects.cjs" --workspace "$PR_ROOT" --write', 'GH_TOKEN="${{ github.token }}" node "$TRUSTED_ROOT/repo/scripts/sync-toolkit-projects.cjs" --workspace "$PR_ROOT" --write'), /must expose github.token only to preflight and final push steps/]
  ];

  const workflowPath = path.join(repoRoot, '.github', 'workflows', 'auto-sync-generated-surfaces.yml');
  const original = readTextFile(workflowPath);
  for (const [name, mutate, expected] of cases) {
    const cwd = tempCopy();
    fs.writeFileSync(path.join(cwd, '.github', 'workflows', 'auto-sync-generated-surfaces.yml'), `${mutate(original)}\n`);
    const result = runValidate(cwd);
    assert.notEqual(result.status, 0, name);
    assert.match(result.stderr, expected, name);
  }
});

test('auto-sync generated surfaces workflow snapshots and rechecks staged output before commit', () => {
  const cases = [
    ['final recheck is required after validation', (text) => text.replace('      - name: Final pre-commit workspace recheck', '      - name: Removed pre-commit workspace recheck'), /must recheck the workspace and staged index after validation and before commit/],
    ['post-sync staged index snapshot is required', (text) => text.replace('expected_index_tree="$(/usr/bin/git -C "$PR_ROOT" write-tree)"', 'expected_index_tree="$(/usr/bin/git -C "$PR_ROOT" rev-parse HEAD)"'), /must snapshot the staged index after the post-sync guard/],
    ['staged index tree comparison is required', (text) => text.replace('if [[ "$current_index_tree" != "${EXPECTED_INDEX_TREE}" ]]; then', 'if false; then'), /final recheck must compare the staged index tree snapshot/],
    ['commit step must not stage files', (text) => text.replace('/usr/bin/git -C "$PR_ROOT" config user.name', '/usr/bin/git -C "$PR_ROOT" add README.md AGENTS.md skills mcp\n          /usr/bin/git -C "$PR_ROOT" config user.name'), /commit step must not run git add/],
    ['final recheck rejects untracked files', (text) => text.replace('untracked_files="$(/usr/bin/git -C "$PR_ROOT" ls-files --others --exclude-standard)"', 'untracked_files=""'), /final recheck must reject untracked files before commit/],
    ['final recheck rejects unstaged tracked changes', (text) => text.replace('if ! /usr/bin/git -C "$PR_ROOT" diff --quiet; then', 'if false; then'), /final recheck must reject unstaged tracked changes before commit/],
    ['final recheck rejects staged paths outside generated outputs', (text) => replaceLast(text, '_projects/*|repo/*|.github/*|package.json|package-lock.json|pnpm-lock.yaml|yarn.lock|.gitignore|.gitattributes)', '_projects/*|.github/*|package.json|package-lock.json|pnpm-lock.yaml|yarn.lock|.gitignore|.gitattributes)'), /final recheck must reject staged paths outside generated output scope/],
    ['commit step resets dangerous git environment', (text) => text.replace('unset GIT_CONFIG_GLOBAL GIT_CONFIG_SYSTEM GIT_CONFIG_NOSYSTEM GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_OBJECT_DIRECTORY GIT_SSH_COMMAND', 'echo no reset'), /commit step must reset dangerous git environment state/],
    ['push step resets dangerous git environment', (text) => replaceLast(text, 'unset GIT_CONFIG_GLOBAL GIT_CONFIG_SYSTEM GIT_CONFIG_NOSYSTEM GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_ALTERNATE_OBJECT_DIRECTORIES GIT_OBJECT_DIRECTORY GIT_SSH_COMMAND', 'echo no reset'), /push step must reset dangerous git environment state/]
  ];

  const workflowPath = path.join(repoRoot, '.github', 'workflows', 'auto-sync-generated-surfaces.yml');
  const original = readTextFile(workflowPath);
  for (const [name, mutate, expected] of cases) {
    const cwd = tempCopy();
    fs.writeFileSync(path.join(cwd, '.github', 'workflows', 'auto-sync-generated-surfaces.yml'), `${mutate(original)}\n`);
    const result = runValidate(cwd);
    assert.notEqual(result.status, 0, name);
    assert.match(result.stderr, expected, name);
  }
});

test('auto-sync generated surfaces workflow blocks unsafe preflight paths', () => {
  const cases = [
    ['.github path guard is required', (text) => text.replace('.github/*|repo/scripts/*|repo/tests/*|repo/docs/*|_projects/*/_main/*|package.json|package-lock.json|pnpm-lock.yaml|yarn.lock|.gitignore|.gitattributes)', 'repo/scripts/*|repo/tests/*|repo/docs/*|_projects/*/_main/*|package.json|package-lock.json|pnpm-lock.yaml|yarn.lock|.gitignore|.gitattributes)'), /missing forbidden preflight path rejection for \.github/],
    ['repo scripts path guard is required', (text) => text.replace('.github/*|repo/scripts/*|repo/tests/*|repo/docs/*|_projects/*/_main/*|package.json|package-lock.json|pnpm-lock.yaml|yarn.lock|.gitignore|.gitattributes)', '.github/*|repo/tests/*|repo/docs/*|_projects/*/_main/*|package.json|package-lock.json|pnpm-lock.yaml|yarn.lock|.gitignore|.gitattributes)'), new RegExp('missing forbidden preflight path rejection for repo/' + 'scripts')],
    ['repo tests path guard is required', (text) => text.replace('.github/*|repo/scripts/*|repo/tests/*|repo/docs/*|_projects/*/_main/*|package.json|package-lock.json|pnpm-lock.yaml|yarn.lock|.gitignore|.gitattributes)', '.github/*|repo/scripts/*|repo/docs/*|_projects/*/_main/*|package.json|package-lock.json|pnpm-lock.yaml|yarn.lock|.gitignore|.gitattributes)'), /missing forbidden preflight path rejection for repo\/tests/],
    ['_main path guard is required', (text) => text.replace('.github/*|repo/scripts/*|repo/tests/*|repo/docs/*|_projects/*/_main/*|package.json|package-lock.json|pnpm-lock.yaml|yarn.lock|.gitignore|.gitattributes)', '.github/*|repo/scripts/*|repo/tests/*|repo/docs/*|package.json|package-lock.json|pnpm-lock.yaml|yarn.lock|.gitignore|.gitattributes)'), /missing forbidden preflight path rejection for _projects\/\*\*\/_main/],
    ['lockfile path guard is required', (text) => text.replace('.github/*|repo/scripts/*|repo/tests/*|repo/docs/*|_projects/*/_main/*|package.json|package-lock.json|pnpm-lock.yaml|yarn.lock|.gitignore|.gitattributes)', '.github/*|repo/scripts/*|repo/tests/*|repo/docs/*|_projects/*/_main/*|.gitignore|.gitattributes)'), /missing forbidden preflight path rejection for package\/lockfile changes/]
  ];

  const workflowPath = path.join(repoRoot, '.github', 'workflows', 'auto-sync-generated-surfaces.yml');
  const original = readTextFile(workflowPath);
  for (const [name, mutate, expected] of cases) {
    const cwd = tempCopy();
    fs.writeFileSync(path.join(cwd, '.github', 'workflows', 'auto-sync-generated-surfaces.yml'), `${mutate(original)}\n`);
    const result = runValidate(cwd);
    assert.notEqual(result.status, 0, name);
    assert.match(result.stderr, expected, name);
  }
});

test('auto-sync generated output path scope is explicit', () => {
  for (const rel of [
    'README.md',
    'AGENTS.md',
    'mcp/registry/projects.registry.json',
    'skills/n8n-workflow-sync/templates/sync-helpers/README.md'
  ]) {
    assert.equal(validator.isAutoSyncGeneratedOutputPath(rel), true, rel);
  }

  for (const rel of [
    '_projects/foo/toolkit.project.json',
    '_projects/foo/curated_output_for_ai/file.md',
    '_projects/foo/_main/file.md',
    'repo/' + 'scr' + 'ipts/anything.cjs',
    '.github/workflows/anything.yml',
    'package.json',
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    '.gitignore',
    '.gitattributes'
  ]) {
    assert.equal(validator.isAutoSyncGeneratedOutputPath(rel), false, rel);
  }
});

test('project modules use _projects/_main with no mandatory exports tree', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, '_projects')), true);
  assert.equal(fs.existsSync(path.join(repoRoot, 'projects')), false);

  for (const rel of [
    '_projects/n8n/local-setup',
    '_projects/n8n/workflow-templates',
    '_projects/cicd/secure-installer',
    '_projects/design/ui-ux-pro-max'
  ]) {
    const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, rel, 'toolkit.project.json'), 'utf8'));
    assert.equal(manifest.module_path, rel);
    assert.equal(manifest.main_path, `${rel}/_main`);
    assert.equal(fs.existsSync(path.join(repoRoot, rel, '_main')), true);
    assert.equal(fs.existsSync(path.join(repoRoot, rel, 'main')), false);
    assert.equal(fs.existsSync(path.join(repoRoot, rel, 'exports')), false);
  }
});

test('.gitattributes preserves _projects _main bytes for source locks', () => {
  const attrs = fs.readFileSync(path.join(repoRoot, '.gitattributes'), 'utf8');
  assert.match(attrs, /^_projects\/\*\*\/_main\/\*\* -text$/m);
  assert.doesNotMatch(attrs, /^projects\/\*\*\/main\/\*\* -text$/m);
});

test('design skill front matter and OpenAI metadata are approved', () => {
  const errors = validator.runValidation();
  assert.equal(errors.filter((error) => /Design skill/.test(error)).length, 0, errors.join('\n'));
});

test('design skill keeps generator tooling inside the skill folder', () => {
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(full);
    }
  }
  walk(path.join(repoRoot, 'skills', 'ui-ux-secure-frontend-design'));
  assert.equal(files.some((file) => file.endsWith(path.join('tools', 'design-system-generator', 'scripts', 'design_system.py'))), true);
  assert.equal(files.some((file) => file.includes(`${path.sep}for_ai${path.sep}`)), false);
});

test('validator allows local-only Python design generator tooling under skill tools', () => {
  const cwd = tempCopy();
  const testFile = path.join(cwd, 'skills', 'ui-ux-secure-frontend-design', 'tools', 'design-system-generator', 'tests', 'extra_allowed.py');
  fs.writeFileSync(testFile, 'VALUE = 1\n');
  const result = runValidate(cwd);
  assert.equal(result.status, 0, result.stderr);
});

test('validator rejects network, shell, and package-install strings in design generator scripts', () => {
  const cwd = tempCopy();
  const scriptDir = path.join(cwd, 'skills', 'ui-ux-secure-frontend-design', 'tools', 'design-system-generator', 'scripts');
  fs.mkdirSync(scriptDir, { recursive: true });
  fs.writeFileSync(path.join(scriptDir, 'core.py'), 'import requests\n');
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Design generator script contains forbidden local-only token/);
});

test('generated agent-rule templates are normal Markdown, not one giant fenced block', () => {
  for (const file of ['AGENTS.md', 'CLAUDE.md', 'GEMINI.md']) {
    const text = fs.readFileSync(path.join(repoRoot, 'skills', 'n8n-local-setup', 'templates', 'agent-rules', file), 'utf8').replace(/\r\n/g, '\n');
    assert.doesNotMatch(text, /Use this generated template[^\n]*\n\n```md\n# AI coding agent execution preferences/);
    assert.match(text, /_projects\/n8n\/local-setup\/_main\/templates\/partials/);
    assert.match(text, /skills\/n8n-local-setup\/templates\/agent-rules\/partials\/skill-routing-rules\.md/);
    assert.doesNotMatch(text, /^- skills\/n8n-local-setup\/templates\/agent-rules\/partials/m);
    assert.match(text, /\n# AI coding agent execution preferences\n/);
    assert.match(text, /\n```md\n# SECTION NAME\n/);
  }
});

test('root agent-rule partials are declared linked surfaces when present', () => {
  const partialsDir = path.join(repoRoot, 'skills', 'n8n-local-setup', 'templates', 'agent-rules', 'partials');
  const files = fs.existsSync(partialsDir)
    ? fs.readdirSync(partialsDir, { recursive: true }).filter((entry) => fs.statSync(path.join(partialsDir, entry)).isFile()).map((entry) => entry.replace(/\\/g, '/')).sort()
    : [];
  assert.deepEqual(files, ['skill-routing-rules.md']);

  const manifests = validator.projectManifests();
  const linkedOutputs = new Set();
  for (const manifest of manifests) {
    for (const output of manifest.outputs || []) {
      if (output.kind === 'linked') linkedOutputs.add(output.output);
    }
  }
  assert.equal(linkedOutputs.has('skills/n8n-local-setup/templates/agent-rules/partials/skill-routing-rules.md'), true);
});

test('validator rejects broken relative links in non-_main Markdown files', () => {
  const cwd = tempCopy();
  fs.appendFileSync(path.join(cwd, 'mcp', 'projects', 'n8n-local-setup.md'), '\n[Missing local target](DOES-NOT-EXIST.md)\n');
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /mcp\/projects\/n8n-local-setup\.md links to missing path: mcp\/projects\/DOES-NOT-EXIST\.md/);
});

test('Markdown link validation ignores _projects source files', () => {
  const cwd = tempCopy();
  const ignoredDir = path.join(cwd, '_projects', 'n8n', 'local-setup', '_main');
  fs.mkdirSync(ignoredDir, { recursive: true });
  fs.writeFileSync(path.join(ignoredDir, 'IGNORED.md'), '[Ignored missing target](missing.md)\n');
  const curatedDir = path.join(cwd, '_projects', 'n8n', 'local-setup', 'curated_output_for_ai');
  fs.mkdirSync(curatedDir, { recursive: true });
  fs.writeFileSync(path.join(curatedDir, 'OUTPUT_RELATIVE.md'), '[Output-relative target](missing-output.md)\n');
  const result = runValidate(cwd);
  assert.equal(result.status, 0, result.stderr);
});

test('validator rejects README links to absent optional folders', () => {
  const cwd = tempCopy();
  fs.appendFileSync(path.join(cwd, '_projects', 'n8n', 'local-setup', 'README.md'), '\n[Generated preview](_generated/)\n');
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /links to missing path: _projects\/n8n\/local-setup\/_generated/);
});

test('changing declared _main partials makes generated agent rules stale', () => {
  const cwd = tempCopy();
  const partial = path.join(cwd, '_projects', 'n8n', 'local-setup', '_main', 'templates', 'partials', 'n8n-mcp-rules.md');
  fs.appendFileSync(partial, '\n\n<!-- drift test -->\n');
  const result = spawnSync(process.execPath, [syncScript, '--check'], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Stale generated output: skills\/n8n-local-setup\/templates\/agent-rules\/AGENTS\.md/);
});

test('changing declared _main MCP config source makes root MCP config stale', () => {
  const cwd = tempCopy();
  const source = path.join(cwd, '_projects', 'n8n', 'local-setup', '_main', 'templates', 'codex-mcp-config.md');
  fs.appendFileSync(source, '\n\n<!-- drift test -->\n');
  const result = spawnSync(process.execPath, [syncScript, '--check'], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Stale generated output: skills\/n8n-local-setup\/templates\/mcp-configs\/codex-mcp-config\.md/);
});

test('Secure CI/CD prompt preserves the full source prompt', () => {
  const manifests = manifestsById();
  const outputPath = 'skills/secure-cicd-installer/templates/cicd/secure-cicd-prompt.md';
  const output = manifestOutput(manifests.get('cicd.secure-installer'), outputPath);
  assert.equal(output?.kind, 'extract', outputPath);
  assert.equal(output?.source, '_main/README.md', outputPath);
  assert.equal(output?.notice, false, outputPath);

  const prompt = readTextFile(path.join(repoRoot, outputPath));
  assert.equal(prompt, secureCicdPromptFromReadme());
  assert.match(prompt, /Manual step needed: \[Short title\]/);
  assert.match(prompt, /Phase 9: Commit, branch, pull request, and push policy\./);
  assert.match(prompt, /Do not commit, push, create a pull request, merge, or deploy without my approval\./);
});

test('changing Secure CI/CD prompt source makes generated prompt stale', () => {
  const cwd = tempCopy();
  const source = path.join(cwd, '_projects', 'cicd', 'secure-installer', '_main', 'README.md');
  const text = readTextFile(source);
  fs.writeFileSync(source, text.replace('Phase 10: Final output.', 'Phase 10: Final output drift test.'), 'utf8');
  const result = spawnSync(process.execPath, [syncScript, '--check'], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Stale generated output: skills\/secure-cicd-installer\/templates\/cicd\/secure-cicd-prompt\.md/);
});

test('internal AI-facing surfaces are generated from declared project output', () => {
  const manifests = manifestsById();
  const expectedMarkdown = [
    ['n8n.local-setup', 'skills/n8n-local-setup/SKILL.md', 'curated_output_for_ai/skills/n8n-local-setup/SKILL.md'],
    ['n8n.local-setup', 'skills/n8n-local-setup/README.md', 'curated_output_for_ai/skills/n8n-local-setup/README.md'],
    ['n8n.local-setup', 'mcp/projects/n8n-local-setup.md', 'curated_output_for_ai/mcp/n8n-local-setup.md'],
    ['n8n.local-setup', 'skills/n8n-local-setup/templates/mcp-configs/README.md', 'curated_output_for_ai/templates/mcp-configs/README.md'],
    ['n8n.workflow-templates', 'skills/n8n-workflow-sync/SKILL.md', 'curated_output_for_ai/skills/n8n-workflow-sync/SKILL.md'],
    ['n8n.workflow-templates', 'skills/n8n-workflow-sync/README.md', 'curated_output_for_ai/skills/n8n-workflow-sync/README.md'],
    ['n8n.workflow-templates', 'mcp/projects/n8n-workflow-templates.md', 'curated_output_for_ai/mcp/n8n-workflow-templates.md'],
    ['n8n.workflow-templates', 'skills/n8n-workflow-sync/references/n8n/workflow-sync.md', 'curated_output_for_ai/overviews/workflow-sync.md'],
    ['n8n.workflow-templates', 'skills/n8n-workflow-sync/templates/sanitizer/README.md', 'curated_output_for_ai/templates/n8n/sanitizer/README.md'],
    ['n8n.workflow-templates', 'skills/n8n-workflow-sync/templates/workflow-policy/README.md', 'curated_output_for_ai/templates/n8n/workflow-policy/README.md'],
    ['cicd.secure-installer', 'skills/secure-cicd-installer/SKILL.md', 'curated_output_for_ai/skills/secure-cicd-installer/SKILL.md'],
    ['cicd.secure-installer', 'skills/secure-cicd-installer/README.md', 'curated_output_for_ai/skills/secure-cicd-installer/README.md'],
    ['cicd.secure-installer', 'mcp/projects/secure-cicd-installer.md', 'curated_output_for_ai/mcp/secure-cicd-installer.md'],
    ['cicd.secure-installer', 'skills/secure-cicd-installer/references/secure-cicd-installer.md', 'curated_output_for_ai/overviews/secure-cicd-installer.md'],
    ['cicd.secure-installer', 'skills/secure-cicd-installer/templates/cicd/README.md', 'curated_output_for_ai/templates/cicd/README.md'],
    ['cicd.secure-installer', 'skills/n8n-workflow-sync/templates/sync-helpers/README.md', 'curated_output_for_ai/templates/n8n/sync-helpers/README.md']
  ];
  const expectedExactCopies = [
    ['n8n.local-setup', 'skills/n8n-local-setup/references/n8n/local-setup.md', '_main/1. local setup.md'],
    ['n8n.local-setup', 'skills/n8n-local-setup/references/n8n/upgrading.md', '_main/2. upgrading.md'],
    ['n8n.local-setup', 'skills/n8n-local-setup/references/n8n/tunnelling.md', '_main/3. tunneling guide.md'],
    ['n8n.local-setup', 'skills/n8n-local-setup/references/n8n/docker-compose-ngrok.md', '_main/3a. docker compose + ngrok.md'],
    ['n8n.local-setup', 'skills/n8n-local-setup/references/n8n/vps-hosting.md', '_main/4. vps hosting.md'],
    ['n8n.local-setup', 'skills/n8n-local-setup/references/ai-agent-platforms/claude-code.md', '_main/5. extra - claude code integration.md'],
    ['n8n.local-setup', 'skills/n8n-local-setup/references/ai-agent-platforms/opencode.md', '_main/6. extra - opencode integration.md'],
    ['n8n.local-setup', 'skills/n8n-local-setup/references/ai-agent-platforms/antigravity.md', '_main/7. extra - antigravity integration.md']
  ];
  const expectedJson = [
    ['n8n.local-setup', 'skills/n8n-local-setup/packs/codex-n8n-local/pack.json', 'curated_output_for_ai/packs/codex-n8n-local/pack.json'],
    ['n8n.local-setup', 'skills/n8n-local-setup/packs/claude-code-n8n-local/pack.json', 'curated_output_for_ai/packs/claude-code-n8n-local/pack.json'],
    ['n8n.workflow-templates', 'skills/n8n-workflow-sync/packs/n8n-workflow-sync/pack.json', 'curated_output_for_ai/packs/n8n-workflow-sync/pack.json'],
    ['cicd.secure-installer', 'skills/secure-cicd-installer/packs/secure-cicd/pack.json', 'curated_output_for_ai/packs/secure-cicd/pack.json']
  ];

  for (const [projectId, outputPath, source] of expectedMarkdown) {
    const output = manifestOutput(manifests.get(projectId), outputPath);
    assert.equal(output?.kind, 'curated', outputPath);
    assert.equal(output?.source, source, outputPath);
  }
  for (const [projectId, outputPath, source] of expectedExactCopies) {
    const output = manifestOutput(manifests.get(projectId), outputPath);
    assert.equal(output?.kind, 'copy', outputPath);
    assert.equal(output?.source, source, outputPath);
  }
  for (const [projectId, outputPath, source] of expectedJson) {
    const output = manifestOutput(manifests.get(projectId), outputPath);
    assert.equal(output?.kind, 'json', outputPath);
    assert.equal(output?.source, source, outputPath);
  }

  for (const projectId of ['n8n.local-setup', 'n8n.workflow-templates', 'cicd.secure-installer']) {
    for (const output of manifests.get(projectId).outputs || []) {
      if (output.kind !== 'linked') continue;
      assert.match(output.notes || '', /(source-locked|Toolkit-only)/, output.output);
    }
  }
});

test('curated Markdown outputs carry curated-source notices', () => {
  for (const [outputPath, sourcePath] of [
    [
      'skills/n8n-local-setup/SKILL.md',
      '_projects/n8n/local-setup/curated_output_for_ai/skills/n8n-local-setup/SKILL.md'
    ],
    [
      'skills/n8n-local-setup/README.md',
      '_projects/n8n/local-setup/curated_output_for_ai/skills/n8n-local-setup/README.md'
    ],
    [
      'skills/n8n-workflow-sync/templates/sync-helpers/README.md',
      '_projects/cicd/secure-installer/curated_output_for_ai/templates/n8n/sync-helpers/README.md'
    ]
  ]) {
    const text = fs.readFileSync(path.join(repoRoot, outputPath), 'utf8').replace(/\r\n/g, '\n');
    assert.match(text, /Generated from toolkit curated output for AI\. Do not edit directly\./, outputPath);
    assert.match(text, new RegExp(`Source: ${sourcePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), outputPath);
    assert.match(text, /Update the curated output and run sync\./, outputPath);
  }
});

test('changing curated skill README source makes generated skill README stale', () => {
  const cwd = tempCopy();
  const source = path.join(
    cwd,
    '_projects',
    'n8n',
    'local-setup',
    'curated_output_for_ai',
    'skills',
    'n8n-local-setup',
    'README.md'
  );
  fs.appendFileSync(source, '\n\n<!-- drift test -->\n');
  const result = spawnSync(process.execPath, [syncScript, '--check'], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Stale generated output: skills\/n8n-local-setup\/README\.md/);
});

test('curated JSON pack outputs match deterministic source formatting', () => {
  for (const [sourcePath, outputPath] of [
    [
      '_projects/n8n/local-setup/curated_output_for_ai/packs/codex-n8n-local/pack.json',
      'skills/n8n-local-setup/packs/codex-n8n-local/pack.json'
    ],
    [
      '_projects/n8n/workflow-templates/curated_output_for_ai/packs/n8n-workflow-sync/pack.json',
      'skills/n8n-workflow-sync/packs/n8n-workflow-sync/pack.json'
    ],
    [
      '_projects/cicd/secure-installer/curated_output_for_ai/packs/secure-cicd/pack.json',
      'skills/secure-cicd-installer/packs/secure-cicd/pack.json'
    ]
  ]) {
    const expected = `${JSON.stringify(readJsonFile(path.join(repoRoot, sourcePath)), null, 2)}\n`;
    assert.equal(fs.readFileSync(path.join(repoRoot, outputPath), 'utf8'), expected, outputPath);
  }
});

test('third-party UI UX project remains a linked special case', () => {
  const manifests = manifestsById();
  assert.equal(fs.existsSync(path.join(repoRoot, '_projects', 'design', 'ui-ux-pro-max', 'curated_output_for_ai')), false);
  for (const outputPath of [
    'skills/ui-ux-secure-frontend-design/SKILL.md',
    'mcp/projects/ui-ux-pro-max.md',
    'skills/ui-ux-secure-frontend-design/references/project/ui-ux-pro-max.md',
    'skills/ui-ux-secure-frontend-design/tools/design-system-generator/README.md',
    'skills/ui-ux-secure-frontend-design/tools/design-system-generator/LICENSE-THIRD-PARTY-NOTES.md',
    'skills/ui-ux-secure-frontend-design/packs/design-system-generator/pack.json'
  ]) {
    assert.equal(manifestOutput(manifests.get('design.ui-ux-pro-max'), outputPath)?.kind, 'linked', outputPath);
  }
});

test('project modules require README, manifest, lock, toolkit metadata, and _main only', () => {
  const cwd = tempCopy();
  fs.unlinkSync(path.join(cwd, '_projects', 'n8n', 'local-setup', 'toolkit.project.json'));
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing required project module file: _projects\/n8n\/local-setup\/toolkit\.project\.json/);
});

test('project module validation treats curated and generated folders as optional', () => {
  const errors = validator.runValidation();
  assert.equal(errors.filter((error) => /missing (curated_output_for_ai|_generated)/.test(error)).length, 0, errors.join('\n'));
});

test('source-lock audit passes and catches exact-copy drift for retired sources', () => {
  let result = spawnSync(process.execPath, [auditScript], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);

  const cwd = tempCopy();
  const lock = readJsonFile(path.join(cwd, '_projects', 'n8n', 'workflow-templates', 'SOURCE-LOCK.json'));
  assert.equal(lock.source_lifecycle, 'retired_after_migration');
  assert.equal(lock.source_update_policy, 'none');
  assert.equal(lock.public_attribution_required, false);
  const copiedFile = path.join(cwd, '_projects', 'n8n', 'workflow-templates', '_main', 'scripts', 'prepare-n8n-template.js');
  fs.appendFileSync(copiedFile, '\nDrift test\n');
  result = spawnSync(process.execPath, [auditScript], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exact-copy drift/);
});

test('source-lock audit rejects toolkit-local source_path provenance rewrites', () => {
  for (const sourcePath of ['skills/n8n-workflow-sync/templates/sync-helpers/README.md', 'repo/scripts/example.cjs', '_projects/n8n/local-setup/_main/README.md']) {
    const cwd = tempCopy();
    const lockPath = path.join(cwd, '_projects', 'n8n', 'workflow-templates', 'SOURCE-LOCK.json');
    const lock = readJsonFile(lockPath);
    lock.files[0].source_path = sourcePath;
    writeJsonFile(lockPath, lock);

    const result = spawnSync(process.execPath, [auditScript], { cwd, encoding: 'utf8' });
    assert.notEqual(result.status, 0, sourcePath);
    assert.match(result.stderr, /source_path must stay upstream-provenance, not toolkit-local/);
  }
});

test('source-lock audit requires local paths to stay in their topology namespaces', () => {
  let cwd = tempCopy();
  let lockPath = path.join(cwd, '_projects', 'n8n', 'workflow-templates', 'SOURCE-LOCK.json');
  let lock = readJsonFile(lockPath);
  lock.files[0].mode = 'adapted';
  lock.files[0].notes = 'Topology namespace regression test.';
  lock.files[0].project_path = 'skills/n8n-workflow-sync/templates/sync-helpers/README.md';
  delete lock.files[0].source_blob_sha;
  writeJsonFile(lockPath, lock);
  let result = spawnSync(process.execPath, [auditScript], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /project_path must point under _projects\//);

  cwd = tempCopy();
  lockPath = path.join(cwd, '_projects', 'n8n', 'workflow-templates', 'SOURCE-LOCK.json');
  lock = readJsonFile(lockPath);
  let rootSurfaceEntry = lock.files.find((entry) => entry.root_surface_path);
  rootSurfaceEntry.mode = 'adapted';
  rootSurfaceEntry.notes = 'Topology namespace regression test.';
  rootSurfaceEntry.root_surface_path = 'repo/scripts/validate-toolkit.cjs';
  delete rootSurfaceEntry.source_blob_sha;
  writeJsonFile(lockPath, lock);
  result = spawnSync(process.execPath, [auditScript], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /root_surface_path must point under skills\/ or mcp\//);

  cwd = tempCopy();
  lockPath = path.join(cwd, '_projects', 'n8n', 'workflow-templates', 'SOURCE-LOCK.json');
  lock = readJsonFile(lockPath);
  lock.files[0].mode = 'adapted';
  lock.files[0].notes = 'Topology traversal regression test.';
  lock.files[0].project_path = '_projects/../README.md';
  delete lock.files[0].source_blob_sha;
  writeJsonFile(lockPath, lock);
  result = spawnSync(process.execPath, [auditScript], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /project_path must not contain \.\. path segments/);

  cwd = tempCopy();
  lockPath = path.join(cwd, '_projects', 'n8n', 'workflow-templates', 'SOURCE-LOCK.json');
  lock = readJsonFile(lockPath);
  rootSurfaceEntry = lock.files.find((entry) => entry.root_surface_path);
  rootSurfaceEntry.mode = 'adapted';
  rootSurfaceEntry.notes = 'Topology traversal regression test.';
  rootSurfaceEntry.root_surface_path = 'skills/../repo/scripts/validate-toolkit.cjs';
  delete rootSurfaceEntry.source_blob_sha;
  writeJsonFile(lockPath, lock);
  result = spawnSync(process.execPath, [auditScript], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /root_surface_path must not contain \.\. path segments/);
});

test('source-lock audit rejects missing or unknown lifecycle metadata', () => {
  let cwd = tempCopy();
  let lockPath = path.join(cwd, '_projects', 'design', 'ui-ux-pro-max', 'SOURCE-LOCK.json');
  let lock = readJsonFile(lockPath);
  delete lock.source_lifecycle;
  writeJsonFile(lockPath, lock);
  let result = spawnSync(process.execPath, [auditScript], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing source_lifecycle/);

  cwd = tempCopy();
  lockPath = path.join(cwd, '_projects', 'design', 'ui-ux-pro-max', 'SOURCE-LOCK.json');
  lock = readJsonFile(lockPath);
  lock.source_lifecycle = 'unknown';
  lock.source_update_policy = 'maybe';
  writeJsonFile(lockPath, lock);
  result = spawnSync(process.execPath, [auditScript], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /unknown source_lifecycle/);
  assert.match(result.stderr, /unknown source_update_policy/);
});

test('source-lock lifecycle metadata accepts retired internal and active third-party sources', () => {
  const retired = readJsonFile(path.join(repoRoot, '_projects', 'n8n', 'local-setup', 'SOURCE-LOCK.json'));
  assert.equal(retired.source_lifecycle, 'retired_after_migration');
  assert.equal(retired.source_role, 'migration_provenance_only');
  assert.equal(retired.source_update_policy, 'none');
  assert.equal(retired.public_attribution_required, false);

  const thirdParty = readJsonFile(path.join(repoRoot, '_projects', 'design', 'ui-ux-pro-max', 'SOURCE-LOCK.json'));
  assert.equal(thirdParty.source_lifecycle, 'active');
  assert.equal(thirdParty.source_role, 'third_party_attribution_source');
  assert.equal(thirdParty.source_update_policy, 'manual_review_required');
  assert.equal(thirdParty.public_attribution_required, true);
});

test('source watch separates retired provenance sources from active update candidates', () => {
  const plan = sourceWatcher.buildPlan(sourceWatcher.discoverLocks());
  const activeRepos = plan.active_update_candidates.map((entry) => entry.source_repo);
  const retiredRepos = plan.retired_provenance_sources.map((entry) => entry.source_repo);

  assert.deepEqual(activeRepos.filter((repo) => repo.startsWith('weijunswj/')), []);
  assert.ok(retiredRepos.includes('weijunswj/codex-n8n-local-setup'));
  assert.ok(retiredRepos.includes('weijunswj/ai-cicd-installer'));
  assert.ok(retiredRepos.includes('weijunswj/n8n-workflow-templates'));

  const thirdParty = plan.active_update_candidates.find((entry) => entry.source_repo === 'nextlevelbuilder/ui-ux-pro-max-skill');
  assert.ok(thirdParty);
  assert.equal(thirdParty.risk, 'third-party');
  assert.equal(thirdParty.update_policy, 'manual_review_required');
  assert.equal(thirdParty.public_attribution_required, true);
  assert.match(thirdParty.notes, /read-only advisory/i);
  assert.doesNotMatch(thirdParty.notes, /draft PR|open PR|create PR/i);
});

test('source watch rendered output is advisory and does not claim PR creation today', () => {
  const markdown = sourceWatcher.renderMarkdown(sourceWatcher.buildPlan(sourceWatcher.discoverLocks()));
  assert.match(markdown, /advisory/i);
  assert.match(markdown, /Retired internal sources are provenance-only/);
  assert.match(markdown, /does not fetch upstream commits, copy files, update SOURCE-LOCK\.json, create branches, or create PRs/);
  assert.doesNotMatch(markdown, /Draft PR only|opens PRs today|creates PRs today|pushes commits/i);
});

test('public source repo registry excludes retired internal provenance sources', () => {
  const registry = readJsonFile(path.join(repoRoot, 'mcp', 'registry', 'source-repos.registry.json'));
  const sources = registry.map((entry) => entry.source);
  assert.ok(sources.includes('nextlevelbuilder/ui-ux-pro-max-skill'));
  assert.equal(sources.includes('weijunswj/codex-n8n-local-setup'), false);
  assert.equal(sources.includes('weijunswj/ai-cicd-installer'), false);
  assert.equal(sources.includes('weijunswj/n8n-workflow-templates'), false);
});

test('validator rejects retired internal repos as active public source-watch targets', () => {
  const cwd = tempCopy();
  const registryPath = path.join(cwd, 'mcp', 'registry', 'source-repos.registry.json');
  const registry = readJsonFile(registryPath);
  registry.push({
    id: 'bad.retired',
    source: 'weijunswj/codex-n8n-local-setup',
    project_module: '_projects/n8n/local-setup'
  });
  writeJsonFile(registryPath, registry);
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /retired internal repo must not be listed as active source-watch target/);
});

test('source-lock audit rejects active third-party sources without manual review metadata', () => {
  const cwd = tempCopy();
  const lockPath = path.join(cwd, '_projects', 'design', 'ui-ux-pro-max', 'SOURCE-LOCK.json');
  const lock = readJsonFile(lockPath);
  lock.source_update_policy = 'none';
  lock.public_attribution_required = false;
  writeJsonFile(lockPath, lock);
  const result = spawnSync(process.execPath, [auditScript], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /third-party attribution source must use source_update_policy manual_review_required/);
  assert.match(result.stderr, /third-party attribution source must set public_attribution_required true/);
});

test('curated recipes must source from curated_output_for_ai', () => {
  const cwd = tempCopy();
  const projectDir = path.join(cwd, '_projects', 'n8n', 'local-setup');
  const manifestPath = path.join(projectDir, 'toolkit.project.json');
  const manifest = readJsonFile(manifestPath);
  fs.writeFileSync(path.join(projectDir, '_main', 'bad-curated.md'), 'Bad curated source\n');
  manifest.outputs.push({
    kind: 'curated',
    source: '_main/bad-curated.md',
    output: 'skills/n8n-local-setup/references/n8n/bad-curated.md'
  });
  manifest.writes.allowed.push('skills/n8n-local-setup/references/n8n/bad-curated.md');
  writeJsonFile(manifestPath, manifest);

  const result = spawnSync(process.execPath, [syncScript, '--check'], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /curated output source must start with curated_output_for_ai\//);
});

test('internal curated Markdown files carry the curated review note', () => {
  const required = [
    'Curated AI-facing source.',
    'Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.'
  ];
  for (const projectDir of [
    '_projects/n8n/local-setup/curated_output_for_ai',
    '_projects/n8n/workflow-templates/curated_output_for_ai',
    '_projects/cicd/secure-installer/curated_output_for_ai'
  ]) {
    const files = fs.readdirSync(path.join(repoRoot, projectDir), { recursive: true })
      .map((entry) => String(entry).replace(/\\/g, '/'))
      .filter((entry) => entry.endsWith('.md'));
    assert.ok(files.length > 0, projectDir);
    for (const file of files) {
      const text = readTextFile(path.join(repoRoot, projectDir, file));
      for (const needle of required) assert.ok(text.includes(needle), `${projectDir}/${file}`);
    }
  }
});

test('validator rejects stale mandatory exports architecture wording in permanent docs', () => {
  const cwd = tempCopy();
  fs.writeFileSync(path.join(cwd, 'repo', 'docs', 'bad-exports.md'), 'Every project module must include an `exports' + '/` folder.\n');
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Stale mandatory exports architecture wording/);
});

test('validator rejects stale registry YAML references in temp docs', () => {
  const cwd = tempCopy();
  fs.writeFileSync(path.join(cwd, 'repo', 'docs', 'bad.md'), `Use ${'mcp/registry/*.' + 'yaml'} here.\n`);
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Stale registry YAML reference/);
});

test('validator rejects stale project exports path references in active docs', () => {
  const cwd = tempCopy();
  fs.writeFileSync(path.join(cwd, 'repo', 'docs', 'bad-export-source.md'), `Source: ${'projects/design/ui-ux-pro-max/' + 'exports/tools/readme.md'}\n`);
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Stale project exports path reference/);
});

test('validator rejects project landing cards that stop pointing to _main', () => {
  const cwd = tempCopy();
  fs.writeFileSync(
    path.join(cwd, '_projects', 'n8n', 'local-setup', 'README.md'),
    '# Local n8n Setup\n\nUse playbooks/ as canonical human documentation.\n'
  );
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /project README must link to _main\//);
  assert.match(result.stderr, /must not claim playbooks are canonical human documentation/);
});

test('validator rejects oversized project landing cards', () => {
  const cwd = tempCopy();
  const longBody = Array.from({ length: 45 }, (_, index) => `Line ${index + 1}`).join('\n');
  fs.writeFileSync(
    path.join(cwd, '_projects', 'n8n', 'local-setup', 'README.md'),
    `# Local n8n Setup\n\nCanonical docs live in [_main/](_main/).\n\n${longBody}\n`
  );
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /project README must stay a tiny landing card/);
});

test('validator rejects source-watch wording that promises live update actions', () => {
  const cwd = tempCopy();
  fs.writeFileSync(
    path.join(cwd, 'repo', 'docs', 'bad-source-watch.md'),
    'Source-watch fetches upstream repos, copies allowlisted files, opens draft PRs, runs live n8n, and mutates credentials.\n'
  );
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /source-watch wording must stay advisory\/read-only/);
});

test('validator rejects source-watch action claims even with advisory wording', () => {
  const cwd = tempCopy();
  fs.writeFileSync(
    path.join(cwd, 'repo', 'docs', 'bad-source-watch-advisory.md'),
    'Source-watch is advisory but opens draft PRs.\n'
  );
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /source-watch wording must stay advisory\/read-only/);
});

test('validator allows source-watch action phrases when the action is negated', () => {
  const cwd = tempCopy();
  fs.writeFileSync(
    path.join(cwd, 'repo', 'docs', 'ok-source-watch-negated.md'),
    [
      'source-watch does not open PRs.',
      'source-watch will not create branches.',
      'source-watch never mutates credentials.',
      'source-watch is read-only; it does not fetch upstream repos.'
    ].join('\n')
  );
  const result = runValidate(cwd);
  assert.equal(result.status, 0, result.stderr);
});

test('validator rejects pack YAML files in temp dirs', () => {
  const cwd = tempCopy();
  const badDir = path.join(cwd, 'skills', 'n8n-local-setup', 'packs', 'bad');
  fs.mkdirSync(badDir, { recursive: true });
  fs.writeFileSync(path.join(badDir, 'pack.' + 'yaml'), 'id: bad\n');
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /not allowed/);
});

test('validator rejects forbidden local files and folders', () => {
  const cwd = tempCopy();
  fs.writeFileSync(path.join(cwd, '.env'), 'EXAMPLE=unsafe\n');
  fs.mkdirSync(path.join(cwd, '.n8n-local'), { recursive: true });
  fs.writeFileSync(path.join(cwd, 'sample.live-export.json'), '{}\n');
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Forbidden env file/);
  assert.match(result.stderr, /Forbidden directory/);
  assert.match(result.stderr, /Live n8n import\/export file/);
});

test('validator rejects obvious secret-looking strings', () => {
  const cwd = tempCopy();
  fs.writeFileSync(path.join(cwd, 'repo', 'docs', 'secret.md'), `key=${'sk-' + 'A'.repeat(25)}\n`);
  const result = runValidate(cwd);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /possible secret/);
});

test('safe-source-update classifies n8n helper templates as manual and workflow JSON as blocked', () => {
  assert.equal(safeSourceUpdate.classify('skills/n8n-workflow-sync/templates/sync-helpers/compare-n8n-workflow-credentials.cjs'), 'manual');
  assert.equal(safeSourceUpdate.classify('skills/n8n-workflow-sync/templates/sanitizer/sanitise-n8n-template.ps1'), 'manual');
  assert.equal(safeSourceUpdate.classify('n8n-workflows/customer-workflow.json'), 'blocked');
});
