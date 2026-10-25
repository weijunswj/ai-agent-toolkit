'use strict';

// The host-observability scripts run against fake /proc files, fake df, docker, systemctl and apt
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
const watchScript = path.join(skillDir, 'scripts', 'update-watch.sh');
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
    `  is-enabled) echo "${o.unattendedEnabled || 'enabled'}" ;;`,
    `  is-active) echo "${o.unattendedActive || 'active'}" ;;`,
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

// Update watch.
function makeAptHost(t, options = {}) {
  const host = makeHost(t, options);
  const apt = path.join(host.dir, 'apt');
  fs.mkdirSync(path.join(apt, 'periodic'), { recursive: true });
  fs.writeFileSync(path.join(apt, 'periodic', 'update-success-stamp'), '');
  if (options.indexAgeDays) {
    const when = new Date(Date.now() - options.indexAgeDays * 86400000);
    fs.utimesSync(path.join(apt, 'periodic', 'update-success-stamp'), when, when);
  }
  fs.writeFileSync(path.join(host.dir, 'apt-sim.txt'), options.aptSim ?? '');
  writeExec(path.join(host.stub, 'apt-get'), `case " $* " in *" -s "*) cat "${host.dir}/apt-sim.txt" ;; *) echo "apt-get stub refuses non-simulation calls" >&2; exit 99 ;; esac`);
  writeExec(path.join(host.stub, 'apt-cache'), `[ "$1" = policy ] || exit 1; f="${host.dir}/policy-$2.txt"; [ -f "$f" ] && cat "$f"; exit 0`);
  if (options.dockerPolicy) fs.writeFileSync(path.join(host.dir, 'policy-docker-ce.txt'), options.dockerPolicy);
  const plugins = path.join(host.dir, 'plugins');
  fs.mkdirSync(plugins, { mode: 0o700 });
  fs.chmodSync(plugins, 0o700);
  return { ...host, apt, plugins };
}

function watchEnv(host, rx, extra = {}) {
  return { APT_STATE_DIR: host.apt, REBOOT_MARKER: path.join(host.dir, 'reboot-required'), UPDATE_WATCH_PLUGIN_DIR: host.plugins, ...(rx ? alertEnv(rx) : {}), ...extra };
}

const aptSim = [
  'Inst openssl [3.0.13-0ubuntu3.4] (3.0.13-0ubuntu3.5 Ubuntu:24.04/noble-security [amd64])',
  'Inst curl [8.5.0-2ubuntu10.5] (8.5.0-2ubuntu10.6 Ubuntu:24.04/noble-updates [amd64])',
  'Inst tzdata [2024a] (2024b Ubuntu:24.04/noble-updates [all])',
  'Conf openssl (3.0.13-0ubuntu3.5 Ubuntu:24.04/noble-security [amd64])'
].join('\n');

test('update watch: pending security updates, a reboot marker and an old Docker engine warn with counts and versions', { skip }, async (t) => {
  const host = makeAptHost(t, {
    aptSim,
    dockerPolicy: 'docker-ce:\n  Installed: 5:27.3.1-1~ubuntu.24.04~noble\n  Candidate: 5:28.0.1-1~ubuntu.24.04~noble\n'
  });
  fs.writeFileSync(path.join(host.dir, 'reboot-required'), '*** System restart required ***\n');
  fs.writeFileSync(path.join(host.dir, 'reboot-required.pkgs'), 'linux-image-6.8.0-50-generic\n');
  const rx = await receiver(t);
  const result = await run(watchScript, [], host, watchEnv(host, rx));
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /^Update watch: WARN$/m);
  const report = fs.readFileSync(path.join(host.root, 'reports', 'latest-update-watch.md'), 'utf8');
  assert.match(report, /\| Security updates \| WARN \| - \| 1 pending \| 1 of 3 pending package updates/);
  assert.match(report, /\| OS packages \| OK \| - \| 3 pending \|/);
  assert.match(report, /\| Reboot needed \| WARN \| - \| - \| The reboot-needed marker is set by linux-image-6\.8\.0-50-generic/);
  assert.match(report, /\| Docker engine \| WARN \| 27\.3\.1 \(5:27\.3\.1-1~ubuntu\.24\.04~noble\) \| 5:28\.0\.1-1~ubuntu\.24\.04~noble \|/);
  assert.match(report, /\| Automatic security updates \| OK \|/);
  assert.match(report, /Nothing was installed, upgraded, refreshed or restarted/);
  assert.equal(hooks(rx).length, 1);
  assert.match(JSON.parse(hooks(rx)[0].body).subject, /updates WARN/);
  const again = await run(watchScript, [], host, watchEnv(host, rx));
  assert.match(again.stdout, /Alert: not needed/);
  assert.equal(hooks(rx).length, 1);
});

test('update watch: a version it cannot check is UNKNOWN, never up to date', { skip }, async (t) => {
  const host = makeAptHost(t, { aptSim: '' });
  const result = await run(watchScript, ['--dry-run'], host, watchEnv(host, null));
  assert.match(result.stdout, /^Overall: UNKNOWN$/m);
  assert.match(result.stdout, /\| Docker engine \| UNKNOWN \| 27\.3\.1 \| unknown \|/);
  assert.equal(fs.existsSync(host.root), false, 'a dry run writes nothing');

  const noApt = makeHost(t, { docker: 'absent' });
  const plain = await run(watchScript, ['--dry-run'], noApt, { REBOOT_MARKER: path.join(noApt.dir, 'none'), UPDATE_WATCH_PLUGIN_DIR: path.join(noApt.dir, 'none') });
  assert.match(plain.stdout, /\| OS packages \| UNKNOWN \|/);
  assert.match(plain.stdout, /\| Docker engine \| N\/A \|/);
});

test('update watch: an old package index warns that counts may be low', { skip }, async (t) => {
  const host = makeAptHost(t, { indexAgeDays: 10 });
  const result = await run(watchScript, ['--dry-run'], host, watchEnv(host, null));
  assert.match(result.stdout, /\| Package index age \| WARN \| - \| - \| Last refreshed 10 days ago/);
});

test('update watch: plug-ins add rows only when safe and well formed', { skip }, async (t) => {
  const host = makeAptHost(t);
  writeExec(path.join(host.plugins, 'platform.sh'), "echo 'Platform core|4.4.0|4.5.0|WARN|Behind the latest release'\necho 'Platform proxy|3.1|unknown|UNKNOWN|Latest not readable'");
  fs.chmodSync(path.join(host.plugins, 'platform.sh'), 0o700);
  writeExec(path.join(host.plugins, 'open.sh'), "echo 'Open|1|1|OK|should not run'");
  fs.chmodSync(path.join(host.plugins, 'open.sh'), 0o777);
  writeExec(path.join(host.plugins, 'bad.sh'), "echo 'garbage line'");
  fs.chmodSync(path.join(host.plugins, 'bad.sh'), 0o700);
  writeExec(path.join(host.plugins, 'broken.sh'), 'exit 3');
  fs.chmodSync(path.join(host.plugins, 'broken.sh'), 0o700);
  const result = await run(watchScript, ['--dry-run'], host, watchEnv(host, null));
  assert.match(result.stdout, /\| Platform core \| WARN \| 4\.4\.0 \| 4\.5\.0 \| Behind the latest release \|/);
  assert.match(result.stdout, /\| Platform proxy \| UNKNOWN \|/);
  assert.match(result.stdout, /\| Plug-in open \| UNKNOWN \| - \| - \| Skipped: not executable, others can write it/);
  assert.ok(!result.stdout.includes('should not run'));
  assert.match(result.stdout, /\| Plug-in bad \| UNKNOWN \| - \| - \| A line did not match/);
  assert.match(result.stdout, /\| Plug-in broken \| UNKNOWN \| - \| - \| The plug-in failed or timed out/);

  fs.chmodSync(host.plugins, 0o777);
  const openDir = await run(watchScript, ['--dry-run'], host, watchEnv(host, null));
  assert.match(openDir.stdout, /\| Plug-ins \| UNKNOWN \| - \| - \| Plug-in folder skipped/);
  assert.ok(!openDir.stdout.includes('Platform core'));
});

test('update watch alert settings: never sends nothing, always sends every run', { skip }, async (t) => {
  const host = makeAptHost(t, { aptSim });
  const rx = await receiver(t);
  await run(watchScript, [], host, watchEnv(host, rx, { UPDATE_WATCH_ALERT: 'never' }));
  assert.equal(hooks(rx).length, 0);
  await run(watchScript, [], host, watchEnv(host, rx, { UPDATE_WATCH_ALERT: 'always' }));
  await run(watchScript, [], host, watchEnv(host, rx, { UPDATE_WATCH_ALERT: 'always' }));
  assert.equal(hooks(rx).length, 2);
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

test('installer refuses to install without root and rejects odd calendar values', { skip }, (t) => {
  const host = installerHost(t, 1000);
  const result = runInstaller(host, ['--install']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Run as root on the target host/);
  assert.deepEqual(fs.readdirSync(host.env.SYSTEMD_UNIT_DIR), []);
  const odd = runInstaller(installerHost(t, 0), ['--install'], { UPDATE_WATCH_CALENDAR: 'daily; rm -rf /' });
  assert.equal(odd.status, 2);
});

test('installer installs hourly and daily timers, keeps an existing env file, backs up units, and removes cleanly', { skip }, (t) => {
  const host = installerHost(t, 0);
  const first = runInstaller(host, ['--install']);
  assert.equal(first.status, 0, first.stderr);
  const units = host.env.SYSTEMD_UNIT_DIR;
  const pulseService = fs.readFileSync(path.join(units, 'host-pulse.service'), 'utf8');
  assert.match(pulseService, new RegExp(`ExecStart=${host.env.INSTALL_PREFIX}/host-pulse\\.sh`));
  assert.match(pulseService, new RegExp(`EnvironmentFile=-${host.env.CONFIG_DIR}/host-pulse\\.env`));
  assert.match(pulseService, /NoNewPrivileges=yes/);
  assert.match(fs.readFileSync(path.join(units, 'host-pulse.timer'), 'utf8'), /OnCalendar=hourly/);
  assert.match(fs.readFileSync(path.join(units, 'host-update-watch.timer'), 'utf8'), /OnCalendar=daily/);
  const envFile = path.join(host.env.CONFIG_DIR, 'host-pulse.env');
  assert.equal(fs.statSync(envFile).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.join(host.env.CONFIG_DIR, 'update-watch.d')).mode & 0o777, 0o700);
  for (const file of ['host-pulse.sh', 'update-watch.sh', 'lib/host-observability-common.sh']) assert.ok(fs.existsSync(path.join(host.env.INSTALL_PREFIX, file)), file);
  assert.match(fs.readFileSync(path.join(host.dir, 'systemctl.log'), 'utf8'), /enable --now host-pulse\.timer host-update-watch\.timer/);

  fs.writeFileSync(envFile, 'ALERT_CHANNELS=webhook\n');
  const second = runInstaller(host, ['--install'], { UPDATE_WATCH_CALENDAR: 'Mon *-*-* 03:00:00' });
  assert.equal(second.status, 0, second.stderr);
  assert.equal(fs.readFileSync(envFile, 'utf8'), 'ALERT_CHANNELS=webhook\n', 'an existing env file is never overwritten');
  assert.ok(fs.readdirSync(units).some((name) => name.startsWith('host-pulse.service.bak.')));
  assert.match(fs.readFileSync(path.join(units, 'host-update-watch.timer'), 'utf8'), /OnCalendar=Mon \*-\*-\* 03:00:00/);

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

test('the pulse and update watch contain no command that changes the host', () => {
  for (const file of [pulseScript, watchScript, path.join(skillDir, 'scripts', 'lib', 'host-observability-common.sh')]) {
    // Comments and plain message strings are dropped; strings holding a command substitution stay.
    const code = fs.readFileSync(file, 'utf8').split('\n').filter((line) => !/^\s*#/.test(line)).join('\n')
      .replace(/"(?:[^"\\\n]|\\.)*"|'[^'\n]*'/g, (literal) => (literal.includes('$(') ? literal : '""'));
    assert.doesNotMatch(code, /\bapt-get\s+(install|upgrade|update|dist-upgrade|remove|purge)\b/, file);
    assert.doesNotMatch(code, /\bsystemctl\s+(start|stop|restart|enable|disable|reload|daemon-reload)\b/, file);
    assert.doesNotMatch(code, /\bdocker\s+(rm|stop|start|restart|kill|pull|run|update|system\s+prune)\b/, file);
    assert.doesNotMatch(code, /(^|[;&|(]\s*|\$\(\s*|then\s+|else\s+)(sudo\s+)?(reboot|shutdown|ufw|iptables|kill|pkill|rm\s+-rf\s+\/)\b/m, file);
    for (const line of code.split('\n').filter((l) => /(?<!have )\bapt-get\s/.test(l))) assert.match(line, / -s /, `apt-get call without -s: ${line}`);
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
