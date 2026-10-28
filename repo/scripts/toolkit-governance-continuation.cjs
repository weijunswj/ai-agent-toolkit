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
function pythonBindingBarriers(text, shell) {
  if (!['common','powershell'].includes(shell) || /[$%!\x60^&]/.test(text)) return [];
  if (text.length>32768 || /[^\x09\x0a\x0d\x20-\x7e]/.test(text)) return [];
  // This is source ownership for lexical proof only, never shell admission.
  // Single-quoted PowerShell here-string, exact stdin consumer, no prefix/suffix.
  const transport=/^[ \t]*@'\r?\n([\s\S]*?)\r?\n'@[ \t]*\|[ \t]*python(?:3)?(?:\.exe)?[ \t]+-[ \t]*$/i.exec(text);
  if(!transport)return [];
  const source=transport[1],offset=transport[0].indexOf('\n')+1;
  if (/\r(?!\n)/.test(source) || source.split(/\r?\n/).slice(0,2).some(line=>/^[ \t]*#.*coding[=:]/.test(line))) return [];
  // A here-string closing delimiter cannot be embedded before the final close.
  if(/(?:^|\n)'@/.test(source))return [];
  const tokens=[];
  for(let i=0;i<source.length;) {
    const c=source[i];
    if(/[ \t\r\n]/.test(c)){i++;continue;}
    if(c==='#'){while(i<source.length&&source[i]!=='\n')i++;continue;}
    const start=i;
    if(c==='"'||c==="'") {
      const prefix=tokens.at(-1);
      if(prefix?.end===start && /^[a-z_]/i.test(prefix.value||'') && !/^(?:r|u|b|br|rb)$/i.test(prefix.value))return [];
      const triple=source.slice(i,i+3)===c.repeat(3),width=triple?3:1;i+=width;let closed=false;
      while(i<source.length){
        if(source[i]==='\\'){i+=2;continue;}
        if(source.slice(i,i+width)===c.repeat(width)){i+=width;closed=true;break;}
        if(!triple&&/[\r\n]/.test(source[i]))return [];
        i++;
      }
      if(!closed)return [];
      tokens.push({value:null,start,end:i});continue;
    }
    if(/[a-z_]/i.test(c)){i++;while(i<source.length&&/[a-z0-9_]/i.test(source[i]))i++;tokens.push({value:source.slice(start,i),start,end:i});continue;}
    tokens.push({value:c,start,end:++i});
  }
  const name=t=>t&&/^[a-z_]\w*$/i.test(t.value||'')&&!new Set(['False','None','True','and','as','assert','async','await','break','class','continue','def','del','elif','else','except','finally','for','from','global','if','import','in','is','lambda','nonlocal','not','or','pass','raise','return','try','while','with','yield']).has(t.value);
  const barriers=[];
  for(let n=0;n<tokens.length;n++) {
    if(tokens[n].value!=='for'||!name(tokens[n+1]))continue;
    const whitespace=source.slice(tokens[n].end,tokens[n+1].start);
    if(!/^[ \t]+$/.test(whitespace))continue;
    let at=n+2;
    while(tokens[at]?.value===','&&name(tokens[at+1]))at+=2;
    if(tokens[at]?.value!=='in'||!name(tokens[n+1]))continue;
    // Every header gap must be horizontal trivia. No continuation/comment/newline
    // or expression may impersonate this deliberately small binding grammar.
    if(tokens.slice(n+1,at+1).some((t,j)=>j>0&&!/^[ \t]*$/.test(source.slice(tokens[n+j].end,t.start))))continue;
    barriers.push({start:offset+tokens[n].end,end:offset+tokens[n+1].start,role:'Python for binding separator'});
  }
  return barriers;
}
// Dotted host path components and the exact upper-case folder variables are names only
// in argument position. Command words and derived-text execution keep the earlier evidence.
// Each span becomes a barrier, so neighbouring text still cannot join across it. The
// whole-input ASCII/no-control qualification excludes source NUL, as for the Python proof.
const FOLDER_VARIABLES = /^(?:CODEX_HOME|CLAUDE_CONFIG_DIR|CLAUDE_PROJECT_DIR|CLAUDE_PLUGIN_ROOT)$/;
const NAME_EVALUATORS = /(?:^|[^\w-])(?:eval|source|exec|invoke-expression|iex)(?:\.exe)?(?=$|[^\w-])/i;
const NAME_DOT_SOURCE = /(?:^|[;&|(){}\r\n])[ \t]*\.[ \t]+/;
const NAME_COMMAND_WRAPPERS = /^(?:env|command|exec|nohup|xargs|sudo|time|nice|timeout|setsid|stdbuf|chroot|start-process|saps|start|call|if|then|else|while|until|do)$/i;
// Runtime extraction can pull a host spelling back out of a folder name: piping into a shell
// or interpreter, substitutions, string methods/operators, slicing and parameter or cmd
// substring expansion. Any of them anywhere keeps the unbarriered (main) result.
// Same matches as /\$\{[^}]*[:#%\/^,]/ in one linear pass: a '${' with an operator before its
// first '}'. The regex backtracked quadratically on long runs of unclosed '${'.
const BRACE_OPERATOR = Object.freeze({ test(text) {
  let close = -1, operator = -1;
  for (let i = text.length - 1; i >= 0; i -= 1) {
    if (text[i] === '}') close = i;
    else if (':#%/^,'.includes(text[i])) operator = i;
    if (text[i] === '$' && text[i + 1] === '{' && operator > i + 1 && (close < 0 || operator < close)) return true;
  }
  return false;
} });
const EXTRACTION = [
  /\$\(|`|<\(/,
  /\.(?:substring|trim(?:start|end)?|replace|remove|split|insert|chars|pad(?:left|right)|tostring|to(?:lower|upper)(?:invariant)?|getfilename\w*|getextension|name)\b/i,
  /\[io\.path\]|\[char\b|\bsplit-path\b|-[ci]?(?:replace|split)\b|-join\b|\[\s*-?\d+\s*\.\./i,
  BRACE_OPERATOR,
  /[!%][a-z_][\w]*:~/i,
  NAME_EVALUATORS,
  NAME_DOT_SOURCE,
  /\.[ \t]*(?:\(|\$)/,
];
// Pipe consumers must be fixed data readers or pure data filters. Unknown commands,
// quoted/path-qualified shells and wrappers all retain the raw evidence instead of
// extending a shell denylist. The PowerShell-only data filters (Sort-Object and the rest of
// the second group) do not apply to an explicit cmd shell.
const NAME_PIPE_READERS = /^(?:grep|rg|jq|head|tail|sort|wc|cut|cat|git|tr|uniq|convertfrom-json|convertto-json|select-object|select-string|where-object|out-string|sort-object|measure-object|format-table|format-list|get-unique|out-null)(?:\.exe)?$/i;
const CMD_PIPE_READERS = /^(?:grep|rg|jq|head|tail|sort|wc|cut|cat|git|tr|uniq|convertfrom-json|convertto-json|select-object|select-string|where-object|out-string)(?:\.exe)?$/i;
// A quoted script argument still runs: its pipes and command positions count.
// -e and -p are case-sensitive (grep -E and -P take patterns); -c and PowerShell's
// -Command with its prefixes are not.
const NAME_SCRIPT_SELECTOR_CASED = /(?:^|\s)(?:-lc|-e|-p|--eval|--print|\/[cC])[ \t]*$/;
const NAME_SCRIPT_SELECTOR_COMMAND = /(?:^|\s)-c(?:o(?:m(?:m(?:a(?:n(?:d)?)?)?)?)?)?[ \t]*$/i;
// POSIX and PowerShell quoting: single quotes are literal, double quotes allow a '\' or
// backtick escape. Quoted text is blanked to spaces (offsets kept), so a '|', '&' or path
// inside quotes is neither a pipe nor a command word. A quoted script argument is kept as
// written and its first word is a command position. cmd does not quote with single quotes,
// so cmd and unknown shells keep the raw scan, as do unbalanced quotes: all return null.
function quotedView(text, shell) {
  if (!['common', 'posix', 'powershell'].includes(shell)) return null;
  let out = '', quote = null, script = false; const scripts = [];
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quote) {
      if (quote === '"' && (c === '\\' || c === '`') && i + 1 < text.length) { out += script ? c + text[i + 1] : '  '; i += 1; continue; }
      if (c === quote) { quote = null; out += c; continue; }
      out += script ? c : ' '; continue;
    }
    if (c === "'" || c === '"') {
      const before = text.slice(Math.max(0, i - 64), i);
      script = NAME_SCRIPT_SELECTOR_CASED.test(before) || NAME_SCRIPT_SELECTOR_COMMAND.test(before);
      if (script) scripts.push(i + 1);
      quote = c;
    }
    out += c;
  }
  return quote ? null : { text: out, scripts };
}
function derivedNameExecution(text, shell = null, view = quotedView(text, shell)) {
  if (EXTRACTION.some(pattern => pattern.test(text))) return true;
  // Shell quote fragments and escapes can spell an evaluator without changing
  // its command name. Keep path separators in one view and POSIX escapes in another.
  const unquoted = text.replace(/['"]/g, '');
  for (const view of [unquoted, unquoted.replace(/\\/g, '')]) {
    if (NAME_EVALUATORS.test(view) || NAME_DOT_SOURCE.test(view)) return true;
  }
  const readers = shell === 'cmd' ? CMD_PIPE_READERS : NAME_PIPE_READERS;
  for (const m of (view?.text ?? text).matchAll(/\|\|?|(?:^|[^&])&(?=[ \t]*['"($])/g)) {
    if (m[0] === '||') continue;
    const rest = text.slice(m.index + m[0].length);
    if (m[0] === '|') {
      const target = /^[ \t\r\n]*([^\s;|&(){}]+)/.exec(rest)?.[1];
      // git reads a pipe only as a plain subcommand; an option first can define an alias that runs a program.
      if (readers.test(target || '') && !(/^git(?:\.exe)?$/i.test(target) && /^[ \t\r\n]*\S+[ \t]+-/.test(rest))) continue;
      if (/^[ \t\r\n]*foreach-object[ \t]+\{/i.test(rest)) continue;
      return true;
    }
    // A literal shell executable does not compute its own name. Its entire script
    // still undergoes the extraction, pipe and command-position scans here.
    if (!/^[ \t]*(['"])(?:[a-z]:[\\/]|\/)?(?:[a-z0-9_.-]+[\\/])*(?:pwsh|powershell|bash|sh|cmd)(?:\.exe)?\1(?=[ \t]|$)/i.test(rest)) return true;
  }
  return false;
}
const NAME_STAGE_WORD = /[ \t]*((?:"[^"\r\n]*"|'[^'\r\n]*'|[\\^][ \t]|[^\s;'"&|(){}])+)/y;
function nameBarriers(text, shell = null) {
  if (text.length > LIMITS.command || /[^\x09\x0a\x0d\x20-\x7e]/.test(text)) return [];
  const view = quotedView(text, shell), scan = view?.text ?? text;
  if (derivedNameExecution(text, shell, view)) return [];
  // Word ranges in command position, including quoted paths and nested commands. Stages
  // are found outside quotes, and at the start of a quoted script argument, whose text is
  // scanned as written. The command word itself is read from the source text.
  const stageEnd = /[;&|(){}\r\n]/g;
  const starts = [...scan.matchAll(/(?:^|[;&|(){}\r\n])(?=[ \t]*[^\s;'"&|(){}]|[ \t]*['"])/g)].map(m => m.index + m[0].length);
  for (const at of view?.scripts || []) starts.push(at);
  const cover = new Array(text.length + 1).fill(0);
  for (const at of starts) {
    NAME_STAGE_WORD.lastIndex = at;
    const m = NAME_STAGE_WORD.exec(scan);
    if (!m) continue;
    let end = at + m[0].length;
    const word = text.slice(end - m[1].length, end).replace(/['"]/g, '');
    const leaf = word.split(/[\\/]/).pop().replace(/\.exe$/i, '');
    // Wrappers, conditions and leading assignments/redirections can run a later
    // argument. Keep their whole stage visible, including options and wrapper chains.
    if (NAME_COMMAND_WRAPPERS.test(leaf) || NAME_COMMAND_WRAPPERS.test(word.replace(/\\/g, ''))
      || /^[a-z_]\w*=|^\d*[<>]/i.test(word)) {
      stageEnd.lastIndex = end; end = stageEnd.exec(scan)?.index ?? text.length;
    }
    cover[at] += 1; cover[end] -= 1;
  }
  for (let i = 1; i <= text.length; i += 1) cover[i] += cover[i - 1];
  const inCommand = at => cover[at] > 0;
  const spans = [];
  for (const m of text.matchAll(/(?<![\w.$-])\.(?:claude|codex)[\w.-]*/gi)) {
    const before = text[m.index - 1], after = text[m.index + m[0].length];
    // A path separator must touch the name. A bare or quoted dotted word stays evidence.
    if (!inCommand(m.index) && (before === '/' || before === '\\' || after === '/' || after === '\\')) spans.push({ start: m.index, end: m.index + m[0].length });
  }
  // An undotted host word is a name only inside a standalone path-like word (one holding
  // '/' or '\' that no quote or operator glues to another fragment), as a directory
  // component or joined by '-' or '_' to more letters or digits. A path leaf spelled as a
  // host executable ('.../claude', 'codex.exe', 'claude-code') is never a name.
  for (const m of text.matchAll(/(?<![A-Za-z0-9.])(?:claude|codex)(?![A-Za-z0-9])/gi)) {
    if (inCommand(m.index) || spans.some(s => s.start <= m.index && m.index < s.end)) continue;
    const end = m.index + m[0].length, before = text[m.index - 1], after = text[end];
    let a = m.index, b = end;
    while (a > 0 && /[A-Za-z0-9_.\-\/\\:]/.test(text[a - 1])) a -= 1;
    while (b < text.length && /[A-Za-z0-9_.\-\/\\:]/.test(text[b])) b += 1;
    const left = text[a - 1], right = text[b];
    const leftAlone = left === undefined || /[\s;|&(=]/.test(left) || (/['"]/.test(left) && (a < 2 || /[\s;|&(=:]/.test(text[a - 2])));
    const rightAlone = right === undefined || /[\s;|&)]/.test(right) || (/['"]/.test(right) && (b + 1 >= text.length || /[\s;|&)]/.test(text[b + 1])));
    if (!leftAlone || !rightAlone || !/[\\/]/.test(text.slice(a, b))) continue;
    let p = m.index, q = end;
    while (p > a && !/[\\/]/.test(text[p - 1])) p -= 1;
    while (q < b && !/[\\/]/.test(text[q])) q += 1;
    if (q === b && HOST.test(text.slice(p, q))) continue;
    const directory = after === '/' || after === '\\';
    const joined = (/[-_]/.test(before || '') && /[A-Za-z0-9]/.test(text[m.index - 2] || ''))
      || (/[-_]/.test(after || '') && /[A-Za-z0-9]/.test(text[end + 1] || ''));
    if (directory || joined) spans.push({ start: m.index, end });
  }
  // A variable is one only outside single quotes and not after an escape. Unbalanced
  // quotes withdraw all name barriers.
  const single = new Array(text.length).fill(false); let quote = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote === "'") { single[i] = true; if (c === "'") quote = null; continue; }
    if (quote === '"') { if ((c === '\\' || c === '`') && i + 1 < text.length) { i++; continue; } if (c === '"') quote = null; continue; }
    if (c === "'" || c === '"') { quote = c; single[i] = c === "'"; }
  }
  if (quote) return [];
  for (const m of text.matchAll(/(?<![$\w\\`^])\$(?:env:)?([a-z_]\w*)/gi)) {
    if (!single[m.index] && !inCommand(m.index) && FOLDER_VARIABLES.test(m[1])) spans.push({ start: m.index + m[0].length - m[1].length, end: m.index + m[0].length });
  }
  return spans.sort((a, b) => a.start - b.start);
}
function barrierText(text, spans) {
  const chars = text.split('');
  for (const span of spans) for (let i = span.start; i < span.end; i++) chars[i] = '\0';
  return chars.join('');
}
function constructionFragments(text, shell, names = []) {
  const barriers=pythonBindingBarriers(text, shell),chars=text.split('');
  barriers.push(...names);
  // Proof excludes source NUL; otherwise preserve every original code unit until
  // the legacy consuming transforms finish, then discard controls as before.
  for(const span of barriers)for(let i=span.start;i<span.end;i++)chars[i]='\0';
  const shadow=chars.join('').replace(/[\\\x60^]\r?\n/g,'')
    .replace(/%[^%\r\n]*%|![^!\r\n]*!|\$\{[^}$\r\n]*\}/g,'')
    .replace(/["'\\\x60^]/g,'');
  return formatParts(shadow).filter(part=>part!==null).join('').replace(/-(?:f|join)\b/gi,'')
    .replace(barriers.length ? /[^a-z0-9\x00-]/gi : /[^a-z0-9-]/gi,'');
}
function broadVisible(source, executableScript = false, shell = null) {
  // Every evidence scan reads the barriered text; only the strict reader sees the source.
  const names = nameBarriers(source, shell), text = names.length ? barrierText(source, names) : source;
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
  if (executableScript || !tokens(source.replace(/[|<>]/g, ' '), { literalData: true })) {
    // Detection only: join visible literal fragments across expression punctuation,
    // format placeholders and format/join operators. Never evaluate the expression
    // or pass this over-inclusive spelling to the target reader. Fully opaque runtime
    // scripts with no recognisable host/selector remain outside this guard's scope.
    const fragments = constructionFragments(source, shell, names);
    // Casts, methods and other syntax between quoted fragments must not hide their
    // visible spelling. Inspect potential spelling atoms at every quote, including
    // inner wrapper quotes, without claiming to parse shell quote nesting. Only the
    // spelling/escape/format alphabet contributes; intervening expression code does
    // not. This can only make detection stricter, never prove runtime concatenation.
    const atoms = quoteAtoms(text);
    const quoted = formatParts(atoms.filter(atom => /^[a-z0-9_.:{},\\\x60^-]*$/i.test(atom)).join(''))
      .filter(part => part !== null).join('').replace(/[^a-z0-9-]/gi, '');
    const candidate = /claude|codex|resume|fork|--(?:continue|session-id)/i;
    if (candidate.test(fragments) || candidate.test(quoted)) return true;
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
  const shell = roleShell(input), roles = commandRoles(text, input);
  if (roles.data) return false;
  // Only the proved non-native executable span is excluded. Never OR the raw path
  // back into evidence; keep the complete executable script, even inside outer quotes.
  text = roles.candidate;
  if (roles.script && broadVisible(roles.script, true, shell)) return true;
  for (const segment of roles.segments?.unproved || []) {
    const wrapper = wrapperRoles(roleWords(segment, { scriptWord: true }), roleShell(input));
    if (broadVisible(segment, false, shell) || (wrapper && broadVisible(wrapper.script.value, true, shell))) return true;
  }
  if (!broadVisible(text, false, shell)) return false;
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
      if (broadVisible(words[i], false, shell)) return true;
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

// Data-argument proofs. A closed structural scanner reads the whole input as simple commands
// under every shell that may run it, and each command, including those inside substitutions,
// must match one fixed data-command schema. Only operand spans a schema proves are data get
// masked; the remainder must then hold no host or selector signal under every evidence scan.
// This can only turn UNKNOWN into NOT_CONTINUATION: PARSED and VERIFIED never reach it.
const DATA_STOP = Object.freeze({ stop: true });
const DATA_INERT = Object.freeze({ inert: true });
const DATA_MAX_DEPTH = 64;
function dataShells(input, host = null) {
  const shell = input?.tool_input?.shell;
  // Claude Code's PowerShell tool runs PowerShell and its Bash tool runs bash. The host comes
  // from the hook entry point, never from the payload. Any other omitted shell must prove under both.
  if (shell === undefined) {
    if (input?.tool_name === 'PowerShell') return ['powershell'];
    return host === 'claude' && input?.tool_name === 'Bash' ? ['posix'] : ['posix', 'powershell'];
  }
  const role = roleShell(input);
  return role === 'posix' || role === 'powershell' ? [role] : null;
}

class DataScanner {
  constructor(text, shell, inertAllowed) {
    this.text = text; this.shell = shell; this.ps = shell === 'powershell'; this.inertAllowed = inertAllowed;
    this.i = 0; this.all = []; this.heredocs = []; this.depth = 0;
  }
  stop() { throw DATA_STOP; }
  at(s) { return this.text.startsWith(s, this.i); }
  blanks() { while (this.text[this.i] === ' ' || this.text[this.i] === '\t') this.i += 1; }
  newline() { return this.text[this.i] === '\n' || (this.ps && this.at('\r\n')); }
  ends(nested) {
    const c = this.text[this.i];
    return c === undefined || this.newline() || c === ';' || c === '|' || this.at('&&') || (nested && c === ')');
  }
  run() {
    if (!this.ps && this.text.includes('\r')) this.stop();
    this.list(false);
    if (this.i !== this.text.length || this.heredocs.length) this.stop();
    return this.all;
  }
  // Separators only order or join commands; every command still needs its own schema.
  list(nested) {
    const t = this.text; let after = false, pending = false, piped = false;
    for (;;) {
      this.blanks();
      const c = t[this.i];
      if (c === undefined || (nested && c === ')')) { if (pending || (nested && c === undefined)) this.stop(); return; }
      if (this.newline()) {
        if (pending || nested) this.stop();
        this.i += t[this.i] === '\r' ? 2 : 1; this.readHeredocs(); after = false; piped = false; continue;
      }
      if (c === ';') { if (!after) this.stop(); this.i += 1; after = false; piped = false; continue; }
      if (this.at('&&') || this.at('||')) { if (!after) this.stop(); this.i += 2; after = false; pending = true; piped = false; continue; }
      if (c === '|') { if (!after) this.stop(); this.i += 1; after = false; pending = true; piped = true; continue; }
      if (after) this.stop();
      this.command(nested, piped); after = true; pending = false;
    }
  }
  command(nested, piped) {
    const t = this.text, cmd = { words: [], redirects: [], heredoc: null, piped, start: this.i, depth: this.depth };
    const assign = this.ps ? /^\$([A-Za-z_][A-Za-z0-9_]*)[ \t]*=(?!=)[ \t]*/.exec(t.slice(this.i, this.i + 300))
      : /^([A-Za-z_][A-Za-z0-9_]*)=/.exec(t.slice(this.i, this.i + 300));
    if (assign) {
      cmd.assign = { name: assign[1], start: this.i + (this.ps ? 1 : 0), end: this.i + (this.ps ? 1 : 0) + assign[1].length };
      this.i += assign[0].length;
      cmd.assign.value = this.ends(nested) || t[this.i] === ' ' || t[this.i] === '\t' ? null : this.word(nested);
      this.blanks();
      if (!this.ends(nested)) this.stop();
    } else {
      for (;;) {
        this.blanks();
        if (this.ends(nested)) break;
        if (t[this.i] === '&') this.stop();
        if (this.redirect(cmd)) continue;
        cmd.words.push(this.word(nested));
      }
      if (!cmd.words.length) this.stop();
    }
    cmd.end = this.i; this.all.push(cmd);
  }
  redirect(cmd) {
    const t = this.text;
    if (t[this.i] === '<') {
      // PowerShell reserves '<': a script holding one outside quotes fails to parse and runs nothing.
      if (this.ps) { if (this.inertAllowed) throw DATA_INERT; this.stop(); }
      if (!this.at('<<') || this.at('<<<') || this.at('<<-') || this.depth) this.stop();
      this.i += 2; this.blanks();
      const m = /^(?:'([A-Za-z_][A-Za-z0-9_]*)'|"([A-Za-z_][A-Za-z0-9_]*)"|\\([A-Za-z_][A-Za-z0-9_]*))(?=[ \t\n;|&>]|$)/.exec(t.slice(this.i, this.i + 300));
      if (!m || cmd.heredoc) this.stop();
      cmd.heredoc = { delimiter: m[1] || m[2] || m[3] }; this.heredocs.push(cmd.heredoc); this.i += m[0].length;
      return true;
    }
    const m = (this.ps ? /^([1-6*])?(>>|>)/ : /^([12])?(>>|>&|>)/).exec(t.slice(this.i, this.i + 4));
    if (!m) return false;
    if (m[2] === '>&' || (this.ps && t[this.i + m[0].length] === '&')) {
      const target = /^&?([12])(?=[ \t\n;|]|$)/.exec(t.slice(this.i + m[0].length, this.i + m[0].length + 3));
      if (!target || (m[1] || '1') === target[1] || (this.ps && m[1] === undefined)) this.stop();
      this.i += m[0].length + target[0].length; return true;
    }
    this.i += m[0].length; this.blanks();
    const word = this.word(false);
    const discard = this.ps ? this.raw(word).toLowerCase() === '$null' : word.value === '/dev/null';
    if (!discard && !safeTarget(word)) this.stop();
    cmd.redirects.push(word); return true;
  }
  readHeredocs() {
    const t = this.text;
    for (const doc of this.heredocs) {
      doc.bodyStart = this.i;
      for (let line = this.i; ; ) {
        const next = t.indexOf('\n', line), end = next < 0 ? t.length : next;
        if (t.slice(line, end) === doc.delimiter) { doc.bodyEnd = line; this.i = next < 0 ? t.length : next + 1; break; }
        if (next < 0) this.stop();
        line = next + 1;
      }
    }
    this.heredocs = [];
  }
  raw(word) { return this.text.slice(word.start, word.end); }
  word(nested) {
    const t = this.text, start = this.i, parts = [];
    if (this.ps && (this.at("@'\n") || this.at("@'\r\n") || this.at('@"\n') || this.at('@"\r\n'))) return this.hereString();
    const lit = (text, s, quoted) => parts.push({ type: 'lit', text, start: s, end: this.i, quoted });
    while (this.i < t.length) {
      const c = t[this.i];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === ';' || c === '|' || c === '&' || c === '<' || c === '>' || (nested && c === ')')) break;
      const s = this.i;
      if (c === "'") {
        let text = ''; this.i += 1;
        for (;;) {
          if (this.i >= t.length) this.stop();
          if (t[this.i] === "'") { if (this.ps && t[this.i + 1] === "'") { text += "'"; this.i += 2; continue; } this.i += 1; break; }
          text += t[this.i++];
        }
        lit(text, s, "'"); continue;
      }
      if (c === '"') { this.doubleQuoted(parts); continue; }
      if (c === '$') { this.dollar(parts, false); continue; }
      if (this.ps) {
        if (!/[A-Za-z0-9_\-./\\:=+~%!?*^]/.test(c)) this.stop();
        this.i += 1; lit(c, s, false); continue;
      }
      if (c === '\\') { if (this.i + 1 >= t.length || t[this.i + 1] === '\n') this.stop(); this.i += 2; lit(t[s + 1], s, "\\"); continue; }
      if (c === '*' || c === '?' || c === '[' || c === ']') { this.i += 1; parts.push({ type: 'glob', start: s, end: this.i }); continue; }
      if (c === '~' && this.i === start) { this.i += 1; parts.push({ type: 'tilde', start: s, end: this.i }); continue; }
      if (!/[A-Za-z0-9_\-./:=+~%,@^!]/.test(c)) this.stop();
      this.i += 1; lit(c, s, false);
    }
    if (this.i === start) this.stop();
    return finishWord(start, this.i, parts);
  }
  hereString() {
    const t = this.text, start = this.i, quote = t[this.i + 1];
    this.i += t[this.i + 2] === '\r' ? 4 : 3;
    const bodyStart = this.i;
    for (let line = this.i; ; ) {
      if (t.startsWith(quote + '@', line)) {
        const bodyEnd = Math.max(bodyStart, line - (t[line - 2] === '\r' ? 2 : 1));
        this.i = line + 2;
        // An expandable here-string is data only when it expands nothing.
        if (quote === '"' && /[$`]/.test(t.slice(bodyStart, bodyEnd))) this.stop();
        if (this.i < t.length && !/[ \t\r\n;|]/.test(t[this.i])) this.stop();
        return { start, end: this.i, parts: [], value: null, here: { start: bodyStart, end: bodyEnd } };
      }
      const next = t.indexOf('\n', line);
      if (next < 0) this.stop();
      line = next + 1;
    }
  }
  doubleQuoted(parts) {
    const t = this.text; this.i += 1;
    let text = '', s = this.i;
    const flush = () => { if (text) parts.push({ type: 'lit', text, start: s, end: this.i, quoted: '"' }); text = ''; };
    for (;;) {
      const c = t[this.i];
      if (c === undefined || c === '`') this.stop();
      if (c === '"') {
        if (this.ps && t[this.i + 1] === '"') { text += '"'; this.i += 2; continue; }
        flush(); this.i += 1; return;
      }
      if (c === '$' && (this.ps ? /[A-Za-z_({?^]/.test(t[this.i + 1] || '') : /[A-Za-z_({0-9@*#?$!-]/.test(t[this.i + 1] || ''))) {
        flush(); this.dollar(parts, true); s = this.i; continue;
      }
      if (!this.ps && c === '\\') {
        if (t[this.i + 1] === '\n' || t[this.i + 1] === undefined) this.stop();
        if ('$`"\\'.includes(t[this.i + 1])) { text += t[this.i + 1]; this.i += 2; continue; }
      }
      text += c; this.i += 1;
    }
  }
  dollar(parts, quoted) {
    const t = this.text, s = this.i;
    if (this.at('$(')) {
      // Nesting this deep is no ordinary data command, and recursion must not reach the stack limit.
      if (this.at('$((') || this.depth >= DATA_MAX_DEPTH) this.stop();
      this.i += 2; this.depth += 1; const first = this.all.length;
      this.list(true);
      if (t[this.i] !== ')') this.stop();
      this.i += 1; this.depth -= 1;
      parts.push({ type: 'sub', start: s, end: this.i, commands: this.all.slice(first), quoted }); return;
    }
    const m = (this.ps ? /^\$(?:\{(env:)?([A-Za-z_][A-Za-z0-9_]*)\}|(env:)?([A-Za-z_][A-Za-z0-9_]*)|([?$^]))/i
      : /^\$(?:\{([A-Za-z_][A-Za-z0-9_]*)\}|([A-Za-z_][A-Za-z0-9_]*)|([0-9@*#?$!-]))/).exec(t.slice(this.i, this.i + 300));
    if (!m) this.stop();
    this.i += m[0].length;
    const env = this.ps && Boolean(m[1] || m[3]);
    const name = this.ps ? (m[2] || m[4] || m[5]).toLowerCase() : m[1] || m[2] || m[3];
    // Scope-qualified names (function:, alias:, using:) and member access are never data here.
    if (t[this.i] === ':' && this.ps) this.stop();
    if (!quoted && this.ps && this.i < t.length && !/[ \t\r\n;|\\/)]/.test(t[this.i])) this.stop();
    parts.push({ type: 'var', name, env, quoted, start: s, end: this.i });
  }
}
function finishWord(start, end, pieces) {
  // Adjacent literal pieces with the same quoting form one part, with its source offsets.
  const parts = [];
  for (const piece of pieces) {
    const prev = parts.at(-1);
    if (piece.type === 'lit' && prev?.type === 'lit' && prev.quoted === piece.quoted && prev.end === piece.start) {
      parts[parts.length - 1] = { ...prev, text: prev.text + piece.text, end: piece.end };
    } else parts.push(piece);
  }
  const literal = parts.every(p => p.type === 'lit');
  return { start, end, parts, quoted: parts.some(p => p.quoted), value: literal ? parts.map(p => p.text).join('') : null };
}
// Written files get a plain document name: no dot folder or dot file, no provider prefix and
// an extension nothing runs, so a write here cannot stage code, config or hooks.
function safeTarget(word) {
  return word.value !== null && !word.here
    && /^(?:[A-Za-z]:)?[\\/]?(?:[A-Za-z0-9_][A-Za-z0-9_ .-]*[\\/])*[A-Za-z0-9_][A-Za-z0-9_ .-]*\.(?:md|txt|log|csv)$/i.test(word.value);
}

const lower = value => value === null ? null : value.toLowerCase();
const optionWord = word => !word.quoted && word.value !== null && word.value.startsWith('-');
// Operand spans that are data: the whole word except nested substitutions, which are commands.
function dataSpans(word, from = word.start) {
  const spans = []; let at = from;
  for (const part of word.parts) {
    if (part.type !== 'sub' || part.end <= from) continue;
    if (part.start > at) spans.push({ start: at, end: part.start });
    at = part.end;
  }
  if (word.end > at) spans.push({ start: at, end: word.end });
  if (word.here) spans.push({ ...word.here });
  return spans;
}
// The value after an attached '--name=' prefix, when the prefix is a literal unquoted part.
function attachedValue(word, prefixes) {
  const first = word.parts[0];
  if (!first || first.type !== 'lit' || first.quoted) return null;
  const head = first.text.toLowerCase();
  const prefix = prefixes.find(p => head.startsWith(p) && head.length >= p.length);
  return prefix === undefined ? null : { start: first.start + prefix.length, end: word.end, prefix };
}

// Native programs with options that run programs (git, rg, node) must get each data word as
// exactly one argument. Windows PowerShell passes embedded quotes raw, and cmd splits single
// quotes and escaped quotes its own way, so either could turn data into an option.
function nativeWord(word, ctx) {
  // An unquoted substitution splits into several arguments (fields in POSIX, array items in
  // PowerShell), and so does an unquoted POSIX variable holding spaces or wildcards.
  if (word.parts.some(p => p.type === 'sub' && !p.quoted)) return false;
  if (ctx.shell === 'posix' && word.parts.some(p => p.type === 'var' && !p.quoted
    && (ctx.assigned.get(p.name) || []).some(value => value === null || /[\s*?[\]]/.test(value)))) return false;
  if (ctx.shell === 'powershell' || ctx.common) {
    if (word.parts.some(p => p.type === 'lit' && p.text.includes('"'))) return false;
    // Windows PowerShell quotes a spaced argument as "...\" when it ends in a backslash, and the
    // program then reads that quote as escaped and joins the following arguments differently.
    const last = word.parts.at(-1);
    if (last?.type === 'lit' && last.text.endsWith('\\')) return false;
    if (last?.type === 'var' && (ctx.assigned.get(last.name) || []).some(value => value === null || value.endsWith('\\'))) return false;
  }
  if (ctx.common && (/\\"|""/.test(ctx.raw(word))
    || word.parts.some(p => p.type === 'lit' && p.quoted === "'" && !/^[A-Za-z0-9_./:\\-]*$/.test(p.text)))) return false;
  return true;
}
// ...and a positional data word must never start with '-' at run time.
function plainOperand(word, ctx) {
  if (!nativeWord(word, ctx)) return false;
  const first = word.parts.find(p => p.type !== 'lit' || p.text !== '');
  if (!first || first.type === 'sub' || first.type === 'glob') return false;
  if (first.type === 'lit') return !first.text.startsWith('-');
  if (first.type === 'var') {
    const values = ctx.assigned.get(first.name) || [];
    return values.every(value => value !== null && !value.startsWith('-') && !(ctx.shell === 'powershell' && value.includes('"')));
  }
  return true;
}

// Walk native arguments against a fixed option table. Unknown or quoted options fail.
function nativeArgs(args, spec, ctx, data) {
  let ended = false, positional = 0;
  for (let n = 0; n < args.length; n += 1) {
    const word = args[n];
    if (word.here) return false;
    if (!ended && spec.dashdash && word.value === '--' && !word.quoted) { ended = true; continue; }
    const leading = word.parts[0]?.type === 'lit' && !word.parts[0].quoted && word.parts[0].text.startsWith('-');
    if (!ended && (leading || (word.value !== null && word.value.startsWith('-')))) {
      const attached = attachedValue(word, spec.attached || []);
      if (attached) { if (spec.nodash && !nativeWord(word, ctx)) return false; data.push(...dataSpans(word, attached.start)); continue; }
      if (!optionWord(word)) return false;
      const v = word.value;
      if (spec.switches.has(v) || spec.numeric?.test(v)) continue;
      if (spec.valued.has(v)) {
        const value = args[++n];
        if (!value || value.here || (spec.nodash && !nativeWord(value, ctx))) return false;
        data.push(...dataSpans(value)); continue;
      }
      if (spec.cluster) {
        const letters = v.slice(1);
        if (/^[A-Za-z]+$/.test(letters) && v[1] !== '-') {
          const last = letters.at(-1);
          if ([...letters.slice(0, -1)].every(l => spec.cluster.switches.includes(l))) {
            if (spec.cluster.switches.includes(last)) continue;
            if (spec.cluster.valued.includes(last)) {
              const value = args[++n];
              if (!value || value.here || (spec.nodash && !nativeWord(value, ctx))) return false;
              data.push(...dataSpans(value)); continue;
            }
          }
        }
        if (/^-[A-Za-z]\d+$/.test(v) && spec.cluster.valued.includes(v[1])) continue;
      }
      return false;
    }
    if (spec.nodash && !plainOperand(word, ctx)) return false;
    // A '<transport>::<address>' remote runs a remote helper, and git's ext:: helper runs a command.
    if (spec.remote && positional++ === 0 && word.parts.some(p => p.type === 'sub' || (p.type === 'lit' && p.text.includes('::'))
      || (p.type === 'var' && (ctx.assigned.get(p.name) || []).some(value => value === null || value.includes('::'))))) return false;
    data.push(...dataSpans(word));
  }
  return true;
}
const set = values => new Set(values);
const GH_SUBJECTS = set(['issue', 'pr']);
const GH_ACTIONS = set(['comment', 'create', 'edit', 'view', 'list']);
const GH_ITEM = {
  switches: set(['--draft', '-d', '--fill', '--comments', '-c', '--edit-last', '--web', '-w']),
  valued: set(['--body', '-b', '--title', '-t', '--body-file', '-F', '--repo', '-R', '--label', '-l', '--add-label', '--remove-label',
    '--assignee', '-a', '--add-assignee', '--remove-assignee', '--reviewer', '-r', '--add-reviewer', '--remove-reviewer', '--base', '-B',
    '--head', '-H', '--milestone', '-m', '--json', '--jq', '-q', '--template', '--state', '-s', '--limit', '-L', '--search', '-S', '--author', '-A']),
  attached: ['--body=', '--title=', '--body-file=', '--repo=', '--label=', '--json=', '--jq=', '--template=', '--base=', '--head=', '--state=', '--limit=', '--search='],
};
const GH_API = {
  switches: set(['--paginate', '--silent', '-i', '--include', '--verbose', '--slurp']),
  valued: set(['-X', '--method', '-f', '--raw-field', '-F', '--field', '-H', '--header', '--jq', '-q', '--template', '-t', '--input', '--hostname', '--cache']),
  attached: ['--method=', '--raw-field=', '--field=', '--header=', '--jq=', '--template=', '--input=', '--hostname='],
};
const GIT_SUBCOMMANDS = {
  status: { switches: ['--short', '-s', '--branch', '-b', '--porcelain', '--long', '--ignored', '-uno', '-unormal', '-uall', '--show-stash'],
    attached: ['--porcelain=', '--untracked-files=', '--ignore-submodules='] },
  log: { switches: ['--oneline', '--graph', '--decorate', '--no-decorate', '--all', '--stat', '--shortstat', '--name-only', '--name-status', '--no-merges',
    '--merges', '--first-parent', '--reverse', '-p', '--patch', '--no-patch', '-s', '--no-color', '--follow', '--date-order', '--topo-order',
    '--abbrev-commit', '--left-right', '--boundary', '--no-ext-diff'],
    valued: ['-n', '--max-count', '--author', '--grep', '--since', '--until', '--format', '--pretty', '--date', '--skip'],
    attached: ['--format=', '--pretty=', '--grep=', '--author=', '--since=', '--until=', '--after=', '--before=', '--max-count=', '--date=', '--skip=', '--decorate='],
    numeric: /^-\d+$/ },
  show: { switches: ['--stat', '--shortstat', '--name-only', '--name-status', '--oneline', '-s', '--no-patch', '--quiet', '--no-color', '--no-ext-diff', '--abbrev-commit'],
    attached: ['--format=', '--pretty=', '--date='] },
  diff: { switches: ['--stat', '--shortstat', '--numstat', '--name-only', '--name-status', '--cached', '--staged', '--check', '--no-color', '--quiet',
    '--exit-code', '--no-ext-diff', '--no-textconv', '-w', '--ignore-all-space', '--ignore-space-change', '-R', '--merge-base', '--summary', '--raw'],
    attached: ['--unified=', '--stat=', '--color=', '--diff-filter=', '--relative='], numeric: /^-U\d+$/ },
  'rev-parse': { switches: ['--short', '--verify', '--abbrev-ref', '--show-toplevel', '--git-dir', '--git-common-dir', '--is-inside-work-tree', '-q', '--quiet',
    '--symbolic-full-name', '--show-prefix', '--absolute-git-dir'], attached: ['--short='] },
  branch: { switches: ['--show-current', '-a', '--all', '-r', '--remotes', '--list', '-l', '-v', '-vv', '--verbose', '-d', '-D', '--delete', '--merged', '--no-merged', '--contains'],
    valued: ['-u', '--set-upstream-to'], attached: ['--set-upstream-to=', '--format='] },
  'ls-remote': { switches: ['--heads', '--tags', '-h', '-t', '--refs', '-q', '--quiet', '--symref'], remote: true },
  fetch: { switches: ['--prune', '-p', '--tags', '-t', '--all', '-q', '--quiet', '--no-tags', '--dry-run', '-v', '--verbose', '--prune-tags', '--unshallow'],
    valued: ['--depth'], attached: ['--depth='], remote: true },
  add: { switches: ['-A', '--all', '-u', '--update', '-v', '--verbose', '-n', '--dry-run', '-N', '--intent-to-add', '--ignore-errors'] },
  commit: { switches: ['-a', '--all', '--amend', '--no-edit', '--allow-empty', '-q', '--quiet', '-v', '--no-verify', '-n', '--signoff', '-s'],
    valued: ['-m', '--message', '-F', '--file', '--author', '--date'], attached: ['--message=', '--file=', '--author=', '--date='] },
  push: { switches: ['-u', '--set-upstream', '--tags', '--dry-run', '-n', '--follow-tags', '-v', '--verbose', '-q', '--quiet', '--porcelain', '--atomic', '--delete', '-d'], remote: true },
  // The patch path, branch names, start points and revisions are operands only.
  apply: { switches: ['-R', '--reverse', '--check', '--stat', '--numstat', '--summary'] },
  switch: { switches: ['--detach', '-q', '--quiet', '--track'], valued: ['-c', '-C'] },
  checkout: { switches: ['--detach', '-q', '--quiet', '--track'], valued: ['-b', '-B'] },
  'merge-base': { switches: ['--is-ancestor', '--all'] },
  'ls-tree': { switches: ['-r', '--name-only'] },
};
const GIT_WORKTREE = {
  list: { switches: ['--porcelain', '-v', '--verbose'] },
  prune: { switches: ['-v', '--verbose', '-n', '--dry-run'], valued: ['--expire'], attached: ['--expire='] },
  remove: { switches: ['-f', '--force'] },
  add: { switches: ['--detach', '-f', '--force', '--no-checkout', '--lock', '-q', '--quiet'], valued: ['-b', '-B'] },
};
function gitSpec(entry) {
  return { switches: set(entry.switches || []), valued: set(entry.valued || []), attached: entry.attached || [], numeric: entry.numeric, remote: entry.remote, dashdash: true, nodash: true };
}
const GREP = { switches: set(['--line-number', '--recursive', '--ignore-case', '--files-with-matches', '--files-without-match', '--count', '--fixed-strings',
  '--extended-regexp', '--word-regexp', '--line-regexp', '--invert-match', '--only-matching', '--no-filename', '--with-filename', '--quiet', '--silent', '--null', '--no-messages']),
  valued: set(['--regexp', '--file', '--include', '--exclude', '--exclude-dir', '--max-count', '--context', '--after-context', '--before-context']),
  attached: ['--regexp=', '--file=', '--include=', '--exclude=', '--exclude-dir=', '--max-count=', '--context=', '--after-context=', '--before-context=', '--color=', '--colour=', '--binary-files='],
  cluster: { switches: [...'rRnilLcwxFEhHovsqIaz'], valued: [...'efABCm'] }, numeric: /^-\d+$/, dashdash: true };
// rg has no --pre, --pre-glob, --search-zip or --hostname-bin here: those run programs.
const RG = { switches: set(['--line-number', '--ignore-case', '--smart-case', '--fixed-strings', '--files-with-matches', '--files', '--hidden', '--no-ignore',
  '--word-regexp', '--invert-match', '--count', '--only-matching', '--json', '--no-heading', '--with-filename', '--no-filename', '--no-line-number', '--multiline', '--no-config', '--follow']),
  valued: set(['--regexp', '--glob', '--type', '--type-not', '--max-count', '--max-depth', '--sort', '--context', '--after-context', '--before-context']),
  attached: ['--regexp=', '--glob=', '--type=', '--type-not=', '--max-count=', '--max-depth=', '--sort=', '--context=', '--color='],
  cluster: { switches: [...'nilFwvcoSuHNUL'], valued: [...'egtTABCm'] }, dashdash: true, nodash: true };
// Fixed Toolkit entry points by exact basename; options and values are data to the script.
// Names to recognise in a command only; this module never loads or starts them.
const TOOLKIT_SCRIPTS = set([
  'setup-toolkit.cjs',
  'toolkit-governance.cjs', 'toolkit-risk-tier.cjs', 'toolkit-install-health.cjs',
]);
// Coreutils without any option that runs a program. sort is listed separately below.
const COREUTILS = set(['head', 'tail', 'wc', 'uniq', 'cut', 'touch', 'stat', 'realpath', 'basename', 'dirname']);
const POSIX_FILE = set(['ls', 'cat', 'rm', 'mkdir', 'cp', 'mv', 'cd', 'pwd', 'echo']);
const SORT = { switches: set(['-r', '-n', '-u', '-f', '-V', '-h', '--reverse', '--numeric-sort', '--unique']), valued: set(['-k', '-t']), attached: ['--key=', '--field-separator='], nodash: true };
// PowerShell cmdlets and their default aliases. No parameter here runs code or writes outside
// a checked document; -Value, -Target, -OutVariable and script blocks are absent.
const PS_PATH_CMDLETS = set(['get-childitem', 'gci', 'ls', 'dir', 'get-content', 'gc', 'cat', 'type', 'get-item', 'gi', 'test-path', 'resolve-path', 'rvpa',
  'remove-item', 'rm', 'del', 'ri', 'rmdir', 'rd', 'erase', 'new-item', 'ni', 'mkdir', 'md', 'copy-item', 'cp', 'copy', 'cpi', 'move-item', 'mv', 'move', 'mi',
  'set-location', 'cd', 'sl', 'chdir', 'push-location', 'pushd', 'pop-location', 'popd', 'get-location', 'pwd', 'gl', 'get-filehash', 'select-string', 'sls']);
const PS_DATA_CMDLETS = set(['out-null', 'out-string', 'select-object', 'select', 'sort-object', 'sort', 'measure-object', 'measure', 'format-table', 'ft', 'format-list', 'fl',
  'convertfrom-json', 'convertto-json', 'get-unique', 'gu', 'write-output', 'echo', 'write', 'write-host']);
const PS_WRITERS = set(['set-content', 'add-content', 'ac', 'out-file', 'tee-object', 'tee']);
const PS_SWITCHES = set(['-recurse', '-force', '-file', '-directory', '-hidden', '-name', '-raw', '-leaf', '-parent', '-descending', '-unique', '-autosize', '-wrap',
  '-compress', '-line', '-word', '-character', '-sum', '-average', '-maximum', '-minimum', '-asstring', '-ashashtable', '-passthru', '-whatif', '-nonewline',
  '-noenumerate', '-simplematch', '-casesensitive', '-list', '-notmatch', '-allmatches', '-quiet', '-noemphasis', '-append', '-noclobber', '-confirm:$false']);
const PS_VALUED = set(['-path', '-literalpath', '-filter', '-include', '-exclude', '-destination', '-itemtype', '-depth', '-tail', '-totalcount', '-first', '-last', '-skip',
  '-index', '-property', '-expandproperty', '-encoding', '-erroraction', '-ea', '-algorithm', '-delimiter', '-readcount', '-object', '-foregroundcolor', '-backgroundcolor',
  '-separator', '-pattern', '-context', '-inputobject', '-width']);

function cmdletArgs(args, ctx, data, { paths = false, writer = false } = {}) {
  let target = null; const positional = [], values = [];
  for (let n = 0; n < args.length; n += 1) {
    const word = args[n];
    const raw = ctx.raw(word).toLowerCase();
    if (!word.quoted && raw.startsWith('-')) {
      if (PS_SWITCHES.has(raw)) continue;
      if (writer && ['-path', '-literalpath', '-filepath'].includes(raw)) { if (target || !args[n + 1]) return false; target = args[++n]; continue; }
      if (writer && raw === '-value') { if (!args[n + 1]) return false; data.push(...dataSpans(args[++n])); continue; }
      if (!PS_VALUED.has(raw) || !args[n + 1]) return false;
      values.push(args[++n]); continue;
    }
    positional.push(word);
  }
  if (writer) {
    if (!target) target = positional.shift();
    if (!target || !safeTarget(target)) return false;
  }
  for (const word of [...positional, ...values]) {
    // A provider path (function:, alias:, env:, variable:) is a definition or a variable, not a file.
    if (paths && word.parts.some((p, k) => p.type === 'lit' && p.text.includes(':')
      && !(k === 0 && /^[A-Za-z]:(?:[\\/]|$)/.test(p.text) && p.text.indexOf(':', 2) < 0))) return false;
    data.push(...dataSpans(word));
  }
  return true;
}

function matchDataCommand(cmd, ctx) {
  const data = [];
  if (cmd.assign) {
    const value = cmd.assign.value;
    if (ctx.shell === 'powershell') {
      const name = cmd.assign.name.toLowerCase();
      if (/^ps|preference$/.test(name) || ['ofs', 'args', 'input', 'home', 'pwd', 'profile', 'host', 'null', 'true', 'false', 'this', 'executioncontext',
        'error', 'matches', 'lastexitcode', 'myinvocation', 'pid', 'shellid', 'foreach', 'switch'].includes(name)) return null;
      // In expression mode a bare word would run as a command; only strings and variables are values.
      if (!value || !(value.here || value.parts[0]?.quoted || value.parts[0]?.type === 'var')) return null;
    } else if (!/[a-z]/.test(cmd.assign.name)) return null;
    data.push({ start: cmd.assign.start, end: cmd.assign.end });
    if (value) data.push(...dataSpans(value));
    return { data };
  }
  const words = cmd.words;
  if (words.length === 1 && words[0].here) return { data: dataSpans(words[0]) };
  const head = words[0];
  if (head.quoted || head.value === null || !/^[A-Za-z][A-Za-z0-9_.-]*$/.test(head.value)) return null;
  const name = head.value.toLowerCase().replace(/\.exe$/, ''), args = words.slice(1);
  if (args.some(w => w.here) && !(ctx.shell === 'powershell' && PS_WRITERS.has(name))) return null;
  if (cmd.heredoc && !((name === 'cat' && !args.length) || name === 'tee')) return null;
  if (cmd.heredoc) data.push({ start: cmd.heredoc.bodyStart, end: cmd.heredoc.bodyEnd });
  if (name === 'gh') {
    const subject = lower(args[0]?.value ?? null), action = lower(args[1]?.value ?? null);
    if (args[0]?.quoted || args[1]?.quoted) return null;
    if (subject === 'api') return nativeArgs(args.slice(1), GH_API, ctx, data) ? { data } : null;
    if (!GH_SUBJECTS.has(subject) || !GH_ACTIONS.has(action)) return null;
    return nativeArgs(args.slice(2), GH_ITEM, ctx, data) ? { data } : null;
  }
  if (name === 'git') {
    let n = 0;
    for (; n < args.length; n += 1) {
      if (args[n].quoted) return null;
      if (['--no-pager', '-P'].includes(args[n].value)) continue;
      if (args[n].value === '-C') {
        if (!args[n + 1] || !plainOperand(args[n + 1], ctx)) return null;
        data.push(...dataSpans(args[++n])); continue;
      }
      break;
    }
    const sub = args[n]?.value;
    let entry = Object.hasOwn(GIT_SUBCOMMANDS, sub || '') ? GIT_SUBCOMMANDS[sub] : null;
    if (sub === 'worktree') {
      if (args[n + 1]?.quoted) return null;
      entry = Object.hasOwn(GIT_WORKTREE, args[n + 1]?.value || '') ? GIT_WORKTREE[args[++n].value] : null;
    }
    if (!entry || args[n].quoted) return null;
    return nativeArgs(args.slice(n + 1), gitSpec(entry), ctx, data) ? { data } : null;
  }
  if (name === 'grep') return nativeArgs(args, GREP, ctx, data) ? { data } : null;
  if (name === 'rg') return nativeArgs(args, RG, ctx, data) ? { data } : null;
  if (name === 'node') {
    const script = args[0];
    if (!script || script.here || optionWord(script) || !plainOperand(script, ctx)) return null;
    const last = script.parts.at(-1);
    if (!last || last.type !== 'lit' || script.parts.some(p => p.type === 'sub' || p.type === 'glob')) return null;
    const base = /(?:^|[\\/])([^\\/]+)$/.exec(last.text)?.[1];
    if (!base || !TOOLKIT_SCRIPTS.has(base.toLowerCase()) || (script.parts.length === 1 ? false : !/[\\/]/.test(last.text))) return null;
    // The folder is literal, the home folder or the user profile; never a variable this input sets.
    // A POSIX shell reads $env:USERPROFILE as an unset $env before a literal folder name.
    const first = script.parts[0];
    if (first.type === 'var' && (ctx.assigned.has(first.name)
      || !(ctx.shell === 'powershell' ? first.env && first.name === 'userprofile' : ['HOME', 'env'].includes(first.name)))) return null;
    data.push(...dataSpans(script));
    // Only the --host value is data. Every other option and operand stays evidence.
    const rest = args.slice(1);
    for (let n = 0; n < rest.length; n += 1) {
      const word = rest[n];
      if (word.here || !plainOperand(word, ctx) && !optionWord(word)) return null;
      if (!optionWord(word)) continue;
      if (!/^--?[A-Za-z][A-Za-z0-9-]*(?:=[A-Za-z0-9_.-]*)?$/.test(word.value)) return null;
      if (word.value.startsWith('--host=')) data.push({ start: word.start + 7, end: word.end });
      else if (word.value === '--host') {
        const value = rest[++n];
        if (!value || value.value === null || !/^[a-z]+$/.test(value.value)) return null;
        data.push(...dataSpans(value));
      }
    }
    return { data };
  }
  if (ctx.shell === 'powershell') {
    if (PS_WRITERS.has(name)) return cmdletArgs(args, ctx, data, { paths: true, writer: true }) ? { data } : null;
    if (PS_PATH_CMDLETS.has(name)) return cmdletArgs(args, ctx, data, { paths: true }) ? { data } : null;
    if (PS_DATA_CMDLETS.has(name)) return cmdletArgs(args, ctx, data) ? { data } : null;
  } else {
    if (name === 'tee') {
      for (const word of args) {
        if (word.value === '-a' && !word.quoted) continue;
        if (!safeTarget(word)) return null;
      }
      return args.length ? { data } : null;
    }
    if (name === 'sort') return nativeArgs(args, SORT, ctx, data) ? { data } : null;
    // A shell that may be PowerShell needs the cmdlet reading too. Verb-noun names are no POSIX tools.
    if (name.includes('-') && (PS_PATH_CMDLETS.has(name) || PS_DATA_CMDLETS.has(name))) return cmdletArgs(args, ctx, data) ? { data } : null;
    if (COREUTILS.has(name) || POSIX_FILE.has(name)) {
      for (const word of args) {
        if (optionWord(word)) { if (!/^-{1,2}[A-Za-z0-9][A-Za-z0-9-]*$/.test(word.value)) return null; continue; }
        data.push(...dataSpans(word));
      }
      return { data };
    }
  }
  if (COREUTILS.has(name)) {
    for (const word of args) {
      if (optionWord(word)) { if (!/^-{1,2}[A-Za-z0-9][A-Za-z0-9-]*$/.test(word.value)) return null; continue; }
      data.push(...dataSpans(word));
    }
    return { data };
  }
  return null;
}

// An omitted shell may also be cmd, which ignores everything after the first LF but sees
// neither single quotes nor the other shells' escapes. Within that line, data must hold no
// expansion and no unquoted cmd operator, so cmd cannot run part of it either.
function cmdLineSafe(text, spans) {
  const line = text.indexOf('\n') < 0 ? text.length : text.indexOf('\n');
  const data = new Array(line).fill(false);
  for (const span of spans) for (let i = span.start; i < Math.min(span.end, line); i += 1) data[i] = true;
  let quoted = false;
  for (let i = 0; i < line; i += 1) {
    const c = text[i];
    if (c === '"') { quoted = !quoted; continue; }
    if (c === '^' && !quoted) return false;
    if (data[i] && (c === '%' || c === '!' || (!quoted && '&|<>'.includes(c)))) return false;
  }
  return true;
}

// One proof per shell: the scanner consumed everything, every command matched a schema, and the
// masked remainder carries no host or selector evidence. Inert PowerShell runs nothing at all.
function shellDataProof(text, shell, inertAllowed, scanShell) {
  const scanner = new DataScanner(text, shell, inertAllowed);
  let commands;
  try { commands = scanner.run(); } catch (error) { if (error === DATA_INERT) return { spans: [], inert: true }; if (error === DATA_STOP) return null; throw error; }
  const assigned = new Map();
  for (const cmd of commands) {
    if (!cmd.assign) continue;
    const value = cmd.assign.value, key = shell === 'powershell' ? cmd.assign.name.toLowerCase() : cmd.assign.name;
    const literal = !value ? '' : value.here ? text.slice(value.here.start, value.here.end) : value.value;
    assigned.set(key, [...(assigned.get(key) || []), literal]);
  }
  const ctx = { shell, common: inertAllowed, assigned, raw: word => text.slice(word.start, word.end) };
  const spans = [];
  for (const cmd of commands) {
    const proof = matchDataCommand(cmd, ctx);
    if (!proof) return null;
    spans.push(...proof.data);
  }
  if (!spans.length) return null;
  const chars = text.split('');
  for (const span of spans) for (let i = span.start; i < span.end; i += 1) if (chars[i] !== '\n') chars[i] = ' ';
  return broadVisible(chars.join(''), true, scanShell) ? null : { spans, inert: false };
}
function dataArguments(text, input, host = null) {
  if (typeof text !== 'string' || !text || text.length > LIMITS.command || /[^\x09\x0a\x0d\x20-\x7e]/.test(text)) return false;
  const shells = dataShells(input, host);
  if (!shells) return false;
  const scanShell = roleShell(input), common = shells.length > 1;
  const proofs = shells.map(shell => shellDataProof(text, shell, common, scanShell));
  if (proofs.some(proof => !proof) || proofs.every(proof => proof.inert)) return false;
  return !common || proofs.every(proof => cmdLineSafe(text, proof.spans));
}

// host is the hook entry point's own host ('claude' or 'codex'), or null when unknown.
function parse(text, input, { host = null } = {}) {
  const result = parseCommand(text, input);
  return result === UNKNOWN && dataArguments(text, input, host) ? NONE : result;
}

function parseCommand(text, input) {
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

module.exports = Object.freeze({ ContinuationResolver, TranscriptReader, LIMITS, parse, visible, executionDirectory });
