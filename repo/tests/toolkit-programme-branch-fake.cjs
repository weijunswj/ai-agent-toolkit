'use strict';

// The in-memory GitHub of toolkit-programme-fake-github.cjs, with real branches and commits per
// repository for the public state branch tests. Each repository keeps its own commits (40-character
// SHAs), branches and file trees. The Contents API reads a branch or a commit, writes and deletes with
// compare-and-swap on the blob SHA (409 stale, 422 create over an existing file) and makes one commit
// per write; the Git Data API creates trees, commits and refs (422 for a ref that exists), and reads a
// commit while it exists. Issues, comments, pull requests and GraphQL behave as in the base fake. With
// `branchLag` on, a Contents read of a branch serves the commit before its head, as in the base fake.

const crypto = require('node:crypto');
const { FakeGitHub, blobSha, topLevelEntries } = require('./toolkit-programme-fake-github.cjs');

const ok = (status, json) => ({ status, json });

class BranchFakeGitHub extends FakeGitHub {
  constructor(options = {}) {
    super(options);
    this.gits = new Map();
    this.counter = 0;
    this.commitLog = [];
    for (const slug of [this.repository, this.storeRepository]) {
      const git = { slug, branches: new Map(), commits: new Map(), trees: new Map() };
      git.branches.set('main', this.newCommit(git, new Map(), [], 'initial'));
      this.gits.set(slug.toLowerCase(), git);
    }
  }

  newSha(kind) { this.counter += 1; return crypto.createHash('sha1').update(`${kind}-${this.counter}`).digest('hex'); }

  newCommit(git, files, parents, message, branch = null) {
    const sha = this.newSha('commit');
    git.commits.set(sha, { files: new Map(files), parents, message, login: this.committer || this.login, date: this.tick() });
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
    if (fullPath === 'graphql' && body.query.includes('stateSnapshot') && this.git(`${body.variables.owner}/${body.variables.name}`)) {
      const { owner, name, directory } = body.variables;
      const split = directory.indexOf(':');
      const files = this.filesAt(`${owner}/${name}`, directory.slice(0, split));
      const prefix = directory.slice(split + 1).replace(/\/$/, '') + '/';
      const entries = [...(files || [])].filter(([file]) => file.startsWith(prefix) && !file.slice(prefix.length).includes('/'))
        .map(([file, text]) => ({ name: file.slice(prefix.length), oid: blobSha(text), type: 'blob', object: { text, isTruncated: false } }));
      return ok(200, { data: { repository: { snapshot: entries.length ? { entries } : null } } });
    }
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
      // In this fake a commit's tree has the commit's own id.
      return sha ? ok(200, { name: decodeURIComponent(found[1]), commit: { sha, commit: { tree: { sha } } } }) : ok(404, { message: 'Branch not found' });
    }
    if ((found = /^git\/blobs\/([0-9a-f]{40})$/.exec(rest)) && method === 'GET') {
      for (const commit of git.commits.values()) for (const text of commit.files.values()) {
        if (blobSha(text) === found[1]) return ok(200, { sha: found[1], encoding: 'base64', content: Buffer.from(text, 'utf8').toString('base64') });
      }
      return ok(404, { message: 'Not Found' });
    }
    if ((found = /^compare\/([0-9a-f]{40})\.\.\.([0-9a-f]{40})$/.exec(rest)) && method === 'GET') {
      const ancestors = sha => { const seen = new Set(); const walk = at => { if (!at || seen.has(at)) return; seen.add(at); for (const parent of git.commits.get(at)?.parents || []) walk(parent); }; walk(sha); return seen; };
      const [base, head] = [found[1], found[2]];
      return ok(200, { status: base === head ? 'identical' : ancestors(head).has(base) ? 'ahead' : ancestors(base).has(head) ? 'behind' : 'diverged' });
    }
    if ((found = /^git\/commits\/([0-9a-f]{40})$/.exec(rest)) && method === 'GET') {
      return git.commits.has(found[1]) ? ok(200, { sha: found[1], message: git.commits.get(found[1]).message }) : ok(404, { message: 'Not Found' });
    }
    if (rest === 'git/trees' && method === 'POST') {
      const tree = new Map(body.base_tree ? this.filesAt(match[1], body.base_tree) || git.trees.get(body.base_tree) || [] : []);
      for (const entry of body.tree) {
        if (entry.type !== 'blob' || typeof entry.content !== 'string') return ok(422, { message: 'Invalid tree entry' });
        tree.set(entry.path, entry.content);
      }
      const sha = this.newSha('tree');
      git.trees.set(sha, tree);
      return ok(201, { sha, tree: topLevelEntries(body.tree, sha) });
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
    if ((found = /^git\/refs\/heads\/(.+)$/.exec(rest)) && method === 'PATCH') {
      const branch = decodeURIComponent(found[1]);
      const current = git.branches.get(branch);
      if (!current) return ok(422, { message: 'Reference does not exist' });
      const commit = git.commits.get(body.sha);
      if (!commit) return ok(422, { message: 'Object does not exist' });
      // Without force, only a fast-forward: the new commit must descend from the current head.
      const descends = sha => sha === current || (git.commits.get(sha)?.parents || []).some(descends);
      if (!body.force && !descends(body.sha)) return ok(422, { message: 'Update is not a fast forward' });
      git.branches.set(branch, body.sha);
      const logged = this.commitLog.find(item => item.sha === body.sha);
      if (logged) logged.branch = branch;
      return ok(200, { ref: `refs/heads/${branch}`, object: { sha: body.sha } });
    }
    // The branch's commits that changed a path, newest first along the first parent.
    if (rest === 'commits' && method === 'GET') {
      const path = params.get('path') || '';
      const rows = [];
      for (let sha = this.resolve(git, params.get('sha')); sha; sha = git.commits.get(sha).parents[0]) {
        const { files, parents, message, login, date } = git.commits.get(sha);
        const before = git.commits.get(parents[0])?.files || new Map();
        const changed = [...new Set([...files.keys(), ...before.keys()])].filter(file => files.get(file) !== before.get(file));
        if (changed.some(file => file === path || file.startsWith(`${path}/`)) && (!params.get('author') || login === params.get('author'))) rows.push({ sha, commit: { message, committer: { date } }, author: { login } });
      }
      const size = Number(params.get('per_page') || 30);
      const page = Number(params.get('page') || 1);
      return ok(200, rows.slice((page - 1) * size, page * size));
    }
    return super.route(method, fullPath, body);
  }

  gitContents(git, method, file, body, params) {
    if (method === 'GET') {
      const ref = params.get('ref') || 'main';
      let sha = this.resolve(git, ref);
      if (!sha) return ok(404, { message: 'No commit found for the ref' });
      if (this.branchLag && git.branches.has(ref)) sha = git.commits.get(sha).parents[0] || sha;
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
