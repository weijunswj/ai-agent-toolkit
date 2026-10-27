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
const CANDIDATE_SPELLINGS = Object.freeze([
  ...['codex', 'claude', 'claude-code'].flatMap(host => ['', '.exe', '.cmd', '.ps1'].map(suffix => host + suffix)),
  'resume', 'fork', '--resume', '--continue', '--session-id', '--fork-session',
]);
// Exact help-only forms verified on the frozen native CLIs in isolated homes. Do not infer
// that a help-looking prompt after --, or a wrapped/compound command, exits before a session.
const HELP_FORMS = Object.freeze({
  codex: Object.freeze([['resume', '--help'], ['resume', '-h'], ['exec', 'resume', '--help'], ['e', 'resume', '--help'], ['fork', '--help'], ['help', 'resume'], ['help', 'exec', 'resume']].map(Object.freeze)),
  claude: Object.freeze([['--resume', '--help'], ['--resume', '-h'], ['-r', '--help'], ['--resume', '--version']].map(Object.freeze)),
});
function hostOf(word) { return HOST.exec(word.split(/[\\/]/).pop())?.[1].toLowerCase().replace('claude-code', 'claude'); }

// Fixed read-only machines; reachability belongs to one classification call only.
const CANDIDATE_MACHINES = Object.freeze(CANDIDATE_SPELLINGS.map(word => {
  const characters = Object.create(null);
  for (let p = 0; p < word.length; p += 1) characters[word[p]] = (characters[word[p]] || 0) | (1 << p);
  return Object.freeze({ word, characters: Object.freeze(characters), end: 1 << word.length, full: (1 << (word.length + 1)) - 1 });
}));

// Equivalent to the fixed numeric-hole grammar, without regex backtracking on a
// long digit run lacking a closing brace. Literal parts and holes stay separate.
function formatParts(text) {
  const parts = []; let start = 0;
  for (let i = 0; i < text.length;) {
    if (text[i] !== '{' || text[i + 1] < '0' || text[i + 1] > '9' || text[i + 1] === undefined) { i += 1; continue; }
    let end = i + 2;
    while (end < text.length && text[end] !== '{' && text[end] !== '}') end += 1;
    if (text[end] === '}') { parts.push(text.slice(start, i), null); start = end + 1; i = start; }
    else i = end;
  }
  parts.push(text.slice(start)); return parts;
}

function quoteAtoms(text) {
  const atoms = []; let single = -1, double = -1;
  // Every quote opens a potential span to the next quote of its own kind.
  // Each character belongs to at most two spans, including wrapper overlaps.
  for (let i = text.length - 1; i >= 0; i -= 1) {
    const quote = text[i];
    if (quote !== "'" && quote !== '"') continue;
    const end = quote === "'" ? single : double;
    if (end >= 0) atoms.push(text.slice(i + 1, end));
    if (quote === "'") single = i; else double = i;
  }
  return atoms.reverse();
}

function atomPattern(raw) {
  const space = c => c === ' ' || (c >= '\x09' && c <= '\x0d');
  let first = 0, last = raw.length;
  while (first < last && space(raw[first])) first += 1;
  while (last > first && space(raw[last - 1])) last -= 1;
  const steps = []; let literals = 0, letters = false, holes = false;
  for (const part of formatParts(raw.slice(first, last))) {
    if (part === null) { holes = true; if (steps.at(-1) !== null) steps.push(null); continue; }
    for (let c of part) {
      if (c >= 'A' && c <= 'Z') c = String.fromCharCode(c.charCodeAt(0) + 32);
      if ((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === '-' || c === '.') {
        steps.push(c); literals += 1; if (c >= 'a' && c <= 'z') letters = true;
        if (literals > 15) return null;
      } else if (!'_.:{},\\\x60^'.includes(c)) return null;
    }
  }
  // Literal hyphens, digits and dots can complete a split spelling. A template
  // hole alone cannot supply native evidence, even beside a literal suffix.
  return literals && (!holes || letters) ? { steps, literals } : null;
}

function advancePrefixes(machine, states, pattern) {
  if (!pattern || pattern.literals > machine.word.length) return states;
  let active = states;
  for (const step of pattern.steps) {
    if (!active) break;
    // A hole consumes any span inside this one fixed spelling. All literal
    // characters must match, and the entire contributing atom must be consumed.
    active = step === null ? machine.full ^ ((active & -active) - 1)
      : (active & (machine.characters[step] || 0)) << 1;
  }
  // Skipping an atom retains every alternative and every accepting endpoint.
  return states | active;
}

function orderedEvidence(text, atoms = quoteAtoms(text)) {
  const states = CANDIDATE_MACHINES.map(() => 1);
  for (const raw of atoms) {
    const pattern = atomPattern(raw);
    for (let k = 0; k < CANDIDATE_MACHINES.length; k += 1) {
      states[k] = advancePrefixes(CANDIDATE_MACHINES[k], states[k], pattern);
      if (states[k] & CANDIDATE_MACHINES[k].end) return true;
    }
  }
  return false;
}

// Preserve the old non-overlapping format-template signal independently of the
// ordered whole-atom projection. Its full-word compatibility is not authority.
function legacyTemplateEvidence(text) {
  let opening = -1;
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] !== '"' && text[i] !== "'") continue;
    if (opening >= 0) {
      const raw = text.slice(opening + 1, i);
      const split = formatParts(raw);
      if (!/[\r\n]/.test(raw) && split.includes(null)) {
        opening = -1;
        const parts = split.filter(part => part !== null).map(part => part.toLowerCase());
        if (!parts.some(part => /[a-z]/.test(part))) continue;
        if (CANDIDATE_SPELLINGS.some(word => {
          if (!word.startsWith(parts[0]) || !word.endsWith(parts.at(-1))) return false;
          let offset = 0;
          return parts.every(part => { const index = word.indexOf(part, offset); if (index < 0) return false; offset = index + part.length; return true; });
        })) return true;
        continue;
      }
    }
    opening = i;
  }
  return false;
}

// Classification is intentionally broader than admission. An embedded/wrapped or malformed
// invocation must not fall out of enforcement merely because the literal reader cannot parse it.
function broadVisible(text, executableScript = false) {
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
  // Word syntax outside the literal grammar can compute the other spelling, including
  // grouping, arrays, addition, formatting and join without expansion characters.
  // Reuse the reader's boundary rather than maintaining a second syntax allowlist.
  // Pipeline/redirection punctuation alone does not build a spelling. Whole visible
  // continuations still use the unmodified text and strict reader below.
  if (executableScript || !tokens(text.replace(/[|<>]/g, ' '), { literalData: true })) {
    // Detection only: join visible literal fragments across expression punctuation,
    // format placeholders and format/join operators. Never evaluate the expression
    // or pass this over-inclusive spelling to the target reader. Fully opaque runtime
    // scripts with no recognisable host/selector remain outside this guard's scope.
    const fragments = formatParts(shadow).filter(part => part !== null).join('').replace(/-(?:f|join)\b/gi, '')
      .replace(/[\x09-\x0d]/g, ' ').replace(/[^a-z0-9 -]/gi, '');
    // Casts, methods and other syntax between quoted fragments must not hide their
    // visible spelling. Inspect potential spelling atoms at every quote, including
    // inner wrapper quotes, without claiming to parse shell quote nesting. Only the
    // spelling/escape/format alphabet contributes; intervening expression code does
    // not. This can only make detection stricter, never prove runtime concatenation.
    const atoms = quoteAtoms(text);
    const quoted = formatParts(atoms.filter(atom => /^[a-z0-9_.:{},\\\x60^-]*$/i.test(atom)).join(''))
      .filter(part => part !== null).join('').replace(/[^a-z0-9-]/gi, '');
    const candidate = /claude|codex|resume|fork|--(?:continue|session-id)/i;
    // Source whitespace is a barrier, not invented adjacency. Existing expansion,
    // call and escape markers retain the collapsed signal for refusal only: an
    // unquoted substitution with arguments can still construct a native word.
    // Keep until a qualified replacement covers that dynamic construction family.
    const constructed = /[$%!\x60^&]/.test(text) && candidate.test(fragments.replace(/ /g, ''));
    if (candidate.test(fragments) || candidate.test(quoted) || constructed) return true;
    if (legacyTemplateEvidence(text) || orderedEvidence(text, atoms)) return true;
  }
  return (/claude(?:-code)?(?:\.(?:exe|cmd|ps1))?\b/i.test(shadow)
      && /--(?:resume|continue|session-id|fork-session)\b|(?:^|[\s;&|()])-(?!-)[a-z]*[rc][a-z]*(?=$|[\s=;&|()])/i.test(shadow))
    || (/codex(?:\.(?:exe|cmd|ps1))?\b/i.test(shadow) && /\b(?:resume|fork)\b/i.test(shadow));
}
function knownShell(input) {
  const shell = input?.tool_input?.shell;
  return shell === undefined || (typeof shell === 'string'
    && /^(?:cmd|powershell|pwsh|bash|sh)(?:\.exe)?$/i.test(shell.split(/[\\/]/).pop()));
}

function roleShell(input) {
  const shell = input?.tool_input?.shell;
  if (shell === undefined) return 'common';
  if (!knownShell(input)) return null;
  const name = shell.split(/[\\/]/).pop().toLowerCase().replace(/\.exe$/, '');
  return /^(?:powershell|pwsh)$/.test(name) ? 'powershell' : name === 'cmd' ? 'cmd' : 'posix';
}

// This separate lexer proves operand roles, never native argv. Offsets and quote ownership
// stay with every word. No operators, concatenation, escaped quotes or partial consumption.
const horizontalSpace = c => c === ' ' || c === '\t';
function roleWords(text, { scriptWord = false, fieldComma = false } = {}) {
  if (!text || text.length > LIMITS.command || /[^\x09\x20-\x7e\r\n]/.test(text)) return null;
  const words = [];
  for (let i = 0; i < text.length;) {
    if (horizontalSpace(text[i])) { i += 1; continue; }
    const start = i; let value = '', quote = null, prefix = '';
    if (text[i] === '&' && !words.length && horizontalSpace(text[i + 1])) { words.push({ start, end: ++i, value: '&', quote, prefix }); continue; }
    while (i < text.length && !horizontalSpace(text[i]) && !['"', "'"].includes(text[i])) {
      if (!/[a-z0-9_./:\\=+\-]/i.test(text[i]) && !(fieldComma && text[i] === ',')) return null;
      value += text[i++];
    }
    if (['"', "'"].includes(text[i])) {
      if (value && !/^(?:--regexp=|\/c:)$/i.test(value)) return null;
      prefix = value; quote = text[i++]; const opening = i;
      while (i < text.length && text[i] !== quote) {
        if (text[i] === '`' || (text[i] === '\\' && text[i + 1] === quote)) return null;
        if (!scriptWord && /[\r\n]/.test(text[i])) return null;
        i += 1;
      }
      if (i === text.length) return null;
      value += text.slice(opening, i++);
      if (i < text.length && !horizontalSpace(text[i])) return null;
    }
    if (start === i) return null;
    words.push({ start, end: i, value, quote, prefix });
  }
  return words.length ? words : null;
}

function literalWord(word, shell) {
  if (!word || !shell || /[$`%!^]/.test(word.value)) return false;
  // cmd does not protect controls with single quotes. The common subset can still
  // prove a simple, unspaced pathname whose quote characters cannot introduce code.
  if (word.quote === "'" && !['powershell', 'posix'].includes(shell)
    && !/^[a-z0-9_./:\\-]+$/i.test(word.value)) return false;
  // POSIX backslashes may remove ordinary path characters but cannot introduce code.
  // A slash next to a quote, whitespace, operator or expansion earns no data proof.
  for (let i = 0; i < word.value.length; i += 1) {
    if (word.value[i] === '\\' && !/[a-z0-9_./:\\-]/i.test(word.value[i + 1] || '')) return false;
  }
  return true;
}

// Exact rg help entries: -e/--regexp (patterns), -n/--line-number, -i/--ignore-case,
// -F/--fixed-strings, -l/--files-with-matches, --files, --hidden, --no-ignore,
// --help and --no-config. --pre and --hostname-bin execute programs and are absent.
const RG_DATA_SWITCHES = Object.freeze(['-n', '--line-number', '-i', '--ignore-case', '-F', '--fixed-strings', '-l', '--files-with-matches', '--files', '--hidden', '--no-ignore', '--help', '--no-config']);
// Fixed schemas from Microsoft's findstr, type and Get-Content command references.
const FINDSTR_DATA_SWITCHES = Object.freeze(['/n', '/i', '/l', '/r', '/s', '/m']);
function readerProof(words, shell) {
  if (!shell || !words?.length || words.some(word => !literalWord(word, shell))) return null;
  let offset = 0;
  if (words[0].value === '&') {
    if (!['powershell', 'common'].includes(shell) || !words[1]?.quote) return null;
    offset = 1;
  }
  const executable = words[offset], name = executable?.value.split(/[\\/]/).pop().toLowerCase();
  const args = words.slice(offset + 1), roles = words.map(word => ({ ...word, role: word === executable ? 'reader executable' : 'call operator' }));
  const mark = (n, role) => { roles[offset + 1 + n].role = role; };
  if (/^rg(?:\.exe)?$/.test(name || '')) {
    let pattern = false, mode = false, ended = false;
    for (let n = 0; n < args.length; n += 1) {
      const value = args[n].value;
      if (!ended && value === '--') { ended = true; mark(n, 'option delimiter'); continue; }
      if (!ended && RG_DATA_SWITCHES.includes(value)) { if (['--files', '--help'].includes(value)) mode = true; mark(n, 'search switch'); continue; }
      if (!ended && ['-e', '--regexp'].includes(value)) {
        mark(n, 'pattern option'); if (!args[++n] || !args[n].value) return null;
        pattern = true; mark(n, 'literal pattern'); continue;
      }
      if (!ended && value.startsWith('--regexp=')) {
        if (!value.slice(9)) return null;
        pattern = true; mark(n, 'attached literal pattern'); continue;
      }
      if (!ended && value.startsWith('-')) return null;
      mark(n, pattern || mode ? 'literal path' : 'literal pattern'); pattern = true;
    }
    if (!pattern && !mode) return null;
  } else if (/^findstr(?:\.exe)?$/.test(name || '')) {
    let pattern = false, paths = false;
    for (let n = 0; n < args.length; n += 1) {
      const value = args[n].value, lower = value.toLowerCase();
      if (!pattern && FINDSTR_DATA_SWITCHES.includes(lower)) { mark(n, 'search switch'); continue; }
      if (!paths && lower.startsWith('/c:') && value.length > 3) { pattern = true; mark(n, 'attached literal pattern'); continue; }
      if (value.startsWith('/')) return null;
      mark(n, pattern ? 'literal path' : 'literal pattern'); if (pattern) paths = true; pattern = true;
    }
    if (!pattern) return null;
  } else if (name === 'get-content' || (shell === 'powershell' && ['cat', 'type'].includes(name))) {
    let paths = 0;
    const seen = new Set();
    for (let n = 0; n < args.length; n += 1) {
      const value = args[n].value, lower = value.toLowerCase();
      if (['-raw', '-literalpath', '-path', '-totalcount', '-tail'].includes(lower)) {
        if (seen.has(lower)) return null; seen.add(lower); mark(n, 'content option');
        if (lower === '-raw') continue;
        if (!args[++n]) return null;
        if (['-totalcount', '-tail'].includes(lower)) {
          if (!/^\d+$/.test(args[n].value)) return null;
          mark(n, 'literal count'); continue;
        }
        paths += 1;
      } else if (value.startsWith('-')) return null;
      else paths += 1;
      // Custom providers and expression/array binding are outside this filesystem subset.
      if (!args[n].value || /[\[\],]/.test(args[n].value)
        || (args[n].value.includes(':') && !/^[a-z]:[\\/][^:]*$/i.test(args[n].value))) return null;
      mark(n, 'literal filesystem path');
    }
    if (paths !== 1) return null;
  } else if (name === 'type' && shell === 'cmd') {
    if (!args.length || args.some(word => !word.value || /^[/-]/.test(word.value))) return null;
    args.forEach((_, n) => mark(n, 'literal path'));
  } else return null;
  return { schema: name, shell, roles, consumed: words.at(-1).end };
}

// Recognise a fixed wrapper shape, not arbitrary scripts or native admission. Unknown
// flags may still expose a script for refusal, but never exclude executable-path evidence.
function wrapperRoles(words, shell) {
  if (!words?.length) return null;
  const offset = words[0].value === '&' ? 1 : 0, executable = words[offset];
  if (!executable) return null;
  const name = executable.value.split(/[\\/]/).pop().toLowerCase().replace(/\.exe$/, '');
  if (!['powershell', 'pwsh', 'cmd', 'bash', 'sh'].includes(name)) return null;
  const powershell = ['powershell', 'pwsh'].includes(name);
  const selector = value => powershell ? /^-(?:command|c)$/i.test(value) : name === 'cmd' ? /^\/c$/i.test(value) : /^-(?:c|lc)$/.test(value);
  const index = words.findIndex((word, n) => n > offset && selector(word.value));
  if (index < 0 || !words[index + 1]) return null;
  const script = words[index + 1], flags = words.slice(offset + 1, index);
  const fixed = Boolean(index === words.length - 2 && shell && literalWord(executable, shell)
    && (!offset || (['common', 'powershell'].includes(shell) && executable.quote))
    && flags.every(word => powershell && !word.quote && /^-(?:noprofile|noninteractive)$/i.test(word.value))
    && new Set(flags.map(word => word.value.toLowerCase())).size === flags.length
    && !words[index].quote && !script.prefix);
  return { executable, script, fixed, powershell };
}

// The actual caller needs these five literal acquisition-option roles only.
// This is not a gh-wide exemption or a subprocess/format-expression schema.
const GH_RUN_FIELDS = Object.freeze(['attempt', 'conclusion', 'createdAt', 'databaseId', 'displayTitle', 'event', 'headBranch',
  'headSha', 'name', 'number', 'startedAt', 'status', 'updatedAt', 'url', 'workflowDatabaseId', 'workflowName']);
// Complete fixed built-ins only. This proves literal operand roles, never Git
// validity, transport safety, external-operation approval or native target authority.
function gitProof(text, shell) {
  const words = roleWords(text);
  if (!shell || !words?.length || words.some(word => !literalWord(word, shell))) return null;
  const offset = words[0].value === '&' ? 1 : 0, executable = words[offset];
  if (offset && (!['powershell', 'common'].includes(shell) || !executable?.quote)) return null;
  if (!/^git(?:\.exe)?$/.test(executable?.value.split(/[\\/]/).pop().toLowerCase() || '')) return null;
  const command = words[offset + 1];
  if (!command || command.quote || !['add', 'commit', 'push', 'fetch', 'rev-parse', 'status'].includes(command.value)) return null;
  const roles = words.map(word => ({ ...word, role: word === executable ? 'reader executable' : word === command ? 'fixed git command' : 'git option' }));
  const args = words.slice(offset + 2);
  const mark = (n, role) => { roles[offset + 2 + n].role = role; };
  const ref = value => /^[a-z0-9_][a-z0-9_./-]*(?::[a-z0-9_][a-z0-9_./-]*)?$/i.test(value);
  const remote = value => /^[a-z0-9_][a-z0-9_.-]*$/i.test(value);
  if (command.value === 'add') {
    if (args[0]?.value !== '--' || args[0].quote || args.length < 2) return null;
    for (let n = 1; n < args.length; n += 1) {
      if (!args[n].value) return null;
      mark(n, 'literal git path');
    }
  } else if (command.value === 'commit') {
    if (!args.length) return null;
    for (let n = 0; n < args.length; n += 2) {
      if (args[n].quote || !['-m', '--message'].includes(args[n].value) || !args[n + 1]?.value) return null;
      mark(n + 1, 'literal git message');
    }
  } else if (command.value === 'push' || command.value === 'fetch') {
    let at = 0;
    if (args[at]?.value === '--' && !args[at].quote) at += 1;
    if (!remote(args[at]?.value || '') || args.length < at + 2) return null;
    mark(at++, 'literal git remote');
    for (; at < args.length; at += 1) {
      if (!ref(args[at].value)) return null;
      mark(at, 'literal git refspec');
    }
  } else if (command.value === 'rev-parse') {
    if (!args.length) return null;
    for (let n = 0; n < args.length; n += 1) {
      if (!ref(args[n].value) || args[n].value.includes(':')) return null;
      mark(n, 'literal git revision');
    }
  } else {
    let at = 0;
    for (; at < args.length && args[at].value !== '--'; at += 1) {
      if (args[at].quote || !['--short', '--branch', '--porcelain'].includes(args[at].value)) return null;
    }
    if (at < args.length) {
      if (args[at].quote || ++at === args.length) return null;
      for (; at < args.length; at += 1) {
        if (!args[at].value) return null;
        mark(at, 'literal git path');
      }
    }
  }
  return { schema: 'git ' + command.value + ' literal operands', shell, roles, consumed: words.at(-1).end };
}

function acquisitionProof(text, shell) {
  const ws = roleWords(text, { fieldComma: true });
  if (!shell || !ws?.length || ws.some(w => !literalWord(w, shell))) return null;
  const offset = ws[0].value === '&' ? 1 : 0, exe = ws[offset];
  if (offset && (!['powershell', 'common'].includes(shell) || !exe?.quote)) return null;
  if (!/^gh(?:\.exe)?$/i.test(exe?.value.split(/[\\/]/).pop() || '') || ws[offset + 1]?.quote || ws[offset + 2]?.quote
    || ws[offset + 1]?.value !== 'run' || ws[offset + 2]?.value !== 'list') return null;
  const rs = ws.map((w, n) => ({ ...w, role: n === offset ? 'reader executable' : n <= offset + 2 ? 'fixed acquisition command' : 'acquisition option' }));
  const seen = new Set();
  for (let n = offset + 3; n < ws.length; n += 2) {
    const option = ws[n], value = ws[n + 1];
    if (!['--repo', '--branch', '--commit', '--limit', '--json'].includes(option.value) || option.quote || !value || value.value.startsWith('-') || seen.has(option.value)) return null;
    seen.add(option.value);
    if (option.value === '--repo' && !/^(?:[a-z0-9.-]+\/)?[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(value.value)) return null;
    if (option.value === '--branch' && !/^[a-z0-9_./-]+$/i.test(value.value)) return null;
    if (option.value === '--commit' && !/^[a-f0-9]{40}$/i.test(value.value)) return null;
    if (option.value === '--limit' && !/^\d+$/.test(value.value)) return null;
    if (option.value === '--json' && (!value.value || value.value.split(',').some(f => !GH_RUN_FIELDS.includes(f)))) return null;
    rs[n + 1].role = 'literal acquisition ' + option.value.slice(2);
  }
  return { schema: 'gh run list literal filters', shell, roles: rs, consumed: ws.at(-1).end };
}

// Complete structural scan. Only top-level statement/pipeline stages can earn data
// roles. All groups, blocks, arrays and their contents remain executable evidence.
function readerSegments(text, shell) {
  if (!shell || !text || text.length > LIMITS.command || /[^\x09\x0a\x0d\x20-\x7e]/.test(text)) return null;
  const ranges = [], separators = [], stack = []; let quote = null, start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '\r' && text[i + 1] !== '\n') return null;
    if (quote) {
      if (c === '`' || (c === '\\' && text[i + 1] === quote)) return null;
      if (quote === '"' && c === '$') return null; // No interpolated-string ownership claim.
      if (c === quote) {
        if (text[i + 1] === quote) return null;
        quote = null;
      }
      continue;
    }
    if (c === '#' || c === '`' || c === '^' || (c === '@' && ['"', "'"].includes(text[i + 1]))) return null;
    if (c === '\\' && /[\s'";&|<>]/.test(text[i + 1] || '')) return null;
    if (['"', "'"].includes(c)) { quote = c; continue; }
    if ('({['.includes(c)) { stack.push(c); continue; }
    if (')}]'.includes(c)) { if (stack.pop() !== { ')': '(', '}': '{', ']': '[' }[c]) return null; continue; }
    if (!stack.length && (c === ';' || c === '\n' || c === '\r' || c === '|')) {
      if (c === '|' && (text[i + 1] === '|' || text[i - 1] === '|')) return null;
      ranges.push({ start, end: i });
      const end = c === '\r' ? ++i + 1 : i + 1;
      separators.push({ start: ranges.at(-1).end, end, value: text.slice(ranges.at(-1).end, end) }); start = end;
    }
    if (!stack.length && (text.slice(i, i + 2) === '&&' || c === '<' || c === '>')) return null;
  }
  if (quote || stack.length) return null;
  ranges.push({ start, end: text.length });
  const nonemptyAfter = new Array(ranges.length + 1).fill(false);
  for (let n = ranges.length - 1; n >= 0; n--) nonemptyAfter[n] = nonemptyAfter[n + 1] || Boolean(text.slice(ranges[n].start, ranges[n].end).trim());
  // Blank lines are inert. Missing semicolon/pipe stages are deliberately unqualified.
  for (let n = 0; n < ranges.length; n++) if (!text.slice(ranges[n].start, ranges[n].end).trim()) {
    if (separators[n - 1]?.value === ';' || separators[n]?.value === ';') return null;
    if (separators[n]?.value === '|') return null;
    if (separators[n - 1]?.value === '|' && !nonemptyAfter[n + 1]) return null;
  }
  const spans = [], proofs = [], unproved = [];
  for (const r of ranges) {
    const chunk = text.slice(r.start, r.end); if (!chunk.trim()) continue;
    const proof = readerProof(roleWords(chunk), shell) || acquisitionProof(chunk, shell) || gitProof(chunk, shell);
    if (!proof) { unproved.push(chunk); continue; }
    const roles = proof.roles.map(w => ({ ...w, start: w.start + r.start, end: w.end + r.start }));
    proofs.push({ ...proof, ...r, roles });
    for (const w of roles) {
      // Keep attached option prefixes visible; only their literal values are data.
      if (w.role === 'attached literal pattern') spans.push({ ...w, start: w.start + (w.value.startsWith('--regexp=') ? 9 : 3) });
      else if (w.role.startsWith('literal ') || (w.role === 'reader executable' && /[\\/]/.test(w.value))) spans.push(w);
    }
  }
  if (!proofs.length) return null;
  return { candidate: mask(text, spans), proofs, spans, unproved, separators };
}
function mask(text, spans) {
  let at = 0; const parts = [];
  for (const s of spans) { parts.push(text.slice(at, s.start), ' '.repeat(s.end - s.start)); at = s.end; }
  parts.push(text.slice(at)); const candidate = parts.join(''); return candidate;
}
function commandRoles(text, input) {
  const shell = roleShell(input), words = roleWords(text);
  const data = readerProof(words, shell);
  if (data) return { data, candidate: text, script: null };
  const wrapper = wrapperRoles(words, shell) || (shell === 'powershell' ? wrapperRoles(roleWords(text, { scriptWord: true }), shell) : null);
  if (!wrapper) {
    const segments = readerSegments(text, shell);
    return { data: null, candidate: segments?.candidate ?? text, script: null, segments };
  }
  // One transparent PowerShell layer may prove a complete literal reader. Expansion in
  // either layer defeats that proof; scripts themselves are never recursively admitted.
  const transparent = wrapper.fixed && wrapper.powershell && literalWord(wrapper.script, shell);
  const inner = transparent ? readerProof(roleWords(wrapper.script.value), 'powershell') : null;
  // Keep inherited common/one-line transport until a replacement proves those consumers.
  // Extended composition requires explicit PowerShell and a complete literal script word.
  const extended = shell === 'powershell' && wrapper.fixed && wrapper.powershell && wrapper.script.quote
    && (literalWord(wrapper.script, shell) || (wrapper.script.quote === "'" && !/[\x60%!^]/.test(wrapper.script.value)));
  const scriptSegments = (transparent || extended) && !inner ? readerSegments(wrapper.script.value, 'powershell') : null;
  const script = scriptSegments?.candidate ?? wrapper.script.value;
  const scriptStart = wrapper.script.start + (wrapper.script.quote ? 1 : 0);
  // Compose the same proved operand view into both the outer source and the executable
  // script. Otherwise an outer raw scan would reintroduce data excluded by the inner proof.
  const candidate = wrapper.fixed ? text.slice(0, wrapper.executable.start)
    + ' '.repeat(wrapper.executable.end - wrapper.executable.start)
    + text.slice(wrapper.executable.end, scriptStart) + script
    + text.slice(scriptStart + wrapper.script.value.length) : text;
  const segments = scriptSegments ? { ...scriptSegments, candidate,
    spans: scriptSegments.spans.map(word => ({ ...word, start: word.start + scriptStart, end: word.end + scriptStart })),
    separators: scriptSegments.separators.map(separator => ({ ...separator, start: separator.start + scriptStart, end: separator.end + scriptStart })),
    proofs: scriptSegments.proofs.map(proof => ({ ...proof,
    start: proof.start + scriptStart, end: proof.end + scriptStart,
    roles: proof.roles.map(word => ({ ...word, start: word.start + scriptStart, end: word.end + scriptStart })),
  })) } : null;
  return { data: inner ? { schema: 'powershell reader wrapper', shell, roles: words.map(word => ({ ...word,
    role: word === wrapper.executable ? 'shell executable' : word === wrapper.script ? 'literal reader script'
      : word.value === '&' ? 'call operator' : /^-(?:command|c)$/i.test(word.value) ? 'script selector' : 'fixed shell switch',
  })), inner, consumed: words.at(-1).end } : null, candidate, script, segments,
  excludedExecutable: wrapper.fixed ? { ...wrapper.executable, role: 'shell executable' } : null };
}

function visible(text, input) {
  const roles = commandRoles(text, input);
  if (roles.data) return false;
  // Only the proved non-native executable span is excluded. Never OR the raw path
  // back into evidence; keep the complete executable script, even inside outer quotes.
  text = roles.candidate;
  if (roles.script && broadVisible(roles.script, true)) return true;
  for (const segment of roles.segments?.unproved || []) {
    const wrapper = wrapperRoles(roleWords(segment, { scriptWord: true }), roleShell(input));
    if (broadVisible(segment) || (wrapper && broadVisible(wrapper.script.value, true))) return true;
  }
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
