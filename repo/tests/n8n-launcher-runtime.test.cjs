'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const generatorPath = path.join(repoRoot, 'repo', 'scripts', 'generate-n8n-stack-launcher-flow.cjs');
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
  const candidates = process.platform === 'win32' ? ['powershell.exe', 'pwsh'] : ['pwsh', 'powershell'];
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()'], { encoding: 'utf8' });
    if (!result.error && result.status === 0) return candidate;
  }
  return null;
}

function powerShellSingleQuoted(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

test('launcher handoff model distinguishes success, bounded relaunch, and unexpected failure', () => {
  const probe = [
    `const api = require(${JSON.stringify(generatorPath)});`,
    'const cases = [',
    '  api.decideLauncherAction(0, 0),',
    '  api.decideLauncherAction(api.RELAUNCH_EXIT_CODE, 0),',
    '  api.decideLauncherAction(api.RELAUNCH_EXIT_CODE, api.MAX_RELAUNCHES),',
    '  api.decideLauncherAction(9, 0)',
    '];',
    'process.stdout.write(JSON.stringify(cases));'
  ].join('\n');
  const result = spawnSync(process.execPath, ['-e', probe], { cwd: repoRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(JSON.parse(result.stdout), [
    { action: 'done', nextRelaunchCount: 0 },
    { action: 'relaunch', nextRelaunchCount: 1 },
    { action: 'relaunch-limit', nextRelaunchCount: 1 },
    { action: 'unexpected-failure', nextRelaunchCount: 0 }
  ]);
});

test('both CMD launchers preserve arguments across one intentional relaunch', (t) => {
  if (process.platform !== 'win32') {
    t.skip('CMD launcher integration requires Windows');
    return;
  }

  for (const launcher of launcherCases) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), `toolkit-${launcher.id}-handoff-`));
    try {
      const scriptsDir = path.join(root, 'scripts');
      fs.mkdirSync(scriptsDir, { recursive: true });
      const wrapperPath = path.join(root, path.basename(launcher.wrapper));
      fs.copyFileSync(path.join(repoRoot, launcher.wrapper), wrapperPath);
      const logPath = path.join(root, 'handoff.log');
      const countPath = path.join(root, 'handoff.count');
      fs.writeFileSync(path.join(scriptsDir, launcher.menuName), [
        '$countPath = $env:N8N_LAUNCHER_TEST_COUNT',
        '$count = if (Test-Path -LiteralPath $countPath) { [int](Get-Content -LiteralPath $countPath -Raw) } else { 0 }',
        '$line = "{0}|{1}" -f $env:N8N_LAUNCHER_RELAUNCH_COUNT, ($args -join "|")',
        'Add-Content -LiteralPath $env:N8N_LAUNCHER_TEST_LOG -Value $line -Encoding ascii',
        'Set-Content -LiteralPath $countPath -Value ($count + 1) -Encoding ascii',
        'if ($count -eq 0) { exit 75 }',
        'exit 0',
        ''
      ].join('\r\n'), 'utf8');

      const spacedStackDir = 'C:\\Temp Folder\\n8n stack';
      const result = spawnSync('cmd.exe', ['/d', '/c', wrapperPath, '--alpha', 'beta', '--gamma=delta', '--stack-dir', spacedStackDir], {
        cwd: root,
        env: { ...process.env, N8N_LAUNCHER_TEST_LOG: logPath, N8N_LAUNCHER_TEST_COUNT: countPath },
        input: 'x\r\n',
        encoding: 'utf8',
        timeout: 15000
      });
      assert.equal(result.status, 0, `${launcher.id}\n${result.stdout}\n${result.stderr}`);
      assert.doesNotMatch(result.stdout, /stopped unexpectedly/i, launcher.id);
      const lines = fs.readFileSync(logPath, 'utf8').trim().split(/\r?\n/);
      assert.deepEqual(lines, [
        `0|--alpha|beta|--gamma=delta|--stack-dir|${spacedStackDir}`,
        `1|--alpha|beta|--gamma=delta|--stack-dir|${spacedStackDir}`
      ], launcher.id);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('both PowerShell menus use explicit safe Docker Desktop install approval and relaunch', (t) => {
  const powerShell = findPowerShell();
  if (!powerShell) {
    t.skip('PowerShell is not available in this environment');
    return;
  }

  for (const launcher of launcherCases) {
    const menuPath = path.join(repoRoot, launcher.menu);
    const command = [
      '$ErrorActionPreference = "Stop"',
      `$menu = Get-Content -LiteralPath ${powerShellSingleQuoted(menuPath)} -Raw`,
      '$end = $menu.LastIndexOf("`nInitialize-MenuRuntime")',
      'if ($end -lt 0) { throw "could not find menu pre-loop marker" }',
      '. ([scriptblock]::Create($menu.Substring(0, $end)))',
      '$script:Messages = New-Object System.Collections.Generic.List[string]',
      'function Write-Info { param([string]$Message) $script:Messages.Add($Message) }',
      'function Write-Warning { param([string]$Message) $script:Messages.Add($Message) }',
      'function Write-ErrorMessage { param([string]$Message) $script:Messages.Add($Message) }',
      'function Write-Success { param([string]$Message) $script:Messages.Add($Message) }',
      '$previousTestMode = $env:N8N_LAUNCHER_TEST_MODE',
      '$env:N8N_LAUNCHER_TEST_MODE = "true"',
      'if (-not (Test-DockerInstallBlockedByAutomation)) { throw "actual automation guard ignored test mode" }',
      'if ($null -eq $previousTestMode) { Remove-Item Env:N8N_LAUNCHER_TEST_MODE -ErrorAction SilentlyContinue } else { $env:N8N_LAUNCHER_TEST_MODE = $previousTestMode }',
      'function Test-DockerInstallBlockedByAutomation { return $true }',
      'function Test-WingetCli { return $true }',
      'function global:Read-Host { throw "CI/test guard reached the install prompt" }',
      'function Invoke-NativeCommand { throw "CI/test guard ran an install command" }',
      '$blocked = Invoke-DockerDesktopInstall -RequirementName "Docker CLI"',
      'if ($blocked) { throw "CI/test guard reported install success" }',
      'if (($script:Messages -join "`n") -notmatch "disabled in CI or test execution") { throw "CI/test guard guidance missing" }',
      'function Test-DockerInstallBlockedByAutomation { return $false }',
      'Remove-Item Function:\Read-Host -ErrorAction SilentlyContinue',
      'function Test-WingetCli { return $false }',
      'function Invoke-NativeCommand { throw "install command ran without winget" }',
      '$missingWinget = Invoke-DockerDesktopInstall -RequirementName "Docker CLI"',
      'if ($missingWinget) { throw "missing winget reported install success" }',
      'if (($script:Messages -join "`n") -notmatch "install Docker Desktop manually") { throw "manual install guidance missing" }',
      'function Test-WingetCli { return $true }',
      '$script:InstallCalls = 0',
      'function Invoke-NativeCommand { $script:InstallCalls += 1; return 0 }',
      'function global:Read-Host { param([string]$Prompt) return "n" }',
      '$declined = Invoke-DockerDesktopInstall -RequirementName "Docker CLI"',
      'if ($declined -or $script:InstallCalls -ne 0) { throw "declined install executed winget" }',
      'function global:Read-Host { param([string]$Prompt) return "yes" }',
      '$script:WingetArgs = @()',
      '$script:RelaunchRequested = $false',
      'function global:winget { $script:WingetArgs = @($args); $global:LASTEXITCODE = 0 }',
      'function Invoke-NativeCommand { param([scriptblock]$Command, [switch]$Quiet) & $Command; return $LASTEXITCODE }',
      'function Request-LauncherRelaunch { $script:RelaunchRequested = $true }',
      '[void](Invoke-DockerDesktopInstall -RequirementName "Docker Compose")',
      'if (-not $script:RelaunchRequested) { throw "successful install did not request relaunch" }',
      '$wingetText = $script:WingetArgs -join " "',
      'if ($wingetText -notmatch "install --id Docker.DockerDesktop --exact --source winget --accept-package-agreements --accept-source-agreements") { throw "winget arguments changed: $wingetText" }',
      'Remove-Item Function:\Read-Host -ErrorAction SilentlyContinue',
      'Remove-Item Function:\winget -ErrorAction SilentlyContinue'
    ].join('; ');

    const result = spawnSync(powerShell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 30000
    });
    assert.equal(result.status, 0, `${launcher.id}\n${result.stdout}\n${result.stderr}`);
  }
});

test('both menus block a second Docker install attempt after the controlled relaunch', (t) => {
  const powerShell = findPowerShell();
  if (!powerShell) {
    t.skip('PowerShell is not available in this environment');
    return;
  }

  for (const launcher of launcherCases) {
    const menuPath = path.join(repoRoot, launcher.menu);
    const command = [
      '$ErrorActionPreference = "Stop"',
      `$menu = Get-Content -LiteralPath ${powerShellSingleQuoted(menuPath)} -Raw`,
      '$end = $menu.LastIndexOf("`nInitialize-MenuRuntime")',
      'if ($end -lt 0) { throw "could not find menu pre-loop marker" }',
      '. ([scriptblock]::Create($menu.Substring(0, $end)))',
      '$script:Messages = New-Object System.Collections.Generic.List[string]',
      'function Clear-MenuScreen {}',
      'function Write-Header { param([string]$Message) $script:Messages.Add($Message) }',
      'function Write-Info { param([string]$Message) $script:Messages.Add($Message) }',
      'function Write-Warning { param([string]$Message) $script:Messages.Add($Message) }',
      'function Write-ErrorMessage { param([string]$Message) $script:Messages.Add($Message) }',
      'function Test-MenuFlag { param([string]$Name) return $false }',
      'Remove-Item Env:N8N_LAUNCHER_RELAUNCH_COUNT -ErrorAction SilentlyContinue',
      'if ((Get-LauncherRelaunchCount) -ne 0) { throw "missing relaunch count was not parsed as zero" }',
      '$env:N8N_LAUNCHER_RELAUNCH_COUNT = "0"',
      'if ((Get-LauncherRelaunchCount) -ne 0) { throw "zero relaunch count was not parsed" }',
      'foreach ($malformed in @("-1", "1.0", " 1", "999999999999999999999")) { $env:N8N_LAUNCHER_RELAUNCH_COUNT = $malformed; if ((Get-LauncherRelaunchCount) -ne $script:LauncherMaxRelaunches) { throw "malformed relaunch count weakened bound: $malformed" } }',
      'function global:Read-Host { throw "second launch reached an installation prompt" }',
      'function global:winget { throw "second launch invoked winget" }',
      'function Invoke-DockerDesktopInstall { throw "second launch called the installer" }',
      '$env:N8N_LAUNCHER_RELAUNCH_COUNT = "1"',
      'function Test-DockerCli { return $false }',
      'function Test-DockerComposeCli { throw "Compose check ran without Docker CLI" }',
      'if (Invoke-LaunchPreflight) { throw "second launch with missing Docker CLI passed preflight" }',
      '$guidance = $script:Messages -join "`n"',
      'if ($guidance -notmatch "controlled (launcher )?relaunch|controlled launcher restart") { throw "post-relaunch guidance did not explain the controlled relaunch" }',
      'if ($guidance -notmatch "PATH") { throw "post-relaunch PATH guidance missing" }',
      'if ($guidance -notmatch "sign-out|sign out") { throw "post-relaunch sign-out guidance missing" }',
      'if ($guidance -notmatch "reboot") { throw "post-relaunch reboot guidance missing" }',
      'if ($guidance -notmatch "run this launcher again|rerun the launcher") { throw "post-relaunch rerun guidance missing" }',
      '$script:Messages.Clear()',
      'function Test-DockerCli { return $true }',
      'function Test-DockerComposeCli { return $false }',
      'if (Invoke-LaunchPreflight) { throw "second launch with missing Docker Compose passed preflight" }',
      '$guidance = $script:Messages -join "`n"',
      'if ($guidance -notmatch "PATH" -or $guidance -notmatch "sign-out|sign out" -or $guidance -notmatch "reboot") { throw "missing Compose did not emit post-relaunch recovery guidance" }',
      '$script:Messages.Clear()',
      '$env:N8N_LAUNCHER_RELAUNCH_COUNT = "malformed"',
      'function Test-DockerCli { return $false }',
      'function Test-DockerComposeCli { throw "Compose check ran without Docker CLI" }',
      'if (Invoke-LaunchPreflight) { throw "malformed relaunch count passed preflight" }',
      'if (-not (Test-LauncherRelaunchAlreadyAttempted)) { throw "malformed relaunch count weakened the relaunch bound" }',
      'Remove-Item Env:N8N_LAUNCHER_RELAUNCH_COUNT -ErrorAction SilentlyContinue',
      'Remove-Item Function:\\Read-Host -ErrorAction SilentlyContinue',
      'Remove-Item Function:\\winget -ErrorAction SilentlyContinue'
    ].join('; ');

    const result = spawnSync(powerShell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', command], {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 30000
    });
    assert.equal(result.status, 0, `${launcher.id}\n${result.stdout}\n${result.stderr}`);
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
      'function Write-Info { param([string]$Message) }',
      '$script:Requirement = ""',
      'function Invoke-DockerDesktopInstall { param([string]$RequirementName) $script:Requirement = $RequirementName; return $false }',
      'function Test-DockerCli { return $false }',
      'function Test-DockerComposeCli { throw "Compose check ran without Docker CLI" }',
      'if (Invoke-LaunchPreflight) { throw "missing Docker CLI passed preflight" }',
      'if ($script:Requirement -ne "Docker CLI") { throw "missing Docker CLI did not offer guided install" }',
      'function Test-DockerCli { return $true }',
      'function Test-DockerComposeCli { return $false }',
      '$script:Requirement = ""',
      'if (Invoke-LaunchPreflight) { throw "missing Docker Compose passed preflight" }',
      'if ($script:Requirement -ne "Docker Compose") { throw "missing Compose did not offer repair install" }',
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