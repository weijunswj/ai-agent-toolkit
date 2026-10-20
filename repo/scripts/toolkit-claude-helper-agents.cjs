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
const { roleSpec, roleInstructions } = require('./toolkit-claude-helper-spec.cjs');

const MARKER = '<!-- ai-agent-toolkit:generated claude-helper-agent v1 -->';
const REGISTRY_REL = 'repo/contracts/controller-kernel/stack-registry-v3.json';
const LEGACY_FILES = Object.freeze(['toolkit-v3-g0-evidence.md', 'toolkit-v3-g1-bounded.md']);
function fail(code) { throw Object.assign(new Error(code), { code }); }

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
      '- The registry is the only source of this model and effort. If this file and the registry disagree, the registry governs: report the difference and stop. Regenerate with `node repo/scripts/toolkit-claude-helper-agents.cjs`.',
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
function matchesRenderedDefinition(role, text, repositoryRoot) {
  if (typeof text !== 'string') return { matches: false, stack: null };
  const stack = STACK_REFERENCE.exec(text)?.[1] || null;
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
      if (a.action === 'create' || a.action === 'update') fs.writeFileSync(path.join(this.#dir, file), text);
    }
    for (const a of actions.filter(x => x.action === 'retire-legacy')) fs.rmSync(path.join(this.#dir, a.file));
    for (const { file, text } of this.#files) if (fs.readFileSync(path.join(this.#dir, file), 'utf8') !== text) fail('HELPER_AGENTS_READBACK_MISMATCH');
    return { actions, backup_dir: backupDir };
  }
}

function parseArgs(argv) {
  const args = { stack: null, agentsDir: path.join(os.homedir(), '.claude', 'agents'), write: false,
    backupRoot: path.join(os.homedir(), '.ai-agent-toolkit', 'backups', 'claude-helper-agents') };
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

module.exports = Object.freeze({ ClaudeHelperAgentRenderer, AgentDirectoryInstaller, MARKER, matchesRenderedDefinition, run });
