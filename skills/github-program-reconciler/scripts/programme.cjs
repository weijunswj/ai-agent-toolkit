#!/usr/bin/env node
'use strict';

// Command line for programme state documents and the reconcile pass. Run it from a checkout of the
// governed repository; `.github/toolkit-programme.json` names the parent issue and the private store.
//
// Anyone may read:
//   reconcile [--issue <n>] [--parent-file <file>]   dry run
//   show [--parent | --issue <n>] [--include-private]; show --session <id> alone shows that session's local binding
//   init-parent --catalogue <file>                     validate a catalogue
//
// Any session in a governed checkout, executors included, may bring the pages up to date:
//   refresh                                            the full reconcile --apply pass, written under the
//                                                      parent's current holder; it takes no decision input
//
// An executor session the controller assigned writes only its own checkpoint journal:
//   bind --issue <n> --assignment <id> --session <id> [--model <m> --effort <e> [--route-read-back]]
//   checkpoint --session <id> [--message-file <file>]  (the turn-end hook runs the same step)
//
// Only the appointed controller writes programme state. Every write below needs --controller and
// --session <id>, and every write except creating the parent and a deliberate parent takeover also
// needs that session to hold the parent document (a lane controller may assign and interrupt the one
// child the catalogue delegates to its prefix):
//   reconcile --apply [--issue <n>]
//   init-parent --catalogue <file> --apply
//   update-parent --patch <file>
//   claim --parent [--takeover --takeover-record <comment id>]
//   claim --issue <n> --lane [--takeover]
//   assign --issue <n> --role G0|G1|G2 --assignment <id> [--supersede --reason <text>]
//   reopen --issue <n> --reason <text> [--assignment <new id>]
//   interrupt --issue <n> --reason <text>
//   update --issue <n> --patch <file>
//   return --issue <n> (--record <return-id> --assignment <id> [--at-head <sha>] | --consume <return-id> --verdict ACCEPT|REOPEN|WAITING_OWNER)
//
// The record prefix is the binding's writer prefix unless --prefix is given. --json prints JSON.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const state = require('./programme-state.cjs');
const checkpoint = require('./programme-checkpoint.cjs');

const { ProgrammeError } = state;
const VERSION_FILE = path.resolve(__dirname, '..', '..', '..', 'repo', 'contracts', 'toolkit-local-bridge', 'version.json');
const COMMANDS = ['reconcile', 'refresh', 'show', 'init-parent', 'update-parent', 'claim', 'assign', 'reopen', 'interrupt', 'update', 'return', 'bind', 'checkpoint'];
const FLAGS = new Set(['--apply', '--parent', '--include-private', '--takeover', '--route-read-back', '--json', '--controller', '--supersede', '--lane']);
const VALUES = new Set(['--issue', '--parent-file', '--catalogue', '--patch', '--role', '--model', '--effort', '--record', '--consume', '--verdict', '--session',
  '--prefix', '--repo-root', '--assignment', '--reason', '--at-head', '--takeover-record', '--message-file']);
const EXECUTOR_COMMANDS = ['bind', 'checkpoint'];
const LANE_COMMANDS = ['assign', 'interrupt'];

const usage = message => new ProgrammeError('USAGE', message);

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!COMMANDS.includes(command)) throw usage(`Usage: programme.cjs <${COMMANDS.join('|')}> [options]`);
  const args = { command };
  for (let index = 0; index < rest.length; index += 1) {
    const flag = rest[index];
    if (FLAGS.has(flag)) { args[flag.slice(2)] = true; continue; }
    if (!VALUES.has(flag)) throw usage(`Unknown option: ${flag}`);
    const value = rest[index + 1];
    if (value === undefined || value.trim() === '' || value.startsWith('--')) throw usage(`${flag} needs a value`);
    args[flag.slice(2)] = value;
    index += 1;
  }
  if (args.issue !== undefined) {
    args.issue = /^\d+$/.test(args.issue) ? Number(args.issue) : NaN;
    if (!Number.isSafeInteger(args.issue) || args.issue < 1) throw usage('--issue must be an issue number (1 or more).');
  }
  if (command === 'refresh') {
    const extra = Object.keys(args).filter(key => !['command', 'json', 'repo-root'].includes(key));
    if (extra.length) throw usage(`refresh takes no options but --json and --repo-root: it always runs the full pass as the parent's current holder (got --${extra[0]}).`);
  }
  if (EXECUTOR_COMMANDS.includes(command) && args.controller) throw usage(`${command} is an executor command; the controller does not bind or checkpoint.`);
  if (isWrite(args) && !args.controller) {
    throw usage('Only the appointed controller writes programme state. Other sessions run reconcile (a dry run) or show and report to the controller; an executor the controller assigned records its work only in its own checkpoint journal (bind, then its turn-end hook).');
  }
  const needs = (condition, message) => { if (!condition) throw usage(message); };
  if (command === 'show') needs(!(args.parent && args.issue !== undefined), 'show takes --parent or --issue <n>, not both.');
  if (command === 'claim') {
    needs(Boolean(args.parent) !== (args.issue !== undefined), 'claim needs --issue <n> --lane or --parent.');
    needs(args.role === undefined, 'Gates are not claimed: the controller runs assign --issue <n> --role <gate> --assignment <id>.');
    needs(!args.parent || !args.lane, '--lane is for claim --issue <n>.');
    needs(args.parent || args.lane, 'claim --issue <n> is only for a lane controller (--lane); the controller assigns gates with assign.');
    needs(!args['takeover-record'] || (args.parent && args.takeover), '--takeover-record goes with claim --parent --takeover.');
  }
  if (command === 'assign') {
    needs(args.issue !== undefined && args.role && args.assignment, 'assign needs --issue <n>, --role G0|G1|G2 and --assignment <id>.');
    needs(!args.reason || args.supersede, '--reason goes with --supersede on assign.');
  }
  if (command === 'reopen' || command === 'interrupt') needs(args.issue !== undefined && args.reason, `${command} needs --issue <n> and --reason <text>.`);
  if (command === 'return') {
    needs(args.issue !== undefined && Boolean(args.record) !== Boolean(args.consume), 'return needs --issue <n> and either --record <id> --assignment <id> or --consume <id> --verdict ACCEPT|REOPEN|WAITING_OWNER.');
    needs(!args.record || args.assignment, 'return --record needs --assignment <id>.');
    needs(!args.consume || args.verdict, 'return --consume needs --verdict ACCEPT|REOPEN|WAITING_OWNER.');
  }
  if (command === 'bind') {
    needs(args.issue !== undefined && args.assignment && args.session, 'bind needs --issue <n>, --assignment <id> and --session <this session\'s own id>.');
    needs(!args['route-read-back'] || (args.model && args.effort), '--route-read-back needs --model and --effort.');
  }
  if (command === 'checkpoint') needs(args.session, 'checkpoint needs --session <this session\'s own id>.');
  return args;
}

// Commands that write programme state or GitHub. Each one is the controller's. `refresh` also writes,
// but it is not listed: it carries no decision of its own (see commands.refresh).
function isWrite(args) {
  if (args.command === 'reconcile' || args.command === 'init-parent') return Boolean(args.apply);
  return ['update-parent', 'claim', 'assign', 'reopen', 'interrupt', 'update', 'return'].includes(args.command);
}

function toolkitVersion(file = VERSION_FILE) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')).version || null; }
  catch { return null; }
}

// One reconcile pass with --apply at a time per repository on this computer. The lock file holds a
// random token, the owner's process id and host; its modified time is the owner's heartbeat, renewed
// before every GitHub request. Before every request the pass also checks that the lock still holds its
// token, and stops (PASS_LOCK_LOST) if not, so a pass that loses its lock never writes again.
//
// The lock is taken over only when its owner is provably gone: on this host, its process has ended;
// on another host (a shared profile), it has not beaten for LOCK_STALE_MS. A live process that has
// not beaten for LOCK_ABANDONED_MS is taken to be an unrelated process that reused a dead owner's id
// (a pass beats at least every few minutes while awake); if it is in fact a pass waking from a long
// sleep, it finds its token gone and stops before its next request. Anything at the path that is not
// a lock file is replaced. A lock is moved aside and checked before it is replaced, and an owner
// releases only a lock that still holds its own token.
//
// reconcile --apply refuses while the lock is held (PASS_RUNNING). refresh leaves an "again" flag and
// ends, and the owner runs one more refresh pass on the same store before it lets go, up to MAX_PASSES
// in a row. If the owner fails or reaches the limit, the flag stays for the next refresh or sweep.
const LOCK_STALE_MS = 15 * 60 * 1000;
const LOCK_ABANDONED_MS = 6 * 60 * 60 * 1000;
const MAX_PASSES = 5;
const LOCK_SCHEMA = 'toolkit.programme-pass-lock.v1';

function defaultLockFile(repository = '') {
  const key = crypto.createHash('sha256').update(String(repository).toLowerCase()).digest('hex').slice(0, 12);
  return path.join(os.homedir(), '.ai-agent-toolkit', 'user-state', 'programme-refresh', `pass-${key}.lock`);
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; }
}

function readLock(file) {
  let info;
  try { info = fs.lstatSync(file); } catch { return { missing: true }; }
  if (!info.isFile()) return { broken: true, mtimeMs: info.mtimeMs };
  let lock = null;
  try { lock = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* unreadable: broken */ }
  if (!lock || lock.schema !== LOCK_SCHEMA || typeof lock.token !== 'string') return { broken: true, mtimeMs: info.mtimeMs };
  return { lock, mtimeMs: info.mtimeMs };
}

// held, free or stale, with what was seen so a replacement can check it moved the same lock.
function lockState(file, nowMs, alive = pidAlive) {
  const seen = readLock(file);
  if (seen.missing) return { free: true };
  if (seen.broken) return { stale: true, seen };
  const silent = nowMs - seen.mtimeMs;
  const gone = seen.lock.host === os.hostname()
    ? !alive(seen.lock.pid) || silent > LOCK_ABANDONED_MS
    : silent > LOCK_STALE_MS || silent < -LOCK_STALE_MS;
  return gone ? { stale: true, seen } : { held: true, seen };
}

// Returns a handle { token, owns(), beat(), release() }, or null while another live pass holds the
// lock. A null file means no lock (tests that bring their own GitHub).
function takeLock(file, deps = {}) {
  if (!file) return { token: null, owns: () => true, beat() {}, release() {} };
  const now = () => (deps.nowMs === undefined ? Date.now() : deps.nowMs);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const token = crypto.randomBytes(16).toString('hex');
  const owns = () => readLock(file).lock?.token === token;
  const handle = {
    token,
    owns,
    beat() { try { if (owns()) { const at = new Date(); fs.utimesSync(file, at, at); } } catch { /* the next beat retries */ } },
    release() { try { if (owns()) fs.unlinkSync(file); } catch { /* already gone */ } },
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // Written whole first, then linked into place: the link fails while any lock is there, and a
    // reader never sees a half-written lock.
    const draft = `${file}.${token}.draft`;
    fs.writeFileSync(draft, JSON.stringify({ schema: LOCK_SCHEMA, token, pid: process.pid, host: os.hostname(), at: new Date(now()).toISOString() }), { mode: 0o600 });
    try {
      fs.linkSync(draft, file);
      return handle;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    } finally {
      try { fs.unlinkSync(draft); } catch { /* gone */ }
    }
    const seen = lockState(file, now(), deps.pidAlive);
    if (seen.free) continue;
    if (seen.held) return null;
    // Stale: move it aside, then make sure what moved is what was judged stale.
    const aside = `${file}.stale-${token}`;
    try { fs.renameSync(file, aside); } catch { continue; }
    const moved = readLock(aside);
    const same = seen.seen.broken ? Boolean(moved.broken) : moved.lock?.token === seen.seen.lock.token;
    if (!same) {
      // A live pass took the lock in between: put its lock back and step aside.
      try { fs.linkSync(aside, file); } catch { /* a third pass holds it */ }
      try { fs.unlinkSync(aside); } catch { /* gone */ }
      return null;
    }
    try { fs.rmSync(aside, { recursive: true, force: true }); } catch { /* left beside the lock */ }
  }
  return null;
}

const againFile = file => `${file}.again`;
const flagged = file => Boolean(file) && fs.existsSync(againFile(file));
function setAgain(file) { fs.writeFileSync(againFile(file), `${new Date().toISOString()}\n`, { mode: 0o600 }); }
function clearAgain(file) { try { fs.unlinkSync(againFile(file)); } catch { /* not set */ } }

function lockMinutes(file, nowMs = Date.now()) {
  const at = Date.parse(readLock(file).lock?.at || '');
  return Number.isFinite(at) ? Math.max(0, Math.round((nowMs - at) / 60000)) : null;
}

function readJsonFile(file, what) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); }
  catch (error) { throw usage(`The ${what} file could not be read as JSON: ${error.message}`); }
}

function runGit(gitPath, cwd, args) {
  const result = spawnSync(gitPath, args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 30000 });
  if (result.error || result.status !== 0) throw new ProgrammeError('GIT_FAILED', `git ${args.join(' ')} failed: ${String(result.stderr || result.error?.message || '').trim()}`);
  return result.stdout.trim();
}

// Refuses unless the Toolkit governance state for the repository is ENABLED with the governed block and
// binding present. The state module ships with the plugin; without it nothing can show the repository
// is ENABLED, so the command refuses.
function requireGitHubGovernance(repoRoot) {
  let governance;
  try { governance = require('../../../repo/scripts/toolkit-governance-state.cjs'); } catch {
    throw new ProgrammeError('GOVERNANCE_STATE_UNAVAILABLE', 'The Toolkit governance state could not be read from this copy, so no programme command runs. Use a full Toolkit install.');
  }
  const current = governance.governanceState(repoRoot);
  if (current.state === 'ENABLED' && current.governed_rules_bind) return;
  throw new ProgrammeError('GITHUB_GOVERNANCE_OFF', `Toolkit's GitHub governance is ${current.state === 'ENABLED' ? 'ENABLED but incomplete (the governed block or binding is missing)' : current.state} for this repository, so no programme command runs. Nothing changed.`);
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
  // GitHub governance must be ENABLED with its materials in place; a DISABLED or undecided repository
  // never runs programme commands, whatever files it carries. Tests that supply the origin own the state.
  if (!deps.originUrl) requireGitHubGovernance(repoRoot);
  const binding = deps.binding || state.loadBinding(repoRoot);
  const base = deps.transport || new state.GitHubTransport({ ghPath: state.resolveExecutable('gh') });
  // A pass that holds the lock checks it still does, and renews it, before every GitHub request.
  const transport = deps.heartbeat ? Object.assign(Object.create(base), { request: (...call) => { deps.heartbeat(); return base.request(...call); } }) : base;
  const repository = state.bindRepository({ transport, originUrl, binding });
  const version = deps.toolkitVersion === undefined ? toolkitVersion() : deps.toolkitVersion;
  const store = new state.STORE_BACKENDS[binding.store.kind]({ transport, store: binding.store, now: deps.now, toolkitVersion: version });
  store.verify();
  // The session comes from --session only; an inherited environment never makes a session a writer.
  const writer = args.session ? { session: args.session, prefix: args.prefix || binding.writer_prefix } : null;
  return { binding, transport, repository, store, writer, version, repoRoot };
}

function requireWriter(context) {
  if (!context.writer) throw new ProgrammeError('WRITER_UNKNOWN', 'This write needs --session <this session\'s own id>.');
  return context.writer;
}

// A writer whose prefix is not the binding's writer prefix is a lane controller.
const isLane = (context, writer) => writer.prefix !== context.binding.writer_prefix;

// Every controller write except creating the parent and a deliberate parent takeover needs the
// writing session to hold the parent document.
function requireParentHolder(context, parentDoc) {
  const writer = requireWriter(context);
  if (state.isHolder(parentDoc, writer)) return writer;
  if (isLane(context, writer)) {
    throw new ProgrammeError('ROLE_REFUSED', `A lane controller (${writer.prefix}) writes only the child the catalogue delegates to it, with assign and interrupt; every other write is the controller's.`);
  }
  throw new ProgrammeError('STALE_WRITER', state.parentRefusal(parentDoc));
}

// assign and interrupt: the parent's holder, or the lane controller holding a child delegated to it.
function requireGateWriter(context, parentDoc, child, outcome) {
  const writer = requireWriter(context);
  if (state.isHolder(parentDoc, writer) || state.isLaneHolder(child, writer, outcome)) return writer;
  return requireParentHolder(context, parentDoc);
}

function outcomeFor(parentDoc, issue) {
  const outcome = parentDoc.outcomes.find(entry => entry.issue === issue);
  if (!outcome) throw usage(`#${issue} is not in the outcome catalogue of #${parentDoc.parent_issue}.`);
  return outcome;
}

function readParent(context) {
  const { doc } = context.store.read('parent', context.binding.parent_issue);
  if (!doc) throw new ProgrammeError('PARENT_STATE_MISSING', `No parent state document for #${context.binding.parent_issue} yet. The appointed controller creates and holds it with init-parent --apply --controller; other sessions report this to the controller.`);
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

// Marks every journal already in the store as read, so a handover never reports the previous
// assignment's earlier checkpoints as late; only a checkpoint written after this point is.
function markJournalsSeen(doc, files) {
  if (!files.length) return doc;
  doc.journals_seen = { ...(doc.journals_seen || {}), ...Object.fromEntries(files.map(file => [file.name, file.sha])) };
  return doc;
}

const escapeRegExp = text => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A takeover is verified from its record: a comment on the bound parent issue, by this same account,
// carrying a decision ID with this writer's prefix, naming the epoch it takes over, and posted after
// the parent document was last written. The tool cannot see whether another session stopped; the
// record must say so.
function verifyTakeoverRecord(context, parentDoc, commentId, writer) {
  const refuse = detail => new ProgrammeError('TAKEOVER_UNVERIFIED', `The takeover record was not verified: ${detail}. Nothing changed. The new controller posts a takeover record on #${context.binding.parent_issue} (decision ID with ${writer.prefix}, the epoch it takes over, evidence that the previous writer stopped) and passes its comment ID.`);
  if (!/^\d+$/.test(String(commentId || ''))) throw refuse('no comment ID was given');
  const comment = context.transport.request('GET', `repos/${context.repository}/issues/comments/${commentId}`);
  if (comment.status !== 200 || !comment.json) throw refuse(`comment ${commentId} could not be read (${comment.status})`);
  const onParent = new RegExp(`/repos/${escapeRegExp(context.repository)}/issues/${context.binding.parent_issue}$`, 'i').test(String(comment.json.issue_url || ''));
  if (!onParent) throw refuse(`comment ${commentId} is not on #${context.binding.parent_issue}`);
  const user = context.transport.request('GET', 'user');
  const login = String(user.json?.login || '');
  if (user.status !== 200 || !login || String(comment.json.user?.login || '').toLowerCase() !== login.toLowerCase()) throw refuse('it was not posted by the account running this command');
  const body = String(comment.json.body || '');
  if (!new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(writer.prefix)}\\d+`).test(body)) throw refuse(`it carries no decision ID with ${writer.prefix}`);
  const epochs = [...body.matchAll(/\bepoch\s*[:=#]?\s*(\d+)/gi)].map(match => Number(match[1]));
  if (!epochs.includes(parentDoc.fence.epoch)) throw refuse(`it does not name epoch ${parentDoc.fence.epoch}, the one it takes over`);
  const lastWrite = context.store.lastCommitDate('parent', context.binding.parent_issue);
  const posted = Date.parse(comment.json.created_at || '');
  if (!lastWrite || !Number.isFinite(posted) || posted <= Date.parse(lastWrite)) throw refuse('it is older than the parent document\'s last write');
  return { comment_id: Number(commentId), from_epoch: parentDoc.fence.epoch };
}

// The live PR head for a G1 acceptance check; null when no PR is found.
function liveHead(context, child) {
  const reader = new state.ProgrammeGraphReader({ transport: context.transport, repository: context.repository });
  const number = child.pr.number || (child.candidate.branch ? reader.pullRequestForBranch(child.candidate.branch) : null);
  return number ? reader.pullRequest(number)?.head || null : null;
}

const commands = {
  reconcile(args, context) {
    if (args.apply) requireParentHolder(context, readParent(context));
    if (args.apply && args['parent-file']) throw usage('--parent-file is for dry runs only.');
    const reconciler = new state.Reconciler({
      store: context.store,
      reader: new state.ProgrammeGraphReader({ transport: context.transport, repository: context.repository }),
      mutator: new state.GitHubMutator({ transport: context.transport, repository: context.repository }),
      binding: context.binding, writer: context.writer, toolkitVersion: context.version,
    });
    const parentOverride = args['parent-file'] ? readJsonFile(args['parent-file'], 'parent') : null;
    return reconciler.run({ apply: Boolean(args.apply), issue: args.issue ?? null, parentOverride });
  },

  // The same full pass as `reconcile --apply`, for any session in a governed checkout. It takes no
  // session, patch or verdict: it writes under the session that holds the parent now, so it can only
  // bring the pages and documents in line with what is already recorded and observed. Every decision
  // (assign, return, update, claim) stays the controller's. After a takeover the guard stops it at its
  // next effect, as it stops the controller's own pass.
  refresh(args, context) {
    const parentDoc = readParent(context);
    const { holder_session: session, holder_prefix: prefix } = parentDoc.fence;
    if (!session || prefix !== context.binding.writer_prefix) {
      throw new ProgrammeError('PARENT_UNHELD', `The parent document of #${context.binding.parent_issue} has no controller holding it, so there is no one to refresh for. Nothing changed; report this to the controller.`);
    }
    context.writer = { session, prefix };
    return commands.reconcile({ ...args, apply: true }, context);
  },

  show(args, context) {
    const kind = args.issue ? 'child' : 'parent';
    const { doc, sha } = context.store.read(kind, args.issue || context.binding.parent_issue);
    if (!doc) throw new ProgrammeError('STATE_MISSING', `No state document for #${args.issue || context.binding.parent_issue}.`);
    return { blob: sha, document: args['include-private'] ? doc : redact(doc) };
  },

  'init-parent'(args, context) {
    if (!args.catalogue) throw usage('init-parent needs --catalogue <file>.');
    const catalogue = readJsonFile(args.catalogue, 'catalogue');
    const doc = state.newParent({ repository: context.repository, parentIssue: context.binding.parent_issue, outcomes: catalogue.outcomes || [], releasePlan: catalogue.release_plan || null });
    if (!args.apply) {
      const errors = state.validateParent(doc);
      try { state.refuseNewLegacy(null, doc); } catch (error) { errors.push(error.message); }
      return { mode: 'dry-run', valid: !errors.length, errors, document: doc };
    }
    state.refuseNewLegacy(null, doc);
    const writer = requireWriter(context);
    if (context.store.read('parent', context.binding.parent_issue).doc) throw new ProgrammeError('STATE_EXISTS', 'The parent state document already exists. Only its holder, the appointed controller, changes it.');
    doc.fence = { epoch: 1, holder_prefix: writer.prefix, holder_session: writer.session };
    const result = context.store.write('parent', context.binding.parent_issue, doc, { sha: null, previous: null });
    return writeResult('parent', context.binding.parent_issue, result, writer);
  },

  'update-parent'(args, context) {
    if (!args.patch) throw usage('update-parent needs --patch <file>.');
    const writer = requireParentHolder(context, readParent(context));
    const patch = readJsonFile(args.patch, 'patch');
    const result = context.store.mutate('parent', context.binding.parent_issue, { writer, change: doc => state.applyPatch('parent', doc, patch) });
    return writeResult('parent', context.binding.parent_issue, result, writer);
  },

  claim(args, context) {
    const writer = requireWriter(context);
    const parentDoc = readParent(context);
    if (args.lane) {
      const outcome = outcomeFor(parentDoc, args.issue);
      const result = context.store.mutate('child', args.issue, {
        writer, authorise: false, create: () => state.newChild({ repository: context.repository, outcome }),
        change: doc => state.claimLane(doc, writer, outcome, { takeover: Boolean(args.takeover) }),
      });
      return writeResult('child', args.issue, result, writer);
    }
    const retired = Array.isArray(parentDoc.private?.retired_holders) ? parentDoc.private.retired_holders : [];
    if (retired.includes(writer.session)) throw new ProgrammeError('STALE_WRITER', state.parentRefusal(parentDoc));
    if (isLane(context, writer)) throw new ProgrammeError('ROLE_REFUSED', `A lane controller (${writer.prefix}) never holds the parent document.`);
    const heldByOther = Boolean(parentDoc.fence.holder_session) && !state.isHolder(parentDoc, writer);
    let record = null;
    if (heldByOther && args.takeover) record = verifyTakeoverRecord(context, parentDoc, args['takeover-record'], writer);
    const result = context.store.mutate('parent', context.binding.parent_issue, { writer, authorise: false, change: doc => {
      if (record && doc.fence.epoch !== record.from_epoch) throw new ProgrammeError('TAKEOVER_UNVERIFIED', `The parent moved to epoch ${doc.fence.epoch} after the takeover record named epoch ${record.from_epoch}. Nothing changed.`);
      const previous = doc.fence.holder_session;
      const next = state.claimDocument(doc, writer, { takeover: Boolean(args.takeover) });
      if (!next || !record) return next;
      const holders = Array.isArray(next.private.retired_holders) ? next.private.retired_holders : [];
      const takeovers = Array.isArray(next.private.takeovers) ? next.private.takeovers : [];
      next.private = { ...next.private, retired_holders: [...holders, previous].slice(-20), takeovers: [...takeovers, record].slice(-20) };
      return next;
    } });
    const output = writeResult('parent', context.binding.parent_issue, result, writer);
    if (record) {
      const unsettled = [parentDoc, ...parentDoc.outcomes.map(outcome => context.store.read('child', outcome.issue).doc).filter(Boolean)]
        .reduce((count, doc) => count + doc.pending_effects.length, 0);
      output.next_action = unsettled
        ? `Controller: run reconcile --apply --controller to settle ${unsettled} earlier intent(s) by readback before any other write`
        : 'Controller: run reconcile (a dry run) and continue';
    }
    return output;
  },

  assign(args, context) {
    const parentDoc = readParent(context);
    const outcome = outcomeFor(parentDoc, args.issue);
    const writer = requireGateWriter(context, parentDoc, context.store.read('child', args.issue).doc, outcome);
    const files = context.store.listJournals(args.issue);
    const result = context.store.mutate('child', args.issue, {
      writer, parentDoc, create: () => state.newChild({ repository: context.repository, outcome }),
      change: doc => {
        const next = state.assignGate(doc, { assignment: args.assignment, role: args.role, supersede: Boolean(args.supersede), reason: args.reason || null });
        return next && markJournalsSeen(next, files);
      },
    });
    return writeResult('child', args.issue, result, writer);
  },

  reopen(args, context) {
    const parentDoc = readParent(context);
    const writer = requireParentHolder(context, parentDoc);
    const files = context.store.listJournals(args.issue);
    const result = context.store.mutate('child', args.issue, { writer, parentDoc,
      change: doc => markJournalsSeen(state.reopenGate(doc, { reason: args.reason, assignment: args.assignment || null }), files) });
    return writeResult('child', args.issue, result, writer);
  },

  interrupt(args, context) {
    const parentDoc = readParent(context);
    const outcome = outcomeFor(parentDoc, args.issue);
    const writer = requireGateWriter(context, parentDoc, context.store.read('child', args.issue).doc, outcome);
    const files = context.store.listJournals(args.issue);
    const result = context.store.mutate('child', args.issue, { writer, parentDoc,
      change: doc => markJournalsSeen(state.interruptGate(doc, { reason: args.reason }), files) });
    return writeResult('child', args.issue, result, writer);
  },

  update(args, context) {
    if (!args.issue || !args.patch) throw usage('update needs --issue <n> and --patch <file>.');
    const parentDoc = readParent(context);
    const writer = requireParentHolder(context, parentDoc);
    const patch = readJsonFile(args.patch, 'patch');
    const result = context.store.mutate('child', args.issue, { writer, parentDoc, change: doc => state.applyPatch('child', doc, patch, { writer, parentDoc }) });
    return writeResult('child', args.issue, result, writer);
  },

  return(args, context) {
    const parentDoc = readParent(context);
    const writer = requireParentHolder(context, parentDoc);
    let change;
    if (args.record) {
      change = doc => state.recordReturn(doc, { returnId: args.record, assignment: args.assignment, atHead: args['at-head'] || null });
    } else {
      const child = context.store.read('child', args.issue).doc;
      const head = child && args.verdict === 'ACCEPT' && child.gate.role === 'G1' ? liveHead(context, child) : undefined;
      change = doc => state.consumeReturn(doc, { returnId: args.consume, verdict: args.verdict, writer, parentDoc, liveHead: head });
    }
    const result = context.store.mutate('child', args.issue, { writer, parentDoc, change });
    return writeResult('child', args.issue, result, writer);
  },

  // An executor binds its own session to the controller's current assignment and opens its journal.
  bind(args, context, deps) {
    const hash = checkpoint.sessionHash(args.session);
    const child = context.store.read('child', args.issue).doc;
    if (!child) throw new ProgrammeError('STATE_MISSING', `#${args.issue} has no state document yet; the controller assigns the gate first.`);
    const gate = child.gate;
    if (gate.assignment?.id !== args.assignment || !['ASSIGNED', 'ACTIVE'].includes(gate.state)) {
      throw new ProgrammeError('STALE_ASSIGNMENT', `Assignment ${args.assignment} is not open on #${args.issue} (current: ${gate.assignment?.id || 'none'}, ${gate.state || 'no gate'}). Report to the controller.`);
    }
    const files = context.store.listJournals(args.issue);
    const elsewhere = files.filter(file => file.assignment === args.assignment && file.session_hash !== hash);
    if (elsewhere.length || (gate.session_id && gate.session_id !== hash)) {
      throw new ProgrammeError('DUPLICATE_SESSION', `Another session is already bound to assignment ${args.assignment}. Nothing was written; report to the controller.`);
    }
    const route = args.model || args.effort ? { model: args.model || null, effort: args.effort || null, read_back: Boolean(args['route-read-back']) } : null;
    const facts = checkpoint.collectFacts(context.repoRoot, deps);
    const name = `${args.assignment}--${hash}.json`;
    const { doc: previous, sha } = context.store.readJournal(args.issue, name);
    const next = previous
      ? checkpoint.nextJournal(previous, { facts, route }).doc
      : checkpoint.newJournal({ repository: context.repository, issue: args.issue, assignment: args.assignment, hash, route, facts });
    const result = next ? context.store.writeJournal(args.issue, name, next, { sha, previous }) : { outcome: 'NOOP', doc: previous };
    checkpoint.writeLocalBinding({ session_hash: hash, repository: context.repository, issue: args.issue, assignment: args.assignment,
      repo_root: path.resolve(context.repoRoot), bound_at: (deps.now || (() => new Date().toISOString()))() }, deps);
    return { journal: name, outcome: result.outcome, seq: result.doc?.seq ?? null, acting: { session_hash: hash, issue: args.issue, assignment: args.assignment } };
  },
};

// Commands that never open the repository context: a checkpoint reads only the local binding (and
// writes the journal), and `show --session` reads only local files.
const localCommands = {
  checkpoint(args, deps) {
    const message = args['message-file'] ? fs.readFileSync(args['message-file'], 'utf8') : null;
    const result = checkpoint.runCheckpoint({ sessionId: args.session, message }, deps);
    if (result.outcome === 'UNBOUND') throw new ProgrammeError('NOT_BOUND', 'This session is not bound to an assignment in a repository with the reconciler binding; nothing was written.');
    return result;
  },

  show(args, deps) {
    const hash = checkpoint.sessionHash(args.session);
    const binding = checkpoint.readLocalBinding(hash, deps);
    const errors = checkpoint.readErrors(hash, deps);
    return { session_hash: hash, binding: binding ? { ...binding, repo_root: args['include-private'] ? binding.repo_root : '(redacted)' } : null, errors };
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

// A session a Toolkit launcher started (a gate or a pinned helper) is an executor, whatever flags it
// passes: it never writes programme state.
const EXECUTOR_MARKERS = Object.freeze(['TOOLKIT_GATE_ROLE', 'TOOLKIT_NATIVE_HELPER_BINDING']);

function main(argv = process.argv.slice(2), deps = {}) {
  const out = deps.stdout || process.stdout;
  const args = parseArgs(argv);
  const environment = deps.environment || process.env;
  const marker = EXECUTOR_MARKERS.find(name => typeof environment[name] === 'string' && environment[name] !== '');
  if (marker && isWrite(args)) {
    throw usage(`This session was started by a Toolkit launcher (${marker}), so it is an executor: it never writes programme state, even with --controller. Run reconcile (a dry run) or show and report to the controller.`);
  }
  if ((args.command === 'reconcile' && args.apply) || args.command === 'refresh') return runPasses(args, deps, out);
  return finish(args, deps, out);
}

// reconcile --apply and refresh hold the repository's pass lock. The owner runs one more refresh pass
// for each change that came in while it ran, then lets go.
function runPasses(args, deps, out) {
  const beat = { fn: () => {} };
  const passDeps = { ...deps, heartbeat: () => beat.fn() };
  const context = openContext(args, passDeps);
  const file = deps.lockFile !== undefined ? deps.lockFile : (deps.originUrl ? null : defaultLockFile(context.binding.repository));
  let lock = takeLock(file, deps);
  if (!lock && args.command !== 'refresh') {
    throw new ProgrammeError('PASS_RUNNING', `Another reconcile or refresh pass for ${context.binding.repository} is running on this computer. Nothing changed; run again when it ends.`);
  }
  if (!lock) {
    setAgain(file);
    lock = takeLock(file, deps);
    if (!lock) {
      const minutes = lockMinutes(file, deps.nowMs);
      const reason = `another pass for ${context.binding.repository} is running on this computer${minutes === null ? '' : ` (started ${minutes} min ago)`}; it runs once more when it ends, so this change reaches the pages then (if that pass fails or a long burst reaches the limit, the next refresh or the hourly sweep does)`;
      out.write(args.json ? `${JSON.stringify({ outcome: 'QUEUED', reason }, null, 2)}\n` : `Refresh queued: ${reason}.\n`);
      return 0;
    }
  }
  let code = 0;
  let passes = 0;
  while (lock) {
    const held = lock;
    beat.fn = () => {
      if (!held.owns()) throw new ProgrammeError('PASS_LOCK_LOST', `Another pass took over the lock for ${context.binding.repository} while this one ran, so this pass stopped before its next GitHub request. The next refresh or the hourly sweep finishes the work.`);
      held.beat();
    };
    try {
      do {
        clearAgain(file);
        const passArgs = passes === 0 ? args : { command: 'refresh', json: args.json, 'repo-root': args['repo-root'] };
        // Later passes reuse the same store, which remembers its own writes through GitHub's read lag.
        if (passes > 0 && !args.json) out.write('\nA change came in during that pass, so the pages are refreshed once more.\n');
        code = Math.max(code, finish(passArgs, deps, out, context));
        passes += 1;
      } while (flagged(file) && passes < MAX_PASSES);
    } finally {
      lock.release();
    }
    // A change can be flagged between the last check and the release: take the lock back for it.
    lock = flagged(file) && passes < MAX_PASSES ? takeLock(file, deps) : null;
  }
  return code;
}

function finish(args, deps, out, opened = null) {
  let result;
  const local = args.command === 'checkpoint' || (args.command === 'show' && args.session && !args.parent && args.issue === undefined);
  if (local) result = localCommands[args.command](args, deps);
  else {
    const context = opened || openContext(args, deps);
    result = commands[args.command](args, context, deps);
  }
  const pass = args.command === 'reconcile' || args.command === 'refresh';
  if (pass && !args.json) out.write(formatReport(result));
  else out.write(`${JSON.stringify(result, null, 2)}\n`);
  if (pass) return result.holds.length ? 1 : 0;
  return 0;
}

if (require.main === module) {
  try { process.exitCode = main(); }
  catch (error) {
    console.error(`${error.code || 'FAIL'}: ${error.message}`);
    process.exitCode = 2;
  }
}

module.exports = Object.freeze({ parseArgs, toolkitVersion, takeLock, lockState, defaultLockFile, againFile, LOCK_STALE_MS, LOCK_ABANDONED_MS, MAX_PASSES, openContext, commands, localCommands, formatReport, main, verifyTakeoverRecord });
