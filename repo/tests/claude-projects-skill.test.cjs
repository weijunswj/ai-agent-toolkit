'use strict';

// The Claude Projects controller skill lives in the Toolkit repo as its source of truth, outside
// skills/, so no plugin ever offers it as a skill. The user uploads it to claude.ai by hand.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const SKILL_REL = 'repo/contracts/claude-projects/web-controller-projects/SKILL.md';
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8').replace(/\r\n/g, '\n');

test('the Projects controller skill has one source file with a Version line', () => {
  const text = read(SKILL_REL);
  assert.match(text, /^---\nname: "web-controller-projects"\n/);
  assert.match(text, /^Version: \d{4}-\d{2}-\d{2}\.\d+$/m);
  for (const kept of ['## Keep moving', '**Remote Control wake.**']) {
    assert.ok(text.includes(kept), kept);
  }
  assert.doesNotMatch(text, /## Adding work to a repo/);
  assert.doesNotMatch(text, /Toolkit may absorb this framework later/);
  assert.match(text, /Before any upload, a coordinator compares that copy with the repo file and brings direct edits into Toolkit first, so nothing is overwritten/);
  assert.match(text, /## Hourly nudge\n- Every project also runs an hourly stalled-work nudge, set up at project setup/);
  assert.match(text, /It must be a recurring routine: one-shot self-reminders have died silently/);
  assert.match(text, /This is the only resolve pass/);
  assert.match(text, /\*\*Resolve only in the hourly nudge\.\*\*/);
  assert.doesNotMatch(text, /Active-work check-in|resolves threads and coordinator posts that have been idle past/);
});

test('no plugin payload or skills folder reaches the Projects controller skill', () => {
  const skillsRoot = path.join(repoRoot, 'skills');
  for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillFile = path.join(skillsRoot, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;
    assert.doesNotMatch(fs.readFileSync(skillFile, 'utf8'), /^name:\s*"?web-controller-projects"?\s*$/m, entry.name);
  }
  for (const manifest of ['.claude-plugin/plugin.json', '.codex-plugin/plugin.json']) {
    assert.equal(JSON.parse(read(manifest)).skills, './skills', manifest);
  }
  for (const rel of ['repo/scripts/setup-claude-toolkit-plugin.cjs', 'repo/scripts/setup-codex-toolkit-plugin.cjs', 'repo/scripts/audit-published-surfaces.cjs']) {
    assert.doesNotMatch(read(rel), /claude-projects/, rel);
  }
});

test('Projects wires managed instructions, promises and fresh scheduled sessions to controller law', () => {
  const text = read(SKILL_REL);
  assert.match(text, /^Version: 2026-10-24\.1$/m);
  assert.match(text, /Account-plugin sync: compares the version of the Toolkit plugin on the user's claude\.ai account/);
  assert.match(text, /remove the account marketplace and add it again with Sync automatically on/);
  assert.doesNotMatch(text, /Thread effort follows the role|fires into that same thread|firing runs in the dedicated check-in thread/);
  assert.match(text, /toolkit-projects-instructions\.cjs --render/);
  assert.match(text, /toolkit-projects-instructions\.cjs --check <file>/);
  assert.match(text, /Read the saved instructions back/);
  assert.match(text, /record the block's toolkit version in project memory/);
  assert.match(text, /`edited`: flag edits inside the markers, show the difference and replace only after owner confirmation/);
  assert.match(text, /declined project-instructions <version>/);
  assert.match(text, /Never offer that version again; offer the next newer version once/);
  assert.match(text, /Threads cannot read project settings\. Read the current project instructions yourself/);
  assert.match(text, /give a cloud thread the verbatim text/);
  assert.match(text, /\*\*Dedupe in the same change\.\*\*[^\n]*dedupe the owner lines outside the markers against the new block, as part of the same owner OK/);
  assert.match(text, /\*\*Dedupe in the same change\.\*\*[^\n]*Remove lines the block fully duplicates/);
  // Partial repeats are trimmed, not kept whole: the repeated part goes and the project-specific rest stays.
  assert.match(text, /\*\*Dedupe in the same change\.\*\*[^\n]*Trim lines that partly repeat it \(for example an approvals line restating the block's merge and force-push rules[^\n]*cut only the repeated part and keep the rest/);
  assert.match(text, /Keep project-specific text and anything that differs in substance[^\n]*Never change other lines outside the markers/);
  assert.match(text, /\*\*Briefs name sibling PRs\.\*\*[^\n]*Every G1 brief carries that list and requires a re-check/);
  assert.match(text, /Every scheduled task runs as a fresh session per run, with no bound thread/);
  assert.match(text, /Fresh-session routines cannot be created from a device-linked/);
  assert.match(text, /cheapest that does the task well, starting one notch higher and stepping down after clean runs/);
  assert.match(text, /Write these requirements into every task prompt/);
  for (const required of ['capped short message to the coordinator with retry', 'full report to a file',
    'resolve its own thread after the report is delivered', 'ALL unresolved threads and project-chat posts',
    'small page limits', 'ALL unanswered owner items with no reply or reaction', 'link and ask date',
    'ONE reminder each run', 'stale thread labels', '**Overdue promise:**', 'fenced `toolkit-promises` block',
    'toolkit-promise-check.cjs --list <file>', 'Pre-wire follow-ups into briefs',
    'never take over a gate\'s verdict', 'accept, downgrade or reject with a reason per item']) {
    assert.ok(text.includes(required), required);
  }
  const body = read('repo/contracts/claude-projects/web-controller-projects/project-instructions.md');
  assert.match(body, /Every thread is an executor/);
  assert.match(body, /Do not copy CONTROLLER\.md/);
  // Toolkit-improvement feedback is the owner's own rule, kept outside the markers, never Toolkit's.
  for (const surface of [body, text]) {
    assert.doesNotMatch(surface, /TOOLKIT_FEEDBACK|feedback format|Feedback comes back in the reply|Capture feedback|to Toolkit as/);
  }
});

// A binding that is only re-checked at launch goes stale on an idle project; each rule of the
// binding-drift closure matrix (launch, periodic check, rebind, unknown, briefs, task prompts) is pinned.
test('Projects re-checks the bound CONTROLLER.md blob before launches and on every periodic run', () => {
  const text = read(SKILL_REL);
  const body = read('repo/contracts/claude-projects/web-controller-projects/project-instructions.md');
  // Binding line format: full commit and full blob, so a periodic run has something exact to compare.
  assert.ok(text.includes('`BINDING: <owner/repo> <branch> commit <full SHA> CONTROLLER.md blob <full blob SHA> skill <Version> bound <UTC date>`'));
  // Coordinator before a launch: stale rebinds first, commit-only moves are quiet, a failed read holds.
  assert.match(text, /\*\*Re-check before every launch\.\*\* Before each launch or authority transition, compare the default branch's `CONTROLLER\.md` blob with the bound blob/);
  assert.match(text, /update the binding line and tell the owner in one line what changed, all before the launch/);
  assert.match(text, /If only the commit moved, update the commit quietly/);
  assert.match(text, /If the read fails, hold the launch until it succeeds/);
  assert.match(text, /Every brief names the bound commit and blob/);
  // Periodic runs: fresh, exact compare and loud first-line forms for stale and unknown.
  assert.match(text, /fetch the default branch fresh[^\n]*never use a stale local branch\. Compare full SHAs with the binding line/);
  assert.ok(text.includes('first line is `BINDING STALE: bound <blob7>, main <blob7> at <commit7>`'));
  assert.ok(text.includes('No binding line, or the read fails: first line `BINDING UNKNOWN: <reason>`'));
  // Coordinator on a report: same-turn rebind, running gates checked, launches held; runs never write.
  assert.match(text, /re-reads and rebinds in the same turn, checks whether running gates need the changed instructions, and holds new launches until rebound/);
  assert.match(text, /Periodic runs and threads only report; only the coordinator writes the binding line/);
  assert.match(text, /^   - Write the binding line \(Binding above\)\.$/m);
  assert.doesNotMatch(text, /Record the commit SHA and the skill Version in memory|Re-check its revision before each launch/);
  // Both periodic runs carry the check.
  assert.match(text, /^  3\. Runs the \*\*Binding check\*\*; when current, the report says `\*\*Binding:\*\* current` with the short blob, adding the newer short commit when only the commit moved\.$/m);
  assert.match(text, /^  1\. the \*\*Binding check\*\*, flagged on the report's first line when stale or unknown;$/m);
  // Running projects pick up changed task behaviour.
  assert.match(text, /When a skill update changes what the daily check-in or hourly nudge does, update those tasks' prompts in the same turn/);
  // Threads at start: briefs carry the blob and a mismatch is reported first.
  assert.match(body, /bound by commit and blob SHA/);
  assert.match(body, /a thread that finds `main`'s blob different says so to the coordinator in its first reply, then continues on its packet/);
});
