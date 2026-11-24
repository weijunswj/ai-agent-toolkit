#!/usr/bin/env node
'use strict';

// Keeps Toolkit's hooks harness-specific (repo/docs/agent-playbooks/hook-design.md, "Harness-specific
// by default"). It reads the hook scope file repo/contracts/hooks/hook-scope.json, every hooks.json in
// the repository and the scripts those files run, and fails when:
//   - a tracked hooks.json is not listed under a harness in the scope file, or a listed one is missing;
//   - a hooks.json command has no scope row for its harness, or is not a node script in the repository;
//   - a hooks.json entry runs on an event its row does not list, a listed event has no `why_event`
//     line, or a row names an event, script or hard rule that nothing runs or the closed list lacks;
//   - one script runs from two harnesses' hooks.json files, or one harness's hook script is loaded
//     by another harness's entry;
//   - a module that two harnesses' entries load (the static require graph; a require it cannot
//     resolve fails closed) has no `policy` or `library` row;
//   - a `policy` or `library` module holds a harness's vocabulary: a tool name as a whole string
//     literal or regular-expression word, a CLAUDE_ or CODEX_ name, a hook output field, or a
//     comparison with `host`;
//   - a `known_open` item is already clean, lists a term no longer found or misses one now found, or
//     is new since the base (the list only shrinks; the base is DIFF_BASE in CI, else where HEAD left
//     origin/main).
// Comments are not read. It runs only in this repository's own CI and writes nothing.
//
// Usage: node repo/scripts/check-hook-scope.cjs [--root <dir>] [--inventory]
//   --inventory prints the hook graph (entries, shared modules, the vocabulary each shared module
//   holds) as JSON instead of checking.
// Exit 0 clear, 1 findings, 2 bad arguments or an unreadable scope file or base.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCOPE = 'repo/contracts/hooks/hook-scope.json';
const SCHEMA = 'toolkit-hook-scope/v1';
const MODULE_KINDS = Object.freeze(['policy', 'library']);
const SCRIPT_EXTENSIONS = Object.freeze(['.cjs', '.js', '.mjs']);
const KEYWORDS_BEFORE_REGEX = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
const EQUALITY = new Set(['===', '!==', '==', '!=']);
// A tool name inside a regular expression counts only as a whole alternative: /^(?:Bash|Monitor)$/.
const REGEX_ITEM = /(?<=^|[(|:^])([A-Za-z_][A-Za-z0-9_]*)(?=$|[|)$])/g;

const posix = rel => rel.split(path.sep).join('/');
const isText = value => typeof value === 'string' && value.trim() !== '';
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// ---------------------------------------------------------------------------------------------
// A small JavaScript tokenizer: identifiers, punctuators, numbers, strings, template literals and
// regular expressions, with comments and white space dropped. Enough to find requires and literals
// without running the code.

const PUNCTUATORS = ['>>>=', '...', '===', '!==', '**=', '<<=', '>>=', '>>>', '&&=', '||=', '??=', '=>', '==', '!=', '<=', '>=', '&&', '||', '??', '?.', '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '**', '<<', '>>'];

function tokenize(src) {
  const tokens = [];
  let i = 0;
  const regexAllowed = () => {
    const prev = tokens[tokens.length - 1];
    if (!prev) return true;
    if (prev.type === 'punct') return ![')', ']', '}'].includes(prev.value);
    if (prev.type === 'ident') return KEYWORDS_BEFORE_REGEX.has(prev.value);
    return false;
  };
  // Reads a template literal from the opening backtick; `${...}` parts are tokenized in place.
  const template = () => {
    const start = i;
    let value = '';
    let expressions = false;
    i += 1;
    while (i < src.length && src[i] !== '`') {
      if (src[i] === '\\') { value += src.slice(i, i + 2); i += 2; continue; }
      if (src[i] === '$' && src[i + 1] === '{') {
        expressions = true;
        i += 2;
        let depth = 0;
        while (i < src.length) {
          const before = tokens.length;
          if (step(true)) {
            const last = tokens[tokens.length - 1];
            if (tokens.length > before && last.type === 'punct' && last.value === '{') depth += 1;
            if (tokens.length > before && last.type === 'punct' && last.value === '}') {
              if (depth === 0) { tokens.pop(); break; }
              depth -= 1;
            }
          }
        }
        continue;
      }
      value += src[i];
      i += 1;
    }
    i += 1;
    tokens.push({ type: 'template', value, expressions, at: start });
  };
  const quoted = quote => {
    const start = i;
    let value = '';
    i += 1;
    while (i < src.length && src[i] !== quote && src[i] !== '\n') {
      if (src[i] === '\\') {
        const next = src[i + 1];
        value += next === 'n' ? '\n' : next === 't' ? '\t' : next;
        i += 2;
        continue;
      }
      value += src[i];
      i += 1;
    }
    i += 1;
    tokens.push({ type: 'string', value, at: start });
  };
  const regex = () => {
    const start = i;
    let source = '';
    let inClass = false;
    i += 1;
    while (i < src.length && src[i] !== '\n') {
      const c = src[i];
      if (c === '\\') { source += src.slice(i, i + 2); i += 2; continue; }
      if (c === '[') inClass = true;
      else if (c === ']') inClass = false;
      else if (c === '/' && !inClass) break;
      source += c;
      i += 1;
    }
    i += 1;
    while (i < src.length && /[a-z]/i.test(src[i])) i += 1;
    tokens.push({ type: 'regex', value: source, at: start });
  };
  // One step: skip space or a comment, or read one token. Returns true when a token was read.
  function step() {
    const c = src[i];
    if (/\s/.test(c)) { i += 1; return false; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i += 1; return false; }
    if (c === '/' && src[i + 1] === '*') { const end = src.indexOf('*/', i + 2); i = end < 0 ? src.length : end + 2; return false; }
    if (c === '#' && src[i + 1] === '!' && i === 0) { while (i < src.length && src[i] !== '\n') i += 1; return false; }
    if (c === '"' || c === "'") { quoted(c); return true; }
    if (c === '`') { template(); return true; }
    if (c === '/' && regexAllowed()) { regex(); return true; }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[\w$]/.test(src[j])) j += 1;
      tokens.push({ type: 'ident', value: src.slice(i, j), at: i });
      i = j;
      return true;
    }
    if (/[0-9]/.test(c)) {
      let j = i + 1;
      while (j < src.length && /[\w.]/.test(src[j])) j += 1;
      tokens.push({ type: 'number', value: src.slice(i, j), at: i });
      i = j;
      return true;
    }
    const punct = PUNCTUATORS.find(p => src.startsWith(p, i)) || c;
    tokens.push({ type: 'punct', value: punct, at: i });
    i += punct.length;
    return true;
  }
  while (i < src.length) step();
  return tokens;
}

// ---------------------------------------------------------------------------------------------
// The static require graph. A require argument may be a string, `__dirname`, a `const` bound in the
// same file to such a value, or path.join / path.resolve (or bare join / resolve) of those.

function constBindings(tokens) {
  const bindings = new Map();
  for (let k = 0; k + 3 < tokens.length; k += 1) {
    if (tokens[k].type === 'ident' && tokens[k].value === 'const' && tokens[k + 1].type === 'ident' && tokens[k + 2].value === '=') {
      if (!bindings.has(tokens[k + 1].value)) bindings.set(tokens[k + 1].value, k + 3);
    }
  }
  return bindings;
}

// Evaluates a path expression starting at tokens[k]; returns { value, end } or null.
function evaluate(tokens, k, context, depth = 0) {
  if (depth > 8) return null;
  const token = tokens[k];
  if (!token) return null;
  if (token.type === 'string' || (token.type === 'template' && !token.expressions)) return { value: token.value, end: k + 1 };
  if (token.type !== 'ident') return null;
  let name = token.value;
  let next = k + 1;
  if (name === 'path' && tokens[next]?.value === '.' && tokens[next + 1]?.type === 'ident') { name = tokens[next + 1].value; next += 2; }
  else if (name === '__dirname' && tokens[next]?.value !== '(') return { value: context.dir, end: next };
  if ((name === 'join' || name === 'resolve') && tokens[next]?.value === '(') {
    const parts = [];
    let at = next + 1;
    while (tokens[at] && tokens[at].value !== ')') {
      const part = evaluate(tokens, at, context, depth + 1);
      if (!part) return null;
      parts.push(part.value);
      at = part.end;
      if (tokens[at]?.value === ',') at += 1;
      else if (tokens[at]?.value !== ')') return null;
    }
    if (!tokens[at]) return null;
    return { value: name === 'join' ? path.join(...parts) : path.resolve(...parts), end: at + 1 };
  }
  if (next === k + 1 && context.bindings.has(name)) {
    const bound = evaluate(tokens, context.bindings.get(name), context, depth + 1);
    return bound ? { value: bound.value, end: next } : null;
  }
  return null;
}

function resolveFile(candidate) {
  const tries = [candidate, ...SCRIPT_EXTENSIONS.map(ext => candidate + ext)];
  return tries.find(file => fs.existsSync(file) && fs.statSync(file).isFile()) || null;
}

// The repository files a script requires, and the requires it could not resolve.
function requiresOf(root, rel, source = fs.readFileSync(path.join(root, rel), 'utf8')) {
  const tokens = tokenize(source);
  const context = { dir: path.dirname(path.join(root, rel)), bindings: constBindings(tokens) };
  const loads = new Set();
  const unresolved = [];
  for (let k = 0; k + 1 < tokens.length; k += 1) {
    const token = tokens[k];
    if (token.type !== 'ident' || token.value !== 'require' || tokens[k + 1].value !== '(') continue;
    if (tokens[k - 1]?.value === '.' || tokens[k - 1]?.value === 'function') continue;
    const argument = evaluate(tokens, k + 2, context);
    if (!argument || tokens[argument.end]?.value !== ')') {
      unresolved.push(`require(${tokens.slice(k + 2, k + 8).map(t => t.value).join('')}...)`);
      continue;
    }
    const spec = argument.value;
    const local = path.isAbsolute(spec) || spec.startsWith('./') || spec.startsWith('../');
    if (!local) continue;
    const file = resolveFile(path.isAbsolute(spec) ? spec : path.resolve(context.dir, spec));
    if (!file) { unresolved.push(`require('${spec}') finds no file`); continue; }
    const target = posix(path.relative(root, file));
    if (target.startsWith('../') || path.isAbsolute(target)) { unresolved.push(`require('${spec}') leaves the repository`); continue; }
    if (SCRIPT_EXTENSIONS.includes(path.extname(target))) loads.add(target);
  }
  return { loads: [...loads].sort(), unresolved };
}

// Every repository script reachable from the entries, with what each loads. A boundary (`boundaries`)
// is a whole subsystem with its own reason, such as the updater; its requires are not followed.
// A declared dynamic require (`dynamic_requires`) adds the files it names as edges.
function graph(root, entries, stops = new Set(), dynamic = new Map()) {
  const nodes = new Map();
  const queue = [...entries];
  while (queue.length) {
    const rel = queue.shift();
    if (nodes.has(rel)) continue;
    const node = !fs.existsSync(path.join(root, rel)) ? { loads: [], unresolved: ['the file is missing'] }
      : stops.has(rel) ? { loads: [], unresolved: [] } : requiresOf(root, rel);
    const declared = dynamic.get(rel);
    if (declared && Array.isArray(declared.loads)) node.loads = [...new Set([...node.loads, ...declared.loads])];
    nodes.set(rel, node);
    queue.push(...node.loads.filter(next => !nodes.has(next)));
  }
  return nodes;
}

// ---------------------------------------------------------------------------------------------
// Vocabulary: the harness facts a policy or library module must not hold.

// Returns a map of each term found to the first line it is on. Terms: a tool name as a whole string
// literal or a whole regular-expression alternative; an environment name read as a member (process.env.CLAUDE_X)
// or as a string (a constant that only starts with the prefix is not one); a hook output field; and
// a comparison with, or `case` of, a harness name (`=== 'codex'`).
function vocabularyOf(source, vocabulary) {
  const tokens = tokenize(source);
  const tools = new Set(vocabulary.tool_names);
  const fields = new Set(vocabulary.output_fields);
  const harnesses = new Set(vocabulary.harness_names);
  const env = new RegExp(`^(?:${vocabulary.env_prefixes.map(p => p.replace(/[^A-Z0-9_]/g, '')).join('|')})[A-Z0-9_]*$`);
  const found = new Map();
  const add = (term, token) => { if (!found.has(term)) found.set(term, source.slice(0, token.at).split('\n').length); };
  tokens.forEach((token, k) => {
    const literal = token.type === 'string' || (token.type === 'template' && !token.expressions);
    if (literal && tools.has(token.value)) add(token.value, token);
    if (token.type === 'regex') for (const match of token.value.matchAll(REGEX_ITEM)) if (tools.has(match[1])) add(match[1], token);
    if (((token.type === 'ident' && tokens[k - 1]?.value === '.') || literal) && env.test(token.value)) add(token.value, token);
    if ((token.type === 'ident' || literal) && fields.has(token.value)) add(token.value, token);
    if (literal && harnesses.has(token.value) && (EQUALITY.has(tokens[k + 1]?.value) || EQUALITY.has(tokens[k - 1]?.value) || tokens[k - 1]?.value === 'case')) add(`=== '${token.value}'`, token);
  });
  return new Map([...found].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

// ---------------------------------------------------------------------------------------------
// hooks.json reading.

function hookEntries(root, rel) {
  const errors = [];
  const entries = [];
  let parsed;
  try { parsed = JSON.parse(fs.readFileSync(path.join(root, rel), 'utf8')); }
  catch (error) { return { errors: [`${rel} is not readable JSON (${error.message})`], entries }; }
  if (!isRecord(parsed?.hooks)) return { errors: [`${rel} has no "hooks" object`], entries };
  for (const [event, groups] of Object.entries(parsed.hooks)) {
    for (const group of Array.isArray(groups) ? groups : []) {
      for (const hook of Array.isArray(group?.hooks) ? group.hooks : []) {
        const command = String(hook?.command ?? '');
        const match = /^node\s+"\$\{[A-Z_]+\}\/((?:repo|skills)\/[^"\s]+)"(?:\s|$)/.exec(command);
        if (!match) { errors.push(`${rel} ${event}: "${command}" is not a node script in the repository, so it has no scope row`); continue; }
        entries.push({ event, script: match[1], file: rel });
      }
    }
  }
  return { errors, entries };
}

function trackedHookFiles(root) {
  const result = spawnSync('git', ['ls-files', '--', '*hooks.json', '**/hooks.json'], { cwd: root, encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) return null;
  return [...new Set(result.stdout.split('\n').map(line => line.trim()).filter(line => /(^|\/)hooks\.json$/.test(line)))].sort();
}

// ---------------------------------------------------------------------------------------------
// The scope file.

function readScope(text) {
  const scope = JSON.parse(text);
  const errors = [];
  if (scope?.schema !== SCHEMA) errors.push(`${SCOPE} schema is not ${SCHEMA}`);
  for (const key of ['hard_rules', 'hooks', 'modules', 'known_open']) if (!Array.isArray(scope?.[key])) errors.push(`${SCOPE} needs a "${key}" list`);
  if (!isRecord(scope?.hook_files)) errors.push(`${SCOPE} needs "hook_files": { harness: [hooks.json paths] }`);
  const v = scope?.vocabulary;
  if (!isRecord(v) || !['tool_names', 'env_prefixes', 'output_fields', 'harness_names'].every(key => Array.isArray(v[key]))) errors.push(`${SCOPE} needs "vocabulary" with tool_names, env_prefixes, output_fields and harness_names lists`);
  for (const key of ['dynamic_requires', 'boundaries']) if (!Array.isArray(scope?.[key] ?? [])) errors.push(`${SCOPE} "${key}" is a list`);
  return { scope, errors };
}

// Module rows name one file (`path`) or several sharing one reason (`paths`).
function moduleRows(scope) {
  return scope.modules.flatMap(row => (Array.isArray(row?.paths) ? row.paths : [row?.path]).map(rel => ({ rel, row })));
}

function inventory(root, scope) {
  const errors = [];
  const harnesses = Object.keys(scope.hook_files);
  const entriesByHarness = new Map(harnesses.map(h => [h, []]));
  for (const [harness, files] of Object.entries(scope.hook_files)) {
    for (const rel of files) {
      if (!fs.existsSync(path.join(root, rel))) { errors.push(`${SCOPE} lists ${rel} under ${harness}, but it is missing`); continue; }
      const read = hookEntries(root, rel);
      errors.push(...read.errors);
      entriesByHarness.get(harness).push(...read.entries.map(entry => ({ ...entry, harness })));
    }
  }
  const scripts = new Map(harnesses.map(h => [h, [...new Set(entriesByHarness.get(h).map(e => e.script))].sort()]));
  const stops = new Set((scope.boundaries || []).filter(b => isText(b?.path)).map(b => b.path));
  const dynamic = new Map((scope.dynamic_requires || []).filter(d => isText(d?.file)).map(d => [d.file, d]));
  const graphs = new Map(harnesses.map(h => [h, graph(root, scripts.get(h), stops, dynamic)]));
  const reach = new Map();
  for (const [harness, nodes] of graphs) for (const rel of nodes.keys()) reach.set(rel, [...(reach.get(rel) || []), harness]);
  return { errors, harnesses, entriesByHarness, scripts, graphs, reach };
}

// ---------------------------------------------------------------------------------------------
// The check.

function check(root, { baseScope = null, trackedFiles } = {}) {
  let parsed;
  try { parsed = readScope(fs.readFileSync(path.join(root, SCOPE), 'utf8')); }
  catch (error) { return { errors: [`${SCOPE} is not readable JSON (${error.message})`], notes: [] }; }
  const { scope } = parsed;
  if (parsed.errors.length) return { errors: parsed.errors, notes: [] };
  const errors = [];
  const notes = [];
  const hardRules = new Set();
  for (const rule of scope.hard_rules) {
    if (!isText(rule?.id) || !isText(rule?.rule)) errors.push('every hard rule needs an id and a one-line rule');
    else if (hardRules.has(rule.id)) errors.push(`hard rule ${rule.id} is listed twice`);
    else hardRules.add(rule.id);
  }

  // Every tracked hooks.json belongs to one listed harness.
  const listed = Object.values(scope.hook_files).flat();
  const tracked = trackedFiles ?? trackedHookFiles(root);
  if (!tracked) errors.push('could not list the tracked hooks.json files (git ls-files failed)');
  else for (const rel of tracked) if (!listed.includes(rel)) errors.push(`${rel} is a hooks.json no harness in ${SCOPE} lists: add it under its harness in "hook_files"`);

  const inv = inventory(root, scope);
  errors.push(...inv.errors);
  const open = new Map();
  const found = new Map();
  const finding = (id, message, terms) => { found.set(id, { message, terms }); };

  // Hook rows: one per harness and script.
  const rowKey = (harness, script) => `${harness} ${script}`;
  const rows = new Map();
  for (const row of scope.hooks) {
    if (!isText(row?.harness) || !isText(row?.script) || !isRecord(row?.events)) { errors.push('every hook row needs harness, script and events'); continue; }
    const key = rowKey(row.harness, row.script);
    if (rows.has(key)) errors.push(`hook row ${key} is listed twice`);
    rows.set(key, row);
    if (!inv.harnesses.includes(row.harness)) errors.push(`hook row ${row.script} names harness ${row.harness}, which has no hook_files`);
    if (row.rules === 'harness-only') {
      if (!isText(row.reason)) errors.push(`hook row ${key} is harness-only, so it needs a reason`);
    } else if (!Array.isArray(row.rules) || !row.rules.length) {
      errors.push(`hook row ${key} needs "rules": hard-rule ids, or "harness-only" with a reason`);
    } else {
      for (const id of row.rules) if (!hardRules.has(id)) errors.push(`hook row ${key} names hard rule ${id}, which is not on the closed list`);
    }
    for (const [event, why] of Object.entries(row.events)) if (!isText(why)) errors.push(`hook row ${key} lists ${event} with no why_event line`);
  }
  for (const [harness, entries] of inv.entriesByHarness) {
    for (const entry of entries) {
      const row = rows.get(rowKey(harness, entry.script));
      if (!row) { errors.push(`${entry.file} runs ${entry.script} on ${entry.event}, but ${SCOPE} has no ${harness} row for it`); continue; }
      if (!Object.hasOwn(row.events, entry.event)) errors.push(`${entry.file} runs ${entry.script} on ${entry.event}, an event its ${harness} row does not list and justify`);
    }
  }
  for (const [key, row] of rows) {
    const runs = (inv.entriesByHarness.get(row.harness) || []).filter(e => e.script === row.script);
    if (!runs.length) { errors.push(`hook row ${key} names a script no ${row.harness} hooks.json runs: remove the row`); continue; }
    for (const event of Object.keys(row.events)) if (!runs.some(e => e.event === event)) errors.push(`hook row ${key} lists ${event}, but no ${row.harness} hooks.json runs it there: remove the event`);
  }

  // One script, one harness: run by two hooks.json files, or one harness's hook loaded by another's entry.
  const entryHarness = new Map();
  for (const [harness, scripts] of inv.scripts) for (const script of scripts) entryHarness.set(script, [...(entryHarness.get(script) || []), harness]);
  for (const [script, harnesses] of entryHarness) {
    const loadedBy = (inv.reach.get(script) || []).filter(h => !harnesses.includes(h));
    if (harnesses.length > 1) finding(`two-harnesses:${script}`, `${script} runs from the ${harnesses.join(' and ')} hooks.json files; give each harness its own entry`);
    else if (loadedBy.length) finding(`two-harnesses:${script}`, `${script} is a ${harnesses[0]} hook entry that the ${loadedBy.join(' and ')} entries also load; move what they share into a policy or library module`);
  }

  // Unresolvable requires fail closed for anything a hook loads, unless declared with what they load.
  const unresolved = new Map();
  for (const nodes of inv.graphs.values()) for (const [rel, node] of nodes) if (node.unresolved.length) unresolved.set(rel, node.unresolved);
  const declared = new Map();
  for (const item of scope.dynamic_requires || []) {
    if (!isText(item?.file) || !Number.isInteger(item?.count) || !Array.isArray(item?.loads) || !isText(item?.reason)) { errors.push('every dynamic_requires item needs file, count, loads and reason'); continue; }
    declared.set(item.file, item);
    for (const load of item.loads) if (!isText(load) || !fs.existsSync(path.join(root, load))) errors.push(`dynamic_requires ${item.file} loads ${load}, which is missing`);
    const actual = unresolved.get(item.file)?.length ?? 0;
    if (actual !== item.count) errors.push(`dynamic_requires ${item.file} declares ${item.count} require(s) the check cannot follow, but it has ${actual}: ${actual ? 'declare each one' : 'remove the item'}`);
  }
  for (const item of scope.boundaries || []) {
    if (!isText(item?.path) || !isText(item?.reason)) errors.push('every boundary needs a path and a reason');
    else if (!inv.reach.has(item.path)) errors.push(`boundary ${item.path} is a file no hook loads: remove it`);
  }
  for (const [rel, items] of unresolved) if (!declared.has(rel)) for (const item of items) errors.push(`${rel}: ${item} cannot be followed, so the hook graph is unknown; use a literal path or path.join(__dirname, ...), or declare it in dynamic_requires`);

  // Modules two harnesses load need a policy or library row; those rows hold no harness vocabulary.
  const modules = new Map();
  for (const { rel, row } of moduleRows(scope)) {
    if (!isText(rel) || !MODULE_KINDS.includes(row?.kind)) { errors.push(`every module row needs a path (or paths) and a kind (${MODULE_KINDS.join(' or ')})`); continue; }
    if (modules.has(rel)) errors.push(`module row ${rel} is listed twice`);
    modules.set(rel, row);
    if (row.kind === 'policy') {
      if (!Array.isArray(row.rules) || !row.rules.length) errors.push(`policy module ${rel} needs the hard-rule ids it holds`);
      else for (const id of row.rules) if (!hardRules.has(id)) errors.push(`policy module ${rel} names hard rule ${id}, which is not on the closed list`);
    }
    if (!isText(row.reason)) errors.push(`module row ${rel} needs a reason`);
    if (row.not_vocabulary !== undefined && !isText(row.path)) errors.push(`module row ${rel}: not_vocabulary needs a one-file row (path)`);
    if (!inv.reach.has(rel)) errors.push(`module row ${rel} names a file no hook loads: remove the row`);
    if (entryHarness.has(rel)) errors.push(`module row ${rel} names a hook entry; an entry belongs to one harness`);
  }
  for (const [rel, harnesses] of inv.reach) {
    if (harnesses.length < 2 || entryHarness.has(rel) || modules.has(rel)) continue;
    errors.push(`${rel} is loaded by the ${harnesses.join(' and ')} hooks but has no module row: add it as policy (with its hard rules) or library`);
  }
  for (const [rel, row] of modules) {
    if (!fs.existsSync(path.join(root, rel))) { errors.push(`module row ${rel} names a missing file`); continue; }
    const terms = vocabularyOf(fs.readFileSync(path.join(root, rel), 'utf8'), scope.vocabulary);
    // not_vocabulary: a term that is a plain word here, not a harness fact, with the reason.
    for (const [term, why] of Object.entries(isRecord(row.not_vocabulary) ? row.not_vocabulary : {})) {
      if (!isText(why)) errors.push(`module row ${rel}: not_vocabulary ${term} needs a reason`);
      if (!terms.has(term)) errors.push(`module row ${rel}: not_vocabulary ${term} is no longer found: remove it`);
      terms.delete(term);
    }
    if (terms.size) finding(`vocabulary:${rel}`, `${rel} is a shared module holding harness vocabulary (${[...terms].map(([t, line]) => `${t} at line ${line}`).join(', ')}); move it into the harness's entry or dialect`, [...terms.keys()]);
  }

  // known_open: each item is a finding that still exists, with exactly its terms; the list only shrinks.
  for (const item of scope.known_open) {
    if (!isText(item?.id) || !isText(item?.owner) || !/#\d+/.test(item.owner)) { errors.push('every known_open item needs an id and an owner naming the issue that clears it'); continue; }
    if (open.has(item.id)) errors.push(`known_open item ${item.id} is listed twice`);
    open.set(item.id, item);
  }
  for (const [id, item] of open) {
    const now = found.get(id);
    if (!now) { errors.push(`known_open item ${id} is already clean: remove it from the list`); continue; }
    if (now.terms) {
      const listedTerms = Array.isArray(item.terms) ? item.terms : [];
      const gone = listedTerms.filter(term => !now.terms.includes(term));
      const added = now.terms.filter(term => !listedTerms.includes(term));
      if (gone.length) errors.push(`known_open item ${id} lists ${gone.join(', ')}, no longer found: remove ${gone.length > 1 ? 'them' : 'it'} from its terms`);
      if (added.length) errors.push(`${id.slice('vocabulary:'.length)} now holds ${added.join(', ')}, which its known_open item does not list; new harness vocabulary never goes on the list`);
    }
  }
  for (const [id, now] of found) if (!open.has(id)) errors.push(now.message);

  if (baseScope === null) notes.push(`no ${SCOPE} at the base, so the only-shrinks check starts once it lands`);
  else {
    const before = new Map((Array.isArray(baseScope.known_open) ? baseScope.known_open : []).map(item => [item?.id, item]));
    for (const [id, item] of open) {
      const was = before.get(id);
      if (!was) { errors.push(`known_open item ${id} is new since the base: the list only shrinks, so fix the hook instead`); continue; }
      const grew = (Array.isArray(item.terms) ? item.terms : []).filter(term => !(Array.isArray(was.terms) ? was.terms : []).includes(term));
      if (grew.length) errors.push(`known_open item ${id} gained ${grew.join(', ')} since the base: the list only shrinks`);
    }
  }
  return { errors, notes };
}

// The scope file at the base commit, or null when the base has none.
function baseScopeAt(root, environment = process.env) {
  const git = args => spawnSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
  const requested = String(environment.DIFF_BASE || '').trim();
  let base;
  if (requested) {
    const verified = git(['rev-parse', '--verify', '--quiet', `${requested}^{commit}`]);
    if (verified.status !== 0) throw new Error(`the base ${requested} is not a commit in this checkout; fetch full history, or set DIFF_BASE to a commit`);
    base = verified.stdout.trim();
  } else {
    const mergeBase = git(['merge-base', 'HEAD', 'origin/main']);
    if (mergeBase.status !== 0) throw new Error('could not find where HEAD left origin/main; fetch origin/main, or set DIFF_BASE to the commit to compare with');
    base = mergeBase.stdout.trim();
  }
  const shown = git(['show', `${base}:${SCOPE}`]);
  if (shown.status !== 0) return { base, scope: null };
  return { base, scope: JSON.parse(shown.stdout) };
}

function inventoryReport(root) {
  const { scope, errors } = readScope(fs.readFileSync(path.join(root, SCOPE), 'utf8'));
  if (errors.length) throw new Error(errors.join('; '));
  const inv = inventory(root, scope);
  const shared = [...inv.reach].filter(([, h]) => h.length > 1).map(([rel, harnesses]) => ({
    path: rel, harnesses, vocabulary: Object.fromEntries(vocabularyOf(fs.readFileSync(path.join(root, rel), 'utf8'), scope.vocabulary)),
  }));
  return {
    entries: Object.fromEntries([...inv.entriesByHarness].map(([h, list]) => [h, list.map(e => `${e.event} ${e.script}`)])),
    reached: Object.fromEntries([...inv.graphs].map(([h, nodes]) => [h, nodes.size])),
    shared,
    unresolved: [...inv.graphs.values()].flatMap(nodes => [...nodes].filter(([, n]) => n.unresolved.length).map(([rel, n]) => `${rel}: ${n.unresolved.join('; ')}`)),
    errors: inv.errors,
  };
}

function main(argv = process.argv.slice(2)) {
  let root = path.resolve(__dirname, '..', '..');
  let report = false;
  for (let k = 0; k < argv.length; k += 1) {
    if (argv[k] === '--root' && argv[k + 1]) { root = path.resolve(argv[k + 1]); k += 1; }
    else if (argv[k] === '--inventory') report = true;
    else { process.stderr.write(`Unknown argument ${argv[k]}. Usage: check-hook-scope.cjs [--root <dir>] [--inventory]\n`); return 2; }
  }
  if (report) { process.stdout.write(`${JSON.stringify(inventoryReport(root), null, 2)}\n`); return 0; }
  let base;
  try { base = baseScopeAt(root); }
  catch (error) { process.stderr.write(`HOOK SCOPE: ${error.message}\n`); return 2; }
  const { errors, notes } = check(root, { baseScope: base.scope });
  for (const note of notes) process.stdout.write(`Note: ${note}\n`);
  if (!errors.length) { process.stdout.write(`HOOK SCOPE: clear (base ${base.base.slice(0, 12)})\n`); return 0; }
  process.stdout.write(`HOOK SCOPE: ${errors.length} found\n${errors.map(e => `- ${e}`).join('\n')}\n`);
  return 1;
}

if (require.main === module) process.exitCode = main();

module.exports = Object.freeze({ SCOPE, SCHEMA, tokenize, requiresOf, vocabularyOf, readScope, inventory, check, baseScopeAt, main });
