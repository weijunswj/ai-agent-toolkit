'use strict';
require('./toolkit-test-temp-guard.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const codexSetup = require('../scripts/setup-codex-toolkit-plugin.cjs');
const parts = require('../scripts/toolkit-remove-parts.cjs');
const note = require('../scripts/toolkit-reinstall-note.cjs');
const { ClaudeHelperDefinitions, ClaudeHelperAgentRenderer, AgentDirectoryInstaller } = require('../scripts/toolkit-claude-helper-agents.cjs');
const { CodexHelperDefinitions } = require('../scripts/toolkit-codex-helper-agents.cjs');
const { parseTomlDocument } = require('../scripts/codex-delegation-common.cjs');
const { leftoverTaskLines } = require('../scripts/setup-toolkit-core.cjs');

const ROOT = path.resolve(__dirname, '..', '..');
const PLUGIN = 'ai-agent-toolkit@ai-agent-toolkit-local';
const hookTable = (event, quote = '"') => `[hooks.state.${quote}${PLUGIN}:.codex-plugin/hooks/hooks.json:${event}:0:0${quote}]\ntrusted_hash = "sha256:aa"\nenabled = true\n`;
const OWN = 'model = "gpt-x"\n\n[hooks.state."someone@else:hooks.json:stop:0:0"]\nenabled = false\n\n[mcp_servers.docs]\nurl = "https://example.invalid/mcp"\n';
const CONFIG = `${OWN}\n${hookTable('session_start')}\n${hookTable('stop', "'")}`;
const python = parseTomlDocument(Buffer.from('a = 1\n')).ok;

function home(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-reinstall-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const environment = { CLAUDE_CONFIG_DIR: path.join(dir, '.claude'), CODEX_HOME: path.join(dir, '.codex') };
  fs.mkdirSync(environment.CODEX_HOME, { recursive: true });
  return { dir, environment, config: path.join(environment.CODEX_HOME, 'config.toml'), cache: path.join(environment.CODEX_HOME, 'plugins', 'cache', 'ai-agent-toolkit-local') };
}

test('the Toolkit hook records are found in either quote style and nothing else is taken', () => {
  const found = codexSetup.toolkitHookStateTables(CONFIG);
  assert.deepEqual(found.keys, [`${PLUGIN}:.codex-plugin/hooks/hooks.json:session_start:0:0`, `${PLUGIN}:.codex-plugin/hooks/hooks.json:stop:0:0`]);
  assert.equal(found.text.trimEnd(), OWN.trimEnd());
});

test('Codex setup treats leftover hook records alone as a fresh install, but still stops on real install state', (t) => {
  const h = home(t);
  fs.writeFileSync(h.config, CONFIG);
  fs.mkdirSync(h.cache, { recursive: true });
  assert.deepEqual(codexSetup.inspectResidualToolkitState(h.environment.CODEX_HOME).evidence, []);
  fs.writeFileSync(h.config, `${CONFIG}\n[plugins."${PLUGIN}"]\nenabled = true\n`);
  assert.match(codexSetup.inspectResidualToolkitState(h.environment.CODEX_HOME).evidence.join(';'), /still has \[plugins/);
  fs.writeFileSync(h.config, `${CONFIG}\n[marketplaces.other]\nsource = "ai-agent-toolkit-local"\n`);
  assert.match(codexSetup.inspectResidualToolkitState(h.environment.CODEX_HOME).evidence.join(';'), /still names ai-agent-toolkit-local/);
  fs.writeFileSync(h.config, CONFIG);
  fs.mkdirSync(path.join(h.cache, 'ai-agent-toolkit', '3.90.0'), { recursive: true });
  fs.writeFileSync(path.join(h.cache, 'ai-agent-toolkit', '3.90.0', 'plugin.json'), '{}');
  assert.match(codexSetup.inspectResidualToolkitState(h.environment.CODEX_HOME).evidence.join(';'), /plugin cache/);
});

test('removal lists the hook records and the cache folder, and keeps them while the Codex plugin is installed', (t) => {
  const h = home(t);
  fs.writeFileSync(h.config, CONFIG);
  fs.mkdirSync(path.join(h.cache, 'ai-agent-toolkit'), { recursive: true });
  const part = new parts.CodexHookStatePart({ environment: h.environment, home: h.dir, plugins: () => ({ codex: true }) });
  const items = part.plan();
  assert.deepEqual(items.map(item => item.action), ['remove', 'remove']);
  assert.match(items[0].what, /approval records for 2 Toolkit hooks/);
  assert.deepEqual(part.apply(items).map(item => item.result), ['kept', 'kept']);
  assert.equal(fs.readFileSync(h.config, 'utf8'), CONFIG);
  assert.ok(fs.existsSync(h.cache));
});

test('removal takes out exactly the Toolkit hook records, with a backup, once the plugin is gone', { skip: !python && 'needs Python 3.11+' }, (t) => {
  const h = home(t);
  fs.writeFileSync(h.config, CONFIG);
  fs.mkdirSync(path.join(h.cache, 'ai-agent-toolkit', '3.90.0'), { recursive: true });
  const part = new parts.CodexHookStatePart({ environment: h.environment, home: h.dir, plugins: () => ({ codex: false }), now: () => new Date('2026-11-13T05:00:00Z') });
  const results = part.apply(part.plan());
  assert.deepEqual(results.map(item => item.result), ['removed', 'removed'], JSON.stringify(results));
  assert.equal(fs.readFileSync(h.config, 'utf8').trimEnd(), OWN.trimEnd());
  assert.equal(fs.readFileSync(path.join(h.dir, '.ai-agent-toolkit', 'backups', 'remove-toolkit', '2026-11-13T05-00-00-000Z', 'codex-config.toml'), 'utf8'), CONFIG);
  assert.ok(!fs.existsSync(h.cache));
  assert.deepEqual(codexSetup.toolkitHookStateTables(fs.readFileSync(h.config, 'utf8')).keys, []);
});

test('removal leaves config.toml alone without a TOML parser, after a change, or when the edit would change more', (t) => {
  const h = home(t);
  fs.writeFileSync(h.config, CONFIG);
  const make = parse => new parts.CodexHookStatePart({ environment: h.environment, home: h.dir, plugins: () => ({ codex: false }), parse });
  const items = make().plan();
  const [noPython] = make(() => ({ ok: false, kind: 'parser-unavailable' })).apply(items);
  assert.equal(noPython.result, 'kept');
  assert.match(noPython.reason, /Python 3\.11 or later.*by hand/);
  let call = 0;
  const [differs] = make(() => ({ ok: true, doc: { t: 'table', v: { model: { t: 'str', v: call++ ? 'b' : 'a' } } } })).apply(items);
  assert.equal(differs.result, 'kept');
  assert.match(differs.reason, /would change other settings/);
  fs.appendFileSync(h.config, `\n${hookTable('pre_tool_use')}`);
  const [changed] = make().apply(items);
  assert.equal(changed.result, 'kept');
  assert.match(changed.reason, /changed after the plan/);
  assert.ok(fs.readFileSync(h.config, 'utf8').startsWith(CONFIG));
});

test('a cache folder that still holds files is kept', (t) => {
  const h = home(t);
  fs.mkdirSync(h.cache, { recursive: true });
  fs.writeFileSync(path.join(h.cache, 'left.txt'), 'x');
  const part = new parts.CodexHookStatePart({ environment: h.environment, home: h.dir, plugins: () => ({ codex: false }) });
  assert.deepEqual(part.apply(part.plan()), [{ what: '~/.codex/plugins/cache/ai-agent-toolkit-local', result: 'kept', reason: 'it still holds files' }]);
});

test('the plan lists each MCP key helper that runs toolkit-env.cjs from the Toolkit folder, and changes nothing', (t) => {
  const h = home(t);
  const inside = `"C:/node.exe" "${path.join(h.dir, '.ai-agent-toolkit', 'source', 'ai-agent-toolkit', 'repo', 'scripts', 'toolkit-env.cjs').replace(/\\/g, '/')}" header COOLIFY_TOKEN`;
  const outside = '"node" "/work/clone/repo/scripts/toolkit-env.cjs" header OTHER';
  const claude = { mcpServers: { coolify: { type: 'http', url: 'https://x.invalid', headersHelper: inside }, other: { headersHelper: outside }, plain: { command: 'npx' } },
    projects: { '/work/app': { mcpServers: { local: { command: 'node', args: [inside.split(' ')[1].replace(/"/g, ''), 'run', 'KEY'] } } } } };
  fs.writeFileSync(path.join(h.dir, '.claude.json'), JSON.stringify(claude));
  fs.writeFileSync(h.config, `[mcp_servers.coolify]\nurl = "https://x.invalid"\nhttp_headers_helper = '${inside}'\n\n[mcp_servers."two words"]\nhttp_headers_helper = '${outside}'\n`);
  const before = [fs.readFileSync(path.join(h.dir, '.claude.json'), 'utf8'), fs.readFileSync(h.config, 'utf8')];
  const part = new parts.McpKeyHelpersPart({ environment: h.environment, home: h.dir });
  const items = part.plan();
  assert.deepEqual(items.map(item => item.what), ['Claude Code server in /work/app: local', 'Claude Code user server: coolify', 'Codex server: coolify']);
  assert.ok(items.every(item => item.action === 'keep' && /no key until Toolkit is reinstalled; the key stays in the credential store/.test(item.detail)));
  assert.deepEqual(part.apply(items), []);
  assert.deepEqual([fs.readFileSync(path.join(h.dir, '.claude.json'), 'utf8'), fs.readFileSync(h.config, 'utf8')], before);
});

// Installs each app's helpers the way the generators do, in a temporary home. Each app renders only
// the stacks whose routes it runs natively (Claude Code: owner-claude; Codex: owner-gpt).
function installHelpers(h, { claude = null, codex = null }) {
  if (claude) {
    const renderer = ClaudeHelperAgentRenderer.fromRepository(claude, ROOT);
    new AgentDirectoryInstaller(path.join(h.environment.CLAUDE_CONFIG_DIR, 'agents'), ['G0', 'G1'].map(role => renderer.render(role))).apply(path.join(h.dir, 'b1'));
  }
  if (codex) new CodexHelperDefinitions({ environment: h.environment, repositoryRoot: ROOT, backupRoot: path.join(h.dir, 'b2') }).refresh({ stack: codex });
}

test('remove, then setup: the helpers come back for the stack they had, and the note is pruned', (t) => {
  const h = home(t);
  installHelpers(h, { claude: 'owner-claude', codex: 'owner-gpt' });
  const claude = () => new ClaudeHelperDefinitions({ environment: h.environment, repositoryRoot: ROOT, backupRoot: path.join(h.dir, 'b1') });
  const codex = () => new CodexHelperDefinitions({ environment: h.environment, repositoryRoot: ROOT, backupRoot: path.join(h.dir, 'b2') });
  assert.equal(claude().check().status, 'current');
  assert.equal(codex().check().status, 'current');
  const registry = { readRegistry: () => ({ status: 'ok', tasks: [] }) };
  const removal = [new parts.ReinstallNotePart({ environment: h.environment, home: h.dir, registry }), new parts.HelperAgentFilesPart({ environment: h.environment, home: h.dir })];
  const planned = removal.map(part => part.plan());
  assert.equal(planned[0][0].action, 'save');
  assert.match(planned[0][0].detail, /Claude Code helpers \(stack owner-claude\) and the Codex helpers \(stack owner-gpt\)/);
  removal.forEach((part, index) => part.apply(planned[index]));
  assert.equal(claude().check().status, 'not-installed');
  assert.equal(codex().check().status, 'not-installed');
  assert.deepEqual(note.readNote(h.dir).helpers, { 'claude-code': 'owner-claude', codex: 'owner-gpt' });

  assert.match(note.restoreHelpersLine('claude-code', claude(), { home: h.dir }), /Claude Code helpers: put back for stack owner-claude/);
  assert.match(note.restoreHelpersLine('codex', codex(), { home: h.dir }), /Codex helpers: put back for stack owner-gpt/);
  assert.equal(claude().check().status, 'current');
  assert.equal(codex().check().status, 'current');
  assert.equal(note.readNote(h.dir), null);
  assert.ok(!fs.existsSync(note.notePath(h.dir)));
  assert.equal(note.restoreHelpersLine('codex', codex(), { home: h.dir }), null);
});

test('setup never installs helpers without a note, and leaves helpers the owner already has', (t) => {
  const h = home(t);
  const codex = new CodexHelperDefinitions({ environment: h.environment, repositoryRoot: ROOT, backupRoot: path.join(h.dir, 'b2') });
  assert.equal(note.restoreHelpersLine('codex', codex, { home: h.dir }), null);
  assert.equal(codex.check().status, 'not-installed');
  installHelpers(h, { codex: 'owner-gpt' });
  note.saveNote(h.dir, { helpers: { codex: 'some-other-stack' } });
  assert.equal(note.restoreHelpersLine('codex', codex, { home: h.dir }), null);
  assert.equal(codex.check().files[0].stack, 'owner-gpt');
  assert.equal(note.readNote(h.dir), null);
});

test('a task list an older removal noted is never offered: it reads as empty and the next write drops it', (t) => {
  const h = home(t);
  const file = note.notePath(h.dir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ schema: note.SCHEMA, saved_at: '2026-11-01T00:00:00.000Z', helpers: { codex: 'owner-gpt' },
    tasks: [{ checkout: path.join(h.dir, 'repo'), folder: 'AI-AGENT-TOOLKIT', repository: 'example/ai-agent-toolkit' }] }));
  assert.deepEqual(note.readNote(h.dir), { helpers: { codex: 'owner-gpt' }, saved_at: '2026-11-01T00:00:00.000Z' });
  assert.equal(note.taskOffers, undefined, 'the task offer is gone');
  note.saveNote(h.dir, { helpers: { 'claude-code': 'owner-claude' } });
  const written = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal('tasks' in written, false);
  assert.deepEqual(written.helpers, { codex: 'owner-gpt', 'claude-code': 'owner-claude' });
  // A note holding only an old task list is no note at all.
  fs.writeFileSync(file, JSON.stringify({ schema: note.SCHEMA, tasks: [{ checkout: 'C:\\repo', folder: 'REPO' }] }));
  assert.equal(note.readNote(h.dir), null);
});

test('the removal note never records scheduled tasks, even when Toolkit tasks are still recorded', (t) => {
  const h = home(t);
  const registry = { readRegistry: () => ({ status: 'ok', tasks: [{ host: 'windows', checkout: 'C:\\Users\\me\\GitHub\\repo', folder: 'REPO', repository: 'me/repo' }] }) };
  assert.deepEqual(new parts.ReinstallNotePart({ home: h.dir, registry, helpers: () => ({ 'claude-code': null, codex: null }) }).plan(), []);
  const part = new parts.ReinstallNotePart({ home: h.dir, registry, helpers: () => ({ 'claude-code': null, codex: 'owner-gpt' }) });
  const [item] = part.plan();
  assert.doesNotMatch(item.detail, /scheduled task/);
  assert.deepEqual(part.apply([item]), [{ what: item.what, result: 'saved' }]);
  assert.equal('tasks' in JSON.parse(fs.readFileSync(note.notePath(h.dir), 'utf8')), false);
});

test('setup names leftover Toolkit tasks once and points to remove toolkit, without touching them', () => {
  const calls = [];
  const registry = (tasks) => ({ readRegistry: home => { calls.push(home); return { status: 'ok', tasks }; } });
  const recorded = [{ host: 'windows', id: 'a' }, { host: 'windows', id: 'b' }, { host: 'windows', adopted: true, id: 'mine' }];
  const [line, ...rest] = leftoverTaskLines({ home: 'H', platform: 'win32', registry: registry(recorded) });
  assert.equal(rest.length, 0);
  assert.match(line, /2 old Toolkit tasks are still recorded[^]*Say "remove toolkit"/);
  assert.deepEqual(leftoverTaskLines({ home: 'H', platform: 'win32', registry: registry([{ host: 'windows', adopted: true }]) }), []);
  assert.deepEqual(leftoverTaskLines({ home: 'H', platform: 'linux', registry: registry(recorded) }), []);
  assert.deepEqual(leftoverTaskLines({ home: 'H', platform: 'win32', registry: { readRegistry: () => { throw new Error('locked'); } } }), []);
  assert.deepEqual(leftoverTaskLines({ home: 'H', platform: 'win32', registry: { readRegistry: () => ({ status: 'unreadable' }) } }), []);
  assert.deepEqual(calls, ['H', 'H']);
});

test('the removal plan and result show the reinstall note as saved, not kept', (t) => {
  const h = home(t);
  const { ToolkitRemoval, describePlan, describeResult } = require('../scripts/toolkit-remove.cjs');
  const registry = { readRegistry: () => ({ status: 'ok', tasks: [] }), registryPath: () => '', updateRegistry: () => {} };
  const notePart = new parts.ReinstallNotePart({ home: h.dir, registry, helpers: () => ({ 'claude-code': 'owner-claude' }) });
  const removal = new ToolkitRemoval({ home: h.dir, registry, parts: [notePart] });
  const plan = removal.plan();
  assert.ok(describePlan(plan).some(line => /reinstall\.json: saved, so setup toolkit can put back the Claude Code helpers \(stack owner-claude\); no keys/.test(line)));
  const result = removal.apply(plan.code);
  assert.ok(result.ok);
  const lines = describeResult(result);
  assert.ok(lines.some(line => /reinstall\.json: saved$/.test(line)));
  assert.ok(!lines.some(line => /reinstall\.json: kept/.test(line)));
  assert.deepEqual(note.readNote(h.dir).helpers, { 'claude-code': 'owner-claude' });
});
