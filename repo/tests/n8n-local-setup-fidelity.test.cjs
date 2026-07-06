'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const syncScript = path.join(repoRoot, 'repo', 'scripts', 'sync-toolkit-projects.cjs');
const auditScript = path.join(repoRoot, 'repo', 'scripts', 'audit-published-surfaces.cjs');

const guideOutputs = [
  {
    source: '_main/Page 1 - Local Setup.md',
    output: 'skills/n8n-local-setup/references/n8n/local-setup.md'
  },
  {
    source: '_main/Page 2 - Hostinger VPS.md',
    output: 'skills/n8n-local-setup/references/n8n/hostinger-vps.md'
  },
  {
    source: '_main/Page 3 - Production Self-Hosting With Cloudflare Tunnel.md',
    output: 'skills/n8n-local-setup/references/n8n/production-cloudflare-tunnel.md'
  }
];

const platformOutputs = [
  {
    source: '_main/mcp setup - codex.md',
    output: 'skills/n8n-local-setup/references/ai-agent-platforms/codex.md'
  },
  {
    source: '_main/mcp setup - claude code.md',
    output: 'skills/n8n-local-setup/references/ai-agent-platforms/claude-code.md'
  },
  {
    source: '_main/mcp setup - opencode.md',
    output: 'skills/n8n-local-setup/references/ai-agent-platforms/opencode.md'
  },
  {
    source: '_main/mcp setup - antigravity.md',
    output: 'skills/n8n-local-setup/references/ai-agent-platforms/antigravity.md'
  }
];

const mcpConfigOutputs = [
  {
    source: '_main/templates/mcp-configs/antigravity-mcp-config.md',
    output: 'skills/n8n-local-setup/templates/mcp-configs/antigravity-mcp-config.md'
  },
  {
    source: '_main/templates/mcp-configs/claude-mcp-config.md',
    output: 'skills/n8n-local-setup/templates/mcp-configs/claude-mcp-config.md'
  },
  {
    source: '_main/templates/mcp-configs/codex-mcp-config.md',
    output: 'skills/n8n-local-setup/templates/mcp-configs/codex-mcp-config.md'
  },
  {
    source: '_main/templates/mcp-configs/opencode-mcp-config.md',
    output: 'skills/n8n-local-setup/templates/mcp-configs/opencode-mcp-config.md'
  }
];

const mcpConfigIndexOutput = {
  source: 'curated_output_for_ai/templates/mcp-configs/README.md',
  output: 'skills/n8n-local-setup/templates/mcp-configs/README.md'
};

const retiredMcpSetupPattern = new RegExp([
  'n8n-' + 'mcp@' + 'latest',
  'MCP_' + 'MODE',
  'DISABLE_' + 'CONSOLE_OUTPUT',
  'community ' + 'MCP',
  'n8n_' + 'docs'
].map(escapeRegExp).join('|'), 'i');

const overstatedOfficialMcpCapabilityPattern = new RegExp([
  'official n8n MCP ' + 'validation' + '/build tools',
  'official n8n MCP ' + 'validation',
  'official n8n MCP ' + 'build',
  'MCP ' + 'validation' + '/build'
].map(escapeRegExp).join('|'), 'i');
const officialN8nSkillsUrl = 'https://github.com/n8n-io/skills';
const officialN8nSkillsLink = `[official n8n Skills](${officialN8nSkillsUrl})`;
const officialN8nSkillsTitleLink = `[Official n8n Skills](${officialN8nSkillsUrl})`;

const localStackOutputs = [
  {
    source: '_main/templates/local-stack/docker-compose.yml',
    output: 'skills/n8n-local-setup/templates/local-stack/docker-compose.yml'
  },
  {
    source: '_main/templates/local-stack/.env.example',
    output: 'skills/n8n-local-setup/templates/local-stack/.env.example'
  },
  {
    source: '_main/templates/local-stack/.gitignore',
    output: 'skills/n8n-local-setup/templates/local-stack/.gitignore'
  },
  {
    source: '_main/templates/local-stack/_n8n-local.cmd',
    output: 'skills/n8n-local-setup/templates/local-stack/_n8n-local.cmd'
  },
  {
    source: '_main/templates/local-stack/n8n-local-desktop-shortcut.cmd',
    output: 'skills/n8n-local-setup/templates/local-stack/n8n-local-desktop-shortcut.cmd'
  },
  {
    source: '_main/templates/local-stack/scripts/n8n-local-menu.ps1',
    output: 'skills/n8n-local-setup/templates/local-stack/scripts/n8n-local-menu.ps1'
  }
];

const productionStackOutputs = [
  {
    source: '_main/templates/production-cloudflare-stack/docker-compose.yml',
    output: 'skills/n8n-local-setup/templates/production-cloudflare-stack/docker-compose.yml'
  },
  {
    source: '_main/templates/production-cloudflare-stack/.env.example',
    output: 'skills/n8n-local-setup/templates/production-cloudflare-stack/.env.example'
  },
  {
    source: '_main/templates/production-cloudflare-stack/.gitignore',
    output: 'skills/n8n-local-setup/templates/production-cloudflare-stack/.gitignore'
  },
  {
    source: '_main/templates/production-cloudflare-stack/_n8n-production-cloudflare.cmd',
    output: 'skills/n8n-local-setup/templates/production-cloudflare-stack/_n8n-production-cloudflare.cmd'
  },
  {
    source: '_main/templates/production-cloudflare-stack/scripts/n8n-production-cloudflare-menu.ps1',
    output: 'skills/n8n-local-setup/templates/production-cloudflare-stack/scripts/n8n-production-cloudflare-menu.ps1'
  }
];

const productionServerBackupOutputs = [
  {
    source: '_main/templates/production-server-backups/README.md',
    output: 'skills/n8n-local-setup/templates/production-server-backups/README.md'
  },
  {
    source: '_main/templates/production-server-backups/n8n-production-backup.sh.template',
    output: 'skills/n8n-local-setup/templates/production-server-backups/n8n-production-backup.sh.template'
  }
];

const obsoletePaths = [
  '_projects/n8n/local-setup/_main/1. local setup.md',
  '_projects/n8n/local-setup/_main/2. hostinger vps.md',
  '_projects/n8n/local-setup/_main/2. upgrading.md',
  '_projects/n8n/local-setup/_main/3. tunneling guide.md',
  '_projects/n8n/local-setup/_main/3a. docker compose + ngrok.md',
  '_projects/n8n/local-setup/_main/4. vps hosting.md',
  '_projects/n8n/local-setup/_main/5. extra - claude code integration.md',
  '_projects/n8n/local-setup/_main/6. extra - opencode integration.md',
  '_projects/n8n/local-setup/_main/7. extra - antigravity integration.md',
  '_projects/n8n/local-setup/_main/codex-mcp-config.md',
  '_projects/n8n/local-setup/_main/claude-mcp-config.md',
  '_projects/n8n/local-setup/_main/opencode-mcp-config.md',
  '_projects/n8n/local-setup/_main/antigravity-mcp-config.md',
  '_projects/n8n/local-setup/curated_output_for_ai/mcp/n8n-local-setup.md',
  'mcp/projects/n8n-local-setup.md',
  '_projects/n8n/local-setup/_main/templates/local-stack/n8n-local.cmd',
  '_projects/n8n/local-setup/_main/scripts/windows/start-n8n-ngrok.bat',
  'skills/n8n-local-setup/references/n8n/upgrading.md',
  'skills/n8n-local-setup/references/n8n/tunnelling.md',
  'skills/n8n-local-setup/references/n8n/docker-compose-ngrok.md',
  'skills/n8n-local-setup/references/n8n/vps-hosting.md',
  'skills/n8n-local-setup/templates/local-stack/n8n-local.cmd',
  'skills/n8n-local-setup/references/n8n/1. local setup.md',
  'skills/n8n-local-setup/references/n8n/3. tunneling guide.md',
  'skills/n8n-local-setup/references/n8n/3a. docker compose + ngrok.md',
  'skills/n8n-local-setup/references/n8n/4. vps hosting.md',
  'skills/n8n-local-setup/references/n8n/5. extra - claude code integration.md',
  'skills/n8n-local-setup/references/n8n/6. extra - opencode integration.md',
  'skills/n8n-local-setup/references/ai-agent-platforms/1. local setup.md'
];

const expectedMainMenuOptions = [
  'Start n8n',
  'Restart n8n',
  'Stop n8n',
  'Update',
  'Show Compose status',
  'View logs',
  'Back up',
  'Advanced / Recovery: Restore local n8n from backup',
  'Command list',
  'Exit'
];

const expectedStartMenuOptions = [
  'Localhost only',
  'Start ngrok tunnel',
  'Update all, then start with ngrok tunnel',
  'Cancel'
];

const expectedStopMenuOptions = [
  'n8n + ngrok tunnel',
  'Stop ngrok tunnel',
  'Cancel'
];

const expectedUpdateMenuOptions = [
  'All services',
  'n8n only',
  'postgres only',
  'ngrok only',
  'Cancel'
];

const expectedBackupMenuOptions = [
  'Back up now',
  'Change automatic backup settings',
  'Remove automatic backups',
  'Back',
  'Set up automatic backups',
  'Back'
];

function tempCopy() {
  const target = fs.mkdtempSync(path.join(os.tmpdir(), 'toolkit-n8n-fidelity-'));
  fs.cpSync(repoRoot, target, {
    recursive: true,
    filter(source) {
      const rel = path.relative(repoRoot, source).replace(/\\/g, '/');
      return !rel.startsWith('.git') && !rel.startsWith('_dist') && !rel.startsWith('node_modules');
    }
  });
  return target;
}

function readText(root, relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8').replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function stripGeneratedNotices(text) {
  let remaining = text.trimStart();
  while (remaining.startsWith('<!--')) {
    const end = remaining.indexOf('-->');
    assert.notEqual(end, -1, 'generated notice close marker');
    remaining = remaining.slice(end + '-->'.length).trimStart();
  }
  return remaining.trimEnd() + '\n';
}

function assertCapabilityAwareMcpGuidance(text, label) {
  assert.match(text, new RegExp(escapeRegExp(`${officialN8nSkillsLink} first`), 'i'), label);
  assert.match(text, /n8n MCP tools that are actually available/i, label);
  assert.match(text, /Discover available n8n MCP tools before relying on validation, build, update, execution, or inspection capabilities/i, label);
  assert.doesNotMatch(text, overstatedOfficialMcpCapabilityPattern, label);
}

function assertWindowsHookRecoveryGuidance(text, label) {
  assert.match(text, /\.sh/, label);
  assert.match(text, /Windows/i, label);
  assert.match(text, /repair-codex-plugin-windows-hooks\.cjs --plugin-root/, label);
  assert.match(text, /audit-n8n-skills-plugin-hooks\.cjs --plugin-root/, label);
  assert.match(text, /C:\\WINDOWS\\system32\\bash\.exe|unsafe bare `?\.sh`? hook on Windows/i, label);
  assert.match(text, /C:\\Program Files\\Git\\(?:bin|usr\\bin)\\bash\.exe|Windows Git Bash/i, label);
  assert.match(text, /do not approve (?:or trust )?(?:(?:the|those) )?hooks/i, label);
  assert.match(text, /npx skills add n8n-io\/skills/, label);
  assert.match(text, /using-n8n-skills/, label);
  assert.match(text, /repair (?:fails|cannot|failed)|cannot be repaired/i, label);
}

function applyTextRewrites(text, output) {
  let rewritten = text;
  for (const rewrite of output.text_rewrites || []) {
    rewritten = rewritten.split(rewrite.from).join(rewrite.to);
  }
  return rewritten;
}

function localSetupManifest(root = repoRoot) {
  return JSON.parse(readText(root, '_projects/n8n/local-setup/toolkit.project.json'));
}

function auditJson(root = repoRoot) {
  const result = spawnSync(process.execPath, [auditScript, '--json'], { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function assertHeadingsInOrder(text, headings) {
  let lastIndex = -1;
  for (const heading of headings) {
    assert.match(text, new RegExp(`^${escapeRegExp(heading)}$`, 'm'), heading);
    const index = text.indexOf(heading);
    assert.ok(index > lastIndex, heading);
    lastIndex = index;
  }
}

function functionBody(text, name) {
  const start = text.indexOf(`function ${name}`);
  assert.notEqual(start, -1, name);
  const nextFunction = text.indexOf('\nfunction ', start + 1);
  return nextFunction === -1 ? text.slice(start) : text.slice(start, nextFunction);
}

function menuOptions(menu, functionName) {
  const body = functionBody(menu, functionName);
  return [...body.matchAll(/Write-Host ' \s*\d+\. ([^']+)'/g)].map((match) => match[1]);
}

function findPowerShell() {
  const candidates = process.platform === 'win32' ? ['powershell.exe', 'pwsh'] : ['pwsh', 'powershell'];
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'], {
      encoding: 'utf8'
    });
    if (!result.error && result.status === 0) {
      return candidate;
    }
  }
  return null;
}

function powerShellSingleQuoted(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

test('n8n local setup final source and generated surfaces are declared', () => {
  const manifest = localSetupManifest();
  for (const expected of [...guideOutputs, ...localStackOutputs, ...productionStackOutputs, ...productionServerBackupOutputs, ...platformOutputs, ...mcpConfigOutputs]) {
    const output = manifest.outputs.find((entry) => entry.output === expected.output);
    assert.ok(output, expected.output);
    assert.equal(output.kind, 'copy', expected.output);
    assert.equal(output.source, expected.source, expected.output);
    assert.equal(output.fidelity, 'exact', expected.output);
    assert.ok(manifest.writes.allowed.includes(expected.output), expected.output);
  }

  const mcpIndexOutput = manifest.outputs.find((entry) => entry.output === mcpConfigIndexOutput.output);
  assert.ok(mcpIndexOutput, mcpConfigIndexOutput.output);
  assert.equal(mcpIndexOutput.kind, 'curated', mcpConfigIndexOutput.output);
  assert.equal(mcpIndexOutput.source, mcpConfigIndexOutput.source, mcpConfigIndexOutput.output);
  assert.equal(mcpIndexOutput.fidelity, 'reviewed_entrypoint', mcpConfigIndexOutput.output);
  assert.ok(manifest.writes.allowed.includes(mcpConfigIndexOutput.output), mcpConfigIndexOutput.output);

  for (const removed of [
    'mcp/projects/n8n-local-setup.md',
    'skills/n8n-local-setup/references/n8n/upgrading.md',
    'skills/n8n-local-setup/references/n8n/tunnelling.md',
    'skills/n8n-local-setup/references/n8n/docker-compose-ngrok.md',
    'skills/n8n-local-setup/references/n8n/vps-hosting.md',
    'skills/n8n-local-setup/templates/local-stack/n8n-local.cmd'
  ]) {
    assert.equal(manifest.outputs.some((entry) => entry.output === removed), false, removed);
    assert.equal(manifest.writes.allowed.includes(removed), false, removed);
  }
});

test('n8n local setup generated files preserve source bodies', () => {
  const manifest = localSetupManifest();
  for (const expected of guideOutputs) {
    const source = readText(repoRoot, `_projects/n8n/local-setup/${expected.source}`).trimEnd() + '\n';
    const recipe = manifest.outputs.find((entry) => entry.output === expected.output);
    const output = stripGeneratedNotices(readText(repoRoot, expected.output));
    assert.equal(output, applyTextRewrites(source, recipe), expected.output);
  }

  for (const expected of platformOutputs) {
    const source = readText(repoRoot, `_projects/n8n/local-setup/${expected.source}`).trimEnd() + '\n';
    const recipe = manifest.outputs.find((entry) => entry.output === expected.output);
    const output = stripGeneratedNotices(readText(repoRoot, expected.output));
    assert.equal(output, applyTextRewrites(source, recipe), expected.output);
  }

  for (const expected of localStackOutputs) {
    const source = readText(repoRoot, `_projects/n8n/local-setup/${expected.source}`).trimEnd() + '\n';
    const output = readText(repoRoot, expected.output);
    assert.equal(output, source, expected.output);
  }

  for (const expected of [...productionStackOutputs, ...productionServerBackupOutputs]) {
    const source = readText(repoRoot, `_projects/n8n/local-setup/${expected.source}`).trimEnd() + '\n';
    const outputText = readText(repoRoot, expected.output);
    const output = expected.output.endsWith('.md') ? stripGeneratedNotices(outputText) : outputText;
    assert.equal(output, source, expected.output);
  }

  for (const expected of mcpConfigOutputs) {
    const source = readText(repoRoot, `_projects/n8n/local-setup/${expected.source}`).trimEnd() + '\n';
    const output = stripGeneratedNotices(readText(repoRoot, expected.output));
    assert.equal(output, source, expected.output);
  }

  const mcpIndexSource = stripGeneratedNotices(readText(repoRoot, `_projects/n8n/local-setup/${mcpConfigIndexOutput.source}`));
  const mcpIndexGenerated = stripGeneratedNotices(readText(repoRoot, mcpConfigIndexOutput.output));
  assert.equal(mcpIndexGenerated, mcpIndexSource, mcpConfigIndexOutput.output);
});

test('obsolete n8n local setup pages and launchers are removed', () => {
  for (const relPath of obsoletePaths) {
    assert.equal(fs.existsSync(path.join(repoRoot, relPath)), false, relPath);
  }

  const manifestText = readText(repoRoot, '_projects/n8n/local-setup/toolkit.project.json');
  const sourceManifest = readText(repoRoot, '_projects/n8n/local-setup/SOURCE-MANIFEST.md');
  const n8nIndex = readText(repoRoot, '_projects/n8n/local-setup/curated_output_for_ai/references/n8n/README.md');
  const publishedIndex = readText(repoRoot, 'skills/n8n-local-setup/references/n8n/README.md');
  const combined = `${manifestText}\n${sourceManifest}\n${n8nIndex}\n${publishedIndex}`;

  for (const stale of ['upgrading.md', 'tunnelling.md', 'docker-compose-ngrok.md', 'templates/local-stack/n8n-local.cmd', 'start-n8n-ngrok.bat']) {
    assert.doesNotMatch(combined, new RegExp(escapeRegExp(stale)), stale);
  }
  assert.doesNotMatch(combined, /mcp\/projects\/n8n-local-setup\.md/);
  assert.match(combined, /mcp setup - codex\.md/);
  assert.match(combined, /codex-mcp-config\.md/);
});

test('n8n local setup source README exposes two main beginner pages', () => {
  const readme = readText(repoRoot, '_projects/n8n/local-setup/_main/README.md');

  assert.match(readme, /^## Start Here$/m);
  assert.match(readme, /\[Page 1 - Local Setup\]\(\.\/Page%201%20-%20Local%20Setup\.md\)/);
  assert.match(readme, /\[Page 2 - Hostinger Coolify VPS n8n\]\(\.\/Page%202%20-%20Hostinger%20VPS\.md\)/);
  assert.match(readme, /^## Supporting Materials$/m);
  assert.match(readme, /Local stack templates/);
  assert.doesNotMatch(readme, /Local helper scripts/);
  assert.doesNotMatch(readme, /\[scripts\/\]\(\.\/scripts\/\)/);
  assert.match(readme, /^## Skills-First Routing$/m);
  assert.match(readme, /Humans use `_projects\/\*\*`/);
  assert.match(readme, /Agents use generated `skills\/\*\*` surfaces after sync/);
  assert.match(readme, new RegExp(`${escapeRegExp(officialN8nSkillsTitleLink)} plus instance-level MCP references are secondary and only for users intentionally enabling n8n workflow work through an AI coding agent\\.`));
  assert.match(readme, new RegExp(`^## ${escapeRegExp(officialN8nSkillsTitleLink)} And MCP References$`, 'm'));
  assert.match(readme, /This section is for using AI coding agents to work on n8n workflows\./);
  assert.doesNotMatch(readme, /Skip this section for beginner local setup/);
  assert.match(readme, /\[mcp setup - codex\.md\]\(\.\/mcp%20setup%20-%20codex\.md\)/);
  assert.match(readme, /\[codex-mcp-config\.md\]\(\.\/templates\/mcp-configs\/codex-mcp-config\.md\)/);
  assert.match(readme, /\*\*If the \[AI Coding Agent Rules\]\(\.\.\/\.\.\/\.\.\/\.\.\/skills\/ai-coding-agent-rules\/\) skill is installed, repo-local templates are automatically checked/);

  for (const stale of ['Upgrading', 'Tunneling Guide', 'Docker Compose + ngrok', 'MCP setup pages', 'MCP config templates', 'extra - claude', 'extra - opencode', 'extra - antigravity']) {
    assert.doesNotMatch(readme, new RegExp(stale, 'i'), stale);
  }
});

test('Local Setup keeps the corrected beginner flow', () => {
  const localSetup = readText(repoRoot, '_projects/n8n/local-setup/_main/Page 1 - Local Setup.md');

  assert.match(localSetup, /^# Page 1 - Local Setup$/m);
  assert.match(localSetup, /\* Start local n8n first\./);
  assert.match(localSetup, /\n---\n\n## 1\. Fast Path/);
  assertHeadingsInOrder(localSetup, [
    '## 1. Fast Path ( Full Guide Below )',
    '## 2. Before You Start',
    '## 3. Create The Local Stack Folder',
    '## 4. Copy The Local Stack Templates',
    '## 5. Create And Fill `.env`',
    '## 6. First-Time Local n8n Setup',
    '## 7. ngrok Public Tunnel Setup',
    '## 8. `_n8n-local.cmd` Guide',
    '## 9. Skills-First Agent Guidance',
    '## 10. Troubleshooting',
    '## 11. Advanced Queue Mode',
    '## 12. Safety Rules',
    '## 13. Appendices And References'
  ]);

  assert.match(localSetup, /Do not ask for ngrok or public URL values before local n8n works/i);
  assert.match(localSetup, /Open a web browser/);
  assert.match(localSetup, /Open a web browser and go to `http:\/\/localhost:5678`/);
  assert.match(localSetup, /Create the owner account locally/);
  assert.match(localSetup, /Do not install a separate ngrok extension for this guide/);
  assert.doesNotMatch(localSetup, /dashboard\.ngrok\.com\/get-started\/setup\/docker-desktop/);
  assert.doesNotMatch(localSetup, /ngrok Docker Desktop extension/);
  assert.match(localSetup, /ngrok connects to `n8n:5678` inside the same Docker Compose network/);
  assert.match(localSetup, /Choose `Start n8n`/);
  assert.match(localSetup, /Choose `Start ngrok tunnel`/);
  assert.match(localSetup, /Read the quick status at the top of the main menu and confirm `ngrok: running`/);
  assert.match(localSetup, /choose `Show Compose status` to see service state, health, container names, and ports/);
  assert.match(localSetup, /ngrok Docker setup dashboard page/);
  assert.match(localSetup, /not Docker Desktop/);
  assert.match(localSetup, /bottom of section 1/);
  assert.match(localSetup, /Free ngrok accounts get an assigned Dev Domain/);
  assert.match(localSetup, /Stopping the `ngrok` Docker service stops the tunnel/);
  assert.match(localSetup, /OneDrive Desktop redirection/);
  assert.match(localSetup, /`%USERPROFILE%\\\.n8n-local`/);
  assert.match(localSetup, /C:\\Users\\<your-user>\\\.n8n-local/);
  assert.doesNotMatch(localSetup, /C:\\Users\\xPass/);
  assert.doesNotMatch(localSetup, /xPass/);
  assert.match(localSetup, /`C:\\\.n8n-local`/);
  assert.match(localSetup, /`C:\\Users\\<you>\\Documents\\\.n8n-local`/);
  assert.doesNotMatch(localSetup, /`C:\\n8n-local`/);
  assert.doesNotMatch(localSetup, /`C:\\Users\\<you>\\Documents\\n8n-local`/);
  assert.match(localSetup, /\$DesktopPath = \[Environment\]::GetFolderPath\('Desktop'\)/);
  assert.match(localSetup, /Join-Path \$DesktopPath 'n8n-local-desktop-shortcut\.cmd'/);
  assert.match(localSetup, /C:\\Users\\<you>\\OneDrive\\Desktop/);
  assert.doesNotMatch(localSetup, /\$env:USERPROFILE\\Desktop/);
  assert.match(localSetup, /`<LOCAL_STACK_FOLDER>`/);
  assert.match(localSetup, /Do not launch n8n directly from Docker Desktop\. Launch it from `_n8n-local\.cmd` instead because/);
});

test('Local Setup separates .env and public URL values without MCP setup values', () => {
  const localSetup = readText(repoRoot, '_projects/n8n/local-setup/_main/Page 1 - Local Setup.md');
  const envExample = readText(repoRoot, '_projects/n8n/local-setup/_main/templates/local-stack/.env.example');

  assert.match(localSetup, /Copy `\.env\.example` to `\.env`/);
  assert.match(localSetup, /Do not edit `\.env\.example`/);
  assert.match(localSetup, /if \(-not \(Test-Path -LiteralPath "\.env"\)\) \{/);
  assert.match(localSetup, /Write-Host "\.env already exists; leaving it unchanged\."/);
  assert.doesNotMatch(localSetup, /Copy-Item -LiteralPath "\.env\.example" -Destination "\.env" -Force/);
  assert.match(localSetup, /Replace only the value after `=`/);
  assert.match(localSetup, /^### STEP 1: Fill These Before First Launch$/m);
  assert.match(localSetup, /^#### Postgres$/m);
  assert.match(localSetup, /^#### n8n$/m);
  assert.match(localSetup, /^### STEP 2: Fill These Later Only After Local n8n Works$/m);
  assert.doesNotMatch(localSetup, /^### STEP 3:/m);
  assert.match(localSetup, /you are allowed to invent any strong random value yourself/);
  assert.match(localSetup, /copy the real value from there/);
  assert.match(localSetup, /Compose uses it for both n8n timezone values/);
  assert.match(localSetup, /Keep as `n8n` unless you intentionally run multiple local stacks/);
  assert.match(localSetup, /`POSTGRES_DB` and `POSTGRES_USER` stay in `\.env` on purpose/);
  assert.match(localSetup, /Choose `N8N_LOCAL_PORT` before first launch/);
  assert.match(localSetup, /Docker uses this value when it creates the local n8n container/);
  assert.match(localSetup, /The launcher chooses the right active `WEBHOOK_URL` for n8n and writes it to `\.env\.active`/);
  assert.match(localSetup, /The launcher builds the localhost webhook URL from `N8N_LOCAL_PORT`/);
  assert.match(localSetup, /When you choose `Localhost only`, the active `WEBHOOK_URL` is built from `localhost` plus `N8N_LOCAL_PORT`/);
  assert.match(localSetup, /When you choose `Start ngrok tunnel`, the active `WEBHOOK_URL` is built from `NGROK_DOMAIN`/);
  assert.match(localSetup, /You will not see `\.env\.active` in a fresh copied stack folder/);
  assert.match(localSetup, /creates it automatically in `<LOCAL_STACK_FOLDER>`/);
  assert.match(localSetup, /It stays there after the menu closes and gets overwritten the next time you choose a start mode/);
  assert.match(localSetup, /You still open the n8n editor in your browser at `http:\/\/localhost:5678`/);
  assert.match(localSetup, /`WEBHOOK_URL` controls the public webhook and callback links n8n shows or builds/);
  assert.match(localSetup, /If the active `WEBHOOK_URL` in `\.env\.active` is an ngrok URL while `ngrok` is stopped, the menu warns you/);
  assert.match(localSetup, /You do not manually switch `WEBHOOK_URL`/);
  assert.match(localSetup, /Choose `Start n8n`, then `Start ngrok tunnel`, so the launcher writes `\.env\.active` and recreates n8n/);
  assert.match(localSetup, /If port `5678` is already used, change `N8N_LOCAL_PORT` to another unused port such as `5679`/);
  assert.match(localSetup, /It reads `N8N_LOCAL_PORT` from `\.env` automatically/);
  assert.match(localSetup, /"127\.0\.0\.1:\$\{N8N_LOCAL_PORT:-5678\}:5678"/);
  assert.match(localSetup, /https:\/\/dashboard\.ngrok\.com\/get-started\/your-authtoken/);
  assert.match(localSetup, /https:\/\/dashboard\.ngrok\.com\/get-started\/setup\/docker/);
  assert.match(localSetup, /ngrok dashboard Docker page, not Docker Desktop/);
  assert.match(localSetup, /bottom of section 1/);
  assert.match(localSetup, /do not need `N8N_PROTOCOL` in this local `\.env`/i);
  assert.doesNotMatch(localSetup, /ngrok Docker Desktop extension/);
  assert.doesNotMatch(envExample, /N8N_PROTOCOL=/);
  assert.doesNotMatch(envExample, /N8N_HOST=/);
  assert.doesNotMatch(envExample, /N8N_PROXY_HOPS=/);
  assert.doesNotMatch(envExample, /N8N_LOCAL_WEBHOOK_URL=/);
  assert.doesNotMatch(envExample, /N8N_NGROK_WEBHOOK_URL=/);
  assert.doesNotMatch(envExample, /^TZ=/m);
  assert.doesNotMatch(envExample, /^GENERIC_TIMEZONE=/m);

  for (const variable of ['POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD', 'N8N_ENCRYPTION_KEY', 'LOCAL_TIMEZONE', 'N8N_LOCAL_PORT', 'NGROK_AUTHTOKEN', 'NGROK_DOMAIN']) {
    assert.match(localSetup, new RegExp(`\\| \`${variable}\` \\|`), variable);
  }

  for (const expected of [
    '# [ STEP 1: Fill These Before First Launch ]',
    '# Postgres',
    '# Keeping POSTGRES_DB and POSTGRES_USER visible so separate local stacks can use separate names.',
    '# n8n',
    '# Choose the browser port before first launch.',
    '# - https://dashboard.ngrok.com/get-started/setup/docker',
    '# - The free domain is near the bottom of section 1.',
    '# [ STEP 2: Fill These Later Only After Local n8n Works ]'
  ]) {
    assert.match(envExample, new RegExp(escapeRegExp(expected)), expected);
  }
  assert.doesNotMatch(envExample, /N8N_MCP_URL|N8N_MCP_TOKEN/);
  assert.doesNotMatch(localSetup, /\| `N8N_MCP_URL` \| Basic local stack/);
  assert.doesNotMatch(localSetup, /\| `N8N_MCP_TOKEN` \| Basic local stack/);
  assert.doesNotMatch(localSetup, /MCP Values For AI Agents|MCP URL|MCP token|Enable MCP|N8N_MCP_URL|N8N_MCP_TOKEN/);
});

test('Local Setup keeps skills-first guidance and official n8n setup table', () => {
  const localSetup = readText(repoRoot, '_projects/n8n/local-setup/_main/Page 1 - Local Setup.md');
  const publicIndex = localSetup.indexOf('## 7. ngrok Public Tunnel Setup');
  const skillsIndex = localSetup.indexOf('## 9. Skills-First Agent Guidance');

  assert.ok(publicIndex > -1, 'public URL setup section exists');
  assert.ok(skillsIndex > publicIndex, 'skills-first guidance appears after public URL setup');
  assert.match(localSetup, /This toolkit is skills-first\./);
  assert.match(localSetup, /Humans use `_projects\/\*\*` for source review and maintenance\./);
  assert.match(localSetup, /Agents use `skills\/\*\*` after generated outputs are synced\./);
  assert.match(localSetup, new RegExp(`${escapeRegExp(officialN8nSkillsTitleLink)} plus instance-level MCP references are available as secondary material, not as the beginner setup path\\.`));
  assert.match(localSetup, /Use \[n8n Agent Rules\]/);
  assert.match(localSetup, new RegExp(`Use this table only when you want an AI coding agent to work with n8n workflows through the ${escapeRegExp(officialN8nSkillsLink)} plus instance-level MCP setup`));

  for (const expected of [
    'mcp setup - codex.md',
    'mcp setup - claude code.md',
    'mcp setup - opencode.md',
    'mcp setup - antigravity.md',
    'codex-mcp-config.md',
    'claude-mcp-config.md',
    'opencode-mcp-config.md',
    'antigravity-mcp-config.md',
    '../../../../skills/n8n-local-setup/references/ai-agent-platforms/codex.md',
    '../../../../skills/n8n-local-setup/templates/mcp-configs/codex-mcp-config.md'
  ]) {
    assert.match(localSetup, new RegExp(escapeRegExp(expected)), expected);
  }

  for (const forbidden of [
    'Enable MCP',
    'through MCP',
    'N8N_MCP_TOKEN',
    'N8N_MCP_URL'
  ]) {
    assert.doesNotMatch(localSetup, new RegExp(escapeRegExp(forbidden)), forbidden);
  }
});

test('Local Setup menu tables match launcher option names exactly', () => {
  const localSetup = readText(repoRoot, '_projects/n8n/local-setup/_main/Page 1 - Local Setup.md');
  const menu = readText(repoRoot, '_projects/n8n/local-setup/_main/templates/local-stack/scripts/n8n-local-menu.ps1');

  assert.deepEqual(menuOptions(menu, 'Show-MainMenu'), expectedMainMenuOptions);
  assert.deepEqual(menuOptions(menu, 'Show-StartMenu'), expectedStartMenuOptions);
  assert.deepEqual(menuOptions(menu, 'Show-StopMenu'), expectedStopMenuOptions);
  assert.deepEqual(menuOptions(menu, 'Show-UpdateMenu'), expectedUpdateMenuOptions);
  assert.deepEqual(menuOptions(menu, 'Show-BackupMenu'), expectedBackupMenuOptions);

  for (const option of expectedMainMenuOptions.filter((name) => name !== 'Exit')) {
    assert.match(localSetup, new RegExp(`\\| \`${escapeRegExp(option)}\` \\|`), option);
  }

  for (const option of [...expectedStartMenuOptions, ...expectedStopMenuOptions, ...expectedUpdateMenuOptions].filter((name) => name !== 'Cancel')) {
    assert.match(localSetup, new RegExp(`\\| \`${escapeRegExp(option)}\` \\|`), option);
  }

  assert.match(localSetup, /^## 8\. `_n8n-local\.cmd` Guide$/m);
  assert.match(localSetup, /^### 8\.1 First Screen$/m);
  assert.match(localSetup, /^### 8\.2 `Start n8n` Menu$/m);
  assert.match(localSetup, /^### 8\.3 `Stop n8n` Menu$/m);
  assert.match(localSetup, /^### 8\.4 `Update` Menu$/m);
  assert.match(localSetup, /^### 8\.5 `View logs` Menu$/m);
  assert.match(localSetup, /The update menu asks what you want to update first\. After you choose, it pulls the selected image\(s\) and recreates the selected container\(s\) automatically\./);
  assert.match(localSetup, /`Back up` opens a simplified backup submenu/);
  assert.match(localSetup, /Automatic backups: Not set up/);
  assert.match(localSetup, /Automatic backups: Enabled/);
  assert.match(localSetup, /Writes a timestamped folder under `%USERPROFILE%\\\.n8n-local\\backups`/);
  assert.match(localSetup, /`Back up now`/);
  assert.match(localSetup, /workflows included, credentials included, and decrypted credentials disabled/);
  assert.match(localSetup, /`Set up automatic backups`/);
  assert.match(localSetup, /`Change automatic backup settings`/);
  assert.match(localSetup, /`Remove automatic backups`/);
  assert.doesNotMatch(localSetup, /Back up Postgres database now/);
  assert.doesNotMatch(localSetup, /Configure scheduled n8n CLI backups/);
  assert.doesNotMatch(localSetup, /Run n8n CLI backup now/);
  assert.doesNotMatch(localSetup, /Show n8n CLI backup configuration/);
  assert.doesNotMatch(localSetup, /Disable scheduled n8n CLI backups/);
  assert.match(localSetup, /n8n export:workflow --backup --output=<backup_dir>/);
  assert.match(localSetup, /n8n export:credentials --backup --output=<backup_dir>/);
  assert.match(localSetup, /Decrypted credential exports expose credential secrets in plain text files/);
  assert.match(localSetup, /n8n-cli-YYYYMMDD-HHMMSS/);
  assert.match(localSetup, /manifest\.json/);
  assert.match(localSetup, /Windows Task Scheduler/);
  assert.match(localSetup, /--run-n8n-cli-backup/);
  assert.match(localSetup, /--show-n8n-cli-backup-config/);
  assert.match(localSetup, /--disable-n8n-cli-backups/);
  assert.match(localSetup, /n8n import:workflow --separate --input=<workflows_dir>/);
  assert.match(localSetup, /n8n import:credentials --separate --input=<credentials_dir>/);
  assert.match(localSetup, /%USERPROFILE%\\\.n8n-local\\backups/);
  assert.match(localSetup, /^Restore:$/m);
  assert.match(localSetup, /If the backup env\/key is missing, restore stops before stopping services or touching the database/);
  assert.match(localSetup, /The launcher clears the completed command output, trims the console buffer when Windows allows it, and redraws the main menu\./);
  assert.match(localSetup, /For normal use, the quick status at the top of the main menu is enough/);
  assert.match(localSetup, /Use `Show Compose status` only when you need the more detailed Docker Compose view/);
  assert.match(localSetup, /`Command list` explains the numbered menu options/);
  assert.match(localSetup, /If the update includes Postgres, the launcher creates a database-level recovery backup first/);
});

test('local launcher and menu keep the console open until Exit', () => {
  const cmd = readText(repoRoot, '_projects/n8n/local-setup/_main/templates/local-stack/_n8n-local.cmd');
  const menu = readText(repoRoot, '_projects/n8n/local-setup/_main/templates/local-stack/scripts/n8n-local-menu.ps1');

  assert.match(cmd, /n8n-local-menu\.ps1/);
  assert.match(cmd, /-ExecutionPolicy Bypass/);
  assert.match(cmd, /n8n-local-menu\.ps1" %\*/);
  assert.match(cmd, /%~dp0/);
  assert.match(cmd, /:run_menu/);
  assert.match(cmd, /if "%EXIT_CODE%"=="0" goto done/);
  assert.match(cmd, /The n8n local menu stopped unexpectedly with exit code %EXIT_CODE%\./);
  assert.match(cmd, /goto run_menu/);
  assert.match(cmd, /exit \/b 0/);
  assert.doesNotMatch(cmd, /NGROK_AUTHTOKEN|POSTGRES_PASSWORD|N8N_ENCRYPTION_KEY/);
  assert.match(menu, /\$script:ExitRequested = \$false/);
  assert.match(menu, /function Clear-MenuScreen/);
  assert.match(menu, /\[Console\]::Clear\(\)/);
  assert.match(menu, /\[Console\]::SetBufferSize\(\[Console\]::BufferWidth, \[Console\]::WindowHeight\)/);
  assert.match(menu, /Press Enter to clear completed output and return to the menu/);
  assert.match(menu, /function Pause-Menu \{[\s\S]*Clear-MenuScreen[\s\S]*\}/);
  assert.match(menu, /function Invoke-MenuAction/);
  assert.match(menu, /function Invoke-NativeCommand/);
  assert.match(menu, /function Show-CommandList/);
  assert.match(menu, /function Write-CommandListItem/);
  assert.match(menu, /function Write-ImageVersions/);
  assert.doesNotMatch(menu, /function Get-BackupImageLogContent/);
  assert.match(functionBody(menu, 'Get-ComposeServiceRows'), /docker compose ps --format '\{\{\.Service\}\}\|\{\{\.Image\}\}\|\{\{\.State\}\}'/);
  assert.match(functionBody(menu, 'Get-RunningServiceImage'), /docker inspect \$container --format '\{\{\.Config\.Image\}\}'/);
  assert.match(functionBody(menu, 'Get-ImageVersionLines'), /Get-RunningServiceImage[\s\S]*failed to detect[\s\S]*stopped/);
  assert.doesNotMatch(functionBody(menu, 'Get-ImageVersionLines'), /\$script:ServiceImages/);
  assert.doesNotMatch(menu, /function Show-Help/);
  assert.match(menu, /try \{\n    & \$Action\n  \} catch \{/);
  assert.match(menu, /while \(-not \$script:ExitRequested\)/);
  assert.match(menu, /Pause-Menu/);
  assert.match(menu, /'10' \{ Clear-MenuScreen; Write-Success 'Bye\.'; \$script:ExitRequested = \$true \}/);
  assert.match(menu, /exit 0/);

  for (let option = 1; option <= 9; option += 1) {
    assert.match(menu, new RegExp(`'${option}' \\{ Invoke-MenuAction \\{[^\\n]+\\} \\}`), `option ${option} returns through Invoke-MenuAction`);
  }

  assert.match(menu, /function Get-RunningServices/);
  assert.match(menu, /function Write-ServiceStatus/);
  assert.match(menu, /function Write-N8nServiceStatus/);
  assert.match(menu, /function Wait-ForN8nReady/);
  assert.match(menu, /function Repair-N8nConfigEncryptionKey/);
  assert.match(menu, /function Test-N8nEncryptionKeyMismatchLog/);
  assert.match(menu, /function Invoke-ComposeCapture/);
  assert.match(menu, /If this is the template folder, copy the stack to %USERPROFILE%\\\.n8n-local first\./);
  assert.match(menu, /Then copy \.env\.example to \.env in that local stack folder and fill the placeholders\./);
  assert.match(functionBody(menu, 'Get-RunningServices'), /Join-Path \$script:StackRoot '\.env'[\s\S]*return @\(\)/);
  assert.match(functionBody(menu, 'Get-RunningServices'), /try \{[\s\S]*Get-ComposeGlobalArguments[\s\S]*'ps', '--services', '--filter', 'status=running'[\s\S]*docker compose @composeArgs 2>\$null[\s\S]*\} catch \{[\s\S]*return @\(\)[\s\S]*\}/);
  assert.match(menu, /Write-ServiceStatus -Name 'postgres'/);
  assert.match(menu, /Write-N8nServiceStatus -RunningServices \$runningServices/);
  assert.match(functionBody(menu, 'Write-N8nServiceStatus'), /Test-N8nStableReady -RequiredSuccesses 2 -DelaySeconds 1[\s\S]*Test-N8nDatabaseImageMismatchLog[\s\S]*database schema \/ image mismatch[\s\S]*Test-N8nEncryptionKeyMismatchLog[\s\S]*Restart n8n to self-heal[\s\S]*choose View logs/);
  assert.match(functionBody(menu, 'Test-N8nHttpReady'), /param\([\s\S]*\[int\]\$Attempts = 1[\s\S]*\[int\]\$DelaySeconds = 0[\s\S]*Invoke-WebRequest[\s\S]*Start-Sleep -Seconds \$DelaySeconds[\s\S]*return \$false/);
  assert.match(menu, /Write-ServiceStatus -Name 'ngrok'/);
  assert.match(menu, /WEBHOOK_URL is still using ngrok, but ngrok is stopped/);
  assert.match(menu, /Public webhooks and OAuth callbacks will not/);
  assert.match(menu, /function Set-ActiveWebhookUrl/);
  assert.match(functionBody(menu, 'Set-ActiveWebhookUrl'), /\.env\.active[\s\S]*WEBHOOK_URL=\$activeUrl/);
  assert.match(menu, /\$webhookLabel = "  \{0,-22\}: " -f 'active WEBHOOK_URL'/);
  assert.match(functionBody(menu, 'Show-LaunchStatus'), /Write-N8nServiceStatus -RunningServices \$runningServices[\s\S]*Write-ImageVersions -RunningServices \$runningServices[\s\S]*Write-Host ''[\s\S]*WEBHOOK_URL is still using ngrok, but ngrok is stopped/);
  assert.match(menu, /Write-Host '  2\. Start ngrok tunnel'/);
  assert.match(menu, /Write-Host '  1\. n8n \+ ngrok tunnel'/);
  assert.match(menu, /Write-Host '  5\. Show Compose status'/);
  assert.match(menu, /Write-Host '  8\. Advanced \/ Recovery: Restore local n8n from backup'/);
  assert.match(menu, /Write-Host '  9\. Command list'/);
  assert.match(functionBody(menu, 'Show-Status'), /service state, health, container names, and ports/);
  assert.match(functionBody(menu, 'Show-Status'), /Invoke-Compose -Arguments @\('ps'\)/);
  assert.match(functionBody(menu, 'Show-Status'), /Write-ImageVersions/);
  assert.match(functionBody(menu, 'Apply-Update'), /This update includes Postgres[\s\S]*Backup-Postgres -Required[\s\S]*Update cancelled because the automatic Postgres backup did not complete/);
  assert.match(functionBody(menu, 'Backup-Postgres'), /n8n-postgres-\$timestamp[\s\S]*database\.sql[\s\S]*Write-BackupSecretFile[\s\S]*return \$true[\s\S]*return \$false/);
  assert.match(functionBody(menu, 'Write-RestoreReadme'), /HOW TO USE THIS RESTORE FOLDER\.txt[\s\S]*N8N_IMAGE from SECRET-DO-NOT-COMMIT\.env/);
  assert.doesNotMatch(functionBody(menu, 'Write-RestoreReadme'), /Image\/version context/);
  assert.match(functionBody(menu, 'Write-CommandListItem'), /\$itemLabelWidth = 19[\s\S]*\$itemPrefix = \("  \{0\}\. \{1,-\$itemLabelWidth\}: " -f \$Number, \$Name\)/);
  assert.match(functionBody(menu, 'Show-CommandList'), /Write-CommandListItem -Number '7' -Name 'Back up' -Description 'Opens safe manual and automatic backup actions\.'/);
  assert.match(functionBody(menu, 'Show-CommandList'), /Write-CommandListItem -Number '8' -Name 'Advanced \/ Recovery: Restore local n8n from backup' -Description 'Restores a local database or entities backup after pre-restore backups and approval\.'/);
  assert.match(functionBody(menu, 'Show-BackupMenu'), /Write-N8nCliBackupAutomaticStatus[\s\S]*Back up now[\s\S]*Change automatic backup settings[\s\S]*Remove automatic backups[\s\S]*Set up automatic backups/);
  assert.match(functionBody(menu, 'Show-BackupMenu'), /Invoke-N8nCliBackupNow[\s\S]*Configure-N8nCliBackupSchedule[\s\S]*Disable-N8nCliBackupSchedule/);
  assert.doesNotMatch(functionBody(menu, 'Show-BackupMenu'), /Back up Postgres database now|Run n8n CLI backup now|Show n8n CLI backup configuration|Disable scheduled n8n CLI backups/);
  assert.doesNotMatch(functionBody(menu, 'Show-BackupMenu'), /Backup-Postgres|Show-N8nCliBackupConfiguration|Invoke-N8nCliBackupFromConfig/);
  assert.match(menu, /function Show-UpdateMenu/);
  assert.match(menu, /Choose what to update\. The launcher pulls images, then recreates selected containers automatically\./);
  assert.match(functionBody(menu, 'Show-UpdateMenu'), /Read-Host 'Enter a number'[\s\S]*Apply-Update -Services \$selection/);
  assert.match(functionBody(menu, 'Apply-Update'), /Invoke-Compose -Arguments \$pullArgs[\s\S]*Invoke-Compose -Arguments \$upArgs[\s\S]*Selected services were pulled and recreated/);
  assert.match(functionBody(menu, 'Start-N8nWithNgrok'), /n8n is already running\. It will be recreated so current non-image \.env values are applied\.[\s\S]*Starting or refreshing ngrok tunnel now\./);
  assert.doesNotMatch(functionBody(menu, 'Start-NgrokTunnel'), /N8N_HOST/);
  assert.doesNotMatch(functionBody(menu, 'Start-NgrokTunnel'), /N8N_PROTOCOL/);
  assert.match(functionBody(menu, 'Start-NgrokTunnel'), /Get-NgrokWebhookUrl -Domain \$domain[\s\S]*Set-ActiveWebhookUrl -Url \$publicWebhookUrl -Mode 'ngrok'/);
  assert.match(functionBody(menu, 'Start-LocalStack'), /Set-ActiveWebhookUrl -Url \(Get-LocalWebhookUrl\) -Mode 'localhost'[\s\S]*Wait-ForN8nReady -Context 'Local n8n start' -AllowSelfHeal/);
  assert.match(functionBody(menu, 'Start-NgrokTunnel'), /Test-ServiceImagesAvailable -Services \$script:Services -AllowPull:\$isFirstStart[\s\S]*\$upArgs \+= @\('--pull', 'never'\)[\s\S]*\$upArgs \+= @\('--force-recreate', 'n8n', 'ngrok'\)[\s\S]*Wait-ForN8nReady -Context 'n8n and ngrok start' -AllowSelfHeal/);
  assert.match(functionBody(menu, 'Stop-NgrokTunnel'), /Set-ActiveWebhookUrl -Url \(Get-LocalWebhookUrl\) -Mode 'localhost'[\s\S]*Recreating n8n so WEBHOOK_URL is now local\.[\s\S]*Test-ServiceImagesAvailable -Services @\('n8n'\)[\s\S]*Invoke-Compose -Arguments @\('up', '-d', '--pull', 'never', '--force-recreate', 'n8n'\)[\s\S]*Wait-ForN8nReady -Context 'n8n restart after stopping ngrok' -AllowSelfHeal/);
  assert.match(functionBody(menu, 'Restart-N8n'), /Set-ActiveWebhookUrl -Url \(Get-LocalWebhookUrl\) -Mode 'localhost'[\s\S]*current non-image \.env values are applied[\s\S]*Test-ServiceImagesAvailable -Services @\('n8n'\)[\s\S]*Invoke-Compose -Arguments @\('up', '-d', '--pull', 'never', '--force-recreate', 'n8n'\)[\s\S]*Wait-ForN8nReady -Context 'n8n restart' -AllowSelfHeal/);
  assert.match(functionBody(menu, 'Test-N8nStableReady'), /RequiredSuccesses[\s\S]*Test-N8nHttpReady[\s\S]*Get-N8nRecentLogLines -Tail 60[\s\S]*Test-N8nDatabaseImageMismatchLog[\s\S]*Test-N8nEncryptionKeyMismatchLog/);
  assert.match(functionBody(menu, 'Wait-ForN8nReady'), /\$readyStreak[\s\S]*readyStreak -ge 3[\s\S]*stayed reachable[\s\S]*Get-N8nRecentLogLines[\s\S]*Test-N8nEncryptionKeyMismatchLog[\s\S]*Repair-N8nConfigEncryptionKey[\s\S]*up', '-d', '--pull', 'never', '--force-recreate', 'n8n'/);
  assert.match(functionBody(menu, 'Test-N8nDatabaseImageMismatchLog'), /McpRegistryServerEntity[\s\S]*Migration timestamp mismatch/);
  assert.match(functionBody(menu, 'Wait-ForN8nReady'), /Test-N8nDatabaseImageMismatchLog[\s\S]*database schema \/ n8n image version mismatch[\s\S]*backup \.env includes it[\s\S]*source N8N_IMAGE/);
  assert.match(functionBody(menu, 'Repair-N8nConfigEncryptionKey'), /stop', '--timeout', '10', 'n8n'/);
  assert.match(functionBody(menu, 'Repair-N8nConfigEncryptionKey'), /const fs = require\(`fs`\);[\s\S]*const path = require\(`path`\);[\s\S]*const configPath = `\/home\/node\/\.n8n\/config`;[\s\S]*process\.env\.N8N_ENCRYPTION_KEY[\s\S]*key === `replace-with-32-random-character`[\s\S]*config\.encryptionKey = key[\s\S]*'--pull', 'never'[\s\S]*'-T'[\s\S]*--entrypoint/, 'node');
  assert.doesNotMatch(functionBody(menu, 'Repair-N8nConfigEncryptionKey'), /Write-Host \$key|Write-Info \$key|Write-Success \$key|Write-Warning \$key/);
  assert.match(functionBody(menu, 'Show-Logs'), /logs', '--tail', '200'/);
  assert.doesNotMatch(menu, /Open-NgrokDockerDesktopGuide/);
  assert.doesNotMatch(menu, /dashboard\.ngrok\.com\/get-started\/setup\/docker-desktop/);
  assert.match(menu, /Do not launch n8n directly from Docker Desktop\. Launch it from _n8n-local\.cmd instead\./);
});

test('local backup packages and restore flow protect n8n encryption keys', () => {
  const localSetup = readText(repoRoot, '_projects/n8n/local-setup/_main/Page 1 - Local Setup.md');
  const envExample = readText(repoRoot, '_projects/n8n/local-setup/_main/templates/local-stack/.env.example');
  const menu = readText(repoRoot, '_projects/n8n/local-setup/_main/templates/local-stack/scripts/n8n-local-menu.ps1');
  const gitignore = readText(repoRoot, '.gitignore');

  assert.match(envExample, /DO NOT CHANGE THIS VALUE AFTER STARTING LOCAL n8n FOR THE FIRST TIME\./);
  assert.match(envExample, /This key is needed to decrypt saved n8n credentials in the database\./);
  assert.match(envExample, /If you restore from a backup, use the N8N_ENCRYPTION_KEY that came with that backup\./);

  for (const ignored of ['.n8n-local/backups/', '.n8n-local/backups/n8n-cli/', '.n8n-local/import/', '**/SECRET-DO-NOT-COMMIT.env']) {
    assert.match(gitignore, new RegExp(`^${escapeRegExp(ignored)}$`, 'm'), ignored);
  }

  assert.match(localSetup, /Restore local n8n from backup/);
  assert.match(localSetup, /^Restore:$/m);
  assert.match(localSetup, /`?\.sql/);
  assert.match(localSetup, /`?\.zip/);
  assert.match(localSetup, /n8n `export:entities` output files/);
  assert.match(localSetup, /^Required backup env:$/m);
  assert.match(localSetup, /Restore requires the backup `\.env`/);
  assert.match(localSetup, /If the backup env\/key is missing, restore stops before stopping services or touching the database/);
  assert.match(localSetup, /Keep `SECRET-DO-NOT-COMMIT\.env` beside `database\.sql`/);
  assert.match(localSetup, /Type `PROCEED` when asked/);
  assert.match(localSetup, /Automated restore of n8n CLI workflow export folders/);
  assert.match(localSetup, /Automated restore of n8n CLI credential export folders/);
  assert.match(localSetup, /Basic restore commands for n8n CLI workflow\/credential exports/);
  assert.match(localSetup, /HOW TO USE THIS RESTORE FOLDER\.txt/);
  assert.doesNotMatch(localSetup, /README-RESTORE\.txt/);
  assert.doesNotMatch(localSetup, /image-versions\.txt/);
  assert.doesNotMatch(localSetup, /does not restore from an extracted folder of JSONL files/);
  assert.match(localSetup, /Includes `SECRET-DO-NOT-COMMIT\.env`, a private copy of the backup `\.env`/);
  assert.match(localSetup, /Restore creates a pre-restore backup of the current database and current `\.env`/);
  assert.match(localSetup, /Start and restart wait until the n8n editor answers at `localhost`/);
  assert.match(localSetup, /If the container runs but the editor is not reachable, the launcher reports an error instead of calling it healthy/);
  assert.match(localSetup, /syncs|attempts.*`\/home\/node\/\.n8n\/config` to the active `\.env` key/);
  assert.match(localSetup, /Restore updates the active `\.env` `N8N_ENCRYPTION_KEY`/);
  assert.match(localSetup, /Restore also applies backup `\.env` `N8N_IMAGE`/);
  assert.match(localSetup, /Backup `N8N_IMAGE` is accepted only when it points to the official n8n image path/);
  assert.match(localSetup, /docker\.n8n\.io\/n8nio\/n8n:<tag>[\s\S]*docker\.n8n\.io\/n8nio\/n8n@sha256:<digest>/);
  assert.match(localSetup, /Other backup-provided image refs are refused before restore changes begin/);
  assert.match(localSetup, /set `N8N_IMAGE` manually in the active local `\.env`/);
  assert.match(localSetup, /database schema \/ image version mismatch[\s\S]*source n8n image and retry/);
  assert.match(localSetup, /Rollback restores the pre-restore database and pre-restore `\.env` when possible/);
  assert.match(localSetup, /If a `\.zip` has credential entities but no backup key, import is refused before n8n can truncate tables/);
  assert.match(localSetup, /^Advanced target `\.env`:$/m);
  assert.match(localSetup, /If the launcher cannot find exactly one target `\.env`, rerun with `--env-file`/);

  assert.match(menu, /function Write-BackupSecretFile/);
  assert.match(menu, /SECRET-DO-NOT-COMMIT\.env/);
  assert.match(functionBody(menu, 'Backup-Postgres'), /Write-BackupSecretFile[\s\S]*Write-RestoreManifest[\s\S]*Write-RestoreReadme/);
  assert.match(functionBody(menu, 'Write-BackupSecretFile'), /Test-PlaceholderEncryptionKey -Value \$encryptionKey/);
  assert.doesNotMatch(functionBody(menu, 'Write-BackupSecretFile'), /Test-PlaceholderEncryptionKey -Value \$encryptionKey[\s\S]*return ''/);
  assert.match(functionBody(menu, 'Write-BackupSecretFile'), /still uses the placeholder[\s\S]*backup will include it/);
  assert.match(functionBody(menu, 'Write-BackupSecretFile'), /Copy-Item -LiteralPath \$sourceEnvPath -Destination \$secretPath -Force/);
  assert.match(functionBody(menu, 'Write-BackupSecretFile'), /Private backup \.env written to: \$secretPath/);
  assert.match(functionBody(menu, 'Write-BackupSecretFile'), /N8N_ENCRYPTION_KEY is missing from \.env/);
  assert.doesNotMatch(functionBody(menu, 'Write-BackupSecretFile'), /Write-Host \$encryptionKey|Write-Info \$encryptionKey|Write-Success \$encryptionKey|Set-Content[\s\S]*POSTGRES_PASSWORD/);

  for (const functionName of [
    'Find-RestoreBackupSecret',
    'Find-RestoreBackupEnvValue',
    'Find-RestoreEnvBackupFileInDirectory',
    'Get-RestoreEnvBackupNames',
    'Get-RestoreBackupType',
    'Test-PathInsideDirectory',
    'Test-SameResolvedPath',
    'Test-N8nDatabaseImageMismatchLog',
    'Test-ComposeOneOffCreateOnlyFailure',
    'Get-ComposeProjectName',
    'Clear-StoppedN8nOneOffContainers',
    'Invoke-N8nOneOffCapture',
    'Find-RestoreEntityDirectory',
    'New-RestoreEntityImportDirectory',
    'Wait-ForServiceImagesAvailable',
    'Get-RestoreZipLimits',
    'Test-RestoreZipEntryLimits',
    'Expand-RestoreEntitiesZipToStaging',
    'Test-PlaceholderEncryptionKey',
    'Write-MissingRestoreEnvError',
    'Write-MissingCredentialRestoreKeyError',
    'Test-TrustedRestoreN8nImageRef',
    'Write-UntrustedRestoreN8nImageError',
    'Resolve-RestoreEnvFile',
    'Initialize-MenuRuntime',
    'Restore-PreviousStackServices',
    'Update-N8nImageForRestore',
    'Set-LocalN8nImageForRestore',
    'Set-LocalEncryptionKeyForRestore',
    'Get-RestoreEntityLatestMigration',
    'Get-N8nImageLatestMigration',
    'Find-N8nImageForEntityMigration',
    'Resolve-N8nImageForEntityRestore',
    'Restore-PreRestoreEnvValueBackup',
    'Restore-PreRestoreN8nImageBackup',
    'Restore-PostgresSqlBackup',
    'Restore-PreRestorePostgresBackup',
    'Restore-PreRestoreEncryptionKeyBackup',
    'Restore-N8nEntitiesBackup',
    'Restore-LocalN8nFromBackupMenu',
    'Get-N8nCliBackupDefaultRoot',
    'Get-N8nCliBackupConfigPath',
    'Convert-N8nCliBackupDayValue',
    'Test-SafeN8nCliBackupRoot',
    'Get-N8nCliBackupExportSpecs',
    'Invoke-N8nCliBackupRetentionCleanup',
    'Configure-N8nCliBackupSchedule',
    'Invoke-N8nCliBackupFromConfig',
    'Disable-N8nCliBackupSchedule',
    'Show-BackupMenu'
  ]) {
    assert.match(menu, new RegExp(`function ${escapeRegExp(functionName)}`), functionName);
  }

  assert.match(functionBody(menu, 'Restore-LocalN8nFromBackupMenu'), /Resolved \.env path: \$resolvedEnvPath/);
  assert.doesNotMatch(menu, /function Backup-CurrentEnvForRestore/);
  assert.doesNotMatch(menu, /\.before-restore/);
  assert.doesNotMatch(functionBody(menu, 'Restore-LocalN8nFromBackupMenu'), /Backup-CurrentEnvForRestore/);
  assert.match(functionBody(menu, 'Restore-LocalN8nFromBackupMenu'), /replace the active local n8n database state with the backup state/);
  assert.match(functionBody(menu, 'Restore-LocalN8nFromBackupMenu'), /Find-RestoreBackupSecret -Path \$backupPath -TargetEnvPath \$resolvedEnvPath[\s\S]*Write-MissingRestoreEnvError -SecretSearchPath \$secretSearchPath[\s\S]*return[\s\S]*Test-DockerReady[\s\S]*Get-RunningServices/);
  assert.match(functionBody(menu, 'Restore-LocalN8nFromBackupMenu'), /Pre-restore database backup created; rollback \.env saved if present/);
  assert.doesNotMatch(functionBody(menu, 'Restore-LocalN8nFromBackupMenu'), /Current local n8n database backup created/);
  assert.doesNotMatch(functionBody(menu, 'Restore-LocalN8nFromBackupMenu'), /Current \.env backup created/);
  assert.match(functionBody(menu, 'Restore-LocalN8nFromBackupMenu'), /Restore requires the local stack to be stopped/);
  assert.match(functionBody(menu, 'Restore-LocalN8nFromBackupMenu'), /Restore cancelled because local services could not be stopped/);
  assert.match(functionBody(menu, 'Restore-LocalN8nFromBackupMenu'), /Type PROCEED to continue/);
  assert.match(functionBody(menu, 'Restore-LocalN8nFromBackupMenu'), /PROCEED/);
  assert.match(functionBody(menu, 'Restore-LocalN8nFromBackupMenu'), /Restore cancelled\. No restore changes were applied\./);
  const restoreMenuBody = functionBody(menu, 'Restore-LocalN8nFromBackupMenu');
  const approvalIndex = restoreMenuBody.indexOf("$approval = Read-Host 'Type PROCEED to continue'");
  const prepareIndex = restoreMenuBody.indexOf('Prepare-RestoreBackupInput -Path $backupPath');
  const backupIndex = restoreMenuBody.indexOf('Backup-Postgres -Required');
  assert.notEqual(approvalIndex, -1, 'restore flow prompts for PROCEED');
  assert.notEqual(prepareIndex, -1, 'restore flow prepares restore input');
  assert.notEqual(backupIndex, -1, 'restore flow creates pre-restore backup');
  assert.ok(approvalIndex < prepareIndex, 'zip staging must happen only after PROCEED');
  assert.ok(prepareIndex < backupIndex, 'zip staging must complete before backup/restore mutation');
  assert.match(functionBody(menu, 'Restore-LocalN8nFromBackupMenu'), /Restore-PreRestorePostgresBackup -BackupDir \$preRestoreRoot -EnvPath \$resolvedEnvPath/);
  assert.match(functionBody(menu, 'Restore-LocalN8nFromBackupMenu'), /Restore-PreRestoreEncryptionKeyBackup -SecretBackupPath \$preRestoreSecretPath -EnvPath \$resolvedEnvPath/);
  assert.match(functionBody(menu, 'Restore-PreRestorePostgresBackup'), /database\.sql[\s\S]*Restore-PostgresSqlBackup[\s\S]*Pre-restore database rollback completed/);
  assert.match(functionBody(menu, 'Restore-PreRestoreEncryptionKeyBackup'), /SECRET-DO-NOT-COMMIT\.env|N8N_ENCRYPTION_KEY/);
  assert.match(functionBody(menu, 'Restore-PreRestoreN8nImageBackup'), /Restore-PreRestoreEnvValueBackup[\s\S]*N8N_IMAGE/);
  assert.match(functionBody(menu, 'Test-TrustedRestoreN8nImageRef'), /\$rawImage -ne \$imageRef[\s\S]*\$imageRef -match '\\s'/);
  assert.match(functionBody(menu, 'Test-TrustedRestoreN8nImageRef'), /\\Adocker\\\.n8n\\\.io\/n8nio\/n8n:\[A-Za-z0-9\][\s\S]*\\z[\s\S]*\\Adocker\\\.n8n\\\.io\/n8nio\/n8n@sha256:\[a-fA-F0-9\]\{64\}\\z/);
  assert.match(functionBody(menu, 'Write-UntrustedRestoreN8nImageError'), /not an allowed official n8n image reference[\s\S]*docker\.n8n\.io\/n8nio\/n8n:<tag>[\s\S]*set N8N_IMAGE manually/);
  assert.match(functionBody(menu, 'Set-LocalN8nImageForRestore'), /Test-TrustedRestoreN8nImageRef -Image \$image[\s\S]*Write-UntrustedRestoreN8nImageError -Image \$image[\s\S]*return \$false[\s\S]*Read-EnvFileValue -Path \$EnvPath -Name 'N8N_IMAGE'[\s\S]*Set-EnvFileValue -Path \$EnvPath -Name 'N8N_IMAGE'[\s\S]*Initialize-ServiceImages/);
  assert.doesNotMatch(functionBody(menu, 'Restore-PreRestoreEncryptionKeyBackup'), /Name 'N8N_IMAGE'/);
  assert.match(functionBody(menu, 'Clear-PostgresPublicSchema'), /DROP SCHEMA public CASCADE; CREATE SCHEMA public;/);
  const backupBody = functionBody(menu, 'Backup-Postgres');
  assert.match(backupBody, /pg_dump[\s\S]*'-f', \$containerBackupPath[\s\S]*Invoke-NativeCommand -Command \{ & docker compose @composeArgs \}/);
  assert.match(backupBody, /'cp', "postgres:\$containerBackupPath", \$backupPath[\s\S]*Invoke-NativeCommand -Command \{ & docker compose @copyArgs \}/);
  assert.doesNotMatch(backupBody, /1> \$backupPath/);
  assert.match(backupBody, /Test-PostgresSqlBackupFile -Path \$backupPath/);
  assert.doesNotMatch(menu, /function Invoke-DockerCommandToFile|Start-Process -FilePath 'docker' -ArgumentList \$Command/);
  const sqlRestoreBody = functionBody(menu, 'Restore-PostgresSqlBackup');
  const sqlBranchIndex = sqlRestoreBody.indexOf('$containerPath = "$containerPath.sql"');
  const sqlValidationIndex = sqlRestoreBody.indexOf('Test-PostgresSqlBackupFile', sqlBranchIndex);
  const sqlClearIndex = sqlRestoreBody.indexOf('Clear-PostgresPublicSchema', sqlBranchIndex);
  assert.notEqual(sqlBranchIndex, -1, 'Restore-PostgresSqlBackup has a SQL restore branch');
  assert.notEqual(sqlValidationIndex, -1, 'Restore-PostgresSqlBackup validates SQL before restore');
  assert.notEqual(sqlClearIndex, -1, 'Restore-PostgresSqlBackup clears schema during SQL restore');
  assert.ok(sqlValidationIndex < sqlClearIndex, 'SQL backup validation must run before clearing the schema');
  assert.match(functionBody(menu, 'Test-PostgresSqlBackupFile'), /docker compose help output instead of a Postgres dump/);
  assert.match(functionBody(menu, 'Test-PostgresSqlBackupFile'), /PostgreSQL database dump/);
  assert.match(functionBody(menu, 'Test-PostgresSqlBackupFile'), /\[byte\[\]\]::new\(\$bytesToRead\)/);
  assert.match(functionBody(menu, 'Test-PostgresSqlBackupFile'), /GetString\(\$buffer, 0, \$bytesRead\)/);
  assert.match(functionBody(menu, 'Restore-PostgresSqlBackup'), /psql[\s\S]*ON_ERROR_STOP/);
  assert.match(functionBody(menu, 'Restore-PostgresSqlBackup'), /pg_restore[\s\S]*--clean[\s\S]*--if-exists/);
  const entitiesRestoreBody = functionBody(menu, 'Restore-N8nEntitiesBackup');
  assert.match(entitiesRestoreBody, /Write-MissingCredentialRestoreKeyError[\s\S]*return \$false[\s\S]*Clear-PostgresPublicSchema[\s\S]*import:entities[\s\S]*--truncateTables/);
  assert.match(functionBody(menu, 'Wait-ForServiceImagesAvailable'), /Test-LocalImageExists[\s\S]*Start-Sleep[\s\S]*still not available locally after waiting/);
  assert.match(functionBody(menu, 'Update-N8nImageForRestore'), /pull', 'n8n'[\s\S]*Wait-ForServiceImagesAvailable -Services @\('n8n'\)[\s\S]*Configured n8n image is available locally/);
  assert.match(functionBody(menu, 'Test-ComposeOneOffCreateOnlyFailure'), /ExitCode[\s\S]*Container .*Creating[\s\S]*Starting entity import/);
  assert.match(functionBody(menu, 'Get-ComposeProjectName'), /COMPOSE_PROJECT_NAME[\s\S]*config', '--format', 'json'[\s\S]*Split-Path -Leaf \$script:StackRoot/);
  assert.match(functionBody(menu, 'Clear-StoppedN8nOneOffContainers'), /volumes are not removed[\s\S]*com\.docker\.compose\.project=\$projectName[\s\S]*com\.docker\.compose\.service=n8n[\s\S]*com\.docker\.compose\.oneoff=True[\s\S]*docker rm -f <stopped-or-created-n8n-one-off-containers>/);
  assert.match(functionBody(menu, 'Invoke-N8nOneOffCapture'), /Test-ComposeOneOffCreateOnlyFailure[\s\S]*retrying once[\s\S]*Clear-StoppedN8nOneOffContainers[\s\S]*Docker could not create or start the one-off n8n container/);
  assert.doesNotMatch(menu, /function Test-N8nOneOffContainerReady/);
  assert.match(functionBody(menu, 'Repair-N8nConfigEncryptionKey'), /Invoke-Compose -Arguments @\('run', '--rm', '--pull', 'never', '--no-deps', '-T', '--entrypoint', 'node', 'n8n', '-e', \$nodeScript\)/);
  assert.match(functionBody(menu, 'Restore-N8nEntitiesBackup'), /ImageAlreadyRefreshed[\s\S]*Update-N8nImageForRestore/);
  assert.match(functionBody(menu, 'Restore-N8nEntitiesBackup'), /RestoreN8nImage[\s\S]*Test-TrustedRestoreN8nImageRef -Image \$restoreN8nImage[\s\S]*Write-UntrustedRestoreN8nImageError -Image \$restoreN8nImage[\s\S]*\$env:N8N_IMAGE = \$restoreN8nImage[\s\S]*finally[\s\S]*Remove-Item Env:\\N8N_IMAGE/);
  assert.match(functionBody(menu, 'Restore-N8nEntitiesBackup'), /'--pull', 'never'[\s\S]*'-T'[\s\S]*import:entities/);
  assert.match(functionBody(menu, 'Restore-N8nEntitiesBackup'), /Invoke-Compose -Arguments \$importArgs[\s\S]*Review the n8n import output above[\s\S]*wrong N8N_ENCRYPTION_KEY[\s\S]*migrations\.jsonl[\s\S]*incompatible N8N_IMAGE/);
  assert.doesNotMatch(functionBody(menu, 'Restore-N8nEntitiesBackup'), /Credential entities were imported, but no source backup N8N_ENCRYPTION_KEY was applied/);
  assert.match(functionBody(menu, 'Write-MissingCredentialRestoreKeyError'), /Credential entities were found, but no source backup N8N_ENCRYPTION_KEY was found/);
  assert.match(functionBody(menu, 'Write-MissingCredentialRestoreKeyError'), /Include the backup \.env or SECRET-DO-NOT-COMMIT\.env with the \.zip/);
  assert.match(functionBody(menu, 'Write-MissingRestoreEnvError'), /No backup \.env or SECRET-DO-NOT-COMMIT\.env with N8N_ENCRYPTION_KEY was found/);
  assert.match(functionBody(menu, 'Write-MissingRestoreEnvError'), /Restore cancelled before stopping services or changing the database/);
  assert.match(functionBody(menu, 'Write-MissingRestoreEnvError'), /Keep SECRET-DO-NOT-COMMIT\.env with database\.sql/);
  assert.match(functionBody(menu, 'Set-LocalEncryptionKeyForRestore'), /already matches the backup secret file[\s\S]*return \$true[\s\S]*Set-EnvFileValue/);
  assert.match(functionBody(menu, 'Find-RestoreBackupSecret'), /Find-RestoreBackupEnvValue[\s\S]*N8N_ENCRYPTION_KEY/);
  assert.match(functionBody(menu, 'Find-RestoreBackupEnvValue'), /Get-RestoreEnvBackupNames[\s\S]*TargetEnvPath/);
  assert.match(functionBody(menu, 'Find-RestoreBackupEnvValue'), /Read-EnvTextValue[\s\S]*\$Name/);
  assert.match(functionBody(menu, 'Get-RestoreEntityLatestMigration'), /migrations\.jsonl[\s\S]*ConvertFrom-Json[\s\S]*timestamp[\s\S]*latest/);
  assert.match(functionBody(menu, 'Get-N8nImageLatestMigration'), /migrations\/common[\s\S]*console\.log[\s\S]*docker run --rm --entrypoint node \$Image/);
  assert.match(functionBody(menu, 'Find-N8nImageForEntityMigration'), /docker image ls 'docker\.n8n\.io\/n8nio\/n8n'[\s\S]*Get-N8nImageLatestMigration[\s\S]*1784000000006[\s\S]*2\.22\.5/);
  assert.match(functionBody(menu, 'Resolve-N8nImageForEntityRestore'), /SourceEntityDir[\s\S]*InputDir[\s\S]*Get-RestoreEntityLatestMigration[\s\S]*Entities export latest migration[\s\S]*Find-N8nImageForEntityMigration/);
  assert.match(functionBody(menu, 'Get-RestoreZipLimits'), /MaxFiles[\s\S]*MaxCompressedBytes[\s\S]*MaxEntryBytes[\s\S]*MaxTotalBytes[\s\S]*MaxCompressionRatio/);
  assert.match(functionBody(menu, 'Test-RestoreZipEntryLimits'), /MaxFiles[\s\S]*MaxEntryBytes[\s\S]*MaxTotalBytes[\s\S]*MaxCompressionRatio[\s\S]*MaxCompressedBytes/);
  assert.match(functionBody(menu, 'Expand-RestoreEntitiesZipToStaging'), /ZipFile\]::OpenRead[\s\S]*Test-RestoreZipEntryLimits[\s\S]*Test-PathInsideDirectory[\s\S]*ExtractToFile[\s\S]*Find-RestoreEntityDirectory/);
  assert.match(functionBody(menu, 'New-RestoreEntityImportDirectory'), /EndsWith\('\.jsonl'\)[\s\S]*migrations\.jsonl[\s\S]*workflows_tags\.jsonl[\s\S]*workflowtagmapping\.jsonl[\s\S]*both files import into the workflows_tags table[\s\S]*Copy-Item -LiteralPath \$file\.FullName[\s\S]*CreateFromDirectory\(\$zipSourceDir, \$zipPath\)[\s\S]*Rebuilt clean entities\.zip with \$copiedCount/);
  assert.match(functionBody(menu, 'Expand-RestoreEntitiesZipToStaging'), /New-RestoreEntityImportDirectory -EntityDir \$entityDir -StagingDir \$stagingDir[\s\S]*did not contain migrations\.jsonl[\s\S]*clean entities\.zip rebuilt from all extracted n8n entity JSONL files[\s\S]*EntityDir = \$importDir[\s\S]*SourceEntityDir = \$entityDir/);
  assert.match(functionBody(menu, 'Prepare-RestoreBackupInput'), /Expand-RestoreEntitiesZipToStaging[\s\S]*InputDir = \$expanded\.EntityDir[\s\S]*SourceEntityDir = \$expanded\.SourceEntityDir/);
  assert.match(functionBody(menu, 'Restore-N8nEntitiesBackup'), /\$inputDir = \$Backup\.InputDir[\s\S]*\$mountValue = "\$\{inputDir\}:\/restore"[\s\S]*--inputDir[\s\S]*\/restore/);
  assert.doesNotMatch(menu, /Copy-RestoreEntitiesZipToStaging/);
  assert.match(functionBody(menu, 'Resolve-RestoreEnvFile'), /--env-file[\s\S]*--stack-dir[\s\S]*launcher stack directory[\s\S]*single \.env beside selected local Docker Compose file/);
  assert.doesNotMatch(functionBody(menu, 'Resolve-RestoreEnvFile'), /compose-file/);
  assert.doesNotMatch(menu, /Get-MenuArgumentValue -Name 'compose-file'/);
  assert.match(functionBody(menu, 'Resolve-RestoreEnvFile'), /More than one plausible \.env file was found\. Rerun with --env-file <path>\./);
  assert.match(functionBody(menu, 'Initialize-MenuRuntime'), /Get-MenuArgumentValue -Name 'stack-dir'[\s\S]*Set-Location -LiteralPath \$script:StackRoot/);
  assert.match(functionBody(menu, 'Get-ComposeGlobalArguments'), /Get-MenuArgumentValue -Name 'env-file'[\s\S]*--env-file/);
  assert.match(functionBody(menu, 'Invoke-Compose'), /Get-ComposeGlobalArguments[\s\S]*\$allArguments/);
  assert.match(functionBody(menu, 'Invoke-ComposeCapture'), /COMPOSE_PROGRESS[\s\S]*plain[\s\S]*COMPOSE_ANSI[\s\S]*never[\s\S]*finally/);
  assert.match(functionBody(menu, 'Set-EnvFileValue'), /\$lines\[\$index\] = \$replacement[\s\S]*break[\s\S]*Set-Content/);
  assert.match(functionBody(menu, 'Get-LocalN8nProbeUrls'), /127\.0\.0\.1[\s\S]*localhost/);
  assert.match(functionBody(menu, 'Test-N8nHttpReady'), /foreach \(\$url in \(Get-LocalN8nProbeUrls\)\)[\s\S]*Invoke-WebRequest -Uri \$url/);
  assert.match(functionBody(menu, 'Get-RestoreBackupType'), /Restore input must use one of these extensions: \.sql, \.zip/i);
  assert.match(functionBody(menu, 'Get-RestoreBackupType'), /Restore input must be a backup file/);
  assert.match(functionBody(menu, 'Get-RestoreBackupType'), /Get-ZipEntryNames[\s\S]*Test-RestoreEntityFileName[\s\S]*Filename-level detection/);
  assert.match(functionBody(menu, 'Get-RestoreBackupType'), /credentialsentity\.jsonl[\s\S]*HasCredentialEntities/);
  assert.match(functionBody(menu, 'Prepare-RestoreBackupInput'), /HasCredentialEntities = \$detected\.HasCredentialEntities/);
  assert.match(functionBody(menu, 'Restore-LocalN8nFromBackupMenu'), /Find-RestoreBackupEnvValue -Path \$backupPath -Name 'N8N_IMAGE'[\s\S]*Resolve-N8nImageForEntityRestore -Backup \$detected[\s\S]*Could not determine the n8n image version required by this entities export[\s\S]*Test-TrustedRestoreN8nImageRef -Image \$backupN8nImage[\s\S]*Write-UntrustedRestoreN8nImageError -Image \$backupN8nImage[\s\S]*Set-LocalN8nImageForRestore -BackupN8nImage \$backupN8nImage -EnvPath \$resolvedEnvPath[\s\S]*Set-LocalEncryptionKeyForRestore/);
  assert.match(functionBody(menu, 'Restore-LocalN8nFromBackupMenu'), /Add-Member -NotePropertyName RestoreN8nImage -NotePropertyValue \$backupN8nImage/);
  assert.match(functionBody(menu, 'Restore-LocalN8nFromBackupMenu'), /Get-RunningServices -EnvPath \$resolvedEnvPath[\s\S]*Backup-Postgres -Required -EnvPath \$resolvedEnvPath -BackupDir \$preRestoreRoot/);
  assert.match(functionBody(menu, 'Restore-LocalN8nFromBackupMenu'), /detected\.HasCredentialEntities[\s\S]*Write-MissingCredentialRestoreKeyError[\s\S]*return/);
  assert.match(functionBody(menu, 'Restore-LocalN8nFromBackupMenu'), /Set-LocalEncryptionKeyForRestore[\s\S]*'postgres-sql' \{ \$ok = Restore-PostgresSqlBackup -Backup \$detected -EnvPath \$resolvedEnvPath \}/);
  assert.match(functionBody(menu, 'Restore-LocalN8nFromBackupMenu'), /'n8n-entities' \{[\s\S]*\$n8nImageRefreshed = Update-N8nImageForRestore[\s\S]*Repair-N8nConfigEncryptionKey[\s\S]*Restore-N8nEntitiesBackup[\s\S]*EnvPath \$resolvedEnvPath[\s\S]*ImageAlreadyRefreshed:\$n8nImageRefreshed[\s\S]*\}/);
  assert.match(functionBody(menu, 'Restore-LocalN8nFromBackupMenu'), /\$ok[\s\S]*detected\.Type -eq 'n8n-entities'[\s\S]*Restore-PreRestoreN8nImageBackup[\s\S]*Restore-PreviousStackServices/);
  assert.match(functionBody(menu, 'Restore-LocalN8nFromBackupMenu'), /Restore-PreRestoreEncryptionKeyBackup[\s\S]*Restore-PreRestoreN8nImageBackup[\s\S]*rollback/);
  assert.doesNotMatch(functionBody(menu, 'Restore-LocalN8nFromBackupMenu'), /Test-N8nOneOffContainerReady|Restore cancelled because Docker could not start a one-off n8n container/);
  assert.match(functionBody(menu, 'Restore-PreviousStackServices'), /StartN8nWhenNone[\s\S]*No local n8n services were detected before restore[\s\S]*Start-LocalStack -ForceRecreateN8n/);
  assert.match(functionBody(menu, 'Restore-LocalN8nFromBackupMenu'), /Restore-PreviousStackServices -PreviousServices \$preRestoreServices -StartN8nWhenNone/);
  assert.doesNotMatch(functionBody(menu, 'Get-RestoreBackupType'), /ReadToEnd|StreamReader|Open\(\)/);
  assert.doesNotMatch(menu, /Write-Host .*POSTGRES_PASSWORD|Write-Info .*POSTGRES_PASSWORD|Write-Success .*POSTGRES_PASSWORD|Write-Warning .*POSTGRES_PASSWORD/);
  assert.match(functionBody(menu, 'Restore-PreviousStackServices'), /PreviousServices/);
  assert.match(functionBody(menu, 'Restore-PreviousStackServices'), /Start-N8nWithNgrok|Start-LocalStack/);
});

test('local menu PowerShell script stays parseable', (t) => {
  const sourceScript = path.join(repoRoot, '_projects/n8n/local-setup/_main/templates/local-stack/scripts/n8n-local-menu.ps1');
  const generatedScript = path.join(repoRoot, 'skills/n8n-local-setup/templates/local-stack/scripts/n8n-local-menu.ps1');
  const sourceMenu = fs.readFileSync(sourceScript, 'utf8');

  assert.doesNotMatch(sourceMenu, /\$Name:/);
  assert.match(sourceMenu, /\$statusPrefix = \("  \{0,-\$statusLabelWidth\}: " -f \$Name\)/);

  const powerShell = findPowerShell();
  if (!powerShell) {
    t.skip('PowerShell is not available in this environment');
    return;
  }

  for (const scriptPath of [sourceScript, generatedScript]) {
    const command = [
      '$tokens = $null',
      '$errors = $null',
      `[System.Management.Automation.Language.Parser]::ParseFile(${powerShellSingleQuoted(scriptPath)}, [ref]$tokens, [ref]$errors) | Out-Null`,
      'if ($errors.Count -gt 0) { $errors | ForEach-Object { Write-Error $_.Message }; exit 1 }'
    ].join('; ');
    const result = spawnSync(powerShell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
      cwd: repoRoot,
      encoding: 'utf8'
    });

    if (
      result.status !== 0 &&
      /Unhandled exception\. System\.IO\.FileLoadException: The given assembly name was invalid/i.test(result.stderr || '')
    ) {
      t.skip('PowerShell runtime failed before parser execution');
      return;
    }

    assert.equal(result.status, 0, `${scriptPath}\n${result.stdout}\n${result.stderr}`);
  }
});

test('local menu native command helper returns only the process exit code', (t) => {
  const sourceScript = path.join(repoRoot, '_projects/n8n/local-setup/_main/templates/local-stack/scripts/n8n-local-menu.ps1');
  const powerShell = findPowerShell();
  if (!powerShell) {
    t.skip('PowerShell is not available in this environment');
    return;
  }

  const command = [
    `$menu = Get-Content -LiteralPath ${powerShellSingleQuoted(sourceScript)} -Raw`,
    "$start = $menu.IndexOf('function Invoke-NativeCommand')",
    "$end = $menu.IndexOf(\"`nfunction Invoke-Compose\", $start + 1)",
    ". ([scriptblock]::Create($menu.Substring($start, $end - $start)))",
    "$result = Invoke-NativeCommand -Command { Write-Output 'NAME IMAGE STATUS'; $global:LASTEXITCODE = 0 }",
    "if ($result -is [array]) { Write-Error \"Invoke-NativeCommand leaked command output into its return value: $($result -join '|')\"; exit 1 }",
    "if ($result -ne 0) { Write-Error \"Expected exit code 0, got $result\"; exit 1 }"
  ].join('; ');
  const result = spawnSync(powerShell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    cwd: repoRoot,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('local n8n CLI backup helpers validate config and generate safe commands', (t) => {
  const sourceScript = path.join(repoRoot, '_projects/n8n/local-setup/_main/templates/local-stack/scripts/n8n-local-menu.ps1');
  const powerShell = findPowerShell();
  if (!powerShell) {
    t.skip('PowerShell is not available in this environment');
    return;
  }

  const command = [
    '$ErrorActionPreference = "Stop"',
    `. ${powerShellSingleQuoted(sourceScript)} --library`,
    '$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("toolkit-n8n-cli-backup-" + [guid]::NewGuid().ToString("N"))',
    '$script:StackRoot = Join-Path $testRoot "stack"',
    'New-Item -ItemType Directory -Force -Path $script:StackRoot | Out-Null',
    '$safeRoot = Join-Path $script:StackRoot "backups\\n8n-cli"',
    '$validCadence = Convert-N8nCliBackupDayValue -Value "7" -Name "Backup cadence"',
    'if (-not $validCadence.Ok -or $validCadence.Value -ne 7) { throw "valid cadence was rejected" }',
    '$invalidCadence = Convert-N8nCliBackupDayValue -Value "0" -Name "Backup cadence"',
    'if ($invalidCadence.Ok) { throw "zero cadence was accepted" }',
    '$invalidRetention = Convert-N8nCliBackupDayValue -Value "abc" -Name "Retention period"',
    'if ($invalidRetention.Ok) { throw "non-numeric retention was accepted" }',
    '$safe = Test-SafeN8nCliBackupRoot -Path $safeRoot',
    'if (-not $safe.Ok) { throw "safe backup root was rejected: $($safe.Error)" }',
    '$existingAutomaticConfig = [pscustomobject]@{ enabled = $true; cadenceDays = 7; retentionDays = 14; backupRoot = $safeRoot; includeWorkflows = $false; includeCredentials = $false; exportDecryptedCredentials = $true; scheduledTime = "around 3:00 AM local time" }',
    '$manualConfig = New-N8nCliBackupNowConfig -ExistingConfig $existingAutomaticConfig',
    'if ($manualConfig.includeWorkflows -ne $true) { throw "manual backup did not include workflows" }',
    'if ($manualConfig.includeCredentials -ne $true) { throw "manual backup did not include credentials" }',
    'if ($manualConfig.exportDecryptedCredentials -ne $false) { throw "manual backup enabled decrypted credentials" }',
    'if ($manualConfig.backupRoot -ne $safeRoot) { throw "manual backup did not reuse configured destination" }',
    'if ($manualConfig.retentionDays -ne 14) { throw "manual backup did not reuse configured retention" }',
    'if (-not (Test-N8nCliBackupAutomaticEnabled -Config $existingAutomaticConfig)) { throw "enabled automatic backup config was not detected" }',
    '$disabledAutomaticConfig = [pscustomobject]@{ enabled = $false; backupRoot = $safeRoot }',
    'if (Test-N8nCliBackupAutomaticEnabled -Config $disabledAutomaticConfig) { throw "disabled automatic backup config was treated as enabled" }',
    '$scheduleText = Get-N8nCliBackupScheduleTimeText -Config $existingAutomaticConfig',
    'if ($scheduleText -ne "around 3:00 AM local time") { throw "schedule time text mismatch: $scheduleText" }',
    '$homeUnsafe = Test-SafeN8nCliBackupRoot -Path $HOME',
    'if ($homeUnsafe.Ok) { throw "home directory was accepted as backup root" }',
    '$stackUnsafe = Test-SafeN8nCliBackupRoot -Path $script:StackRoot',
    'if ($stackUnsafe.Ok) { throw "stack root was accepted as backup root" }',
    '$rootUnsafe = Test-SafeN8nCliBackupRoot -Path ([System.IO.Path]::GetPathRoot($script:StackRoot))',
    'if ($rootUnsafe.Ok) { throw "filesystem root was accepted as backup root" }',
    'New-Item -ItemType Directory -Force -Path $safeRoot | Out-Null',
    '$oldBackup = Join-Path $safeRoot "n8n-cli-20000101-000000"',
    '$newBackup = Join-Path $safeRoot "n8n-cli-29990101-000000"',
    '$unmatched = Join-Path $safeRoot "manual-folder"',
    'New-Item -ItemType Directory -Force -Path $oldBackup, $newBackup, $unmatched | Out-Null',
    '(Get-Item -LiteralPath $oldBackup).LastWriteTime = (Get-Date).AddDays(-40)',
    '(Get-Item -LiteralPath $newBackup).LastWriteTime = Get-Date',
    '(Get-Item -LiteralPath $unmatched).LastWriteTime = (Get-Date).AddDays(-40)',
    'if (-not (Invoke-N8nCliBackupRetentionCleanup -BackupRoot $safeRoot -RetentionDays 30)) { throw "retention cleanup failed" }',
    'if (Test-Path -LiteralPath $oldBackup) { throw "old timestamped backup was not deleted" }',
    'if (-not (Test-Path -LiteralPath $newBackup)) { throw "new timestamped backup was deleted" }',
    'if (-not (Test-Path -LiteralPath $unmatched)) { throw "non-matching folder was deleted" }',
    '$specs = @(Get-N8nCliBackupExportSpecs -IncludeWorkflows $true -IncludeCredentials $true -ExportDecryptedCredentials $true -ContainerBackupRoot "/tmp/n8n-cli-backups/test")',
    'if ($specs.Count -ne 2) { throw "expected two export specs, got $($specs.Count)" }',
    '$workflowCommand = $specs[0].ComposeArguments -join " "',
    '$credentialCommand = $specs[1].ComposeArguments -join " "',
    'if ($workflowCommand -notmatch "exec -T n8n n8n export:workflow --backup --output=/tmp/n8n-cli-backups/test/workflows") { throw "workflow command mismatch: $workflowCommand" }',
    'if ($credentialCommand -notmatch "exec -T n8n n8n export:credentials --backup --output=/tmp/n8n-cli-backups/test/credentials-decrypted --decrypted") { throw "credential command mismatch: $credentialCommand" }',
    '$config = [pscustomobject]@{ enabled = $true; scheduler = "Windows Task Scheduler"; taskName = ("toolkit-n8n-cli-backup-test-" + [guid]::NewGuid().ToString("N")); cadenceDays = 1; retentionDays = 30; backupRoot = $safeRoot; includeWorkflows = $true; includeCredentials = $false; exportDecryptedCredentials = $false; n8nServiceName = "n8n" }',
    'Save-N8nCliBackupConfig -Config $config | Out-Null',
    'if (-not (Disable-N8nCliBackupSchedule)) { throw "disable returned false" }',
    '$disabled = Read-N8nCliBackupConfig',
    'if ($disabled.enabled) { throw "disable did not persist enabled=false" }'
  ].join('; ');

  const result = spawnSync(powerShell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    cwd: repoRoot,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('local n8n CLI backup setup prompts make recommended defaults explicit and safe', (t) => {
  const sourceScript = path.join(repoRoot, '_projects/n8n/local-setup/_main/templates/local-stack/scripts/n8n-local-menu.ps1');
  const powerShell = findPowerShell();
  if (!powerShell) {
    t.skip('PowerShell is not available in this environment');
    return;
  }

  const command = [
    '$ErrorActionPreference = "Stop"',
    `. ${powerShellSingleQuoted(sourceScript)} --library`,
    '$testRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("toolkit-n8n-cli-backup-prompts-" + [guid]::NewGuid().ToString("N"))',
    '$script:StackRoot = Join-Path $testRoot "stack"',
    'New-Item -ItemType Directory -Force -Path $script:StackRoot | Out-Null',
    'function Invoke-BackupPromptScenario { param([string[]]$Responses) $script:PromptLog = New-Object System.Collections.Generic.List[string]; $script:PromptResponses = New-Object System.Collections.Queue; foreach ($response in $Responses) { $script:PromptResponses.Enqueue($response) }; function global:Read-Host { param([string]$Prompt) $script:PromptLog.Add($Prompt); if ($script:PromptResponses.Count -gt 0) { return [string]$script:PromptResponses.Dequeue() }; return "" }; try { $config = New-N8nCliBackupConfigFromPrompts; return [pscustomobject]@{ Config = $config; Prompts = [string[]]$script:PromptLog.ToArray() } } finally { Remove-Item Function:\\Read-Host -ErrorAction SilentlyContinue } }',
    '$defaultScenario = Invoke-BackupPromptScenario -Responses @("", "", "", "", "", "")',
    '$defaultConfig = $defaultScenario.Config',
    '$defaultRoot = [System.IO.Path]::GetFullPath((Get-N8nCliBackupDefaultRoot))',
    'if ($null -eq $defaultConfig) { throw "default prompt scenario returned null config" }',
    'if ($defaultConfig.cadenceDays -ne 1) { throw "empty cadence input did not select default 1" }',
    'if ($defaultConfig.retentionDays -ne 30) { throw "empty retention input did not select default 30" }',
    'if ($defaultConfig.backupRoot -ne $defaultRoot) { throw "empty destination input did not select default root: $($defaultConfig.backupRoot)" }',
    'if ($defaultConfig.includeWorkflows -ne $true) { throw "empty workflow input did not default to yes" }',
    'if ($defaultConfig.includeCredentials -ne $true) { throw "empty credential input did not default to yes" }',
    'if ($defaultConfig.exportDecryptedCredentials -ne $false) { throw "empty decrypted credential input did not default to no" }',
    '$promptText = $defaultScenario.Prompts -join "`n"',
    'if ($promptText -notmatch "Backup cadence in days\\. Press Enter for recommended default: 1") { throw "cadence prompt did not explain Enter default: $promptText" }',
    'if ($promptText -notmatch "Retention period in days\\. Press Enter for recommended default: 30") { throw "retention prompt did not explain Enter default: $promptText" }',
    'if ($promptText -notmatch "Backup destination\\. Press Enter for recommended default:") { throw "destination prompt did not explain Enter default: $promptText" }',
    'if ($promptText -notmatch "Include workflows\\? Recommended: Yes\\. Press Enter for recommended default: Yes") { throw "workflow prompt did not show recommended Yes: $promptText" }',
    'if ($promptText -notmatch "Include credentials\\? Recommended: Yes, encrypted credential export only\\. Press Enter for recommended default: Yes") { throw "credential prompt did not show encrypted-only recommended Yes: $promptText" }',
    'if ($promptText -notmatch "Export decrypted credentials\\? Recommended: No\\. Do not export decrypted credentials unless you explicitly understand the risk\\. Press Enter for recommended default: No") { throw "decrypted credential prompt did not show explicit No warning: $promptText" }',
    '$script:ColorLog = New-Object System.Collections.Generic.List[object]',
    'function global:Write-Host { param([Parameter(Position=0)][object]$Object, [switch]$NoNewline, [ConsoleColor]$ForegroundColor) $script:ColorLog.Add([pscustomobject]@{ Text = [string]$Object; Color = [string]$ForegroundColor; NoNewline = [bool]$NoNewline }) }',
    'try { Write-N8nCliBackupRecommendedPrompt -Prompt "Include credentials?" -DefaultText "Yes" -Recommendation "Yes, encrypted credential export only" -Suffix "Y/n" } finally { Remove-Item Function:\\Write-Host -ErrorAction SilentlyContinue }',
    '$coloredPromptText = ($script:ColorLog | ForEach-Object { $_.Text }) -join ""',
    'if ($coloredPromptText -ne "Include credentials? Recommended: Yes, encrypted credential export only. Press Enter for recommended default: Yes (Y/n): ") { throw "colored prompt text changed: $coloredPromptText" }',
    'if (-not ($script:ColorLog | Where-Object { $_.Text -eq "Include credentials?" -and $_.Color -eq "Cyan" })) { throw "prompt label was not cyan" }',
    'if (-not ($script:ColorLog | Where-Object { $_.Text -eq " Recommended: " -and $_.Color -eq "DarkCyan" })) { throw "recommended label was not dark cyan" }',
    'if (-not ($script:ColorLog | Where-Object { $_.Text -eq "Yes, encrypted credential export only." -and $_.Color -eq "Green" })) { throw "recommended safe credential text was not green" }',
    'if (-not ($script:ColorLog | Where-Object { $_.Text -eq " Press Enter for recommended default: " -and $_.Color -eq "DarkCyan" })) { throw "Enter default hint was not dark cyan" }',
    'if (-not ($script:ColorLog | Where-Object { $_.Text -eq "Yes" -and $_.Color -eq "Green" })) { throw "default value was not green" }',
    'if (-not ($script:ColorLog | Where-Object { $_.Text -eq " (Y/n)" -and $_.Color -eq "DarkGray" })) { throw "yes/no suffix was not dark gray" }',
    '$wrongConfirmation = Invoke-BackupPromptScenario -Responses @("", "", "", "", "", "y", "NOPE")',
    'if ($wrongConfirmation.Config.exportDecryptedCredentials) { throw "decrypted credentials enabled without exact confirmation phrase" }',
    'if (($wrongConfirmation.Prompts -join "`n") -notmatch "Type EXPORT DECRYPTED CREDENTIALS to enable decrypted credential files") { throw "decrypted credential confirmation prompt was not shown" }',
    '$exactConfirmation = Invoke-BackupPromptScenario -Responses @("", "", "", "", "", "y", "EXPORT DECRYPTED CREDENTIALS")',
    'if (-not $exactConfirmation.Config.exportDecryptedCredentials) { throw "exact confirmation phrase did not enable decrypted credential export" }'
  ].join('; ');

  const result = spawnSync(powerShell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    cwd: repoRoot,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('local stack templates stay placeholder-only and local-first', () => {
  const compose = readText(repoRoot, '_projects/n8n/local-setup/_main/templates/local-stack/docker-compose.yml');
  const envExample = readText(repoRoot, '_projects/n8n/local-setup/_main/templates/local-stack/.env.example');
  const localGitignore = readText(repoRoot, '_projects/n8n/local-setup/_main/templates/local-stack/.gitignore');
  const shortcut = readText(repoRoot, '_projects/n8n/local-setup/_main/templates/local-stack/n8n-local-desktop-shortcut.cmd');

  assert.match(compose, /^\s{2}postgres:/m);
  assert.match(compose, /^\s{2}n8n:/m);
  assert.match(compose, /^\s{2}ngrok:/m);
  assert.match(compose, /postgres:16-alpine/);
  assert.match(compose, /docker\.n8n\.io\/n8nio\/n8n:stable/);
  assert.match(compose, /ngrok\/ngrok:latest/);
  assert.match(compose, /DB_TYPE: postgresdb/);
  assert.match(compose, /"127\.0\.0\.1:\$\{N8N_LOCAL_PORT:-5678\}:5678"/);
  assert.match(compose, /path: \.env\.active/);
  assert.match(compose, /required: false/);
  assert.match(compose, /"127\.0\.0\.1:4040:4040"/);
  assert.doesNotMatch(compose, /^\s{2}redis:/m);
  assert.doesNotMatch(compose, /^\s{2}n8n-worker:/m);

  for (const expected of [
    '# [ STEP 1: Fill These Before First Launch ]',
    '# Postgres',
    '# n8n',
    '# Choose the browser port before first launch.',
    '# - https://dashboard.ngrok.com/get-started/setup/docker',
    '# - The free domain is near the bottom of section 1.',
    '# [ STEP 2: Fill These Later Only After Local n8n Works ]',
    'POSTGRES_DB=n8n',
    'POSTGRES_USER=n8n',
    'POSTGRES_PASSWORD=replace-with-local-postgres-password',
    'N8N_ENCRYPTION_KEY=replace-with-32-random-character',
    'LOCAL_TIMEZONE=Asia/Singapore',
    'N8N_LOCAL_PORT=5678',
    'NGROK_AUTHTOKEN=replace-with-ngrok-authtoken',
    'NGROK_DOMAIN=your-name.ngrok.app'
  ]) {
    assert.match(envExample, new RegExp(escapeRegExp(expected)), expected);
  }
  assert.doesNotMatch(envExample, /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/);
  assert.doesNotMatch(envExample, /n8n_[A-Za-z0-9_-]{20,}/);
  assert.match(shortcut, /%USERPROFILE%\\\.n8n-local/);
  assert.match(shortcut, /_n8n-local\.cmd/);
  assert.doesNotMatch(shortcut, /POSTGRES_PASSWORD|N8N_ENCRYPTION_KEY|NGROK_AUTHTOKEN/);

  for (const ignored of ['.env', '.env.*', '!.env.example', '.env.active', 'backups/', 'import/', '*.credentials.json', '**/SECRET-DO-NOT-COMMIT.env']) {
    assert.match(localGitignore, new RegExp(`^${escapeRegExp(ignored)}$`, 'm'), ignored);
  }
});

test('Hostinger Coolify VPS page keeps Coolify-specific hosted n8n content only', () => {
  const vps = readText(repoRoot, '_projects/n8n/local-setup/_main/Page 2 - Hostinger VPS.md');

  assert.match(vps, /^# Page 2 - Hostinger Coolify VPS n8n$/m);
  assert.match(vps, /\* Set up the Hostinger VPS and Coolify first\./);
  assert.match(vps, /\n---\n\n## 1\. Which n8n Path Should You Use\?/);
  assertHeadingsInOrder(vps, [
    '## 1. Which n8n Path Should You Use?',
    '## 2. What You Actually Manage',
    '## 3. Prerequisites',
    '## 4. Domain Or No-Domain Options',
    '## 5. Required n8n Public URL Concepts',
    '## 6. Safe Starter Compose For Coolify',
    '## 7. Deploy n8n In Coolify',
    '## 8. First-Launch Checklist',
    '## 9. Backups And Restore Responsibility',
    '## 10. Updating n8n In Coolify',
    '## 11. Maintenance Checklist',
    '## 12. Local Reverse Proxy Note',
    '## 13. Safety Rules',
    '## 14. References'
  ]);

  for (const expected of [
    'Hostinger one-click n8n VPS template',
    'Hostinger Coolify VPS with n8n inside Coolify',
    'Codex SSH Hostinger Coolify Setup Maintainer',
    'Coolify reverse proxy / Traefik',
    'n8n container internal port 5678',
    'private Postgres service',
    'Browser Terminal',
    'Coolify web dashboard',
    'sslip.io',
    'nip.io',
    'N8N_HOST',
    'N8N_PROTOCOL',
    'N8N_EDITOR_BASE_URL',
    'WEBHOOK_URL',
    'N8N_PROXY_HOPS',
    'N8N_ENCRYPTION_KEY',
    'GENERIC_TIMEZONE',
    'pg_isready',
    'service_healthy',
    'deployment/default network',
    'templates/production-server-backups/',
    'n8n export:workflow --backup --output=<backup_dir>',
    'n8n export:credentials --backup --output=<backup_dir>',
    'encrypted credential export only',
    'pg_dump',
    'n8n-production-YYYYMMDD-HHMMSS',
    'manifest.json',
    'RESTORE-NOTES.txt',
    'backup.log',
    'systemd',
    'cron',
    'N8N_BACKUP_RETENTION_DAYS',
    'N8N_SERVICE_NAME',
    'N8N_BACKUP_POSTGRES_SERVICE'
  ]) {
    assert.match(vps, new RegExp(escapeRegExp(expected)), expected);
  }

  assert.match(vps, /N8N_HOST=n8n\.example\.com/);
  assert.match(vps, /WEBHOOK_URL=https:\/\/n8n\.example\.com\//);
  assert.match(vps, /N8N_PROXY_HOPS=1/);
  assert.match(vps, /postgres:16-alpine/);
  assert.match(vps, /docker\.n8n\.io\/n8nio\/n8n:stable/);
  assert.match(vps, /DB_TYPE: postgresdb/);
  assert.match(vps, /^\s{4}healthcheck:\n\s{6}test: \["CMD-SHELL", "pg_isready/m);
  assert.match(vps, /^\s{4}depends_on:\n\s{6}postgres:\n\s{8}condition: service_healthy/m);
  assert.match(vps, /^\s{4}expose:\n\s{6}- "5678"/m);
  assert.match(vps, /Do not add `ports:` for Postgres/);
  assert.match(vps, /WEBHOOK_URL.*must end with `\/`/);
  assert.match(vps, /Do not assign Postgres a public domain, public route, Coolify proxy route/);
  assert.match(vps, /Docker host port mapping for `5432`/);
  assert.match(vps, /Do not use Windows Task Scheduler for Hostinger\/Coolify or company-server backups/);
  assert.match(vps, /decrypted credential export disabled/i);
  assert.match(vps, /Offsite or cloud storage is intentionally not configured here/);
  assert.match(vps, /future hardening item/);
  assert.doesNotMatch(vps, /^\s{4}ports:/m);
  assert.doesNotMatch(vps, /^networks:/m);
  assert.doesNotMatch(vps, /driver: bridge/);
  assert.doesNotMatch(vps, /203\.0\.113\.123/);
  assert.doesNotMatch(vps, /ssh root@/);
  assert.match(vps, /Avoid direct `http:\/\/<vps-ip>:5678` access except for disposable throwaway testing/);
  assert.doesNotMatch(vps, /https:\/\/n8n\.<your-vps-hostname>/);
  assert.doesNotMatch(vps, /Ubuntu 24\.04 with n8n/);
  assert.doesNotMatch(vps, /KVM 2 is the comfortable default/);
  assert.doesNotMatch(vps, /Docker Compose Manager/);
  assert.doesNotMatch(vps, /generic company VM/i);
  assert.doesNotMatch(vps, /unrelated hosting providers/i);
});

test('Production Cloudflare guide and menu use all-inclusive production backups', () => {
  const guide = readText(repoRoot, '_projects/n8n/local-setup/_main/Page 3 - Production Self-Hosting With Cloudflare Tunnel.md');
  const menu = readText(repoRoot, '_projects/n8n/local-setup/_main/templates/production-cloudflare-stack/scripts/n8n-production-cloudflare-menu.ps1');
  const envExample = readText(repoRoot, '_projects/n8n/local-setup/_main/templates/production-cloudflare-stack/.env.example');
  const runtimeIgnore = readText(repoRoot, '_projects/n8n/local-setup/_main/templates/production-cloudflare-stack/.gitignore');

  assert.match(guide, /Private runtime ignore template/);
  assert.match(guide, /Linux server backup template/);
  assert.match(guide, /\[production server backup template\]\(\.\/templates\/production-server-backups\/\)/);
  assert.match(guide, /`Back up now`/);
  assert.match(guide, /n8n export:workflow --backup --output=<backup_dir>/);
  assert.match(guide, /n8n export:credentials --backup --output=<backup_dir>/);
  assert.match(guide, /encrypted credential export only/);
  assert.match(guide, /Postgres `pg_dump`/);
  assert.match(guide, /n8n-production-YYYYMMDD-HHMMSS/);
  assert.match(guide, /manifest\.json/);
  assert.match(guide, /RESTORE-NOTES\.txt/);
  assert.match(guide, /backup\.log/);
  assert.match(guide, /retention cleanup using `N8N_BACKUP_RETENTION_DAYS`/);
  assert.match(guide, /does not set up automatic backups/);
  assert.match(guide, /Do not use Windows Task Scheduler for this production\/server documentation path/);
  assert.match(guide, /schedule it with systemd or cron/);
  assert.match(guide, /Offsite or cloud storage is intentionally not configured here/);
  assert.match(guide, /future hardening item/);
  assert.doesNotMatch(guide, /Backup Postgres/);

  assert.deepEqual(menuOptions(menu, 'Show-MainMenu'), [
    'Safety preflight',
    'Start production stack',
    'Stop production stack',
    'Restart n8n',
    'View status',
    'View logs',
    'Back up now',
    'Check/update images',
    'Print production URL',
    'Command list',
    'Exit'
  ]);

  assert.match(functionBody(menu, 'Get-N8nCliProductionBackupSpecs'), /export:workflow[\s\S]*export:credentials/);
  assert.match(functionBody(menu, 'Backup-N8nProductionNow'), /Get-N8nCliProductionBackupSpecs[\s\S]*Backup-Postgres/);
  assert.match(functionBody(menu, 'Backup-N8nProductionNow'), /Add-ProductionBackupLog[\s\S]*Write-ProductionBackupRestoreNotes[\s\S]*Write-ProductionBackupManifest/);
  assert.match(functionBody(menu, 'Write-ProductionBackupManifest'), /manifest\.json[\s\S]*backup\.log[\s\S]*RESTORE-NOTES\.txt/);
  assert.match(functionBody(menu, 'Write-ProductionBackupRestoreNotes'), /RESTORE-NOTES\.txt[\s\S]*import:workflow[\s\S]*import:credentials/);
  assert.match(functionBody(menu, 'Backup-N8nProductionNow'), /Invoke-ProductionBackupRetentionCleanup/);
  assert.match(functionBody(menu, 'Backup-N8nProductionNow'), /Decrypted credential export is disabled/);
  assert.match(functionBody(menu, 'Write-ProductionBackupManifest'), /includeWorkflows = \$true[\s\S]*includeCredentials = \$true[\s\S]*exportDecryptedCredentials = \$false[\s\S]*includeDatabase = \$true/);
  assert.match(functionBody(menu, 'Invoke-ProductionBackupRetentionCleanup'), /\^n8n-production-\\d\{8\}-\\d\{6\}\$/);
  assert.match(functionBody(menu, 'Invoke-ProductionBackupRetentionCleanup'), /Test-PathInsideDirectory[\s\S]*Remove-Item -LiteralPath \$folder\.FullName -Recurse -Force/);
  assert.match(functionBody(menu, 'Show-UpdateMenu'), /Backup-N8nProductionNow -Required/);
  assert.doesNotMatch(functionBody(menu, 'Show-MainMenu'), /Backup Postgres/);
  assert.doesNotMatch(functionBody(menu, 'Get-N8nCliProductionBackupSpecs'), /--decrypted/);
  assert.doesNotMatch(menu, /Windows Task Scheduler|Register-ScheduledTask|New-ScheduledTaskTrigger|Unregister-ScheduledTask/);

  assert.match(envExample, /^N8N_BACKUP_RETENTION_DAYS=30$/m);
  for (const ignored of ['.env', '.env.*', '!.env.example', 'backups/', 'logs/', '*.sql', '*.dump', '*.backup', '*.zip', '*.tar', '*.tgz', '**/SECRET-DO-NOT-COMMIT.env']) {
    assert.match(runtimeIgnore, new RegExp(`^${escapeRegExp(ignored)}$`, 'm'), ignored);
  }
});

test('production server backup template uses Linux scheduling and guarded credential export', () => {
  const readme = readText(repoRoot, '_projects/n8n/local-setup/_main/templates/production-server-backups/README.md');
  const script = readText(repoRoot, '_projects/n8n/local-setup/_main/templates/production-server-backups/n8n-production-backup.sh.template');
  const rootIgnore = readText(repoRoot, '.gitignore');

  for (const expected of [
    'Hostinger VPS plus Coolify',
    'n8n CLI workflow export',
    'n8n CLI credential export',
    'Postgres `pg_dump`',
    'manifest file',
    'Restore notes',
    'A run log',
    'Retention cleanup',
    'N8N_BACKUP_EXPORT_DECRYPTED_CREDENTIALS=1',
    'N8N_BACKUP_CONFIRM_DECRYPTED_EXPORT=EXPORT_DECRYPTED_CREDENTIALS',
    'systemd',
    'OnCalendar=*-*-* 03:15:00',
    'cron',
    'Do not use Windows Task Scheduler',
    'Offsite or cloud storage is intentionally not configured'
  ]) {
    assert.match(readme, new RegExp(escapeRegExp(expected)), expected);
  }

  assert.match(script, /n8n export:workflow --backup/);
  assert.match(script, /n8n "\$\{credential_args\[@\]\}"/);
  assert.match(script, /export:credentials --backup/);
  assert.match(script, /N8N_BACKUP_EXPORT_DECRYPTED_CREDENTIALS:-0/);
  assert.match(script, /N8N_BACKUP_CONFIRM_DECRYPTED_EXPORT:-/);
  assert.match(script, /EXPORT_DECRYPTED_CREDENTIALS/);
  assert.match(script, /--decrypted/);
  assert.match(script, /pg_dump -U "\$postgres_user" -d "\$postgres_db"/);
  assert.match(script, /manifest\.json/);
  assert.match(script, /RESTORE-NOTES\.txt/);
  assert.match(script, /backup\.log/);
  assert.match(script, /status": "\$\(json_escape "\$status"\)"/);
  assert.match(script, /find "\$backup_root_abs" -maxdepth 1 -type d -name 'n8n-production-/);
  assert.match(script, /rm -rf -- \{\} \+/);
  assert.match(script, /Refusing unsafe backup root/);
  assert.match(script, /Refusing backup root that begins with dash/);
  assert.doesNotMatch(script, /Register-ScheduledTask|schtasks|Windows Task Scheduler|powershell\.exe/i);

  for (const ignored of ['.n8n-production-cloudflare/', '.n8n-production-cloudflare/backups/', '**/n8n-production-*/', '*.log', '*.sql', '*.dump', '*.backup', '*.tar']) {
    assert.match(rootIgnore, new RegExp(`^${escapeRegExp(ignored)}$`, 'm'), ignored);
  }
});

test('linked n8n Skills and MCP setup surfaces are shipped as secondary AI-coding-agent references', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, 'mcp/projects/n8n-local-setup.md')), false);

  for (const expected of [...platformOutputs, ...mcpConfigOutputs, mcpConfigIndexOutput]) {
    assert.equal(fs.existsSync(path.join(repoRoot, expected.output)), true, expected.output);
  }

  for (const page of platformOutputs.map((entry) => entry.output)) {
    const text = readText(repoRoot, page);
    assert.match(text, new RegExp(escapeRegExp(officialN8nSkillsLink), 'i'), page);
    assert.match(text, /instance-level MCP|`n8n_live`/i, page);
    assert.match(text, /not a required local setup path|not part of the beginner local setup path/i, page);
    assert.match(text, /\]\(\.\.\/n8n\/local-setup\.md\)/, page);
    assert.match(text, /\]\(\.\.\/\.\.\/templates\/mcp-configs\//, page);
    assert.doesNotMatch(text, /_Page%201|\]\(\.\/templates\//, page);
    assert.doesNotMatch(text, retiredMcpSetupPattern, page);
    assertCapabilityAwareMcpGuidance(text, page);
  }

  for (const page of [
    'skills/n8n-local-setup/references/ai-agent-platforms/opencode.md',
    'skills/n8n-local-setup/references/ai-agent-platforms/antigravity.md'
  ]) {
    const text = readText(repoRoot, page);
    assert.match(text, /official README's "Other platforms" category/, page);
    assert.match(text, /npx skills add n8n-io\/skills/, page);
    assert.match(text, /`SessionStart` loads the \[official n8n Skills\]\(https:\/\/github\.com\/n8n-io\/skills\) entry-point meta-skill, currently `using-n8n-skills`, automatically/, page);
    assert.match(text, /`PreToolUse` nudges the agent to consult the matching skill/, page);
    assert.match(text, /`PostToolUse` can provide follow-up reminders/, page);
    assert.match(text, /Plain skill installs do not include the plugin `SessionStart`, `PreToolUse`, or `PostToolUse` hooks/, page);
    assert.match(text, /always start by loading the `using-n8n-skills` meta-skill/, page);
    assert.doesNotMatch(text, /Official plugin support is platform-dependent/, page);
  }

  for (const page of mcpConfigOutputs.map((entry) => entry.output)) {
    const text = readText(repoRoot, page);
    assert.match(text, /\bn8n_live\b/, page);
    assert.match(text, /official n8n/i, page);
    assert.match(text, /using-n8n-skills/, page);
    assert.match(text, /Do not modify anything\./, page);
    assert.doesNotMatch(text, retiredMcpSetupPattern, page);
    assert.doesNotMatch(text, /Smoke Test|create it in my n8n instance/i, page);
    assertCapabilityAwareMcpGuidance(text, page);
  }

  const codexPage = readText(repoRoot, 'skills/n8n-local-setup/references/ai-agent-platforms/codex.md');
  assert.match(codexPage, /marketplace registration is not (?:enough|a complete install)/i);
  assert.match(codexPage, /installed.*enabled/i);
  assert.match(codexPage, /not (?:merely|just) available/i);
  assert.match(codexPage, /temporary marketplace checkout/i);
  assert.match(codexPage, /\\\.codex\\\.tmp\\marketplaces\\n8n-io\\plugins\\n8n-skills/i);
  assert.match(codexPage, /On Windows, repair and audit the installed plugin cache before approving or trusting hooks/);
  assert.match(codexPage, /rewrites generic `\.sh` hook commands through `hooks\/run-hook\.ps1`/);
  assert.match(codexPage, /patches `n8n-skills@n8n-io` hook emitters with Node JSON fallbacks/);
  assertWindowsHookRecoveryGuidance(codexPage, 'codex recovery guidance');

  const claudePage = readText(repoRoot, 'skills/n8n-local-setup/references/ai-agent-platforms/claude-code.md');
  assert.match(claudePage, /On Windows, repair and audit the installed plugin cache before approving or trusting hooks/);
  assert.match(claudePage, /rewrites generic `\.sh` hook commands through `hooks\/run-hook\.ps1`/);
  assert.match(claudePage, /patches `n8n-skills@n8n-io` hook emitters with Node JSON fallbacks/);
  assertWindowsHookRecoveryGuidance(claudePage, 'claude recovery guidance');

  for (const page of [
    'skills/n8n-local-setup/templates/mcp-configs/codex-mcp-config.md',
    'skills/n8n-local-setup/templates/mcp-configs/claude-mcp-config.md'
  ]) {
    const text = readText(repoRoot, page);
    assert.match(text, /On Windows, repair official plugin hooks before trusting them/, page);
    assert.match(text, /adds Node JSON fallbacks for `n8n-skills@n8n-io`/, page);
    if (page.includes('codex-mcp-config')) {
      assert.match(text, /Do not report setup complete while `n8n-skills@n8n-io` is only marketplace-available/, page);
      assert.match(text, /if the UI still shows \*\*Add\*\*, run the plugin-add step/, page);
    }
    assertWindowsHookRecoveryGuidance(text, page);
  }

  for (const page of [
    'skills/n8n-local-setup/templates/mcp-configs/opencode-mcp-config.md',
    'skills/n8n-local-setup/templates/mcp-configs/antigravity-mcp-config.md'
  ]) {
    const text = readText(repoRoot, page);
    assert.match(text, /npx skills add n8n-io\/skills/, page);
    assert.match(text, /Plain skill installs do not include the plugin `SessionStart`, `PreToolUse`, or `PostToolUse` hooks/, page);
    assert.match(text, /current \[official n8n Skills\]\(https:\/\/github\.com\/n8n-io\/skills\) entry-point cue/, page);
    assert.match(text, /target repo `AGENTS\.md`/, page);
    assert.doesNotMatch(text, /plugin support is platform-dependent/i, page);
  }

  const mcpConfigIndex = readText(repoRoot, mcpConfigIndexOutput.output);
  assertCapabilityAwareMcpGuidance(mcpConfigIndex, mcpConfigIndexOutput.output);

  const localSetup = readText(repoRoot, '_projects/n8n/local-setup/_main/Page 1 - Local Setup.md');
  assert.match(localSetup, /mcp setup - codex\.md/);
  assert.match(localSetup, /templates\/mcp-configs\/codex-mcp-config\.md/);
  assert.doesNotMatch(localSetup, /N8N_MCP|mcp-server|MCP URL|MCP token|Enable MCP/);
});

test('curated indexes, skill metadata, and packs point to current skills-first surfaces', () => {
  const paths = [
    '_projects/n8n/local-setup/curated_output_for_ai/references/n8n/README.md',
    '_projects/n8n/local-setup/curated_output_for_ai/references/ai-agent-platforms/README.md',
    '_projects/n8n/local-setup/curated_output_for_ai/templates/mcp-configs/README.md',
    '_projects/n8n/local-setup/curated_output_for_ai/skills/n8n-local-setup/SKILL.md',
    '_projects/n8n/local-setup/curated_output_for_ai/skills/n8n-local-setup/README.md',
    '_projects/n8n/local-setup/curated_output_for_ai/packs/codex-n8n-local/README.md',
    '_projects/n8n/local-setup/curated_output_for_ai/packs/claude-code-n8n-local/README.md',
    '_projects/n8n/local-setup/curated_output_for_ai/packs/codex-n8n-local/pack.json',
    '_projects/n8n/local-setup/curated_output_for_ai/packs/claude-code-n8n-local/pack.json'
  ];

  const combined = paths.map((relPath) => readText(repoRoot, relPath)).join('\n');
  assert.match(combined, /hostinger-vps\.md/);
  assert.match(combined, /_n8n-local\.cmd/);
  assert.match(combined, /n8n-local-desktop-shortcut\.cmd/);
  assert.match(combined, /references\/ai-agent-platforms/);
  assert.match(combined, /skills-first|Skills-First/);
  assert.match(combined, new RegExp(`${escapeRegExp(officialN8nSkillsLink)} plus`, 'i'));
  assert.match(combined, /templates\/mcp-configs\/codex-mcp-config\.md|codex-mcp-config\.md/);
  assertWindowsHookRecoveryGuidance(combined, 'curated n8n local setup recovery guidance');

  for (const stale of ['upgrading.md', 'tunnelling.md', 'docker-compose-ngrok.md', 'vps-hosting.md', 'templates/local-stack/n8n-local.cmd', 'mcp/projects/n8n-local-setup.md']) {
    assert.doesNotMatch(combined, new RegExp(escapeRegExp(stale)), stale);
  }
});

test('repo README and usage docs route to n8n skills-first local setup surfaces', () => {
  const readme = readText(repoRoot, 'README.md');
  const howToUse = readText(repoRoot, 'repo/docs/HOW-TO-USE.md');
  const combined = `${readme}\n${howToUse}`;
  const readmeInstallSection = readme.split('\n## Install Skills By Platform\n')[1].split('\n## MCP Status\n')[0];
  const howToUseInstallSection = howToUse.split('\n## Install Toolkit Skills\n')[1].split('\n## Documentation Links\n')[0];

  for (const expected of [
    'skills/n8n-local-setup/references/n8n/local-setup.md',
    'skills/n8n-local-setup/references/n8n/hostinger-vps.md',
    'skills/n8n-local-setup/templates/local-stack/',
    'skills/n8n-local-setup/references/ai-agent-platforms/',
    'skills/n8n-local-setup/templates/mcp-configs/',
    'skills/n8n-agent-rules/'
  ]) {
    assert.match(combined, new RegExp(escapeRegExp(expected)), expected);
  }

  assert.match(combined, /Humans use `_projects\/\*\*`/);
  assert.match(combined, /Agents use (generated )?`skills\/\*\*`/);
  assert.match(combined, /Repo-wide MCP is intentionally not shipped, generated, maintained, or advertised as a supported surface for now\./);
  assert.match(combined, new RegExp(`${escapeRegExp(officialN8nSkillsTitleLink)} plus instance-level MCP references (?:remain inside|remain under|live inside|are packaged under)`));
  assert.match(combined, /They are not a repo-wide MCP surface\./);
  assert.doesNotMatch(readmeInstallSection, /\[Official n8n Skills\]|setup n8n plugin|using-n8n-skills|n8n_live|repair-codex-plugin-windows-hooks/i);
  assert.doesNotMatch(howToUseInstallSection, /\[Official n8n Skills\]|setup n8n plugin|using-n8n-skills|n8n_live|repair-codex-plugin-windows-hooks/i);

  for (const forbidden of [
    'mcp setup - codex',
    'mcp setup - claude code',
    'mcp setup - opencode',
    'mcp setup - antigravity',
    'Codex MCP config',
    'Claude Code MCP config',
    'OpenCode MCP config',
    'Antigravity MCP config'
  ]) {
    assert.doesNotMatch(combined, new RegExp(escapeRegExp(forbidden), 'i'), forbidden);
  }
});

test('n8n local setup packs install current files only', () => {
  const codex = JSON.parse(readText(repoRoot, 'skills/n8n-local-setup/packs/codex-n8n-local/pack.json'));
  const claude = JSON.parse(readText(repoRoot, 'skills/n8n-local-setup/packs/claude-code-n8n-local/pack.json'));

  for (const pack of [codex, claude]) {
    for (const expected of [
      'skills/n8n-local-setup/references/n8n/local-setup.md',
      'skills/n8n-local-setup/references/n8n/hostinger-vps.md',
      'skills/n8n-local-setup/templates/local-stack/docker-compose.yml',
      'skills/n8n-local-setup/templates/local-stack/.env.example',
      'skills/n8n-local-setup/templates/local-stack/_n8n-local.cmd',
      'skills/n8n-local-setup/templates/local-stack/n8n-local-desktop-shortcut.cmd',
      'skills/n8n-local-setup/templates/local-stack/scripts/n8n-local-menu.ps1',
      'skills/n8n-local-setup/templates/production-cloudflare-stack/docker-compose.yml',
      'skills/n8n-local-setup/templates/production-cloudflare-stack/.env.example',
      'skills/n8n-local-setup/templates/production-cloudflare-stack/.gitignore',
      'skills/n8n-local-setup/templates/production-cloudflare-stack/_n8n-production-cloudflare.cmd',
      'skills/n8n-local-setup/templates/production-cloudflare-stack/scripts/n8n-production-cloudflare-menu.ps1',
      'skills/n8n-local-setup/templates/production-server-backups/README.md',
      'skills/n8n-local-setup/templates/production-server-backups/n8n-production-backup.sh.template',
      'skills/n8n-agent-rules/SKILL.md',
      'skills/n8n-agent-rules/README.md',
      'skills/n8n-agent-rules/n8n-agent-rules.md',
      'skills/n8n-agent-rules/scripts/install-n8n-agent-adapter.cjs',
      'skills/n8n-local-setup/references/n8n-agent-rules.md'
    ]) {
      assert.ok(pack.installs.includes(expected), `${pack.id}: ${expected}`);
    }

    for (const stale of ['upgrading.md', 'tunnelling.md', 'docker-compose-ngrok.md', 'vps-hosting.md', 'templates/local-stack/n8n-local.cmd', 'N8N_MCP']) {
      assert.equal(pack.installs.some((entry) => entry.includes(stale)), false, `${pack.id}: ${stale}`);
      assert.equal((pack.source_refs || []).some((entry) => entry.includes(stale)), false, `${pack.id}: ${stale} source_refs`);
    }

    assert.ok(pack.source_refs.includes('skills/n8n-local-setup/templates/production-cloudflare-stack/.gitignore'), `${pack.id}: production .gitignore source ref`);
    assert.ok(pack.source_refs.includes('skills/n8n-local-setup/templates/production-server-backups/README.md'), `${pack.id}: production backup README source ref`);
    assert.ok(pack.source_refs.includes('skills/n8n-local-setup/templates/production-server-backups/n8n-production-backup.sh.template'), `${pack.id}: production backup script source ref`);
    assert.ok((pack.notes || []).some((entry) => /systemd timer or cron scheduling/.test(entry)), `${pack.id}: production scheduling note`);
  }

  assert.ok(codex.installs.includes('skills/n8n-local-setup/references/ai-agent-platforms/codex.md'));
  assert.ok(codex.installs.includes('skills/n8n-local-setup/templates/mcp-configs/codex-mcp-config.md'));
  assert.ok(codex.source_refs.includes('_projects/n8n/local-setup/_main/mcp setup - codex.md'));
  assert.ok(codex.source_refs.includes('_projects/n8n/local-setup/_main/templates/mcp-configs/codex-mcp-config.md'));
  assert.ok(claude.installs.includes('skills/n8n-local-setup/references/ai-agent-platforms/claude-code.md'));
  assert.ok(claude.installs.includes('skills/n8n-local-setup/templates/mcp-configs/claude-mcp-config.md'));
  assert.ok(claude.source_refs.includes('_projects/n8n/local-setup/_main/mcp setup - claude code.md'));
  assert.ok(claude.source_refs.includes('_projects/n8n/local-setup/_main/templates/mcp-configs/claude-mcp-config.md'));
});

test('n8n local setup published surface audit findings are resolved', () => {
  const report = auditJson();
  const unresolvedPack = report.issues.packInstalledUndeclared
    .map((entry) => entry.path)
    .filter((entryPath) => entryPath.startsWith('skills/n8n-local-setup/'));
  const unresolvedSuspicious = report.issues.suspiciousPublishedSurfaces
    .map((entry) => entry.path)
    .filter((entryPath) => entryPath.startsWith('skills/n8n-local-setup/'));

  assert.deepEqual(unresolvedPack, []);
  assert.deepEqual(unresolvedSuspicious, []);
});

test('changing a preserved n8n local setup source guide makes sync check fail stale', () => {
  const cwd = tempCopy();
  fs.appendFileSync(path.join(cwd, '_projects', 'n8n', 'local-setup', '_main', 'Page 2 - Hostinger VPS.md'), '\nStale output regression fixture.\n', 'utf8');
  const result = spawnSync(process.execPath, [syncScript, '--check'], { cwd, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Stale generated output: skills\/n8n-local-setup\/references\/n8n\/hostinger-vps\.md/);
});
