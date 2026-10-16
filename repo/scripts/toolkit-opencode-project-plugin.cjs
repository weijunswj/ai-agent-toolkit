#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Both installed public loaders discover only .js/.ts in these directories.
// An unreferenced .mjs payload is inert despite valid module contents.
const PLUGIN_RELATIVE_PATH = path.join('.opencode', 'plugins', 'ai-agent-toolkit.js');
const PLUGIN_TEMPLATE_PATH = path.resolve(
  __dirname,
  '..',
  'contracts',
  'toolkit-local-bridge',
  'opencode-plugin',
  'ai-agent-toolkit.mjs'
);
const EXECUTION_RULES_PATH = path.resolve(
  __dirname,
  '..',
  'contracts',
  'agent-rules',
  'ai-coding-agent-execution.md'
);
const EXECUTION_RULES_TOKEN = '__TOOLKIT_EXECUTION_RULES_JSON__';
const VERSION_PATH = path.resolve(__dirname, '..', 'contracts', 'toolkit-local-bridge', 'version.json');

function parseArgs(argv = process.argv.slice(2)) {
  const args = { projectRoot: '', write: false, help: false, generation: 'V1' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--project-root') args.projectRoot = argv[++index] || '';
    else if (arg.startsWith('--project-root=')) args.projectRoot = arg.slice('--project-root='.length);
    else if (arg === '--write') args.write = true;
    else if (arg === '--api-generation') args.generation = argv[++index];
    else if (arg === '--print-helper-definition') args.helperRole = argv[++index];
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.help && !args.projectRoot && !args.helperRole) throw new Error('--project-root <absolute-path> is required');
  if (args.helperRole && !['G0','G1'].includes(args.helperRole)) throw new Error('helper definition requires G0 or G1');
  if (args.helperRole && args.write) throw new Error('helper-definition output cannot install or activate');
  if (!['V1','V2'].includes(args.generation)) throw new Error('--api-generation must be V1 or V2');
  if (args.projectRoot && !path.isAbsolute(args.projectRoot)) {
    throw new Error('--project-root must be an absolute path');
  }
  return args;
}

function lstatIfExists(targetPath) {
  try {
    return fs.lstatSync(targetPath);
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function inspectProjectRoot(projectRoot) {
  const info = lstatIfExists(projectRoot);
  if (!info) throw new Error('Project root does not exist');
  if (info.isSymbolicLink()) throw new Error('Project root cannot be a symbolic link or junction');
  if (!info.isDirectory()) throw new Error('Project root must be a directory');
  return path.resolve(projectRoot);
}

function readRegularFile(filePath, label) {
  const info = fs.lstatSync(filePath);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${label} is not a regular file`);
  return fs.readFileSync(filePath);
}

function renderPluginPayload(generation = 'V1') {
  if (!['V1','V2'].includes(generation)) throw new Error('OpenCode API generation must be V1 or V2');
  if (generation === 'V2') throw new Error('OPENCODE_V2_PRE_DISPATCH_API_UNAVAILABLE: installed public setup exposes no tool/session receiver; SDK hooks alone cannot satisfy helper pre-dispatch and zero-effect invariants');
  const template = readRegularFile(PLUGIN_TEMPLATE_PATH, 'Bundled plugin template').toString('utf8');
  const executionRules = readRegularFile(EXECUTION_RULES_PATH, 'Canonical execution-rule source').toString('utf8');
  if (!executionRules.trim()) throw new Error('Canonical execution-rule source is empty');
  if (template.split(EXECUTION_RULES_TOKEN).length !== 2) {
    throw new Error('Bundled plugin template must contain exactly one canonical execution-rule placeholder');
  }
  const version = JSON.parse(readRegularFile(VERSION_PATH, 'Toolkit version source').toString('utf8')).version;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Toolkit package version is invalid');
  const sourceDigest = crypto.createHash('sha256').update(Buffer.from(executionRules)).digest('hex');
  return Buffer.from(`// AI-AGENT-TOOLKIT package ${version}; execution-rule SHA256 ${sourceDigest}\n`
    + template.replace(EXECUTION_RULES_TOKEN, JSON.stringify(executionRules))
      .replace('__TOOLKIT_HELPER_RUNTIME_JSON__', JSON.stringify(path.resolve(__dirname, 'toolkit-opencode-helper-adapter.cjs')))
      .replace('__TOOLKIT_API_GENERATION_JSON__', JSON.stringify(generation)), 'utf8');
}

function inspectDestination(projectRoot, payload) {
  const destination = path.join(projectRoot, PLUGIN_RELATIVE_PATH);
  const directories = [
    path.join(projectRoot, '.opencode'),
    path.join(projectRoot, '.opencode', 'plugins')
  ];
  const missingDirectories = [];
  let priorDirectoryMissing = false;

  for (const directory of directories) {
    const info = priorDirectoryMissing ? null : lstatIfExists(directory);
    if (!info) {
      priorDirectoryMissing = true;
      missingDirectories.push(directory);
      continue;
    }
    if (info.isSymbolicLink()) throw new Error('OpenCode plugin directory cannot be a symbolic link or junction');
    if (!info.isDirectory()) throw new Error('OpenCode plugin directory path is not a directory');
  }

  const targetInfo = priorDirectoryMissing ? null : lstatIfExists(destination);
  if (!targetInfo) return { destination, missingDirectories, state: 'missing' };
  if (targetInfo.isSymbolicLink()) throw new Error('OpenCode plugin target cannot be a symbolic link or junction');
  if (!targetInfo.isFile()) throw new Error('OpenCode plugin target exists and is not a regular file');

  const existing = fs.readFileSync(destination);
  if (!existing.equals(payload)) throw new Error('OpenCode plugin target already exists with different content; refusing to overwrite');
  return { destination, missingDirectories, state: 'already-installed' };
}

function makeDirectoriesSafely(directories) {
  for (const directory of directories) {
    try {
      fs.mkdirSync(directory);
    } catch (error) {
      if (!error || error.code !== 'EEXIST') throw error;
    }
    const info = lstatIfExists(directory);
    if (!info || info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error('OpenCode plugin directory changed during installation; refusing to continue');
    }
  }
}

class OpenCodeProjectPluginInstallation {
  #projectRoot; #write; #generation;
  #root; #payload; #inspected;
  constructor({ projectRoot, write = false, generation = 'V1' }) {this.#projectRoot=projectRoot;this.#write=write;this.#generation=generation;}
  run() {
    const projectRoot=this.#projectRoot,write=this.#write,generation=this.#generation;

  if (!projectRoot || !path.isAbsolute(projectRoot)) throw new Error('--project-root must be an absolute path');
  const root = this.#root = inspectProjectRoot(projectRoot);
  const payload = this.#payload = renderPluginPayload(generation);
  const inspected = this.#inspected = inspectDestination(root, payload);
  const relativePath = PLUGIN_RELATIVE_PATH.split(path.sep).join('/');
  const payloadSha256 = crypto.createHash('sha256').update(payload).digest('hex');

  if (inspected.state === 'already-installed') {
    return { status: 'already-installed', relativePath, payloadSha256, wrote: false };
  }
  if (!write) {
    return {
      status: 'dry-run',
      relativePath,
      payloadSha256,
      directoriesToCreate: inspected.missingDirectories.map((item) => path.relative(root, item).split(path.sep).join('/')),
      wrote: false
    };
  }

  makeDirectoriesSafely(inspected.missingDirectories);
  let descriptor;
  try {
    descriptor = fs.openSync(inspected.destination, 'wx', 0o644);
    fs.writeFileSync(descriptor, payload);
  } catch (error) {
    if (descriptor !== undefined) {
      try { fs.closeSync(descriptor); } catch { /* keep the original error */ }
    }
    if (error && error.code === 'EEXIST') {
      const afterRace = inspectDestination(root, payload);
      if (afterRace.state === 'already-installed') {
        return { status: 'already-installed', relativePath, payloadSha256, wrote: false };
      }
      throw new Error('OpenCode plugin target appeared during installation; refusing to overwrite');
    }
    throw error;
  }
  fs.closeSync(descriptor);
  if (!fs.readFileSync(inspected.destination).equals(payload)) throw new Error('OpenCode plugin installed readback mismatch');
  return { status: 'installed', relativePath, payloadSha256, wrote: true };

  }
}
function installProjectPlugin({ projectRoot, write = false, generation = 'V1' }) {return new OpenCodeProjectPluginInstallation({projectRoot,write,generation}).run();}

function printHelp() {
  console.log([
    'Install the Toolkit OpenCode project plugin.',
    'Dry-run is the default. --write creates only .opencode/plugins/ai-agent-toolkit.js.',
    '',
    'Usage:',
    '  node repo/scripts/toolkit-opencode-project-plugin.cjs --project-root <absolute-path>',
    '  node repo/scripts/toolkit-opencode-project-plugin.cjs --project-root <absolute-path> --write'
  ].join('\n'));
}

function run(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return { status: 0 };
  }
  if (args.helperRole) {
    const result = require('./toolkit-v3-native-helper-adapter.cjs').renderNativeHelperDefinition('opencode',args.helperRole,require('./toolkit-v3-native-helper-adapter.cjs').readNativeSelectionFromEnvironment());
    console.log(JSON.stringify(result,null,2));
    return {status:0,result};
  }
  const result = installProjectPlugin(args);
  console.log(JSON.stringify(result, null, 2));
  return { status: 0, result };
}

if (require.main === module) {
  try {
    process.exit(run().status || 0);
  } catch (error) {
    console.error(`FAIL: ${error.message}`);
    process.exit(1);
  }
}

module.exports = { EXECUTION_RULES_PATH, PLUGIN_RELATIVE_PATH, installProjectPlugin, parseArgs, renderPluginPayload, run };
