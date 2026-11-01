#!/usr/bin/env node
'use strict';

// Coordinator-run release maintenance. Report by default; --apply prepares in a
// disposable clone and only fast-forwards existing same-repository PR branches.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { isDeepStrictEqual } = require('node:util');
const { VERSION_REL_PATH, SEMVER } = require('./toolkit-version.cjs');
const { MANIFEST_REL_PATHS } = require('./bump-version.cjs');
const { LEVELS, CHANGELOG_REL_PATH, FRAGMENT_DIR_REL_PATH, PROJECTS_SKILL_REL_PATH,
  nextVersion, headingOf, topChangelogVersion, fragmentProblems, foldFragments } = require('./toolkit-version-at-merge.cjs');

const VERSION_FILES = [VERSION_REL_PATH, ...MANIFEST_REL_PATHS];
const STAMP_FILES = new Set([
  'AGENTS.md', 'README.md', '.agents/rules/00-agent-toolkit-bootstrap.md',
  'repo/contracts/agent-rules/repo-local/AGENTS.managed.template.md',
  'repo/contracts/agent-rules/repo-local/antigravity-bootstrap.template.md',
  'skills/repository-agent-rules/repo-local/AGENTS.managed.template.md',
  'skills/repository-agent-rules/repo-local/antigravity-bootstrap.template.md',
  'skills/n8n-safety-router/n8n-safety-rules.md',
  'skills/n8n-environment-setup/references/n8n-safety-rules.md',
  'skills/n8n-workflow-transport/references/n8n-safety-rules.md',
  'skills/n8n-safety-router/adapters/AGENTS.n8n-brief.template.md',
  'repo/docs/published-surface-audit-baseline.json', PROJECTS_SKILL_REL_PATH,
]);
const SHA = /^[0-9a-f]{40}$/;
function safeRef(ref) {
  if (typeof ref !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ref) ||
      ref.includes('..') || ref.includes('//') || ref.includes('@{') ||
      ref.split('/').some(part => part.startsWith('.') || part.endsWith('.') || part.endsWith('.lock')) || ref.endsWith('/')) {
    throw new Error('unsafe branch ref');
  }
  return ref;
}
function repositoryFromOrigin(origin) {
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(origin.trim());
  if (!match) throw new Error('origin must name a github.com repository without embedded credentials');
  return match[1];
}
function detectIntent(base, head) {
  if (!SEMVER.test(base || '') || !SEMVER.test(head || '')) throw new Error('unreadable merge-base or head version');
  if (base === head) return '';
  const level = LEVELS.find(value => nextVersion(base, value) === head);
  if (!level) throw new Error(`hold: ${head} is not exactly next patch, minor or major after merge-base version ${base}`);
  return level;
}
function mergeJson(base, head, main) {
  if (isDeepStrictEqual(head, main)) return head;
  if (isDeepStrictEqual(base, head)) return main;
  if (isDeepStrictEqual(base, main)) return head;
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  if (!object(base) || !object(head) || !object(main)) throw new Error('conflicting non-version manifest field');
  const result = Object.create(null);
  for (const key of new Set([...Object.keys(base), ...Object.keys(head), ...Object.keys(main)])) {
    const value = mergeJson(base[key], head[key], main[key]);
    if (value !== undefined) result[key] = value;
  }
  return result;
}
function splitChangelog(text) {
  const matches = [...text.matchAll(/^ {0,3}##(?:[ \t]+[^\r\n]*)?\r?$/gm)];
  if (!matches.length) throw new Error('CHANGELOG has no release entries');
  const headings = matches.map(match => headingOf(match[0]));
  const versions = headings.map(topChangelogVersion).filter(Boolean);
  if (new Set(headings).size !== headings.length || new Set(versions).size !== versions.length) throw new Error('duplicate CHANGELOG headings');
  return { prefix: text.slice(0, matches[0].index), entries: matches.map((match, i) => text.slice(match.index, matches[i + 1]?.index ?? text.length)) };
}
function recoverNotes(baseText, headText, headVersion) {
  const base = splitChangelog(baseText), head = splitChangelog(headText);
  if (base.entries.some(entry => !topChangelogVersion(entry))) throw new Error('ambiguous inherited Unreleased notes');
  if (head.prefix !== base.prefix || head.entries.length !== base.entries.length + 1 ||
      head.entries.slice(1).join('') !== base.entries.join('') || topChangelogVersion(head.entries[0]) !== headVersion) {
    throw new Error('PR must carry one new release entry and keep released entries byte for byte');
  }
  const entry = head.entries[0];
  const heading = headingOf(entry.split('\n')[0]);
  const match = /^## \d+\.\d+\.\d+(?: \((.*)\))?$/.exec(heading);
  if (!match) throw new Error('unsupported release heading');
  const notes = `${match[1] ? `Title: ${match[1]}\n\n` : ''}${entry.slice(entry.indexOf('\n') + 1).trim()}\n`;
  const problems = fragmentProblems('recovered PR notes', notes);
  if (problems.length) throw new Error(problems.join('; '));
  return notes;
}
function runProcess(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 120000 });
  if (result.error) throw new Error(`${command} could not run: ${result.error.code || 'process error'}`);
  return result;
}
function checked(result, label) {
  if (result.status !== 0) throw new Error(`${label} failed (exit ${result.status})`);
  return result.stdout.trim();
}

class PrRebumpOperation {
  constructor({ workspace, apply = false, repo = '' }, deps = {}) {
    this.workspace = path.resolve(workspace);
    this.apply = apply;
    this.repo = repo;
    this.git = deps.git || ((cwd, args) => runProcess('git', args, cwd));
    this.github = deps.github || ((args) => checked(runProcess('gh', args, this.workspace), 'GitHub read'));
    this.generate = deps.generate || ((cwd, args) => checked(runProcess(process.execPath,
      [path.join(cwd, 'repo/scripts/bump-version.cjs'), ...args], cwd), 'version generation'));
    this.validate = deps.validate || ((cwd, base) => {
      checked(runProcess(process.execPath, ['repo/scripts/validate-toolkit.cjs'], cwd, { ...process.env, DIFF_BASE: base }), 'Toolkit validation');
      checked(this.git(cwd, ['diff', '--check']), 'whitespace check');
    });
  }
  g(cwd, args) { return checked(this.git(cwd, args), `git ${args[0]}`); }
  api(endpoint) { return JSON.parse(this.github(['api', endpoint])); }
  blob(cwd, sha, rel) { return this.git(cwd, ['show', `${sha}:${rel}`]); }
  read(cwd, sha, rel) { const result = this.blob(cwd, sha, rel); checked(result, `read ${rel}`); return result.stdout; }
  version(cwd, sha) { return JSON.parse(this.read(cwd, sha, VERSION_REL_PATH)).version; }
  remoteSha(branch) {
    const rows = this.g(this.workspace, ['ls-remote', '--refs', 'origin', `refs/heads/${safeRef(branch)}`]).split(/\s+/);
    if (!SHA.test(rows[0]) || rows[1] !== `refs/heads/${branch}`) throw new Error('remote branch is missing');
    return rows[0];
  }
  eligible(pr) {
    if (!Number.isSafeInteger(pr.number) || pr.number < 1) throw new Error('invalid pull request number');
    if (pr.state !== 'open' || pr.draft || pr.base?.ref !== 'main' || pr.head?.repo?.full_name !== this.repo || pr.base?.repo?.full_name !== this.repo) return 'draft, fork, closed or non-main target';
    safeRef(pr.head.ref);
    if (pr.head.ref === 'main' || !SHA.test(pr.head.sha)) throw new Error('invalid PR head');
    if (pr.auto_merge) throw new Error('queued auto-merge must be removed before updating this branch');
    return '';
  }
  snapshot(cwd, pr, main) {
    const bases = this.g(cwd, ['merge-base', '--all', main, pr.head.sha]).split(/\s+/);
    if (bases.length !== 1 || !SHA.test(bases[0])) throw new Error('need exactly one merge base and full local history');
    const base = bases[0], head = pr.head.sha;
    const level = detectIntent(this.version(cwd, base), this.version(cwd, head));
    if (!level) return { status: 'skipped', reason: 'no version bump' };
    const notes = recoverNotes(this.read(cwd, base, CHANGELOG_REL_PATH), this.read(cwd, head, CHANGELOG_REL_PATH), this.version(cwd, head));
    const mainLog = this.read(cwd, main, CHANGELOG_REL_PATH);
    if (splitChangelog(mainLog).entries.some(entry => !topChangelogVersion(entry))) throw new Error('main has ambiguous Unreleased notes');
    const target = nextVersion(this.version(cwd, main), level);
    const contained = this.git(cwd, ['merge-base', '--is-ancestor', main, head]).status === 0;
    return { status: contained ? 'unchanged' : 'eligible', main, head, base, level, target, notes, mainLog };
  }
  mergeText(cwd, rel, base, head, main) {
    const texts = [base, head, main].map(sha => this.read(cwd, sha, rel));
    let restore;
    let normalised;
    if (VERSION_FILES.includes(rel)) {
      const values = texts.map(text => JSON.parse(text));
      if (values.some(value => typeof value.version !== 'string')) throw new Error(`no version field in ${rel}`);
      const version = values[2].version;
      for (const value of values) delete value.version;
      return `${JSON.stringify({ ...mergeJson(...values), version }, null, 2)}\n`;
    } else if (STAMP_FILES.has(rel)) {
      normalised = texts.map(text => text.replace(/(toolkit=)\d+\.\d+\.\d+(?= sha256=)/g, '$1VERSION')
        .replace(/^Version: \d{4}-\d{2}-\d{2}\.\d+$/gm, 'Version: SKILL_VERSION')
        .replace(rel === 'repo/docs/published-surface-audit-baseline.json' ? /("version": ")\d+\.\d+\.\d+(".*)/g : /$^/g, '$1VERSION$2'));
      restore = text => text.replace(/toolkit=VERSION/g, `toolkit=${this.version(cwd, main)}`)
        .replace(/^Version: SKILL_VERSION$/gm, /^Version: .*$/m.exec(texts[2])?.[0] || 'Version: SKILL_VERSION')
        .replace(/("version": ")VERSION"/g, `$1${this.version(cwd, main)}"`);
    } else throw new Error(`source conflict: ${rel}`);
    const temp = path.join(cwd, '.git', 'rebump-merge');
    fs.mkdirSync(temp, { recursive: true });
    const files = normalised.map((text, index) => { const file = path.join(temp, String(index)); fs.writeFileSync(file, text); return file; });
    const result = this.git(cwd, ['merge-file', '-p', files[1], files[0], files[2]]);
    checked(result, `non-version conflict in ${rel}`);
    return restore(result.stdout);
  }
  prepare(cwd, pr, snapshot) {
    const s = snapshot;
    this.g(cwd, ['checkout', '-q', '-b', 'rebump-candidate', s.head]);
    this.g(cwd, ['config', 'user.name', 'Toolkit release maintenance']);
    this.g(cwd, ['config', 'user.email', 'release@example.com']);
    // Refuse links and gitlinks before any generator writes through a path.
    for (const sha of [s.base, s.head, s.main]) {
      const tree = this.g(cwd, ['ls-tree', '-r', sha]);
      if (/^(120000|160000) /m.test(tree)) throw new Error('symlinks and gitlinks are unsupported for release preparation');
    }
    const merge = this.git(cwd, ['merge', '--no-ff', '--no-commit', s.main]);
    if (![0, 1].includes(merge.status)) throw new Error('main merge failed');
    const conflicts = this.g(cwd, ['diff', '--name-only', '--diff-filter=U', '-z']).split('\0').filter(Boolean);
    for (const rel of conflicts) {
      if (rel === CHANGELOG_REL_PATH) continue;
      if (rel.startsWith('/') || rel.includes('..') || rel.includes('\\')) throw new Error('unsafe conflict path');
      fs.writeFileSync(path.join(cwd, rel), this.mergeText(cwd, rel, s.base, s.head, s.main));
    }
    fs.writeFileSync(path.join(cwd, CHANGELOG_REL_PATH), s.mainLog);
    const fragment = `${FRAGMENT_DIR_REL_PATH}/rebump-${pr.number}.md`;
    if (fs.existsSync(path.join(cwd, fragment))) throw new Error('recovered fragment path already exists');
    const fragments = fs.readdirSync(path.join(cwd, FRAGMENT_DIR_REL_PATH)).filter(name => name.endsWith('.md') && name !== 'README.md');
    if (fragments.length) throw new Error('unfolded fragments need builder reconciliation');
    fs.writeFileSync(path.join(cwd, fragment), s.notes);
    this.generate(cwd, [this.version(cwd, s.main)]);
    this.g(cwd, ['add', '--all']);
    this.g(cwd, ['commit', '-q', '-m', 'Merge main for release maintenance']);
    const mergeHead = this.g(cwd, ['rev-parse', 'HEAD']);
    if (this.g(cwd, ['show', '-s', '--format=%P', mergeHead]) !== `${s.head} ${s.main}`) throw new Error('unexpected merge parentage');
    this.generate(cwd, ['--next', s.level, '--base', s.main]);
    if (this.versionFromFile(cwd) !== s.target) throw new Error('wrong prepared version');
    const resultLog = fs.readFileSync(path.join(cwd, CHANGELOG_REL_PATH), 'utf8');
    const split = splitChangelog(resultLog), released = splitChangelog(s.mainLog);
    if (split.entries.slice(1).join('') !== released.entries.join('')) throw new Error('released CHANGELOG entries changed');
    // Reusing the fragment fold verifies the title and all notes, including their order.
    const { parseFragment } = require('./toolkit-version-at-merge.cjs');
    if (resultLog !== foldFragments(s.mainLog, s.target, [parseFragment(s.notes)])) throw new Error('PR release notes changed');
    this.validate(cwd, s.main);
    this.g(cwd, ['add', '--all']);
    this.g(cwd, ['commit', '-q', '-m', `Bump Toolkit to ${s.target}`]);
    return this.g(cwd, ['rev-parse', 'HEAD']);
  }
  versionFromFile(cwd) { return JSON.parse(fs.readFileSync(path.join(cwd, VERSION_REL_PATH), 'utf8')).version; }
  process(pr) {
    let scratch;
    let snapshot;
    try {
      const skip = this.eligible(pr);
      if (skip) return { number: pr.number, status: 'skipped', reason: skip };
      const main = this.remoteSha('main');
      if (this.remoteSha(pr.head.ref) !== pr.head.sha) throw new Error('PR head does not match remote branch');
      let cwd = this.workspace;
      if (this.apply) {
        const temp = path.join(this.workspace, '.tmp');
        fs.mkdirSync(temp, { recursive: true });
        scratch = fs.mkdtempSync(path.join(temp, 'rebump-'));
        this.g(this.workspace, ['clone', '--no-checkout', '--no-hardlinks', '--', this.origin, scratch]);
        cwd = scratch;
      }
      snapshot = this.snapshot(cwd, pr, main);
      if (!this.apply || snapshot.status !== 'eligible') {
        const { notes, mainLog, ...summary } = snapshot;
        return { number: pr.number, ...summary };
      }
      const candidate = this.prepare(cwd, pr, snapshot);
      const latest = this.api(`repos/${this.repo}/pulls/${pr.number}`);
      if (this.eligible(latest) || latest.head.ref !== pr.head.ref || latest.head.sha !== snapshot.head ||
          this.remoteSha('main') !== snapshot.main || this.remoteSha(pr.head.ref) !== snapshot.head) throw new Error('main or PR changed before push; run a new report');
      // No force, lease, rebase, default-branch push or GitHub merge operation.
      const push = this.git(cwd, ['push', 'origin', `HEAD:refs/heads/${pr.head.ref}`]);
      const readback = this.remoteSha(pr.head.ref);
      if (readback !== candidate) throw new Error(push.status === 0 ? 'push read-back differs; reconcile before retry' : 'push failed or uncertain; reconcile remote before retry');
      return { number: pr.number, status: 'verified', main, oldHead: snapshot.head, head: candidate, level: snapshot.level, version: snapshot.target };
    } catch (error) {
      // Keep failed preparation for inspection; never retry a push here.
      if (scratch && fs.existsSync(path.join(scratch, '.git', 'MERGE_HEAD'))) this.git(scratch, ['merge', '--abort']);
      return { number: pr.number, status: 'held', reason: error.message, ...(scratch ? { scratch } : {}) };
    }
  }
  run() {
    this.origin = this.g(this.workspace, ['remote', 'get-url', 'origin']);
    const repository = repositoryFromOrigin(this.origin);
    if (this.repo && this.repo !== repository) throw new Error('--repo differs from origin');
    this.repo = repository;
    this.github(['auth', 'status']);
    const user = this.api('user');
    if (!user.login) throw new Error('authenticated account could not be verified');
    const prs = [];
    for (let page = 1; ; page += 1) {
      const batch = this.api(`repos/${this.repo}/pulls?state=open&per_page=100&page=${page}`);
      if (!Array.isArray(batch)) throw new Error('invalid pull request list');
      prs.push(...batch);
      if (batch.length < 100) break;
    }
    return { mode: this.apply ? 'apply' : 'report', repository: this.repo, account: user.login,
      results: prs.sort((a, b) => a.number - b.number).map(pr => this.process(pr)) };
  }
}
function parseArgs(argv) {
  const args = { workspace: path.resolve(__dirname, '../..'), apply: false, repo: '' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--apply') args.apply = true;
    else if (['--workspace', '--repo'].includes(argv[i]) && argv[i + 1] && !argv[i + 1].startsWith('-')) args[argv[i].slice(2)] = argv[++i];
    else throw new Error('usage: node repo/scripts/toolkit-rebump-prs.cjs [--workspace <repo>] [--repo <owner/name>] [--apply]');
  }
  return args;
}
if (require.main === module) {
  try {
    const report = new PrRebumpOperation(parseArgs(process.argv.slice(2))).run();
    console.log(JSON.stringify(report, null, 2));
    if (report.results.some(result => result.status === 'held')) process.exitCode = 1;
  } catch (error) { console.error(`toolkit-rebump-prs: ${error.message}`); process.exitCode = 1; }
}
module.exports = { PrRebumpOperation, detectIntent, recoverNotes, mergeJson, safeRef, repositoryFromOrigin, parseArgs };
