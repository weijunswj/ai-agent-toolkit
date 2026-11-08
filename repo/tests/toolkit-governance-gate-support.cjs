'use strict';
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { recordMerged } = require('./toolkit-governed-fixture-support.cjs');
const repoRoot = path.resolve(__dirname, '..', '..');
const scripts = path.join(repoRoot, 'repo', 'scripts');
const gate = require(path.join(scripts, 'toolkit-governance-gate.cjs'));
const governance = require(path.join(scripts, 'toolkit-governance-state.cjs'));
const claudeHook = require(path.join(scripts, 'toolkit-governance-hook.cjs'));
const codexHook = require(path.join(scripts, 'toolkit-codex-helper-hook.cjs'));
const codexSessionStartScript = require(path.join(scripts, 'toolkit-codex-session-start.cjs'));
const codexSetup = require(path.join(scripts, 'setup-codex-toolkit-plugin.cjs'));
const managedBlock = require(path.join(scripts, 'toolkit-managed-block.cjs'));
const REMOTE = 'https://github.com/example-owner/example-repo.git';
const QUESTION_LINE = 'Toolkit: message held. Turn on GitHub governance (issues, records, evidence store) for this repository?';
const AGENT_LINE = `For agents: ${gate.NEVER_OWNER_SHORT}`;
const noticeOf = context => (/word for word:\n([\s\S]*?)\n2\. Then call AskUserQuestion/.exec(context) || [])[1];
function git(cwd, args) {
  return childProcess.execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }).trim();
}
function scratch(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-governance-gate-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const registryPath = path.join(root, 'home', '.ai-agent-toolkit', 'user-state', 'repository-governance.v1.json');
  return { root, registryPath, options: { registryPath, testOnly: true, home: path.join(root, 'home') }, heldPath: path.join(path.dirname(registryPath), gate.HELD_BASENAME) };
}
function gitRepo(ctx, name, { remote = REMOTE, block = false, binding = false } = {}) {
  const repo = path.join(ctx.root, name);
  fs.mkdirSync(repo, { recursive: true });
  git(ctx.root, ['init', '--quiet', repo]);
  if (remote !== null) git(repo, ['remote', 'add', 'origin', remote]);
  if (block) {
    const rendered = managedBlock.renderBlock({ source: 'repo/contracts/agent-rules/toolkit-governed-rules.md', name: 'TOOLKIT-GOVERNED-RULES', version: '3.8.0', body: '# Rules\n\nFixture body.' });
    fs.writeFileSync(path.join(repo, 'AGENTS.md'), `# Repo\n\n${rendered}\n`);
  }
  if (binding) {
    fs.mkdirSync(path.join(repo, '.github'), { recursive: true });
    fs.writeFileSync(path.join(repo, '.github', 'toolkit-programme.json'), JSON.stringify({
      schema: 'toolkit.programme-binding.v1', repository: 'example-owner/example-repo', parent_issue: 1, record_prefix: 'INT-EX', writer_prefix: 'EX',
      store: { kind: 'github', repository: 'example-owner/example-store', branch: 'main', path: 'state/' }, required_checks: ['validate'],
    }, null, 2));
  }
  if (remote && governance.readIdentity(repo).valid && governance.isGitHubHost(governance.readIdentity(repo).remote.host)) {
    const support = require('./toolkit-governed-fixture-support.cjs');
    support.recordAbsent(repo, { registryPath: ctx.registryPath });
    support.recordAbsent(repo, { home: path.join(ctx.root, 'home') });
  }
  return repo;
}
function hold(ctx, environment = {}) {
  const prompts = new gate.PromptHold({ registryOptions: ctx.options, environment });
  return { decide(request) {
    ctx.started ||= new Set();
    if (typeof request.sessionId === 'string' && !ctx.started.has(request.sessionId)) {
      ctx.started.add(request.sessionId);
      gate.startSession({ session_id: request.sessionId, source: 'startup' }, { registryOptions: ctx.options });
    }
    return prompts.decide(request);
  } };
}
const tools = ctx => new gate.ToolGate({ registryOptions: ctx.options });
const stateOf = (ctx, repo) => governance.governanceState(repo, ctx.options);
const OLD_FOLDER = '.ai-agent-toolkit';
const oldCopy = folder => path.join(folder, OLD_FOLDER, 'governance.json');
const writesNothingIn = folder => assert.equal(fs.existsSync(path.join(folder, OLD_FOLDER)), false, `nothing is written into ${folder}`);
const registryBytes = ctx => (fs.existsSync(ctx.registryPath) ? fs.readFileSync(ctx.registryPath, 'utf8') : null);
const projects = require('./support/projects-approval.cjs');
const hostile = require('./support/hostile-inputs.cjs');
const replyTicket = result => (/ ANSWER ([0-9a-f]{32})\n/.exec(result.context || '') || [])[1];
function answerFixture(t, { remote = REMOTE } = {}) {
  const ctx = scratch(t);
  let clock = new Date();
  const now = () => clock;
  const target = gitRepo(ctx, 'target', { remote });
  const cwd = target;
  const options = { registryOptions: ctx.options, environment: {}, now };
  const start = (session = 'owner', source = 'startup', folder = cwd) => gate.startSession({ session_id: session, cwd: folder, source }, options);
  const prompts = environment => new gate.PromptHold({ ...options, environment: environment || {} });
  const say = (prompt, sessionId = 'owner', environment) => prompts(environment).decide({ cwd, prompt, sessionId });
  const ask = (session = 'owner') => {
    assert.equal(say('', session).action, 'block');
    clock = new Date(clock.getTime() + 1);
  };
  start();
  return { ctx, target, cwd, options, start, say, ask, prompts, now, tick: ms => { clock = new Date(clock.getTime() + ms); } };
}
const baseReplyStore = require('./fixtures/governance-reply-tickets-base.json');
const boundOf = (context) => {
  const match = /record nothing yet|reply to the question/.test(context || '') ? / node "[^"\n]+" (yes|no|later) ([0-9a-f]{32})\n/.exec(context) : null;
  return match ? { word: match[1], ticket: match[2] } : null;
};
const askOf = (context) => {
  const match = / node "[^"\n]+" confirm-(yes|no|later) ([0-9a-f]{32})\n/.exec(context || '');
  return match && /is a bare "/.test(context) ? { word: match[1], ticket: match[2] } : null;
};
const REAL_THREAD_WAKE = (text) => `<wake reason="mention" current-time="${new Date().toISOString()}">
  <project id="chan_example" type="project">
    <thread ts="cmsg_exampleThread">
      <message trigger="true" from="human" trust="principal" author-id="user_example" id="cmsg_exampleReply_${crypto.randomUUID()}" sent-at="${new Date().toISOString()}" mention="true">${text}</message>
    </thread>
  </project>
  <system-note>If a quick read or two gets you the answer, just answer. Otherwise, before any other tool, instead of a reaction, send one short \`reply\` saying what you will do without restating the message, so the person is not left waiting.</system-note>
</wake>`;
const REAL_CHAT_WAKE = (text) => `<wake reason="mention" current-time="${new Date().toISOString()}">
  <project id="chan_example" type="project">
    <message trigger="true" from="human" trust="principal" author-id="user_example" id="cmsg_exampleChat_${crypto.randomUUID()}" sent-at="${new Date().toISOString()}" mention="true">${text}</message>
  </project>
</wake>`;
const ATTACHMENT_MESSAGE = (trigger, attachment) => `<message trigger="${trigger}" from="human" trust="principal" author-id="user_example" id="cmsg_exampleFile" sent-at="2026-10-23T07:54:03Z" mention="true" has-attachments="true">
        ${attachment}
      </message>`;
const FILE_ATTACHMENT = '<attachment kind="file" name="message.md" id="file_example"></attachment>';
const IMAGE_ATTACHMENT = '<attachment kind="image" name="screenshot.png" id="file_exampleImage"/>';
const MUST_PASS = Object.freeze([
  'node scripts/save-meta.cjs --host claude --tracking yes',
  'head -c 2000 ~/.claude/projects/x/summary.md',
  'grep -rn summary ~/.claude/projects/x',
  'cat ~/.codex/sessions/summary.md | grep fork',
  "cat > meta.json <<'EOF'\n{\"host\": \"claude\", \"tracking\": \"yes\"}\nEOF",
  "printf 'agent: codex\\ntracking: yes\\n' > .tmp/meta.yml",
  'ssh vps-example "cat /srv/app/claude-notes.md" && echo ok',
  'for f in repo/scripts/toolkit-claude-*.cjs; do echo "$f: yes"; done',
  'claude -p yes',
  'echo ok | claude -p',
  'claude --resume 0b4e -p no',
  'claude -c -p N.',
  'codex exec resume --last later',
  'codex fork abc',
  'bash -c "claude -p yes"',
  'claude config set -g autoUpdates no',
  'claude mcp list',
  'codex --version',
]);
const MUST_PASS_POWERSHELL = Object.freeze([
  'Set-Content -Path meta.json -Value \'{"host": "claude", "tracking": "yes"}\'',
  'Get-Content -Raw "$env:USERPROFILE\\.claude\\projects\\x\\summary.md"',
  '"yes" | claude.exe -p',
]);
const ROOT_GITIGNORE_ROWS = [
  { name: 'absent', make() {} },
  { name: 'plain file without the Toolkit line', make(repo) { fs.writeFileSync(path.join(repo, '.gitignore'), 'node_modules/\r\ndist/'); } },
  { name: 'line removed by the user', make(repo) { fs.writeFileSync(path.join(repo, '.gitignore'), 'node_modules/\n# was /.ai-agent-toolkit/\n'); } },
  { name: 'symlink', make(repo) { fs.writeFileSync(path.join(repo, 'shared-ignore'), 'build/\n'); fs.symlinkSync('shared-ignore', path.join(repo, '.gitignore')); } },
  { name: 'directory', make(repo) { fs.mkdirSync(path.join(repo, '.gitignore')); fs.writeFileSync(path.join(repo, '.gitignore', 'keep'), ''); } },
  { name: 'read-only file', make(repo) { fs.writeFileSync(path.join(repo, '.gitignore'), 'node_modules/\n'); }, after(repo) { fs.chmodSync(path.join(repo, '.gitignore'), 0o444); } },
];
function snapshot(target) {
  let stat;
  try { stat = fs.lstatSync(target); } catch { return 'absent'; }
  if (stat.isSymbolicLink()) return `link:${fs.readlinkSync(target)}`;
  if (stat.isDirectory()) return `dir:${fs.readdirSync(target).join(',')}`;
  return `file:${fs.readFileSync(target, 'utf8')}`;
}
const UAT_REPORT = '# Codex mini UAT\nObserved: the guard in Codex did not refuse the write.\nClaude Code ran the same check.\nno\nok\nlater\nResult: no GitHub push.\n';
const REPORT_WRITE = `cat > .tmp/uat-codex-mini3-results.md <<'EOF'\n${UAT_REPORT}EOF`;
function card(ctx, environment = {}) {
  const prompts = new gate.PromptHold({ registryOptions: ctx.options, environment, picker: true });
  const plain = new gate.PromptHold({ registryOptions: ctx.options, environment });
  const toolGate = tools(ctx);
  return {
    start(sessionId, source = 'startup', cwd = undefined) { gate.startSession({ session_id: sessionId, source, cwd }, { registryOptions: ctx.options }); },
    send: (cwd, prompt, sessionId) => prompts.decide({ cwd, prompt, sessionId }),
    typed: (cwd, prompt, sessionId) => plain.decide({ cwd, prompt, sessionId }),
    ask: (cwd, sessionId, toolUseId, toolInput = gate.PICKER_INPUT) => toolGate.decide({ tool_name: 'AskUserQuestion', cwd, session_id: sessionId, tool_use_id: toolUseId, tool_input: toolInput }),
    tap: (cwd, sessionId, toolUseId, label) => prompts.picked({ cwd, sessionId, toolUseId,
      toolResponse: { questions: gate.PICKER_INPUT.questions, answers: label === undefined ? {} : { [gate.PICKER_QUESTION]: label } } }),
  };
}
const clone = value => JSON.parse(JSON.stringify(value));
module.exports = { assert, childProcess, crypto, fs, os, path, test, recordMerged, repoRoot, scripts, gate, governance, claudeHook, codexHook, codexSessionStartScript, codexSetup, managedBlock, REMOTE, QUESTION_LINE, AGENT_LINE, noticeOf, git, scratch, gitRepo, hold, tools, stateOf, OLD_FOLDER, oldCopy, writesNothingIn, registryBytes, projects, hostile, replyTicket, answerFixture, baseReplyStore, boundOf, askOf, REAL_THREAD_WAKE, REAL_CHAT_WAKE, ATTACHMENT_MESSAGE, FILE_ATTACHMENT, IMAGE_ATTACHMENT, MUST_PASS, MUST_PASS_POWERSHELL, ROOT_GITIGNORE_ROWS, snapshot, UAT_REPORT, REPORT_WRITE, card, clone };
