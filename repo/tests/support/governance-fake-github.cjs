'use strict';

// A strict offline GitHub process for the proposal transport's actual spawnSync path.
const fs = require('node:fs');
const crypto = require('node:crypto');
const [file, ...args] = process.argv.slice(2);
const state = JSON.parse(fs.readFileSync(file, 'utf8'));
const input = args.includes('--input') ? JSON.parse(fs.readFileSync(0, 'utf8')) : null;
state.calls.push({ args, input });
const sha = text => crypto.createHash('sha1').update(text).digest('hex');
const base = 'a'.repeat(40), root = 'b'.repeat(40), head = 'c'.repeat(40), github = 'd'.repeat(40), prepared = 'e'.repeat(40);
const marker = '<!-- toolkit-governance-decision -->';
const endpoint = args[1]?.replace(`repos/${state.repository}`, 'repo');
let result = null, missing = false;
if (args[0] === 'auth') result = '';
else if (endpoint === 'user') result = { login: 'example-owner' };
else if (endpoint === 'repo') result = args.includes('--jq') ? { push: state.canWrite !== false } : { default_branch: 'main', padding: 'x'.repeat(state.large ? 400000 : 0) };
else if (endpoint === 'repo/pulls?state=open&per_page=100') {
  const prs = [...Array.from({ length: state.large ? 20 : 0 }, (_, index) => ({ number: index + 10, body: 'x'.repeat(30000) })), ...(state.pr ? [state.pr] : [])];
  result = args.includes('--jq') ? prs.map(pr => ({ number: pr.number, marked: pr.body.includes(marker) })) : prs;
} else if (endpoint === 'repo/pulls/1') result = args.includes('--jq') ? state.pr?.state : state.pr;
else if (endpoint === 'repo/pulls/1/files?per_page=100') result = Object.keys(state.files).map(filename => ({ filename, status: 'added' }));
else if (endpoint === 'repo/git/ref/heads/main') result = { object: { sha: base } };
else if (endpoint?.startsWith('repo/git/ref/heads/toolkit/')) { missing = !state.branch; result = { object: { sha: state.branch?.sha } }; }
else if (endpoint === 'repo/git/refs') { state.branch = { name: input.ref, sha: input.sha }; result = {}; }
else if (endpoint === `repo/git/commits/${base}` || endpoint === `repo/git/commits/${head}`) result = { tree: { sha: root } };
else if (endpoint === `repo/git/trees/${root}`) result = { tree: [{ path: '.github', type: 'tree', mode: '040000', sha: github }], truncated: false };
else if (endpoint === `repo/git/trees/${github}`) result = { tree: state.files['.github/toolkit-programme.json'] ? [{ path: 'toolkit-programme.json', type: 'blob', mode: '100644', sha: sha(state.files['.github/toolkit-programme.json']) }] : [], truncated: false };
else if (endpoint?.startsWith('repo/contents/') && !input) {
  const name = endpoint.slice('repo/contents/'.length).split('?')[0], content = state.files[name];
  missing = content === undefined;
  result = { type: 'file', encoding: 'base64', sha: sha(content || ''), size: Buffer.byteLength(content || ''), content: Buffer.from(content || '').toString('base64') };
} else if (endpoint === 'repo/contents/.github/toolkit-programme.json' && input) {
  if (!args.includes('PUT')) throw Error('Contents writes require PUT');
  state.files['.github/toolkit-programme.json'] = Buffer.from(input.content, 'base64').toString('utf8');
  state.branch.sha = head; result = { commit: { sha: head } };
} else if (endpoint === 'repo/git/trees' && input) {
  if (input.base_tree !== root) throw Error('wrong base tree');
  state.prepared = input.tree; result = { sha: prepared };
} else if (endpoint === 'repo/git/commits' && input) {
  if (input.tree !== prepared || input.parents.length !== 1 || input.parents[0] !== base) throw Error('wrong commit');
  state.commits = (state.commits || 0) + 1; result = { sha: head };
} else if (endpoint?.startsWith('repo/git/refs/heads/toolkit/') && input) {
  if (!args.includes('PATCH') || input.force !== false || input.sha !== head) throw Error('unsafe branch update');
  state.branch.sha = head;
  for (const entry of state.prepared) state.files[entry.path] = entry.content;
  result = { object: { sha: head } };
} else if (endpoint === 'repo/pulls' && input) {
  if (!input.body.includes(marker) || state.branch.sha !== head) throw Error('unmarked or uncommitted proposal');
  state.pr = { number: 1, html_url: `https://github.com/${state.repository}/pull/1`, state: 'open', body: input.body, base: { ref: input.base }, head: { sha: head, repo: { full_name: state.repository } }, changed_files: Object.keys(state.files).length };
  result = state.pr;
} else if (endpoint?.startsWith('repo/compare/')) result = { total_commits: 1, merge_base_commit: { sha: base }, files: Object.keys(state.files).map(filename => ({ filename })) };
else throw Error(`Unexpected offline GitHub call: ${args.join(' ')}`);
fs.writeFileSync(file, JSON.stringify(state));
if (state.delayMs) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, state.delayMs);
if (missing) { fs.writeSync(2, '(HTTP 404)'); process.exitCode = 1; }
else fs.writeFileSync(1, args[0] === 'auth' ? result : JSON.stringify(result));
