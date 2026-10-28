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
// SKILL.md keeps the always-needed rules; setup, instructions sync and recurring-task procedures
// live in its reference files, uploaded with it. Content checks read the whole bundle.
const REFERENCE_DIR = 'repo/contracts/claude-projects/web-controller-projects/reference';
const referenceFiles = () => fs.readdirSync(path.join(repoRoot, REFERENCE_DIR)).filter(name => name.endsWith('.md')).sort()
  .map(name => `${REFERENCE_DIR}/${name}`);
const bundle = () => [SKILL_REL, ...referenceFiles()].map(read).join('\n');

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
  const text = bundle();
  assert.match(text, /^Version: 2026-10-28\.2$/m);
  // The check-in posts the skill card itself; the coordinator lists the Save tap, re-upload only when the card failed.
  assert.match(text, /`SKILL BEHIND`: the account copy is an older Toolkit revision\. With "card posted", the check-in posted the skill update card in its thread: put "tap Save on the skill card"/);
  assert.match(text, /keep that thread open \(never resolve it in the hourly pass, even after the check-in moves to a new home thread\) until the owner saves/);
  assert.match(text, /Once a check-in shows the account copy current, drop the pending item and resolve the thread unless it is a current home thread\. Do the same for an older card when a newer card is posted, when the owner declines it, or when a check-in reports SKILL DRIFT or no account copy: its Save would install an older Version or overwrite direct edits; for a chat card, post "Don't save the <Version> card above\." Name the Version in each Save item\./);
  assert.match(text, /the coordinator resolves a check-in run thread that holds a skill card once `SKILL BEHIND` \(\*\*Daily check-in\*\*\) releases it\./);
  assert.match(text, /If you could not post a due card, or with neither marker and no "drift unverified", tell the owner once per Version to re-upload the skill with its reference files\./);
  assert.match(text, /Fresh-session scheduled runs resolve their own run thread after delivery, except a check-in run that posted a skill card;/);
  assert.match(text, /each fresh scheduled run resolves its own thread after report delivery, except a check-in run that posted a skill card\./);
  // Plugin lag: removing the plugin alone is the fix that worked; the marketplace re-add is the fallback.
  assert.match(text, /`PLUGIN BEHIND`: the Toolkit plugin on the user's claude\.ai account is more than a day behind `main`/);
  // One card each where the owner reads: the coordinator posts a due or failed skill card in the project chat, and one plugin card.
  assert.match(text, /With "card due" or "card failed", load propose_skills \(ToolSearch\) and post the card yourself in the project chat \(kind improvement, target and name web-controller-projects, description from main's frontmatter; skillMd main's SKILL\.md read byte for byte\), never with SKILL DRIFT, and link it in the pending item\./);
  assert.match(text, /On "card posted", if propose_skills loads for you, add memory line `skill cards: coordinator` so the check-in writes "card due" next time; remove it if a post fails\./);
  assert.match(text, /No agent can update it: once per version, post one plugin card in the project chat with the check-in's steps/);
  assert.match(text, /Keep it pending until a check-in shows `\*\*Plugin:\*\* current`\./);
  assert.match(text, /Only the account skill \(one Save tap\) and plugin \(two clicks\) need the owner: no agent can write them\./);
  // The skill drift watch lives in the daily check-in: direct account edits come back into Toolkit first.
  assert.match(text, /`SKILL DRIFT`: the account copy has direct edits that match no Toolkit revision\. Bring them into Toolkit from the saved copy/);
  assert.match(text, /Post its first line to the owner every run, "nothing changed" included/);
  assert.match(text, /The hourly nudge stays silent/);
  assert.match(text, /in claude\.ai Customize > Plugins, remove the Toolkit plugin only and let it reinstall; if it is still behind, select Check for updates on its marketplace; last, remove the marketplace and add it again with Sync automatically on/);
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
  assert.match(text, /Every Toolkit scheduled task is bound to its own home thread \(`<PROJECT>: <task name>`\)[^\n]*A fresh session per run is the fallback, only where a task can't be bound/);
  assert.doesNotMatch(text, /with no bound thread, except the hourly nudge|It is a fresh session per run and read-only/);
  assert.match(text, /Fresh-session routines cannot be created from a device-linked/);
  assert.match(text, /Model and effort: the cheapest step of the `agent-cost-control` ladder that can do the task \(small, mid or top tier; medium effort at least\), set on purpose, never left on a default/);
  assert.match(text, /\| raised <tier>\/<effort> <YYYY-MM-DD>: <reason>\]/);
  assert.match(text, /a template update never lowers a recorded raise/);
  assert.match(text, /Write these requirements into every task prompt/);
  for (const required of ['capped short message to the coordinator with retry', 'full report to a file',
    'only a fresh-session run resolves its own run thread after delivery', 'ALL unresolved threads and project-chat posts',
    'small page limits', 'ALL unanswered owner items with no reply or reaction', 'link and ask date',
    'ONE reminder each run', 'stale thread labels', '**Overdue promise:**', 'promise list in project memory as a plain list',
    'Pre-wire follow-ups into briefs', 'never take over a gate\'s verdict',
    'record only rejections and downgrades, one line each with the reason']) {
    assert.ok(text.includes(required), required);
  }
  // The promise checker and its fenced block are gone: the list is plain, read by the nudge.
  assert.doesNotMatch(text, /toolkit-promises|toolkit-promise-check/);
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
  const text = bundle();
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
  assert.match(text, /^   - Write the binding line \(\*\*Binding\*\* in the skill\)\.$/m);
  assert.doesNotMatch(text, /Record the commit SHA and the skill Version in memory|Re-check its revision before each launch/);
  // Both periodic runs carry the check.
  assert.match(text, /^  - `BINDING STALE` or `BINDING UNKNOWN`: rebind \(\*\*Binding\*\*\)\. When current, the report says `\*\*Binding:\*\* current` with the short blob, adding the newer short commit when only the commit moved\.$/m);
  // The binding check runs once a day; the hourly nudge leaves it out.
  assert.match(text, /\*\*Binding check\*\* \(each daily check-in, read-only; the hourly nudge leaves it out\)/);
  assert.doesNotMatch(text, /^  1\. the \*\*Binding check\*\*/m);
  // Running projects pick up changed task behaviour.
  assert.match(text, /When a skill update changes what the daily check-in or hourly nudge does, update those tasks' prompts in the same turn/);
  // Threads at start: briefs carry the blob and a mismatch is reported first.
  assert.match(body, /bound by commit and blob SHA/);
  assert.match(body, /a thread that finds `main`'s blob different says so to the coordinator in its first reply, then continues on its brief/);
});

// Self-updating projects: the base layer stays current through the daily check-in, applied
// automatically under safeguards, and only Toolkit-governed parts ever change.
test('Projects keeps its Toolkit base layer current without touching the project layer', () => {
  const text = bundle();
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
  // Block wording: attribution ban (the personal-data guard enforces it on PR text), home threads never resolved, post-edit rule.
  assert.match(body, /no "Generated with" footer, Co-Authored-By or Claude-Session trailers, session or thread links, or requester header\. Strip what the platform adds; CI fails it\./);
  assert.doesNotMatch(body, /Keep any attribution header/);
  assert.match(body, /Each Toolkit scheduled task is bound to its own home thread, which carries its model and effort \(fallback: a fresh session per run\)/);
  assert.match(body, /Never resolve a home thread; a fresh-session run resolves its own thread after delivery/);
  assert.match(body, /- Posts: after the owner's last message, keep output in one post you edit \(append, keep every detail\); post anew on an owner project-chat message or near 8 KB; answer an owner burst in one post\./);
  // Posts, in the main project chat, reply threads and work threads alike.
  assert.match(text, /\*\*Posts, everywhere you post\*\* \(the main project chat, reply threads and work threads alike\): after the owner's last message, keep all your output in one running post and edit it, appending each new result, PR or question and keeping every earlier detail\. The running post is always your newest top-level post, the acknowledgement posted with a new thread included\. Before every edit, check whether the owner has written in the main project chat since that post; if so, post fresh instead\. Start each appended update with its local time, for example \*\*\[16:41\] Update:\*\*\. Also start a fresh post when the running post nears about 8 KB; an owner message inside a thread does not start one, and the reply to it is appended to the running post\. Answer a burst of owner messages in one post\. When the owner replies under one of your earlier posts in the main project chat, answer in the main project chat \(you cannot post under your own posts there\) with a fresh post starting "Re: your reply on <short topic>", and never edit the older post\./);
  assert.doesNotMatch(text + body, /is always a new post|edit your own post only/);
  // Running post id in memory, links on everything named, both enforced by the post hook.
  assert.ok(text.includes('save its message id as the first line of project memory, `RUNNING POST: <message id>`'));
  assert.ok(text.includes('it refuses a fresh post while the owner has not written since your newest post, unless that post nears 8 KB'));
  assert.ok(text.includes('only when it is ready for the owner to check and merge; until then, link the chat thread that owns the work'));
  // The post layout and the merge summary, also enforced by the post hook.
  assert.ok(text.includes('**Post layout.** A running post has four parts, in order: a **Now:** line'));
  assert.ok(text.includes('one **ELI5:** line, matched to the Now line, as the very last line with nothing after it'));
  assert.ok(text.includes('one **[HH:MM] Update:** line per update with a blank line after each'));
  // Questions: numbered items with indented choices, a "(my pick)" mark and an &nbsp; spacer after the last choice.
  assert.ok(text.includes('Each owner question is one numbered item under **Waiting on you**, written `1. **Question: <the ask>?**`'));
  assert.ok(text.includes('`    - **<Choice> (my pick).** <one-line reason>`'));
  assert.ok(text.includes('then one line indented four spaces holding only `&nbsp;` after the last choice'));
  assert.doesNotMatch(text, /put at most one \*\*Question:\*\* in a post|Use decision cards for questions, else group/);
  assert.ok(text.includes('an edit keeps every earlier Update line word for word and adds at least one new one'));
  assert.ok(text.includes('the post hook refuses a PR merge (`gh pr merge`, a `gh api` merge call or a merge tool) until a line in one of that session\'s own posts or edits says "external effects" and names the PR'));
  assert.ok(text.includes('It reads only the command text, so it is a tripwire, not a guarantee'));
  assert.match(text, /also post a one-line pointer to it in top-level project chat/);
  // Base layer and project layer.
  assert.match(text, /Project instructions start with the managed block \(only blank lines before it\)/);
  assert.match(text, /\*\*Toolkit is the base layer; the project builds on top\.\*\* Only Toolkit-governed parts ever change/);
  assert.match(text, /Never overwrite other project memory, owner text outside the markers or the project's own tasks/);
  assert.match(text, /`setup-inventory\.json` beside this skill/);
  // Setup asks for no model or effort settings; threads and tasks still set their own.
  assert.match(text, /Setup never asks the user to choose models or effort in the project's settings\. Thread effort is never a project setting/);
  assert.doesNotMatch(text, /Ask for one setting only|effort \*\*High\*\*|default Low is too weak/);
  assert.equal(JSON.parse(read('repo/contracts/claude-projects/web-controller-projects/setup-inventory.json')).rows.some(row => row.id === 'models'), false);
  // Cheapest first: every non-gate thread starts on the ladder's cheapest fitting step, never on High by default.
  assert.doesNotMatch(text, /Non-gate threads get High|one notch higher/);
  assert.match(text, /\*\*Set model and effort explicitly on every thread you start\.\*\* Gates get the pinned stack route/);
  assert.match(text, /cheapest step of the `agent-cost-control` ladder that fits its brief \(small, mid or top tier; medium effort at least\)/);
  // Restarting on the next step up is for non-gate threads; gates keep their pinned routes.
  assert.match(text, /When a non-gate thread's output falls short \(a missed check, a wrong fact, a shallow review\), restart that work on the next step up/);
  // The skill itself keeps gate sessions and the helpers a G0 or G1 lead launches off the ladder.
  const costSkill = fs.readFileSync(path.join(__dirname, '../../skills/agent-cost-control/SKILL.md'), 'utf8');
  assert.match(costSkill, /\*\*Gates are outside the ladder\.\*\* G0, G1, G2, reviewers and the helpers a G0 or G1 lead launches keep the models, effort and routes their gate rules pin\./);
  assert.match(costSkill, /Gate sessions \(G0, G1, G2, reviewers\) and the helpers a G0 or G1 lead launches follow their gate rules'/);
  assert.match(costSkill, /A task changes at its next rebuild; a non-gate thread is restarted on the new step\./);
  // Only host settings that are confirmed are named.
  assert.doesNotMatch(costSkill, /default_subagent_reasoning_effort/);
  // One job per thread, automatic rotation with a handoff file, never the coordinator's own thread.
  assert.match(text, /\*\*One job per non-gate thread; rotate long-lived ones\.\*\* A finished non-gate thread is never reused for new work/);
  // Gate sessions keep the gate rules' fresh-context rules; the old reuse-after-rename sentence is gone.
  assert.match(text, /Gate sessions follow the gate rules' fresh-context and recoverable-work rules, never this one/);
  assert.doesNotMatch(text, /Rename an idle finished non-gate thread before reusing it/);
  assert.match(text, /scheduled tasks start their home thread on the tier and effort in their prompt's params, which carry any recorded raise/);
  assert.match(text, /never swap again for the same gap/);
  assert.match(text, /it writes a handoff file in the shared folder/);
  assert.match(text, /Never rotate your own coordinator thread/);
  // Closing: work threads on saved and relayed output, chat reply threads after 6 quiet hours, home threads never.
  assert.match(text, /A chat reply thread \(the replies under one of your project-chat posts\) also closes on the first pass after 6 hours with no new message in it \(`QUIET-6H`\)/);
  assert.match(text, /idleness alone never closes a work thread/);
  assert.match(text, /a task's home thread is never resolved/);
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
  // The daily check-in and the hourly nudge are both bound to guarded home threads.
  assert.match(text, /every project runs a daily check-in every day/);
  assert.match(text, /It is bound to its own home thread \(`<PROJECT>: Daily check-in`\)/);
  assert.match(text, /\*\*It is bound to its own home thread,\*\* because a fresh-session task posts a run card/);
  for (const required of ['Never resolve the home thread or list it as a resolve candidate', 'TASKS OUTDATED `weekly-rebuild`',
    'If the bound nudge dies twice in 7 days', '`UNRELAYED`', '`HIDDEN REPLY`', 'whether the daily check-in exists and is armed',
    '`CHECK-IN NOT ARMED` (including a deleted check-in)', '**Both gone:** the two tasks watch each other', 'call `list_triggers` once (a cheap read)']) {
    assert.ok(text.includes(required), required);
  }
  // The coordinator acts on every check-in prefix, in dependency order.
  const prefixes = ['`SKILL UPDATE`', '`BLOCK OUTDATED`', '`BINDING STALE`', '`TOOLKIT CHANGED`', '`MEMORY FORMAT`', '`TASKS OUTDATED`', '`NUDGE NOT ARMED`', '`PROJECT TASKS MISSING`', '`PLUGIN BEHIND`'];
  const section = text.slice(text.indexOf('## Daily check-in'), text.indexOf('## Hourly nudge'));
  const at = prefixes.map(prefix => section.indexOf(`  - ${prefix}`));
  assert.ok(at.every((position, index) => position > -1 && (index === 0 || position > at[index - 1])), at.join(','));
});

test('device steps go to the Remote Control session, not the owner', () => {
  const text = read(SKILL_REL);
  // The owner was once asked to create a local scheduled task that a Remote Control session could create.
  assert.match(text, /installs, setup checks and device tasks \(such as a local scheduled task\), which the Remote Control session on the user's computer does itself; hand the user a step on their computer only when its safety check blocks the session;/);
  assert.match(read('repo/contracts/agent-rules/global-rules.md'), /never ask them to run commands, or to do a device step an agent there can do unless a safety check blocks it\./);
});

test('Toolkit text says computer or Remote Control session, not laptop', () => {
  // Work runs on whatever computer the user has. "laptop" stays only as a screen size or an icon
  // name in the frontend art direction skill, matched line by line.
  const allowedFolder = /^skills\/frontend-art-direction\//;
  const roots = ['skills', 'repo/contracts', 'repo/docs', 'repo/scripts', 'repo/tests/fixtures'];
  const hits = [];
  const walk = (rel) => {
    for (const entry of fs.readdirSync(path.join(repoRoot, rel), { withFileTypes: true })) {
      const child = `${rel}/${entry.name}`;
      if (entry.isDirectory()) { if (entry.name !== 'node_modules') walk(child); continue; }
      if (/\.(png|jpe?g|gif|ico)$/i.test(entry.name)) continue;
      fs.readFileSync(path.join(repoRoot, child), 'utf8').split(/\r?\n/).forEach((line, index) => {
        // Only the allowed phrase is exempt, so a banned use on the same line still fails.
        const rest = !allowedFolder.test(child) ? line : /^81,Device,laptop,/.test(line) ? '' : line.replace(/mobile, tablet, laptop, and wide/gi, '');
        if (/laptop/i.test(rest)) hits.push(`${child}:${index + 1}`);
      });
    }
  };
  roots.forEach(walk);
  assert.deepEqual(hits, []);
});

test('Projects lists every owner-hands step when it reports what waits on the owner', () => {
  const text = read(SKILL_REL);
  // An optional step posted only inside a thread was once left off a pending answer.
  assert.match(text, /\*\*Pending lists name every owner-hands step\.\*\* Whenever you tell the owner what waits on them \(a pending answer, the nudge reminder, a check-in\), list every step only they can do, optional ones and ones posted only inside a thread included, each with its link; never drop one as minor\./);
  const nudge = read('repo/contracts/claude-projects/web-controller-projects/tasks/hourly-nudge.md');
  assert.match(nudge, /\*\*Waiting on owner:\*\* \([^\n]*plus every step only the owner can do that is not done yet, optional ones and ones posted only inside a thread included;/);
});

test('the device programme sweep needs both GitHub governance ENABLED and a named device', () => {
  // Cloud-only projects have no device to run it on, so neither half alone may set it up or suggest it.
  const at = rel => read(`repo/contracts/claude-projects/web-controller-projects/${rel}`);
  assert.match(at('reference/setup.md'), /reports plain `ENABLED` \(not `ENABLED \(materials incomplete\)`; a failed read counts as not ENABLED\) and step 3 named a device: also set up the \*\*Programme sweep on a device\*\*/);
  assert.match(at('reference/setup.md'), /With governance in any other state, or no device, do not create it or suggest it/);
  assert.match(at('reference/recurring-tasks.md'), /Only for a repository whose GitHub governance is ENABLED, in a project whose memory names a device \(guided setup step 3\); in any other case, never create or suggest it\./);
  assert.match(at('SKILL.md'), /only when ENABLED and a device is named\)/);
  assert.match(at('tasks/hourly-nudge.md'), /when project memory names a device, "; no device programme sweep task armed", and with no device named "; no device named, so cloud writes wait for the next session on a computer with gh signed in"/);
  const sweep = JSON.parse(at('setup-inventory.json')).rows.find(row => row.id === 'programme-sweep');
  assert.match(sweep.artefact, /GitHub governance ENABLED and a device named/);
});

// Moving a task can skip today's run, and fire_trigger on a bound task runs it unwired.
test('Projects catches up a moved task through its home thread and never fire_triggers a bound task', () => {
  const text = bundle();
  const reference = read(`${REFERENCE_DIR}/recurring-tasks.md`);
  assert.match(reference, /\*\*Moving a task or catching up a run\.\*\* A schedule change, or a recreate, whose new time has already passed today skips today's run if it has not already run today \(a swap's test run counts as today's run\): say which run will be skipped before the move, and catch it up the same turn\./);
  assert.match(reference, /To catch up a bound task, or to test-fire one during a swap, message its home thread to run its prompt there now/);
  assert.match(reference, /Never fire_trigger a bound task from another thread: that run starts in a new session with no project tools, files or memory/);
  assert.match(reference, /Confirm the catch-up's report reached the coordinator\. Never run a bound task's prompt in another thread or in the coordinator\./);
  assert.match(text, /\*\*Moving a task or catching up:\*\* a move to a time already passed today skips today's run unless it already ran today, so catch it up the same turn/);
  assert.match(text, /when its last run is over 65 minutes older than the latest time its own cron should have fired \(hours outside its waking window never count; a nudge that fires less often uses its interval plus 5 minutes\)/);
  assert.doesNotMatch(text, /missed its latest scheduled hour by over 65 minutes/);
  const setup = read('repo/contracts/claude-projects/web-controller-projects/tasks/run-setup.md');
  assert.match(setup, /^RUN SETUP \(\{\{project\}\} project, Toolkit base layer\)\n- First check, before anything else: [^\n]*Make no other tool call \(no effort call, message, file write, resolve or retry\) and skip every later step, DELIVERY included: end the turn with the single line "skipped: started outside its home thread"\.\n/);
  assert.match(text, /Never catch up a task whose entry says `stopped by owner`\./);
});
