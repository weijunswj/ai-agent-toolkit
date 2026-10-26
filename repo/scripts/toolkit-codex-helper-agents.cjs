#!/usr/bin/env node
'use strict';

// Renders the Codex G0/G1 helper custom agents from the pinned V3 stack registry for an
// explicitly selected stack, and installs them into a Codex agents directory. The registry
// stays the only source of model and effort; these files are projections that carry the
// registry digest they were rendered from.
//
// Codex custom agents (official subagents page, read 2026-10-23,
// https://learn.chatgpt.com/docs/agent-configuration/subagents.md): one standalone TOML file per
// agent under ~/.codex/agents/ (project copies under .codex/agents/); `name`, `description` and
// `developer_instructions` are required; `model` and `model_reasoning_effort` are optional, and
// "If a custom agent file sets model or model_reasoning_effort, the value in the file takes
// precedence". Provider, sandbox, approval and MCP servers always come from the parent, so
// this writer never writes them. It writes only those five keys.
// Model slugs and effort range (official models page, read 2026-10-23,
// https://learn.chatgpt.com/docs/models): `gpt-6-luna` is the CLI slug and GPT-6 Luna "supports
// reasoning efforts up to Max". The registry's lowercase `max` as the config spelling is not
// stated on that page; the host load check, not this file, decides it.
//
// Default is a dry run. --write backs up and replaces only files this generator manages
// (marked); any other file in the directory is left untouched. A host load check that
// rejects the new files restores the previous bytes automatically.
//
// Usage: node repo/scripts/toolkit-codex-helper-agents.cjs --stack <id> [--agents-dir <dir>] [--backup-root <dir>] [--write]

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { StackRegistrySnapshot, CapturedStackBinding } = require('./toolkit-stack-selection.cjs');
const { HostDialect } = require('./toolkit-v3-native-helper-adapter.cjs');
const { ROLES, roleSpec, roleInstructions } = require('./toolkit-claude-helper-spec.cjs');

const MARKER = '# ai-agent-toolkit:generated codex-helper-agent v1';
const REGISTRY_REL = 'repo/contracts/controller-kernel/stack-registry-v3.json';
const TOOLKIT_ROOT = path.resolve(__dirname, '..', '..');
const ROLE_KEYS = Object.freeze(Object.keys(ROLES));
const NOT_CHECKED = Object.freeze({ status: 'unverified', detail: 'Codex was not asked to load the helper agents, so they are written but not verified.' });
function fail(code) { throw Object.assign(new Error(code), { code }); }

// TOML basic string: quotes, backslashes and control characters escaped (TOML 1.0, section "String").
function tomlString(value) {
  return `"${String(value).replace(/[\\"\u0000-\u001f\u007f]/g, char => {
    const named = { '\\': '\\\\', '"': '\\"', '\n': '\\n', '\t': '\\t', '\r': '\\r', '\b': '\\b', '\f': '\\f' }[char];
    return named || `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`;
  })}"`;
}
// TOML multi-line literal string: kept verbatim, so it may not contain the closing delimiter.
function tomlLiteralBlock(value) {
  if (value.includes("'''")) fail('CODEX_HELPER_AGENT_TEXT_UNSUPPORTED');
  return `'''\n${value}'''`;
}

// Writes through a temporary file in the same folder, so Codex never reads a half-written agent.
function writeFileAtomically(file, text) {
  const temp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temp, text, { flag: 'wx' });
    fs.renameSync(temp, file);
  } catch (error) {
    fs.rmSync(temp, { force: true });
    throw error;
  }
}

// The Codex home Codex itself uses: CODEX_HOME, else ~/.codex.
function codexHome(environment = process.env) { return environment.CODEX_HOME || path.join(os.homedir(), '.codex'); }
function codexUserAgentsDirectory(environment = process.env) { return path.join(codexHome(environment), 'agents'); }
// Beside the Codex home's owning folder, like the Codex delegation backups, so an isolated home stays self-contained.
function defaultBackupRoot(environment = process.env) {
  return path.join(path.dirname(path.resolve(codexHome(environment))), '.ai-agent-toolkit', 'backups', 'codex-helper-agents');
}

class CodexHelperAgentRenderer {
  #binding; #reference;
  constructor(captured) { this.#binding = new CapturedStackBinding(captured); this.#reference = captured.source_capture.reference; }

  static fromRepository(stackId, repositoryRoot = TOOLKIT_ROOT) {
    if (typeof stackId !== 'string' || !stackId) fail('HELPER_AGENTS_STACK_SELECTION_REQUIRED');
    const bytes = fs.readFileSync(path.join(repositoryRoot, REGISTRY_REL));
    const reference = { id: 'stack-registry', repository: 'weijunswj/ai-agent-toolkit', revision: 'local-source', path: REGISTRY_REL,
      content_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      blob_sha1: crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') };
    const sourceCapture = { reference, content_base64: bytes.toString('base64') };
    return new CodexHelperAgentRenderer({ source_capture: sourceCapture, selection: new StackRegistrySnapshot(sourceCapture).resolve(stackId) });
  }

  render(role) {
    const spec = roleSpec(role);
    const { route } = this.#binding.role(spec.registryRole);
    // Codex can only route a helper to its own provider; a custom agent file cannot change the provider.
    if (!HostDialect.for('codex').supports(route)) fail('CODEX_NATIVE_ROUTE_UNSUPPORTED');
    const selection = this.#binding.selection;
    const instructions = [
      `# ${spec.title}`,
      '',
      '## Binding',
      `- Rendered from the Toolkit stack registry \`${this.#reference.path}\` (SHA-256 \`${this.#binding.sourceDigest}\`) for the explicitly selected stack \`${selection.profile_id}\`, role ${role}.Subagent (\`${spec.registryRole}\`): ${route.provider} \`${route.model}\` at \`${route.reasoning}\` effort.`,
      '- The registry is the only source of this model and effort. If this file and the registry disagree, the registry governs: report the difference and stop. Run `setup toolkit` to refresh this file.',
      '- This file grants no permission, scope or execution authority. Native permissions, the caller\'s assignment and Toolkit hooks still apply.',
      '',
      roleInstructions(spec),
    ].join('\n');
    const text = [
      MARKER,
      `# Stack \`${selection.profile_id}\`, registry SHA-256 ${this.#binding.sourceDigest}. Run setup toolkit to refresh; a refresh replaces edits made here and keeps a backup.`,
      `name = ${tomlString(spec.name)}`,
      `description = ${tomlString(spec.description)}`,
      `model = ${tomlString(route.model)}`,
      `model_reasoning_effort = ${tomlString(route.reasoning)}`,
      `developer_instructions = ${tomlLiteralBlock(instructions)}`,
      '',
    ].join('\n');
    return { file: `${spec.name}.toml`, text };
  }
}

// The stack a managed file names. A file that names none cannot be checked and is held.
const STACK_REFERENCE = /^# Stack `([A-Za-z0-9._-]+)`/m;
function stackReference(text) { return STACK_REFERENCE.exec(text)?.[1] || null; }
// Checks a helper agent Codex would load against a fresh rendering from the registry for the
// stack it names. Any byte difference, an unknown stack or an unrenderable route is a mismatch.
function matchesRenderedDefinition(role, text, repositoryRoot = TOOLKIT_ROOT) {
  if (typeof text !== 'string') return { matches: false, stack: null };
  const stack = stackReference(text);
  if (!stack) return { matches: false, stack: null };
  try { return { matches: CodexHelperAgentRenderer.fromRepository(stack, repositoryRoot).render(role).text === text, stack }; }
  catch { return { matches: false, stack }; }
}

class CodexAgentDirectoryInstaller {
  #dir; #files; #probe;
  // `probe(agentsDir)` asks Codex to load the agents and returns { status: verified | unverified | rejected, detail }.
  constructor(dir, files, { probe = () => NOT_CHECKED } = {}) { this.#dir = path.resolve(dir); this.#files = files; this.#probe = probe; }

  #read(file) { try { return fs.readFileSync(file, 'utf8'); } catch { return null; } }

  plan() {
    return this.#files.map(({ file, text }) => {
      const target = path.join(this.#dir, file);
      if (!fs.existsSync(target)) return { action: 'create', file };
      const current = this.#read(target);
      // Unreadable is treated as not Toolkit's, so it is never replaced.
      if (current === null || !current.startsWith(`${MARKER}\n`)) return { action: 'skip-unmanaged', file };
      return { action: current === text ? 'unchanged' : 'update', file };
    });
  }

  // Backs up every file it replaces, writes, reads back, then asks Codex to load the result.
  // A rejection restores the exact previous bytes (or removes files that did not exist) and fails.
  apply(backupRoot) {
    const actions = this.plan();
    if (actions.some(a => a.action === 'skip-unmanaged')) fail('HELPER_AGENTS_UNMANAGED_TARGET');
    const changing = actions.filter(a => a.action === 'create' || a.action === 'update');
    if (!changing.length) return { actions, backup_dir: null, load_check: null };
    const previous = new Map(changing.map(a => [a.file, a.action === 'update' ? fs.readFileSync(path.join(this.#dir, a.file)) : null]));
    let backupDir = null;
    if (changing.some(a => a.action === 'update')) {
      backupDir = path.join(backupRoot, new Date().toISOString().replace(/[:.]/g, '-'));
      fs.mkdirSync(backupDir, { recursive: true });
      for (const [file, bytes] of previous) if (bytes) fs.writeFileSync(path.join(backupDir, file), bytes, { flag: 'wx' });
    }
    fs.mkdirSync(this.#dir, { recursive: true });
    const written = [];
    try {
      for (const { file, text } of this.#files) {
        if (!previous.has(file)) continue;
        const target = path.join(this.#dir, file);
        // A concurrent edit since the plan is kept, never overwritten.
        const now = this.#read(target);
        if (previous.get(file) === null ? fs.existsSync(target) : now !== previous.get(file).toString('utf8')) fail('HELPER_AGENTS_CHANGED_DURING_WRITE');
        writeFileAtomically(target, text);
        written.push(file);
        if (this.#read(target) !== text) fail('HELPER_AGENTS_READBACK_MISMATCH');
      }
    } catch (error) {
      this.#restore(written, previous);
      throw error;
    }
    const verdict = this.#probe(this.#dir);
    if (verdict?.status === 'rejected') {
      this.#restore(written, previous);
      const error = new Error(`Codex did not load the Toolkit helper agents: ${verdict.detail || 'no detail'}. The previous files were restored${backupDir ? `; backup: ${backupDir}` : ''}.`);
      error.code = 'CODEX_HELPER_AGENTS_LOAD_FAILED';
      error.restored = true;
      throw error;
    }
    // Anything short of a verified load is reported as not verified, never as success.
    return { actions, backup_dir: backupDir, load_check: verdict?.status === 'verified' ? verdict : { status: 'unverified', detail: verdict?.detail || NOT_CHECKED.detail } };
  }

  // Puts back exactly what was there: the previous bytes, or no file. Then reads it back.
  #restore(files, previous) {
    for (const file of files) {
      const target = path.join(this.#dir, file), bytes = previous.get(file);
      if (bytes) writeFileAtomically(target, bytes);
      else fs.rmSync(target, { force: true });
      if (bytes ? !fs.readFileSync(target).equals(bytes) : fs.existsSync(target)) fail('CODEX_HELPER_AGENTS_RESTORE_FAILED');
    }
  }
}

const fileFor = role => `${ROLES[role].name}.toml`;

// Owns the user-level Codex helper agents. Each managed file names the stack it was rendered
// from, so the check renders that stack from the registry at repositoryRoot and compares bytes;
// no selection is stored. Project copies (.codex/agents) are compared and reported, never written.
class CodexHelperDefinitions {
  #environment; #repositoryRoot; #backupRoot; #probe;
  constructor({ environment = process.env, repositoryRoot = TOOLKIT_ROOT, backupRoot, probe } = {}) {
    this.#environment = environment || {};
    this.#repositoryRoot = repositoryRoot;
    this.#backupRoot = backupRoot || defaultBackupRoot(this.#environment);
    this.#probe = probe;
  }

  // Read-only. `projectDirectories` are agents directories (for example <project>/.codex/agents).
  check({ projectDirectories = [] } = {}) {
    const dir = codexUserAgentsDirectory(this.#environment);
    const { entries, projects, status, detail } = this.#assess(dir, projectDirectories);
    return { status, agents_dir: dir, files: entries.map(({ file, state, stack }) => ({ file, state, stack })), project_overrides: projects, detail };
  }

  // Installs the helpers for `stack` when none are installed, or refreshes stale ones to the
  // stack they name. Writes nothing when current or held.
  refresh({ stack } = {}) {
    const dir = codexUserAgentsDirectory(this.#environment);
    const assessed = this.#assess(dir, []);
    const install = assessed.status === 'not-installed' && typeof stack === 'string' && stack;
    if (assessed.status !== 'stale' && !install) return { status: assessed.status, backup_dir: null, load_check: null, detail: assessed.detail };
    const files = install ? ROLE_KEYS.map(role => CodexHelperAgentRenderer.fromRepository(stack, this.#repositoryRoot).render(role))
      : assessed.entries.filter(({ rendered }) => rendered !== null).map(({ file, rendered }) => ({ file, text: rendered }));
    const result = new CodexAgentDirectoryInstaller(dir, files, this.#probe ? { probe: this.#probe } : {}).apply(this.#backupRoot);
    return { status: install ? 'installed' : 'updated', backup_dir: result.backup_dir, load_check: result.load_check, detail: result.load_check.status === 'verified' ? '' : result.load_check.detail };
  }

  #assess(dir, projectDirectories) {
    const entries = this.#userEntries(dir);
    const projects = this.#projectOverrides(projectDirectories);
    if (entries.every(entry => !entry.present)) return { entries, projects, status: 'not-installed', detail: '' };
    const held = this.#holdDetail(entries, projects, dir);
    if (held) return { entries, projects, status: 'held', detail: held };
    if (entries.some(entry => entry.state === 'update' || entry.state === 'missing')) {
      return { entries, projects, status: 'stale', detail: `The Toolkit helper agents in ${dir} are out of date or incomplete. Run setup toolkit to refresh them.` };
    }
    return { entries, projects, status: 'current', detail: '' };
  }

  #holdDetail(entries, projects, dir) {
    const skipped = entries.find(entry => entry.state === 'skip-unmanaged');
    if (skipped) return `${skipped.file} in ${dir} was not written by Toolkit, so Toolkit will not replace it. Rename or remove it, then run setup toolkit.`;
    const broken = entries.find(entry => entry.state === 'unrenderable');
    if (broken && !broken.stack) return `${broken.file} is managed by Toolkit but names no stack, so Toolkit cannot tell which stack it came from. Rename or remove it, then run setup toolkit.`;
    if (broken) return `${broken.file} names stack ${broken.stack}, which the current stack registry cannot render for Codex.`;
    const orphan = entries.find(entry => entry.state === 'missing' && !entry.stack);
    if (orphan) return `${orphan.file} is missing, and no installed helper names a stack to render it from. Install the Toolkit helpers for a stack, then run setup toolkit.`;
    const drifted = projects.find(project => project.state === 'mismatch');
    if (drifted) return `the project copy ${drifted.file} does not match the selected stack. Codex may load a project agent with the same name instead, and Toolkit does not change project files; update or remove it.`;
    return '';
  }

  // One entry per role. A missing file takes the stack named by the other installed managed file.
  #userEntries(dir) {
    const installed = Object.fromEntries(ROLE_KEYS.map(role => [role, this.#installed(path.join(dir, fileFor(role)))]));
    const inheritedStack = role => ROLE_KEYS.filter(other => other !== role).map(other => installed[other])
      .filter(other => other.managed).map(other => stackReference(other.text)).find(Boolean) || null;
    return ROLE_KEYS.map(role => {
      const file = fileFor(role), own = installed[role];
      if (!own.present) {
        const stack = inheritedStack(role);
        const rendered = stack ? this.#render(role, stack) : null;
        return { role, file, present: false, state: stack && rendered === null ? 'unrenderable' : 'missing', stack, rendered };
      }
      if (!own.managed) return { role, file, present: true, state: 'skip-unmanaged', stack: null, rendered: null };
      const stack = stackReference(own.text);
      const rendered = stack ? this.#render(role, stack) : null;
      const state = rendered === null ? 'unrenderable' : rendered === own.text ? 'unchanged' : 'update';
      return { role, file, present: true, state, stack, rendered };
    });
  }

  #installed(file) {
    if (!fs.existsSync(file)) return { present: false, managed: false, text: null };
    let text = null;
    try { text = fs.readFileSync(file, 'utf8'); } catch { /* unreadable: left alone */ }
    return { present: true, managed: text !== null && text.startsWith(`${MARKER}\n`), text };
  }

  #render(role, stack) {
    try { return CodexHelperAgentRenderer.fromRepository(stack, this.#repositoryRoot).render(role).text; }
    catch { return null; } // an unknown or unrenderable stack is reported, never guessed
  }

  #projectOverrides(projectDirectories) {
    const overrides = [];
    for (const directory of new Set(projectDirectories.map(item => path.resolve(item)))) {
      for (const role of ROLE_KEYS) {
        const file = path.join(directory, fileFor(role));
        let text;
        try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
        overrides.push({ file, state: matchesRenderedDefinition(role, text, this.#repositoryRoot).matches ? 'unchanged' : 'mismatch' });
      }
    }
    return overrides;
  }
}

// Setup's lines for the Codex helper step. Setup refreshes installed helpers to the stack each file
// names and never picks a stack itself, so a computer without them is told how to install them.
// `checkout` is the Toolkit checkout as shown to the reader; setup passes its placeholder so
// the output names no local path.
function describeSetupResult(result, checkout = path.resolve(TOOLKIT_ROOT).replace(/\\/g, '/')) {
  const generator = `node "${checkout}/repo/scripts/toolkit-codex-helper-agents.cjs" --stack <stack> --write`;
  if (result.status === 'current') return ['Toolkit helpers: current.'];
  if (result.status === 'updated' || result.status === 'installed') {
    const backup = result.backup_dir ? ` (backup: ${result.backup_dir.replace(/\\/g, '/')})` : '';
    return [`Toolkit helpers: ${result.status} this run${backup}. Start a new Codex session to use them.`,
      ...(result.load_check?.status === 'verified' ? [] : [`Codex load check: ${result.detail || NOT_CHECKED.detail}`])];
  }
  if (result.status === 'not-installed') {
    return ['Toolkit helpers: not installed. In Toolkit-governed repositories Codex launches no helpers until they are.',
      `To install them for your selected stack: ${generator}`];
  }
  return [`Toolkit helpers: held: ${result.detail}`];
}

function parseArgs(argv, environment = process.env) {
  const args = { stack: null, agentsDir: codexUserAgentsDirectory(environment), write: false, backupRoot: defaultBackupRoot(environment) };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--stack') args.stack = argv[++i];
    else if (argv[i] === '--agents-dir') args.agentsDir = argv[++i];
    else if (argv[i] === '--backup-root') args.backupRoot = argv[++i];
    else if (argv[i] === '--write') args.write = true;
    else fail('HELPER_AGENTS_ARGUMENT_UNKNOWN');
  }
  if (!args.stack) fail('HELPER_AGENTS_STACK_SELECTION_REQUIRED');
  return args;
}

function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const renderer = CodexHelperAgentRenderer.fromRepository(args.stack);
  const installer = new CodexAgentDirectoryInstaller(args.agentsDir, ROLE_KEYS.map(role => renderer.render(role)));
  const result = args.write ? installer.apply(args.backupRoot) : { actions: installer.plan(), dry_run: true };
  process.stdout.write(`${JSON.stringify({ stack: args.stack, agents_dir: args.agentsDir, ...result }, null, 2)}\n`);
  return result;
}

if (require.main === module) {
  try { run(); } catch (error) { process.stderr.write(`${error.code || error.message}\n`); process.exitCode = 1; }
}

module.exports = Object.freeze({ CodexHelperAgentRenderer, CodexHelperDefinitions, CodexAgentDirectoryInstaller, MARKER,
  codexUserAgentsDirectory, describeSetupResult, matchesRenderedDefinition, parseArgs, run });
