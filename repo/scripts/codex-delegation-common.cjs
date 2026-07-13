'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CODEX_AGENT_MAX_THREADS = 1;
const CODEX_AGENT_MAX_DEPTH = 1;
const CODEX_V2_RAM_SAFE_HELPERS = 1;
const CODEX_DELEGATION_BEGIN = '# AI-AGENT-TOOLKIT:BEGIN CODEX-DELEGATION-LIMITS v1';
const CODEX_DELEGATION_END = '# AI-AGENT-TOOLKIT:END CODEX-DELEGATION-LIMITS';
const CODEX_HELPER_CAPACITY_BEGIN = '# AI-AGENT-TOOLKIT:BEGIN CODEX-HELPER-CAPACITY v2';
const CODEX_HELPER_CAPACITY_END = '# AI-AGENT-TOOLKIT:END CODEX-HELPER-CAPACITY';
const CODEX_V2_ROOT_GUIDANCE = 'Stay root-only by default. Use one helper only for a concrete correctness benefit, an explicitly requested specialist workflow, or an investigation the root cannot handle well. Never spawn for speed, routine parallelism, workload reduction, or a second opinion. Normal work uses zero helpers and at most one direct helper. Keep final judgment, bound the assignment, and avoid duplicate work.';
const CODEX_V2_HELPER_GUIDANCE = 'Complete only the assigned bounded task. Do not spawn another helper, broaden scope, or duplicate root or sibling work. Return any need for more expertise to the root.';
const CODEX_V2_TARGET_KEYS = [
  'max_concurrent_threads_per_session',
  'root_agent_usage_hint_text',
  'subagent_usage_hint_text',
];
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
def scalar(value):
    return value if type(value) in (int, float, str, bool) or value is None else None

def inspected_values(table, keys):
    values = {}
    for key in keys:
        if type(table) is dict and key in table:
            value = table[key]
            values[key] = {
                'present': True,
                'type': type(value).__name__,
                'exact_int': type(value) is int,
                'value': scalar(value),
            }
        else:
            values[key] = {'present': False}
    return values

agents = parsed.get('agents', None)
features = parsed.get('features', None)
multi_agent_v2 = features.get('multi_agent_v2', None) if type(features) is dict else None
print(json.dumps({
    'ok': True,
    'agents_present': agents is not None,
    'agents_is_table': type(agents) is dict if agents is not None else None,
    'agents_type': type(agents).__name__ if agents is not None else None,
    'values': inspected_values(agents, ('max_threads', 'max_depth')),
    'child_tables': sorted(str(key) for key, value in agents.items() if type(value) is dict) if type(agents) is dict else [],
    'features_present': features is not None,
    'features_is_table': type(features) is dict if features is not None else None,
    'multi_agent_v2_present': multi_agent_v2 is not None,
    'multi_agent_v2_is_table': type(multi_agent_v2) is dict if multi_agent_v2 is not None else None,
    'multi_agent_v2_type': type(multi_agent_v2).__name__ if multi_agent_v2 is not None else None,
    'multi_agent_v2_values': inspected_values(multi_agent_v2, (
        'enabled',
        'max_concurrent_threads_per_session',
        'root_agent_usage_hint_text',
        'subagent_usage_hint_text',
    )),
}, sort_keys=True))
`;

function helpersToTotalThreads(helperCount) {
  if (!Number.isSafeInteger(helperCount) || helperCount < 0) throw new Error('Helper count must be a non-negative integer.');
  return helperCount + 1;
}

function totalThreadsToHelpers(totalThreads) {
  if (!Number.isSafeInteger(totalThreads) || totalThreads < 1) return null;
  return totalThreads - 1;
}

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

function backupRoot(configPath = codexConfigPath()) {
  // Keep backups beside the selected CODEX_HOME's owning home. This keeps
  // isolated editor/test homes self-contained and avoids touching real state.
  return path.join(path.dirname(path.dirname(path.resolve(configPath))), '.ai-agent-toolkit', 'backups', 'codex-delegation');
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
  const failures = [];
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
      failures.push(`${candidate.command}: ${cleanError(result.error)}`);
      continue;
    }
    if (result.status !== 0) {
      failures.push(`${candidate.command}: ${cleanError(result.stderr || `TOML parser exited with ${result.status}`)}`);
      continue;
    }
    try {
      const parsed = JSON.parse(String(result.stdout || '').trim());
      const value = { ...parsed, parser: `${candidate.command}${candidate.args.length ? ` ${candidate.args.join(' ')}` : ''} tomllib` };
      TOML_PARSE_CACHE.set(cacheKey, value);
      return JSON.parse(JSON.stringify(value));
    } catch (error) {
      failures.push(`${candidate.command}: TOML parser returned invalid JSON: ${cleanError(error)}`);
    }
  }
  return {
    ok: false,
    kind: 'parser-unavailable',
    detail: `A Python runtime with the standard-library tomllib parser is required for safe Codex config inspection: ${failures.join('; ') || 'no usable Python command found'}`,
  };
}

module.exports = {
  CODEX_AGENT_MAX_THREADS,
  CODEX_AGENT_MAX_DEPTH,
  CODEX_V2_RAM_SAFE_HELPERS,
  CODEX_DELEGATION_BEGIN,
  CODEX_DELEGATION_END,
  CODEX_HELPER_CAPACITY_BEGIN,
  CODEX_HELPER_CAPACITY_END,
  CODEX_V2_ROOT_GUIDANCE,
  CODEX_V2_HELPER_GUIDANCE,
  CODEX_V2_TARGET_KEYS,
  RESTORE_FLAG,
  cleanError,
  sha256,
  defaultCodexHome,
  codexConfigPath,
  backupRoot,
  parseTomlStructurally,
  helpersToTotalThreads,
  totalThreadsToHelpers,
};
