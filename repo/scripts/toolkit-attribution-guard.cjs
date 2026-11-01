'use strict';

// Refuses shell commands that would put AI attribution into a commit or a pull request: a
// Co-Authored-By trailer naming Claude or Anthropic, a Claude-Session trailer (: or =), a claude.ai session
// link, or a "Generated with Claude Code" footer. It looks only at `git commit` and `gh pr create` /
// `gh pr edit` / `gh pr merge`, in the command text and in a message or body file the command names. Ordinary text
// that merely mentions Claude passes. Used by the Claude Code PreToolUse hook and the Codex helper hook.
//
// It also refuses force pushes (--force, -f, --force-with-lease, --mirror or a +refspec) in a
// Toolkit-governed (GitHub governance ENABLED, or the governed block present) or personal-data-guarded
// repository and to an evidence store (a TRANSPORT-* repository), since they rewrite history. Skipped
// commit and push checks (--no-verify, core.hooksPath) are a written rule, not a hook: CI is the
// backstop. This is best effort: CI and branch rules are the backstop. Not covered:
// GIT_CONFIG_* environment variables, remote.*.push or remote.*.mirror settings, git aliases, scripts and programs that run git themselves,
// a cd that is not its own command in the same line, and commands nested more than two shells deep.
//
// Last, a `git push` or `gh pr create` that passed those checks is refused when what it would send
// carries a credential (toolkit-push-check.cjs), including what a `git commit`
// earlier in the same command could add. A push whose folder cannot be found is refused. When the step
// cannot check for another reason (git missing, too slow, a setting unreadable), Claude Code lets the
// command run with one note for the user and the Codex hook refuses it (Codex shows no notes). Folders
// are read as the shell reads them (toolkit-shell-call.cjs shellPath). For a Codex call that names no
// folder, the push check finds the working tree itself or refuses. The same gaps apply.

const fs = require('node:fs');
const path = require('node:path');
const { SHELLS, ShellCall, absoluteShellPath, assignVariable, assignmentOf, folderWord, shellCommands, shellOf, shellPath, shellReadings } = require('./toolkit-shell-call.cjs');

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

// The commands of one line with each whole-word variable an earlier command assigned a literal to
// read as its value, and a leading home variable as `~` (toolkit-shell-call.cjs folderWord), the way
// the merge hold reads them. The assignments themselves are dropped.
function withVariables(commands, shell = null) {
  const variables = new Map();
  const result = [];
  for (const current of commands) {
    const assigned = assignmentOf(current.words);
    if (assigned) { assignVariable(variables, assigned); continue; }
    result.push({ ...current, words: current.words.map((word) => folderWord(word, variables, shell)) });
  }
  return result;
}

// Location commands take their last non-option word as the folder. In particular, -Path and
// -LiteralPath name the following word, while flags such as -P, -L, /d and -PassThru do not.
const LOCATION_COMMAND = /^(?:cd|pushd|chdir|set-location|sl)$/i;
function locationTarget(words) {
  return words.slice(1).filter((word) => !word.startsWith('-') && !/^\/d$/i.test(word)).pop() || '';
}

// An unknown Codex folder cannot be recovered by checking reachable worktrees after any
// unresolved location command. Screen the whole family, including invocation operators and
// blocks, rather than trying to execute more shell syntax. Quoted data stays data; scripts
// handed to a nested shell get the same screen with their own quotes read.
function mentionsLocation({ words, offsets }, text) {
  if (words.some((word, index) => !/^["']/.test(text.slice(offsets[index]))
    && /^[&.{}]*(?:cd|pushd|popd|chdir|set-location|sl|push-location|pop-location)[{}]*$/i.test(word))) return true;
  let runner = -1;
  for (let index = 0; index < words.length; index += 1) {
    if (SHELLS.test(words[index].replace(/^[&.{}]+/, ''))) { runner = index; break; }
    if (!/^(?:&|\.|\{|env|exec|command|nohup|builtin)$/i.test(words[index])
      && !/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index])
      && !(index > 0 && words[index].startsWith('-'))) break;
  }
  return runner !== -1 && words.slice(runner + 1).some(word => shellCommands(word).some(current => mentionsLocation(current, word)));
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
        if (value) base = shellPath(base, value);
      }
    } else if (word.startsWith('-C') && word.length > 2) {
      if (++directories > MAX_DIRECTORY_OPTIONS) return { refusal: DIRECTORY_LIMIT };
      base = shellPath(base, word.slice(2));
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
    if (!paths.has(raw)) paths.set(raw, shellPath(base, raw));
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
  const bases = legacyDirectory ? [root, shellPath(root, legacyDirectory)] : [root];
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

const FORCE_MESSAGE = 'This command force-pushes (--force, -f, --force-with-lease, --mirror or a +refspec). Toolkit-governed repositories and evidence stores keep their history: push a new commit or a merge commit instead, or push to a new branch.';
const PUSH_VALUE_LETTERS = 'o';
const PUSH_VALUE_OPTIONS = new Set(['--repo', '--receive-pack', '--exec', '--push-option']);

// git's global options and its subcommand, with the folder the command runs in. `absolute` says
// whether a -C or --work-tree folder that stands on its own set that folder.
function gitCommand({ words }, root) {
  const start = words.findIndex((word) => /(?:^|[\\/])git(?:\.exe)?$/i.test(word));
  if (start === -1) return null;
  let base = root;
  let absolute = false;
  let directories = 0;
  for (let index = start + 1; index < words.length; index += 1) {
    const word = words[index];
    if (word === '-c' || word === '--config-env') index += 1;
    else if (word.startsWith('--config-env=') || (word.startsWith('-c') && word.length > 2)) continue;
    else if (word === '-C' || word.startsWith('-C')) {
      const value = word === '-C' ? words[++index] : word.slice(2);
      if (value === undefined) return null;
      if (++directories > MAX_DIRECTORY_OPTIONS) return { refusal: DIRECTORY_LIMIT };
      if (value) { base = shellPath(base, value); absolute ||= absoluteShellPath(value); }
    } else if (word === '--work-tree' || word.startsWith('--work-tree=')) {
      const value = word === '--work-tree' ? words[++index] : word.slice(12);
      if (value) { base = shellPath(base, value); absolute ||= absoluteShellPath(value); }
    } else if (GIT_VALUE_OPTIONS.has(word)) index += 1;
    else if (!word.startsWith('-')) return { base, absolute, sub: word, args: words.slice(index + 1) };
  }
  return { base, absolute, sub: null, args: [] };
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

// Returns the refusal reason, or '' when the command may run. A quoted command handed to a
// shell (bash -c "...", pwsh -Command "...") is read too, up to two levels deep.
// `registryOptions` is for tests (the governance decisions file to read).
// `shell` is the shell the command runs in when the host says (shellOf), else null.
function forceRefusal(command, cwd, depth = 0, registryOptions = {}, shell = null) {
  const text = String(command || '');
  if (text.length > MAX_COMMAND_CHARS || !/\bgit\b/i.test(text)) return '';
  let root = cwd || process.cwd();
  const cache = new Map();
  for (const current of withVariables(shellCommands(text), shell)) {
    // A cd earlier in the same command line moves the folder later git commands run in.
    if (LOCATION_COMMAND.test(current.words[0])) {
      const target = locationTarget(current.words);
      if (target) root = shellPath(root, target);
      continue;
    }
    const git = gitCommand(current, root);
    if (git?.refusal) return git.refusal;
    if (git && forcePush(git)) {
      const kind = repositoryKind(git.base, cache, registryOptions);
      const target = git.args.find((word) => !word.startsWith('-'));
      if (kind.checked || kind.store || storeUrl(target)) return FORCE_MESSAGE;
    }
    if (depth < 2 && SHELLS.test(current.words[0])) {
      for (const word of current.words.slice(1)) {
        if (/\s/.test(word) && /\bgit\b/i.test(word)) {
          const nested = forceRefusal(word, root, depth + 1, registryOptions, null);
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
  if (rest.includes('--dry-run')) return null;
  const head = ghOption(rest, '--head', '-H').replace(/^[^:]*:/, '');
  return { folder: root, pullRequest: true, base: ghOption(rest, '--base', '-B'), sources: head ? [head] : [] };
}

// What a `git push` sends: { remote, sources } from its remote and the local side of each refspec,
// or null when it only deletes. No refspec means the current branch; --all and --tags read every
// branch or tag.
function pushTarget(args, folder) {
  if (args.some((word) => word === '--delete' || word === '-d')) return null;
  // A dry run (`--dry-run`, `-n`, or `n` in a short-option bundle without the value-taking `o`) sends nothing.
  if (args.some((word) => word === '--dry-run' || (/^-[A-Za-z]+$/.test(word) && word.includes('n') && !word.includes('o')))) return null;
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

// git commands that change what a later push in the same command line sends: commits, the adds
// before them, and the history commands the push check refuses before a push.
const COMMIT_STEPS = new Set(['add', 'stage', 'commit', 'merge', 'cherry-pick', 'revert', 'am', 'rebase']);
// git commands that can make or move the branch a later push in the same command line sends.
const BRANCH_STEPS = new Set(['checkout', 'switch', 'branch', 'worktree']);
// git commands that leave HEAD, the index and the branches as they were; any other earlier step may
// move them before an unconfirmed-folder push, so it is kept as `other`.
const READ_STEPS = new Set(['status', 'log', 'diff', 'show', 'fetch', 'push', 'rev-parse', 'ls-files', 'ls-remote', 'describe']);
// Whether a git step is a plain read: on READ_STEPS, except a fetch that writes a local branch (a
// refspec after the repository with `:` or --update-head-ok), and `config` with only a read option.
function readStep({ sub, args }) {
  if (sub === 'config') return args.some((word) => /^(?:--get(?:-all|-regexp|-urlmatch)?|--list|-l)$/.test(word));
  if (sub === 'fetch') {
    const valueOptions = new Set(['--upload-pack', '--depth', '--deepen', '--shallow-since', '--shallow-exclude', '--negotiation-tip', '-j', '--jobs', '--filter', '--server-option', '-o', '--refmap', '--recurse-submodules-default', '--submodule-prefix']);
    let repository = false;
    let positional = false;
    for (let index = 0; index < args.length; index += 1) {
      const word = args[index];
      if (!positional && (word === '-u' || word === '--update-head-ok')) return false;
      if (!positional && word === '--') { positional = true; continue; }
      if (!positional && valueOptions.has(word)) { index += 1; continue; }
      if (!positional && word.startsWith('-')) continue;
      if (!repository) repository = true;
      else if (word.includes(':')) return false;
    }
    return true;
  }
  return READ_STEPS.has(sub);
}

// The branch a git step creates and its start point ({ name, start }, `HEAD` when none is named):
// `checkout -b|-B <name> [<start>]`, `switch -c|-C <name> [<start>]`, `branch <name> [<start>]` with
// no options, and `worktree add -b|-B <name> <path> [<start>]`. Anything else is null.
function branchCreated(sub, args) {
  const positional = (list) => list.filter((word) => !word.startsWith('-'));
  const after = (flags) => {
    const at = args.findIndex((word) => flags.includes(word));
    return at === -1 || !args[at + 1] ? null : { name: args[at + 1], rest: [...args.slice(0, at), ...args.slice(at + 2)] };
  };
  if (sub === 'checkout' || sub === 'switch') {
    const found = after(sub === 'checkout' ? ['-b', '-B'] : ['-c', '-C', '--create', '--force-create']);
    return found ? { name: found.name, start: positional(found.rest)[0] || 'HEAD' } : null;
  }
  if (sub === 'branch') {
    const words = positional(args);
    return words.length === args.length && words.length >= 1 && words.length <= 2 ? { name: words[0], start: words[1] || 'HEAD' } : null;
  }
  if (sub === 'worktree' && args[0] === 'add') {
    const found = after(['-b', '-B']);
    return found ? { name: found.name, start: positional(found.rest.slice(1))[1] || 'HEAD' } : null;
  }
  return null;
}

// What a push or a new pull request sends, for each one in a command line, with the same cd,
// git -C and nested-shell reading as the force-push check: push and pull-request targets as
// toolkit-push-check.cjs reads them. A push that only deletes sends nothing to check. Each target
// carries `preceding`, the git steps earlier in the same command line ({ folder, sub }, in order),
// because the check runs before any of them.
//
// `confirmed` false says the starting folder may not be where the command runs (a Codex call that
// named no folder). A `cd`, `pushd` or `Set-Location` to a folder that stands on its own, or a git -C
// or --work-tree one, confirms the folder from there on; a relative one keeps the state. Each push,
// pull request and preceding step read from a folder not confirmed carries `folderConfirmed: false`,
// and `folderMoved: true` once a relative one moved it (`moved`), since the folder it moved from is
// not known either.
function outgoingChanges(command, cwd, depth = 0, preceding = [], confirmed = true, shell = null, moved = false) {
  const text = String(command || '');
  const found = [];
  if (text.length > MAX_COMMAND_CHARS || !/\b(?:git|gh)\b/i.test(text)) return found;
  let root = cwd || process.cwd();
  const unknownStart = !confirmed;
  let unresolvedLocation = false;
  const withPreceding = (target) => (preceding.length ? { ...target, preceding: preceding.slice() } : target);
  const marked = (entry, known) => (known ? entry : { ...entry, folderConfirmed: false, ...(moved ? { folderMoved: true } : {}) });
  for (const current of withVariables(shellCommands(text), shell)) {
    if (LOCATION_COMMAND.test(current.words[0])) {
      const target = locationTarget(current.words);
      if (target) root = shellPath(root, target);
      if (unknownStart) {
        confirmed = Boolean(target && !/[$`]|%[^%]+%/.test(target) && (confirmed || absoluteShellPath(target)));
        if (!confirmed) { moved = true; unresolvedLocation = true; }
      }
      continue;
    }
    if (unknownStart && mentionsLocation(current, text)) {
      unresolvedLocation = true;
      confirmed = false;
      moved = true;
    }
    const git = gitCommand(current, root);
    const known = confirmed || Boolean(git?.absolute);
    const push = git && !git.refusal && git.sub === 'push' ? pushTarget(git.args, git.base) : null;
    if (push) found.push(withPreceding(marked(push, known)));
    if (git && !git.refusal && COMMIT_STEPS.has(git.sub)) preceding.push(marked({ folder: git.base, sub: git.sub }, known));
    if (git && !git.refusal && BRANCH_STEPS.has(git.sub)) {
      const created = branchCreated(git.sub, git.args);
      preceding.push(marked(created ? { folder: git.base, sub: 'create', ...created } : { folder: git.base, sub: git.sub }, known));
    }
    if (git && !git.refusal && !COMMIT_STEPS.has(git.sub) && !BRANCH_STEPS.has(git.sub) && !readStep(git)) {
      preceding.push(marked({ folder: git.base, sub: 'other' }, known));
    }
    const pullRequest = pullRequestCreate(current, root);
    if (pullRequest) found.push(withPreceding(marked(pullRequest, confirmed)));
    if (depth < 2 && SHELLS.test(current.words[0])) {
      for (const word of current.words.slice(1)) {
        if (/\s/.test(word) && /\b(?:git|gh)\b/i.test(word)) found.push(...outgoingChanges(word, root, depth + 1, preceding, confirmed, null, moved));
      }
    }
  }
  return unresolvedLocation ? found.map(target => (target.folderConfirmed === false ? { ...target, folderMoved: true } : target)) : found;
}

// Returns the refusal reason for a push or new pull request that carries a credential
// (toolkit-push-check.cjs), or ''. This step fails open: if it cannot check, the
// command runs and one note goes to `notes` (a list the caller shows) or else to stderr. Every
// target of one command line shares one time budget, which starts at the first check (30 seconds,
// or `budgetMs` in tests); `check(target, { deadline })` is for tests. `folderConfirmed` false says
// `cwd` may not be where the command runs (outgoingChanges).
function outgoingRefusal(command, cwd, { notes, budgetMs, folderConfirmed = true, shell = null, check = (target, options) => require('./toolkit-push-check.cjs').checkOutgoing(target, options) } = {}) {
  let deadline;
  const run = (target) => {
    if (deadline === undefined) deadline = Date.now() + (budgetMs ?? require('./toolkit-push-check.cjs').BUDGET_MS);
    return check(target, { deadline });
  };
  let targets;
  // An unknown shell gives the targets of every reading (shellReadings); each is checked once.
  try { targets = shellReadings(shell).flatMap((reading) => outgoingChanges(command, cwd, 0, [], folderConfirmed, reading)); } catch { return ''; }
  const seen = new Set();
  for (const target of targets) {
    const key = JSON.stringify(target);
    if (seen.has(key)) continue;
    seen.add(key);
    let result;
    try { result = run(target) || {}; } catch { result = { note: 'Toolkit could not check this push for credentials, so it was let through: the check could not load.' }; }
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
// `sessionFolderOnly` is for a host whose top-level `cwd` is the chat's folder, which may not be where
// the command runs (Codex): for a call that names no folder of its own, the push check then finds the
// folder itself or refuses (toolkit-push-check.cjs).
function attributionDecision(input, options = {}) {
  const call = ShellCall.from(input, { shell: true });
  const command = call.text;
  const folderConfirmed = !(options.sessionFolderOnly && !call.folders.length);
  // `options.host` is set by the hook entry point ('claude' or 'codex'), never read from the payload.
  const shell = shellOf(input, options.host);
  const reason = call.refusal() || (command && (attributionRefusal(command, call.folder) || shellReadings(shell).map((reading) => forceRefusal(command, call.folder, 0, {}, reading)).find(Boolean) || outgoingRefusal(command, call.folder, { ...options, folderConfirmed, shell })));
  return reason ? { hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } } : {};
}

module.exports = Object.freeze({ ATTRIBUTION_PATTERNS, FORCE_MESSAGE, MESSAGE, attributionDecision, attributionRefusal, forceRefusal, hasAttribution, outgoingChanges, outgoingRefusal, repositoryKind });
