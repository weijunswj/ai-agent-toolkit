#!/usr/bin/env node
'use strict';

// Task auto-merge check: whether a pull request may merge on the owner's standing answer (the
// app-local setup answer). It reads two things. The scope: a pull request that changes the merge
// rules themselves waits for the owner's typed merge whatever that answer says. The UAT verdict: the
// one line in the pull request body that says whether the owner must test it. The scope is read from
// the pull request's commits through git, so the controller runs it on the merge head before a merge
// and the merge hold (toolkit-merge-hold.cjs) runs the scope half on this computer before letting a
// merge with no typed approval through. It loads only Node's own modules.
//
//   node repo/scripts/toolkit-auto-merge-eligible.cjs --base <commit> --head <commit> --body-file <file|-> [--json]
//   node repo/scripts/toolkit-auto-merge-eligible.cjs --base <commit> --head <commit> --scope-only [--json]
//
// --body-file is the pull request body as GitHub has it now, saved by whoever runs the check (`gh pr
// view N --json body --jq .body`, or a connector read), or - for standard input. --scope-only reads
// the scope alone and grants no merge readiness; with neither, the check refuses to answer.
// On Windows, pipe the body straight in (`gh pr view N --json body --jq .body | node ... --body-file -`)
// or save it as UTF-8. Windows PowerShell 5.1 writes `> file` as UTF-16 with a byte order mark, which
// is read too; a body that is not text this check reads exits 2 and is never called a missing line.
// A copy of this check from before the UAT line ignores --body-file and can answer yes on scope
// alone: only a yes that names the UAT verdict counts.
//
// Exit 0: auto-merge may go ahead once the other gate conditions hold. Exit 1: it waits, with every
// reason named together (a missing, invalid or owner-test verdict; each merge-rule path). Exit 2: the
// commits or the body could not be read, or the call names no mode (also waits).
//
// The UAT verdict is exactly one hand-written line at the start of a line:
//   UAT: NOT_REQUIRED (why the owner has nothing to try)
//   UAT: OWNER_TEST_NEEDED (the one thing the owner tries)
//   UAT: PASSED (the owner's OK: a link or a date)
// No line is never read as NOT_REQUIRED, and neither is a tier, a label or a green check. A missing
// or invalid line goes back to the gate that owns the pull request; it is not a question for the
// owner. Only the owner's own answer turns OWNER_TEST_NEEDED into PASSED. Lines in code fences,
// quotes and HTML comments that start a line are never read as the verdict (see uatVerdict for the
// whole subset). The line is evidence for this check, never merge authority.
//
// The merge-authority list, each for the failure it prevents: a pull request that loosens the
// rules for whether and how merges happen would otherwise merge itself on those looser rules.
//   - the programme binding, its schema and its reader: they bound governance scope;
//   - the merge hold, its helpers and this check: they enforce it on this computer;
//   - the controller, global and gate rules, and the Approvals section of the Projects controller
//     skill: they say when a controller may merge;
//   - CI workflows: they decide what "every required check is green" means;
//   - a major version bump: a breaking release would go out unseen.
// Hooks, setup, governance and the preference reader/writer also wait for a typed merge:
// changing the enforcement or setup path must never authorise that same change.
// A change that only moves version stamps (a managed block's toolkit=<version>, a "Version:
// <date>.<n>" line, a "version" or BRIDGE_VERSION value), as the release bump at merge time does,
// does not count. The rest of the gate conditions (review, CI, one merge at a time, no open FAIL)
// are the controller's to check; see the gate rules' task auto-merge section.

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Any repository.
const GENERAL = Object.freeze([
  [/^\.github\/toolkit-programme\.json$/, 'the programme binding'],
  [/^\.github\/ai-agent-toolkit-programme\.json$/, 'the programme binding'],
  [/^\.github\/workflows\//, 'a CI workflow'],
  [/^(?:\.(?:claude|codex)-plugin\/)?hooks\/hooks\.json$/, 'a host hook manifest'],
  [/^repo\/scripts\/[^/]*-hook\.(?:cjs|ps1)$/, 'a host hook entrypoint'],
  // SessionStart commands do not use the -hook suffix. Keep these in step with both host manifests;
  // the eligibility tests also check Codex's installed PowerShell launchers.
  [/^repo\/scripts\/toolkit-local-bridge\.cjs$/, 'a host hook entrypoint'],
  [/^repo\/scripts\/toolkit-codex-session-start\.(?:cjs|ps1)$/, 'a host hook entrypoint'],
]);

// The Toolkit repository's own merge rules (applied when the diff's repository is the Toolkit: it
// has the global rules source).
const TOOLKIT = Object.freeze([
  [/^(?:repo\/scripts\/toolkit-issue-closure|skills\/github-program-reconciler\/scripts\/issue-closure)\.cjs$/, 'the issue closure guard'],
  [/^repo\/contracts\/toolkit-local-bridge\/(?:claude|codex)-plugin\/hooks\/hooks\.json$/, 'a host hook manifest source'],
  [/^repo\/contracts\/agent-rules\/(?:global|gate|toolkit-governed)-rules\.md$/, 'the agent rules on merging'],
  [/^repo\/CONTROLLER\.md$/, 'the controller rules'],
  [/^repo\/controller\//, 'the controller rules'],
  [/^repo\/docs\/agent-playbooks\/controller-takeover\.md$/, 'the controller rules'],
  [/^repo\/scripts\/setup-[^/]+\.cjs$/, 'setup and its host bank helpers'],
  [/^repo\/scripts\/toolkit-governance(?:-[^/]+)?\.cjs$/, 'governance runtime and state'],
  [/^repo\/scripts\/toolkit-(?:repository-identity|user-state)\.cjs$/, 'governance identity and operational state'],
  [/^repo\/scripts\/toolkit-task-auto-merge-preferences\.cjs$/, 'the app-local merge answer'],
  [/^repo\/scripts\/toolkit-(?:permissions|cleanup)\.cjs$/, 'the permission blocks and the cleanup they allow'],
  [/^(?:repo\/docs\/agent-playbooks|skills\/repository-agent-rules\/repo-local\/docs\/agent-playbooks)\/safety-gates\.md$/, 'approval rules'],
  [/^repo\/contracts\/programme-state\//, 'the programme binding schema'],
  [/^skills\/github-program-reconciler\/scripts\/programme-state\.cjs$/, 'the programme binding reader'],
  [/^repo\/scripts\/toolkit-merge-hold\.cjs$/, 'the merge hold'],
  [/^repo\/scripts\/toolkit-shell-call\.cjs$/, 'the merge hold'],
  [/^repo\/scripts\/toolkit-auto-merge-eligible\.cjs$/, 'this merge-scope check'],
]);

// Files where only one section is on the list: [pattern, heading, why]. The file counts only when
// the text from that heading to the next heading of the same level changes.
const SECTIONS = Object.freeze([
  [/^repo\/contracts\/claude-projects\/web-controller-projects\/SKILL\.md$/, '## Approvals', 'the Projects controller skill\'s Approvals section'],
]);

const TOOLKIT_MARKER = 'repo/contracts/agent-rules/global-rules.md';
const VERSION_FILES = Object.freeze(['repo/contracts/toolkit-local-bridge/version.json', 'package.json']);
const SEMVER = /^(\d+)\.\d+\.\d+(?:[-+].*)?$/;

// Version stamps the release bump moves, blanked so a bump-only change compares equal.
function withoutStamps(text) {
  return String(text)
    .replace(/(\stoolkit=)\d+\.\d+\.\d+(?=\s)/g, '$1*')
    .replace(/^(Version: )\d{4}-\d{2}-\d{2}\.\d+$/gm, '$1*')
    .replace(/^(\s*"version":\s*")\d+\.\d+\.\d+(",?)$/gm, '$1*$2')
    .replace(/^(const BRIDGE_VERSION = ')\d+\.\d+\.\d+(';)$/gm, '$1*$2');
}

// The [pattern, why] rules for the Toolkit repository or any other.
function rulesFor(toolkit) { return toolkit ? [...GENERAL, ...TOOLKIT] : GENERAL; }
function sectionsFor(toolkit) { return toolkit ? SECTIONS : []; }

// The text of one section (its heading line to the next heading of the same or a higher level), or
// null when the file has no such heading.
function sectionOf(text, heading) {
  const lines = String(text).replace(/\r\n/g, '\n').split('\n');
  const start = lines.findIndex(line => line.trimEnd() === heading);
  if (start < 0) return null;
  const level = /^#+/.exec(heading)[0].length;
  let end = start + 1;
  while (end < lines.length && !(/^#+\s/.test(lines[end]) && /^#+/.exec(lines[end])[0].length <= level)) end += 1;
  return lines.slice(start, end).join('\n');
}

// The verdict for a pull request: { eligible, reasons: [{ path, why }] }. `files` are the changed
// paths (forward slashes); `toolkit` applies the Toolkit's own list; `stampOnly` lists changed paths
// whose only change is version stamps; `sectionChanged` lists changed paths whose listed section
// changed (or that were added or deleted); `versions` maps a version file to { before, after }.
function eligibility({ files, toolkit = false, stampOnly = [], sectionChanged = [], versions = {} }) {
  const rules = rulesFor(toolkit);
  const sections = sectionsFor(toolkit);
  const reasons = [];
  for (const file of files) {
    if (stampOnly.includes(file)) continue;
    const hit = rules.find(([pattern]) => pattern.test(file));
    if (hit) { reasons.push({ path: file, why: hit[1] }); continue; }
    const section = sections.find(([pattern]) => pattern.test(file));
    if (section && sectionChanged.includes(file)) reasons.push({ path: file, why: section[2] });
  }
  for (const [file, { before, after }] of Object.entries(versions)) {
    const from = SEMVER.exec(String(before || ''));
    const to = SEMVER.exec(String(after || ''));
    if (from && to && Number(to[1]) > Number(from[1])) reasons.push({ path: file, why: `a major version bump (${before} to ${after})` });
  }
  return { eligible: reasons.length === 0, reasons };
}

function git(cwd, args) {
  const run = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
  return run.status === 0 ? run.stdout : null;
}

function versionAt(cwd, commit, file) {
  const text = git(cwd, ['show', `${commit}:${file}`]);
  if (text === null) return null;
  try { return JSON.parse(text).version || null; } catch { return null; }
}

// The verdict for the pull request from `base` to `head` in the repository at `cwd`, or null when
// git cannot read it.
function eligibilityOf(cwd, base, head) {
  const SHA = /^[0-9a-f]{7,64}$/i;
  if (!SHA.test(String(base)) || !SHA.test(String(head))) return null;
  const listed = git(cwd, ['diff', '--name-only', '--no-renames', '-z', `${base}...${head}`]);
  if (listed === null) return null;
  const files = listed.split('\0').filter(Boolean);
  // At either end, so a pull request that deletes the marker still gets the list.
  const toolkit = [base, head].some(commit => git(cwd, ['cat-file', '-e', `${commit}:${TOOLKIT_MARKER}`]) !== null);
  const versions = {};
  for (const file of VERSION_FILES) if (files.includes(file)) versions[file] = { before: versionAt(cwd, base, file), after: versionAt(cwd, head, file) };
  // Compared from the merge base, as the diff is; a file added or deleted is never stamp-only, and
  // its listed section always counts as changed.
  const from = (git(cwd, ['merge-base', base, head]) || '').trim();
  const based = /^[0-9a-f]{40,64}$/.test(from);
  const ends = file => (based ? [git(cwd, ['show', `${from}:${file}`]), git(cwd, ['show', `${head}:${file}`])] : [null, null]);
  const stampOnly = files.filter(file => rulesFor(toolkit).some(([pattern]) => pattern.test(file))).filter(file => {
    const [before, after] = ends(file);
    return before !== null && after !== null && withoutStamps(before) === withoutStamps(after);
  });
  const sectionChanged = [];
  for (const file of files) {
    const section = sectionsFor(toolkit).find(([pattern]) => pattern.test(file));
    if (!section) continue;
    const [before, after] = ends(file);
    if (before === null || after === null) { sectionChanged.push(file); continue; }
    const was = sectionOf(before, section[1]);
    const now = sectionOf(after, section[1]);
    if (was === null || now === null || withoutStamps(was) !== withoutStamps(now)) sectionChanged.push(file);
  }
  return eligibility({ files, toolkit, stampOnly, sectionChanged, versions });
}

// The commit a ref names in the repository at `cwd` (a ref such as refs/remotes/origin/main), or
// null when git cannot resolve it.
function commitOf(cwd, ref) {
  if (!/^[\w./-]+$/.test(String(ref)) || String(ref).startsWith('-')) return null;
  const sha = (git(cwd, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) || '').trim();
  return /^[0-9a-f]{40,64}$/.test(sha) ? sha : null;
}

// The UAT verdict in a pull request body: { state, detail, problem, ready }. `state` is absent,
// invalid, NOT_REQUIRED, OWNER_TEST_NEEDED or PASSED; `detail` is the text in brackets; `problem`
// says what is wrong with an invalid line (or that an absent body was empty); `ready` is true only
// for NOT_REQUIRED and PASSED.
//
// The reader is default-deny over a small subset of what GitHub draws. It reads lines the way
// GitHub's Markdown does (LF, CRLF and a lone CR end a line; one leading byte order mark is
// dropped) and sets aside only what GitHub certainly does not show as a line of the description's
// own text: fenced code, quotes, and HTML comments that start a line. Everything else that looks
// like a UAT line counts as one, so it makes the verdict invalid rather than being skipped:
//   - a line dressed as a bullet, a numbered item, a heading, bold or italic, in another letter
//     case, or indented;
//   - a line with invisible characters, other kinds of space, look-alike letters or full-width
//     forms in or before the word (compared after Unicode compatibility folding, accents dropped);
//   - a line after any other break character (NEL, LS, PS, vertical tab, form feed);
//   - a line inside an HTML comment that starts in the middle of a line, where a reader and
//     GitHub can disagree about what is hidden.
// Toolkit's generated marker blocks are read like any other text; only the generated task status
// line (`- UAT: <state>; review: <state>`) inside one is set aside.
// Accepted gaps, each leaning to a refusal or left to the reviewer who confirms the line: a UAT
// statement written as a table cell, inline code or inside other HTML is not counted;
// look-alike letters outside the small list below are not folded; a quoted or fenced UAT line is
// visible on the page but never read.
const UAT_STATES = Object.freeze(['NOT_REQUIRED', 'OWNER_TEST_NEEDED', 'PASSED']);
const UAT_FORMAT = 'UAT: NOT_REQUIRED (reason), UAT: OWNER_TEST_NEEDED (what the owner tries) or UAT: PASSED (the owner\'s OK)';
const MAX_BODY_BYTES = 512 * 1024;
const MAX_UAT_DETAIL = 500;
const FENCE_LINE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const MARKER_LINE = /^ {0,3}<!--\s*AI-AGENT-TOOLKIT:[^>]*?:(BEGIN|END)\b/;
const GENERATED_STATUS = /^- UAT: [^;]*; review: /;
// Break characters GitHub does not end a line at, but a terminal or another reader may.
const OTHER_BREAKS = /[\u0085\u2028\u2029\u000b\u000c]/;
// Letters that draw like U, A or T.
const LOOK_ALIKES = Object.freeze({ '\u0410': 'A', '\u0430': 'a', '\u0391': 'A', '\u03b1': 'a', '\u0422': 'T', '\u03a4': 'T', '\u0442': 't', '\u03c4': 't', '\u054d': 'U', '\u222a': 'U', '\u03c5': 'u', '\u057d': 'u' });
const LOOK_ALIKE = new RegExp(`[${Object.keys(LOOK_ALIKES).join('')}]`, 'g');
const UAT_CANDIDATE = /^ *(?:(?:[-*+]|#{1,6}|\d{1,9}[.)]) +)*(?:\*\*|__|\*|_)?uat(?:\*\*|__|\*|_)? *:/i;

// Whether a piece of a line tries to be the verdict, however it is dressed. Other kinds of space
// are tried both as a space and as nothing, since some draw as a gap and some as none.
const ODD_SPACE = /(?! )[\p{Z}\s]/gu;
function looksLikeUat(piece) {
  const plain = gap => piece.replace(ODD_SPACE, gap).normalize('NFKD').replace(ODD_SPACE, gap).replace(/[\p{C}\p{M}]/gu, '')
    .replace(LOOK_ALIKE, letter => LOOK_ALIKES[letter]);
  return UAT_CANDIDATE.test(plain(' ')) || UAT_CANDIDATE.test(plain(''));
}

function uatVerdict(body) {
  const verdict = (state, detail = null, problem = null) => ({ state, detail, problem, ready: state === 'NOT_REQUIRED' || state === 'PASSED' });
  if (typeof body !== 'string') return verdict('absent');
  const text = body.startsWith('\ufeff') ? body.slice(1) : body;
  if (text.trim() === '') return verdict('absent', null, 'the pull request body is empty');
  const candidates = [];
  let fence = null; // the opening fence run while inside fenced code
  let comment = null; // 'block' (starts a line: hidden) or 'inline' (starts mid-line: unsure)
  let marker = false;
  // Whether a piece of a line ends inside an HTML comment it opened.
  const leftOpen = piece => piece.lastIndexOf('<!--') > piece.lastIndexOf('-->');
  for (const line of text.split(/\r\n|\r|\n/)) {
    if (fence) {
      const close = FENCE_LINE.exec(line);
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length && close[2].trim() === '') fence = null;
      continue;
    }
    let read = line; // the part of the line a reader may see
    let unsure = false;
    if (comment === 'inline') {
      unsure = true;
      if (line.includes('-->') && !leftOpen(line)) comment = null;
    } else if (comment === 'block') {
      const end = line.indexOf('-->');
      if (end < 0) continue;
      comment = null;
      // Text after the comment's end, on the same line, is shown.
      read = line.slice(end + 3);
      if (read.trim() === '') continue;
      unsure = true;
      if (leftOpen(read)) comment = 'inline';
    } else {
      const open = FENCE_LINE.exec(line);
      // A backtick fence whose info string holds a backtick is not a fence to GitHub.
      if (open && !(open[1][0] === '`' && open[2].includes('`'))) { fence = open[1]; continue; }
      if (/^ {0,3}>/.test(line)) continue;
      const at = line.indexOf('<!--');
      if (at >= 0 && /^ {0,3}<!--/.test(line)) {
        const mark = MARKER_LINE.exec(line);
        if (mark) marker = mark[1] === 'BEGIN';
        const end = line.indexOf('-->', at + 4);
        if (end < 0) { comment = 'block'; continue; }
        read = line.slice(end + 3);
        if (read.trim() === '') continue;
        unsure = true;
        if (leftOpen(read)) comment = 'inline';
      } else if (at >= 0) {
        unsure = true;
        if (leftOpen(line)) comment = 'inline';
      }
    }
    if (marker && !unsure && GENERATED_STATUS.test(line)) continue;
    for (const piece of read.split(OTHER_BREAKS)) if (looksLikeUat(piece)) candidates.push({ line: line.trimEnd(), unsure });
  }
  if (candidates.length === 0) return verdict('absent');
  if (candidates.length > 1) return verdict('invalid', null, `the body has more than one UAT line (${candidates.length}); keep exactly one`);
  const { line, unsure } = candidates[0];
  if (unsure) return verdict('invalid', null, 'the UAT line sits beside or inside an HTML comment that starts in the middle of a line; put the line on its own, outside any comment');
  // Invisible, control and odd space characters could hide a second line or redraw this report.
  if (/[\p{C}\p{Zl}\p{Zp}]/u.test(line) || /[^\S ]/.test(line)) return verdict('invalid', null, `the line holds an invisible character, a tab or an unusual space; retype it with plain characters as ${UAT_FORMAT}`);
  if (!line.startsWith('UAT: ')) return verdict('invalid', null, `write it at the start of a line, with no bullet or bold, as ${UAT_FORMAT}`);
  const parts = /^UAT: (\S+)(.*)$/.exec(line);
  if (!parts || !UAT_STATES.includes(parts[1])) return verdict('invalid', null, 'the verdict must be NOT_REQUIRED, OWNER_TEST_NEEDED or PASSED, in capitals');
  const detail = /^ \((.*)\)$/.exec(parts[2]);
  const reason = detail ? detail[1].trim() : '';
  if (!reason || reason.length > MAX_UAT_DETAIL) return verdict('invalid', null, `give the reason in brackets right after the verdict, up to ${MAX_UAT_DETAIL} characters and nothing after it: ${UAT_FORMAT}`);
  return verdict(parts[1], reason);
}

// Text from the bytes of a saved pull request body, or null when they are not text this check
// reads. UTF-8 with or without a byte order mark, and UTF-16 with one (what Windows PowerShell 5.1
// writes for `> file`), are read. UTF-32, UTF-16 with no mark, NUL bytes and bytes that are not
// valid UTF-8 are refused, so a wrongly saved body is never reported as a missing line.
function decodeBody(raw) {
  if (!Buffer.isBuffer(raw) || raw.length > MAX_BODY_BYTES) return null;
  const starts = (...bytes) => bytes.every((byte, index) => raw[index] === byte);
  let text;
  try {
    if (starts(0xff, 0xfe, 0x00, 0x00) || starts(0x00, 0x00, 0xfe, 0xff)) return null;
    if (starts(0xff, 0xfe) || starts(0xfe, 0xff)) {
      if (raw.length % 2 !== 0) return null;
      text = new TextDecoder(starts(0xff, 0xfe) ? 'utf-16le' : 'utf-16be', { fatal: true, ignoreBOM: true }).decode(raw);
    } else {
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
    }
  } catch { return null; }
  return text.includes('\u0000') ? null : text;
}

// The pull request body from a file, or from standard input for "-"; null when it cannot be read.
function readBody(file, cwd, stdin) {
  try {
    return decodeBody(file === '-' ? (typeof stdin === 'string' ? Buffer.from(stdin, 'utf8') : Buffer.isBuffer(stdin) ? stdin : fs.readFileSync(0)) : fs.readFileSync(path.resolve(cwd, file)));
  } catch { return null; }
}

const USAGE = 'Usage: node repo/scripts/toolkit-auto-merge-eligible.cjs --base <commit> --head <commit> --body-file <file|-> [--json]\n'
  + '   or: node repo/scripts/toolkit-auto-merge-eligible.cjs --base <commit> --head <commit> --scope-only [--json]\n'
  + '--body-file is the pull request body, read for its UAT line. --scope-only reads the merge scope alone and grants no merge readiness.\n'
  + 'With --json, "ready" is the answer; "eligible" is the merge scope alone.\n';
const SCOPE_WAITS = 'Waits for the owner\'s typed merge: this pull request changes the merge rules.';

// The lines for a verdict that is not ready, or [] when it is.
function uatLines(uat) {
  if (uat.state === 'absent') return [`Missing UAT verdict: ${uat.problem || 'the pull request body has no UAT line'}. The gate that owns this pull request adds exactly one: ${UAT_FORMAT}. This is not a question for the owner.`];
  if (uat.state === 'invalid') return [`UAT verdict invalid: ${uat.problem}. The gate that owns this pull request corrects the line. This is not a question for the owner.`];
  if (uat.state === 'OWNER_TEST_NEEDED') return [`Owner test needed: ${uat.detail}. It waits for the owner's test; after their OK the controller changes the line to UAT: PASSED (their OK).`];
  return [];
}

function main(argv, { cwd = process.cwd(), stdout = process.stdout, stderr = process.stderr, stdin } = {}) {
  const value = name => { const at = argv.indexOf(name); return at >= 0 ? argv[at + 1] : undefined; };
  const json = argv.includes('--json');
  const scopeOnly = argv.includes('--scope-only');
  const withBody = argv.includes('--body-file');
  const bodyFile = value('--body-file');
  const base = value('--base');
  const head = value('--head');
  if (!base || !head || scopeOnly === withBody || (withBody && (!bodyFile || (bodyFile !== '-' && bodyFile.startsWith('--'))))) { stderr.write(USAGE); return 2; }
  const scope = eligibilityOf(cwd, base, head);
  if (!scope) { stderr.write('The pull request\'s changes could not be read from git, so its merge scope is unknown. It waits for the owner\'s typed merge.\n'); return 2; }
  const scopeLines = scope.eligible ? [] : [SCOPE_WAITS, ...scope.reasons.map(entry => `- ${entry.path}: ${entry.why}`)];
  if (scopeOnly) {
    if (json) stdout.write(`${JSON.stringify(scope, null, 2)}\n`);
    else if (scope.eligible) stdout.write('Scope only: nothing here changes the merge rules. The UAT verdict was not read, so this grants no merge readiness; run the check with --body-file.\n');
    else stdout.write(`${scopeLines.join('\n')}\nScope only: the UAT verdict was not read.\n`);
    return scope.eligible ? 0 : 1;
  }
  const body = readBody(bodyFile, cwd, stdin);
  if (body === null) { stderr.write('The pull request body could not be read as text, so its UAT verdict is unknown: the file is missing, too long, or not UTF-8 (UTF-16 is read only with its byte order mark). Pipe the body straight in with --body-file -, or save it as UTF-8, and run the check again.\n'); return 2; }
  const uat = uatVerdict(body);
  const ready = scope.eligible && uat.ready;
  if (json) stdout.write(`${JSON.stringify({ ...scope, uat, ready }, null, 2)}\n`);
  else if (ready) stdout.write(`Auto-merge: yes. Nothing here changes the merge rules and the UAT verdict is ${uat.state} (${uat.detail}), so it merges once the other gate conditions hold.\n`);
  else stdout.write(`${[...uatLines(uat), ...scopeLines].join('\n')}\n`);
  return ready ? 0 : 1;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = Object.freeze({ GENERAL, SECTIONS, TOOLKIT, UAT_STATES, commitOf, eligibility, eligibilityOf, main, sectionOf, uatVerdict, withoutStamps });
