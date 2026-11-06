#!/usr/bin/env node
'use strict';
// Prevent actual PR writes and issue closes with unfinished native descendants.
// Known executable positions and attached gh words are read; hidden writes and variable command
// words refuse by name, while listed data stays data. Accepted syntax gaps live in the Projects skill.
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { performance } = require('node:perf_hooks');
const { ShellCall, closureCommands, connectorTarget, GRAPHQL_OPERATION, shellPath, wordText, stdinText, fileIsGenerated, ghCommand } = require('./toolkit-shell-call.cjs');
const { IssueClosureGuard, closingReferences } = require('../../skills/github-program-reconciler/scripts/issue-closure.cjs');
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
  if (result.error?.code === 'ETIMEDOUT') throw new Error('Repository origin lookup exceeded the invocation deadline.');
  if (result.status !== 0 || !result.stdout?.trim()) throw new Error('This repository has no readable origin remote. Name the repository explicitly.');
  const repository = /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\s*$/.exec(result.stdout)?.[1];
  if (!repository) throw new Error('The origin remote is not on github.com. Name the repository explicitly.');
  return repository;
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
  close: { values: ['repo:R','comment:c','reason:r','duplicate-of'], booleans: [] },
  api: { values: ['cache','field:F','header:H','hostname','input','jq:q','method:X','preview:p','raw-field:f','template:t'], booleans: ['include:i','paginate','silent','slurp','verbose'] },
};
const REPEAT = new Set(['assignee','label','project','reviewer','add-assignee','add-label','add-project','add-reviewer','remove-assignee','remove-label','remove-project','remove-reviewer','header','field','raw-field','preview']);
function flagValues(words, kind, expanding = []) {
  const table = TABLES[kind]; const aliases = new Map();
  for (const [entries, takesValue] of [[table.values, true], [[...table.booleans, 'help:h'], false]]) for (const entry of entries) {
    const [long, short] = entry.split(':'); aliases.set(`--${long}`, { key: long, takesValue });
    if (short) aliases.set(`-${short}`, { key: long, takesValue });
  }
  const flags = new Map(); const positional = []; const expansions = new Map();
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word === '--') { positional.push(...words.slice(i + 1)); break; }
    if (!word.startsWith('-')) { positional.push(word); continue; }
    const equal = word.indexOf('=');
    const key = word.startsWith('--') ? equal > 0 ? word.slice(0, equal) : word : word.slice(0,2);
    const spec = aliases.get(key);
    if (!spec) throw new Error(`Unknown flag ${/^--?[a-zA-Z][a-zA-Z-]*$/.test(key) ? key : '(unreadable name)'} on a guarded GitHub write. Use the documented subcommand flags.`);
    let value = true;
    let expands = expanding[i] || false;
    if (spec.takesValue) {
      value = word.startsWith('--') ? equal > 0 ? word.slice(equal + 1) : words[++i] : word.length > 2 ? word.slice(word[2] === '=' ? 3 : 2) : words[++i];
      expands ||= expanding[i] || false;
      if (value === undefined || /^--?[a-zA-Z][\w-]*$/.test(value)) throw new Error(`Missing value for ${spec.key}.`);
    } else if (equal > 0) throw new Error('Boolean flags cannot carry values.');
    else if (!word.startsWith('--') && word.length > 2) {
      // Re-read clustered short options; a value-taking final option keeps its tail.
      words = [...words.slice(0, i + 1), '-' + word.slice(2), ...words.slice(i + 1)];
      expanding = [...expanding.slice(0, i + 1), expands, ...expanding.slice(i + 1)];
    }
    if (flags.has(spec.key) && !REPEAT.has(spec.key)) throw new Error(`Repeated ${spec.key} option is ambiguous.`);
    if (REPEAT.has(spec.key)) flags.set(spec.key, [...(flags.get(spec.key) || []), value]); else flags.set(spec.key, value);
    if (REPEAT.has(spec.key)) expansions.set(spec.key, [...(expansions.get(spec.key) || []), expands]); else expansions.set(spec.key, expands);
  }
  if (flags.has('body') && flags.has('body-file')) throw new Error('Conflicting body sources.');
  return { flags, positional, expansions };
}
function explicit(value) { if (typeof value === 'string' && /[$`]|__inert_block__/.test(value)) throw new Error('Generated GitHub text or identity cannot be inspected.'); return value; }
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
function textValue(value, expanding, command) {
  const read = wordText({ words: [value], expanding: [expanding], docs: command.docs }, 0);
  if (read.unresolved) throw new Error('Generated GitHub text cannot be inspected. Provide literal text or a readable body file.');
  return read.value;
}
function contentFile(file, call, command, commands, index) {
  if (file === '-') return stdinText(command);
  const generated = fileIsGenerated(file, command, commands, index);
  if (generated === 'moved') throw new Error('The command changes folder first, so Toolkit cannot tell which file this names. Use an absolute path.');
  if (generated) throw new Error('The content file may be generated by another command or stdin.');
  return readFile(shellPath(call.folder, file));
}
function queryText(value, expanding, command, call, commands, index) {
  if (!expanding) return textValue(value, false, command);
  const variable = /^\$([A-Za-z_]\w*)$/.exec(value || '');
  if (variable) {
    // Resolve only a leading literal assignment. An assignment under a condition or function
    // might never run, leaving an older closeIssue mutation in the variable.
    const assignmentName = new RegExp(`^\\$?${variable[1]}(?:\\+?=|$)`, command.powershell ? 'i' : '');
    const assignments = commands.filter((part, at) => at !== index && (part.sourceWords || part.allWords || part.words).some(word => assignmentName.test(word)));
    const literal = new RegExp(`(?:^|[;\\n])\\s*\\$?${variable[1]}\\s*=\\s*'((?:[^']|'')*)'\\s*(?=;|\\r?\\n|$)`, command.powershell ? 'gi' : 'g');
    const matches = [...call.text.matchAll(literal)];
    if (assignments.length !== 1 || commands.indexOf(assignments[0]) >= index || matches.length !== 1 || call.text.slice(0, matches[0].index).trim()) throw new Error('GraphQL query variable is unresolved. Put its literal assignment first, or use single quotes or a readable query file.');
    return matches[0][1].replace(/''/g, "'");
  }
  const stripped = String(value).replace(/#[^\r\n]*|"""[\s\S]*?"""|"(?:\\.|[^"\\])*"/g, ' ');
  if (/^\s*(?:query\b|\{)/.test(stripped)) {
    let depth = 0; let opened = false;
    for (let i = 0; i < stripped.length; i++) {
      if (stripped[i] === '{') { depth++; opened = true; }
      if (stripped[i] === '}' && --depth === 0) { if (opened && !stripped.slice(i + 1).trim()) return value; break; }
    }
  }
  throw new Error('Expanding GraphQL query structure is unresolved. Use single quotes or a readable query file.');
}
function apiOperation(flags, positional, call, command, commands, index, expansions) {
  const endpoint = positional[0] || '';
  const method = String(flags.get('method') || (flags.has('field') || flags.has('raw-field') || flags.has('input') ? 'POST' : 'GET')).toUpperCase();
  if (method === 'GET' || method === 'HEAD') return null;
  const target = /^(?:https:\/\/api\.github\.com\/)?\/?repos\/(.+)\/(issues|pulls)(?:\/([^/?#]+))?\/?(?:[?#].*)?$/i.exec(endpoint);
  if (!target && /^(?:https:\/\/api\.github\.com\/)?\/?repos\/.+\/(?:issues|pulls)\/[^/]+\//i.test(endpoint)) return null;
  const unresolvedEndpoint = /[$`]|\{/.test(endpoint);
  if (!target && endpoint !== 'graphql' && !unresolvedEndpoint) return null;
  if (target && target[3] && !/^\d+$/.test(target[3]) && !/[$`{}]/.test(target[3])) return null;
  const sensitive = endpoint === 'graphql' ? ['query'] : target?.[2].toLowerCase() === 'issues' ? ['state'] : target ? ['title','body'] : ['state','title','body'];
  let payload = {};
  if (flags.has('input')) {
    if (index > 0) throw new Error('API input may be generated by another command or stdin.');
    try { payload = JSON.parse(contentFile(flags.get('input'), call, command, commands, index)); } catch { throw new Error('API input must be a readable JSON file or literal heredoc.'); }
  }
  for (const key of ['field','raw-field']) for (const [i, field] of (flags.get(key) || []).entries()) {
    const pair = /^([^=]+)=(.*)$/s.exec(field);
    if (!pair) throw new Error('API fields must be explicit.');
    if (!sensitive.includes(pair[1])) continue;
    if (Object.hasOwn(payload, pair[1])) throw new Error('Duplicate closure-sensitive API field.');
    payload[pair[1]] = key === 'field' && pair[2].startsWith('@')
      ? contentFile(pair[2].slice(1), call, command, commands, index)
      : pair[1] === 'state' ? explicit(pair[2]) : endpoint === 'graphql' ? queryText(pair[2], expansions.get(key)?.[i], command, call, commands, index) : textValue(pair[2], expansions.get(key)?.[i], command);
  }
  if (endpoint === 'graphql') { if (graphqlRelevant(payload.query)) throw new Error('Guarded GraphQL mutation identity or text is unresolved. Use an explicit REST issue/PR target.'); return null; }
  const closesIssue = payload.state !== undefined && payload.state !== 'open';
  const closesPR = ['title','body'].some(key => typeof payload[key] !== 'string' && payload[key] != null || closingReferences(payload[key] || '', 'x/x').length);
  if (target?.[2].toLowerCase() === 'issues' && !closesIssue || target?.[2].toLowerCase() === 'pulls' && !closesPR) return null;
  if (!target && !closesIssue && !closesPR) return null;
  const repository = target?.[1]; const number = /^\d+$/.test(target?.[3] || '') ? Number(target[3]) : null;
  if (!SLUG.test(repository || '') || !number && (target?.[2].toLowerCase() !== 'pulls' || target?.[3])) throw new Error('This call closes an issue whose repository or number is not literal. Name both.');
  if (target[2].toLowerCase() === 'issues') { explicit(payload.state); return payload.state === 'closed' ? { kind: 'close', repository, number } : null; }
  return { kind: target[3] ? 'edit' : 'create', repository, number, title: payload.title, body: payload.body };
}
function shellOperations(input, options = {}) {
  const call = ShellCall.from(input); const operations = []; const commands = closureCommands(input);
  for (const [index, command] of commands.entries()) {
    if (command.unreadableGh) throw new Error('Start-Process gh arguments cannot be inspected. Use one literal argument string and supported options, or run gh as its own command.');
    const gh = ghCommand(command.words); if (!gh) continue;
    if (gh.variable) throw Object.assign(new Error('This gh command takes its command words from a variable, so Toolkit cannot tell what it runs and it was refused. Write the gh command out in full.'), { complete: true });
    const { noun, verb, inherited, rest, start } = gh;
    const kind = noun === 'api' ? 'api' : noun === 'pr' && ['create','new','edit'].includes(verb) ? verb === 'new' ? 'create' : verb : noun === 'issue' && verb === 'close' ? 'close' : null;
    if (!kind) continue;
    const hidden = () => Object.assign(new Error(`This command runs gh ${noun}${verb ? ' ' + verb : ''} inside an assignment, script block or wrapper Toolkit does not read, so it was refused. Run it as its own command, or quote it if it is only text.`), { complete: true });
    let parsed;
    try { parsed = flagValues(rest, kind, command.expanding.slice(start)); }
    catch (error) {
      if (kind === 'api') {
        let method;
        for (let i = 0; i < rest.length; i++) {
          if (rest[i] === '-X' || rest[i] === '--method') method = rest[++i];
          else if (/^(?:-X.+|--method=)/.test(rest[i])) method = rest[i].replace(/^(?:-X=?|--method=)/, '');
        }
        if (/^(?:GET|HEAD)$/i.test(method || '')) continue;
      }
      if (command.hidden) throw hidden();
      if (kind !== 'api' || rest.some(word => /^(?:https:\/\/api\.github\.com\/)?\/?repos\/.+\/(?:issues|pulls)(?:\/[^/]+)?\/?(?:[?#].*)?$|^graphql$/.test(word)) && rest.some(word => /^(?:-X|-f|-F|--method|--field|--raw-field|--input)/.test(word))) throw error;
      continue;
    }
    const { flags, positional, expansions } = parsed;
    if (flags.has('help')) continue;
    if (command.hidden && kind !== 'api') throw hidden();
    if (kind === 'api') {
      let op;
      try { op = apiOperation(flags, positional, call, command, commands, index, expansions); } catch (error) { if (command.hidden) throw hidden(); throw error; }
      if (op) { if (command.hidden) throw hidden(); operations.push(op); } continue;
    }
    const op = { kind };
    if (kind !== 'close') {
      if (['fill','fill-first','fill-verbose','web','editor','template','recover'].some(key => flags.has(key))) throw new Error('Generated or editor PR content cannot be inspected.');
      if (kind === 'create' && (!flags.has('title') || !flags.has('body') && !flags.has('body-file'))) throw new Error('PR creation needs an explicit title and body.');
      op.title = textValue(flags.get('title'), expansions.get('title'), command);
      op.body = textValue(flags.get('body'), expansions.get('body'), command);
      if (flags.has('body-file')) op.body = contentFile(flags.get('body-file'), call, command, commands, index);
      if (kind === 'edit' && op.title === undefined && op.body === undefined && [...flags.keys()].every(key => key === 'repo')) throw new Error('Editor PR content cannot be inspected.');
      if (![op.title,op.body].some(text => closingReferences(text || '', 'x/x').length)) continue;
    }
    let repository = flags.get('repo') || inherited; let number = Number(positional[0]);
    if (inherited && flags.has('repo') && inherited.toLowerCase() !== flags.get('repo').toLowerCase()) throw new Error('Conflicting repository options.');
    const url = /^https:\/\/github\.com\/([^/]+\/[^/]+)\/(?:pull|issues)\/(\d+)$/.exec(positional[0] || '');
    if (url) { if (repository && repository.toLowerCase() !== url[1].toLowerCase()) throw new Error('Conflicting repository identities.'); repository = url[1]; number = Number(url[2]); }
    if (kind !== 'create' && (!Number.isSafeInteger(number) || number < 1)) throw new Error(`Missing or invalid ${kind === 'close' ? 'issue' : 'PR'} number.`);
    if (!repository && command.movesTarget) throw new Error('The command changes folder or GH_REPO. Name the repository explicitly.');
    repository ||= process.env.GH_REPO || originRepository(call.folder, options); explicit(repository);
    operations.push({ ...op, repository, number });
  }
  return { operations, cwd: call.folder };
}

function connectorOperations(input, options = {}) {
  const tool = input?.tool_name || ''; const args = input?.tool_input || {};
  if (GRAPHQL_OPERATION.test(tool)) { if (graphqlRelevant(args.query)) throw new Error('Guarded GraphQL mutation identity or text is unresolved.'); return []; }
  const cloudMerge = options.cloud && /^mcp__.+?[_-]merge[_-]?pull[_-]?request$/i.test(tool);
  if (cloudMerge && !['commit_title','commit_message','commitTitle','commitMessage'].some(key => args[key] !== undefined)) return [];
  const kind = cloudMerge ? 'edit' : /create_pull_request$/.test(tool) ? 'create' : /(?:update|edit)_pull_request$/.test(tool) ? 'edit' : /close_issue$/.test(tool) || /(?:issue_write|update_issue)$/.test(tool) && String(args.state).toLowerCase() === 'closed' ? 'close' : null;
  if (!kind) return [];
  const target = connectorTarget(args, ['pr_number','pull_number','pullNumber','pull_request_number','number','issue_number','issueNumber']);
  if (target.unclear) throw new Error(`Conflicting ${target.unclear} fields.`);
  const variants = cloudMerge ? [{ title: args.commit_title, body: args.commit_message }, { title: args.commitTitle, body: args.commitMessage }] : [{ title: args.title, body: args.body }];
  return variants.filter(text => !cloudMerge || text.title !== undefined || text.body !== undefined)
    .map(text => ({ kind, repository: target.repository, number: target.pr, ...text }));
}
function issueClosureDecision(input, options = {}) {
  try {
    const shell = ShellCall.isShellTool(input?.tool_name);
    const { operations, cwd } = shell ? shellOperations(input, options) : { operations: connectorOperations(input, options), cwd: input?.cwd || process.cwd() };
    for (const op of operations) {
      if (op.kind !== 'close') {
        for (const key of ['title','body']) {
          if (op[key] == null) op[key] = undefined;
          else if (typeof op[key] !== 'string') throw new Error('PR text must be explicit strings.');
        }
      }
      if (!SLUG.test(op.repository || '')) throw new Error('Missing or invalid repository identity.');
      if (op.kind !== 'create' && (!Number.isSafeInteger(op.number) || op.number < 1)) throw new Error(`Missing or invalid ${op.kind === 'close' ? 'issue' : 'PR'} number.`);
      const guard = options.guard || guardFor(op.repository, cwd, options); let result;
      if (op.kind === 'close') result = guard.assertClosable(op.number);
      else {
        if (op.title !== undefined && typeof op.title !== 'string' || op.body !== undefined && typeof op.body !== 'string') throw new Error('PR text must be explicit strings.');
        result = op.kind === 'edit' ? guard.checkEdit(op.number, { title: op.title, body: op.body }) : guard.checkTexts([op.title, op.body].filter(value => value !== undefined));
      }
      if (result.status !== 'allowed') return { status: result.status, deny: `Toolkit: ${result.reason}${result.status === 'unknown' ? ' ' + RECOVERY : ''}` };
    }
    return null;
  } catch (error) { return { status: 'unknown', deny: `Toolkit: ${error.message}${error.complete === true ? '' : ' ' + RECOVERY}` }; }
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
