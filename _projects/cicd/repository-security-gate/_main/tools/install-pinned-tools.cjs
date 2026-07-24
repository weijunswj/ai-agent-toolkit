#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const https = require('node:https');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { validateToolLock } = require('./security-gate.cjs');

const PACK_ROOT = path.resolve(__dirname, '..');
const LOCK_PATH = path.join(PACK_ROOT, 'config', 'tool-lock.json');
const MAX_DOWNLOAD_BYTES = 350 * 1024 * 1024;
const ALLOWED_DOWNLOAD_HOSTS = new Set([
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com'
]);

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const item = argv[index];
    if (!item.startsWith('--')) throw new Error(`Unknown argument: ${item}`);
    const name = item.slice(2);
    if (index + 1 >= argv.length || argv[index + 1].startsWith('--')) args[name] = true;
    else args[name] = argv[++index];
  }
  return args;
}

function isWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function request(url, redirects = 0) {
  if (redirects > 5) return Promise.reject(new Error('Too many download redirects.'));
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !ALLOWED_DOWNLOAD_HOSTS.has(parsed.hostname)) {
    return Promise.reject(new Error(`Download host is not allowlisted: ${parsed.hostname}`));
  }
  return new Promise((resolve, reject) => {
    const requestHandle = https.get(parsed, {
      headers: { 'user-agent': 'ai-agent-toolkit-security-gate' }
    }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode)) {
        response.resume();
        if (!response.headers.location) {
          reject(new Error('Download redirect omitted Location.'));
          return;
        }
        request(new URL(response.headers.location, parsed).toString(), redirects + 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Download failed with HTTP ${response.statusCode}.`));
        return;
      }
      const declared = Number(response.headers['content-length'] || 0);
      if (declared > MAX_DOWNLOAD_BYTES) {
        response.resume();
        reject(new Error('Download exceeds the bounded asset size.'));
        return;
      }
      const chunks = [];
      let total = 0;
      response.on('data', (chunk) => {
        total += chunk.length;
        if (total > MAX_DOWNLOAD_BYTES) {
          response.destroy(new Error('Download exceeded the bounded asset size.'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks)));
    });
    requestHandle.on('error', reject);
    requestHandle.setTimeout(120000, () => requestHandle.destroy(new Error('Download timed out.')));
  });
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024
  });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} failed: ${result.error?.message || String(result.stderr || '').slice(0, 300)}`);
  }
  return String(result.stdout || '');
}

function assertArchiveEntries(entries, label) {
  for (const entry of entries.split(/\r?\n/).filter(Boolean)) {
    const normalized = entry.replace(/\\/g, '/');
    if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized) || normalized.split('/').includes('..')) {
      throw new Error(`${label} contains an unsafe archive path.`);
    }
  }
}

function assertExtractedTree(root) {
  const realRoot = fs.realpathSync.native(root);
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) throw new Error('Extracted scanner asset contains a symlink.');
      const real = fs.realpathSync.native(full);
      if (!isWithin(realRoot, real)) throw new Error('Extracted scanner asset escaped its root.');
      if (entry.isDirectory()) visit(full);
    }
  }
  visit(root);
}

function findFile(root, basename) {
  const matches = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && entry.name === basename) matches.push(full);
    }
  }
  visit(root);
  if (matches.length !== 1) throw new Error(`Expected exactly one ${basename} in asset; found ${matches.length}.`);
  return matches[0];
}

async function installRecord(record, destination) {
  if (record.state !== 'active' || record.kind !== 'scanner') throw new Error(`${record.name} is not an active scanner.`);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), `toolkit-${record.name}-`));
  try {
    const assetPath = path.join(temporary, path.basename(record.expected_release_asset));
    const bytes = await request(record.asset_url);
      const digest = crypto.createHash('sha256').update(bytes).digest('hex');
      if (digest !== record.release_checksum) throw new Error(`${record.name} checksum mismatch.`);
      fs.writeFileSync(assetPath, bytes, { flag: 'wx' });
      const extractRoot = path.join(temporary, 'extract');
      fs.mkdirSync(extractRoot);
      const lower = record.expected_release_asset.toLowerCase();
      if (lower.endsWith('.tar.gz')) {
        assertArchiveEntries(run('tar', ['-tzf', assetPath], temporary), record.name);
        run('tar', ['-xzf', assetPath, '-C', extractRoot], temporary);
      } else if (lower.endsWith('.zip') || lower.endsWith('.nupkg')) {
        assertArchiveEntries(run('unzip', ['-Z1', assetPath], temporary), record.name);
        run('unzip', ['-q', assetPath, '-d', extractRoot], temporary);
      } else {
        fs.copyFileSync(assetPath, path.join(extractRoot, record.expected_release_asset));
      }
      assertExtractedTree(extractRoot);
      if (record.name === 'psscriptanalyzer') {
        const manifest = findFile(extractRoot, 'PSScriptAnalyzer.psd1');
        const moduleDestination = path.join(destination, 'PSScriptAnalyzer');
        fs.cpSync(path.dirname(manifest), moduleDestination, { recursive: true, errorOnExist: true });
        return;
      }
      const binaryNames = {
        trivy: 'trivy',
        'osv-scanner': 'osv-scanner_linux_amd64',
        zizmor: 'zizmor',
        actionlint: 'actionlint',
        shellcheck: 'shellcheck',
        'gitleaks-cli': 'gitleaks'
      };
      const binary = findFile(extractRoot, binaryNames[record.name]);
      const targetName = record.name === 'gitleaks-cli' ? 'gitleaks' : record.name;
      const target = path.join(destination, targetName);
      fs.copyFileSync(binary, target, fs.constants.COPYFILE_EXCL);
      fs.chmodSync(target, 0o755);
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const destination = path.resolve(args.dest || '.security-tools');
  if (fs.existsSync(destination)) {
    const stat = fs.lstatSync(destination);
    if (!stat.isDirectory() || stat.isSymbolicLink() || fs.readdirSync(destination).length !== 0) {
      throw new Error('Tool destination must be a new or empty non-symlink directory.');
    }
  } else {
    fs.mkdirSync(destination, { recursive: true });
  }
  const lock = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
  const validation = validateToolLock(lock);
  if (!validation.valid) throw new Error(`Tool lock invalid: ${validation.errors.join('; ')}`);
  const requested = String(args.tools || 'trivy,osv-scanner,zizmor,actionlint,shellcheck,psscriptanalyzer,gitleaks-cli')
    .split(',').map((item) => item.trim()).filter(Boolean);
  for (const name of requested) {
    const record = lock.records.find((item) => item.name === name);
    if (!record) throw new Error(`Unknown tool: ${name}`);
    await installRecord(record, destination);
    process.stdout.write(`Installed verified ${record.name} ${record.release}.\n`);
  }
  fs.writeFileSync(path.join(destination, 'installed-lock.json'), `${JSON.stringify({
    lock_version: lock.lock_version,
    installed: requested.map((name) => {
      const record = lock.records.find((item) => item.name === name);
      return { name, release: record.release, commit: record.commit, checksum: record.release_checksum };
    })
  }, null, 2)}\n`, { flag: 'wx' });
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`SECURITY_GATE_INFRA_BLOCKED: ${error.message}\n`);
    process.exitCode = 2;
  });
}

module.exports = { main };
