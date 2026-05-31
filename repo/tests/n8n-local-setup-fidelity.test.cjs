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
    source: 'curated_output_for_ai/references/ai-agent-platforms/codex.md',
    output: 'skills/n8n-local-setup/references/ai-agent-platforms/codex.md'
  },
  {
    source: 'curated_output_for_ai/references/ai-agent-platforms/claude-code.md',
    output: 'skills/n8n-local-setup/references/ai-agent-platforms/claude-code.md'
  },
  {
    source: 'curated_output_for_ai/references/ai-agent-platforms/opencode.md',
    output: 'skills/n8n-local-setup/references/ai-agent-platforms/opencode.md'
  },
  {
    source: 'curated_output_for_ai/references/ai-agent-platforms/antigravity.md',
    output: 'skills/n8n-local-setup/references/ai-agent-platforms/antigravity.md'
  }
];

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
  '_projects/n8n/local-setup/_main/mcp setup - codex.md',
  '_projects/n8n/local-setup/_main/mcp setup - claude code.md',
  '_projects/n8n/local-setup/_main/mcp setup - opencode.md',
  '_projects/n8n/local-setup/_main/mcp setup - antigravity.md',
  '_projects/n8n/local-setup/_main/codex-mcp-config.md',
  '_projects/n8n/local-setup/_main/claude-mcp-config.md',
  '_projects/n8n/local-setup/_main/opencode-mcp-config.md',
  '_projects/n8n/local-setup/_main/antigravity-mcp-config.md',
  '_projects/n8n/local-setup/curated_output_for_ai/mcp/n8n-local-setup.md',
  '_projects/n8n/local-setup/curated_output_for_ai/templates/mcp-configs/README.md',
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
  'skills/n8n-local-setup/references/ai-agent-platforms/1. local setup.md',
  'skills/n8n-local-setup/templates/mcp-configs/README.md',
  'skills/n8n-local-setup/templates/mcp-configs/antigravity-mcp-config.md',
  'skills/n8n-local-setup/templates/mcp-configs/claude-mcp-config.md',
  'skills/n8n-local-setup/templates/mcp-configs/codex-mcp-config.md',
  'skills/n8n-local-setup/templates/mcp-configs/opencode-mcp-config.md'
];

const expectedMenuOptions = [
  'Start local n8n stack',
  'Stop local n8n stack',
  'Restart local n8n stack',
  'Show status',
  'View all logs',
  'View n8n logs',
  'View Postgres logs',
  'View ngrok logs (advanced Compose tunnel)',
  'Backup Postgres database',
  'Check for updates',
  'Update selected services',
  'Update all services',
  'Open local n8n URL',
  'Open ngrok Docker Desktop extension guide',
  'Help / command reference',
  'Exit'
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

function menuOptions(menu) {
  return [...menu.matchAll(/Write-Host ' \s*\d+\. ([^']+)'/g)].map((match) => match[1]);
}

test('n8n local setup final source and generated surfaces are declared', () => {
  const manifest = localSetupManifest();
  for (const expected of [...guideOutputs, ...localStackOutputs]) {
    const output = manifest.outputs.find((entry) => entry.output === expected.output);
    assert.ok(output, expected.output);
    assert.equal(output.kind, 'copy', expected.output);
    assert.equal(output.source, expected.source, expected.output);
    assert.equal(output.fidelity, 'exact', expected.output);
    assert.ok(manifest.writes.allowed.includes(expected.output), expected.output);
  }

  for (const expected of platformOutputs) {
    const output = manifest.outputs.find((entry) => entry.output === expected.output);
    assert.ok(output, expected.output);
    assert.equal(output.kind, 'curated', expected.output);
    assert.equal(output.source, expected.source, expected.output);
    assert.equal(output.fidelity, 'reviewed_entrypoint', expected.output);
    assert.ok(manifest.writes.allowed.includes(expected.output), expected.output);
  }

  for (const removed of [
    'mcp/projects/n8n-local-setup.md',
    'skills/n8n-local-setup/references/n8n/upgrading.md',
    'skills/n8n-local-setup/references/n8n/tunnelling.md',
    'skills/n8n-local-setup/references/n8n/docker-compose-ngrok.md',
    'skills/n8n-local-setup/references/n8n/vps-hosting.md',
    'skills/n8n-local-setup/templates/local-stack/n8n-local.cmd',
    'skills/n8n-local-setup/templates/mcp-configs/README.md',
    'skills/n8n-local-setup/templates/mcp-configs/codex-mcp-config.md',
    'skills/n8n-local-setup/templates/mcp-configs/claude-mcp-config.md',
    'skills/n8n-local-setup/templates/mcp-configs/opencode-mcp-config.md',
    'skills/n8n-local-setup/templates/mcp-configs/antigravity-mcp-config.md'
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
    const source = stripGeneratedNotices(readText(repoRoot, `_projects/n8n/local-setup/${expected.source}`));
    const output = stripGeneratedNotices(readText(repoRoot, expected.output));
    assert.equal(output, source, expected.output);
  }

  for (const expected of localStackOutputs) {
    const source = readText(repoRoot, `_projects/n8n/local-setup/${expected.source}`).trimEnd() + '\n';
    const output = readText(repoRoot, expected.output);
    assert.equal(output, source, expected.output);
  }
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
  for (const removedMcp of ['mcp/projects/n8n-local-setup.md', 'templates/mcp-configs', 'mcp setup - codex.md', 'codex-mcp-config.md']) {
    assert.doesNotMatch(combined, new RegExp(escapeRegExp(removedMcp)), removedMcp);
  }
});

test('n8n local setup source README exposes two main beginner pages', () => {
  const readme = readText(repoRoot, '_projects/n8n/local-setup/_main/README.md');

  assert.match(readme, /^## Start Here$/m);
  assert.match(readme, /\[Page 1 - Local Setup\]\(\.\/Page%201%20-%20Local%20Setup\.md\)/);
  assert.match(readme, /\[Page 2 - Hostinger VPS\]\(\.\/Page%202%20-%20Hostinger%20VPS\.md\)/);
  assert.match(readme, /^## Supporting Materials$/m);
  assert.match(readme, /Local stack templates/);
  assert.match(readme, /Local helper scripts/);
  assert.match(readme, /^## Skills-First Routing$/m);
  assert.match(readme, /Humans use `_projects\/\*\*`/);
  assert.match(readme, /Agents use generated `skills\/\*\*` surfaces after sync/);
  assert.match(readme, /MCP setup\/config is intentionally not shipped or maintained by this toolkit for now\./);
  assert.match(readme, /\*\*If the \[AI Coding Agent Rules\]\(\.\.\/\.\.\/\.\.\/\.\.\/skills\/ai-coding-agent-rules\/\) skill is installed, repo-local templates are automatically checked/);

  for (const stale of ['Upgrading', 'Tunneling Guide', 'Docker Compose + ngrok', 'MCP setup pages', 'MCP config templates', 'mcp setup -', 'mcp-configs', 'extra - claude', 'extra - opencode', 'extra - antigravity']) {
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
    '## 8. Daily Use',
    '## 9. Backup',
    '## 10. Updating Local Instances',
    '## 11. Skills-First Agent Guidance',
    '## 12. Troubleshooting',
    '## 13. Advanced Queue Mode',
    '## 14. Safety Rules',
    '## 15. Appendices And References'
  ]);

  assert.match(localSetup, /Do not ask for ngrok or public URL values before local n8n works/i);
  assert.match(localSetup, /Open `http:\/\/localhost:5678`/);
  assert.match(localSetup, /Create the owner account locally/);
  assert.match(localSetup, /https:\/\/dashboard\.ngrok\.com\/get-started\/setup\/docker-desktop/);
  assert.match(localSetup, /ngrok Docker Desktop extension/);
  assert.match(localSetup, /Target n8n container port `5678`/);
  assert.match(localSetup, /Do not run both the Docker Desktop extension endpoint and the Compose ngrok tunnel/);
  assert.match(localSetup, /Free ngrok accounts get an assigned Dev Domain/);
  assert.match(localSetup, /Stopping an endpoint is not the same as deleting or releasing a reserved domain/);
  assert.match(localSetup, /OneDrive Desktop redirection/);
  assert.match(localSetup, /`C:\\n8n-local`/);
  assert.match(localSetup, /`<LOCAL_STACK_FOLDER>`/);
  assert.match(localSetup, /Do not launch n8n directly from Docker Desktop\. Launch it from `_n8n-local\.cmd` instead\./);
});

test('Local Setup separates .env and public URL values without MCP setup values', () => {
  const localSetup = readText(repoRoot, '_projects/n8n/local-setup/_main/Page 1 - Local Setup.md');
  const envExample = readText(repoRoot, '_projects/n8n/local-setup/_main/templates/local-stack/.env.example');

  assert.match(localSetup, /Copy `\.env\.example` to `\.env`/);
  assert.match(localSetup, /Do not edit `\.env\.example`/);
  assert.match(localSetup, /Replace only the value after `=`/);
  assert.match(localSetup, /^### Local Stack Runtime Values$/m);
  assert.match(localSetup, /^### Public n8n URL And Webhook Values$/m);

  for (const variable of ['POSTGRES_PASSWORD', 'N8N_ENCRYPTION_KEY', 'WEBHOOK_URL', 'N8N_HOST', 'N8N_PROTOCOL', 'N8N_PROXY_HOPS', 'NGROK_AUTHTOKEN', 'NGROK_DOMAIN']) {
    assert.match(localSetup, new RegExp(`\\| \`${variable}\` \\|`), variable);
  }

  assert.doesNotMatch(envExample, /N8N_MCP_URL|N8N_MCP_TOKEN/);
  assert.doesNotMatch(localSetup, /\| `N8N_MCP_URL` \| Basic local stack/);
  assert.doesNotMatch(localSetup, /\| `N8N_MCP_TOKEN` \| Basic local stack/);
  assert.doesNotMatch(localSetup, /MCP Values For AI Agents|MCP URL|MCP token|Enable MCP|N8N_MCP_URL|N8N_MCP_TOKEN|mcp%20setup|templates\/mcp-configs/);
});

test('Local Setup keeps skills-first agent guidance and does not route MCP setup', () => {
  const localSetup = readText(repoRoot, '_projects/n8n/local-setup/_main/Page 1 - Local Setup.md');
  const publicIndex = localSetup.indexOf('## 7. ngrok Public Tunnel Setup');
  const skillsIndex = localSetup.indexOf('## 11. Skills-First Agent Guidance');

  assert.ok(publicIndex > -1, 'public URL setup section exists');
  assert.ok(skillsIndex > publicIndex, 'skills-first guidance appears after public URL setup');
  assert.match(localSetup, /This toolkit is skills-first\./);
  assert.match(localSetup, /Humans use `_projects\/\*\*` for source review and maintenance\./);
  assert.match(localSetup, /Agents use `skills\/\*\*` after generated outputs are synced\./);
  assert.match(localSetup, /MCP setup\/config is intentionally not shipped or maintained by this toolkit for now\./);
  assert.match(localSetup, /Use \[n8n Agent Rules\]/);

  for (const forbidden of [
    'Codex MCP Setup',
    'Claude Code MCP Setup',
    'OpenCode MCP Setup',
    'Antigravity MCP Setup',
    'mcp%20setup%20-%20codex.md',
    'mcp%20setup%20-%20claude%20code.md',
    'mcp%20setup%20-%20opencode.md',
    'mcp%20setup%20-%20antigravity.md',
    'templates/mcp-configs',
    'Enable MCP',
    'through MCP'
  ]) {
    assert.doesNotMatch(localSetup, new RegExp(escapeRegExp(forbidden)), forbidden);
  }
});

test('Local Setup menu tables match launcher option names exactly', () => {
  const localSetup = readText(repoRoot, '_projects/n8n/local-setup/_main/Page 1 - Local Setup.md');
  const menu = readText(repoRoot, '_projects/n8n/local-setup/_main/templates/local-stack/scripts/n8n-local-menu.ps1');

  assert.deepEqual(menuOptions(menu), expectedMenuOptions);
  for (const option of expectedMenuOptions.filter((name) => name !== 'Exit')) {
    assert.match(localSetup, new RegExp(`\\| \`${escapeRegExp(option)}\` \\|`), option);
  }

  assert.match(localSetup, /\| Need \| Menu option \| Step 1 \| Step 2 \| What it does \| PowerShell fallback \|/);
  assert.match(localSetup, /\| Step \| Menu option \| What it does \| PowerShell fallback \|/);
  assert.match(localSetup, /\| 1 \| `Check for updates` \| Compares local image tag IDs before and after `docker compose pull`\. It may pull newer images into the local Docker cache, but it does not restart or recreate running services\. \|/);
  assert.match(localSetup, /\| 2 \| `Update selected services` \| Applies selected updates\. Back up first if Postgres is selected\. Postgres is pinned to major version 16 in `docker-compose\.yml`\. \|/);
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
  assert.match(menu, /function Invoke-MenuAction/);
  assert.match(menu, /try \{\n    & \$Action\n  \} catch \{/);
  assert.match(menu, /while \(-not \$script:ExitRequested\)/);
  assert.match(menu, /Pause-Menu/);
  assert.match(menu, /'16' \{ Clear-Host; Write-Success 'Bye\.'; \$script:ExitRequested = \$true \}/);
  assert.match(menu, /exit 0/);

  for (let option = 1; option <= 15; option += 1) {
    assert.match(menu, new RegExp(`'${option}' \\{ Invoke-MenuAction \\{[^\\n]+\\} \\}`), `option ${option} returns through Invoke-MenuAction`);
  }

  assert.match(menu, /Open-NgrokDockerDesktopGuide/);
  assert.match(menu, /https:\/\/dashboard\.ngrok\.com\/get-started\/setup\/docker-desktop/);
  assert.match(menu, /Do not launch n8n directly from Docker Desktop\. Launch it from _n8n-local\.cmd instead\./);
});

test('local stack templates stay placeholder-only and local-first', () => {
  const compose = readText(repoRoot, '_projects/n8n/local-setup/_main/templates/local-stack/docker-compose.yml');
  const envExample = readText(repoRoot, '_projects/n8n/local-setup/_main/templates/local-stack/.env.example');

  assert.match(compose, /^\s{2}postgres:/m);
  assert.match(compose, /^\s{2}n8n:/m);
  assert.match(compose, /^\s{2}ngrok:/m);
  assert.match(compose, /postgres:16-alpine/);
  assert.match(compose, /docker\.n8n\.io\/n8nio\/n8n:stable/);
  assert.match(compose, /ngrok\/ngrok:latest/);
  assert.match(compose, /DB_TYPE: postgresdb/);
  assert.match(compose, /"127\.0\.0\.1:5678:5678"/);
  assert.match(compose, /"127\.0\.0\.1:4040:4040"/);
  assert.doesNotMatch(compose, /^\s{2}redis:/m);
  assert.doesNotMatch(compose, /^\s{2}n8n-worker:/m);

  for (const expected of [
    'POSTGRES_PASSWORD=replace-with-local-postgres-password',
    'N8N_ENCRYPTION_KEY=replace-with-long-random-value',
    'N8N_HOST=localhost',
    'WEBHOOK_URL=http://localhost:5678/',
    'NGROK_AUTHTOKEN=replace-with-ngrok-authtoken',
    'NGROK_DOMAIN=your-reserved-domain.ngrok.app'
  ]) {
    assert.match(envExample, new RegExp(escapeRegExp(expected)), expected);
  }
  assert.doesNotMatch(envExample, /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/);
  assert.doesNotMatch(envExample, /n8n_[A-Za-z0-9_-]{20,}/);
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
  assert.doesNotMatch(vps, /Coolify/i);
  assert.doesNotMatch(vps, /generic company VM/i);
  assert.doesNotMatch(vps, /unrelated hosting providers/i);
});

test('MCP setup and config surfaces are not shipped from n8n local setup', () => {
  for (const relPath of obsoletePaths.filter((entry) => entry.includes('mcp') || entry.includes('MCP'))) {
    assert.equal(fs.existsSync(path.join(repoRoot, relPath)), false, relPath);
  }

  for (const page of platformOutputs.map((entry) => entry.output)) {
    const text = readText(repoRoot, page);
    assert.match(text, /skills-first/i, page);
    assert.match(text, /\]\(\.\.\/n8n\/local-setup\.md\)/, page);
    assert.match(text, /\]\(\.\.\/\.\.\/templates\/local-stack\/\)/, page);
    assert.match(text, /MCP setup\/config is intentionally not shipped or maintained by this toolkit for now\./, page);
    assert.doesNotMatch(text, /mcp-configs|N8N_MCP|mcp-server|MCP URL|MCP token|Enable MCP|through MCP|_Page%201|\]\(\.\/templates\//, page);
  }
});

test('curated indexes, skill metadata, and packs point to current skills-first surfaces', () => {
  const paths = [
    '_projects/n8n/local-setup/curated_output_for_ai/references/n8n/README.md',
    '_projects/n8n/local-setup/curated_output_for_ai/references/ai-agent-platforms/README.md',
    '_projects/n8n/local-setup/curated_output_for_ai/references/ai-agent-platforms/codex.md',
    '_projects/n8n/local-setup/curated_output_for_ai/references/ai-agent-platforms/claude-code.md',
    '_projects/n8n/local-setup/curated_output_for_ai/references/ai-agent-platforms/opencode.md',
    '_projects/n8n/local-setup/curated_output_for_ai/references/ai-agent-platforms/antigravity.md',
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
  assert.match(combined, /references\/ai-agent-platforms/);
  assert.match(combined, /skills-first|Skills-First/);
  assert.match(combined, /MCP setup\/config is intentionally not shipped or maintained by this toolkit for now\./);

  for (const stale of ['upgrading.md', 'tunnelling.md', 'docker-compose-ngrok.md', 'vps-hosting.md', 'templates/local-stack/n8n-local.cmd', 'mcp-configs/codex-mcp-config.md', 'mcp/projects/n8n-local-setup.md', 'N8N_MCP']) {
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
    'skills/n8n-agent-rules/'
  ]) {
    assert.match(combined, new RegExp(escapeRegExp(expected)), expected);
  }

  assert.match(combined, /Humans use `_projects\/\*\*`/);
  assert.match(combined, /Agents use (generated )?`skills\/\*\*`/);
  assert.match(combined, /MCP setup\/config is intentionally not shipped or maintained by this toolkit for now\./);

  for (const forbidden of [
    'skills/n8n-local-setup/templates/mcp-configs/',
    'mcp setup - codex',
    'mcp setup - claude code',
    'mcp setup - opencode',
    'mcp setup - antigravity',
    'Codex MCP config',
    'Claude Code MCP config',
    'OpenCode MCP config',
    'Antigravity MCP config',
    'MCP config templates'
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
      'skills/n8n-local-setup/templates/local-stack/scripts/n8n-local-menu.ps1',
      'skills/n8n-agent-rules/SKILL.md',
      'skills/n8n-agent-rules/README.md',
      'skills/n8n-agent-rules/n8n-agent-rules.md',
      'skills/n8n-agent-rules/scripts/install-n8n-agent-adapter.cjs',
      'skills/n8n-local-setup/references/n8n-agent-rules.md'
    ]) {
      assert.ok(pack.installs.includes(expected), `${pack.id}: ${expected}`);
    }

    for (const stale of ['upgrading.md', 'tunnelling.md', 'docker-compose-ngrok.md', 'vps-hosting.md', 'templates/local-stack/n8n-local.cmd', 'mcp-configs', 'mcp setup', 'N8N_MCP']) {
      assert.equal(pack.installs.some((entry) => entry.includes(stale)), false, `${pack.id}: ${stale}`);
      assert.equal((pack.source_refs || []).some((entry) => entry.includes(stale)), false, `${pack.id}: ${stale} source_refs`);
    }
  }

  assert.ok(codex.installs.includes('skills/n8n-local-setup/references/ai-agent-platforms/codex.md'));
  assert.ok(claude.installs.includes('skills/n8n-local-setup/references/ai-agent-platforms/claude-code.md'));
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
