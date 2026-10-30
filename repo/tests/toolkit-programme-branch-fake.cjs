'use strict';

// The in-memory GitHub of toolkit-programme-fake-github.cjs, with real branches and commits per
// repository for the public state branch tests. Each repository keeps its own commits (40-character
// SHAs), branches and file trees. The Contents API reads a branch or a commit, writes and deletes with
// compare-and-swap on the blob SHA (409 stale, 422 create over an existing file) and makes one commit
// per write; the Git Data API creates trees, commits and refs (422 for a ref that exists), and reads a
// commit while it exists. Issues, comments, pull requests and GraphQL behave as in the base fake.

const crypto = require('node:crypto');
const { FakeGitHub, blobSha } = require('./toolkit-programme-fake-github.cjs');

const ok = (status, json) => ({ status, json });

class BranchFakeGitHub extends FakeGitHub {
  constructor(options = {}) {
    super(options);
    this.gits = new Map();
    this.counter = 0;
    this.commitLog = [];
    for (const slug of [this.repository, this.storeRepository]) {
      const git = { slug, branches: new Map(), commits: new Map(), trees: new Map(), dates: new Map() };
      git.branches.set('main', this.newCommit(git, new Map(), [], 'initial'));
      this.gits.set(slug.toLowerCase(), git);
    }
  }

  newSha(kind) { this.counter += 1; return crypto.createHash('sha1').update(`${kind}-${this.counter}`).digest('hex'); }

  newCommit(git, files, parents, message, branch = null) {
    const sha = this.newSha('commit');
    git.commits.set(sha, { files: new Map(files), parents, message });
    this.commitLog.push({ repository: git.slug, branch, sha, message });
    return sha;
  }

  git(slug) { return this.gits.get(String(slug).toLowerCase()); }
  resolve(git, ref) { return git.branches.get(ref) || (git.commits.has(ref) ? ref : null); }
  head(slug, branch) { return this.git(slug).branches.get(branch) || null; }
  filesAt(slug, ref) { const git = this.git(slug); const sha = this.resolve(git, ref); return sha ? git.commits.get(sha).files : null; }
  textAt(slug, ref, file) { return this.filesAt(slug, ref)?.get(file) ?? null; }
  readAt(slug, ref, file) { const text = this.textAt(slug, ref, file); return text === null ? null : JSON.parse(text); }

  // Test levers: what a person or another tool does to the repository outside Toolkit.
  deleteBranch(slug, branch) { this.git(slug).branches.delete(branch); }
  setBranch(slug, branch, sha) { this.git(slug).branches.set(branch, sha); }
  dropCommit(slug, sha) { this.git(slug).commits.delete(sha); }
  setPrivate(slug, value) { this.repos.get(slug.toLowerCase()).private = value; }
  writeRaw(slug, branch, file, text) {
    const git = this.git(slug);
    const files = new Map(git.commits.get(git.branches.get(branch)).files);
    if (text === null) files.delete(file); else files.set(file, text);
    git.branches.set(branch, this.newCommit(git, files, [git.branches.get(branch)], 'hand edit', branch));
  }

  route(method, fullPath, body) {
    const [path, query = ''] = fullPath.split('?');
    const params = new URLSearchParams(query);
    const match = /^repos\/([^/]+\/[^/]+)\/(.+)$/.exec(path);
    const git = match && this.git(match[1]);
    if (!git) return super.route(method, fullPath, body);
    const rest = match[2];
    let found;
    if ((found = /^contents\/(.+)$/.exec(rest))) return this.gitContents(git, method, decodeURIComponent(found[1]), body, params);
    if ((found = /^branches\/(.+)$/.exec(rest)) && method === 'GET') {
      const sha = git.branches.get(decodeURIComponent(found[1]));
      return sha ? ok(200, { name: decodeURIComponent(found[1]), commit: { sha } }) : ok(404, { message: 'Branch not found' });
    }
    if ((found = /^git\/commits\/([0-9a-f]{40})$/.exec(rest)) && method === 'GET') {
      return git.commits.has(found[1]) ? ok(200, { sha: found[1], message: git.commits.get(found[1]).message }) : ok(404, { message: 'Not Found' });
    }
    if (rest === 'git/trees' && method === 'POST') {
      const tree = new Map();
      for (const entry of body.tree) {
        if (entry.type !== 'blob' || typeof entry.content !== 'string') return ok(422, { message: 'Invalid tree entry' });
        tree.set(entry.path, entry.content);
      }
      const sha = this.newSha('tree');
      git.trees.set(sha, tree);
      return ok(201, { sha });
    }
    if (rest === 'git/commits' && method === 'POST') {
      const tree = git.trees.get(body.tree);
      if (!tree || !Array.isArray(body.parents) || body.parents.some(parent => !git.commits.has(parent))) return ok(422, { message: 'Invalid commit' });
      return ok(201, { sha: this.newCommit(git, tree, body.parents, body.message) });
    }
    if (rest === 'git/refs' && method === 'POST') {
      const branch = String(body.ref || '').replace(/^refs\/heads\//, '');
      if (git.branches.has(branch)) return ok(422, { message: 'Reference already exists' });
      if (!git.commits.has(body.sha)) return ok(422, { message: 'Object does not exist' });
      git.branches.set(branch, body.sha);
      return ok(201, { ref: body.ref, object: { sha: body.sha } });
    }
    if (rest === 'commits' && method === 'GET') {
      const date = git.dates.get(`${params.get('sha')}:${params.get('path')}`);
      return ok(200, date ? [{ sha: 'f'.repeat(40), commit: { committer: { date } } }] : []);
    }
    return super.route(method, fullPath, body);
  }

  gitContents(git, method, file, body, params) {
    if (method === 'GET') {
      const sha = this.resolve(git, params.get('ref') || 'main');
      if (!sha) return ok(404, { message: 'No commit found for the ref' });
      const files = git.commits.get(sha).files;
      if (files.has(file)) {
        const text = files.get(file);
        return ok(200, { sha: blobSha(text), encoding: 'base64', content: Buffer.from(text, 'utf8').toString('base64') });
      }
      const prefix = `${file.replace(/\/$/, '')}/`;
      const entries = [...files].filter(([name]) => name.startsWith(prefix) && !name.slice(prefix.length).includes('/'))
        .map(([name, text]) => ({ type: 'file', name: name.slice(prefix.length), path: name, sha: blobSha(text) }));
      return entries.length ? ok(200, entries) : ok(404, { message: 'Not Found' });
    }
    const branch = body?.branch;
    if (!git.branches.has(branch)) return ok(404, { message: `Branch ${branch} not found` });
    const head = git.branches.get(branch);
    const files = new Map(git.commits.get(head).files);
    const current = files.get(file);
    const currentSha = current === undefined ? null : blobSha(current);
    if (method === 'PUT') {
      if (currentSha && !body.sha) return ok(422, { message: 'Invalid request.\n\n"sha" wasn\'t supplied.' });
      if (currentSha && body.sha !== currentSha) return ok(409, { message: `${file} does not match ${body.sha}` });
      if (!currentSha && body.sha) return ok(404, { message: 'Not Found' });
      const text = Buffer.from(body.content, 'base64').toString('utf8');
      files.set(file, text);
      const sha = this.newCommit(git, files, [head], body.message, branch);
      git.branches.set(branch, sha);
      git.dates.set(`${branch}:${file}`, this.tick());
      return ok(currentSha ? 200 : 201, { content: { sha: blobSha(text) }, commit: { sha } });
    }
    if (method === 'DELETE') {
      if (!currentSha) return ok(404, { message: 'Not Found' });
      if (body.sha !== currentSha) return ok(409, { message: `${file} does not match ${body.sha}` });
      files.delete(file);
      git.branches.set(branch, this.newCommit(git, files, [head], body.message, branch));
      return ok(200, { commit: {} });
    }
    return ok(405, { message: 'Method not allowed' });
  }
}

module.exports = { BranchFakeGitHub };
