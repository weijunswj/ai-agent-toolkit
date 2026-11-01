'use strict';

// The Claude Projects controller skill lives in the Toolkit repo as its source of truth, outside
// skills/, so no plugin ever offers it as a skill. The coordinator reads the copy pulled from the repo into the project library.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..', '..');
const SKILL_REL = 'repo/contracts/claude-projects/web-controller-projects/SKILL.md';
const read = (rel) => fs.readFileSync(path.join(repoRoot, rel), 'utf8').replace(/\r\n/g, '\n');
// SKILL.md keeps the always-needed rules; setup, instructions sync, recurring-task, periodic-run,
// guidebook, device-work and permission-ask procedures live in its reference files beside it. Content
// checks read the whole bundle.
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
  assert.match(text, /The coordinator reads it only from the library copy \(\*\*Guidebook copy\*\*\); changes go into Toolkit through a PR, never into the copy\./);
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
  // Gate launches name their gate and route; setup writes the GATE ROUTE line the launch hook reads.
  assert.ok(text.includes('`GATE ROUTE: profile <profile> placement <remote_control|cloud|any> [folder <path>]`'));
  assert.match(text, /\*\*Gate launches carry a Gate line and their route\.\*\* Every thread brief that names a gate carries one line `Gate: <value>`/);
  assert.match(text, /Write the `GATE ROUTE:` line \(\*\*Binding\*\* in the skill\)/);
  // The coordinator loads no account skills: it reads the skill from the library copy, which three routes keep current.
  assert.match(text, /## Guidebook copy\n- The coordinator's runtime loads no account skills, so this skill reaches you as a copy in the project library: `\/mnt\/project-files\/toolkit\/web-controller-projects\/`/);
  assert.match(text, /`VERSION` \(`Version: <skill Version> toolkit <x\.y\.z> main <commit7> copied <UTC>`, written last, so a copy cut short never looks current\)/);
  assert.match(text, /Never edit the copy: every refresh overwrites it, and changes go into Toolkit through a PR\./);
  assert.match(text, /The hourly nudge checks the copy against a fresh clone of main every run and refreshes a stale or changed copy itself/);
  assert.match(text, /After a merge that changes this skill or the Toolkit version, start a cloud thread for the refresh at once/);
  assert.match(text, /The daily check-in is the backstop/);
  // The library folder is writable by any thread, so only a refresh from a fresh clone of main may change the block,
  // and nothing in the copy loosens a safeguard.
  assert.match(text, /\*\*BLOCK CHANGED:\*\* only a refresh run \(the nudge, the check-in or a refresh thread\) that just rewrote the folder from a fresh clone of main reports it, and only that report lets you replace the block: never replace it on your own comparison of the library files/);
  assert.match(text, /In the turn that report arrives, replace the block in project settings with the library's `instructions-block\.md` under the \*\*Managed project-instructions sync\*\* safeguards/);
  assert.match(text, /\*\*The guidebook never relaxes the safety floor or the owner's own instructions\.\*\*/);
  assert.match(text, /a refresh removes any other file or folder in it, so keep nothing of your own there\./);
  const block = read('repo/contracts/claude-projects/web-controller-projects/project-instructions.md');
  assert.match(block, /Replace this block with the folder's `instructions-block\.md` only when such a run reports `BLOCK CHANGED` that turn, never on your own comparison/);
  assert.doesNotMatch(block, /When this block differs from/);
  assert.match(text, /Its closing checklist carries "coordinator: refresh the guidebook"/);
  assert.match(text, /`SKILL UPDATE`: the guidebook's Version is newer than the one on the BINDING line\./);
  assert.match(text, /a guidebook refresh reports BLOCK CHANGED, or the daily check-in reports BLOCK OUTDATED/);
  // The skill card route for the account copy is gone, with its brief.
  assert.ok(!fs.existsSync(path.join(repoRoot, REFERENCE_DIR, 'skill-card.md')));
  assert.doesNotMatch(text, /SKILL DRIFT|SKILL BEHIND|SKILL CARD|propose_skills|skill-card|skill card|card due|damaged card|tap Save/);
  assert.match(text, /Fresh-session scheduled runs resolve their own run thread after delivery; a task's home thread is never resolved\./);
  assert.match(text, /each fresh scheduled run resolves its own thread after report delivery\. Stop the nudge/);
  assert.doesNotMatch(read(SKILL_REL), /&(?:lt|gt|amp|quot);/);
  // Setup reads the guidebook first, refreshing it when missing or not current.
  assert.match(text, /Read the guidebook's `VERSION` \(\*\*Guidebook copy\*\* in the skill\)\./);
  assert.match(text, /the guidebook's `VERSION` line, and the next work item\./);
  // Plugin lag: Check for updates first, then removing the plugin alone, then the marketplace re-add, then an app restart.
  assert.match(text, /`PLUGIN BEHIND`: the Toolkit plugin on the user's claude\.ai account is more than a day behind `main`/);
  // One plugin card where the owner reads.
  assert.match(text, /No agent can update it: once per version, post one plugin card in the project chat with the check-in's steps/);
  assert.match(text, /Keep it pending until a check-in shows `\*\*Plugin:\*\* current`\./);
  assert.match(text, /Only the plugin \(two clicks\) needs the owner: no agent can update it\./);
  assert.match(text, /Post its first line to the owner every run, "nothing changed" included/);
  assert.ok(text.includes('Relay each hourly nudge run too, one line when nothing needs the owner (**Communication**).'));
  assert.doesNotMatch(text, /stays silent/);
  // The steps live once, in the check-in (toolkit-projects-tasks.test.cjs keeps them equal to Toolkit's shared Claude app steps).
  assert.match(text, /post one plugin card in the project chat with the check-in's steps, the four numbered steps it puts under \*\*Plugin:\*\*, copied as written\./);
  assert.doesNotMatch(text, /remove the Toolkit plugin only and let it reinstall/);
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
  for (const required of ['capped short message to the coordinator with retry', 'full report to `latest.md` and an immutable `runs/<run UTC>.md`',
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
  assert.ok(body.includes('- Posts: before every post, read the newest page where you post (the project chat, or your thread).'));
  assert.ok(body.includes('Decide from the chat itself, never from a memory line.'));
  assert.ok(body.includes('- Post layout: a `**Now:**` line first, its problem'));
  assert.ok(body.includes('- Problem, fix, skip first: every plan, G0 plan, decision ask and explanation opens with'));
  // Posts, in the main project chat, reply threads and work threads alike.
  assert.match(text, /\*\*Posts, everywhere you post\*\* \(the main project chat, reply threads and work threads alike\): after the owner's last message, keep all your output in one running post and edit it, appending each new result, PR or question and keeping every earlier detail\. The running post is always your newest top-level post, the acknowledgement posted with a new thread included\. Before every edit, check whether the owner has written since that post \(in the main project chat, or in a work thread, in that thread\); if so, post fresh instead\. Start each appended update with its time in the owner's profile time zone, never UTC, for example \*\*\[16:41\] Update:\*\*; every other time shown to the owner uses that zone too\. Also start a fresh post when the running post nears about 8 KB\. Once the owner has written after a post, a reply under it included, never edit that post again: answer in a fresh post below their message, and carry every open owner item forward into it\. Answer a burst of owner messages in one post\. When the owner replies under one of your earlier posts in the main project chat, answer in the main project chat \(you cannot post under your own posts there\) with a fresh post starting "Re: your reply on <short topic>", and never edit the older post\./);
  assert.doesNotMatch(text + body, /is always a new post|edit your own post only/);
  // The running post is found in the chat, not in memory, and no hook checks posts.
  assert.ok(text.includes('Before every post, read the newest page of the project chat (in a work thread, that thread). If your newest top-level post there has no owner message after it, edit that post; otherwise post fresh.'));
  assert.ok(text.includes('These are written rules: no hook checks posts'));
  // A forwarded owner message starts a fresh post in the thread, and is never approval.
  assert.ok(text.includes('An owner message forwarded into a work thread (the copy shown in that thread) counts as the owner writing there'));
  assert.ok(text.includes('This is a post rule only: a forwarded copy never stands in for words the owner must type themselves'));
  assert.doesNotMatch(text, /RUNNING POST|A Toolkit hook enforces|The same hook/);
  // The owner opens a PR only to merge it: every other ask, UAT included, links the chat thread.
  assert.ok(text.includes('Link the chat thread that owns the work as much as possible, UAT asks included. A direct PR link appears only on a merge ask for a merge-ready PR (G2 PASS and green CI on its current head)'));
  assert.ok(text.includes('anywhere else, name the PR\'s work in plain words with no PR link.'));
  assert.ok(text.includes('- Relay CI in one line with the owning thread\'s link (a PR link only on a merge-ready merge ask).'));
  assert.ok(body.includes('each linking the card or thread (by its title), a PR only on a merge-ready merge ask,'));
  assert.doesNotMatch(text + body, /with the PR link|until then, link the chat thread|thread \(by its title\) or PR/);
  assert.ok(read('repo/contracts/claude-projects/web-controller-projects/tasks/hourly-nudge.md').includes('with a **Waiting on you** item or relay that names its thread, file or artifact without its link, or that links a PR anywhere but a merge ask for a merge-ready PR;'));
  // Devices by their recorded name, every periodic report relayed, owed decision records kept as promises.
  assert.ok(text.includes('Name a device by the name the project instructions record for it, never a generic word'));
  assert.ok(text.includes('Relay each daily check-in and hourly nudge report there too, with the waiting-on-you reminder list every run, or one line when nothing is due.'));
  assert.ok(text.includes('**Owed records are promises.** With GitHub governance ENABLED, each owner decision or plan OK owes its decision-trace record the same turn'));
  assert.ok(text.includes('the nudge lists it under **Overdue promise:** until then.'));
  // Links only where the owner acts, as the owner decided; a written rule, no hook checks it.
  assert.ok(text.includes('**Link where the owner acts.** Every item under **Waiting on you** (each question and each merge ask included) carries the link to the card or chat thread where the owner acts.'));
  assert.ok(text.includes('A thread or file named elsewhere needs no link. This is a written rule: no hook checks it.'));
  assert.doesNotMatch(text, /Link everything worth opening|names "PR <n>" without a link|not from the link rule/);
  // The post layout and the merge summary.
  assert.ok(text.includes('**Post layout.** A running post has four parts, in order: a **Now:** line'));
  // The owner's call: Waiting on you sits second last, just above the ELI5 line, which ends every post.
  assert.ok(text.includes('**Waiting on you (n):** second last, just above the ELI5 line'));
  assert.ok(text.includes('one **ELI5:** line, matched to the Now line, as the very last line with nothing after it'));
  assert.ok(body.includes('`**Waiting on you (n):**` second last, one numbered item per ask actionable now,'));
  // Waiting on you holds only what the owner can act on now; work not ready for them stays off it.
  assert.ok(text.includes('one numbered line per item the owner can act on right now (work still being built, reviewed or otherwise not ready for them stays off the list until it is;'));
  assert.ok(read('repo/contracts/claude-projects/web-controller-projects/tasks/hourly-nudge.md').includes('(d) a **Waiting on you** item the owner cannot act on yet, such as work still being built or reviewed.'));
  assert.doesNotMatch(body, /one numbered item per owner ask/);
  assert.ok(body.includes('one `**ELI5:**` line last;'));
  // Times shown to the owner use their profile time zone, never UTC.
  assert.ok(body.includes('add one `**[HH:MM] Update:**` line; all times in the owner\'s time zone.'));
  assert.doesNotMatch(text, /with its local time/);
  // The hourly nudge checks the same order and time zone, so every project's posts agree.
  for (const task of ['daily-check-in', 'hourly-nudge']) assert.ok(read(`repo/contracts/claude-projects/web-controller-projects/tasks/${task}.md`).includes("- Write every time in the report in the owner's profile time zone (from the project instructions or memory), never UTC; only the state file below keeps UTC."), task);
  assert.ok(read('repo/contracts/claude-projects/web-controller-projects/tasks/hourly-nudge.md').includes('(c) a coordinator post since the last run whose **ELI5:** line is not its last line, whose **Waiting on you** list is not just above that line, or whose Update stamps are not in the owner\'s profile time zone;'));
  assert.doesNotMatch(text + body, /Waiting on you \(n\):\*\*`? (as the very )?last|the ELI5 line ends the post/);
  assert.ok(text.includes('one **[HH:MM] Update:** line per update, each followed by a line holding only `&nbsp;` as a spacer'));
  assert.ok(text.includes('(only Update lines take that spacer)'));
  // The owner's board rules: blank lines between blocks, nested problem lines, title links, open asks carried forward.
  assert.ok(text.includes('One blank line separates each labelled block from the next: the Now line with its bullets, the update log, **Waiting on you** and the ELI5 line.'));
  assert.ok(text.includes('(**Problem, fix, skip first**) nested as bullets under it'));
  assert.ok(text.includes('answered items drop off, and a fresh post repeats every item still open'));
  assert.ok(text.includes('A thread link\'s text is the thread\'s title, never "here" or an id; an issue is linked by its URL.'));
  assert.doesNotMatch(text, /the answer to it is appended to the running post|\(only Update lines take a spacer line\)/);
  for (const phrase of ['its problem, fix and skip lines nested as bullets under it', 'thread (by its title)', 'a fresh post carries every open ask forward',
    'a blank line between labelled blocks', 'Otherwise post fresh, below the owner\'s message, and never edit the older post again.']) assert.ok(body.includes(phrase), phrase);
  // Questions: numbered items with indented choices and a "(my pick)" mark; no spacer after the last choice.
  assert.ok(text.includes('Each owner question is one numbered item under **Waiting on you**, written `1. **Question: <the ask>?**`'));
  assert.ok(text.includes('lettered in order because the owner picks one, `    a. **<Choice> (my pick).** <one-line reason>`'));
  assert.ok(body.includes('with its choices lettered (a., b.) under it'));
  assert.doesNotMatch(text, /`    - \*\*<Choice>|flatten its choices into plain bullets/);
  assert.ok(text.includes('The next numbered item follows the last choice directly, with no spacer line.'));
  // Plans, G0 plans, decision asks and explanations open with the problem, the fix and what skipping it costs.
  assert.ok(text.includes('**Problem, fix, skip first.** Every plan, G0 plan, decision ask and explanation, from you and from every thread, opens with three lines'));
  for (const label of ['**The problem:**', '**The fix:**', '**If we skip it:**']) assert.ok(text.includes(`  - \`${label}\``), label);
  assert.ok(text.includes('In a running post the **Now:** line stays first: put them under it, or under the question they belong to.'));
  assert.ok(text.includes('Every brief tells the thread to do the same, and a G0 brief to open its plan with them.'));
  assert.ok(text.includes('Under it, indented four spaces, come its problem, fix and skip lines, then its choices'));
  assert.ok(text.includes('for every approval or choice the coordinator acts on itself, opening with its problem, fix and skip lines'));
  assert.equal((text.match(/&nbsp;/g) || []).length, 1, 'only the Update log lines take an &nbsp; spacer');
  assert.ok(text.includes('Choices need no link of their own. Never write a question outside that list: no bare **Question:** label, bulleted question or question in an Update line, and never write its choices as bullets.'));
  assert.doesNotMatch(text, /put at most one \*\*Question:\*\* in a post|Use decision cards for questions, else group/);
  assert.ok(text.includes('An edit keeps every earlier Update line word for word and adds at least one new one.'));
  // The merge-summary rule binds without a hook.
  assert.ok(text.includes('post a short summary of the merge\'s external effects'));
  assert.ok(!text.includes('the post hook refuses a PR merge'));
  assert.ok(!text.includes('It reads only the command text, so it is a tripwire, not a guarantee'));
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
  const prefixes = ['`GUIDEBOOK MISSING`', '`SKILL UPDATE`', '`BLOCK OUTDATED`', '`BINDING STALE`', '`TOOLKIT CHANGED`', '`MEMORY FORMAT`', '`TASKS OUTDATED`', '`NUDGE NOT ARMED`', '`PROJECT TASKS MISSING`', '`PLUGIN BEHIND`'];
  // The prefix list moved word for word from the skill's Daily check-in section into reference/periodic-runs.md.
  const section = text.slice(text.indexOf('## Acting on the check-in report'), text.indexOf('## Hourly nudge home thread'));
  const at = prefixes.map(prefix => section.indexOf(`  - ${prefix}`));
  assert.ok(at.every((position, index) => position > -1 && (index === 0 || position > at[index - 1])), at.join(','));
});

test('every reference or tasks file SKILL.md names exists, so a pointer cannot dangle after a move', () => {
  const text = read(SKILL_REL);
  const named = [...new Set([...text.matchAll(/`((?:reference|tasks)\/[a-z0-9-]+\.md)`/g)].map(match => match[1]))];
  for (const rel of ['reference/guidebook.md', 'reference/periodic-runs.md', 'reference/device-work.md', 'reference/permission-asks.md']) {
    assert.ok(named.includes(rel), `SKILL.md points to ${rel}`);
  }
  for (const rel of named) assert.ok(fs.existsSync(path.join(repoRoot, path.dirname(SKILL_REL), rel)), rel);
});

test('nothing tells the owner to upload the Projects skill by hand', () => {
  // The owner never hand-uploads the skill: the coordinator reads the copy pulled from the repo.
  const skillDir = path.dirname(SKILL_REL);
  const files = [...fs.readdirSync(path.join(repoRoot, skillDir), { recursive: true })]
    .filter(name => /\.(md|json)$/.test(name)).map(name => `${skillDir}/${String(name).replace(/\\/g, '/')}`);
  for (const rel of [...files, 'repo/scripts/toolkit-install-health.cjs', 'skills/toolkit-setup/SKILL.md']) {
    assert.doesNotMatch(read(rel), /upload the (folder|zip|skill)/i, rel);
  }
  assert.doesNotMatch(read('repo/ARCHITECTURE.md'), /uploaded by hand/i, 'repo/ARCHITECTURE.md');
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

test('on a Windows device every governed repository gets its own programme sweep line, not only Toolkit', () => {
  // Setup plans tasks only for the managed Toolkit checkout, so another governed repository's line
  // comes from the read-only plan command run against that repository's checkout.
  const recurring = read('repo/contracts/claude-projects/web-controller-projects/reference/recurring-tasks.md');
  assert.match(recurring, /Toolkit setup on the device lists it for the Toolkit repository only\. For any other governed repository, the device's local Remote Control thread runs `node <Toolkit checkout>\/repo\/scripts\/toolkit-windows-tasks\.cjs plan --repo-root <that repository's checkout>`, which is read-only/);
  assert.match(recurring, /Hand the user that exact line, for that repository's checkout, and put "paste the programme sweep line for <owner\/repo>" on the owner's pending list/);
  assert.doesNotMatch(recurring, /paste the programme sweep line from setup/);
  assert.match(read('skills/github-program-reconciler/SKILL.md'), /the line that setup prints for the Toolkit repository, or that `toolkit-windows-tasks\.cjs plan --repo-root <checkout>` prints, read-only, for any other governed repository/);
  const windowsTasks = require('../scripts/toolkit-windows-tasks.cjs');
  assert.equal(windowsTasks.parseArgs(['plan', '--repo-root', 'C:\\work\\other']).repo_root, 'C:\\work\\other');
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

// The coordinator once held an unrelated PR behind another and left lanes idle; the skill and the
// block both carry the never-hold rule and the lane cap, since the coordinator reads only the block.
test('independent lanes run side by side under the owner\'s lane cap', () => {
  const text = read(SKILL_REL);
  const lanes = text.split('\n').find(line => line.startsWith('- **Run independent lanes side by side.**'));
  assert.ok(lanes, 'Keep moving carries the lanes bullet');
  assert.ok(text.indexOf(lanes) > text.indexOf('## Keep moving') && text.indexOf(lanes) < text.indexOf('## Threads'));
  for (const phrase of ['Never hold a ready or working PR for an independent PR', 'Only merges land one at a time',
    'Keep the project\'s lane number actively working, of any type', '1 lane by default, or the number the owner sets',
    '`- Lanes: <n> working lanes (owner, <date>)`', 'an owner line that already sets a lane cap counts, and no line means 1', 'no per-type limit',
    'Work waiting on the owner does not count (a G0 plan waiting for an OK, a thread waiting for an answer, a PR waiting for UAT or merge)',
    'so start the next queued item to keep that many actually working',
    'open one extra lane for it alone: that lane is always kept free, outside the count', 'Queued or coordinator-started work never takes that extra lane',
    'any usage limit the owner records in project instructions', 'counts toward the cap']) {
    assert.ok(lanes.includes(phrase), phrase);
  }
  const block = read('repo/contracts/claude-projects/web-controller-projects/project-instructions.md');
  const line = block.split('\n').find(entry => entry.startsWith('- Lanes:'));
  assert.ok(line, 'the block carries the lanes line');
  for (const phrase of ['never holding one for another', '1 working lane by default, or the number the owner sets in a project line outside this block',
    'work waiting on the owner does not count, so keep that many actually working',
    'one extra lane always kept free for one needing thread work, never for queued work', 'owner usage limits']) {
    assert.ok(line.includes(phrase), phrase);
  }
  assert.doesNotMatch(text + block, /at most 3 (working )?lanes/);
  // Setup records a number only when the owner gives one, and a sync that brings the default says so once.
  assert.ok(read('repo/contracts/claude-projects/web-controller-projects/reference/setup.md').includes('Otherwise tell them once that the project runs 1 lane at a time, and that "lanes 3" changes it.'));
  assert.ok(read('repo/contracts/claude-projects/web-controller-projects/reference/instructions-sync.md').includes('the note adds: "This project now runs 1 lane at a time by default; say lanes N to change it."'));
});

// Task runs were invisible when the coordinator recycled: the skill now relays every run from its
// home-thread line, stamps the relay, and catches up from the files on a new session's first wake.
test('the coordinator relays every task run and catches up missed ones from the run stamps', () => {
  const text = bundle();
  const body = read('repo/contracts/claude-projects/web-controller-projects/project-instructions.md');
  assert.match(text, /\*\*Every task run reaches the project chat\.\*\* Skip tasks marked `stopped by owner`; relay and catch up each unrelayed run by its own report and `\.relayed` file/);
  const recurring = read('repo/contracts/claude-projects/web-controller-projects/reference/recurring-tasks.md');
  const relay = recurring.split('\n').find(line => line.startsWith('- On every task report'));
  // The prompt is the runtime contract here. Check both paths and effect order, rather than
  // simulating a coordinator in a test that would only prove its own invented implementation.
  const order = ['skip the task if', 'before reading reports or acting on prefixes',
    'Read its exact `/mnt/project-files/toolkit/task-runs/<slug>/<run UTC>.md`',
    'the immutable per-run report path it names, never `latest.md`',
    'Before posting, check `/mnt/project-files/toolkit/task-runs/<slug>/<run UTC>.relayed`',
    'if it already exists, skip that run', 'Otherwise post one Update line',
    "Only after the post succeeds, write that run's `.relayed` file", 'and read it back'];
  const positions = order.map(part => relay.indexOf(part));
  assert.ok(positions.every((position, index) => position >= 0 && (index === 0 || position > positions[index - 1])), relay);
  assert.match(relay, /only the coordinator writes `\.relayed`/);
  assert.match(relay, /task name, run UTC, its first line and a link to its home thread/);
  assert.ok(text.includes('- **Relay missed runs.** On the first wake of every coordinator session, and on every wake a task home thread starts'));
  const catchUp = recurring.split('\n').find(line => line.startsWith('- **Relay missed runs.**'));
  assert.match(catchUp, /every task except those whose `SCHEDULED TASKS:` entry says `stopped by owner`/);
  assert.match(catchUp, /Relay every run whose matching `<run UTC>\.relayed` is missing, oldest first/);
  assert.match(catchUp, /same per-run report read, check-before-post and write-after-success rules above for each run/);
  assert.doesNotMatch(recurring, /<slug>\.md|<slug>\.relayed|newer than its `\.relayed` run time|overwrites its run stamp/);
  assert.match(recurring, /A missing acknowledgement means pending, whatever a newer run's state/);
  assert.match(recurring, /A successful post followed by a failed acknowledgement write remains pending/);
  assert.match(recurring, /it does not make the post and file write atomic/);
  assert.ok(text.includes('one capped line in its home thread (first line and per-run report path), with a capped short message to the coordinator with retry when that post fails'));
  for (const prefix of ['`RELAY GAP`', '`UNRELAYED TASK RUNS`', '`LANES UNDER CAP`']) assert.ok(text.includes(prefix), prefix);
  assert.doesNotMatch(text, /Report to the coordinator only/);
  assert.ok(body.includes('Each run files its report and run stamp, then posts one line in its home thread.'));
});

test('task-run relay, catch-up and prefix actions all honour stopped by owner before sending', () => {
  const base = 'repo/contracts/claude-projects/web-controller-projects/';
  const routes = [
    ['SKILL.md', line => line.startsWith('- **Every task run reaches')],
    ['reference/recurring-tasks.md', line => line.startsWith('- On every task report') || line.startsWith('- **Relay missed runs.**')],
    ['reference/periodic-runs.md', line => /^\s*- `(?:RELAY GAP|UNRELAYED TASK RUNS)`/.test(line)]
  ];
  for (const [file, selects] of routes) {
    const lines = read(base + file).split('\n').filter(selects);
    assert.equal(lines.length, file === 'SKILL.md' ? 1 : 2, file);
    for (const line of lines) assert.ok(line.includes('stopped by owner'), `${file}: ${line}`);
  }
});
