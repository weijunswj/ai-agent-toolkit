'use strict';

// A deliberately small admission reader, never a shell interpreter. Unknown selectors are
// refused even when no prompts are queued. See the source/selector receipts in the focused test.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMITS = Object.freeze({ command: 32768, bytes: 8 * 1024 * 1024, record: 256 * 1024, records: 32768 });
const UNKNOWN = Object.freeze({ status: 'UNKNOWN', reason: 'TARGET_UNVERIFIED' });
const NONE = Object.freeze({ status: 'NOT_CONTINUATION' });
const HOST = /^(claude(?:-code)?|codex)(?:\.exe|\.cmd|\.ps1)?$/i;
// Exact help-only forms verified on the frozen native CLIs in isolated homes. Do not infer
// that a help-looking prompt after --, or a wrapped/compound command, exits before a session.
const HELP_FORMS = Object.freeze({
  codex: Object.freeze([['resume', '--help'], ['resume', '-h'], ['exec', 'resume', '--help'], ['e', 'resume', '--help'], ['fork', '--help'], ['help', 'resume'], ['help', 'exec', 'resume']].map(Object.freeze)),
  claude: Object.freeze([['--resume', '--help'], ['--resume', '-h'], ['-r', '--help'], ['--resume', '--version']].map(Object.freeze)),
});
function hostOf(word) { return HOST.exec(word.split(/[\\/]/).pop())?.[1].toLowerCase().replace('claude-code', 'claude'); }

// Classification is intentionally broader than admission. An embedded/wrapped or malformed
// invocation must not fall out of enforcement merely because the literal reader cannot parse it.
function broadVisible(text) {
  const direct = (/\bclaude(?:-code)?(?:\.(?:exe|cmd|ps1))?\b/i.test(text)
      && /--(?:resume|continue|session-id|fork-session)\b|(?:^|[\s;&|()'"`])-(?!-)[a-z]*[rc][a-z]*(?=$|[\s=;&|()'"`])/i.test(text))
    || (/\bcodex(?:\.(?:exe|cmd|ps1))?\b/i.test(text) && /\b(?:resume|fork)\b/i.test(text));
  if (direct) return true;
  // Quote concatenation and shell escapes can split an executable or selector spelling.
  // This shadow is detection only: the strict reader below never admits those forms.
  // No left host boundary is required here because removing a Windows path separator
  // can attach its directory name to the executable. Extra matches refuse conservatively.
  const shadow = text.replace(/[\\`^]\r?\n/g, '')
    .replace(/%[^%\r\n]*%|![^!\r\n]*!|\$\{[^}$\r\n]*\}/g, '')
    .replace(/["'\\`^]/g, '');
  // Expansion can compute the missing host or selector. A remaining static part is
  // enough to refuse a dynamic candidate; it is never enough to verify its target.
  if (/[$`%!^]/.test(text) && /(?:claude(?:-code)?|codex|resume|fork)\b|--(?:continue|session-id|fork-session)\b/i.test(shadow)) return true;
  return (/claude(?:-code)?(?:\.(?:exe|cmd|ps1))?\b/i.test(shadow)
      && /--(?:resume|continue|session-id|fork-session)\b|(?:^|[\s;&|()])-(?!-)[a-z]*[rc][a-z]*(?=$|[\s=;&|()])/i.test(shadow))
    || (/codex(?:\.(?:exe|cmd|ps1))?\b/i.test(shadow) && /\b(?:resume|fork)\b/i.test(shadow));
}
function knownShell(input) {
  const shell = input?.tool_input?.shell;
  return shell === undefined || (typeof shell === 'string'
    && /^(?:cmd|powershell|pwsh|bash|sh)(?:\.exe)?$/i.test(shell.split(/[\\/]/).pop()));
}
function visible(text, input) {
  if (!broadVisible(text)) return false;
  if (!knownShell(input)) return true;
  const lexed = tokens(text, { literalData: true });
  if (!lexed) return true;
  const { words, operators } = lexed;
  // Literal data in these exact command forms cannot launch a host. Keep this exception
  // narrower than a shell parser: no control operators, substitutions, wrappers or git
  // options other than the sole grep operand. All existing generic path/owner guards run first.
  if (operators.size === 0 && (words[0] === 'echo'
    || (words.length === 3 && words[0] === 'git' && words[1] === 'log' && words[2].startsWith('--grep=')))) return false;
  // cmd treats single quotes as ordinary argument characters. They may delimit only
  // simple data above, never an executable, help vector, directory or native selector.
  if (lexed.singleQuoted) return true;
  if (operators.size === 0 && HELP_FORMS[hostOf(words[0] || '')]?.some(form => form.length === words.length - 1 && form.every((arg, i) => arg === words[i + 1]))) return false;
  let hostSeen = false;
  for (let i = 0; i < words.length; i += 1) {
    const host = hostOf(words[i]);
    if (!host) {
      // A wrapped command remains visible, even beside another ordinary host invocation.
      if (broadVisible(words[i])) return true;
      continue;
    }
    hostSeen = true;
    const end = words.findIndex((word, index) => index > i && operators.has(index));
    const args = words.slice(i + 1, end < 0 ? undefined : end);
    if (host === 'claude' && args.some(word => /^(?:--(?:resume|continue|session-id|fork-session)(?:=|$)|-(?!-)[a-z]*[rc][a-z]*(?:=|$))/i.test(word))) return true;
    if (host === 'codex' && args.some(word => word === 'resume' || word === 'fork')) return true;
  }
  return !hostSeen;
}

function tokens(text, { literalData = false } = {}) {
  if (!text || text.length > LIMITS.command || /[^\x20-\x7e]/.test(text)
    || /[$`%!^]/.test(text) || (!literalData && /[?*#<>|{}\[\]]/.test(text))) return null;
  const result = [], operators = new Set();
  let word = '', quote = null, started = false, closed = false, singleQuoted = false;
  const flush = () => { if (started) result.push(word); word = ''; started = false; closed = false; };
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      if (quote === "'" && c !== quote && /[^a-z0-9 _./:=+\-]/i.test(c)) return null;
      if (quote === '"' && c === '\\' && /["\\]/.test(text[i + 1] || '')) return null;
      if (c === quote) { quote = null; closed = true; } else word += c;
      started = true; continue;
    }
    // No concatenated/doubled/escaped quote interpretation: shells disagree on these.
    if (closed && !/[ ;&]/.test(c)) return null;
    if (c === '"' || c === "'") {
      if (started && !/^--[a-z][a-z0-9-]*=$/i.test(word)) return null;
      if (c === "'") { if (!literalData) return null; singleQuoted = true; }
      quote = c; started = true; continue;
    }
    // An unquoted backslash is a POSIX escape, including inside selector spellings.
    // Windows paths therefore need a complete double-quoted value in this common subset.
    if (c === '\\') return null;
    if (/[?*#<>|{}\[\]()]/.test(c)) return null;
    if (c === ' ') { flush(); continue; }
    if (c === ';' || c === '&') {
      flush();
      operators.add(result.length);
      if (c === '&' && text[i + 1] === '&') { result.push('&&'); i += 1; }
      else result.push(c);
      continue;
    }
    word += c; started = true;
  }
  if (quote) return null;
  flush();
  return { words: result, operators, singleQuoted };
}

function absolute(value) {
  // Reject drive-relative and foreign-platform paths rather than interpreting them as local.
  return typeof value === 'string' && value !== '' && path.isAbsolute(value)
    && !/^[A-Za-z]:(?![\\/])/.test(value)
    && (process.platform === 'win32' ? /^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+)/.test(value) : !/^[A-Za-z]:/.test(value));
}
function directory(value, base) {
  if (typeof value !== 'string' || !value || value === '-' || value.startsWith('~') || /^[A-Za-z]:(?![\\/])/.test(value)) throw new Error('DIRECTORY');
  if (process.platform !== 'win32' && /^(?:[A-Za-z]:|\\)/.test(value)) throw new Error('DIRECTORY');
  return path.resolve(base, value);
}
function same(a, b) { return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b; }

// Check every parent, not just the leaf. This also refuses junctions and alias paths.
function regularPath(file, kind, io = fs) {
  if (!absolute(file) || !same(io.realpathSync.native(file), path.resolve(file))) throw new Error('PATH');
  let current = path.resolve(file);
  for (;;) {
    const stat = io.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error('LINK');
    if (current === path.resolve(file) && !(kind === 'file' ? stat.isFile() : stat.isDirectory())) throw new Error('KIND');
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}

function executionDirectory(input) {
  const args = input?.tool_input || {};
  const values = [args.workdir, args.cwd].filter(value => value !== undefined);
  if (values.some(value => !absolute(value)) || (values.length === 2 && !same(path.resolve(values[0]), path.resolve(values[1])))) throw new Error('WORKDIR');
  const cwd = values[0] ?? input?.cwd;
  if (!absolute(cwd)) throw new Error('WORKDIR');
  return path.resolve(cwd);
}

function parse(text, input) {
  if (!visible(text, input)) return NONE;
  if (!knownShell(input)) return UNKNOWN;
  const lexed = tokens(text);
  if (!lexed) return UNKNOWN;
  const { words, operators } = lexed;
  try {
    let cwd = executionDirectory(input);
    const targets = [cwd];
    let i = 0;
    while (/^(?:cd|pushd|chdir|set-location)$/i.test(words[i] || '')) {
      i += 1;
      if (/^(?:\/d|-literalpath|-path)$/i.test(words[i] || '')) i += 1;
      cwd = directory(words[i++], cwd); targets.push(cwd);
      if (!operators.has(i) || !['&&', ';'].includes(words[i++])) return UNKNOWN;
    }
    if (operators.has(i) && words[i] === '&') i += 1;
    const executable = words[i++];
    const host = executable && hostOf(executable);
    if (!host || (/[\\/]/.test(executable) && !absolute(executable))) return UNKNOWN;
    const rest = words.slice(i);
    if (rest.some((word, index) => operators.has(i + index))) return UNKNOWN;
    if (host === 'claude') {
      let selector = null, fork = false, print = false;
      const prompts = [];
      for (let n = 0; n < rest.length; n += 1) {
        const word = rest[n];
        if (word === '--fork-session' && !fork) { fork = true; continue; }
        if (['-p', '--print'].includes(word) && !print) { print = true; continue; }
        const match = /^(--resume|-r)(?:=(.*))?$/.exec(word);
        if (match && selector === null) { selector = match[2] ?? rest[++n]; continue; }
        if (word.startsWith('-')) return UNKNOWN;
        prompts.push(word);
      }
      // UUIDs, names, implicit continue, session-id and pickers lack a qualified native
      // selection reader here. Only the documented exact transcript-path form is admitted.
      if (!absolute(selector) || !selector.endsWith('.jsonl') || prompts.length > 1) return UNKNOWN;
      return { status: 'PARSED', host, selector, targets, cwd };
    }
    let cd = null, mode = null, exec = false, last = false;
    for (let n = 0; n < rest.length; n += 1) {
      const word = rest[n];
      if (word === '-C' || word === '--cd' || word.startsWith('--cd=')) {
        if (cd !== null) return UNKNOWN;
        cd = word.startsWith('--cd=') ? word.slice(5) : rest[++n];
      } else if (['exec', 'e'].includes(word) && !exec && mode === null) exec = true;
      else if (['resume', 'fork'].includes(word) && mode === null) mode = word;
      else if (word === '--last' && !last) last = true;
      else return UNKNOWN;
    }
    // Interactive --last expands to linked worktrees in the frozen native source. Until that
    // entire candidate set is resolved, it is unknown. exec/e resume --last filters the latest
    // native cwd against config.cwd itself. No prompt/config/remote overrides are admitted.
    if (!exec || mode !== 'resume' || !last) return UNKNOWN;
    if (cd !== null) { cwd = directory(cd, cwd); targets.push(cwd); }
    return { status: 'VERIFIED', host, proof: 'directory-filtered-last', targets: [...new Set(targets)], cwd };
  } catch { return UNKNOWN; }
}

// Isolated acquisition boundary: only directories leave this reader. It never emits
// transcript records, parse errors, prompts or arbitrary exception text.
class TranscriptReader {
  constructor({ io = fs } = {}) { this.io = io; }

  read({ file, projects }) {
    let descriptor;
    try {
      const relative = path.relative(projects, file);
      const parts = relative.split(path.sep);
      const id = path.basename(file, '.jsonl');
      if (parts.length !== 2 || parts.some(part => !part || part === '..') || !UUID.test(id)) return UNKNOWN;
      regularPath(projects, 'directory', this.io);
      regularPath(file, 'file', this.io);
      descriptor = this.io.openSync(file, 'r');
      const before = this.io.fstatSync(descriptor);
      if (!before.isFile() || before.size === 0 || before.size > LIMITS.bytes) return UNKNOWN;
      // Read at most the engineering limit, even if the file grows after stat.
      const buffer = Buffer.alloc(before.size + 1);
      const size = this.io.readSync(descriptor, buffer, 0, buffer.length, 0);
      if (size !== before.size) return UNKNOWN;
      const lines = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size)).split('\n');
      if (lines.at(-1) === '') lines.pop();
      if (lines.length > LIMITS.records) return UNKNOWN;
      const targets = new Set();
      let messages = 0;
      for (const line of lines) {
        if (!line || Buffer.byteLength(line) > LIMITS.record) return UNKNOWN;
        const row = JSON.parse(line);
        if (!row || typeof row !== 'object' || Array.isArray(row)) return UNKNOWN;
        if (row.sessionId !== undefined && row.sessionId !== id) return UNKNOWN;
        if (row.cwd !== undefined) {
          if (row.sessionId !== id || !absolute(row.cwd)) return UNKNOWN;
          regularPath(row.cwd, 'directory', this.io);
          targets.add(path.resolve(row.cwd));
        }
        if (row.type === 'user' || row.type === 'assistant') {
          if (row.sessionId !== id || !absolute(row.cwd) || !UUID.test(row.uuid || '') || !Number.isFinite(Date.parse(row.timestamp))
            || !row.message || typeof row.message !== 'object' || Array.isArray(row.message) || row.isSidechain === true) return UNKNOWN;
          messages += 1;
        }
      }
      const after = this.io.fstatSync(descriptor);
      const current = this.io.lstatSync(file);
      regularPath(file, 'file', this.io);
      for (const key of ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs']) if (before[key] !== after[key] || before[key] !== current[key]) return UNKNOWN;
      if (!messages || !targets.size) return UNKNOWN;
      return { status: 'VERIFIED', host: 'claude', proof: 'exact-transcript', targets: [...targets] };
    } catch { return UNKNOWN; }
    finally { if (descriptor !== undefined) try { this.io.closeSync(descriptor); } catch { /* no decision can be created here */ } }
  }
}

class ContinuationResolver {
  constructor({ environment = process.env, io = fs, spawn = spawnSync } = {}) {
    this.environment = environment; this.io = io; this.spawn = spawn;
  }

  resolve(text, input) {
    const parsed = parse(text, input);
    if (parsed.status === 'NOT_CONTINUATION' || parsed.status === 'UNKNOWN') return parsed;
    try {
      for (const target of parsed.targets) regularPath(target, 'directory', this.io);
      if (parsed.status === 'VERIFIED') return parsed;
      const home = this.environment.CLAUDE_CONFIG_DIR || path.join(this.environment.USERPROFILE || this.environment.HOME || os.homedir(), '.claude');
      if (!absolute(home)) return UNKNOWN;
      const result = this.spawn(process.execPath, [__filename, '--metadata'], {
        input: JSON.stringify({ file: parsed.selector, projects: path.join(home, 'projects') }),
        encoding: 'utf8', windowsHide: true, timeout: 5000, maxBuffer: 256 * 1024,
        // The acquisition worker needs no host/session/credential environment.
        env: {},
      });
      if (result.status !== 0 || result.error || result.stderr) return UNKNOWN;
      const metadata = JSON.parse(result.stdout);
      if (metadata.status !== 'VERIFIED' || !Array.isArray(metadata.targets) || metadata.targets.length === 0 || metadata.targets.some(target => !absolute(target))) return UNKNOWN;
      return { status: 'VERIFIED', host: parsed.host, proof: 'exact-transcript', targets: [...new Set([...parsed.targets, ...metadata.targets])] };
    } catch { return UNKNOWN; }
  }
}

if (require.main === module) {
  let result = UNKNOWN;
  try {
    const raw = fs.readFileSync(0, 'utf8');
    if (process.argv[2] === '--metadata' && raw.length <= LIMITS.command) result = new TranscriptReader().read(JSON.parse(raw));
  } catch { /* emit only the fixed refusal */ }
  process.stdout.write(JSON.stringify(result));
}

module.exports = Object.freeze({ ContinuationResolver, TranscriptReader, LIMITS, parse, visible, executionDirectory });
