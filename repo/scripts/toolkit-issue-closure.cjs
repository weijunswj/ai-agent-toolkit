#!/usr/bin/env node
'use strict';
// Prevent actual PR writes and issue closes with unfinished native descendants.
// Executable command positions only; ordinary command arguments remain data.
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { ShellCall, executableCommands, connectorTarget, GRAPHQL_OPERATION, shellPath } = require('./toolkit-shell-call.cjs');
const { IssueClosureGuard } = require('../../skills/github-program-reconciler/scripts/issue-closure.cjs');
const { GitHubTransport } = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');
const { resolveExecutable } = require('../../skills/github-program-reconciler/scripts/resolve-executable.cjs');
const SLUG = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i;
const RECOVERY = 'Provide an explicit repository, PR or issue number, and literal title/body text or a readable body file; retry when GitHub is readable.';
function readFile(file) {
  if (!file || file === '-' || /[$`\r\n]/.test(file)) throw new Error('Editor, stdin and generated files cannot be inspected.');
  try {
    if (!fs.statSync(file).isFile() || fs.statSync(file).size > 1024 * 1024) throw new Error();
    return fs.readFileSync(file, 'utf8');
  } catch { throw new Error('The content file is unavailable or too large.'); }
}
function remaining(options) {
  const value = options.deadline === undefined ? 5000 : Math.ceil(options.deadline - performance.now());
  if (value <= 0) throw new Error('Issue closure invocation deadline expired.');
  return Math.min(options.timeoutMs ?? 5000, value);
}
function originRepository(cwd, options) {
  let git;
  try { git = resolveExecutable('git', { cwd }); } catch { throw new Error('git is unavailable for repository origin lookup. Run setup toolkit.'); }
  const result = spawnSync(git, ['-C', cwd, 'config', '--get', 'remote.origin.url'], { encoding: 'utf8', timeout: remaining(options), windowsHide: true });
  if (result.status !== 0) throw new Error('Repository origin could not be read within the invocation deadline.');
  return /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\s*$/.exec(result.stdout)?.[1];
}
function guardFor(repository, cwd, options = {}) {
  if (!SLUG.test(repository || '')) throw new Error('Repository unavailable.');
  // Resolve gh only when a closing target actually needs a read.
  const transport = options.transport || { timeoutMs: options.timeoutMs ?? 5000, request(...args) {
    let ghPath;
    try { ghPath = options.ghPath || resolveExecutable('gh', { cwd }); }
    catch { throw Object.assign(new Error('gh is unavailable. Run setup toolkit, then gh auth login.'), { code: 'GH_MISSING' }); }
    return new GitHubTransport({ ghPath, timeoutMs: options.timeoutMs ?? 5000 }).request(...args);
  } };
  return new IssueClosureGuard({ transport, repository, deadline: options.deadline, deadlineMs: options.deadlineMs ?? 120000, maxRequests: options.maxRequests ?? 500 });
}
const TABLES = {
  create: { values: ['repo:R','assignee:a','base:B','body:b','body-file:F','head:H','label:l','milestone:m','project:p','recover','reviewer:r','template:T','title:t'], booleans: ['draft:d','dry-run','editor:e','fill:f','fill-first','fill-verbose','no-maintainer-edit','web:w'] },
  edit: { values: ['repo:R','add-assignee','add-label','add-project','add-reviewer','base:B','body:b','body-file:F','milestone:m','remove-assignee','remove-label','remove-project','remove-reviewer','title:t'], booleans: ['remove-milestone'] },
  close: { values: ['repo:R','comment:c','reason:r'], booleans: [] },
  api: { values: ['cache','field:F','header:H','hostname','input','jq:q','method:X','preview:p','raw-field:f','template:t'], booleans: ['include:i','paginate','silent','slurp','verbose'] },
};
const REPEAT = new Set(['assignee','label','project','reviewer','add-assignee','add-label','add-project','add-reviewer','remove-assignee','remove-label','remove-project','remove-reviewer','header','field','raw-field','preview']);
function flagValues(words, kind) {
  const table = TABLES[kind]; const aliases = new Map();
  for (const [entries, takesValue] of [[table.values, true], [[...table.booleans, 'help:h'], false]]) for (const entry of entries) {
    const [long, short] = entry.split(':'); aliases.set(`--${long}`, { key: long, takesValue });
    if (short) aliases.set(`-${short}`, { key: long, takesValue });
  }
  const flags = new Map(); const positional = [];
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word === '--') { positional.push(...words.slice(i + 1)); break; }
    if (!word.startsWith('-')) { positional.push(word); continue; }
    const equal = word.indexOf('=');
    const key = word.startsWith('--') ? equal > 0 ? word.slice(0, equal) : word : word.slice(0,2);
    const spec = aliases.get(key);
    if (!spec) throw new Error(`Unknown flag ${/^--?[a-zA-Z][a-zA-Z-]*$/.test(key) ? key : '(unreadable name)'} on a guarded GitHub write. Use the documented subcommand flags.`);
    let value = true;
    if (spec.takesValue) {
      value = word.startsWith('--') ? equal > 0 ? word.slice(equal + 1) : words[++i] : word.length > 2 ? word.slice(word[2] === '=' ? 3 : 2) : words[++i];
      if (value === undefined || /^-[a-zA-Z]/.test(value)) throw new Error(`Missing value for ${spec.key}.`);
    } else if (equal > 0 || !word.startsWith('--') && word.length > 2) throw new Error('Boolean flags cannot carry values.');
    if (flags.has(spec.key) && !REPEAT.has(spec.key)) throw new Error(`Repeated ${spec.key} option is ambiguous.`);
    if (REPEAT.has(spec.key)) flags.set(spec.key, [...(flags.get(spec.key) || []), value]); else flags.set(spec.key, value);
  }
  if (flags.has('body') && flags.has('body-file')) throw new Error('Conflicting body sources.');
  return { flags, positional };
}
function explicit(value) { if (typeof value === 'string' && /[$`]|__unreadable_stdin__|__here_string__|__inert_block__/.test(value)) throw new Error('Generated GitHub text or identity cannot be inspected.'); return value; }
// Comments and string contents are data; mutation fields (including aliases) are executable.
function graphqlRelevant(query) {
  if (typeof query !== 'string' || query.length > 1024 * 1024) throw new Error('GraphQL query is unreadable.');
  const stripped = query.replace(/#[^\r\n]*|"""[\s\S]*?"""|"(?:\\.|[^"\\])*"/g, ' ');
  const tokens = stripped.match(/[A-Za-z_][A-Za-z_0-9]*|[{}():!$]/g) || [];
  if (!tokens.length) throw new Error('GraphQL query is unreadable.');
  if (!tokens.includes('mutation')) {
    if (/^\s*(?:query\b|\{)/.test(stripped)) return false;
    throw new Error('GraphQL query is unreadable.');
  }
  const fields = new Set(['closeIssue','updateIssue','updatePullRequest','createPullRequest']);
  let braces = 0; let parens = 0; let mutation = false; let found = false;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === 'mutation' && braces === 0) mutation = true;
    if (token === '(') parens++;
    else if (token === ')') parens--;
    else if (token === '{') braces++;
    else if (token === '}') { braces--; if (!braces) mutation = false; }
    else if (mutation && braces === 1 && parens === 0 && fields.has(token) && tokens[i + 1] !== ':') {
      if (token !== 'updateIssue') found = true;
      else {
        let end = i + 1; let nesting = 0;
        for (; end < tokens.length; end++) {
          if (tokens[end] === '(') nesting++;
          if (tokens[end] === ')' && --nesting === 0) break;
        }
        const input = tokens.slice(i + 1, end);
        const state = input.indexOf('state');
        const variableInput = input.some((word, j) => word === 'input' && input[j + 1] === ':' && input[j + 2] === '$');
        if (variableInput || state >= 0 && !(input[state + 1] === ':' && input[state + 2] === 'OPEN')) found = true;
      }
    }
  }
  if (braces || parens || /\bfragment\b|\.\.\./.test(stripped)) throw new Error('GraphQL query structure cannot be resolved.');
  return found;
}
function apiOperation(flags, positional, call, command, commandCount) {
  const endpoint = positional[0] || '';
  const method = String(flags.get('method') || (flags.has('field') || flags.has('raw-field') || flags.has('input') ? 'POST' : 'GET')).toUpperCase();
  if (method === 'GET' || method === 'HEAD') return null;
  const target = /^(?:https:\/\/api\.github\.com\/)?\/?repos\/([^/]+\/[^/]+)\/(issues|pulls)(?:\/(\d+))?$/.exec(endpoint);
  if (!target && endpoint !== 'graphql') return null;
  const fields = [...(flags.get('field') || []), ...(flags.get('raw-field') || [])]; let payload = {};
  if (flags.has('input')) {
    if (command.unreadableInput || commandCount !== 1) throw new Error('API input may be generated by another command or stdin.');
    try { payload = JSON.parse(readFile(shellPath(call.folder, flags.get('input')))); } catch { throw new Error('API input must be a readable JSON file.'); }
  }
  for (const field of fields) {
    const pair = /^([^=]+)=(.*)$/s.exec(field);
    if (!pair) throw new Error('API fields must be explicit.');
    if (Object.hasOwn(payload, pair[1]) && ['state','title','body','query'].includes(pair[1])) throw new Error('Duplicate closure-sensitive API field.');
    if (pair[2].startsWith('@') && commandCount !== 1) throw new Error('API field content may be generated by another command.');
    payload[pair[1]] = pair[2].startsWith('@') ? readFile(shellPath(call.folder, pair[2].slice(1))) : pair[2];
  }
  if (endpoint === 'graphql') { if (graphqlRelevant(payload.query)) throw new Error('Guarded GraphQL mutation identity or text is unresolved. Use an explicit REST issue/PR target.'); return null; }
  if (target[2] === 'issues') {
    if (payload.state === undefined || payload.state === 'open') return null;
    explicit(payload.state); if (payload.state !== 'closed') return null;
    return { kind: 'close', repository: target[1], number: Number(target[3]) };
  }
  return { kind: target[3] ? 'edit' : 'create', repository: target[1], number: Number(target[3]), title: explicit(payload.title), body: explicit(payload.body) };
}
function shellOperations(input, options = {}) {
  const call = ShellCall.from(input); const operations = []; const commands = executableCommands(call.text);
  for (const command of commands) {
    if (!/(?:^|[\\/])gh(?:\.exe)?$/i.test(command.words[0])) continue;
    const words = command.words.slice(1); let inherited;
    if (['-R','--repo'].includes(words[0])) { inherited = words[1]; words.splice(0,2); }
    else if (/^(?:-R.+|--repo=)/.test(words[0] || '')) { inherited = words[0].startsWith('--') ? words[0].slice(7) : words[0].slice(2); words.shift(); }
    const kind = words[0] === 'api' ? 'api' : words[0] === 'pr' && ['create','edit'].includes(words[1]) ? words[1] : words[0] === 'issue' && words[1] === 'close' ? 'close' : null;
    if (!kind) continue;
    const { flags, positional } = flagValues(words.slice(kind === 'api' ? 1 : 2), kind);
    if (flags.has('help')) continue;
    if (kind === 'api') { const op = apiOperation(flags, positional, call, command, commands.length); if (op) operations.push(op); continue; }
    let repository = flags.get('repo') || inherited; let number = Number(positional[0]);
    if (inherited && flags.has('repo') && inherited.toLowerCase() !== flags.get('repo').toLowerCase()) throw new Error('Conflicting repository options.');
    const url = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/(?:pull|issues)\/(\d+)$/.exec(positional[0] || '');
    if (url) { if (repository && repository.toLowerCase() !== url[1].toLowerCase()) throw new Error('Conflicting repository identities.'); repository = url[1]; number = Number(url[2]); }
    if (kind !== 'create' && (!Number.isSafeInteger(number) || number < 1)) throw new Error(`Missing or invalid ${kind === 'close' ? 'issue' : 'PR'} number.`);
    if (!repository && command.movesTarget) throw new Error('The command changes folder or GH_REPO. Name the repository explicitly.');
    repository ||= process.env.GH_REPO || originRepository(call.folder, options); explicit(repository);
    const op = { kind, repository, number };
    if (kind !== 'close') {
      if (['fill','fill-first','fill-verbose','web','editor','template','recover'].some(key => flags.has(key))) throw new Error('Generated or editor PR content cannot be inspected.');
      op.title = explicit(flags.get('title')); op.body = explicit(flags.get('body'));
      if (flags.has('body-file')) {
        if (commands.length !== 1 || command.unreadableInput) throw new Error('The PR body file may be generated by another command or stdin.');
        op.body = readFile(shellPath(call.folder, flags.get('body-file')));
      }
      if (kind === 'edit' && op.title === undefined && op.body === undefined && [...flags.keys()].every(key => key === 'repo')) throw new Error('Editor PR content cannot be inspected.');
    }
    operations.push(op);
  }
  return { operations, cwd: call.folder };
}
function connectorOperations(input) {
  const tool = input?.tool_name || ''; const args = input?.tool_input || {};
  if (GRAPHQL_OPERATION.test(tool)) { if (graphqlRelevant(args.query)) throw new Error('Guarded GraphQL mutation identity or text is unresolved.'); return []; }
  const kind = /create_pull_request$/.test(tool) ? 'create' : /(?:update|edit)_pull_request$/.test(tool) ? 'edit' : /close_issue$/.test(tool) || /(?:issue_write|update_issue)$/.test(tool) && String(args.state).toLowerCase() === 'closed' ? 'close' : null;
  if (!kind) return [];
  const target = connectorTarget(args, ['pr_number','pull_number','pullNumber','pull_request_number','number','issue_number','issueNumber']);
  if (target.unclear) throw new Error(`Conflicting ${target.unclear} fields.`);
  return [{ kind, repository: target.repository, number: target.pr, title: args.title, body: args.body }];
}
function issueClosureDecision(input, options = {}) {
  try {
    const shell = ShellCall.isShellTool(input?.tool_name);
    const { operations, cwd } = shell ? shellOperations(input, options) : { operations: connectorOperations(input), cwd: input?.cwd || process.cwd() };
    for (const op of operations) {
      if (!SLUG.test(op.repository || '')) throw new Error('Missing or invalid repository identity.');
      if (op.kind !== 'create' && (!Number.isSafeInteger(op.number) || op.number < 1)) throw new Error(`Missing or invalid ${op.kind === 'close' ? 'issue' : 'PR'} number.`);
      const guard = options.guard || guardFor(op.repository, cwd, options); let result;
      if (op.kind === 'close') result = guard.assertClosable(op.number);
      else {
        if (op.title !== undefined && typeof op.title !== 'string' || op.body !== undefined && typeof op.body !== 'string') throw new Error('PR text must be explicit strings.');
        if (op.kind === 'create' && (op.title === undefined || op.body === undefined)) throw new Error('PR creation needs an explicit title and body.');
        result = op.kind === 'edit' ? guard.checkEdit(op.number, { title: op.title, body: op.body }) : guard.checkTexts([op.title, op.body]);
      }
      if (result.status !== 'allowed') return { status: result.status, deny: `Toolkit: ${result.reason} ${RECOVERY}` };
    }
    return null;
  } catch (error) { return { status: 'unknown', deny: `Toolkit: ${error.message} ${RECOVERY}` }; }
}
function main() {
  const event = JSON.parse(readFile(process.env.GITHUB_EVENT_PATH)); const pr = event.pull_request;
  if (!pr?.number || !pr.head?.sha) throw new Error('A current pull request event is required.');
  const result = guardFor(process.env.GITHUB_REPOSITORY, process.cwd(), { timeoutMs: 30000 }).checkPullRequest(pr.number, { head: pr.head.sha });
  if (result.status !== 'allowed') throw new Error(result.reason);
  process.stdout.write('Issue closure safety verified on the current PR head.\n');
}
if (require.main === module) { try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; } }
module.exports = { issueClosureDecision, guardFor, readFile, shellOperations, connectorOperations, flagValues, graphqlRelevant };
