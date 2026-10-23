#!/usr/bin/env node
'use strict';

// Command line for programme state documents and the reconcile pass. Run it from a checkout of the
// governed repository; `.github/toolkit-programme.json` names the parent issue and the private store.
//
// Anyone may read:
//   reconcile [--issue <n>] [--parent-file <file>]   dry run
//   show [--parent | --issue <n>] [--include-private]
//   init-parent --catalogue <file>                     validate a catalogue
//
// Only the appointed controller writes. Every write needs --controller and
// --session <id>, and every write except creating the parent and a deliberate parent takeover also
// needs that session to hold the parent document:
//   reconcile --apply [--issue <n>]
//   init-parent --catalogue <file> --apply
//   update-parent --patch <file>
//   claim (--parent | --issue <n>) [--role G0|G1|G2] [--model <m> --effort <e> [--route-read-back]] [--takeover]
//   update --issue <n> --patch <file>
//   return --issue <n> (--submit <return-id> | --consume <return-id> --verdict ACCEPT|REOPEN)
//
// The record prefix is the binding's writer prefix unless --prefix is given. --json prints JSON.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const state = require('./programme-state.cjs');

const { ProgrammeError } = state;
const VERSION_FILE = path.resolve(__dirname, '..', '..', '..', 'repo', 'contracts', 'toolkit-local-bridge', 'version.json');
const COMMANDS = ['reconcile', 'show', 'init-parent', 'update-parent', 'claim', 'update', 'return'];
const FLAGS = new Set(['--apply', '--parent', '--include-private', '--takeover', '--route-read-back', '--json', '--controller']);
const VALUES = new Set(['--issue', '--parent-file', '--catalogue', '--patch', '--role', '--model', '--effort', '--submit', '--consume', '--verdict', '--session', '--prefix', '--repo-root']);

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!COMMANDS.includes(command)) throw new ProgrammeError('USAGE', `Usage: programme.cjs <${COMMANDS.join('|')}> [options]`);
  const args = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (FLAGS.has(flag)) { args[flag.slice(2)] = true; continue; }
    if (!VALUES.has(flag)) throw new ProgrammeError('USAGE', `Unknown option: ${flag}`);
    const value = rest[index + 1];
    if (value === undefined || value === '' || value.startsWith('--')) throw new ProgrammeError('USAGE', `${flag} needs a value`);
    args[flag.slice(2)] = value;
    index += 1;
  }
  if (args.issue !== undefined) {
    args.issue = /^\d+$/.test(args.issue) ? Number(args.issue) : NaN;
    if (!Number.isSafeInteger(args.issue) || args.issue < 1) throw new ProgrammeError('USAGE', '--issue must be an issue number (1 or more).');
  }
  if (isWrite(args) && !args.controller) {
    throw new ProgrammeError('USAGE', 'Only the appointed controller writes programme state. Other sessions run reconcile (a dry run) or show and report to the controller.');
  }
  if (command === 'claim') {
    if (Boolean(args.parent) === (args.issue !== undefined)) throw new ProgrammeError('USAGE', 'claim needs --issue <n> or --parent.');
    if (args.parent && args.role !== undefined) throw new ProgrammeError('USAGE', '--role cannot be used with --parent.');
  }
  return args;
}

// Commands that write programme state or GitHub. Each one is the controller's.
function isWrite(args) {
  if (args.command === 'reconcile' || args.command === 'init-parent') return Boolean(args.apply);
  return ['update-parent', 'claim', 'update', 'return'].includes(args.command);
}

function toolkitVersion(file = VERSION_FILE) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')).version || null; }
  catch { return null; }
}

function readJsonFile(file, what) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); }
  catch (error) { throw new ProgrammeError('USAGE', `The ${what} file could not be read as JSON: ${error.message}`); }
}

function runGit(gitPath, cwd, args) {
  const result = spawnSync(gitPath, args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 30000 });
  if (result.error || result.status !== 0) throw new ProgrammeError('GIT_FAILED', `git ${args.join(' ')} failed: ${String(result.stderr || result.error?.message || '').trim()}`);
  return result.stdout.trim();
}

// Binds repository identity, the store and the writer. `deps` lets tests supply a transport and the
// origin URL instead of running gh and git.
function openContext(args, deps = {}) {
  let repoRoot = args['repo-root'] || deps.repoRoot;
  let originUrl = deps.originUrl;
  if (!repoRoot || !originUrl) {
    const gitPath = state.resolveExecutable('git');
    repoRoot = repoRoot || runGit(gitPath, process.cwd(), ['rev-parse', '--show-toplevel']);
    originUrl = originUrl || runGit(gitPath, repoRoot, ['remote', 'get-url', 'origin']);
  }
  const binding = deps.binding || state.loadBinding(repoRoot);
  const transport = deps.transport || new state.GitHubTransport({ ghPath: state.resolveExecutable('gh') });
  const repository = state.bindRepository({ transport, originUrl, binding });
  const version = deps.toolkitVersion === undefined ? toolkitVersion() : deps.toolkitVersion;
  const store = new state.STORE_BACKENDS[binding.store.kind]({ transport, store: binding.store, now: deps.now, toolkitVersion: version });
  store.verify();
  // The session comes from --session only; an inherited environment never makes a session a writer.
  const writer = args.session ? { session: args.session, prefix: args.prefix || binding.writer_prefix } : null;
  return { binding, transport, repository, store, writer, version };
}

function requireWriter(context) {
  if (!context.writer) throw new ProgrammeError('WRITER_UNKNOWN', 'Controller writes need --session <the controller session id>.');
  return context.writer;
}

// Every controller write except creating the parent and a deliberate parent takeover needs the
// writing session to hold the parent document.
function requireParentHolder(context, parentDoc) {
  const writer = requireWriter(context);
  if (!state.isHolder(parentDoc, writer)) throw new ProgrammeError('STALE_WRITER', state.parentRefusal(parentDoc));
  return writer;
}

function outcomeFor(parentDoc, issue) {
  const outcome = parentDoc.outcomes.find(entry => entry.issue === issue);
  if (!outcome) throw new ProgrammeError('USAGE', `#${issue} is not in the outcome catalogue of #${parentDoc.parent_issue}.`);
  return outcome;
}

function readParent(context) {
  const { doc } = context.store.read('parent', context.binding.parent_issue);
  if (!doc) throw new ProgrammeError('PARENT_STATE_MISSING', `No parent state document for #${context.binding.parent_issue} yet. The appointed controller creates and holds it with init-parent --apply; other sessions report this to the controller.`);
  return doc;
}

function redact(doc) {
  const copy = JSON.parse(JSON.stringify(doc));
  copy.private = Object.keys(copy.private || {}).length ? '(redacted; --include-private shows it)' : {};
  if (copy.fence?.holder_session) copy.fence.holder_session = '(redacted)';
  if (copy.gate?.session_id) copy.gate.session_id = '(redacted)';
  return copy;
}

function writeResult(kind, number, result, writer) {
  return { document: `${kind === 'parent' ? 'parent' : 'issue'}-${number}.json`, outcome: result.outcome, revision: result.doc?.revision ?? null,
    epoch: result.doc?.fence?.epoch ?? null, acting: { prefix: writer.prefix, session: writer.session } };
}

const commands = {
  reconcile(args, context) {
    if (args.apply) requireParentHolder(context, readParent(context));
    if (args.apply && args['parent-file']) throw new ProgrammeError('USAGE', '--parent-file is for dry runs only.');
    const reconciler = new state.Reconciler({
      store: context.store,
      reader: new state.ProgrammeGraphReader({ transport: context.transport, repository: context.repository }),
      mutator: new state.GitHubMutator({ transport: context.transport, repository: context.repository }),
      binding: context.binding, writer: context.writer, toolkitVersion: context.version,
    });
    const parentOverride = args['parent-file'] ? readJsonFile(args['parent-file'], 'parent') : null;
    return reconciler.run({ apply: Boolean(args.apply), issue: args.issue ?? null, parentOverride });
  },

  show(args, context) {
    const kind = args.issue ? 'child' : 'parent';
    const { doc, sha } = context.store.read(kind, args.issue || context.binding.parent_issue);
    if (!doc) throw new ProgrammeError('STATE_MISSING', `No state document for #${args.issue || context.binding.parent_issue}.`);
    return { blob: sha, document: args['include-private'] ? doc : redact(doc) };
  },

  'init-parent'(args, context) {
    if (!args.catalogue) throw new ProgrammeError('USAGE', 'init-parent needs --catalogue <file>.');
    const catalogue = readJsonFile(args.catalogue, 'catalogue');
    const doc = state.newParent({ repository: context.repository, parentIssue: context.binding.parent_issue, outcomes: catalogue.outcomes || [], releasePlan: catalogue.release_plan || null });
    if (!args.apply) {
      const errors = state.validateParent(doc);
      return { mode: 'dry-run', valid: !errors.length, errors, document: doc };
    }
    const writer = requireWriter(context);
    if (context.store.read('parent', context.binding.parent_issue).doc) throw new ProgrammeError('STATE_EXISTS', 'The parent state document already exists. Only the appointed controller runs update-parent.');
    doc.fence = { epoch: 1, holder_prefix: writer.prefix, holder_session: writer.session };
    const result = context.store.write('parent', context.binding.parent_issue, doc, { sha: null, previous: null });
    return writeResult('parent', context.binding.parent_issue, result, writer);
  },

  'update-parent'(args, context) {
    if (!args.patch) throw new ProgrammeError('USAGE', 'update-parent needs --patch <file>.');
    const writer = requireParentHolder(context, readParent(context));
    const patch = readJsonFile(args.patch, 'patch');
    const result = context.store.mutate('parent', context.binding.parent_issue, { writer, change: doc => state.applyPatch('parent', doc, patch) });
    return writeResult('parent', context.binding.parent_issue, result, writer);
  },

  claim(args, context) {
    const writer = requireWriter(context);
    const route = args.model || args.effort ? { model: args.model || null, effort: args.effort || null, read_back: Boolean(args['route-read-back']) } : null;
    const options = { takeover: Boolean(args.takeover), role: args.role || null, route };
    if (args.parent) {
      readParent(context);
      const result = context.store.mutate('parent', context.binding.parent_issue, { writer, authorise: false, change: doc => state.claimDocument(doc, writer, options) });
      return writeResult('parent', context.binding.parent_issue, result, writer);
    }
    const parentDoc = readParent(context);
    requireParentHolder(context, parentDoc);
    const outcome = outcomeFor(parentDoc, args.issue);
    const result = context.store.mutate('child', args.issue, {
      writer, authorise: false, create: () => state.newChild({ repository: context.repository, outcome }),
      change: doc => state.claimDocument(doc, writer, { ...options, parentDoc }),
    });
    return writeResult('child', args.issue, result, writer);
  },

  update(args, context) {
    if (!args.issue || !args.patch) throw new ProgrammeError('USAGE', 'update needs --issue <n> and --patch <file>.');
    const parentDoc = readParent(context);
    const writer = requireParentHolder(context, parentDoc);
    const patch = readJsonFile(args.patch, 'patch');
    const result = context.store.mutate('child', args.issue, { writer, parentDoc, change: doc => state.applyPatch('child', doc, patch, { writer, parentDoc }) });
    return writeResult('child', args.issue, result, writer);
  },

  return(args, context) {
    if (!args.issue || (!args.submit && !args.consume)) throw new ProgrammeError('USAGE', 'return needs --issue <n> and --submit <id> or --consume <id> --verdict ACCEPT|REOPEN.');
    const parentDoc = readParent(context);
    const writer = requireParentHolder(context, parentDoc);
    const change = args.submit
      ? doc => state.submitReturn(doc, { returnId: args.submit, writer, parentDoc })
      : doc => state.consumeReturn(doc, { returnId: args.consume, verdict: args.verdict, writer, parentDoc });
    const result = context.store.mutate('child', args.issue, { writer, parentDoc, change });
    return writeResult('child', args.issue, result, writer);
  },
};

function formatReport(report) {
  const lines = [
    `Repository ${report.repository}, parent #${report.parent_issue}; state store ${report.store.repository} ${report.store.branch} ${report.store.path} (parent revision ${report.parent_revision ?? 'none'})`,
    `${report.mode === 'apply' ? 'Apply' : 'Dry run'}: ${report.summary}`,
  ];
  if (report.findings.length) lines.push('', 'Findings', ...report.findings.map(finding => `- ${finding.code} #${finding.issue}: ${finding.detail}`));
  if (report.close_list.length) lines.push('', 'Ready to close (the controller decides; nothing is closed automatically)', ...report.close_list.map(entry => `- #${entry.issue}: PR #${entry.pr}, head ${entry.head.slice(0, 7)}; ${entry.gate || 'unassigned gate'} ${entry.gate_accepted ? 'acceptance recorded' : 'not accepted'}; UAT: ${entry.uat || 'not recorded'}; review: ${entry.review || 'not recorded'}${entry.accepted ? '' : '; completion not accepted'}`));
  if (report.mode === 'apply' && report.results.length) lines.push('', 'Effects', ...report.results.map(entry => `- ${entry.outcome}: ${entry.text}${entry.detail ? ` (${entry.detail})` : ''}`));
  else if (report.effects.length) lines.push('', 'Planned effects', ...report.effects.map((effect, index) => `${index + 1}. ${effect.text}`));
  if (report.recovered.length) lines.push('', 'Recovered from an earlier pass', ...report.recovered.map(entry => `- ${entry.outcome}: ${entry.kind} ${entry.number} intent ${entry.intent_id}`));
  if (report.holds.length) lines.push('', 'Holds', ...report.holds.map(hold => `- ${hold.code} ${hold.target}: ${hold.detail}`));
  if (report.mode === 'apply') lines.push('', `Writes: ${report.writes.state} state, ${report.writes.github} GitHub`);
  lines.push('', `Next action: ${report.next_action}`);
  return `${lines.join('\n')}\n`;
}

function main(argv = process.argv.slice(2), deps = {}) {
  const out = deps.stdout || process.stdout;
  const args = parseArgs(argv);
  const context = openContext(args, deps);
  const result = commands[args.command](args, context);
  if (args.command === 'reconcile' && !args.json) out.write(formatReport(result));
  else out.write(`${JSON.stringify(result, null, 2)}\n`);
  if (args.command === 'reconcile') return result.holds.length ? 1 : 0;
  return 0;
}

if (require.main === module) {
  try { process.exitCode = main(); }
  catch (error) {
    console.error(`${error.code || 'FAIL'}: ${error.message}`);
    process.exitCode = 2;
  }
}

module.exports = Object.freeze({ parseArgs, toolkitVersion, openContext, commands, formatReport, main });
