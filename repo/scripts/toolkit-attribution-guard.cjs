'use strict';

// Refuses shell commands that would put AI attribution into a commit or a pull request: a
// Co-Authored-By trailer naming Claude or Anthropic, a Claude-Session trailer (: or =), a claude.ai session
// link, or a "Generated with Claude Code" footer. It looks only at `git commit` and `gh pr create` /
// `gh pr edit` / `gh pr merge`, in the command text and in a message or body file the command names. Ordinary text
// that merely mentions Claude passes. Used by the Claude Code PreToolUse hook and the Codex helper hook.
//
// It also refuses commands that skip a repository's own commit and push checks (git commit -n or
// --no-verify, git push --no-verify, or a different core.hooksPath) in a Toolkit-governed (GitHub governance ENABLED, or the governed block present) or
// personal-data-guarded repository, and force pushes (--force, -f, --force-with-lease, --mirror or a
// +refspec) there and to an evidence store (a TRANSPORT-* repository). This is best effort: CI and
// branch rules are the backstop. Not covered:
// GIT_CONFIG_* environment variables, remote.*.push or remote.*.mirror settings, git aliases, scripts and programs that run git themselves,
// a cd that is not its own command in the same line, and commands nested more than two shells deep.
//
// Last, a `git push` or `gh pr create` that passed those checks is refused when what it would send
// carries a credential or a plain-text finding (toolkit-push-check.cjs). That step fails open: if it
// cannot check, the command runs with one note on stderr. The same gaps apply.

const fs = require('node:fs');
const path = require('node:path');
const { ShellCall } = require('./toolkit-shell-call.cjs');

const MESSAGE = 'Remove the AI attribution lines (Co-Authored-By or Claude-Session trailers, claude.ai session links, "Generated with" footers) and retry.';
const ATTRIBUTION_PATTERNS = Object.freeze([
  /https?:\/\/claude\.ai\/(?:code\/)?(?:session|chat)[^\s"'`)]*/i,
  /Generated with \[?Claude Code/i
]);
const GIT_VALUE_OPTIONS = new Set(['-c', '-C', '--git-dir', '--work-tree', '--namespace', '--config-env', '--super-prefix']);
const MAX_COMMAND_CHARS = 1024 * 1024;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_DIRECTORY_OPTIONS = 64;
const DIRECTORY_LIMIT = `This shell command exceeds the attribution check's ${MAX_DIRECTORY_OPTIONS} git -C options per command. Split it into smaller commands and retry.`;
const MAX_FILE_OPTIONS = 64;
const FILE_LIMIT = `This shell command exceeds the attribution check's ${MAX_FILE_OPTIONS} file options per command or unpaired file options across the text. Split it into smaller commands and retry.`;
// Retain the old file screen when shell syntax prevents pairing an option with its command.
const FILE_OPTIONS = /(?:^|\s)(?:-F(?:=|\s+)?|--file(?:=|\s+)|--body-file(?:=|\s+))("[^"]+"|'[^']+'|[^\s"']+)/g;

// One word scan, without retrying the remainder of a line for every occurrence of git.
// Raw text deliberately includes wrappers, substitutions, here-documents and here-strings.
function commitOrPr(text) {
  let git = false;
  for (const [word] of text.matchAll(/\bgit\b|\bcommit\b|[\n;&|]/g)) {
    if (word === 'git') git = true;
    else if (word === 'commit') { if (git) return true; }
    else git = false;
  }
  return /\bgh\s+pr\s+(?:create|edit|merge)\b/.test(text);
}

function trailerStart(line, name) {
  let start = line.indexOf(name);
  while (start !== -1) {
    let end = start + name.length;
    while (line[end] === ' ' || line[end] === '\t') end += 1;
    if (line[end] === ':' || line[end] === '=') return start;
    start = line.indexOf(name, end);
  }
  return -1;
}

function hasAttribution(text) {
  const value = String(text || '');
  const trailer = value.toLowerCase().split('\n').some((line) => {
    if (trailerStart(line, 'claude-session') !== -1) return true;
    const start = trailerStart(line, 'co-authored-by');
    // A trailer naming Claude or an anthropic.com address; this is text matching, not URL checking.
    return start !== -1 && /claude|anthropic\.com/.test(line.slice(start));
  });
  return trailer || ATTRIBUTION_PATTERNS.some((pattern) => pattern.test(value));
}

// Read shell words in one pass. Quotes protect separators; shell escapes and both Bash and
// PowerShell line continuations stay inside the same command. Backslashes in Windows paths stay.
function shellCommands(text) {
  const commands = [];
  let words = []; let offsets = []; let word = ''; let started = false; let quote = ''; let offset = 0;
  const finishWord = () => { if (started) { words.push(word); offsets.push(offset); } word = ''; started = false; };
  const finishCommand = () => { finishWord(); if (words.length) commands.push({ words, offsets }); words = []; offsets = []; };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (!started) offset = index;
    if (quote !== "'" && (char === '\\' || char === '`')) {
      if (next === '\n' || (next === '\r' && text[index + 2] === '\n')) {
        index += next === '\r' ? 2 : 1;
        continue;
      }
      if (next && (char === '`' || (quote === '"' ? '"\\$`'.includes(next) : /[\s"'\\;&|()]/.test(next)))) {
        word += next; started = true; index += 1; continue;
      }
    }
    if (quote) {
      if (char === quote) {
        if (quote === "'" && next === "'") { word += char; index += 1; }
        else quote = '';
      } else word += char;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; started = true; continue; }
    if (char === '#' && !started) {
      while (index + 1 < text.length && text[index + 1] !== '\n') index += 1;
      continue;
    }
    if (char === ';' || char === '|' || char === '\n' || char === '(' || char === ')' || (char === '&' && next === '&')) {
      finishCommand();
      if ((char === '|' || char === '&') && next === char) index += 1;
    } else if (/\s/.test(char)) finishWord();
    else { word += char; started = true; }
  }
  finishCommand();
  return commands;
}

// Find the relevant subcommand after git's global options. Each -C is relative to the previous
// folder, while gh always uses the base folder. Option values cannot be mistaken for subcommands.
function messageCommand({ words, offsets }, root) {
  const start = words.findIndex((word) => /(?:^|[\\/])(?:git|gh)(?:\.exe)?$/i.test(word));
  if (start === -1) return null;
  if (/(?:^|[\\/])gh(?:\.exe)?$/i.test(words[start])) {
    return words[start + 1] === 'pr' && ['create', 'edit', 'merge'].includes(words[start + 2])
      ? { base: root, git: false, words: words.slice(start + 3), offsets: offsets.slice(start + 3) } : null;
  }
  let base = root;
  let directories = 0;
  for (let index = start + 1; index < words.length; index += 1) {
    const word = words[index];
    if (GIT_VALUE_OPTIONS.has(word)) {
      const value = words[++index];
      if (value === undefined) return null;
      if (word === '-C') {
        if (++directories > MAX_DIRECTORY_OPTIONS) return { refusal: DIRECTORY_LIMIT };
        if (value) base = path.resolve(base, value);
      }
    } else if (word.startsWith('-C') && word.length > 2) {
      if (++directories > MAX_DIRECTORY_OPTIONS) return { refusal: DIRECTORY_LIMIT };
      base = path.resolve(base, word.slice(2));
    } else if (!word.startsWith('-')) return word === 'commit' ? { base, git: true, words: words.slice(index + 1), offsets: offsets.slice(index + 1) } : null;
    // Other global options, including --option=value and attached -c values, occupy one word.
  }
  return null;
}

function namedFiles({ words, offsets, git }) {
  const files = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const offset = offsets[index];
    if (word === '--') break;
    let raw; let fileOption = false;
    if (word === '--file' || word === '--body-file' || (!git && word === '-F')) {
      fileOption = true; raw = words[++index];
    } else if (word.startsWith('--file=')) { fileOption = true; raw = word.slice(7); }
    else if (word.startsWith('--body-file=')) { fileOption = true; raw = word.slice(12); }
    else if (!git && word.startsWith('-F')) { fileOption = true; raw = word.slice(word[2] === '=' ? 3 : 2); }
    else if (git && word.startsWith('-') && !word.startsWith('--')) {
      for (let letter = 1; letter < word.length; letter += 1) {
        if (!'mFcCt'.includes(word[letter])) continue;
        const value = word.slice(letter + 1) || words[++index];
        if (word[letter] === 'F') {
          fileOption = true; raw = value;
          // Retain the existing -F=file spelling too.
          if (raw?.startsWith('=')) raw = raw.slice(1);
        }
        break;
      }
    }
    if (fileOption) {
      files.push({ raw, offset });
      if (files.length > MAX_FILE_OPTIONS) return { refusal: FILE_LIMIT };
    }
  }
  return { files };
}

function readSmallFile(file) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) return '';
    return fs.readFileSync(file, 'utf8');
  } catch { return ''; }
}

// Cache both resolution and inspection for one call, including missing and oversized files.
class AttributionFileScreen {
  constructor(readFile = readSmallFile) {
    this.readFile = readFile;
    this.resolved = new Map();
    this.checked = new Map();
  }

  hasAttribution(base, raw) {
    if (!raw || raw === '-') return false;
    if (!this.resolved.has(base)) this.resolved.set(base, new Map());
    const paths = this.resolved.get(base);
    if (!paths.has(raw)) paths.set(raw, path.resolve(base, raw));
    const file = paths.get(raw);
    if (!this.checked.has(file)) this.checked.set(file, hasAttribution(this.readFile(file)));
    return this.checked.get(file);
  }
}

// Returns the refusal reason, or '' when the command may run.
function attributionRefusal(command, cwd) {
  const text = String(command || '');
  if (text.length > MAX_COMMAND_CHARS) return `This shell command exceeds the attribution check's ${MAX_COMMAND_CHARS}-character limit. Split it into smaller commands and retry.`;
  const rawCommand = commitOrPr(text);
  if (rawCommand && hasAttribution(text)) return MESSAGE;
  const root = cwd || process.cwd();
  const commands = shellCommands(text).map((current) => messageCommand(current, root)).filter(Boolean);
  if (commands.some((current) => current.refusal)) return DIRECTORY_LIMIT;
  if (!rawCommand && !commands.length) return '';
  if (hasAttribution(text)) return MESSAGE;
  const paired = new Set();
  const screen = new AttributionFileScreen();
  for (const current of commands) {
    const result = namedFiles(current);
    if (result.refusal) return result.refusal;
    for (const { raw, offset } of result.files) {
      paired.add(offset);
      if (screen.hasAttribution(current.base, raw)) return MESSAGE;
    }
  }
  // The legacy -C interpretation is retained only for unpaired files. Always check the base
  // folder too: a wrapper or an unmatched quote must not silently disable file screening.
  const legacyDirectory = /\bgit\s+-C\s+("[^"]+"|'[^']+'|\S+)/.exec(text)?.[1]?.replace(/^["']|["']$/g, '');
  const bases = legacyDirectory ? [root, path.resolve(root, legacyDirectory)] : [root];
  let unpaired = 0;
  for (const match of text.matchAll(FILE_OPTIONS)) {
    const offset = match.index + (/\s/.test(match[0][0]) ? 1 : 0);
    if (paired.has(offset)) continue;
    if (++unpaired > MAX_FILE_OPTIONS) return FILE_LIMIT;
    const raw = match[1].replace(/^["']|["']$/g, '');
    if (raw === '-') continue;
    for (const base of bases) if (screen.hasAttribution(base, raw)) return MESSAGE;
  }
  return '';
}

const BYPASS_MESSAGE = 'This command skips the repository\'s commit or push checks (git commit -n or --no-verify, git push --no-verify, or a different core.hooksPath). This repository runs them on every commit and push: fix what they report and retry without the bypass. If a check is wrong, tell the owner.';
const FORCE_MESSAGE = 'This command force-pushes (--force, -f, --force-with-lease, --mirror or a +refspec). Toolkit-governed repositories and evidence stores keep their history: push a new commit or a merge commit instead, or push to a new branch.';
const HOOKS_PATH = 'core.hookspath';
const PUSH_VALUE_LETTERS = 'o';
const PUSH_VALUE_OPTIONS = new Set(['--repo', '--receive-pack', '--exec', '--push-option']);
const GIT_CONFIG_WRITES = new Set(['set', 'unset', '--unset', '--unset-all', '--replace-all', '--add', 'edit', '--edit', '-e', 'rename-section', 'remove-section', '--rename-section', '--remove-section']);
const COMMIT_VALUE_LETTERS = 'mFcCtS';

// git accepts any unambiguous prefix of a long option; "--no-veri" is the shortest that cannot
// also mean --no-verbose.
function noVerify(word) { return word.length >= 9 && '--no-verify'.startsWith(word); }

// git's global options and its subcommand, with the folder the command runs in.
function gitCommand({ words }, root) {
  const start = words.findIndex((word) => /(?:^|[\\/])git(?:\.exe)?$/i.test(word));
  if (start === -1) return null;
  let base = root;
  let directories = 0;
  const configs = [];
  for (let index = start + 1; index < words.length; index += 1) {
    const word = words[index];
    if (word === '-c' || word === '--config-env') configs.push(words[++index] || '');
    else if (word.startsWith('--config-env=')) configs.push(word.slice(13));
    else if (word.startsWith('-c') && word.length > 2) configs.push(word.slice(2));
    else if (word === '-C' || word.startsWith('-C')) {
      const value = word === '-C' ? words[++index] : word.slice(2);
      if (value === undefined) return null;
      if (++directories > MAX_DIRECTORY_OPTIONS) return { refusal: DIRECTORY_LIMIT };
      if (value) base = path.resolve(base, value);
    } else if (word === '--work-tree') { const value = words[++index]; if (value) base = path.resolve(base, value); }
    else if (word.startsWith('--work-tree=')) base = path.resolve(base, word.slice(12));
    else if (GIT_VALUE_OPTIONS.has(word)) index += 1;
    else if (!word.startsWith('-')) return { base, configs, sub: word, args: words.slice(index + 1) };
  }
  return { base, configs, sub: null, args: [] };
}

function skipsChecks({ configs, sub, args }) {
  if (configs.some((value) => value.toLowerCase().startsWith(`${HOOKS_PATH}=`) || value.toLowerCase() === HOOKS_PATH)) return true;
  const end = args.indexOf('--');
  const options = end === -1 ? args : args.slice(0, end);
  if (sub === 'commit') {
    for (let index = 0; index < options.length; index += 1) {
      const word = options[index];
      if (noVerify(word)) return true;
      if (!word.startsWith('-') || word.startsWith('--')) continue;
      // A short-option bundle such as -an. Letters after a value-taking letter are its value, and
      // a value-taking letter at the end takes the next word (-S takes only an attached value).
      for (let letter = 1; letter < word.length; letter += 1) {
        if (word[letter] === 'n') return true;
        if (COMMIT_VALUE_LETTERS.includes(word[letter])) {
          if (letter === word.length - 1 && word[letter] !== 'S') index += 1;
          break;
        }
      }
    }
  }
  if (sub === 'push') return options.some(noVerify);
  if (sub === 'config') {
    const key = args.findIndex((word) => word.toLowerCase() === HOOKS_PATH);
    if (key === -1) return false;
    if (args.some((word) => GIT_CONFIG_WRITES.has(word))) return true;
    // `git config core.hooksPath <value>` sets it; `--get` or the key alone only reads it.
    return args.slice(key + 1).some((word) => !word.startsWith('-'));
  }
  return false;
}

// Whether a push rewrites history on the remote: --force and its abbreviations, -f in a
// short-option bundle, --force-with-lease, --mirror, or a refspec that starts with +.
function forcePush({ sub, args }) {
  if (sub !== 'push') return false;
  let positional = 0;
  for (let index = 0; index < args.length; index += 1) {
    const word = args[index];
    if (word === '--') { positional = Infinity; continue; }
    if (positional !== Infinity && word.startsWith('--')) {
      if (word.startsWith('--force') || (word.length >= 5 && '--force'.startsWith(word)) || word === '--mirror') return true;
      if (PUSH_VALUE_OPTIONS.has(word)) index += 1;
      continue;
    }
    if (positional !== Infinity && word.startsWith('-') && word.length > 1) {
      for (let letter = 1; letter < word.length; letter += 1) {
        if (word[letter] === 'f') return true;
        if (PUSH_VALUE_LETTERS.includes(word[letter])) { if (letter === word.length - 1) index += 1; break; }
      }
      continue;
    }
    // The first word after the options is the remote; the rest are refspecs.
    if (positional++ > 0 && word.startsWith('+')) return true;
  }
  return false;
}

// The repository's git config text, also for a worktree whose .git is a file.
function gitConfigText(root) {
  const dotGit = path.join(root, '.git');
  let gitDir = dotGit;
  try {
    if (fs.statSync(dotGit).isFile()) {
      gitDir = path.resolve(root, readSmallFile(dotGit).replace(/^gitdir:\s*/, '').trim());
      const common = readSmallFile(path.join(gitDir, 'commondir')).trim();
      if (common) gitDir = path.resolve(gitDir, common);
    }
  } catch { return ''; }
  return readSmallFile(path.join(gitDir, 'config'));
}

// An evidence store by its repository name: a remote URL ending in TRANSPORT-<name>.
const STORE_URL = /(?:^|[/:])transport-[\w.-]+?(?:\.git)?\/?$/i;
function storeUrl(url) { return STORE_URL.test(String(url || '').trim()); }

// Whether the repository's GitHub governance state is ENABLED (setup finished or not), or ERROR (a
// merged binding that cannot be used never quietly drops protection). A state that cannot be read, or
// a copy without the state module, counts as not enabled here; the block and guard-config checks
// below still apply.
function governanceEnabled(root, registryOptions) {
  try { return ['ENABLED', 'ERROR'].includes(require('./toolkit-governance-state.cjs').governanceState(root, registryOptions).state); } catch { return false; }
}

// What protects the repository a folder is in: `checked` when the nearest folder with a .git entry
// carries the governed rules block in AGENTS.md or the guard config, or its GitHub governance is
// ENABLED, `store` when one of its remotes is an evidence store.
function repositoryKind(folder, cache, registryOptions = {}) {
  if (cache.has(folder)) return cache.get(folder);
  let answer = { checked: false, store: false };
  for (let current = folder, depth = 0; depth < 64; depth += 1) {
    if (fs.existsSync(path.join(current, '.git'))) {
      answer = {
        checked: fs.existsSync(path.join(current, '.github', 'personal-data-guard.json'))
          || /BEGIN TOOLKIT-GOVERNED-RULES\b/.test(readSmallFile(path.join(current, 'AGENTS.md')))
          || governanceEnabled(current, registryOptions),
        store: [...gitConfigText(current).matchAll(/^\s*url\s*=\s*(.+)$/gim)].some((match) => storeUrl(match[1])),
      };
      break;
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  cache.set(folder, answer);
  return answer;
}

const SHELLS = /(?:^|[\\/])(?:bash|sh|zsh|dash|ksh|pwsh|powershell|cmd|eval|invoke-expression|iex)(?:\.exe)?$/i;

// Returns the refusal reason, or '' when the command may run. A quoted command handed to a
// shell (bash -c "...", pwsh -Command "...") is read too, up to two levels deep.
// `registryOptions` is for tests (the governance decisions file to read).
function bypassRefusal(command, cwd, depth = 0, registryOptions = {}) {
  const text = String(command || '');
  if (text.length > MAX_COMMAND_CHARS || !/\bgit\b/i.test(text)) return '';
  let root = cwd || process.cwd();
  const cache = new Map();
  for (const current of shellCommands(text)) {
    // A cd earlier in the same command line moves the folder later git commands run in.
    if (/^(?:cd|pushd|set-location|sl)$/i.test(current.words[0]) && current.words.length === 2) {
      root = path.resolve(root, current.words[1]);
      continue;
    }
    const git = gitCommand(current, root);
    if (git?.refusal) return git.refusal;
    if (git && skipsChecks(git) && repositoryKind(git.base, cache, registryOptions).checked) return BYPASS_MESSAGE;
    if (git && forcePush(git)) {
      const kind = repositoryKind(git.base, cache, registryOptions);
      const target = git.args.find((word) => !word.startsWith('-'));
      if (kind.checked || kind.store || storeUrl(target)) return FORCE_MESSAGE;
    }
    if (depth < 2 && SHELLS.test(current.words[0])) {
      for (const word of current.words.slice(1)) {
        if (/\s/.test(word) && /\bgit\b/i.test(word)) {
          const nested = bypassRefusal(word, root, depth + 1, registryOptions);
          if (nested) return nested;
        }
      }
    }
  }
  return '';
}

// The value of a gh option given as `--name value`, `--name=value`, `-X value` or `-Xvalue`.
function ghOption(words, long, short) {
  let value = '';
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    if (word === long || word === short) value = words[++index] || '';
    else if (word.startsWith(`${long}=`)) value = word.slice(long.length + 1);
    else if (word.startsWith(short) && word.length > 2) value = word.slice(2);
  }
  return value;
}

// `gh pr create` with its base branch (--base or -B) and the branch it proposes (--head or -H,
// `owner:branch` read as `branch`), or null.
function pullRequestCreate({ words }, root) {
  const start = words.findIndex((word) => /(?:^|[\\/])gh(?:\.exe)?$/i.test(word));
  if (start === -1 || words[start + 1] !== 'pr' || words[start + 2] !== 'create') return null;
  const rest = words.slice(start + 3);
  const head = ghOption(rest, '--head', '-H').replace(/^[^:]*:/, '');
  return { folder: root, pullRequest: true, base: ghOption(rest, '--base', '-B'), sources: head ? [head] : [] };
}

// What a `git push` sends: { remote, sources } from its remote and the local side of each refspec,
// or null when it only deletes. No refspec means the current branch; --all and --tags read every
// branch or tag.
function pushTarget(args, folder) {
  if (args.some((word) => word === '--delete' || word === '-d')) return null;
  const positional = []; const sources = [];
  for (let index = 0; index < args.length; index += 1) {
    const word = args[index];
    if (word === '--') { positional.push(...args.slice(index + 1)); break; }
    if (word === '--all' || word === '--branches') sources.push('--branches');
    else if (word === '--tags') sources.push('--tags');
    else if (PUSH_VALUE_OPTIONS.has(word) || word === '-o') index += 1;
    else if (!word.startsWith('-')) positional.push(word);
  }
  const [remote, ...refspecs] = positional;
  let deletes = 0;
  for (let index = 0; index < refspecs.length; index += 1) {
    let spec = refspecs[index].replace(/^\+/, '');
    if (spec === 'tag' && refspecs[index + 1]) spec = `refs/tags/${refspecs[++index]}`;
    const source = spec.includes(':') ? spec.slice(0, spec.indexOf(':')) : spec;
    if (source) sources.push(source); else deletes += 1;
  }
  if (deletes && !sources.length) return null;
  return { folder, remote: remote || '', sources };
}

// What a push or a new pull request sends, for each one in a command line, with the same cd,
// git -C and nested-shell reading as the bypass check: push and pull-request targets as
// toolkit-push-check.cjs reads them. A push that only deletes sends nothing to check.
function outgoingChanges(command, cwd, depth = 0) {
  const text = String(command || '');
  const found = [];
  if (text.length > MAX_COMMAND_CHARS || !/\b(?:git|gh)\b/i.test(text)) return found;
  let root = cwd || process.cwd();
  for (const current of shellCommands(text)) {
    if (/^(?:cd|pushd|set-location|sl)$/i.test(current.words[0]) && current.words.length === 2) {
      root = path.resolve(root, current.words[1]);
      continue;
    }
    const git = gitCommand(current, root);
    const push = git && !git.refusal && git.sub === 'push' ? pushTarget(git.args, git.base) : null;
    if (push) found.push(push);
    const pullRequest = pullRequestCreate(current, root);
    if (pullRequest) found.push(pullRequest);
    if (depth < 2 && SHELLS.test(current.words[0])) {
      for (const word of current.words.slice(1)) {
        if (/\s/.test(word) && /\b(?:git|gh)\b/i.test(word)) found.push(...outgoingChanges(word, root, depth + 1));
      }
    }
  }
  return found;
}

// Returns the refusal reason for a push or new pull request that carries a credential or a
// plain-text finding (toolkit-push-check.cjs), or ''. This step fails open: if it cannot check, the
// command runs and one note goes to `notes` (a list the caller shows) or else to stderr.
function outgoingRefusal(command, cwd, { notes, budgetMs, check = (target) => require('./toolkit-push-check.cjs').checkOutgoing(target, budgetMs ? { budgetMs } : {}) } = {}) {
  let targets;
  try { targets = outgoingChanges(command, cwd); } catch { return ''; }
  const seen = new Set();
  for (const target of targets) {
    const key = JSON.stringify(target);
    if (seen.has(key)) continue;
    seen.add(key);
    let result;
    try { result = check(target) || {}; } catch { result = { note: 'Toolkit could not check this push for credentials and plain-text findings, so it was let through: the check could not load.' }; }
    if (result.note) {
      if (Array.isArray(notes)) notes.push(result.note);
      else { try { process.stderr.write(`${result.note}\n`); } catch { /* a note is best effort */ } }
    }
    if (result.refusal) return result.refusal;
  }
  return '';
}

// A PreToolUse decision for a shell tool call, in the shape Claude Code and Codex both read. The
// hooks call it for shell calls only, so the call is read as one whatever its tool name. Every check
// reads the same text and judges the folder the command runs in (toolkit-shell-call.cjs).
// `options` is for the push check: `notes` collects its fail-open notes, and tests set its budget.
function attributionDecision(input, options = {}) {
  const call = ShellCall.from(input, { shell: true });
  const command = call.text;
  const reason = call.refusal() || (command && (attributionRefusal(command, call.folder) || bypassRefusal(command, call.folder) || outgoingRefusal(command, call.folder, options)));
  return reason ? { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } } : {};
}

module.exports = Object.freeze({ ATTRIBUTION_PATTERNS, BYPASS_MESSAGE, FORCE_MESSAGE, MESSAGE, attributionDecision, attributionRefusal, bypassRefusal, hasAttribution, outgoingChanges, outgoingRefusal, repositoryKind });
