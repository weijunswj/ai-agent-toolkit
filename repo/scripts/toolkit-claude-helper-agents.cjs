#!/usr/bin/env node
'use strict';

// Renders the Claude Code G0/G1 helper subagent definitions from the pinned V3
// stack registry for an explicitly selected stack, and installs them into a Claude
// agents directory. The registry stays the only source of model and effort; these
// files are projections that carry the registry digest they were rendered from.
//
// Default is a dry run. --write backs up and replaces only files this generator
// manages (marked) or the known legacy helper files it supersedes; any other file
// in the directory is left untouched.
//
// Usage: node repo/scripts/toolkit-claude-helper-agents.cjs --stack <id> [--agents-dir <dir>] [--write]

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { StackRegistrySnapshot, CapturedStackBinding } = require('./toolkit-stack-selection.cjs');
const { claudeNativeModel } = require('./toolkit-v3-native-helper-adapter.cjs');
const { ROLES, roleSpec, roleInstructions } = require('./toolkit-claude-helper-spec.cjs');

const MARKER = '<!-- ai-agent-toolkit:generated claude-helper-agent v1 -->';
const REGISTRY_REL = 'repo/contracts/controller-kernel/stack-registry-v3.json';
const LEGACY_FILES = Object.freeze(['toolkit-v3-g0-evidence.md', 'toolkit-v3-g1-bounded.md']);
const TOOLKIT_ROOT = path.resolve(__dirname, '..', '..');
const ROLE_KEYS = Object.freeze(Object.keys(ROLES));
const DAY_MS = 24 * 60 * 60 * 1000;
// Folder names the installer gives backups: its ISO timestamp with ':' and '.' replaced by '-'.
const BACKUP_NAME = /^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/;
function fail(code) { throw Object.assign(new Error(code), { code }); }

// Writes a helper definition through a temporary file in the same folder, so Claude Code never
// reads a half-written definition.
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

// The one owner of the Claude user agents directory: CLAUDE_CONFIG_DIR, else ~/.claude.
function claudeUserAgentsDirectory(environment = process.env) {
  return path.join(environment.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'agents');
}
function defaultBackupRoot() { return path.join(os.homedir(), '.ai-agent-toolkit', 'backups', 'claude-helper-agents'); }

class ClaudeHelperAgentRenderer {
  #binding; #reference;
  constructor(captured) { this.#binding = new CapturedStackBinding(captured); this.#reference = captured.source_capture.reference; }

  static fromRepository(stackId, repositoryRoot = path.resolve(__dirname, '..', '..')) {
    if (typeof stackId !== 'string' || !stackId) fail('HELPER_AGENTS_STACK_SELECTION_REQUIRED');
    const bytes = fs.readFileSync(path.join(repositoryRoot, REGISTRY_REL));
    const reference = { id: 'stack-registry', repository: 'weijunswj/ai-agent-toolkit', revision: 'local-source', path: REGISTRY_REL,
      content_sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      blob_sha1: crypto.createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') };
    const sourceCapture = { reference, content_base64: bytes.toString('base64') };
    return new ClaudeHelperAgentRenderer({ source_capture: sourceCapture, selection: new StackRegistrySnapshot(sourceCapture).resolve(stackId) });
  }

  render(role) {
    const spec = roleSpec(role);
    const { route } = this.#binding.role(spec.registryRole);
    const model = claudeNativeModel(route);
    const selection = this.#binding.selection;
    const text = [
      '---',
      `name: ${spec.name}`,
      `description: ${spec.description}`,
      `tools: ${spec.tools.join(', ')}`,
      `disallowedTools: ${spec.disallowed.join(', ')}`,
      `model: ${model}`,
      `effort: ${route.reasoning}`,
      'permissionMode: default',
      `maxTurns: ${spec.maxTurns}`,
      '---',
      '',
      MARKER,
      '',
      `# ${spec.title}`,
      '',
      '## Binding',
      `- Rendered from the Toolkit V3 stack registry \`${this.#reference.path}\` (SHA-256 \`${this.#binding.sourceDigest}\`) for the explicitly selected stack \`${selection.profile_id}\`, role ${role}.Subagent (\`${spec.registryRole}\`): ${route.provider} \`${route.model}\` at \`${route.reasoning}\` effort, native model \`${model}\`.`,
      '- The registry is the only source of this model and effort. If this file and the registry disagree, the registry governs: report the difference and stop. Run `setup toolkit` to refresh this file.',
      '- This file grants no permission, scope or execution authority. Native permissions, the caller\'s assignment and Toolkit hooks still apply.',
      '',
      roleInstructions(spec),
    ].join('\n');
    return { file: `${spec.name}.md`, text };
  }
}

// Checks a helper definition Claude Code would load against a fresh rendering from
// the registry for the stack it names. Any byte difference, an unknown stack or an
// unrenderable route is a mismatch; the definition never vouches for itself.
const STACK_REFERENCE = /explicitly selected stack `([A-Za-z0-9._-]+)`/;
function stackReference(text) { return STACK_REFERENCE.exec(text)?.[1] || null; }
function matchesRenderedDefinition(role, text, repositoryRoot) {
  if (typeof text !== 'string') return { matches: false, stack: null };
  const stack = stackReference(text);
  if (!stack) return { matches: false, stack: null };
  try { return { matches: ClaudeHelperAgentRenderer.fromRepository(stack, repositoryRoot).render(role).text === text, stack }; }
  catch { return { matches: false, stack }; }
}

class AgentDirectoryInstaller {
  #dir; #files;
  constructor(dir, files) { this.#dir = path.resolve(dir); this.#files = files; }

  #managed(file) {
    try { return fs.readFileSync(file, 'utf8').includes(MARKER); } catch { return false; }
  }

  plan() {
    const actions = [];
    for (const { file, text } of this.#files) {
      const target = path.join(this.#dir, file);
      if (!fs.existsSync(target)) actions.push({ action: 'create', file });
      else if (!this.#managed(target)) actions.push({ action: 'skip-unmanaged', file });
      else actions.push({ action: fs.readFileSync(target, 'utf8') === text ? 'unchanged' : 'update', file });
    }
    for (const legacy of LEGACY_FILES) if (fs.existsSync(path.join(this.#dir, legacy))) actions.push({ action: 'retire-legacy', file: legacy });
    return actions;
  }

  // Backs up every file it will replace or retire before writing.
  apply(backupRoot) {
    const actions = this.plan();
    if (actions.some(a => a.action === 'skip-unmanaged')) fail('HELPER_AGENTS_UNMANAGED_TARGET');
    const changing = actions.filter(a => ['update', 'retire-legacy'].includes(a.action));
    let backupDir = null;
    if (changing.length) {
      backupDir = path.join(backupRoot, new Date().toISOString().replace(/[:.]/g, '-'));
      fs.mkdirSync(backupDir, { recursive: true });
      for (const a of changing) fs.copyFileSync(path.join(this.#dir, a.file), path.join(backupDir, a.file));
    }
    fs.mkdirSync(this.#dir, { recursive: true });
    for (const { file, text } of this.#files) {
      const a = actions.find(x => x.file === file);
      if (a.action === 'create' || a.action === 'update') writeFileAtomically(path.join(this.#dir, file), text);
    }
    for (const a of actions.filter(x => x.action === 'retire-legacy')) fs.rmSync(path.join(this.#dir, a.file));
    for (const { file, text } of this.#files) if (fs.readFileSync(path.join(this.#dir, file), 'utf8') !== text) fail('HELPER_AGENTS_READBACK_MISMATCH');
    return { actions, backup_dir: backupDir };
  }
}

const fileFor = role => `${ROLES[role].name}.md`;
const publicEntry = ({ file, state, stack }) => ({ file, state, stack });
const backupTime = name => Date.parse(name.replace(BACKUP_NAME, '$1:$2:$3.$4Z'));

// The first reason the installed helpers cannot be refreshed or trusted, as one plain sentence; '' when none.
function holdDetail(entries, projects, dir) {
  const skipped = entries.find(entry => entry.state === 'skip-unmanaged');
  if (skipped) return `${skipped.file} in ${dir} was not written by Toolkit, so Toolkit will not replace it. Rename or remove it, then run setup toolkit.`;
  const broken = entries.find(entry => entry.state === 'unrenderable');
  if (broken && !broken.stack) return `${broken.file} is managed by Toolkit but names no stack, so Toolkit cannot tell which stack it came from. Rename or remove it, then run setup toolkit.`;
  if (broken && broken.present) return `${broken.file} names stack ${broken.stack}, which the current stack registry cannot render.`;
  if (broken) return `${broken.file} is missing and the installed helpers name stack ${broken.stack}, which the current stack registry cannot render.`;
  const orphan = entries.find(entry => entry.state === 'missing' && !entry.stack);
  if (orphan) return `${orphan.file} is missing, and no installed helper names a stack to render it from. Install the Toolkit helpers for a stack, then run setup toolkit.`;
  const drifted = projects.find(project => project.state === 'mismatch');
  if (drifted) return `the project copy ${drifted.file} does not match the selected stack. Toolkit does not change project files; update or remove it.`;
  return '';
}

// Owns the user-level helper definitions. Each installed managed file names the stack it was
// rendered from, so the check renders that stack from the registry at repositoryRoot and compares
// bytes; no selection is stored. Project copies are compared and reported, never written. Refresh
// touches user-level files only, and only when they are stale.
class ClaudeHelperDefinitions {
  #environment; #repositoryRoot; #backupRoot; #retentionDays; #now;
  constructor({ environment = process.env, repositoryRoot = TOOLKIT_ROOT, backupRoot = defaultBackupRoot(),
    retentionDays = 7, now = () => new Date() } = {}) {
    this.#environment = environment || {};
    this.#repositoryRoot = repositoryRoot;
    this.#backupRoot = backupRoot;
    this.#retentionDays = retentionDays;
    this.#now = now;
  }

  // Read-only. `projectDirectories` are agents directories (for example <project>/.claude/agents); the
  // helper copies inside them are compared and reported, never written.
  check({ projectDirectories = [] } = {}) {
    const dir = claudeUserAgentsDirectory(this.#environment);
    const { entries, projects, status, detail } = this.#assess(dir, projectDirectories);
    return { status, agents_dir: dir, files: entries.map(publicEntry), project_overrides: projects, detail };
  }

  // Rewrites the user-level files when they are stale; otherwise writes nothing. Always prunes old backups;
  // a prune failure is returned as prune_warning, since the definitions themselves are already settled.
  refresh() {
    const dir = claudeUserAgentsDirectory(this.#environment);
    const { entries, status, detail } = this.#assess(dir, []);
    const files = entries.map(publicEntry);
    let result = { status, backup_dir: null, files, detail };
    if (status === 'stale') {
      // A folder holding only the retired definitions has nothing to render; the installer backs them up and removes them.
      const files = entries.filter(({ rendered }) => rendered !== null).map(({ file, rendered }) => ({ file, text: rendered }));
      const { backup_dir } = new AgentDirectoryInstaller(dir, files).apply(this.#backupRoot);
      result = { status: 'updated', backup_dir, files, detail: '' };
    }
    try { this.#pruneBackups(result.backup_dir); }
    catch (error) { result.prune_warning = `Old helper backups in ${this.#backupRoot} could not be removed (${error.code || error.message}); the helpers themselves are fine.`; }
    return result;
  }

  #assess(dir, projectDirectories) {
    const entries = this.#userEntries(dir);
    const projects = this.#projectOverrides(projectDirectories);
    const legacy = LEGACY_FILES.some(file => fs.existsSync(path.join(dir, file)));
    if (entries.every(entry => !entry.present)) {
      if (!legacy) return { entries, projects, status: 'not-installed', detail: '' };
      return { entries, projects, status: 'stale', detail: `Retired Toolkit helper definitions remain in ${dir}. Run setup toolkit to remove them.` };
    }
    const blocked = holdDetail(entries, projects, dir);
    if (blocked) return { entries, projects, status: 'held', detail: blocked };
    if (legacy || entries.some(entry => entry.state === 'update' || entry.state === 'missing')) {
      return { entries, projects, status: 'stale', detail: `The Toolkit helper definitions in ${dir} are out of date or incomplete. Run setup toolkit to refresh them.` };
    }
    return { entries, projects, status: 'current', detail: '' };
  }

  // One entry per role. `rendered` is the text the file must hold for the stack it names, or null.
  // A missing file takes the stack named by the other installed managed file.
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

  // Unreadable is treated as not Toolkit's, so it is never replaced.
  #installed(file) {
    if (!fs.existsSync(file)) return { present: false, managed: false, text: null };
    let text = null;
    try { text = fs.readFileSync(file, 'utf8'); } catch { /* unreadable: left alone */ }
    return { present: true, managed: text !== null && text.includes(MARKER), text };
  }

  #render(role, stack) {
    try { return ClaudeHelperAgentRenderer.fromRepository(stack, this.#repositoryRoot).render(role).text; }
    catch { return null; } // an unknown or unrenderable stack is reported, never guessed
  }

  // Each directory holds helper copies to compare. An unreadable or absent copy is skipped, as the policy skips it.
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

  // Deletes only timestamp-named backup folders older than the retention window. Errors surface.
  #pruneBackups(keep) {
    let entries;
    try { entries = fs.readdirSync(this.#backupRoot, { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    const cutoff = this.#now().getTime() - this.#retentionDays * DAY_MS;
    for (const entry of entries) {
      const target = path.join(this.#backupRoot, entry.name);
      if (!BACKUP_NAME.test(entry.name) || !entry.isDirectory() || target === keep) continue;
      if (backupTime(entry.name) < cutoff) fs.rmSync(target, { recursive: true, force: true });
    }
  }
}

function parseArgs(argv, environment = process.env) {
  const args = { stack: null, agentsDir: claudeUserAgentsDirectory(environment), write: false, backupRoot: defaultBackupRoot() };
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
  const renderer = ClaudeHelperAgentRenderer.fromRepository(args.stack);
  const installer = new AgentDirectoryInstaller(args.agentsDir, ['G0', 'G1'].map(role => renderer.render(role)));
  const result = args.write ? installer.apply(args.backupRoot) : { actions: installer.plan(), dry_run: true };
  process.stdout.write(`${JSON.stringify({ stack: args.stack, agents_dir: args.agentsDir, ...result }, null, 2)}\n`);
  return result;
}

if (require.main === module) {
  try { run(); } catch (error) { process.stderr.write(`${error.code || error.message}\n`); process.exitCode = 1; }
}

module.exports = Object.freeze({ ClaudeHelperAgentRenderer, ClaudeHelperDefinitions, AgentDirectoryInstaller, MARKER, claudeUserAgentsDirectory,
  matchesRenderedDefinition, parseArgs, run });
