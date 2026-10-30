'use strict';

// In-memory GitHub for the programme reconciler tests. It answers the REST and GraphQL calls the
// reconciler makes and copies the behaviour measured against a real sandbox repository on
// 2026-10-23: sub-issue ids (not numbers), 422 for a second parent without replace_parent or a
// duplicate, 422 for a reorder without an anchor, 409 for a stale Contents sha, 422 for a create
// over an existing file, and a new commit even for an identical Contents PUT. A Contents GET on a
// folder lists its files, `commits?path=` gives a file's last commit date, and comments carry their
// issue URL, author and creation time. With `branchLag` on,
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
    this.fileDates = new Map();
    this.comments = new Map();
    this.login = 'owner';
  }

  tick() { this.clock += 1000; return new Date(this.clock).toISOString(); }

  addIssue(number, { title = `Issue ${number}`, body = '', state = 'open', parent = null, blockedBy = [], labels = [] } = {}) {
    const issue = { number, id: this.nextId++ * 1000 + number, title, body, state, parent: null, subs: [], blockedBy, labels, updated_at: this.tick() };
    if (state === 'closed') issue.closed_at = this.tick();
    this.issues.set(number, issue);
    if (parent) this.link(parent, number);
    return issue;
  }

  link(parent, child) {
    const issue = this.issues.get(child);
    if (issue.parent) this.issues.get(issue.parent).subs = this.issues.get(issue.parent).subs.filter(n => n !== child);
    issue.parent = parent;
    this.issues.get(parent).subs.push(child);
    issue.updated_at = this.tick();
    this.issues.get(parent).updated_at = this.tick();
  }

  addPr(number, { head, state = 'OPEN', isDraft = false, merged = false, contexts = [], rollupOid = head, hasNextPage = false, branch = null, body = '', base = 'main' } = {}) {
    this.prs.set(number, { number, head, state, isDraft, merged, contexts, rollupOid, hasNextPage, branch, body, base });
  }

  // A comment on an issue, as `login` posted it; `created_at` defaults to the fake clock.
  addComment(issue, { body, login = this.login, createdAt = this.tick(), type = 'User', association = 'OWNER' } = {}) {
    const id = 7000000000 + this.comments.size + 1;
    this.comments.set(id, { id, issue, body, login, type, association, created_at: createdAt });
    return id;
  }

  // An issue's comments as the REST list shows them, oldest first.
  commentsOf(issue) {
    return [...this.comments.values()].filter(comment => comment.issue === issue)
      .map(comment => ({ id: comment.id, user: { login: comment.login, type: comment.type || 'User' }, author_association: comment.association || 'OWNER', body: comment.body, created_at: comment.created_at }));
  }

  // A hook runs before every call and may answer it: (call) => response | undefined.
  intercept(hook) { this.hooks.push(hook); }

  // Writes to the governed repository (issues and links), not to the state store.
  mutations() { return this.calls.filter(call => call.method !== 'GET' && call.path !== 'graphql' && !call.path.includes('/contents/')).length; }

  issueJson(issue) {
    return {
      number: issue.number, id: issue.id, title: issue.title, body: issue.body, state: issue.state, state_reason: null, closed_at: issue.closed_at || null,
      updated_at: issue.updated_at,
      parent_issue_url: issue.parent ? `https://api.github.com/repos/${this.repository}/issues/${issue.parent}` : null,
      issue_dependencies_summary: { total_blocked_by: issue.blockedBy.length },
      sub_issues_summary: { total: issue.subs.length, completed: issue.subs.filter(n => this.issues.get(n)?.state === 'closed').length },
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
    if (path === 'user' && method === 'GET') return ok(200, { login: this.login });
    if ((match = /^repos\/([^/]+\/[^/]+)\/contents\/(.+)$/.exec(path))) return this.contents(method, decodeURIComponent(match[2]), body, params);
    if ((match = /^repos\/([^/]+\/[^/]+)\/commits$/.exec(path)) && method === 'GET' && this.repos.has(match[1].toLowerCase())) {
      const date = this.fileDates.get(params.get('path'));
      return ok(200, date ? [{ sha: 'f'.repeat(40), commit: { committer: { date } } }] : []);
    }
    if (!(match = /^repos\/([^/]+\/[^/]+)\/(.+)$/.exec(path)) || match[1].toLowerCase() !== this.repository.toLowerCase()) return ok(404, { message: 'Not Found' });
    const rest = match[2];
    if ((match = /^issues\/comments\/(\d+)$/.exec(rest)) && method === 'GET') {
      const comment = this.comments.get(Number(match[1]));
      if (!comment) return ok(404, { message: 'Not Found' });
      return ok(200, { id: comment.id, body: comment.body, created_at: comment.created_at, user: { login: comment.login },
        issue_url: `https://api.github.com/repos/${this.repository}/issues/${comment.issue}` });
    }
    if ((match = /^issues\/(\d+)$/.exec(rest))) {
      const issue = this.issues.get(Number(match[1]));
      const pr = !issue && this.prs.get(Number(match[1]));
      if (pr) {
        // A pull request read or edited through the issues API, as GitHub allows.
        if (method === 'PATCH') { pr.body = body.body; pr.updated_at = this.tick(); }
        return ok(200, { number: pr.number, id: pr.number, title: `PR ${pr.number}`, body: pr.body, state: pr.state === 'OPEN' || pr.state === 'DRAFT' ? 'open' : 'closed',
          state_reason: null, closed_at: null, updated_at: pr.updated_at || null, pull_request: { url: '' }, parent_issue_url: null, issue_dependencies_summary: { total_blocked_by: 0 } });
      }
      if (!issue) return ok(404, { message: 'Not Found' });
      if (method === 'PATCH') { issue.body = body.body; issue.updated_at = this.tick(); }
      return ok(200, this.issueJson(issue));
    }
    if ((match = /^issues\/(\d+)\/comments$/.exec(rest))) {
      const issue = this.issues.get(Number(match[1]));
      if (!issue) return ok(404, { message: 'Not Found' });
      if (method === 'POST') {
        const id = this.addComment(issue.number, { body: body.body });
        return ok(201, this.commentsOf(issue.number).find(comment => comment.id === id));
      }
      const page = Number(params.get('page') || 1);
      return ok(200, this.commentsOf(issue.number).slice((page - 1) * 100, page * 100));
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
    if (rest === 'pulls' && !params.get('head')) {
      const page = Number(params.get('page') || 1);
      const open = [...this.prs.values()].filter(pr => pr.state === 'OPEN' || pr.state === 'DRAFT');
      return ok(200, open.slice((page - 1) * 100, page * 100).map(pr => ({ number: pr.number, body: pr.body, draft: pr.isDraft })));
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
      if (!found) {
        const prefix = `${filePath.replace(/\/$/, '')}/`;
        const entries = [...files].filter(([name]) => name.startsWith(prefix) && !name.slice(prefix.length).includes('/'))
          .map(([name, entry]) => ({ type: 'file', name: name.slice(prefix.length), path: name, sha: entry.sha }));
        return entries.length ? ok(200, entries) : ok(404, { message: 'Not Found' });
      }
      return ok(200, { sha: found.sha, encoding: 'base64', content: Buffer.from(found.text, 'utf8').toString('base64') });
    }
    if (method === 'PUT') {
      if (body.branch !== this.branch) return ok(404, { message: `Branch ${body.branch} not found` });
      if (file && !body.sha) return ok(422, { message: 'Invalid request.\n\n"sha" wasn\'t supplied.' });
      if (file && body.sha !== file.sha) return ok(409, { message: `${filePath} does not match ${body.sha}` });
      if (!file && body.sha) return ok(404, { message: 'Not Found' });
      const text = Buffer.from(body.content, 'base64').toString('utf8');
      this.files.set(filePath, { text, sha: blobSha(text) });
      this.fileDates.set(filePath, this.tick());
      this.commit();
      return ok(file ? 200 : 201, { content: { sha: blobSha(text) }, commit: { sha: `c${this.commits}` } });
    }
    return ok(405, { message: 'Method not allowed' });
  }

  // Writes a state file directly, as another writer would.
  putFile(filePath, doc) {
    const text = `${JSON.stringify(doc, null, 2)}\n`;
    this.files.set(filePath, { text, sha: blobSha(text) });
    this.fileDates.set(filePath, this.tick());
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

  // The inventory's paged open-issues query: issues only (no pull request), 100 a page, each with its
  // native parent and label names. `labels` on an issue lists its label names.
  inventoryRoute(body) {
    const open = [...this.issues.values()].filter(issue => issue.state === 'open').sort((a, b) => a.number - b.number);
    const start = body.variables.after ? Number(body.variables.after) : 0;
    const page = open.slice(start, start + 100);
    const nodes = page.map(issue => {
      const parent = issue.parent ? this.issues.get(issue.parent) : null;
      return { __typename: 'Issue', number: issue.number, state: 'OPEN',
        parent: parent ? { number: parent.number, state: parent.state.toUpperCase(), repository: { nameWithOwner: this.repository } } : null,
        labels: { nodes: (issue.labels || []).map(name => ({ name })) } };
    });
    const hasNextPage = start + 100 < open.length;
    return ok(200, { data: { repository: { issues: { pageInfo: { hasNextPage, endCursor: hasNextPage ? String(start + 100) : null }, nodes } } } });
  }

  graphqlRoute(body) {
    if (/issues\(states: OPEN/.test(body.query)) return this.inventoryRoute(body);
    const pr = this.prs.get(body.variables.number);
    if (!pr) return ok(200, { data: { repository: { pullRequest: null } } });
    return ok(200, { data: { repository: { defaultBranchRef: { name: 'main' }, pullRequest: {
      number: pr.number, state: pr.merged ? 'MERGED' : pr.state, isDraft: pr.isDraft, merged: pr.merged, headRefOid: pr.head, baseRefName: pr.base || 'main', mergeable: 'MERGEABLE',
      commits: { nodes: [{ commit: { oid: pr.rollupOid, statusCheckRollup: { state: 'SUCCESS', contexts: { pageInfo: { hasNextPage: pr.hasNextPage }, nodes: pr.contexts } } } }] },
    } } } });
  }
}

// A child whose gate the controller assigned and, optionally, whose return it recorded and consumed.
// A G1 acceptance first records a G2 review PASSED at `head`, the live PR head it is checked against.
function gatedChild(state, doc, { role = 'G1', assignment = `${role.toLowerCase()}-a1`, returnId = null, verdict = null, writer = null, parentDoc = null, head = 'c'.repeat(40) } = {}) {
  let next = state.assignGate(doc, { assignment, role });
  if (returnId) next = state.recordReturn(next, { returnId, assignment });
  if (verdict === 'ACCEPT' && role === 'G1') next = state.applyPatch('child', next, { review: { state: 'PASSED', verdicts: [{ reviewer: 'g2', head, verdict: 'PASSED' }] } }, { writer, parentDoc });
  if (verdict) next = state.consumeReturn(next, { returnId, verdict, writer, parentDoc, liveHead: head });
  return next;
}

module.exports = { FakeGitHub, blobSha, gatedChild };
