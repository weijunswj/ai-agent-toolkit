#!/usr/bin/env node
'use strict';

// Read-only "check this machine" report for the n8n import/export helpers. It writes nothing, never
// imports, exports, publishes or restarts anything, and prints no environment values except the three
// n8n log settings that decide whether the helpers can read n8n's output.
//
// Without --offline it reads the local Docker host: `docker version`, `docker ps`, `docker inspect`,
// `docker compose ps`, and `n8n --version` inside the selected container. An agent runs it only with the
// same current-turn approval it needs for any other Docker read on that machine; --offline skips Docker.
//
// Usage: node check-n8n-helper-machine.cjs [--offline] [--json] [--container <name> | --container-id <id>
//        | --compose-project <project> --compose-service <service>]

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { checkSet, MIN_NODE_MAJOR, nodeMajor } = require('./n8n-helper-set.cjs');

const LOG_SETTINGS = ['N8N_LOG_LEVEL', 'N8N_LOG_OUTPUT', 'N8N_LOG_FORMAT'];

function defaultRun(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true, timeout: 60000 });
  return {
    status: typeof result.status === 'number' ? result.status : 1,
    stdout: result.stdout || '',
    stderr: result.stderr || (result.error ? result.error.message : ''),
  };
}

function firstLine(text) {
  return String(text || '').split(/\r?\n/).map((line) => line.trim()).find(Boolean) || '';
}

function powerShellChecks(run, platform) {
  const hosts = platform === 'win32' ? ['powershell', 'pwsh'] : ['pwsh'];
  const checks = hosts.map((host) => {
    const result = run(host, ['-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()']);
    const version = result.status === 0 ? firstLine(result.stdout) : '';
    return {
      name: host === 'powershell' ? 'Windows PowerShell' : 'PowerShell 7 (pwsh)',
      status: version ? 'OK' : 'INFO',
      detail: version ? version : 'not found',
    };
  });
  if (!checks.some((check) => check.status === 'OK')) {
    checks[checks.length - 1] = { ...checks[checks.length - 1], status: 'FAIL', detail: 'not found. The import/export helpers run in PowerShell; install PowerShell 7 (pwsh).' };
  }
  return checks;
}

function logSettingsFrom(inspectStdout) {
  let parsed;
  try {
    parsed = JSON.parse(inspectStdout);
  } catch {
    return null;
  }
  const env = Array.isArray(parsed) && parsed[0] && parsed[0].Config && Array.isArray(parsed[0].Config.Env) ? parsed[0].Config.Env : [];
  const settings = {};
  for (const entry of env) {
    const separator = String(entry).indexOf('=');
    if (separator < 0) continue;
    const key = entry.slice(0, separator);
    if (LOG_SETTINGS.includes(key)) settings[key] = entry.slice(separator + 1);
  }
  return settings;
}

function logSettingsCheck(settings) {
  if (!settings) return { name: 'n8n log settings', status: 'INFO', detail: 'could not be read' };
  const shown = LOG_SETTINGS.map((key) => `${key}=${settings[key] === undefined ? '(default)' : settings[key]}`).join(', ');
  const nonDefault = (settings.N8N_LOG_LEVEL && !['info', 'debug'].includes(settings.N8N_LOG_LEVEL)) ||
    (settings.N8N_LOG_OUTPUT && !String(settings.N8N_LOG_OUTPUT).split(',').map((value) => value.trim()).includes('console')) ||
    settings.N8N_LOG_FORMAT === 'json';
  return {
    name: 'n8n log settings',
    status: nonDefault ? 'INFO' : 'OK',
    detail: nonDefault
      ? `${shown}. n8n prints workflow lists through its log, so these settings would hide or wrap them; the helpers override them for their own export calls only.`
      : shown,
  };
}

async function dockerChecks(run, options) {
  const checks = [];
  const docker = run('docker', ['version', '--format', '{{.Server.Version}}']);
  if (docker.status !== 0) {
    checks.push({ name: 'Docker', status: 'FAIL', detail: 'not reachable. Start Docker Desktop (or the Docker service) and rerun.' });
    return checks;
  }
  checks.push({ name: 'Docker', status: 'OK', detail: `server ${firstLine(docker.stdout)}` });

  const { resolveN8nDockerTarget } = require('./resolve-n8n-docker-target.cjs');
  let target;
  try {
    target = await resolveN8nDockerTarget({
      args: [...options.targetArgs, '--non-interactive'],
      runDocker: (args) => run('docker', args),
      interactive: false,
    });
  } catch (error) {
    checks.push({ name: 'n8n container', status: 'FAIL', detail: firstLine(error.message) + ' Pass --container <name> to pick one.' });
    return checks;
  }
  const label = target.project || target.service ? `${target.project || '(none)'}/${target.service || '(none)'} -> ${target.name}` : target.name;
  checks.push({ name: 'n8n container', status: 'OK', detail: `${label} (${target.idPrefix}), image ${target.image}` });

  const version = run('docker', ['exec', target.id, 'n8n', '--version']);
  const versionText = version.status === 0 ? firstLine(version.stdout) : '';
  const major = Number((/^(\d+)\./.exec(versionText) || [])[1] || 0);
  checks.push({
    name: 'n8n version',
    status: versionText ? 'OK' : 'FAIL',
    detail: versionText
      ? `${versionText}${major && major < 2 ? '. Publish-only export (-PublishedOnly) needs n8n 2.0 or newer.' : ''}`
      : 'the n8n command did not answer inside the container.',
  });

  const inspect = run('docker', ['inspect', target.id]);
  checks.push(logSettingsCheck(inspect.status === 0 ? logSettingsFrom(inspect.stdout) : null));
  return checks;
}

function nextStep(checks) {
  const failed = checks.find((check) => check.status === 'FAIL');
  if (!failed) return 'This machine can run the n8n import/export helpers.';
  if (failed.name === 'Node.js') return `Install Node.js ${MIN_NODE_MAJOR} or newer, then rerun this check.`;
  if (failed.name.includes('PowerShell')) return 'Install PowerShell 7 (pwsh), then rerun this check.';
  if (failed.name === 'Helper set') return 'Refresh the helper folder from Toolkit (see README), then rerun this check.';
  if (failed.name === 'Docker') return 'Start Docker, then rerun this check.';
  if (failed.name === 'n8n container') return 'Start the n8n container, or pass --container <name>, then rerun this check.';
  return `Fix "${failed.name}", then rerun this check.`;
}

function parseArgs(argv) {
  const options = { offline: false, json: false, targetArgs: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--offline') options.offline = true;
    else if (arg === '--json') options.json = true;
    else if (['--container', '--container-name', '--container-id', '--compose-project', '--compose-service'].includes(arg)) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      options.targetArgs.push(arg, value);
      index += 1;
    } else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

async function runChecks(options = {}, deps = {}) {
  const run = deps.run || defaultRun;
  const platform = deps.platform || process.platform;
  const nodeVersion = deps.nodeVersion || process.version;
  const helperDir = deps.helperDir || __dirname;
  const checks = [];

  checks.push({
    name: 'Node.js',
    status: nodeMajor(nodeVersion) >= MIN_NODE_MAJOR ? 'OK' : 'FAIL',
    detail: `${nodeVersion} (needs ${MIN_NODE_MAJOR} or newer)`,
  });
  checks.push({ name: 'Operating system', status: 'OK', detail: `${platform} ${deps.arch || process.arch}` });
  checks.push(...powerShellChecks(run, platform));

  const allowLocalChanges = (deps.env || process.env).N8N_HELPERS_ALLOW_LOCAL_CHANGES === '1';
  const set = checkSet(helperDir, { nodeVersion, allowLocalChanges });
  const setProblems = set.problems.filter((problem) => !problem.startsWith('Node.js'));
  checks.push({
    name: 'Helper set',
    status: setProblems.length || (set.changed.length && !allowLocalChanges) ? 'FAIL' : 'OK',
    detail: setProblems.length
      ? setProblems.join(' ')
      : `${set.setId}${set.changed.length ? `, local changes in ${set.changed.join(', ')}` : ', complete and matching'}${set.extra.length ? `; repository-local extras kept: ${set.extra.join(', ')}` : ''}`,
  });

  if (options.offline) {
    checks.push({ name: 'Docker', status: 'INFO', detail: 'skipped (--offline)' });
  } else {
    checks.push(...await dockerChecks(run, options));
  }
  return { checks, next: nextStep(checks), ok: !checks.some((check) => check.status === 'FAIL') };
}

async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    return 2;
  }
  const report = await runChecks(options);
  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`n8n helper machine check (${path.basename(__dirname)})\n`);
    for (const check of report.checks) process.stdout.write(`[${check.status.padEnd(4)}] ${check.name}: ${check.detail}\n`);
    process.stdout.write(`Next step: ${report.next}\n`);
  }
  return report.ok ? 0 : 1;
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; });
}

module.exports = { logSettingsFrom, logSettingsCheck, nextStep, parseArgs, runChecks };
