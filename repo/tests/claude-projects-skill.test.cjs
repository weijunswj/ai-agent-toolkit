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
  assert.match(text, /^Version: 2026-10-24\.4$/m);
  // Plugin lag: removing the plugin alone is the fix that worked; the marketplace re-add is the fallback.
  assert.match(text, /`PLUGIN BEHIND`: the Toolkit plugin on the user's claude\.ai account is more than a day behind `main`/);
  assert.match(text, /remove the Toolkit plugin only in claude\.ai Customize > Plugins and let it reinstall; if it is still behind, remove the marketplace and add it again with Sync automatically on/);
  assert.doesNotMatch(text, /Thread effort follows the role|fires into that same thread|firing runs in the dedicated check-in thread/);
  assert.match(text, /toolkit-projects-instructions\.cjs --render/);
  assert.match(text, /toolkit-projects-instructions\.cjs --check <file>/);
  assert.match(text, /Read the saved instructions back/);
  assert.match(text, /record the block's toolkit version in project memory/);
  assert.match(text, /declined project-instructions <version>/);
  assert.match(text, /Never apply that version again; apply the next newer version as usual/);
  assert.match(text, /Threads cannot read project settings\. Read the current project instructions yourself/);
  assert.match(text, /give a cloud thread the verbatim text/);
  assert.match(text, /\*\*Dedupe in the same change\.\*\*[^\n]*dedupe the owner lines outside the markers against main's block, never an older saved block/);
  assert.match(text, /\*\*Dedupe in the same change\.\*\*[^\n]*Remove lines the block fully duplicates/);
  // Partial repeats are trimmed, not kept whole: the repeated part goes and the project-specific rest stays.
  assert.match(text, /\*\*Dedupe in the same change\.\*\*[^\n]*Trim lines that partly repeat it \(for example an approvals line restating the block's merge and force-push rules[^\n]*cut only the repeated part, keep the rest and label it "\(adds to the block\)"/);
  assert.match(text, /Keep project-specific text and anything that differs in substance[^\n]*Never add text beyond that label, and never change other lines outside the markers/);
  assert.match(text, /\*\*Briefs name sibling PRs\.\*\*[^\n]*Every G1 brief carries that list and requires a re-check/);
  assert.match(text, /Every scheduled task runs as a fresh session per run, with no bound thread, except the hourly nudge \(bound to its own home thread/);
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
  assert.ok(text.includes('`BINDING: <owner/repo> <branch> commit <full SHA> CONTROLLER.md blob <full blob SHA> toolkit <x.y.z> skill <Version> bound <UTC date>`'));
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
  assert.match(text, /^  - `BINDING STALE` or `BINDING UNKNOWN`: rebind \(\*\*Binding\*\*\)\. When current, the report says `\*\*Binding:\*\* current` with the short blob, adding the newer short commit when only the commit moved\.$/m);
  assert.match(text, /^  1\. the \*\*Binding check\*\*, flagged on the report's first line when stale or unknown;$/m);
  // Running projects pick up changed task behaviour.
  assert.match(text, /When a skill update changes what the daily check-in or hourly nudge does, update those tasks' prompts in the same turn/);
  // Threads at start: briefs carry the blob and a mismatch is reported first.
  assert.match(body, /bound by commit and blob SHA/);
  assert.match(body, /a thread that finds `main`'s blob different says so to the coordinator in its first reply, then continues on its packet/);
});

// Self-updating projects: the base layer stays current through the daily check-in, applied
// automatically under safeguards, and only Toolkit-governed parts ever change.
test('Projects keeps its Toolkit base layer current without touching the project layer', () => {
  const text = read(SKILL_REL);
  const body = read('repo/contracts/claude-projects/web-controller-projects/project-instructions.md');
  const templates = ['daily-check-in.md', 'hourly-nudge.md', 'run-setup.md', 'delivery.md']
    .map(name => read(`repo/contracts/claude-projects/web-controller-projects/tasks/${name}`));
  // No idle window anywhere: a finished thread closes once saved, relayed and nothing is open.
  for (const surface of [text, body, ...templates]) {
    assert.doesNotMatch(surface, /resolve window|idle window|default 2 days|IDLE-2D|thread default|weekday check-in|\* \* 1-5/i);
  }
  assert.match(text, /\*\*Resolve only in the hourly nudge\.\*\* Threads never resolve themselves[^\n]*\(a\) its output is durably recorded[^\n]*\(b\) its latest result was relayed to the owner in project chat, or the owner replied after it; \(c\) no owner question or decision is open\. There is no waiting period/);
  assert.match(body, /Threads never resolve themselves\. The coordinator resolves a thread in the hourly pass only when its output is durably recorded[^\n]*relayed to the owner in project chat or the owner replied after it, and no owner question or decision is open/);
  assert.match(text, /resolving threads or posts that meet the resolve conditions are reversible housekeeping/);
  // Block wording: narrow attribution ban, home threads never resolved, post-edit rule.
  assert.match(body, /no "Generated with" footer, Co-Authored-By or Claude-Session trailers, or session links in footers\. Keep any attribution header the platform requires on PRs/);
  assert.match(body, /A task that reports into one fixed home thread never resolves that thread/);
  assert.match(body, /- Posts: edit your own post only while it is the latest message in its chat or thread, else post anew; answer a burst of owner messages in one post; a new result, PR or question is always a new post\./);
  // Coordinator posts, in the main project chat and reply threads alike.
  assert.match(text, /\*\*Posts, everywhere you post\*\* \(the main project chat and reply threads alike\): edit your own post only if it is still the latest message in that chat or thread[^\n]*otherwise post anew\. Answer a burst of owner messages in one post\. Anything new from your side \(a result, a PR, a question\) is always a new post\./);
  assert.match(text, /also post a one-line pointer to it in top-level project chat/);
  // Base layer and project layer.
  assert.match(text, /Project instructions start with the managed block \(only blank lines before it\)/);
  assert.match(text, /\*\*Toolkit is the base layer; the project builds on top\.\*\* Only Toolkit-governed parts ever change/);
  assert.match(text, /Never overwrite other project memory, owner text outside the markers or the project's own tasks/);
  assert.match(text, /`setup-inventory\.json` beside this skill/);
  // Setup asks for the coordinator's model and effort only.
  assert.match(text, /Ask for one setting only: in the project's model settings, the \*\*coordinator\*\* gets the strongest available Opus model, effort \*\*High\*\*/);
  assert.match(text, /Non-gate threads get High, set on the thread when it starts/);
  // Instructions sync applies itself under safeguards.
  for (const required of ['**Apply it yourself, without asking, with these safeguards.**', 'No saved copy, no change.',
    '`--place <file>`', 'under the instructions limit (16,000 characters)', 'restore the saved copy and report',
    'say undo instructions sync', '`--declined-dedupe <version>`', 'overlaps: <n>', '`misplaced` when the block is not at the top']) {
    assert.ok(text.includes(required), required);
  }
  // Toolkit-made tasks: rendered, named, swapped by recreate; project and local tasks report-only.
  for (const required of ['toolkit-projects-tasks.cjs --render <daily-check-in|hourly-nudge> --params <file>',
    '`<PROJECT>: Daily check-in`, `<PROJECT>: Hourly nudge`', '**Change = recreate.**', 'only then delete the old task',
    'If the test run fails, delete the new one, keep the old one and report', 'say undo task sync <name>',
    'A `malformed` prompt holds and is reported', '**The project\'s own tasks** are never changed without the owner',
    'never recreated or moved to the cloud', 'Trigger ids live only on this line, never in a prompt', '--check-memory <file>',
    'Fresh-session routines cannot be created from a device-linked', 'Run every day by default']) {
    assert.ok(text.includes(required), required);
  }
  // The daily check-in stays fresh; the hourly nudge is bound to a guarded home thread.
  assert.match(text, /every project runs a daily check-in every day/);
  assert.match(text, /\*\*It is bound to its own home thread,\*\* because a fresh-session task posts a run card/);
  for (const required of ['Never resolve the home thread or list it as a resolve candidate', 'TASKS OUTDATED `weekly-rebuild`',
    'If the bound nudge dies twice in 7 days', '`UNRELAYED`', '`HIDDEN REPLY`', 'whether the daily check-in is armed']) {
    assert.ok(text.includes(required), required);
  }
  // The coordinator acts on every check-in prefix, in dependency order.
  const prefixes = ['`SKILL UPDATE`', '`BLOCK OUTDATED`', '`BINDING STALE`', '`TOOLKIT CHANGED`', '`MEMORY FORMAT`', '`TASKS OUTDATED`', '`NUDGE NOT ARMED`', '`PLUGIN BEHIND`'];
  const section = text.slice(text.indexOf('## Daily check-in'), text.indexOf('## Hourly nudge'));
  const at = prefixes.map(prefix => section.indexOf(`  - ${prefix}`));
  assert.ok(at.every((position, index) => position > -1 && (index === 0 || position > at[index - 1])), at.join(','));
});
