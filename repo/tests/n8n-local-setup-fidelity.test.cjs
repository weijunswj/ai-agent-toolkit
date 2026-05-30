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

const restoredReferences = [
  {
    source: '_main/1. local setup.md',
    output: 'skills/n8n-local-setup/references/n8n/local-setup.md'
  },
  {
    source: '_main/2. upgrading.md',
    output: 'skills/n8n-local-setup/references/n8n/upgrading.md'
  },
  {
    source: '_main/3. tunneling guide.md',
    output: 'skills/n8n-local-setup/references/n8n/tunnelling.md'
  },
  {
    source: '_main/3a. docker compose + ngrok.md',
    output: 'skills/n8n-local-setup/references/n8n/docker-compose-ngrok.md'
  },
  {
    source: '_main/4. vps hosting.md',
    output: 'skills/n8n-local-setup/references/n8n/vps-hosting.md'
  },
  {
    source: '_main/5. extra - claude code integration.md',
    output: 'skills/n8n-local-setup/references/ai-agent-platforms/claude-code.md'
  },
  {
    source: '_main/6. extra - opencode integration.md',
    output: 'skills/n8n-local-setup/references/ai-agent-platforms/opencode.md'
  },
  {
    source: '_main/7. extra - antigravity integration.md',
    output: 'skills/n8n-local-setup/references/ai-agent-platforms/antigravity.md'
  }
];

const localStackTemplates = [
  {
    source: '_main/templates/local-stack/docker-compose.yml',
    output: 'skills/n8n-local-setup/templates/local-stack/docker-compose.yml'
  },
  {
    source: '_main/templates/local-stack/.env.example',
    output: 'skills/n8n-local-setup/templates/local-stack/.env.example'
  },
  {
    source: '_main/templates/local-stack/n8n-local.cmd',
    output: 'skills/n8n-local-setup/templates/local-stack/n8n-local.cmd'
  },
  {
    source: '_main/templates/local-stack/scripts/n8n-local-menu.ps1',
    output: 'skills/n8n-local-setup/templates/local-stack/scripts/n8n-local-menu.ps1'
  }
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

test('n8n local setup restored references are declared copy outputs', () => {
  const manifest = localSetupManifest();
  for (const expected of restoredReferences) {
    const output = manifest.outputs.find((entry) => entry.output === expected.output);
    assert.ok(output, expected.output);
    assert.equal(output.kind, 'copy', expected.output);
    assert.equal(output.source, expected.source, expected.output);
    assert.equal(output.fidelity, 'exact', expected.output);
    assert.ok(manifest.writes.allowed.includes(expected.output), expected.output);
  }
});

test('n8n local setup stack templates are declared exact copy outputs', () => {
  const manifest = localSetupManifest();
  for (const expected of localStackTemplates) {
    const output = manifest.outputs.find((entry) => entry.output === expected.output);
    assert.ok(output, expected.output);
    assert.equal(output.kind, 'copy', expected.output);
    assert.equal(output.source, expected.source, expected.output);
    assert.equal(output.fidelity, 'exact', expected.output);
    assert.ok(manifest.writes.allowed.includes(expected.output), expected.output);
  }
});

test('n8n local setup restored references preserve full source guide bodies', () => {
  const manifest = localSetupManifest();
  for (const expected of restoredReferences) {
    const source = readText(repoRoot, `_projects/n8n/local-setup/${expected.source}`).trimEnd() + '\n';
    const recipe = manifest.outputs.find((entry) => entry.output === expected.output);
    const output = stripGeneratedNotices(readText(repoRoot, expected.output));
    assert.equal(output, applyTextRewrites(source, recipe), expected.output);
  }
});

test('n8n local setup stack templates preserve placeholder-only source bodies', () => {
  for (const expected of localStackTemplates) {
    const source = readText(repoRoot, `_projects/n8n/local-setup/${expected.source}`).trimEnd() + '\n';
    const output = readText(repoRoot, expected.output);
    assert.equal(output, source, expected.output);
  }
});

test('n8n local setup README stays short and index-like', () => {
  const readme = readText(repoRoot, '_projects/n8n/local-setup/curated_output_for_ai/skills/n8n-local-setup/README.md');

  assert.ok(readme.length < 3500, 'published skill README should stay short');
  assert.match(readme, /^## Start Here$/m);
  assert.match(readme, /\[references\/n8n\/local-setup\.md\]\(references\/n8n\/local-setup\.md\)/);
  assert.match(readme, /^## Agent Rules And Adapters$/m);
  assert.match(readme, /\*\*If the \[AI Coding Agent Rules\]\(\.\.\/ai-coding-agent-rules\/\) skill is installed, repo-local templates are automatically checked, bootstrapped, repaired, and merged\/appended into `AGENTS\.md` and equivalent agent instruction files before repo edits\.\*\*/);

  for (const removedHeading of [
    '## Fast Path',
    '## Recommended Example Folder',
    '## Blessed Local Stack',
    '## Blessed Local Launcher',
    '## Why Postgres Is Included',
    '## Tunnel Scope',
    '## Advanced Queue Mode',
    '## MCP Config Templates'
  ]) {
    assert.doesNotMatch(readme, new RegExp(`^${escapeRegExp(removedHeading)}$`, 'm'), removedHeading);
  }
});

test('n8n local setup source README stays an index without noisy setup sections', () => {
  const readme = readText(repoRoot, '_projects/n8n/local-setup/_main/README.md');

  assert.match(readme, /^## Start Here$/m);
  assert.match(readme, /\[1\. Local Setup\]\(\.\/1\.%20local%20setup\.md\)/);
  assert.match(readme, /These pages are secondary references\. They are not equal start paths for local setup\./);
  assert.match(readme, /\[3\. Hostinger Domain And Tunnel Notes\]\(\.\/3\.%20tunneling%20guide\.md\)/);

  for (const removedHeading of [
    '## Fast Path',
    '## Recommended Example Folder',
    '## Blessed Local Stack',
    '## Blessed Local Launcher',
    '## Why Postgres Is Included',
    '## Tunnel Scope',
    '## Advanced Queue Mode',
    '## MCP Config Templates'
  ]) {
    assert.doesNotMatch(readme, new RegExp(`^${escapeRegExp(removedHeading)}$`, 'm'), removedHeading);
  }
});

test('n8n local setup main guide follows beginner-first install structure', () => {
  const localSetup = readText(repoRoot, '_projects/n8n/local-setup/_main/1. local setup.md');

  const headingsInOrder = [
    '## Fast Path ( Full Guide Below )',
    '## Before You Start',
    '## Create The Local Stack Folder',
    '## Copy The Local Stack Templates',
    '## Create And Fill `.env`',
    '## What Not To Commit',
    '## Start The Local Menu',
    '## First Launch: Local-Only Owner Setup',
    '## Public Tunnel With ngrok',
    '## Daily Use',
    '## Updates',
    '## MCP Setup',
    '## Agent Rules And Adapters',
    '## Agent Platform Setup',
    '## Troubleshooting',
    '## Advanced Queue Mode',
    '## Safety Rules'
  ];

  let lastIndex = -1;
  for (const heading of headingsInOrder) {
    assert.match(localSetup, new RegExp(`^${escapeRegExp(heading)}$`, 'm'), heading);
    const index = localSetup.indexOf(heading);
    assert.ok(index > lastIndex, heading);
    lastIndex = index;
  }

  assert.doesNotMatch(localSetup, /^## What This Guide Creates$/m);
  assert.match(localSetup, /\| Step \| What to do \| Where \| Result \|/);
  assert.match(localSetup, /\[local stack template folder\]\(\.\/templates\/local-stack\/\)/);
  assert.match(localSetup, /Copy everything inside the \[local stack template folder\]\(\.\/templates\/local-stack\/\) into `Desktop\\n8n-local`/);
  assert.match(localSetup, /Copy the whole folder contents\. Do not pull out only the `\.ps1` file\./);
  assert.match(localSetup, /Or run this from the toolkit repo root instead:/);
});

test('n8n local setup env, folder, launch, and tunnel instructions are explicit', () => {
  const localSetup = readText(repoRoot, '_projects/n8n/local-setup/_main/1. local setup.md');

  assert.match(localSetup, /Copy `\.env\.example` To `\.env`/);
  assert.match(localSetup, /Do not edit `\.env\.example`/);
  assert.match(localSetup, /\| Variable \| What to paste \| Example \/ format \| Notes \|/);
  for (const variable of [
    'POSTGRES_PASSWORD',
    'N8N_ENCRYPTION_KEY',
    'NGROK_AUTHTOKEN',
    'NGROK_DOMAIN',
    'WEBHOOK_URL',
    'N8N_HOST',
    'N8N_PROTOCOL',
    'N8N_PROXY_HOPS'
  ]) {
    assert.match(localSetup, new RegExp(`\\| \`${variable}\` \\|`), variable);
  }
  assert.match(localSetup, /https:\/\/dashboard\.ngrok\.com\/get-started\/your-authtoken/);
  assert.match(localSetup, /^### Create And Reserve Your ngrok Domain$/m);
  assert.match(localSetup, /Paste the authtoken from your ngrok dashboard into your local `\.env` file\. Do not share this value or commit it to GitHub\./);
  assert.match(localSetup, /Run this in PowerShell from any folder to create the folder on your Desktop:/);
  assert.match(localSetup, /cd "\$env:USERPROFILE\\Desktop\\n8n-local"\nGet-ChildItem -Force\nGet-ChildItem -Force \.\\scripts/);
  assert.match(localSetup, /Desktop\\n8n-local\n\|-- docker-compose\.yml\n\|-- \.env\.example\n\|-- \.env\n\|-- n8n-local\.cmd\n`-- scripts\\/);
  assert.match(localSetup, /Commit means save into Git\/GitHub\./);
  assert.match(localSetup, /Do not save these files or values into GitHub:/);
  assert.match(localSetup, /- `\.env` files\./);
  assert.match(localSetup, /- Real ngrok authtokens\./);
  assert.match(localSetup, /- Real passwords\./);
  assert.match(localSetup, /- Real n8n encryption keys\./);
  assert.match(localSetup, /Double-click `n8n-local\.cmd`/);
  assert.match(localSetup, /Do not launch n8n directly from Docker Desktop\. Launch it from `n8n-local\.cmd` instead\./);
  assert.match(localSetup, /If you are only opening n8n on your own computer, you do not need ngrok\./);
  assert.match(localSetup, /Use ngrok when another online service must call your local n8n webhook or OAuth callback\./);
  assert.match(localSetup, /Close the existing `n8n-local\.cmd` window\.\n2\. Save `\.env`\.\n3\. Double-click `n8n-local\.cmd` again\./);
});

test('n8n local setup keeps run-location guidance with cd before folder-specific PowerShell', () => {
  const localSetup = readText(repoRoot, '_projects/n8n/local-setup/_main/1. local setup.md');

  const folderSpecificCommands = [
    'Copy-Item -LiteralPath ".env.example" -Destination ".env" -Force',
    '.\\n8n-local.cmd',
    'docker compose up -d postgres n8n',
    'docker compose up -d ngrok',
    'docker compose up -d --force-recreate n8n ngrok',
    'docker compose stop ngrok',
    'docker compose logs -f ngrok'
  ];

  for (const command of folderSpecificCommands) {
    const index = localSetup.indexOf(command);
    assert.ok(index > -1, command);
    const preceding = localSetup.slice(Math.max(0, index - 500), index);
    assert.match(preceding, /cd "\$env:USERPROFILE\\Desktop\\n8n-local"/, command);
  }

  assert.doesNotMatch(localSetup, /Run this in PowerShell from `%USERPROFILE%\\Desktop\\n8n-local`/);
  assert.match(localSetup, /Paste values into `\.env`, not PowerShell|Replace only the value after `=`/);
  assert.match(localSetup, /Open this URL in your browser/);
});

test('n8n local setup appendices are collapsed or focused', () => {
  const upgrading = readText(repoRoot, '_projects/n8n/local-setup/_main/2. upgrading.md');
  const tunnelling = readText(repoRoot, '_projects/n8n/local-setup/_main/3. tunneling guide.md');
  const composeGuide = readText(repoRoot, '_projects/n8n/local-setup/_main/3a. docker compose + ngrok.md');

  assert.match(upgrading, /The primary local setup guide is \[1\. Local Setup\]\(\.\/1\.%20local%20setup\.md\)/);
  assert.match(tunnelling, /^# 3\. Hostinger Domain And Tunnel Notes$/m);
  assert.match(tunnelling, /focused Hostinger transition note/);
  assert.match(tunnelling, /Do not add another ngrok setup path on this page\./);
  assert.match(tunnelling, /Hostinger/);
  assert.doesNotMatch(tunnelling, /outside service\n-> https:\/\/your-reserved-domain\.ngrok\.app/);
  assert.doesNotMatch(tunnelling, /docker compose up -d ngrok/);

  assert.match(composeGuide, /^# 3a\. Compose Template Reference$/m);
  assert.match(composeGuide, /This page explains the local stack templates; it is not a separate start path\./);
  assert.match(composeGuide, /Do not launch n8n directly from Docker Desktop\. Launch it from `n8n-local\.cmd` instead\./);
  assert.doesNotMatch(composeGuide, /^## Start The Stack$/m);
  assert.doesNotMatch(composeGuide, /^## Daily Use$/m);
});

test('n8n local setup extras include the AI Coding Agent Rules automatic bootstrap note', () => {
  const note =
    '**If the [AI Coding Agent Rules](../../../../skills/ai-coding-agent-rules/) skill is installed, repo-local templates are automatically checked, bootstrapped, repaired, and merged/appended into `AGENTS.md` and equivalent agent instruction files before repo edits.**';

  for (const relPath of [
    '_projects/n8n/local-setup/_main/1. local setup.md',
    '_projects/n8n/local-setup/_main/README.md',
    '_projects/n8n/local-setup/_main/5. extra - claude code integration.md',
    '_projects/n8n/local-setup/_main/6. extra - opencode integration.md',
    '_projects/n8n/local-setup/_main/7. extra - antigravity integration.md'
  ]) {
    const text = readText(repoRoot, relPath);
    assert.match(text, new RegExp(escapeRegExp(note)), relPath);
  }
});

test('n8n local setup docs avoid known install readability regressions', () => {
  const docs = [
    '_projects/n8n/local-setup/curated_output_for_ai/references/ai-agent-platforms/README.md',
    '_projects/n8n/local-setup/curated_output_for_ai/references/ai-agent-platforms/codex.md',
    '_projects/n8n/local-setup/_main/5. extra - claude code integration.md',
    '_projects/n8n/local-setup/_main/6. extra - opencode integration.md',
    '_projects/n8n/local-setup/_main/7. extra - antigravity integration.md'
  ];

  for (const relPath of docs) {
    const text = readText(repoRoot, relPath);
    assert.match(text, /Do not copy only `SKILL\.md`|Copy the whole `skills\/<skill-name>\/` folder/, relPath);
    assert.doesNotMatch(text, /;\s*choose any one/i, relPath);
    assert.doesNotMatch(text, /\.codex-plugin|\.claude-plugin|marketplace\.json|plugin manifest schema/i, relPath);
  }
});

test('generated n8n local setup references use portable primary guide links', () => {
  for (const relPath of [
    'skills/n8n-local-setup/references/n8n/upgrading.md',
    'skills/n8n-local-setup/references/n8n/tunnelling.md',
    'skills/n8n-local-setup/references/n8n/docker-compose-ngrok.md'
  ]) {
    const text = readText(repoRoot, relPath);
    assert.doesNotMatch(text, /\.\/1\.%20local%20setup\.md/, relPath);
    assert.match(text, /\]\(local-setup\.md\)/, relPath);
  }
});

test('generated n8n platform references use portable primary guide links', () => {
  for (const relPath of [
    'skills/n8n-local-setup/references/ai-agent-platforms/claude-code.md',
    'skills/n8n-local-setup/references/ai-agent-platforms/opencode.md',
    'skills/n8n-local-setup/references/ai-agent-platforms/antigravity.md'
  ]) {
    const text = readText(repoRoot, relPath);
    assert.doesNotMatch(text, /\.\/1\.%20local%20setup\.md/, relPath);
    assert.match(text, /\]\(\.\.\/n8n\/local-setup\.md\)/, relPath);
  }
});

test('n8n local setup uses Desktop as the example while allowing any folder', () => {
  const localSetup = readText(repoRoot, '_projects/n8n/local-setup/_main/1. local setup.md');
  const readme = readText(repoRoot, '_projects/n8n/local-setup/_main/README.md');
  const combined = `${localSetup}\n${readme}`;

  assert.match(combined, /Desktop\\n8n-local/);
  assert.match(combined, /\$env:USERPROFILE\\Desktop\\n8n-local/);
  assert.match(combined, /Yes\. The folder can live anywhere you control\./i);
  assert.match(combined, /Open your Desktop\./i);
});

test('n8n local setup commands include beginner run-location guidance', () => {
  const localSetup = readText(repoRoot, '_projects/n8n/local-setup/_main/1. local setup.md');

  for (const expected of [
    'Run this in PowerShell from any folder to create the folder on your Desktop:',
    'Or run this from the toolkit repo root instead:',
    'Replace only the value after `=`',
    'Use the menu first.',
    'Open this URL in your browser'
  ]) {
    assert.match(localSetup, new RegExp(escapeRegExp(expected)), expected);
  }

  assert.doesNotMatch(localSetup, /Run this in PowerShell from the local stack folder/);
  assert.doesNotMatch(localSetup, /Run this in PowerShell from `%USERPROFILE%\\Desktop\\n8n-local`/);
});

test('n8n local setup docs link important local stack and platform files', () => {
  const localSetup = readText(repoRoot, '_projects/n8n/local-setup/_main/1. local setup.md');

  for (const expected of [
    '[docker-compose.yml](./templates/local-stack/docker-compose.yml)',
    '[.env.example](./templates/local-stack/.env.example)',
    '[n8n-local.cmd](./templates/local-stack/n8n-local.cmd)',
    '[n8n-local-menu.ps1](./templates/local-stack/scripts/n8n-local-menu.ps1)',
    '[Codex MCP config](./templates/codex-mcp-config.md)',
    '[Claude MCP config](./templates/claude-mcp-config.md)',
    '[OpenCode MCP config](./templates/opencode-mcp-config.md)',
    '[Antigravity MCP config](./templates/antigravity-mcp-config.md)',
    '[n8n Agent Rules](../../../../skills/n8n-agent-rules/)'
  ]) {
    assert.match(localSetup, new RegExp(escapeRegExp(expected)), expected);
  }
});

test('n8n local setup one-stop guide preserves equivalent working instructions', () => {
  const localSetup = readText(repoRoot, '_projects/n8n/local-setup/_main/1. local setup.md');

  assert.ok(localSetup.length > 12000, 'primary local setup guide should retain full working detail');

  for (const expected of [
    'docker compose up -d postgres n8n',
    'docker compose up -d ngrok',
    'docker compose stop ngrok',
    'docker compose logs -f n8n',
    'docker compose logs -f ngrok',
    'docker compose logs -f postgres',
    'Check for updates',
    'Update selected services',
    'Backup Postgres database',
    'Claude Code Integration appendix',
    'OpenCode Integration appendix',
    'Antigravity Integration appendix',
    'Do not add Redis or workers to the default local setup'
  ]) {
    assert.match(localSetup, new RegExp(escapeRegExp(expected), 'i'), expected);
  }
});

test('n8n local setup compose template uses n8n postgres ngrok without default queue services', () => {
  const compose = readText(repoRoot, '_projects/n8n/local-setup/_main/templates/local-stack/docker-compose.yml');
  assert.match(compose, /^\s{2}postgres:/m);
  assert.match(compose, /^\s{2}n8n:/m);
  assert.match(compose, /^\s{2}ngrok:/m);
  assert.match(compose, /postgres:16-alpine/);
  assert.match(compose, /docker\.n8n\.io\/n8nio\/n8n:stable/);
  assert.match(compose, /ngrok\/ngrok:latest/);
  assert.match(compose, /DB_TYPE: postgresdb/);
  assert.match(compose, /healthcheck:/);
  assert.match(compose, /pg_isready -U \$\$\{POSTGRES_USER\} -d \$\$\{POSTGRES_DB\}/);
  assert.match(compose, /condition: service_healthy/);
  assert.match(compose, /"127\.0\.0\.1:5678:5678"/);
  assert.match(compose, /"127\.0\.0\.1:4040:4040"/);
  assert.match(compose, /^\s{2}postgres_data:/m);
  assert.match(compose, /^\s{2}n8n_data:/m);
  assert.doesNotMatch(compose, /^\s{2}redis:/m);
  assert.doesNotMatch(compose, /^\s{2}n8n-worker:/m);
  assert.doesNotMatch(compose, /EXECUTIONS_MODE:\s*queue/);
});

test('n8n local setup env example stays placeholder-only', () => {
  const envExample = readText(repoRoot, '_projects/n8n/local-setup/_main/templates/local-stack/.env.example');
  for (const expected of [
    'POSTGRES_DB=n8n',
    'POSTGRES_USER=n8n',
    'POSTGRES_PASSWORD=replace-with-local-postgres-password',
    'N8N_ENCRYPTION_KEY=replace-with-long-random-value',
    'N8N_HOST=your-reserved-domain.ngrok.app',
    'N8N_PROTOCOL=https',
    'WEBHOOK_URL=https://your-reserved-domain.ngrok.app/',
    'N8N_PROXY_HOPS=1',
    'NGROK_AUTHTOKEN=replace-with-ngrok-authtoken',
    'NGROK_DOMAIN=your-reserved-domain.ngrok.app'
  ]) {
    assert.match(envExample, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(envExample, /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/);
  assert.doesNotMatch(envExample, /n8n_[A-Za-z0-9_-]{20,}/);
});

test('n8n local setup launcher templates provide guided stack actions', () => {
  const cmd = readText(repoRoot, '_projects/n8n/local-setup/_main/templates/local-stack/n8n-local.cmd');
  const menu = readText(repoRoot, '_projects/n8n/local-setup/_main/templates/local-stack/scripts/n8n-local-menu.ps1');

  assert.match(cmd, /n8n-local-menu\.ps1/);
  assert.match(cmd, /-ExecutionPolicy Bypass/);
  assert.match(cmd, /%~dp0/);
  assert.doesNotMatch(cmd, /NGROK_AUTHTOKEN|POSTGRES_PASSWORD|N8N_ENCRYPTION_KEY/);

  for (const expected of [
    'Write-Header',
    'Write-Info',
    'Write-Success',
    'Write-Warning',
    'Write-ErrorMessage',
    'Pause-Menu',
    'Invoke-Compose',
    'Test-DockerReady',
    'Test-StackFiles',
    'Get-EnvValue',
    'Get-ServiceImageIds',
    'Check-Updates',
    'Apply-Update'
  ]) {
    assert.match(menu, new RegExp(`function ${expected.replace('-', '\\-')}`), expected);
  }

  assert.match(menu, /Clear-Host/);
  assert.match(menu, /Write-Host/);
  assert.match(menu, /ForegroundColor/);
  assert.match(menu, /docker compose up -d/);
  assert.match(menu, /docker compose pull/);
  assert.match(menu, /docker compose up -d --force-recreate/);
  assert.match(menu, /docker compose down/);
  assert.match(menu, /docker compose restart/);
  assert.match(menu, /docker compose ps/);
  assert.match(menu, /docker compose logs -f/);
  assert.match(menu, /docker compose logs -f n8n/);
  assert.match(menu, /docker compose logs -f ngrok/);
  assert.match(menu, /docker compose logs -f postgres/);
  assert.match(menu, /docker image inspect/);
  assert.match(menu, /docker\.n8n\.io\/n8nio\/n8n:stable/);
  assert.match(menu, /ngrok\/ngrok:latest/);
  assert.match(menu, /postgres:16-alpine/);
  assert.doesNotMatch(menu, /docker compose images -q/);
  assert.match(menu, /Start-Process "http:\/\/localhost:5678"/);
  assert.match(menu, /Start-Process "http:\/\/127\.0\.0\.1:4040"/);
  assert.match(menu, /Do not launch n8n directly from Docker Desktop\. Launch it from n8n-local\.cmd instead\./);
  assert.match(menu, /Docker Desktop direct launch bypasses guided checks, selected updates, backups, and clear status output\./);
  assert.match(menu, /pg_dump/);
  assert.match(menu, /POSTGRES_USER/);
  assert.match(menu, /POSTGRES_DB/);
  assert.doesNotMatch(menu, /POSTGRES_PASSWORD\s*=/);
  assert.doesNotMatch(menu, /NGROK_AUTHTOKEN\s*=/);
  assert.doesNotMatch(menu, /N8N_ENCRYPTION_KEY\s*=/);
});

test('n8n copied setup references use portable published baseline template links', () => {
  for (const relPath of [
    'skills/n8n-local-setup/references/n8n/local-setup.md',
    'skills/n8n-local-setup/references/ai-agent-platforms/claude-code.md',
    'skills/n8n-local-setup/references/ai-agent-platforms/opencode.md',
    'skills/n8n-local-setup/references/ai-agent-platforms/antigravity.md'
  ]) {
    const text = readText(repoRoot, relPath);
    assert.doesNotMatch(text, /\/_projects\/development\/ai-coding-agent-rules\/_main\//, relPath);
    assert.doesNotMatch(text, /\.\.\/\.\.\/\.\.\/development\/ai-coding-agent-rules\/_main\//, relPath);
  }

  assert.match(readText(repoRoot, 'skills/n8n-local-setup/references/n8n/local-setup.md'), /\[AI Coding Agent Rules\]\(\.\.\/\.\.\/\.\.\/ai-coding-agent-rules\/\)/);
  assert.match(
    readText(repoRoot, 'skills/n8n-local-setup/references/ai-agent-platforms/codex.md'),
    /\[skills\/ai-coding-agent-rules\/repo-local\/AGENTS\.managed\.template\.md\]\(\.\.\/\.\.\/\.\.\/ai-coding-agent-rules\/repo-local\/AGENTS\.managed\.template\.md\)/
  );
  assert.match(readText(repoRoot, 'skills/n8n-local-setup/references/ai-agent-platforms/claude-code.md'), /\[AI Coding Agent Rules\]\(\.\.\/\.\.\/\.\.\/\.\.\/skills\/ai-coding-agent-rules\/\)/);
  assert.match(readText(repoRoot, 'skills/n8n-local-setup/references/ai-agent-platforms/opencode.md'), /\[AI Coding Agent Rules\]\(\.\.\/\.\.\/\.\.\/\.\.\/skills\/ai-coding-agent-rules\/\)/);
  assert.match(readText(repoRoot, 'skills/n8n-local-setup/references/ai-agent-platforms/antigravity.md'), /\[AI Coding Agent Rules\]\(\.\.\/\.\.\/\.\.\/\.\.\/skills\/ai-coding-agent-rules\/\)/);
});

test('n8n local setup pack-installed references are declared by project recipes', () => {
  const report = auditJson();
  const unresolved = report.issues.packInstalledUndeclared
    .map((entry) => entry.path)
    .filter((entryPath) => entryPath.startsWith('skills/n8n-local-setup/'));
  assert.deepEqual(unresolved, []);
});

test('codex n8n local pack installs inert generic template and n8n-agent-rules assets', () => {
  const pack = JSON.parse(readText(repoRoot, 'skills/n8n-local-setup/packs/codex-n8n-local/pack.json'));
  for (const expectedPath of [
    'skills/n8n-local-setup/references/n8n/1. local setup.md',
    'skills/n8n-local-setup/references/n8n/3. tunneling guide.md',
    'skills/n8n-local-setup/references/n8n/3a. docker compose + ngrok.md',
    'skills/n8n-local-setup/references/n8n/4. vps hosting.md',
    'skills/n8n-local-setup/references/n8n/docker-compose-ngrok.md',
    'skills/n8n-local-setup/references/n8n/templates/codex-mcp-config.md',
    'skills/n8n-local-setup/templates/local-stack/docker-compose.yml',
    'skills/n8n-local-setup/templates/local-stack/.env.example',
    'skills/n8n-local-setup/templates/local-stack/n8n-local.cmd',
    'skills/n8n-local-setup/templates/local-stack/scripts/n8n-local-menu.ps1',
    'skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md',
    'skills/n8n-agent-rules/SKILL.md',
    'skills/n8n-agent-rules/README.md',
    'skills/n8n-agent-rules/n8n-agent-rules.md',
    'skills/n8n-agent-rules/adapters/AGENTS.n8n-brief.template.md',
    'skills/n8n-agent-rules/scripts/install-n8n-agent-adapter.cjs',
    'skills/n8n-local-setup/references/n8n-agent-rules.md',
    'skills/n8n-local-setup/references/n8n/vps-hosting.md'
  ]) {
    assert.ok(pack.installs.includes(expectedPath), expectedPath);
  }
});

test('claude n8n local pack installs inert generic template and n8n-agent-rules assets', () => {
  const pack = JSON.parse(readText(repoRoot, 'skills/n8n-local-setup/packs/claude-code-n8n-local/pack.json'));
  for (const expectedPath of [
    'skills/n8n-local-setup/references/ai-agent-platforms/1. local setup.md',
    'skills/n8n-local-setup/references/ai-agent-platforms/templates/claude-mcp-config.md',
    'skills/n8n-local-setup/templates/local-stack/docker-compose.yml',
    'skills/n8n-local-setup/templates/local-stack/.env.example',
    'skills/n8n-local-setup/templates/local-stack/n8n-local.cmd',
    'skills/n8n-local-setup/templates/local-stack/scripts/n8n-local-menu.ps1',
    'skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md',
    'skills/ai-coding-agent-rules/repo-local/CLAUDE.shim.template.md',
    'skills/n8n-agent-rules/SKILL.md',
    'skills/n8n-agent-rules/README.md',
    'skills/n8n-agent-rules/n8n-agent-rules.md',
    'skills/n8n-agent-rules/adapters/CLAUDE.n8n-brief.template.md',
    'skills/n8n-agent-rules/scripts/install-n8n-agent-adapter.cjs',
    'skills/n8n-local-setup/references/n8n-agent-rules.md'
  ]) {
    assert.ok(pack.installs.includes(expectedPath), expectedPath);
  }
});

test('n8n local setup suspicious published surface findings are resolved', () => {
  const report = auditJson();
  const unresolved = report.issues.suspiciousPublishedSurfaces
    .map((entry) => entry.path)
    .filter((entryPath) => entryPath.startsWith('skills/n8n-local-setup/'));
  assert.deepEqual(unresolved, []);
});

test('changing a preserved n8n local setup source guide makes sync check fail stale', () => {
  const cwd = tempCopy();
  fs.appendFileSync(path.join(cwd, '_projects', 'n8n', 'local-setup', '_main', '2. upgrading.md'), '\nStale output regression fixture.\n', 'utf8');
  const result = spawnSync(process.execPath, [syncScript, '--check'], { cwd, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Stale generated output: skills\/n8n-local-setup\/references\/n8n\/upgrading\.md/);
});

test('published surface baseline check passes after n8n local setup fidelity restoration', () => {
  const result = spawnSync(process.execPath, [auditScript, '--check'], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});
