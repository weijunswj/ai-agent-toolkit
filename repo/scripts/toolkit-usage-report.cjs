#!/usr/bin/env node
'use strict';

// Usage reader: token and tool counts per agent session, read from Claude Code and Codex session
// transcripts, so the runs that spend usage limits can be measured instead of guessed.
//
//   node repo/scripts/toolkit-usage-report.cjs --transcripts <dir|file>... [--codex <dir|file>...]
//        [--since <ISO time>] [--tag <session id>=<run type>]... --out <report.json>
//
// --transcripts takes Claude Code transcripts (~/.claude/projects/<folder>/<session>.jsonl; a folder
// is searched for .jsonl files, helper transcripts under <session>/subagents/ included). --codex takes
// Codex rollouts (~/.codex/sessions/...). --since counts only activity at or after that time.
// --tag sets a session's run type when its transcript cannot show it (a coordinator, for example).
//
// Per session the report holds: source, session id, run type, models (turns per model), first and
// last activity, model turns (helper turns among them), the four token counts, cache hit share, tool
// calls by name, repeat reads of one file (each path kept only as an id that matches within this
// report), shell sleeps, wake-ups scheduled and helpers started, plus totals per run type. A field a
// source's transcript cannot show is null, never 0.
//
// Privacy: the report and console never hold prompt, reply, thinking, tool input, tool result or file
// text. Text is read in memory only to count and classify; names are kept only in a plain character
// set, and the finished report is scanned with the shared secret patterns before it is written: any
// match refuses the whole report, naming only the pattern. Paths are keyed with a random key made for
// this run and never stored, so a path id cannot be looked up from a guessed path.
//
// One reply can be written as several transcript lines (one per content block), each repeating the
// reply's message id and usage; it counts once, with the largest value seen per token field. A Codex
// token_count event counts only when its running total moved, since Codex repeats unchanged events,
// and its input count includes the cached part, which is split out.
//
// Exit 0 written, 1 refused (secret-shaped text in the report), 2 bad arguments or unreadable input.
// When a transcript file cannot be read part way, the report is still written, counts it under
// skipped.unreadable_files, and the exit is 2 so a baseline is never taken from partial input unseen.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { scanText } = require('../../skills/secure-ci-cd/scripts/secret-patterns.cjs');

const SCHEMA = 'toolkit-usage-report/v1';
const RUN_TYPES = Object.freeze(['hourly', 'daily', 'weekly', 'coordinator', 'g0', 'g1', 'g2', 'train', 'other']);
const USAGE = 'Usage: node repo/scripts/toolkit-usage-report.cjs --transcripts <dir|file>... [--codex <dir|file>...] [--since <ISO time>] [--tag <session id>=<run type>]... --out <report.json>';

// Names that reach the report (models, tools) must look like names: no spaces, slashes or @ (so no
// path or email address passes), except a model's dated suffix such as @20250514.
const NAME = /^[A-Za-z0-9][A-Za-z0-9_.:\-[\]]{0,127}(?:@[0-9]{8})?$/;
const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const UNRECOGNISED = 'unrecognised';
// A shell command that waits: `sleep <n>` as its own command.
const SLEEP = /(?:^|[\s;&|(])sleep\s+\d/;
const WAKEUP_TOOLS = new Set(['ScheduleWakeup', 'CronCreate', 'mcp__claude-code-remote__send_later']);
const HELPER_TOOLS = new Set(['Agent', 'Task']);
// Only the first user messages can carry the brief or the thread title.
const OPENING_MESSAGES = 5;
const TOP_REPEATS = 5;

class UsageError extends Error {}

function safeName(value) {
  return typeof value === 'string' && NAME.test(value) ? value : UNRECOGNISED;
}

function timeOf(value) {
  if (typeof value !== 'string') return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function count(value) {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function addCount(map, key, by = 1) {
  map.set(key, (map.get(key) || 0) + by);
}

function sortedObject(map) {
  return Object.fromEntries([...map.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

// The run type a session's opening messages show. The first coordinator relay's note, or a plain
// prompt's first line, names the gate (`Gate: G0|G1|G2`); otherwise the thread title (the initiator
// message of a wake, other than the host's own from="system" line) names a scheduled run or a merge
// train. Free text elsewhere, such as
// project instructions that mention hourly runs, never counts.
function classifyRunType(texts) {
  const list = Array.isArray(texts) ? texts.filter((text) => typeof text === 'string') : [];
  const relay = list.find((text) => text.includes('<relay from="coordinator"'));
  if (relay) {
    const note = /<note>([\s\S]*?)<\/note>/.exec(relay);
    const gate = note && /^[ \t]*Gate:[ \t]*G([012])\b/m.exec(note[1]);
    if (gate) return `g${gate[1]}`;
  } else {
    for (const text of list) {
      const first = text.split(/\r?\n/).find((line) => line.trim());
      const gate = first && /^[ \t]*Gate:[ \t]*G([012])\b/.exec(first);
      if (gate) return `g${gate[1]}`;
    }
  }
  for (const text of list) {
    const titles = /<message\b([^>]*)\brole="initiator"([^>]*)>([^<]{1,300})<\/message>/g;
    let match;
    while ((match = titles.exec(text)) !== null) {
      // The host's own opening line (from="system") is not the thread title.
      if (/\bfrom="system"/.test(`${match[1]} ${match[2]}`)) continue;
      const title = match[3];
      if (/\bhourly\b/i.test(title)) return 'hourly';
      if (/\bdaily\b/i.test(title)) return 'daily';
      if (/\bweekly\b/i.test(title)) return 'weekly';
      if (/\btrain\b/i.test(title)) return 'train';
      return 'other';
    }
  }
  return 'other';
}

function messageText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  if (content.some((block) => block && block.type === 'tool_result')) return null;
  const parts = content.filter((block) => block && (block.type === 'text' || block.type === 'input_text') && typeof block.text === 'string');
  return parts.length ? parts.map((block) => block.text).join('\n') : null;
}

function commandText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.filter((part) => typeof part === 'string').join(' ');
  return '';
}

// One session's counts. Text passed in is used to count or classify and is never kept, except the
// opening messages, which are held only until the run type is worked out.
class SessionUsage {
  constructor(source, id) {
    this.source = source;
    this.id = id;
    this.models = new Map();
    this.tools = new Map();
    this.replies = new Map();
    this.toolIds = new Set();
    this.reads = new Map();
    this.opening = [];
    this.openingDone = false;
    this.firstAt = null;
    this.lastAt = null;
    this.turns = 0;
    this.sleeps = 0;
    this.wakeups = source === 'claude' ? 0 : null;
    this.helpers = source === 'claude' ? 0 : null;
    this.tokens = { input: 0, cache_creation: 0, cache_read: 0, output: 0 };
  }

  seen(ms) {
    if (this.firstAt === null || ms < this.firstAt) this.firstAt = ms;
    if (this.lastAt === null || ms > this.lastAt) this.lastAt = ms;
  }

  opener(text) {
    if (this.openingDone || typeof text !== 'string') return;
    this.opening.push(text);
    if (this.opening.length >= OPENING_MESSAGES) this.openingDone = true;
  }

  // A Claude Code reply line. Lines of one reply share its message id; each field keeps its largest
  // value, since a line written before the reply finished can carry a smaller output count.
  reply(key, model, usage, sidechain) {
    let entry = this.replies.get(key);
    if (!entry) {
      entry = { model: safeName(model), sidechain, input: 0, cache_creation: 0, cache_read: 0, output: 0 };
      this.replies.set(key, entry);
    }
    const u = usage && typeof usage === 'object' ? usage : {};
    entry.input = Math.max(entry.input, count(u.input_tokens));
    entry.cache_creation = Math.max(entry.cache_creation, count(u.cache_creation_input_tokens));
    entry.cache_read = Math.max(entry.cache_read, count(u.cache_read_input_tokens));
    entry.output = Math.max(entry.output, count(u.output_tokens));
  }

  // A Codex model call, from a token_count event whose running total moved.
  call(model, last) {
    const input = count(last.input_tokens);
    const cached = Math.min(count(last.cached_input_tokens), input);
    this.tokens.input += input - cached;
    this.tokens.cache_read += cached;
    this.tokens.output += count(last.output_tokens);
    this.turns += 1;
    addCount(this.models, safeName(model));
  }

  tool(callId, name, { readKey = null, command = '' } = {}) {
    if (callId) {
      if (this.toolIds.has(callId)) return;
      this.toolIds.add(callId);
    }
    const safe = safeName(name);
    addCount(this.tools, safe);
    if (readKey) addCount(this.reads, readKey);
    if (SLEEP.test(command)) this.sleeps += 1;
    if (this.wakeups !== null && WAKEUP_TOOLS.has(name)) this.wakeups += 1;
    if (this.helpers !== null && HELPER_TOOLS.has(name)) this.helpers += 1;
  }

  // The session's row. Safe to call more than once: reply totals are added to copies.
  report(tags) {
    const tokens = { ...this.tokens };
    const models = new Map(this.models);
    let turns = this.turns;
    let helperTurns = 0;
    for (const entry of this.replies.values()) {
      turns += 1;
      if (entry.sidechain) helperTurns += 1;
      addCount(models, entry.model);
      for (const field of Object.keys(tokens)) tokens[field] += entry[field];
    }
    const prompt = tokens.input + tokens.cache_creation + tokens.cache_read;
    const repeats = [...this.reads.entries()].filter(([, reads]) => reads > 1);
    const result = {
      source: this.source,
      session_id: this.id,
      run_type: tags.get(this.id) || classifyRunType(this.opening),
      models: sortedObject(models),
      first_at: this.firstAt === null ? null : new Date(this.firstAt).toISOString(),
      last_at: this.lastAt === null ? null : new Date(this.lastAt).toISOString(),
      assistant_turns: turns,
      subagent_turns: this.source === 'claude' ? helperTurns : null,
      tokens,
      cache_hit_share: prompt > 0 ? Number((tokens.cache_read / prompt).toFixed(4)) : null,
      tool_calls: sortedObject(this.tools),
      repeat_reads: this.source === 'claude' ? {
        paths: repeats.length,
        extra_reads: repeats.reduce((sum, [, reads]) => sum + reads - 1, 0),
        top: [...repeats].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, TOP_REPEATS).map(([pathId, reads]) => ({ path_id: pathId, reads })),
      } : null,
      sleeps: this.sleeps,
      wakeups: this.wakeups,
      subagents: this.helpers,
    };
    return result;
  }
}

// All sessions of one run. Reads transcripts line by line; nothing it reads is printed.
class UsageReport {
  constructor({ since = null, tags = new Map(), pathKey = crypto.randomBytes(32) } = {}) {
    this.since = since;
    this.tags = tags;
    this.pathKey = pathKey;
    this.sessions = new Map();
    this.files = 0;
    this.malformed = 0;
    this.unreadable = 0;
  }

  sessionId(raw, file) {
    if (typeof raw === 'string' && SESSION_ID.test(raw)) return raw;
    const base = path.basename(file, '.jsonl');
    const fromName = /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(base);
    if (fromName) return fromName[1];
    return `file-${crypto.createHmac('sha256', this.pathKey).update(path.resolve(file)).digest('hex').slice(0, 16)}`;
  }

  session(source, id) {
    const key = `${source}:${id}`;
    if (!this.sessions.has(key)) this.sessions.set(key, new SessionUsage(source, id));
    return this.sessions.get(key);
  }

  pathId(filePath) {
    const normal = filePath.replace(/\\/g, '/');
    return crypto.createHmac('sha256', this.pathKey).update(normal).digest('hex').slice(0, 16);
  }

  counted(ms) {
    return ms !== null && (this.since === null || ms >= this.since);
  }

  async readLines(file, onLine) {
    let stream;
    try {
      stream = fs.createReadStream(file, { encoding: 'utf8' });
      const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
      this.files += 1;
      for await (const line of lines) {
        if (!line.trim()) continue;
        let record;
        try { record = JSON.parse(line); } catch { record = null; }
        if (!record || typeof record !== 'object' || Array.isArray(record)) {
          this.malformed += 1;
          continue;
        }
        onLine(record);
      }
    } catch {
      this.unreadable += 1;
    } finally {
      if (stream) stream.destroy();
    }
  }

  async addClaudeFile(file) {
    await this.readLines(file, (record) => {
      if (record.type !== 'user' && record.type !== 'assistant') return;
      const message = record.message && typeof record.message === 'object' ? record.message : null;
      if (!message) return;
      const session = this.session('claude', this.sessionId(record.sessionId, file));
      const ms = timeOf(record.timestamp);
      if (record.type === 'user') {
        // The first relay arrives inside the opening meta message, so meta messages count too.
        if (!record.isSidechain) session.opener(messageText(message.content));
        if (this.counted(ms)) session.seen(ms);
        return;
      }
      if (message.model === '<synthetic>' || !this.counted(ms)) return;
      session.seen(ms);
      const key = message.id || record.requestId || record.uuid;
      if (typeof key === 'string') session.reply(key, message.model, message.usage, record.isSidechain === true);
      for (const block of Array.isArray(message.content) ? message.content : []) {
        if (!block || block.type !== 'tool_use') continue;
        const input = block.input && typeof block.input === 'object' ? block.input : {};
        session.tool(typeof block.id === 'string' ? block.id : null, block.name, {
          readKey: block.name === 'Read' && typeof input.file_path === 'string' ? this.pathId(input.file_path) : null,
          command: block.name === 'Bash' ? commandText(input.command) : '',
        });
      }
    });
  }

  async addCodexFile(file) {
    let session = null;
    let model = null;
    let lastTotal = null;
    const current = () => session || (session = this.session('codex', this.sessionId(null, file)));
    await this.readLines(file, (record) => {
      const payload = record.payload && typeof record.payload === 'object' ? record.payload : {};
      const ms = timeOf(record.timestamp);
      if (record.type === 'session_meta') {
        if (!session) session = this.session('codex', this.sessionId(payload.id, file));
        return;
      }
      if (record.type === 'turn_context') {
        model = payload.model;
        return;
      }
      if (record.type === 'response_item') {
        if (payload.type === 'message' && payload.role === 'user') {
          current().opener(messageText(payload.content));
          if (this.counted(ms)) current().seen(ms);
          return;
        }
        if (!this.counted(ms)) return;
        if (payload.type === 'function_call' || payload.type === 'custom_tool_call' || payload.type === 'local_shell_call') {
          current().seen(ms);
          let command = '';
          if (payload.type === 'function_call' && typeof payload.arguments === 'string') {
            try { command = commandText((JSON.parse(payload.arguments) || {}).command); } catch { command = ''; }
          } else if (payload.type === 'local_shell_call') {
            command = commandText(payload.action && payload.action.command);
          }
          const name = payload.type === 'local_shell_call' ? 'local_shell' : payload.name;
          current().tool(typeof payload.call_id === 'string' ? payload.call_id : null, name, { command });
        }
        return;
      }
      if (record.type === 'event_msg' && payload.type === 'token_count' && payload.info && typeof payload.info === 'object') {
        const total = payload.info.total_token_usage;
        const last = payload.info.last_token_usage;
        if (!total || typeof total !== 'object' || !last || typeof last !== 'object') return;
        const signature = ['input_tokens', 'cached_input_tokens', 'output_tokens', 'reasoning_output_tokens', 'total_tokens'].map((field) => count(total[field])).join(',');
        if (signature === lastTotal) return;
        lastTotal = signature;
        if (!this.counted(ms)) return;
        current().seen(ms);
        current().call(model, last);
      }
    });
  }

  toJSON() {
    const sessions = [...this.sessions.values()]
      .map((session) => session.report(this.tags))
      .filter((session) => session.assistant_turns > 0 || Object.keys(session.tool_calls).length > 0)
      .sort((a, b) => (a.first_at || '').localeCompare(b.first_at || '') || a.session_id.localeCompare(b.session_id));
    const byRunType = {};
    for (const session of sessions) {
      const row = byRunType[session.run_type] || (byRunType[session.run_type] = { sessions: 0, assistant_turns: 0, tokens: { input: 0, cache_creation: 0, cache_read: 0, output: 0 } });
      row.sessions += 1;
      row.assistant_turns += session.assistant_turns;
      for (const field of Object.keys(row.tokens)) row.tokens[field] += session.tokens[field];
    }
    return {
      schema: SCHEMA,
      since: this.since === null ? null : new Date(this.since).toISOString(),
      path_ids: 'keyed with a random key made for this report; ids match only within this report',
      files_read: this.files,
      skipped: { malformed_lines: this.malformed, unreadable_files: this.unreadable },
      totals: { sessions: sessions.length, by_run_type: Object.fromEntries(Object.entries(byRunType).sort(([a], [b]) => a.localeCompare(b))) },
      sessions,
    };
  }
}

function listJsonl(target) {
  let stat;
  try { stat = fs.lstatSync(target); } catch { throw new UsageError('a --transcripts or --codex path does not exist'); }
  if (stat.isFile()) return [target];
  if (!stat.isDirectory()) throw new UsageError('a --transcripts or --codex path is not a file or folder');
  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) found.push(full);
    }
  };
  walk(target);
  return found;
}

function parseArgs(argv) {
  const options = { transcripts: [], codex: [], since: null, tags: new Map(), out: null };
  let list = null;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) throw new UsageError(`${arg} needs a value`);
      index += 1;
      return next;
    };
    if (arg === '--transcripts' || arg === '--codex') {
      list = arg === '--transcripts' ? options.transcripts : options.codex;
      list.push(value());
    } else if (arg === '--since') {
      list = null;
      const ms = /^\d{4}-\d{2}-\d{2}(?:T[\d:.]+(?:Z|[+-]\d{2}:\d{2}))?$/.test(argv[index + 1] || '') ? Date.parse(value()) : NaN;
      if (!Number.isFinite(ms)) throw new UsageError('--since needs an ISO time, for example 2026-11-15T00:00:00Z');
      options.since = ms;
    } else if (arg === '--tag') {
      list = null;
      const match = /^([^=]+)=(.+)$/.exec(value());
      if (!match || !SESSION_ID.test(match[1]) || !RUN_TYPES.includes(match[2])) throw new UsageError(`--tag needs <session id>=<run type>, run type one of ${RUN_TYPES.join(', ')}`);
      options.tags.set(match[1], match[2]);
    } else if (arg === '--out') {
      list = null;
      options.out = value();
    } else if (list && !arg.startsWith('--')) {
      list.push(arg);
    } else {
      throw new UsageError('unknown argument');
    }
  }
  if (!options.transcripts.length && !options.codex.length) throw new UsageError('name at least one --transcripts or --codex path');
  if (!options.out) throw new UsageError('--out is required');
  return options;
}

async function main(argv = process.argv.slice(2), io = { stdout: process.stdout, stderr: process.stderr }) {
  let options;
  let claudeFiles;
  let codexFiles;
  try {
    options = parseArgs(argv);
    claudeFiles = options.transcripts.flatMap(listJsonl);
    codexFiles = options.codex.flatMap(listJsonl);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    io.stderr.write(`USAGE REPORT: ${error.message}\n${USAGE}\n`);
    return 2;
  }
  const report = new UsageReport({ since: options.since, tags: options.tags });
  for (const file of claudeFiles) await report.addClaudeFile(file);
  for (const file of codexFiles) await report.addCodexFile(file);
  const json = report.toJSON();
  const text = `${JSON.stringify(json, null, 2)}\n`;
  const findings = scanText(text);
  if (findings.length) {
    const labels = [...new Set(findings.map((finding) => finding.label))].join(', ');
    io.stderr.write(`USAGE REPORT: refused, the report would hold text shaped like a secret (${labels}); nothing was written\n`);
    return 1;
  }
  try {
    fs.writeFileSync(options.out, text, { mode: 0o600 });
  } catch {
    io.stderr.write('USAGE REPORT: could not write the --out file\n');
    return 2;
  }
  const notes = [];
  if (json.skipped.malformed_lines) notes.push(`${json.skipped.malformed_lines} unreadable lines skipped`);
  if (json.skipped.unreadable_files) notes.push(`${json.skipped.unreadable_files} files could not be read`);
  io.stdout.write(`USAGE REPORT: ${json.totals.sessions} sessions from ${json.files_read} files${notes.length ? ` (${notes.join(', ')})` : ''}\n`);
  return json.skipped.unreadable_files ? 2 : 0;
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code; }, () => {
    process.stderr.write('USAGE REPORT: failed while reading transcripts\n');
    process.exitCode = 2;
  });
}

module.exports = Object.freeze({ RUN_TYPES, SCHEMA, SessionUsage, UsageReport, classifyRunType, parseArgs, main });
