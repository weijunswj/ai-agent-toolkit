'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const validator = require('../scripts/validate-toolkit.cjs');

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

function duplicates(values) {
  const seen = new Set();
  const repeated = new Set();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated].sort();
}

function assertWindowsHookRecoveryGuidance(text, label) {
  assert.match(text, /\.sh/, label);
  assert.match(text, /Windows/i, label);
  assert.match(text, /repair-codex-plugin-windows-hooks\.cjs --plugin-root/, label);
  assert.match(text, /audit-n8n-skills-plugin-hooks\.cjs --plugin-root/, label);
  assert.match(text, /C:\\WINDOWS\\system32\\bash\.exe/, label);
  assert.match(text, /C:\\Program Files\\Git\\(?:bin|usr\\bin)\\bash\.exe|Windows Git Bash/i, label);
  assert.match(text, /do not approve (?:or trust )?(?:(?:the|those) )?hooks/i, label);
  assert.match(text, /npx skills add n8n-io\/skills/, label);
  assert.match(text, /using-n8n-skills/, label);
  assert.match(text, /repair (?:fails|cannot|failed)|cannot be repaired/i, label);
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
  const { routed, omitted } = validator.parseSkillRouting(routing);
  const omittedNames = omitted.map((entry) => entry.name);
  const current = skillNames();
  const currentSet = new Set(current);
  const omittedSet = new Set(omittedNames);

  assert.deepEqual(duplicates(routed), [], 'routing table should not list a skill twice');
  assert.deepEqual(duplicates(omittedNames), [], 'omitted skills should not list a skill twice');
  assert.deepEqual(
    routed.filter((name) => omittedSet.has(name)),
    [],
    'a skill should not be both routed and intentionally omitted'
  );

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

test('skill safety matrix covers current skill folders and safety boundaries', () => {
  const matrix = readText(path.join(repoRoot, 'repo', 'docs', 'SKILL-SAFETY-MATRIX.md'));
  const headerLine = matrix.split('\n').find((line) => line.startsWith('| Skill |'));
  const requiredColumns = [
    'Skill',
    'Primary Trigger',
    'Risk Class',
    'Local Writes',
    'Scripts Or Tools',
    'External Or Live Risk',
    'Approval Boundary',
    'Companion Skills',
    'Source/Provenance',
    'Notes And Boundaries'
  ];
  const rows = [...matrix.matchAll(/^\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|(.+)$/gm)]
    .map((match) => ({
      name: match[1],
      link: match[2],
      cells: match[0].split('|').slice(1, -1).map((cell) => cell.trim())
    }))
    .filter((row) => row.link.startsWith('../../skills/'));
  const rowNames = rows.map((row) => row.name).sort();
  const current = skillNames();

  assert.ok(headerLine, 'skill safety matrix should have a Markdown table');
  assert.deepEqual(
    headerLine.split('|').slice(1, -1).map((cell) => cell.trim()),
    requiredColumns,
    'skill safety matrix should keep the approved safety columns'
  );
  assert.deepEqual(duplicates(rowNames), [], 'skill safety matrix should not list a skill twice');
  assert.deepEqual(rowNames, current, 'skill safety matrix should cover every skills/*/SKILL.md folder exactly once');

  for (const row of rows) {
    assert.equal(row.link, `../../skills/${row.name}/`, `${row.name} should link to its skill folder`);
    assert.equal(row.cells.length, requiredColumns.length, `${row.name} row should fill every safety column`);
    for (const [index, cell] of row.cells.entries()) {
      assert.ok(cell, `${row.name} ${requiredColumns[index]} cell should not be empty`);
    }
    assert.match(row.cells[2], /^(Low|Medium|High)$/);
  }
});

test('README skill table covers current skill folders exactly once', () => {
  const readme = readText(path.join(repoRoot, 'README.md'));
  const skillsSection = readme.match(/^## Skills\s*$(?<body>[\s\S]*?)(?=^##\s+)/m)?.groups?.body || '';
  assert.ok(skillsSection, 'README should include a Skills section');

  const rows = [...skillsSection.matchAll(/^\|\s*\[([^\]]+)\]\(skills\/([^/)]+)\/\)\s*\|/gm)]
    .map((match) => ({ label: match[1], skill: match[2] }))
    .sort((a, b) => a.skill.localeCompare(b.skill));
  const rowSkills = rows.map((row) => row.skill);
  const current = skillNames();

  assert.deepEqual(duplicates(rowSkills), [], 'README skill table should not list a skill twice');
  assert.deepEqual(rowSkills, current, 'README skill table should cover every skills/*/SKILL.md folder exactly once');

  for (const row of rows) {
    assert.ok(row.label.trim().length >= 3, `${row.skill} README table label should be descriptive`);
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
  const readmeInstallSection = readme.split('\n## Install Skills By Platform\n')[1].split('\n## MCP Status\n')[0];
  const howToUseInstallSection = howToUse.split('\n## Install Toolkit Skills\n')[1].split('\n## Documentation Links\n')[0];

  for (const heading of ['Codex Setup', 'Claude Code Setup', 'OpenCode Setup', 'Antigravity 2 Setup']) {
    assert.match(howToUse, new RegExp(`^## ${heading}$`, 'm'), heading);
  }

  for (const heading of ['Codex', 'Claude Code', 'OpenCode', 'Antigravity 2']) {
    assert.match(howToUse, new RegExp(`^### ${heading}$`, 'm'), heading);
  }

  assert.match(readme, /^## Install Skills By Platform$/m);
  assert.match(readmeInstallSection, /This section is only for manually copying Toolkit-owned skill folders/);
  for (const platform of ['Codex', 'Claude Code', 'OpenCode', 'Antigravity 2']) {
    assert.match(readme, new RegExp(`\\| ${platform.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\|`), platform);
  }

  assert.match(howToUse, /### Native Toolkit Setup/);
  assert.match(howToUse, /For normal human setup, keep the journey short/);
  assert.match(howToUse, /For Codex, open the repo in Codex and say `setup toolkit`/);
  assert.match(howToUse, /manually approve the startup hook when Codex prompts/);
  assert.match(howToUse, /For Claude Code, use Claude Code's native Toolkit plugin flow from this repo/);
  assert.match(howToUse, /\.codex-plugin\/plugin\.json/);
  assert.match(howToUse, /\.claude-plugin\/plugin\.json/);
  assert.match(howToUse, /Codex does not install or update Claude Code/);
  assert.match(howToUse, /Claude Code does not install or update Codex/);
  assert.match(howToUse, /OpenCode and Antigravity 2 are opt-in local bridge targets/);
  assert.match(howToUse, /Manual installation means copying a Toolkit-owned `skills\/<skill-name>\/` folder into one supported location/);
  assert.doesNotMatch(howToUseInstallSection, /\[Official n8n Skills\]/);
  assert.doesNotMatch(howToUseInstallSection, /setup n8n plugin/i);
  assert.doesNotMatch(howToUseInstallSection, /using-n8n-skills|n8n_live/);
  assert.doesNotMatch(howToUseInstallSection, /codex plugin marketplace add n8n-io\/skills/);
  assert.doesNotMatch(howToUseInstallSection, /node repo\/scripts\/repair-codex-plugin-windows-hooks\.cjs --plugin-root/);
  assert.match(howToUse, /Copy whole skill folders, not just `SKILL\.md`/);
  assert.match(howToUse, /Keep `README\.md`, `references\/`, `templates\/`, `agents\/`, `packs\/`, and other supporting files beside `SKILL\.md` when present/);
  assert.match(howToUse, /Do not paste secrets, tokens, `.env` values, or credentials into repo files/);
  assert.match(howToUse, /### Manual Skill Folder Locations/);
  assert.match(howToUse, /Codex \| `<repo>\/\.agents\/skills\/<skill-name>\/`/);
  assert.match(howToUse, /Claude Code \| `<repo>\/\.claude\/skills\/<skill-name>\/`/);
  assert.match(howToUse, /OpenCode \| `<repo>\/\.opencode\/skills\/<skill-name>\/`/);
  assert.match(howToUse, /Antigravity 2 \| `C:\\Users\\<user>\\\.gemini\\config\\plugins\\<plugin-name>\\skills\\<skill-name>\\SKILL\.md`/);
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

  assert.match(readme, /For Codex, open the repo in Codex and say `setup toolkit`/);
  assert.match(readme, /manually approve the startup hook when Codex prompts/);
  assert.match(readme, /For Claude Code, use Claude Code's native Toolkit plugin flow from this repo/);
  assert.match(readmeInstallSection, /Copy the whole `skills\/<skill-name>\/` folder into \*\*ANY ONE\*\* supported location/);
  assert.match(readme, /`C:\\Users\\<user>\\\.gemini\\config\\plugins\\<plugin-name>\\skills\\<skill-name>\\`/);
  assert.match(readme, /\| Platform \| Manual Toolkit-owned skill folder locations \| Active instruction files \| Reference \|/);
  assert.match(readme, /\| Codex \| `<repo>\/\.agents\/skills\/<skill-name>\/`<br>`\$HOME\/\.agents\/skills\/<skill-name>\/`<br>`\/etc\/codex\/skills\/<skill-name>\/` \|/);
  assert.match(readme, /\| Claude Code \| `<repo>\/\.claude\/skills\/<skill-name>\/`<br>`\$HOME\/\.claude\/skills\/<skill-name>\/` \|/);
  assert.match(readme, /\| OpenCode \| `<repo>\/\.opencode\/skills\/<skill-name>\/`/);
  assert.match(readme, /\| Antigravity 2 \| `C:\\Users\\<user>\\\.gemini\\config\\plugins\\<plugin-name>\\skills\\<skill-name>\\` \|/);
  assert.match(readme, /\| Codex \|[^\n]*\| `AGENTS\.md` \|/);
  assert.match(readme, /\| Claude Code \|[^\n]*\| `AGENTS\.md`, `CLAUDE\.md` shim \|/);
  assert.match(readme, /\| OpenCode \|[^\n]*\| `AGENTS\.md` \|/);
  assert.match(readme, /\| Antigravity 2 \|[^\n]*\| `AGENTS\.md`, `GEMINI\.md`, Antigravity 2 bootstrap \|/);
  assert.doesNotMatch(readmeInstallSection, /Native plugin package via/);
  assert.doesNotMatch(readmeInstallSection, /Opt-in bridge target/);
  assert.doesNotMatch(readmeInstallSection, /\[Official n8n Skills\]/);
  assert.doesNotMatch(readmeInstallSection, /setup n8n plugin|using-n8n-skills|n8n_live/i);
  assert.doesNotMatch(readme, /codex plugin marketplace add n8n-io\/skills/);
  assert.doesNotMatch(readme, /node repo\/scripts\/repair-codex-plugin-windows-hooks\.cjs --plugin-root/);
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
  assert.match(howToUse, /\[Antigravity 2 reference\]\(\.\.\/\.\.\/skills\/n8n-local-setup\/references\/ai-agent-platforms\/antigravity\.md\)/);

  assert.match(codexRef, /Do not copy, fork, vendor, mirror, or recreate the official \[`n8n-io\/skills`\]\(https:\/\/github\.com\/n8n-io\/skills\) content inside this toolkit/);
  assert.match(codexRef, /On Windows, repair and audit the installed plugin cache before approving or trusting hooks/);
  assert.match(codexRef, /rewrites generic `\.sh` hook commands through `hooks\/run-hook\.ps1`/);
  assert.match(codexRef, /patches `n8n-skills@n8n-io` hook emitters with Node JSON fallbacks/);
  assertWindowsHookRecoveryGuidance(codexRef, 'generated codex ref recovery guidance');
  assert.match(codexRef, /codex plugin marketplace add n8n-io\/skills/);
  assert.match(codexRef, /codex plugin add n8n-skills@n8n-io/);
  assert.match(codexRef, /Start n8n work by loading the \[official n8n Skills\]\(https:\/\/github\.com\/n8n-io\/skills\) entry-point meta-skill, currently `using-n8n-skills`/);
  assert.match(codexRef, /`n8n_live`/);
  assert.match(claudeCodeRef, /Do not copy, fork, vendor, mirror, or recreate the official \[`n8n-io\/skills`\]\(https:\/\/github\.com\/n8n-io\/skills\) content inside this toolkit/);
  assert.match(claudeCodeRef, /On Windows, repair and audit the installed plugin cache before approving or trusting hooks/);
  assert.match(claudeCodeRef, /rewrites generic `\.sh` hook commands through `hooks\/run-hook\.ps1`/);
  assert.match(claudeCodeRef, /patches `n8n-skills@n8n-io` hook emitters with Node JSON fallbacks/);
  assertWindowsHookRecoveryGuidance(claudeCodeRef, 'generated claude ref recovery guidance');
  assert.match(claudeCodeRef, /\/plugin marketplace add n8n-io\/skills/);
  assert.match(claudeCodeRef, /\/plugin install n8n-skills@n8n-io/);
  assert.match(claudeCodeRef, /Start n8n work by loading the \[official n8n Skills\]\(https:\/\/github\.com\/n8n-io\/skills\) entry-point meta-skill, currently `using-n8n-skills`/);
  assert.match(claudeCodeRef, /`n8n_live`/);
  assert.match(opencodeRef, /official README's "Other platforms" category/);
  assert.match(opencodeRef, /npx skills add n8n-io\/skills/);
  assert.match(opencodeRef, /`SessionStart` loads the \[official n8n Skills\]\(https:\/\/github\.com\/n8n-io\/skills\) entry-point meta-skill, currently `using-n8n-skills`, automatically/);
  assert.match(opencodeRef, /`PreToolUse` nudges the agent to consult the matching skill/);
  assert.match(opencodeRef, /`PostToolUse` can provide follow-up reminders/);
  assert.match(opencodeRef, /Plain skill installs do not include the plugin `SessionStart`, `PreToolUse`, or `PostToolUse` hooks/);
  assert.match(opencodeRef, /target repo's `AGENTS\.md`/);
  assert.match(opencodeRef, /`n8n_live`/);
  assert.match(antigravityRef, /official README's "Other platforms" category/);
  assert.match(antigravityRef, /npx skills add n8n-io\/skills/);
  assert.match(antigravityRef, /`SessionStart` loads the \[official n8n Skills\]\(https:\/\/github\.com\/n8n-io\/skills\) entry-point meta-skill, currently `using-n8n-skills`, automatically/);
  assert.match(antigravityRef, /`PreToolUse` nudges the agent to consult the matching skill/);
  assert.match(antigravityRef, /`PostToolUse` can provide follow-up reminders/);
  assert.match(antigravityRef, /Plain skill installs do not include the plugin `SessionStart`, `PreToolUse`, or `PostToolUse` hooks/);
  assert.match(antigravityRef, /target repo's `AGENTS\.md`/);
  assert.match(antigravityRef, /`n8n_live`/);

  const installDocs = [howToUse, readme, codexRef, claudeCodeRef, opencodeRef, antigravityRef].join('\n');
  assert.match(installDocs, /\.codex-plugin\/plugin\.json/);
  assert.match(installDocs, /\.claude-plugin\/plugin\.json/);
  assert.doesNotMatch(installDocs, /\.claude-plugin\/marketplace\.json/);
  assert.doesNotMatch(installDocs, /(?:codex|claude) plugin package template/i);
  assert.doesNotMatch(installDocs, /Minimal Codex plugin manifest/i);
  assert.doesNotMatch(installDocs, /Minimal Claude Code plugin manifest/i);
  assert.doesNotMatch(
    installDocs,
    /^(?!.*\b(?:do not|don't|not)\b).*copy only\s+`?SKILL\.md`?/gim,
    'install docs must not tell users to copy only SKILL.md'
  );
});

test('n8n-local-setup plugin flow stays Windows-safe before hook approval', () => {
  const rootDocs = [
    'README.md',
    'repo/docs/HOW-TO-USE.md'
  ];

  for (const relPath of rootDocs) {
    const text = readText(path.join(repoRoot, relPath));
    assert.match(text, /n8n Local Setup|skills\/n8n-local-setup/i, relPath);
    assert.doesNotMatch(text, /codex plugin marketplace add n8n-io\/skills/, relPath);
    assert.doesNotMatch(text, /repair-codex-plugin-windows-hooks\.cjs --plugin-root/, relPath);
  }

  const paths = [
    '_projects/n8n/local-setup/_main/mcp setup - codex.md',
    'skills/n8n-local-setup/references/ai-agent-platforms/codex.md',
    '_projects/n8n/local-setup/_main/templates/mcp-configs/codex-mcp-config.md',
    'skills/n8n-local-setup/templates/mcp-configs/codex-mcp-config.md'
  ];

  for (const relPath of paths) {
    const text = readText(path.join(repoRoot, relPath));
    assert.match(text, /setup n8n plugin/i, relPath);
    assert.match(text, /Install the official n8n plugin only if hooks can be made Windows-safe/i, relPath);
    assert.match(text, /bare `?\.sh`? hooks?/i, relPath);
    assert.match(text, /open in VS Code|would open `session-start\.sh` in VS Code/i, relPath);
    assert.match(text, /repair-codex-plugin-windows-hooks\.cjs --plugin-root/, relPath);
    assert.match(text, /--verify-output/, relPath);
    assert.match(text, /audit-n8n-skills-plugin-hooks\.cjs --plugin-root/, relPath);
    assert.match(text, /do not approve (?:or trust )?(?:(?:the|those) )?hooks/i, relPath);
    assert.match(text, /Never touch `n8n_live`/i, relPath);
  }
});
