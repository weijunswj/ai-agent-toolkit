'use strict';

// Continuation guard: finds commands that could resume or fork a Claude or Codex session, then
// admits only two exact forms whose target folder can be verified. Unknown selectors are refused
// even when no prompts are queued. See the source/selector receipts in the focused test.
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

// Candidate reader. A command is a continuation candidate only when a place where a shell runs a
// program could run Claude or Codex with a resume or fork selector. Everything in argument
// position (paths, patterns, ssh remote commands, redirect targets, heredoc bodies fed to ordinary
// programs, echo text) is data. The text is read under every shell that may run it; a reading the
// reader cannot finish falls back to a plain letters check, so unreadable input stays refused.
// Only a candidate reaches the strict reader (parseCommand), which admits two exact forms.
const POSIX = 'posix', POWERSHELL = 'powershell', CMD = 'cmd', CMD_FIRST_LINE = 'cmd-first-line';
const MAX_DEPTH = 8;
const MAX_NESTING = 64;
const UNREADABLE = Object.freeze({ unreadable: true });
// PowerShell refuses to parse a script holding '<' outside a string or comment, so it runs nothing.
const INERT = Object.freeze({ inert: true });
// Invisible, control and look-alike space characters split words for host detection, so
// `codex<NUL>exec` still reads as a codex launch. Splitting never creates a new command position.
const ODD = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u00a0\u00ad\u1680\u180e\u2000-\u200f\u2028-\u202f\u205f-\u206f\u3000\ufeff]/;
// A bare carriage return ends a PowerShell line, and PowerShell or cmd may honour the Unicode line
// breaks, so outside POSIX shells each is read as a new line: that only adds command positions.
const BREAK = /[\r\u0085\u2028\u2029]/;
const PS_QUOTES = Object.freeze({ "'": "'", '\u2018': "'", '\u2019': "'", '\u201a': "'", '\u201b': "'", '"': '"', '\u201c': '"', '\u201d': '"', '\u201e': '"' });

// Programs that run a later word as a command, read by checking every later word.
const WRAPPERS = new Set(['env', 'command', 'builtin', 'exec', 'nohup', 'xargs', 'sudo', 'doas', 'timeout', 'nice', 'ionice', 'setsid',
  'stdbuf', 'time', 'chroot', 'watch', 'strace', 'ltrace', 'nsenter', 'unshare', 'flock', 'chrt', 'taskset', 'unbuffer', 'winpty',
  'busybox', 'start', 'start-process', 'saps', 'call', 'wsl', 'npx', 'pnpx', 'bunx', 'npm', 'pnpm', 'yarn', 'find']);
// cmd keywords whose command comes later on the line.
const CMD_KEYWORDS = new Set(['if', 'for', 'do', 'else']);
// Shells that take a script argument or read a script from stdin.
const RUNNERS = Object.freeze({ bash: POSIX, sh: POSIX, zsh: POSIX, dash: POSIX, ksh: POSIX, ash: POSIX, mksh: POSIX, yash: POSIX, fish: POSIX,
  csh: POSIX, tcsh: POSIX, pwsh: POWERSHELL, powershell: POWERSHELL, cmd: CMD });
// Language interpreters: their script body gets the direct check (host spelling plus selector).
const INTERPRETERS = new Set(['node', 'nodejs', 'python', 'python2', 'python3', 'py', 'pypy', 'pypy3', 'perl', 'ruby', 'php', 'deno', 'lua',
  'luajit', 'bun', 'osascript', 'rscript', 'tclsh', 'wish', 'awk', 'gawk', 'mawk', 'nawk', 'sed', 'jshell', 'groovy', 'cscript', 'wscript']);
// Commands that run their arguments as a script in the same shell.
const EVALUATORS = new Set(['eval', 'iex', 'invoke-expression', 'source', '.']);
// Commands that make a name run a host later.
const DEFINERS = new Set(['alias', 'set-alias', 'sal', 'new-alias', 'nal', 'doskey']);
// Words after which the next word is again a command position.
const POSIX_PREFIX = new Set(['!', '{', 'then', 'else', 'elif', 'if', 'do', 'while', 'until', 'coproc']);
const POWERSHELL_PREFIX = new Set(['return', 'throw', 'exit', 'else', 'try', 'finally', 'do', 'begin', 'process', 'end', 'clean']);
const POWERSHELL_ASSIGN = new Set(['=', '+=', '-=', '*=', '/=', '%=', '??=']);

const CLAUDE_WORD = /(?<![\w.-])claude(?:-code)?(?:\.(?:exe|cmd|ps1))?(?![\w-])/i;
// Claude's long selectors, or a short flag cluster of Claude's own lower-case letters holding -c
// or -r (`-c`, `-pr`), so `-Raw`, `-rf` and `git -C` are not selectors.
const CLAUDE_SELECTOR = /--(?:resume|continue|session-id|fork-session)(?![\w-])|(?:^|[\s'"`(,[=])-(?=[cdhprv]{1,3}(?![\w-]))[dhpv]*[cr]/;
const CODEX_WORD = /(?<![\w.-])codex(?:\.(?:exe|cmd|ps1))?(?![\w-])/i;
const CODEX_SELECTOR = /(?<![\w-])(?:resume|fork)(?![\w-])/i;
// Host spelling plus selector in one script body (interpreters, stdin fed to a shell).
function directCheck(text) {
  return (CLAUDE_WORD.test(text) && CLAUDE_SELECTOR.test(text)) || (CODEX_WORD.test(text) && CODEX_SELECTOR.test(text));
}
// Letters of a host name anywhere, even split by quotes or operators (`"cla"+"ude"`).
function hostLetters(text) { return /claude|codex/i.test(text.replace(/[^a-z0-9]/gi, '')); }
// The same outside folder paths (`C:/Users/x/.codex/...`), which name places, not programs.
function outsidePaths(text) { return hostLetters(text.replace(/\S*[\\/]\S*/g, ' ')); }
function selectorSignal(text) { return CLAUDE_SELECTOR.test(text) || CODEX_SELECTOR.test(text); }
// A computed command name can be built from quoted pieces with noise or format holes between
// them (`("co".Replace("z","")+"dex")`, `("c{0}dex" -f "o")`): the pieces are joined in order,
// format holes filled from the pieces after them, and the name's letters looked for in order.
const HOST_NAMES = Object.freeze(['claude', 'codex']);
const SELECTOR_NAMES = Object.freeze(['resume', 'fork', 'continue', 'session']);
function constructed(text) {
  const pieces = [...text.matchAll(/'([^']*)'|"([^"]*)"/g)].map(m => m[1] ?? m[2]);
  if (!/(?:^|[\s)])-f(?![\w-])/i.test(text) || !pieces.length) return pieces.join('');
  const rest = pieces.slice(1);
  let used = 0;
  const filled = pieces[0].replace(/\{(\d+)\}/g, (_, n) => { used = Math.max(used, Number(n) + 1); return rest[Number(n)] ?? ''; });
  return filled + rest.slice(used).join('');
}
function inOrder(text, name) {
  let at = 0;
  for (let i = 0; i < text.length && at < name.length; i += 1) if (text[i].toLowerCase() === name[at]) at += 1;
  return at === name.length;
}
// Programs whose option values are command lines they run: the values get the direct check.
const COMMAND_OPTIONS = Object.freeze({
  git: /^(?:-c|--config-env|--receive-pack|--upload-pack|--exec)$/,
  rg: /^(?:--pre|--hostname-bin)$/,
  ssh: /^-o$/,
  tar: /^(?:--to-command|--use-compress-program|-I|--checkpoint-action|--info-script|--new-volume-script)$/,
});
// The reading for text no reader could finish: host letters and a selector anywhere in it.
function fallback(text) { return hostLetters(text) && selectorSignal(text); }

const word = (raw, value, extra = {}) => ({ kind: 'word', raw, value, glob: false, quoted: false, ...extra });

// One pass over one shell's syntax. It records every simple command, including those inside
// substitutions, groups, script blocks and unquoted heredoc bodies; it never runs or expands
// anything. Throws UNREADABLE for syntax it cannot finish and INERT for PowerShell that cannot parse.
class ShellReader {
  constructor(text, dialect) { this.t = text; this.d = dialect; this.i = 0; this.commands = []; this.nesting = 0; this.pending = []; }

  read() {
    this.list(null);
    if (this.pending.length) this.bodies();
    return this.commands;
  }

  peek(offset = 0) { return this.t[this.i + offset]; }
  at(s) { return this.t.startsWith(s, this.i); }

  // A bare carriage return is a word character to POSIX shells, which the word splitting above
  // reads as a gap; elsewhere it and the Unicode line breaks end a line.
  lineBreak(c) { return c === '\r' ? this.peek(1) === '\n' || this.d !== POSIX : this.d !== POSIX && BREAK.test(c); }

  blank() {
    const c = this.peek();
    if (c === ' ' || c === '\t' || (c !== undefined && (ODD.test(c) || c === '\r') && !this.lineBreak(c))) return 1;
    const escape = this.d === POSIX ? '\\' : this.d === POWERSHELL ? '`' : '^';
    if (c === escape && (this.peek(1) === '\n' || (this.peek(1) === '\r' && this.peek(2) === '\n'))) return this.peek(1) === '\n' ? 2 : 3;
    return 0;
  }

  // A list of pipelines up to `close` (')' or '}') or the end of the text.
  list(close) {
    if (++this.nesting > MAX_NESTING) throw UNREADABLE;
    let command = this.start(0);
    const finish = () => { if (command.words.length || command.heredocs.length) this.commands.push(command); };
    for (;;) {
      for (let n = this.blank(); n; n = this.blank()) this.i += n;
      const c = this.peek();
      if (c === undefined) { if (close) throw UNREADABLE; finish(); this.nesting -= 1; return; }
      if (c === close && (close === ')' || this.d === POWERSHELL)) { this.i += 1; finish(); this.nesting -= 1; return; }
      if (this.comment()) continue;
      if (c === '\n' || this.lineBreak(c)) {
        this.i += c === '\r' && this.peek(1) === '\n' ? 2 : 1; finish(); command = this.start(0);
        if (this.pending.length) this.bodies();
        continue;
      }
      if (c === ';' || this.at('&&') || this.at('||')) {
        this.i += c === ';' ? (this.peek(1) === ';' || this.peek(1) === '&' ? 2 : 1) : 2; finish(); command = this.start(0); continue;
      }
      if (c === '|') {
        this.i += this.peek(1) === '&' ? 2 : 1; finish();
        const prev = command; command = this.start(prev.stage + 1); command.prev = prev; continue;
      }
      if (c === '&') {
        if (this.d === POWERSHELL && !command.words.length) { this.i += 1; command.words.push({ kind: 'op', raw: '&', value: '&' }); continue; }
        if (this.d === POSIX && this.peek(1) === '>') { this.redirect(command); continue; }
        this.i += 1; finish(); command = this.start(0); continue;
      }
      if (c === ')' || (c === '}' && this.d === POWERSHELL)) {
        if (this.d === POWERSHELL) throw UNREADABLE;
        // A case pattern ends with ')' in POSIX shells, so the next word is a command position
        // again; cmd prints a stray ')' as text.
        this.i += 1; if (this.d === POSIX) { finish(); command = this.start(0); } continue;
      }
      if (this.d === POSIX && (this.at('<(') || this.at('>('))) { command.words.push(this.group(2, ')')); continue; }
      if (this.redirect(command)) continue;
      if (c === '(') {
        if (this.d === CMD && command.words.length) { this.i += 1; continue; }
        command.words.push(this.group(1, ')')); continue;
      }
      if (c === '{' && this.d === POWERSHELL) { command.words.push(this.group(1, '}', 'block')); continue; }
      // A POSIX `{` opening a group or a function body (`f() {`) starts a new command position.
      if ((c === '{' || c === '}') && this.d === POSIX && /^[\s;]?$/.test(this.peek(1) || '')
        && (!command.words.length || (c === '{' && command.words.at(-1).kind === 'group'))) { this.i += 1; finish(); command = this.start(0); continue; }
      if (c === ',' && this.d === POWERSHELL) { this.i += 1; continue; }
      if (this.d === POWERSHELL && this.at('--%') && /[\s]/.test(this.peek(3) || ' ') && command.words.length) {
        // Stop-parsing: the rest of the line goes to the program as written.
        const end = this.t.indexOf('\n', this.i), rest = this.t.slice(this.i + 3, end < 0 ? this.t.length : end);
        for (const piece of rest.split(/\s+/).filter(Boolean)) command.words.push(word(piece, piece));
        this.i = end < 0 ? this.t.length : end; continue;
      }
      const before = this.i, tokens = this.word();
      if (this.i === before) throw UNREADABLE;
      command.words.push(...tokens);
    }
  }

  start(stage) { return { words: [], heredocs: [], stdin: [], stage, dialect: this.d }; }

  comment() {
    if (this.d === POSIX && this.peek() === '#') { this.toLineEnd(); return true; }
    if (this.d === POWERSHELL) {
      if (this.at('<#')) { const end = this.t.indexOf('#>', this.i + 2); if (end < 0) throw UNREADABLE; this.i = end + 2; return true; }
      if (this.peek() === '#') { this.toLineEnd(); return true; }
    }
    return false;
  }
  toLineEnd() { this.i = this.lineEnd(); }

  group(width, close, kind = 'group') {
    const start = this.i; this.i += width;
    this.list(close);
    return { kind, raw: this.t.slice(start, this.i), value: null };
  }

  redirect(command) {
    const rest = this.t.slice(this.i, this.i + 8);
    const m = this.d === POSIX ? /^(?:\d*(?:<<<|<<-|<<|<>|<&|>>|>&|>\||<|>)|&>>?)/.exec(rest)
      : this.d === POWERSHELL ? /^(?:[\d*]?(?:>>|>)(?:&\d)?|<)/.exec(rest) : /^\d?(?:>>|>|<)(?:&\d)?/.exec(rest);
    if (!m) return false;
    if (this.d === POWERSHELL && m[0] === '<') throw INERT;
    this.i += m[0].length;
    // A descriptor duplication (2>&1, >&2) names no file.
    if (/&\d$/.test(m[0])) return true;
    if (/[<>]&$/.test(m[0]) && /^\d|^-/.test(this.peek() || '')) { this.i += 1; return true; }
    for (let n = this.blank(); n; n = this.blank()) this.i += n;
    const target = this.word()[0];
    if (!target) throw UNREADABLE;
    if (m[0].endsWith('<<<')) command.stdin.push(target.value ?? target.raw);
    else if (/<<-?$/.test(m[0])) {
      const doc = { delimiter: target.value ?? target.raw, strip: m[0].endsWith('-'), quoted: target.quoted, body: null };
      command.heredocs.push(doc); this.pending.push(doc);
    }
    return true;
  }

  // Read pending heredoc bodies starting at the current line.
  bodies() {
    for (const doc of this.pending) {
      let body = '';
      for (;;) {
        if (this.i >= this.t.length) break;
        const next = this.t.indexOf('\n', this.i), end = next < 0 ? this.t.length : next;
        let line = this.t.slice(this.i, end).replace(/\r$/, '');
        this.i = next < 0 ? this.t.length : next + 1;
        if (doc.strip) line = line.replace(/^\t+/, '');
        if (line === doc.delimiter) break;
        body += line + '\n';
      }
      doc.body = body;
      // An unquoted delimiter expands substitutions in the body, which run.
      if (!doc.quoted) this.expandable(body, this);
    }
    this.pending = [];
  }

  // Substitutions inside heredoc or here-string text whose quotes are ordinary characters.
  expandable(text, parent) {
    const reader = new ShellReader(text, this.d); reader.nesting = parent.nesting;
    reader.doubleQuotedPart(null);
    parent.commands.push(...reader.commands);
  }

  // One shell word, or several when an odd character or a PowerShell '=' splits it.
  word() {
    const start = this.i, tokens = [];
    let value = '', dynamic = false, glob = false, quoted = false, brace = false;
    const push = () => {
      if (this.i > start || value) tokens.push(word(this.t.slice(start, this.i), dynamic ? null : value, { glob, quoted }));
    };
    const ends = c => c === undefined || c === ' ' || c === '\t' || c === '\n' || ODD.test(c) || (c === '\r')
      || ';&|<>()'.includes(c) || (this.d === POWERSHELL && '{},'.includes(c));
    while (!ends(this.peek())) {
      const c = this.peek();
      if (this.d === POSIX) {
        if (c === '\\') { if (this.peek(1) === '\n') { this.i += 2; continue; } value += this.peek(1) ?? ''; this.i += 2; continue; }
        if (c === "'") { const end = this.t.indexOf("'", this.i + 1); if (end < 0) throw UNREADABLE; value += this.t.slice(this.i + 1, end); this.i = end + 1; quoted = true; continue; }
        if (c === '$' && this.peek(1) === "'") {
          let j = this.i + 2; for (; j < this.t.length && this.t[j] !== "'"; j += 1) if (this.t[j] === '\\') j += 1;
          if (j >= this.t.length) throw UNREADABLE;
          const inner = this.t.slice(this.i + 2, j); if (inner.includes('\\')) dynamic = true; else value += inner;
          this.i = j + 1; quoted = true; continue;
        }
        if (c === '"') { this.i += 1; if (this.doubleQuotedPart('"')) dynamic = true; value += this.literal; quoted = true; continue; }
        if (c === '$' || c === '`') { this.substitution(); dynamic = true; continue; }
        // Wildcards, and brace expansion (`{a,b}`, `{a..b}`), can produce another command name.
        if ('*?['.includes(c)) glob = true;
        if (c === '{') brace = true;
        if (brace && (c === ',' || (c === '.' && this.peek(1) === '.'))) glob = true;
        value += c; this.i += 1; continue;
      }
      if (this.d === POWERSHELL) {
        if (c === '`') { value += this.peek(1) ?? ''; this.i += 2; continue; }
        if (PS_QUOTES[c] === "'") {
          this.i += 1; let text = '';
          for (;;) {
            const d = this.peek(); if (d === undefined) throw UNREADABLE;
            if (PS_QUOTES[d] === "'") { if (PS_QUOTES[this.peek(1)] === "'") { text += "'"; this.i += 2; continue; } this.i += 1; break; }
            text += d; this.i += 1;
          }
          value += text; quoted = true; continue;
        }
        if (PS_QUOTES[c] === '"') { this.i += 1; if (this.doubleQuotedPart('"')) dynamic = true; value += this.literal; quoted = true; continue; }
        if (c === '@' && (this.at("@'") || this.at('@"')) && /^\r?\n/.test(this.t.slice(this.i + 2, this.i + 4))) { if (this.hereString()) dynamic = true; value += this.literal; quoted = true; continue; }
        if (c === '@' && (this.peek(1) === '(' || this.peek(1) === '{')) { this.group(2, this.peek(1) === '(' ? ')' : '}'); dynamic = true; continue; }
        if (c === '$') {
          if (this.peek(1) === '(') { this.group(2, ')'); dynamic = true; continue; }
          if (this.peek(1) === '{') { const end = this.t.indexOf('}', this.i); if (end < 0) throw UNREADABLE; this.i = end + 1; dynamic = true; continue; }
          if (/[\w:?^$]/.test(this.peek(1) || '')) {
            this.i += 1; while (/[\w:]/.test(this.peek() || '')) this.i += 1;
            dynamic = true;
            // `$x=value`: the assignment's right side is a pipeline.
            if (this.peek() === '=' && this.peek(1) !== '=') { push(); tokens.push(word('=', '=')); this.i += 1; return tokens.concat(this.wordOrNothing()); }
            continue;
          }
        }
        if (c === '@' && /[\w]/.test(this.peek(1) || '') && this.i === start) { this.i += 1; while (/\w/.test(this.peek() || '')) this.i += 1; dynamic = true; continue; }
        // PowerShell resolves wildcards in a command path.
        if (c === '*' || c === '?' || c === '[') glob = true;
        value += c; this.i += 1; continue;
      }
      // cmd
      if (c === '^') { value += this.peek(1) ?? ''; this.i += 2; continue; }
      if (c === '"') { const end = this.t.indexOf('"', this.i + 1); const stop = end < 0 ? this.lineEnd() : end; const inner = this.t.slice(this.i + 1, stop); if (/%[^%\s]+%|![^!\s]+!/.test(inner)) dynamic = true; value += inner; this.i = end < 0 ? stop : end + 1; quoted = true; continue; }
      if (c === '%' || c === '!') {
        const m = (c === '%' ? /^%(?:%?~?[a-z]|[^%\s]+%)/i : /^![^!\s]+!/).exec(this.t.slice(this.i, this.i + 256));
        if (m) { this.i += m[0].length; dynamic = true; continue; }
      }
      value += c; this.i += 1;
    }
    push();
    return tokens;
  }
  wordOrNothing() { for (let n = this.blank(); n; n = this.blank()) this.i += n; return []; }
  lineEnd() { const breaks = /[\n\r\u0085\u2028\u2029]/g; breaks.lastIndex = this.i; return breaks.exec(this.t)?.index ?? this.t.length; }

  // POSIX $(...), `...`, ${...} and $name; the caller marks the word dynamic.
  substitution() {
    const c = this.peek();
    if (c === '`') {
      let j = this.i + 1, inner = '';
      for (; j < this.t.length && this.t[j] !== '`'; j += 1) { if (this.t[j] === '\\' && j + 1 < this.t.length) { j += 1; inner += this.t[j]; continue; } inner += this.t[j]; }
      if (j >= this.t.length) throw UNREADABLE;
      this.nested(inner); this.i = j + 1; return;
    }
    if (this.peek(1) === '(') { this.group(2, ')'); return; }
    if (this.peek(1) === '{') {
      // Parameter expansion; its default or alternative words may hold substitutions.
      this.i += 2; let depth = 1;
      while (depth) {
        const d = this.peek(); if (d === undefined) throw UNREADABLE;
        if (d === '}') { depth -= 1; this.i += 1; continue; }
        if (d === '\\') { this.i += 2; continue; }
        if (d === "'") { const end = this.t.indexOf("'", this.i + 1); if (end < 0) throw UNREADABLE; this.i = end + 1; continue; }
        if (d === '"') { this.i += 1; this.doubleQuotedPart('"'); continue; }
        if (d === '$' || d === '`') { if (this.peek(1) === '{') { depth += 1; this.i += 2; continue; } this.substitution(); continue; }
        this.i += 1;
      }
      return;
    }
    this.i += 1;
    if (/[\w@*#?$!-]/.test(this.peek() || '')) { if (/\w/.test(this.peek())) while (/\w/.test(this.peek() || '')) this.i += 1; else this.i += 1; }
  }

  nested(text) {
    const reader = new ShellReader(text, this.d); reader.nesting = this.nesting;
    this.commands.push(...reader.read());
  }

  // Reads a double-quoted part (or, with close null, expandable text to its end). Sets
  // this.literal and returns true when the part expands something.
  doubleQuotedPart(close) {
    let literal = '', dynamic = false;
    for (;;) {
      const c = this.peek();
      if (c === undefined) { if (close) throw UNREADABLE; break; }
      if (close && (c === close || (this.d === POWERSHELL && PS_QUOTES[c] === '"'))) {
        if (this.d === POWERSHELL && PS_QUOTES[this.peek(1)] === '"') { literal += '"'; this.i += 2; continue; }
        this.i += 1; break;
      }
      if (this.d === POSIX) {
        if (c === '\\') { const d = this.peek(1); if (d !== undefined && '$`"\\\n'.includes(d)) { if (d !== '\n') literal += d; this.i += 2; continue; } literal += c; this.i += 1; continue; }
        if (c === '`' || (c === '$' && /[({\w@*#?$!-]/.test(this.peek(1) || ''))) { this.substitution(); dynamic = true; continue; }
      } else {
        if (c === '`') { literal += this.peek(1) ?? ''; this.i += 2; continue; }
        if (c === '$' && this.peek(1) === '(') { this.group(2, ')'); dynamic = true; continue; }
        if (c === '$' && /[\w{:?^$]/.test(this.peek(1) || '')) {
          if (this.peek(1) === '{') { const end = this.t.indexOf('}', this.i); if (end < 0) throw UNREADABLE; this.i = end + 1; }
          else { this.i += 1; while (/[\w:]/.test(this.peek() || '')) this.i += 1; }
          dynamic = true; continue;
        }
      }
      literal += c; this.i += 1;
    }
    this.literal = literal;
    return dynamic;
  }

  // PowerShell @'...'@ and @"..."@; the expandable form may hold subexpressions.
  hereString() {
    const quote = this.peek(1); this.i += 2;
    if (this.peek() === '\r') this.i += 1;
    this.i += 1;
    const bodyStart = this.i;
    for (let line = this.i; ; ) {
      if (line >= this.t.length) throw UNREADABLE;
      if (this.t.startsWith(quote + '@', line)) {
        const body = this.t.slice(bodyStart, Math.max(bodyStart, line - 1));
        this.i = line + 2; this.literal = body;
        if (quote === '"') { const before = this.commands.length; this.expandable(body, this); return this.commands.length > before || /\$/.test(body); }
        return false;
      }
      const next = this.t.indexOf('\n', line);
      if (next < 0) throw UNREADABLE;
      line = next + 1;
    }
  }
}

// The shells that may run a text: the one the call names, else the tool's own shell, else bash,
// PowerShell and the first line under cmd. An unrecognised shell is read under all three in full.
function dialectsOf(input, host) {
  const shell = input?.tool_input?.shell;
  if (shell !== undefined) {
    if (!knownShell(input)) return [POSIX, POWERSHELL, CMD];
    const name = shell.split(/[\\/]/).pop().toLowerCase().replace(/\.exe$/, '');
    return [/^(?:powershell|pwsh)$/.test(name) ? POWERSHELL : name === 'cmd' ? CMD : POSIX];
  }
  if (input?.tool_name === 'PowerShell') return [POWERSHELL];
  if (input?.tool_name === 'Bash' && host === 'claude') return [POSIX];
  // cmd runs only the first line of a command it is handed.
  return [POSIX, POWERSHELL, CMD_FIRST_LINE];
}

const leaf = value => value.split(/[\\/]/).pop().toLowerCase().replace(/\.(?:exe|cmd|bat|ps1)$/, '');
const raws = words => words.map(w => w.raw).join(' ');

// Decides whether any command the reader found could resume or fork a session. `seen` names the
// first one found, for the refusal text.
class CandidateFinder {
  constructor({ text, stdin = [] }) { this.full = text; this.stdin = stdin; this.seen = null; this.assigned = new Map(); }

  // Literal variable assignments (`x=co`, `$h = 'codex'`), so a computed command word can be
  // read with them filled in.
  remember(commands) {
    for (const { words, dialect } of commands) {
      const add = (name, value) => this.assigned.set(name.toLowerCase(), [...(this.assigned.get(name.toLowerCase()) || []), value]);
      if (dialect === POWERSHELL && /^\$\w+$/.test(words[0]?.raw || '') && words[1]?.raw === '=' && typeof words[2]?.value === 'string') add(words[0].raw.slice(1), words[2].value);
      for (const w of words) {
        const m = w.kind === 'word' && typeof w.value === 'string' ? /^([A-Za-z_]\w*)=([\s\S]*)$/.exec(w.value) : null;
        if (!m || !/^[A-Za-z_]\w*=/.test(w.raw)) break;
        add(m[1], m[2]);
      }
    }
  }
  expand(raw) { return raw.replace(/\$\{?(?:env:)?([A-Za-z_]\w*)\}?/gi, (m, name) => (this.assigned.get(name.toLowerCase()) || [m]).join('')); }

  found(seen) { this.seen ??= seen; return true; }

  text(text, dialect, depth = 0) {
    if (depth > MAX_DEPTH || text.length > LIMITS.command) return fallback(text) && this.found('a command Toolkit could not read');
    let commands;
    try { commands = new ShellReader(text, dialect).read(); }
    catch (error) {
      if (error === INERT) return false;
      if (error === UNREADABLE || error instanceof RangeError) return fallback(text) && this.found('a command Toolkit could not read');
      throw error;
    }
    this.remember(commands);
    return commands.some(command => this.command(command, depth));
  }

  // An argument list run without a shell (Codex's shell tool).
  argv(values, depth = 0) {
    const words = values.map(value => word(value, value, { quoted: true }));
    return this.at(words, 0, { words, heredocs: [], stdin: this.stdin, stage: 0, dialect: null }, { depth, argv: true });
  }

  command(command, depth) {
    const { words, dialect } = command;
    let i = 0, call = false;
    for (;;) {
      const w = words[i];
      if (!w) return false;
      if (w.kind === 'op') { i += 1; call = true; continue; }
      if (w.kind !== 'word') {
        if (call && w.kind === 'group') return this.dynamic(words.slice(i), command);
        return dialect === POWERSHELL && !call ? this.expression(command) : false;
      }
      if (call) break;
      if (dialect === POSIX) {
        if (/^[A-Za-z_]\w*\+?=/.test(w.raw)) { i += 1; continue; }
        if (w.value !== null && POSIX_PREFIX.has(w.value)) { i += 1; continue; }
      } else if (dialect === POWERSHELL) {
        // A quoted host path at statement start is a parse error, not a launch; read it as one anyway.
        if (/^["'\u2018-\u201e]/.test(w.raw) && w.value !== null && hostOf(w.value)) break;
        if (/^[$[@\d"'\u2018-\u201e]/.test(w.raw)) {
          const assign = words.findIndex((x, n) => n > i && x.kind === 'word' && !x.quoted && POWERSHELL_ASSIGN.has(x.raw));
          if (assign < 0) return this.expression(command);
          i = assign + 1; continue;
        }
        if (w.value !== null && POWERSHELL_PREFIX.has(w.value.toLowerCase())) { i += 1; continue; }
        // Dot-sourcing runs a script file or block in this scope; at() reads it like `source`.
        if (w.raw === '.') break;
      } else if (dialect === CMD && w.value?.startsWith('@')) {
        words[i] = { ...w, value: w.value.slice(1) };
      }
      break;
    }
    return this.at(words, i, command, { depth });
  }

  // PowerShell expression statements run no program, except through .NET calls such as
  // [Diagnostics.Process]::Start(); those get the direct check.
  expression(command) {
    const text = raws(command.words);
    return /::|\.(?:start|invoke)\s*\(/i.test(text) && directCheck(text) && this.found('a .NET process start');
  }

  // What an earlier pipeline stage feeds this command: a quoted string, a here-string or a
  // variable holding one is known text (`literal`); anything else is only the stages' own text.
  upstream(command) {
    const stages = [];
    for (let at = command.prev; at; at = at.prev) stages.unshift(at);
    const first = command.prev?.words;
    let literal = null;
    if (first?.length === 1 && first[0].kind === 'word') {
      const w = first[0];
      if (w.quoted && w.value !== null) literal = w.value;
      else if (/^\$\w+$/.test(w.raw) && this.assigned.has(w.raw.slice(1).toLowerCase())) literal = this.assigned.get(w.raw.slice(1).toLowerCase()).join('\n');
    }
    return { literal, raw: stages.map(stage => raws(stage.words)).join(' | ') };
  }

  // A command word that is computed at run time: refused only with host letters outside folder
  // paths, or in the word's own assigned or built value, and a selector after it.
  dynamic(words, command) {
    if (words[1]?.raw === '=') return false;
    const own = words[0].raw, after = raws(words.slice(1));
    const selector = selectorSignal(after) || selectorSignal(own);
    // A name assigned elsewhere (`$h='codex'; & $h resume`), or built in the command word itself.
    const assigned = (outsidePaths(this.full) || hostLetters(this.expand(own))) && selector;
    const built = HOST_NAMES.some(name => inOrder(constructed(own), name))
      && (selector || SELECTOR_NAMES.some(name => inOrder(constructed(after), name)));
    return (assigned || built) && this.found('a command name computed at run time');
  }

  at(words, i, command, { depth, viaWrapper = false, xargs = false, argv = false }) {
    const w = words[i];
    if (!w) return false;
    if (w.kind !== 'word') return w.kind === 'group' ? this.dynamic(words.slice(i), command) : false;
    if (w.value === null || w.glob) return this.dynamic(words.slice(i), command);
    const pieces = w.value.split(ODD);
    const value = pieces[0], args = pieces.length > 1 ? [...pieces.slice(1).filter(Boolean).map(p => word(p, p)), ...words.slice(i + 1)] : words.slice(i + 1);
    // A dotted file named like a host (`~/.claude -r`) is read as the host too.
    const host = hostOf(value) || hostOf(value.split(/[\\/]/).pop().replace(/^\.+/, ''));
    if (host) return this.launch(host, value, args, { viaWrapper, xargs });
    const name = leaf(value);
    if (WRAPPERS.has(name) || (CMD_KEYWORDS.has(name) && command.dialect === CMD)) {
      if (depth >= MAX_DEPTH) return fallback(raws(words.slice(i))) && this.found('a deeply wrapped command');
      for (let j = i + 1; j < words.length; j += 1) {
        const x = words[j];
        if (x.kind !== 'word') continue;
        if (x.value === null || x.glob) { if (this.dynamic(words.slice(j), command)) return true; continue; }
        const inner = leaf(x.value.split(ODD)[0]);
        if (hostOf(x.value.split(ODD)[0]) || WRAPPERS.has(inner) || RUNNERS[inner] || INTERPRETERS.has(inner) || EVALUATORS.has(inner)) {
          if (this.at(words, j, command, { depth: depth + 1, viaWrapper: true, xargs: name === 'xargs', argv })) return true;
        }
      }
      return false;
    }
    if (RUNNERS[name]) return this.runner(RUNNERS[name], name, args, command, depth, argv);
    if (INTERPRETERS.has(name)) {
      // The script is its arguments, a heredoc or here-string, or known text piped in. Text an
      // earlier stage builds gets the letters check over those stages.
      const up = command.prev ? this.upstream(command) : null;
      const body = [raws(args), ...command.heredocs.map(doc => doc.body || ''), ...command.stdin, up?.literal ?? ''].join('\n');
      return (directCheck(body) || (up && up.literal === null && fallback(up.raw))) && this.found(`a ${name} script`);
    }
    if (EVALUATORS.has(name)) {
      // `... | iex` runs its piped input.
      if (command.prev && !args.length) {
        const up = this.upstream(command);
        return (up.literal !== null ? this.text(up.literal, command.dialect ?? POWERSHELL, depth + 1) : fallback(up.raw)) && this.found(`text piped into ${name}`);
      }
      if (name === '.' || name === 'source') {
        if (args.some(x => x.kind !== 'word' || x.value === null)) return this.dynamic(words.slice(i), command);
        // The sourced file may have been written earlier in the same command.
        return fallback(this.full) && this.found(`${name} on a script file`);
      }
      if (args.some(x => x.kind !== 'word' || x.value === null)) {
        const own = raws(words.slice(i));
        return ((hostLetters(own) && selectorSignal(own)) || this.dynamic(words.slice(i), command)) && this.found(`${name} on computed text`);
      }
      const script = args.filter(x => !/^-c(?:o(?:m(?:m(?:a(?:n(?:d)?)?)?)?)?)?$/i.test(x.value));
      return this.text(script.map(x => x.value).join(' '), command.dialect ?? POWERSHELL, depth + 1);
    }
    const options = COMMAND_OPTIONS[name];
    if (options) {
      for (let n = 0; n < args.length; n += 1) {
        const v = args[n].kind === 'word' ? args[n].value ?? args[n].raw : '';
        const eq = v.startsWith('-') ? v.indexOf('=') : -1;
        let value = null;
        if (options.test(eq > 0 ? v.slice(0, eq) : v)) value = eq > 0 ? v.slice(eq + 1) : (args[n + 1]?.value ?? args[n + 1]?.raw ?? '');
        else if (name === 'git' && /^(?:ext|fd)::/.test(v)) value = v;
        // rg runs its --pre program on each searched path, so the paths are its arguments.
        if (value !== null && name === 'rg' && /^--pre(?:=|$)/.test(v)) value += ' ' + raws(args.slice(n + 1));
        if (value !== null && directCheck(value)) return this.found(`a command run by ${name}`);
      }
      return false;
    }
    if (DEFINERS.has(name)) return args.some(x => x.kind === 'word' && x.value !== null && x.value.split(/[=\s]/).some(p => hostOf(p.replace(/^['"]|['"]$/g, '')))) && this.found('an alias for a host');
    return false;
  }

  launch(host, value, args, { viaWrapper, xargs }) {
    if (xargs) return this.found(`${leaf(value)} through xargs`);
    const words = args.filter(x => x.kind === 'word');
    // An unquoted computed argument can become a selector at run time.
    if (args.some(x => x.kind !== 'word' || (x.value === null && !x.quoted))) return this.found(`${leaf(value)} with computed arguments`);
    const values = words.filter(x => x.value !== null).map(x => x.value);
    if (!viaWrapper && HELP_FORMS[host]?.some(form => form.length === values.length && form.every((arg, n) => arg === values[n]))) return false;
    const pieces = values.flatMap(v => v.split(viaWrapper ? /[\s,]+/ : /,/)).filter(Boolean);
    const selector = host === 'claude'
      ? pieces.find(p => /^(?:--(?:resume|continue|session-id|fork-session)(?:=|$)|-(?!-)[a-z]*[rc][a-z]*(?:=|$))/i.test(p))
      : pieces.find(p => p === 'resume' || p === 'fork');
    return selector !== undefined && this.found(`${leaf(value)} ${selector.split('=')[0]}`);
  }

  // A shell given a script, or reading one from stdin or a heredoc.
  runner(dialect, name, args, command, depth, argv) {
    if (depth >= MAX_DEPTH) return fallback(raws(args)) && this.found('a deeply nested shell');
    const words = args.filter(x => x.kind === 'word');
    const computed = words.findIndex(x => x.value === null);
    if (computed >= 0) return this.dynamic(words.slice(computed), command);
    // script: null reads stdin, 'file' runs a file Toolkit cannot see, else the script words.
    let script = null;
    if (dialect === POSIX) {
      const n = words.findIndex(x => /^-[A-Za-z]*c[A-Za-z]*$/.test(x.value));
      if (n >= 0) script = words.slice(n + 1, n + 2);
      else if (words.some(x => !/^[-+]/.test(x.value))) script = 'file';
    } else if (dialect === POWERSHELL) {
      const encoded = words.findIndex(x => /^-(?:e(?:n(?:c(?:o(?:d(?:e(?:d(?:c(?:o(?:m(?:m(?:a(?:n(?:d)?)?)?)?)?)?)?)?)?)?)?)?)?|ec)$/i.test(x.value));
      if (encoded >= 0) {
        // -EncodedCommand carries the script as Base64 of UTF-16LE text: read it decoded.
        const value = words[encoded + 1]?.value || '';
        if (this.text(Buffer.from(value, 'base64').toString('utf16le'), dialect, depth + 1)) return true;
        words.splice(encoded, 2);
      }
      const n = words.findIndex(x => /^-c(?:o(?:m(?:m(?:a(?:n(?:d)?)?)?)?)?)?$/i.test(x.value));
      if (n >= 0) script = words.slice(n + 1);
      else if (words.some(x => /^-f(?:i(?:l(?:e)?)?)?$/i.test(x.value))) script = 'file';
      else if (words.some(x => !x.value.startsWith('-'))) {
        // A positional script may follow options that take a value, so read from each plain word.
        for (let k = 0; k < words.length; k += 1) {
          if (!words[k].value.startsWith('-') && this.text(words.slice(k).map(x => x.value).join(' '), dialect, depth + 1)) return true;
        }
        return false;
      }
      if (Array.isArray(script) && script.length === 1 && script[0].value === '-') script = null;
    } else {
      const n = words.findIndex(x => /^\/[ck]/i.test(x.value));
      if (n >= 0) {
        const attached = words[n].value.slice(2);
        script = [...(attached ? [word(attached, attached)] : []), ...words.slice(n + 1)];
      }
    }
    if (script === 'file') return false;
    if (script?.length) {
      let text = script.map(x => x.value).join(' ');
      if (dialect === CMD && /^".*"$/s.test(text)) text = text.slice(1, -1);
      return this.text(text, dialect, depth + 1);
    }
    // No script argument: stdin, a heredoc or a here-string is the script.
    for (const doc of command.heredocs) if (doc.body && this.text(doc.body, dialect, depth + 1)) return true;
    for (const input of command.stdin) if (this.text(input, dialect, depth + 1)) return true;
    // Known text piped in is read as the script; text an earlier stage builds gets the letters check.
    if (command.prev) {
      const up = this.upstream(command);
      if (up.literal !== null) return this.text(up.literal, dialect, depth + 1);
      return fallback(up.raw) && this.found(`a script piped into ${name}`);
    }
    return this.stdin.length > 0 && fallback(this.stdin.join('\n')) && this.found(`a script piped into ${name}`);
  }
}

// True when the call could resume or fork a session; `seen` says what was found.
function candidate(text, input, host = null) {
  const args = input?.tool_input;
  const fields = args && typeof args === 'object' && !Array.isArray(args)
    ? ['command', 'cmd'].map(field => args[field]).filter(value => (typeof value === 'string' && value) || (Array.isArray(value) && value.length)) : [];
  const stdin = fields.length ? [args.input, args.patch].filter(value => typeof value === 'string' && value) : [];
  const finder = new CandidateFinder({ text: typeof text === 'string' ? text : '', stdin });
  // The fields the gate's text came from are read as the host gives them: a string as shell text,
  // an argument list as the program and its arguments, so no shell ever re-reads its unquoted words.
  const readings = fields.length ? fields : [finder.full];
  const hit = readings.some(value => Array.isArray(value)
    ? (value.every(item => typeof item === 'string') ? finder.argv(value) : fallback(JSON.stringify(value)) && finder.found('a command Toolkit could not read'))
    : dialectsOf(input, host).some(dialect => (dialect === CMD_FIRST_LINE ? finder.text(value.split('\n')[0], CMD) : finder.text(value, dialect))));
  return hit ? { seen: finder.seen } : null;
}

function knownShell(input) {
  const shell = input?.tool_input?.shell;
  return shell === undefined || (typeof shell === 'string'
    && /^(?:cmd|powershell|pwsh|bash|sh)(?:\.exe)?$/i.test(shell.split(/[\\/]/).pop()));
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

// host is the hook entry point's own host ('claude' or 'codex'), or null when unknown.
function parse(text, input, { host = null } = {}) {
  const found = candidate(text, input, host);
  if (!found) return NONE;
  const result = parseCommand(text, input);
  return result === UNKNOWN && found.seen ? Object.freeze({ ...UNKNOWN, seen: found.seen }) : result;
}

// The strict reader: a candidate is admitted only in one of two exact forms.
function parseCommand(text, input) {
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
  constructor({ environment = process.env, io = fs, spawn = spawnSync, host = null } = {}) {
    this.environment = environment; this.io = io; this.spawn = spawn; this.host = host;
  }

  resolve(text, input) {
    const parsed = parse(text, input, { host: this.host });
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

module.exports = Object.freeze({ ContinuationResolver, TranscriptReader, LIMITS, parse, executionDirectory });
