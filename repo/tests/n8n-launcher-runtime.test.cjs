'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const dockerWindowsInstallUrl = 'https://docs.docker.com/desktop/setup/install/windows-install/';
const launcherCases = [
  {
    id: 'local',
    wrapper: '_projects/n8n/local-setup/_main/templates/.n8n-local/_n8n-local.cmd',
    menu: '_projects/n8n/local-setup/_main/templates/.n8n-local/scripts/n8n-local-menu.ps1',
    menuName: 'n8n-local-menu.ps1'
  },
  {
    id: 'production-cloudflare',
    wrapper: '_projects/n8n/local-setup/_main/templates/.n8n-production-cloudflare/_n8n-production-cloudflare.cmd',
    menu: '_projects/n8n/local-setup/_main/templates/.n8n-production-cloudflare/scripts/n8n-production-cloudflare-menu.ps1',
    menuName: 'n8n-production-cloudflare-menu.ps1'
  }
];

function findPowerShell() {
  if (process.platform === 'win32') return 'powershell.exe';

  const candidates = ['pwsh', 'powershell'];
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'], {
      encoding: 'utf8',
      timeout: 5000
    });
    if (!result.error && result.status === 0) return candidate;
  }
  return null;
}

function powerShellSingleQuoted(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function writeCmd(filePath, lines) {
  fs.writeFileSync(filePath, `${lines.join('\r\n')}\r\n`, 'utf8');
}

function prepareLauncherFixture(launcher) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `toolkit-${launcher.id}-launcher-`));
  const scriptsDir = path.join(root, 'scripts');
  fs.mkdirSync(scriptsDir, { recursive: true });
  const wrapperPath = path.join(root, path.basename(launcher.wrapper));
  fs.copyFileSync(path.join(repoRoot, launcher.wrapper), wrapperPath);
  fs.copyFileSync(path.join(repoRoot, launcher.menu), path.join(scriptsDir, launcher.menuName));
  return { root, wrapperPath };
}

function removeLauncherFixture(root) {
  fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

function windowsLauncherPath(extraPaths = []) {
  const windowsRoot = process.env.SystemRoot || 'C:\\Windows';
  return [...extraPaths,
    path.join(windowsRoot, 'System32', 'WindowsPowerShell', 'v1.0'),
    path.join(windowsRoot, 'System32')
  ].join(path.delimiter);
}

function launcherEnv(extraPaths = [], overrides = {}) {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name.toLowerCase() === 'path') delete env[name];
  }
  return { ...env, Path: windowsLauncherPath(extraPaths), ...overrides };
}

test('both CMD wrappers remove installer relaunch handling but retain unexpected-failure recovery', () => {
  for (const launcher of launcherCases) {
    const wrapper = fs.readFileSync(path.join(repoRoot, launcher.wrapper), 'utf8').replace(/\r\n/g, '\n');
    assert.match(wrapper, /if "%EXIT_CODE%"=="0" goto done/, launcher.id);
    assert.match(wrapper, /:unexpected_failure[\s\S]*goto run_menu/, launcher.id);
    assert.doesNotMatch(wrapper, /RELAUNCH_EXIT_CODE|MAX_RELAUNCHES|N8N_LAUNCHER_RELAUNCH_COUNT|intentional_relaunch|relaunch_limit|refresh_path/i, launcher.id);
    assert.doesNotMatch(wrapper, /Restarting the launcher|Docker Desktop installation completed/i, launcher.id);
  }
});

test('both menus use official manual Docker guidance without installer, browser, or duplicate prompt code', () => {
  for (const launcher of launcherCases) {
    const source = fs.readFileSync(path.join(repoRoot, launcher.menu), 'utf8').replace(/\r\n/g, '\n');
    const start = source.indexOf('# BEGIN SHARED DOCKER LAUNCH PREFLIGHT');
    const end = source.indexOf('# END SHARED DOCKER LAUNCH PREFLIGHT', start);
    assert.ok(start >= 0 && end > start, launcher.id);
    const preflight = source.slice(start, end);
    assert.ok(preflight.includes(dockerWindowsInstallUrl), launcher.id);
    assert.match(preflight, /Docker CLI was not found/, launcher.id);
    assert.match(preflight, /Docker Desktop, Docker CLI, and Docker Compose/, launcher.id);
    assert.match(preflight, /downloads, Windows requirements, and WSL verification\/setup instructions/, launcher.id);
    assert.match(preflight, /Run this launcher again after Docker Desktop and WSL are working/, launcher.id);
    assert.match(preflight, /Docker CLI exists/, launcher.id);
    assert.match(preflight, /Docker Compose is unavailable/, launcher.id);
    assert.match(preflight, /manually repair or reinstall Docker Desktop/, launcher.id);
    assert.doesNotMatch(preflight, /winget|Invoke-DockerDesktopInstall|Request-LauncherRelaunch|Read-Host/i, launcher.id);
    assert.doesNotMatch(preflight, /Start-Process|Invoke-Item|explorer\.exe|desktop\.docker\.com|docker\.com\/products\/docker-desktop/i, launcher.id);
    assert.doesNotMatch(preflight, /N8N_LAUNCHER_RELAUNCH_COUNT|LauncherRelaunch|controlled launcher relaunch/i, launcher.id);
    assert.match(preflight, /function Wait-ForDockerReady[\s\S]*MaxAttempts = 60[\s\S]*DelaySeconds = 2/, launcher.id);
    assert.match(preflight, /function Start-DockerDesktopAndWait[\s\S]*docker desktop start[\s\S]*Wait-ForDockerReady/, launcher.id);
  }
});

test('Docker CLI missing exits both CMD launchers after one Enter with identical winget and CI behavior', (t) => {
  if (process.platform !== 'win32') {
    t.skip('CMD launcher integration requires Windows');
    return;
  }

  for (const launcher of launcherCases) {
    const outputs = [];
    for (const scenario of ['winget-absent', 'winget-present', 'ci']) {
      const { root, wrapperPath } = prepareLauncherFixture(launcher);
      try {
        const binDir = path.join(root, 'bin');
        fs.mkdirSync(binDir, { recursive: true });
        const wingetMarker = path.join(root, 'winget-called.txt');
        if (scenario === 'winget-present') {
          writeCmd(path.join(binDir, 'winget.cmd'), [
            '@echo off',
            'echo called>>"%N8N_WINGET_MARKER%"',
            'exit /b 91'
          ]);
        }
        const result = spawnSync('cmd.exe', ['/d', '/c', wrapperPath], {
          cwd: root,
          env: launcherEnv([binDir], {
            CI: scenario === 'ci' ? 'true' : '',
            GITHUB_ACTIONS: '',
            TF_BUILD: '',
            BUILD_BUILDID: '',
            N8N_LAUNCHER_TEST_MODE: '',
            N8N_WINGET_MARKER: wingetMarker
          }),
          input: '\r\n',
          encoding: 'utf8',
          timeout: 15000
        });
        assert.equal(result.status, 0, `${launcher.id}/${scenario}\n${result.stdout}\n${result.stderr}`);
        assert.match(result.stdout, /Docker CLI was not found/i, scenario);
        assert.match(result.stdout, /Docker Desktop, Docker CLI, and Docker Compose/i, scenario);
        assert.ok(result.stdout.includes(dockerWindowsInstallUrl), scenario);
        assert.match(result.stdout, /downloads, Windows requirements, and WSL verification\/setup instructions/i, scenario);
        assert.match(result.stdout, /Run this launcher again after Docker Desktop and WSL are working/i, scenario);
        assert.doesNotMatch(result.stdout, /Choose an action:/i, scenario);
        assert.doesNotMatch(result.stdout, /stopped unexpectedly|Restarting the launcher/i, scenario);
        assert.equal((result.stdout.match(/Press Enter/gi) || []).length, 1, `${scenario}: exactly one outer pause`);
        assert.equal(fs.existsSync(wingetMarker), false, `${scenario}: winget was not invoked`);
        outputs.push(result.stdout.replace(/\r/g, ''));
      } finally {
        removeLauncherFixture(root);
      }
    }
    assert.equal(outputs[1], outputs[0], `${launcher.id}: winget presence changed behavior`);
    assert.equal(outputs[2], outputs[0], `${launcher.id}: CI changed behavior`);
  }
});

test('Docker Compose missing exits both CMD launchers after one Enter without opening the menu', (t) => {
  if (process.platform !== 'win32') {
    t.skip('CMD launcher integration requires Windows');
    return;
  }

  for (const launcher of launcherCases) {
    const { root, wrapperPath } = prepareLauncherFixture(launcher);
    try {
      const binDir = path.join(root, 'bin');
      fs.mkdirSync(binDir, { recursive: true });
      const dockerLog = path.join(root, 'docker.log');
      writeCmd(path.join(binDir, 'docker.cmd'), [
        '@echo off',
        'echo %*>>"%N8N_DOCKER_LOG%"',
        'if /i "%1 %2"=="compose version" exit /b 1',
        'exit /b 1'
      ]);
      const result = spawnSync('cmd.exe', ['/d', '/c', wrapperPath], {
        cwd: root,
        env: launcherEnv([binDir], { N8N_DOCKER_LOG: dockerLog }),
        input: '\r\n',
        encoding: 'utf8',
        timeout: 15000
      });
      assert.equal(result.status, 0, `${launcher.id}\n${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /Docker CLI exists/i, launcher.id);
      assert.match(result.stdout, /Docker Compose is unavailable/i, launcher.id);
      assert.match(result.stdout, /manually repair or reinstall Docker Desktop/i, launcher.id);
      assert.ok(result.stdout.includes(dockerWindowsInstallUrl), launcher.id);
      assert.doesNotMatch(result.stdout, /Choose an action:/i, launcher.id);
      assert.equal((result.stdout.match(/Press Enter/gi) || []).length, 1, `${launcher.id}: exactly one outer pause`);
      assert.match(fs.readFileSync(dockerLog, 'utf8'), /^compose version\s*$/m, launcher.id);
    } finally {
      removeLauncherFixture(root);
    }
  }
});

test('Docker ready opens both local and production CMD launcher menus normally', (t) => {
  if (process.platform !== 'win32') {
    t.skip('CMD launcher integration requires Windows');
    return;
  }

  for (const launcher of launcherCases) {
    const { root, wrapperPath } = prepareLauncherFixture(launcher);
    try {
      const binDir = path.join(root, 'bin');
      fs.mkdirSync(binDir, { recursive: true });
      const dockerLog = path.join(root, 'docker.log');
      writeCmd(path.join(binDir, 'docker.cmd'), [
        '@echo off',
        'echo %*>>"%N8N_DOCKER_LOG%"',
        'if /i "%1 %2"=="compose version" exit /b 0',
        'if /i "%1"=="info" exit /b 0',
        'exit /b 0'
      ]);
      const result = spawnSync('cmd.exe', ['/d', '/c', wrapperPath], {
        cwd: root,
        env: launcherEnv([binDir], { N8N_DOCKER_LOG: dockerLog }),
        input: '10\r\n',
        encoding: 'utf8',
        timeout: 15000
      });
      assert.equal(result.status, 0, `${launcher.id}\n${result.stdout}\n${result.stderr}`);
      assert.match(result.stdout, /Choose an action:/i, launcher.id);
      assert.match(result.stdout, /Bye\./i, launcher.id);
      assert.doesNotMatch(result.stdout, /stopped unexpectedly/i, launcher.id);
      const dockerCalls = fs.readFileSync(dockerLog, 'utf8');
      assert.match(dockerCalls, /^compose version\s*$/m, launcher.id);
      assert.match(dockerCalls, /^info\s*$/m, launcher.id);
      assert.doesNotMatch(dockerCalls, /desktop start/i, launcher.id);
    } finally {
      removeLauncherFixture(root);
    }
  }
});
test('both menus fail closed until Docker CLI, Compose, and engine preflight succeed', (t) => {

  const powerShell = findPowerShell();
  if (!powerShell) {
    t.skip('PowerShell is not available in this environment');
    return;
  }

  for (const launcher of launcherCases) {
    const menuPath = path.join(repoRoot, launcher.menu);
    const source = fs.readFileSync(menuPath, 'utf8').replace(/\r\n/g, '\n');
    const initializeIndex = source.lastIndexOf('Initialize-MenuRuntime');
    const loopIndex = source.indexOf('while (-not $script:ExitRequested)', initializeIndex);
    assert.ok(initializeIndex >= 0 && loopIndex > initializeIndex, launcher.id);
    const preLoop = source.slice(initializeIndex, loopIndex);
    assert.match(preLoop, /if \(-not \(Invoke-LaunchPreflight\)\) \{ Pause-Menu; exit 0 \}/, launcher.id);

    const command = [
      '$ErrorActionPreference = "Stop"',
      `$menu = Get-Content -LiteralPath ${powerShellSingleQuoted(menuPath)} -Raw`,
      '$end = $menu.LastIndexOf("`nInitialize-MenuRuntime")',
      'if ($end -lt 0) { throw "could not find menu pre-loop marker" }',
      '. ([scriptblock]::Create($menu.Substring(0, $end)))',
      'function Clear-MenuScreen {}',
      'function Write-Header { param([string]$Message) }',
      '$script:Messages = New-Object System.Collections.Generic.List[string]',
      'function Write-Info { param([string]$Message) $script:Messages.Add($Message) }',
      'function Write-ErrorMessage { param([string]$Message) $script:Messages.Add($Message) }',
      'function global:Read-Host { throw "preflight displayed a duplicate prompt" }',
      'function Test-DockerCli { return $false }',
      'function Test-DockerComposeCli { throw "Compose check ran without Docker CLI" }',
      'if (Invoke-LaunchPreflight) { throw "missing Docker CLI passed preflight" }',
      '$guidance = $script:Messages -join "`n"',
      'if ($guidance -notmatch "Docker CLI was not found" -or $guidance -notmatch "Install or repair Docker Desktop manually") { throw "missing Docker CLI guidance was incomplete" }',
      '$script:Messages.Clear()',
      'function Test-DockerCli { return $true }',
      'function Test-DockerComposeCli { return $false }',
      'if (Invoke-LaunchPreflight) { throw "missing Docker Compose passed preflight" }',
      '$guidance = $script:Messages -join "`n"',
      'if ($guidance -notmatch "Docker CLI exists" -or $guidance -notmatch "manually repair or reinstall Docker Desktop") { throw "missing Docker Compose guidance was incomplete" }',
      'function Test-DockerComposeCli { return $true }',
      'function Invoke-NativeCommand { param([scriptblock]$Command, [switch]$Quiet) return 1 }',
      '$script:StartCalled = $false',
      'function Start-DockerDesktopAndWait { $script:StartCalled = $true; return $true }',
      'if (-not (Invoke-LaunchPreflight)) { throw "recovered Docker engine failed preflight" }',
      'if (-not $script:StartCalled) { throw "stopped Docker engine did not start/wait" }'
    ].join('; ');

    const result = spawnSync(powerShell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 30000
    });
    assert.equal(result.status, 0, `${launcher.id}\n${result.stdout}\n${result.stderr}`);
  }
});

test('production readiness requires a stable streak and reports a redacted bounded timeout', (t) => {
  const powerShell = findPowerShell();
  if (!powerShell) {
    t.skip('PowerShell is not available in this environment');
    return;
  }

  const launcher = launcherCases.find((entry) => entry.id === 'production-cloudflare');
  const menuPath = path.join(repoRoot, launcher.menu);
  const command = [
    '$ErrorActionPreference = "Stop"',
    `$menu = Get-Content -LiteralPath ${powerShellSingleQuoted(menuPath)} -Raw`,
    '$end = $menu.LastIndexOf("`nInitialize-MenuRuntime")',
    'if ($end -lt 0) { throw "could not find menu pre-loop marker" }',
    '. ([scriptblock]::Create($menu.Substring(0, $end)))',
    'function Get-ProductionN8nProbeUrls { return @("http://127.0.0.1:6789") }',
    'function New-MockHttpException { param([int]$StatusCode) $exception = New-Object System.Exception "mock HTTP"; $exception | Add-Member -NotePropertyName Response -NotePropertyValue ([pscustomobject]@{ StatusCode = $StatusCode }) -Force; return $exception }',
    'function Invoke-WebRequest { param($Uri, [switch]$UseBasicParsing, $TimeoutSec) throw (New-MockHttpException -StatusCode 500) }',
    'if (Test-ProductionN8nHttpReady) { throw "HTTP 500 was treated as ready" }',
    'function Invoke-WebRequest { param($Uri, [switch]$UseBasicParsing, $TimeoutSec) throw (New-MockHttpException -StatusCode 401) }',
    'if (-not (Test-ProductionN8nHttpReady)) { throw "responding HTTP 401 endpoint was not treated as reachable" }',
    '$script:Messages = New-Object System.Collections.Generic.List[string]',
    'function Write-Info { param([string]$Message) $script:Messages.Add($Message) }',
    'function Write-Warning { param([string]$Message) $script:Messages.Add($Message) }',
    'function Write-ErrorMessage { param([string]$Message) $script:Messages.Add($Message) }',
    'function Write-Success { param([string]$Message) $script:Messages.Add($Message) }',
    'function Start-Sleep { param([int]$Seconds) }',
    'function Get-LocalN8nUrl { return "http://localhost:6789/" }',
    'function Get-ProductionN8nRecentLogLines { return @("normal recent line", "CLOUDFLARED_TUNNEL_TOKEN=super-secret") }',
    'function Test-ProductionN8nEncryptionKeyMismatchLog { return $false }',
    'function Test-ProductionN8nDatabaseImageMismatchLog { return $false }',
    '$script:Responses = @($true, $false, $true, $true, $true)',
    '$script:ProbeCalls = 0',
    'function Test-ProductionN8nHttpReady { $value = $script:Responses[$script:ProbeCalls]; $script:ProbeCalls += 1; return $value }',
    '$stable = Wait-ForProductionN8nReady -Context "test recovery" -MaxAttempts 6 -RequiredSuccesses 3 -DelaySeconds 0',
    'if (-not $stable -or $script:ProbeCalls -ne 5) { throw "readiness did not require three consecutive successes after a reset" }',
    '$script:Responses = @($false, $false, $false)',
    '$script:ProbeCalls = 0',
    '$script:Messages.Clear()',
    '$timedOut = Wait-ForProductionN8nReady -Context "test timeout" -MaxAttempts 3 -RequiredSuccesses 2 -DelaySeconds 0',
    'if ($timedOut -or $script:ProbeCalls -ne 3) { throw "bounded timeout did not fail honestly" }',
    '$messageText = $script:Messages -join "`n"',
    'if ($messageText -notmatch "Readiness check 1/3") { throw "readiness progress was not displayed" }',
    'if ($messageText -notmatch "Recent n8n logs") { throw "recent log diagnostics were not displayed" }',
    'if ($messageText -match "super-secret") { throw "timeout diagnostics exposed a secret value" }',
    'if ($messageText -notmatch "redacted") { throw "sensitive log line was not visibly redacted" }',
    'if ($messageText -notmatch "View logs") { throw "timeout next action was not displayed" }',
    'if ($messageText -match "tunnel.*healthy") { throw "localhost readiness claimed tunnel health" }',
    '$script:NeedsRepair = $true',
    'function Test-ProductionN8nEncryptionKeyMismatchLog { return $script:NeedsRepair }',
    'function Repair-ProductionN8nConfigEncryptionKey { $script:NeedsRepair = $false; return $true }',
    '$script:ComposeCalls = 0',
    'function Invoke-Compose { param([string[]]$Arguments) $script:ComposeCalls += 1; return 0 }',
    '$script:Responses = @($false, $false, $true, $true)',
    '$script:ProbeCalls = 0',
    '$healed = Wait-ForProductionN8nReady -Context "self-heal test" -AllowSelfHeal -MaxAttempts 2 -RequiredSuccesses 2 -DelaySeconds 0',
    'if (-not $healed -or $script:ProbeCalls -ne 4 -or $script:ComposeCalls -ne 1) { throw "self-heal recreate was not readiness-gated" }'
  ].join('; ');

  const result = spawnSync(powerShell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 30000
  });
  assert.equal(result.status, 0, `${launcher.id}\n${result.stdout}\n${result.stderr}`);
});

test('production n8n recreate actions wait for readiness while stop and down actions do not', (t) => {
  const powerShell = findPowerShell();
  if (!powerShell) {
    t.skip('PowerShell is not available in this environment');
    return;
  }

  const launcher = launcherCases.find((entry) => entry.id === 'production-cloudflare');
  const menuPath = path.join(repoRoot, launcher.menu);
  const command = [
    '$ErrorActionPreference = "Stop"',
    `$menu = Get-Content -LiteralPath ${powerShellSingleQuoted(menuPath)} -Raw`,
    '$end = $menu.LastIndexOf("`nInitialize-MenuRuntime")',
    'if ($end -lt 0) { throw "could not find menu pre-loop marker" }',
    '. ([scriptblock]::Create($menu.Substring(0, $end)))',
    'function Write-Header { param([string]$Message) }',
    'function Write-Info { param([string]$Message) }',
    'function Write-Warning { param([string]$Message) }',
    'function Write-ErrorMessage { param([string]$Message) }',
    'function Write-Success { param([string]$Message) }',
    'function Invoke-BasePreflight { return $true }',
    'function Invoke-SafetyPreflight { return $true }',
    'function Test-DockerReady { return $true }',
    'function Read-EnvFile { return @{ N8N_LOCAL_PORT = "6789" } }',
    'function Get-LocalN8nUrl { return "http://localhost:6789/" }',
    'function Get-CloudflareN8nUrl { return "https://n8n.example.test" }',
    'function Get-EnvValue { return "n8n.example.test" }',
    'function Set-ActiveN8nUrl { return $true }',
    'function Backup-N8nProductionNow { return $true }',
    '$script:N8nRunning = $true',
    'function Get-RunningServices { if ($script:N8nRunning) { return @("n8n") }; return @() }',
    '$script:ComposeCalls = New-Object System.Collections.Generic.List[string]',
    'function Invoke-Compose { param([string[]]$Arguments) $script:ComposeCalls.Add(($Arguments -join " ")); return 0 }',
    '$script:WaitContexts = New-Object System.Collections.Generic.List[string]',
    'function Wait-ForProductionN8nReady { param([string]$Context, [switch]$AllowSelfHeal) $script:WaitContexts.Add($Context); return $true }',
    'function Reset-Probe { $script:WaitContexts.Clear(); $script:ComposeCalls.Clear() }',
    'Reset-Probe',
    'Start-ProductionStack',
    'if ($script:WaitContexts.Count -ne 1) { throw "initial production start did not wait" }',
    'Reset-Probe',
    'Restart-N8n',
    'if ($script:WaitContexts.Count -ne 1) { throw "n8n restart did not wait" }',
    'Reset-Probe',
    'Start-CloudflareTunnel',
    'if ($script:WaitContexts.Count -ne 1) { throw "full production recreate did not wait" }',
    'Reset-Probe',
    '$script:N8nRunning = $true',
    'Stop-CloudflareTunnel',
    'if ($script:WaitContexts.Count -ne 1) { throw "Cloudflare stop n8n recreate did not wait" }',
    'Reset-Probe',
    'function global:Read-Host { param([string]$Prompt) return "2" }',
    'Show-UpdateMenu',
    'if ($script:WaitContexts.Count -ne 1) { throw "n8n image update/recreate did not wait" }',
    'Reset-Probe',
    'Restore-PreviousProductionServices -PreviousServices @("n8n")',
    'if ($script:WaitContexts.Count -ne 1) { throw "localhost restore restart did not wait" }',
    'Reset-Probe',
    'Restore-PreviousProductionServices -PreviousServices @("cloudflared")',
    'if ($script:WaitContexts.Count -ne 1) { throw "Cloudflare restore restart did not wait" }',
    'Reset-Probe',
    'Restore-PreviousProductionServices -PreviousServices @() -StartN8nWhenNone',
    'if ($script:WaitContexts.Count -ne 1) { throw "restore fallback start did not wait" }',
    'Reset-Probe',
    'Stop-ProductionStack',
    'if ($script:WaitContexts.Count -ne 0) { throw "intentional down waited for recovery" }',
    'Reset-Probe',
    '$script:N8nRunning = $false',
    'Stop-CloudflareTunnel',
    'if ($script:WaitContexts.Count -ne 0) { throw "Cloudflare-only stop waited without n8n recreation" }',
    'Reset-Probe',
    'function global:Read-Host { param([string]$Prompt) return "3" }',
    'Show-UpdateMenu',
    'if ($script:WaitContexts.Count -ne 0) { throw "postgres-only update waited for n8n recovery" }',
    'Remove-Item Function:\Read-Host -ErrorAction SilentlyContinue'
  ].join('; ');

  const result = spawnSync(powerShell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 30000
  });
  assert.equal(result.status, 0, `${launcher.id}\n${result.stdout}\n${result.stderr}`);
});