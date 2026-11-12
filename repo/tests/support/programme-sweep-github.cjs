'use strict';
const { BranchFakeGitHub } = require('../toolkit-programme-branch-fake.cjs');
const { blobSha } = require('../toolkit-programme-fake-github.cjs');
class SweepGitHub extends BranchFakeGitHub {
  route(method, endpoint, body) {
    if (endpoint === 'graphql' && /p\d+: pullRequest/.test(body.query)) {
      const repository = { defaultBranchRef: { name: 'main' } };
      for (const match of body.query.matchAll(/p(\d+): pullRequest/g)) {
        const number = Number(match[1]);
        const response = super.route('POST', 'graphql', { query: 'query { pullRequest }', variables: { number } });
        repository[`p${number}`] = { ...response.json.data.repository.pullRequest, title: this.prs.get(number)?.title || 'Example task' };
      }
      return { status: 200, json: { data: { repository } } };
    }
    if (method === 'GET' && /^repos\/[^/]+\/[^/]+\/issues\?/.test(endpoint) && endpoint.includes('state=all')) {
      const params = new URLSearchParams(endpoint.split('?')[1]);
      const page = Number(params.get('page') || 1);
      const since = params.get('since');
      const rows = [...this.issues.values()].map(issue => this.issueJson(issue))
        .filter(row => !since || Date.parse(row.updated_at) >= Date.parse(since));
      return { status: 200, json: rows.slice((page - 1) * 100, page * 100) };
    }
    if (endpoint === 'graphql' && body.query.includes('sweepStateSnapshot')) {
      const { owner, name, ref, directory } = body.variables;
      const slug = `${owner}/${name}`;
      const files = this.filesAt(slug, ref);
      if (!files) return { status: 200, json: { data: { repository: { snapshot: null } } } };
      const prefix = directory.replace(/^.*?:/, '').replace(/\/$/, '') + '/';
      return { status: 200, json: { data: { repository: { commit: { oid: this.resolve(this.git(slug), ref), tree: { oid: this.resolve(this.git(slug), ref) } }, snapshot: { entries: [...files].filter(([file]) => file.startsWith(prefix) && !file.slice(prefix.length).includes('/')).map(([file, text]) => ({ name: file.slice(prefix.length), oid: blobSha(text), type: 'blob', object: { text, isTruncated: false } })) } } } } };
    }
    const m = /^repos\/([^/]+\/[^/]+)\/git\/trees$/.exec(endpoint);
    if (m && method === 'POST' && body.base_tree) {
      const files = this.filesAt(m[1], body.base_tree);
      const result = super.route(method, endpoint, body);
      this.git(m[1]).trees.set(result.json.sha, new Map([...files, ...this.git(m[1]).trees.get(result.json.sha)]));
      return result;
    }
    return super.route(method, endpoint, body);
  }
}
module.exports = { SweepGitHub };
