#!/usr/bin/env node
'use strict';

// Pre-write adapter: prevents closing a parent with unfinished native descendants.
// Unreadable content/state refuses only PR writes and issue closures; ordinary reads pass.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ShellCall, shellCommands, shellPath } = require('./toolkit-shell-call.cjs');
const { IssueClosureGuard } = require('../../skills/github-program-reconciler/scripts/issue-closure.cjs');
const { GitHubTransport } = require('../../skills/github-program-reconciler/scripts/programme-state.cjs');
const { resolveExecutable } = require('../../skills/github-program-reconciler/scripts/resolve-executable.cjs');
const SLUG = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i;
const RECOVERY = 'Provide an explicit repository, PR or issue number, and literal title/body text or a readable body file; retry when GitHub is readable.';
function readFile(file) {
  if (!file || file === '-' || /[$`\r\n]/.test(file)) throw new Error('Editor, stdin and generated files cannot be inspected.');
  if (!fs.statSync(file).isFile() || fs.statSync(file).size > 1024 * 1024) throw new Error('The content file is unavailable or too large.');
  return fs.readFileSync(file, 'utf8');
}
function originRepository(cwd) {
  const git = resolveExecutable('git', { cwd });
  const result = spawnSync(git, ['-C', cwd, 'config', '--get', 'remote.origin.url'], { encoding: 'utf8', timeout: 5000, windowsHide: true });
  if (result.status !== 0) throw new Error('Repository unavailable.');
  return /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\s*$/.exec(result.stdout)?.[1];
}
function guardFor(repository, cwd, options = {}) {
  if (!SLUG.test(repository || '')) throw new Error('Repository unavailable.');
  const transport = options.transport || new GitHubTransport({ ghPath: resolveExecutable('gh', { cwd }), timeoutMs: 5000 });
  // Enforcement does not grant lifecycle authority. A local binding is only a read hint;
  // lifecycle writes independently use the fresh merged binding in programme-state.
  let parentIssue = null;
  const bindingPath = path.join(cwd, '.github', 'toolkit-programme.json');
  if (fs.existsSync(bindingPath)) {
    const binding = JSON.parse(readFile(bindingPath));
    if (binding.repository?.toLowerCase() === repository.toLowerCase()) parentIssue = binding.parents?.[0]?.issue || binding.parent_issue || null;
  }
  return new IssueClosureGuard({ transport, repository, parentIssue });
}
function flagValues(words) {
  const flags = new Map(); const positional = [];
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    if (word.startsWith('-')) {
      const split = word.indexOf('=');
      const attached = /^-[XRtbfF].+/.test(word);
      const key = attached ? word.slice(0, 2) : split > 0 ? word.slice(0, split) : word;
      const boolean = ['--fill', '--fill-first', '--fill-verbose', '--web', '--editor'].includes(key);
      const value = attached ? word.slice(word[2] === '=' ? 3 : 2) : split > 0 ? word.slice(split + 1) : boolean ? true : words[++i];
      if (flags.has(key)) {
        if (!['-f', '-F', '--field', '--raw-field'].includes(key)) throw new Error('Repeated options cannot be resolved.');
        flags.set(key, [...[flags.get(key)].flat(), value]);
      } else flags.set(key, value);
    } else positional.push(word);
  }
  return { flags, positional };
}
function shellOperations(input) {
  const call = ShellCall.from(input);
  const operations = [];
  for (const command of shellCommands(call.text)) {
    const start = command.words.findIndex(word => /(?:^|[\\/])gh(?:\.exe)?$/i.test(word));
    if (start < 0) continue;
    const words = command.words.slice(start + 1);
    let globalRepository;
    if (['-R', '--repo'].includes(words[0])) { globalRepository = words[1]; words.splice(0, 2); }
    else if (/^-R.+/.test(words[0]) || /^--repo=/.test(words[0])) { globalRepository = words[0].startsWith('--') ? words[0].slice(7) : words[0].slice(2); words.splice(0, 1); }
    if (!((words[0] === 'pr' && ['create', 'edit'].includes(words[1])) || (words[0] === 'issue' && words[1] === 'close') || words[0] === 'api')) continue;
    const api = words[0] === 'api';
    const { flags, positional } = flagValues(words.slice(api ? 1 : 2));
    if (api) {
      const endpoint = positional[0] || '';
      const method = String(flags.get('-X') || flags.get('--method') || (flags.has('-f') || flags.has('-F') || flags.has('--input') ? 'POST' : 'GET')).toUpperCase();
      if (method === 'GET') continue;
      // Only exact, readable REST targets are supported. Opaque GraphQL mutations refuse.
      if (endpoint === 'graphql') {
        let query;
        if (flags.has('--input')) query = JSON.parse(readFile(shellPath(call.folder, flags.get('--input')))).query;
        for (const key of ['-f', '-F', '--field', '--raw-field']) for (const value of flags.has(key) ? [flags.get(key)].flat() : []) {
          if (typeof value === 'string' && value.startsWith('query=')) query = value.slice(6).startsWith('@') ? readFile(shellPath(call.folder, value.slice(7))) : value.slice(6);
        }
        if (typeof query !== 'string' || !/^\s*(?:query\b|\{)/.test(query) || /\bmutation\b|closeIssue|updatePullRequest|createPullRequest/.test(query)) throw new Error('Use an explicit REST issue/PR target instead of an opaque GraphQL mutation.');
        continue;
      }
      if (/[$`]|<</.test(call.text)) throw new Error('The API write is generated or unresolved.');
      const target = /^(?:https:\/\/api\.github\.com\/)?\/?repos\/([^/]+\/[^/]+)\/(issues|pulls)(?:\/(\d+))?$/.exec(endpoint);
      if (!target) continue;
      if (flags.has('--input') && shellCommands(call.text).length !== 1) throw new Error('The API body file may be generated by an earlier command.');
      let payload = {};
      if (flags.has('--input')) payload = JSON.parse(readFile(shellPath(call.folder, flags.get('--input'))));
      for (const key of ['-f', '-F', '--field', '--raw-field']) for (const field of flags.has(key) ? [flags.get(key)].flat() : []) {
        const pair = String(field).match(/^([^=]+)=(.*)$/s);
        if (!pair || pair[2].startsWith('@')) throw new Error('API fields must be explicit.');
        payload[pair[1]] = pair[2];
      }
      if (target[2] === 'issues') {
        if (payload.state !== 'closed') continue;
        operations.push({ kind: 'close', repository: target[1], number: Number(target[3]) });
      } else operations.push({ kind: target[3] ? 'edit' : 'create', repository: target[1], number: Number(target[3]), ...payload });
      continue;
    }
    const kind = words[0] === 'issue' ? 'close' : words[1];
    let repository = flags.get('--repo') || flags.get('-R') || globalRepository;
    let number = Number(positional[0]);
    const url = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/(?:pull|issues)\/(\d+)$/.exec(positional[0] || '');
    if (url) { repository = url[1]; number = Number(url[2]); }
    if (!repository && (start > 0 || shellCommands(call.text).length !== 1)) throw new Error('Name the repository explicitly after a wrapper, environment assignment or compound command.');
    repository ||= process.env.GH_REPO || originRepository(call.folder);
    const op = { kind, repository, number };
    if (kind !== 'close') {
      if ([...flags.keys()].some(flag => ['--fill', '--fill-first', '--fill-verbose', '--web', '--editor'].includes(flag))) throw new Error('Generated or editor PR content cannot be inspected.');
      op.title = flags.get('--title') ?? flags.get('-t');
      op.body = flags.get('--body') ?? flags.get('-b');
      const file = flags.get('--body-file') ?? flags.get('-F');
      if (file !== undefined) op.body = readFile(file === '-' ? '-' : shellPath(call.folder, file));
      // Interpolation, substitution and preceding file generators are unresolved shell effects.
      if (/[$`]|<</.test(call.text) || (file && shellCommands(call.text).length !== 1)) throw new Error('Shell-generated PR text cannot be inspected.');
      if (kind === 'edit' && op.title === undefined && op.body === undefined) {
        if (flags.size === 0) throw new Error('Editor PR content cannot be inspected.');
      }
    }
    operations.push(op);
  }
  if (!operations.length && /\bgh\b[^\r\n]*\b(?:pr\s+(?:create|edit)|issue\s+close)\b/i.test(call.text)) throw new Error('The GitHub write command could not be resolved.');
  return { operations, cwd: call.folder };
}
function connectorOperations(input) {
  const tool = input?.tool_name || '';
  const args = input?.tool_input || {};
  const repository = args.repository_full_name || (args.owner && args.repo ? `${args.owner}/${args.repo}` : null);
  const number = Number(args.pull_number || args.pullNumber || args.issue_number || args.issueNumber || args.number);
  if (/(?:create_pull_request|update_pull_request|edit_pull_request)$/.test(tool)) return [{ kind: /create_pull_request$/.test(tool) ? 'create' : 'edit', repository, number, title: args.title, body: args.body }];
  if (/close_issue$/.test(tool) || /(?:issue_write|update_issue)$/.test(tool) && String(args.state).toLowerCase() === 'closed') return [{ kind: 'close', repository, number }];
  if (/graphql/i.test(tool) && /closeIssue|createPullRequest|updatePullRequest|mutation/.test(JSON.stringify(args))) throw new Error('Use an explicit REST issue/PR target instead of an opaque GraphQL mutation.');
  return [];
}
function issueClosureDecision(input, options = {}) {
  try {
    const shell = ShellCall.isShellTool(input?.tool_name);
    const { operations, cwd } = shell ? shellOperations(input) : { operations: connectorOperations(input), cwd: input?.cwd || process.cwd() };
    for (const op of operations) {
      const guard = options.guard || guardFor(op.repository, cwd, options);
      let result;
      if (op.kind === 'close') result = guard.assertClosable(op.number);
      else {
        if (op.title !== undefined && typeof op.title !== 'string' || op.body !== undefined && typeof op.body !== 'string') throw new Error('PR text must be explicit strings.');
        if (op.kind === 'create' && (op.title === undefined || op.body === undefined)) throw new Error('PR creation needs an explicit title and body.');
        result = op.kind === 'edit' ? guard.checkPullRequest(op.number, { title: op.title, body: op.body }) : guard.checkTexts([op.title, op.body]);
      }
      if (result.status !== 'allowed') return { deny: `Toolkit: ${result.reason} ${RECOVERY}` };
    }
    return null;
  } catch { return { deny: `Toolkit: the issue closure check could not inspect this write. ${RECOVERY}` }; }
}
function checkMerge(merge, cwd, options = {}) {
  try {
    if (!merge.repository || !merge.pr || !merge.sha) throw new Error('Merge target is incomplete.');
    const guard = options.closureGuard || guardFor(merge.repository, cwd || process.cwd(), options);
    const result = guard.checkPullRequest(merge.pr, { head: merge.sha, mergeTexts: options.mergeTexts || [] });
    return result.status === 'allowed' ? null : { deny: `Toolkit: ${result.reason} ${RECOVERY}` };
  } catch { return { deny: `Toolkit: issue closure safety could not be checked for this merge. ${RECOVERY}` }; }
}
function main() {
  const event = JSON.parse(readFile(process.env.GITHUB_EVENT_PATH));
  const repository = process.env.GITHUB_REPOSITORY;
  const pr = event.pull_request;
  if (!pr?.number || !pr.head?.sha) throw new Error('A current pull request event is required.');
  const result = guardFor(repository, process.cwd()).checkPullRequest(pr.number, { head: pr.head.sha });
  if (result.status !== 'allowed') throw new Error(result.reason);
  process.stdout.write('Issue closure safety verified on the current PR head.\n');
}
if (require.main === module) { try { main(); } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; } }
module.exports = { issueClosureDecision, checkMerge, guardFor, readFile, shellOperations, connectorOperations };
