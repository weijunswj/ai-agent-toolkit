'use strict';

// The host-observability scripts run against fake /proc files, fake df, docker and systemctl
// commands, and a local fake alert and heartbeat receiver. Each case gets its own temp folder and a
// PATH that holds only the stubs and the basic tools the scripts need, so a real Docker or systemd on
// the test machine never leaks in. The scripts target Linux servers, so the cases skip on Windows.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const skillDir = path.join(repoRoot, 'skills', 'host-observability');
const pulseScript = path.join(skillDir, 'scripts', 'host-pulse.sh');
const installScript = path.join(skillDir, 'scripts', 'install-host-observability-systemd.sh');
const skip = process.platform === 'win32' ? 'host scripts target Linux servers' : false;
const realTools = ['bash', 'sh', 'awk', 'sed', 'grep', 'date', 'mktemp', 'cat', 'head', 'tail', 'sort', 'find', 'stat', 'cp', 'mv',
  'rm', 'mkdir', 'rmdir', 'chmod', 'tr', 'paste', 'xargs', 'hostname', 'curl', 'cksum', 'basename', 'dirname', 'wc', 'flock',
  'timeout', 'touch', 'ls', 'install', 'uname', 'env', 'cut'];

const SECRET_HOOK = 'hooksecretvalue0123456789';
const SECRET_BEAT = 'beatsecretuuid0123456789';
const SECRET_BOT = 'botsecrettoken0123456789';

function tempDir(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeExec(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `#!/usr/bin/env bash\n${body}\n`);
  fs.chmodSync(file, 0o755);
}

function linkRealTools(binDir, exclude = []) {
  fs.mkdirSync(binDir, { recursive: true });
  for (const tool of realTools) {
    if (exclude.includes(tool)) continue;
    const found = spawnSync('bash', ['-c', `command -v ${tool}`], { encoding: 'utf8', env: { PATH: '/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin' } });
    const target = found.stdout.trim();
    if (found.status === 0 && target.startsWith('/')) fs.symlinkSync(target, path.join(binDir, tool));
  }
}

// One fake host: /proc files, stubs and a state folder. Options override the healthy defaults.
function makeHost(t, options = {}) {
  const dir = tempDir(t, 'host-obs-');
  const proc = path.join(dir, 'proc');
  const stub = path.join(dir, 'stub');
  const tools = path.join(dir, 'tools');
  fs.mkdirSync(path.join(proc, 'sys', 'kernel', 'random'), { recursive: true });
  const o = {
    memTotalKb: 4000000, memAvailKb: 3000000, swapTotalKb: 1000000, swapFreeKb: 1000000, load15: '0.40', cpus: 2,
    oom: 0, uptime: 7200, bootId: 'boot-a', diskPct: 40, inodePct: 10, docker: 'ok', dockerPs: 'web|running|Up 2 hours (healthy)',
    restarts: 0, systemd: true, failedUnits: '', ...options
  };
  fs.writeFileSync(path.join(proc, 'meminfo'), `MemTotal: ${o.memTotalKb} kB\nMemFree: 100 kB\nMemAvailable: ${o.memAvailKb} kB\nSwapTotal: ${o.swapTotalKb} kB\nSwapFree: ${o.swapFreeKb} kB\n`);
  fs.writeFileSync(path.join(proc, 'loadavg'), `0.10 0.20 ${o.load15} 1/100 12345\n`);
  fs.writeFileSync(path.join(proc, 'cpuinfo'), Array.from({ length: o.cpus }, (_, i) => `processor\t: ${i}\n`).join('\n'));
  fs.writeFileSync(path.join(proc, 'vmstat'), o.oom === null ? 'pgfault 1\n' : `pgfault 1\noom_kill ${o.oom}\n`);
  fs.writeFileSync(path.join(proc, 'uptime'), `${o.uptime}.00 100.00\n`);
  fs.writeFileSync(path.join(proc, 'sys', 'kernel', 'random', 'boot_id'), `${o.bootId}\n`);
  linkRealTools(tools);
  writeExec(path.join(stub, 'df'), `case " $* " in *" -Pi "*) printf 'Filesystem Inodes IUsed IFree IUse%% Mounted\\nfake 100 10 90 ${o.inodePct}%% /\\n' ;; *) printf 'Filesystem 1024-blocks Used Available Capacity Mounted\\nfake 100 40 60 ${o.diskPct}%% /\\n' ;; esac`);
  writeExec(path.join(stub, 'nproc'), `echo ${o.cpus}`);
  if (o.docker !== 'absent') {
    fs.writeFileSync(path.join(dir, 'docker-ps.txt'), `${o.dockerPs}\n`);
    writeExec(path.join(stub, 'docker'), [
      `[ "${o.docker}" = fail ] && exit 1`,
      'case "$1 $2" in',
      `  "ps -a") if [ "$3" = "--format" ]; then cat "${dir}/docker-ps.txt"; else echo abc123; fi ;;`,
      '  "ps -aq") echo abc123 ;;',
      `  inspect*) echo ${o.restarts} ;;`,
      `  version*) echo "${o.dockerVersion || '27.3.1'}" ;;`,
      'esac'
    ].join('\n'));
  }
  const systemdDir = path.join(dir, 'run-systemd');
  if (o.systemd) fs.mkdirSync(systemdDir);
  fs.writeFileSync(path.join(dir, 'failed-units.txt'), o.failedUnits);
  writeExec(path.join(stub, 'systemctl'), [
    'case "$1" in',
    `  list-units) cat "${dir}/failed-units.txt" ;;`,
    '  *) exit 0 ;;',
    'esac'
  ].join('\n'));
  const root = path.join(dir, 'root');
  return { dir, proc, stub, tools, root, systemdDir, stateFile: path.join(root, 'state', 'pulse.state') };
}

function writeState(host, lines, name = 'pulse.state') {
  fs.mkdirSync(path.join(host.root, 'state'), { recursive: true });
  fs.writeFileSync(path.join(host.root, 'state', name), lines.join('\n') + '\n');
}

function readState(host, name = 'pulse.state') {
  const text = fs.readFileSync(path.join(host.root, 'state', name), 'utf8');
  return Object.fromEntries(text.trim().split('\n').map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
}

function run(script, args, host, env = {}) {
  const fullEnv = {
    PATH: `${host.stub}:${host.tools}`,
    HOME: host.dir,
    LANG: 'C',
    TMPDIR: host.dir,
    HOST_LABEL: 'test-host',
    HOST_PULSE_ROOT: host.root,
    PROC_ROOT: host.proc,
    SYSTEMD_RUN_DIR: host.systemdDir,
    ...env
  };
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(host.tools, 'bash'), [script, ...args], { env: fullEnv });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

// A fake receiver for alerts and heartbeat pings. responses maps a path prefix to a status code.
async function receiver(t, responses = {}) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      requests.push({ method: req.method, url: req.url, headers: req.headers, body });
      const match = Object.keys(responses).find((prefix) => req.url.startsWith(prefix));
      res.statusCode = match ? responses[match] : 200;
      res.end('ok');
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, requests, set: (prefix, code) => { responses[prefix] = code; } };
}

function alertEnv(rx, extra = {}) {
  return {
    ALERT_CHANNELS: 'webhook',
    ALERT_WEBHOOK_URL: `${rx.base}/hook/${SECRET_HOOK}`,
    ALERT_WEBHOOK_FORMAT: 'json',
    HEARTBEAT_URL: `${rx.base}/hb/${SECRET_BEAT}`,
    ...extra
  };
}

const hooks = (rx) => rx.requests.filter((r) => r.url.startsWith('/hook'));
const beats = (rx) => rx.requests.filter((r) => r.url.startsWith('/hb'));
const stateLine = (stdout) => (stdout.match(/^State: (\S+)/m) || [])[1];
const latestReport = (host) => fs.readFileSync(path.join(host.root, 'reports', 'latest-pulse.md'), 'utf8');

// M3: host states. Each row is one fake host and the state the pulse must give it.
const stateMatrix = [
  { name: 'all signals low, pulse fresh', host: {}, expect: 'NORMAL' },
  { name: 'memory over the review threshold', host: { memAvailKb: 800000 }, expect: 'REVIEW_CAPACITY' },
  { name: 'load over the review threshold', host: { load15: '1.80' }, expect: 'REVIEW_CAPACITY' },
  { name: 'disk over the upgrade threshold', host: { diskPct: 90 }, expect: 'UPGRADE_OR_REBALANCE_REQUIRED' },
  { name: 'swap over the upgrade threshold', host: { swapFreeKb: 400000 }, expect: 'UPGRADE_OR_REBALANCE_REQUIRED' },
  { name: 'disk reserve breached now', host: { diskPct: 97 }, expect: 'EMERGENCY_PRESSURE' },
  { name: 'memory reserve breached now', host: { memAvailKb: 100000 }, expect: 'EMERGENCY_PRESSURE' },
  { name: 'inodes reserve breached now', host: { inodePct: 99 }, expect: 'EMERGENCY_PRESSURE' },
  { name: 'docker present but failing', host: { docker: 'fail' }, expect: 'OBSERVABILITY_DEGRADED' },
  { name: 'docker and systemd absent', host: { docker: 'absent', systemd: false }, expect: 'NORMAL' },
  { name: 'kernel without an oom counter', host: { oom: null }, expect: 'NORMAL' },
  { name: 'invalid threshold setting', host: {}, env: { DISK_REVIEW_PCT: 'eighty' }, expect: 'OBSERVABILITY_DEGRADED' }
];

for (const row of stateMatrix) {
  test(`pulse state matrix: ${row.name} gives ${row.expect}`, { skip }, async (t) => {
    const host = makeHost(t, row.host);
    const rx = await receiver(t);
    const result = await run(pulseScript, [], host, alertEnv(rx, row.env));
    assert.equal(result.code, 0, result.stderr);
    assert.equal(stateLine(result.stdout), row.expect, result.stdout + latestReport(host));
    assert.match(latestReport(host), new RegExp(`^State: ${row.expect}$`, 'm'));
    if (row.host.docker === 'absent') assert.match(latestReport(host), /Docker containers \| N\/A \| Not applicable: Docker is not installed/);
    if (row.host.systemd === false) assert.match(latestReport(host), /systemd units \| N\/A \| Not applicable/);
  });
}

test('a first pulse alerts once, pings the heartbeat, and a repeat with no change stays quiet', { skip }, async (t) => {
  const host = makeHost(t);
  const rx = await receiver(t);
  const first = await run(pulseScript, [], host, alertEnv(rx));
  assert.equal(stateLine(first.stdout), 'NORMAL', first.stdout);
  assert.equal(hooks(rx).length, 1);
  const payload = JSON.parse(hooks(rx)[0].body);
  assert.equal(payload.source, 'host-observability');
  assert.equal(payload.host, 'test-host');
  assert.match(payload.subject, /NORMAL/);
  assert.equal(beats(rx).length, 1);
  const second = await run(pulseScript, [], host, alertEnv(rx));
  assert.match(second.stdout, /Alert: not needed/);
  assert.equal(hooks(rx).length, 1);
  assert.equal(beats(rx).length, 2, 'the heartbeat is pinged on every run');
});

test('emergency pressure alerts at once and on every run while it lasts', { skip }, async (t) => {
  const host = makeHost(t, { diskPct: 97 });
  const rx = await receiver(t);
  await run(pulseScript, [], host, alertEnv(rx));
  await run(pulseScript, [], host, alertEnv(rx));
  assert.equal(hooks(rx).length, 2);
  assert.match(JSON.parse(hooks(rx)[1].body).text, /Disk \/: EMERGENCY_PRESSURE/);
});

test('repeated out-of-memory kills within one boot need an upgrade; a new boot starts the count again', { skip }, async (t) => {
  const host = makeHost(t, { oom: 6 });
  const rx = await receiver(t);
  writeState(host, ['last_pulse_epoch=' + Math.floor(Date.now() / 1000), 'boot_id=boot-a', 'oom_kill=3']);
  const same = await run(pulseScript, [], host, alertEnv(rx));
  assert.equal(stateLine(same.stdout), 'UPGRADE_OR_REBALANCE_REQUIRED', same.stdout);
  assert.match(latestReport(host), /Out-of-memory kills \| UPGRADE_OR_REBALANCE_REQUIRED \| 3 new since the last pulse/);

  const rebooted = makeHost(t, { oom: 1, bootId: 'boot-b' });
  writeState(rebooted, ['last_pulse_epoch=' + Math.floor(Date.now() / 1000), 'boot_id=boot-a', 'oom_kill=9']);
  const after = await run(pulseScript, [], rebooted, alertEnv(rx));
  assert.equal(stateLine(after.stdout), 'REVIEW_CAPACITY', after.stdout);
  assert.match(latestReport(rebooted), /Rebooted since the last pulse/);
  assert.match(latestReport(rebooted), /## Notices/);
});

test('repeated container restarts need an upgrade', { skip }, async (t) => {
  const host = makeHost(t, { restarts: 5 });
  const rx = await receiver(t);
  writeState(host, ['last_pulse_epoch=' + Math.floor(Date.now() / 1000), 'boot_id=boot-a', 'docker_restarts=1']);
  const result = await run(pulseScript, [], host, alertEnv(rx));
  assert.equal(stateLine(result.stdout), 'UPGRADE_OR_REBALANCE_REQUIRED', result.stdout);
});

test('a pulse gap is degraded, uses the failure heartbeat URL, and --status never calls an old pulse fine', { skip }, async (t) => {
  const host = makeHost(t);
  const rx = await receiver(t);
  const threeHoursAgo = Math.floor(Date.now() / 1000) - 3 * 3600;
  writeState(host, [`last_pulse_epoch=${threeHoursAgo}`, 'last_state=NORMAL', 'last_services=OK', 'boot_id=boot-a']);
  const status = await run(pulseScript, ['--status'], host);
  assert.match(status.stdout, /^State: OBSERVABILITY_DEGRADED$/m);
  assert.match(status.stdout, /180 minutes old/);
  const result = await run(pulseScript, [], host, alertEnv(rx, { HEARTBEAT_FAIL_URL: `${rx.base}/hb-fail/${SECRET_BEAT}` }));
  assert.equal(stateLine(result.stdout), 'OBSERVABILITY_DEGRADED', result.stdout);
  assert.match(latestReport(host), /Pulse continuity \| OBSERVABILITY_DEGRADED \| Gap of 180 minutes/);
  assert.deepEqual(beats(rx).map((r) => r.url.split('/')[1]), ['hb-fail']);
  const fresh = await run(pulseScript, ['--status'], host);
  assert.match(fresh.stdout, /^State: OBSERVABILITY_DEGRADED$/m);
  assert.match(fresh.stdout, /Last pulse: 0 minutes ago/);
});

test('--status with no pulse recorded is degraded', { skip }, async (t) => {
  const host = makeHost(t);
  const status = await run(pulseScript, ['--status'], host);
  assert.equal(status.code, 0);
  assert.match(status.stdout, /^State: OBSERVABILITY_DEGRADED\nReason: no pulse has been recorded/m);
});

test('a failed alert delivery stays in the report, is never marked sent, and the next pulse retries', { skip }, async (t) => {
  const host = makeHost(t);
  const rx = await receiver(t, { '/hook': 500 });
  const failed = await run(pulseScript, [], host, alertEnv(rx));
  assert.match(failed.stdout, /Alert: FAILED \(webhook=failed\); the next pulse retries/);
  assert.match(latestReport(host), /## Alert delivery\n\nFAILED/);
  assert.equal(readState(host).alert_pending, '1');
  assert.equal(readState(host).last_sent_signature, '');
  rx.set('/hook', 200);
  const retried = await run(pulseScript, [], host, alertEnv(rx));
  assert.match(retried.stdout, /Alert: sent \(webhook=sent\)/);
  assert.equal(readState(host).alert_pending, '0');
  assert.equal(readState(host).last_sent_signature, 'NORMAL|OK');
});

test('no alert channel or no heartbeat keeps reports local and is degraded, never NORMAL', { skip }, async (t) => {
  const host = makeHost(t);
  const rx = await receiver(t);
  const noChannel = await run(pulseScript, [], host, { HEARTBEAT_URL: `${rx.base}/hb/x` });
  assert.equal(stateLine(noChannel.stdout), 'OBSERVABILITY_DEGRADED');
  assert.match(noChannel.stdout, /Alert: not attempted: no alert channel set up/);
  assert.match(latestReport(host), /Alerting \| OBSERVABILITY_DEGRADED \| Not set up: no alert channel chosen/);
  for (const channels of ['none', 'telegram', 'pigeon']) {
    const result = await run(pulseScript, ['--dry-run'], host, { ALERT_CHANNELS: channels, HEARTBEAT_URL: `${rx.base}/hb/x` });
    assert.match(result.stdout, /^State: OBSERVABILITY_DEGRADED$/m, channels);
  }
  const noBeat = await run(pulseScript, [], makeHost(t), { ...alertEnv(rx), HEARTBEAT_URL: '' });
  assert.equal(stateLine(noBeat.stdout), 'OBSERVABILITY_DEGRADED');
});

test('failing services alert without changing the capacity state', { skip }, async (t) => {
  const host = makeHost(t, { dockerPs: 'web|running|Up 1 hour (unhealthy)\ndb|restarting|Restarting (1)', failedUnits: 'backup.service loaded failed failed Backup\n' });
  const rx = await receiver(t);
  const result = await run(pulseScript, [], host, alertEnv(rx));
  assert.equal(stateLine(result.stdout), 'NORMAL');
  assert.match(result.stdout, /^Services: FAILING \(2\)$/m);
  assert.match(latestReport(host), /Unhealthy or restarting: web,db/);
  assert.match(latestReport(host), /1 failed: backup\.service/);
  assert.match(JSON.parse(hooks(rx)[0].body).subject, /services FAILING \(2\)/);
});

test('health URLs: a plain URL is checked and a secret-looking one is skipped and redacted', { skip }, async (t) => {
  const host = makeHost(t);
  const rx = await receiver(t, { '/down': 503 });
  const env = alertEnv(rx, { HEALTHCHECK_URLS: `${rx.base}/up ${rx.base}/down ${rx.base}/x?token=${SECRET_HOOK}` });
  const result = await run(pulseScript, [], host, env);
  const report = latestReport(host);
  assert.match(report, /Health http:\/\/127\.0\.0\.1:\d+\/up \| OK \| HTTP 200/);
  assert.match(report, /Health http:\/\/127\.0\.0\.1:\d+\/down \| FAILING \| HTTP 503/);
  assert.match(report, /token=<redacted> \| OBSERVABILITY_DEGRADED \| Skipped/);
  assert.ok(!rx.requests.some((r) => r.url.startsWith('/x')), 'the secret-looking URL is never requested');
  assert.equal(stateLine(result.stdout), 'OBSERVABILITY_DEGRADED');
});

test('secrets never reach reports, state, output or alert bodies', { skip }, async (t) => {
  const host = makeHost(t, { diskPct: 97 });
  const rx = await receiver(t);
  const env = alertEnv(rx, { TELEGRAM_BOT_TOKEN: SECRET_BOT, TELEGRAM_CHAT_ID: '42', HEARTBEAT_FAIL_URL: `${rx.base}/hb-fail/${SECRET_BEAT}` });
  const results = [await run(pulseScript, [], host, env), await run(pulseScript, ['--dry-run'], host, env), await run(pulseScript, ['--status'], host, env)];
  const files = [];
  const walk = (dir) => { for (const entry of fs.readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) walk(full); else files.push(fs.readFileSync(full, 'utf8')); } };
  walk(host.root);
  const haystack = [...files, ...results.map((r) => r.stdout + r.stderr), ...hooks(rx).map((r) => r.body)].join('\n');
  for (const secret of [SECRET_HOOK, SECRET_BEAT, SECRET_BOT]) assert.ok(!haystack.includes(secret), `${secret} leaked`);
  assert.ok(hooks(rx).length >= 1);
  const leftovers = fs.readdirSync(path.join(host.root, 'state')).filter((name) => name.startsWith('.curl') || name.startsWith('.payload'));
  assert.deepEqual(leftovers, [], 'private curl configs and payloads are removed');
});

test('a dry run writes nothing and sends nothing', { skip }, async (t) => {
  const host = makeHost(t);
  const rx = await receiver(t);
  const result = await run(pulseScript, ['--dry-run'], host, alertEnv(rx));
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /Dry run: no report file, heartbeat, alert or state change\./);
  assert.equal(fs.existsSync(host.root), false);
  assert.equal(rx.requests.length, 0);
});

test('test alerts use the chosen webhook format', { skip }, async (t) => {
  const host = makeHost(t);
  const rx = await receiver(t);
  for (const [format, check] of [
    ['slack', (r) => assert.match(JSON.parse(r.body).text, /test alert/)],
    ['discord', (r) => assert.match(JSON.parse(r.body).content, /test alert/)],
    ['ntfy', (r) => { assert.match(r.headers.title, /test alert/); assert.match(r.body, /If you can read this/); }],
    ['text', (r) => assert.match(r.headers['content-type'], /text\/plain/)]
  ]) {
    const before = hooks(rx).length;
    const result = await run(pulseScript, ['--test-alert'], host, alertEnv(rx, { ALERT_WEBHOOK_FORMAT: format }));
    assert.equal(result.code, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /Test alert: webhook=sent/);
    check(hooks(rx)[before]);
  }
  const beat = await run(pulseScript, ['--test-heartbeat'], host, alertEnv(rx));
  assert.match(beat.stdout, /Heartbeat ping: sent/);
  const unset = await run(pulseScript, ['--test-alert'], host, {});
  assert.equal(unset.code, 1);
  assert.match(unset.stdout, /Alerting not set up: no alert channel chosen/);
});

test('reports stay bounded: old pulse reports are pruned to REPORT_KEEP', { skip }, async (t) => {
  const host = makeHost(t);
  const rx = await receiver(t);
  fs.mkdirSync(path.join(host.root, 'reports'), { recursive: true });
  for (let i = 0; i < 5; i += 1) fs.writeFileSync(path.join(host.root, 'reports', `pulse-2020010${i}T000000Z.md`), 'old');
  fs.writeFileSync(path.join(host.root, 'reports', 'keep-me.txt'), 'not a pulse report');
  await run(pulseScript, [], host, alertEnv(rx, { REPORT_KEEP: '2' }));
  const names = fs.readdirSync(path.join(host.root, 'reports')).sort();
  assert.equal(names.filter((n) => /^pulse-.*\.md$/.test(n)).length, 2);
  assert.ok(names.includes('keep-me.txt'));
  assert.ok(names.includes('latest-pulse.md'));
});

// Installer.
function installerHost(t, uid) {
  const dir = tempDir(t, 'host-obs-install-');
  const stub = path.join(dir, 'stub');
  const tools = path.join(dir, 'tools');
  linkRealTools(tools);
  writeExec(path.join(stub, 'id'), `echo ${uid}`);
  writeExec(path.join(stub, 'systemctl'), `echo "$*" >> "${dir}/systemctl.log"`);
  const env = {
    PATH: `${stub}:${tools}`,
    HOME: dir,
    INSTALL_PREFIX: path.join(dir, 'prefix'),
    CONFIG_DIR: path.join(dir, 'etc'),
    HOST_PULSE_ROOT: path.join(dir, 'var'),
    SYSTEMD_UNIT_DIR: path.join(dir, 'units')
  };
  fs.mkdirSync(env.SYSTEMD_UNIT_DIR);
  return { dir, tools, env };
}

function runInstaller(host, args, extra = {}) {
  return spawnSync(path.join(host.tools, 'bash'), [installScript, ...args], { encoding: 'utf8', env: { ...host.env, ...extra } });
}

test('installer prints its plan and changes nothing without --install', { skip }, (t) => {
  const host = installerHost(t, 0);
  const result = runInstaller(host, []);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Plan \(nothing has been changed\):/);
  assert.match(result.stdout, /Run again with --install/);
  assert.deepEqual(fs.readdirSync(host.env.SYSTEMD_UNIT_DIR), []);
  for (const key of ['INSTALL_PREFIX', 'CONFIG_DIR', 'HOST_PULSE_ROOT']) assert.equal(fs.existsSync(host.env[key]), false, key);
  assert.equal(fs.existsSync(path.join(host.dir, 'systemctl.log')), false);
});

test('installer refuses to install without root', { skip }, (t) => {
  const host = installerHost(t, 1000);
  const result = runInstaller(host, ['--install']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Run as root on the target host/);
  assert.deepEqual(fs.readdirSync(host.env.SYSTEMD_UNIT_DIR), []);
});

test('installer installs the hourly timer, keeps an existing env file, backs up units, and removes cleanly', { skip }, (t) => {
  const host = installerHost(t, 0);
  const first = runInstaller(host, ['--install']);
  assert.equal(first.status, 0, first.stderr);
  const units = host.env.SYSTEMD_UNIT_DIR;
  const pulseService = fs.readFileSync(path.join(units, 'host-pulse.service'), 'utf8');
  assert.match(pulseService, new RegExp(`ExecStart=${host.env.INSTALL_PREFIX}/host-pulse\\.sh`));
  assert.match(pulseService, new RegExp(`EnvironmentFile=-${host.env.CONFIG_DIR}/host-pulse\\.env`));
  assert.match(pulseService, /NoNewPrivileges=yes/);
  assert.match(fs.readFileSync(path.join(units, 'host-pulse.timer'), 'utf8'), /OnCalendar=hourly/);
  assert.deepEqual(fs.readdirSync(units).sort(), ['host-pulse.service', 'host-pulse.timer']);
  const envFile = path.join(host.env.CONFIG_DIR, 'host-pulse.env');
  assert.equal(fs.statSync(envFile).mode & 0o777, 0o600);
  for (const file of ['host-pulse.sh', 'lib/host-observability-common.sh']) assert.ok(fs.existsSync(path.join(host.env.INSTALL_PREFIX, file)), file);
  assert.match(fs.readFileSync(path.join(host.dir, 'systemctl.log'), 'utf8'), /enable --now host-pulse\.timer/);

  fs.writeFileSync(envFile, 'ALERT_CHANNELS=webhook\n');
  const second = runInstaller(host, ['--install']);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(fs.readFileSync(envFile, 'utf8'), 'ALERT_CHANNELS=webhook\n', 'an existing env file is never overwritten');
  assert.ok(fs.readdirSync(units).some((name) => name.startsWith('host-pulse.service.bak.')));

  const removed = runInstaller(host, ['--remove']);
  assert.equal(removed.status, 0, removed.stderr);
  assert.ok(!fs.existsSync(path.join(units, 'host-pulse.service')));
  assert.ok(!fs.existsSync(path.join(host.env.INSTALL_PREFIX, 'host-pulse.sh')));
  assert.ok(fs.existsSync(envFile), 'remove keeps the env file');
  assert.match(removed.stdout, /pause or delete that check too/);
});

// Static safety checks.
test('the env template holds placeholders only, every value commented out', () => {
  const text = fs.readFileSync(path.join(skillDir, 'templates', 'host-pulse.env.example'), 'utf8');
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    assert.match(line, /^#/, `uncommented line in the template: ${line}`);
  }
  assert.doesNotMatch(text, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, 'no email addresses');
  assert.match(text, /no channel is chosen by default/i);
  for (const line of text.split('\n').filter((l) => /^# [A-Z_]+=/.test(l))) assert.doesNotMatch(line, /=\S*\s+#/, `systemd reads no comment after a value: ${line}`);
});

test('the pulse contains no command that changes the host', () => {
  for (const file of [pulseScript, path.join(skillDir, 'scripts', 'lib', 'host-observability-common.sh')]) {
    // Comments and plain message strings are dropped; strings holding a command substitution stay.
    const code = fs.readFileSync(file, 'utf8').split('\n').filter((line) => !/^\s*#/.test(line)).join('\n')
      .replace(/"(?:[^"\\\n]|\\.)*"|'[^'\n]*'/g, (literal) => (literal.includes('$(') ? literal : '""'));
    assert.doesNotMatch(code, /\bapt-get\s+(install|upgrade|update|dist-upgrade|remove|purge)\b/, file);
    assert.doesNotMatch(code, /\bsystemctl\s+(start|stop|restart|enable|disable|reload|daemon-reload)\b/, file);
    assert.doesNotMatch(code, /\bdocker\s+(rm|stop|start|restart|kill|pull|run|update|system\s+prune)\b/, file);
    assert.doesNotMatch(code, /(^|[;&|(]\s*|\$\(\s*|then\s+|else\s+)(sudo\s+)?(reboot|shutdown|ufw|iptables|kill|pkill|rm\s+-rf\s+\/)\b/m, file);
  }
});

test('the skill asks the owner for alert and heartbeat choices and names no default channel', () => {
  const skill = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
  const options = fs.readFileSync(path.join(skillDir, 'references', 'alert-options.md'), 'utf8');
  assert.match(skill, /No channel is a default/);
  assert.match(options, /Toolkit picks no alert channel and no heartbeat service/);
  for (const option of ['Slack', 'Discord', 'ntfy', 'Telegram', 'Email', 'dead-man']) assert.match(options, new RegExp(option, 'i'), option);
  assert.ok(Buffer.byteLength(skill) < 6144, 'SKILL.md stays under 6 KB');
});
