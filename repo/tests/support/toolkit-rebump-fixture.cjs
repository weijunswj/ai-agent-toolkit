'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { PrRebumpOperation } = require('../../scripts/toolkit-rebump-prs.cjs');
const { VERSION_REL_PATH } = require('../../scripts/toolkit-version.cjs');
const { MANIFEST_REL_PATHS } = require('../../scripts/bump-version.cjs');
const { CHANGELOG_REL_PATH, foldFragments, nextVersion, versionProblems } = require('../../scripts/toolkit-version-at-merge.cjs');
const ROOT = path.resolve(__dirname, '../../..');
const NOTES = '### Changed\n\n- Keep the branch change.\n';
const BASE_LOG = '# Toolkit Changelog\n\n## 3.1.0\n\n### Changed\n\n- A released note.\n';
const write = (root, rel, text) => { const target = path.join(root, rel); fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target, text); };
const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function fixture(t, level = 'minor') {
  fs.mkdirSync(path.join(ROOT, '.tmp'), { recursive: true });
  const temp = fs.mkdtempSync(path.join(ROOT, '.tmp/rebump-test-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const repo = path.join(temp, 'writer'), remote = path.join(temp, 'remote.git');
  fs.mkdirSync(repo);
  const raw = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  const git = (cwd, ...args) => { const result = raw(cwd, args); assert.equal(result.status, 0, `${args.join(' ')}: ${result.stderr}`); return result.stdout.trim(); };
  git(temp, 'init', '--bare', '-q', remote);
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'config', 'user.name', 'Release test');
  git(repo, 'config', 'user.email', 'release@example.com');
  git(repo, 'config', 'core.autocrlf', 'false');
  git(repo, 'remote', 'add', 'origin', remote);
  for (const file of ['toolkit-version.cjs', 'toolkit-version-at-merge.cjs', 'bump-version.cjs']) {
    write(repo, `repo/scripts/${file}`, read(ROOT, `repo/scripts/${file}`));
  }
  // The real bump command runs against a small fixture contract. Full repository
  // generation and validation are exercised by toolkit-version.test.cjs.
  for (const file of ['sync-agent-instruction-shims.cjs', 'sync-repo-doc-contract.cjs', 'audit-published-surfaces.cjs']) {
    write(repo, `repo/scripts/${file}`, "const fs=require('fs');const v=JSON.parse(fs.readFileSync('repo/contracts/toolkit-local-bridge/version.json')).version;fs.writeFileSync('AGENTS.md', '<!-- toolkit='+v+' sha256=0123456789ab -->\\n');");
  }
  write(repo, 'repo/docs/changelog.d/README.md', '# Fragments\n');
  write(repo, '.gitignore', '.tmp/\n');
  write(repo, CHANGELOG_REL_PATH, BASE_LOG);
  write(repo, 'source.txt', 'base\n');
  const setVersion = version => {
    for (const rel of [VERSION_REL_PATH, ...MANIFEST_REL_PATHS]) {
      const value = fs.existsSync(path.join(repo, rel)) ? JSON.parse(read(repo, rel)) : { version, name: 'fixture' };
      write(repo, rel, `${JSON.stringify({ ...value, version }, null, 2)}\n`);
    }
    write(repo, 'AGENTS.md', `<!-- toolkit=${version} sha256=0123456789ab -->\n`);
  };
  const commit = message => { git(repo, 'add', '--all'); git(repo, 'commit', '-q', '-m', message); return git(repo, 'rev-parse', 'HEAD'); };
  setVersion('3.1.0');
  const base = commit('base');
  git(repo, 'push', '-q', '-u', 'origin', 'main');
  git(temp, '--git-dir', remote, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  git(repo, 'checkout', '-q', '-b', 'lane');
  const version = level ? nextVersion('3.1.0', level) : '3.1.0';
  setVersion(version);
  write(repo, 'branch.txt', 'branch change\n');
  if (level) write(repo, CHANGELOG_REL_PATH, foldFragments(BASE_LOG, version, [{ title: 'branch change', body: NOTES.trim() }]));
  let head = commit('branch work');
  git(repo, 'push', '-q', '-u', 'origin', 'lane');
  const pr = () => ({ number: 7, state: 'open', draft: false, auto_merge: null,
    base: { ref: 'main', repo: { full_name: 'example/toolkit' } },
    head: { ref: 'lane', sha: git(repo, 'ls-remote', '--refs', 'origin', 'refs/heads/lane').split(/\s/)[0], repo: { full_name: 'example/toolkit' } } });
  function mainRelease(version) {
    git(repo, 'checkout', '-q', 'main');
    const changelog = read(repo, CHANGELOG_REL_PATH);
    setVersion(version);
    write(repo, CHANGELOG_REL_PATH, foldFragments(changelog, version, [{ title: 'main change', body: '### Changed\n\n- Main released change.' }]));
    write(repo, 'main.txt', `${version}\n`);
    const sha = commit('main release');
    git(repo, 'push', '-q', 'origin', 'main');
    git(repo, 'checkout', '-q', 'lane');
    return sha;
  }
  const main = mainRelease('3.1.1');
  const operation = (apply = true, overrides = {}) => {
    const op = new PrRebumpOperation({ workspace: repo, repo: 'example/toolkit', apply }, {
      github: args => {
        if (args[0] === 'auth') return '';
        if (args[1] === 'user') return JSON.stringify({ login: 'release-test' });
        if (args[1].includes('?')) return JSON.stringify([pr()]);
        return JSON.stringify(pr());
      },
      validate: (cwd, baseSha) => {
        assert.deepEqual(versionProblems({ workspace: cwd, base: baseSha }), []);
        const version = JSON.parse(read(cwd, VERSION_REL_PATH)).version;
        for (const rel of MANIFEST_REL_PATHS) assert.equal(JSON.parse(read(cwd, rel)).version, version);
        git(cwd, 'diff', '--check');
      }, ...overrides,
    });
    op.origin = remote;
    return op;
  };
  return { temp, repo, remote, git, raw, base, main, head, pr, mainRelease, operation, commit, setVersion,
    editLane: fn => { fn(); head = commit('branch edit'); git(repo, 'push', '-q', 'origin', 'lane'); return head; } };
}

module.exports = { fixture };
