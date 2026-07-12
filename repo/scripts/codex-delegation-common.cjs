'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CODEX_AGENT_MAX_THREADS = 1;
const CODEX_AGENT_MAX_DEPTH = 1;
const CODEX_DELEGATION_BEGIN = '# AI-AGENT-TOOLKIT:BEGIN CODEX-DELEGATION-LIMITS v1';
const CODEX_DELEGATION_END = '# AI-AGENT-TOOLKIT:END CODEX-DELEGATION-LIMITS';
const RESTORE_FLAG = '--restore-codex-delegation-backup';
const TOML_PARSE_CACHE = new Map();

const PYTHON_TOML_INSPECT = String.raw`
import json, sys, tomllib
raw = sys.stdin.buffer.read()
try:
    text = raw.decode('utf-8')
except UnicodeDecodeError as exc:
    print(json.dumps({'ok': False, 'kind': 'encoding', 'detail': str(exc)}))
    raise SystemExit(0)
try:
    parsed = tomllib.loads(text)
except Exception as exc:
    print(json.dumps({'ok': False, 'kind': 'parse', 'detail': str(exc)}))
    raise SystemExit(0)
agents = parsed.get('agents', None)
if agents is None:
    print(json.dumps({'ok': True, 'agents_present': False}))
    raise SystemExit(0)
if type(agents) is not dict:
    print(json.dumps({'ok': True, 'agents_present': True, 'agents_is_table': False, 'agents_type': type(agents).__name__}))
    raise SystemExit(0)
values = {}
for key in ('max_threads', 'max_depth'):
    if key in agents:
        value = agents[key]
        values[key] = {
            'present': True,
            'type': type(value).__name__,
            'exact_int': type(value) is int,
            'value': value if type(value) in (int, float, str, bool) or value is None else None,
        }
    else:
        values[key] = {'present': False}
children = sorted(str(key) for key, value in agents.items() if type(value) is dict)
print(json.dumps({
    'ok': True,
    'agents_present': True,
    'agents_is_table': True,
    'values': values,
    'child_tables': children,
}, sort_keys=True))
`;

function cleanError(error) {
  return String(error && error.message ? error.message : error || 'unknown error').replace(/[\r\n]+/g, ' ').slice(0, 300);
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function defaultCodexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

function codexConfigPath() {
  return path.join(defaultCodexHome(), 'config.toml');
}

function backupRoot() {
  return path.join(os.homedir(), '.ai-agent-toolkit', 'backups', 'codex-delegation');
}

function pythonCandidates() {
  const explicit = String(process.env.AI_AGENT_TOOLKIT_PYTHON || '').trim();
  const candidates = [];
  if (explicit) candidates.push({ command: explicit, args: [] });
  if (process.platform === 'win32') candidates.push({ command: 'py', args: ['-3'] });
  candidates.push({ command: 'python3', args: [] }, { command: 'python', args: [] });
  const seen = new Set();
  return candidates.filter((entry) => {
    const key = `${entry.command}\u0000${entry.args.join('\u0000')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function parseTomlStructurally(bytes) {
  const input = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || '');
  const cacheKey = sha256(input);
  if (TOML_PARSE_CACHE.has(cacheKey)) return JSON.parse(JSON.stringify(TOML_PARSE_CACHE.get(cacheKey)));
  for (const candidate of pythonCandidates()) {
    const result = spawnSync(candidate.command, [...candidate.args, '-c', PYTHON_TOML_INSPECT], {
      input,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10000,
      maxBuffer: 1024 * 1024,
    });
    if (result.error && result.error.code === 'ENOENT') continue;
    if (result.error) {
      return { ok: false, kind: 'parser-runtime', detail: cleanError(result.error) };
    }
    if (result.status !== 0) {
      return {
        ok: false,
        kind: 'parser-runtime',
        detail: cleanError(result.stderr || `TOML parser exited with ${result.status}`),
      };
    }
    try {
      const parsed = JSON.parse(String(result.stdout || '').trim());
      const value = { ...parsed, parser: `${candidate.command}${candidate.args.length ? ` ${candidate.args.join(' ')}` : ''} tomllib` };
      TOML_PARSE_CACHE.set(cacheKey, value);
      return JSON.parse(JSON.stringify(value));
    } catch (error) {
      return { ok: false, kind: 'parser-runtime', detail: `TOML parser returned invalid JSON: ${cleanError(error)}` };
    }
  }
  return {
    ok: false,
    kind: 'parser-unavailable',
    detail: 'A Python runtime with the standard-library tomllib parser is required for safe Codex config inspection.',
  };
}

module.exports = {
  CODEX_AGENT_MAX_THREADS,
  CODEX_AGENT_MAX_DEPTH,
  CODEX_DELEGATION_BEGIN,
  CODEX_DELEGATION_END,
  RESTORE_FLAG,
  cleanError,
  sha256,
  defaultCodexHome,
  codexConfigPath,
  backupRoot,
  parseTomlStructurally,
};
