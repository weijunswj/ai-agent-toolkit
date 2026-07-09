#!/usr/bin/env node
'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const readline = require('node:readline/promises');

const N8N_IMAGES = new Set(['n8nio/n8n', 'n8nio/n8n:stable']);
const DEFAULT_SERVICE = 'n8n';

function parseArgs(args = []) {
  const options = {};
  const readValue = (index, key) => {
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    options[key] = value;
    return index + 1;
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--json') {
      options.json = true;
    } else if (arg === '--json-output') {
      index = readValue(index, 'jsonOutput');
    } else if (arg.startsWith('--json-output=')) {
      options.jsonOutput = arg.slice('--json-output='.length);
    } else if (arg === '--non-interactive') {
      options.nonInteractive = true;
    } else if (arg === '--container' || arg === '--container-name') {
      index = readValue(index, 'containerName');
    } else if (arg === '--container-id') {
      index = readValue(index, 'containerId');
    } else if (arg === '--compose-project') {
      index = readValue(index, 'composeProject');
    } else if (arg === '--compose-service') {
      index = readValue(index, 'composeService');
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return options;
}

function optionsFromEnv(env = process.env) {
  return {
    containerName: env.N8N_CONTAINER_NAME || '',
    containerId: env.N8N_CONTAINER_ID || '',
    composeProject: env.N8N_COMPOSE_PROJECT || '',
    composeService: env.N8N_COMPOSE_SERVICE || '',
  };
}

function mergeOptions(cliOptions, envOptions) {
  return {
    ...envOptions,
    ...Object.fromEntries(Object.entries(cliOptions).filter(([, value]) => value !== undefined && value !== '')),
  };
}

function defaultDockerRunner(commandArgs) {
  return spawnSync('docker', commandArgs, { encoding: 'utf8' });
}

function normalizeRunResult(result) {
  return {
    status: typeof result.status === 'number' ? result.status : result.code || 0,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function runDocker(runDocker, args) {
  const result = normalizeRunResult(runDocker(args));
  return result;
}

function parseInspect(stdout) {
  if (!stdout.trim()) return [];
  const parsed = JSON.parse(stdout);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function normalizeContainer(inspect) {
  const labels = inspect.Config?.Labels || {};
  const ports = [];
  for (const [containerPort, bindings] of Object.entries(inspect.NetworkSettings?.Ports || {})) {
    if (!Array.isArray(bindings) || bindings.length === 0) continue;
    for (const binding of bindings) {
      const hostPort = binding.HostPort || '';
      if (hostPort) ports.push(`${hostPort}:${containerPort.replace('/tcp', '')}`);
    }
  }

  return {
    id: inspect.Id || '',
    idPrefix: (inspect.Id || '').slice(0, 12),
    name: String(inspect.Name || '').replace(/^\//, ''),
    image: inspect.Config?.Image || inspect.Image || '',
    running: inspect.State?.Running === true,
    project: labels['com.docker.compose.project'] || '',
    service: labels['com.docker.compose.service'] || '',
    ports: ports.join(', '),
  };
}

function inspectTargets(runDockerFn, targets) {
  const uniqueTargets = [...new Set(targets.filter(Boolean))];
  if (!uniqueTargets.length) return [];
  const result = runDocker(runDockerFn, ['inspect', ...uniqueTargets]);
  if (result.status !== 0) return [];
  return parseInspect(result.stdout).map(normalizeContainer).filter((candidate) => candidate.running);
}

function listRunningContainers(runDockerFn) {
  const psResult = runDocker(runDockerFn, ['ps', '-q']);
  if (psResult.status !== 0) {
    throw new Error(`Docker is not reachable.\n${psResult.stderr || psResult.stdout}`.trim());
  }
  const ids = psResult.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return inspectTargets(runDockerFn, ids);
}

function dedupeCandidates(candidates) {
  const seen = new Set();
  const result = [];
  for (const candidate of candidates) {
    const key = candidate.id || `${candidate.project}\0${candidate.service}\0${candidate.name}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(candidate);
  }
  return result;
}

function explicitTargetProvided(options) {
  return Boolean(options.containerId || options.containerName || options.composeProject || options.composeService);
}

function findExplicitContainer(runDockerFn, options) {
  const target = options.containerId || options.containerName;
  if (!target) return null;
  const inspected = inspectTargets(runDockerFn, [target]);
  if (inspected.length !== 1) {
    throw new Error(`Explicit n8n container target did not resolve to exactly one running container: ${target}\n${overrideGuidance()}`);
  }
  return inspected[0];
}

function findByComposePs(runDockerFn, options) {
  const service = options.composeService || DEFAULT_SERVICE;
  const args = ['compose'];
  if (options.composeProject) args.push('-p', options.composeProject);
  args.push('ps', '-q', service);
  const result = runDocker(runDockerFn, args);
  if (result.status !== 0) return [];
  const ids = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return inspectTargets(runDockerFn, ids);
}

function findByComposeLabels(allRunning, options) {
  const service = options.composeService || DEFAULT_SERVICE;
  return allRunning.filter((candidate) => {
    if (candidate.service !== service) return false;
    if (options.composeProject && candidate.project !== options.composeProject) return false;
    return true;
  });
}

function findByImageFallback(allRunning) {
  return allRunning.filter((candidate) => N8N_IMAGES.has(candidate.image));
}

function candidateLines(candidates) {
  return candidates.flatMap((candidate, index) => [
    `${index + 1}. stack=${candidate.project || '(none)'}`,
    `   service=${candidate.service || '(none)'}`,
    `   container=${candidate.name || '(unknown)'}`,
    `   container_id=${candidate.idPrefix || '(unknown)'}`,
    `   image=${candidate.image || '(unknown)'}`,
    `   ports=${candidate.ports || '(none)'}`,
  ]);
}

function formatCandidateList(candidates) {
  return candidates
    .map((candidate, index) => candidateLines([candidate]).map((line, lineIndex) => {
      if (lineIndex === 0) return line.replace(/^1\./, `${index + 1}.`);
      return line;
    }).join('\n'))
    .join('\n\n');
}

function overrideGuidance() {
  return [
    'Provide an explicit target and rerun:',
    '  --container <name> / --container-name <name> / --container-id <id>',
    '  --compose-project <project> --compose-service <service>',
    'or set N8N_CONTAINER_NAME, N8N_CONTAINER_ID, N8N_COMPOSE_PROJECT, or N8N_COMPOSE_SERVICE.',
  ].join('\n');
}

function missingTargetMessage() {
  return [
    'No running n8n Docker container was detected.',
    'Detection tried explicit CLI/env target, docker compose ps, Compose labels, and n8nio/n8n image fallback.',
    overrideGuidance(),
  ].join('\n');
}

function invalidSelectionMessage() {
  return 'Target selection terminated. Relaunch the helper and select a valid target number.';
}

async function chooseCandidate(candidates, io) {
  const { input = process.stdin, output = process.stderr, interactive = input.isTTY && output.isTTY } = io;
  output.write('Multiple running n8n Docker candidates were detected:\n');
  output.write(`${formatCandidateList(candidates)}\n`);

  if (!interactive) {
    throw new Error(`Multiple running n8n candidates require an explicit target in non-interactive mode.\n${overrideGuidance()}`);
  }

  const rl = readline.createInterface({ input, output, terminal: true });
  let answer = '';
  try {
    answer = await rl.question('Select n8n target number for this run: ');
  } finally {
    rl.close();
  }

  const trimmed = answer.trim();
  if (!/^\d+$/.test(trimmed)) throw new Error(invalidSelectionMessage());
  const selected = Number(trimmed);
  if (selected < 1 || selected > candidates.length) throw new Error(invalidSelectionMessage());
  return candidates[selected - 1];
}

async function resolveN8nDockerTarget({
  args = [],
  env = process.env,
  runDocker: runDockerFn = defaultDockerRunner,
  input = process.stdin,
  output = process.stderr,
  interactive,
} = {}) {
  const cliOptions = parseArgs(args);
  const options = mergeOptions(cliOptions, optionsFromEnv(env));
  const allowInteractive = interactive ?? (!cliOptions.nonInteractive && Boolean(input.isTTY && output.isTTY));

  const explicitContainer = findExplicitContainer(runDockerFn, options);
  if (explicitContainer) return explicitContainer;

  const composeCandidates = dedupeCandidates(findByComposePs(runDockerFn, options));
  if (explicitTargetProvided(options)) {
    const allRunning = listRunningContainers(runDockerFn);
    const explicitCandidates = dedupeCandidates([...composeCandidates, ...findByComposeLabels(allRunning, options)]);
    if (explicitCandidates.length !== 1) {
      throw new Error(`Explicit n8n Compose target did not resolve to exactly one running container.\n${formatCandidateList(explicitCandidates)}\n${overrideGuidance()}`);
    }
    return explicitCandidates[0];
  }
  if (composeCandidates.length === 1) return composeCandidates[0];
  if (composeCandidates.length > 1) {
    return chooseCandidate(composeCandidates, { input, output, interactive: allowInteractive });
  }

  const allRunning = listRunningContainers(runDockerFn);
  const labelCandidates = dedupeCandidates(findByComposeLabels(allRunning, options));
  if (labelCandidates.length === 1) return labelCandidates[0];
  if (labelCandidates.length > 1) {
    return chooseCandidate(labelCandidates, { input, output, interactive: allowInteractive });
  }

  const imageCandidates = dedupeCandidates(findByImageFallback(allRunning));
  if (imageCandidates.length === 1) return imageCandidates[0];
  if (imageCandidates.length > 1) {
    return chooseCandidate(imageCandidates, { input, output, interactive: allowInteractive });
  }

  throw new Error(missingTargetMessage());
}

function publicTarget(candidate) {
  return {
    container_id: candidate.id,
    container_id_prefix: candidate.idPrefix,
    container_name: candidate.name,
    compose_project: candidate.project,
    compose_service: candidate.service,
    image: candidate.image,
    ports: candidate.ports,
  };
}

async function main() {
  try {
    const args = process.argv.slice(2);
    const options = parseArgs(args);
    const candidate = await resolveN8nDockerTarget({ args });
    const json = `${JSON.stringify(publicTarget(candidate), null, 2)}\n`;
    if (options.jsonOutput) {
      fs.writeFileSync(options.jsonOutput, json, 'utf8');
    } else {
      process.stdout.write(json);
    }
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  candidateLines,
  dedupeCandidates,
  findByComposeLabels,
  findByImageFallback,
  formatCandidateList,
  invalidSelectionMessage,
  missingTargetMessage,
  normalizeContainer,
  overrideGuidance,
  parseArgs,
  publicTarget,
  resolveN8nDockerTarget,
};
