'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const routingPartial = path.join(
  repoRoot,
  '_projects',
  'development',
  'ai-coding-agent-rules',
  '_main',
  '_partials',
  'toolkit-skill-routing.md'
);

function readText(filePath) {
  return fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

function skillNames() {
  return fs.readdirSync(path.join(repoRoot, 'skills'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => fs.existsSync(path.join(repoRoot, 'skills', name, 'SKILL.md')))
    .sort();
}

function section(text, heading) {
  const marker = `## ${heading}\n`;
  const start = text.indexOf(marker);
  assert.notEqual(start, -1, `missing section: ${heading}`);
  const contentStart = start + marker.length;
  const nextHeading = text.indexOf('\n## ', contentStart);
  return nextHeading === -1 ? text.slice(contentStart) : text.slice(contentStart, nextHeading);
}

function duplicates(values) {
  const seen = new Set();
  const repeated = new Set();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated].sort();
}

function isInsideRoot(rootRealPath, realPath) {
  const relative = path.relative(rootRealPath, realPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function markdownFilesIn(relRoots, root = repoRoot) {
  const files = [];
  const visited = new Set();
  const rootPath = path.resolve(root);
  let rootRealPath;

  try {
    rootRealPath = fs.realpathSync(rootPath);
  } catch {
    return files;
  }

  function walk(fullPath) {
    let stat;
    try {
      stat = fs.lstatSync(fullPath);
    } catch {
      return;
    }

    if (stat.isSymbolicLink()) return;

    let realPath;
    try {
      realPath = fs.realpathSync(fullPath);
    } catch {
      return;
    }

    if (!isInsideRoot(rootRealPath, realPath)) return;
    if (visited.has(realPath)) return;
    visited.add(realPath);

    if (stat.isDirectory()) {
      let entries;
      try {
        entries = fs.readdirSync(fullPath);
      } catch {
        return;
      }
      for (const entry of entries) {
        walk(path.join(fullPath, entry));
      }
      return;
    }
    if (stat.isFile() && fullPath.endsWith('.md')) files.push(fullPath);
  }

  for (const relRoot of relRoots) {
    walk(path.resolve(rootPath, relRoot));
  }

  return files.sort();
}

function createSymlinkOrSkip(t, target, linkPath, type) {
  try {
    fs.rmSync(linkPath, { recursive: true, force: true });
    fs.symlinkSync(target, linkPath, type);
  } catch (error) {
    if (['EPERM', 'EINVAL', 'ENOTSUP', 'EACCES'].includes(error.code)) {
      t.skip(`symlink creation is not available in this environment: ${error.message}`);
      return false;
    }
    throw error;
  }
  return true;
}

test('toolkit skill routing covers current skill folders or documents omissions', () => {
  const routing = readText(routingPartial);
  const routedSection = section(routing, 'Current Toolkit Skill Routing');
  const omittedSection = section(routing, 'Intentionally Omitted Skills');

  const routed = [...routedSection.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)].map((match) => match[1]).sort();
  const omitted = [...omittedSection.matchAll(/^-\s*`([^`]+)`:\s*(.+)$/gm)]
    .map((match) => ({ name: match[1], reason: match[2].trim() }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const omittedNames = omitted.map((entry) => entry.name);
  const current = skillNames();
  const currentSet = new Set(current);

  assert.deepEqual(duplicates(routed), [], 'routing table should not list a skill twice');
  assert.deepEqual(duplicates(omittedNames), [], 'omitted skills should not list a skill twice');

  for (const name of current) {
    assert.ok(
      routed.includes(name) || omittedNames.includes(name),
      `${name} exists under skills/ but is not routed or intentionally omitted`
    );
  }

  for (const name of routed) {
    assert.ok(currentSet.has(name), `${name} is routed but has no skills/${name}/SKILL.md`);
  }

  for (const { name, reason } of omitted) {
    assert.ok(currentSet.has(name), `${name} is intentionally omitted but has no skills/${name}/SKILL.md`);
    assert.ok(reason.length >= 12, `${name} omission needs a concrete reason`);
  }
});

test('toolkit skill routing stays routing-only', () => {
  const routing = readText(routingPartial);

  assert.match(routing, /Use the skill name, description, and local files to decide whether a skill applies/);
  assert.doesNotMatch(routing, /Codex Install And Discovery/);
  assert.doesNotMatch(routing, /Repo-level Codex skill/);
  assert.doesNotMatch(routing, /User-level Codex skill/);
  assert.doesNotMatch(routing, /Admin-level Codex skill/);
  assert.doesNotMatch(routing, /`~\/\.codex\/config\.toml`/);
  assert.doesNotMatch(routing, /`\/skills`/);
  assert.doesNotMatch(routing, /`\$skill-name`/);
});

test('markdown docs use markdown numbered steps instead of HTML or compressed step lists', () => {
  const files = markdownFilesIn(['README.md', 'repo', '_projects', 'skills']);

  for (const file of files) {
    const relPath = path.relative(repoRoot, file).replace(/\\/g, '/');
    const text = readText(file);
    if (/<\/?(?:ol|li)>/i.test(text)) {
      assert.fail(`${relPath} should use markdown numbered lists instead of HTML lists`);
    }
    if (/;\s*choose any one/i.test(text)) {
      assert.fail(`${relPath} should split multi-step guidance instead of compressing it with semicolons`);
    }
  }
});

test('markdown file walker skips symlinks and stays inside the selected root', (t) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-md-walk-root-'));
  const externalRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-md-walk-external-'));

  fs.writeFileSync(path.join(fixtureRoot, 'safe.md'), '# Safe\n', 'utf8');
  fs.writeFileSync(path.join(externalRoot, 'secret.md'), '# External secret marker\n', 'utf8');

  if (!createSymlinkOrSkip(t, externalRoot, path.join(fixtureRoot, 'external-link'), process.platform === 'win32' ? 'junction' : 'dir')) return;
  if (!createSymlinkOrSkip(t, fixtureRoot, path.join(fixtureRoot, 'loop-link'), process.platform === 'win32' ? 'junction' : 'dir')) return;

  const files = markdownFilesIn(['.'], fixtureRoot)
    .map((file) => path.relative(fixtureRoot, file).replace(/\\/g, '/'));

  assert.ok(files.includes('safe.md'), 'safe markdown file should be discovered');
  assert.equal(files.includes('external-link/secret.md'), false, 'symlinked external markdown should be skipped');
  assert.equal(files.includes('loop-link/safe.md'), false, 'symlink loop should be skipped');
});

test('context publisher documents published-surface readability rules', () => {
  const source = readText(path.join(
    repoRoot,
    '_projects',
    'repo-methodology',
    'context-preserving-ai-publisher',
    'curated_output_for_ai',
    'skills',
    'context-preserving-ai-publisher',
    'SKILL.md'
  ));
  const generated = readText(path.join(repoRoot, 'skills', 'context-preserving-ai-publisher', 'SKILL.md'));

  for (const text of [source, generated]) {
    assert.match(text, /Sequential instructions must use Markdown numbered steps: `1\.`, `2\.`, `3\.`/);
    assert.match(text, /Non-sequential options must use bullets or compact tables/);
    assert.match(text, /Prefer tables for user-facing choices or comparisons when they make alternatives easier to scan/);
    assert.match(text, /\*\*Choose any one supported install location:\*\*/);
    assert.match(text, /Compact bullets or numbered steps may stay inside table cells when the cell remains readable/);
    assert.match(text, /Do not force a table apart solely because a cell contains a short list/);
    assert.match(text, /Move content below the table only when a cell becomes too long, hard to scan, or mixes unrelated procedures/);
    assert.match(text, /Avoid semicolon chains for setup instructions/);
    assert.match(text, /Beginner-facing docs should say what to do, where to do it, and what not to do/);
  }
});

test('human setup docs cover platform-specific skill and rule setup fairly', () => {
  const howToUse = readText(path.join(repoRoot, 'repo', 'docs', 'HOW-TO-USE.md'));
  const readme = readText(path.join(repoRoot, 'README.md'));
  const aiRulesReadme = readText(path.join(repoRoot, 'skills', 'ai-coding-agent-rules', 'README.md'));
  const codexRef = readText(path.join(repoRoot, 'skills', 'n8n-local-setup', 'references', 'ai-agent-platforms', 'codex.md'));
  const claudeCodeRef = readText(path.join(repoRoot, 'skills', 'n8n-local-setup', 'references', 'ai-agent-platforms', 'claude-code.md'));
  const opencodeRef = readText(path.join(repoRoot, 'skills', 'n8n-local-setup', 'references', 'ai-agent-platforms', 'opencode.md'));
  const antigravityRef = readText(path.join(repoRoot, 'skills', 'n8n-local-setup', 'references', 'ai-agent-platforms', 'antigravity.md'));

  for (const heading of ['Codex Setup', 'Claude Code Setup', 'OpenCode Setup', 'Antigravity Setup']) {
    assert.match(howToUse, new RegExp(`^## ${heading}$`, 'm'), heading);
  }

  for (const heading of ['Codex', 'Claude Code', 'OpenCode', 'Antigravity']) {
    assert.match(howToUse, new RegExp(`^### ${heading}$`, 'm'), heading);
  }

  assert.match(readme, /^## Install Skills By Platform$/m);
  assert.match(readme, /\[How To Use: Install Toolkit Skills\]\(repo\/docs\/HOW-TO-USE\.md#install-toolkit-skills\)/);
  for (const platform of ['Codex', 'Claude Code', 'OpenCode', 'Antigravity']) {
    assert.match(readme, new RegExp(`\\| ${platform.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\|`), platform);
  }

  assert.match(howToUse, /Preferred install: copy the whole `skills\/<skill-name>\/` folder into one supported location/);
  assert.match(howToUse, /Codex and Claude Code plugin\/package support exists, but this repo does not make it the primary install path yet/);
  assert.match(howToUse, /Only introduce Codex\/Claude plugin packaging later if the install experience becomes as simple as Antigravity-style folder copy \/ drag-and-drop setup/);
  assert.match(howToUse, /OpenCode stays on a short manual whole-skill-folder install note for now/);
  assert.match(howToUse, /Copy whole skill folders, not just `SKILL\.md`/);
  assert.match(howToUse, /Keep `README\.md`, `references\/`, `templates\/`, `agents\/`, `packs\/`, and other supporting files beside `SKILL\.md` when present/);
  assert.match(howToUse, /Do not paste secrets, tokens, `.env` values, or credentials into repo files/);
  assert.match(howToUse, /Codex \| Direct whole-skill-folder install/);
  assert.match(howToUse, /Claude Code \| Direct whole-skill-folder install/);
  assert.match(howToUse, /Antigravity \| Plugin-scoped skill-folder install/);
  assert.match(howToUse, /OpenCode \| Short manual whole-skill-folder note only/);
  assert.match(howToUse, /\*\*Choose any one supported Codex skill-folder location:\*\*/);
  assert.match(howToUse, /\*\*Choose any one supported Claude Code skill-folder location:\*\*/);
  assert.match(howToUse, /\*\*Choose any one supported OpenCode skill-folder location:\*\*/);
  assert.match(howToUse, /Choose \*\*ANY ONE\*\* supported install location per platform/);
  assert.match(howToUse, /Use the whole `skills\/<skill-name>\/` folder as the install unit/);
  assert.match(howToUse, /`C:\\Users\\<user>\\\.gemini\\config\\plugins\\<plugin-name>\\skills\\<skill-name>\\SKILL\.md`/);
  assert.match(howToUse, /\| Scope \| Skill folder location \|/);
  assert.match(howToUse, /\| Repo-level \| `<repo>\/\.agents\/skills\/<skill-name>\/SKILL\.md` \|/);
  assert.match(howToUse, /\| User-level \| `\$HOME\/\.claude\/skills\/<skill-name>\/SKILL\.md` \|/);
  assert.match(howToUse, /\| Project OpenCode config \| `<repo>\/\.opencode\/skills\/<skill-name>\/SKILL\.md` \|/);
  assert.match(howToUse, /\| Plugin-scoped \| `C:\\Users\\<user>\\\.gemini\\config\\plugins\\<plugin-name>\\skills\\<skill-name>\\SKILL\.md` \|/);

  assert.match(readme, /Codex \| Direct whole-skill-folder install/);
  assert.match(readme, /Claude Code \| Direct whole-skill-folder install/);
  assert.match(readme, /Antigravity \| Plugin-scoped skill-folder install/);
  assert.match(readme, /OpenCode \| Short manual whole-skill-folder install only/);
  assert.match(readme, /Codex and Claude Code plugin\/package support exists, but this repo does not make it the primary install path yet/);
  assert.match(readme, /into \*\*ANY ONE\*\* supported location/);
  assert.match(readme, /\*\*Choose any one supported Codex skill-folder location:\*\*/);
  assert.match(readme, /\*\*Choose any one supported Claude Code skill-folder location:\*\*/);
  assert.match(readme, /\*\*Choose any one supported OpenCode skill-folder location:\*\*/);
  assert.match(readme, /`C:\\Users\\<user>\\\.gemini\\config\\plugins\\<plugin-name>\\skills\\<skill-name>\\`/);
  assert.match(readme, /\| Platform \| Preferred install \| Active instruction files \| References \|/);
  assert.match(readme, /\| Codex \| Direct whole-skill-folder install\.<br>\*\*Choose any one supported Codex skill-folder location:\*\*<br>- `<repo>\/\.agents\/skills\/<skill-name>\/`/);
  assert.match(readme, /\| Claude Code \| Direct whole-skill-folder install\.<br>\*\*Choose any one supported Claude Code skill-folder location:\*\*<br>- `<repo>\/\.claude\/skills\/<skill-name>\/`/);
  assert.match(readme, /\| OpenCode \| Short manual whole-skill-folder install only\.<br>\*\*Choose any one supported OpenCode skill-folder location:\*\*<br>- `<repo>\/\.opencode\/skills\/<skill-name>\/`/);
  assert.match(readme, /\| Antigravity \| Plugin-scoped skill-folder install\.<br>`C:/);
  assert.match(readme, /\| Codex \|[^\n]*\| `AGENTS\.md` \|/);
  assert.match(readme, /\| Claude Code \|[^\n]*\| `AGENTS\.md`, `CLAUDE\.md` shim \|/);
  assert.match(readme, /\| OpenCode \|[^\n]*\| `AGENTS\.md` \|/);
  assert.match(readme, /\| Antigravity \|[^\n]*\| `AGENTS\.md`, `GEMINI\.md`, Antigravity bootstrap \|/);
  assert.doesNotMatch(readme, /\| Platform \| Supported skill-folder location \| Repo-local instruction outputs \|/);
  assert.doesNotMatch(readme, /Repo-local instruction outputs/);

  assert.match(howToUse, /\| Repo-level \| `<repo>\/\.agents\/skills\/<skill-name>\/SKILL\.md` \|/);
  assert.match(howToUse, /\| User-level \| `\$HOME\/\.agents\/skills\/<skill-name>\/SKILL\.md` \|/);
  assert.match(howToUse, /\| Admin-level \| `\/etc\/codex\/skills\/<skill-name>\/SKILL\.md` \|/);
  assert.match(howToUse, /`~\/\.codex\/config\.toml` is for Codex configuration/);
  assert.match(howToUse, /\| Project-level \| `<repo>\/\.claude\/skills\/<skill-name>\/SKILL\.md` \|/);
  assert.match(howToUse, /\| User-level \| `\$HOME\/\.claude\/skills\/<skill-name>\/SKILL\.md` \|/);
  assert.match(howToUse, /Use `CLAUDE\.md`, `CLAUDE\.local\.md`, or `\.claude\/rules\/`/);
  assert.match(howToUse, /\| Project OpenCode config \| `<repo>\/\.opencode\/skills\/<skill-name>\/SKILL\.md` \|/);
  assert.match(howToUse, /\| User OpenCode config \| `\$HOME\/\.config\/opencode\/skills\/<skill-name>\/SKILL\.md` \|/);
  assert.match(howToUse, /\| Project Claude-compatible \| `<repo>\/\.claude\/skills\/<skill-name>\/SKILL\.md` \|/);
  assert.match(howToUse, /\| User Claude-compatible \| `\$HOME\/\.claude\/skills\/<skill-name>\/SKILL\.md` \|/);
  assert.match(howToUse, /\| Project agent-compatible \| `<repo>\/\.agents\/skills\/<skill-name>\/SKILL\.md` \|/);
  assert.match(howToUse, /\| User agent-compatible \| `\$HOME\/\.agents\/skills\/<skill-name>\/SKILL\.md` \|/);
  assert.match(howToUse, /Use `AGENTS\.md`, `AGENTS\.override\.md`, or the configured OpenCode rules file/);
  assert.match(howToUse, /\| Plugin-scoped \| `C:\\Users\\<user>\\\.gemini\\config\\plugins\\<plugin-name>\\skills\\<skill-name>\\SKILL\.md` \|/);
  assert.doesNotMatch(howToUse, /\$HOME\/\.gemini\/antigravity\/skills\/<skill-name>\/SKILL\.md/);
  assert.doesNotMatch(howToUse, /\$HOME\/\.gemini\/skills\/<skill-name>\/SKILL\.md/);
  assert.doesNotMatch(howToUse, /<workspace-root>\/\.agent\/skills\/<skill-name>\/SKILL\.md/);
  assert.match(howToUse, /Use `GEMINI\.md` or the configured context file/);
  assert.match(readme, /`<repo>\/\.claude\/skills\/<skill-name>\/`/);
  assert.match(readme, /`\$HOME\/\.config\/opencode\/skills\/<skill-name>\/`/);
  assert.match(readme, /`AGENTS\.md` is the shared managed instruction file/);
  assert.match(readme, /\[repo-local\/AGENTS\.managed\.template\.md\]\(skills\/ai-coding-agent-rules\/repo-local\/AGENTS\.managed\.template\.md\)/);
  assert.doesNotMatch(readme, /\[`(?:AGENTS|CLAUDE|GEMINI)\.template\.md`\]\(skills\/ai-coding-agent-rules\/(?:AGENTS|CLAUDE|GEMINI)\.template\.md\)/);
  assert.match(readme, /\(skills\/n8n-agent-rules\/\)/);
  assert.doesNotMatch(readme, /\$HOME\/\.gemini\/antigravity\/skills\/<skill-name>\//);
  assert.doesNotMatch(readme, /\$HOME\/\.gemini\/skills\/<skill-name>\//);
  assert.doesNotMatch(readme, /<workspace-root>\/\.agent\/skills\/<skill-name>\//);
  assert.match(aiRulesReadme, /\| Platform \| Repo-local entry point \|/);
  assert.match(aiRulesReadme, /\| Claude Code \| 1\. Create or merge `AGENTS\.md` from \[repo-local\/AGENTS\.managed\.template\.md\]\(repo-local\/AGENTS\.managed\.template\.md\)\.<br>2\. Add `CLAUDE\.md` from \[repo-local\/CLAUDE\.shim\.template\.md\]\(repo-local\/CLAUDE\.shim\.template\.md\)\. \|/);
  assert.match(aiRulesReadme, /\| Antigravity \| 1\. Create or merge `AGENTS\.md` from \[repo-local\/AGENTS\.managed\.template\.md\]\(repo-local\/AGENTS\.managed\.template\.md\)\.<br>2\. Add `GEMINI\.md` from \[repo-local\/GEMINI\.shim\.template\.md\]\(repo-local\/GEMINI\.shim\.template\.md\)\.<br>3\. Add `\.agents\/rules\/00-agent-toolkit-bootstrap\.md` from \[repo-local\/antigravity-bootstrap\.template\.md\]\(repo-local\/antigravity-bootstrap\.template\.md\)\. \|/);
  assert.match(aiRulesReadme, /\| Platform \| Preferred skill install \| Supported skill-folder location \|/);
  assert.match(aiRulesReadme, /\| Codex \| Direct whole-skill-folder install\. \| \*\*Choose any one supported Codex skill-folder location:\*\*<br>- `<repo>\/\.agents\/skills\/<skill-name>\/`/);
  assert.match(aiRulesReadme, /\| OpenCode \| Short manual whole-skill-folder install only\. \| \*\*Choose any one supported OpenCode skill-folder location:\*\*<br>- `<repo>\/\.opencode\/skills\/<skill-name>\/`/);
  assert.match(howToUse, /\[OpenCode reference\]\(\.\.\/\.\.\/skills\/n8n-local-setup\/references\/ai-agent-platforms\/opencode\.md\)/);
  assert.match(howToUse, /\[Antigravity reference\]\(\.\.\/\.\.\/skills\/n8n-local-setup\/references\/ai-agent-platforms\/antigravity\.md\)/);

  assert.match(codexRef, /Copy the whole `skills\/<skill-name>\/` folder/);
  assert.match(codexRef, /\*\*Choose any one supported Codex skill-folder location:\*\*/);
  assert.match(codexRef, /\| Scope \| Skill folder location \|/);
  assert.match(codexRef, /`<repo>\/\.agents\/skills\/<skill-name>\/SKILL\.md`/);
  assert.match(codexRef, /`\$HOME\/\.agents\/skills\/<skill-name>\/SKILL\.md`/);
  assert.match(codexRef, /`\/etc\/codex\/skills\/<skill-name>\/SKILL\.md`/);
  assert.match(claudeCodeRef, /Copy the whole `skills\/<skill-name>\/` folder/);
  assert.match(claudeCodeRef, /\*\*Choose any one supported Claude Code skill-folder location:\*\*/);
  assert.match(claudeCodeRef, /\| Scope \| Skill folder location \|/);
  assert.match(claudeCodeRef, /`<repo>\/\.claude\/skills\/<skill-name>\/SKILL\.md`/);
  assert.match(claudeCodeRef, /`\$HOME\/\.claude\/skills\/<skill-name>\/SKILL\.md`/);
  assert.match(opencodeRef, /Copy the whole `skills\/<skill-name>\/` folder/);
  assert.match(opencodeRef, /\*\*Choose any one supported OpenCode skill-folder location:\*\*/);
  assert.match(opencodeRef, /\| Scope \| Skill folder location \|/);
  assert.doesNotMatch(opencodeRef, /plugin\/package install first/i);
  assert.match(antigravityRef, /C:\\Users\\<user>\\\.gemini\\config\\plugins\\<plugin-name>\\skills\\<skill-name>\\SKILL\.md/);
  assert.match(antigravityRef, /\| Location type \| Skill folder path \|/);
  assert.match(antigravityRef, /plugin-scoped folder is for loading toolkit skills/);

  const installDocs = [howToUse, readme, codexRef, claudeCodeRef, opencodeRef, antigravityRef].join('\n');
  assert.doesNotMatch(installDocs, /\.codex-plugin\/plugin\.json/);
  assert.doesNotMatch(installDocs, /\.claude-plugin\/plugin\.json/);
  assert.doesNotMatch(installDocs, /\.claude-plugin\/marketplace\.json/);
  assert.doesNotMatch(installDocs, /marketplace install/i);
  assert.doesNotMatch(installDocs, /Minimal Codex plugin manifest/i);
  assert.doesNotMatch(installDocs, /Minimal Claude Code plugin manifest/i);
  assert.doesNotMatch(
    installDocs,
    /^(?!.*\b(?:do not|don't|not)\b).*copy only\s+`?SKILL\.md`?/gim,
    'install docs must not tell users to copy only SKILL.md'
  );
});
