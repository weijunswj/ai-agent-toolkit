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
  'Stop ngrok tunnel',
  'n8n + ngrok tunnel',
  'Cancel'
];

const expectedUpdateMenuOptions = [
  'All services',
  'n8n only',
  'postgres only',
  'ngrok only',
  'Cancel'
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
  const result = spawnSync(process.execPath, [auditScript, '--json'], { cwd: root, encoding: 'utf8' });
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
  for (const expected of [...guideOutputs, ...localStackOutputs, ...platformOutputs, ...mcpConfigOutputs]) {
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
  assert.match(readme, /\[Page 2 - Hostinger VPS\]\(\.\/Page%202%20-%20Hostinger%20VPS\.md\)/);
  assert.match(readme, /^## Supporting Materials$/m);
  assert.match(readme, /Local stack templates/);
  assert.doesNotMatch(readme, /Local helper scripts/);
  assert.doesNotMatch(readme, /\[scripts\/\]\(\.\/scripts\/\)/);
  assert.match(readme, /^## Skills-First Routing$/m);
  assert.match(readme, /Humans use `_projects\/\*\*`/);
  assert.match(readme, /Agents use generated `skills\/\*\*` surfaces after sync/);
  assert.match(readme, /Optional AI-coding-agent MCP feature references are secondary and only for users intentionally enabling n8n MCP for an AI coding agent\./);
  assert.match(readme, /^## Optional AI-Coding-Agent MCP Feature References$/m);
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

test('Local Setup keeps skills-first guidance and optional MCP setup table', () => {
  const localSetup = readText(repoRoot, '_projects/n8n/local-setup/_main/Page 1 - Local Setup.md');
  const publicIndex = localSetup.indexOf('## 7. ngrok Public Tunnel Setup');
  const skillsIndex = localSetup.indexOf('## 9. Skills-First Agent Guidance');

  assert.ok(publicIndex > -1, 'public URL setup section exists');
  assert.ok(skillsIndex > publicIndex, 'skills-first guidance appears after public URL setup');
  assert.match(localSetup, /This toolkit is skills-first\./);
  assert.match(localSetup, /Humans use `_projects\/\*\*` for source review and maintenance\./);
  assert.match(localSetup, /Agents use `skills\/\*\*` after generated outputs are synced\./);
  assert.match(localSetup, /Optional AI-coding-agent MCP feature references are available as secondary material, not as the beginner setup path\./);
  assert.match(localSetup, /Use \[n8n Agent Rules\]/);
  assert.match(localSetup, /Use this table only when you want an AI coding agent to work with n8n workflows through the optional MCP feature setup/);

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
  assert.match(localSetup, /`Back up` writes a timestamped SQL dump under:/);
  assert.match(localSetup, /%USERPROFILE%\\\.n8n-local\\backups/);
  assert.match(localSetup, /The launcher clears the completed command output, trims the console buffer when Windows allows it, and redraws the main menu\./);
  assert.match(localSetup, /For normal use, the quick status at the top of the main menu is enough/);
  assert.match(localSetup, /Use `Show Compose status` only when you need the more detailed Docker Compose view/);
  assert.match(localSetup, /`Command list` explains what the numbered menu options do/);
  assert.match(localSetup, /If the update includes Postgres, the launcher runs `Back up` first/);
});

test('local launcher and menu keep the console open until Exit', () => {
  const cmd = readText(repoRoot, '_projects/n8n/local-setup/_main/templates/local-stack/_n8n-local.cmd');
  const menu = readText(repoRoot, '_projects/n8n/local-setup/_main/templates/local-stack/scripts/n8n-local-menu.ps1');

  assert.match(cmd, /n8n-local-menu\.ps1/);
  assert.match(cmd, /-ExecutionPolicy Bypass/);
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
  assert.match(menu, /function Write-BackupImageLog/);
  assert.match(functionBody(menu, 'Get-ComposeServiceRows'), /docker compose ps --format '\{\{\.Service\}\}\|\{\{\.Image\}\}\|\{\{\.State\}\}'/);
  assert.match(functionBody(menu, 'Get-RunningServiceImage'), /docker inspect \$container --format '\{\{\.Config\.Image\}\}'/);
  assert.match(functionBody(menu, 'Get-ImageVersionLines'), /Get-RunningServiceImage[\s\S]*failed to detect[\s\S]*stopped/);
  assert.doesNotMatch(functionBody(menu, 'Get-ImageVersionLines'), /\$script:ServiceImages/);
  assert.doesNotMatch(menu, /function Show-Help/);
  assert.match(menu, /try \{\n    & \$Action\n  \} catch \{/);
  assert.match(menu, /while \(-not \$script:ExitRequested\)/);
  assert.match(menu, /Pause-Menu/);
  assert.match(menu, /'9' \{ Clear-MenuScreen; Write-Success 'Bye\.'; \$script:ExitRequested = \$true \}/);
  assert.match(menu, /exit 0/);

  for (let option = 1; option <= 8; option += 1) {
    assert.match(menu, new RegExp(`'${option}' \\{ Invoke-MenuAction \\{[^\\n]+\\} \\}`), `option ${option} returns through Invoke-MenuAction`);
  }

  assert.match(menu, /function Get-RunningServices/);
  assert.match(menu, /function Write-ServiceStatus/);
  assert.match(menu, /If this is the template folder, copy the stack to %USERPROFILE%\\\.n8n-local first\./);
  assert.match(menu, /Then copy \.env\.example to \.env in that local stack folder and fill the placeholders\./);
  assert.match(functionBody(menu, 'Get-RunningServices'), /Join-Path \$script:StackRoot '\.env'[\s\S]*return @\(\)/);
  assert.match(functionBody(menu, 'Get-RunningServices'), /try \{[\s\S]*docker compose ps --services --filter 'status=running' 2>\$null[\s\S]*\} catch \{[\s\S]*return @\(\)[\s\S]*\}/);
  assert.match(menu, /Write-ServiceStatus -Name 'postgres'/);
  assert.match(menu, /Write-ServiceStatus -Name 'n8n'/);
  assert.match(menu, /Write-ServiceStatus -Name 'ngrok'/);
  assert.match(menu, /WEBHOOK_URL is still using ngrok, but ngrok is stopped/);
  assert.match(menu, /Public webhooks and OAuth callbacks will not/);
  assert.match(menu, /function Set-ActiveWebhookUrl/);
  assert.match(functionBody(menu, 'Set-ActiveWebhookUrl'), /\.env\.active[\s\S]*WEBHOOK_URL=\$activeUrl/);
  assert.match(menu, /\$webhookLabel = "  \{0,-22\}: " -f 'active WEBHOOK_URL'/);
  assert.match(functionBody(menu, 'Show-LaunchStatus'), /Write-ImageVersions -RunningServices \$runningServices[\s\S]*Write-Host ''[\s\S]*WEBHOOK_URL is still using ngrok, but ngrok is stopped/);
  assert.match(menu, /Write-Host '  2\. Start ngrok tunnel'/);
  assert.match(menu, /Write-Host '  1\. Stop ngrok tunnel'/);
  assert.match(menu, /Write-Host '  5\. Show Compose status'/);
  assert.match(menu, /Write-Host '  8\. Command list'/);
  assert.match(functionBody(menu, 'Show-Status'), /service state, health, container names, and ports/);
  assert.match(functionBody(menu, 'Show-Status'), /Invoke-Compose -Arguments @\('ps'\)/);
  assert.match(functionBody(menu, 'Show-Status'), /Write-ImageVersions/);
  assert.match(functionBody(menu, 'Apply-Update'), /This update includes Postgres[\s\S]*Backup-Postgres -Required[\s\S]*Update cancelled because the automatic Postgres backup did not complete/);
  assert.match(functionBody(menu, 'Backup-Postgres'), /n8n-postgres-\$timestamp[\s\S]*database\.sql[\s\S]*Write-BackupImageLog -BackupPath \$backupPath[\s\S]*return \$true[\s\S]*return \$false/);
  assert.match(functionBody(menu, 'Write-BackupImageLog'), /image-versions\.txt[\s\S]*Running container images at backup time/);
  assert.match(functionBody(menu, 'Write-CommandListItem'), /\$itemLabelWidth = 19[\s\S]*\$itemPrefix = \("  \{0\}\. \{1,-\$itemLabelWidth\}: " -f \$Number, \$Name\)/);
  assert.match(functionBody(menu, 'Show-CommandList'), /Write-CommandListItem -Number '7' -Name 'Back up' -Description 'Writes a timestamped backup folder under \.\\backups\.'/);
  assert.match(menu, /function Show-UpdateMenu/);
  assert.match(menu, /Choose what to update\. The launcher pulls images, then recreates selected containers automatically\./);
  assert.match(functionBody(menu, 'Show-UpdateMenu'), /Read-Host 'Enter a number'[\s\S]*Apply-Update -Services \$selection/);
  assert.match(functionBody(menu, 'Apply-Update'), /Invoke-Compose -Arguments \$pullArgs[\s\S]*Invoke-Compose -Arguments \$upArgs[\s\S]*Selected services were pulled and recreated/);
  assert.match(functionBody(menu, 'Start-N8nWithNgrok'), /n8n is already running\. It will be recreated so current non-image \.env values are applied\.[\s\S]*Starting or refreshing ngrok tunnel now\./);
  assert.doesNotMatch(functionBody(menu, 'Start-NgrokTunnel'), /N8N_HOST/);
  assert.doesNotMatch(functionBody(menu, 'Start-NgrokTunnel'), /N8N_PROTOCOL/);
  assert.match(functionBody(menu, 'Start-NgrokTunnel'), /Get-NgrokWebhookUrl -Domain \$domain[\s\S]*Set-ActiveWebhookUrl -Url \$publicWebhookUrl -Mode 'ngrok'/);
  assert.match(functionBody(menu, 'Start-LocalStack'), /Set-ActiveWebhookUrl -Url \(Get-LocalWebhookUrl\) -Mode 'localhost'/);
  assert.match(functionBody(menu, 'Start-NgrokTunnel'), /Test-ServiceImagesAvailable -Services \$script:Services -AllowPull:\$isFirstStart[\s\S]*\$upArgs \+= @\('--pull', 'never'\)[\s\S]*\$upArgs \+= @\('--force-recreate', 'n8n', 'ngrok'\)/);
  assert.match(functionBody(menu, 'Stop-NgrokTunnel'), /Set-ActiveWebhookUrl -Url \(Get-LocalWebhookUrl\) -Mode 'localhost'[\s\S]*Recreating n8n so WEBHOOK_URL is now local\.[\s\S]*Test-ServiceImagesAvailable -Services @\('n8n'\)[\s\S]*Invoke-Compose -Arguments @\('up', '-d', '--pull', 'never', '--force-recreate', 'n8n'\)/);
  assert.match(functionBody(menu, 'Restart-N8n'), /Set-ActiveWebhookUrl -Url \(Get-LocalWebhookUrl\) -Mode 'localhost'[\s\S]*current non-image \.env values are applied[\s\S]*Test-ServiceImagesAvailable -Services @\('n8n'\)[\s\S]*Invoke-Compose -Arguments @\('up', '-d', '--pull', 'never', '--force-recreate', 'n8n'\)/);
  assert.match(functionBody(menu, 'Show-Logs'), /logs', '--tail', '200'/);
  assert.doesNotMatch(menu, /Open-NgrokDockerDesktopGuide/);
  assert.doesNotMatch(menu, /dashboard\.ngrok\.com\/get-started\/setup\/docker-desktop/);
  assert.match(menu, /Do not launch n8n directly from Docker Desktop\. Launch it from _n8n-local\.cmd instead\./);
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

test('local stack templates stay placeholder-only and local-first', () => {
  const compose = readText(repoRoot, '_projects/n8n/local-setup/_main/templates/local-stack/docker-compose.yml');
  const envExample = readText(repoRoot, '_projects/n8n/local-setup/_main/templates/local-stack/.env.example');
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
});

test('Hostinger VPS page restores Hostinger-specific production content only', () => {
  const vps = readText(repoRoot, '_projects/n8n/local-setup/_main/Page 2 - Hostinger VPS.md');

  assert.match(vps, /^# Page 2 - Hostinger VPS$/m);
  assert.match(vps, /\* Verify current Hostinger plan\/template details before buying\./);
  assert.match(vps, /\n---\n\n## 1\. When To Use Hostinger VPS/);
  assertHeadingsInOrder(vps, [
    '## 1. When To Use Hostinger VPS',
    '## 2. Choose A Hostinger Plan',
    '## 3. Choose The n8n Template',
    '## 4. First Login Checklist',
    '## 5. Domain / Subdomain Setup',
    '## 6. Verify Server Files',
    '## 7. Verify Containers',
    '## 8. Queue Mode And Workers',
    '## 9. Backups',
    '## 10. Updating Hostinger n8n',
    '## 11. Safety Rules',
    '## 12. References'
  ]);

  for (const expected of [
    'KVM 1',
    'KVM 2',
    'KVM 4',
    'KVM 8',
    '1 vCPU',
    '4 GB RAM',
    '50 GB NVMe',
    '4 TB bandwidth',
    '2 vCPU',
    '8 GB RAM',
    '100 GB NVMe',
    '8 TB bandwidth',
    'Ubuntu 24.04 with n8n',
    'Ubuntu 24.04 with n8n (queue mode)',
    'Browser Terminal',
    'IP address',
    'Server IP',
    'IPv4',
    'Dedicated IP',
    'ssh root@203.0.113.123',
    'https://n8n.<your-vps-hostname>',
    '/docker/n8n',
    '/root',
    'docker-compose.yml',
    'docker compose pull',
    'docker compose down',
    'docker compose up -d',
    'Docker Compose Manager',
    'VPS snapshot',
    'N8N_ENCRYPTION_KEY'
  ]) {
    assert.match(vps, new RegExp(escapeRegExp(expected)), expected);
  }

  assert.match(vps, /KVM 2 is the comfortable default/);
  assert.match(vps, /KVM 1 is budget\/light-use only/);
  assert.match(vps, /KVM 4\+ is for heavier workflows/);
  assert.match(vps, /A record/);
  assert.match(vps, /DNS propagation/);
  assert.match(vps, /Replace `203\.0\.113\.123` with the IP address from hPanel/);
  assert.doesNotMatch(vps, /123\.123\.123\.123/);
  assert.doesNotMatch(vps, /ssh root@<your-vps-ip>/);
  assert.match(vps, /Do not copy the Hostinger dashboard URL\. You need the server IP address\./);
  assert.match(vps, /Terminal commands go in Browser Terminal or SSH\. Website URLs go in your web browser\./);
  assert.match(vps, /Do not type the n8n URL into Browser Terminal or SSH\. It belongs in a web browser\./);
  assert.match(vps, /Save the email, password, n8n URL, and VPS IP address in the password manager/);
  assert.doesNotMatch(vps, /Coolify/i);
  assert.doesNotMatch(vps, /generic company VM/i);
  assert.doesNotMatch(vps, /unrelated hosting providers/i);
});

test('optional MCP setup and config surfaces are shipped as secondary AI-coding-agent references', () => {
  assert.equal(fs.existsSync(path.join(repoRoot, 'mcp/projects/n8n-local-setup.md')), false);

  for (const expected of [...platformOutputs, ...mcpConfigOutputs, mcpConfigIndexOutput]) {
    assert.equal(fs.existsSync(path.join(repoRoot, expected.output)), true, expected.output);
  }

  for (const page of platformOutputs.map((entry) => entry.output)) {
    const text = readText(repoRoot, page);
    assert.match(text, /optional .*MCP feature reference/i, page);
    assert.match(text, /not a required local setup path|not part of the beginner local setup path/i, page);
    assert.match(text, /\]\(\.\.\/n8n\/local-setup\.md\)/, page);
    assert.match(text, /\]\(\.\.\/\.\.\/templates\/mcp-configs\//, page);
    assert.doesNotMatch(text, /_Page%201|\]\(\.\/templates\//, page);
  }

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
  assert.match(combined, /Optional AI-coding-agent MCP/i);
  assert.match(combined, /templates\/mcp-configs\/codex-mcp-config\.md|codex-mcp-config\.md/);

  for (const stale of ['upgrading.md', 'tunnelling.md', 'docker-compose-ngrok.md', 'vps-hosting.md', 'templates/local-stack/n8n-local.cmd', 'mcp/projects/n8n-local-setup.md']) {
    assert.doesNotMatch(combined, new RegExp(escapeRegExp(stale)), stale);
  }
});

test('repo README and usage docs route to n8n skills-first local setup surfaces', () => {
  const readme = readText(repoRoot, 'README.md');
  const howToUse = readText(repoRoot, 'repo/docs/HOW-TO-USE.md');
  const combined = `${readme}\n${howToUse}`;

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
  assert.match(combined, /No runnable MCP server, package, CLI, or executable MCP tools are shipped from this repo today\./);
  assert.match(combined, /Optional n8n AI-coding-agent MCP feature references are secondary and not the beginner local setup path\./);

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
  const result = spawnSync(process.execPath, [syncScript, '--check'], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Stale generated output: skills\/n8n-local-setup\/references\/n8n\/hostinger-vps\.md/);
});
