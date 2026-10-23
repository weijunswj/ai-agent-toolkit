'use strict';

// In-memory GitHub for the programme reconciler tests. It answers the REST and GraphQL calls the
// reconciler makes and copies the behaviour measured against a real sandbox repository on
// 2026-10-23: sub-issue ids (not numbers), 422 for a second parent without replace_parent or a
// duplicate, 422 for a reorder without an anchor, 409 for a stale Contents sha, 422 for a create
// over an existing file, and a new commit even for an identical Contents PUT. With `branchLag` on,
// a Contents read of the branch serves the files as of the commit before the latest one, as the
// real API did on 2026-10-23 right after a write; a read at a commit sha is always exact.

const crypto = require('node:crypto');

const blobSha = text => crypto.createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0${text}`).digest('hex');
const ok = (status, json) => ({ status, json });

class FakeGitHub {
  constructor({ repository = 'acme/app', store = 'acme/state-store', storePrivate = true, storeWritable = true, branch = 'main' } = {}) {
    this.repository = repository;
    this.storeRepository = store;
    this.repos = new Map([
      [repository.toLowerCase(), { full_name: repository, private: false, permissions: { push: true } }],
      [store.toLowerCase(), { full_name: store, private: storePrivate, permissions: { push: storeWritable } }],
    ]);
    this.branch = branch;
    this.issues = new Map();
    this.files = new Map();
    this.prs = new Map();
    this.commits = 0;
    this.snapshots = new Map();
    this.branchLag = false;
    this.clock = Date.UTC(2026, 9, 23, 0, 0, 0);
    this.calls = [];
    this.hooks = [];
    this.nextId = 9000;
  }

  tick() { this.clock += 1000; return new Date(this.clock).toISOString(); }

  addIssue(number, { title = `Issue ${number}`, body = '', state = 'open', parent = null, blockedBy = [] } = {}) {
    const issue = { number, id: this.nextId++ * 1000 + number, title, body, state, parent: null, subs: [], blockedBy, comments: [], updated_at: this.tick() };
    this.issues.set(number, issue);
    if (parent) this.link(parent, number);
    return issue;
  }

  addComment(number, body, { login = 'owner', type = 'User' } = {}) {
    const comment = { id: this.nextId++, user: { login, type }, body, created_at: this.tick() };
    this.issues.get(number).comments.push(comment);
    return comment;
  }

  link(parent, child) {
    const issue = this.issues.get(child);
    if (issue.parent) this.issues.get(issue.parent).subs = this.issues.get(issue.parent).subs.filter(n => n !== child);
    issue.parent = parent;
    this.issues.get(parent).subs.push(child);
    issue.updated_at = this.tick();
    this.issues.get(parent).updated_at = this.tick();
  }

  addPr(number, { head, state = 'OPEN', isDraft = false, merged = false, contexts = [], rollupOid = head, hasNextPage = false, branch = null } = {}) {
    this.prs.set(number, { number, head, state, isDraft, merged, contexts, rollupOid, hasNextPage, branch });
  }

  // A hook runs before every call and may answer it: (call) => response | undefined.
  intercept(hook) { this.hooks.push(hook); }

  // Writes to the governed repository (issues and links), not to the state store.
  mutations() { return this.calls.filter(call => call.method !== 'GET' && call.path !== 'graphql' && !call.path.includes('/contents/')).length; }

  issueJson(issue) {
    return {
      number: issue.number, id: issue.id, title: issue.title, body: issue.body, state: issue.state, state_reason: null,
      updated_at: issue.updated_at,
      parent_issue_url: issue.parent ? `https://api.github.com/repos/${this.repository}/issues/${issue.parent}` : null,
      issue_dependencies_summary: { total_blocked_by: issue.blockedBy.length },
    };
  }

  byId(id) { return [...this.issues.values()].find(issue => issue.id === id); }

  request(method, path, body) {
    const call = { method, path, body: body === undefined ? undefined : JSON.parse(JSON.stringify(body)) };
    this.calls.push(call);
    for (const hook of this.hooks) {
      const answer = hook(call, this);
      if (answer) return answer;
    }
    return this.route(method, path, call.body);
  }

  graphql(query, variables) {
    const response = this.request('POST', 'graphql', { query, variables });
    return response.json.data;
  }

  route(method, fullPath, body) {
    if (fullPath === 'graphql') return this.graphqlRoute(body);
    const [path, query = ''] = fullPath.split('?');
    const params = new URLSearchParams(query);
    let match;
    if ((match = /^repos\/([^/]+\/[^/]+)$/.exec(path)) && method === 'GET') {
      const repo = this.repos.get(match[1].toLowerCase());
      return repo ? ok(200, repo) : ok(404, { message: 'Not Found' });
    }
    if ((match = /^repos\/([^/]+\/[^/]+)\/branches\/(.+)$/.exec(path))) {
      return decodeURIComponent(match[2]) === this.branch ? ok(200, { name: this.branch }) : ok(404, { message: 'Branch not found' });
    }
    if ((match = /^repos\/([^/]+\/[^/]+)\/contents\/(.+)$/.exec(path))) return this.contents(method, decodeURIComponent(match[2]), body, params);
    if (!(match = /^repos\/([^/]+\/[^/]+)\/(.+)$/.exec(path)) || match[1].toLowerCase() !== this.repository.toLowerCase()) return ok(404, { message: 'Not Found' });
    const rest = match[2];
    if ((match = /^issues\/(\d+)$/.exec(rest))) {
      const issue = this.issues.get(Number(match[1]));
      if (!issue) return ok(404, { message: 'Not Found' });
      if (method === 'PATCH') { issue.body = body.body; issue.updated_at = this.tick(); }
      return ok(200, this.issueJson(issue));
    }
    if ((match = /^issues\/(\d+)\/comments$/.exec(rest)) && method === 'GET') {
      const issue = this.issues.get(Number(match[1]));
      if (!issue) return ok(404, { message: 'Not Found' });
      const page = Number(params.get('page') || 1);
      return ok(200, issue.comments.slice((page - 1) * 100, page * 100));
    }
    if ((match = /^issues\/(\d+)\/sub_issues$/.exec(rest))) {
      const parent = this.issues.get(Number(match[1]));
      if (!parent) return ok(404, { message: 'Not Found' });
      if (method === 'GET') {
        const page = Number(params.get('page') || 1);
        const size = Number(params.get('per_page') || 30);
        return ok(200, parent.subs.slice((page - 1) * size, page * size).map(n => this.issueJson(this.issues.get(n))));
      }
      const child = this.byId(body.sub_issue_id);
      if (!child) return ok(404, { message: 'Not Found' });
      if (child.parent === parent.number) return ok(422, { message: 'Issue may not contain duplicate sub-issues and Sub issue may only have one parent' });
      if (child.parent && !body.replace_parent) return ok(422, { message: 'Sub issue may only have one parent' });
      for (let at = parent; at; at = at.parent ? this.issues.get(at.parent) : null) {
        if (at.number === child.number) return ok(422, { message: 'Sub issue may not create a circular dependency' });
      }
      this.link(parent.number, child.number);
      return ok(201, this.issueJson(parent));
    }
    if ((match = /^issues\/(\d+)\/sub_issues\/priority$/.exec(rest)) && method === 'PATCH') {
      const parent = this.issues.get(Number(match[1]));
      const child = this.byId(body.sub_issue_id);
      const anchorId = body.before_id ?? body.after_id;
      if (anchorId === undefined) return ok(422, { message: 'Either a before_id or after_id argument must be provided' });
      const anchor = this.byId(anchorId);
      if (!parent || !child || !anchor || !parent.subs.includes(child.number) || !parent.subs.includes(anchor.number)) return ok(404, { message: 'Not Found' });
      parent.subs = parent.subs.filter(n => n !== child.number);
      const at = parent.subs.indexOf(anchor.number) + (body.before_id !== undefined ? 0 : 1);
      parent.subs.splice(at, 0, child.number);
      parent.updated_at = this.tick();
      return ok(200, this.issueJson(parent));
    }
    if ((match = /^issues\/(\d+)\/dependencies\/blocked_by$/.exec(rest))) {
      const issue = this.issues.get(Number(match[1]));
      return ok(200, issue.blockedBy.map(n => this.issueJson(this.issues.get(n))));
    }
    if (rest === 'pulls') {
      const branch = (params.get('head') || '').split(':')[1];
      return ok(200, [...this.prs.values()].filter(pr => pr.branch === branch).map(pr => ({ number: pr.number, state: pr.state === 'OPEN' ? 'open' : 'closed' })));
    }
    return ok(404, { message: `Unhandled ${method} ${fullPath}` });
  }

  contents(method, filePath, body, params) {
    const file = this.files.get(filePath);
    if (method === 'GET') {
      const ref = params.get('ref') || this.branch;
      const files = ref === this.branch
        ? (this.branchLag && this.commits > 0 ? this.snapshots.get(`c${this.commits - 1}`) || new Map() : this.files)
        : this.snapshots.get(ref);
      if (!files) return ok(404, { message: 'No commit found for the ref' });
      const found = files.get(filePath);
      if (!found) return ok(404, { message: 'Not Found' });
      return ok(200, { sha: found.sha, encoding: 'base64', content: Buffer.from(found.text, 'utf8').toString('base64') });
    }
    if (method === 'PUT') {
      if (body.branch !== this.branch) return ok(404, { message: `Branch ${body.branch} not found` });
      if (file && !body.sha) return ok(422, { message: 'Invalid request.\n\n"sha" wasn\'t supplied.' });
      if (file && body.sha !== file.sha) return ok(409, { message: `${filePath} does not match ${body.sha}` });
      if (!file && body.sha) return ok(404, { message: 'Not Found' });
      const text = Buffer.from(body.content, 'base64').toString('utf8');
      this.files.set(filePath, { text, sha: blobSha(text) });
      this.commit();
      return ok(file ? 200 : 201, { content: { sha: blobSha(text) }, commit: { sha: `c${this.commits}` } });
    }
    return ok(405, { message: 'Method not allowed' });
  }

  // Writes a state file directly, as another writer would.
  putFile(filePath, doc) {
    const text = `${JSON.stringify(doc, null, 2)}\n`;
    this.files.set(filePath, { text, sha: blobSha(text) });
    this.commit();
  }

  commit() {
    this.commits += 1;
    this.snapshots.set(`c${this.commits}`, new Map(this.files));
  }

  readFile(filePath) {
    const file = this.files.get(filePath);
    return file ? JSON.parse(file.text) : null;
  }

  graphqlRoute(body) {
    const pr = this.prs.get(body.variables.number);
    if (!pr) return ok(200, { data: { repository: { pullRequest: null } } });
    return ok(200, { data: { repository: { pullRequest: {
      number: pr.number, state: pr.merged ? 'MERGED' : pr.state, isDraft: pr.isDraft, merged: pr.merged, headRefOid: pr.head, baseRefName: 'main', mergeable: 'MERGEABLE',
      commits: { nodes: [{ commit: { oid: pr.rollupOid, statusCheckRollup: { state: 'SUCCESS', contexts: { pageInfo: { hasNextPage: pr.hasNextPage }, nodes: pr.contexts } } } }] },
    } } } });
  }
}

module.exports = { FakeGitHub, blobSha };
