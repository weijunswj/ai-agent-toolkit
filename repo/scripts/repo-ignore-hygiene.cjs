'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { CANONICAL_BACKUP_DIR, LEGACY_BACKUP_DIR, sha256 } = require('./repo-local-backup.cjs');

const RULES = Object.freeze({
  canonical: `/${CANONICAL_BACKUP_DIR}/`,
  legacy: `/${LEGACY_BACKUP_DIR}/`,
});
const CHOICES = Object.freeze({
  GITIGNORE: 'gitignore',
  EXCLUDE: 'exclude',
  DECLINE: 'decline',
  PROCEED_WARNING: 'proceed-warning',
});

function samePath(left, right) {
  const a = path.resolve(left);
  const b = path.resolve(right);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

function runGit(repoRoot, args, options = {}) {
  const result = spawnSync('git', ['-C', repoRoot, ...args], {
    encoding: options.encoding === undefined ? 'utf8' : options.encoding,
    input: options.input,
    windowsHide: true,
    shell: false,
  });
  if (result.error) throw new Error(`Git inspection failed: ${result.error.message}`);
  return result;
}

function discoverRepository(repoRoot) {
  const requested = path.resolve(repoRoot);
  const top = runGit(requested, ['rev-parse', '--show-toplevel']);
  if (top.status !== 0) throw new Error('Ignore hygiene requires a real Git repository.');
  const resolved = path.resolve(String(top.stdout).trim());
  if (!samePath(requested, resolved)) throw new Error('Ignore hygiene must target the repository root explicitly.');
  const exclude = runGit(resolved, ['rev-parse', '--git-path', 'info/exclude']);
  if (exclude.status !== 0 || !String(exclude.stdout).trim()) throw new Error('Git local exclude path could not be resolved.');
  const excludePath = path.isAbsolute(String(exclude.stdout).trim())
    ? path.resolve(String(exclude.stdout).trim())
    : path.resolve(resolved, String(exclude.stdout).trim());
  return { repo_root: resolved, gitignore_path: path.join(resolved, '.gitignore'), exclude_path: excludePath };
}

function readSnapshot(filePath) {
  try {
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`Ignore target must be a regular file or missing: ${filePath}`);
    const bytes = fs.readFileSync(filePath);
    const text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes)) throw new Error(`Ignore target is not valid UTF-8: ${filePath}`);
    return { path: filePath, existed: true, bytes, sha256: sha256(bytes), mode: process.platform === 'win32' ? null : stat.mode & 0o7777 };
  } catch (error) {
    if (error && error.code === 'ENOENT') return { path: filePath, existed: false, bytes: Buffer.alloc(0), sha256: null, mode: null };
    throw error;
  }
}

function snapshotsMatch(left, right) {
  return left.existed === right.existed && left.sha256 === right.sha256 && left.bytes.length === right.bytes.length;
}

function newlineStyle(bytes) {
  const text = bytes.toString('utf8');
  const crlf = (text.match(/\r\n/g) || []).length;
  const lf = (text.match(/(^|[^\r])\n/g) || []).length;
  if (crlf > lf) return '\r\n';
  return '\n';
}

function hasFinalNewline(bytes) {
  return bytes.length > 0 && bytes[bytes.length - 1] === 0x0a;
}

function appendRules(snapshot, rules) {
  if (!rules.length) return Buffer.from(snapshot.bytes);
  const eol = newlineStyle(snapshot.bytes);
  const body = rules.join(eol);
  if (!snapshot.existed) return Buffer.from(`${body}${eol}`, 'utf8');
  if (!snapshot.bytes.length) return Buffer.from(body, 'utf8');
  if (hasFinalNewline(snapshot.bytes)) return Buffer.concat([snapshot.bytes, Buffer.from(`${body}${eol}`, 'utf8')]);
  return Buffer.concat([snapshot.bytes, Buffer.from(`${eol}${body}`, 'utf8')]);
}

function normalizeReportedSource(repo, source) {
  const value = String(source || '');
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(repo.repo_root, value);
}

function gitCoverage(repo, folder) {
  const probe = `${folder}/.toolkit-ignore-probe`;
  const nullDevice = process.platform === 'win32' ? 'NUL' : '/dev/null';
  const result = runGit(repo.repo_root, ['-c', `core.excludesFile=${nullDevice}`, 'check-ignore', '-z', '-v', '--no-index', '--stdin'], {
    encoding: null,
    input: Buffer.from(`${probe}\n`, 'utf8'),
  });
  if (result.status === 1) return null;
  if (result.status !== 0) throw new Error('Git could not evaluate ignore coverage safely.');
  const fields = Buffer.from(result.stdout).toString('utf8').split('\0').filter((field) => field !== '');
  if (fields.length < 4) throw new Error('Git returned malformed ignore coverage evidence.');
  const match = { source: fields[0], line: Number(fields[1]), pattern: fields[2], path: fields[3] };
  if (match.pattern.startsWith('!')) return null;
  const sourcePath = normalizeReportedSource(repo, match.source);
  if (samePath(sourcePath, repo.gitignore_path)) match.location = '.gitignore';
  else if (samePath(sourcePath, repo.exclude_path)) match.location = '.git/info/exclude';
  else return null;
  return match;
}

function exactRuleKind(pattern, folder) {
  const normalized = String(pattern || '').trim();
  const expected = [folder, `/${folder}`, `${folder}/`, `/${folder}/`];
  return expected.includes(normalized) ? 'narrow-equivalent' : 'broader-demonstrated-coverage';
}

function exactFileMatch(filePath, folder, location) {
  const snapshot = readSnapshot(filePath);
  if (!snapshot.existed) return null;
  let effective = null;
  const positive = new Set([folder, `/${folder}`, `${folder}/`, `/${folder}/`]);
  for (const [index, raw] of snapshot.bytes.toString('utf8').split(/\r?\n/).entries()) {
    const pattern = raw.trim().replace(/^\uFEFF/, '');
    if (!pattern || pattern.startsWith('#')) continue;
    const negated = pattern.startsWith('!');
    const candidate = negated ? pattern.slice(1) : pattern;
    if (positive.has(candidate)) effective = negated ? null : { source: location, line: index + 1, pattern: candidate };
  }
  return effective;
}

function coverageMatches(repo, folder) {
  const effective = gitCoverage(repo, folder);
  if (!effective) return [];
  const matches = [
    exactFileMatch(repo.gitignore_path, folder, '.gitignore'),
    exactFileMatch(repo.exclude_path, folder, '.git/info/exclude'),
  ].filter(Boolean);
  if (!matches.some((match) => match.source === effective.location && match.line === effective.line)) {
    matches.push({ source: effective.location, line: effective.line, pattern: effective.pattern });
  }
  return matches;
}

function coverageEntry(repo, key, matches, canonicalPresent, legacyPresent) {
  const folder = key === 'canonical' ? CANONICAL_BACKUP_DIR : LEGACY_BACKUP_DIR;
  const gitignore = matches.some((match) => match.source === '.gitignore');
  const exclude = matches.some((match) => match.source === '.git/info/exclude');
  const coverage = gitignore && exclude ? 'both' : gitignore ? '.gitignore' : exclude ? '.git/info/exclude' : 'not-covered';
  return {
    folder: `/${folder}/`,
    coverage,
    covered_by_gitignore: gitignore,
    covered_by_info_exclude: exclude,
    matches: matches.map((match) => ({ ...match, kind: exactRuleKind(match.pattern, folder) })),
    existing_folder_present: key === 'canonical' ? canonicalPresent : legacyPresent,
    legacy_folder_present: legacyPresent,
    proposed_action: matches.length ? 'none; existing coverage is effective' : `add ${RULES[key]} to the explicitly selected ignore file`,
    mutation_required: matches.length === 0,
    user_approval_required: matches.length === 0,
  };
}

function inspectIgnoreHygiene(repoRoot) {
  const repo = discoverRepository(repoRoot);
  const canonicalPresent = fs.existsSync(path.join(repo.repo_root, CANONICAL_BACKUP_DIR));
  const legacyPresent = fs.existsSync(path.join(repo.repo_root, LEGACY_BACKUP_DIR));
  const canonicalMatches = coverageMatches(repo, CANONICAL_BACKUP_DIR);
  const legacyMatches = coverageMatches(repo, LEGACY_BACKUP_DIR);
  return {
    repository: repo.repo_root,
    files: {
      gitignore: { path: repo.gitignore_path, exists: fs.existsSync(repo.gitignore_path) },
      info_exclude: { path: repo.exclude_path, exists: fs.existsSync(repo.exclude_path) },
    },
    canonical: coverageEntry(repo, 'canonical', canonicalMatches, canonicalPresent, legacyPresent),
    legacy: coverageEntry(repo, 'legacy', legacyMatches, canonicalPresent, legacyPresent),
  };
}

function previewDigest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function previewIgnoreHygiene(repoRoot, choice = CHOICES.GITIGNORE) {
  if (![CHOICES.GITIGNORE, CHOICES.EXCLUDE, CHOICES.DECLINE, CHOICES.PROCEED_WARNING].includes(choice)) throw new Error('Unsupported ignore-hygiene choice.');
  const coverage = inspectIgnoreHygiene(repoRoot);
  const targetPath = choice === CHOICES.EXCLUDE ? coverage.files.info_exclude.path : choice === CHOICES.GITIGNORE ? coverage.files.gitignore.path : null;
  const targetSnapshot = targetPath ? readSnapshot(targetPath) : null;
  const additions = [];
  if (choice === CHOICES.GITIGNORE || choice === CHOICES.EXCLUDE) {
    const targetKey = choice === CHOICES.GITIGNORE ? 'covered_by_gitignore' : 'covered_by_info_exclude';
    if (!coverage.canonical[targetKey]) additions.push(RULES.canonical);
    if (!coverage.legacy[targetKey]) additions.push(RULES.legacy);
  }
  const mutationRequired = Boolean(targetPath && additions.length);
  const binding = {
    schema: 'ai-agent-toolkit.ignore-hygiene-preview.v1',
    repository: coverage.repository,
    choice,
    target_file: targetPath,
    target_existed: targetSnapshot ? targetSnapshot.existed : null,
    target_sha256: targetSnapshot ? targetSnapshot.sha256 : null,
    additions,
  };
  const preview = {
    ...binding,
    coverage,
    exact_lines_proposed: additions,
    canonical_reason: 'Canonical rule protects all new Toolkit-created repo-local backups.',
    legacy_reason: 'Legacy rule protects existing backups only; Toolkit never selects it for new writes or migrates its contents.',
    tracked_consequence: choice === CHOICES.GITIGNORE ? 'The repository .gitignore will become the only intended tracked working-tree change.' : 'No tracked ignore file is changed by this choice.',
    local_only_consequence: choice === CHOICES.EXCLUDE ? 'Coverage is local to this Git checkout and is not shared by commits.' : 'No local exclude file is changed by this choice.',
    working_tree_dirty: choice === CHOICES.GITIGNORE && mutationRequired,
    canonical_folder_exists: coverage.canonical.existing_folder_present,
    legacy_folder_exists: coverage.legacy.existing_folder_present,
    backup_content_action: 'No backup content will be moved, merged, rewritten, or deleted.',
    mutation_required: mutationRequired,
    user_approval_required: mutationRequired,
    unresolved_warning: choice === CHOICES.PROCEED_WARNING && (coverage.canonical.mutation_required || coverage.legacy.mutation_required)
      ? 'Proceeding leaves Toolkit backup ignore hygiene unresolved; the parent operation may continue only if it is otherwise safe.'
      : null,
  };
  preview.approval_digest = previewDigest(binding);
  return preview;
}

function atomicWrite(filePath, bytes, mode, options = {}) {
  const parent = path.dirname(filePath);
  if (options.createParent) fs.mkdirSync(parent, { recursive: true });
  const temp = path.join(parent, `.${path.basename(filePath)}.toolkit-${process.pid}-${crypto.randomBytes(6).toString('hex')}`);
  let replaced = false;
  try {
    fs.writeFileSync(temp, bytes, { flag: 'wx', mode: mode == null ? 0o600 : mode });
    if (typeof options.beforeReplace === 'function') options.beforeReplace();
    fs.renameSync(temp, filePath);
    replaced = true;
  } finally {
    if (!replaced) {
      try { fs.unlinkSync(temp); } catch {}
    }
  }
}

function applyIgnoreHygiene(repoRoot, request, options = {}) {
  if (!request || typeof request !== 'object') throw new Error('An explicit ignore-hygiene request is required.');
  const choice = request.choice;
  const preview = previewIgnoreHygiene(repoRoot, choice);
  if (request.approval_digest !== preview.approval_digest) throw new Error('Approval is missing, stale, or not bound to this exact ignore-hygiene preview.');
  if (choice === CHOICES.DECLINE) return { status: 'declined', changed: false, preview };
  if (choice === CHOICES.PROCEED_WARNING) {
    if (request.parent_operation_safe !== true) throw new Error('Proceed-with-warning requires an explicit assertion that the parent operation remains safe.');
    return { status: 'proceed-with-warning', changed: false, warning: preview.unresolved_warning, preview };
  }
  if (!preview.mutation_required) return { status: 'already-covered', changed: false, preview };
  const target = preview.target_file;
  const before = readSnapshot(target);
  const expected = { existed: preview.target_existed, sha256: preview.target_sha256, bytes: before.bytes };
  if (!snapshotsMatch(before, expected)) throw new Error('Ignore file changed after preview; a fresh preview and approval are required.');
  const replacement = appendRules(before, preview.exact_lines_proposed);
  const createParent = choice === CHOICES.EXCLUDE;
  if (createParent) {
    const repo = discoverRepository(repoRoot);
    if (!samePath(target, repo.exclude_path)) throw new Error('Local exclude target changed after preview.');
  }
  atomicWrite(target, replacement, before.mode, {
    createParent,
    beforeReplace: () => {
      const current = readSnapshot(target);
      if (!snapshotsMatch(before, current)) throw new Error('Ignore file changed immediately before replacement; refusing the stale approval.');
      if (typeof options.beforeReplace === 'function') options.beforeReplace({ target, replacement });
    },
  });
  return { status: 'updated', changed: true, target_file: target, added: preview.exact_lines_proposed, preview };
}

function passiveIgnoreHygiene(repoRoot) {
  const coverage = inspectIgnoreHygiene(repoRoot);
  return {
    status: coverage.canonical.mutation_required || coverage.legacy.mutation_required ? 'warning' : 'ok',
    changed: false,
    coverage,
    message: 'Passive Toolkit inspection is read-only; use an active preview and exact approval before changing ignore files.',
  };
}

function parseArgs(argv) {
  const args = { command: argv[2] || 'status' };
  for (let index = 3; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--repo') args.repo = argv[++index];
    else if (value === '--choice') args.choice = argv[++index];
    else if (value === '--approval-digest') args.approval_digest = argv[++index];
    else if (value === '--parent-operation-safe') args.parent_operation_safe = true;
    else throw new Error(`Unknown argument: ${value}`);
  }
  return args;
}

function main(argv = process.argv) {
  const args = parseArgs(argv);
  const root = args.repo || process.cwd();
  let result;
  if (args.command === 'status') result = passiveIgnoreHygiene(root);
  else if (args.command === 'preview') result = previewIgnoreHygiene(root, args.choice || CHOICES.GITIGNORE);
  else if (args.command === 'apply') result = applyIgnoreHygiene(root, { choice: args.choice, approval_digest: args.approval_digest, parent_operation_safe: args.parent_operation_safe });
  else throw new Error('Usage: repo-ignore-hygiene.cjs status|preview|apply --repo <path> [--choice gitignore|exclude|decline|proceed-warning] [--approval-digest <sha256>] [--parent-operation-safe]');
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

if (require.main === module) {
  try { main(); } catch (error) { process.stderr.write(`FAIL: ${error.message}\n`); process.exitCode = 1; }
}

module.exports = {
  RULES,
  CHOICES,
  discoverRepository,
  readSnapshot,
  appendRules,
  inspectIgnoreHygiene,
  previewIgnoreHygiene,
  applyIgnoreHygiene,
  passiveIgnoreHygiene,
  main,
};
