'use strict';

// The stale-copy check judges a governed repository's Toolkit copies on origin's default branch head as
// this computer's binding read last fetched it (toolkit-governance-conformance.cjs cloudWorkflowFindings),
// never on the working tree. A fixture repository's files reach that head here: its working tree, bytes
// as they are, is committed as `refs/remotes/origin/<branch>` without moving HEAD, as a fetch would.
const { execFileSync } = require('node:child_process');

const IDENTITY = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' };
const git = (cwd, args) => execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false', ...args], { cwd, encoding: 'utf8', windowsHide: true, env: { ...process.env, ...IDENTITY } }).trim();

// Commits the working tree as origin's default branch head: { commit, default_branch }.
function fetchedHead(repo, branch = 'main') {
  git(repo, ['add', '-A', '--force']);
  const tree = git(repo, ['write-tree']);
  const commit = git(repo, ['commit-tree', tree, '-m', 'origin head']);
  git(repo, ['update-ref', `refs/remotes/origin/${branch}`, commit]);
  return { commit, default_branch: branch };
}

// A governance state for `repo` whose merged binding read fetched its working tree as it is now.
function fetchedState(repo, fields = {}, branch = 'main') {
  return { root: repo, ...fields, merged: { ...(fields.merged || {}), ...fetchedHead(repo, branch) } };
}

module.exports = Object.freeze({ fetchedHead, fetchedState });
