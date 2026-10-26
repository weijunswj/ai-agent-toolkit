'use strict';

// Dependency and security settings for a Toolkit-governed (ENABLED) github.com repository, and the
// guarded auto-merge of Dependabot updates:
//
//   S1 Dependabot alerts on.
//   S2 Dependabot security updates on.
//   S3 .github/dependabot.yml (or .yaml) has a version-update entry for every package ecosystem
//      found in the repository (npm, pip, GitHub Actions, Docker, Go, Cargo, Bundler, Composer).
//   S4 secret scanning and push protection on (public repositories; GitHub bills for them on a
//      private or internal repository, so there they are not applicable and never asked about).
//   S5 CodeQL code scanning on: default setup configured, or an advanced setup in a workflow
//      (public repositories; private as S4).
//   S6 private vulnerability reporting on (public repositories only).
//   S7 auto-merge matches the binding's `dependency_updates.auto_merge`. With "patch-minor": the
//      auto-merge workflow is present and current, the repository allows auto-merge, and
//      default-branch protection (toolkit-governance-protection.cjs) is conformant with at least one
//      required check. With "off" (the default) nothing more is needed: the workflow, if present,
//      does nothing.
//
// Toolkit never asks about, turns on or reports as drift a GitHub feature that needs billing. A
// binding's deprecated `paid_security` key is accepted and ignored when it is "off" or "on"; any
// other value makes the binding invalid.
//
// The policy (dependency_updates) is read from the binding committed on the default branch, through
// GitHub, never from the working tree: an agent can edit a working tree, and only a merged binding is
// the owner's answer. Unreadable counts as unanswered: no auto-merge. The invariant model and closure matrix are in toolkit-governance-security.test.cjs.
//
// S1, S2, S4-S7 ask GitHub through the signed-in `gh` CLI; S3 and the workflow file are read from the
// checkout. `--offline` checks only those files. Nothing here writes, except `applySecurity` (through
// `ghSecurityWriter` and `writeSecurityFiles`), which `toolkit governance security` and `migrate` call
// for an ENABLED repository: the owner's yes to governance covers the free settings, the only ones
// Toolkit writes. Nothing is written when GitHub cannot be read.
// Toolkit never edits a dependabot.yml or workflow it did not write: when one exists and differs, it
// reports what to change by hand.

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { resolvePathExecutable } = require('./claude-process-launch.cjs');
const governance = require('./toolkit-governance-state.cjs');

const GH_TIMEOUT_MS = 15000;
const MAX_OUTPUT = 1024 * 1024;
const MAX_FILE_BYTES = 256 * 1024;
const ROOT = path.resolve(__dirname, '..', '..');
const WORKFLOW_TEMPLATE_REL = 'skills/secure-ci-cd/templates/github-actions/dependency-auto-merge.yml';
const WORKFLOW_REL = '.github/workflows/dependency-auto-merge.yml';
const DEPENDABOT_REL = '.github/dependabot.yml';
// GitHub reads either name; Toolkit writes the first.
const DEPENDABOT_NAMES = Object.freeze([DEPENDABOT_REL, '.github/dependabot.yaml']);
const WORKFLOW_MARKER = '# Toolkit dependency auto-merge v';
// The auto-merge workflow's own action pin moves with Toolkit's template, never through Dependabot,
// so a bump there cannot make the copy differ from the template.
const TEMPLATE_ACTION = 'dependabot/fetch-metadata';
// GitHub refusals that mean "not available here" (plan or organisation policy), not a failure.
const UNAVAILABLE = Object.freeze(['not-on-plan', 'refused-by-policy']);
// Version updates wait this many days after a release (security updates never wait). GitHub
// Actions wait longer: an action runs with the workflow's token, so a bad release costs more.
const COOLDOWN_DAYS = Object.freeze({ default: 3, 'github-actions': 7 });

// Manifest file names per Dependabot ecosystem. GitHub Actions is found from .github/workflows.
const ECOSYSTEM_FILES = Object.freeze({
  npm: ['package.json'],
  pip: ['requirements.txt', 'pyproject.toml', 'Pipfile', 'setup.py'],
  docker: ['Dockerfile'],
  gomod: ['go.mod'],
  cargo: ['Cargo.toml'],
  bundler: ['Gemfile'],
  composer: ['composer.json'],
});
const SKIP_DIRECTORIES = new Set(['node_modules', 'vendor', 'dist', 'build', 'target', 'venv', '__pycache__']);

// ---- files (S3, the workflow) -------------------------------------------------------------------

function isFile(file) {
  try { return fs.statSync(file).isFile(); } catch { return false; }
}

function readSmall(file) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return null;
    return fs.readFileSync(file, 'utf8');
  } catch { return null; }
}

// Map(ecosystem -> sorted Dependabot directories such as "/" or "/webapp"), from the repository
// root and the folders directly inside it (hidden and build folders skipped).
function detectEcosystems(root) {
  const found = new Map();
  const add = (ecosystem, directory) => {
    if (!found.has(ecosystem)) found.set(ecosystem, new Set());
    found.get(ecosystem).add(directory);
  };
  const scan = (folder, directory) => {
    for (const [ecosystem, names] of Object.entries(ECOSYSTEM_FILES)) {
      if (names.some(name => isFile(path.join(folder, name)))) add(ecosystem, directory);
    }
  };
  scan(root, '/');
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { entries = []; }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || SKIP_DIRECTORIES.has(entry.name)) continue;
    scan(path.join(root, entry.name), `/${entry.name}`);
  }
  try {
    if (fs.readdirSync(path.join(root, '.github', 'workflows')).some(name => /\.ya?ml$/i.test(name))) add('github-actions', '/');
  } catch { /* no workflows */ }
  return new Map([...found.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([ecosystem, dirs]) => [ecosystem, [...dirs].sort()]));
}

function unquote(value) {
  const text = String(value).trim();
  if (text.length >= 2 && ((text[0] === '"' && text.at(-1) === '"') || (text[0] === "'" && text.at(-1) === "'"))) return text.slice(1, -1);
  return text;
}

// The dependabot config file present in `root` (relative path), or null.
function dependabotFile(root) {
  return DEPENDABOT_NAMES.find(rel => isFile(path.join(root, ...rel.split('/')))) || null;
}

// Map(ecosystem -> [directories]) from a dependabot.yml or .yaml, or null when it is missing or
// unreadable. It reads the plain block style GitHub's examples use; inline lists are understood too.
function readDependabotConfig(root) {
  const rel = dependabotFile(root);
  const text = rel === null ? null : readSmall(path.join(root, ...rel.split('/')));
  if (text === null) return null;
  const entries = new Map();
  let current = null;
  let inDirectories = false;
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.replace(/\s+#.*$/, '').replace(/\s+$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const ecosystem = /^\s*-?\s*package-ecosystem:\s*(.+)$/.exec(line);
    if (ecosystem) {
      current = unquote(ecosystem[1]);
      if (!entries.has(current)) entries.set(current, []);
      inDirectories = false;
      continue;
    }
    if (!current) continue;
    const directory = /^\s*directory:\s*(.+)$/.exec(line);
    if (directory) { entries.get(current).push(unquote(directory[1])); inDirectories = false; continue; }
    const directories = /^\s*directories:\s*(.*)$/.exec(line);
    if (directories) {
      const inline = directories[1].trim();
      if (inline.startsWith('[')) {
        entries.get(current).push(...inline.slice(1, -1).split(',').map(unquote).filter(Boolean));
        inDirectories = false;
      } else inDirectories = true;
      continue;
    }
    const item = /^\s*-\s+(.+)$/.exec(line);
    if (inDirectories && item && !item[1].includes(':')) { entries.get(current).push(unquote(item[1])); continue; }
    inDirectories = false;
  }
  return entries;
}

function directoryCovered(configured, directory) {
  const normalise = value => (value === '/' ? '/' : `/${String(value).replace(/^\/+|\/+$/g, '')}`);
  return configured.some(pattern => {
    const wanted = normalise(directory);
    const have = normalise(pattern);
    if (have === wanted || have === '/**' || have === '/*') return true;
    if (have.endsWith('/**')) return wanted.startsWith(have.slice(0, -2));
    return false;
  });
}

// [{ ecosystem, directory }] found in the repository but missing from `config`.
function uncoveredEcosystems(detected, config) {
  const missing = [];
  for (const [ecosystem, directories] of detected) {
    const configured = (config && config.get(ecosystem)) || [];
    for (const directory of directories) if (!directoryCovered(configured, directory)) missing.push({ ecosystem, directory });
  }
  return missing;
}

// The dependabot.yml Toolkit writes when a repository has none: weekly version updates for every
// detected ecosystem, a cooldown, and patch and minor updates grouped into one pull request per
// ecosystem (so a group is never a major update); majors arrive one per pull request.
function renderDependabotConfig(detected) {
  const lines = [
    '# Written by Toolkit governance: weekly Dependabot version updates for every package ecosystem',
    '# found in this repository. Security updates are separate, turned on in the repository settings,',
    '# and never wait for the cooldown.',
    'version: 2',
    'updates:',
  ];
  for (const [ecosystem, directories] of detected) {
    lines.push(`  - package-ecosystem: "${ecosystem}"`);
    if (directories.length === 1) lines.push(`    directory: "${directories[0]}"`);
    else lines.push('    directories:', ...directories.map(directory => `      - "${directory}"`));
    lines.push(
      '    schedule:',
      '      interval: "weekly"',
      '    cooldown:',
      `      default-days: ${COOLDOWN_DAYS[ecosystem] || COOLDOWN_DAYS.default}`,
      '    groups:',
      `      ${ecosystem}-patch-and-minor:`,
      '        update-types: ["patch", "minor"]',
    );
    if (ecosystem === 'github-actions') lines.push('    ignore:', `      - dependency-name: "${TEMPLATE_ACTION}"  # pinned by Toolkit's auto-merge template`);
  }
  return `${lines.join('\n')}\n`;
}

function digest(text) {
  return crypto.createHash('sha256').update(String(text).replace(/\r\n/g, '\n')).digest('hex');
}

function workflowTemplate(toolkitRoot = ROOT) {
  return fs.readFileSync(path.join(toolkitRoot, ...WORKFLOW_TEMPLATE_REL.split('/')), 'utf8');
}

// 'current' | 'outdated' (Toolkit's, older) | 'foreign' (someone else's file at that path) | 'missing'.
function workflowState(root, toolkitRoot = ROOT) {
  const text = readSmall(path.join(root, ...WORKFLOW_REL.split('/')));
  if (text === null) return 'missing';
  let template;
  try { template = workflowTemplate(toolkitRoot); } catch { return 'foreign'; }
  if (digest(text) === digest(template)) return 'current';
  return text.startsWith(WORKFLOW_MARKER) ? 'outdated' : 'foreign';
}

// Workflow `text` as [{ indent, text }] lines a reader can match safely: no byte order mark, no blank
// or comment lines, no trailing comments, and no lines inside a block scalar (a `run: |` script).
function workflowLines(text) {
  const lines = [];
  let scalarIndent = -1;
  for (const raw of String(text).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n')) {
    const indent = raw.length - raw.trimStart().length;
    if (scalarIndent >= 0) {
      if (!raw.trim() || indent > scalarIndent) continue;
      scalarIndent = -1;
    }
    let body = raw.trim();
    if (!body || body.startsWith('#')) continue;
    let quote = null;
    for (let index = 0; index < body.length; index += 1) {
      const char = body[index];
      if (quote) { if (char === quote) quote = null; continue; }
      if (char === '"' || char === "'") quote = char;
      else if (char === '#' && /\s/.test(body[index - 1] || '')) { body = body.slice(0, index).trimEnd(); break; }
    }
    lines.push({ indent, text: body });
    // A block scalar header (`|`, `>-`, `|2-` ...), also on a `- ` list line, whose script lines are
    // indented past the key.
    if (/:\s*[|>](?:[+-]?\d?|\d[+-])$/.test(body)) scalarIndent = indent + /^(?:-\s+)*/.exec(body)[0].length;
  }
  return lines;
}

// The child lines of the top-level `key:` and its inline value: { inline, children } or null. The
// document may itself be indented.
function topLevel(lines, key) {
  const base = (lines.find(line => line.text !== '---' && !line.text.startsWith('--- ')) || { indent: 0 }).indent;
  const start = lines.findIndex(line => line.indent === base && new RegExp(`^(?:${key}|"${key}"|'${key}'):(?:\\s|$)`).test(line.text));
  if (start < 0) return null;
  // A flow value's closing bracket may sit at the key's own column.
  const end = lines.findIndex((line, index) => index > start && line.indent <= base && !/^[\]}]/.test(line.text));
  return { inline: lines[start].text.replace(/^[^:]+:\s*/, ''), children: lines.slice(start + 1, end < 0 ? lines.length : end) };
}

const CODEQL_EVENTS = Object.freeze(['push', 'pull_request', 'pull_request_target', 'merge_group', 'schedule', 'workflow_call']);
const FALSE_IF = /^(?:-\s+)?if:\s*(?:false|\$\{\{\s*false\s*\}\})$/;

// A CodeQL analysis older than this no longer shows an advanced setup in use.
const ANALYSIS_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;

// YAML this reader does not model: anchors and aliases, tags, complex and merge keys. Any of it
// in a file means a "no" cannot be proved there.
function outsideSubset(lines) {
  return lines.some(({ text }) => /(?:^|[\s[{,])[&*][A-Za-z0-9_-]/.test(text)
    || /(?:^|:\s+|-\s+|(?<![{$])[[{,]\s*)!/.test(text)
    || /^(?:-\s+)?\?(?:\s|$)/.test(text)
    || /^(?:-\s+)?<<\s*:/.test(text));
}

// The names in a flow collection's text (`[a, b]` or `{a: x, b: {}}`), or null when an entry is
// not a plain name (a key with no value, an anchor, a tag, a quoted escape).
function flowNames(value) {
  const map = value.startsWith('{');
  if (!/^[[{]/.test(value) || !value.endsWith(map ? '}' : ']')) return null;
  let inner = value.slice(1, -1);
  for (let before = ''; before !== inner;) { before = inner; inner = inner.replace(/\{[^{}]*\}|\[[^[\]]*\]/g, ''); }
  const entries = inner.split(',').map(entry => entry.trim()).filter(Boolean);
  const plain = map ? /^["']?([a-z_]+)["']?\s*:/ : /^["']?([a-z_]+)["']?$/;
  const names = entries.map(entry => (plain.exec(entry) || [])[1]);
  return names.length && names.every(Boolean) ? names : null;
}

// The `on:` triggers as plain names, or null when any entry cannot be read as one.
function triggerNames(on) {
  if (on.inline) {
    let value = on.inline.trim();
    if (/^[[{]/.test(value)) {
      // A flow value may run over several lines.
      if (on.children.length) value = [value, ...on.children.map(line => line.text)].join(' ');
      return flowNames(value);
    }
    if (on.children.length) return null;
    const name = /^["']?([a-z_]+)["']?$/.exec(value);
    return name ? [name[1]] : null;
  }
  if (!on.children.length) return null;
  const indent = on.children[0].indent;
  const entries = on.children.filter(line => line.indent === indent);
  const names = entries.map(line => (/^(?:-\s+)?["']?([a-z_]+)["']?\s*(?::(?:\s|$)|$)/.exec(line.text) || [])[1]);
  return names.every(Boolean) ? names : null;
}

// The steps of a job block: [{ indent, items: [{ indent, text }] }], where `indent` is the column
// of the step's own keys, or { flow: [text] } for flow-style steps. Only the `steps:` list counts.
function jobSteps(block, keyIndent) {
  const steps = [];
  for (let index = 0; index < block.length; index += 1) {
    const line = block[index];
    if (line.indent !== keyIndent || line.text.startsWith('-')) continue;
    const flow = /^steps:\s*(\[.*)$/.exec(line.text);
    if (flow) {
      const value = flow[1];
      if (!value.endsWith(']')) return null;
      return { flow: value.slice(1, -1).split(/\}\s*,\s*\{/).map(item => item.replace(/^\s*\{?|\}?\s*$/g, '')) };
    }
    if (!/^steps:\s*$/.test(line.text)) continue;
    const first = block[index + 1];
    if (!first || !/^-(?:\s|$)/.test(first.text)) return null;
    const listIndent = first.indent;
    for (let at = index + 1; at < block.length; at += 1) {
      const item = block[at];
      if (item.indent < listIndent || (item.indent === listIndent && !/^-(?:\s|$)/.test(item.text))) break;
      if (item.indent === listIndent) {
        const prefix = /^-\s*/.exec(item.text)[0];
        const rest = item.text.slice(prefix.length);
        const next = block[at + 1];
        const indent = rest ? listIndent + prefix.length : (next && next.indent > listIndent ? next.indent : listIndent + 2);
        steps.push({ indent, items: rest ? [{ indent, text: rest }] : [] });
      } else steps[steps.length - 1].items.push(item);
    }
    return { list: steps };
  }
  return { list: [] };
}

// Whether workflow `text` provably names no CodeQL step but upload-sarif (another scanner's results).
// This is a plain text search, so no YAML shape can hide a step from it: the text is searched raw and
// decoded (escaped line breaks joined, every \x, \u and \U escape decoded, every other backslash
// dropped), comments included, and every `codeql` in either copy must belong to
// `github/codeql-action/upload-sarif@` with nothing before `github/` that could make it another
// action's path. A quoted value that YAML decodes to a CodeQL action path, with no backslash left in
// it, spells `codeql` in the decoded copy. Text that may not decode as written (a NUL, a decoding
// error, a line break other than LF or CRLF, a %TAG directive, a verbatim tag, a `!!` or named tag
// with a % escape, a binary tag) is never ruled out.
function codeqlRuledOut(text) {
  const raw = String(text);
  // A line break other than LF or CRLF (a lone CR, NEL, LS, PS) could hide an escaped line break.
  if (/[\u0000\uFFFD\u0085\u2028\u2029]|\r(?!\n)/.test(raw) || /^\uFEFF?[ \t]*%TAG\b/m.test(raw)
    || /!!binary|tag:yaml\.org,2002:binary|!<|![\w-]*!\S*%/i.test(raw)) return false;
  const decoded = raw.replace(/\\\r?\n[ \t]*/g, '')
    .replace(/\\x([0-9A-Fa-f]{2})|\\u([0-9A-Fa-f]{4})|\\U([0-9A-Fa-f]{8})/g, (all, a, b, c) => {
      try { return String.fromCodePoint(parseInt(a || b || c, 16)); } catch { return ''; }
    })
    .replace(/\\/g, '');
  const safe = 'github/codeql-action/upload-sarif@';
  return [raw, decoded].every(copy => {
    const lower = copy.toLowerCase();
    for (let at = lower.indexOf('codeql'); at >= 0; at = lower.indexOf('codeql', at + 1)) {
      if (at < 7 || lower.slice(at - 7, at - 7 + safe.length) !== safe || /[\w./-]/.test(lower[at - 8] || '')) return false;
    }
    return true;
  });
}

// Whether workflow `text` runs CodeQL itself (an advanced setup). GitHub refuses an advanced setup's
// results once default setup is on, so default setup is never turned on over one. "No" rests only on
// `codeqlRuledOut`, which reads every byte; the YAML reader below only finds a live CodeQL job, and
// whatever it cannot show live is 'unsure', which the caller treats as unreadable, so default setup
// stays off. Returns:
//   true      `on:` names push, pull_request, pull_request_target, merge_group, schedule or
//             workflow_call (a reusable workflow runs when it is called), and one job that is not
//             switched off with `if: false` has codeql-action init and analyze steps that are not
//             switched off either;
//   false     the file names no CodeQL step but upload-sarif;
//   'unsure'  anything else.
function runsCodeql(text) {
  if (codeqlRuledOut(text)) return false;
  const lines = workflowLines(text);
  if (outsideSubset(lines)) return 'unsure';
  const on = topLevel(lines, 'on');
  if (!on) return 'unsure';
  const events = triggerNames(on);
  if (!events) return 'unsure';
  if (!events.some(event => CODEQL_EVENTS.includes(event))) return 'unsure';
  const jobs = topLevel(lines, 'jobs');
  if (!jobs || !jobs.children.length) return 'unsure';
  const jobIndent = jobs.children[0].indent;
  const blocks = [];
  for (const line of jobs.children) {
    if (line.indent === jobIndent) blocks.push([]);
    else if (blocks.length) blocks[blocks.length - 1].push(line);
  }
  // A step's own `uses:` key, or a key of a flow-style step.
  const uses = action => new RegExp(`(?:^|,)\\s*["']?uses["']?\\s*:\\s*['"]?github\\/codeql-action\\/${action}@`, 'i');
  const off = /(?:^|,)\s*["']?if["']?\s*:\s*(?:false|\$\{\{\s*false\s*\}\})\s*(?:,|$)/;
  let live = false;
  for (const block of blocks) {
    if (!block.length) continue;
    const keyIndent = block[0].indent;
    const jobOff = block.some(line => line.indent === keyIndent && !line.text.startsWith('-') && FALSE_IF.test(line.text));
    const found = jobSteps(block, keyIndent);
    if (!found) return 'unsure';
    // Each step as its own keys: lines at its key column, or a flow step without nested groups.
    const steps = found.flow
      ? found.flow.map(item => {
        let flat = item.replace(/\$\{\{[^}]*\}\}/g, expr => (/^\$\{\{\s*false\s*\}\}$/.test(expr) ? 'false' : 'expr'));
        for (let before = ''; before !== flat;) { before = flat; flat = flat.replace(/\{[^{}]*\}|\[[^[\]]*\]/g, ''); }
        return [flat];
      })
      : found.list.map(step => step.items.filter(item => item.indent === step.indent).map(item => item.text));
    if (jobOff) continue;
    const enabled = steps.filter(keys => !keys.some(key => off.test(key)));
    if (['init', 'analyze'].every(action => enabled.some(keys => keys.some(key => uses(action).test(key))))) live = true;
  }
  return live ? true : 'unsure';
}

// The binding's policy as committed on the default branch: { policy, required_checks, source } where
// source is 'default-branch', 'not-merged' (no binding there yet), 'invalid' or 'unreadable'.
// Anything but 'default-branch' has the safe defaults: no auto-merge, Actions kept for the owner, no
// required checks.
function committedPolicy(read, identity) {
  const binding = read && read.ok === true && read.binding ? read.binding : { status: 'unreadable' };
  if (binding.status === 'ok') {
    const parsed = governance.committedBindingPolicy(binding.text, identity);
    return { policy: parsed.policy, required_checks: parsed.required_checks, source: parsed.valid ? 'default-branch' : 'invalid' };
  }
  return { policy: governance.committedBindingPolicy('null', identity).policy, required_checks: null, source: binding.status === 'missing' ? 'not-merged' : 'unreadable' };
}

// ---- GitHub settings (S1, S2, S4-S7) ------------------------------------------------------------

function ghRun(args, spawn, input = null) {
  let result;
  try {
    result = spawn(resolvePathExecutable('gh'), ['api', ...args], {
      encoding: 'utf8', timeout: GH_TIMEOUT_MS, maxBuffer: MAX_OUTPUT, windowsHide: true, shell: false,
      ...(input === null ? {} : { input }),
    });
  } catch {
    return { ok: false, reason: 'gh-unavailable' };
  }
  if (!result || result.error) return { ok: false, reason: 'gh-unavailable' };
  if (result.status !== 0) {
    const text = String(result.stderr || '') + String(result.stdout || '');
    // A ref GitHub cannot resolve is not "no such file".
    if (/HTTP 404/.test(text)) return { ok: false, reason: /no commit found/i.test(text) ? 'ref-not-found' : /no analysis found/i.test(text) ? 'no-analysis' : 'not-found' };
    if (/HTTP 40[39]|HTTP 422/.test(text)) {
      if (/SAML|OAuth App access restrictions|rate limit/i.test(text)) return { ok: false, reason: /HTTP 403/.test(text) ? 'forbidden' : 'gh-request-failed' };
      if (/advanced security must be enabled|code scanning is not enabled|code security|secret protection|not available (?:on|for) (?:this|your) (?:plan|repository)|upgrade your plan|requires GitHub (?:Team|Enterprise)/i.test(text)) return { ok: false, reason: 'not-on-plan' };
      if (/(?:disabled|prohibited|not allowed|blocked) by (?:your |the )?(?:organi[sz]ation|enterprise)|(?:organi[sz]ation|enterprise) policy/i.test(text)) return { ok: false, reason: 'refused-by-policy' };
      return { ok: false, reason: /HTTP 403/.test(text) ? 'forbidden' : 'gh-request-failed' };
    }
    return { ok: false, reason: 'gh-request-failed' };
  }
  const stdout = String(result.stdout || '').trim();
  if (!stdout) return { ok: true, value: null };
  try { return { ok: true, value: JSON.parse(stdout) }; } catch { return { ok: false, reason: 'gh-output-invalid' }; }
}

function statusOf(section) {
  return section && typeof section.status === 'string' ? section.status : null;
}

// What GitHub says about `slug`: { ok, visibility, allow_auto_merge, alerts, security_updates,
// secret_scanning, push_protection, code_scanning, private_reporting, binding } where each setting
// is 'enabled' | 'disabled' | 'not-on-plan' | 'unreadable', `binding` is the programme
// binding on the default branch ({ status: 'ok', text } | { status: 'missing' } |
// { status: 'unreadable' }), and `advanced_codeql` names a default-branch workflow that runs CodeQL
// itself (null for none, 'unreadable'; read only when default setup is off; `codeql_uploads` names a
// recent CodeQL analysis that did not come from default setup and `codeql_unplaced` a workflow whose
// CodeQL steps could not be placed, both of which read unreadable); or { ok: false, reason }.
// Without admin rights GitHub hides these settings, so they read unreadable.
function ghSecurityReader(slug, { spawn = childProcess.spawnSync, now = Date.now } = {}) {
  const repository = ghRun([`repos/${slug}`], spawn);
  if (!repository.ok) return repository;
  const value = repository.value || {};
  const visibility = typeof value.private !== 'boolean' ? null
    : value.private === false ? 'public' : value.visibility === 'internal' ? 'internal' : 'private';
  if (visibility === null) return { ok: false, reason: 'visibility-unreadable' };
  const admin = Boolean(value.permissions && value.permissions.admin === true);
  const analysis = value.security_and_analysis && typeof value.security_and_analysis === 'object' ? value.security_and_analysis : null;
  const fromAnalysis = key => {
    const status = analysis ? statusOf(analysis[key]) : null;
    if (status === 'enabled' || status === 'disabled') return status;
    return visibility === 'public' || !admin ? 'unreadable' : 'not-on-plan';
  };
  // GitHub answers 404 both for "alerts off" and for "you may not see this".
  const alertsRead = ghRun([`repos/${slug}/vulnerability-alerts`, '--silent'], spawn);
  const alerts = alertsRead.ok ? 'enabled' : alertsRead.reason === 'not-found' && admin ? 'disabled' : 'unreadable';
  const fixes = ghRun([`repos/${slug}/automated-security-fixes`], spawn);
  const securityUpdates = fixes.ok && fixes.value && typeof fixes.value.enabled === 'boolean'
    ? (fixes.value.enabled && fixes.value.paused !== true ? 'enabled' : 'disabled')
    : (statusOf(analysis && analysis.dependabot_security_updates) || 'unreadable');
  const codeRead = ghRun([`repos/${slug}/code-scanning/default-setup`], spawn);
  const codeScanning = codeRead.ok && codeRead.value
    ? (codeRead.value.state === 'configured' ? 'enabled' : 'disabled')
    : (visibility === 'public' || !admin ? 'unreadable' : 'not-on-plan');
  let privateReporting = 'not-on-plan';
  if (visibility === 'public') {
    const reporting = ghRun([`repos/${slug}/private-vulnerability-reporting`], spawn);
    privateReporting = reporting.ok && reporting.value && typeof reporting.value.enabled === 'boolean' ? (reporting.value.enabled ? 'enabled' : 'disabled') : 'unreadable';
  }
  const branch = typeof value.default_branch === 'string' && value.default_branch ? value.default_branch : null;
  const committed = rel => {
    if (!branch) return { status: 'unreadable' };
    const file = ghRun([`repos/${slug}/contents/${rel}?ref=${encodeURIComponent(branch)}`], spawn);
    if (file.ok && file.value && file.value.encoding === 'base64' && typeof file.value.content === 'string') return { status: 'ok', text: Buffer.from(file.value.content, 'base64').toString('utf8') };
    return { status: !file.ok && file.reason === 'not-found' ? 'missing' : 'unreadable' };
  };
  const binding = committed(governance.BINDING_FILE);
  let advancedCodeql = null;
  let unplaced = null;
  let uploads = null;
  let unreadable = false;
  if (codeScanning === 'disabled') {
    const listing = branch ? ghRun([`repos/${slug}/contents/.github/workflows?ref=${encodeURIComponent(branch)}`], spawn) : { ok: false, reason: 'no-branch' };
    if (!listing.ok) unreadable = listing.reason !== 'not-found';
    else if (!Array.isArray(listing.value)) unreadable = true;
    else {
      const names = listing.value.filter(entry => entry && entry.type === 'file' && /\.ya?ml$/i.test(entry.name)).map(entry => entry.name).sort();
      if (names.length > 50) unreadable = true;
      for (const name of names.slice(0, 50)) {
        const file = committed(`.github/workflows/${name}`);
        if (file.status !== 'ok') { unreadable = true; continue; }
        const runs = runsCodeql(file.text);
        if (runs === true) { advancedCodeql = name; break; }
        if (runs === 'unsure') { if (unplaced === null) unplaced = name; else unreadable = true; }
      }
    }
    if (advancedCodeql === null) {
      // GitHub's own record also catches CodeQL run from outside a workflow file (a composite action,
      // another repository's reusable workflow): a recent CodeQL analysis on the default branch whose
      // key is not default setup's (`dynamic/...`). GitHub answers 404 when there is none.
      const analyses = branch
        ? ghRun([`repos/${slug}/code-scanning/analyses?tool_name=CodeQL&ref=${encodeURIComponent(`refs/heads/${branch}`)}&per_page=100`], spawn)
        : { ok: false, reason: 'no-branch' };
      if (analyses.ok && Array.isArray(analyses.value)) {
        const since = now() - ANALYSIS_WINDOW_MS;
        const recent = entry => !(Date.parse(entry.created_at) < since);
        // An entry without a key cannot be told apart from default setup's.
        if (analyses.value.some(entry => !entry || typeof entry.analysis_key !== 'string')) unreadable = true;
        const other = analyses.value.find(entry => entry && typeof entry.analysis_key === 'string' && !entry.analysis_key.startsWith('dynamic/') && recent(entry));
        if (other) uploads = other.analysis_key;
        // A full page whose oldest entry is still recent may hide an older one on the next page.
        const last = analyses.value[analyses.value.length - 1];
        if (!other && analyses.value.length >= 100 && (!last || recent(last))) unreadable = true;
      } else if (!(analyses.ok === false && analyses.reason === 'no-analysis')) unreadable = true;
      if (uploads !== null || unplaced !== null || unreadable) advancedCodeql = 'unreadable';
    }
  }
  return {
    ok: true,
    visibility,
    allow_auto_merge: typeof value.allow_auto_merge === 'boolean' ? value.allow_auto_merge : 'unreadable',
    alerts,
    security_updates: securityUpdates,
    secret_scanning: fromAnalysis('secret_scanning'),
    push_protection: fromAnalysis('secret_scanning_push_protection'),
    code_scanning: codeScanning,
    private_reporting: privateReporting,
    binding,
    advanced_codeql: advancedCodeql,
    ...(uploads !== null && advancedCodeql === 'unreadable' ? { codeql_uploads: uploads } : {}),
    ...(unplaced !== null && uploads === null && !unreadable && advancedCodeql === 'unreadable' ? { codeql_unplaced: unplaced } : {}),
  };
}

// The settings writes for the fixes `plan` lists ({ alerts, security_updates, secret_scanning,
// code_scanning, private_reporting, allow_auto_merge }: true for each to turn on). Only free settings
// are written: never GitHub Secret Protection or Code Security. Returns [{ setting, ok, reason }];
// each write is tried once, never retried.
function ghSecurityWriter(slug, plan, { spawn = childProcess.spawnSync } = {}) {
  const results = [];
  const write = (setting, args, input = null) => {
    const outcome = ghRun(args, spawn, input);
    results.push({ setting, ok: outcome.ok, reason: outcome.ok ? null : outcome.reason });
  };
  if (plan.alerts) write('alerts', ['-X', 'PUT', `repos/${slug}/vulnerability-alerts`, '--silent']);
  if (plan.security_updates) write('security_updates', ['-X', 'PUT', `repos/${slug}/automated-security-fixes`, '--silent']);
  if (plan.secret_scanning) {
    const body = { security_and_analysis: { secret_scanning: { status: 'enabled' }, secret_scanning_push_protection: { status: 'enabled' } } };
    write('secret_scanning', ['-X', 'PATCH', `repos/${slug}`, '--input', '-'], JSON.stringify(body));
  }
  if (plan.allow_auto_merge) write('allow_auto_merge', ['-X', 'PATCH', `repos/${slug}`, '--input', '-'], JSON.stringify({ allow_auto_merge: true }));
  if (plan.code_scanning) write('code_scanning', ['-X', 'PATCH', `repos/${slug}/code-scanning/default-setup`, '--input', '-'], JSON.stringify({ state: 'configured' }));
  if (plan.private_reporting) write('private_reporting', ['-X', 'PUT', `repos/${slug}/private-vulnerability-reporting`, '--silent']);
  return results;
}

// Writes the files in `files` ({ dependabot: true, workflow: true }) only where nothing is at that
// path yet (a dependabot.yaml counts), or the workflow is Toolkit's own older copy. Returns
// [{ file, result }].
function writeSecurityFiles(root, files, { toolkitRoot = ROOT } = {}) {
  const results = [];
  const put = (rel, text) => {
    const file = path.join(root, ...rel.split('/'));
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
      results.push({ file: rel, result: 'written' });
    } catch (error) {
      results.push({ file: rel, result: `failed (${error && error.code ? error.code : 'unexpected error'})` });
    }
  };
  if (files.dependabot && dependabotFile(root) === null) put(DEPENDABOT_REL, renderDependabotConfig(detectEcosystems(root)));
  if (files.workflow && ['missing', 'outdated'].includes(workflowState(root, toolkitRoot))) put(WORKFLOW_REL, workflowTemplate(toolkitRoot));
  return results;
}

// Turns on what `result` (a dependencySecurity verdict) lists as fixes and writes its missing files,
// then reads back through `reread()`. { prior, settings, files, unavailable, still_off, unconfirmed,
// read_back, result } with result:
//   'nothing'     nothing to do;
//   'unverified'  GitHub could not be read first (nothing is written then), or the read-back failed,
//                 as a whole or for any one written setting (listed in `unconfirmed`);
//   'failed'      a write failed, a file was not written, or the read-back still shows it off;
//   'applied'     every written setting was read back on, or GitHub refused it as not available here.
// A write GitHub refuses because the plan or an organisation policy does not allow it is listed in
// `unavailable` and left alone: it is not a failure. `prior` keeps what GitHub showed before, so a
// change can be undone by hand.
function applySecurity(root, result, { writer = ghSecurityWriter, fileWriter = writeSecurityFiles, reread = null } = {}) {
  const prior = result.settings || null;
  const empty = { prior, settings: [], files: [], unavailable: [], still_off: [], unconfirmed: [], read_back: false };
  if (!result.fixes) return { ...empty, result: 'unverified' };
  const fixes = result.fixes;
  const wantSettings = Object.values(fixes).some(Boolean);
  const wantFiles = Boolean(result.files && (result.files.dependabot || result.files.workflow));
  if (!wantSettings && !wantFiles) return { ...empty, result: 'nothing' };
  let settings = [];
  if (wantSettings) {
    try { settings = writer(result.slug, fixes); } catch { settings = [{ setting: 'all', ok: false, reason: 'writer-failed' }]; }
  }
  let files = [];
  if (wantFiles) {
    try { files = fileWriter(root, result.files); } catch { files = [{ file: 'all', result: 'failed (writer-failed)' }]; }
  }
  const unavailable = settings.filter(entry => !entry.ok && UNAVAILABLE.includes(entry.reason)).map(entry => entry.setting);
  let after = null;
  if (wantSettings && reread) {
    try { after = reread(); } catch { after = null; }
  }
  // Each written setting must read back on by itself: off is still off, anything else unconfirmed.
  const readBack = Boolean(after && after.settings);
  const stillOff = [];
  const unconfirmed = [];
  for (const entry of settings.filter(item => item.ok)) {
    if (!READ_BACK[entry.setting]) { unconfirmed.push(entry.setting); continue; }
    const values = READ_BACK[entry.setting].map(key => (readBack ? after.settings[key] : undefined));
    if (values.every(item => item === 'enabled' || item === true)) continue;
    if (values.some(item => item === 'disabled' || item === false)) stillOff.push(entry.setting);
    else unconfirmed.push(entry.setting);
  }
  const failed = settings.some(entry => !entry.ok && !UNAVAILABLE.includes(entry.reason)) || files.some(entry => entry.result !== 'written') || stillOff.length > 0;
  const status = failed ? 'failed' : unconfirmed.length > 0 ? 'unverified' : 'applied';
  return { prior, settings, files, unavailable, still_off: stillOff, unconfirmed, read_back: readBack, result: status };
}

// The read values that show each written setting on. A written setting with no entry here can never
// count as read back.
const READ_BACK = Object.freeze({
  alerts: ['alerts'], security_updates: ['security_updates'], secret_scanning: ['secret_scanning', 'push_protection'],
  code_scanning: ['code_scanning'], private_reporting: ['private_reporting'], allow_auto_merge: ['allow_auto_merge'],
});

const SETTING_LABELS = Object.freeze({
  alerts: 'Dependabot alerts', security_updates: 'Dependabot security updates', secret_scanning: 'secret scanning and push protection',
  code_scanning: 'CodeQL code scanning', private_reporting: 'private vulnerability reporting',
  allow_auto_merge: 'allow auto-merge', all: 'the settings',
});

// Plain lines saying what `applySecurity` did, what could not be checked, and what is left to do by
// hand.
function describeOutcome(slug, root, result, outcome) {
  const lines = [];
  if (!result.fixes) lines.push(`- ${slug}: nothing changed: GitHub could not be read, so nothing was checked or turned on.`);
  for (const entry of outcome.settings) {
    const label = SETTING_LABELS[entry.setting] || entry.setting;
    if (entry.ok) lines.push(`- ${slug}: ${label} turned on.`);
    else if (UNAVAILABLE.includes(entry.reason) && (outcome.unavailable || []).includes(entry.setting)) lines.push(`- ${slug}: ${label} left alone: GitHub does not allow it here (${entry.reason === 'not-on-plan' ? 'not on this plan' : 'an organisation or enterprise policy'}).`);
    else lines.push(`- ${slug}: ${label} not turned on (${entry.reason}).`);
  }
  for (const entry of outcome.files) lines.push(`- ${root}: ${entry.file} ${entry.result}${entry.result === 'written' ? '; commit it through a pull request' : ''}.`);
  const wrote = outcome.settings.some(entry => entry.ok);
  // Only settings that were written can fail to read back.
  const unconfirmed = (outcome.unconfirmed || []).filter(key => outcome.settings.some(entry => entry.ok && entry.setting === key));
  if (outcome.still_off.length) lines.push(`- ${slug}: reading back still shows off: ${outcome.still_off.map(key => SETTING_LABELS[key] || key).join(', ')}.`);
  if (unconfirmed.length) lines.push(`- ${slug}: could not read back: ${unconfirmed.map(key => SETTING_LABELS[key] || key).join(', ')}; the change is unverified, so run the check again.`);
  // Only when every successful write was itself read back on, and nothing else failed.
  if (wrote && outcome.result === 'applied') lines.push(`- ${slug}: read back.`);
  for (const [id, check] of Object.entries(result.checks || {})) {
    if (check.status === 'unverified') lines.push(`- ${slug}: could not check ${id}: ${check.details.join('; ')}.`);
  }
  if (result.pending_policy) lines.push(`- ${slug}: the working-tree binding asks for ${JSON.stringify(result.pending_policy)}; it counts only once merged into the default branch.`);
  const byHand = [];
  if (result.checks.S3 && result.checks.S3.status === 'drift' && !(result.files && result.files.dependabot)) byHand.push(...result.checks.S3.details);
  if (result.checks.S7 && result.checks.S7.status === 'drift') byHand.push(...result.checks.S7.details.filter(detail => !detail.includes(WORKFLOW_REL) || result.workflow === 'foreign'));
  for (const id of ['S4', 'S5']) if (result.checks[id] && result.checks[id].status === 'drift' && !(result.fixes && (id === 'S4' ? result.fixes.secret_scanning : result.fixes.code_scanning))) byHand.push(...result.checks[id].details);
  if (byHand.length) lines.push(`${slug}: still to do (Toolkit never edits a file it did not write):`, ...byHand.map(note => `  - ${note}`));
  return lines;
}

// ---- the verdict --------------------------------------------------------------------------------

function settingCheck(value, label) {
  if (value === 'enabled') return { status: 'ok', details: [] };
  if (value === 'disabled') return { status: 'drift', details: [`${label} is off`] };
  if (value === 'not-on-plan') return { status: 'not-on-plan', details: [`${label} is not offered by GitHub on this repository`] };
  if (value === 'not-checked') return { status: 'not-checked', details: ['offline'] };
  return { status: 'unverified', details: [`${label} could not be read`] };
}

function verdict(status, reason, checks = {}, extra = {}) {
  return Object.freeze({ status, reason, checks: Object.freeze(checks), ...extra });
}

const SNAPSHOT_KEYS = Object.freeze(['visibility', 'allow_auto_merge', 'alerts', 'security_updates', 'secret_scanning', 'push_protection', 'code_scanning', 'private_reporting']);

function sameValues(a, b) {
  return Object.keys(a).every(key => a[key] === b[key]);
}

// { status: conformant | drift | unverified | not-applicable, reason, checks: { S1..S7 }, policy,
// policy_source, pending_policy, settings, missing_ecosystems, fixes, files } for the repository at
// `root`. Options: `offline`, `reader(slug)` (tests), `protectionResult` (the default-branch
// verdict, for S7), `toolkitRoot`.
function dependencySecurity(root, { offline = false, reader = ghSecurityReader, protectionResult = null, toolkitRoot = ROOT } = {}) {
  let identity;
  try { identity = governance.readIdentity(root); } catch { return verdict('unverified', 'identity-unreadable'); }
  const slug = identity.valid ? governance.remoteSlug(identity.remote) : null;
  if (!identity.valid || identity.remote.host !== 'github.com' || !slug) return verdict('not-applicable', 'not-a-github-repository');
  const detected = detectEcosystems(root);
  const config = readDependabotConfig(root);
  const missingEcosystems = uncoveredEcosystems(detected, config);
  const workflow = workflowState(root, toolkitRoot);
  let read = null;
  if (!offline) {
    try { read = reader(slug); } catch { read = { ok: false, reason: 'reader-failed' }; }
  }
  const online = read && read.ok === true;
  const { policy, source, required_checks: mergedChecks } = offline ? { ...committedPolicy(null, identity), source: 'offline' } : committedPolicy(read, identity);
  const known = source === 'default-branch' || source === 'not-merged';
  const working = governance.workingBindingPolicy(root);
  const pendingPolicy = working && known && !sameValues(working, policy) ? working : null;
  const advanced = online ? read.advanced_codeql || null : null;
  // Default-branch protection is checked against the working tree's required checks; it counts for
  // auto-merge only when those are the merged binding's.
  const workingChecks = governance.bindingRequiredChecks(root);
  const checksMerged = Boolean(mergedChecks && workingChecks && [...mergedChecks].sort().join('\n') === [...workingChecks].sort().join('\n'));
  const protectedForAutoMerge = Boolean(protectionResult && protectionResult.status === 'conformant' && checksMerged);
  const value = key => (offline ? 'not-checked' : online ? read[key] : 'unreadable');
  const checks = {
    S1: settingCheck(value('alerts'), 'Dependabot alerts'),
    S2: settingCheck(value('security_updates'), 'Dependabot security updates'),
    S3: missingEcosystems.length === 0
      ? { status: 'ok', details: [] }
      : { status: 'drift', details: missingEcosystems.map(item => `${dependabotFile(root) || DEPENDABOT_REL} has no "${item.ecosystem}" entry for ${item.directory}`) },
  };
  const scanning = settingCheck(value('secret_scanning'), 'Secret scanning');
  const pushProtection = settingCheck(value('push_protection'), 'Push protection');
  const off = [scanning, pushProtection].filter(item => item.status === 'drift');
  checks.S4 = off.length ? { status: 'drift', details: off.flatMap(item => item.details) }
    : [scanning, pushProtection].find(item => item.status !== 'ok') || scanning;
  checks.S5 = online && advanced === 'unreadable' && read.code_scanning === 'disabled'
    ? { status: 'unverified', details: [read.codeql_uploads
      ? `GitHub has CodeQL results on the default branch from ${read.codeql_uploads} in the last 90 days, not from default setup, so an advanced CodeQL setup is in use somewhere; default setup stays off, so check it by hand`
      : read.codeql_unplaced
      ? `.github/workflows/${read.codeql_unplaced} names CodeQL steps Toolkit could not place or rule out, so an advanced CodeQL setup cannot be ruled out; default setup stays off, so check that workflow by hand`
      : 'the default branch\'s workflows or GitHub\'s CodeQL results could not be read, so an advanced CodeQL setup cannot be ruled out; default setup stays off'] }
    : online && advanced && read.code_scanning === 'disabled'
      ? { status: 'ok', details: [`CodeQL runs from .github/workflows/${advanced} (advanced setup), so default setup stays off`] }
      : settingCheck(value('code_scanning'), 'CodeQL code scanning');
  // GitHub bills for secret scanning, push protection and CodeQL on a private or internal repository,
  // so there they are not applicable: never asked about, turned on or reported as drift.
  if (online && read.visibility !== 'public') {
    for (const id of ['S4', 'S5']) checks[id] = { status: 'not-applicable', details: [`not applicable (${read.visibility} repository): GitHub offers it free only on public repositories`] };
  }
  checks.S6 = online && read.visibility !== 'public'
    ? { status: 'not-applicable', details: ['private vulnerability reporting is for public repositories'] }
    : settingCheck(value('private_reporting'), 'Private vulnerability reporting');
  const s7 = [];
  let s7Status = 'ok';
  let s7Unverified = null;
  if (offline) s7Status = 'not-checked';
  else if (!online) s7Status = 'unverified';
  else if (!known) s7Status = 'unverified';
  else if (policy.auto_merge === 'patch-minor') {
    if (workflow !== 'current') s7.push(workflow === 'missing' ? `${WORKFLOW_REL} is missing` : workflow === 'outdated' ? `${WORKFLOW_REL} is an older Toolkit copy` : `${WORKFLOW_REL} is not Toolkit's file`);
    if (read.allow_auto_merge === false) s7.push('the repository does not allow auto-merge');
    const branch = protectionResult ? protectionResult.status : 'unverified';
    if (protectionResult && protectionResult.reason === 'binding-has-no-required-checks') s7.push('the binding names no required checks, so auto-merge could merge untested code');
    else if (['drift', 'not-enforceable', 'not-applicable'].includes(branch)) s7.push('the default branch is not protected the way auto-merge needs (see the default-branch protection findings)');
    else if (branch !== 'conformant' || read.allow_auto_merge === 'unreadable') s7Status = 'unverified';
    else if (!checksMerged) {
      s7Status = 'unverified';
      s7Unverified = 'the working tree\'s required checks differ from the merged binding\'s, so the protection check does not count for auto-merge until they are merged';
    }
    if (s7.length) s7Status = 'drift';
  }
  checks.S7 = {
    status: s7Status,
    details: s7.length ? s7 : s7Status === 'not-checked' ? ['offline']
      : s7Status === 'unverified' ? [online && !known ? 'the programme binding on the default branch could not be read, so the auto-merge policy is unknown and auto-merge stays off' : s7Unverified || 'the repository settings or default-branch protection could not be read'] : [],
  };
  const statuses = Object.values(checks).map(entry => entry.status);
  const status = statuses.includes('drift') ? 'drift'
    : statuses.every(item => ['ok', 'not-on-plan', 'not-applicable'].includes(item)) ? 'conformant' : 'unverified';
  // Secret scanning and CodeQL only where GitHub offers them free: public repositories.
  const wanted = online && read.visibility === 'public';
  const fixes = online ? {
    alerts: read.alerts === 'disabled',
    security_updates: read.security_updates === 'disabled',
    secret_scanning: Boolean(wanted) && (read.secret_scanning === 'disabled' || read.push_protection === 'disabled'),
    code_scanning: Boolean(wanted) && read.code_scanning === 'disabled' && advanced === null,
    private_reporting: read.visibility === 'public' && read.private_reporting === 'disabled',
    allow_auto_merge: policy.auto_merge === 'patch-minor' && read.allow_auto_merge === false && protectedForAutoMerge,
  } : null;
  const files = {
    dependabot: dependabotFile(root) === null && detected.size > 0,
    workflow: policy.auto_merge === 'patch-minor' && ['missing', 'outdated'].includes(workflow),
  };
  const settings = online ? Object.fromEntries(SNAPSHOT_KEYS.map(key => [key, read[key]])) : null;
  return verdict(status, null, checks, {
    slug, policy, policy_source: source, pending_policy: pendingPolicy, visibility: online ? read.visibility : null,
    settings, missing_ecosystems: missingEcosystems, workflow, fixes, files,
  });
}

module.exports = Object.freeze({
  WORKFLOW_REL,
  WORKFLOW_TEMPLATE_REL,
  DEPENDABOT_REL,
  DEPENDABOT_NAMES,
  COOLDOWN_DAYS,
  detectEcosystems,
  dependabotFile,
  readDependabotConfig,
  uncoveredEcosystems,
  renderDependabotConfig,
  workflowState,
  runsCodeql,
  committedPolicy,
  ghSecurityReader,
  ghSecurityWriter,
  writeSecurityFiles,
  applySecurity,
  describeOutcome,
  dependencySecurity,
});
