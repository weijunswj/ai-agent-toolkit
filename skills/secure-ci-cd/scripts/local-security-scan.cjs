#!/usr/bin/env node
'use strict';

// Local security scan: a read-only check of one git repository on the owner's computer for
// committed credentials. Zero dependencies (Node and git); no third-party scanner, no network.
//
//   tree     every tracked file and every untracked file git does not ignore
//   history  every line ever added on any branch or tag (git log --all --root, each merge against
//            its first parent, every file read as text, no line too long), so a credential that was
//            removed from the tree but is still in history is found
//
// The formats come from secret-patterns.cjs, the one list every Toolkit secret check reuses: fixed
// prefixes, exact lengths and character sets from providers' published token formats, placeholders
// skipped, and a same-line "secret-scan: allow <reason>" marker for a reviewed exception.
// Vulnerable dependencies are not scanned here; Dependabot covers them.
//
// Report: JSON (schema toolkit.local-security-scan.v1) and a short Markdown summary. It names the
// scanned commit, whether the tree had uncommitted changes, what could not be scanned, and
// findings classed release-blocker or likely-false-positive (a test, fixture, example or docs path),
// with place only: file, line, column, short commit and rule. Never any part of a match, an author
// or a commit message. Nothing is written inside the scanned repository: --out there is refused.
//
// Usage:
//   node local-security-scan.cjs [--repo <dir>] [--out <dir>] [--no-history]
//        [--recheck <previous report.json>] [--json]
// --recheck compares with an earlier report: fixed, still open and new findings, by finding id.
// Exit codes: 0 nothing found and everything scanned; 1 a release blocker; 2 could not scan (bad
// arguments, not a git repository, git not found, unreadable earlier report, report not writable);
// 3 no release blocker, but part of the repository could not be scanned (a shallow clone's history,
// a file over 5 MB or unreadable), so the result is incomplete.
//
// git is run from an absolute PATH folder only (never the scanned folder, where a planted git could
// sit), with the repository's fsmonitor hook and signature display switched off.
//
// This interface (flags, exit codes and the JSON schema) is stable: other Toolkit checks call it.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { spawn, spawnSync } = require('node:child_process');

const patterns = require('./secret-patterns.cjs');

const SCHEMA = 'toolkit.local-security-scan.v1';
const MAX_FILE_BYTES = 5 * 1024 * 1024;
// Places where a match is usually a sample rather than a live credential.
const SAMPLE_PATH = /(^|\/)(tests?|__tests__|spec|fixtures?|examples?|samples?|testdata|docs?)\/|\.(example|sample|template|dist)(\.|$)/i;

class ScanError extends Error {}

function parseArgs(argv, cwd = process.cwd()) {
  const options = { repo: cwd, out: null, history: true, recheck: null, json: false };
  const valued = { '--repo': 'repo', '--out': 'out', '--recheck': 'recheck' };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg in valued) {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new ScanError(`${arg} needs a value`);
      options[valued[arg]] = path.resolve(cwd, value);
      index += 1;
    } else if (arg === '--no-history') options.history = false;
    else if (arg === '--json') options.json = true;
    else throw new ScanError(`unknown argument ${arg}`);
  }
  return options;
}

// git from an absolute PATH folder: a bare name would let Windows run a git.exe from the current
// folder first, and a relative PATH entry could point into the scanned repository.
function resolveGit({ env = process.env, platform = process.platform } = {}) {
  const pathKey = Object.keys(env).find(key => key.toUpperCase() === 'PATH');
  const name = platform === 'win32' ? 'git.exe' : 'git';
  const pathApi = platform === 'win32' ? path.win32 : path.posix;
  for (const raw of String(pathKey ? env[pathKey] : '').split(platform === 'win32' ? ';' : ':')) {
    const dir = raw.trim().replace(/^"(.*)"$/, '$1');
    if (!dir || !pathApi.isAbsolute(dir)) continue;
    const candidate = pathApi.join(dir, name);
    try {
      if (fs.statSync(candidate).isFile()) { fs.accessSync(candidate, platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK); return candidate; }
    } catch { /* not here */ }
  }
  throw new ScanError('git was not found in an absolute PATH folder');
}

// --no-optional-locks: `git status` must not refresh the index, so the scanned repository stays
// untouched. core.fsmonitor=false: a hook command in the repository's own config never runs.
function gitArgs(repo, args) {
  return ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-c', 'log.showSignature=false', '-C', repo, ...args];
}

function git(command, repo, args) {
  const result = spawnSync(command, gitArgs(repo, args), { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, windowsHide: true, shell: false });
  return { status: result.error ? null : result.status, stdout: result.stdout || '' };
}

// The real path of `target`, following links through its nearest existing parent folder.
function realTarget(target) {
  let existing = path.resolve(target);
  const rest = [];
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    rest.unshift(path.basename(existing));
    existing = parent;
  }
  try { return path.join(fs.realpathSync(existing), ...rest); } catch { return path.resolve(target); }
}

function inside(child, parent) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function findingId(key) { return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16); }

function classFor(file) { return SAMPLE_PATH.test(file) ? 'likely-false-positive' : 'release-blocker'; }

function scanTree(command, repo) {
  const listed = git(command, repo, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  if (listed.status !== 0) throw new ScanError('git could not list the files');
  const findings = [];
  const notScanned = [];
  for (const file of [...new Set(listed.stdout.split('\0').filter(Boolean))].sort()) {
    let bytes;
    try {
      const full = path.join(repo, file);
      const stat = fs.lstatSync(full);
      if (!stat.isFile()) continue;
      if (stat.size > MAX_FILE_BYTES) { notScanned.push({ file, reason: 'larger than 5 MB' }); continue; }
      bytes = fs.readFileSync(full);
    } catch { notScanned.push({ file, reason: 'unreadable' }); continue; }
    if (bytes.includes(0)) continue; // binary
    for (const hit of patterns.scanText(bytes.toString('utf8'))) {
      findings.push({ id: findingId(`tree:${hit.rule}:${file}:${hit.line}`), kind: 'secret', class: classFor(file), rule: hit.rule, label: hit.label, file, line: hit.line, column: hit.column });
    }
  }
  return { findings, notScanned };
}

// Streams `git log -p` over every branch and tag and scans each run of added lines together (so a
// private key's material on the lines after its header is seen), with file, line number and commit.
// A file name is read only from the `+++ ` line between `diff --git` and the first `@@`; after that,
// every `+` line is content, whatever it starts with.
function scanHistory(command, repo) {
  return new Promise((resolve) => {
    const args = gitArgs(repo, ['log', '--all', '--root', '--diff-merges=first-parent', '--format=commit %H', '-p', '-U0', '--text', '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', '--src-prefix=a/', '--dst-prefix=b/']);
    const child = spawn(command, args, { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'ignore'] });
    const findings = new Map();
    let commit = null;
    let file = null;
    let header = false;
    let line = 0;
    let skipped = false;
    let block = [];
    const flush = () => {
      if (block.length && file && commit) {
        for (const hit of patterns.scanLines(block)) {
          const key = `history:${hit.rule}:${file}:${hit.line}:${commit}`;
          findings.set(`${hit.rule}:${file}:${commit}:${hit.line}`, { id: findingId(key), kind: 'secret-in-history', class: classFor(file), rule: hit.rule, label: hit.label, file, line: hit.line, column: hit.column, commit: commit.slice(0, 12) });
        }
      }
      block = [];
    };
    const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
    lines.on('line', (text) => {
      // Content lines always start with "+", "-", " " or "\\", so these two never come from a file.
      if (/^commit [0-9a-f]{40,64}$/.test(text)) { flush(); commit = text.slice(7); file = null; header = false; return; }
      if (text.startsWith('diff --git ')) { flush(); file = null; header = true; return; }
      const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(text);
      if (header) {
        if (hunk) { header = false; line = Number(hunk[1]); return; }
        if (text.startsWith('+++ ')) file = text === '+++ /dev/null' ? null : text.slice(4).replace(/^"?b\//, '').replace(/"$/, '');
        else if (text.startsWith('Binary files ')) skipped = true;
        return;
      }
      if (hunk) { flush(); line = Number(hunk[1]); return; }
      if (text.startsWith('+')) { block.push({ line, text: text.slice(1) }); line += 1; }
    });
    child.on('error', () => resolve({ ok: false, findings: [] }));
    child.on('close', (code) => { flush(); resolve({ ok: code === 0 && !skipped, findings: [...findings.values()] }); });
  });
}

function recheck(previous, findings) {
  const before = new Set((previous.findings || []).map(item => item.id));
  const now = new Set(findings.map(item => item.id));
  return {
    previous_commit: previous.scanned && previous.scanned.commit ? previous.scanned.commit : null,
    fixed: [...before].filter(id => !now.has(id)).sort(),
    still_open: [...now].filter(id => before.has(id)).sort(),
    new: [...now].filter(id => !before.has(id)).sort(),
  };
}

function markdown(report) {
  const lines = ['# Local security scan', '', `- **Status:** ${report.status}`, `- **Commit:** ${report.scanned.commit || 'none'}${report.scanned.dirty ? ' (with uncommitted changes)' : ''}`,
    `- **Scanned:** working tree${report.mode.history ? (report.scanned.history_complete ? ' and full history' : ' (history incomplete: shallow clone or unreadable)') : ' only (--no-history)'}, ${report.patterns} credential formats`,
    `- **Findings:** ${report.summary.release_blocker} release blocker, ${report.summary.likely_false_positive} likely false positive`,
    '- **Dependencies:** not scanned here; Dependabot covers vulnerable packages'];
  if (report.not_scanned.length) lines.push(`- **Not scanned:** ${report.not_scanned.map(item => `${item.file} (${item.reason})`).join(', ')}`);
  if (report.findings.length) {
    lines.push('', '## Findings', '');
    for (const item of report.findings) {
      lines.push(`- [${item.class}] ${item.id}: ${item.label} in ${item.file}:${item.line}${item.commit ? ` (commit ${item.commit}; rotate it even if it is gone from the tree)` : ''}`);
    }
  }
  if (report.recheck) lines.push('', '## Re-check', '', `- Fixed: ${report.recheck.fixed.length}`, `- Still open: ${report.recheck.still_open.length}`, `- New: ${report.recheck.new.length}`);
  return `${lines.join('\n')}\n`;
}

async function scan(options) {
  let repo;
  try { repo = fs.realpathSync(options.repo); } catch { throw new ScanError('the repository folder does not exist'); }
  const command = resolveGit();
  const top = git(command, repo, ['rev-parse', '--show-toplevel']);
  if (top.status !== 0) throw new ScanError('not inside a git repository');
  repo = fs.realpathSync(top.stdout.trim());
  if (options.out && inside(realTarget(options.out), repo)) throw new ScanError('--out is inside the scanned repository; reports never go there');
  let previous = null;
  if (options.recheck) {
    try { previous = JSON.parse(fs.readFileSync(options.recheck, 'utf8')); } catch { previous = null; }
    if (!previous || previous.schema !== SCHEMA || !Array.isArray(previous.findings)) throw new ScanError('the earlier report for --recheck is unreadable or not a local security scan report');
  }
  const head = git(command, repo, ['rev-parse', '--verify', '--quiet', 'HEAD']);
  const status = git(command, repo, ['status', '--porcelain']);
  const tree = scanTree(command, repo);
  let historyComplete = null;
  let history = [];
  if (options.history && head.status === 0) {
    const shallow = git(command, repo, ['rev-parse', '--is-shallow-repository']).stdout.trim() === 'true';
    const read = await scanHistory(command, repo);
    history = read.findings;
    historyComplete = read.ok && !shallow;
  }
  const findings = [...tree.findings, ...history].sort((a, b) => a.id.localeCompare(b.id));
  const count = cls => findings.filter(item => item.class === cls).length;
  const summary = { release_blocker: count('release-blocker'), likely_false_positive: count('likely-false-positive') };
  // A file left unscanned (over 5 MB or unreadable) makes the result incomplete, never clean.
  const incomplete = historyComplete === false || tree.notScanned.length > 0;
  const report = {
    schema: SCHEMA,
    generated_at: new Date().toISOString(),
    status: summary.release_blocker > 0 ? 'release-blocker' : incomplete ? 'incomplete' : 'clean',
    scanned: { commit: head.status === 0 ? head.stdout.trim() : null, dirty: status.status === 0 ? status.stdout.trim().length > 0 : null, history_complete: historyComplete },
    mode: { history: options.history },
    patterns: patterns.PATTERNS.length,
    not_scanned: tree.notScanned,
    findings,
    summary,
    ...(previous ? { recheck: recheck(previous, findings) } : {}),
  };
  return report;
}

function exitCodeFor(report) {
  if (report.status === 'release-blocker') return 1;
  return report.status === 'incomplete' ? 3 : 0;
}

async function main(argv = process.argv.slice(2), { stdout = process.stdout, stderr = process.stderr, cwd = process.cwd() } = {}) {
  let options;
  let report;
  let text;
  try {
    options = parseArgs(argv, cwd);
    report = await scan(options);
    text = markdown(report);
    if (options.out) {
      try {
        fs.mkdirSync(options.out, { recursive: true });
        fs.writeFileSync(path.join(options.out, 'local-security-scan.json'), `${JSON.stringify(report, null, 2)}\n`);
        fs.writeFileSync(path.join(options.out, 'local-security-scan.md'), text);
      } catch { throw new ScanError('the report could not be written to --out'); }
    }
  } catch (error) {
    stderr.write(`local-security-scan: could not scan: ${error instanceof ScanError ? error.message : 'unexpected error'}\n`);
    return 2;
  }
  stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : text);
  return exitCodeFor(report);
}

if (require.main === module) main().then((code) => { process.exitCode = code; });

module.exports = { SCHEMA, parseArgs, resolveGit, scan, markdown, recheck, exitCodeFor, main };
