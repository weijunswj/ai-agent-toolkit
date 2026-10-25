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
const realTools = ['bash', 'sh', 'awk', 'sed', 'grep', 'date', 'mktemp', 'cat', 'head', 'tail', 'sort', 'find', 'cp', 'mv',
  'rm', 'mkdir', 'rmdir', 'chmod', 'tr', 'paste', 'hostname', 'curl', 'dirname', 'wc', 'flock', 'touch', 'ls', 'install',
  'uname', 'env', 'cut'];
const nowSec = () => Math.floor(Date.now() / 1000);

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
  linkRealTools(tools, o.noCurl ? ['curl'] : []);
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
    SENDMAIL: path.join(host.dir, 'no-sendmail'),
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

// M3: host states. Each row is one fake host, optionally with an earlier pulse already recorded,
// and the state the pulse must give it. `prior` returns state lines; `runs` repeats the pulse.
const fresh = (extra = []) => (now) => [`last_pulse_epoch=${now - 600}`, 'boot_id=boot-a', ...extra];
const failURL = (rx) => ({ HEARTBEAT_FAIL_URL: `${rx.base}/hb-fail/${SECRET_BEAT}` });
const pinged = (rx) => beats(rx).map((r) => r.url.split('/')[1]);
const stateMatrix = [
  // Row 1: healthy.
  { name: 'all signals low, pulse fresh', expect: 'NORMAL', report: [/Alerting \| NORMAL \| Channels: webhook \|/] },
  // Row 2: sustained pressure or growth over the review threshold.
  { name: 'memory over the review threshold', host: { memAvailKb: 800000 }, expect: 'REVIEW_CAPACITY' },
  { name: 'load over the review threshold for one pulse only', host: { load15: '1.80' }, prior: fresh(), expect: 'NORMAL',
    report: [/CPU load \| NORMAL \| .*over the review threshold for 1 of 2 pulses in a row/] },
  { name: 'load over the review threshold for two pulses in a row', host: { load15: '1.80' }, prior: fresh(['load_over_review=1']),
    expect: 'REVIEW_CAPACITY', report: [/CPU load \| REVIEW_CAPACITY \| .*for 2 of 2 pulses/] },
  { name: 'disk growing fast while under the review threshold', host: { diskPct: 50 }, prior: fresh(['disk_pct__=40']),
    expect: 'REVIEW_CAPACITY', report: [/Disk \/ \| REVIEW_CAPACITY \| 50% used .*grew 10 points since the last pulse/] },
  { name: 'disk growing slowly', host: { diskPct: 42 }, prior: fresh(['disk_pct__=40']), expect: 'NORMAL' },
  // Row 3: over the upgrade threshold, or repeated out-of-memory kills or restarts.
  { name: 'disk over the upgrade threshold', host: { diskPct: 90 }, expect: 'UPGRADE_OR_REBALANCE_REQUIRED' },
  { name: 'swap over the upgrade threshold', host: { swapFreeKb: 400000 }, expect: 'UPGRADE_OR_REBALANCE_REQUIRED' },
  { name: 'repeated out-of-memory kills within one boot', host: { oom: 6 }, prior: fresh(['oom_kill=3']),
    expect: 'UPGRADE_OR_REBALANCE_REQUIRED', report: [/Out-of-memory kills \| UPGRADE_OR_REBALANCE_REQUIRED \| 3 new since the last pulse/] },
  { name: 'one out-of-memory kill', host: { oom: 4 }, prior: fresh(['oom_kill=3']), expect: 'REVIEW_CAPACITY' },
  { name: 'a new boot starts the out-of-memory count again', host: { oom: 1, bootId: 'boot-b' }, prior: fresh(['oom_kill=9']),
    expect: 'REVIEW_CAPACITY', report: [/Rebooted since the last pulse/, /## Notices/] },
  { name: 'repeated container restarts', host: { restarts: 5 }, prior: fresh(['docker_restarts=1']), expect: 'UPGRADE_OR_REBALANCE_REQUIRED' },
  // Row 4: host reserve breached now, alert at once and on every run while it lasts.
  { name: 'disk reserve breached now', host: { diskPct: 97 }, runs: 2, expect: 'EMERGENCY_PRESSURE',
    check: ({ rx }) => { assert.equal(hooks(rx).length, 2); assert.match(JSON.parse(hooks(rx)[1].body).text, /Disk \/: EMERGENCY_PRESSURE/); } },
  { name: 'memory reserve breached now', host: { memAvailKb: 100000 }, expect: 'EMERGENCY_PRESSURE', check: ({ rx }) => assert.equal(hooks(rx).length, 1) },
  { name: 'inodes reserve breached now', host: { inodePct: 99 }, expect: 'EMERGENCY_PRESSURE' },
  { name: 'emergency load counts on the first pulse', host: { load15: '7.00' }, expect: 'EMERGENCY_PRESSURE' },
  // Row 5: pulse older than 60 minutes, or a collector failed; never NORMAL.
  { name: 'pulse exactly 60 minutes old', prior: (now) => [`last_pulse_epoch=${now - 3630}`, 'boot_id=boot-a'], env: failURL, expect: 'NORMAL',
    report: [/Pulse continuity \| NORMAL \| 60 minutes since the last pulse/], check: ({ rx }) => assert.deepEqual(pinged(rx), ['hb']) },
  { name: 'pulse 61 minutes old', prior: (now) => [`last_pulse_epoch=${now - 3660}`, 'boot_id=boot-a'], env: failURL, expect: 'OBSERVABILITY_DEGRADED',
    report: [/Pulse continuity \| OBSERVABILITY_DEGRADED \| Gap of 61 minutes .*limit 60/], check: ({ rx }) => assert.deepEqual(pinged(rx), ['hb-fail']) },
  { name: 'docker present but failing', host: { docker: 'fail' }, expect: 'OBSERVABILITY_DEGRADED' },
  { name: 'invalid threshold setting', env: { DISK_REVIEW_PCT: 'eighty' }, expect: 'OBSERVABILITY_DEGRADED',
    report: [/Settings \| OBSERVABILITY_DEGRADED \| DISK_REVIEW_PCT is not a whole number/] },
  { name: 'curl missing is named, and health URLs are not marked failing', host: { noCurl: true },
    env: (rx) => ({ HEALTHCHECK_URLS: `${rx.base}/up` }), expect: 'OBSERVABILITY_DEGRADED',
    report: [/Health URLs \| OBSERVABILITY_DEGRADED \| Not checked: curl is not installed/, /Off-host heartbeat \| OBSERVABILITY_DEGRADED \| Ping not sent: curl is not installed/,
      /Alerting \| OBSERVABILITY_DEGRADED \| Not set up: webhook chosen but curl is not installed/, /^Services: OK$/m],
    check: ({ rx, report }) => { assert.equal(rx.requests.length, 0); assert.doesNotMatch(report, /FAILING/); } },
  // Row 6: Docker absent or systemd absent: those rows not applicable, other rows still classified.
  { name: 'docker absent, disk over the upgrade threshold', host: { docker: 'absent', diskPct: 90 }, expect: 'UPGRADE_OR_REBALANCE_REQUIRED',
    report: [/Docker containers \| N\/A \| Not applicable: Docker is not installed/, /Container restarts \| NORMAL \| Not applicable/, /systemd units \| OK/] },
  { name: 'systemd absent, memory over the review threshold', host: { systemd: false, memAvailKb: 800000 }, expect: 'REVIEW_CAPACITY',
    report: [/systemd units \| N\/A \| Not applicable: systemd is not running/, /Docker containers \| OK/] },
  { name: 'kernel without an oom counter, swap over the upgrade threshold', host: { oom: null, swapFreeKb: 400000 }, expect: 'UPGRADE_OR_REBALANCE_REQUIRED',
    report: [/Out-of-memory kills \| NORMAL \| Not applicable: this kernel has no oom_kill counter/] },
  // Row 7: alert transport fails: the report keeps it, it is never marked sent, and the pulse is degraded.
  { name: 'alert transport fails', responses: { '/hook': 500 }, env: failURL, expect: 'OBSERVABILITY_DEGRADED',
    report: [/Alert delivery \| OBSERVABILITY_DEGRADED \| Failed \(webhook=failed\)/, /## Alert delivery\n\nFAILED \(webhook=failed\); the next pulse retries/],
    check: ({ host, rx }) => { assert.equal(readState(host).alert_pending, '1'); assert.equal(readState(host).last_sent_signature, ''); assert.deepEqual(pinged(rx), ['hb-fail']); } },
  { name: 'unsupported webhook format', env: { ALERT_WEBHOOK_FORMAT: 'xml' }, expect: 'OBSERVABILITY_DEGRADED',
    report: [/Alerting \| OBSERVABILITY_DEGRADED \| Not set up: unknown ALERT_WEBHOOK_FORMAT xml/], check: ({ rx }) => assert.equal(hooks(rx).length, 0) },
  { name: 'plain http webhook to another host', env: { ALERT_WEBHOOK_URL: `http://alerts.example.com/hook/${SECRET_HOOK}` }, expect: 'OBSERVABILITY_DEGRADED',
    report: [/Not set up: ALERT_WEBHOOK_URL must be an https URL/] },
  // Row 8: no alert channel chosen: reports kept locally, alerting degraded, never NORMAL.
  { name: 'no alert channel chosen', env: { ALERT_CHANNELS: '' }, expect: 'OBSERVABILITY_DEGRADED',
    report: [/Alerting \| OBSERVABILITY_DEGRADED \| Not set up: no alert channel chosen/, /not attempted: no alert channel set up/],
    check: ({ rx }) => assert.equal(hooks(rx).length, 0) },
  { name: 'alert channel set to none', env: { ALERT_CHANNELS: 'none' }, expect: 'OBSERVABILITY_DEGRADED', report: [/Not set up: alert channel set to none/] },
  { name: 'telegram chosen without its settings', env: { ALERT_CHANNELS: 'telegram' }, expect: 'OBSERVABILITY_DEGRADED', report: [/TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is empty/] },
  { name: 'email chosen with no mailer on the host', env: { ALERT_CHANNELS: 'email', ALERT_EMAIL_TO: 'owner' }, expect: 'OBSERVABILITY_DEGRADED',
    report: [/email chosen but neither mail nor sendmail is installed/] },
  { name: 'unknown alert channel', env: { ALERT_CHANNELS: 'pigeon' }, expect: 'OBSERVABILITY_DEGRADED', report: [/unknown alert channel pigeon/] },
  { name: 'no off-host heartbeat', env: { HEARTBEAT_URL: '' }, expect: 'OBSERVABILITY_DEGRADED', report: [/Off-host heartbeat \| OBSERVABILITY_DEGRADED \| Not set up/] }
];

for (const row of stateMatrix) {
  test(`pulse state matrix: ${row.name} gives ${row.expect}`, { skip }, async (t) => {
    const host = makeHost(t, row.host);
    const rx = await receiver(t, { ...row.responses });
    if (row.prior) writeState(host, row.prior(nowSec()));
    const env = alertEnv(rx, typeof row.env === 'function' ? row.env(rx) : row.env);
    const results = [];
    for (let i = 0; i < (row.runs || 1); i += 1) results.push(await run(pulseScript, [], host, env));
    const last = results[results.length - 1];
    assert.equal(last.code, 0, last.stderr);
    const report = latestReport(host);
    assert.equal(stateLine(last.stdout), row.expect, last.stdout + report);
    assert.match(report, new RegExp(`^State: ${row.expect}$`, 'm'));
    assert.equal(readState(host).last_state, row.expect);
    for (const pattern of row.report || []) assert.match(report, pattern);
    if (row.check) row.check({ host, rx, results, report });
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

// --status at the stale limit: just under, at and just over 60 minutes.
for (const [ageSeconds, expect] of [[59 * 60, 'NORMAL'], [3630, 'NORMAL'], [3660, 'OBSERVABILITY_DEGRADED'], [3 * 3600, 'OBSERVABILITY_DEGRADED']]) {
  test(`--status with a pulse ${ageSeconds} seconds old gives ${expect}`, { skip }, async (t) => {
    const host = makeHost(t);
    writeState(host, [`last_pulse_epoch=${nowSec() - ageSeconds}`, 'last_state=NORMAL', 'last_services=OK', 'boot_id=boot-a']);
    const status = await run(pulseScript, ['--status'], host);
    assert.equal(status.code, 0);
    assert.match(status.stdout, new RegExp(`^State: ${expect}$`, 'm'));
    if (expect !== 'NORMAL') assert.match(status.stdout, new RegExp(`${Math.floor(ageSeconds / 60)} minutes old \\(limit 60\\)`));
  });
}

test('--status with no pulse recorded is degraded', { skip }, async (t) => {
  const host = makeHost(t);
  const status = await run(pulseScript, ['--status'], host);
  assert.equal(status.code, 0);
  assert.match(status.stdout, /^State: OBSERVABILITY_DEGRADED\nReason: no pulse has been recorded/m);
});

test('--status says when it needs root to read the state folder', { skip: skip || (process.getuid && process.getuid() === 0 ? 'root reads any folder' : false) }, async (t) => {
  const host = makeHost(t);
  writeState(host, [`last_pulse_epoch=${nowSec()}`, 'last_state=NORMAL', 'last_services=OK']);
  fs.chmodSync(path.join(host.root, 'state'), 0o000);
  let status;
  try {
    status = await run(pulseScript, ['--status'], host);
  } finally {
    fs.chmodSync(path.join(host.root, 'state'), 0o700);
  }
  assert.equal(status.code, 1);
  assert.match(status.stdout, /^State: UNKNOWN\nReason: this user cannot read .*; run --status as root/m);
});

test('a failed alert delivery retries on the next pulse, and --status shows it meanwhile', { skip }, async (t) => {
  const host = makeHost(t);
  const rx = await receiver(t, { '/hook': 500 });
  const failed = await run(pulseScript, [], host, alertEnv(rx));
  assert.match(failed.stdout, /Alert: FAILED \(webhook=failed\); the next pulse retries/);
  const status = await run(pulseScript, ['--status'], host);
  assert.match(status.stdout, /^State: OBSERVABILITY_DEGRADED$/m);
  assert.match(status.stdout, /Alert delivery: the last alert failed to send/);
  rx.set('/hook', 200);
  const retried = await run(pulseScript, [], host, alertEnv(rx));
  assert.match(retried.stdout, /Alert: sent \(webhook=sent\)/);
  assert.equal(stateLine(retried.stdout), 'NORMAL');
  assert.equal(readState(host).alert_pending, '0');
  assert.equal(readState(host).last_sent_signature, 'NORMAL|OK');
  const after = await run(pulseScript, ['--status'], host);
  assert.doesNotMatch(after.stdout, /Alert delivery/);
});

test('failing services alert without changing the capacity state', { skip }, async (t) => {
  const host = makeHost(t, {
    dockerPs: ['web|running|Up 1 hour (unhealthy)', 'db|restarting|Restarting (1) 5 seconds ago', 'worker|exited|Exited (137) 2 hours ago',
      'migrate|exited|Exited (0) 3 hours ago', 'cron-job|exited|Exited (1) 1 hour ago'].join('\n'),
    failedUnits: 'backup.service loaded failed failed Backup\n'
  });
  const rx = await receiver(t);
  const result = await run(pulseScript, [], host, alertEnv(rx, { DOCKER_EXITED_OK_CONTAINERS: 'cron-job other' }));
  assert.equal(stateLine(result.stdout), 'NORMAL');
  assert.match(result.stdout, /^Services: FAILING \(2\)$/m);
  assert.match(latestReport(host), /Failing: web \(unhealthy\), db \(restarting\), worker \(exited with code 137\) \|/);
  assert.match(latestReport(host), /1 failed: backup\.service/);
  assert.match(JSON.parse(hooks(rx)[0].body).subject, /services FAILING \(2\)/);
  assert.equal(readState(host).last_sent_signature, 'NORMAL|FAILING (2)|systemd:backup.service;docker:web,db,worker');
});

test('a different service failing with the same count alerts again', { skip }, async (t) => {
  const host = makeHost(t, { failedUnits: 'backup.service loaded failed failed Backup\n' });
  const rx = await receiver(t);
  await run(pulseScript, [], host, alertEnv(rx));
  await run(pulseScript, [], host, alertEnv(rx));
  assert.equal(hooks(rx).length, 1, 'the same failure alerts once');
  fs.writeFileSync(path.join(host.dir, 'failed-units.txt'), 'certbot.service loaded failed failed Renew\n');
  await run(pulseScript, [], host, alertEnv(rx));
  assert.equal(hooks(rx).length, 2);
  assert.match(JSON.parse(hooks(rx)[1].body).text, /certbot\.service/);
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
  const plainBeat = await run(pulseScript, ['--test-heartbeat'], host, { HEARTBEAT_URL: 'http://beats.example.com/ping' });
  assert.equal(plainBeat.code, 1);
  assert.match(plainBeat.stdout, /must be https/);
});

test('test commands name a missing curl', { skip }, async (t) => {
  const host = makeHost(t, { noCurl: true });
  const rx = await receiver(t);
  const alert = await run(pulseScript, ['--test-alert'], host, alertEnv(rx));
  assert.equal(alert.code, 1);
  assert.match(alert.stdout, /Alerting not set up: webhook chosen but curl is not installed/);
  const beat = await run(pulseScript, ['--test-heartbeat'], host, alertEnv(rx));
  assert.equal(beat.code, 1);
  assert.match(beat.stdout, /Heartbeat ping: failed \(curl is not installed\)/);
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
function installerHost(t, uid, options = {}) {
  const dir = tempDir(t, 'host-obs-install-');
  const stub = path.join(dir, 'stub');
  const tools = path.join(dir, 'tools');
  linkRealTools(tools, options.uname ? ['uname'] : []);
  writeExec(path.join(stub, 'id'), `echo ${uid}`);
  if (options.uname) writeExec(path.join(stub, 'uname'), `echo ${options.uname}`);
  if (options.systemctl !== false) {
    writeExec(path.join(stub, 'systemctl'), [
      `echo "$*" >> "${dir}/systemctl.log"`,
      `[ -n "\${FAIL_SYSTEMCTL:-}" ] && [ "$1" = "$FAIL_SYSTEMCTL" ] && exit 1`,
      'exit 0'
    ].join('\n'));
  }
  const env = {
    PATH: `${stub}:${tools}`,
    HOME: dir,
    INSTALL_PREFIX: path.join(dir, 'prefix'),
    CONFIG_DIR: path.join(dir, 'etc'),
    HOST_PULSE_ROOT: path.join(dir, 'var'),
    SYSTEMD_UNIT_DIR: path.join(dir, 'units'),
    SYSTEMD_RUN_DIR: path.join(dir, 'run-systemd')
  };
  fs.mkdirSync(env.SYSTEMD_UNIT_DIR);
  if (options.systemdRunning !== false) fs.mkdirSync(env.SYSTEMD_RUN_DIR);
  return { dir, tools, env };
}

function runInstaller(host, args, extra = {}) {
  return spawnSync(path.join(host.tools, 'bash'), [installScript, ...args], { encoding: 'utf8', env: { ...host.env, ...extra } });
}

function assertNothingInstalled(host) {
  assert.deepEqual(fs.readdirSync(host.env.SYSTEMD_UNIT_DIR), []);
  for (const key of ['INSTALL_PREFIX', 'CONFIG_DIR', 'HOST_PULSE_ROOT']) assert.equal(fs.existsSync(host.env[key]), false, key);
}

test('installer prints its plan and changes nothing without --install', { skip }, (t) => {
  const host = installerHost(t, 0);
  const result = runInstaller(host, []);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^Plan \(nothing has been changed\):/);
  assert.match(result.stdout, /runs as root with no capabilities/);
  assert.match(result.stdout, /Run again with --install/);
  assertNothingInstalled(host);
  assert.equal(fs.existsSync(path.join(host.dir, 'systemctl.log')), false);
});

for (const [name, options] of [
  ['systemd is not running', { systemdRunning: false }],
  ['systemctl is missing', { systemctl: false }],
  ['the host is not Linux', { uname: 'Darwin' }]
]) {
  test(`installer refuses the plan and the install when ${name}, and changes nothing`, { skip }, (t) => {
    const host = installerHost(t, 0, options);
    for (const args of [[], ['--install']]) {
      const result = runInstaller(host, args);
      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stderr, /systemd is not running on this host; nothing was changed/);
      assert.doesNotMatch(result.stdout, /Start host-pulse\.timer/);
      assertNothingInstalled(host);
    }
  });
}

test('installer refuses to install without root', { skip }, (t) => {
  const host = installerHost(t, 1000);
  const result = runInstaller(host, ['--install']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Run as root on the target host/);
  assertNothingInstalled(host);
});

test('installer writes a hardened hourly timer, keeps one backup, and removes cleanly', { skip }, (t) => {
  const host = installerHost(t, 0);
  const first = runInstaller(host, ['--install']);
  assert.equal(first.status, 0, first.stderr);
  const units = host.env.SYSTEMD_UNIT_DIR;
  const unitNames = ['host-pulse-test-alert.service', 'host-pulse-test-heartbeat.service', 'host-pulse.service', 'host-pulse.timer'];
  assert.deepEqual(fs.readdirSync(units).sort(), unitNames);
  const pulseService = fs.readFileSync(path.join(units, 'host-pulse.service'), 'utf8');
  assert.match(pulseService, new RegExp(`^ExecStart=${host.env.INSTALL_PREFIX}/host-pulse\\.sh$`, 'm'));
  assert.match(pulseService, new RegExp(`^EnvironmentFile=-${host.env.CONFIG_DIR}/host-pulse\\.env$`, 'm'));
  assert.match(pulseService, new RegExp(`^ReadWritePaths=${host.env.HOST_PULSE_ROOT}$`, 'm'));
  assert.match(pulseService, /^# Root for the Docker socket/m);
  for (const line of ['NoNewPrivileges=yes', 'CapabilityBoundingSet=', 'AmbientCapabilities=', 'PrivateTmp=yes', 'PrivateDevices=yes',
    'ProtectSystem=strict', 'ProtectHome=read-only', 'ProtectKernelTunables=yes', 'ProtectKernelModules=yes', 'ProtectControlGroups=yes',
    'RestrictSUIDSGID=yes', 'RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6', 'UMask=0077']) {
    assert.match(pulseService, new RegExp(`^${line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'), line);
  }
  assert.doesNotMatch(pulseService, /^User=|^ProtectSystem=full/m);
  for (const name of ['alert', 'heartbeat']) {
    const testUnit = fs.readFileSync(path.join(units, `host-pulse-test-${name}.service`), 'utf8');
    assert.match(testUnit, new RegExp(`^ExecStart=${host.env.INSTALL_PREFIX}/host-pulse\\.sh --test-${name}$`, 'm'));
    assert.equal(testUnit.split('\n[Service]\n')[1], pulseService.split('\n[Service]\n')[1].replace(/host-pulse\.sh$/m, `host-pulse.sh --test-${name}`), 'test runs share the sandbox');
    assert.doesNotMatch(testUnit, /^\[Install\]/m, 'test units are never enabled');
  }
  const timer = fs.readFileSync(path.join(units, 'host-pulse.timer'), 'utf8');
  assert.match(timer, /^OnCalendar=hourly$/m);
  assert.match(timer, /^AccuracySec=1s$/m);
  const envFile = path.join(host.env.CONFIG_DIR, 'host-pulse.env');
  assert.equal(fs.statSync(envFile).mode & 0o777, 0o600);
  for (const file of ['host-pulse.sh', 'lib/host-observability-common.sh']) assert.ok(fs.existsSync(path.join(host.env.INSTALL_PREFIX, file)), file);
  assert.match(fs.readFileSync(path.join(host.dir, 'systemctl.log'), 'utf8'), /enable --now host-pulse\.timer/);

  fs.writeFileSync(envFile, 'ALERT_CHANNELS=webhook\n');
  fs.chmodSync(envFile, 0o644);
  for (let i = 0; i < 2; i += 1) {
    const again = runInstaller(host, ['--install']);
    assert.equal(again.status, 0, again.stderr);
  }
  assert.equal(fs.readFileSync(envFile, 'utf8'), 'ALERT_CHANNELS=webhook\n', 'an existing env file is never overwritten');
  assert.equal(fs.statSync(envFile).mode & 0o777, 0o600, 'an existing env file is tightened to mode 600');
  assert.deepEqual(fs.readdirSync(units).sort(), unitNames, 'no backups pile up beside the units');
  const backups = path.join(host.env.CONFIG_DIR, 'backup');
  assert.deepEqual(fs.readdirSync(backups), ['previous']);
  assert.deepEqual(fs.readdirSync(path.join(backups, 'previous')).sort(), ['host-observability-common.sh', 'host-pulse.sh', ...unitNames].sort());

  const removed = runInstaller(host, ['--remove']);
  assert.equal(removed.status, 0, removed.stderr);
  assert.deepEqual(fs.readdirSync(units), []);
  assert.ok(!fs.existsSync(host.env.INSTALL_PREFIX));
  assert.ok(!fs.existsSync(backups));
  assert.ok(fs.existsSync(envFile), 'remove keeps the env file');
  assert.match(removed.stdout, /For a full removal, also delete .*host-pulse\.env/);
  assert.match(removed.stdout, /pause or delete that check too/);
});

test('a failed install puts back the previous files and removes the new ones', { skip }, (t) => {
  const host = installerHost(t, 0);
  const fresh = runInstaller(host, ['--install'], { FAIL_SYSTEMCTL: 'enable' });
  assert.equal(fresh.status, 1);
  assert.match(fresh.stderr, /Install failed; putting back what was there before/);
  assert.deepEqual(fs.readdirSync(host.env.SYSTEMD_UNIT_DIR), []);
  assert.ok(!fs.existsSync(host.env.INSTALL_PREFIX));
  assert.ok(!fs.existsSync(path.join(host.env.CONFIG_DIR, 'host-pulse.env')), 'an env file created by the failed run is removed');

  assert.equal(runInstaller(host, ['--install']).status, 0);
  const service = path.join(host.env.SYSTEMD_UNIT_DIR, 'host-pulse.service');
  fs.writeFileSync(service, 'previous unit\n');
  const envFile = path.join(host.env.CONFIG_DIR, 'host-pulse.env');
  fs.writeFileSync(envFile, 'ALERT_CHANNELS=webhook\n');
  const failed = runInstaller(host, ['--install'], { FAIL_SYSTEMCTL: 'daemon-reload' });
  assert.equal(failed.status, 1);
  assert.equal(fs.readFileSync(service, 'utf8'), 'previous unit\n');
  assert.equal(fs.readFileSync(envFile, 'utf8'), 'ALERT_CHANNELS=webhook\n', 'an env file the run did not create is kept');
  assert.ok(fs.existsSync(path.join(host.env.INSTALL_PREFIX, 'host-pulse.sh')));
  assert.ok(!fs.existsSync(path.join(host.env.CONFIG_DIR, 'backup', 'rollback')));
});

test('--remove carries on when systemctl is missing', { skip }, (t) => {
  const host = installerHost(t, 0);
  assert.equal(runInstaller(host, ['--install']).status, 0);
  fs.rmSync(path.join(host.dir, 'stub', 'systemctl'));
  const removed = runInstaller(host, ['--remove']);
  assert.equal(removed.status, 0, removed.stderr);
  assert.match(removed.stdout, /systemctl not found; removing the files only/);
  assert.deepEqual(fs.readdirSync(host.env.SYSTEMD_UNIT_DIR), []);
  assert.ok(!fs.existsSync(host.env.INSTALL_PREFIX));
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
