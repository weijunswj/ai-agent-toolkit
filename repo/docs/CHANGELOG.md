# Toolkit Changelog

## 3.195.0 (Governance reminders for permissions, the App, the evidence store and a closed shard split)

### Added

- **Permissions line at turn end (Claude Code):** while this computer's Toolkit permission lines are out of date, the first turn end of each governed local chat shows the owner one line, naming `toolkit permissions`. It shows once per chat, never stops the turn, and cloud sessions are not checked. The session-start line for the agent stays.
- **Governance App and evidence store at session start:** a governed session start carries one line for the agent to pass on when the Governance App is missing or partly set up, or when the evidence store cannot be found, is not private or cannot be written with this computer's GitHub sign-in. GitHub is checked at most once a day per repository, in the background, so a session start never waits; while a part is missing, unusable or could not be read it is checked again after an hour, and the governance bank saves its own reads, so a fix the owner sees there ends the line at once. GitHub that could not be read says nothing.
- **Evidence store row:** the governance bank's evidence store row reads the store as it reads the App and shows Not ready when it cannot be used, with the same one step as the session line.
- **A closed shard split is asked about once:** when the owner closed a shard split pull request without merging it, the bank's shards row asks once (shards=yes opens a new one, shards=never stops the offer, any other reply keeps shards off). The answer is remembered on that computer and holds until a newer split is closed, even once that pull request drops off GitHub's newest closed list or the list cannot be read, so no plain reply reopens it.

### Changed

- **How to ask, generic wording:** the global rules, the desktop asking line, the takeover playbook and the controller principles now say to mark the recommended option instead of naming the owner's own "(my pick)" style, and the principles no longer ask for bold section labels. The owner's own instructions keep their style; the Claude Projects controller skill keeps its post format.

### Notes

- A missing Governance App holds no governance action: programme records, gates, merges, the bank and this computer's own refresh use the owner's own GitHub sign-in. Only the cloud Programme Sweep and the Shard Timings pull request need the App, and they do nothing without it.
- Codex keeps the session-start permissions line only; its turn-end hook prints nothing.

## 3.194.0

### Added

- **Daily scheduled task sync in Projects:** the daily check-in now reads every scheduled task of the project back once and runs the upgrade plan in its daily mode (`toolkit-projects-tasks.cjs --upgrade-plan <read-back> --memory <memory> --daily`). Each outdated Toolkit task, and each of the project's own tasks on the Toolkit shell, is swapped in place without asking, then every task is read back again and checked with `--upgrade-verify`; only a verified task counts as done, and the run posts only what changed.
- **No unpause question in the daily run:** the daily plan asks nothing; a paused task stays paused and is listed under `paused`, and a task stopped by the owner is never touched. A takeover keeps its one unpause question.

### Changed

- **Shell updates without asking:** a project's own task opted into the Toolkit shell now gets its shell updates from the daily check-in with the same read-back as a takeover, instead of waiting for the owner's word. Its own steps never change.
- **Old full shells are recognised:** a project task still holding the full shell from before pointers (run setup and delivery only) now plans as a shell task and is brought to the pointer form, instead of reading as not Toolkit's.
- **Setup inventory:** a new `shell-tasks` row (checked by TASKS OUTDATED, kept current automatically); the `project-tasks` row now covers only tasks not on the shell.

## 3.193.0

### Added

- **How to ask the owner, in the Claude desktop app:** each session start (startup, resume, clear, compact) ends with one line for the agent, in every folder and whatever the governance state: the context, options and pick go in the closing message and the question card follows on the next turn, because the app cuts text written before a card in the same turn. It stands over the agent's own notes, no card is refused and Toolkit's merge card keeps its own text. The terminal, the IDE extensions, cloud sessions and Codex do not get it.
- **Woken for each finished gate:** the note after a gate launch (Claude Code) says how to be woken for each running gate session's own result (for a session on this computer, the host's idle notice asked for by the session's listed name, never its id; otherwise, or when no notice comes, a GitHub watch), since the app continues a chat only once none of the sessions it started is working.

### Fixed

- The turn-end owed check no longer lists work that is already recorded. `programme.cjs gate-session` keeps its accepted result on this computer and the check reads that instead of the words of shell commands, so a record made through a script or a variable counts, and a refused one does not. The first turn end after the update may list gates launched in the last day and recorded by the older version; the same `gate-session` command answers `NOOP` and clears each.
- The owed check no longer lists a gate session held at its first turn (`First turn: reply only READY`) before its go-ahead.
- The owed check's stop text asks for the owed work, or a recorded reason it waits, and no message to the owner unless a step or decision is theirs; never the last message or its question again.
- A copy of a controller's chat that was itself rewound no longer counts as the controller while the original goes on.

### Changed

- The global question rule says a question card holds only the question.

## 3.192.0

### Changed

- **Governance bank as one table:** `toolkit governance` now shows one table: 1.1 GitHub governance and 1.2 Task auto-merge with merge train, the only two questions, then the parts Toolkit keeps itself: parallel CI shards, Toolkit permissions, the Governance App and the evidence store. Each part is marked Ready, Not ready or Unknown with its one next step while governance is on, and the top line says `ON, ready` or `ON, not ready, n steps left`. The parent issue and required checks are one line under the table, and merge trains show in row 1.2. A part takes no answer: replying to its row says how it changes instead, and the evidence store's other choice is to say change store, and the controller sets up the new store with you; nothing moves on the answer.
- **Unknown is never missing:** when GitHub cannot be read, even for one of the App's two reads, the Governance App row is Unknown and the answer gives no setup line; a CI time that could not be read, or a programme file that could not be read, leaves the shards and store rows Unknown too, and an unknown part is never counted as a step left. A missing App holds no governance action; only the cloud jobs that need it do nothing.
- **Shards not applicable:** where Toolkit cannot split the tests (no Node tests, such as a Python suite), the shards row says not applicable with the reason, and no answer turns shards on there. Fast CI says not needed.

### Added

- **Permissions line at session start:** while this computer's Toolkit permission lines are out of date, a governed repository's session start carries one line for the agent to pass on once, naming `toolkit permissions`. Nothing waits on it, and cloud sessions are not checked.

## 3.191.0

### Added

- **Takeover shows the controller settings:** a controller takeover's dry run and done line now show the stack profile, live lanes and where gates run, read from the evidence store with one request, or say that none are saved yet, that they belong to another repository or that they cannot be read. They never name the device or folder.
- **Scheduled task upgrade at a takeover:** `toolkit-projects-tasks.cjs --upgrade-plan` reads a project's scheduled tasks as the host read them back, with the project memory (`--memory`, required, so a task the owner stopped is never planned as a swap), and names each one current, outdated (with its exact replacement prompt), waiting for its project additions, hand-made, damaged, not Toolkit's or stopped by the owner, and lists the paused ones in one unpause question. `--upgrade-verify` checks the read-back after the swaps: each replacement is stored, a task rendered by hand checks current, nothing else moved, no task was added, and only the tasks the owner named were unpaused. A task stopped by the owner is never touched.

### Changed

- **Takeover without the evidence store:** a session that cannot use the store (often a cloud one) now says it claims nothing and to run the takeover in a session that can, such as one on the owner's computer.
- **Owner-line lint and named computers:** two lines that name different kinds of computer (a desktop and a PC, say), or a line naming one while the controller settings name a device, are now a conflict to ask the owner about, never a duplicate or repeat with a fix.
- **Owner-line lint under a turning heading:** a line that repeats Toolkit's block under a heading that may change what it means (such as "Not in this project") is no longer offered for removal.

## 3.190.0 (remove toolkit and leftover scan fixes)

### Fixed

- **Remove toolkit:** the plan now lists the Claude app's Toolkit copy from the claude.ai account as kept, with the steps to remove it on claude.ai, and apply's closing lines say the Claude app keeps running it until then. Toolkit never changes that copy.
- **Remove toolkit:** the line about parts every app shares names only what is on the computer (old scheduled tasks only when there are some), and says nothing when there are none.
- **Remove toolkit:** the "Not touched" line no longer counts the subagent limit among the Claude Code settings left as they are, and the update reports folder is listed only while it holds a Toolkit report.
- **Leftover scan:** an older marked `GEMINI.md` shim is listed where governance is on too, and an older marked `CLAUDE.md` shim is listed in every state; the governance cleanup replaces a marked `CLAUDE.md` shim that loads the repository's own `AGENTS.md` with the line `@AGENTS.md`, as a rules refresh does.
- **Install check:** "Toolkit helpers: not installed" now says none are needed, because each subagent's model and effort are set when it is started.
- **Wording:** the `CLAUDE.md` shim guidance names Claude Code 2.1.277 as the first version that reads `AGENTS.md` by itself, and says the session-start preflight compares `CLAUDE.md` only in a Toolkit source checkout.

## 3.189.0 (every cloud workflow by default, and a first look at what is already there)

### Added

- **Every Toolkit cloud workflow by default:** turning governance on now carries the personal data guard (its check, sweep, script and settings, with no hooks on any computer) and dependency auto-merge with the programme sweep and its gate, in the same one pull request; the test shards and Shard Timings join where a usable shard list exists, as before. One list, `DEFAULT_CLOUD_WORKFLOWS`, is read by turn-on, the refresh pull request and the governance check.
- **A missing workflow is drift:** the governance check names each default workflow file that is missing or edited, and the refresh pull request adds what is missing and brings an edited or older copy back. A rerun with nothing missing changes nothing. A file Toolkit did not write is never overwritten: that workflow is left out whole and named, and the rest still goes in. The cloud sweep's board call stays about the rendered copies, so an already governed repository is not told to change because of it.
- **First-install sweep:** after a turn-on that adds the guard merges, Toolkit runs the new Personal data sweep workflow once over what is already there (files, commit messages, pull request text, and issue, pull request and review comments) and shows the counts and a link in the next session's result line. It lists places and rule names only, never a value, and changes and posts nothing. Run workflow on GitHub runs it again by hand.

### Changed

- **The personal data guard never scans commit author, committer or tagger addresses:** the `identity` setting, and the installer's `--identity` and `--identity-reason`, are gone. A config that still holds the key is read without it, and the refresh pull request that brings the new script takes the key out, keeping every other setting.
- **The same addresses in commit messages:** the personal data guard leaves the address on an author line (Signed-off-by, Co-authored-by and the like) alone, and GitHub no-reply addresses everywhere. A co-author line naming an AI tool (Claude or anthropic.com, Codex, Cursor, Copilot, Gemini and the like) fails whatever its address: the no-reply exemption applies only after that rule. The default settings need no Dependabot entry any more.
- **Images and fonts pass the personal data guard by default, named:** the settings a new install writes have `pass_unread`, so a PNG, JPEG, GIF, WebP, AVIF, ICO, WOFF, WOFF2, TTF or OTF file whose name and bytes agree passes unread and the report names it; the review steps have the reviewer open each one. Text under such a name is scanned as text, and settings that already exist are left as they are.
- **The guard's refusal for a file it cannot read** (an archive, Office file or other binary) says it was not checked and how to list its path, instead of calling it a leak.
- The guard's CI workflow copies have a managed header, and its installer brings an older copy up to date; a hand-edited one is kept.
- A default branch other than main now leaves out only the sweep, its gate and the shard copies, with the reason, instead of every cloud workflow.
- With governance off, the left-over files report also names the guard's marked workflows; like its script, they keep working and are the owner's choice to remove.
- The turn-on no longer writes dependency auto-merge into the working tree; it travels in the pull request.

### Fixed

- A governance turn-on from a checkout behind the default branch no longer replaces files GitHub already holds: existing settings files and files Toolkit did not write are kept and named, and a hand-edited Toolkit copy it brings back is named.
- A file name with a line break can no longer write a line of its own in the guard's report.

## 3.188.0

### Added

- **Typed command `controller takeover`:** typed as the whole message in a new chat, it makes that chat the controller of the repository the chat's folder is in, names that repository, follows the takeover playbook (dry run, then claim) and ends in one short status: what runs, what is next, what waits on you. It counts as your appointment exactly as the sentence does, and only when you type it yourself: a launched, forked, scheduled or relayed message, a quoted line or words inside a longer message start nothing. A folder with no repository, or one where GitHub governance is off, undecided or unreadable, gets a plain refusal. The sentence keeps working for another repository and for chats that cannot run the command. It has its own group in `toolkit cmd`.
- **Toolkit versions in a takeover:** the dry run and the done line show the Toolkit copy this chat loaded (`--session-copy <folder>`, "not given" otherwise, never guessed), the copy that ran, Toolkit main, what the repository's cloud sweep runs (follows main, pinned, outdated, edited or the repository's own commit) and exactly one refresh action. The dry run shows them with governance off too.

### Changed

- The takeover playbook is 9,586 bytes shorter (29,998 bytes, capped): its steps point to the one command, the hand-made "two matching reads" stop proof is gone, and only the owner's own typed confirmation stands where the command cannot run. The relay illustrations that only repeated the templates are gone.
- The public-record screen names what it refuses exactly: dotted host names of three parts or more, local one-name hosts and any host with a port; a two-part name such as `claude.ai` passes.

### Fixed

- A takeover run that resumes an earlier run's record marks it NOT USED only when a read shows that another claim left its epoch. Before, a refusal or a late comment could mark the record an earlier run's claim had landed with, when GitHub's old reads outlasted that run.
- A record with other text in it is never resumed, so it cannot hold a takeover up.
- `CLAIM_UNCERTAIN` gives the reason of the claim that is uncertain, not of a later refused request, and a record that could not be marked says to run the command again first.

## 3.187.0

### Added

- **One takeover command:** `programme.cjs takeover` takes over as controller of a governed programme. The dry run, which any session may make, reads and prints the facts, whether the old controller has stopped, every hold and the record it would post. `--apply --controller` posts the record, reads it back, claims and reads the claim back, in seconds however many tasks there are.
- **Stop proof from the old controller's own last write:** its state commits, its comments on the parent and its merges to the default branch, by GitHub's clock. It must be 10 minutes old at the record and still the last one after it. Less takes the owner's own words (`--owner-stop`), quoted in the record. A source that cannot be read, or a takeover from another account than the old controller's, is refused.
- **Safe to run again:** a run that stopped early claims with its own unused record, an answer that never came back or did not read back is settled by reading, a record number another comment took first moves to the next free one, and a record that can no longer carry a claim is marked `NOT USED:`. A claim that landed, or may have, says so (`CLAIM_LANDED`, `CLAIM_UNCERTAIN`) and its record is never marked.
- **Nothing private in the public record:** the controller's name and the words it is given are refused before anything is read when they hold a session ID of any host, a path or home folder, a host name, an address or a port.

### Changed

- A sweep that writes between the record and the claim no longer voids a takeover. State commits a refresh makes end with ` (refresh)`, so they are told apart from the controller's.
- A replacement controller takes a new name; taking over under the holder's own name is refused and suggests the next one.
- The permission blocks ask before `takeover`, and the takeover playbook's record step runs the command.

### Removed

- `claim --parent`, with `--takeover` on the parent and `--takeover-record`: `takeover` is the only way a parent's epoch moves after it is created. `claim --issue <n> --lane` stays for lane controllers.

## 3.186.0

### Added

- Claude Code setup has a row for the Claude desktop app's "archive sessions when their PR closes" setting, On by default. In the app, the agent reads the setting with the app's settings tool and passes it to setup; a yes returns that one change for the agent to make in the app. The app asks you in its own approval card; in auto or bypass permissions mode it may not, so there your agent asks you about that one change first. Setup never changes the setting itself. An off you chose in setup is remembered; an off you set only in the app looks the same as one never chosen, so the question says that `3.6=off` keeps it off. Outside the app the row shows Not readable here and changes nothing.

### Fixed

- A governance answer, or `toolkit env show`, in a Terminal panel tab Claude opened in the desktop app is refused like any shell an agent started: the app marks such a tab, and Toolkit now reads that mark. A tab you open yourself works as before; the shell behind a `!` line in the message box is refused too. The bridge doc no longer says the panel carries no mark.
- A Claude Code setting under an entry that is not an object counts as not read, no longer as having a value.
- Where the Claude Code settings file cannot be read and no agent profile can be used, setup says it still sets its own profile to root-only.
- Turning governance off where it is already off says only that.

## 3.185.0 (no open pull request left without an owner)

### Added

- **Unowned open pull requests are findings:** in a governed repository the programme sweep raises `PR_UNOWNED` for an open pull request no task in progress owns once it has been open 24 hours, and `PR_RED_UNOWNED` for a red one on the first sweep that sees it. Bot pull requests (the shard refresh, the source-watch notice, dependency updates) and the evidence store's are included; the store's go by age alone. A task owns a pull request it tracks, or one that names it with `Refs` or `Closes`, while that task is in progress; a bare mention or a queued task does not count. Neither finding can be disposed of, and an acknowledgement lasts at most 24 hours, so it comes back daily until the pull request is landed, handed to a task or closed. Both join the stale-work net, so Claude Code's turn-end check stops the controller once for one left 4 hours. The sweep only reports: it never reruns, closes, merges or comments on a pull request.
- **Open PRs in `attention`:** every open pull request of the repository and the evidence store with its owner, its next step or when it is flagged, and the failing jobs of a red one no task owns. It is read live and never stored; a list that cannot be read says so instead of showing a short one.

### Changed

- **Controller rule:** each flagged pull request is routed the same day (landed, handed to a task, asked of the owner, or closed on their OK), and a red one has every job rerun, never only the failed ones.
- **Governance bank, parallel CI shards:** where shards are on, the row says the split is refreshed once a day, and `explain 1.1` says how: one pull request, nothing changes until it is merged, and the programme flags it after 24 hours with no owner.
- **Projects nudge and check-in:** where governance is ENABLED they work out no unowned pull requests of their own; the sweep's findings are the one list. Projects with governance off keep the thread-based check. Project owners refresh their copy as usual.
- **Controller check:** the Open PRs rows of `attention` are not counted or listed as findings.

## 3.184.0 (one way to turn governance off, and setup asks nothing when every setting is set)

### Changed

- `setup toolkit` in Claude Code asks nothing when no setting is left to set: it shows the tables, keeps every row and says how to change one (such as `3.5=off`). It no longer asks a question whose yes "changes nothing". It names any setting it could not read, or that this Claude Code version does not have, and never counts it as having a value; `refresh toolkit` names them too.
- Turning governance off has one route: the card's No, `disable` in your own terminal and the bank's Turn off make the same one pull request. The terminal `disable` is the answer itself and no longer asks a second Enter; a shell a coding agent started is still refused by name, and the bank no longer reads an answer typed in one.
- Where the governance bank is the turn-on question (no card came first), its first answer may also be a plain yes (all recommended), later (no store) or no (the off pull request).
- The governance question in text form names this repository's own store (`TRANSPORT-<name>`) instead of a placeholder.
- The `migrate` question says that only rulesets and branch protection wait for the answer; the free dependency and security settings are turned on either way.

### Fixed

- After an answer the governance bank used, a bare "ok" is told the answer was used, instead of "was not read ... Reply again", and the next reply is no longer framed as answering a bank still open.
- `store=` naming the task repository itself is refused for that reason before anything is made, the shard list included; before, a parent issue was made first and the refusal named the wrong cause.
- Turning governance back on from off gives the governance App line, as a first turn-on does.
- `toolkit governance status` no longer prints "Without hooks ..." while Claude Code or Codex runs Toolkit's hooks; the synced Projects line no longer counts.
- The unread governance bank names a cause that a retry cannot fix (such as a redirected remote), and a read-only `explain` on an unread binding no longer says an answer was not used.
- A turn-off pull request that could not be published says the no stays pending only where it can still be published as it is, and an unexpected error keeps its name.

## 3.183.0 (controller settings and owner-line lint)

### Added

- Controller settings: `toolkit-controller-settings.cjs` keeps the stack profile, the number of live lanes and where gates run (by default, per gate, device and folder) in one file the controller saves to the evidence store at `state/<owner>/<repo>/controller-settings.json`. Only a controller changes it, on the owner's words, which are kept as said with each change and with the setting; a gate session (by its launcher mark or its brief) and a launcher-bound helper are refused, and every write goes through a temporary file over unchanged bytes and is read back.
- The project lines (lanes, stack profile, where gates run) and the `GATE ROUTE:` memory line are rendered from the settings, and the lanes line names the owner and date only where the owner gave the number; `toolkit-projects-instructions.cjs --render --settings <file>` prints the lines after the block.
- Owner-line lint: `toolkit-owner-lines.cjs check` reads the owner's own lines in any controller's instructions or memory and offers one-tap fixes for a whole line that repeats or contradicts the settings, overrides the block's post format, or is a block line or another owner line again. A line it does not understand whole, or that does not stand on its own, gets no fix; a near copy is only a hint; a second line with another value is shown as a conflict. `apply` writes only the fixes the owner tapped, exactly as they were shown, changes no other byte, and refuses when the file, the settings or their repository changed.
- `toolkit-controller-check.cjs --owner-lines <file> [--settings <file>]` runs the lint on any host.

### Changed

- The `GATE ROUTE:` line also names the live lanes: `GATE ROUTE: profile <profile> lanes <n> placement <...> [folder <path>]`.

## 3.182.0 (questions asked the app's own way)

### Changed

- **The merge card says what it does:** its Merge option now reads "Merges pull request N of owner/name into its base branch, at commit <full SHA>. Nothing else is approved." Toolkit builds the line from the merge it refused and reads no pull request title for it, so no one else's text reaches the card. Any other wording, pull request or repository records nothing.
- **Merge train `land`, route owner:** the agent gives the effects and runs the merge, and the merge guard's card is the one ask. The agent asks first only where no guard is known to run, or where task auto-merge is on and the guard may let the merge through unasked.
- **Task auto-merge needs no card:** with the switch On, a pull request the auto-merge check accepts, with its other gate conditions met, lands with no card or question at any tier, scripted carries included; the controller posts one short notice after (what landed, its effect, how to undo it) and runs the check before telling the owner a card will open. A refused one keeps the card, and a merge train with a RISKY member keeps it too. The shard refresh body, the fast-tests playbook and the train's `land` say the same. What the merge guard allows or refuses is unchanged.

### Removed

- **The question-card check in Claude Code:** a question card after text in the same turn, or with a question over 120 characters, is no longer refused. Agents ask with the app's own question method. The merge card, the governance question and the redirect of an agent's own merge question are unchanged.
- **How-to-ask rules:** the controller principles, the takeover and the standing permission asks no longer say where the context or the card goes; the global rules' one line stays (the harness's own question method, clear on its own).
- **The typed-command note:** the Claude Code and Codex prompt hooks no longer add a line for a typed Toolkit command. Every command still works: the Toolkit setup skill, whose description now also names `refresh governance`, reads the message and runs `toolkit-commands.cjs`.

## 3.181.2

### Fixed

- **The turn-end owed check now runs in every Claude Code entry point, for the first time.** It stayed silent in the desktop app, the CLI, IDE extensions and headless runs alike, because it read a variable every Claude Code hook process carries as the mark of a side session. No variable the host sets decides whether a turn is stopped now. Gate sessions are still recognised by their brief and launched sessions by Toolkit's launcher marks.
- The owed check stops only a chat whose own rows show it acted as the controller. Rows copied from another chat (a Fork, a `/btw` or forked side session, a branch) no longer count, and neither does a command that only mentions `programme.cjs` and `--controller`. A controller's chat still counts after a restart, a compaction or a rewind. A gate launched with its brief in the start's background is now seen, a proposed start nobody began is not a launch, and a `Gate:` line counts as a gate only with its `Route:` line, as the gate route check reads it.
- The owed check reads Toolkit's launcher marks from the shared list in `toolkit-governed-repo.cjs`, so a session started with a pinned task profile now also counts as launched there. The copies the Claude agent hook, the Codex helper hook and the governance gate keep for a module failure are now checked against that list.
- The hook test pack runs every Claude Code row with `CLAUDE_CODE_CHILD_SESSION=1`, as Claude Code hook processes have it.

## 3.181.1

### Changed

- `toolkit governance status` names the governed rules file in an enabled repository (`Governed rules: <path>`, and `governed_rules` in `--json`), so a chat that no session-start hook reached can still read them.
- The Bridge doc says helpers (subagents) get the global rules and the repository's `AGENTS.md` but not the governed rules, and why.
- The n8n safety router skill no longer calls itself a Toolkit skill surface, so the portable skills' leak list is empty.
- The git-completion playbook no longer cites a PR review playbook that only Toolkit's own repository has.

## 3.181.0 (controller handoff snapshot removed)

### Removed

- The controller handoff snapshot is gone, with no replacement: the `toolkit-store.cjs handoff` command, its planner script, the Claude Code after-tool hook that refreshed it, the controller check's `handoff` row and `--handoff` flag, its hook test pack rows and fixtures, and every doc, skill and Projects line that pointed to it. A successor controller works from the GitHub records, the evidence store and Projects memory. `handoff` is now refused as an unknown store command and as an unknown `--skip` name.
- The evidence store command deletes no file at all: a deletion in a save, a move, a merge or any commit it would push is refused, with no exception for snapshot memory files.
- Toolkit's scheduled Projects task prompts no longer start with `touch ~/.toolkit-handoff-off`, and their controller check commands no longer skip `handoff`. The daily check-in reports the stored ping and pointer prompts as outdated until they are saved again.

### Changed

- Every session start, in Claude Code and Codex, removes what the snapshot left on the computer: `handoff-sessions/`, `handoff-folders/`, `handoff-refresh.json` and `handoff-refresh.lock` in Toolkit's user-state folder, and an empty `~/.toolkit-handoff-off`. Only those exact names of the kind the snapshot wrote are removed; a link, a file with content in the home folder or any other name is left alone, and nothing is printed.

## 3.180.0

### Added

- Toolkit's own CI now checks that every hook is harness-specific: each hooks.json command has a scope row naming its harness, the hard rules it enforces and why each event is the moment that matters, no script serves two harnesses, and modules both harnesses load hold no harness tool names, environment names or output fields. The mixing that exists today is listed as known open items that may only shrink.
- The hook design playbook gains "Harness-specific by default": per-harness entries and dialects, hard rules written once in shared policy, and the event test for choosing when a hook runs.

## 3.179.0

### Changed

- **Merge trains stack by default:** while a train pull request is open, `toolkit-merge-train.cjs find` writes `onto` (the train's number, branch and head) into the manifest, even for one ready pull request, and `build` stacks onto that head with no bump of its own, printing the pull request base and the retarget line for after the earlier train lands. A build on main reads the open train pull requests first and refuses beside one, naming the train to stack onto and the exact `--onto` head; `--separate "<reason>"` builds beside it on purpose and keeps the reason in the manifest. Rebuilding a train's own branch on main is not refused. `catchup` drops `onto` with the stacked mark.
- **Find boards the named pull requests:** `toolkit-merge-train.cjs find --pr <n,n,...>` judges only those, with every readiness check, and writes the ready ones up to six, so a train holds exactly the owner-approved members; a named one that is not ready, or not open, is listed with its reason and left out. Without `--pr` it judges every open pull request and boards the oldest ready ones, as before. Only a train pull request from this repository counts as an open train; a fork's never does.
- **Pack changes stop where the section ends:** `find` copies a member's `Pack changes` lines only up to the next heading or the first `UAT:`, `Agent UAT:`, `Bump:`, `Route:`, `Tier:`, closing line or HTML comment, so a train body no longer repeats a member's UAT and Bump lines or its programme-state block.
- **Land says the merge step plainly:** a ready `land` prints `merge_step`. For route `owner`: ask the owner in a plain message (a question card that asks to merge is refused) "Merge PR N?" with the external effects, and on their yes the agent runs the exact merge command (merge commit, pinned head) so the merge guard shows its card; the owner is never told to click Merge on GitHub, except where the guard cannot record the answer, and then the agent says why. For route `auto`: post the effects notice, then run that command.
- **Land lists what is owed after the merge:** a ready `land` prints the closing-story commands for the train and each member, the sessions to archive (keeping those whose owner test is owed) and the `git worktree remove` and `git branch -d` lines for worktrees at the train or a member head; worktrees Claude Code or Codex made are left to the host.

### Added

- Claude Code refuses a gate start (`start_session`) whose brief lacks a valid `Gate:`, `Route:` or `Assignment:` line, is a fork, or does not pin the route's model and effort, and names the exact fix: the route lines from the stack registry, the profile's members, or the model and effort to pass. The brief is read by the same route reader the started session's own route check uses.
- After a gate start or proposal card that runs below its pinned effort (including one that asked for more effort than the starting session has, which the app caps without an error), Claude Code prints the next steps with the session id filled in: a READY-only first turn, then `set_session_effort` to the pin, then the go-ahead; and the `programme.cjs assign` record step for the brief's assignment.
- An offer card's brief, sent with its proposal id, has its Gate, Route and Assignment lines checked; that call may carry no model or effort.
- The hook test pack also reads after-tool (PostToolUse) context, so a row can check what a hook adds after a tool runs.

## 3.178.0 (env edit keeps your typing: placeholders, notes in the file and one tab)

### Changed

- An empty `NAME=` line in `toolkit env edit` is a placeholder: it is skipped (nothing stored, a stored value kept), the other lines are applied, and the next tab shows it again. It no longer refuses the whole save.
- The edit file says what happened to a refused save, or one that skipped an empty line: a status line at the top and a note for each line it is about, by line number and key name only.
- Asking for your keys while an edit is open opens that same tab again, applying a waiting save first, instead of replacing it with a new file.

### Fixed

- A save in an older edit tab, such as one an editor brought back, no longer wipes what was typed there. The tab is kept with its editor copies, says it was not saved and which lines differ, and is deleted at the first "done" after a command has shown it. The 30-minute close applies a waiting save first and keeps a tab whose last save was refused.

### Added

- Claude Code, outside a Toolkit gate run: the agent hook refuses a main-session subagent launch until the agent has loaded the `agent-cost-control` skill in this chat (the Toolkit helper presets need no skill read), then runs it with no prompt only when it is strictly cheaper than the agent starting it: a lower model family at any effort short of max, or the same family at a lower effort. Every other launch gets Claude Code's own permission prompt naming both routes: the same route, a costlier family or effort, any max effort, a fork, a launch that inherits the agent's model, and a route the hook cannot work out (including when the check itself fails).
- Claude Code, in a Toolkit gate run: a G0 or G1 lead may start any agent for separable work, not just the two Toolkit helpers, when it is strictly cheaper than the lead; the Toolkit helpers pass the same test after their file check. Anything else is refused with one line instead of asked, so an unattended gate never waits on an approval, and helpers still never start agents. A helper's own tool calls are no longer held to a stack helper effort.
- The hook test pack reads a third decision, `ask` (the host shows its permission prompt), so rows can expect it.

## 3.177.0 (env edit file is the only way to delete a key; Claude Code keeps agents out of the env edit folder)

### Changed

- `toolkit env edit` now applies each save exactly: a changed value is replaced, a new line is added and a deleted line removes its key on that save, with no question at "done". The file's `# Status:` line says which keys were removed, and "done" names any app entry that used one. A save that would remove every key is still refused; it now says to delete the last keys by hand in Windows Credential Manager.

### Removed

- `toolkit env remove NAME`. The edit file is the only way Toolkit deletes a key; no other command, and nothing else in Toolkit (setup, refresh, `remove toolkit`), deletes one. An edit opened by an earlier version that only marked deleted lines is applied from the file at "done".

### Fixed

- Tests can no longer reach the real key store: in a test run the store refuses the real `ai-agent-toolkit/env/` prefix before Windows PowerShell starts.
- **Merge card after a PC restart:** the owner's Claude Code chat, reopened by the app, keeps its merge card however many other sessions started on this computer meanwhile. Toolkit now keeps each session's start record for 30 days after the chat last started or was reopened (up to 4,096 records) instead of only the newest 256, and a compaction or clear no longer overwrites a record it briefly cannot read.
- **Exact reason when it cannot:** if any start of the chat found its start record missing or unreadable, the merge refusal and the typed-line note say so once the app reopens it, and name where to approve (a new chat on this computer, a direct Projects message, or the Merge button on GitHub). Before that, the standing task auto-merge note already warns.

### Added

- In Claude Code, a Toolkit hook refuses an agent's file reads, writes, searches and listings, and shell commands, that name the env edit folder, an edit file or the env folder as a whole, because the edit file holds your real key values. Reading the names-only manifest and running `toolkit env` commands still work.

## 3.176.0

### Added

- The controller enforcement map now also covers the gate rules, and each row carries the hash of its rule line: an edited controller or gate rule fails the map check until its row is reviewed and the hash updated.
- An instruction-only row now says its basis: judgement (no code can decide it), host-gap (the host lacks the event, with a line saying how to test for it now) or planned (with the slice that builds it). `--list host-gap` prints the host-gap rows for a hooks or setup review.

### Fixed

- Seven out-of-date reasons in the map: three rules a hook or script already enforces are now mapped to it, and four reasons now name the slice or host gap that applies.
- `toolkit governance check` no longer asks for a governed rules block back. Before governance is decided, a `TOOLKIT-GOVERNED-RULES` block (current, older or edited) or an older `GLOBAL-AGENTS.MD-TEMPLATE` block in `AGENTS.md` is now reported as a leftover copy that is not followed, with the cleanup offered once governance is on, instead of "refresh it to the TOOLKIT-GOVERNED-RULES block through a pull request" or "a refresh asks first". Broken markers are still reported.
- The disabled-governance rules line says any governed block in `AGENTS.md` is an old copy and is not followed.
- Playbooks and skills no longer point at Toolkit copies that plug and play removed from repositories. The safety-gates and git-completion playbooks name the evidence-store line of the Toolkit-governed rules instead of a managed `AGENTS.md`; the model-safety-flags playbook says to add an `Authorised context` section to the repository's own `AGENTS.md`; the controller bootstrap names the gate rules' fresh-context triggers; the secure CI/CD prompt points to the repository's own test-sharding guide; and the playbooks README says the plugin installs it, with no copy-by-hand step. A test keeps any skill from naming those old copies as live sources.
- Docs describe plug and play: a governed repository holds only its programme file, CI checks and dependency-update files, while the rules and playbooks come from the installed Toolkit; no doc says a governed rules block may still belong in `AGENTS.md`; the agent routing table lists `toolkit-playbooks`; the safety matrix names the cleanup route for leftover copies; and the source-of-truth contract says Toolkit's own skills ship in the plugin and are not for copying.
- Antigravity's docs say it gets only the portable skills copied into its skills folder for now: no plugin, hooks, Toolkit-only skills or governed rules.
- The real Codex host check in the bridge doc matches today's session start: no question about repository rules, and one leftover note for an old rules block.
- `release-readiness-audit` no longer asks for scope again when the request already gives a full read-only scope (the target, that nothing is changed, and what to report); it starts the audit.
- When the session-start governance check crashes inside a repository, Claude Code and Codex now get one line saying so, with the error's kind (never its message), the path of the Toolkit-governed rules file to read if the repository is governed, and `setup toolkit` to repair the plugin. Before, the session started with no rules and no notice. Outside a repository it still says nothing, and session start never blocks.
- The skill-routing source says governance comes from the installed Toolkit, never from a block in `AGENTS.md`.

### Changed

- The portable skills no longer name Toolkit terms or a coding app in their main instructions, so they read the same in any agent. App-specific and Toolkit-specific details moved to a reference file in each skill (`agent-cost-control`, `n8n-environment-setup`, `secure-ci-cd`, `windows-local-dev-services`), and the rest were reworded (`external-operation-preflight`, `frontend-art-direction`, `host-observability`, `managed-app-foundation-review`, `n8n-workflow-transport`, `release-readiness-audit`, `skill-product-review`). The Hostinger maintainer skill keeps its Codex name, now recorded as an app it depends on.
- `agent-cost-control` calls the planning, build and review sessions by those names and a merge train a batch merge; they stay outside the model ladder as before.

## 3.175.0 (A turn-end owed check for the controller in Claude Code)

### Added

- **Owed check at turn end (Claude Code).** A second turn-end hook, `toolkit-owed-check-hook.cjs`, stops the controller's turn once with the exact steps when the turn leaves owed work: programme findings new for 4 hours or more, or acknowledged past their due time; open `CLOSE_DUE` findings; side sessions the desktop app shows finished but not archived (every pull request merged or closed, not running, nothing waiting on the owner); gate launches from the last 24 hours with no `gate-session` record; and archived gate sessions with no close record. It reads only local files (no git, gh or network call) and stops a turn again only when an entry is added. It stays silent in gate, helper and side sessions, in sessions that did not act as the controller, outside governed repositories and when the host says the stop already follows a hook block. A missing cache, an unreadable transcript or desktop session files in an unknown format become one note, shown once, never a block. Codex keeps the single turn-end hook.
- **Net findings in the attention cache.** `programme.cjs attention` and `refresh` write the open net findings (ID, code, task, kind, state and times; no free text) into this computer's attention cache, which the owed check reads. The owed check starts `programme.cjs refresh` in the background when the cache is missing or over an hour old (at most once per 15 minutes per repository, never in a cloud session).
- **Hook pack.** Rows can use the `Stop` event, and fixtures can plant attention-cache findings (`attention_net`) and desktop session files (`desktop_sessions`).
- In Claude Code, a question card is refused when the agent already wrote text earlier in the same turn, since the desktop app shows only the open card and hides that text, and when a card's question is longer than 120 characters. The refusal tells the agent to ask in its closing message instead, or to put the context into the card's option descriptions. Toolkit's own governance and merge cards are not affected, and a card is shown with a note when the session's transcript cannot be read.
- `agent-cost-control` has a "Before you start a subagent" section, read once per chat before any subagent, helper agent or spawned thread: start one only for separable work that saves time or context, set the cheapest tier and effort on the launch, brief it with the data it needs, and get approval first for anything not cheaper than yourself (the same route, a higher tier or effort, any maximum effort, or a launch that inherits your route). A default helper ladder: the small tier for lookups and inventories, the mid tier for bounded code, tests and long summaries, never the top tier as a helper. A subagent that starts another applies the same test against its own route.

### Removed

- **Session start shows the governance status only.** The session-start hook no longer prints the attention line, the stale-check line or the cloud "attention and stale check wait" line, and starts no background refresh or stale check; due programme work reaches the controller at turn end. Checkpoint and stale-copy lines stay.
- **The daily stale check is gone.** `toolkit-controller-check.cjs` has no `stale` check, its date stamp (`~/.ai-agent-toolkit/user-state/stale-check/`) is no longer written or read, and the session-start command line for it is gone; the programme sweep raises the same rows as stale-work net findings. `--skip stale` is still accepted and does nothing, for Claude Projects task prompts stored before this change. An existing `stale-check` folder is left on disk unread and can be deleted by hand.
- **The attention cache holds only the net findings.** Its line, counts, digest, work-queue summary and shown-digest fields are gone (schema v2); a cache an earlier Toolkit wrote is not read and is rewritten by the next refresh.

### Changed

- Setup's check of the installed Claude Code hooks now expects exactly two turn-end hooks, the programme checkpoint then the owed check.
- The controller principle **Stale check** is now **Stale-work net**: the sweep raises the rows and the turn-end owed check brings them to the controller. The Claude Projects hourly nudge and daily check-in no longer pass `stale` to the controller check.
- A cloud session that cannot reach the programme store now says the next refresh on the owner's computer reads it.

### Fixed

- Commands typed through the Claude desktop app's Terminal panel now get the same checks as the Bash tool: a merge without the owner's approval, a chat launched to merge, a push to the default branch and a write to Toolkit's user-state folder are refused there too. Terminal panel and Monitor commands also get the AI attribution, force-push and credential checks. A test fails CI when a tool that runs a command line misses any of these checks.

## 3.174.0 (lane waits removed; one ordered work queue on the programme graph; one-task catalogue patches)

### Removed

- Lane waits: a blocker starting `Queued in NOW:` is no longer special. `assign`, `reopen` and a consume `REOPEN` keep every blocker, results no longer carry `dropped_lane_waits`, child writes no longer stamp `private.lane_wait`, and the `QUEUED_BUT_MOVING` work-queue finding and the PR head commit time it read are gone. A task waiting only for a free lane stays planned in the queue with no blocker.
- A parent that still stores a `QUEUED_BUT_MOVING` finding reads, never counts it as open, and drops it on its next write; a stored `private.lane_wait` stamp still reads, and the controller's one clean-up order removes it with the old blockers.
- The `LATER` band, the `BATCH_NEXT` work-queue finding and its timers. A parent that still stores a `BATCH_NEXT` finding reads, never counts it as open, and drops it on its next write; old `LATER` and `OPTIONAL` archive parts stay registered and are redrawn empty.

### Changed

- The programme graph has one queue: tasks in flight keep their bands on top (`NOW · IN PROGRESS`, `NOW · AGENT UAT`, `NOW · CLOSE CHECK`), and every other open task is `QUEUED`, sorted on every pass in work order: priority, then quick wins, then all other work, then tasks marked last (`last` or optional). A blocked task keeps its place in the queue with its blocker in Waiting on.
- CURRENT lists only tasks in flight; queued tasks, blocked or not, are in the graph's queue and still count in `Holds`.
- Native sub-issues follow the same order, and graph archive parts use the `QUEUED` group.
- A parent patch changes the catalogue with exactly one of `outcomes`, `outcome` or `move`; an unknown task (`OUTCOME_UNKNOWN`), an unknown field or a move after itself is refused and writes nothing. The reconciler skill says to write holder orders as compact JSON.
- **Shorter "Nothing to answer here" list:** what the merged programme file sets is one line (for example "Set in .github/toolkit-programme.json: evidence store owner/TRANSPORT-name, the parent issue, required check validate, merge trains on"), with how to change it said once. The other rows are one short line each: parallel CI shards already in your CI name the workflow, up-to-date permissions say only "Up to date", and a set-up governance App says to type "explain 1.1", which now holds the steps to stop using it.
- **Setup's AGENTS.md question says it covers every repository:** the Claude Code setting row now reads "Read AGENTS.md (in all local repos) too?", so it no longer looks like a choice for one repository. What it does is unchanged.

### Added

- Optional work-order fields on the parent's task list: `priority` (`P0` or `P1`), `size` (`S`, `M` or `L`, the controller's judgement after evaluating a task) and `after` (tasks this one waits for). A task waiting on a queued task moves to just after it; a loop raises the report-only `DEPENDENCY_CYCLE` and keeps its place.
- `programme.cjs show --queue` prints, read-only, each queued task's place, step and why.
- `update-parent` takes a one-task catalogue patch: `{"outcome": {"issue": n, ...}}` sets `name`, `description`, `order`, `last`, `priority`, `size` or `after` on that task (`null` removes an optional field), and `{"move": {"issue": n, "after": m}}` slots task n right after m in the hand order, renumbering only the tasks after the slot. Every other task stays byte-identical, so a holder order no longer resends the whole catalogue.

### Fixed

- **Governance bank shows the real merged values:** every row of `toolkit governance` that shows what the merged programme file sets now comes from one read of this computer's copy of it. Before, another session's failed read of GitHub could mark that copy stale between two reads, and the bank then showed "Merge trains: Off. Bound in the merged programme file" for a file that has them on; task auto-merge could show Off the same way. When the read the bank uses is stale, the line now says GitHub could not be read just now, why, and that these are the values this computer last read. With no programme file read at all, the bank shows no values and says so.
- **The governance question offers only yes, no or later:** the question in a repository with no decision yet, the status line and the how-to guide no longer pass the enable and disable commands on to the owner. Agents still recognise those commands as answers and are told never to show them. A reply that is not an answer is no longer quoted back: the agent says at most, in plain words, that no governance answer was recorded.
- **One ask when the first message asks for the bank:** `refresh governance` (or `toolkit governance`) as a chat's first message in a repository with no decision yet no longer also shows the session question or its card; the bank is the one ask.
- **No bank from an unreadable GitHub:** where GitHub could not be read, so Toolkit cannot tell whether governance is decided, the bank reads once more and then says to type it again in a moment, instead of showing "GitHub governance: undefined" and a turn-on row. A failed read of the store and parent issue is one plain line, without Toolkit's internal note.
- **Plainer bank lines:** how to keep governance off is said once ("To keep governance off instead, reply no store: Toolkit then makes nothing and asks again next session"), and the governance App line says why the owner runs its command: the setup refuses to run under an agent, so the App's private key never passes through one.
- **Governance App setup is one line to paste:** the bank's answer, a published turn-on and the governance check now give the owner one line to paste into PowerShell, with the repository and its evidence store filled in, and say what follows: Enter when it asks, then Create and Install on GitHub. The six-step guide by hand (a pre-filled page, copying the Client ID, a key file, saving both on GitHub's website) is gone for a new App; repairing a part setup keeps its steps.

## 3.173.0 (A close-due finding for each finished gate session; One stale-work net in the programme sweep; The worktree residue report finishes on large checkouts and checks one worktree; Projects skill card only on real text changes)

### Added

- **Gate sessions are recorded.** `assign` and `reopen` open an entry for each new gate assignment in the task's private state, and the controller records the gate's host session right after the launch with `programme.cjs gate-session --issue <n> --assignment <id> --host <host> [--host-session <id>]`, then its close with `gate-session --closed`. Each host's value and where its session ID comes from are in the host contract (section 10). The command refuses the parent's holder, its earlier holders and the calling session's own desktop ID. Holder orders can carry `gate-session`.
- **`CLOSE_DUE`.** The sweep raises one finding per finished gate assignment whose session is still open: no longer the live assignment and, for a G1, every PR it returned merged or closed with no UAT owed there (or the agent's UAT handed on). It is part of the stale-work net, is never disposed and is acknowledged for at most 72 hours. It resolves once the close is recorded. `programme.cjs attention` shows the host and session beside it; the session ID stays in private state and never reaches a page, a finding detail or the session-start cache.
- **The stale-work net.** The programme sweep now raises the stale check's rows as attention findings, with the usual life (new, acknowledged with a due time, overdue): `OWNER_OK_CLOSE` for a task whose PR merged, whose agent UAT passed and with no gate open and every DONE WHEN row ticked, so only the owner's OK to close is left; `CHILD_NO_NEAREST` for a task opened in the last 7 days with no `Nearest child:` line; `POLISH_CAP` for a polish task at 8 rows or more, or while two are open; and `ROWS_UNTICKED` for a task with a merged PR while none of its DONE WHEN or ROWS checkboxes is ticked. A merged task's `READY_TO_CLOSE` and `TASK_MERGED_OPEN` details say how many DONE WHEN rows are still unchecked.
- **Net findings cannot hang.** Each finding code says whether it is part of the net, its longest acknowledgement and whether it may be disposed. `OWNER_OK_CLOSE` and `POLISH_CAP` are never disposed (`FINDING_NO_DISPOSE` names the routes that clear them), and an acknowledgement past a code's cap is refused with that cap named.
- **The 4-hour callout.** `programme.cjs attention` lists the net findings nobody answered for 4 hours (new for 4 hours, or acknowledged past their due time) first, under `Unanswered over 4 h (<n>)`; `--json` adds `callout`.
- **One worktree at a time.** `workspace-residue-report.cjs --worktree <path>` checks only that worktree and, when it is ready to remove, prints the safe lines to run (`git worktree remove <path>`, then `git branch -d <branch>` when its branch is merged, is not a default branch and no other worktree holds it); otherwise it says why it is not ready. `--json` adds `remove_commands`. It never offers `--force` or `-D`, and host-made worktrees are still left to the host.
- **Age.** Each worktree reports `age_hours`, and `--min-age-hours <n>` keeps a worktree made more recently than that out of the ready list.
- `toolkit-projects-guidebook.cjs --card` prints one line on the owner's saved claude.ai copy of the Projects skill: `SKILL CARD OUTDATED: saved <old>, main <new>, text <fingerprint>`, `SKILL CARD CURRENT` or `SKILL CARD NOT SEEN`. It compares the text, leaving out the Version line, line endings and trailing whitespace, so a release that only restamps the Version line offers no card, and a declined card is remembered by its text fingerprint.
- `toolkit-projects-guidebook.cjs --refresh <folder>`, the hourly nudge's every-run guidebook refresh: it refuses a clone that is not origin's main tip (`SKILL COPY FAILED STALE_CHECKOUT`), then prints `GUIDEBOOK CURRENT` or `GUIDEBOOK REFRESHED <old> -> <new>`.

### Changed

- The controller principle **Close what you spawn** asks for each gate's session to be recorded at launch and its close when closed, and the enforcement map now names the sweep as its check for gate assignments.
- Update Toolkit on every computer that runs the sweep: an older Toolkit holds on a parent document carrying `CLOSE_DUE` (`attention[n].code is not a known finding code`) until it is updated.
- `BODY_OVER_BUDGET` is raised only when a page is 5 per cent or more over its budget (500 characters for the parent, 200 for a task, 150 for a pull request), so a page a few characters over raises nothing.
- `CLOSED_WITHOUT_ACCEPTANCE` is no longer raised for a task closed as completed that has its closing story after the close.
- Update Toolkit on every computer that runs the sweep: an older Toolkit holds on a parent document carrying the new finding codes (`attention[n].code is not a known finding code`) until it is updated.
- The report has a time budget (`--budget-ms`, default 60 seconds): worktrees it did not reach are listed as not checked, the report says it stopped, and `--json` carries `complete`. In text mode each worktree line is printed as soon as it is checked, so a checkout with many worktrees shows progress at once.
- Setup and the Claude Code session start offer the Projects skill update card only when the saved text really differs; a Version-only difference says the copy matches Toolkit's text. Where the session has no `propose_skills` tool, the line says so plainly and nothing is asked.
- The hourly nudge deletes any old Toolkit clone before cloning, runs the guidebook refresh and the skill card check every run, and deletes the clone at the end. The daily check-in uses the scripted card line instead of comparing Version lines by hand.
- The guidebook refresh no longer reports `BLOCK CHANGED`, and the project-instructions check no longer reports the block outdated, when only the block's marker version or digest moved, so an identical block is not re-applied every release.
- The Projects coordinator no longer watches Toolkit features to suggest improvements or settings to the owner; it still never changes Toolkit features or their settings itself.

## 3.172.0

### Changed

- **Work starts on the owner's computer:** every controller, cloud or local, now starts its sessions, lanes, gate runs and threads on the owner's computer. A cloud start needs the owner to start it or agree to it in chat. When the computer is busy or away, the work waits and the controller says so in one line; nothing falls back to the cloud. Scheduled tasks that already run in the cloud are unchanged.
- **Projects runs local first:** the Projects skill's "Cloud first" rule is now "Local first", new projects get `remote_control` as their gate placement, and the managed project instructions say the same. Steps only a cloud thread can do (the guidebook copy into the project library, its after-merge fast refresh) ask the user first; the hourly nudge still refreshes the copy on its own.
- **Device evidence:** a local Remote Control thread archives its evidence to the transport store itself, and uses the shared folder only when it cannot reach the store.
- The leftover scan and the session-start check name an older `N8N-AGENT-RULES-ADAPTER` block in `AGENTS.md` as a leftover in every governance state; where governance is on, governance cleanup removes it with the other Toolkit copies.

### Removed

- The n8n block Toolkit could add to a repository's `AGENTS.md` is retired, with its installer and its Claude and Gemini snippet copies: the global rules that setup installs carry the n8n Safety Router section in every session, so a repository needs no copy.

### Fixed

- A programme refresh on a computer leaves the sweep lease to a cloud Programme Sweep that is queued or running its refresh job, and says "The cloud sweep picks this up". Back-to-back refreshes after the controller's own writes, each capped at 300 requests, used to re-take the lease within seconds, so the cloud's full-budget pass never ran and new pull requests were missing from task graphs. When GitHub cannot say whether a cloud sweep runs, the refresh runs as usual and says so in one line.
- The programme sweep after a merge refreshes the board again. A pass whose lease release met a race on the evidence store branch used to drop the release without a word, so the lease stayed live for up to twenty minutes and every sweep started for the next merge logged "queued" and ended green with nothing refreshed. The release now reads again and tries up to three times, with a short pause before each new try; one that never lands puts a "lease not released" warning in the run log, and the next sweep reports that pass as stopped. A failed pass still names its own stop code when that warning comes first.
- A cloud sweep that meets another sweep's lease waits for it, checking every minute for up to 30 minutes, then runs its pass with the time left. A run that never gets the lease fails instead of ending green, and starts one more run at once.
- `toolkit governance status` reads the merged binding once more with a longer budget when the first read ran out of time, so one slow fetch of a large default branch no longer holds every programme command.

## 3.171.0

### Added

- **Remove Toolkit:** `remove toolkit` now also removes Codex setup's journal once its last step finished (an unfinished one stays as recovery evidence) and the update reports the bridge writes to the temp folder, once no Toolkit plugin is installed.

### Changed

- **Remove Toolkit:** the Claude Code settings setup turned on are listed as Claude Code's own settings, left exactly as they are, and the recovery records folder is kept as evidence instead of being called someone else's file. Removal never deletes a key from the credential store and has no step for other plugins.
- **n8n skills:** setup only copies the official n8n skills; it no longer turns the n8n Skills plugin off in Claude Code or tells you to turn it off in Codex.
- **Governance check:** no message or document tells you to type `toolkit governance check` any more. Owner-facing steps say to ask your agent to check governance; agent and workflow text names the script, `toolkit-governance.cjs check`.
- **Repository files:** `repository-agent-rules` expects the one-line `@AGENTS.md` CLAUDE.md only where Claude Code would otherwise miss AGENTS.md: the repository has its own CLAUDE.md and the "Read AGENTS.md as well as CLAUDE.md" setting is off.

### Fixed

- The programme sweep now resolves a merged or closed pull request's over-budget page finding on its next complete pass. Such a pull request keeps the body it was approved with, so its finding no longer needs a dispose by hand. Open pull requests and task pages still count.
- The background stale check now runs only when the binding merged on origin's default branch has governance on, the same binding the session-start hook reads before it starts the check. Before, a worktree made before governance was turned on skipped the check with no stamp, and the hook started it again every 15 minutes.
- A cloud session that has an attention cache but no stale-check stamp for today now says the stale check waits for the owner's computer. Before, it said nothing about it.
- The controller handoff snapshot now refuses a source file holding a NUL byte, as the store's save does, and the handoff hook starts no refresh for it. Before, every refresh wrote the file, stopped at the save and undid the write, so `--check` stayed STALE.
- The handoff snapshot README now gives a successor a reading order: `MEMORY.md` first when the snapshot holds one, then the saved instructions, then the named working files.

### Tests

- New handoff tests cover the dot-name skip, the 5 MB cap, the undo removing a created file, `--check` with a named memory folder and Windows network-share paths.
- A new hook pack row checks that a scheduled task's `touch ~/.toolkit-handoff-off` passes every guard on both hosts.
- A new hook pack row checks that a memory file saved with a NUL byte starts no handoff refresh.

## 3.170.0 (merge approvals in a reopened chat)

### Added

- **Reopened chats approve merges:** in Claude Code on this computer, a chat the user started and the app later reopened on the same session takes a typed `merge N` and a tap on the merge card again, as a fresh chat does. Launched, forked and shell-resumed chats, a resume that carried the host-session variable, Codex or unknown-app reconnects and resumed cloud sessions still record nothing. The host now comes from the hook entry point, never from a field in the event.
- **No planted merge lines:** a session brief, a message to another session, a move to the cloud, a scheduled wakeup, a cron prompt, a remote routine or a scheduled task whose text holds a line Toolkit would read as the user's merge approval is refused, so an agent cannot approve a merge by writing the user's line into another chat. A side chat the user opens and types into still counts as theirs.

### Changed

- **Honest refusals:** when a chat cannot record a typed merge approval, the hook says so on the message that held it, with the reason and where to approve instead (a new chat, a direct Projects message or the Merge button on GitHub), and the merge refusal in that chat no longer asks the user to type the line again there.

## 3.169.0

### Changed

- **Handoff snapshot mirrors the memory folder, deletes included:** a memory file deleted on this computer now leaves the controller handoff snapshot (`toolkit-store.cjs handoff`): its row becomes a removed row with the time it was removed, and its copy leaves the store's current files (Git history keeps it; the snapshot README says how to get it back). A file is removed only when this computer's last saved run (its folder record, kept in the Toolkit user-state folder) or the session's baseline held exactly the snapshot's content, so a stale, partial or other computer's copy never deletes a newer save. A removed file comes back only from different content saved more than 5 minutes after the removal, so a session still holding the old copy no longer brings it back. A clock behind the snapshot removes nothing (`clock=behind`).
- **A computer changes only memory it has seen:** a run updates a stored memory file only when this computer's last saved run or this session held exactly the stored content. Otherwise the stored copy stays and the run and `--check` name it as `diverged=<files>`, so a second computer that has not synced can add new memory files but never replace or remove one. A manual `--reseed` run takes this copy for the diverged files; the after-tool hook never does.
- **Two computers saving at once:** when a handoff save meets a store another computer just saved to, the merge keeps the store's snapshot folder whole (never one computer's manifest beside the other's files) and the run plans once more from it, so neither computer's save is lost or deleted and the store checkout keeps working. A snapshot copy that no row lists is removed only by a computer that held it, or by `--replace-memory`.
- **Store deletions:** the store command still refuses every deletion, except the handoff snapshot's own removals of memory files its manifest lists as removed in the same commit.
- **Manifest version 2:** the snapshot manifest is `toolkit.handoff-snapshot.v2` (adds the removed rows). This copy reads version 1 and writes version 2 on the next change; an older Toolkit copy reads version 2 as no snapshot.

### Added

- **`handoff --confirm-removals`:** a run that would remove more than max(10, a fifth of the memory rows) holds them and says `held_removals=<n>`; a manual run with this flag applies them.
- **`handoff --memory <folder> --replace-memory`:** a manual run that makes the named folder the whole memory set: every memory row it lacks is removed and its copy of every other memory file wins.
- **`handoff --check` fields:** `removed=`, `held_removals=`, `clock=behind`, `removed_here=` (removed files this copy holds with different content) and `diverged=` (memory files this computer never held at the stored content) and `unlisted=` (snapshot copies no row lists that this computer never held). A run whose save lost a race says `took_store=<folder>`.

## 3.168.0 (Governance asks two questions; Gate endings that can always be recorded)

### Changed

- The governance question bank now asks at most two questions: GitHub governance (on or off) and task auto-merge. Everything else is a Toolkit default shown as a status line under the table, which any answer applies: parallel CI shards when the last green CI run took 10 minutes or more (none for faster or unknown CI, and none where CI already runs its tests in parallel), the governance App and Toolkit permissions commands when they are needed, and the instruction copies cleanup while governance stays on. Merge trains are no longer asked; turning governance on writes them off, and a governed repository keeps its stored value.
- Where governance is not decided yet, the answer itself turns it on, so the governance row is a status line and only task auto-merge is asked. Reply `no store` to keep governance off: nothing is written and Toolkit asks again next session.
- Add `shards=yes`, `shards=not-now` or `shards=never` to a reply to change the shards default, and `store=<owner/name>` to use another private repository of yours as the evidence store.
- Turning governance on uses this repository's own private `TRANSPORT-<repository name>` store, found or created, and never another repository's store unless you name it. The session-start question and the turn-on result name the store.
- `toolkit governance migrate` asks one Enter for all of its GitHub changes (the no-force-push ruleset, the programme-state ruleset and default-branch protection) instead of one each, and a no writes none of them.
- An answer to a bank whose status lines changed since it was shown is refused, so an answer never applies a default you did not see.
- Question cards: a host may show only the card while it is open, not the text written above it, so a card's question and options now make sense on their own, and a question that needs explaining ends the closing message as written text instead of sitting below a hidden explanation (global rules, controller principles, takeover playbook). Standing permission asks follow suit: outside Claude Projects the whole ask, its scope lines and then the question, goes as written text at the end of the closing message (safety-gates playbook).
- A lane wait is now only a blocker starting `Queued in NOW:`. Other blockers that start with `Queued`, such as a queue label `Queued 1 - after Alpha2`, are real blocks that `assign`, `reopen` and a consume send-back keep. Older lane waits in another form are not matched: rewrite each to the new form or keep it as a real blocker.
- The reconciler's Gates rule now says a G2 recheck is a `reopen` only with no G1 round between; after a G1 round it is `assign --supersede`.

### Fixed

- A finish mark whose governance turn-on pull request was closed without merging is cleared instead of waiting for ever.
- The bank heading says "1 question across 1 section" instead of "1 questions across 1 sections".
- The Claude Code setup question says how many settings a yes would set, so it reads on its own on a question card.
- A piped setup reply with a second non-empty line is refused before anything is written.
- A no to the Claude Code setup question says when setup had already updated the Toolkit checkout before asking.
- Setup reads the AGENTS.md memory setting under either plugin name, writes the older name when it cannot tell the Claude Code version, and keeps a value you set under the other name.
- **Projects ping transition:** a task still on an old pointer now posts a line that tells the coordinator to refresh a guidebook copy from before pings first and to take that run's project additions from the stored prompt until the swap; its TASKS OUTDATED prefix comes after any COORDINATOR BEHIND prefix. Swapped pings are unchanged.
- **Projects checklist wording:** the hourly nudge clones Toolkit in step 4a, where it is first used; tool threads are read-only apart from the guidebook copy refresh and the programme sweep; a fresh-fallback task's tool steps go to a thread that has the tools; the daily check-in's setup step reads the coordinator's own model and effort; and the recurring-tasks reference no longer calls Toolkit tasks pointers.
- **Projects tier-gap check:** when a task's tool steps run in another thread, the daily check-in lists its model and effort as unverified and names that thread, instead of leaving it unverified with no reason.
- A G2 return is accepted only when the task PR carries a `Toolkit-G2: PASS` verdict for the return's head from an account that can write to the repository, read with the merge train finder's own parser and trust rule. The accept records that PASS in the task's review in the same write; a FAIL at that head allows only a send-back, which records it as not passed. Before, a G2 could be accepted with no verdict at all.
- A G2 accept closes the builder's older return in the same write (accepted when it was at the passed head, sent back otherwise), so it no longer stays open for good after the G2's supersede.

### Added

- **Global rules, open a given link yourself:** the accuracy principle now says to open and inspect a link you are given directly (for a PR: metadata, files, diff, checks, comments and review threads) and to say what you did not inspect. It joins the existing line, so the installed rules gain no line; the global block cap rises to 22,014 bytes for it.
- After the owner answers a gate question, the controller records the answer on the same return: `return --consume <id> --verdict ACCEPT|REOPEN --reason <the answer>` works once on the newest return consumed `WAITING_OWNER`, while the gate still waits at the same epoch and assignment. Before, the only way out was a reopen and a new return ID. A holder order's `return` write takes the same `reason`.
- Every consumed return is logged with its time in the task's gate trail (`private.gate_history`), so a later check can tell when a plan was accepted.

## 3.167.1

### Fixed

- **The test duration check says when a failed-only rerun cannot help.** When CI fails a test file over its time budget and that file's newest time comes from a shard of the same run that passed in an earlier attempt, the failure line now adds which attempt and shard measured it, that the shard was not run again, and that a failed-only rerun reads the same time, so rerun all jobs. A light run's time keeps the plain line, since a light run reuses an earlier run's test results and rerunning it reuses them again. A failed shard's time keeps it too, since any rerun, failed-only included, runs that shard and measures it again. Each CI shard summary now records the run that measured it for this. Exit codes and checks are unchanged.

## 3.167.0 (One approval question for Claude Code setup)

### Added

- Claude Code setup now asks one question, `Apply these defaults?`, over a table per section that shows each setting's current value, what setup applies and the other choices. A yes applies the Toolkit default only to settings that have no value yet; a setting that already has a value, including one you turned off, keeps it. A reply such as `3.5=off` changes just that setting, and a setting you do not list keeps its current value unless you also say yes. A no writes nothing.
- An off you choose for a Claude Code setting (attribution, cross-session messages, reading AGENTS.md) or for the Antigravity skills copy is recorded, so later setups and refreshes keep it off without asking.
- The AGENTS.md setting goes where the running Claude Code reads it: `cc-plugin-agents-md@builtin` on 2.1.285 and later, `agents-md@builtin` on 2.1.277 to 2.1.284, and nowhere on older versions, which setup says.
- The setup skill now keeps the rule for relaying the question bank as its own short section.
- The stale check flags a child whose page shows a merged PR while none of its DONE WHEN or ROWS checkboxes is ticked, as an `UNTICKED?` row. The row shows once for each new merged PR; on later days the child is named on the `held, not proposed` line until a row is ticked. It reads only checkbox rows under those headings (fenced code and HTML comments hold none) and only merged rows of the PR GRAPH the sweep draws.
- The session-start stale-check line counts `KEPT OPEN?` and `UNTICKED?` rows by kind.

### Fixed

- A Claude Code refresh asks the question again when a setting still has no value, and stays silent otherwise.
- Setup saves the answers refresh compares with only after they are applied, so a run that stopped to rerun the updated setup no longer leaves a later refresh silent with nothing applied.
- On Claude Code, an empty reply to the approval question stops setup with the "requires an answer" message instead of asking again forever.
- The first per-repository stale-check stamp write removes the old shared `user-state/stale-sweep.json`. A test now pins that the stamp is written to a temporary file and renamed, and a dead comment and test about the old shared stamp are gone.

### Changed

- The task status `MERGED · awaiting proof` is now `NOW · CLOSE CHECK`, so the board says the controller's close check is next (judge DONE WHEN against what merged, then close the task, plan its next slice or queue it again). It keeps its place in the NOW band and its one-hour `TASK_MERGED_OPEN` alarm, and CURRENT reads `merged, close check`. `NOW · AGENT UAT` still marks a recorded test the agent owes.
- The full bridge test suite is split by area into `toolkit-local-bridge.test.cjs`, `toolkit-local-bridge-repo-update.test.cjs` and `toolkit-local-bridge-hook-update.test.cjs`, so each file runs well inside the per-file time budget.

- A merged child kept open on purpose (`Kept open:`) is no longer skipped for ever: once no lane, holder, write or comment has touched it for six hours, the sweep raises `TASK_MERGED_OPEN` again, saying it was kept open, and the stale check shows it as a `KEPT OPEN?` row. A longer planned wait is a dispose with a reason, which holds while the child stays still.
- In a cloud session, an evidence store that answers 401, 403 or 404 now says it is not reachable from that session and that the check waits for the owner's computer, instead of advising a different store.

## 3.166.0 (handoff snapshot review fixes; polish bundle 2)

### Added

- `toolkit-store.cjs handoff --check` names `unsure=<files>`: files this copy holds differently from a snapshot row written before rows carried a time, whose order nobody knows (this copy may hold a save the snapshot missed, or be older). It says `STALE` for them instead of `CURRENT`. `handoff --reseed`, run only from the newest copy, takes this copy for those files; hook-started runs still never decide that order themselves. A row whose time came from its snapshot is marked `modified_from: "snapshot"`, so later checks still know.

### Fixed

- The handoff hook's first check in a session only notes what the session holds and never starts a refresh; the next check, at least a minute later, decides. A scheduled task whose first tool call comes before the one that turns the hook off no longer starts one refresh.
- A memory folder that is there but empty (a re-sync that cleared it, an empty mount point) counts as unreachable, so a hook-started run keeps its rows instead of dropping them all.
- A hook-started run judges a memory row by the memory folder it names now, so rows first written under an older folder path are kept when the folder cannot be reached.
- **A stopped check says why on its controller check row.** A check that stops with nothing on its output, such as a handoff `--check` that cannot read the snapshot, now shows its `Stopped:` line instead of a bare ATTENTION row.
- **The PR body pre-flight reads the programme file as the sweep does.** A repository whose `.github/toolkit-programme.json` turns governance off no longer gets the page budget, and the success line names only the checks that ran there.
- **The governance App `--save` says when it could not read back.** When the names cannot be read again after the Enter, the stop says so instead of saying the repository changed; nothing is saved either way.
- **Remove takes the update lock and moving marker too.** `update.lock` and `update.tree-moving` are removed with the rest of Toolkit's own files instead of being kept as "not a Toolkit file".
- **Owner closes wait for every open gate.** A task whose gate is submitted, interrupted or waiting on the owner is no longer offered to the owner as a close (`gate_live` counts every gate state but retired).
- **The parent state schema knows every finding code.** `AGENT_UAT_UNSTARTED` and `QUEUED_BUT_MOVING` are in its code list, and a test keeps the list in step with the code.

### Changed

- **A hand-made task's refresh refusal says what to save.** The refusal and the recurring-tasks reference say to write the task's project lines word for word in `project-additions.md`, or the line `- none` when it has none.
- **Gate rules: agent UAT start.** A landed PR's owed agent UAT starts at once, and an `OWNER_TEST_NEEDED` PR still needs its `Agent UAT: PASSED` line before merge.
- **Agent UAT lane check:** a UAT with no head is never flagged, and each of the lane check's paths has its own test.

## 3.165.0 (stale check from the session-start hook)

### Changed

- The stale check (missed closes, duplicate children, closed children holding open work, a full polish child) now runs from the governance session-start hook instead of the Claude Projects daily check-in. Where governance is on, a session start shows one `Stale check` line for the controller when there are rows to answer, starts the check in the background at most once a day per repository, and says which read failed when the check keeps failing. A day with nothing to answer shows nothing.
- The stale check's rows are for the controller: it closes children it judges done itself, and puts a close that needs the owner's OK (an `OWNER OK?` row after agent UAT passed, a duplicate or an obsolete child) in its next ask to the owner. The `CLOSE LIST` owner post and its empty-day line are gone.
- A child whose gate is still live (at work on a task waiting on the owner, or blocked) is never offered to the owner to close: programme owner waits now carry `gate_live`, and only a wait with no live gate becomes an `OWNER OK?` row.
- A cloud session never reads the programme store at session start. Inside a governed repository it shows the attention and stale-check lines from its own cache, or else says plainly that both run at the next session start on the owner's computer.
- The Projects daily check-in no longer runs the stale sweep, and no longer posts a "nothing changed" line to the owner: a quiet run posts nothing, and the hourly nudge still catches a missed run.
- The stale check's `--stale-stamp` option is gone: each repository now keeps its own stamp. A Projects daily check-in armed before this change stops with "unknown argument" until it is armed again.

## 3.164.1 (polish bundle)

### Fixed

- **Remove toolkit takes the update records too.** `remote-check.json`, `update.readers/`, `agent-rules-notices.json` and `hook-skips.json` are now removed with the rest of Toolkit's own files instead of being kept as "not a Toolkit file".
- **Setup moves the managed checkout under the update guard.** Setup's switch and fast-forward hold the same moving marker as the bridge, so a session-start hook never loads half-moved files; a reader still reading after 15 seconds stops setup with nothing moved.
- **A held-off update is one plain line.** An update another session start held off for the whole wait no longer reads as a failure or opens an update report; it runs at the next session start.
- **A paste marker split across two reads is found.** The owner's Enter prompt keeps the last few characters read, so a split end marker no longer holds the prompt until Ctrl+C, and a split start marker no longer lets an Enter inside a paste confirm.
- **Setup reports terminal answers truly.** "Question answers prompted interactively" now says yes when the owner answered at the terminal, also after the RAM Enter prompt.
- **The governance App `--save` checks again after the Enter.** A variable or secret that appeared on the repository while the prompt was open stops the save with nothing written.
- **Projects run check is fast and reads ISO times.** The check stops at the first fire after a stamp (60 old runs went from about 36 seconds to under 0.1), and ISO run times match their receipts instead of reading as orphan and pending.
- **Agent UAT records name the owed head.** A write that records the agent's UAT at another head than the owed UAT is refused, naming both heads.

### Changed

- **Server monitor alerts start with "Server monitor".** Alert and test titles read `Server monitor <label>: ...` instead of `host-observability <label>: ...`, and email subjects take an optional prefix only when one is set. The set-up steps say to copy the skill folder whole, and the Healthchecks.io line says its Telegram alarms come from its own bot.
- **Plainer rules.** The global question rule ends "Failing that, ask in one fully bold sentence."; the root-cause principle reads "make it at the shared source every copy, prompt and later run inherits"; the Secure CI/CD reference keeps the merge-guard condition; the delivery doc describes the stale sweep's `JUDGE?`, `FOLD?` and `MOVE?` rows.
- **The PR body pre-flight checks size and the bump level.** In a governed repository a body at or over the 3,000-character pull request page budget is a problem to fix, and in the Toolkit repository `Bump: patch` beside a changelog fragment with an Added section prints a note.
- **A refused Projects task refresh says why,** and a hand-made Toolkit task prompt refreshes only once its project lines are saved.
- **The Claude app chat's refresh ask is softer** on a computer whose own sessions still keep Toolkit current, and the Bridge doc no longer states an unmeasured spinner display.

## 3.164.0

### Added

- Controllers now tell the owner what they need (their steps, real problems and outcomes worth knowing) and leave out the working detail of gate runs and other spawned work, with a short bold-labelled status when nothing needs them. Ask cards carry only the short question and options, with the context above. The rule lives once on the controller principles page, every controller re-reads it before an owner post, and the copies elsewhere now point to it. Spawned sessions keep writing full reports.
- Claude Projects folds its information-only notices (a binding change, missing or outdated project tasks, a nudge switch, a schedule fix, a rebuilt task) into the next status instead of a separate owner message.

## 3.163.2

### Fixed

- The controller handoff snapshot now follows memory saves made by any tool. The after-tool hook compares the snapshot's remembered sources with what the session holds after any tool call but a read-only one, so a host memory tool, a shell edit or a tool it has never seen all count, and a change inside the 10-minute window is picked up by the next call after it.
- The handoff refresh never runs in a scheduled task or cron session. No host marks such a session, so the session says so itself: every Toolkit task prompt's first tool call (and whoever runs a ping run's tool steps) runs `touch ~/.toolkit-handoff-off`, or a launcher sets `TOOLKIT_HANDOFF_HOOK=off`, and the hook then exits before it reads or writes anything. The file holds for every session of that user on that machine or container until it is removed.
- A session with no earlier handoff run, such as a fresh cloud container, finds its working repository's snapshot in a nearby store checkout and readies a fresh shallow clone first, moving a branch only as a fast-forward.
- Every handoff run, gate-end runs included, decides file by file: it adds a file the snapshot lacks, writes a differing file only when this copy of it is newer than its row (each row now records its file's modified time), and keeps a row whose file is missing here. A session holding an older memory copy no longer overwrites or drops newer memory. A row from an older snapshot with no time gets a fixed time once, and it never moves after that. Only a hook-started run drops rows, for files that session deleted, and never for a source it cannot reach. A folder whose times are not real (most files saved within one minute, as a plain copy gives) is judged once when the session starts, and then only that session's own changes are written. Ordering trusts each machine's clock. As before, a file deleted in one session comes back when a later session still holds an older copy of it.

## 3.163.1 (daily close list reaches the owner)

### Fixed

- The daily stale sweep now prints a ready-to-post `CLOSE LIST <date>` block on every run: children whose PR merged and whose only step left is the owner's, after the agent's UAT passed and with no gate still at work, are listed with a "reply ok to close" row (naming the head the agent's UAT ran at, and showing the controller's acknowledgement note) instead of hiding on the held line; a child with no DONE WHEN heading or an unchecked row stays a judgement; the block says "nothing to close today" only when the sweep has no rows at all; a same-day rerun marks it "shown again"; an unreadable owner-wait list fails the sweep so it retries instead of looking empty.
- The programme's owner waits (`attention --json`) say why an owner UAT is the owner's: `agent_uat` is `PASSED` or `OWNER_ONLY`, with `uat_head` and `pr_state`.
- The daily check-in tells the controller to post that block to the owner as its own message every run, empty days included, with the run's other rows.

## 3.163.0 (controller handoff snapshot refreshes itself)

### Added

- **Controller handoff snapshot saves itself:** `toolkit-store.cjs handoff` copies the controller's memory folder, saved instructions and named working files into `evidence/handoff/<owner>/<repo>/` in the evidence store, after a secret scan of every source, and saves only when a file's content changed (`HANDOFF UNCHANGED` sends nothing). Its `manifest.json` lists each file's sha256 and the stamp, and remembers the sources, so later runs need only the store and repository. A source not reachable on this computer keeps its last copy. With governance off, `--out <folder>` writes the same snapshot anywhere and sends nothing.
- **Refresh without a scheduled task:** in Claude Code, an after-tool hook starts one background `handoff` run after a successful store save (the gate-end archive) or a write to a remembered source, at most once per 10 minutes. It never blocks and does nothing until a handoff run has recorded its store. Codex and other harnesses use the gate-end step on the controller's evidence page.
- **Stale snapshot check at session start:** the controller health check has a `handoff` row (`--handoff <folder>` with `--checkout`): a read-only compare that flags a changed or missing snapshot with its age. The Projects hourly and daily runs skip it.

### Changed

- **Takeover reads the snapshot per repository:** the takeover playbook reads `evidence/handoff/<owner>/<repo>/` and reports the stamp its `manifest.json` records, the same on every store backend.

## 3.162.1

### Changed

- **Takeover finds the controller handoff snapshot:** the takeover playbook, which controller bootstrap runs, now reads the evidence store's `evidence/handoff/controller/` when it exists, in any governance state and first of all when no project memory is reachable, so a successor on another account still gets the outgoing controller's owner rules, queue, promises and in-flight work. The snapshot is evidence, not authority: current state wins where they differ.

## 3.162.0

### Changed

- **Agent UAT starts as each PR lands:** the controller records an agent UAT's start as `private.agent_uat` state `STARTED`, and the UAT stays the agent's until its result. A landed task whose owed agent UAT has not started is the work-queue finding `AGENT_UAT_UNSTARTED`, bound to the owed UAT's head; it clears once the start or a result is recorded, the UAT is no longer owed, or the head moves.
- **New G0 and G1 assignments wait for it:** while such a finding is open, `programme.cjs assign` of a G0 or G1, and `reopen` of an accepted G0 or G1, are refused with `AGENT_UAT_UNSTARTED` and nothing is written. Each flagged task is read again first, so a start recorded since the last pass lets the assignment through at once. A started UAT, however long, never blocks; G2 never waits; `dispose --reason` lifts it and keeps the reason.
- **Board:** the Waiting on cell reads `Agent: UAT on PR #<n>, not started` or `, started`, and the task page's PR GRAPH `Agent UAT owed, not started` or `, started`.
- **Gate rules:** agent UAT starts as each PR lands, in parallel with the gate lane, and a long one never holds the lane. The Windows Codex review brief paragraph moved from the gate rules into the host contract's review CLI permissions section.

## 3.161.0

### Changed

- **Agent UAT first on the programme board:** an owed UAT is now the agent's step until the controller records the agent's result on the task (`private.agent_uat`: PASSED, FAILED or OWNER_ONLY at the owed UAT's head, with evidence). One function decides who owes it. Until then the Waiting on cell reads `Agent: UAT on PR #n`, CURRENT reads `agent UAT on PR #n`, the task page says `Agent UAT owed`, and the task never joins the owner's waiting list; after an agent PASS or an owner-only finding at that head they read the owner forms. A UAT owed at a new head is the agent's again.
- **New status `NOW · AGENT UAT`:** a merged task whose agent UAT is still owed shows this status, sorted after work in progress and before `MERGED · awaiting proof`; it moves to `MERGED · awaiting proof` with `Owner: UAT` once the agent's UAT passes. A listed blocker still queues the task.
- **Owner PASS needs the agent's result:** a write that newly records the owner's UAT as PASSED at a head is refused (`UAT_AGENT_FIRST`) unless the agent's PASSED or OWNER_ONLY result is recorded at that head in the same or an earlier write. Only the controller writes or removes the agent record. PASS records already stored are unchanged.
- **Gates page:** the merge-time UAT rule now says the agent runs the UAT first and the ask reaches the owner only after that.

## 3.160.1

### Fixed

- The external-operation preflight checker now accepts the `ssh` route that its skill puts first for work inside a host, and the skill's route order names the same route values the checker accepts, with a test that keeps the two lists in step.

## 3.160.0 (Projects scheduled tasks become pings)

### Changed

- The Projects daily check-in and hourly nudge are now pings: each run stamps itself and posts one line in its home thread, and the coordinator works the task's checklist from the guidebook copy that turn. Steps that need a shell, GitHub or scheduled-task reads are labelled `TOOL STEP` and go to a thread that has those tools; `tasks/ping-run.md` tells the coordinator how to read the checklists.
- `toolkit-projects-tasks.cjs --render` renders the ping for both Toolkit tasks; `--check` reads a ping as current and a pointer or full prompt as outdated. Until a task is swapped, `--expand` prints the ping with a `TASKS OUTDATED` prefix, so an unswapped pointer runs as a ping and asks for its swap. A project's own (custom) task is unchanged.
- A Toolkit task's project additions move to `<report_dir>/project-additions.md`: `--additions-from` prints them and `--refresh` refuses until `--additions-saved` shows them saved word for word.
- `toolkit-projects-run-missed.cjs` also checks each run's receipts when given them: `RUN PENDING` (never relayed, or not finished by the next fire), `RECEIPT BROKEN` (`.done` without `.relayed`, or an empty receipt) and `RECEIPT ORPHAN` (receipts with no stamp). Input without receipts gives the same output as before.
- A scheduled run the controller defers or pauses gets one notified owner line (why, and when it resumes), as does a missed or stuck run and a run whose result needs the owner; a normal start is not notified. Scheduled run work never takes or waits for the gate lane.

## 3.159.1

### Changed

- **Native questions by default:** the global rules now ask each action-blocking question with the harness's native question method, explanation first and "(my pick)" on the best option, and fall back to one fully bold sentence only where no native method works. The repository-agent-rules skill, the controller takeover playbook, the toolkit-setup skill and the bridge doc follow the same wording, and a test stops bold-by-default or host-named question wording from coming back.
- **Merges let a running guard ask:** where a merge guard is known to run, the global merge line, both safety-gates lists and Secure CI/CD let the guard ask and take the owner's yes to its question as the OK, instead of the agent asking its own merge question first. With no guard known to run, agents ask as before. The Projects skill's ask list leaves merges to its merge rule.
- **Generic, platform first:** the two principles merge into one that also names harnesses, and says to state outcomes and safety floors rather than steps. The root `AGENTS.md` points to it.
- **Secure CI/CD asks only before irreversible steps:** commits, pushes to a non-default branch and opening or updating a pull request now run without asking. Merges, deployments, default-branch and force pushes, deletes and real-key changes keep their approval ask, in the skill, its reference, the setup prompt, the CI check-up and the safety matrix.
- **Leaner always-on rules:** the n8n renaming detail and the safe-mode check now live only in the n8n rules and the model-safety-flags playbook, where they already were, and the Ship principle no longer repeats the Shipping section's finish rule.
- **Asked once:** the repository-agent-rules reset message leaves its bold question line out when the agent asks it with the native method. The Secure CI/CD setup prompt asks before a push whose workflow deploys outside the approved plan.

## 3.159.0 (leaner child filing rules)

### Added

- **Automate first:** a new global development principle: clear-cut rules are enforced in code (hooks, scripts, CI) first, then in writing, and memory last; controllers still decide judgement calls. It replaces "Checks over judgement".
- **Daily stale sweep:** `toolkit-controller-check.cjs` has a read-only `stale` check that runs once per local date per repository (a local stamp file) where governance is on, and lists children whose PRs merged for the controller to judge against their DONE WHEN (`JUDGE?`; only children it judges done reach the owner as `CLOSE?`) when nothing on them is still open (not acknowledged by the controller, no lapsed hold, no `Kept open:` line, no open sub-issue, no unchecked DONE WHEN row), fold (`FOLD?`, a new child with no `Nearest child:` line), move (`MOVE?`, closed but holding open work) and a full or over-cap polish child, as one owner-approve list; every row prints, and a same-day run shows the day's list again. The Projects daily check-in runs the same sweep through GitHub MCP; the hourly nudge never runs it.
- **Agent UAT first:** `toolkit-pr-body.cjs` refuses a body that asks for owner UAT (`UAT: OWNER_TEST_NEEDED`) without exactly one visible `Agent UAT: PASSED (<evidence>)` line; a merge train with an owner-test member writes that line naming those members. Owner UAT asks list only the steps no tool reaches, each with why.

### Changed

- **Reuse first is hard:** work and findings go on their area's open child; a new child carries a `Nearest child:` line naming the closest open child and why it does not fit.
- **Lows:** a one-line G2 Low in the PR's own files is fixed with the PR's next fix round; every other Low and small UAT nit is a row on one rolling Later polish child (at most 8 rows), which ships as one batched PR when full. From a PR's second G2 round, open Mediums join their area's Now child.
- **Agent UAT:** at every tier that needs UAT, agent UAT runs every step a tool reaches before the owner gets the rest.
- **Trims:** "Never silently wrong" drops its must-hold clause (Automate first now says it) and "Written, not remembered" drops "never only in chat or memory" (memory last covers memory).

## 3.158.3

### Fixed

- **Refresh pull request checks governance first:** `toolkit-cloud-workflows.cjs --refresh-pr` now gives a repository that is not governed its one note before it checks that the Toolkit checkout's commit is on main, as the bridge doc says. Before, a Toolkit checkout off main told an ungoverned repository to update the checkout first, which only led to the same note. A governed repository still stops on an off-main Toolkit commit before any GitHub read or write. This also makes the command's own test give the same result on pull request and main runs.

## 3.158.2

### Changed

- **Session start says why it waits:** both Claude Code session-start hooks now show the fixed spinner text "Toolkit: checking for updates", so a start that waits while an update moves Toolkit's files no longer pauses with nothing on screen. The wait itself is unchanged. Codex hooks are unchanged for now.

## 3.158.1

### Fixed

- **"Couldn't check governance" says why:** the session-start line now names the failed read's cause in a few fixed words, for example "(a read of GitHub ran out of time)" or "(git settings here would send the read somewhere other than origin)", on a computer, in a cloud session and in the shortened cloud line. The cause comes from that start's own read, else the failure this computer's cache recorded. Only fixed phrases are shown, never git's output, a setting's value or a path. Governed effects and standing task auto-merge still hold exactly as before. `status --json` also shows the recorded failure as `merged.refresh_error`.
- **A timed-out read is told apart:** a binding read whose git call was stopped at its time limit, or whose time was already spent, now reports `read-timed-out` instead of `remote-unreachable` or `fetch-failed`, so the line can tell a slow read from a refused one. `status` words it too.
- **Cloud session starts no longer starve later repositories:** a cloud session started above several repositories read them one after another within one 6-second deadline, so a slow first read (a cold network on a resume) left the rest no time and each said it could not check governance. They are now read side by side, each in its own worker thread with the whole deadline.

### Docs

- **Bridge doc cells measured:** the per-place table and the update notice now say what was seen on 20 November 2026: hook scripts run changed code from the next tool call, new hooks and skills need a new session, a session-start change to CLAUDE.md reaches only the next session, over-limit hook text becomes a file with a short preview, the terminal loads the checkout itself, and a real desktop Code chat runs the account copy and hands off.

## 3.158.0 (local default branch catches up at session start)

### Added

- **Local default branch catches up at session start:** at each session start and resume on a computer, in Claude Code and Codex, a checkout that is on its default branch, clean and strictly behind origin is fast-forwarded to the commit the governance session start just fetched, so chats and owner tests no longer run on old code. It adds no network read, runs no repository hook, never resets, switches, stashes or forces, and leaves Toolkit's own checkouts to the bridge.
- **One line only when it matters:** the session sees one line when the checkout moved (asking it to read `AGENTS.md` and `CLAUDE.md` again when the move changed them), or one line naming why a default branch that is behind was not moved: uncommitted changes, an operation in progress, local commits not on origin, merge hooks or LFS filters, an upstream that is not origin, or git being busy. Another branch, a detached `HEAD` or an up-to-date checkout prints nothing.

### Fixed

- **Governance reads run git from its PATH location:** the session start's read of origin's default branch spawned a bare `git` in the repository's folder, which on Windows can run a `git.exe` placed in that repository. It now runs git from its PATH location, as the bridge does.

## 3.157.0 (governed copies follow Toolkit main)

### Changed

- **Governed copies follow Toolkit main:** the cloud sweep, its gate, the test shards workflow and Shard Timings in a governed repository now check out Toolkit `main` instead of one pinned commit, so every Toolkit fix reaches them at their next run with no pull request there. The owner holds one repository on a known-good commit with `gh variable set TOOLKIT_REF --repo <owner/name> --body <commit>`, and removes the variable to follow main again.
- **Stale means the layout only:** a copy is current while its body is what a refresh writes now, whichever Toolkit commit rendered it. A copy from before this release, pinned to one commit, counts as stale until its refresh lands.
- **Previous layout keeps working:** a contract records what the copies run, and a test fails when that changes until a new layout number is recorded with the old calls still served, and when main stops dispatching a subcommand or reading an environment name a recorded call passes. The sweep action refuses an unknown command instead of running a refresh.

### Added

- **One refresh pull request per repository:** `toolkit-cloud-workflows.cjs --repo <checkout> --refresh-pr` opens or updates one owner-merged pull request with the stale workflow copies, outdated vendored checks and a plain-text baseline still in the old format (migrated as `--migrate-baseline` does). Governed repositories only; nothing partial on failure; never merged by an agent. A rerun from a newer Toolkit commit with the same copies adds no commit, and a shallow Toolkit clone is told to run `git fetch --unshallow origin`.
- **Cloud sessions see stale copies:** each ENABLED repository in a cloud session gets the same stale-copy note as a computer, with the refresh command, when a Toolkit checkout is there to compare with.
- **Cloud sweep finding:** the cloud sweep raises `CLOUD_LAYOUT_STALE` on the attention list while a repository's copies are stale, naming the refresh command, and it resolves once the refresh lands.

## 3.156.1

### Fixed

- **`toolkit governance` asks for the bank afresh:** typed again while a governance question bank is open in the session (shown, or kept open after an answer), the phrase was handed to the agent as a possible bank answer: a one-use ticket and "never show the bank again", next to the line telling it to show the bank. A session given both could fall back to a status summary. The phrase now always asks for the bank afresh: the open bank closes and only the command line comes, which runs `setup`. Any other own message after a bank still gets its ticket.
- **A failed GitHub read gives a retry line, not a status:** `toolkit governance` reads the merged binding once more, with a longer limit, when the first read just failed (a slow fetch, a git lock, a network blip), and shows the bank when that works. When it fails too, the owner gets one line to type the command again, and the agent is told to show no status or check summary instead. Before, one failed read printed no bank but a pointer to `status`, so a fresh session could answer with a status summary. An answer is still refused with nothing written while the binding is unread.
- **No hook line, same route:** when a message comes with no `Toolkit command:` hook line (hooks off, or the hook ran out of time), the Toolkit setup skill runs `toolkit-commands.cjs "<the message>"`, which prints the line the hook would have added, for every typed command. So `toolkit governance` opens the bank there too, never a status or check summary.
- **Programme hints name the runnable command:** the session-start attention and checkpoint lines, `toolkit governance status` without hooks, `toolkit governance check`, setup's cloud sweep lines, the controller check and `programme.cjs`'s own messages now name `node "<Toolkit>/skills/github-program-reconciler/scripts/programme.cjs" <command>` with the full path of this computer's managed checkout (or the running copy), through one shared helper. A session once looked for the bare `programme.cjs` among the other Toolkit scripts in `repo/scripts` and said it was missing. The handover file names the script from the Toolkit root, since other computers read it.

## 3.156.0 (automatic updates on every computer)

### Changed

- **Automatic updates are always on:** setup no longer asks about automatic updates, and the bridge no longer takes `--enable-repo-auto-update` or `--disable-repo-auto-update`. A computer with a recorded managed checkout updates it at each session start; a computer that had updates turned off is turned on at its next session start, which records `auto_update_forced_at`. `remove toolkit` is the only way to stop it.
- **A session start with nothing new does almost nothing:** a Claude Code session start whose managed checkout already matches its remote no longer fetches, validates or copies. It reads the hub state, asks the remote once (not at all within 10 minutes of a check that found it current) and runs the install check.
- **The Claude desktop app keeps this computer current:** the app's claude.ai account copy now hands session-start maintenance to the managed checkout's own bridge script, so the checkout, global rules and helper definitions update on a computer that only uses the app. The account-copy reminder waits an hour after the checkout's newest commit, since claude.ai syncs the account copy within minutes. One time only, on a computer whose Toolkit folder predates this release: the app chat asks the owner to say `refresh toolkit` once, which brings the folder up to date and turns automatic updates on.
- **Cloud sessions are quieter:** a cloud session no longer says it runs an uninstalled Toolkit copy; it hears about its copy only when the copy is older than a Toolkit repository in its workspace.

### Added

- **One update notice in the same session:** a session start that moved the checkout tells that session the old and new versions, the changelog titles between them, when to reread the global rules, and when new hooks or skills need a new session.
- **No half-written reads:** an update does not move the checkout's files while the governance hook is reading them at the same session start, and the governance hook waits (up to 15 seconds) for a move already under way. If either is still held off after that, the move waits for the next session start, or that session start has no governance effects.
- **Controller self-update:** the controller health check has a `toolkit` row outside Claude Projects that reports a managed checkout behind its origin branch and names the one command that updates it.

## 3.155.2

### Fixed

- **Explain needs no ticket:** `explain 1.4` in reply to the governance question bank now only prints that row, before or after an answer. It needs no reply ticket, spends none and writes nothing, so the bank stays open for the owner's answer. It reads the bank the owner was shown: when an answer or a state change has numbered the rows differently since, it says the bank changed instead of printing another row under that number. Every other bank reply still needs the owner's one-use ticket, and the tool gate still refuses one without it.
- **The bank stays open after an answer:** the owner's next own message after an answer gets a new one-use ticket for the same bank, so a further change or a row that does not exist (`1.9=A`) gets its own line ("This bank has no row 1.9.") instead of a note about a used ticket.

## 3.155.1

### Fixed

- **Every Toolkit skill loads in strict YAML hosts:** Antigravity 2 refused `external-operation-preflight` and `n8n-workflow-transport` with "mapping values are not allowed in this context", because a plain description holding ": " is invalid YAML. Their descriptions, and those of `github-program-reconciler` and `toolkit-setup`, are now double-quoted with the same wording, as is the Codex `default_prompt` of `github-program-reconciler`.
- **Validation catches skill YAML that strict hosts refuse:** `validate-toolkit.cjs` now holds every skill's frontmatter (Toolkit's own, the bundled n8n skills and the Claude Projects skill) and every `agents/openai.yaml` to a small YAML subset that every strict parser accepts (spaces for indentation, no tab, control character or NEL, and whole-character `\u` escapes), and names the file, line and fix for anything outside it. Toolkit's own frontmatter readers now read a quoted value without its quotes.

## 3.155.0 (governance bank reply fixes)

### Changed

- **Rows left out stay as they are:** a governance bank reply that names only some rows now keeps every row it leaves out at its current value, so `1.4=A` changes the parallel CI shards answer and nothing else. `all recommended` still applies every recommendation.
- **Status rows sit below the table:** rows with nothing to answer, such as the evidence store, the parent issue and the required checks, no longer take a number in the table. They are listed under it as "Already set, nothing to answer here", each with how to change or stop it. Questions are numbered without gaps. When a number moves between showing the bank and the reply (a question became a status row, for example), the reply is not used and Toolkit asks the owner to see the new bank.
- **Shorter explain and plain errors:** `explain 1.4` gives the row's text without the verification and selected lines, and a reply naming a missing row says "This bank has no row 1.9." and asks again.
- **`toolkit permissions` puts the one command first:** the owner's one-paste `--apply` command now opens the print as well as closing it, and each guard is said once for all the lines it covers instead of once per line, which halves the print.
- **Commands in Toolkit's own code block:** the permissions command and the Governance App setup command are printed inside a code block from Toolkit, so the app showing them keeps their quotes straight.

### Fixed

- **One parallel CI shards pull request at a time:** while an answer pull request for parallel CI shards is open, row 1.4 shows it with how to merge or close it, and answering again prepares no second one.

## 3.154.0

### Added

- **Antigravity skill copies stay current at session start:** once you chose "Copy Toolkit's skills into Antigravity?" in setup, each Claude Code session start (in its install check) and each Codex session start, whenever the bridge's session-start hook runs (auto-sync or repo auto-update on), refreshes Toolkit's recorded copies in `~/.gemini/config/skills`, both the portable skills and the official n8n skills, from the managed checkout, never from the copy that runs. A stamp of the checkout's commit makes an unchanged Toolkit cost two small file reads; only a Toolkit update triggers one compare, and only the folders that differ are copied. Hand copies, the apps' own n8n copies and any ledger path outside Antigravity's folder are never touched; with no copies chosen, or Antigravity gone, nothing is written. A refresh takes its own lock without waiting, and a refresh or a failure (error code only) shows as the "Antigravity skills" install-check entry; a failed or skipped run tries again at the next session start. `remove toolkit` removes the refresh's stamp and lock folder (`~/.ai-agent-toolkit/antigravity-refresh`) with the rest of Toolkit's folder.

### Changed

- **Setup shows the Antigravity copy as your saved answer:** with Toolkit's copies there, row "Copy Toolkit's skills into Antigravity?" reads "Copied, kept updated" (with ", N to refresh" or ", could not check"), recommends Keep current, which refreshes anything out of date, and offers Remove as the other choice.
- **Docs no longer describe repo-local Antigravity or governed-rules copies:** the how-to guide, architecture map, Source-of-Truth Contract, n8n environment skill and agent guide now say governed repositories get the governed rules from the installed Toolkit at session start and that Antigravity reads the repository's own `AGENTS.md`, with no bootstrap file.

## 3.153.0

### Changed

- **Instruction templates retired:** the governed-block template (`AGENTS.managed.template.md`) and the Antigravity bootstrap template (`antigravity-bootstrap.template.md`) are gone from `repo/contracts/agent-rules/repo-local/` and `skills/repository-agent-rules/repo-local/`. Nothing installed them: the installed Toolkit delivers the governed rules at session start, and Antigravity reads `AGENTS.md` itself. The instruction sync no longer builds them, and the merge-train re-bump no longer stamps them. The `CLAUDE.md` shim template stays: `repository-agent-rules` still installs it.
- **Toolkit source checkout:** the session-start preflight and the governance cleanup now know a Toolkit source checkout by the instruction sync script, the version file and the Claude Code plugin manifest (one shared check in `repo/scripts/toolkit-version.cjs`), so neither needs an instruction template. The cleanup still refuses a source checkout, and the preflight still compares its `CLAUDE.md` with its own template.
- **Curated header:** the curated-source comment older setups wrote at the top of `AGENTS.md` now lives in `repo/contracts/agent-rules/playbook-history.json` (`agents_header`), exactly as it last shipped, so the leftover scan and the cleanup still remove it with the governed block.

### Fixed

- **Source checkout with broken CLAUDE.md markers:** the session-start note now says to regenerate the file with the sync script, which rewrites it whole, instead of calling the fix the owner's choice with nothing due.

## 3.152.3

### Fixed

- **Merged tasks no longer look unfinished on the programme graph:** a task whose tracked task PR merged while its issue stays open now shows `MERGED · awaiting proof`, not `NOW · IN PROGRESS` with the gate that already returned. It needs no open or draft task PR, no listed blocker and no gate still at the task (none, or its gate retired). Waiting on shows the owner's step, such as `Owner: UAT on PR #<n>`, else `-`. The band sorts after `NOW · IN PROGRESS` and before `NOW · QUEUED`, the order line names it, and CURRENT's In progress line shows `merged, awaiting proof` in place of the gate. A listed blocker still queues a merged task, so lane waits on multi-slice tasks stay `NOW · QUEUED`. The task page's hidden status, issue closure and the work-queue findings are unchanged.

## 3.152.2

### Fixed

- **No rule files under `.agents/rules/` in Toolkit:** the instruction sync check now refuses any file or link under Antigravity's `.agents/rules/` folder in this repository, matched in any letter case, not only the retired bootstrap file. A linked rule folder or file is named by its own path and never followed. `--write` never adds, rewrites or removes one; remove it by hand.

## 3.152.1

### Fixed

- **Cleanup leaves a file with broken Toolkit markers alone:** the leftover scan no longer lists any block in a file whose Toolkit markers are broken, because where a block ends cannot be told. The cleanup names that file once as left in place, keeps it byte for byte and still cleans every other proven copy, instead of stopping with an error and losing the bank row.
- **Bank says why the cleanup cannot run:** a programme file that stops the cleanup after the scan (unreadable, or version 1) now shows as a status row naming why, instead of the row disappearing. A Clean up answer whose write fails exits 1 and says to check the working tree.
- **Template header goes with the governed block:** the current template's curated-source comment above a removed block goes with it, whether or not the owner's text follows. An older wording of that comment stays as the owner's text.
- **Earlier playbook copies recognised by name:** `project-completion-audit.md` and a short-lived `git-completion.md` text are now listed in the playbook history under the names they shipped as.
- **Sweep copies that could not be checked are named apart:** a pinned sweep copy whose commit this Toolkit copy cannot read still holds the cleanup and the parallel CI shards answer, but is no longer called too old; the line says to run from a Toolkit git checkout that has the commit, or to refresh the copies.
- **Session-start note wording:** broken Toolkit markers are the owner's choice to fix, with nothing due in the task, and the checks part is kept beside them. Where governance is on but its programme file cannot be used, the leftover part says what comes first (update Toolkit when it needs a newer one). Checks in a repository whose programme file needs a newer Toolkit say to refresh Toolkit, never to rewrite them from the older copy.
- **Cleanup's next step:** after `--write`, it says to update Toolkit on every app that works in the repository before merging, and never to remove `min_toolkit` to quiet an older copy. A `min_toolkit` value that is not a version is replaced.
- **One version order:** the cleanup, the governance state and the bridge share one version comparison in `toolkit-version.cjs`, and the governance state reads the running version only for a programme file that sets `min_toolkit`.

### Added

- **Hook pack `min_toolkit` fixture key** and rows for the too-old governance line, broken markers and the too-old leftover note.

## 3.152.0

### Changed

- **Programme board shows worked tasks as in progress:** A lane wait, a task waiting only for a free gate lane, is one blocker starting with the word `Queued`. `assign` (plain and `--supersede`), `reopen` and a return consumed as `REOPEN` drop lane waits in the same write, keep every other blocker and list each wait they dropped (`dropped_lane_waits`), so a gate start is one write and a task whose gate returned (an accepted G2 waiting for its train) stays `NOW · IN PROGRESS` instead of falling back to `NOW · QUEUED`. Existing lane waits already use the word, so no data changes. A real block must not start with `Queued`.

### Added

- **`QUEUED_BUT_MOVING` work-queue finding:** The sweep raises it for a task shown `NOW · QUEUED` by lane waits alone, with no live gate and nothing waiting on the owner, whose open PR moved to a new head committed after the wait was written and after its last recorded gate ended: a gate start's `assign` was missed. A head pushed before the wait, or under a recorded gate, does not count. Every child write stamps the wait in the task's private part (`lane_wait`: the time moves count from and the PR head then); a patch cannot set it. The sweep's pull request reads now carry the head commit's time. It is answered by the missed `assign` or `dispose`, never `ack`. A G0, or a G2 with no new push, moves no head, so only the gate start's `assign` covers those.
- **Projects gate route:** The Gate assignments step says how to write a lane wait and to answer `QUEUED_BUT_MOVING` with the missed `assign`.

## 3.151.1

### Fixed

- **Principles page checked like its sibling pages:** setup verify for Claude Code and Codex now checks that an installed plugin carries an unchanged copy of the controller principles page, the Projects guidebook `BASE` lists it, so the weekly base clash check compares principle changes with the Projects skill, and the lane map gives it an owner. Tests now take the page set from the controller file's Pages section, so a page added later cannot be left out of these lists.
- **Base clash check reads new base files in full:** a file newly added to `BASE` has no saved blob to diff against, so the weekly check now reads its whole text.

## 3.151.0

### Added

- **Close what you spawn:** the controller design principles now tell every controller to close each thread or session it started (gate, gatekeeper, lane) once it is fully done: its output is recorded, its PRs are merged or closed, its final message was read in full and every item acted on, its result was relayed and no owner test, card, question or decision is still owed. A host with no close action records the session retired. Never a scheduled task's home thread, and idleness alone never counts. Without timers, the controller re-checks open ones at session start and each owner turn. A new section 10 of the host contract gives each host's close action.

### Changed

- **Work runs where the controller runs:** the principle that sent every controller's work to the cloud and barred computer scheduled tasks now runs work on the controller's own side (a cloud controller in the cloud, a local one on its computer) unless a step needs the other side. Scheduled tasks prefer the cloud and are no longer barred from the computer. The Projects skill keeps its own cloud-first rule, so Projects behaves as before.
- **Host-neutral principles:** the design principles page names no harness; a test keeps it that way, and per-host mechanics live in the host contract.

## 3.150.1

### Fixed

- **Same-role gate after an accepted one:** The Projects **Gate assignments** step and the programme reconciler's **Gates** rule now say that a second G0, a delta G2 after a PASS or a G2 recheck with no G1 round between is opened with `reopen --issue <n> --assignment <id> --reason`, since both `assign` forms are refused (`GATE_STATE`) once that role's gate is accepted. A holder-order test runs all three cases and pins both texts.

## 3.150.0

### Changed

- **Two review rounds per pull request:** the gate rules' round cap now gives each pull request two G2 rounds (every `Toolkit-G2:` verdict counts, deltas included) instead of holding the next round for an owner card after two FAIL verdicts. From round 2 only a proved High finding or a known material shipping-floor defect blocks: otherwise the verdict passes, open Mediums go to a follow-up child in Now and Lows to one in Later, and, with no blocker open, the controller sends the pull request to the merge train. A further round only rechecks the fix for a blocker that is still open, or a later RISKY change such as a source-conflict merge. Proof rules, the scope lock and the root-cause reassessment after two failed rechecks of one family are unchanged.
- **Lows-only children wait in Later:** a follow-up child that holds only Low findings now sits in Later, and the three-day start applies to Now children only.

### Fixed

- **Merge hold reads a stdin script as unread:** a shell told to read its script from standard input, PowerShell's documented `-Command -` and `-c -` spelling (`echo '<script>' | pwsh -Command -`, `powershell -c -`), now counts as a shell whose script the reader cannot find, so from Toolkit's own folder it is refused on Claude Bash, Claude PowerShell and Codex, as `| bash` already was. A POSIX shell's `-c -` and `-c --` count the same way. Elsewhere it stays ordinary work.

## 3.149.0 (owner waits, missed runs and live gates)

### Added

- **Owner waits in `attention`:** `programme.cjs attention` now lists every task whose board cell asks something of the owner, after the work queue, as `Owner waits (<n>)` with each task's ask, any gate it comes after, its PR and short head (JSON `owner_waits`). It reads the children's documents at read time and stores nothing; a child that cannot be read prints `Owner waits: unknown (<code>)`, never a short list. One owner step draws the board's `Owner:` cells, CURRENT's `waiting on you` and this list, so they always agree.
- **Missed scheduled runs:** a new no-model checker, `repo/scripts/toolkit-projects-run-missed.cjs`, reads each Projects task's trigger cron (with `CRON_TZ`), creation and last fire times and its run stamps, and prints `RUN MISSED: <task> <time> (fired, no stamp | not fired)` for each fire more than 20 minutes past with no run since, looking back at most 48 hours. Hours the cron never fires, such as an hourly task's night, are never missed. The hourly nudge runs it in step 10 and the coordinator catches each missed run up. The checking run passes its own time as `own_run`, never as a stamp: it covers only the fire that run answers, so the hourly nudge still sees its own missed runs.
- **Projects owner steps:** the hourly nudge's owner-asks step and the daily check-in now list every board owner wait under **Waiting on owner:** every run until done, and one never pinged is an unrelayed ask. Recording an owed UAT or decision is a new ask, pinged the same turn. The turn a gate thread starts, the coordinator queues its `assign` holder order (with `--supersede` while the task's previous gate is still live), and the turn it reports, the order that records its return (and accepts a G0 or G2), so the programme knows when each gate is live and when it has ended.

### Fixed

- **A blocker is not an owner step:** CURRENT shows a blocked task as `blocked: <blocker>`, no longer as `waiting on you`.
- **Live gates on the board:** a task with a gate assigned or active shows `NOW · IN PROGRESS` even while a blocker is listed, with `<gate>, then Blocked: <blocker>` as its Waiting on cell; once the gate returns, the listed blocker puts it back in `NOW · QUEUED` with no blocker write.

## 3.148.4

### Fixed

- The merge hold now judges a shell command by every real folder it may run in, not only by its text, and refuses by default: the starting folder always counts (a comment, a pipeline part or a background job can drop a `cd`), every folder a `cd` in it could reach counts too, and a folder the command does not spell out (`cd -` with no move before it, `~-`, `$OLDPWD`, a wildcard or a substitution) counts as Toolkit's own folder. Where the command starts in Toolkit's folder or names it, so does a move it does not follow: a move word behind a prefix such as `X=1`, `!`, `if`, `time` or `command -p`; a `CDPATH`, `HOME` or `OLDPWD` setting; an alias set in the command; or a shell whose script the reader cannot find exactly (`bash -ce`, `| bash`, `bash <<<`, a script file, Windows PowerShell's plain `powershell '...'`). Elsewhere such words are ordinary work, so `printenv HOME` or `grep -rn HOME src` in another repository passes. Nested shells with a script option the reader knows, `eval` and `trap` actions are read wherever they stand. Inside Toolkit's user-state folder nothing runs; in Toolkit's own folder only listing, reading, changing folder, read-only git and running a script file with node pass, with no wildcards, variables, substitutions, quotes, escapes, redirections or `..`; deeper in Toolkit's folder, a word naming user-state, a wildcard, brace, variable or substitution, a path back up to Toolkit's folder, or code the shell runs in itself from a file (`source`, `.`, a PowerShell script) is refused. From a start in Toolkit's folder, every folder the command reaches outside it is judged the same way, with every path word read there (`cd; find .ai-agent-toolkit -delete` is refused), and a folder that holds Toolkit's folder is judged as Toolkit's own. `git diff` with paths is refused in Toolkit's own folder, since it compares plain folders there. The guard is a tripwire for agent mistakes, not a lock: code inside other programs (`python -c`, `xargs`, `env -S`) is not read. Line continuations are joined as the shell joins them, and in PowerShell a backslash stays a folder separator. Links, junctions and letter case on Windows cannot hide the folder, a command too long to read is refused there, and the reader takes time in step with the command's length.
- A push after more than 16 folder changes is judged in a folder Toolkit cannot see, so a push to any branch there is refused, and the push reader no longer slows down on long chains of folder changes.
- A push to the default branch through `--git-dir` or a `GIT_DIR=` prefix, or split by a line continuation, is now judged against the repository it names, so it is held like any other default-branch push. A `GIT_DIR` set earlier in the command (`export`, `$env:`, `set`, `declare`) is judged beside the folder's own repository, since it may never reach git. A named git folder the reader cannot read (a wildcard, a substitution, an unknown variable) is judged as the folder's own repository, and past 16 `GIT_DIR` settings in one command a push is refused, so many settings before many pushes no longer take minutes.

## 3.148.3

### Fixed

- **Issue-close guard reads more hidden shell shapes:** where PowerShell may run a command (its own tool, an unknown shell or Codex Bash), a data command's script block holding a guarded gh write now counts as running when the same statement pipes it on to any further stage (`|% Invoke`, `| foreach Invoke`, `| Where-Object { $_.Invoke() }`, `| Out-String | iex`); even a harmless `| Out-Null` after such a block is refused. Quoted `;` or `||`, comments and an escaped line break no longer end that statement early, and a next line that starts with `|` carries it on. A block inside a group (`(...)`, `$(...)`, `. { }`, `% { }`, `Invoke-Command { }`) counts as piped when the statement around the group pipes on. `iex` text built by a `$(...)` substitution, a character cast or a method call that mentions gh or its pieces is refused, and so is a script block made from such text with `[scriptblock]::Create` or `$ExecutionContext.InvokeCommand`.
- **POSIX `-c` scripts that reassemble their arguments:** a script that expands its positional parameters (`$0` to `$9`, `${n}`, `$@`, `$*`) is read with them put in place, so `sh -c '$2 $1' x 'issue close 1' gh`, `sh -c '$1$2' x g 'h issue close 1'` and `sh -c 'g$1 issue close 1' x h` are refused, on every shell. A script that reorders its arguments first with `set --` or `shift` is refused when another order puts a guarded gh write in place. A gh command among the arguments, even a read such as `gh api user`, no longer stops the script itself being read. Words count only whole, so ordinary arguments such as `high-priority`, `ghost.txt` or a URL holding `api` pass. Placed, reordered and nested readings share one budget per command, and each placement is charged, before any text is built, for the script and words it reads as well as the text it builds, so long, repeated, nested or empty-slot arguments stay a quick read.
- **Two readings of escaped quotes compare what closes:** on Codex Bash and unknown shells, text with backslash-escaped quotes is refused when its PowerShell reading runs a guarded write that the judged reading does not see, compared by noun, verb, repository and target (a folder or `GH_REPO` change before a write without `-R` counts as another repository), the API method and fields (such as `-X PATCH` with `state=closed`), and the closing references and UAT line of PR text.
- **Timing tests:** the shell-reader timing comment now names scheduler preemption as the cause of the old flake, and the closing-reference timing uses the same longer samples.

## 3.148.2

### Fixed

- **Work queue behind a blocker:** a task natively blocked by a moving task is now left off the work queue for seven days after it last changed, not for ever; after that `TASK_IDLE` is raised and its detail names the blocker. A blocker waiting on the owner counts as moving, as the reconciler guide now says. A task whose state lists a blocker (`NOW · QUEUED`) gets the same seven days, so a blocker that cleared but is still listed no longer hides it for ever.
- **Work queue on a partial read:** a refresh that could not read every open PR no longer settles open `TASK_IDLE` and `TASK_MERGED_OPEN` findings; they stay as they stand until a pass reads the whole list.
- **Session-start work-queue line:** the longest-stalled task now shows when it was `flagged`, not `since`, which matches the time it prints.

## 3.148.1

### Fixed

- **Codex start failures read as start failures:** when the system refuses to start a named Codex after the launch is made (for example a script whose interpreter is missing), the app-server request now reports it as a start failure, as it already did for a Codex it refused before launch. `--check --codex` then holds with "cannot be started directly" instead of "did not give a readable answer (not found)". An error after Codex has started is reported as a process error. The Codex config check still returns "not verified" for a Codex the system refuses to run (permission or format errors) and moves on to the next candidate only when the program is missing or refused before launch.

### Tests

- Pinned the opted-in Codex PATH lookup: with only a refused Windows command script on PATH, the error keeps "not a standard npm shim" rather than "not available", and only the value `true` opts in (look-alikes such as `'yes'` or `1` keep the default refusal).
- The Windows shadow-executable test now also plants logging copies in the Codex home, which config/read and runtime probes use as their working folder.
- Renamed two Codex launch tests to say "opted-in Codex PATH lookup" and fixed an escaped line ending in a mocked wrapper script.

## 3.148.0

### Added

- External operation preflight keeps the recovery identity of a temporary outside resource that later sessions depend on. A new offline script claims the exact name before creating, records the provider's handle from its read-back, lets a fresh session resolve and check that one resource, and deletes the record only after a read-back shows the resource gone. It keeps one record per resource: a resource or handle another key already holds is refused, and two sessions claiming at once cannot both win. A missing, half-done, damaged or mismatched record holds the work.

## 3.147.0 (no silent skips and release identity)

### Added

- **No silent skips:** every skipped or todo test in Toolkit's own suite is listed in `repo/contracts/ci/test-skips.json` with the systems it skips on and a reason. The shard summaries now name each skipped and todo test, and the Validate check fails on a skip the list does not hold, on a listed skip that no longer skips, and on a summary that counts skips without naming them. A governed repository's own shard runner judges each test file by its exit code only, so it has no per-test skips to hold.
- **Release identity:** `node repo/scripts/toolkit-release-identity.cjs --commit <sha>` finds the first Toolkit version that holds a merged commit and reports, for the computer it runs on only, whether each Toolkit copy there has it: the managed checkout, the Claude Code plugin, the claude.ai account copy in the Claude app, a cloud session's synced plugin copy and the Projects guidebook. A copy is delivered, not delivered or unknown; anything it cannot read or prove is unknown, never delivered. `--min-version <x.y.z>` checks a version instead. It exits 0 only when every copy it found is delivered, and reads only.
- The git-completion playbook asks for this check before an owner test of a merged fix, and for each UAT result to name the version tested.

## 3.146.5 (programme graph status bands)

### Fixed

- **The programme graph sorts by status band:** rows now run `NOW · IN PROGRESS`, then `NOW · QUEUED`, then `LATER`, then the latest `COMPLETED`, then `RETIRED`, so moving work no longer mixes with work parked behind a blocker. Inside each band the order is as before: priority, then child number, optional tasks at the end of `LATER`, and tasks pinned with `last` at the end of their own band, so a pinned task in progress never drops below `LATER`. CURRENT's In progress list and the native sub-issue order follow the same bands, so the first refresh after this release reorders native sub-issues once.
- **Queued tasks are off the work queue:** a task whose state lists a blocker (shown `NOW · QUEUED`) no longer raises `TASK_IDLE` or `TASK_MERGED_OPEN`; its blocker says why. The batch tail guard and the one-level native blocker rule are unchanged.
- **An owed UAT reads as a UAT:** a task waiting on the owner with a UAT still owed shows `Owner: UAT on PR #<n>` in the graph and `your UAT on PR #<n>` in CURRENT, not `Owner: decision`. A gate waiting on the owner still shows `Owner: decision`.

## 3.146.4

### Fixed

- **A quoted host inside a run-time part is checked:** the n8n validator read every `${ ... }` and `{{ ... }}` as run time, so a private host written as a quoted literal inside one (`https://${'private-host'}/x`, `https://{{ $env.HOST || 'private-host' }}/x`, also in Code nodes and expression template literals) passed. Each part is now read as the texts it can give: its alternatives (split at `||`, `??`, `&&`, `?`, `:` and `,`), each a `+` chain of quoted literals, template literals (with their own `${ ... }` read the same way) and grouping parentheses. Only names, member access, calls and index keys count as run time; `*`, `/`, `%` and a unary `!`, `~`, `+` or `-` make only their own piece of a chain run time (`'private-host/items?offset=' + page * 50` is still read), while a comparison, an assignment or a binary `-` makes the whole alternative run time, so a host in brackets, in a nested template or split across `+` (`{{ 'https://' + $json.tenant + '.private-host/x' }}`) is found. `https://${host}/api` still passes, and so does a literal that is an allowed host. A text with no letter or digit (`${host || ''}`) is not read as a host, a URL repeated by one of these texts is counted once, and only the stretch of text a URL can reach around each part is read again, so a large Code node stays fast.

## 3.146.3

### Fixed

- **Two more ignored import switches fail loudly:** `-AllowMissingCredentialBindings` and `-CredentialExportDir` on the n8n import script were accepted and ignored, because only an old preflight that nothing called read them. Both now stop with `N8N_POLICY_VALIDATION_FAILED` before any Docker call, and the old preflight, its credential-binding export and the helpers only they used are removed. A test checks that every function in the import script is called.
- **The PowerShell 5.1 count check sees more call shapes:** besides a bare call, it now finds a counted helper result assigned through `( ... )`, `$( ... )` or `&`, to a `$script:` variable, or after other code on the line. `[array]` casts and `(...) + text` stay accepted.
- **Partly run-time URL hosts are checked again:** a host built partly at run time, by `{{ ... }}` or by a template literal's `${...}` (`https://${tenant}.private-host/api`, `https://private-host{{ $json.path }}`, also in Code nodes and in expression template literals), is checked on what is left once every run-time part is dropped, so a private domain before or after a run-time part is found. A `${ ... }` holding a space, a call or a quote (`${ sub }`, `${$('Config').item.json.sub}`) is read as one piece, and what it holds is checked on its own. A host with no letter or digit left still passes, and so does one whose literal part is an allowed host.
- **Expressions are read past regex literals and comments:** an apostrophe inside a regex literal or a comment no longer hides a later URL in the same expression, and a URL written in a comment inside an expression is checked too.
- **An email ends where the script changes:** an allowed address followed straight by letters of another script (an address at an allowed domain followed by Japanese text) is no longer flagged. The cut is not used when the text cut off, with what follows it, runs on through local-part characters into an `@` or a fullwidth `＠`, because then it starts another address. Any other address is checked as before.

## 3.146.2

### Changed

- **DESIGN.md reference follows the current upstream spec:** the `frontend-art-direction` DESIGN.md contract reference now says tokens can sit in front matter, in fenced `yaml` blocks inside sections, or both, that all blocks merge into one token tree and that a top-level key defined twice is an error. It adds the 10-section order, `motion` tokens (`duration`, `delay` and `timingFunction`) with reduced-motion guidance, and the prose-only Voice & Content Strategy section. The upstream pin moves to `google-labs-code/design.md` 679d301 (Apache-2.0, unchanged), and the source-watch cursor moves there too. Toolkit still adds no upstream CLI or package tooling.

## 3.146.1

### Fixed

- **One early import blocker now stops the import on Windows PowerShell 5.1:** the n8n import helper's early target check returned a single blocker as a lone object, which has no `Count` on Windows PowerShell 5.1, so the check let the run continue. A workflow whose saved local identity no longer existed could then fall back to a same-name workflow. Every counted or indexed result from a helper function is now wrapped as a list, which also fixes the live workflow count and the skipped-archived number in export with one live workflow. A test checks the helper scripts for the unwrapped pattern, and Windows CI runs every early-blocker case under Windows PowerShell 5.1.
- **The n8n workflow validator sees more personal data:** a URL written as a quoted text value inside an expression (`{{ 'https://host/path' }}`) is now checked, while a host built at run time (`{{ ... }}` or a template literal's `${...}`) still is not. Email addresses with letters from any script are now matched, and an allowed email domain is compared in normalised form, so a look-alike domain never passes as an allowed one. Findings still name the place, never the value.
- **Unused import switches fail loudly:** `-RequireConfirmation` and `-SkipCredentialBindingRefresh` on the import script were accepted and ignored; both now stop with `N8N_POLICY_VALIDATION_FAILED` before any Docker call. Confirmation before an import belongs to the sync menu's own `-RequireConfirmation`.
- **AllLive export follows the folder's naming:** a new file uses `<name>.workflow.json` when every existing root workflow file does, and joins words with `_` when the folder does, instead of always writing `<name>.json`. Name clashes compare full file names.
- **Dry-run staging is documented:** the import README says a dry run stages a credential-metadata helper in the container's `-ContainerDir` (default `/tmp`) and removes it before it reports.

## 3.146.0 (Toolkit's own repository drops its rule copies)

### Changed

- **No governed block in Toolkit's root `AGENTS.md`:** the installed Toolkit delivers the governed rules at session start here too, so the root file now holds only Toolkit's own rules, starting with "## This Repository". The Antigravity bootstrap in `.agents/rules/` is gone; Antigravity reads `AGENTS.md` itself. `CLAUDE.md` stays the one line `@AGENTS.md`.
- **Instruction sync:** `sync-agent-instruction-shims.cjs` no longer writes the governed block or the bootstrap into the root. Its check, and `--write`, now fail when root `AGENTS.md` carries any Toolkit block (even a broken marker) or the bootstrap comes back, so a stale branch cannot re-add them. The portable templates stay as they are.
- **Session start in a Toolkit checkout:** the note no longer compares root `AGENTS.md` with the managed template, which would have said to regenerate the block back in. `CLAUDE.md` is still compared with its template, and a newer checkout still says to refresh Toolkit.
- **Force-push guard:** a repository counts as governed by its working-tree `.github/toolkit-programme.json` saying `"governance": "enabled"` (even when the rest of it does not parse), alongside its governance state and the guard config. A leftover governed block alone no longer counts.
- **Version floor:** Toolkit's own binding now sets `min_toolkit` to 3.137.0, the first release with the new turn-on, the cleanup route and the session-start truncation fix, and the cleanup writes that floor too. A test keeps the cleanup's floor no newer than the Toolkit version.
- **Lists and docs:** the re-bump stamp list and the fallback audit drop the root block and the bootstrap, and the instructions playbook and bridge doc describe the hand-written root file.

## 3.145.2

### Fixed

- **Owed UAT stays on its own PR:** the programme graph's Waiting on cell, CURRENT's In progress line and the task page's PR GRAPH now name the PR an owed owner test was recorded on, found by matching the test's head against the task's PRs, instead of whichever PR the task tracks now. A UAT owed on a merged PR no longer moves to a newer replacement PR. A head that no known PR has shows as `UAT at <short head>` with no PR number. The refresh keeps the heads it has seen on each task's PRs (newest 20, never dropping the owed test's head) in the task's private part, which older Toolkit copies already accept, and writes only that key there, so the controller's own private notes are never overwritten.

## 3.145.1

### Fixed

- **A new repository's first sweeps say what to do:** a cloud sweep held only because the repository has no programme state yet (`PARENT_STATE_MISSING`) now warns "No programme state yet; setup on first sweep only." and names the step, `programme.cjs init-parent --apply --controller`, for the parent issue. Three such runs in a row turn the hourly gate red with the same words instead of pointing at a programme page that does not exist yet. Every other hold keeps its general text.
- **The require-cycle guard sees more requires:** it now follows `require(path.join(__dirname, ...))` and same-file path constants built that way, ignores comments, strings and regular expressions when finding requires, the CLI check and the exports line, and also scans the helper-script templates repositories copy and run. The test also checks its own lexer on every file: it fails when a string, regular expression, template, comment or brace is left unclosed, or when the lexed view of a file no longer compiles, so a misread token that would hide a file's requires turns the test red instead. Requires of a function argument or a computed root stay out of reach and are named in the test as the accepted remainder.

## 3.145.0

### Fixed

- **In-flight work shows NOW without a hand step:** an open pull request that claimed a programme task whose state recorded no pull request or branch only raised `PR_UNTRACKED`, so the task stayed `PLANNED` and the parent graph showed active work as LATER until a controller recorded it by hand. A refresh, the cloud sweep included, now records the one open pull request from a person's branch of the repository that claims the task (a GitHub closing link, `Refs`, `Completes`, `Closes`, `Fixes` or `Resolves` `#n` in its body, or, with no such line, its own PATH block): it writes the pull request, its branch and head, and moves a `PLANNED` task to `ACTIVE`, so the graph shows it NOW in the same pass. Two or more such pull requests, a pull request from a fork, a bot or a generated branch, a finished or retired task, and a pass whose discovery is incomplete write nothing and leave a `PR_UNTRACKED` finding that names the pull requests and the reason. The write goes through the guarded state write and is held when the task's record changed after planning; it never touches gate, review, UAT, close or assignment fields. While no gate return, review or UAT is bound to a recorded head, a later push moves the recorded head with it, so the push raises no `PR_HEAD_MOVED`. A tracked pull request that closed or merged still moves to the one newer open pull request that claims the task, now also through its PATH block.

### Added

- **Stale pins are loud:** in a governed repository whose cloud workflow copies (the sweep, its gate and the test shards copies) are pinned to an older Toolkit commit, the governance check only noted it, so the repository's cloud sweep kept running old Toolkit code unseen. Each session start on a computer, in Claude Code and Codex, now names every such copy in one stale-pins note with the refresh command, `node repo/scripts/toolkit-cloud-workflows.cjs --repo <repo>`, to run from a Toolkit checkout on the latest main and land through a pull request. It names the command only when this computer's Toolkit checkout is on main and already contains every pin; a newer pin or a checkout off main gets a note to update the checkout first, because a refresh from it would roll the copies back.

## 3.144.0 (work in batches)

### Changed

- Work now moves from Later to Now in batches. Lanes finish the Now batch first (fixes, then reviews, then other steps), then the controller reads all of Later and picks the next batch: the highest priority tier first, then the quickest tasks, at most 6 PRs and one large task. A tail guard stops one slow task from holding the next batch. `CONTROLLER.md` "Work queue" and the delivery contract's new "Work in batches" part say the same rule; the delivery contract defines the priority tiers (P0 to P3), sizes (S, M, L), when a batch is done, lane order, parking and jumps.
- The `order` field's description says how the controller sets it: Later reads priority tier, then size, with the picked batch first.

### Added

- The reconciler raises a new work-queue finding, `BATCH_NEXT`, on the programme parent when the graph has a Later task and no Now task needs a gate lane, after one quiet hour (only the first raise waits, so a routine task write never drops a dispose). A Now task needs none while it waits on the owner, its open PR passed review at its current head with no red required check, every PR on it has merged or closed, or it has been still for a day (the tail guard). Like the other work-queue findings it is answered by acting or a dispose, never acknowledged, and it clears by itself once a task takes a lane. It reaches the session-start attention line, `programme.cjs attention` and the Projects hourly nudge's `WORK QUEUE` prefix.
- The Projects hourly nudge lists the graph's Later rows as queued work only once `BATCH_NEXT` says no task in progress needs a lane, and works project memory's queue the same way.

## 3.143.0

### Fixed

- **The issue closure check proves a merge train is a train:** a merged train's `OWNER_TEST_NEEDED` line releases an issue its members answer for only when the train's own commits are merges of member heads (each row's pull request merged at that head, never the train itself), catch-up merges of main, eject reverts that exactly undo an earlier boarding, and a last version-only bump, read from GitHub. A pull request that pastes a train table over a merge of a sibling branch (even one that lists the sibling's head as a row), or adds a commit of its own, keeps the issue held.

## 3.142.0 (store save recovers from a failed push)

### Changed

- `toolkit store` save, move and merge-branch no longer strand the store checkout after a failed push. A push is tried up to 4 times with waits of 2, 4 and 8 seconds; before each retry the store is read first, so a push that landed is never sent twice, and a store that moved is merged with a merge commit. After the last try the commit stays in the checkout, and running the same save again checks it and pushes it.
- Commits the store lacks, whether kept by a failed push, made by hand or made by a race merge, are checked again right before every push: every blob and every commit message is secret-scanned, and each change may only add, change or exactly rename plain files inside the store folders. A commit that fails is named and never pushed.
- A race merge that conflicts is cancelled and made again keeping both versions: the store's copy stays in place and ours is saved under `evidence/store-conflicts/`. No step leaves a half-done merge, and `sync` cancels one an older run left, keeping every commit.
- The `--message` text is secret-scanned before anything is committed.
- No store refusal points at a raw push, a reset or a hand merge any more.

## 3.141.1

### Changed

- **Projects coordinator reads a thread's result in full before resolving it:** a wake preview can cut the end of a thread's final message, and a thread was once resolved from such a preview, losing the report paths and a follow-up item in its tail. Reading the final message in full (`full_bodies`, never a preview or summary) and acting on or recording every item in it is now a condition of resolving a thread, in the instructions block line, the skill's resolve conditions and read rule, the hourly nudge's thread read and resolve candidates, and the `RESOLVE DUE` step. Wording in the block and skill was tightened elsewhere to stay within their byte budgets, with no rule dropped from the skill; the block's "End finished Remote Control sessions" line now lives only in the skill, beside the resolve rule.

### Fixed

- **Superseded pull requests:** a programme task kept tracking the first pull request it found, even after that pull request closed unmerged and a replacement took its place, so the G1 acceptance check read the dead pull request's head (`EVIDENCE_STALE`) and the close list never offered the task. A refresh now moves a task's tracked pull request only to a newer pull request that claims the task, through a GitHub closing link or `Refs`, `Completes`, `Closes`, `Fixes` or `Resolves` with the task's number in its own body. When the tracked pull request closed unmerged, the task follows the one such open pull request, or else the newest such merged one; when it merged and the task is still open, the task follows the one such open pull request, so a later slice or rebuild is tracked too. A mention without a keyword, an older pull request, two or more such open pull requests and a retired task never move it, a finished task only moves from a closed pull request to a merged one, and a replacement that cannot be read back in the state it was chosen in leaves the task's PR discovery incomplete with the old pull request kept. Each move appears in the pass's planned effects and its JSON report.

## 3.141.0 (design data refresh)

### Fixed

- **Task auto-merge in Claude Projects cloud threads:** every cloud Projects thread was forced Off for task auto-merge, so a train with the repository's switch at `after-gates` still needed the owner's card tap. The host writes a thread's session context as the opening record of its session transcript, marked meta, and never submits it as a prompt, so the hook that should have recorded the project line never saw it. The merge hold now reads the `- Task auto-merge` project line at merge time from that record: only the first main-thread user entry, only when it is marked meta, belongs to this session and starts with the session context. A typed first prompt, a later wake carrying a context, tool output, another session's transcript and a missing or unreadable transcript all still force Off. The prompt-based switch store, which was never written on the real host, is removed, and the gate route check and the merge hold now share one read-only transcript head reader. Tests use the host's real transcript shape.

### Changed

- **Design data:** The design-system generator's 28 CSV files now match upstream `nextlevelbuilder/ui-ux-pro-max-skill` at `0e8d408`, byte for byte, and every lock pin is the real upstream blob, so the old line-ending-only pins are gone.
- **Status filter:** Only rows upstream marks `active` rank in style and stack searches, so deprecated and supplemental styles never lead a recommendation. A stack query naming a legacy or deprecated generation still finds that stack's deprecated rows.
- **Right-to-left:** A recommended style now carries upstream's `rtl_level`, shown in the Markdown output too.

### Added

- **Source-lock refresh:** `repo/scripts/refresh-source-lock.cjs` turns a reviewed source-watch notice into a one-command refresh of an active source lock: it copies exact files, moves pins, lists new upstream files as excluded and refuses while an adapted file needs porting by hand.
- **Escape list:** `repo/scripts/toolkit-escape-ledger.cjs` keeps one line per bug found after merge in the private evidence store (`state/<owner>/<repo>/escapes.jsonl`, beside the repository's programme state): what broke, why the tests missed it, the kind of test that should have caught it, who found it, and the fix and test once they exist. `add` writes a line, `fix` fills the fix and test once, `check` validates the file and `group` prints counts per kind and the escapes with no test yet, never the text. The reader refuses anything outside its exact format, and any text holding a local path, a secret-shaped value, personal data or an AI footer.
- **Controller findings:** a bug found after merge now also gets its escape-list line the same turn.

## 3.140.0 (stuck threads get a fresh successor)

### Fixed

- When Task Scheduler fails, `remove toolkit` now names the error inside its "could not be planned; nothing was removed" line, screened for anything secret-shaped, so a denial says what was denied. The message is PowerShell's first real error line, past the progress block Windows PowerShell can write first, which also makes a failed removal's reason readable.
- Setup's line about old Toolkit tasks now says plainly that `remove toolkit` uninstalls Toolkit from the computer after your OK, and that the old tasks go with it only once no app keeps Toolkit. The setup skill says the same.
- The 3.132.0 notes now say what an old Toolkit task really does when it fires: it finds its runner gone and exits with an error, then turns itself off after three such runs if Toolkit's record still matches it.
- **The programme sweep reads the newest result of a required check.** For each app that set the check, the newest run decides: an older failure no longer turns a check red once a newer run passed, and a newer failure or cancelled run is no longer hidden by an older pass. Each run's completion time and app ride in the same GraphQL read, with no extra requests. When either cannot be read, the earlier cautious rule applies.
- **The REST fallback for pull request checks can read green.** It now judges REST's lower-case states the way it judges GraphQL's, so a passing check read over REST no longer stays pending.
- **A sweep stopped in planning whose save finds the state branch busy now says it saved nothing.** The lease keeps the stop and the changed-since bookmark for the next pass, which reports it.
- **Stop-parsing word no longer hides a pull request from the attribution check:** PowerShell's `--%` word, unquoted, is dropped before the attribution, push and credential checks read a command, so `gh --% pr create` with an AI trailer is refused like `gh pr create`, and the Claude Code hook's fallback screen matches it too. A quoted `'--%'` stays an argument that gh refuses.
- **Backslash quoting no longer hides a push where PowerShell may run it:** bash reads `\"` as an escaped quote and PowerShell as a backslash and a quote, so `echo "a\" ; git push --force ...` hides the push from bash but runs it in PowerShell. The force-push, evidence-store push and credential checks now also read a line with a backslash as PowerShell does, on Claude Code's PowerShell tool and every Codex shell call; Claude Code's Bash tool keeps the bash reading alone.
- **Daily check-in plugin baseline uses the copy's sync time:** step 10 now measures plugin lag against main as it was when the host last synced the account's plugins, instead of the check-in session's start. A home thread can live for days while its container re-syncs the copy, so the old baseline could hide a real lag. The sync time is the modification time of the host's `manifest.json` beside the copy, which the host rewrites at every container start even when nothing changed; the copy folder's own birth time is only a lower bound, because an unchanged copy keeps its folder from an earlier start, and synced files carry a 1980 file time, so a file's own time is never used. Copies are found by name prefix, since the host can rename one (for example `ai-agent-toolkit~g2`). With several copies the newest sync time wins and each other copy is listed with its version and sync time; with no valid sync time the check compares with main today and says so. The lag age is measured up to the sync time, so a copy synced moments before the account caught up is not reported as more than a day behind. The pinned report now reads "pinned copy synced at <time>", and the state record keeps the sync time.

### Changed

- The old Windows task cleaner now has a fixed end: it goes in the first Toolkit release on or after 1 March 2027.
- Tests now cover the task record's own guards (secret screening, the file's mode, path and stop-time checks, and the refusal to rewrite a record it could not read), and a hand edit made only in a task's exported XML, which is planned as changed and kept.
- The contract is the one record of skill classes: the Skill Safety Matrix Packaging table and the Antigravity copier's Toolkit-only list follow it, and validation fails on any mismatch. `repository-agent-rules` and `toolkit-playbooks` are now Toolkit's own, so the Antigravity portable copy leaves them out; setup removes Toolkit's earlier global copies of them.
- **Hourly nudge default tier:** the hourly nudge now defaults to the mid tier (Sonnet on Claude) instead of small, because the small tier missed threads in its lane sweep. A stored nudge prompt keeps its own tier until it is swapped.
- **Task kind check:** `toolkit-projects-tasks.cjs --check` now reads a pointer that loads another task kind as malformed, instead of relying on a tier mismatch to catch it.

### Added

- Every skill now has one class in `repo/contracts/skill-publication.json`: portable (works anywhere) or Toolkit's own (runs Toolkit itself). The skill portability audit fails when a portable skill picks up a new Toolkit word, or names an agent app without a written reason; mentions already there sit in a baseline that only shrinks, checked against the change's base commit.
- The README splits the skill table into portable skills and Toolkit's own skills, and the audit keeps each skill in its class's table.
- **Stuck threads get a fresh successor:** the Projects hourly nudge now runs `repo/scripts/toolkit-projects-stuck.cjs` every run (step 4a) on what it read: every `list_threads` page, each unresolved work thread and each Remote Control lane's status. A thread is stuck when its Remote Control session ended, or is not connected or served with the session quiet 10 minutes or more while its device is reachable, or when it was failed, stopped or idle while owing work and did nothing of its own after the coordinator's message. A failed or stopped thread gets a continue message first, because a usage-limit or API-error cut-off leaves that state and such threads continue on one message. A working thread, one whose run left output in the last 45 minutes, and one waiting on something recorded (an open owner card, CI, a gate or review) are never stuck; a working thread quiet past twice its expected time goes to the owner instead. The report carries `STUCK THREADS`, `STUCK FOR OWNER` and `STUCK CHECK FAILED` prefixes, and a cut-off thread scan reads `THREAD SCAN INCOMPLETE`.
- **The coordinator starts the successor itself:** `Successors for stuck threads` in the Projects skill's periodic-runs reference covers the re-check, the successor brief (the old brief with its gate route, the pushed state and a stop when the branch moved), a fresh Remote Control session for Remote Control lanes, the "superseded" message to the old thread and a ledger (`successors.json`) that holds each lane to one successor in 2 hours. A parked Remote Control lane now gets a successor before the owner is asked to type in it.

## 3.139.1

### Fixed

- **Source-watch notices never merge on the standing answer:** a pull request that changes the source-watch notice report (`repo/source-watch/reviews/**`) now waits for the owner's typed merge in the task auto-merge check, and the whole `repo/source-watch/**` folder is in the RISKY tier. A notice closes unmerged once it is triaged, but the report was a LIGHT `.md` file outside the merge-authority list, so one UAT line could have made a notice eligible to merge.

### Changed

- The ui-ux-pro-max reviewed-through cursor moves to upstream `b6a7900`. The upstream commits in that range change the upstream CLI asset sync, its CI path filter, upstream tests, a gallery copy of an already tracked data file, the excluded README, and the adapted `design_system.py`, which gains a preview page writer and design token export. Toolkit's adapted generator is a smaller local-only subset with none of those writers, so nothing is adapted now; no exact-copy data file or licence changed, and the earlier recommendation of a separate data refresh stands.

## 3.139.0

### Changed

- **Evidence store kinds are stated plainly:** a programme file whose store is missing, or names a kind other than `github` (a folder, a drive, `none`), is refused with one message that says governance keeps its state in a private GitHub repository, that a folder or drive can hold evidence copies only, and that without such a store governance stays off. It replaces the terse "not supported (supported: github)" line and the store-field errors that followed it. Only a plain kind word is echoed. Governance still reads such a file as an error, never as on.
- **How To Use** has an Evidence Store part: when a store is needed (only while governance is on), a table of store kinds with and without governance, and three limits (same owner only, a shared store is shared trust, folders and drives hold copies only). The `toolkit-setup` skill points to it.
- **Gate and global rules:** with governance off, progress and decisions go in the pull request and the evidence store, if any, and review rounds and long evidence go to the evidence store, if any, so a repository with no store is no longer told to use one.
- Gate route check: the per-launch `Route override:` brief line is retired, so every gate runs on its stack-registry pin. A gate brief that still carries the line is refused with a plain reason, and an old route stamp carrying ` override=` reads off its pin, so the merge train finder never boards it. The controller roles page, the Projects skill launch rule and the merge train notes drop the override wording.

### Fixed

- Merge card on the first try: the merge hold's refusal now leads with Toolkit's merge card and tells the agent to ask no merge question of its own, with the typed line kept as the fallback. In a chat where the card counts and task auto-merge is off, an agent-written question card that asks to merge a named pull request is refused before the owner sees it; the refusal says to run the merge only if the user asked for it, so one tap merges. Questions about already-merged pull requests, merge trains and merges of issues, steps or branches are not refused. The tap receipt names the merge card. The review playbook says that running the merge is the ask.
- **Logged acceptance clears the closed-without-acceptance finding:** refresh no longer raises `CLOSED_WITHOUT_ACCEPTANCE` for a completed close whose controller-logged review `PASSED` has passing verdicts at the tracked PR head (with no head tracked, the newest verdict) and whose UAT is `NOT_REQUIRED`, `PASSED` or `UAT_RETAINED` at that head. Before, only an accepted G1 or G2 gate counted, so a disposed finding came back as new whenever the attention list's size cap evicted the disposal.

## 3.138.0 (usage reader)

### Changed

- **Retired `schedule_folder` leaves bindings:** every binding writer now drops this retired programme-file key, which nothing reads. That covers a governance turn-on or refresh proposal, a task auto-merge or merge-train switch pull request, a parallel CI shards answer and the instruction-copies cleanup. A switch, shards or cleanup change keeps the file's own layout, so its diff shows one extra removed line, and its pull request text or preview names it. A binding that still carries the key stays valid. This repository's own programme file no longer carries it.
- **Report-only lines name who acts:** the CI check-up records each dropped item with its reason; the daily PASS/WARN/FAIL rollup in the secure CI/CD prompt, status template, self-hosted service and managed foundation skills names the owner as reader, the chosen alert channel and same-day action on a FAIL or a WARN three days running; skill product review baselines name who clears each finding and by when; agent cost control gaps are fixed the same turn or handed on with a due date; temporary resources are removed by their cleanup owner by the end date; the controller acts on a governed repository's startup note the same turn, refreshing Toolkit first when the note names a newer one.
- **Owed Toolkit checks have an owner:** the yearly hook review and the Codex nested-cell re-measure are fixed rows of the controller's release-batch real-host smoke, residual hosts live in the release brief's host matrix, and the controller runs the host drift review when due and picks up source-watch notification pull requests on its periodic run.

### Added

- `repo/scripts/toolkit-usage-report.cjs`: reads Claude Code and Codex session transcripts and writes one JSON report of token and tool counts per session, so the runs that use up usage limits can be measured before anything is changed to save them. Per session it gives the models, first and last activity, model turns (helper turns among them), input, cache-write, cache-read and output tokens, the cache hit share, tool calls by name, repeat reads of one file, shell sleeps, wake-ups scheduled, helpers started and a run type (hourly, daily, weekly, coordinator, G0, G1, G2, merge train or other), plus totals per run type. A reply Claude Code writes as several lines counts once, and a repeated Codex token count is skipped. The report never holds prompt, reply, thinking, tool or file text: file paths become ids that match only within one report, and a report that would hold anything shaped like a secret is refused and not written.

### Fixed

- The reconciler skill again says how to run the standalone decision-trace audit, which flags it takes and what it fails on, and its script header no longer claims the reconcile pass runs it.
- The reconciler skill now names where an initial nonblocking review finding is recorded: its area's open follow-up child issue.
- The plain-text check's starting baseline leaves out findings in file names it cannot store (`:`, `\` or control characters) and says how many, so the next run fails on those findings instead of failing to read the baseline.
- `--migrate-baseline` runs even while the check is switched off, says so, and reminds you that git history still holds the old text, so a real token stored there needs revoking. Running it on a baseline that already uses fingerprints says nothing changed.
- The old baseline format notice says "old format" instead of "v1", and the installer prints it when it keeps such a baseline, not only on `--check`.
- Success lines say "1 entry", not "1 entries", and the Toolkit's own plain-text check names a bad option or missing value instead of a vague error.
- In a Toolkit checkout, the personal-data guard installer warns about a leftover plain-text check copy under `.github/scripts/` and `--check` reports it as drift, as it already did for a leftover guard copy.
- **Merge trains re-read each member's UAT line:** `toolkit-merge-train.cjs land` now reads each member's live pull request body and refuses when the auto-merge check calls its `UAT:` line missing or invalid, or when the manifest records `NOT_REQUIRED` or `PASSED` while the body says `OWNER_TEST_NEEDED`. A stale or hand-built manifest can no longer drop an owner's test at merge; a stricter manifest line still lands and keeps the test owed. A `--live` member entry with no body is refused, never read as `NOT_REQUIRED`.
- **The train finder says why a UAT line fails:** its skip reason now ends in `(missing)` or `(invalid: <why>)`.
- **PR sweeps flag invalid UAT lines:** the Projects hourly and daily PR sweeps now flag `invalid UAT verdict` as well as `missing UAT verdict`, judged by the auto-merge check rather than by a line starting `UAT: `.
- The n8n workflow validator helper's Pinecone pattern line ends in CRLF like the lines around it.

## 3.137.1

### Fixed

- **Source-watch reports keep old trackers as history:** a test now pins that both report builders (third-party source updates and advisory targets) show a review cursor's tracker only under the "Tracker at last review (history; find the current owner at triage)" label, so a later edit cannot quietly present a closed task as the current owner.
- The host-change review template now routes each finding to the smallest open task that owns that area now and cites closed or retired tasks only as history, and the source-watch README says a new or advanced cursor names the open task that owns the follow-up.

## 3.137.0 (governance question bank shows once)

### Fixed

- **Governed rules could be cut off at session start:** Claude Code keeps a session-start text only up to 10,000 characters and shows a 2,000-character preview of a longer one, and the governed rules come last. A cloud session started above 12 or more enabled repositories, or a computer with many failed `Checkpoint:` lines, could pass that limit and lose the rules. The text now always stays within 10,000 bytes: failed `Checkpoint:` lines past what fits are counted instead of listed, and in a cloud session the last repositories' state lines shrink to their state word, then are counted, so the rules and the names of the repositories they bind stay whole. Tests pin the limit.
- `programme.cjs mark-archive` keeps every repeated `--remove`, where it silently kept only the last one; any other option given twice is now refused instead of replaced.
- The programme reconciler's README and skill no longer describe a Programme Graph PR column the graph dropped, and say that agents mark notes for archiving through a holder order's `mark-archive` write.
- **Curly quotes in a bank answer:** the tool gate no longer counts a bank answer command that holds a curly quote as the exact answer command, because PowerShell reads curly quotes as quotes, so such a line could run a second command after the answer. The command is refused instead.
- **Refused bank replies:** a bank reply that is not in the exact form now says what makes it exact (its own line, its live ticket, and no curly quote, straight double quote, `$`, backtick or `%` in the answer), instead of the general "only the user answers" refusal, so the agent sends it again rather than telling the owner it cannot be sent.
- **Test time budget after a re-run:** the CI test duration check now counts only the newest run attempt of each shard, as the shard check does, so re-running a shard that ran slow once can clear it.

### Added

- **Governance question bank permission lines:** `toolkit permissions` now prints the governance question bank as two exact Claude Code lines in the computer block, so the owner clicks Allow once (for the Update in the bank's permissions row, or the `--apply` command) instead of on every `toolkit governance` run, auto mode included. One line is `toolkit-governance.cjs setup`, which shows the bank. The other is `toolkit-governance.cjs setup --answers *`, which sends the owner's reply and writes nothing without that reply's live one-use ticket. `refresh`, `--json` and every other governance subcommand still ask, and Codex gets a prompt rule for the bank. The lines name the managed checkout's path, like every computer line.

### Changed

- **Bank once:** `toolkit governance` shows its question bank once. A reply that cannot be used (unread, an unknown row, a status row, two choices for one row) now gets one line saying what was wrong and "Reply again", never the bank again, and the owner's next own message still answers the same bank with a new one-use ticket. In the owner's own terminal the same line is printed and the question asked again.
- **Changed state:** when the governance state changed between showing the bank and the reply, only the rows that changed are named, with their new state and recommendation, and the next reply answers the bank as it is now. Only a bank whose rows were added or taken away needs `toolkit governance` again.
- **Explain:** a reply of `explain 1.4` prints the full text of that row and keeps the bank open for the answer.
- **One Agents line:** every output after an answer, results and errors alike, ends with one line for the agent: show the lines above exactly as printed, add nothing, post no card, run no command shown and never show the bank again unless the owner types `toolkit governance`. The agent sends anything that may answer the bank as it is, and Toolkit checks it, instead of asking its own question or showing the bank again.
- **Shorter bank:** after the table come only the Turn on line where it applies and one reply line. The shards question and minutes moved into `explain 1.4`, with the minutes in short in the row's Current cell, and the permissions note is in that row's own text.
- **Fixed row numbers:** each governance row keeps its number from run to run, and status rows sit in the table under theirs (1.5 Evidence store, 1.6 Governance App, 1.7 Parent issue, 1.8 Required checks, 1.9 Repository visibility). A row that does not apply leaves its number free, and answering a status row says it has nothing to answer. The heading counts questions and status rows apart. `setup toolkit`'s bank is unchanged.
- **Stable command path:** governance commands shown to the owner or an agent name the managed Toolkit checkout when this computer records one, not the desktop app's plugin copy, whose path changes with each update. The tool gate accepts the bank answer command from either copy, exactly.
- **No stray line:** a reply that leaves parallel CI shards out, or answers not now, no longer prints a "not now" line.
- **Open pull requests read again:** the bank reads the open governance pull requests again before it runs, so a turn-on pull request closed outside Toolkit no longer holds the next turn-on with a misleading "not ready" line. When one is still open, the answer names it to merge or close and prepares no second one. A failed turn-on no longer prints a line telling the agent to show the bank again, and a reply the tool gate cannot count tells the owner they can type `toolkit governance`, instead of the agent showing the bank.
- **Store reuse:** a test pins that a new repository with an evidence store already found recommends keeping it, with a new private store only the other choice.

## 3.136.1

### Fixed

- **Programme graph current step:** while a task's gate is assigned or active and not blocked, the parent graph's Waiting on cell names that gate first and shows any owner test still owed after it (`G1, then Owner: UAT on PR #<n>`), instead of showing the owner test as the current step. CURRENT's In progress line ends `then your UAT on PR #<n>` in that case. A submitted, interrupted or finished gate, a blocked task or an owner decision keep the old order.

## 3.136.0

### Fixed

- **Merge trains never undo main:** `verify` (and so `land`) now refuses a merge train whose tree differs from a fresh build of its current members on main, and `catchup` and `eject` check their own result the same way, leaving the train as it was on a difference. An eject revert keeps removing its content through later merges, so a change that reached main another way (the ejected member landing alone, a pull request built on it, or an identical change from another pull request) could be deleted when a green train landed. The check compares results, so every such route is closed for a merge onto the main it checked; a refused train is rebuilt on main.

### Changed

- **Governed default branches require branches to be up to date:** the ruleset Toolkit writes now requires a branch to hold the default branch's latest commit before it merges, and `toolkit governance check` reports a default branch that does not require it (`PROTECTION_UP_TO_DATE`), which `migrate` offers to fix with that ruleset. A check that passed at the head then still holds for the merge, which closes the gap between a merge train's `land` and its merge.

## 3.135.0 (cleanup route for Toolkit instruction copies)

### Added

- `repo/scripts/toolkit-governance-cleanup.cjs`: in a repository whose governance is on, it previews and then (with `--write`) removes the Toolkit instruction copies older setups wrote: the governed block (keeping every byte outside the markers), the Antigravity bootstrap, Toolkit playbook copies, and a one-line `CLAUDE.md` when `AGENTS.md` has nothing of its own left. It sets `min_toolkit` in the programme file, keeping that file's own layout so the pull request shows one changed line, and never runs git; the owner merges the one pull request. It refuses a version 1 programme file, which cannot carry `min_toolkit`, and a Toolkit source checkout, whose copies are removed by hand, and holds while a pinned cloud sweep copy runs a Toolkit that does not know `min_toolkit` (the bank shows that as a status line). A governed block edited by hand is named in the preview.
- `refresh governance` asks about a governed repository's instruction copies as one bank row; Keep current is recommended, and only the owner's Clean up answer runs the cleanup in the working tree.
- `min_toolkit` binding key: a Toolkit copy older than it reads the binding as ERROR and says to update Toolkit.
- `repo/contracts/agent-rules/playbook-history.json`: hashes of every playbook version Toolkit shipped, retired names included, so a repository's older copies are recognised.

### Changed

- The leftover scan now covers repositories whose governance is on: only the instruction copies are listed there, and its checks and workflow copies are kept. A playbook matching any earlier Toolkit copy is listed. A one-line `CLAUDE.md` that loads the repository's own `AGENTS.md` rules is kept.
- The session-start preflight names a governed-rules copy as a leftover instead of asking to refresh it. Where governance is on it says removal is the owner's Clean up answer in `refresh governance`; elsewhere it names the leftover scan. Neither asks anything of the current task. A note with both a leftover copy and differing checks names both, instead of reporting broken markers.
- The n8n router no longer offers "install `AGENTS.md` with `repository-agent-rules`".

## 3.134.0

### Changed

- **Task pages follow page layout v2:** PATH, then TASK (`## WHY` with `### PROBLEM`, `### FIX` and `### IF WE SKIP`, then `## DONE WHEN` with its `**Not in scope:**` label), then `# PLAN` as a part of its own, then the PR GRAPH, then AGENT CONTEXT, then the hand-written text. The `# More` heading is gone: hand-written text sits under the generated blocks with its own Title Case headings. The `###` parts are read only inside `## WHY`, so a new page filed with `## WHY`, `## DONE WHEN` and `# PLAN` lays out on its first pass and a `### Fix` written inside PLAN stays there. New pages have no WHAT (the problem and the fix say it); a page that still has one keeps its words as `## WHAT` at the top of TASK. Pages an earlier Toolkit laid out are redrawn once, with a copy saved first, as before.
- **The PR GRAPH names each PR's task:** its columns are PR Task (the PR's title, cut to 60 characters so long titles cannot fill the page's budget, and drawn as code so a title forms no link, mention or reference), PR #, Status and Merged SHA. The tracked PR's Status cell carries the task's gate and, while the owner's test is owed, `UAT owed`. With no PR yet the graph reads `None yet` with the gate and any owed UAT (`None yet · G0 ACTIVE`); when the tracked PR is not among the rows shown, one `Task:` line under the graph carries them. Titles are never saved in the task state, so older Toolkit copies still read the store: a refresh pass reads them, and a pass that reads none keeps the titles the page already shows. A PR whose title is not read yet, or looks like a secret, shows `-`.
- **No STATUS line on task pages:** review, release, the next action and blockers are in the task's handover file, which the task's AGENT CONTEXT line now links first (`Handover: [handover file](…) · Decisions: …`) when the binding names a GitHub store. The task status and the exact UAT state stay in one hidden line in the block, so frozen closed pages and the issue-closure guard read them as before, and STATUS lines older pages still carry keep counting for that guard. A task kept open on purpose shows its `Kept open: <reason> (since <time>)` line under the PR GRAPH.
- **Heading rule:** generated headings are in capitals and hand-written ones are in Title Case by convention. Only a hand-written heading below the generated blocks that reuses a generated name in capitals (such as `## PR GRAPH` or `# STATUS`) holds the page with `PAGE_LAYOUT_HELD`, naming the heading; it is never rewritten. Other headings in capitals, such as `# NOTES`, are left as written.
- **Rules:** the governed rules' programme tracking line now says each child's PR GRAPH shows each PR's SHA, gate and owed UAT, and its handover file the release and review.

## 3.133.0 (turn-on writes only what the repository needs; scripted review carry; gate route check and route stamps)

### Changed

- Turning governance on now opens one pull request with only the programme file and the Toolkit CI checks (the plain-text check, plus the dependency security files and cloud sweep copies where they apply). It no longer writes the governed block into `AGENTS.md`, a `CLAUDE.md` shim, the Antigravity bootstrap or the playbooks: the installed Toolkit gives every session the governed rules, and the playbooks ship as the `toolkit-playbooks` skill.
- A working tree is a prepared adoption when its programme file turns governance on; a governed block is no longer needed. A programme file that turns governance off is not taken as a prepared yes.
- The governance discovery list no longer offers to reuse or refresh a governed block. A block an older setup left is listed as no longer needed, and the CI checks the turn-on adds are listed.
- `repository-agent-rules` no longer installs or refreshes the governed block, the Antigravity bootstrap or playbook copies; it reports any it finds as leftovers and keeps the CI checks and the one-line `CLAUDE.md` shim.
- The programme reconciler's instructions and the docs that summarise them now say governed issue writes follow the merged programme file turning governance on (ENABLED), with or without a governed block in `AGENTS.md`.
- The session-start check of a governed repository's vendored Toolkit checks (the plain-text check and the personal-data guard) now runs when the repository carries no Toolkit block, so a stale or missing copy is still noted there. Only the checks are compared; the repository's own `AGENTS.md` and `CLAUDE.md` are left alone. When a newer Toolkit is on record on this computer, the note says the checks may come from that newer Toolkit and to refresh Toolkit, so an older copy never rewrites newer checks.
- The n8n router no longer offers to install `AGENTS.md` with `repository-agent-rules`, which no longer does that; it offers the adapter-only `AGENTS.md` or none.

### Merge trains

- **Scripted review carry:** three kinds of pull request now board a merge train with no fresh G2, each only inside an exact check (`repo/scripts/toolkit-review-carry.cjs`), with green required checks, one `Bump:` line, an accepted `UAT:` line and no footer or other personal data in the title or body. Anything else, or any doubt, still needs the normal G2.
  - **Body-only FAIL:** a G2 that failed a pull request only for its description adds `Carry: body-only uat=<state>` under its verdict's route stamp. Once the body is fixed, the same head boards on that verdict, as long as the body keeps that UAT state or makes it `OWNER_TEST_NEEDED`. A weaker UAT line needs a fresh G2.
  - **Shard-timing refresh:** the bot's `toolkit/shard-timings-*` pull request that changes only the shard manifest, and only its measured times and the files each named shard lists (its normal rebalance included). Budgets, every other key and every shard must stay as they were; the rest shard runs any file a named shard drops, and CI proves each file ran once. Its body now carries `UAT:` and `Bump: none` lines and names this route.
  - **Generated sync:** a pull request that changes only files the two instruction syncs write (each sync now lists them as `PROJECTED_OUTPUTS`): whole projected files, or managed blocks with the hand-written rest unchanged. Only where the Validate workflow runs both syncs' `--check` (the Toolkit repository), at the merge base and the head, since that check is what proves the generated text matches its sources; elsewhere it needs a G2.
- **RISKY keeps the owner's card:** the shard manifest and instruction files are RISKY, so a carried pull request of those still waits for the owner's merge card.
- **Wording-only docs:** a G2 brief with `Review class: wording-only` may run at high on the reviewer's pinned model, and the gate route check accepts it. `find` accepts that high stamp only when every changed file is a LIGHT `.md` file.
- **Rules:** the gate rules name the carry and the wording-only route.

### Gate routes

- **Gate route check:** the governance hook now refuses a G0, G1 or G2 session's state-changing tools while the host's own record (the hook input's effort, `CLAUDE_EFFORT`, and the model the CLI wrote to the session transcript) is off its stack-registry pin. The session can still post why it stopped. A session is a gate when a Toolkit launcher marked it or its brief has a `Gate:` line; a brief-declared gate also carries `Route: <profile> <member> <model>/<effort>`, where the member is a role name (`DISCOVERY`, `BUILDER`, or `REVIEWER` for the profile's one reviewer) or a reviewer id. A helper inside a G0 or G1 is checked against its helper pin, never the gate's.
- **Owner overrides:** a temporary owner change of a gate's model or effort is one brief line, `Route override: <member> <model>/<effort> owner=<rec N or cmsg id>`, for that launch only. Without the owner citation the registry pin stands.
- **Route stamps:** G0 plans, G1 pull request bodies and G2 verdicts carry one `Route:` stamp line: `host-verified`, `launcher-attested` (the host shows no record, so the launcher's Route line stands in) or `UNVERIFIED`. `node repo/scripts/toolkit-gate-route.cjs stamp` prints a session's own stamp, and the hook refuses a verdict or G1 body whose stamp is not the session's own. A verdict is read only as the first line of a posted comment, so reads and quotes of verdict lines go through.
- **Merge train acceptance:** `find` refuses a pull request whose G1 or G2 stamp is off its pin, and a RISKY one whose stamp is missing or `UNVERIFIED`.
- **Rules:** the roles and routes page, the gates page, the gate rules' route proof and the Projects controller skill's gate launch line say so; the Projects line now says to set the model and effort pin explicitly on every gate launch.

### Fixed

- **Hourly nudge PR owners on quiet runs:** step 5 now takes each open PR's owner from the thread list step 2b reads on every run, instead of step 2's list, which a quiet run skips. A thread that takes the PR step over because the run could not read GitHub pages the thread list itself.
- **Unowned evidence-store PRs:** the `PR UNOWNED` action keeps the owner's OK for closing a task-repository PR only. An evidence-store PR is merged or closed without asking, because the store is agent-managed with standing permission.
- **Other projects' outdated tasks are report only:** the platform changes a scheduled task's prompt only from the thread that task posts into, so the Toolkit project's daily check-in and its `PROJECT TASKS OUTDATED` action now name the project and task for the owner and never call `update_trigger` across projects. Each project's own coordinator swaps its own tasks when its own check-in reports `TASKS OUTDATED`.

## 3.132.0 (light CI after main moves; pull request body pre-flight; old scheduled-task code removed)

### Programme sweep

- **Busy tasks no longer stall the sweep:** a task with more than 100 closing references or cross-references now reads the rest of its PR links page by page (up to 1,000 a connection). Before, one such task made every pass incomplete, so the lease never recorded a finished pass, an earlier `PASS_STOPPED` never cleared and the task's PR history stopped updating. A pass that still cannot prove its read whole records `an incomplete read` as its reason instead of none.
- **Keep a merged task open on purpose:** `update --patch` with `{"private":{"keep_open":{"reason":"<why>"}}}` keeps a task whose PRs have all merged off the work queue's `TASK_MERGED_OPEN` while its merged PRs are the ones the mark was set over; a later merge brings the task back until the mark is set again with a new reason. The write stamps the time and the PRs it covers, and the task page's STATUS line shows `Kept open: <reason> (since <time>)`. Older Toolkit copies still read the document.
- **Null in an update patch:** `null` on a field a candidate, UAT or review must carry (such as `candidate.head`) now sets it to null instead of removing it, which could only end in a refused write. A refused state document now names its task.

### CI

- **Body edits stay light after main moves:** a pull request title or body edit used to rerun the whole Linux and Windows test matrix whenever `main` had moved since the last run, because the tested merge commit changed. The route job now also reuses an earlier run of the same head on an older base, but only when GitHub shows that run tested this head merged into a base commit today's base still contains, and the base moved no test file, shard manifest, workflow or dependency file. Only the newest run at the head that ran its tests can be reused: if it failed, the edit runs in full rather than reaching back to an older pass. The edit's run still checks the title, body and repository again. Any doubt runs in full.
- **The summary checks follow the choice:** the gate job's legs step names the tested commit it reused (`TESTED_COMMIT`), and both `--verify-ci` checks require exactly that commit.
- **Faster Toolkit validation:** the validator reads the topology policy once per run instead of once per checked review field, builds each retired-wording pattern once, and skips plain words when it looks for file paths. A full run takes about a quarter less time, which the copied-workspace tests feel on every case.
- **Topology tests split in two:** the copied-workspace topology tests took up to about 109 s of their 120 s budget on Windows. The retired-wording cases now run in their own file, so both halves run side by side well inside the budget.

### Pull request bodies

- **Pre-flight before every write:** `node repo/scripts/toolkit-pr-body.cjs --body-file <draft> --title "<title>" --out <clean file>` removes every line holding an AI footer, a claude.ai session or project-thread link or the Projects attribution marker, then checks the cleaned body with the same personal-data guard CI runs, the UAT line rule and, in the Toolkit repository, the one `Bump:` line rule. In a repository with no guard config it uses a default with pull request text and AI attribution on and says so; a guard block whose report it cannot read counts as not ready. Builders run it before opening a pull request and before every body edit, so a body they write already passes the body checks instead of failing and costing a full run and a review round (a cloud create still gets the route's footer, which the update right after it removes).
- **Footer-free writes from the cloud:** the PR review and git completion playbooks now say to write pull request bodies with the GitHub connector, never cloud `gh`, and to read them back; the footer a cloud create still gets is cleaned once with the connector's update call.
- **Projects briefs:** every G1 brief asks for a body that passed the pre-flight; the merge card steps and the cloud hook parity table point at it.

### Removed

- Toolkit's Windows scheduled-task code is gone: the task runner and its retired stub, the task launcher, task health, `toolkit update scheduled task`, and the task planner, apply, start and adopt commands. The cloud has run these jobs since 3.111.0. An old Toolkit task that still fires on a computer now finds its runner gone and exits with an error; after three such runs it turns itself off, if Toolkit's record still matches it. Say `remove toolkit` to uninstall Toolkit from this computer after your OK; the old tasks go with it once no app keeps Toolkit.
- Setup's retired `--scheduled-task-update` and `--remove-toolkit-tasks` options are gone. Setup still prints one line when old Toolkit tasks are recorded on a Windows computer, pointing to `remove toolkit`.
- The permission ask rows for the old task commands are gone, since those commands no longer exist.

### Changed

- `remove toolkit` keeps a small legacy cleaner for old tasks. It removes a task only while it still carries Toolkit's marker (or the exact description an old launcher wrote when it disabled it) and still matches the definition Toolkit recorded. A task you made or that Toolkit only listed is never removed, and a Task Scheduler folder goes only when it is empty.
- The `schedule_folder` binding key is retired: it is still accepted, so a binding that carries it stays valid, and nothing reads it.

### Fixed

- **Governance post-merge finish ends on a by-hand check:** a security check only a person can make, such as a CodeQL setup Toolkit cannot place, and dependency auto-merge waiting for protection that needs a fix by hand, now end the finish with the owner's step instead of retrying it every session.
- **Clearer finish results:** a private repository on GitHub Free with no required checks names default-branch protection with what GitHub cannot enforce, not as a step; a write GitHub refuses keeps GitHub's answer in the reason, and a refusal for a non-admin account (forbidden) is held with the step to run `migrate` as an admin; the bank's required-checks row names the `migrate` step. A security read or write GitHub did not confirm, or a free setting Toolkit would still turn on, keeps being retried.
- **CodeQL read limits:** more workflow files than Toolkit reads, or more than one workflow with CodeQL steps it cannot place, is named as a by-hand check instead of an unread result.
- **Re-runs of the turn-on pull request:** a workflow someone else pushed to the turn-on branch stays; only Toolkit's marked copies and the shard list leave it. The read-back after an update waits briefly for GitHub to show the new head.

## 3.131.0

### Changed

- **Setup question 2.1 (Claude Code agents):** the Current cell now says what the choice does in plain words, for example `Gates: Toolkit helpers only; elsewhere one subagent layer`, instead of `Root only; subagent limit 1`. With broader native behaviour it says Toolkit repos still keep one subagent layer. It adds the Claude Code subagent limit only when that limit is not the one the choice expects (your own value, not set yet, unknown, or Toolkit's limit still set under broader native behaviour).
- **The programme page has three generated parts:** CURRENT, PROGRAMME GRAPH and AGENT CONTEXT, then the hand-written text. The DECISIONS block, which nothing read and which linked only the newest decision comment, is gone. A page that still has one reads as before and loses it on the next write, keeping the text around it byte for byte.
- **AGENT CONTEXT links the full decision index:** its Decisions part now links every top-level decision index comment on the parent, oldest first (`index`, or `index 1` to `index n`; a directory comment stands for its parts), before `programme.cjs trace <n>`. Bot and archive comments never count, as in the trace audit. The body itself therefore reaches every record an index lists, so hand-written index links on the page can later move to an archive comment without leaving records unlinked.
- **A faulty index comment costs only its own link:** an index comment on the parent that links in a loop, too deep or to too many pages is left out of the Decisions part, and the healthy ones stay linked, so their records stay reachable from the body. The pass names the faulty comment in a report-only `TRACE_INDEX_INVALID` finding with the step to fix it.
- **Re-runs update the open setup pull request:** answering the bank again while the turn-on pull request is open adds one commit with the new answers to the same branch, never a second pull request. Toolkit changes only its own turn-on branch.
- **Rendered from the managed checkout:** the turn-on and `toolkit governance check` render the cloud workflows with the managed Toolkit checkout's own installer, so a lagging plugin copy cannot render workflows that do not match their pinned commit.

### Added

- **Governance post-merge finish:** after the question bank's turn-on pull request is merged, the next session starts `toolkit-governance.cjs finish` in the background. It adds default-branch protection, the ruleset that blocks force pushes and the free dependency and security settings without asking again, and the following session shows the result once, built from what actually happened: what is on, what GitHub cannot enforce on a private repository on GitHub Free, and any step left for the owner (such as adding required checks to a fresh repository before protection can be added). Only a setting GitHub could not confirm keeps it pending, with the reason, and it is tried again later. The bank names these settings whenever Turn on is offered, not only when it is recommended.
- **One closing line for the turn-on:** the bank's setup pull request ends with a fixed summary (its link, what merging does, the files it holds, what finishes after the merge) and one line: "Merge <link>. Nothing else is needed from you."

### Removed

- **Shard timings `--fail-if-due`:** nothing used it; `--warn-if-due` stays.

### Fixed

- **Setup file wording:** the docs now say that an older Toolkit copy of the dependency auto-merge workflow is refreshed, instead of "existing files are never changed".

## 3.130.0 (periodic runs hand GitHub steps to a thread with the repos and recover skipped schedules)

### Fixed

- **A queued holder order could be filed twice or lose its receipts:** when the cloud sweep filed an order's result and read it back but then failed to take the order off the queue, the next run ran the order again. After the order's expiry that filed a completed order as both done and refused, or replaced a stopped result and its write receipts with a bare refusal; before expiry it replaced the receipts with "done earlier". Result files now name the commit that queued the order, and the next run finds the result for that same commit and only removes the file. The same order queued again comes with a new commit and still runs, so a stopped order continues from its refused write. The sweep also runs a pending file exactly as listed, read at the commit that queued it, so a file replaced mid-run never hides the replacement or gets a result for an order that did not run.
- A shard timing refresh pull request now ends with `UAT: NOT_REQUIRED` and `Bump: none` lines, so the auto-merge check accepts it and the merge train finder can board it once its review passes. Before, every such pull request needed both lines added by hand.

### Claude Projects

- **Added:** the hourly nudge and the daily check-in start their first line with `GITHUB STEPS OWED: <steps> | ` when a step could not read GitHub (the nudge's CI waits, PR sweep and programme sweep; the check-in's GitHub and checker steps), instead of only saying so.
- **Changed:** a coordinator without repo access no longer finishes a task run by relaying it: the same turn it hands every GitHub step of the run to a thread that has the repos, and writes `.done` only after that thread reports back (**GitHub steps need repo access** in the recurring-tasks reference, and the skill's **Every task run reaches the project chat** line).
- **Added:** the hourly nudge's PR step also reads each scheduled workflow's newest run and raises `SCHEDULE MISSED: <names> | ` when a scheduled time passed more than 30 minutes ago with no run since, because GitHub can skip a scheduled run. The coordinator re-reads the newest run, then has a thread with the repos start it by hand on the default branch only when the workflow stays inside the repository's own GitHub state or the owner approved it by name; anything else waits for the owner.

### Changed

- The Source Watch PR Notifier can now also be started by hand, on `main` only (a manual run on any other branch does nothing), so a skipped scheduled run can be recovered without waiting for the next schedule. A test now requires every scheduled workflow in the repository to take `workflow_dispatch`.
- The global rules' root-cause principle now also says to fix problems upstream: where it matters, the fix goes in the shared source that copies, prompts and later runs inherit, not a local patch. The global block's byte cap rises to 21,900 to hold it.

## 3.129.0 (Enter-only owner terminal steps)

### Added

- `repo/scripts/owner-terminal.cjs` is the one place Toolkit scripts print to, and confirm with, the owner's own terminal: a title line, a few `label: value` facts, at most one sentence wrapped to the window, and an OK or STOP line. Colour and markers show only on a terminal with `NO_COLOR` unset.
- Every owner confirmation is a fresh Enter, and Ctrl+C stops with nothing changed. The prompt drops anything typed or pasted before it and anything that arrives before the input has been quiet for a moment, and a pasted block never confirms, so the blank line at the end of a pasted command no longer answers it.
- The governance App setup command has a `--save both|variable|secret` step for an App made by hand: it saves the Client ID and the key file's key on the repository, reads both names back, and overwrites an App already there only with `--replace`, which `toolkit governance check` prints only on its replace route.

### Changed

- `toolkit permissions --apply` and `--remove`, the governance App setup, `toolkit governance disable` in a terminal, the `toolkit governance migrate` rulesets, `programme.cjs migrate-state --apply`, the setup RAM approval and the Codex configuration approval wait for Enter instead of a typed `apply`, `create`, `yes` or `approve`. Answer files and flags work as before.
- `toolkit env` remove, apply, connect, revoke and retire-codex-env wait for Enter when run in your own terminal; your agent still passes your chat yes or no on stdin. `toolkit env show` asks for Enter instead of the key's name. Typing a secret value stays hidden typed input.
- The governance App setup screen is a title, four facts and one sentence instead of two long paragraphs.
- The App's by-hand save commands are the setup command's `--save` step instead of long pasted PowerShell and shell lines that asked you to type `replace`.
- The global Development Principles say owner terminal steps are short and Enter-only.

## 3.128.2

### Fixed

- The `controller-bootstrap` skill description no longer contains angle brackets, so claude.ai syncs the marketplace without warnings for it; the takeover phrase now reads "you are taking over as controller for [repo]" there.
- Toolkit validation now fails any skill whose description contains `<` or `>`, since claude.ai rejects XML tags in skill descriptions and strips the angle brackets.

## 3.128.1

### Fixed

- **Owed UAT on the target task was not seen:** the issue closure check reads the UAT a task's generated programme status records, but it still looked for the older `- UAT: <state>; review:` line. Task pages now show the UAT as one part of the STATUS line (`... · UAT: PENDING · Review: ...`), so a closing word for a task still waiting on the owner's test was let through. The check now reads that part, still reads the older line on pages that carry it, and still ignores the same text outside the generated status block. The renderer names the check as a reader, so a later layout change updates both.

## 3.128.0 (the daily check-in offers the saved skill update; pages stay drawn and within budget)

### Claude Projects

- **Added:** the daily check-in reads the Version of the owner's saved claude.ai copy of the Projects controller skill and reports `SKILL CARD OUTDATED: saved <old>, main <new>` when it is older than the guidebook. The coordinator offers the update card the same turn with `propose_skills`, once per Version: a Version already offered, dismissed or refused is never offered again, and a refused card is never routed to hand upload. Threads and new chats load the saved copy, so it now stays current in every project, not only when someone remembers to offer a card.
- **Changed:** the check-in's purpose line and the skill's Daily check-in section say that where no agent can make an update (the plugin and the saved skill card), the coordinator guides the owner with the exact step.

### Changed

- The governance question bank asks the parallel CI shards question in the first bank too, not only once governance is on. A yes or never needs governance turned on in the same answer and joins the one turn-on pull request: the binding records `ci_shards`, and a yes adds a first `.github/toolkit-test-shards.json` and the two shard workflows to that pull request.
- The shards question recommends Yes when the last green CI run took 10 minutes or more, and keeps Not now when CI is faster or its time is unknown. Its "More on" line says when Yes is recommended and where Yes puts the list and workflows.
- In a governed repository, an answer that changes task auto-merge or merge trains and also answers the shards question makes one binding pull request with both, instead of holding the shards answer for the next refresh.
- The turn-on pull request renders the shard workflows from its own `ci_shards` answer, not from this computer's last read of the merged binding.
- The turn-on pull request also adds a `.github/dependabot.yml` and the dependency auto-merge workflow where they are missing, so governance does not start with its own security check failing. An existing file is never changed.
- From an app's plugin copy, which has no git, the cloud workflow copies and the shard readers check use the managed Toolkit checkout the bridge keeps current, so turning governance on from any app carries the copies.
- The cloud workflows installer reads the merged binding again before it uses the `ci_shards` answer, so a copy step run soon after the answer merged does not act on an older read.
- Shard Timings without the governance App stays green when a refresh is due and writes a warning naming the owner's step (`--warn-if-due`), because the App is optional.
- **Parent graph columns:** the graph is `Task | Child # | Status | Waiting on | Last Updated (SGT)`. The task name and its number are separate again, and the parent names no PRs (each task page lists every one). Status is `NOW · IN PROGRESS`, `NOW · QUEUED` for a task in progress whose state lists a blocker, `LATER` for every other open task (optional ones too), or `COMPLETED` and `RETIRED`.

### Fixed

- The minutes line says "1 runner minute", not "1 runner minutes".
- **Parent page never redrawn on a busy programme:** the sweep refused to write the parent whenever any comment landed on it during the pass, because a comment moves the issue's update time. A busy parent gets decision and merge records every few minutes, so pass after pass held with `BODY_MOVED` and the page kept an old layout. The page is now held only when its body itself changed; the next pass picks up anything a new comment changes.
- **`BLOCK_BEHIND` false alarms:** a task page drawn by an older Toolkit at the stored revision was reported as showing an older state. The check now compares the page's drawn state revision with the stored one, and only for pages in that pass.
- **`BODY_OVER_BUDGET` next step:** it now names a step that clears it on each kind of page: a `mark-archive` holder order on the parent or a task page, and the builder trimming the description to the CHANGE shape on a PR page.

### Added

- **Marked notes on task pages:** old notes under one `## Archive` line on an open task page leave it when the page is laid out. The whole page is saved to the private store first, and one `Archived notes: [page copy](...)` line links that copy.
- **`mark-archive` holder order write:** the only write to a page's hand-written text, so nobody edits a page by hand. It puts one `## Archive` line above a named line, or removes named link lines nothing on the page uses, on the parent or an open task page. It saves a copy of the page first, checks the result with the reader that will move the notes, and refuses on any change.
- **Handover link:** the parent's AGENT CONTEXT line links its handover file in the private store.

## 3.127.0 (the plugin delivers the governed rules)

### Added

- Session start gives the governed rules: in a repository whose merged binding is enabled, Claude Code's session-start context and Codex's session-start output carry the full governed rules from the installed Toolkit, tagged with its version, so the repository needs no copy of them in `AGENTS.md`. Disabled, undecided, unreadable and error states get none.
- Cloud sessions that start outside a repository, such as a Claude Projects thread in `/home/user`, read each repository cloned directly under the start folder, name each one's governance state and give the governed rules once for the enabled ones.
- New `toolkit-playbooks` skill: the sixteen working playbooks now ship with the plugin, with the index as its `SKILL.md`, on every host that loads Toolkit skills.

### Changed

- The playbooks moved out of `repository-agent-rules`; turn-on pull requests still write them into `docs/agent-playbooks/` until turn-on stops writing repository files.
- Conformance: an enabled repository with no governed block is no longer drift. A block still there is reported once as a leftover copy to remove by pull request once every app working there runs this version.
- Global rules say where the governed rules and playbooks come from when no session hook runs; the governed rules drop the playbook-index install line.

## 3.126.0 (leftovers join their area's open child; governance App setup command)

### Changed

- **Leftovers join their area's open child:** the governed rules, the controller's task intake and its findings and review follow-up rules now send review Lows and other leftovers to the open child for the same area (same page, script or feature) instead of a new child per review. A closing child moves its remainder there too. The governed rules stay within their size cap.
- **Daily fold check:** the Projects daily check-in lists each issue opened under the parent since its last run beside any older open child in the same area, as a `**Fold:**` line. The coordinator copies the text across and asks the owner once to close the new issue.

### Merge scope

- **Permission-line pin test waits for the owner:** a change to `repo/tests/toolkit-permissions.test.cjs`, the test that pins the commands and flags each pasted permission line allows, now needs the owner's typed merge. A new command, subcommand or flag on a pasted line fails that test, so that change now waits for the owner's typed merge; a changed check behind an existing flag still relies on review.

### Added

- `toolkit governance` shows a Governance App row that recommends Set up whenever governance is on or being turned on. Set up prints one command for the owner to run in their own terminal: it makes the repository's App through GitHub's App manifest flow (the owner only clicks Create), saves its Client ID and private key on the repository without the key ever being printed or written to disk, opens the install page and checks the installation. Keep current means not now: governance works without the App.

## 3.125.0

### Changed

- A new top Development Principle, Accuracy first: zero hallucinations and no false data is always the top priority, and every claim, status or done verdict is checked in depth against its sources rather than skimmed.
- Tests first now says what makes a test worth keeping: it fails on the old code for the right reason or guards a real contract, through the real code path with realistic inputs. Reviews flag data shaped to the assertion, test-only branches, a stubbed unit under test, duplicates and tautologies.
- The PR review playbook applies both: check each claim against its source and run each new or changed test against the old code.

### Fixed

- **Holder orders stop at their expiry:** `run-order` reads the order's expiry again before every write, not only at the start. A run, including one the cloud sweep takes from the queue, that reaches the expiry makes no further write, keeps the log entries for the writes before it, reports `STOPPED` with `ORDER_EXPIRED` and files the queued order under `orders/refused/` with those results, so a later run never repeats or finishes it.

## 3.124.0 (governance yes opens the question bank)

### Added

- Programme reconciler: `programme.cjs handover --issue <n>` writes one generated handover file per task, and one for the parent, to the private evidence store at `handover/issue-<n>.md`, so a fresh session can resume from the issue number alone. It holds the path, status, next action, open PRs, holds and findings, recent decisions, the plan and evidence links; gates run it at each gate end, and any session may write it.
- Programme reconciler: drift findings. A full pass reports an open task page with no generated blocks (`BLOCKS_MISSING`) or an older state than the stored one (`BLOCK_BEHIND`), an open task PR without a readable PATH block (`PR_NAV_MISSING`), a closed issue an open task PR names outside the programme (`CHILD_NOT_NATIVE`) and a next action set before its task's latest merge or close (`NEXT_ACTION_STALE`). Each resolves by itself once its condition is gone.

### Changed

- Programme reconciler: one page-copy format. Every saved copy of a programme page is the page's exact text at `page-copies/issue-<n>/<sha256>.md` in the private store, for marked notes and re-laid task pages alike, after the private-store check and the secret screen. Older JSON copies still read. `ARCHIVE_COMMENT_UNTRUSTED` names a saved copy only when that copy is in the store.
- Rules: the governed rules say the parent page shows queue and status while each child and PR shows SHA, release, gate, review and UAT, that gate ends run `programme.cjs handover`, and how a related task is reused. The global rules give the PR body the CHANGE shape (WHY, WHAT, CHECKED, `UAT:`, `Closes`/`Refs`). The decision-trace and takeover playbooks and the bootstrap skill read the handover file.
- Answering yes to the governance question (the card, a typed `toolkit governance enable`, or `enable` in your own terminal) now opens the governance question bank instead of a bare decision. The bank's own script then makes the one setup pull request, so chats no longer build the programme file, rules files, parent issue or evidence store by hand.
- A yes can no longer be published with `toolkit governance publish --run`. A turn-on pull request that is missing any of the rules set (the governed AGENTS.md block, a CLAUDE.md that loads it, the playbooks and the plain-text check) is refused. A repository already prepared by hand gets the missing files rendered into the same pull request.
- On a public repository, the bank shows a visibility line before you answer: the programme file names your private evidence store (its name only) and the parent issue is public. Nothing stops after you answer.

## 3.123.0 (robust page refresh)

### Changed

- **Cloud sweep request cap:** a scheduled sweep on GitHub sends at most 1,500 requests, what fits in half its 50-minute budget at about a second a request, so a full pass leaves half its time for a slow GitHub. It still stops earlier when GitHub's remaining hourly count for the governance App reaches the safety margin. A pass stopped at the cap saves its place and starts its follow-up run at once, so a big board keeps draining. The run summary shows the cap as a number.

### Fixed

- **Two or more comments on one page in one pass:** GitHub moves an issue's update time to that of any comment posted or edited on it, so the page writer took its own archive or index comment for someone else's edit, stopped with `BODY_MOVED`, and left the page for the next pass. It now tells this pass's own comment times apart: a page whose body is unchanged and whose update time is exactly one of its own comments' times is written in the same pass. A person's comment or body edit in between still holds the page.

### Added

- **Refresh failure suite:** tests for GitHub slowness, the hour's allowance running out mid-run, a page edited mid-run, a stop in every queue phase and mid-way through the task pages, and two or more comments on one page. Each ends in a resumed run that completes every page, plus a loud finding or hold. The test fake now moves an issue's update time on every comment post and edit, as GitHub does.

## 3.122.0 (parent page layout; task and PR page layout)

### Changed

- **Programme graph:** the parent's graph has the columns `Task | PRs | Status | Waiting on | Updated (SGT)`. The task cell starts with the child number. PRs shows the three newest, then a count of the rest. Status joins the group and the status, such as `NOW · IN PROGRESS`, or shows `COMPLETED` or `RETIRED`. Waiting on names the owner's decision or UAT, a blocker, or the gate the task is in.
- **Completed and retired rows:** the parent keeps the latest 10 COMPLETED rows. Older completed rows and every RETIRED row sit in the graph archive comments, behind one `Earlier completed · Retired` link line under the table. Archive comments use the same columns.
- **CURRENT:** the summary is slim. It keeps the board line, the tasks in progress with their PR, gate and any wait on the owner, and one line with the attention counts, the number of held tasks and the `programme.cjs attention` command. A stopped pass still shows in full. The Start next line and the finding lists are gone: the graph's order shows what starts next, and the attention command lists every finding.
- **AGENT CONTEXT:** the block is one line: the Agent context comment, any archived notes and the `programme.cjs trace` command.
- The hourly nudge reads the next task from the graph's LATER rows and each task's next action from its task page. When the state store cannot be read, it reports only the parent's Attention line and counts, and says the finding list needs the store or a shell.
- **Task pages:** an open task page is laid out as PATH, then `# TASK` with `## WHAT`, `## WHY` (the problem, the fix and what happens if we skip it as bold labels), `## DONE WHEN` (with an optional not-in-scope label) and `## PLAN`, then the generated PR GRAPH and a one-line STATUS, then one AGENT CONTEXT line, then More. Older pages convert on their next lay-out without changing a word; a heading written inside a part stays in it, and text added under the blocks goes to More.
- **PR GRAPH:** a task's PRs show as a table of PR, status, gate and merge commit: every open PR, the latest ten finished ones, then one `Earlier:` line. STATUS is one line with the status, gate, what waits on you, UAT and review (marked `STALE_HEAD` at an older head), the next action and the release. CI and head SHAs are left to the PR itself.
- **PR pages:** an open PR that names a task keeps PATH at the top and gets STATUS (one line per task) and AGENT CONTEXT under the author's description. A description that ends inside an open code block, HTML block or details section keeps the status block under PATH.
- **Frozen closed tasks:** a closed task page whose status already shows `COMPLETED` or `RETIRED` is never drawn again, so a pass writes only open tasks and the parent. A reopened task is drawn again, and a frozen page whose task moved under another parent gets its new PATH once.
- **Page budgets:** each pass raises `BODY_OVER_BUDGET`, with the largest parts named, for a task page at 4,000 characters or more and an open PR page at 3,000 or more.

### Added

- **Parent budget:** a parent page of 10,000 characters or more raises `BODY_OVER_BUDGET` with the sizes of its largest parts. The page is still written, and the finding clears once the page is under budget.

### Fixed

- Whether a task page can be laid out is checked on its hand-written text with the blocks cut out, so a block marker that closes a comment left open above it no longer lets a held page flip into a new layout on the next pass.

## 3.121.0

### Changed

- `toolkit governance` now shows its choices as one typed question bank in every app, Claude Code included, the same way as `setup toolkit`: the whole list at once, answered in one line such as `all recommended` or `1.4=B`. The governance bank no longer splits its rows over tap cards. The single yes or no governance card and the merge card stay.
- The parallel CI shards question is now one short line, "Run tests in parallel CI jobs so they finish faster? It uses about the same CI minutes.", with the details, the minutes estimate and why Not now is recommended on one "More on" line under it.
- **Programme Sweep gate:** a closed issue now starts the cloud sweep at once instead of waiting until an hour after the last sweep, so the programme board stops showing a closed task as open within minutes. A pass paused at GitHub's hourly App limit still waits for the reset, and a queued or running sweep is handled as for any other activity.

## 3.120.2

### Fixed

- The CI check-up's `speed.edits` row, on a workflow with a route job, again flags ungated jobs without a matrix when they outnumber the jobs the route gates (the route and the `!cancelled()` or `always()` aggregates are not counted), and no longer calls a job that the route gates itself "skipped too".

## 3.120.1

### Fixed

- The CI check-up's `speed.edits` row accepts a route job that reads the event and sets an output the test jobs need and skip on, so the Toolkit's own Validate workflow no longer shows a false finding. It still flags a route job that gates no test legs, and now also flags a job that needs a route-skipped job without `!cancelled()` or `always()`, because a required check on it would never pass after an edit.

## 3.120.0

### Fixed

- `toolkit permissions --apply` and `--remove` now name only the apps whose files they wrote in the closing restart line, so `--host claude` no longer tells you to restart Codex.

### Changed

- **Review rounds have limits:** a High or Medium finding blocks only with proof, a failing test or a supported-path trace with the reason. An unproven Medium becomes a Low follow-up, and an unproven High goes to the owner's card instead of blocking on its own.
- **Rechecks after a FAIL are scope-locked:** they review the fix commits, the earlier findings and what the fixes reach. A new finding on code no fix touched blocks only if it is High and proved; anything else joins the PR's follow-up record.
- **Round cap:** after two FAIL verdicts on one PR, no further review round starts until the owner answers a card: ship with the open items as follow-ups (when none breaks the shipping floor), one more round, or split the PR. The controller counts the PR's FAIL verdict comments before each recheck, and the Projects coordinator's recheck briefs carry the scope lock and the FAIL count.
- **Gate rules budget:** the gate rules' byte cap rises from 14,400 to 15,150 to hold these rules.

## 3.119.1

### Fixed

- **Programme Sweep footer cleaning after a held pass that saved nothing:** A cloud sweep pass that holds and lands no state save no longer reports `refreshed`, even when the reconciler does not report it as saving nothing. A pass held because a newer Toolkit drew the board (`BLOCK_NEWER_TOOLKIT`, a worker older than the board) never reports `refreshed` either, since it left the page as it was. The footer step then edits no posts, and the pass is still reported as held. A regression runs an older worker against a newer board in a real cloud pass and checks that `refreshed` stays unset and footer cleaning is skipped.

## 3.119.0 (parallel CI shards question)

### Added

- **Parallel CI shards question:** `refresh governance` in a repository whose merged binding turns governance on asks "Split this repository's tests into parallel CI shards?" with yes, not now or never ask, and shows the runner minutes of the largest recent green CI run on the default branch, or says they are unknown. It is never asked in an ungoverned repository. Not now writes nothing and the next refresh asks again; never stops the question.
- Yes and never are each one binding pull request that sets only `ci_shards` (`answer`, `offered_at`) in the exact merged binding text, with the Toolkit version line in its body. A yes also adds a first `.github/toolkit-test-shards.json` when there is none: Node tests run with `node --test`, one rest shard plus one named Linux shard per 10 measured minutes, or two shards when the minutes are unknown. For other tests it writes no list and says so.
- The answer is refused while a pinned `.toolkit` sweep copy in the repository runs a Toolkit older than the one that reads `ci_shards`, naming the step: refresh the repository rules first.

### Changed

- The cloud workflows installer copies the test shards workflow and Shard Timings only when the merged binding answers yes to `ci_shards` and the shard list is usable; otherwise it says they were not copied and why.
- `toolkit governance check` reports a test shards copy left at an older workflow name as drift, and suggests making `Toolkit test shards` a required check while the copy is in place and it is not required. It never sets the check.

### Fixed

- In Claude Code, `toolkit governance` now shows the owner only the question card. The prompt hook used to tell the agent to show the setup output in full, so the agent's own instructions and the card's input reached the owner's screen as text and no card appeared. The hook now tells the agent to follow the bank's `Agents` paragraph and never show it, and the bank keeps every agent-only line in that last paragraph.

## 3.118.1

### Changed

- The global rules tell agents to report on the coding app they run in and to raise another app's state only when the user asks.

## 3.118.0

### Changed

- Validate now runs `check-script-references.cjs`, so a permission row or document that names a missing or retired script fails CI.
- The Projects daily check-in runs the decision trace audit and the CI check-up through `toolkit-controller-check.cjs`, once a day. The hourly nudge skips both (`--skip programme,traces,ci`) and no longer clones the project's repository, so the two tasks stop running the same checks.

## 3.117.0

### Fixed

- The decision-trace audit and `programme.cjs trace` no longer read the record a comment replaces as its own record ID when its text starts with `SUPERSEDES=`. A record ID inside a `SUPERSEDES=` token now only names the replaced record, wherever the token sits, so a record written `SUPERSEDES=` first no longer shows as a false "superseded by itself" finding.

### Changed

- The governance question bank has a Merge trains row (1.3) for the repository's `task_prs.merge_train` switch. Like task auto-merge, it can be on only while governance is on, or in the same answer that turns it on; otherwise it reads "Off (needs governance)". Turning governance on writes both switches into the programme file, off unless the answer turns them on, so a repository that turns governance on from now on gets merge trains off unless the owner picks On; governed repositories with no `merge_train` key still read as on. A later change opens one pull request that sets only the switches that change, adding a missing switch in place.
- In Claude Code a bank with more than four rows, such as a new repository with a found evidence store, is now shown as several question cards tapped in order instead of a typed table. Only the next card runs, and the last card's taps return the whole answer with a one-use ticket.

## 3.116.0 (merge train finder)

### Added

- `repo/scripts/toolkit-controller-check.cjs`: one read-only call runs every Toolkit checker that fits where it runs (the Projects guidebook, instructions, memory and task checks only in Claude Projects; programme attention and decision traces only where governance is on; CI drift and leftover footers for any controller) and prints one line when nothing needs action. Findings come compact, counted by code with the top items; `--expand` prints everything.
- The Projects hourly nudge runs it in its guidebook step, so each run also covers decision traces, CI drift and leftover footers, and a new `CONTROLLER CHECK` first-line prefix names what needs action.
- `repo/scripts/check-script-references.cjs` and the registry `repo/contracts/retired-scripts.json`: flag any permission row or document that names a retired or missing script. The controller check runs it as its `refs` row.
- `CONTROLLER.md`: a controller runs it at session start and on each periodic run instead of recalling state from memory.
- **Merge train finder:** `toolkit-merge-train.cjs find --out <file>` picks the pull requests ready to board a train and writes the manifest `build` takes. Ready means open, not a draft, on the default branch, a passing review verdict comment for the current head, green required checks, one `Bump:` line, an accepted `UAT:` line, no version bump of its own and no open train holding it. Each member's tier is the higher of its verdict's tier and the risk-tier list's tier for its changed files. It takes at most six, oldest first, and with fewer than two it says to merge the one alone. It reads only, never fills the owner's OK for a RISKY member, and refuses where merge trains are off.
- **Review verdict comments:** each G2 pass or fail also goes on the pull request as one comment whose first line is `Toolkit-G2: PASS|FAIL <full head SHA> tier=<tier>`. The finder reads only that line, and only from accounts that can write to the repository. The hourly run's `train due` flag uses the finder.
- **Merge-authority list:** the finder joins the files whose changes wait for the owner's typed merge, because it sets the member tiers the train's no-card route reads.

### Fixed

- The Projects daily check-in reads each PR check by name from its newest run on the head only, because a re-run supersedes older runs.

- The footer sweep reads GitHub lists by numbered pages (at most 100), so it also runs in cloud sessions, whose proxy refuses the numeric-ID next-page links that `gh api --paginate` follows. It stops reading pull requests at the first page older than its window.

## 3.115.0 (sharded test workflow copies for governed repositories; governance turns on in a new repository)

### Added

- **Test shards workflow for governed repositories:** where a governed repository has a usable shard list (`.github/toolkit-test-shards.json`), the cloud workflows installer copies a test shards workflow into it, pinned to a Toolkit commit like the sweep copies. It runs a matrix job per system with the list's shard ids, uploads each shard's summary under the same artifact name as the Toolkit's own shards, and a gate job, `Toolkit test shards`, fails unless every discovered test file ran exactly once on each system on the commit and passed, naming any file that did not. It reads the repository only, uses no secret and adds to the repository's own CI without replacing it.
- **`run-tests.cjs --repo-root <dir> --verify <folder>`:** the gate check over a run's shard summaries.
- **Shard Timings for governed repositories:** the same repositories get a Shard Timings copy, and `refresh-shard-timings.cjs --repo-root <checkout>` refreshes a v2 shard list from the newest green run of the workflow the list names, writing per-file times and rebalanced named shards back to that list. The Toolkit's own v1 manifest, Validate runs and Shard Timings are unchanged.

### Changed

- The installer copies neither workflow into a repository without a usable shard list and says why. A change to the list's shards makes the test shards copy outdated, not edited, and `toolkit governance check` reports the new copies' drift with what it costs the repository.
- Turning governance off removes the test shards and Shard Timings copies too, and the left-over reports name them. The Toolkit copies are now found by their rendered-copy marker, so the test shards copy is found at whatever name its shard list chose, and a marker for another copy at a path does not count.
- A test shards or Shard Timings copy left after the shard list went missing, stopped validating or names an unsupported program is drift in `toolkit governance check`, with the fix: repair the list, or remove the shard copies in a pull request.
- The shard copies run on the repository's default branch: the installer renders it into their push trigger, and `refresh-shard-timings.cjs` takes `--branch <name>` for a governed list (or asks GitHub), using it for runs, refresh pull requests and their base. The Toolkit's own refresh stays on main.
- Turning governance on from the governance question bank now works in a new repository. The bank shows the evidence store, parent issue and required checks it found, or says what it will make; an existing store that is not `TRANSPORT-<name>` becomes a question (keep it, or create a new private one). After the owner's answer Toolkit creates a missing private `TRANSPORT-<name>` evidence store (read back as private and the owner's, seeded with `archives/README.md`) and a missing parent issue, then puts the programme file, the governed `AGENTS.md` block, the `CLAUDE.md` shim, the playbooks and the plain-text check into the one turn-on pull request. Text outside the block markers keeps its bytes, and the working tree's instruction files are not changed.
- A failed step stops with what was made and what was not; answering again reuses a store or issue made earlier. When GitHub cannot be searched, nothing is made.
- `toolkit governance check` now tells a repository with no merged decision to say `toolkit governance` and answer its bank in chat, instead of running enable or disable in a terminal.
- In Claude Code the governance question bank is answered on the app's own question card instead of a typed reply. Toolkit lets only the exact card it printed through, and the owner's taps come back as one answer with a one-use ticket. Codex keeps the typed reply. A shown bank no longer ends as Failed.
- The bank's permissions row is now one row per app, "Toolkit permissions (Claude Code)" or "(Codex)", with Keep current, Update or Remove. Its state reads Up to date or "Outdated: N missing, M old". Update and Remove give the owner one command to run in their own terminal: it previews, backs up and waits for a typed `apply`. The bank says any other app needs `toolkit governance` run there too.
- Task auto-merge can be turned on only while governance is on, or in the same answer that turns it on; otherwise it reads "Off (needs governance)".
- `toolkit governance security` also turns on GitHub's "Automatically delete head branches" (check S8), so merged branches do not pile up.

### Known limits

- The test shards jobs set up Node only, so the installer refuses a list whose command starts with another program (such as `python`, `pytest` or `npx`), naming it, and copies neither workflow there.

### Fixed

- The Toolkit permission blocks no longer carry the retired Windows scheduled task lines (`tasks-plan`, `tasks-list`, `tasks-list-all`). Applying the blocks now also takes out Toolkit lines that are no longer in them, and `--remove` takes every Toolkit permission line out, with the same preview, backup and typed `apply`.

## 3.114.0 (merge trains follow governance)

### Changed

- **Merge trains follow governance:** trains run only where governance is enabled and the merged binding's new `task_prs.merge_train` switch is not `off`; no key means on. Elsewhere `toolkit-merge-train.cjs build`, `catchup` and `land` refuse and each ready pull request merges alone, and a train already in flight cannot land. `verify`, `body`, `split` and `eject` still check or unwind a train.
- **Trains land on task auto-merge:** `land` now names a route. `auto` means the repository's task auto-merge switch is on, the train passes the auto-merge scope and `UAT:` check at its head and no member is RISKY, so it merges after the effects notice with no merge card. `owner` lists its reasons and waits for the owner's card.
- **Binding:** `task_prs` may hold `merge_train` (`on` or `off`) beside `auto_merge`. Toolkit copies older than this release show governance ERROR on a binding that sets it.
- **Stale reads ask for a fresh read:** when this computer's read of the binding is stale or missing, the train commands say to read it again online (`toolkit-governance.cjs status`) and retry, instead of telling the agent to merge each pull request alone.
- **Merge-authority list:** `toolkit-merge-train.cjs` joins the files whose changes wait for the owner's typed merge, because its `land` step names the route that merges without a card.
- The Projects hourly nudge now works the programme attention list instead of only listing it. With no signed-in `gh`, it reads the findings from the stored parent document that the cloud sweep keeps current. Any `new` finding opens the run's first line with `PROGRAMME FINDINGS`, and the controller acts on it that turn: it posts missing closing stories itself, folds every other holder write into one holder order queued for the cloud sweep, and sends only owner-only steps to the owner.
- The Projects daily check-in now runs the checks that had nothing running them. The decision-trace audit raises `TRACE GAPS`. A scheduled-workflow health read raises `WORKFLOW FAILING`. The CI check-up raises `CI GAPS` for each clear gap, and its judgement rows stay advice.

### Fixed

- The decision-trace audit now reads issue comments in numbered pages, so it runs where a proxy refuses `gh api --paginate`.

## 3.113.0 (governed repositories can shard tests in any language)

### Fixed

- The cloud sweep gate no longer counts a green sweep run that made no pass (queued behind another sweep's lease, main moved, or off the default branch) as the last sweep, so changes and the six-hour refresh are measured from the last pass that did work and the hourly start picks changes up. Activity still waits an hour after the newest run, so a lease held elsewhere never starts a run per edit. A run paused at GitHub's hourly App limit still counts, so the wait for the reset holds.

### Added

- A governed repository can keep its own test shard list at `.github/toolkit-test-shards.json` (schema `toolkit-test-shards/v2`): Toolkit's shard list plus, per system, a `discover` glob and a `command` with one `{files}` argument. `run-tests.cjs --repo-root <dir> --shard <id> --os <system>` runs the command once per file with no shell, three at a time, stops a file that runs past `file_timeout_seconds` (default 900), times each file and writes the same shard summary as Toolkit's own shards. `--check` and `--plan` read the list without running anything.
- The programme binding accepts a `ci_shards` key (`answer` yes, not-now or never, and `offered_at`) for the sharded CI offer. This release only reads it; nothing writes or acts on it yet, so every copy knows the key before a later release sets it.

## 3.112.0 (Projects tasks load their instructions every run; design principles; governance question bank)

### Changed

- The daily check-in and hourly nudge now store only a short pointer, their params block and the project additions. Each run clones Toolkit main and prints its instructions with `toolkit-projects-tasks.cjs --expand <kind> --params <file>`, so a Toolkit release reaches every project's tasks on their next run with no rebuild.
- `--check` compares the pointer's text, not its version stamp, so a release alone no longer marks tasks outdated. A prompt that still stores the full instructions checks `outdated`, and `--refresh` turns it into the pointer, keeping its params and project text byte for byte.
- An outdated task is now swapped in place with `update_trigger`, keeping its id, run history, schedule and home thread. A task is recreated only to move it between bound and fresh.
- The Toolkit project's daily check-in reports `PROJECT TASKS OUTDATED` for another project's enabled check-in or nudge that is not a current pointer, and its coordinator swaps those in place, prompt only. Disabled tasks are listed and left alone.
- A run that cannot load its instructions posts `TASK LOAD FAILED` in its home thread instead of running from memory.
- `--expand` reads params tolerantly: it drops keys it no longer knows and migrates pre-tier values, so a pointer stored by an older release still loads.
- `toolkit governance`, `setup governance` and `refresh governance` now show a question bank in the same format as `setup toolkit`: GitHub governance on or off, task auto-merge on or off, and Toolkit's permission blocks, each with at most three lettered choices and `A. Keep current` first, plus the evidence store and required checks as status lines. The owner replies `all recommended` or only their changes, such as `1.2=B`, in chat. Turning governance on or off no longer needs the owner's own terminal.
- Only the owner answers the bank: the prompt hook gives the owner's next own message after the bank a one-use ticket bound to the session, its run, the repository and the bank shown, and the bank acts only with that ticket. A launched session, a relayed or scheduled prompt, a repeated Projects delivery, another session or a changed bank gets none. Every change is still one pull request the owner merges.
- Picking "Add them for me" on the permission row is the owner's own ask for the agent to add the printed blocks (backed up first and read back); "Show me the command" prints them with the one command the owner pastes.
- The question bank format (table, choice letters, Keep current folding, bank reference and reply reading) now lives in one shared module used by both setup and governance; setup's output is unchanged.

### Added

- The global rules gain a Development Principles section that steers all development in every repository: tests first, fast CI that improves itself, grouped changes, slim code, platform features first, never silently wrong, generic shared rules, one source of truth, lean always-on text, checks over judgement, vetted outside material, the cheapest capable route, root-cause fixes, ship then improve, risk-based checking, privacy by default, plain words, written not remembered, feedback as input, readers before writers and owner-only branch deletes.
- The governed rules gain a Governance Principles section for governed repositories: only needed files, reuse first, checks not memory, the owner reads and clicks, and per-repository settings.
- A new controller page, design principles, collects the owner's standing principles for controllers, with no project-specific references. It binds above every skill, project line and brief, and the Projects skill no longer outranks it.
- The controller core now points to the global change-local hygiene rule and the governed transport-store rule instead of restating them, and the controller principles drop lines the global rules already cover.

### Removed

- `refresh governance --set on|off` and the terminal-only `setup governance` questions; the bank replaces both.

## 3.111.0 (setup stops all scheduled task work)

### Changed

- Setup and refresh no longer create, update or start scheduled tasks on a computer, and the "May Toolkit update scheduled tasks on this computer?" question is gone. The cloud runs the programme sweep, footer cleaning and shard timings. Setup's `--scheduled-task-update` option is accepted and ignored with one notice.
- On Windows, setup reads Toolkit's task record and prints one line naming how many old Toolkit tasks are still recorded, pointing to `remove toolkit`. It never changes them.
- An old Toolkit task that still fires runs a retired stub: one line, no writes, exit 0. `toolkit update scheduled task` prints the same kind of retired line, and its permission rows are gone; the old task apply and start commands now ask.
- `remove toolkit` no longer notes scheduled tasks for a later reinstall, and setup no longer offers to restore them. A task list an older removal noted is ignored and dropped by the next write.
- Session start no longer prints the Windows task lines. The cloud sweep's health reaches it through the attention line, which reports a stuck sweep.
- The global rules lose the Toolkit task standing approval, and the safety-gates playbook, takeover playbook and Projects guidebook lose the device task route. Projects now reads the cloud Programme Sweep workflow's latest run, and the hourly nudge reports `CLOUD SWEEP` when it failed, skipped or has not run for 2 hours.

### Added

- `toolkit governance check` names a governed repository the cloud sweep skips (state on a public branch, or an evidence store under another owner), with the fix. The sweep's own skip warnings no longer point to a computer sweep.
- Setup and refresh name each governed repository this computer knows that the cloud sweep skips, one line per reason it can tell offline, and point at `toolkit governance check` for the governance App and the sweep workflow.

## 3.110.2

### Fixed

- **`toolkit governance` shows the permission blocks in full:** the guide now tells the agent to show the governance output once, in full and as printed, with the permission table and every block, and never to summarise or repeat it. An agent had left the blocks out as too long and printed its summary twice.

## 3.110.1

### Changed

- `setup toolkit` and `refresh toolkit` now install, refresh and report the Toolkit global rules only for the app they run in (plus Antigravity when managed). Claude Code setup no longer writes or reports `~/.codex/AGENTS.md`, Codex's instruction limit or a hand-written section in Codex's file, and Codex setup no longer touches Claude Code's file; each app keeps its own file current at its own session start. `remove toolkit` for every app and `toolkit-global-rules.cjs` without `--harness` still cover both apps.
- An update report names only the plugin version of the app that triggered it.
- Setup's checklist and PR-branch warning, the final audit step title, two merge-hold refusals and the attribution repair message no longer name Claude or Codex.

## 3.110.0 (cloud sweep runs queued holder orders)

### Removed

- `toolkit governance reopen` and `toolkit governance catalogue` are gone. Nothing called them: reopen only printed "Nothing changed", and the catalogue was a list nobody read once `toolkit cmd` stopped offering it.
- The per-state skill catalogue code and its skill tier file go with it, and `toolkit governance check` no longer reports catalogue drift. The skill routing test still checks that every routed skill exists.
- The governance guard no longer lists `reopen` or `repair` as decision words, since neither is a governance command.

### Added

- The cloud Programme Sweep now runs holder orders the controller queues in the private evidence store (`orders/pending/<order_id>.json`, or `.dry-run.json` for a rehearsal). Each runs at the start of the pass, inside the sweep lease, with `run-order`'s own rules, and is filed under `orders/done/` or `orders/refused/` with its result, so a controller with no shell no longer needs a session on a computer for its board writes. The run summary shows only counts and warns when an order was refused.

## 3.109.0

### Changed

- Programme catalogue entries can be pinned last with `last: true`. A pinned open task sorts after every other open task in the Programme Graph, the Start next pick and the native sub-issue order, so a final clean-up task stays last however many tasks the sweep adds later. Pinned tasks tie only with each other, and the graph's order line names them while one is open. Set the pin only once every copy that reads the parent runs this release: older copies refuse `last` as an unknown field.

## 3.108.0 (shorter command list)

### Changed

- **`toolkit cmd` lists only what you would type:** setup, refresh and remove Toolkit; `toolkit env` (or `toolkit show env`); `toolkit governance` (or `governance setup`); and `merge N`. `setup governance` and `refresh governance` open the same governance guide. The typed shortcuts for the governance tools (`toolkit governance status`, `check`, `discover`, `catalogue`, `security` and `migrate`) are gone: agents, setup and CI run those tools directly. `toolkit permissions` and `toolkit update scheduled task` are off the list.
- **`toolkit governance` is now a guide:** typed as a whole message (or `governance setup`), it runs governance setup, which in a governed repository shows the merged answers, and then offers the next step: turn governance on, change task auto-merge or turn it off. Each change is one pull request for you to merge.
- **`toolkit env` is a typed command:** it opens the keys editor, the same as `toolkit show env`.

## 3.107.0 (permission blocks shown in full, added on the owner's ask)

### Changed

- `refresh governance` now shows the computer block as well as the repository's, with the table, so governance setup covers permission setup.
- `toolkit permissions` opens with a plain table of every Toolkit command the blocks allow: what it lets an agent do, what still asks and what still checks it.
- `refresh governance` and `toolkit permissions` replies now show the permission block in full, with the file it goes in and one command the owner pastes into their own PowerShell or terminal. The app can fold command output away, so the agent repeats the block in its reply.
- `toolkit permissions --apply` also merges the Claude Code repo block into a governed repository's `.claude/settings.local.json`, from that repository's folder or with `--repo-root <checkout>`, backs it up and reads it back. The printed command carries `--repo-root` when a repo block was printed.
- Editing the agent's own permission settings is no longer a hard stop. An agent does it only when the owner asks in their own message: exactly the lines shown, backed up first, every other line kept, then read back. A server-copied quote of the owner's words counts; another agent's summary or request does not, and neither does the agent's own initiative or a ledger entry. Agents still never run `--apply`.

## 3.106.0 (every open PR attended)

### Changed

- **Hourly nudge checks every open PR:** the PR step now runs every hour, even when nothing else changed, because a bot or workflow PR wakes no thread. It covers the repository and the project's evidence store, gives each open PR its owner and live next step, and flags any PR with neither as `PR UNOWNED` on the report's first line.
- **Daily check-in flags unowned PRs:** its GitHub step also covers the evidence store and lists an open PR that no thread owns or watches and no merge train holds under `PR ATTENTION`, with the reason `unowned`.
- **Coordinator routes unowned PRs the same turn:** the periodic-runs reference says how: a reviewed green PR goes to the merge train, anything else to its builder, a reviewer or a fresh lane, or a close with the reason after the owner's OK. The Projects skill now says every open PR, bots' included, needs an owner and a next step.

## 3.105.2

### Fixed

- **Programme Sweep footer cleaning after an unverified save:** A cloud sweep pass whose state commit did not read back as written (a `STATE_READBACK_MISMATCH` hold, with no verified state write) no longer reports `refreshed`, so the footer step edits no posts in the governed repository or its evidence store. The pass is still reported as held. A regression forces the read-back mismatch in a real cloud pass and checks that `refreshed` stays unset and footer cleaning is skipped.

## 3.105.1

### Fixed

- **Evidence-store merges in cloud sessions:** cloud store merges were still refused for want of the user's approval, from the clones folder and from the store's own clone alike. The on-demand read of the parent's merged binding handed git a timeout that was not a whole number of milliseconds, which Node refuses, so every read failed as if GitHub were unreachable. The binding read now always gives git a whole-millisecond timeout.
- **Evidence-store merges from the store's own clone in cloud sessions:** a cloud thread that archives evidence works inside the store's clone, where the merge hold looked for a parent binding only in that clone and found none. From inside the store's clone, a cloud session now also reads the merged bindings of the clones beside it in the same shared folder, with the same bounded read and eight-folder cap. Every other check stays: a fresh merged binding that names the exact store, a private writable store, its default branch as the base, the full head SHA and a plain merge commit. Outside cloud sessions nothing changes.

## 3.105.0 (decision records out of page bodies)

### Changed

- **No comment trace in page bodies:** programme parent and task pages no longer carry a generated COMMENT TRACE. Each keeps a short DECISIONS block instead: one line, the command that lists the decisions, and one link to the newest decision comment. The next refresh replaces every old trace block in place; index comments an older Toolkit posted stay as they are.
- **Fewer page writes and no trace paging:** an untagged comment no longer changes a page, and the pass never pages decisions into index or directory comments. Body traces are no longer audited, so `TRACE_UNLINKED` and `TRACE_SUPERSEDED_UNMARKED` are not raised.
- **Rules:** the governed Decision traces line, the decision-trace and takeover playbooks, the bootstrap skill and the reconciler skill now point agents at `programme.cjs trace <n>` instead of the body.

### Added

- **`programme.cjs trace <n>`:** lists an issue's decision records by topic (latest per topic live), with the parent's read separately. It runs the read-only decision history against the checkout's origin and takes `--full`, `--edits`, `--json`, `--max <n>` and `--repo-root <dir>`.

## 3.104.0 (merge card readiness and slice 4 review fixes)

### Fixed

- **Governance answer:** the shell can no longer give the governance answer by putting the decision word after other options, run Toolkit's governance proposal code itself, or reach Toolkit's user state by changing into its folder first. This holds in every folder, with or without a merge hold.
- **Undecided governance:** the governance state no longer carries the old `hold` flag, and the command line, hook comments, gate rules and bridge doc now say that an undecided repository counts as off and nothing waits on the answer.
- **Remove Toolkit:** a changed scheduled task that no longer carries Toolkit's marker can no longer be named with `--include`, and the plan tells the owner to delete it in Task Scheduler instead of offering `--include`.
- With no push key, the re-bump workflow no longer calls a freshly re-bumped pull request stale: a head that already contains main is current. It reads only pull requests into main, and every page of the list and of each pull request's files.
- When the programme sweep gate cannot read the held streak after starting the sweep, its message now says the sweep started.
- A held streak counts across runs that made no pass (queued, paused at the App limit, main moved, off the default branch; each now leaves a `Programme Sweep no pass` notice) and across changed hold codes, and its alert names when the streak began.
- The fallback risk audit shows at most nine annotations per severity and a tenth that says how many more are in the log, so GitHub's limit of ten per step no longer hides the rest silently.

### Added

- `repo/scripts/toolkit-merge-card-ready.cjs` tells the merge thread when it may post the owner's merge card: the head is unchanged, the body's UAT line lets it merge, and the newest Validate run on that head is green. Run again with `--body-sha` after the tap, it refuses to merge if the body changed since the card.
- The Projects controller skill has a merge card reference: fix eligibility lines and every other body edit before the card, and edit nothing on the pull request after the owner's tap until it lands. The PR review playbook says the same.

## 3.103.1

### Changed

- **Projects skill, periodic runs:** the two overlapping lines on acting on task prefixes are now one. Every prefix from any Toolkit task, the daily check-in's included, is a finding the controller owns: it gets an action and a deadline that turn, then `.relayed` and `.done`; a prefix only the owner can clear closes with one confirmed ping; the same prefix on two runs in a row goes to the owner once with the exact step.

## 3.103.0 (Light Validate runs on PR title or body edits; Task runs come first; one task auto-merge switch per repository)

### Changed

- **A pull request title or body edit no longer reruns the test shards when their results already exist.** A new `route` job lets the Validate run go light when the event is an edit with no base change and an earlier run of the workflow tested exactly the same code: the same head, the same tested merge commit, every test and hook-pack job passed in its newest attempt, and its shard summaries still kept. A light run skips the 17 test and hook-pack jobs (13 of them on Windows) and runs only the route, `personal-data`, `issue-closure`, `gate` and `validate` jobs on Linux. Once GitHub has recomputed the merge commit for a moved `main`, the commit differs and the edit runs in full; until then the edit reuses results for the same merge commit a full run would test. Every other event, and any doubt or error, runs in full too.
- **The Validate gate list moved to a new `gate` job.** It runs every repository check and the Pack changes check over the test results of this run, or of the reused run after checking it again (`repo/scripts/ci-validate-route.cjs legs`). The required `validate` job now needs `gate`, `personal-data` and `issue-closure` and checks the shard summaries again. Its name, its `!cancelled()` condition and the `TEST_LEGS: ${{ toJSON(needs) }}` summary check stay as they were, so governance protection P3 and P4 still hold.
- **Shard summaries record the commit they tested.** In GitHub Actions each summary holds `commit`, its artifact name ends with that commit, and `run-tests.cjs --verify-ci` refuses a summary of another commit. `--verify-ci --legs gate` checks the test jobs; without `--legs` it checks the validate job's needs.
- The workflow drift guard, the validation-floor and binding tests, the validation strategy doc, the hook pack README and the secure CI/CD prompt template describe the new jobs.
- **Projects skill trim:** the gate route line drops its long example, since the format and the per-gate example already show it, keeping the skill under its byte cap.
- Task auto-merge is now one switch per repository: `task_prs.auto_merge` (`after-gates` or `off`) in the governance binding merged on the default branch. Every app and the Projects controller read the same switch; no key is off. A working tree, label, project line or app-local file grants nothing.
- Setup no longer asks a task auto-merge question, and the `--task-auto-merge` flag is gone. Setup says once per run, while an older per-app answer is still on the computer, that the switch now lives in each repository's governance.
- The gate rules' Task auto-merge section names the binding switch as the only switch, and the Projects project line is no longer an override.

### Fixed

- **Cloud sweep at the App limit:** a programme sweep pass that stops at GitHub's hourly App limit, or saves nothing, no longer counts as refreshed, so the footer clean-up never runs after it. A stop while reading state documents too large for one GraphQL read now carries the limit that bound it, so the sweep action sees it as an App-limit stop, reports it held and follows up once the limit resets.

### Added

- **Scheduled task runs outrank other work:** the Projects skill now says a task run outranks all in-flight work except answering the owner. The coordinator handles it in the turn it arrives, before relaying thread updates or merge work, and acts on every step its report or its task's own checklist names.
- **No `.done` after a partial pass:** the coordinator never writes `.done` while any step is unfinished. A step that truly cannot finish leaves `.done` missing, goes on the promise list with its run time, and is finished first on the next turn.
- `setup governance` and `refresh governance` typed commands. `setup governance` asks the switch together with the governance yes in the same proposal; in a governed repository it is `refresh governance`. `refresh governance` shows the merged answers (governance, switch, evidence store, required checks) and the repository's permission block, and with `--set on` or `--set off` prepares one pull request that changes only the switch. It never writes the binding itself.
- A governed repository whose binding sets no switch shows one line, "Task auto-merge is off here until you set it; say refresh governance", in `toolkit governance status`, `check` and `refresh`. It is a line, not a hold.

### Removed

- The per-app task auto-merge answers older versions saved under `~/.ai-agent-toolkit/user-state/` are machine-wide: the first governance read on this computer that reads any repository's new switch back fresh deletes them, and never before.

## 3.102.0

### Added

- Merge trains: `toolkit-merge-train.cjs eject` takes a member off a train that is already pushed without rewriting it. It adds revert commits on top (the bump, the member's boarding merge, then a fresh bump for the members left) and records them in the manifest; `verify` accepts exactly those reverts, so the train keeps its branch and pull request. `land` refuses while the ejected pull request is still open at the head the train carries, and `eject` prints the steps for it to rejoin a later train. A later `build` ejects, and `verify` refuses, a rejoining member that has not restored its ejected change, which would otherwise stay silently reverted.
- Merge trains: `build --onto` marks a stacked train `stacked`; `land` refuses it until `catchup` brings main in, adds the bump and drops the mark. `catchup` also accepts a stacked train whose head is an eject revert.

## 3.101.0 (governance question without the freeze)

### Changed

- **The governance question no longer freezes a repository:** a github.com repository with no merged decision now counts as off. Work carries on under the global rules, Toolkit asks yes, no or later once per session, and no message or tool waits on the answer. The first message of a session goes through with the question (a card in Claude Code, text at the end of the reply in Codex) and Toolkit asks again next session until a decision is merged.
- **Answering:** `toolkit governance enable` or `toolkit governance disable`, sent as the whole message, is recorded at any point in a session that was asked. Any other reply, a bare `yes` or `no` included, now goes through the agent with a one-use reply ticket on your next message after the question, because without a hold a bare `yes` may be answering something else. A card tap is recorded as before.
- **Typed commands:** a typed Toolkit command now gets its line on every message except the one that carries the question.
- **Kept refusals:** an agent still cannot run the governance CLI with a decision, edit Toolkit's user-state files, show Toolkit's card with an answer filled in, schedule a prompt for itself while your reply is awaited, or run the answer script in any form other than the exact command given with your reply. Automation sessions are never asked and cannot answer. A hook that fails still holds inside a repository, as before.
- Projects coordinators now treat every scheduled-task line that carries a warning as work for that turn, never a quiet no-reply. A warning they cannot clear, or the same warning on two handled runs in a row, goes to the owner once with the exact step.
- The hourly nudge reports `COORDINATOR BEHIND: <n> runs` when its own earlier runs were never handled, and tells the owner how to unblock it. Its unrelayed-run lists show the 5 oldest plus a count, so a backlog no longer floods the report.
- The hourly nudge rotates its home thread after 3 days instead of 7, and any bound task that loses context writes a `handoff.md` for its new home thread. A rotation never moves a task: the new home thread creates its own copy of the task, reads it back (never firing it), deletes the outdated one after saving its record and updates the task id in project memory, after the owner's one-time go.
- Every new task gets a fresh thread. Standing threads (record keeper, review runner, integrator, any long-lived lane) rotate with a handoff file after each milestone and at the latest at 15 PRs, records or review rounds, a day old or summarised context, and the hourly nudge reports `ROTATE DUE` so the coordinator acts on it. Remote Control lanes rotate the same way, and a thread only waiting on the owner is never flagged until that clears.
- No Toolkit task is ever fired by hand: setup, template swaps, the nudge home thread and the Both gone recovery read the new task back with `get_trigger`, and its first scheduled run is the proof. A missed fresh-session run is covered by its next scheduled run.
- A task check that needs an id, memory line or file it cannot find now reports `NEEDS SETUP` with what to add and where, never a bare "unknown".

### Removed

- **Held messages:** nothing is stored or replayed. The file of messages an earlier version held is deleted at session start.
- **Tool holds for the question:** the refusal of every tool in an undecided repository, of commands that reach into one from another folder, and the scheduled-task exception that existed only to pass that hold.
- **Task-command exception code:** the unused helper behind that exception is deleted, and `toolkit governance check` now names its last section "Governance question hook" instead of "Prompt-hold enforcement".

### Added

- **Finished tasks leave the programme parent on their own:** GitHub caps a parent issue at 100 sub-issues. With the new version 2 binding switch `detach_finished_children: true`, the controller's reconcile and sweep unlink a closed `COMPLETED` or `RETIRED` task from its native parent once no open sub-issue, unfinished task or open PR still needs it there. Nothing is closed or deleted, at most 25 tasks leave per pass, each is checked again just before the write, and every detach is recorded on the parent's state. The task stays in the catalogue and on the graph, and a reopened task is attached again. Without the switch nothing changes.

## 3.100.1

### Fixed

- **Merge trains in the programme graph:** a merge train pull request is now a carrier. It no longer joins each member task's PR history, gets PATH and STATUS blocks written into its body, wins merged PR backfill over its member on an exact merge time tie, or shows as a PR without a task.
- **Issue closure after a merge train:** the closure check no longer holds an issue because a merged train's one UAT line waits on another member's owner test. It releases the issue only when every member the train carried that references it owes nothing by its own strict UAT line and is not named as owing the test; a member with no strict line, a member merged apart from the train or a pasted member table keeps the hold.
- **Merge train body:** each link line names its member and that member's UAT state, so a reader can tell which member answers for each issue.

## 3.100.0 (Threads self-check CI waits)

### Added

- **Threads waiting on CI arm their own check-in:** the Projects managed block tells every thread to arm a check-in about 15 minutes out before ending a turn that waits on CI or any outside event, instead of relying on that event alone. The Projects skill tells every brief to say so.
- **Hourly nudge flags quiet CI waits:** a new step runs on every nudge, the no-change path included. It lists each thread quiet for 20 minutes or more whose pull request CI is still pending, or finished after the thread's latest message, under `CI WAIT QUIET`, and the coordinator pings each one that turn. The same thread listed again on the next run goes to the owner.

### Changed

- **Projects wording trims:** a few managed-block and skill lines are shorter, with no rule dropped, to keep both under their byte caps.

## 3.99.0 (cloud and CI findings keep asking until they clear)

### Changed

- **Held and skipped sweeps turn red:** each held sweep pass and each skip now prints a titled warning with its code. On the hourly start or a start by hand the sweep gate reads the last runs' warnings: three sweeps in a row held, or skipped for the same reason, or three hourly gate runs in a row skipped because governance is off, turn the gate run red with the step that clears it. Activity runs never go red for this, and the first clean run ends it. The gate's built-in token gains `checks: read` to read those warnings.
- **The sweep gate tells a missing programme file from a refused read:** only a 404 means there is no file; a 401, 403 or server error on the binding is no longer read as governance off.
- **Dependabot pull requests never wait silently:** when auto-merge is off in the binding, the binding cannot be read or no ruleset requires a check, the pull request gets the one marked comment naming why. The template moves to v4, so governed copies show drift until `toolkit governance security` refreshes them.
- **Shard timing drift with no App fails the daily run:** a report-only run that finds a refresh due fails with the owner's step (`--fail-if-due`), and a refresh pull request open over 7 days fails the run naming it.
- **Fallback-risk findings show on the pull request:** under GitHub Actions each one is also a file and line annotation.
- **Re-bump without a key checks instead of repeating a note:** with no push key the workflow lists the owner's open pull requests that carry a version bump and fails naming them, or ends green and silent when there are none. A held re-bump comment keeps the day the hold began, and a hold over 7 days fails the run naming it and the hand command.

## 3.98.1

### Changed

- **State document reads:** a single read of a state document over 1 MB now uses the same blob read as the sweep's snapshot. Tests now pin the failure code for a blob that cannot be read, and cover a write of such a document read back at its own commit.

## 3.98.0 (findings keep asking until they clear)

### Changed

- **An action-required update report keeps asking:** while it is open, every bridge hook run prints `Toolkit: action needed (...)` with the cause, how many session starts in a row have seen it and the report's file name, and says to tell the owner before other work. A repeat of the same result writes no new report but still prints the line; a run that needs no action clears it, and cleanup never deletes the open report.
- **Rule-drift notes repeat:** the repository-rules note shows at every session start while the finding holds, with its count, and names the step as due before the current task ends instead of "when convenient". It still never halts work.
- **Held programme refreshes are counted:** held runs keep `held_streak` and `held_since` like skips, an incomplete inventory is held rather than done, the session line shows the count, and TASK HEALTH flags three held runs in a row.
- **Task health shows age and peers:** a flag that has stood a day or more shows its age in days, and the session line names other computers' flags for the same repository.
- **Unverified is not conformant:** an online `toolkit governance check` that could not confirm a setting reports `unverified`, exits 3 and names the repository admin's step. Offline runs keep exit 0.
- **Merge-train ejections are listed:** the build prints a next step for each ejected member and the train body gets an `Ejected` section.
- **Plain-text check:** unreadable settings or baseline are drift in `--check`, and a stale baseline allowance fails a full run until `--prune-baseline` lowers it.
- **Hook pack:** a known-bad row over 30 days old fails the run unless it names its tracking issue in `issue`.
- **Bridge hook errors are counted:** a hook that keeps stopping on an error says how many session starts in a row and to tell the owner.
- **Work-queue-only attention:** when every open finding is on the work queue, the session-start action names the queue step and no longer offers an ack, which a work-queue finding refuses.

## 3.97.0 (Merge by card in Claude Code)

### Fixed

- **VPS daily security report template says notifications are required:** its notes line, the skill README, checklist, description, routing table and safety matrix now match the check, where a missing notification is a FAIL row, instead of saying notifications may be set up.
- **State commit read-back:** the check after a state commit now compares every written file with Git's own blob id of the written text, computed locally. It no longer depends on how GitHub shapes its answer for a created tree, which may list only the top-level folder of a nested file. An id GitHub does list must agree, and any mismatch is refused.
- **Large state documents:** the programme sweep now reads a state document over about 1 MB whole by its blob id, instead of holding it as unreadable. GitHub's one-request state read leaves out the text of such a file. A pass that cannot fit those extra reads in its budget stops before any write. The check after a state commit compares blob ids instead of reading those files again, so it never stops a commit that has already landed.
- **Queued sweep runs:** a cloud sweep run that only queues behind another sweep no longer cleans footers, since it ran no pass and holds no lease.

### Added

- In Claude Code on this computer, a tap can replace typed `merge N`. When the merge hold refuses a merge that names its full head SHA, it hands back one exact card: "Merge owner/name#N at <short SHA>?" with Merge and Not now. The owner's tap on Merge approves that pull request at that commit, once. Not now approves nothing and withdraws an unused approval for it.
- The card counts only in a chat the owner started, shown exactly as given, as a plain tap. A changed card, a card asked with its answer filled in, words typed into Other, an answer the host marks as idle, a follow-up, typed text or noted, an answer with a field the reader does not know, and a launched, resumed or unmarked session record nothing. Nothing is refused for the card's sake, so ordinary questions are untouched.
- A card event whose environment holds `TOOLKIT_HOST_SESSION` records nothing: the host's hook process carries none, and a session's shell commands do. Two command-line shapes are refused like a fed prompt, read from the text alone: one that names a hook script (or a file named after one, such as its tests) and a tool event (`PreToolUse`, `PostToolUse` or the card functions) and also runs node, bun or deno anywhere, unless the word straight after it is `--test` or `test`; and one that names a hook script and has a command starting `env` whose leading words (dash options or NAME=value) include `-i`, `--ignore-environment` or `-` as a word of its own. Ordinary work of either shape is refused too, such as a search or commit message about the hooks chained with any node run; run those as separate commands.
- Known limits: this is a tripwire, not a lock. Any command or script that starts a hook script without `TOOLKIT_HOST_SESSION` can still feed a card event in the owner's own chat, because the refusals catch only those two exact shapes (a wrapper before `env`, other `env` option spellings, clearing the variable another way, a node one-liner or a saved script all get through), as it can already feed typed `merge N`. A host that answers the card itself, with no tap, is not told apart either: a permission answer from an SDK callback, a permission hook (from any plugin or from settings), a permission-prompt tool or a launcher, a reply a connected client sends to a background session, and an automatic answer the host does not mark.

### Changed

- The order for a merge that needs the owner is now: task auto-merge when it applies, then the card, then typed `merge N`. Codex keeps typed `merge N`. This card records nothing in a cloud session, where the Claude Projects merge card applies instead.
- Hook pack rows may use a placeholder in an object key, so a card answer can be keyed by its question.

## 3.96.0

### Added

- **Speed-first CI in `secure-ci-cd`:** a new guide, `templates/cicd/ci-speed.md`, aims CI at the shortest wait from push to a trusted green check without dropping a security gate or a test. It says what to measure first (runs per commit, cancel causes, jobs per run, queue versus run time, peak jobs against the account's concurrent job cap, setup times) and ranks the fixes cheapest first: light runs for title and body edits, concurrency that cancels only stale runs, fewer and fuller jobs, docs-only skips that keep required checks reporting, shard balancing, caching only where setup is slow, and flake hunting. Free fixes come first; a paid plan raising the cap stays the owner's call. The Toolkit's own measured CI is the worked example. The skill and the setup prompt point to it.
- **New CI check-up rows:** `speed.edits` (an edit reruns heavy jobs), `speed.concurrency` (no group, a pull request group keyed on the commit SHA so stale runs are never cancelled, an edit cancelling the run on the same commit, or pushes sharing one group in a pull request and push workflow, so a burst of merges loses a waiting run) and `speed.slots` (a measured run that starts more than half the account's concurrent jobs). The settings file takes `concurrent_jobs` (default 20, the GitHub Free cap). All three are CHECK rows for the agent to judge.

## 3.95.1

### Fixed

- **Evidence-store merges in cloud sessions:** a cloud session can now merge its evidence store's pull requests under the standing custody permission, as a computer session already could. A cloud session starts in the folder that holds the project's clones, so it had no cached parent binding and the merge hold refused every store merge for want of the user's approval. The hold now reads the parent's merged binding on demand in cloud sessions, with the same bounded read session start uses, and accepts an explicitly named store merge from that folder when the parent's clone sits in it. Every other check stays: a fresh merged binding that names the exact store, a private writable store, its default branch as the base, the full head SHA and a plain merge commit. Other repositories stay gated as before.

## 3.95.0 (rolling merge trains)

### Changed

- Controllers now run rolling merge trains on their own. While a landing is in flight, ready pull requests board the open train; when main frees, boarding closes, the train catches up with main, bumps once and merges after one CI run, and the next train opens at once. A lone ready pull request merges alone, and no pull request waits on a train. The Controller routes its merge step to the page that holds the train rule, the Claude Projects skill points there, and the hourly nudge flags ready pull requests that no train holds.
- Running a merge train needs no planning or build gate and runs on the small model tier. The lane never fixes a conflict: it ejects the member and that member's builder fixes it. A train needs no review of its own once `verify` passes and CI is green; only files two or more members change get a short delta review.
- The Claude Projects coordinator never resolves its own project-chat post or the reply thread under it, since that hides the chat message; quiet reply threads no longer close after six hours. It resolves a thread only when the thread has its own session, is no task home, every pull request it lists is merged or closed, nothing is owed by the owner and its last report is final. The hourly nudge sweeps blocked, review-ready and done threads against that checklist.

### Added

- `toolkit-merge-train.cjs catchup` merges main into a stacked train after the earlier landing and adds the one bump, with no rebuild or force-push.
- A merge train holds at most six members (`build` refuses a seventh), and its body carries every member's `Pack changes` lines (`pack_changes` in the manifest). A member that fails CI or its delta review is ejected at once and the rest carry on; nobody edits a train or member body while its CI runs.
- A stacked train's pull request targets the running train's branch until that train lands, so the version check does not report its waiting fragments as unfolded; it then targets main before `catchup`.
- In Claude Projects the train's merge card goes up in the train thread, which runs `land` and the merge itself, because a relayed tap does not count there; the fallback is the owner typing `merge PR N at <full SHA> as a merge commit` in that thread.
- `toolkit-merge-train.cjs verify` lists the files two or more members change (`overlap`) and the review the train needs (`review`).

## 3.94.0

### Changed

- An acknowledged programme finding is now a promise: `ack` needs `--next <step>` and sets a due time (24 hours ahead unless `--due` gives one, at most 72). Past due the finding is new again, counts as waiting on the owner at once, and `attention` prints it as OVERDUE with the promised step. Acknowledgements made before this change fall due 24 hours after their last change.
- A holder order's dry run now runs every write against an in-memory copy with the real run's content checks (fence, finding state, field limits, document validation), and reports each write as `WOULD_RUN` or `REFUSED` with its code. An order whose `ack` step or `dispose` reason is over 200 characters is refused whole.
- Every reported finding prints its next step; findings that printed "undefined" now print their code's next action.
- The board's "Sweep stuck" warning is also a `SWEEP_STUCK` finding, so it reaches the Attention line. Only a sweep pass resolves it.
- Session-start lines for programme attention, a failing hourly sweep and a failed checkpoint now end with who acts and when.
- The Projects daily check-in reads device task-health files from the evidence store and adds their flags to `TASK FAILING`.
- A merge record names the G2 report's evidence-store path and PASS head, and the report is archived before the record. A cloud session that cannot write the state store hands holder orders to a computer session with the order's expiry as the deadline.

## 3.93.1 (PR edits no longer cancel CI checks; Work queue named at session start)

### Fixed

- The personal-data guard's git hooks now find the guard in the Toolkit's own checkout (`skills/secure-ci-cd/scripts/personal-data-guard.cjs`) when there is no `.github/scripts/` copy, so commits and pushes there run the real guard with no hand copy. With neither file present they still block.
- In a Toolkit checkout the installer now installs or refreshes only the hooks (no guard copy, no workflow) instead of refusing, so rerunning it repairs an older hook. `--check` there reports an outdated hook as drift; no hooks at all is still fine.
- The pre-push hook's plain-text step finds the check's in-repo source the same way, so a push from the Toolkit's own checkout runs it on the changed files, as other repositories with a copy already do.
- In a Toolkit checkout, a leftover `.github/scripts/personal-data-guard.cjs` would run in place of the in-repo guard, so the installer warns about it and `--check` reports it as drift. A repository counts as the Toolkit only when it has both the guard source and the governance conformance script, so one stray file does not make another repository skip its guard copy and workflow.
- **A pull request title or body edit no longer cancels the Validate run in progress.** The edit run now waits for it and then runs in full, so the newest event still finishes last and a fixed body still clears the required check. A new commit, an open or a reopen still cancels the older run.
- **A cancelled Validate run reports `validate` as cancelled, not failed.** The aggregate job now runs with `if: ${{ !cancelled() }}`: it still runs and fails when a shard failed or timed out, but a run that was cancelled no longer fails with "no shard summaries". The secure CI/CD prompt template says the same for the final job.
- **The programme sweep no longer reports a false `CHECKS_RED` from a cancelled run.** A cancelled result of a required check is set aside when the same check has another result at the head; a check whose only results were cancelled still counts as failed.
- **Governance App check test:** the check that a missing governance App never changes the conformance exit code now runs the App reader for both a found and a missing App, and compares the drift findings as well as the exit code. Before, it ran offline, so the reader never ran and the check proved nothing.
- **Code comment:** the evidence-store exemption comment in the governance state script sits above the function it describes again.
- **Large state documents, single reads:** a gate, checkpoint or other single read of a state document over 1 MB now reads it whole by its blob id. The Contents API leaves out the text of such a file, so these reads used to stop with "too large to read".
- The issue-closure check now refuses a `gh issue close` or closing PR write hidden in a PowerShell hash value (`@{a=gh ...}`), in a block inside a parenthesised group or hash literal after a data command, behind a `#` or `<#` or single quote inside a `cmd` script, in a here-string or heredoc given to `iex` or `pwsh -Command`, in `iex(...)`, or among the arguments after a POSIX `-c` script (as separate words, one word run by `$1` or `eval`, or several words joined by `$@`). A hash value that starts a runner or Start-Process, a data command's script block followed by `.Invoke()` or piped to an invoker, a PowerShell cmd script with embedded quotes and `iex` text built by `+`, `-f`, `-join` or a method call are read or refused too.
- Where PowerShell may run the command, a guarded gh command with a parenthesised argument (`gh ('issue','close','1')`) or an `@name` splat is refused by name; reads such as `gh api $url` and flag values such as `--assignee @me` stay allowed.
- Two `gh api graphql -f query="$query"` calls after one literal `query='...'` assignment are no longer refused with the wrong advice.

### Changed

- The Claude Code and Codex session-start attention line now names the longest-stalled work-queue task, its code, when it was flagged and its next step, read from this computer's attention cache.
- A task natively blocked by another open task on the graph that is itself moving is no longer raised as idle; a blocker written only on the page is answered by a dispose naming it.
- A refresh that could not read every open pull request raises no work-queue findings.
- Work-queue rows show the acknowledged marker for a stalled-task finding acknowledged before acknowledgements were refused.
- The controller takeover playbook says a work-queue finding takes an action or a dispose, never an acknowledgement.

## 3.93.0 (Coordinator resolves finished threads on relay; cloud merge hold; remove toolkit review fixes; one-app remove toolkit and a setup bank asked once)

### Changed

- The Projects coordinator now resolves a finished thread in the turn it relays the thread's final result, including when the thread's pull request merges or closes. The hourly nudge becomes the backstop rather than the only resolve path.
- The hourly nudge lists a finished thread even when it cannot prove the result reached project chat, marked "relay unverified", so the coordinator relays the one-line result and resolves it instead of the thread staying open.
- Controllers now own every finding: any warning, alert, failed or skipped check, review Low or owed step that a Toolkit check, task, hook, CI job, sweep or report raises gets an action and a deadline the turn it is seen. An acknowledgement, log line, count or relay is not an action, and a missed deadline or a repeat goes to the owner once with the exact step.
- A review's Low findings now go on a follow-up task that joins the lane's next slice or starts within 3 days, and each real gap found by the CI check-up during planning gets its own slice or task.
- The Projects daily check-in raises `TASK FAILING` for a task whose last run failed or missed its schedule, and `PR ATTENTION` for an open pull request with a failing check, a ready one with no UAT verdict, or one with no update for 3 days, review-notification pull requests included. A project whose missing tasks were reported 3 days ago is raised again so the owner can open that project.
- Source-watch notification pull requests are triaged by the controller within 3 days. Release-readiness audits give every unresolved or deferred finding an owner and a tracked follow-up. Leftover-file scans offer the removal pull request in the same turn. The agent reviewing the server daily security report escalates a warning seen three days running to the owner, leaving the status as the evidence shows.
- Review follow-ups now carry `POST_SHIP` items as well as Lows, a pending UAT ask stays on the owner's waiting list until it is answered, and stranded work gets a successor or a recorded hold.
- The daily check-in keeps a verified plugin gap on the owner's waiting list every run until it clears. Unreadable governance that lasts a day is raised with the owner once. A push whose credential check could not run is followed by the local security scan the same turn, and a secret pasted into chat stays an owed rotation until the user confirms it.
- **Cloud sessions run the merge hold:** a Claude Code cloud session, including every Claude Projects thread, now runs the merge hold as a computer does, instead of skipping it. The undecided-repository hold stays off there (a Projects override) until the no-freeze governance question ships, since a cloud container cannot keep the owner's answer. Issue closures the cloud check cannot prove unsafe stay advisory. `toolkit governance status` says "merge hold runs" for a cloud session.
- **Projects merge card taps count:** in a Projects thread, a tap on Merge on the decision card `Merge owner/name#N at <full head SHA>?` counts as the owner's approval for that pull request at that SHA, once. Only the host's own card answer counts: not Not now, another option, a relay or a replayed card. The merge thread posts the card itself, so the tap reaches the session that merges.
- **Projects task auto-merge switch read by the hook:** the project line `- Task auto-merge: On` is read from the owner's project instructions block in the host's session context at the start of a thread's first prompt (never from the shared-file, repository or folder lists beside it), and a refusal in a cloud session names the exact merge card to post, and with it On a merge with no tap passes on the computer's standing checks (fresh enabled binding, merge commit pinned to the full head SHA, clean merge scope). The Projects skill's parity table says the merge hold runs, and its overrides list now names only the undecided-repository hold as skipped.
- **Typed merge:** a pull request that changes `toolkit-remove.cjs`, `toolkit-remove-parts.cjs` or `toolkit-commands.cjs` now always waits for the owner's typed merge.
- **How-to:** typed Toolkit commands get no line on the message that carries the governance question.

### Added

- Hourly nudge first-line warnings `RESOLVE DUE: <n>` (finished threads waiting to be resolved) and `THREAD SCAN INCOMPLETE: <read> of <total>` (the thread sweep did not cover every open thread, so its "none" cannot be trusted).
- The nudge keeps its resolve candidates in its state file and repeats them on a no-change run until they are resolved.

### Fixed

- **Host pulse never sends a healthy ping for a sick host:** a degraded or emergency pulse with no failure heartbeat URL now skips the ping, so the off-host monitor raises its missed-ping alarm instead of seeing a healthy host. A state other than normal, or failing services, that stays the same is alerted again every `REMIND_EVERY_PULSES` pulses (default 24, a day on the hourly timer) instead of once.
- **VPS daily security check escalates:** it exits 2 on an overall FAIL and 3 when a configured notification fails to send, so the systemd unit shows failed. A daily notification is now required: with none set, the notification row is FAIL. The installer and docs name the owner as the reader.
- **Failed nightly n8n backups reach the owner:** the backup template's systemd unit names an `OnFailure=` alert unit (tested before the timer is enabled), and the cron example mails a failure line through `MAILTO`.
- **Workflow checks stop passing with personal data (breaking for some repositories):** the validator fails a workflow in the canonical folder that holds a real email or a production URL, which also stops the live import before it starts (prepared imports keep it as a warning), and names the JSON path, never the value. A host that is itself an expression is not a finding, and well-known public API hosts (a short built-in list, such as `api.openai.com`) pass with no policy file. **Remedy:** add each other host or email domain the workflows really need to `allowedUrlHosts` or `allowedEmailDomains` in `n8n-workflow-policy.json` at the repository root; entries now add to the defaults instead of replacing them. The sanitiser exits 2 when real data may remain, prints those findings even with `--quiet`, and passes only with `--accept-warnings` (`-AcceptWarnings` in the PowerShell wrapper) once reviewed.
- **Closed tasks can leave the programme parent:** GitHub caps a parent issue at 100 sub-issues. The reconciler no longer attaches, moves or reorders a closed `COMPLETED` or `RETIRED` task back under its parent, so the controller can detach closed tasks to make room for new ones. A closed task that still has open sub-issues or unfinished catalogued tasks under it keeps its native parent. A detached finished task is read on its rotation turn or when it changes, not every sweep pass. A reopened task needs its native parent again.
- **Parent completion checks the catalogue too:** the programme parent closes automatically only when every catalogued task is closed or finished, so a task that could not attach (or was detached) still holds it open.
- **Exact task removal:** `remove toolkit` now removes and exports the exact Task Scheduler task it found, so a task name with wildcard characters such as `[1]` can never match a different task. Two tasks with one name are left alone.
- **Copies and leftovers are kept:** a task carrying a recorded task's marker in another folder, and a recorded task that is still there but no longer Toolkit's, are now listed as changed by you and kept unless named with `--include`. Their record and the shared task runner stay with them.
- **Linked folders in the leftover report:** a linked `.github` folder is shown under "Not listed" instead of as the kept programme file, and a linked playbook folder is one line instead of one per playbook.
- **Plain results:** the apply result says "put back to the earlier value" and similar words instead of raw codes like `restored-previous`.
- **Damaged Codex line:** when the plan said Codex's `config.toml` is left alone because its Toolkit lines are damaged, apply no longer reports that as a failure or prints it twice.
- `remove toolkit` asks first whether to remove Toolkit from only the app it runs in or from every app, and `toolkit-remove.cjs` needs that answer as `--app codex`, `--app claude-code` or `--app all`. One app removes only its own plugin, global rules file, settings, helper files and skill copies; scheduled tasks, Antigravity's copies and the Toolkit folder stay while another app still has the plugin. Running it in Codex no longer uninstalls Claude Code's Toolkit.
- Codex `setup toolkit` no longer stops and shows the question bank again after its own plugin install writes the plugin's tables into `config.toml`. The approved helper limit carries over when only those tables changed and the edit is the same, so the instruction limit, Antigravity copy and global rules steps run in the same pass. Any other change to the file still asks again.
- A setup preview (`--plan`, `--explain`) shows the bank exactly as the run shows it, with the same reference, and runs from the managed checkout like the run does. Before, a preview's reference was never accepted by the run.

## 3.92.0 (the programme graph is the work queue)

### Changed

- The programme graph is now the controller's work queue. `CONTROLLER.md` says every NOW task always has a working lane, an owner wait or its next step done, and a freed lane takes NOW work first, then LATER by priority.
- The sweep's `TASK_IDLE` finding no longer treats an open PR with no update for 24 hours as moving its task, so work parked behind a stalled PR surfaces.
- The new `TASK_MERGED_OPEN` finding flags a task still shown in progress one quiet hour after every PR merged or closed.
- `TASK_IDLE` and `TASK_MERGED_OPEN` are work-queue findings. They are listed first in `programme.cjs attention` and in the parent's CURRENT block, and counted in the `Attention:` line. They cannot be acknowledged (`QUEUE_FINDING_NEEDS_ACTION`) and never count as waiting on the owner. A disposed one comes back when the task stalls again.
- The Programme Graph's PR cell says `merged` or `closed` when an open task's latest PR is no longer open.
- The Projects hourly nudge reads its lane queue from the programme graph first and raises `WORK QUEUE: <n>` for tasks that need the coordinator's step this turn.

## 3.91.11

### Changed

- **Governance App setup:** The steps to save the App's Client ID and private key now lead with GitHub's website (Settings, Secrets and variables, Actions: the variable on the Variables tab, the whole `.pem` text on the Secrets tab), each step stopping if the name is already there, then say to delete the `.pem` file. The guarded `gh` commands stay as the other way. Removal leads with the same page.
- **Governance on and off cover both halves:** The pull request that turns governance on always carries fresh cloud sweep copies (the sweep and its gate) pinned to the Toolkit checkout's own commit, which must be on main, and moves a version 1 binding to version 2; when the copies cannot be rendered it says why and how to fix it. The pull request that turns governance off also removes those copies. Both guides end with `toolkit governance check`, which now also reports cloud sweep copies left once governance is off.

## 3.91.10

### Fixed

- **Programme sweep docs:** the bridge doc no longer promises a footer-skip warning that a run never shows. When the refresh skips or fails, the footer step does not run, and the refresh's own warning, notice or failure says why.
- **Programme file reading tests:** the gate's parity table now covers a version 1 file carrying `parent_lifecycle`, and the `toolkit permissions` comment about the Codex block sits above its own code again.

## 3.91.9

### Fixed

- **New session after an update:** `setup toolkit` and `refresh toolkit` now end with a `## Start a new session` line naming each app (Claude Code, Codex, Antigravity) whose skill files or rules the run changed, because sessions already open keep using the old files; Codex, for one, keeps the old plugin folder's skill paths. Nothing is printed when the run changed none.

## 3.91.8

### Fixed

- **Skill descriptions in Codex:** Codex lists each skill with only about the first 200 characters of its description, so a trigger written further down was never seen there. `remove toolkit` and its full removal plan now open the setup skill's description (Codex had asked whether "remove" meant the computer, the repository or governance instead of showing the plan), and the Toolkit env and release-readiness skills put their trigger phrases first too. A check now keeps every quoted phrase or command in a skill description within the first 195 characters, and every description within 1,024 characters (the programme reconciler's was 1,051).

## 3.91.7

### Fixed

- **Programme file reading:** the cloud sweep gate and `toolkit permissions` now read the programme file the same way the sweep does. A hand-edited version 1 file that also carries a version 2 key, such as `governance: "disabled"`, no longer counts as governance on: the gate skips with a warning that the file is not valid, and `toolkit permissions` offers no repo block.
- **Remove Toolkit test:** the setup skill test now fails if the line allowing an app's own uninstall tool moves in front of the user's yes.

## 3.91.6

### Fixed

- Programme Sweep: a run started by hand from a branch or tag other than the default branch now stops with one warning before any App token is minted, and footer cleaning runs only after a programme refresh that ran on the run's own commit, so a skipped or failed refresh edits no posts.

## 3.91.5

### Fixed

- **Remove Toolkit in Codex:** `remove toolkit` always runs the full removal plan (scheduled tasks, app settings, hook records, helpers, skill copies, global rules, reinstall note and the Toolkit folder) after the user's OK. The setup skill's listing now names the plan script and says the app's own plugin uninstall tool is never the answer on its own, so a Codex session that cannot open the skill file still routes to the plan. Codex's own uninstall tool may do the Codex uninstall step once the user has said yes.

## 3.91.4

### Fixed

- Governance App setup now links an organisation-owned repository to its organisation's "New GitHub App" page, read from the repository's owner type. A personal App cannot be installed on an organisation's repository. When the owner type cannot be read, the steps show both pages.
- The cloud programme sweep, its gate, its merged-binding read and `toolkit permissions` now read a version 1 programme file as governance enabled, as the rest of Toolkit does. Such repositories were silently skipped.
- Every cloud sweep skip (no programme file, governance off, invalid or oversized file, another repository named, foreign evidence store, public state branch, App not set up) and the sweep gate's skip are now one visible warning that names the repository, the reason and the fix, instead of a quiet notice.

## 3.91.3

### Fixed

- **Setup's Antigravity question:** Once Toolkit's skills are copied into Antigravity, setup shows whether the copies match this Toolkit version ("Copied, up to date" or "Copied, N out of date"). It recommends "Keep current" when they match and "Copy and keep updated" only when some are out of date, instead of always recommending a refresh. If setup cannot read the copies, it says "Copied, could not check" and recommends a refresh, and the copies still count as there.

## 3.91.2 (fewer setup re-asks, and Antigravity in Claude Code setup)

### Changed

- **Codex hooks no longer void setup answers:** The "Toolkit hooks in Codex" status line takes no answer, and setup never changes it, so its state is no longer bound into the setup bank reference. Turning the hooks on in Codex's `/hooks` while the table is open keeps the same bank, and your answer still applies.
- **Antigravity in Claude Code setup:** Claude Code setup now offers "Copy Toolkit's skills into Antigravity?" too, whenever Antigravity is on the computer, as Codex setup already did. It is one folder on the computer, whichever app sets it up, so a removal run from Claude Code can be undone from Claude Code.

## 3.91.1

### Fixed

- **Merge train build:** `toolkit-merge-train.cjs build` refuses a branch that is checked out in another worktree, before it changes anything, so a train can no longer leave another checkout out of step with its branch.
- **Merge train body:** on a train whose UAT line waits on an owner test, members' closing lines become `Refs` lines, so the issue-closure check passes; each member's own closing line still closes its issue when the train lands.

## 3.91.0 (reinstall after remove toolkit without hand repair)

### Fixed

- **Cloud sweep follow-up:** after its wait the follow-up starts nothing when another sweep is already queued, running or newer. It also runs when the footer step fails, and its built-in token can read contents, so the checkout works on a private repository.
- **No paid waits:** on a private repository no runner waits an hour after a pass stopped mid-way at GitHub's hourly App limit; the hourly gate resumes it from its board note. A pass that found the limit already at the margin keeps its one follow-up, and a pass stopped by its own time limit still follows up at once.
- **Footer cleaning at the limit:** a run that stopped at GitHub's hourly App limit skips footer cleaning, so it never spends the safety margin.
- **No red runs on a GitHub blip:** a 5xx, a 429 or a dropped connection in the gate or the follow-up ends the run green with a notice; the next start tries again. A missing token or repository, a 401, 403 or 404, and any other error still show red.
- **Cloud jobs contract:** the programme sweep's row names the gate workflow that holds its hourly cron, and `toolkit governance check` says the gate starts the sweep.
- **Store push refusal:** the store command the raw-push refusal prints now includes `--store`, a path in the store and `--repo-root`, so it runs as printed from the store folder.
- **Going back a folder:** the merge hold now reads `cd -` and `Set-Location -` as a step back to the folder before (bash's previous folder, or any folder in PowerShell's location history) instead of a folder named `-`, so `cd <store>; cd -; git push origin main` is judged in the folder the push really runs in. `cd -- -` and `Set-Location -Path -` step back too, and a bare `cd` goes home first, so `cd <repo>; cd; cd -` comes back to the repository. A push after a step back to a folder the same command never showed, after a bare `pushd`, or after `pushd +N`/`-N`, is refused with advice to name the folder.
- **Switches are not folders:** `Push-Location <folder> -PassThru`, `-StackName <name>`, `-Path`/`-LiteralPath`, `cd -L`/`-P`, `pushd -n` and cmd's `cd /d` now give the merge hold the real folder.
- **Timing test:** the closure scanner timing test may now grow its baseline to 2 MiB, so a fast Windows runner no longer compares a sample of under 5 ms.
- **Re-runs clear CI:** each run attempt of a test shard uploads its own summary artifact, and the `validate` check keeps the newest attempt of each shard, so re-running a failed shard can turn `validate` green.
- The leftover-files scan now lists the cloud sweep workflow copies in repositories with governance off, and says when one was edited by hand.
- The cloud sweep workflows' header comments now hold both in the Toolkit and in a governed repository's copy (CI trigger, where the gate script and the refresh come from).
- `toolkit governance check` re-renders a cloud sweep copy at its own Toolkit commit, when the checkout has it and the render is unchanged since, so a hand edit with a recomputed hash shows as drift instead of an older copy. It uses the CI workflow the copy itself names, so renaming or removing that workflow only makes the copy outdated. This covers copies pinned from this release on: the render now lives in `repo/scripts/toolkit-cloud-workflows-render.cjs`, so copies pinned before it keep the hash check until their next rules refresh.
- The governance check's note for an out-of-date copy now says it differs from what a refresh writes (an older Toolkit commit, an action pin or the CI workflow it follows), not only that its commit is older.

### Changed

- **Codex hook records:** `remove toolkit` now also takes out Codex's approval records for the Toolkit hooks (`[hooks.state."ai-agent-toolkit@ai-agent-toolkit-local:..."]` in `config.toml`) and the empty Toolkit plugin cache folder, once the Codex plugin is uninstalled. It backs up the file first, and the edit must read, with Python's `tomllib`, as the old file without exactly those tables; otherwise the file is left alone with a by-hand step.
- **Codex reinstall:** Codex setup no longer treats leftover Toolkit hook records alone as an earlier install. A computer cleaned by an older `remove toolkit` now installs the plugin without being asked for the old marketplace folder.
- **Reinstall note:** `remove toolkit` saves a note in the kept backups (`~/.ai-agent-toolkit/backups/remove-toolkit/reinstall.json`). It names the helper stack each app had and the checkouts whose scheduled tasks it removed; no keys.
  - `setup toolkit` puts the helper agents back for that stack where none are installed.
  - On Windows, setup lists the removed tasks with their exact `plan` and `apply` lines for the owner's OK. It never creates the tasks itself.
- **MCP key warning:** The removal plan lists each MCP server whose key helper runs `toolkit-env.cjs` from inside the Toolkit folder. Such a server gets no key until Toolkit is reinstalled, and its key stays in the credential store.

## 3.90.0

### Added

- **Cloud sweep in every governed repository:** `repo/scripts/toolkit-cloud-workflows.cjs --repo <repo>` copies the Programme Sweep and its gate into a governed repository. Each copy is the Toolkit's own file, pinned to the Toolkit commit it came from, and checks the public Toolkit out into `.toolkit/` to run its scripts. The gate follows the repository's CI workflow when one is named with `--ci-workflow`. It pins only a commit on main from a checkout whose origin is the Toolkit repository, and refuses a Toolkit source checkout, a default branch other than `main`, and a same-named file that is not a Toolkit copy. Shard Timings is not copied.
- **Governance enable and refresh:** The repository rules install or refresh adds the copies while governance is on, and the governance enable pull request carries them. `toolkit governance check` reports a missing or hand-edited copy as drift and notes one pinned to an older Toolkit commit, including one whose action pins Dependabot bumped.

### Changed

- **Sweep action:** The cloud sweep runs the Toolkit's scripts from its own checkout and keeps the checked-out repository as the binding and working folder, so the same steps work in a governed repository's copy.

## 3.89.0 (merge trains)

### Added

- **Merge trains:** `repo/scripts/toolkit-merge-train.cjs` lands several reviewed pull requests with one version bump and one CI run. Each member boards at the exact head its review passed, as its own merge commit, so it keeps its own commits and review. `verify` refuses anything else in the train, `land` checks live heads, main and RISKY owner OKs and names the one head to merge, and a conflict, moved head or red CI ejects a member instead of patching the train.

## 3.88.1

### Fixed

- Governance App setup no longer lets a second person overwrite an existing App by accident. When the repository already has the App variable or secret, setup says to reuse that App instead of offering a new one, and every printed save command stops when it cannot read the names and asks for a typed `replace` before overwriting either fixed name; any other answer, or no answer, changes nothing. A half-set repository gets a command that sets only the missing name.

## 3.88.0 (remove toolkit does the full uninstall)

### Changed

- `remove toolkit` now removes everything Toolkit put on the computer after one OK, not only scheduled tasks and global rules: Codex's helper limit block, Claude Code's subagent limit (only while it holds Toolkit's value), the helper agent files Toolkit generated, the skill folders it copied, and last the Toolkit folder `~/.ai-agent-toolkit`, keeping `env` and the backups. The Claude Code preferences chosen at setup, such as no AI attribution, are listed and kept. The folder waits until no Toolkit plugin is installed, and the result prints the exact plan line to finish with. The plan prints each app's plugin uninstall lines, which the agent runs after the OK, and the app screen to use when the command line is missing.
- The README's Remove section is now one command plus what stays on purpose.
- The personal-data guard installer refuses to install into the Toolkit's own repository, and `--uninstall` removes a clone's guard hooks and puts back any hook they set aside. `--check` in a Toolkit checkout points at `--uninstall` when guard hooks are left over.

## 3.87.0 (cloud sweep runs to GitHub's limit and resumes)

### Changed

- **Cloud sweep has no request cap of its own:** the scheduled sweep on GitHub no longer stops at 1,500 requests. It reads until GitHub's remaining hourly count for the governance App reaches a safety margin, a tenth of the hourly limit GitHub reports (never under 200), then saves where it got to, and the next run resumes with changed and new tasks first. The margin keeps room for the repository's other governance jobs. The computer's caps stay as they were.
- **No fixed limits that can stall a big board:** the changed-issues list is read oldest change first from the last update time it reached, so a list longer than one pass can read carries on next pass instead of starting over. PR discovery's budget grows with the board (sixty requests, plus one per twenty tasks and two per task read), and the open and closed PR lists are read whole within the pass's own request budget.
- **A calm note instead of an alarm:** when a pass stops early, the board's freshness line keeps the pass's time and adds a short note, such as "Paused at GitHub's hourly App limit; the next run picks up the 340 tasks left." The warning `⚠️ Sweep stuck` appears only when no pass has finished for six hours and the passes in those hours read fewer than ten tasks. The evidence store keeps the recent unfinished passes in `sweep-history.json` beside the lease (a pass that finishes writes nothing there), so an older sweep's lease check is unaffected.
- **One governance App per repository:** setup and the docs now guide one GitHub App per governed repository, so each repository gets its own hourly allowance. The pre-filled "New GitHub App" link is named for the repository, within GitHub's 34-character limit. `toolkit governance check` still reads only the variable and secret names, so it cannot tell whether two repositories share an App.
- **A near-free gate in front of the sweep:** a new gate workflow holds the hourly start and also runs on issue, comment and pull request activity from people and when a Validate run finishes. With only the built-in token it starts the sweep when the board shows a saved place to resume, when anything changed or a CI run finished since the last successful sweep, or after six quiet hours; otherwise it ends in seconds. Activity during a running sweep queues one more run behind it, unless a follow-up is already waiting to start the next one. A pass that starts with the App's hourly count already at the margin ends green with a paused note instead of a stop, and follows up once the limit has reset. Bot activity, the sweep's own included, is ignored before a runner starts.
- **The sweep follows up on itself:** a pass that stops early after reading something starts one more run, once GitHub's hourly App limit has reset or at once after its own time limit, so a backlog keeps draining when GitHub drops an hourly start.
- **A pass that saves nothing keeps its place:** when the state branch is busy and a pass saves nothing, the changed-issues bookmark stays where it was, so the next pass reads those changes again.

## 3.86.1

### Fixed

- **Store push refusal wording:** the default-branch merge hold now follows `Push-Location` like `cd` and `Set-Location`, so a push to an evidence store reached that way is judged in the store's own folder and refused by the store guard with the store-command message. Before, it was judged in the starting folder and got "push to another branch and open one", which is wrong for a store and made an agent hold back the store command too. A default-branch push whose remote is a bound store not named `TRANSPORT-*` also shows the store-command message. The push stays refused either way, and a command with several refused pushes names each reason once.
- **Folder stack:** the merge hold now goes back a folder on `popd` and `Pop-Location`, so `Push-Location <folder>; Pop-Location; git push origin main` (or the `pushd`/`popd` pair) is judged in the folder the push really runs in, and a default-branch push there is refused. A `popd` or `Pop-Location` with nothing saved in the same command leaves the folder where it is, as the shell does.
- **Merge target after `Push-Location`:** a merge that names no repository, after a `Push-Location` in the same command, is now refused like one after `cd`, because its repository cannot be told.

## 3.86.0

### Changed

- **Shard timings catch-all:** The Toolkit Shard Timings workflow also starts on a push to `main`, in case the daily schedule stops firing. A push run first checks whether a refresh ran in the last 24 hours and skips the refresh when one did, and only one run goes at a time.

## 3.85.0

### Changed

- The cloud Programme Sweep now cleans the "Generated by Claude Code" footer from posts the repository owner wrote in the governed repository and its evidence store, after each refresh, so footer cleaning no longer needs a computer's sweep. It reads the last 26 hours, or further back when a manual run gives `footer_since`, and writes only counts to the run summary. Refused review-body edits warn and wait for a manual clean; any other failed edit fails the step. The evidence store token gains issues and pull requests write for this.
- `toolkit-github-footer-sweep.cjs` takes `--author <login>` to clean one named author's posts, for a sign-in, such as a GitHub App, that is not that person.

## 3.84.1

### Fixed

- The install check's header comment no longer says it reports Codex's Toolkit state.

## 3.84.0

### Added

- The Toolkit Shard Timings workflow refreshes the test shard timings on GitHub once a day and when started by hand, so it no longer depends on a computer being on. Its built-in token only reads. With the governance GitHub App it opens the refresh pull request with an App token limited to contents and pull requests write, so that pull request's checks start; without the App it only reports. It never runs for pull requests or forks, and the cloud jobs contract lists it.

### Changed

- `refresh-shard-timings.cjs --open-pr` opens no new pull request while an earlier shard timing pull request is still open. When `TOOLKIT_SHARD_PUBLISH_TOKEN` is set, the push and the pull request use that token through environment-only git settings, never a command-line argument or saved config.

## 3.83.1

### Fixed

- Claude no longer reports Codex's Toolkit state. Claude Code session start, a Claude app chat and Claude setup's install check stop saying that Codex runs an older Toolkit or that its Toolkit hooks are off, not reviewed or changed since approval. Codex still reports its own state in its own setup and checks.

## 3.83.0

### Changed

- The scheduled programme sweep can now read and redraw a whole board in one pass. Its request cap is 1,500 on GitHub and 600 on a computer, where it shares the signed-in account's hourly limit. Every other refresh keeps 300. A task now starts only when its reads and the pages already owed also fit within what GitHub reports as left for the hour, above the low-remaining mark, so a larger cap never draws pages past GitHub's limit.
- The cloud Programme Sweep workflow starts at minute 41 instead of 17, because GitHub delays and drops scheduled runs at the top of the hour. It also runs after every push to main, so each merge refreshes the board even when GitHub drops an hourly start. It never runs for pull requests or forks.
- The sweep's summary line now shows its request cap and whether the pass completed, beside the tasks read and the tasks still queued.

## 3.82.0

### Changed

- Projects posts: owner questions now come last, below the ELI5 line, as part of the "Text first, card last" rule. **Waiting on you** keeps the other asks just above the ELI5 line.
- Projects hourly nudge: flags a post with anything but its questions after the ELI5 line, or a question above it.

## 3.81.0

### Fixed

- **Raw pushes to the evidence store:** the shell hook (Claude Code and the Codex helper hook) now refuses a raw `git push` to an evidence store that an enabled binding cached on this computer names, whether reached by `cd`, `pushd`, `Set-Location`, `Push-Location`, `git -C`, `--git-dir`, a `GIT_DIR=` prefix, `--repo`, a URL (https, ssh with a port, `www.github.com`) or a nested shell, deletes included and dry runs excepted, and points at `toolkit-store.cjs save`. Before this, the permission blocks only left raw pushes out, so auto mode could run one with no prompt. Pushes to other repositories, the store command itself and computers with no cached binding are unchanged.

## 3.80.2

### Fixed

- The cloud programme sweep no longer refuses its evidence store as "not writable". A GitHub App installation token's repository read does not reliably show the token's own access, so the cloud sweep skips that one check. Its workflow mints the store token with Contents write, and the sweep lease's write proves it before any state is saved. The private-store and branch checks still apply, and a computer's pass still needs its signed-in account to have push access.

## 3.80.1

### Fixed

- The cloud programme sweep now names its stop code, and the HTTP status of a failed GitHub request, when a pass fails, so a failed run shows its cause. GitHub's own error text, tokens and keys are still never printed.

## 3.80.0 (command list as tables)

### Changed

- `toolkit cmd` now shows the Toolkit commands as small two-column tables (Type this, What it does), grouped Setup, Keys, Governance and Merge, instead of one long bulleted list.

### Added

- The toolkit-setup skill now handles a whole-message `toolkit cmd` or `toolkit command` when no prompt hook line came with it, for example when Codex hooks are off after an update: it runs the command list script and shows its output.

## 3.79.0 (faster setup and refresh)

### Changed

- Setup and refresh skip the Windows scheduled-task update while nothing it depends on has changed (Toolkit version, approval, task registry, discovered checkouts and each checkout's cached governance read) and the last clean update is under 24 hours old, and say so: `Scheduled tasks: unchanged since <time>; not rechecked.` The direct `toolkit update scheduled task` always checks in full.
- When the scheduled-task update is held, setup names each held row and its reason, so agents no longer run the slow direct plan again to find out why. The `toolkit-setup` skill tells agents not to run that plan during setup or refresh.
- A checkout whose cached governance read is fresh, certain and enabled is used without a network refresh or a wait for the refresh lock.
- The scheduled-task plan reports `timings_ms` per step and checkout, and setup prints `Scheduled tasks checked in N s.`

### Fixed

- Linked worktrees under the GitHub folder are no longer discovered as checkouts, so they no longer hold every scheduled-task update (and every setup) on the computer.

## 3.78.0

### Changed

- **Typed governance commands:** `toolkit governance status`, `check`, `discover`, `catalogue` and `security`, typed as a whole message, now tell the agent to run exactly that subcommand of `toolkit-governance.cjs` and nothing in its place. Typing `toolkit governance check` used to run `status` and the programme attention list instead. `toolkit governance migrate` gives you the command to run in your own terminal, because it asks for its own typed yes. `enable` and `disable` stay answers the governance gate reads. The command list and How to use show them all.

## 3.77.0 (holder orders and sweeps that finish)

### Programme reconciler

- **Holder orders:** a controller with no shell of its own (a web controller) writes its decisions into a holder order: the exact writes, for the parent's current holder and epoch, until an expiry at most a day ahead. The session it hands the order to runs `programme.cjs run-order --order <file> --session <id>`, which runs only those writes as the holder, stops at the first refusal and logs the order, its digest, the running session's hash and each outcome in the parent's private part. A rerun skips finished writes; `--dry-run` writes nothing. Claims, takeovers, `init-parent` and `migrate-state` never run from an order.
- **Sweeps draw their pages:** a sweep pass now budgets each task page at its measured cost (about seven requests) for every task likely to need one, and counts the requests that opened the store. A large parent no longer reads every task, runs out of requests and draws no page at all, pass after pass; its pages now fill in over a few passes and the stopped-pass finding clears.
- **A busy sweep says who holds it:** a refresh that meets another sweep's live lease prints the holder's host, start time and lease end, and its JSON carries them as `holder`.

### Issue closure guard

- **Merged owner-test PRs:** closing words for a task are refused while a merged PR in the same repository that references it still says `UAT: OWNER_TEST_NEEDED`, even if the task's page has not recorded the owed test.

## 3.76.0 (owner's one-command permissions apply)

### Added

- **`toolkit permissions --apply`:** the owner types it in their own PowerShell or terminal. It lists what would change, waits for the typed word `apply`, backs each file up next to itself, merges the computer blocks into Claude Code's user settings (every other key and line kept, stale Toolkit lines reported, never removed) and replaces Codex's own `toolkit.rules`, then reads each file back. `--host claude` or `--host codex` does one app. The repo block is still pasted by hand.

### Changed

- **Permission blocks:** every computer block now makes `--apply` ask: an ask line on Claude Code and a prompt rule on Codex, with `--apply` required as the first argument so the Codex rule matches. Printing and `--check` stay allowed and still write nothing.
- **Agents never run `--apply`:** the setup skill and safety playbooks tell agents to hand the owner the command instead. The app's ask for the exact command is the only hard block; the refusals in an agent's shell and without a terminal are speed bumps. Blocks pasted before this release allow `--apply` with no ask until `--apply` or a fresh paste adds the ask line.
- **Merge authority:** changes to the apply command wait for a typed merge, like the permission, cleanup and store scripts.

## 3.75.0 (typed commands and remove Toolkit)

### Added

- **Typed commands:** `toolkit cmd`, `toolkit command`, `toolkit refresh`, `toolkit setup` and `toolkit show env`, typed as the whole message on your own computer, are matched exactly by the Codex and Claude Code prompt hooks. The agent is told which action was asked for, so `toolkit show env` always opens the editor. A phrase inside a longer message, in a relayed message or in a cloud session stays plain text, and a governance hold is unchanged. `node repo/scripts/toolkit-commands.cjs` prints the command list.
- **Remove Toolkit from this computer:** `remove toolkit` routes to `repo/scripts/toolkit-remove.cjs`. `plan` lists every scheduled task that carries Toolkit's marker in any Task Scheduler folder, Toolkit's own task files, the Toolkit block in each global rules file and Toolkit's raised `project_doc_max_bytes` line in Codex's `config.toml`, with a plan code. `apply --confirm <plan code>` removes exactly that list after the owner's OK; a list that changed removes nothing. Tasks changed by hand stay unless named, the owner's own listed tasks always stay, apply puts Codex's earlier `project_doc_max_bytes` back (a backup first, then a Codex load check), and no repository, key, other app setting or plugin is touched.
- **Leftover file report:** `repo/scripts/toolkit-leftover-files.cjs scan` lists files that are provably Toolkit's in GitHub checkouts whose governance is off or undecided. It reports only and never deletes.

### Changed

- **Setup covers the computer only:** setup no longer prints a task plan for the managed checkout and the folder it was started in. The computer-wide task update under the saved approval stays, and the direct task plan still gives one repository's details.
- **Hook pack:** context checks now also read the context a prompt hook adds.

## 3.74.0 (merge before owner tests, bump once at merge, one real-host round per release)

### Changed

- Owner UAT no longer holds a merge. A pull request whose line is `UAT: OWNER_TEST_NEEDED` merges on its review and green CI; the owner tests the installed build afterwards, its tasks stay open on `Refs` until their OK, and a failed test gets a fix-forward or revert pull request. The task auto-merge check now exits 0 for an owner test once scope allows, and says the test follows the merge.
- Pull requests hold `main`'s version and carry only a changelog fragment plus a `Bump: patch|minor|major` body line. The merging agent bumps once, at merge time, so a merge no longer forces a re-bump, new CI and a stale merge card on every other open pull request. Older pull requests that already carry a bump still go through the re-bump workflow.
- Hook changes read the hook pack from CI's Linux and Windows runs. The real-host smoke and the qualification matrix run once per release batch, after its merges, on the installed build and before the owner tests.

## 3.73.0 (refresh toolkit keeps your answers with no questions)

### Changed

- `refresh toolkit` (and `toolkit refresh` or plain `refresh`) now runs setup with `--refresh`: it updates Toolkit and, while the questions match the last bank answered on this computer, keeps every current answer (each row's `A. Keep current`) with no bank, in Codex and in Claude Code. An installed, turned-on plugin that the update left behind is refreshed.
- A new or different question, no saved answers yet, or a missing or turned-off plugin shows the full bank as for `setup toolkit`, with a line naming each new or different row. A recommendation you already declined does not bring the bank back.
- `setup toolkit` still shows the bank. An answered bank saves each row's question shape and the recommendation it showed under `~/.ai-agent-toolkit/user-state/setup-question-shapes.json`, one record per app, with no setting values, paths or keys.
- A refresh never approves a Codex configuration proposal, a scheduled-task standing approval or a native trust step, and `--refresh` refuses choice flags, `--yes-recommended`, proposal approvals and `--plan`.

## 3.72.1 (closing words wait for a task's recorded UAT)

### Fixed

- **Owed UAT on the target:** the issue closure check now also refuses a closing word for an open issue whose generated programme status records UAT as `PENDING`, `UAT_PARTIAL_REQUIRED` or `UAT_FULL_REQUIRED`, whatever the pull request's own UAT line says, and names the `Refs` link to use. Before, a pull request that needed no UAT of its own could close a task still waiting on the owner's test, even through quoted text.

## 3.72.0 (self-checking evidence store command)

### Added

- **`toolkit store`:** `repo/scripts/toolkit-store.cjs` does every evidence store step on a computer (`status`, `sync`, `save`, `move`, `merge-branch`, `delete-merged-branch`) and checks the store itself first: the merged binding's store and branch, a checkout whose fetch and push addresses are that store and whose own config holds no push, rewrite or program setting, and a private, writable store on GitHub. `save` stages only the named paths under the binding's store path, `archives/` or `evidence/`, secret-scans exactly what it stages (refusing a binary or non-UTF-8 file it cannot read), commits, pushes the bound branch with a plain push and reads it back on GitHub. Ancestry is read from real commits only (no grafts, replace refs or commit-graph), a merged branch's whole history is scanned, and "already merged" before a branch delete is GitHub's answer, not the checkout's. It never force-pushes, rebases, deletes a file or pushes another branch, and deletes a store branch only when it is already merged.

### Changed

- **Permission blocks:** the exact store push line and its ask lines are replaced by one store command line in the computer block. On Codex it is an allow rule and no store prompt rule is printed, so store steps stop asking there too. `toolkit permissions` no longer takes `--store`.
- **Merge authority:** changes to the store command wait for a typed merge, like the permission and cleanup scripts.

## 3.71.0 (programme sweep on a saved queue, and on GitHub)

### Changed

- The programme refresh now works through a saved queue on the one reconciler. Each pass reads the whole graph, then the tasks GitHub changed since the last pass, tasks whose page shows another revision than their state, open tracked PRs whose head or checks moved, and a rotating share, so every task is read at least once in twelve passes. It saves the state in one commit, keeps every recovery step it had, and a pass that changes nothing writes no state.
- Requests run one at a time within a cap of 300 per pass, keep a reserve for saving and redrawing, and stop reading when GitHub's rate limit runs low or asks to wait. When GitHub refuses GraphQL, the state is read one document at a time instead.
- CURRENT on the parent page starts with when the board was last updated, or how long it has been out of date, why, and how many tasks are still to check.
- `reconcile --apply` saves its state phase in the same single commit.
- The hourly sweep pass (`refresh --scheduled`) now works for up to 50 minutes instead of 10, is killed at 55 minutes and, on GitHub, has its job stopped at 58, so it always ends before the next hourly start. The refresh a session starts after its own GitHub write keeps 10 minutes and still leaves a flag for the scheduled pass while that holds the lock.
- On a computer, the hourly task's budget rises to 55 minutes and its Windows stop-after limit to 56; the refresh in it takes what is left, less the attention step, and never less than 10 minutes. A task registered with the earlier 30-minute limit is updated in place by the next apply. A long pass renews its sweep lease.
- `toolkit permissions` keeps allowing the programme refresh line with the sweep's `--scheduled` and `--budget-ms`, and its note now says they only set how long one pass may run, 10 to 50 minutes.

### Added

- The hourly Toolkit Programme Sweep workflow runs the refresh on GitHub under the governance GitHub App, with one installation token for the governed repository and one for its evidence store, each with only its own permissions. Without the App it posts a notice and writes nothing; a repository whose state is on a public branch keeps the computer's sweep.
- A shared lease in the evidence store lets one sweep write at a time across the computer and GitHub; a run stopped by its timeout is reported by the next one. The lease makes every write of its own record in turn: while the pass saves its state, the renewal rides that one commit, so a long pass never mistakes its own renewal for another sweep. A lease never outlasts its pass's kill time, a pass that defers to another sweep leaves no stop behind, and a pass that ends with an error records its stop where the next pass on either host reads it.
- On GitHub, the sweep reads the binding merged on the default branch online, so a fresh runner with no saved copy runs its pass, and a run that started before main moved stops with a notice.
- `repo/contracts/cloud-jobs.json` lists the jobs that run on GitHub and their tokens. Each token names only which of the governance App's permissions it takes, at the App's level unless marked read-only, so the App's permission list is kept in one place. `toolkit governance check` lists the jobs beside the App's setup, in the same words.

## 3.70.1 (closing words wait for the owner's UAT)

### Fixed

- **Closing words wait for UAT:** the issue closure check (CI and the PreToolUse hook) now refuses `Closes`, `Fixes` or `Resolves` in a pull request's title, body or commits while its own UAT line is `OWNER_TEST_NEEDED` or invalid, and names the `Refs` link to use instead. Before, a merge could close a child issue before the owner tested it.

## 3.70.0 (Marked notes move off large programme pages)

### Added

- **Marked notes:** on a programme parent page, old hand-written notes under one line that reads exactly `## Archive` now move, byte for byte, into linked comments on a complete pass. The whole page is saved to the private store and read back first, each comment is read back exactly before one guarded page write removes the notes, and AGENT CONTEXT links every part. Note comments are never edited, reused for other text or deleted.
- **New finding:** `ARCHIVE_SECTION_UNSAFE` reports, with one fixed reason and no page text, why marked notes stayed on the page. Any doubt about where the marked area starts or ends moves nothing, and the redraw carries on. The reader accepts only a written subset of Markdown up to the end of the marked area: blank lines, heading lines, code fences at the start of a line, `<details>` folds (attributes without quote marks) and comments on their own lines at the start of a line, and text lines with no HTML-like text and no level one or two heading or code fence behind indentation, a quote, a list marker or a footnote. Any other line, a Unicode space other than a plain space or tab, a lone carriage return or a leading byte-order mark moves nothing. Notes that use inline HTML, raw HTML blocks or indented code fences stay on the page with a finding; rewrite the line or move it outside the marked area.
- **Stopped passes:** a pass that stops for time finishes its redraw but moves no notes; the next complete pass moves them.

### Changed

- **Archive registry:** `page_archive` now also records note parts (with the saved page copy they came from). A note comment that later changes or disappears keeps its link and raises `ARCHIVE_COMMENT_UNTRUSTED` once, naming the saved page copy that holds the notes; later passes stay quiet and the owner's answer to the finding stands. Putting the same notes back under `## Archive` posts a fresh comment for them and leaves the damaged one as found. Older Toolkit versions refuse the new entries and the new finding field; update Toolkit on every computer that runs the sweep before marking notes.
- **AGENT CONTEXT:** the fixed line now says that only notes under one `## Archive` heading move.

## 3.69.1

### Changed

- Projects controllers run cloud-capable work in the cloud by default and use the device only for work that needs it. Gate routes can place individual gates on the device while other gates run in the cloud.
- Cloud reviews and rechecks count towards the work-lane cap unless the project's own review-lane line allows a separate number alongside it. The managed instructions block carries the same cloud-first rule.

## 3.69.0 (Projects follows local Toolkit as its base)

### Added

- **Projects base rule:** the Projects controller skill now opens with the rule that local Toolkit (global, gate and governed rules and the controller file) is its base. Every place Projects differs is a row in the new overrides list with the owner's decision; any other difference is a clash for the owner.
- **Projects task auto-merge switch:** the gate rules name Claude Projects as a third app. Its switch is the project line `- Task auto-merge: On`, and its one named merge thread stands in for a session the owner started. The skill's Approvals section gives the cloud merge route: eligibility check at the exact head, effects notice, head-pinned merge commit, or the owner's card tap at that head.
- **Cloud hook table:** a new reference table says, for every hook in the plugin manifest, how its rule is covered in cloud sessions. A test fails when a hook has no row.
- **Weekly base clash check:** a new task step compares the base files with the copy the guidebook names, and raises each new clash as an owner question. The daily check-in runs it when a week has passed and no weekly audit covers it.
- **Guidebook BASE file:** the guidebook copy now carries `BASE`, the git blob SHA of each base file, so a coordinator can tell which base its copy follows.

### Fixed

- **Governance status in cloud sessions:** a Claude Code cloud container's own git rewrite (ssh spellings of github.com to canonical https, no credential prompts) no longer holds the binding read, so `toolkit governance status` reads the merged binding there. Any other command-scope config stays held.
- **Hook status lines:** `toolkit governance status` no longer says cloud sessions and Claude Projects have no hooks; account copy hooks run there, with the merge and undecided-repository holds skipped in cloud sessions.

## 3.68.0 (one-time permission blocks and checked cleanup)

### Added

- **`toolkit permissions`:** `repo/scripts/toolkit-permissions.cjs` prints two paste-once blocks so Toolkit's own reversible commands stop asking each time. The computer block covers the programme commands that keep records in step, the scheduled-task commands and the cleanup command. The repository block covers pull request and issue comments and one exact evidence store push to the store's own origin and branch; merges are never in a block. A line carries a wildcard only where the script behind it checks its own arguments, and ask lines cover a task repair, a folder override, a skipped first run, a keep-or-replace answer and a comment delete. Codex cannot ask for a flag, so those commands are prompt rules in the Codex block. It only prints and checks; the owner pastes. `--check <file>` reports missing and stale lines, and `--format allowed-tools` prints the same lines for a single launch.
- **`toolkit cleanup`:** `repo/scripts/toolkit-cleanup.cjs plan|apply` removes Toolkit scratch only: finished worktrees, temp files under the scratch folders and local branches already merged into the default branch. It never removes part of a worktree or a clone, a bare repository, anything whose path goes through a link, or anything behind a linked scratch root, and it counts every untracked and ignored file whatever Git's settings say. It always reads the evidence store back first, deletes nothing when there is no store to read back, and prints one line saying what it cleaned and what it kept.
- **Start a recorded scheduled task:** `repo/scripts/toolkit-windows-tasks.cjs start --task <id>` runs one Toolkit-owned task now, and refuses tasks Toolkit does not own, the owner stopped, Task Scheduler shows as turned off, or someone edited by hand.

### Changed

- **Safety gates:** the hard stop on saved permission rules now names the printed blocks as the supported route. Agents still never write host settings or rule files.
- **Merge authority:** changes to the permission and cleanup scripts wait for a typed merge.

### Not included

- Claiming a controller seat, removing or adopting tasks, repairs, closing issues, deleting remote branches, forced, mirror or deleting pushes, a push anywhere but the store's own origin and branch, settings edits and secrets stay outside every block and keep asking.

## 3.67.0 (governance GitHub App setup and removal guidance)

### Added

- **Governance GitHub App guidance:** publishing a pull request that turns governance on now shows the owner the one-time App setup: a pre-filled "New GitHub App" link with the right permissions, the install on the repository and its evidence store, and the `gh` lines that save the client ID variable and the private key secret. Publishing one that turns governance off suggests the removal: deleting the variable and the secret, removing the repository from the installation, and deleting the App when nothing else uses it. Toolkit never creates or deletes any of these itself.
- **`toolkit governance check` reports the App:** a missing App while governance is on, and a left-over variable or secret once it is off. It reads only the names, never changes the exit code, and reports anything it cannot read as unverified.

## 3.66.0 (automatic re-bump workflow and a narrower launch rule)

### Added

- A re-bump workflow for this repository: after every push to `main` it runs the re-bump command for the owner's open pull requests and pushes with the repository secret `TOOLKIT_REBUMP_TOKEN`, so their checks start by themselves. With no secret it prints a note and does nothing. A pull request it cannot re-bump gets one comment that says why.
- `toolkit-rebump-prs.cjs --authors <login,...>` skips other authors' pull requests before any of their code runs.

### Changed

- The re-bump command runs the pull request branch's own bump and validation scripts with every token variable and the Actions file-command paths removed from their environment.
- The merge hold no longer refuses a command that starts Claude or Codex when its only merge wording is branch upkeep: `git merge`, merge commits, merge conflicts or merge-base. Any other merge wording still refuses the launch, and pull request merges stay guarded.
- The merge hold's approval reader now skips a typed line whose only merge wording is the same branch upkeep, from one shared definition, so a launch the hold lets through carries no line the reader counts, as far as the hold can read the command (text the shell reshapes afterwards is not covered). A line such as `git merge 5` or `update #5 with a merge commit` no longer records an approval. This is one more reason to skip a line and nothing else in the reader changed: every line that was held before is still held, and `merge 5` and `merge owner/name#5` count as before.
- A pull request that changes the re-bump scripts (`toolkit-rebump-prs.cjs`, `toolkit-rebump-report.cjs`, `toolkit-rebump-action.sh`) now waits for the owner's typed merge.

## 3.65.0 (Controller enforcement map)

### Added

- A map says, for every controller rule, what enforces it: a hook, a script, a CI check or the programme reconciler, each with the test that proves it and one line on which part of the rule they cover. A rule nothing can enforce is marked instruction-only, with one line on why. Of the 40 rules today, 17 are enforced and 23 are instruction-only. The map lives beside the rules, so the rules files gain no bytes.
- A check fails when a controller rule has no row or two, when a row matches no rule or more than one, or when a row names an enforcer or test that does not exist or a test that never mentions its enforcer. It runs with the test suite, so a rule added, moved or reworded without updating the map fails CI.

## 3.64.0 (One layout for task pages and task PRs)

### Added

- Open task pages follow one fixed order: PATH, STATUS and COMMENT TRACE, then PROBLEM, FIX, IF WE SKIP, DONE WHEN and NOT IN SCOPE, then More with every other hand-written word in its original order. Older label lines and headings become the matching capital sections; the words under them do not change.
- A copy of a task page is saved to the private state store and read back before any write that moves its hand-written text. Without the copy the page is not written.
- Every open or draft PR that names a task gets PATH and STATUS at the top, with the gate, review at the head, UAT and release of each task it names. The PR description stays as written, and merged or closed PRs are never edited.
- A managed block shown as an example inside a code block, quote, list item, indented code, details section or other HTML block is hand-written text on every page: it is never updated, moved or cut.
- Where a block goes is read from the same top-level view of the page as the block search, and every block is read back before a page is written. A page whose block would not be found again is held with `MANAGED_BLOCK_BROKEN` and nothing is written to it.
- The plan says when a page's text will move ("Lay out #<n>'s page in the fixed order"), and the result names the saved copy.
- The task status block lists every PR found for the task, open first.
- A page that cannot be laid out safely keeps its text in place, still gets fresh blocks, and raises the new `PAGE_LAYOUT_HELD` finding with the reason. A pass re-lays at most ten pages.
- The new `TASK_IDLE` finding flags a task shown in progress with no open PR, no live gate assignment, no holder and no change for six hours.

### Changed

- The Programme Graph PR column shows one PR per row, the most recently opened one, with no count of other PRs.
- The generated blocks on task pages carry capital headings, matching the programme page.

## 3.63.1 (Update lines only on edited posts)

### Changed

- **Projects posts:** The guidebook now says Update lines start with a post's first edit. A first or fresh post has no Update lines and lays its points out as clean bold-label bullets under the Now line, with a short good and bad example.
- **Project instructions block:** The post layout line carries the same rule, and the problem, fix and skip lines are written as three one-line bullets.
- **Task relays:** A scheduled task relay that has to go in a fresh post is a plain bullet there, not an Update line.

## 3.63.0 (Controller core plus pages, mixed stack removed, device-offline alert)

### Changed

- Split `repo/CONTROLLER.md` into a small core that every controller always loads and three pages under `repo/controller/` that are read at the step they cover: roles and routes, gates, and evidence, progress and finish. Every rule moved word for word; only the relative link paths inside the pages changed.
- The core's new Pages section lists each page with a short hash of its content, so a page change also changes the core file and one bound CONTROLLER.md blob still covers every rule. `node repo/scripts/sync-controller-pages.cjs --write` refreshes the hashes, and the check fails on a stale hash, an unlisted or missing page, a rule with two homes or a broken link.
- Lowered the core's size budget from 18,500 to 9,500 bytes and gave each page a 5,000-byte budget.
- The pages are RISKY and always need the owner's merge OK, like the core, and both plugin setups check them in the installed copy.
- A gatekeeper is no registry role. It is a launcher session on the mid tier at medium effort, stated in the controller rules and on the cost-control ladder, never the small tier, and a raise needs its written reason.
- Installed Codex helper files that name a removed mixed stack are refreshed from `owner-gpt`, which has the same helper model and effort. Setup says so in one line. Any other unknown stack name is still held.

### Removed

- The stack registry ships two stacks only, `owner-gpt` and `owner-claude`. The mixed stack `claude-projects-stack` (older name `owner-mixed`) and its `GATEKEEPER` route are gone from the registry, its schemas and the role list, so a decision or a captured registry that names one is refused.

### Added

- The Projects coordinator alerts the owner when a device with unfinished lanes goes offline: one notifying ask per outage that names the device, links each affected thread and gives the one step, kept under the waiting list until the device is back. The hourly nudge lists such lanes under its owner steps and starts its report with `DEVICE OFFLINE: <n> | `. A failed status read is reported as not checked, never as offline.

## 3.62.0 (UAT verdict on every pull request)

### Added

- Every pull request body now carries one `UAT:` line that says whether the owner has to test the change: `UAT: NOT_REQUIRED (reason)`, `UAT: OWNER_TEST_NEEDED (what the owner tries)` or `UAT: PASSED (the owner's OK)`. The plan proposes it, the builder writes it and the reviewer confirms it. The portable Git completion playbook holds the format.
- The task auto-merge check reads that line: `toolkit-auto-merge-eligible.cjs --base <SHA> --head <SHA> --body-file <file>`. A pull request with no line, a malformed line or an owner test still open now exits 1 and names the reason (`Missing UAT verdict`, `UAT verdict invalid`, `Owner test needed`) together with any merge-rule path, so a finished pull request no longer waits in silence for an answer nobody was asked for.
- The hourly nudge and the daily check-in list a ready pull request with no `UAT:` line as `missing UAT verdict`.

### Changed

- The check no longer answers when it is called with neither `--body-file` nor `--scope-only`: it exits 2 with its usage, so an older habit cannot read a scope-only pass as merge readiness. `--scope-only` keeps the previous scope report and says it grants no readiness. The merge hold is unchanged and still checks scope only.
- The check reads a saved body safely. It reads UTF-8 and UTF-16 with a byte order mark (what Windows PowerShell 5.1 writes for `> file`) and exits 2 for any other bytes, so a wrongly saved body is never reported as a missing line. A line dressed up to look like a UAT line (invisible characters, unusual spaces, look-alike letters, a bullet, a heading, or a spot beside an HTML comment) counts as a line and makes the verdict invalid. It is never skipped. The playbook says how to save the body on Windows.
- A missing or invalid line goes back to the gate that owns the pull request and is never turned into a question for the owner. Only the owner's own answer turns `OWNER_TEST_NEEDED` into `PASSED`.

## 3.61.0 (Programme refresh reads only what changed)

### Added

- Programme refresh reads only what can have changed. One request for the parent's sub-issue list replaces a read per child, empty comment and sub-issue lists are not requested, the parent's comments are read from a bookmark, and a settled child that has not changed reuses its last comments and merged pull request. Every reused child is read in full again within twelve passes.
- Private timing, request counts and reuse counts show where a refresh spends its budget. The refresh report has a `Reads:` line.

### Fixed

- Programme state documents are replaced only against the version they were read with. A read that comes back without its version id writes nothing.

## 3.60.0 (Agent context comment under AGENT CONTEXT)

### Changed

- The programme parent's AGENT CONTEXT block now links the comment whose topic is "Agent context", and COMMENT TRACE no longer lists that comment. When more than one comment carries that topic, the block says so, names them and leaves them in COMMENT TRACE.

## 3.59.1 (Show queued programme refreshes)

### Fixed

- The scheduled programme sweep reports a queued refresh as held and still checks attention. A run that waits behind another pass no longer reports the refresh as done.

## 3.59.0

### Added

- A closing-story command for agents in any GitHub repository, with close-word and secret screening, duplicate protection, preview and readback.
- Governed refresh checks recent PR and issue closes for missing stories, seeds historic watermarks quietly, and carries unread items forward within the shared pass budget. After 24 hours it appends at most 20 facts comments per pass, using the existing intent journal to prevent duplicate posts after a crash. Facts stay waiting until an agent supplies the story.
- A portable closing-comments playbook and merge-ask pointers explaining who stays subscribed and records what shipped, verdicts and follow-ups.

## 3.58.0

### Added

- Programme parents show managed CURRENT, PROGRAMME GRAPH, AGENT CONTEXT and COMMENT TRACE headings.
- Large programme pages move only the needed graph rows into verified archive comments at the 55,000 safe limit, with linked Archived group counts and a shared five-comment budget per issue. Only the first exact CURRENT heading outside code fences and HTML comments migrates on first insertion (raw HTML blocks, a fence that starts on a list-marker line, a leading byte-order mark and a lone carriage return are not modelled yet); an exact adjacent CURRENT heading outside those examples and comments also migrates into an existing managed block. Recovery keeps unchanged graph parts verified read-only across logins, quietly excludes superseded parts within the bounded registry and detaches excluded, changed or missing comments without stopping redraws. Toolkit never moves hand-written sections. If the page nears its size limit, shorten them by hand.
- BODY_NEAR_LIMIT and BODY_TOO_LARGE remain visible as durable attention findings with exact section sizes, including refusals discovered while applying a redraw.

## 3.57.0

### Added

- Programme refresh has a ten-minute budget, reserving its last two minutes to record unfinished progress and redraw CURRENT. Applying passes clear interrupted notes only from exact verified stored diagnostics in any finding state, including when no changes are planned; issue-scoped applies preserve interruptions not yet stored. Different stopped-pass diagnostics reopen answered findings, waiting counts age from when a finding last became new, ordinary effect failures hold only their scope, and unposted parent repair notices remain recoverable.

### Changed

- Redraw the parent programme page before its link, order and task-page queue, and batch each group's intent commits on the parent while retaining fence checks and independent read-back.

## 3.56.1

### Fixed

- Codex configuration checks distinguish host refusals from unavailable probes and failed shutdowns without treating executable folder names as configuration errors.
- Codex setup, runtime detection and temporary configuration edits find npm command shims on Windows and start their wrapped program without a shell.
- Toolkit validation reports unused kept terms, and the plain-text check explains when an exemption is no longer needed.
- The Codex launch hold documentation uses platform-neutral wording and checks its reason list against the runtime code.
- Only Codex lookup skips command wrappers it cannot start directly when a working executable appears later on PATH, and start failures retain the specific reason.
- A crashed configuration probe reports that the write is not verified and keeps the written file.

## 3.56.0

### Added

- Refresh copies GitHub closes and reopens into programme child state and adopts newly observed native tasks at the end of Later.
- Task pages show all discovered pull requests, including merged commit links. The programme graph shows the current PR and a short count of other PRs, with compact table cells to keep its per-task size bounded. Unlinked open pull requests and those closed after the first complete scan raise an attention finding, excluding known bots and generated test-timing branches starting with `toolkit/shard-timings-`.
- Findings left new for 24 hours appear in the owner's waiting count, with at most five short entries and a count of the rest on the parent page. The attention command keeps the full list.

### Changed

- Child state uses a versioned schema; existing child documents remain readable and upgrade on their next changed write. Older readers hold rather than misread the new documents. Update Toolkit on a computer reporting unknown sweep fields, the old child schema requirement, or the parent error `attention[n].code is not a known finding code`.
- Refresh shares a bounded PR discovery budget; native sub-issue observations are outside it. Task discovery gaps retain the affected history while unrelated findings can resolve, and the parent timeline does not gate PR discovery.
- The first complete PR scan seeds a watermark without reporting historic closes. Later closed scans stop at that boundary with a five-minute overlap, retain discovered task history and use the scan start time for the next watermark. Failed watermark writes hold for retry.

### Fixed

- Waiting previews omit missing issue numbers and distinguish findings by their short commit hash.
- A copied completed close without accepted completion now raises a specific finding without inventing review or user acceptance.
- Reopened sweep-closed tasks regain their previous lifecycle once; an unchanged second refresh writes nothing.
- Controller-set terminal lifecycles are kept; disagreement with the issue close reason raises a state conflict.
- Ordinary reconciliation keeps refresh-owned findings and their acknowledgements until refresh checks them again. Untracked-task findings use open pull requests only.
- Native children of another registered programme parent are skipped during adoption planning, and an added-child notice is recorded only with a successful catalogue addition.

## 3.55.2

### Fixed

- The plain-text check now fails a full run when a kept term is no longer used, so stale exemptions are removed in the change that ends their use. Toolkit's two stale setup-bank entries are removed.
- The Host Contract lists "unexpected error" among the Codex hook check's hold reasons.

## 3.55.1

### Fixed

- A Projects thread or worker relays the takeover entry and stops only when it works on the coordinator's takeover.
- A new controller's governed takeover record is posted on the same route as its claim, straight before it, which narrows the window for a programme sweep to write the parent in between; if one still does, the claim refuses as unverified and a new record follows.
- Connector writes never push task or product source to a default branch, and their text is checked for AI attribution and personal data first.
- Relay packs ask the helper to run one step at a time.
- Projects setup writes the device folder into the gate route and runs the scheduled-task check once it names the device.
- The Projects guidebook refuses a second copy of the takeover playbook anywhere in the skill folder.

## 3.55.0

### Added

- A daily no-AI task checks scheduled jobs, reports missing and unhealthy runs, and shares a path-free health file through a verified private evidence store.
- Scheduled task updates cover enrolled and discovered GitHub checkouts under one saved owner approval, with host questions for hand edits and computer ownership.
- A surviving task launcher reports a missing Toolkit checkout and disables its own task after three misses without deleting it.

### Changed

- Setup asks about scheduled task updates in its task section and uses the same guarded updater. Cloud schedules remain coordinator work.
- The existing session task line includes cached health findings and explains when no verified evidence store is available.

### Fixed

- Computer-wide task health no longer borrows repository ownership or minutes, and repository removal leaves it alone. Existing mixed records are migrated during an approved update.
- Task updates preserve hand-edit questions for older enrolments and continue with other repositories when one is held. Setup still refreshes global rules and helper definitions when task work is held.
- A failed native task write stops the rest of the update run, including the computer-wide health task, and the update report always prints, including any health task failure. A damaged missing-checkout count or receipt no longer stops the launcher's self-disable.
- Each evidence store receives only its own repository's health results and computer-ownership choices, instead of one store receiving every repository's. A newly found checkout is checked against its own store's owner before any job is created.
- A computer whose tasks were enrolled before computer identities existed is no longer held by the evidence-store ownership check, and a held ownership check now names its cause.
- Concurrent missing-checkout launchers retain both disabled records and preserve footer scan, skip and deferral history. Current task updates restore missing launchers and refresh their code version.
- Health waits for busy stores, serialises checkout status reads, keeps a local report when sharing fails and records a safe failure reason. Expected quiet skips and stopped health checks no longer raise alerts.
- Explicit setup flags resolve the scheduled-task question without waiting for input. Setup regression suites are split without changing their coverage or time budget.
- Uncertain GitHub authentication reads defer weekly work visibly instead of treating a failed read as confirmed sign-out.
- Refresh lock takeovers log a plain line, and retry notes survive an exhausted task budget.
- The refresh-wait changelog wording now states the actual bounded wait.

## 3.54.1

### Fixed

- Controller takeover relay packs now record dependent heads and final reads so stale results are refused.
- Evidence-store pushes refused by the hook use a fixed records branch with read-back and a pull request where applicable, keeping merge approval requirements.
- Relay pack times come from observed timestamps, with an explicit unknown value when no time is available.
- Capability checks distinguish denied read probes from native write denials, preserve prepared files and offer only routes with their own permission.

## 3.54.0

### Added

- One shared controller takeover journey on every harness, using capability probes, own tools before executors and owner relays, structured proof and visible user-supplied evidence.
- Connector account, read-back, hook and approval guards. Programme, scheduled-task and shard checks require fresh enabled governance.

### Changed

- Projects runs the shared journey before its own setup extras; its guidebook includes the canonical takeover playbook.
- Relay groups use Read pack, Custody pack, Record pack, Task pack and Gate pack, with lower-case words in pack ids.
- Question cards follow their explanation, and the compact Controller points to the full journey and capability routes.
- Controller takeover playbook edits are in the highest risk tier and held from auto-merge until the owner's typed merge approval.

## 3.53.1

### Fixed

- Keep Toolkit's plain-text settings in `.github/plain-text.json` so direct runs and the required validation check use the same rules and existing empty baseline.
- Recognise Toolkit's source wrapper during governance checks and tell rules refreshes to leave the plain-text installer unused in a Toolkit source checkout.

## 3.53.0

### Fixed

- Report Codex hooks changed since approval or unverified instead of saying they are on, and provide a read-only hook check that holds gate launches until approval is current.
- Refuse unreadable issue-close calls and PowerShell quoting that hides a GitHub write under Codex Bash, while preserving ordinary reads and quoted examples.
- Correct code-mode hook guidance and require smoke tests to prove a guard refusal without editing the installed plugin folder.
- The Codex hook check now also asks Codex which Toolkit hooks it trusts, and holds a gate launch unless Codex reports every hook trusted at the hashes Toolkit recorded.
- A gate launch check passes only on exit 0 with the line saying all Toolkit hooks are on; no output, as from an older installed copy, holds the launch.
- The fallback checks used when the Toolkit hook cannot start or cannot read a call now catch issue close and pull request writes in any gh spelling.
- Clearer refusal and recovery wording for ambiguous shell quoting, a plugin folder Toolkit cannot fingerprint, and a missing hooks file.
- The Codex hook check keeps an answer Codex already gave when Codex then does not stop, always ends within about 35 seconds, and names the reason for each hold without repeating Codex's own output.
- The Codex hook check asks only the Codex program the gate will run, named with `--codex` or `CODEX_TOOLKIT_CODEX_CLI`, starts an npm `codex.cmd` without a shell, and holds when no Codex is named.

## 3.52.0

### Added

- Stable repository minutes for Windows scheduled jobs, with a warning when more than nine repositories share the available minutes.
- Recorded job-owner computers and a local programme lock to serialise scheduled store and programme writes, with logged stale-lock recovery.

### Changed

- Hourly cleaners start at their repository minute and run for 24 hours. Governed shard timing runs on Monday mornings at the same minute after 08:00.
- Exact earlier Toolkit task definitions migrate in place while owner stops and hand edits remain protected.

### Fixed

- Killed, failed or unreadable shard status reads remain visibly deferred for retry. Each status attempt has a complete busy-computer budget, a killed retry keeps the first failure, and checkout waiters allow the holder to finish within the shared task deadline.
- Lock release failures retain their summary, deferred shards retain skip history until work resumes, and failed catch-up notes name the repository and task.
- Printed task commands preserve native Linux paths, including removal recovery hints; Windows command paths retain their existing form.
- Scheduled jobs serialise checkout status refreshes with a sixty-five-second bounded wait and one bounded retry, and failed shard refreshes remain deferred for catch-up.
- Releasing a store lock starts eligible deferred jobs from other local repositories sharing that store. Deferrals retain their first time and count, show their age without hiding sweep failures or sign-out, and still raise the two-hour warning. Catch-up saves failed-start notes and matches repository names without case sensitivity.
- The governance hold allows the managed checkout's exact default-folder commands for independent footer tasks while retaining holds on governed tasks and unrelated commands.
- A first programme sweep without parent state skips with plain instructions for the appointed controller to initialise it in the private evidence store.
- Jobs that find another job holding the programme lock record a visible deferred result and retry, and a deferred weekly shard run is started by the next hourly sweep.
- The apply and remove commands the planner prints use the literal managed path, so the governance hold allows them.
- Scheduled jobs refresh the governance binding before choosing the lock and effects, so a stale cache no longer skips a sweep.
- Computer ownership uses a stable saved id instead of the host name, so renaming the computer keeps its jobs, and any other-owner state shows on the session line with a recovery step that exists.
- The setup reason shows once, a broken task policy module no longer refuses every shell call, and a lock file error records a failed result.

## 3.51.0

### Safety

- Refuse pull request text, merges and issue closures that would close a parent with open native descendants, including optional and uncatalogued children. Locally, unreadable text or incomplete GitHub state holds the affected write; cloud unknowns are advisory.

- Add a read-only closure check feeding the required validation job, and explicit binding permission for fenced parent reopening, completion and recoverable repair notices on refresh.

- Use Refs for programme-parent links; retain child acceptance and user testing requirements.

### Fixed

- Refuse guarded GitHub writes hidden in assignments, unknown wrappers and unreadable Start-Process arguments, and unmatched merge commands before consuming approval. Keep data commands and quoted examples inert. Also read gh with a brace or equals sign attached, PowerShell's stop-parsing word and block comments, and more shell option spellings; refuse gh commands whose noun or verb comes from a variable.

- Add a separate Windows closure shell family with retained controls; keep every family budget unchanged. Bound repeated wrapper and document scans, allow literal read-only query text, and name folder changes and proven refusals accurately.

- Read supported wrappers, condition positions, substitutions and unresolved closing targets; inspect literal quoted heredoc text without executing expansion. Preserve merge approvals when another guarded write refuses the call, and check cloud connector merge-message overrides.

- Preserve shell context and outer expansion across nested calls, and share generated-file and literal-stdin checks with merge-message overrides.

- Split the Windows closure command matrix into its own family, retaining every row and the 360-second budget.

- Codex code-mode exec shell calls remain an accepted gap, tracked separately.

- Update every computer together: older readers reject the parent lifecycle binding and pending lifecycle intents, holding governed work until updated.

- Repair executable command reading, flag arity, cloud unknown advisories, shared invocation deadlines, supplied-text edit checks and full unattended completion walks.

## 3.50.1

### Fixed

- Direct task listings on Windows read the repository's configured schedule folder without circular dependency warnings.

## 3.50.0

### Fixed

- Session start warns when recorded Windows tasks disagree with fresh confirmed governance. The advisory grants no approval and disappears as soon as current enrolments match; offline, stale and uncertain reads stay silent.

- Windows scheduled tasks follow confirmed governance changes, preserve footer scan history and leave existing GitHub material in place. Modified governance tasks ask whether to keep the owner's changes or restore Toolkit's definition. Interrupted switches hold when deletion is unproven and offer explicitly approved recovery. Task removal includes legacy and moved-checkout enrolments in the selected repository; agent guidance routes post-merge task checks to the device.

### Changed

- FOOTER SWEEP joins the fixed-task standing approval for verified github.com repositories with fresh matching disabled governance or confirmed binding absence. Fresh confirmed governance changes allow owned cleaner swaps in the same checkout and folder. Modified PROGRAMME SWEEP or SHARD TIMINGS tasks require the owner's keep-or-replace answer each time. Direct task removal, same-job repair, folder overrides and custom tasks still require explicit approval; the approved apply switch is the removal exception.

## 3.49.2

### Fixed

- New plain-text baselines store fingerprints instead of matched links. Legacy baselines remain recognised and can be migrated explicitly with allowances unchanged; ordinary checks and installer refreshes leave them unchanged.
- Malformed or unreadable baselines fail with a generic message. Scoped checks cannot be combined with baseline writes, and the repository wrapper supports explicit migration.

## 3.49.1

### Fixed

- Setup rejects restoration mixed with planning, explanation, execution or extra arguments before invoking recovery. Dedicated backup restoration still works.
- Plain-text stale-baseline notes retain file names, rules, counts and pruning guidance without printing matched text. Baseline storage remains unchanged.
- The hostile-input timing self-test uses a controlled monotonic clock to check growth, calibration and sample limits without scheduler-dependent assertions.
- Hook test pack guidance distinguishes the 15-minute job timeout from the 360-second pack budget.

## 3.49.0

### Changed

- Local agents register or update Toolkit's fixed Windows programme sweep and shard timing tasks under narrowly scoped standing approval, with verified enabled governance, ownership checks, owner stops and run-result verification. Setup continues to report tasks without changing them.
- The standing command refuses, instead of updating, any task owned by another repository or checkout, any run from a plugin copy or linked worktree, and any task the owner removed, disabled or hand-edited. A removal now records a lasting owner stop. A narrow, owner-approved repair option restores only Toolkit-owned tasks of the same repository.
- Every eligible governed repository gets the shard timing task. Runs report `no shards yet` without repository or external changes until the shard manifest appears, then use Toolkit's fixed refresher automatically.

### Fixed

- Raise the global instruction block budget from 18,500 to 19,400 bytes and the Projects skill budget from 44,200 to 44,900 bytes, preserving the existing wording and allowing for Windows CRLF line endings.
- Remove the old advice to paste a registration line from the reconciler skill, the recurring-tasks reference and the hourly nudge.

## 3.48.4

### Fixed

- Keep Bridge updates and shard refresh worktrees on their own fetched commit when another fetch runs at the same time, and remove only the invocation's temporary ref.
- Use a wider Linux shard-balance trigger while keeping the Windows trigger, and state the review and verification still needed for generated refresh candidates.

### Documentation

- Define version bumps by the files installed consumers read or copy, with the shard manifest as a development and CI example.

## 3.48.3

### Added

- A programme page redraw that is refused for being too large now leaves a lasting attention finding that names the total size, the limit, the reduction needed and the largest sections. It stays open until a complete redraw is written and read back.
- The session-start sweep line now names a recently held scheduled sweep, in addition to skipped, failed and overdue runs.

### Tests

- A new test proves that taking over a programme reads the same bounded set of resources whether the history is short or long.

## 3.48.2

### Fixed

- The CI check-up now reports a failing command hidden by a later `exit 0` line in PowerShell and cmd steps.
- The CI check-up decides whether a job runs on Windows only from its runner labels or the matrix values it names, so a step called "windows documentation" no longer makes a Linux job look like a Windows job. An unresolved runner produces a CHECK for the agent to judge only when a step ends in `exit 0` and sets no shell.

### Tests

- The external operation preflight tests now cover blank authority fields, empty target lists, secret patterns and key names, and secrets nested under secret-looking keys, and check that no secret value is echoed.

## 3.48.1

### Fixes

- Page large comment traces directly into bounded directory comments with a separate line per topic, preventing notification floods while retaining hand-written prose and decision links. Small moves use at most five topic comments per pass. Interrupted passes verify and reuse pages. The audit rejects missing, cyclic or unrelated links in generated indexes within two hops; hand-made indexes retain their one-hop reading and ignore foreign references.
- A deleted comment linked from a generated decision index no longer stops the programme page redrawing; the comments it no longer reaches are listed in the body again, and the audit finding says how to clear the dead link. Index links match the repository in any letter case.
- Keep recovery holds for unchecked writes when attention findings change. Hand-nested directories return as body links so their decisions stay reachable, and index-limit holds explain the correct recovery step.

## 3.48.0

### Changed

- Governance on or off now comes only from the programme file merged on origin's default branch, on every computer. Historical local answers are inert.
- Yes and no prepare a pending decision pull request. Prompt hooks capture answers without publishing; the assigned agent publishes, reads back and asks for the owner's merge. Yes carries the binding, governed rules and installed checks together in one setup pull request. Later asks again next chat.
- Verified read-only accounts continue with global rules and a plain note, without governance effects or standing task auto-merge. Pending proposal checks on prompts use one PR-state read, throttled per repository and limited to three seconds including any default-branch refresh after closure.
- Ordinary work continues when GitHub cannot be checked, without governance effects or standing task auto-merge. Evidence-store exemption requires an exact programme-binding relationship.

## 3.47.1

### Fixed

- Let pinned evidence-store pull request merges use the existing custody permission when a fresh merged parent binding names the exact separate store and live checks confirm privacy, write access, default-branch base and matching head. Other repositories keep their existing merge approval handling.
- Add isolated hook-pack coverage for verified evidence merges and failed verification, without contacting GitHub or reading real user state.

## 3.47.0

### Added

- Added the Claude Projects stack with a Sonnet gatekeeper, Codex discovery and building, Luna helpers and one fresh Opus review.
- Defined a gatekeeper's relay-only duties and the cross-host CLI launch exception with pinned model, effort and native launch-record proof. Launcher and hook enforcement remain separate work.

### Changed

- Replaced the bundled mixed profile with `claude-projects-stack`; pinned legacy two-profile and mixed-profile captures remain readable pending deliberate adoption.

## 3.46.1

### Fixed

- Threads reading the Controller for a Claude Projects coordinator's appointment, takeover or setup, or only to read or report on it, now relay its Projects setup instruction and guidebook link before takeover writes. Setup remains coordinator-only, with identity checked from its own host role and tools; relayed text never grants identity or authority.
- Restored the Projects skill's whole-session scope and clarified who routines ask when owner action is needed.
- The Projects setup relay now covers a brief that only asks to read or report on the Controller, and coordinator workers as well as threads. It also carries the missing-folder steps a coordinator needs to start setup, and the relaying session stops and waits after reporting.
- A setup step's own brief can now carry out that step, including the takeover record in a takeover from an existing controller, so the relay's write ban no longer stalls setup there.
- Ordinary build and review briefs that read the Controller continue on their brief without the setup relay.

### Changed

- Raised the Controller size budget from 18,000 to 18,500 bytes so rule wording is not cut.

## 3.46.0

### Added

- A small Claude Code shell session check prints only whether the Toolkit session entry exists and whether it equals the shell's own non-empty session ID. It grants no authority; installed delivery still needs checks in both real shells. Missing delivery needs fixing and does not switch task auto-merge off; select Off in this app's setup until fixed. Codex does not deliver the variable, so its absent result is expected.

### Fixed

- Merge guidance offers typing in a fresh eligible chat, while reconnected and revoked chat reasons offer only the other approval routes.

## 3.45.1

### Fixed

- Keep standing task auto-merge for a user-started Claude session reconnecting with the same session ID when the resume has no inherited host-session variable. Codex and unknown-host reconnects need explicit approval: in a new chat on this computer, as a direct Projects message to the lane, or by the Merge button on GitHub. Typing in a reconnected or revoked chat records no approval. A resume carrying the variable revokes standing for that session ID, including after later starts without it. Repeated startup events and failed mark replacements cannot clear recorded restrictions. A clear under a new ID has no standing origin but accepts a typed merge because its mark is not resumed.
- Refuse direct runs of Codex's session-start script and common commands that feed a session-start event to Toolkit's hook scripts. Refuse direct host-session variable clears through PowerShell's environment path and environment API, export and declare flags, assignments and unset commands. Refuse env's empty-environment flags only on commands starting Claude or Codex; ordinary searches, messages and tests remain allowed.
- Name the failed standing merge check in refusals and provide a read-only merge check through the session's hook context without consuming approval. A terminal check names its missing native session context before app preferences.

## 3.45.0

### Added

- Show Projects owners one linked list of Remote Control threads needing text to resume after recovery.

### Fixed

- Notify Projects owners in the same turn when a new actionable ask arrives, including after a coordinator restart, with hourly checks for missed asks.

## 3.44.3

### Fixed

- Fresh Claude Projects coordinators automatically bootstrap their guidebook and guided setup on appointment, only when the host identifies the top-level coordinator and provides native project tools and library access. Other hosts and executor threads keep their assigned roles, and failed bootstrap holds takeover.

## 3.44.2

### Fixed

- Correct Windows Codex review guidance for pinned model and effort, worktree dependencies, per-run temp grants and measured limits; assign hook-pack evidence and cleanup to the unsandboxed launch lane, and restore the shared-record rule for project memory.
- Document the qualified Windows Codex review launch with read-only source, one pre-created writable temp root and network refusal. Require an already elevated backend and set temp variables inside review commands. Keep required suite and hook-pack evidence separate from permission qualification; add explicit-root nested runner and grandchild cleanup coverage.

## 3.44.1

### Fixed

- Git folders without a github.com origin now report governance DISABLED automatically. Missing origins, multiple origin URLs and other hosts no longer hold prompts or ordinary tools for an acknowledgement.
- Removed the non-GitHub acknowledgement store, reply-ticket branches and recovery instructions. Existing acknowledgement files remain inert and untouched; adding a GitHub origin starts the normal governance question.

## 3.44.0

### Added

- Select `owner-mixed` for GPT discovery and building, Luna Max helpers and one Opus review. Adoption of a new captured registry revision is deliberate; existing selections retain their original capture.
- Mixed selection does not supply automated cross-host gate launches. Use Codex for GPT discovery and building and a fresh human-opened Claude session for Opus review of the same candidate, scope and evidence, without helpers.

## 3.43.3

### Fixed

- Daily check-ins compare the plugin copy with main when their own session started, keeping genuine lag alerts while avoiding false plugin cards for pinned copies. Reports retain an explicit fallback when session time is unavailable and one advisory when newer hook definitions or entry scripts changed.

## 3.43.2

### Fixed

- Make every merging agent responsible for reconciling open Toolkit versions after a merge, using a computer lane when needed.

## 3.43.1

### Fixed

- Env editing now says the editor is opening and tells you to open the file yourself if no window appears.

## 3.43.0 (hook review leftovers)

### Changed

- **Pushes through another shell:** the merge hold now refuses any git push handed to another shell or expression runner (`bash -c`, `pwsh -Command`, `cmd /c`, `eval`, `iex` or `Invoke-Expression`), whatever branch it names. It checks runner words throughout the command, including shell option bundles, call operators, wrappers, blocks and unquoted expressions. Encoded PowerShell commands are refused unread, even without a visible push. Run each push as its own git command; plain git pushes keep the exact target check. The attribution guard and the merge hold share one shell-word reader.
- **Codex pushes of the current branch with lane worktrees:** when Codex names no folder and several working trees are reachable from the chat's folder (lane worktrees nested under `.tmp/worktrees/`, for example), a push of the current branch is checked in every one of those working trees within the same 30-second budget only when the whole line is one plain git push command, and goes when each one passes. Pull requests of the current branch and lines with other commands, including a read before the push, stay refused because the folder is unknown. A check that runs out of time is still refused on Codex.
- **Helper launches outside gate runs:** the Claude and Codex helper-launch hooks now apply the named-helper policy only in a Toolkit gate run, a session a Toolkit launcher started (a launcher marker). In any other session, governed repositories included, the main session may start any subagent, as the global rules already said, and on Claude a subagent still never starts another in a governed repository, whatever the topology choice.

### Tests

- **Hook pack:** new rows for refused shell and expression-runner pushes, Codex pushes of the current branch with nested lane worktrees, and helper launches inside and outside a gate run. The evidence-store row now passes: its fixture gives another governed repository a cached binding that names the store, with a new row showing a same-named repository under another owner is still held. Fixtures can now set a gate role, nested worktrees with their own commits, a remote owner and a cached binding naming the store.

## 3.42.2

### Fixed

- Automatically recover missing PR links for completed tasks from merged PR body references, closing links and timeline references. Select the latest merge, then the higher PR number on an exact timestamp tie.
- Bound discovery requests, report missing or incomplete evidence, and preserve existing findings while reads are incomplete. Recheck eligibility through the guarded state writer before saving.
- Keep retired tasks out of discovery and show their PR cell as a dash without discarding historical state.

## 3.42.1

### Fixed

- Let free-wording replies outside github.com use a one-use ticket that can only acknowledge governance being off. Bare typed answers remain usable when reply-ticket state is damaged.
- Require eligible, fresh Projects deliveries with independent hashed replay receipts for governance and merge approvals. Preserve live tickets, confirmations and spent ids during reply-ticket conversion and keep launched sessions unable to answer governance questions. Both checks accept host timestamps up to 2 minutes ahead and retain receipts for 24 hours and 2 minutes.
- Explain why adding a GitHub remote asks the question again, and prepare Remote Control lanes by creating the remote repository before cloning it.

## 3.42.0 (keys open in your .env editor)

### Changed

- `toolkit env edit` opens the key file in the app this computer uses for `.env` files, through the Windows shell by full path, instead of always in Notepad. VS Code, VS Code Insiders, VSCodium and Cursor start by their own path in a new window with no folder, so workspace extensions and IDE links to agents do not attach to it.
- A deleted line no longer removes its key within seconds. It is marked (shown in the file's status line and in `status`), and "done" asks one yes/no that names every marked key before removing any; a no, no answer, a new edit or the 30-minute end keeps them. Putting the line back cancels it.
- Every end of an edit removes the copies VS Code-style editors keep of Toolkit's own edit files (Local History and hot-exit backups), overwriting each with zeros first, and says how many. The closing note is worded for the app the file opened in, and the file's header warns that extensions can read an open tab.
- The test guard that blocks Notepad launches also refuses opening an edit file in the shell or an editor, and is renamed to match.

## 3.41.2

### Changed

- **Projects post spacing:** every **[HH:MM] <zone> Update:** line, for example **[16:41] SGT Update:**, is its own paragraph with exactly one blank line before the next. Questions and labelled blocks take that same single blank line. The `&nbsp;` spacer line after Update lines is gone everywhere, in the Projects skill and the project instructions block.

## 3.41.1

### Fixed

- Keep explicit merge approvals during the governance question, and recognise repository names containing dates or SHA-like words.
- Read only the fresh human trigger in a supported Projects message, including after a session resumes, and prevent repeated delivery from restoring a used approval. Standing task auto-merge permissions are unchanged.
- Explain missing recorded approvals accurately and test prompt-to-merge sequences on both hook adapters.

## 3.41.0

### Added

- Each app asks its own task auto-merge question during setup, with On recommended and an accurate Current choice. Answers are stored separately on this computer, validated strictly and written atomically with read-back and recovery.

### Changed

- The app-local answer is the only task auto-merge switch. Repository bindings no longer carry task permission, and governance reports the effective app setting without asking another question.
- Hooks, setup, governance, bindings, preference readers and writers, and merge or approval rules always wait for an owner-typed merge, alongside CI workflows and major releases. Rule-refresh pull requests retain their typed-merge requirement.

## 3.40.0 (Refresh open release branches)

### Changed

- Keep each open release branch's patch, minor or major bump when main moves. A coordinator-run local command reports eligible branches and can merge main, regenerate version stamps, preserve released notes and fast-forward the branch after validation.
- Accept major version bumps in the release command and version guard, and report the resolved base commit used for a bump.
- Document the local reconciliation trigger, conflict recovery and renewed CI and review required for each updated head.

## 3.39.0 (setup rows stand on their own)

### Setup

- **Each Claude Code setting row recommends on its own.** A row recommends Turn on unless it is already on, or setup cannot read or change it, in which case it recommends Keep current. One row with a value no longer holds the other three on Keep current, so "All recommended" now turns on a setting that is still off.
- **Model switching is recommended on.** "Switch models without asking on a flag" recommends Turn on, which writes `"switchModelsOnFlag": true`; Turn off still writes `false`.
- **Choices list only what changes something.** In every row, the choice that matches the current state folds into Keep current whatever is recommended, so a row shows Keep current plus the choices that change something. "Keep Toolkit available in Codex?" retains its verification action under Keep current when Codex already runs the current Toolkit from the update copy.
- **Each app's setup talks only about that app.** The Claude Code question bank and summary no longer mention Codex, and the Codex ones no longer mention Claude Code.
- **Codex checks the chosen update source.** Keep current still checks the installed plugin and marketplace binding after the answers, so choosing another update copy cannot silently skip verification. Automatic updates and the Claude Code plugin also retain their source-following or verification action.
- **Keep current is always A.** Both setup banks put it first wherever it is available, including rows where another choice folds into it.
- **The coding apps section includes the current app.** Both banks call it "Toolkit in your coding apps", with the current app's plugin and settings alongside Antigravity.
- **Codex helper capacity has one way to keep things as they are.** The duplicate Skip choice is removed; old Skip flags and typed answers still mean Keep current. Migrate and Remove remain available only for matching Toolkit settings.

## 3.38.0 (every task run reaches the project chat)

### Claude Projects

- Each scheduled task run keeps its full report in `latest.md` and an immutable `runs/<run UTC>.md`, writes its own run stamp under `/mnt/project-files/toolkit/task-runs/<slug>/`, and posts one home-thread line naming the per-run report. Every slug includes its kind, a readable project prefix and a digest of the full kind, project and report folder. Stamps record the task name where known and the run's own thread link. The write guard permits only that task's reports, stamps and `.failed` receipts, never coordinator `.relayed` or `.done` files.
- The coordinator skips tasks marked `stopped by owner`, relays each run from its exact per-run report with its originating thread link, writes `.relayed` immediately after a successful post, and writes `.done` only after all prefix actions. Notification replay and wake catch-up handle every run without `.done`, oldest first, skipping only the post when `.relayed` exists. A replacement home never changes an old run's origin link.
- Unless a task is `stopped by owner`, the hourly nudge flags runs still unrelayed after 15 minutes (`UNRELAYED TASK RUNS`) and lists those posted but without `.done` as "relayed, actions not confirmed". It flags working lanes below the cap while work is queued (`LANES UNDER CAP`). Its quick check ignores home-thread lines and coordinator activity that only relays task runs; owner messages and other posts still count. The lane count excludes the extra lane for a sudden owner request, owner waits, and PRs waiting on CI or the review queue.
- The daily check-in reports each task's last run and whether it was relayed, flags any run unrelayed for over an hour (`RELAY GAP`), even when a newer run was acknowledged, and advises opting a project's own tasks into the Toolkit shell to get the same line and stamp. Both health checks skip every stamp of tasks marked `stopped by owner`.
- Existing task prompts check as outdated. The daily check-in swaps Toolkit-made tasks unless `stopped by owner`; custom shell updates still need the owner's OK. Until that task's update, the coordinator reads its old shell's `latest.md` immediately, relays and acts that turn only, with no stamp, catch-up or relay gap check. The check-in names this limitation under **Tasks:**.

## 3.37.0

### Added

- Show when each Programme Graph task last changed in Singapore time, using completion times for finished tasks and state writes or task comments for work in progress. Queued tasks show a dash.

### Fixed

- Render the parent graph from state documents written during the same reconcile pass, including task page and pull request link updates.

## 3.36.0 (setup host check)

### Setup

- Setup now works out which app started it. When Codex runs it with `--host claude-code`, or Claude Code runs it without, it stops with exit code 2 before any question, says which app started it, changes nothing and prints the command to run instead. The stop names only that app, never the other one. With no app markers, or both apps' markers, `--host` is used as before.
- The setup skill and setup docs now say that only Claude Code adds `--host claude-code`, Codex never adds `--host`, and agents show only the question bank setup prints, never questions copied from the setup question reference.

### Internals

- The exact Codex and Claude Code shell marker names live in one module, `repo/scripts/agent-host-markers.cjs`, used by setup and `toolkit-env`.

## 3.35.0

### Fixed

- The hourly programme sweep tells "offline" apart from "gh not signed in": when `gh auth status` fails, one short connection to github.com decides which, so a network outage no longer reads as a sign-out.
- Skipped sweep runs are no longer invisible. Each skip is counted in a row in the run's record, the session-start line in that repository shows `Programme sweep: skipped (<reason>), N runs in a row since <time>; see toolkit tasks.` (also for a failed run or no run for over 2 hours inside the sweep's hours), `toolkit tasks` shows the reason and count, and the first good run after them notes `Resumed after N skipped runs since <time> UTC.` Skips still exit 0.

## 3.34.0

### Changed

- Projects: every project now runs 1 working lane by default, with one extra lane always kept free for the owner's sudden asks. The owner sets another number with one project line outside the managed block, and an existing lane cap line still counts. Work waiting on the owner no longer counts, so the coordinator starts the next item instead of idling.
- Projects posts: one blank line between labelled blocks, the problem, fix and skip lines nested as bullets under Now, thread links titled by the thread's name, and every open owner ask carried into a fresh post. Once the owner writes after a post, that post is never edited again.
- Projects setup records a lane line only when the owner gives a number, and an instructions sync that brings in the 1-lane default says so once in its note.
- Projects links: posts link the chat thread that owns the work, UAT asks included. A direct PR link appears only on a merge ask for a merge-ready PR, and the hourly nudge flags any other PR link.
- Projects posts: choices under a question are lettered (a., b.) because the owner picks one, and a device is named by the name the project instructions record for it.
- Projects coordinator: relays every daily check-in and hourly nudge report with the waiting-on-you list, and keeps each owed decision-trace record on the promise list until it is posted and read back.
- Projects posts: **Waiting on you** sits second last, just above the ELI5 line, which always ends the post.
- Projects posts: every time shown to the owner, Update stamps included, uses the owner's profile time zone, never UTC.
- Projects hourly nudge: flags a post whose ELI5 line is not last, whose Waiting on you list is not just above it, or whose Update stamps are not in the owner's time zone.
- Projects daily check-in and hourly nudge: their reports give times in the owner's profile time zone; only their state files keep UTC.
- Projects posts: **Waiting on you** lists only items the owner can act on right now; work still being built or reviewed stays off it, and the hourly nudge flags any that slip on.

## 3.33.0

### Changed

- Each Claude Code setting row in setup lists only the choices that change something: a setting already on shows Turn off and Keep current, and one already off shows Turn on and Keep current. A different value, a blocked parent entry or an unreadable settings file still shows all three. The hidden choice's flag value still works and does the same as Keep current.
- The model-switch row now reads "Switch models without asking on a flag", so on means `"switchModelsOnFlag": true`, which is also Claude Code's default when the line is missing. Turn off writes `false` instead of removing the line, and setup still recommends Turn off. An existing `false` shows as off, so nothing in the settings file changes.

## 3.32.0 (auto-merge without a label)

### Changed

- Task auto-merge no longer uses a label. With the owner's yes merged in the programme binding, the controller merges any pull request once the gate conditions hold on one head. Only pull requests that change the merge rules themselves (the programme binding, its schema and reader, the merge hold and its helpers, the scope check, the controller, global and gate rules, the Approvals section of the Projects controller skill, CI workflows) or make a major version bump wait for the owner's typed `merge N`. Hooks, setup and agent instruction files leave that list: their risk tier already holds them for full review and owner testing.
- The merge hold runs the merge-scope check on this computer, on the head a no-typed-approval merge names, before letting it through. A head it has not fetched, or a scope it cannot read, needs a typed merge.
- The task auto-merge answer no longer needs a required `auto-merge-eligible` check, so `toolkit governance check` no longer reports a yes as not enforceable.

### Removed

- The `auto-merge-eligible` workflow, its `toolkit-owner-merge` label, the commit status that tied the label to a head, and the merge hold's refusal of commands that name the label.

## 3.31.1 (smaller Projects skill)

### Changed

- **Claude Projects controller skill fits a skill card again.** The skill's main file shrank from about 50 KB to about 41 KB, under the 48 KB a claude.ai skill card accepts. The detail for acting on check-in and nudge reports, refreshing the guidebook copy, device work and standing permission asks moved word for word into reference files beside it (`reference/periodic-runs.md`, `reference/guidebook.md`, `reference/device-work.md` and `reference/permission-asks.md`). The skill points to each one before the step that needs it, so no rule changed.
- **No hand upload.** The install check no longer tells you to upload the Projects skill folder by hand. It offers a skill card when the file fits one, says when the file is too large for a card, and in every case notes that the coordinator reads the copy pulled from the repo, so a missed card changes nothing it does. An account copy with its own reference files still gets the card, which replaces only the main file.
- **Size guard.** A test now keeps the skill's main file at or under 44,000 bytes, with the card's 48,000-byte body limit as a hard ceiling, and checks that every reference file the skill names exists.

## 3.31.0 (Claude Code settings on and off)

### Changed

- The four Claude Code setting rows in setup now offer Turn on, Turn off and Keep current, and their titles read "Claude Code setting: <name>?".
- Turn off removes that one setting from the Claude Code user settings file whoever added it, including the full attribution object form. Parent objects and the file itself are removed only when they end up empty and setup created them; the other settings are never touched.
- Turn on sets Toolkit's value, replacing a different value already in the settings file. A value that already does what Toolkit's does is left as it is.
- The Current column says where a value came from in plain words: On (added by setup), On (already in your settings), Different value in your settings, or Off (Claude Code default).
- A setting whose parent entry is not an object is held unchanged on Turn on and Turn off, and the row says why.

## 3.30.2

### Fixed

- Projects skill: work threads post fresh below an owner message the coordinator forwards to them again, as before the post hook was removed. This counts only for choosing which post to edit, never as approval.

## 3.30.1

### Fixed

- The `auto-merge-eligible` check no longer shows red on every always-manual pull request while task auto-merge is off. It reads the default branch's programme binding and, unless that says `after-gates`, passes and only lists what would be always manual. A binding it cannot read keeps the full check.

### Security

- The `toolkit-owner-merge` label now counts only when the repository owner's own user account adds it. A label added by a bot, an app or anyone else is removed and the check fails. A push after the label still removes it and turns the check red.
- Taking the `toolkit-owner-merge` label off, or a refused label, sets the head's `toolkit-owner-merge` status to failure, and only the newest status counts, so a label added back later cannot reuse an earlier OK.
- Before a task auto-merge, the controller runs the eligibility check itself, without `--binding-at`, on the head it merges, and merges only on exit 0 or when the head's newest `toolkit-owner-merge` status is success. This covers a pull request whose check went green while auto-merge was off.
- In a repository an organisation owns, no user is the owner, so the label never counts there (it fails closed).

## 3.30.0

### Setup

- **One row per Claude Code setting.** Setup now asks about each of Toolkit's four recommended Claude Code user settings in its own row: hide AI credit in commits and pull requests, let your other sessions wake this one, ask before switching model on a flag, and read AGENTS.md too. Each row offers Add, Remove Toolkit's value, or Keep current, so you can turn on one without the others. While none is set every row recommends Add; once any is set every row recommends Keep current, and a row still missing says to pick Add to turn it on.
- **Hidden attribution counts as on.** If you hide attribution yourself with `"attribution": {"commit": "", "pr": "", "sessionUrl": false}`, setup shows it as on, the same as Toolkit's `false`, and leaves it as it is. An object that hides only some of it still shows as a different value.
- **Answer one row from the command line.** `--claude-setting <name>=enable|disable|keep` answers one setting row and wins over `--claude-settings`, which still answers all four.

## 3.29.1

### Changed

- `toolkit env edit` now names its private edit file `env-edit-<id>.env` and still opens it in Notepad by its full path, never through the app Windows links to `.env` files. A leftover `.txt` edit file from an earlier version is wiped, never applied; after an update in the middle of an edit, the saves the earlier version already applied are still reported by name.

## 3.29.0 (per-repository task auto-merge)

### Added

- Task auto-merge for finished pull requests, bounded by governance, review, required checks and owner testing. See the gate rules for current permission storage and manual-merge exceptions.
- The `auto-merge-eligible` check (`.github/workflows/auto-merge-eligible.yml`, running the default branch's `repo/scripts/toolkit-auto-merge-eligible.cjs`) fails a pull request on the always-manual list: the programme binding and merge rules, hooks and every module they load, setup that writes hook config, CI workflows, agent instruction files and a major version bump. A change that only moves version stamps does not count. Such a pull request merges once the owner adds the `toolkit-owner-merge` label in GitHub; a new push removes it, and the merge hold refuses an agent that sets it.

### Changed

- With an enforceable yes (the binding and the default branch both require `auto-merge-eligible`), the merge hold lets one merge shape through without a typed approval: a merge commit pinned to the full head SHA, in a session the user started, from that repository's folder. Every other merge still needs the owner's typed merge.
- The global rules' merge line, the gate rules (new task auto-merge section) and the Projects skill say when the controller may merge on that answer: G2 PASS, every required check green and owner UAT passed or not required, on the same head, one merge at a time.
- The release-plan CI check-up rule moves from the delivery contract into the gate rules' G0 bullet, where gate sessions read it first.

## 3.28.0 (parallel lanes)

### Changed

- The Projects controller skill and its project-instructions block now say to run independent pull requests side by side: no ready or working pull request waits for an independent one, whatever their numbers or start order, and only merges land one at a time. At most 3 lanes of any type work at once unless the owner sets another number. The coordinator answers the owner's sudden requests itself and opens one extra lane only for a request that needs real thread work. The serial review route, the single gate device and any usage limit the owner records still apply.
- The project-instructions block size limit rises to 5,850 bytes to hold the lanes line, because the coordinator reads the block but not the skill.

## 3.27.0 (CI check-up)

### CI check-up

- **New CI check-up in `secure-ci-cd`:** `scripts/ci-checkup.cjs` compares what a repository contains with what its CI runs and lists `GAP` and `CHECK` items with a file and a fix hint: package test, lint, build or typecheck scripts no step runs, Go, Rust, Maven, Gradle or Python projects and Dockerfiles no step builds, test files or folders no step reaches, scripts no test names or imports (following `require`, `import` and package script names), missing or unchecked time budgets, job times over budget from recent green runs when `gh` is logged in, unpinned actions, missing `permissions:`, masked test steps, path filters on pull request triggers, a missing Dependabot `github-actions` entry, and a CI status document that is missing or does not match the workflows. Rules were tightened after measuring it on two other governed repositories: plain `shell: bash` counts as failing on error, path filters are raised only for workflows holding a required check (read through `gh`), a test runner given targets reaches only those, long jobs are raised for test jobs from measured times, and scripts CI or a package script starts, run through `python -m`, imported by bare name or matched on whole name parts by a test's name count as covered (a script CI only compiles, lints, syntax-checks or names in a comment does not). It is read-only and zero-dependency: it starts `git` and `gh` only from absolute PATH folders outside the target repository and from a working folder outside it, so a planted `git` or `gh` there never runs; it reads no file whose real location is outside the repository; `--base` uses git plumbing so the index is never rewritten; and required checks it cannot read, or cannot tie to a job because of an expression name or a reusable workflow, count as unknown, never as none. It never fails a build, and takes `--base <ref>` to cover only what a change touches. An optional `.github/ci-checkup.json` names the status document, sets budgets and holds ignores, each with a reason. The procedure in `templates/cicd/ci-checkup.md` says when to run it and how to judge and fix what it finds.
- **When it runs:** G0 runs it at each release plan in a governed repository (the delivery contract), the PR, CI and fast-tests playbooks run it when a change touches CI or adds a package, language or test folder, and `release-readiness-audit` runs it in final audits. The status template gains a "Last CI check-up" line. This repository's `.github/ci-checkup.json` names `repo/docs/VALIDATION-STRATEGY.md` as its status document.
- **Less noise:** a repository with no CI workflow gets one item saying so, not one per file, and an early `exit 0` counts as hiding a failure only in PowerShell or cmd, where a failing command does not stop the step.
- **Risk tiers:** `.github/ci-checkup.json`, `.github/dependabot.yml` and `package.json` are now RISKY, because the check-up's script reads them by path and data that RISKY code names by path is RISKY.

## 3.26.3

### Setup

- **Clearer Claude Code settings row.** The recommended Claude Code settings question now reads "Add Toolkit's recommended Claude Code settings that are missing?". Each setting is named by what it does and shows whether Toolkit set it, you set it to the same value, you set a different value (which Toolkit leaves alone), or it is not set. The add choice names exactly which settings it would add, and the remove choice says it removes only Toolkit's values.
- **Keep current once you have chosen.** The four settings are added together, so once any of them is set, setup recommends Keep current and treats the missing ones as left out on purpose; Add missing settings and Remove Toolkit's values stay listed. Add missing settings is recommended only when none is set.

## 3.26.2 (programme state on a protected public branch)

### Programme state branch

- **New:** a version 2 binding may add `"state": { "kind": "branch", "branch": "DO-NOT-DELETE-IF-TOOLKIT-GOVERNANCE-IS-ENABLED", "path": "state/" }`. Parent and child programme documents then live on that branch of the governed repository itself, as public views: no private part, no gate route, and sessions only as hashes. The private store stays required beside it and keeps the journals, one private sidecar per written revision and the checkpoint. Without `state` nothing changes.
- **Public-safe only:** every read and write checks the public view against closed key lists; free text may not hold a path, an address, an `@`, something that reads as a host name or a session ID, and a refused write changes nothing (`STATE_INVALID`). Commits on the branch end in `[skip ci]`.
- **Recovery:** a deleted branch is restored at its checkpoint commit when every file still matches, or rebuilt from the private sidecars when every digest matches, else held; it is never started empty. A branch pushed back below the checkpoint, a hand edit and a store that is no longer private all hold with a named code. This runs from any command or the hourly `refresh`, never from a hook.
- **Moving:** `programme.cjs migrate-state --dry-run` shows what would be written; `migrate-state --apply --plan-digest <digest>` creates the branch after the owner's typed yes in a terminal and prints the binding change for a pull request. Readers keep the private store until that pull request merges; stop the programme sweep and make no programme writes until then. A private-store write made after the move holds every branch read (`STATE_MIGRATION_STALE`) until the move is run again, which carries the newer documents over while the branch is untouched. The typed yes is never asked in a shell a coding agent started.
- **Protection:** `toolkit governance migrate` offers a "Toolkit: keep programme state" ruleset (no deletion of that branch) after its own typed yes, for repositories whose merged binding has `state`. A ruleset that lets someone bypass it does not count as protection.
- **Changed:** `refresh` now acts as the parent's holder by the hash of the holder's session only, so it can bring documents in line but never make a decision.

## 3.26.1

### Changed

- Gate rules: a writing gate's session opens in the folder it writes, never told to escalate its shells into another folder.
- Host contract: a new gate workspace section says how Codex Desktop gives a builder chat its own writable worktree (`create_thread` with a worktree environment, or `create_worktree` from the builder), why a forwarded approval is refused by Codex's automatic reviewer, where Codex gates keep scratch, and the known limit for successors in an existing worktree.

## 3.26.0 (the coordinator reads the latest Projects skill)

### Projects guidebook

- **Added:** `repo/scripts/toolkit-projects-guidebook.cjs`. `--out <folder>` copies the Projects controller skill (SKILL.md, its `reference/` and `tasks/` files) into a folder, writes `instructions-block.md` (main's project-instructions block with its real marker), then writes a one-line `VERSION` last and reads every file back. It prints `SKILL COPY REFRESHED <Version>`, plus `BLOCK CHANGED <version>` when the block changed, or `SKILL COPY FAILED <reason>`. `--check <folder>` only compares. It removes files a newer skill dropped and folders left empty, and it claims a folder only when its `VERSION` is in the exact format or its block file starts with the real marker, so it never takes over a folder it did not write.
- **Changed:** the Projects coordinator's runtime loads no account skills, so the skill now reaches it as that copy in the project library, `/mnt/project-files/toolkit/web-controller-projects/`. The project-instructions block gains one guidebook line: read `VERSION` every turn, read `SKILL.md` when that Version is new to the session, start a refresh thread when the copy is missing or older than the block, and replace the block with `instructions-block.md` only when a refresh from a fresh clone of main reports `BLOCK CHANGED` that turn, never on its own comparison of the library files. The skill adds that the guidebook never relaxes the safety floor or the owner's instructions. The block's size limit rose to 5,600 bytes for that line.
- **Changed:** the hourly nudge checks the copy against a fresh clone of main every run, so a stray write to the folder is caught within the hour, and refreshes a stale or changed copy itself, reporting `BLOCK CHANGED` or `SKILL COPY FAILED` on its first line. The daily check-in is the backstop: it refreshes a copy still stale two hours after main changed, or when the nudge is stopped or not armed, and reports `GUIDEBOOK MISSING` or `SKILL COPY STALE`. Its `SKILL UPDATE` now compares the copy's Version with the one on the BINDING line.
- **Changed:** the merge step's closing checklist carries "coordinator: refresh the guidebook", and setup reads the guidebook before step 1.
- **Removed:** the skill card route for the account copy of the Projects skill: the skill card thread brief (`reference/skill-card.md`), the check-in's `SKILL DRIFT`, `SKILL BEHIND` and `SKILL CARD` steps, the coordinator's card, Save and re-upload handling, and the account-copy setup inventory row. They kept an account copy current that the coordinator never loads.

## 3.25.0 (Codex host contract)

### Host contract

- The host contract now has a Codex helper table next to the Claude Code one: hook event, blocking output, failure and timeout, trust step, helper definitions, admission, depth, route proof and known limits.
- The first stored Codex helper result is in `repo/contracts/host-qualification/codex.json`: on Codex Desktop on Windows, the G1 helper served its pinned model and effort, and the hook refused a built-in agent and a model override.

### Codex qualification runner

- The unbound-launch cases now match the helper-launch rule: in governed work with no launcher binding, a named helper with no installed file is refused and one that matches the stack is admitted. They run against a scratch Codex home, so real helper files never decide them.

## 3.24.0 (your keys in Notepad, with every save kept)

### toolkit env

- **Changed:** `toolkit env edit` opens your keys in Notepad as `NAME=value` lines with their real values, like a `.env` file, in your saved order with your comment lines. Change a value, add a line, or delete a line to remove that key, then save: a small helper started with the file applies each save within a few seconds. Saying "done" (or `apply`) applies a save not applied yet, deletes the file and lists what was changed, added and removed, by name only. Deleting a line no longer needs a separate `remove`.
- **Safer saves:** a save is applied whole or not at all. Nothing is saved, and a `# Status:` line at the top of the file says why, for an unreadable line, a blank value, a key name used twice, a quoted value, a UTF-16 save, a save that would remove every key, or keys changed elsewhere while the tab was open, including straight in Credential Manager. A key added elsewhere during the edit is never removed. A value one line cannot show exactly appears as `<kept: change it with toolkit env set NAME>` and stays as it is.
- **Fixed:** a second edit reused an open edit file younger than 30 minutes without refreshing it, so it could show a key you had removed. Every edit now writes a fresh file from the store and wipes the earlier one; a save from an older Notepad tab is ignored and wiped, and the result says to use the newest tab. Edit files of earlier versions are wiped, never applied.
- **New:** every "done" says to close the Notepad tab without saving, because Notepad can keep its own copy of an open tab and bring it back, and how to stop that for good ("Start new session"). The file is deleted 30 minutes after its last save if "done" never comes.

### Skill

- The `toolkit-env` skill opens Notepad whenever you want to see or change your keys, in any words, keeps `status` for names-only questions, and tells agents never to open, read or search the edit file.

## 3.23.0 (hooks keep only the checks that stop real damage)

### Hooks cut down

- **Fixed:** shell commands that only name Claude or Codex next to a yes, no or ok, or next to a resume or fork word, are no longer refused as a governance answer or a session resume. This covers metadata saves (`--host claude --tracking yes`), summary reads (`head -c`, `grep -rn` and pipes over `.claude` and `.codex` folders), heredoc and here-string writes, SSH reads and loops over file names, in every folder that is not waiting for its governance answer.
- **Removed:** the short-answer launch reader, the session resume and fork reader (`toolkit-governance-continuation.cjs`) and the question asked from a parent folder for repositories a command reaches. A command or edit that works in a waiting repository from another folder is still refused, and the user answers in that repository's own chat. A session another session started, or a resumed run, still cannot answer, and the governance CLI with a decision and edits to Toolkit's user-state files are still refused everywhere.
- **Removed:** the gate route hook and the skill card hook. The Projects skill keeps both rules as written rules: a gate launch passes its pinned route and the gate's start record is the proof, and a skill card carries main's SKILL.md exactly.
- **Removed:** the Projects post hook (post layout, wording, links and the one running post). The coordinator it was written for runs where Toolkit's hooks do not, so it only ever checked Remote Control threads. The Projects skill keeps every post rule as a written rule, and finds the running post by reading the newest page of the chat instead of a `RUNNING POST:` line in project memory, which kept getting rewritten.
- **Removed:** the shell hook no longer refuses commands that skip a repository's commit or push checks (`--no-verify`, `core.hooksPath`), and the push check no longer refuses plain-text findings. Both are written rules now, with CI as the gate. The force-push, default-branch, merge, attribution and credential checks are unchanged.
- **Changed:** the Projects project instructions block now carries the post rules (find the running post in the chat, the post layout, and problem, fix and skip first), since the coordinator does not load the Projects skill. The block's size limit rose to 5,000 bytes.
- **Fixed:** in Codex, a push from a repository with other working trees elsewhere (sibling worktrees) is no longer refused as "Codex did not say which folder". Only working trees the chat's folder can reach count: the one holding it and any nested below it, since Codex Desktop refuses a workdir outside the chat's folder.
- **New:** the hook design playbook (`repo/docs/agent-playbooks/hook-design.md`) says when a hook is allowed, that it checks an exact effect and never guesses intent from text, and that every hook carries must-pass rows for ordinary commands as well as must-refuse rows.

### Evidence stores and scratch clones are never governed

- **Fixed:** a clone of an evidence store (such as a `TRANSPORT-*` repository) was treated like any undecided github.com repository: Toolkit asked the governance question there, held every prompt and tool (Claude Projects posting included), and a "yes" recorded it as ENABLED. A repository that a programme binding cached on this computer names as its evidence store is now DISABLED automatically: never asked, never held, and `enable` is refused. A `TRANSPORT-*` repository under the owner of such a binding's repository counts too, so a fresh clone on a new computer is not asked either. A binding merged in the store's own repository still decides.
- **Scratch clones:** a clone of another repository inside the ignored top-level `.tmp/` folder of a repository whose governance is decided is DISABLED automatically. A worktree of that repository itself keeps its state.
- **Recorded decisions:** an "enable" recorded earlier for a store or scratch clone decides nothing; `status` and `check` show it with the one command that clears it.
- **Discover:** reports a store or scratch clone as not applicable, and never proposes a repository as its own evidence store.
- **Default-branch push guard:** a push to an evidence store that a cached binding names is not refused, whatever its name. The guard also reads a folder named through a variable the same command assigned (`$d = 'C:\path'; git -C $d push`, `d=/path; cd "$d"`) and a leading home variable (`$env:USERPROFILE`, `$HOME`), so it judges the repository the push really comes from.
- **Held repositories in Claude Projects:** a thread can still post, react, update its checklist or end its turn in a held repository, so it can ask the owner the governance question. Its decision cards and every other tool stay held.

### A controller creates its gate chats without asking

- **Changed:** appointing a controller now counts as the owner's explicit request to create every gate session the controller procedure launches (G0, G1, G2, rechecks and their follow-ups) and to archive each once its evidence is stored and read back. A controller no longer asks before each one, including on hosts that create a chat only when the user asks (Codex `create_thread`, Claude Code desktop sessions). The controller procedure says so; a controller binds it on appointment, before its first launch. A new model or route, spend and anything on the safety floor still need the owner.

## 3.22.0 (plans and asks open with the problem, the fix and the cost of skipping)

### Projects skill

- **New rule:** every plan, G0 plan, decision ask and explanation, from the coordinator and from every thread, opens with three lines: **The problem:** (one plain sentence on what goes wrong for the owner), **The fix:** (what would be built, in everyday words) and **If we skip it:** (what happens if nothing is done). The owner can then turn work down before it is built or reviewed.
- **Where the lines go:** first in a plan, a decision card and a reply. In a running post the **Now:** line stays first and the lines sit under it, or under the question they belong to, before its choices. Plain status lines and a later reminder of the same ask need none.
- **Threads:** every brief passes the rule on, and a G0 brief asks for it at the top of the plan. The managed project-instructions block is unchanged.

## 3.21.0 (a hook test pack every hook change must pass)

### Hook test pack

- **New:** the hook test pack (`repo/scripts/toolkit-hook-pack.cjs`, rows in `repo/tests/hook-pack/corpus/`) runs tool calls through the hooks exactly as Claude Code and Codex start them: the real `hooks.json` matchers, the plugin folder written into each command, one process per hook with the call on stdin, and on Windows the Codex PowerShell launcher setup installs. It checks the decision the host would act on and that no fixture file changed, and prints a scoreboard of passes, known bugs, false blocks and leaks per family.
- **Suites:** ordinary daily commands that must pass, hostile calls that must stop, hooks that break (a missing, throwing or stalled module, unreadable input), a plugin version folder deleted mid-chat, and host parity. Rows for bugs not fixed yet are marked known-bad with the lane that fixes them, and the run fails when one starts passing, so the fix flips it. A refusal that comes only from a hook failing counts only for a row that names it.
- **Revert proof:** `run --against <commit>` runs a fix's new rows against the plugin as it was at that commit and passes only when they fail there, so a review never has to feed hook scripts by hand.
- **CI:** a `hook-pack` job runs the pack on Linux and Windows on every pull request, and the `validate` job waits for it. The validate job also fails a pull request that removes, lowers or otherwise changes a row (anything but a known-bad row moving toward passing) without a line for it under a "Pack changes" heading in the body.
- **Gate rules:** a new "Hook changes" section says what a hook change must show before it merges (the pack green on both systems, a pack row and revert proof for each bug it fixes, explained row changes, and a real-host smoke per release), and that an enforcing hook that breaks refuses only the calls it guards while advisory hooks stay fail-open.

## 3.20.0 (version at merge time)

### Version at merge time

- **Open branches keep `main`'s version:** a branch no longer changes `version.json`, the plugin manifests, the managed-block markers, the CHANGELOG version headings or the Projects skill Version line while it is open. Its notes go in its own fragment in `repo/docs/changelog.d/`, so open branches stop conflicting on version lines and renumbering after every merge. A branch that already keeps one `## Unreleased` section on top of the CHANGELOG (titled or not) may keep it; it is folded in at merge, and a `main` that already holds one counts the same; its notes cannot be dropped.
- **One step at merge time:** after the branch merges `main`, `node repo/scripts/bump-version.cjs --next patch` (or `minor`) reads `main`'s version, sets the next one, folds the fragments and any `## Unreleased` section into the CHANGELOG, deletes the fragments, refreshes every copy of the version and bumps the Projects skill Version line when the branch changed that skill. It refuses when the branch is behind `main`, the tree has uncommitted changes, the branch already set its own version, its CHANGELOG `##` headings differ from `main`'s (a heading of its own, a reused number or a heading below the top one), a fragment is malformed, or there are no notes. The explicit `bump-version.cjs <x.y.z>` form still works.
- **CI guard:** validation accepts a pull request that holds its base's version with the base's CHANGELOG headings, or one that sets exactly the next patch or minor version with that heading on top, the base's headings below it and no fragment left. A stale or skipped number, a stray heading, a half-done bump or a base that is not in the checkout fails with the fix to run.
- **Folding:** sections with the same name from several fragments become one section, a byte order mark is ignored, `##` headings are read as GitHub shows them (a tab after `##`, or up to three spaces before it), and every error names the heading that was added, dropped or repeated.
- **Review tier:** the merge-time bump commit stays a version-only change when it also bumps the Projects skill Version line.
- **Projects skill test:** the test no longer pins one exact skill Version, so branches that change the skill stop conflicting on it.

## 3.19.19 (see one key's value yourself, and env commands you can paste)

- **New:** `toolkit env show NAME` shows one stored value in a PowerShell window you opened yourself, after you type the key's name again; `show NAME --copy` puts it on the clipboard instead, marked so Windows clipboard history and sync skip it where Windows honours that. It refuses, before reading the store, in a shell an agent or an app's built-in terminal started, when it is not on a terminal (a pipe or a file), and on a wrong retype. There is no way to show every value, and nothing about it is recorded. The `toolkit-env` skill tells agents never to run it.
- **Fixed:** messages that told you to "run toolkit env apply" (or `edit`, `remove`, `connect` and the rest) named a command your terminal does not know. In your own terminal they now give the full PowerShell line, `node "$env:USERPROFILE\...\toolkit-env.cjs" apply`; agents still see the short name. The edit file's header gives the same line for `apply` and `remove`, and an edit file made by an earlier version still applies without its old header being kept as your comment.
- **Fixed:** with two edit files open, `apply` said to apply each, which it never could. It now says to close Notepad and wait 30 minutes for the old files to be deleted, then edit again.
- **Safer apply:** a value typed in quotes (`NAME="abc"`) was saved with its quotes; it is now refused by line number, with nothing saved. An edit file saved as UTF-16 now gets one plain message to save it as UTF-8, instead of a problem on every line. The header says spaces around a value are dropped. New tests cover values containing `=`, a byte order mark before the first key, and the edit file being overwritten with zeros before it is deleted.

## 3.19.18 (the Projects post hook keeps one running post after a handoff)

- **Fixed:** a new coordinator session no longer starts a fresh chat post when it should edit the running one. With no post of its own and no owner message yet, the post hook takes the running post from the `RUNNING POST:` line the session read from project memory (or wrote to it), and refuses a fresh status post until the owner writes. The refusal says to read the project chat if the owner wrote since or the post nears 8 KB.
- **Fixed:** while a running post is known, an edit of any other post (an older one, or one the session never saw) is refused and names the running post. Edits of replies stay exempt.
- **Fixed:** a project chat read passes over cards (thread starts, routing, activity, Remote Control) and gate anchors when it looks for the coordinator's newest post, and any page that shows the memory post gives its real size and any owner message after it.
- **Changed:** in the coordinator, an owner message in a work thread it started or listed no longer counts as the owner writing in the main chat. Beside a running post, two new posts still pass: a one-line `Gate: ...` anchor, which never becomes the running post, and a post starting "Re: your reply on" after an owner message in a thread or a reply.
- **New:** things go in lists. In a laid-out post, a new line of three or more sentences is refused with a request to split it into nested bullets; lines an edited post already had are passed over.
- **Removed:** the post hook no longer checks merges. The rule to post a summary of a merge's external effects and wait for the owner's OK stays in the Projects skill and the global rules; the hook now runs only on the Projects post and edit tools, keeping the post layout, wording, linked Waiting items and the running-post rule.
- **Unchanged:** a running post of 7,000 bytes or more still frees one fresh post, since the chat's 8 KB limit is real.

## 3.19.15 (CI runs the tests that pin a date a year ahead)

- **New CI check:** the Validate workflow has a `tests-clock-ahead` job. It runs every test file that pins a calendar date (an ISO date literal or `Date.UTC(`, in the file or in a test helper it loads) with Node's clock 400 days ahead, so a test that pins a date but lets the code read the real clock fails on its pull request instead of turning `main` red weeks later. The `validate` job waits for it. Locally, `node repo/scripts/run-tests.cjs --clock-ahead` runs the same check, and `--clock-offset-days <n>` moves the clock for a named, `--changed` or `--all` run.
- **Clearer CI failures:** a test shard that fails now still uploads its summary, so the `validate` job names the tests that failed instead of listing every file of that shard as not run. The shard-timing refresh reads times only from shards that passed.
- **Fixed:** the test runner's sweep of old run folders now uses the system clock, so a test that starts a nested run with Node's clock moved can never remove a live run's folder.
- **Tests:** seven lock tests that compared a file they had just written with Node's clock now date that file from Node's clock, so they pass with the clock moved too. The playbook for fast tests and sharding says how a test that pins a date stays correct.

## 3.19.14 (setup shows report-only rows as status lines)

- **Changed:** a setup row that only reports state and takes no answer is no longer a numbered question. "Toolkit hooks in Codex" now shows under its section as an unnumbered line, for example "Status (nothing to answer): Toolkit hooks in Codex: Off: Shell and agent check, File edit check. Turn them on in Codex: open /hooks and turn on Shell and agent check and File edit check." The questions after it move up one number (Antigravity becomes 3.2 in the Codex table), and the table heading counts only the numbered questions.
- **Every number has letters:** each numbered row in the Codex and Claude Code tables now always has lettered choices; the "(report only)" cell is gone. The generated setup question reference shows the hooks state under a "Status (nothing to answer)" heading with what to do; `--explain` takes a question number, so it does not show status lines.
- **Unchanged:** the hooks state is still read from Codex's config.toml and never edited, and it is still part of the bank reference, so a hooks change between the table and the answer still asks for the table again.

## 3.19.13 (the merge hold reads every GitHub connector's merge call)

- **Fixed:** the merge hold read only one connector shape (`owner`, `repo`, `pullNumber`, `expectedHeadSha`), so Codex's GitHub app merge (`repository_full_name`, `pr_number`, `expected_head_sha`) was always refused as a pull request Toolkit "cannot identify", even after the user approved it. One shared reader now reads the official GitHub server and Codex's GitHub app. A `sha` field is never read as the head commit (a server that drops it would merge whatever head is there), so older servers (`pull_number`, `sha`) stay refused and the refusal points to `gh pr merge N --match-head-commit <sha>`. A call whose fields are missing, cannot be read or disagree is still refused, and the refusal now names the fields it found and the one that is missing, never their values.
- **Wider:** any `mcp__` tool named `merge_pull_request`, `merge-pull-request` or `mergePullRequest` is held, whatever its server is called (claude.ai connectors name theirs with an ID), and every auto-merge spelling is refused. Read tools still pass.
- **Approval lines:** a line that is only one inline code span, such as `` `merge 618` `` (the way Codex and Claude show a suggested reply), now counts, read with every other rule. A short SHA right after "at" may be all digits (`merge 618 at 7384901`). Lines inside a fenced code block (``` or ~~~) never count, so pasted output cannot carry an approval. The refusal asks for the line as plain text, not in quotes.
- **Claude Projects:** the merge-summary check reads the pull request with the same reader, so a Codex-shaped merge needs an "external effects" line that names its pull request, and its hook now sees every merge tool spelling.

## 3.19.12 (setup shows the choices once when it updates itself)

- **Fixed:** when the Toolkit copy setup runs from was behind and automatic updates are on, setup showed the choices, took the answer, then updated itself, stopped and showed the choices again. Setup started from that copy now makes the same clean update the session start makes before it shows the choices. When the update changed setup's own files it stops before any question with `## Setup updated itself`, and the rerun shows the one table, built from the new setup.
- **Plainer message:** `## Setup updated itself` now names the Toolkit version it moved from and to, and says whether that happened before the choices or after the answer. After an answer it adds that the earlier answers were for the older setup, so the next run shows the choices again.
- **Setup skill:** when a table comes back after an answer, the agent says which version setup moved to and which questions changed, and does not quote the skill's rules as the reason.
- **Unchanged:** with automatic updates off or undecided, a run handed on from another Toolkit copy, a plan or explain run, a missing managed copy, or a copy on another branch, setup shows the choices first and updates only after the answer, as before. A dirty or diverged managed copy, a wrong remote or a failed fetch now stops setup before the choices instead of after them. The table now says "Review every visible choice before setup changes any settings."

## 3.19.11 (the local secret scan never stops git mid-read)

- **Fixed:** when the local secret scan reads a whole file from history to check it for a private key, it now asks git for the file's size first. A file over 5 MB is listed as not scanned without being read, so git is never stopped part way through. On Windows, stopping Git's launcher left the real `git.exe` running in the scanned folder for a short while, so a folder removed straight after the scan could fail as busy.
- **Unchanged:** the report is the same: a file over 5 MB is still listed with its commit as "larger than 5 MB", one git cannot read as "unreadable", and either makes the scan incomplete.

## 3.19.10 (Codex pushes from a lane worktree are checked there)

- **Fixed:** in Codex Desktop, a one-command `git add`, `git commit` and `git push` run in a lane worktree under the chat's folder went out unchecked, even with a new credential file. Codex tells the hook only the chat's folder, so the push check read the main checkout, which had nothing pending. The check now reads the working tree that has the pushed branch checked out, and refuses naming the file and "not committed yet".
- **Refused when the folder cannot be told:** for a Codex call that names no folder, a push from a chat folder that is not a repository is refused. In a repository with more than one working tree, so is a push or pull request of the current branch (`git push`, `git push origin HEAD`, `gh pr create` without `--head`), a branch the chat's repository does not have, and, after a commit in the same command, a branch no working tree has checked out, `--all` or `--tags`. The refusal says to name the branch and run the commit and the push as separate commands, or to name the folder with `git -C <full path>` or `cd <full path>` first.
- **Unchanged:** a Codex call with a `workdir`, or after a `cd` or `git -C` to a full path, is checked as before, and so is every Claude Code shell call. In a repository with one working tree, a Codex call is checked as before too, apart from the not-a-repository refusal above.

## 3.19.9 (writing a report that mentions Claude or Codex is no longer refused)

- **Fixed:** an agent's shell command that only mentions Claude or Codex and has a short word such as "no" or "ok" in it, for example a test report written to a file with a heredoc, is no longer refused with "only the user answers the governance question". The answer guard now counts Claude or Codex only where a shell would really start it, using the same command reader as the continuation guard; heredoc bodies, echo text, file names, here-strings and commit messages are data. A host's own subcommands (`claude config`, `codex login` and the like) still start no session.
- **Tightened:** a launch inside a shell script is now read too, so `bash -c "claude -p yes"`, `cmd /c "claude -p yes"`, `pwsh -Command "codex exec no"` and a second launch later in the same command are refused. A program that starts a host the reader does not list as a wrapper (`tmux new-session`, `screen -dm`, `ssh localhost`, `systemd-run`, `parallel`, `pkexec`, `wt.exe`) is no longer refused with a short answer, where it was before; the same-run rule still stops a session started that way from answering.
- **Informational:** a command that names Claude or Codex and holds the full `toolkit governance enable`, `disable` or `decline` is still refused anywhere in its text, as before. An interpreter script that names Claude or Codex together with a short answer word (`node -e "...Codex said no..."`), a command name computed at run time with host letters somewhere in the command, and text no shell can read that holds a host program name as a word are still refused too; these are rarer than a report write and fail closed.

## 3.19.8 (answers to forwarded owner messages show below them)

- **Fixed:** when the coordinator forwards one of your project chat messages into a work thread, the thread now answers with a new post under it. Before, the post hook did not count the forwarded copy as you writing, so it made the thread edit its older post, and the answer landed above your message where it was easy to miss.
- **How it is read:** only the server's own copy of your message counts (a citation of your message inside the coordinator's relay, in the local and cloud shapes). The coordinator's note, quoted or escaped text, other sessions' output and tool results never count.
- **Counted once:** a message that arrives more than once (queued, then delivered, or cited again later) counts once, so a thread that already answered it keeps editing its answer.
- **Coordinator unchanged for its own wakes:** in the coordinator, a citation counts only for a main chat message it had not seen, and only for its posts from before that message.
- **Projects skill 2026-10-30.1:** the post rule now says an owner message forwarded into a thread counts as the owner writing there.

## 3.19.7 (the continuation guard reads what a command runs)

- **Fewer false refusals:** the guard that refuses resuming or forking a Claude or Codex session now reads where a shell runs a program, instead of looking for host letters anywhere in the text. Read-only commands that name a `.codex`, `.claude`, `Claude-Data` or `Temp\claude` folder, or mention resume or fork, now run, with pipes, chains, loops, heredocs and here-strings: ssh and Docker comparisons, PowerShell reads at chat start and Python scripts piped into Codex's bundled Python among them.
- **Real resumes still refused:** a resume or fork as the command word, through a wrapper (`env`, `xargs`, `Start-Process`, `cmd /c`, `npx`, `find -exec`), in a shell script (`bash -c`, `pwsh -Command`, decoded `-EncodedCommand`, a heredoc or text piped in, or one argument string passed by `Start-Process`), through `eval` or `iex`, held in a variable (`$c = "claude --continue"; iex $c`, `M=resume; codex "$M"`), in a script written and run in the same command, with a split spelling (`c"o"dex`) or a computed name with host letters is refused as before. Option values and variables that some programs run (`git -c`, `--upload-pack`, `rg --pre`, `ssh -o`, `GIT_PAGER`) are checked too.
- **No slow reads:** a command with long chains of wrappers or nested shells is refused once it passes a fixed reading budget, instead of slowing the hook. cmd's reading keeps `;` inside one command, so a message like `'Fix x; codex resume refused'` is not refused there.
- **Clearer refusal:** the message says what it found (for example `claude -c`) and names the two forms Toolkit can verify, `claude --resume <full path to the session's .jsonl file>` and `codex exec resume --last`.
- **Informational:** a host name built inside an interpreter script or from character codes is out of this check's reach; the resumed session's own repository hold still applies.

## 3.19.6 (Codex setup table reads what Codex runs)

- **No Codex command before your answers:** the read-only Codex setup plan no longer starts Codex. It reads the Codex files instead: the Toolkit version in the installed plugin cache, whether the Toolkit plugin is turned on, the local marketplace folder, `project_doc_max_bytes`, each Toolkit hook's state and the setup journal. Codex's own checks run after you answer, and only when an answer needs them: the plugin commands for Install or refresh, and the helper feature check for a helper change.
- **New row "Keep Toolkit available in Codex?":** Install or refresh, Show instructions only, or Keep current, with a short Current such as `On, 3.19.3` or `On, 3.19.0 (3.19.3 available)`. Keep current is recommended only when Codex runs the update copy's version from the update copy with matching files; Keep current and Show instructions only make no plugin change and start no Codex command.
- **New report-only row "Toolkit hooks in Codex":** read from Codex's `[hooks.state]` in `~/.codex/config.toml`, it names any hook that is off or not reviewed (Session start updates, Prompt check, Shell and agent check, File edit check, Checkpoint after tool use, Checkpoint at stop) and says to turn them on in Codex's `/hooks`. It takes no answer, and setup never edits `hooks.state`. The plugin helper's verify output and the final setup summary report the same real hook state.
- **Instruction limit and helpers from config.toml:** "Raise Codex's instruction limit" shows what config.toml has (`Raised (65536)`, `Left alone (32 KiB default)`, `Yours (N)`, `Project docs off (0)`) and recommends Raise it when Toolkit's record and the file disagree. "Codex helper capacity" shows the form of Toolkit's block, for example `1 helper (V1 setting)`; Migrate legacy setting is offered for the V1 block and checked with Codex after your answers.
- **Claude Code start-up reminder:** when Codex has the Toolkit plugin on and runs an older Toolkit than this PC, or some Toolkit hooks are off or not reviewed, the Claude Code session-start install check prints one line, for example `Codex runs Toolkit 3.19.0; this PC has 3.19.3. In Codex say "refresh toolkit", then open /hooks and turn the Toolkit hooks on.` It reads files only and blocks nothing.
- **The same reminder in Claude app chats:** a Claude app chat started from the Toolkit copy in your claude.ai account shows that Codex line too, the same way as the Claude app update reminder: in the hook's message to you and as a line asking the chat to say it in its first reply. With both reminders due, the Claude app one comes first.

## 3.19.5 (a Claude app update reminder, and no Claude plugin update step)

- **Claude app reminder:** when a new Claude app chat starts from the Toolkit copy in your claude.ai account and that copy is older than this PC's Toolkit, the session-start hook shows you one reminder with both versions and the steps: Check for updates on claude.ai, then remove only the plugin on claude.ai in a web browser, then remove and add the marketplace again, then fully quit and reopen the Claude app. It goes out as the hook's message to you and as a line asking the chat to say it in its first reply. It reads two version files and writes nothing. Account copies from before this release stay quiet; the install check and the daily check-in still report them.
- **One set of steps:** the install check row, the daily check-in's plugin steps (skill version 2026-10-29.8, save the card) and the reminder now use the same four steps in that order.
- **Setup names both Claude copies:** instead of "Claude plugin updated this run", setup prints `Claude Code in a terminal: <version> (runs from this PC's Toolkit folder)` and `Claude app: claude.ai copy <version>, which only claude.ai updates`, pointing to the install check's steps when the app copy is behind.
- **No Claude plugin update step:** a probe on Claude Code 2.1.310 showed the terminal app runs Toolkit in place from this PC's Toolkit folder, picks up a new version without `claude plugin update`, and never runs the cache copy. Setup now judges such an install by the folder's version and no longer runs `claude plugin update` after each release; it still installs the plugin once.

## 3.19.4 (skill cards carry the exact file)

- **Skill card hook:** a new Claude Code hook on `propose_skills` checks every card for the Projects controller skill (`web-controller-projects`) against main's SKILL.md, downloaded fresh (raw file, then the GitHub contents API on a mismatch). The card must be kind `improvement` with name and target `web-controller-projects`, the frontmatter description and main's text exactly (only CR and the final newline may differ). Any other card is refused with both sizes and sha256 hashes, where they first differ and the likely cause (cut short, HTML-escaped or changed text). When main cannot be read, the card holds. Other skills' cards pass untouched.
- **One card route (skill version 2026-10-29.7, save the card):** the daily check-in no longer posts skill cards. When a card is due it writes `card due`, and the coordinator starts a fresh skill card thread that follows the new `reference/skill-card.md`: download main's SKILL.md, check its size, hash, Version and that it holds no HTML entities or CR, and pass it unchanged to `propose_skills` in that thread. The `skill cards: coordinator` memory line is gone. Guided setup compares the loaded Version with main's at step 0 and starts the card thread when one is due.
- **Daily check-in:** the **Skill:** line shows the account SKILL.md's size and sha256 next to main's, and a drifted copy that is a cut-short or HTML-escaped Toolkit revision is reported as `SKILL DRIFT: damaged card`, which the coordinator answers with a card thread instead of bringing that text into Toolkit.
- **Install check:** the `Skill card: offer` line names the file's size and sha256, and the setup agent checks them, the Version line and the frontmatter name before it calls `propose_skills` in its own session.

## 3.19.3 (Git Bash folder paths in the push checks)

- **Folders read as the shell reads them:** a folder or file in `cd`, `git -C`, `--work-tree`, a message or body file, a Codex `workdir` or a path word now resolves the way the shell does in every check (the attribution, bypass, force-push and push checks, the merge hold and the governance gate): a leading `~` is the home folder everywhere, and on Windows a Git Bash drive path (`/c/Users/...`, `/cygdrive/c/...`, any drive letter) names that drive and `/tmp` the user's temp folder. Before, `/c/Users` was read as a folder `c` on the current drive and `~/repo` as a folder `~`, neither of which exists, so in Claude Code a push from such a folder went out unchecked with only a note. Git Bash is the shell behind Claude Code's Bash tool on Windows.
- **A folder Toolkit cannot find refuses the push:** a push or new pull request whose folder cannot be found is now refused in both hosts, instead of letting it through with a note that the check could not run. When the same command creates the folder first (`git clone`, `mkdir`, `git worktree add`), the refusal says to run that step as its own command, then the push. A folder written as a variable or a command (`$HOME`, `$(...)`, `$env:USERPROFILE`) cannot be read, and the refusal says so.

## 3.19.2 (links only where the owner acts, and no flattened questions)

- **Projects post hook (skill version 2026-10-29.6, upload it again):** links are required only where the owner acts. A PR, thread or file named in prose or a plain bullet no longer needs a link, in posts and in replies. Every numbered item under the **Waiting on you** header (each question and merge ask) still needs one, and a pull request link there without `/files` is refused with the fix.
- **Exact Waiting list:** only a line that is exactly `**Waiting on you (n):**` (or `**Waiting on you:**`) opens the list, so a bullet or prose line that names it does not. Bullets after the items that do not follow a question are prose and pass. Link text may hold one level of brackets, as in `[[09:41] Update card](#cmsg_X)`.
- **No flattened questions:** a line starting `**Question:` must be a numbered item in that list. A bare label line, a bulleted question, a numbered question outside the list or a question in an Update line is refused, and so is a choice left unindented after a question, a "(my pick)" choice with no numbered question above it, or an indented choice with no numbered item above it. A question line also makes a short post take the layout. Every refusal says how to fix the post and not to flatten it to get past the check.
- **Replies:** the bare-label count now counts only lines that start with `**Question:**`, so prose that talks about the label passes.
- **Projects skill:** "Link everything worth opening" is now "Link where the owner acts", and the question format says never to write a question outside the numbered list or flatten its choices.

## 3.19.1 (Codex shell calls get every commit and push check)

**Codex asks you to trust the Toolkit hooks again after this update**, because their matchers changed. Trust them in Codex's hooks review, or the checks do not run.

- **One shell-call reader:** the attribution, bypass, force-push and push checks, the merge hold and the governance gate now read a shell call through one module, `repo/scripts/toolkit-shell-call.cjs`. It reads Codex's `cmd` and argument lists as well as `command`, and judges the folder the command runs in (Codex's `workdir`, else the tool's `cwd`, else the session folder). Before, the attribution, force-push and push checks read only a string `command` and the session folder, so a Codex call shaped another way, or run in another folder, skipped them.
- **Codex shell names:** the Codex hook checks every shell tool name Codex may report (`Bash`, `exec_command`, `shell`, `local_shell`, `PowerShell`), and both Codex hook files register them for the helper hook and the after-tool programme refresh. Codex documents its shell calls as `Bash`, so this changes nothing when it does.
- **Unreadable shell calls:** a shell call whose command or folder has a shape no host sends is refused when its raw input could commit, push, or create, edit or merge a pull request. Other such calls run.
- **Unchecked pushes in Codex:** Codex shows no hook warning (`systemMessage`), so when the push check cannot run, the Codex hook now refuses the push or new pull request with the reason and the way through for that cause (push fewer new commits at a time, fetch the base branch, fix the named setting, or run `setup toolkit` when git is missing), instead of letting it out unchecked. Claude Code still lets it run with the note. A refusal for another reason carries the note too.
- **Git by full path:** the push check runs git by its absolute path (`TOOLKIT_GIT_PATH`, else PATH, else the usual install locations), so a hook started with no git on PATH still checks, and a git program inside the pushed repository never runs. When none is found, the note says so.
- **Hook time limits:** the Claude Code attribution hook and the Codex helper hook now have an explicit 60-second limit, above the push check's own 30 seconds, which every push and pull request in one shell command now shares.
- **Commit and push in one command:** the push check runs before the whole command, so a `git add; git commit; git push` line used to send a new commit unchecked. Now, after a `git commit` earlier in the same command and repository, it also checks what that commit could add (staged and unstaged tracked changes, and untracked files after a `git add`), and names those items "not committed yet". A `git merge`, `cherry-pick`, `revert`, `am` or `rebase` before a push in the same command is refused with "run the push as its own command".

## 3.19.0 (Windows scheduled tasks)

**Update every computer that reads this repository's binding.** The binding now carries `schedule_folder`, and an older Toolkit copy reads a binding with an unknown key as invalid, so it shows governance as ERROR and holds governed writes until it updates. Update with `setup toolkit`. Upload the Projects controller skill again too: it is now version 2026-10-29.5.

### Scheduled tasks

- **No-AI Windows tasks:** `toolkit-windows-tasks.cjs` is the only code that creates, changes or removes Windows scheduled tasks. It keeps them in one Task Scheduler folder per repository (the binding's new optional `schedule_folder`, `TOOLKIT` for this repository, else the repository name in capitals), named `<FOLDER> - <TASK>`. A task is Toolkit's only when it is in that folder, carries Toolkit's marker and is in this computer's task registry; anything else is listed and never changed.
- **Programme sweep:** `<FOLDER> - PROGRAMME SWEEP` runs hourly from 08:00 to 23:59 for an ENABLED repository: the programme refresh, the attention line, then the footer sweep over the bound repository and its evidence store for the signed-in account's own posts since the last sweep that ended well. It skips with a reason when `gh` is signed out or the merged binding was not read in 24 hours. On Windows it replaces the AI local programme sweep task; an existing one is removed only after you say so.
- **Shard timings:** `TOOLKIT - SHARD TIMINGS` runs on Mondays at 09:15 for the Toolkit repository and opens a pull request only when the measured CI test times drifted.
- **Job runner:** both run `toolkit-scheduled-job.cjs`, which starts only node and gh, never a model, and writes each run's result to `~/.ai-agent-toolkit/user-state/tasks/<id>/last-run.json`. Tasks run as you while you are logged on, with no stored password and no console window (`conhost.exe --headless`), ignore a second start and stop at 30 minutes.
- **Setup:** on Windows, setup lists each task with its folder, name, schedule, purpose and state. It never creates one: when a task needs creating or updating, it prints one PowerShell line for you to paste, which registers the tasks and runs the programme sweep once, starting it again if a closing console stopped it. `setup-toolkit.cjs --remove-toolkit-tasks` removes only Toolkit's own tasks, then the folder when it is empty.
- **List every task:** `toolkit-tasks.cjs [--json]` lists Windows tasks live, Claude Code desktop tasks by name and description, and Codex and cloud tasks from the registry (`~/.ai-agent-toolkit/user-state/tasks.json`), saying where each row was read. `--record` and `--forget` keep cloud tasks in the registry; `toolkit-windows-tasks.cjs adopt` records a task you made yourself, which Toolkit never changes.
- **Projects skill:** on a Windows device the programme sweep is the Windows task, and "list my tasks" merges the project's own list with the device's list.

## 3.18.4 (clearer setup choices and a skill update card)

- **Projects controller skill:** when the copy on claude.ai is older than Toolkit's, setup's install check now has the setup agent offer the new SKILL.md as a skill card the owner saves (`propose_skills`). Uploading the folder by hand is only the fallback when the session has no card tool or the card fails. When the account copy has its own reference files that differ from Toolkit's, a card is not enough, so the check asks for the folder upload instead.
- **Setup question table:** the `Now` column is now `Current`, and holds a short state such as `On`, `7 days`, `Root only; subagent limit 1`, or each recommended Claude Code setting by name with its state; `explain` keeps the full text. When the recommended choice would change nothing, every question shows a single recommended `Keep current` instead of two choices that do the same thing, and the Recommended cell shows only that, since the Current column already says what stays. Otherwise the cell names the change, without repeating a label as its effect. Automatic updates read `Keep current` when they are on and already check the update source 1.1 recommends; the Claude agents question when root-only and its depth setting are in place; the Claude plugin question when Toolkit is installed, turned on, runs from the update copy at this copy's version (read from that folder's manifest, since Claude Code runs Toolkit in place) and Claude Code's install record matches it (a lagging record is shown, for example `On, 3.18.3 (Claude Code's record says 3.17.3)`, and recommends a refresh), which setup now reads from Claude Code's plugin registry files and user settings before you answer (no Claude session is started). There, `Keep current` still re-checks and follows the 1.1 source. A flag or typed word naming a hidden choice still works and applies as the shown one.
- **Antigravity skills question:** copying reads `Copy and keep updated`, so it no longer looks like `Keep current`. The update source's keep choice is now labelled `Keep current` like the others.

## 3.18.3 (security alert cleanup and Dependabot action updates)

- **CI drift guard:** a Dependabot update to a pinned action in `validate.yml` now passes when only the commit SHA and `# vX.Y.Z` version comment change and the action name stays the same. A different action, a tag or short ref, a missing version comment or any other edit to the file is still refused. The guard's tests find the pins in the live file and rerun every drift case with each pinned action updated, so the whole test run passes on such an update too. The portable sharding playbook says the same.
- **Personal-data guard config:** Dependabot's public sign-off address is on the role address allow list, so its commit trailers no longer fail the check. Other addresses at the same domain still block.
- **Action pins:** `setup-python` 7.1.0, `upload-artifact` 7.0.2 and `download-artifact` 8.0.2, each pinned to its verified tag commit.
- **Dependencies:** the test-only `fast-uri` package is locked at 3.1.9, which fixes four advisories.
- **Tests:** two test assertions escape every value they put into a regular expression, so they check the exact text instead of matching any character where a dot was meant.

## 3.18.2 (the project chat's newest post is the one to edit)

- **Projects post hook (skill version 2026-10-29.4, upload it again):** a hook cannot read the project chat, so in the main project chat it now uses the session's own reads of it. After a project chat read that reaches the last page, the newest top-level message decides: when it is the coordinator's own post (not a card), even one an earlier session wrote, and no owner message the session saw (a reply in a thread included) came after it, a fresh post is refused and the refusal names that post to edit with an **[HH:MM] Update:** line, and the post is then checked like the session's own (edits keep its Update lines, and a later owner message closes it to edits), unless the read's copy is near the 8 KB limit and may have been cut short, in which case the post is left untracked and a fresh post passes; when it is the owner's message, the owner counts as having written, so the session posts fresh and earlier posts stay closed to edits. Work-thread sessions (started by a spawn relay, or whose posts land in a thread) skip these reads. Replies under a post, cards and thread launches are not checked by this rule.
- **Queued owner messages:** an owner message that arrives while a turn runs is recorded first as a queued entry and may never appear as a prompt of its own. The hook now counts it as soon as it is queued, so it never asks for an edit that would land above that message.
- **Still not seen:** a coordinator session that has neither posted nor read the chat to its last page has nothing to go on, so its first fresh post passes as before. A live check would need the host to hand the chat's newest message to the hook, or a hook that can call the chat-reading tool.

## 3.18.1 (shorter review rounds)

- **Gate rules:** a G0 plan now splits the work into small slices, one reviewable PR each, with acceptance tests (action, expected result, test file). Before review, the builder checks its own diff against the G2 review section in the same session and notes the result in the PR; this replaces no review. Reviewers rate findings High, Medium or Low: High and Medium block exactly as before, and Low never blocks and goes into one follow-up record per PR. A recheck after a failed review reads the fix commits, the findings they close and the rules they depend on, and widens to the whole diff only where a fix reaches beyond them. The gate rules size cap rose from 10,500 to 11,000 bytes to hold this.
- **Controller:** findings map to ship blocker (High or Medium) and follow-up (Low). A small fix found mid-lane joins the lane's next slice not yet in review instead of its own PR, unless it repairs the default branch or a safety-floor gap or unblocks other work; the slice takes its highest risk tier. Four sentences that repeated other rules were removed.
- **Projects skill (version 2026-10-29.3, upload it again):** G1 briefs ask for the builder's self-check result, recheck briefs name the fix commits and the findings they close, small fixes go into the next slice's brief unless the controller's batching rule lets them go alone, and Low findings are relayed as one follow-up line.
- **Delivery contract:** Low findings are either a follow-up or a Later or optional outcome, and publication is tracked as its own state.

## 3.18.0 (programme attention)

**Update every computer that runs programme commands.** An older Toolkit copy refuses a parent document that carries attention findings ("unknown field(s): attention"), so it stops with an error instead of writing. Update with `setup toolkit`. Upload the Projects controller skill again too: it is now version 2026-10-29.2.

### Governance

- **Attention that lasts:** findings the controller must answer are now kept on the programme's parent document instead of only in one run's report. Each has a fixed code and next action, and is `new`, `acknowledged`, `resolved` or `disposed`. A complete run adds new ones and resolves only its own source's findings that are gone; an unchanged run writes nothing; only the parent's holder acknowledges or disposes (`programme.cjs ack` and `dispose`, with the reason kept private). At most 200 are kept, and new and acknowledged ones are never dropped.
- **Open-issue inventory:** `programme.cjs inventory`, and every `refresh`, put each open issue in one class: a registered parent, a child at any depth, outside the programme (the `programme:outside` label, or an `OUTSIDE-PROGRAMME` comment by an owner, member or collaborator) or needing placement, which becomes a finding. A closed parent with open children is a finding too. A run that misses its deadline or a page records that it was incomplete and resolves nothing. It never links, labels, comments or closes anything.
- **No move across programmes:** a catalogued task that sits under another registered parent is no longer reparented; the pass reports it for the controller to decide.
- **One-time findings stay open:** a captured return, a checkpoint error or an unusable journal is reported only on the pass that first reads the journal, so it no longer closes on the next pass. A captured return stays open while the live assignment's return waits for a verdict, even once acknowledged; a return left by an interrupted or superseded assignment does not keep it open. A checkpoint error or unusable journal stays new while the task has a live gate, until it is acknowledged. A late checkpoint from an ended assignment stays new until it is acknowledged or disposed of. A fresh report of any of them reopens it.
- **Second programme parents wait:** do not register a second parent in a binding yet. A task under a sub-issue of another programme could still be moved across programmes until a planning gate rules on it.
- **Where attention shows:** `programme.cjs attention [--refresh]` lists it, or says `unknown` when GitHub cannot be read (never clear). With `--refresh` it also prints any hold of the refresh pass and exits 1, as `refresh` does. The parent page's CURRENT summary ends with the same line and the open findings. Gate and finality commands print the stored line first, with no extra GitHub request. In Claude Code and Codex the session-start line adds it from this computer's cache. It shows `Attention: clear` once after each change, and starts a background refresh when the cache is missing or an hour old, at most once per 15 minutes per repository, saying so only when one started. It also names a session whose last turn-end record failed. The Projects skill reads it before gates, finality and settling, and the hourly nudge reports it.
- **Hooks and queue in `status`:** `toolkit governance status` shows which hosts run Toolkit's hooks here (`Hooks:` lines, counting the Claude desktop app's claude.ai account copy, with the by-hand path where none run) and how many turn-end records wait offline (`Queue:`).

### Offline queue

- Session start deletes the queues of a repository whose governance is confirmed off. A dropped, skipped or unreadable queued turn is noted once, however often the write keeps failing, and an unreadable entry no longer stops the rest. A replay that ends where it started writes nothing. A signed-out `gh` is an error, never queued. `status` names `GIT_SSH_COMMAND` with `GIT_SSH`, says what a permanent Plink setting means for queued turns, and gives a plain reason for any refresh held by an error code.

## 3.17.3 (fewer false continuation refusals)

- **Quoted text:** the continuation guard reads quotes the way bash and PowerShell do. A `|` or `&` inside a quoted search pattern (`rg 'a|b' path`, `--grep="a|b"`) is no longer a pipe, and a quoted path is no longer a command word, so host folder names next to it stay names. A quoted script after `-c`, `-lc`, `-e`, `-p`, `--eval`, `--print`, `-Command` or `/c` is still read as a script when a shell, an interpreter or a script runner (`su`, `script`, `flock`, `wsl`, `awk`, `sed`) comes earlier in the same command; after other programs (`git -C`, `tar -C`, `mkdir -p`) it is an ordinary argument. An explicit cmd shell, which does not quote with single quotes, and unbalanced quotes keep the earlier reading.
- **Data filters:** a pipe into `tr` or `uniq`, or into the PowerShell cmdlets `Sort-Object`, `Measure-Object`, `Format-Table`, `Format-List`, `Get-Unique` and `Out-Null`, keeps folder names as names. The cmdlets do not count under an explicit cmd shell.
- **Undotted host folders:** a `claude` or `codex` folder or a name joined to one by `-` or `_` (`Temp/claude/`, `claude/project-thread-x`, `scripts/toolkit-codex-hook.cjs`, `Claude-Data/`) is a name when it sits in a standalone path argument. A path whose last part is a host program (`.../claude`, `codex.exe`, `claude-code`), a path glued to another fragment by a quote or `+`, and command positions stay evidence.
- **Claude Code's Bash tool:** commands from the Bash tool are proved as data under bash only, because that tool always runs bash. The host comes from the hook entry point, never from the hook input. Codex, the Monitor tool and other omitted shells still need the proof under both bash and PowerShell.
- **More data commands:** `git apply`, `git switch`, `git checkout`, `git merge-base` and `git ls-tree` with fixed options, where patch paths, branch names, start points and revisions are operands only. A `sort` operand may not start with `-`.
- **Deep nesting:** the data proof stops at 64 nested `$(...)` levels and refuses, instead of running out of stack.
- **Still refused:** a host program in command position, in a substitution, behind a wrapper or built from fragments; pipes into shells, interpreters, `xargs` or unknown commands; inline scripts such as `node -e`; PowerShell script blocks and `"$(...)"` strings that build a path; and `VAR=value` prefixes. Resuming a session with `codex resume` or `claude --resume` is refused as before.
- **Correction to 3.16.6:** the fixed set of data commands also covers plain assignments and single-quoted here-string stages, which count as commands in that proof.

## 3.17.2 (spacer lines only in the update log)

- **Projects skill:** only the **[HH:MM] Update:** lines in a running post keep the `&nbsp;` spacer line after each one. A question's last choice no longer takes a spacer line; the next numbered item follows it directly. The post hook already passed over spacer lines, so it neither requires nor refuses one anywhere, and its tests now cover questions with and without a leftover spacer.

## 3.17.0 (gate route for Projects thread launches)

- **Gate route hook:** a new Claude Code hook on the Claude Projects thread launch tool holds gate threads to their pinned route. A brief that runs a gate carries a `Gate:` line (G0, G1, G2, G2 recheck, delta review, design challenge, or none). A gate launch must pass the effort and model of its stack registry route and the device the project's `GATE ROUTE:` memory line asks for (local Remote Control in a named folder, cloud, or any). Otherwise the launch is refused, and the refusal lists every wrong field with the exact values to pass. A brief that mentions a gate (a gate label, gate, recheck, reviewer or independent review) with no `Gate:` line is refused until it says which gate it is; an independent review declares `Gate: G2`. Other threads, other tools and a hook that cannot start pass.
- **Projects skill:** the Threads section says gate briefs carry the `Gate:` line and their route, Binding defines the `GATE ROUTE:` line, and setup writes it at the Bind step from the pinned profile and the owner's answer on where gate work runs. The setup inventory has a row for it.

## 3.16.7 (credentials and plain-text findings before a push)

### Check before a push

- **Credentials and plain-text findings are refused before they leave the computer:** the shell hook in Claude Code and Codex now reads what a `git push` or `gh pr create` would send and refuses it in the same turn when a line added by any commit being sent carries a credential (the shared formats in `skills/secure-ci-cd/scripts/secret-patterns.cjs`), or, in a repository that runs the plain-text check, the sent version of a changed file has a plain-text finding. It lists up to 10 items by file, line and rule (and commit, for a credential), never the matched text of a credential, link or reference (a banned term shows its short code). It reads the pushed remote and branch, `gh pr create --head` and `--base`, and the same command forms as the force-push check (`git -C`, a `cd` earlier in the line, PowerShell, nested shells). A check that cannot run or takes over 30 seconds lets the command run, and Claude Code shows the user a note. With `--all` or `--tags` only credentials are checked. It moves feedback earlier and does not replace CI or GitHub push protection.
- **Hand pushes:** where the personal-data guard's hooks and the plain-text check are both installed, the guard's pre-push hook also runs the plain-text check on the files the current branch changes, when the push sends the current commit (a branch or tag at it; a delete sends nothing). It is skipped with a note when the push sends another branch, when there is nothing to compare with or while the working folder has uncommitted changes, and a check that cannot run lets the push go on with a note. Its messages, like CI's, name the file, line and rule without the matched text of a link or reference. The guard installer's `--check` now reports a hook from an older template as outdated.

## 3.16.6 (host words used as data)

- **Host words as data:** the continuation guard no longer refuses commands whose host words (Claude, Codex) and selector words (resume, fork, --continue) appear only as data: issue and PR text, commit messages, search patterns, paths, branch names and Toolkit setup options. This step runs only where the guard would refuse, and only turns that refusal into an allow. Every raw owner, state, workdir and path guard still runs first.
- **What counts as data:** every command in the input, including commands inside `$(...)`, must be one of a fixed set: `gh issue` and `gh pr` (`comment`, `create`, `edit`, `view`, `list`) and `gh api` with fixed options; git `status`, `log`, `show`, `diff`, `rev-parse`, `branch`, `ls-remote`, `fetch`, `add`, `commit`, `push` and `worktree list|prune|remove|add`, optionally after `-C <folder>`; `grep`; `rg` without the options that run programs; the Toolkit setup, governance, risk-tier and install-health scripts, where only the `--host` value is data; PowerShell file and output cmdlets; POSIX file commands; `cat` or `tee` fed by a heredoc with a quoted delimiter; single-quoted here-strings; and plain variable values. Only the operands each one proves are data; the rest of the command must hold no host or selector word.
- **Shells:** an explicit bash, sh, PowerShell or pwsh shell is read as that shell, and Claude Code's PowerShell tool as PowerShell. Any other omitted shell must read the command as data under both bash and PowerShell, and its first line must also be safe under cmd. cmd and unknown shells keep the earlier refusal.
- **Still refused:** a host in command position, in a substitution or behind a wrapper; `eval`, `iex`, `&`, `Start-Process`, `xargs`, `find -exec` and `bash -c`; `git -c`, `--upload-pack` and `<transport>::` remotes; writes to anything other than a plain `.md`, `.txt`, `.log` or `.csv` file outside dot folders; PowerShell scope names such as `$function:` and `$env:` assignments; upper-case POSIX assignments; inline scripts such as `node -e`; and data that Windows PowerShell or cmd would split into extra arguments for git, rg or node.
- **Folder names:** `Start-Process`, `saps`, `start` and `call` count as command wrappers, git reads a pipe as data only when no option follows it, and the parameter-expansion check runs in linear time.
- **Correction to 3.16.4:** a folder name after a pipe stays a name for any listed pipe target, and some of those targets can still run code: `ForEach-Object { ... }` with any body, and `git`, `rg` or `sort` with options that run programs. Staged-file runs (`sh f`), `pwsh -File` with a dotted host folder and unquoted `bash -c ~/...` are not covered either.

## 3.16.5 (long runs and test time budgets)

### Guidance

- **Long runs:** a new global rule says to check long runs early against their usual time, stop one that is far over, and stop the process trees you started when a run ends or is interrupted. The fast-tests playbook gains a Long Runs section: note the usual time, check at about a quarter of it, rerun the narrowest form, and keep capture wrappers at a constant cost per write.
- **Windows leftovers:** `windows-local-dev-services` explains that stopping a parent process on Windows leaves its children running, stops whole trees with `taskkill /T`, and lists your own leftover `node` processes by path. Both command-hygiene playbooks use the tree form.

### Toolkit CI

- **Test time budgets:** the shard manifest sets 120 seconds per test file on Linux and Windows (180 seconds, with a recorded reason, for three files waiting to be split), and the `validate` job fails a file over its budget (`check-test-durations.cjs --ci`). A local `npm run validate:all` leaves that one check out and says so.
- **Timing refresh with no AI:** `refresh-shard-timings.cjs` reads the test summaries of the latest green Validate run on `main`, reports untimed files and unbalanced shards, and with `--write` or `--open-pr` records the times and moves files between the named shards.
- **Continuation tests split:** the continuation test is now five files, by area and by hook, and its hook cases start a few hook processes at a time, still one process per case, with the no-change snapshot compared around each batch.
- **Status document:** `VALIDATION-STRATEGY.md` lists the dependency auto-merge and source-watch workflows.

## 3.16.4 (continuation folder names)

- Dotted host folders used as arguments and the exact upper-case folder variables CODEX_HOME, CLAUDE_CONFIG_DIR, CLAUDE_PROJECT_DIR and CLAUDE_PLUGIN_ROOT count as names rather than continuation evidence.
- Names in command position, derived-text execution and pipes into unknown commands retain the earlier checks. Only fixed data-reading pipe targets qualify for the folder-name rule.
- Other variables, escaped or single-quoted variable names, unbalanced quotes, non-ASCII input, control characters and oversized commands retain the earlier evidence checks. Complete literal reader proofs remain independent.
- Every raw owner, state, workdir and path guard still runs first.

## 3.16.3 (offline queue for governed records)

### Governance

- **Governed records wait offline:** while governance is on but GitHub cannot be reached, or the merged binding has not been read in the last 24 hours, the turn-end checkpoint keeps each turn in an offline queue in Toolkit's own state next to the session (never in the repository; at most 200 turns, 7 days). The next turn end of that session that can write replays them in order, once, and deletes the queue after the write is confirmed. If governance is confirmed off, the queue is deleted without being written. A session that never resumes leaves its queued turns unwritten, and turns older than 7 days are dropped with a note.
- **Plink and TortoiseGit setups work:** `GIT_SSH` and `GIT_SSH_COMMAND` hold the read of the merged binding only for an ssh origin, where they matter; for https they are ignored. Your own environment, like your global and system git config, is trusted.
- **`status` says why:** when a refresh keeps the last read (offline, a redirected origin or override, a moved branch), `toolkit-governance.cjs status` says so in plain words.

## 3.16.2 (thread replies, parent folders and replies in your own words)

### Governance

- **Real thread replies are read again:** the app's own notes at the end of a Projects thread message, and files or images attached to a message, no longer make Toolkit ignore the user's reply. A message that carries a file or image is not an answer.
- **Asked from a parent folder:** a session working in a folder that holds several repositories (or in a decided repository) now asks Toolkit's question when a command or edit reaches github.com repositories that are waiting, naming them all, and one reply answers for every repository named. Before, the question was never asked there and no reply could answer it.
- **Replies in your own words:** a reply such as "no for both" goes to the agent with a one-use reply ticket; the agent reads what it means and records it with `toolkit-governance-answer.cjs`, and Toolkit only checks that it is the user's own reply after its question, in the same run. When the agent is unsure, or a bare yes, no or later arrives from a parent folder, it asks once more naming exactly what Toolkit would record, and the user's reply can then record only that answer.

## 3.16.0 (governance as a repository setting)

### Governance

- **The repository decides, on every computer:** `.github/toolkit-programme.json` as merged on the default branch is now the repository's governance setting. A repository with a merged binding is never asked about governance again, on any computer or fresh profile. A working tree, another branch, a fork's copy or this computer's own file never turns governance on, and never turns a merged "enabled" off.
- **Binding version 2:** `governance` is `enabled` or `disabled`, and `parents` lists the programme parent issues (children come from native sub-issues). A merged `disabled` stays off until an owner-merged pull request changes it. Version 1 bindings still read as enabled with one parent, and the next setup pull request moves them to version 2. This repository's own binding is now version 2.
- **No network per tool call:** `toolkit-governance.cjs status` and session start read the default branch's binding (a bounded fetch) into a cache next to your governance decisions; every hook reads only that cache. The read happens only when the URL git really uses for `origin` is the same repository, so a redirect in git's config changes nothing. Programme records take their store, parent and checks from the merged binding only. Offline, the last read keeps routine work going; governed records, gate admission and finality need a read from the last 24 hours.
- **An unusable merged binding is an error, not off:** a malformed binding or unknown schema on the default branch shows ERROR. Ordinary work continues; governed records, gate admission and finality hold until a pull request fixes it.
- **Repositories never set up still ask:** with no merged binding and no answer of yours, a github.com repository still pauses until you answer (yes, no or later), from any chat. Your earlier answers on this computer are kept as they are: a yes means setup is offered, a no means you are not asked again there, and where a binding is merged an old no becomes only a preference not to suggest governance.
- **Discovery before questions:** the new read-only `toolkit-governance.cjs discover` (also shown by `enable`) looks before asking: it reuses a merged binding, lists parent-issue candidates (programme parents and issues with native sub-issues) and evidence-store candidates (verified private, owned by you, with an `archives/` or `state/` folder; a name alone selects nothing), and puts one adoption proposal: what Toolkit would reuse, add, repair, keep and defer, as one setup pull request after one yes.

## 3.15.28 (footer hook follow-ups)

- **Footer hook shell routing:** each `gh api` call in a command is read for its own method, so a long command stays fast. In the cloud, only shell writes that post a body (`gh issue|pr create`, `comment`, `edit`, `review`, `close --comment`, and `gh api` calls other than DELETE or GET) get the read-back note; `gh issue close`, `gh pr ready` and similar writes no longer do. Every `gh` write's response is still read for the footer.
- **Code fences:** a fence closes only on the same character (backtick or tilde), at least as long as the opening and with nothing after it, so a footer after a long fence that quotes a shorter one is still found and one inside an open fence is left alone.

## 3.15.27 (numbered questions and fresh posts in Projects)

- **Claude Projects skill (2026-10-28.3):** several owner questions now go in a numbered list under **Waiting on you**, each written `1. **Question: ...?**` with its link, its choices as four-space-indented bullets marking "(my pick)", and an `&nbsp;` spacer line after the last choice. Each **[HH:MM] Update:** line is followed by the same spacer. Overlapping post-format rules are merged into one set, and work threads follow the same post rules.
- **Projects post hook:** choice bullets under a numbered question need no link of their own, and spacers or other non-list lines no longer end the **Waiting on you** check, so a later item with no link is still caught. Once the owner has written after a post, every edit of that post is refused and a fresh post is asked for, so an answer can no longer land above the owner's message; an owner reply under the running post itself still leaves it open. Lines now also split on a lone carriage return.

## 3.15.26 (cloud footer on GitHub posts)

### GitHub posts

- **Footer flagged after posting:** in cloud sessions the GitHub route appends a "Generated by Claude Code" footer to posts after they leave the session. In a governed, guarded or evidence-store checkout, a new Claude Code after-tool hook reads what GitHub sent back and tells the agent to remove the footer at once with the matching connector edit (issue and pull request comments, pull request and issue bodies). Review comments, review replies and review bodies, which the cloud cannot edit cleanly, are listed for the device sweep instead. The hook never stops a tool call and stays silent when it cannot read its input.
- **Device sweep:** `node repo/scripts/toolkit-github-footer-sweep.cjs --repo <owner/name> [--since <ISO time>] [--apply]` scans a repository's comments, review comments, reviews and issue and pull request bodies for the footer, with no AI step, so a scheduled task can run it. With `--apply` it edits the signed-in account's posts, skips any post changed since the scan, and reads each edit back. Exit codes: 0 none found, 3 found and left, 4 cleaned, 1 a failure, 2 bad arguments.

## 3.15.24 (answer from a Projects thread)

### Governance

- **Answer from a Claude Projects thread:** the user's yes, no, later or ok sent in a Projects thread now answers the governance question in the Remote Control session it reaches, and lifts the hold there. Before, the thread's wrapping meant the reply was never read as an answer, and the repository stayed held. Only the user's own message counts: a coordinator's relay, a scheduled task or anyone else's message does not.

## 3.15.23 (finished child issues close as completed)

- **Child issues close with their merge:** once a merge completes every criterion of a child issue and any owner UAT passed, the PR that completes it says `Closes #n` so the merge closes it as completed; when that could not apply (UAT after the merge, or work over several PRs), the controller closes it without asking. Closing a parent, a programme issue or as not planned still needs the owner. Staged, UAT-pending, blocked, partial or follow-up PRs keep using `Refs`.
- **Reconciler close list:** each ready-to-close entry is marked closable only with G1-or-later acceptance, UAT recorded as not required, passed or retained at the head, every review verdict at the head passed, a merge into the default branch and no open sub-issue. The reconciler itself still never closes.
- **Claude Projects skill (2026-10-28.2):** the skill and the managed project instructions no longer ask the owner before closing a completed child issue.

## 3.15.22 (no Codex-only settings in the Claude plugin)

- **Claude plugin manifest:** the Claude Code plugin no longer carries the Codex-only `interface` block, so syncing the plugin on claude.ai no longer warns that it strips an unknown key. The Codex plugin keeps its display name, prompts and icons.

## 3.15.21 (no model or effort asks in Projects setup)

- **Claude Projects skill (2026-10-28.1):** guided setup no longer asks the owner to choose a coordinator model or effort in the project's settings, and the setup inventory drops its models row. Thread effort is still set on every thread the coordinator starts, and scheduled tasks and gates keep their own model and effort rules.

## 3.15.20 (merge tripwire and stale-copy warning)

### Who may do what

- **Merges wait for the user (a tripwire, not a lock):** on Claude Code and Codex, the hooks hold an agent's merge until the user typed a line with "merge" next to the pull request number in their own session, such as "merge 618", "618 merge" or "ok to merge 618". A line with a quote, a question, or one of a fixed list of words for a no, a doubt, a condition, a delay, a report or another kind of merge ("merge main into 618") does not count. This covers `gh pr merge`, the GitHub API merge endpoint and the GitHub connector's merge tool. One approval allows one merge of that pull request in that repository within a day, and the merge must name the head commit it expects. Connector auto-merge, GraphQL merges, the merge queue, branch merges, ref writes and pushes to the default branch are refused when written directly. It reads command text, so it catches mistakes, not a determined agent: wrapped or nested sessions, scripts, files, other HTTP clients and direct commits through the API or the connector's file tools get past it. Agents act as the user on GitHub, so GitHub cannot tell their merges apart; the hard limit is the repository's own rules where it has them (a pull request for the default branch, no force-push, no deletion). Cloud sessions are not covered yet.
- **Stale plugin copies speak up:** when a session runs an account-synced Toolkit copy that is older than a Toolkit repository in its folder, the session-start message says so and that newer safety hooks do not run, instead of staying silent.

## 3.15.19 (proved binding separators and literal Git operands)

- Restored conservative collapsed continuation evidence for every unproved source byte, including implicit concatenation and joining pipelines. Only a bounded Python for-binding separator in a complete literal PowerShell here-string/stdin transport interrupts the projection; every source word, string, comment and executable neighbour remains inspected. Direct, quoted, template and ordered signals stay independent.
- Added complete fixed Git operand proofs for add, commit, push, fetch, rev-parse and status. Only proved literal data spans are excluded; executable neighbours, options, operators, exit guards and unsupported stages remain visible.
- Added anonymous boundary, schema, construction, raw-guard and source-hook tests with exact span and non-mutation checks. Native parsing, target authority and held-queue independence retain their boundaries; installed and actual-operation acceptance remain separate.

## 3.15.18 (multiline and pipeline reader operands)

- Extended fixed literal reader proofs across top-level newline and single-pipe stages while keeping every operator, unproved stage and nested block visible to continuation detection.
- Added separate literal option-value roles for the five bounded gh run list filters, including its enumerated JSON field tuple. Unknown options, expressions and alternate command forms remain unproved.
- Composed the same operand spans through one explicitly selected PowerShell literal script transport, preserving exact outer and inner source positions and the existing one-line wrapper behaviour.
- Added structural, acquisition-schema, hostile-input and source-hook regressions. Native parsing, target authority, generic guards and held-queue independence retain their existing boundaries; installed interception remains a separate acceptance step.

## 3.15.17 (literal reads and shell script operands)

- Fixed ordinary literal reader patterns and Windows file paths being mistaken for continuation commands. Only complete fixed reader schemas receive the data proof; subprocess options, unknown flags and executable syntax remain conservative.
- Proved reader operands also remain data inside bounded top-level semicolon lists, including Git metadata reads followed by a public Toolkit file read, both directly and inside one qualified PowerShell command wrapper. Every separator and unproved executable segment retains independent detection.
- Recognised shell command operands are inspected as executable source even when quoted. Proved non-native wrapper executable paths no longer contribute false host evidence; native target verification and every generic guard retain their existing rules.
- Added operand-role, wrapper, escape and source-hook regressions with synthetic non-mutation checks. Installed interception and ordinary-read replay remain separate acceptance steps.

## 3.15.16 (continuation target isolation)

### Governance continuations

- Both native tool hooks check verified continuation targets without consulting or repairing the account-wide held-message queue. Unrelated, rootless, malformed and unreadable held groups no longer block a proven decided target. Held targets, unreadable target state, owner answers, user-state edits, card/epoch controls and native helper transition restrictions retain their protections.
- The bounded reader admits exact native Claude transcript-path resumes and directory-filtered Codex `exec`/`e resume --last`. Unknown UUID/name/picker selectors, Claude implicit continue, interactive Codex worktree selection and unsupported shell syntax are refused independently of queue contents. Transcript acquisition returns only directories across a child-process boundary and detects incomplete records, excessive input, path links and file drift.
- Added the complete compact target-authority model, default-reader and hostile-input tests, plus both source-hook processes crossed with both CLI families in synthetic homes. Source-process results do not qualify installed hooks or desktop dispatch; no installation, real continuation or user-state migration is part of this repair.
- Plain literal output/grep data and verified native help/version forms retain ordinary-command behaviour. Balanced double quotes protect literal operators; single-quoted operators, shell evaluation/expansion and ambiguous quote forms are refused on both data and selector paths. Help-only exits were checked in disposable native CLI homes without starting sessions.
- Computed host or selector spellings remain unverified when unsupported syntax leaves recognisable continuation evidence, including addition, arrays, format and join inside data or help-looking commands. Whole-atom prefix recognition preserves evidence across irrelevant quoted arguments, casts, methods and edge whitespace, including mixed fixed-letter format holes. Detection does not evaluate expressions or expand arbitrary-script enforcement.

## 3.15.15 (agent cost control)

### Agent cost control

- **New skill `agent-cost-control`:** every scheduled task, routine, loop, automation, helper, spawned thread and workflow model call starts on the cheapest of three tiers (small, mid, top) that can do its job, with medium effort as the floor and no lowest-effort setting anywhere. A step up needs a written reason kept where the setting lives, a controller proposes the next step at once when output falls short, and a recorded raise survives rebuilds. The skill lists where Claude, Codex, OpenCode-style harnesses, n8n and CI keep their model and effort settings, and how long-running threads rotate with a short handoff file (never the controller's own thread). Coding gates keep their pinned routes.
- **Global rules:** the Delegation paragraph now says to run each non-gate automation, thread and helper cheapest first at medium effort or above, pointing to the skill for the detail. Gate sessions and the helpers a G0 or G1 lead launches keep their pinned routes. A few nearby sentences are reworded more tightly, and the skipping-delegation sentence drops its "no note is needed" clause, which contradicted the gate contract's exception record for substantial gate work done without delegation; this keeps the global block inside its size budget.
- **Claude Projects skill (2026-10-26.7):** non-gate threads no longer start on High; they start on the cheapest fitting step, and the brief names the step and any reason. One job per thread, with automatic rotation of long-lived workers. A chat reply thread under a coordinator post now closes after 6 quiet hours (`QUIET-6H`); work threads still close only once their output is saved and relayed, and home threads never. The scheduled-task reference drops "start one notch higher" for the ladder, and the `SCHEDULED TASKS:` memory line takes an optional `raised <tier>/<effort> <date>: <reason>` field that swaps keep.
- **Task prompts:** `toolkit-projects-tasks.cjs` takes a `model` tier (default small for the hourly nudge and custom tasks, mid for the daily check-in) and an optional `raise_reason`, required above the default tier or above medium effort; `low` effort is refused. RUN SETUP states the tier and effort, and each run flags a `TIER GAP` when it was served something else. The daily check-in reports `model` and `effort` gaps, and the hourly nudge lists `QUIET-6H` resolve candidates and threads due for rotation under **Rotate:**. Prompts rendered before this release still check and refresh: they take their kind's default tier, `low` effort rises to medium, and effort above medium is kept with a reason asking the coordinator to confirm or lower it. A model or effort gap on a fresh-session task is listed as advice only, and a gap the last swap left is reported once, so neither causes a daily swap. Rotation applies to non-gate work only; gate sessions keep the gate rules. Every swap and rebuild first makes the saved params match the task's entry (a recorded raise, or the template's tier at medium effort once a raise is removed), so the prompt sets the right effort itself. A raise reason, in params and in memory alike, is 3 to 200 printable ASCII characters on one line and cannot read as the owner's stop or schedule mark in any case or spacing.

## 3.15.14 (no paid GitHub features)

### GitHub governance

- **No paid GitHub features:** Toolkit never asks about, turns on or reports as drift a GitHub feature that needs billing. Governance setup no longer asks about GitHub Secret Protection or Code Security, `toolkit governance security` and `migrate` never write them, and the check no longer wants a paid-features answer in a private repository's binding. On a private or internal repository secret scanning, push protection and CodeQL show as not applicable (private repository); on a public repository they still turn on by default, as do Dependabot alerts and security updates everywhere. A binding's `paid_security` key is deprecated and ignored: older bindings that carry off or on stay valid and nothing changes, and any other value makes the binding invalid.

## 3.15.13 (post layout)

### Projects skill

- **Post layout enforced:** the Claude Projects post hook now also checks the approved post layout on top-level posts of about 25 words or more: a **Now:** line first, **[HH:MM] Update:** one-liners with no question or numbered options inside, every **Waiting on you** item linked to its card or thread, and one **ELI5:** line as the very last line. An edit of an earlier post must keep every Update line word for word and add at least one new one. Every post and reply is refused if it has an em-dash or an arrow outside code, or more than one **Question:**. Replies under a post keep only the wording and link checks.
- **Merge summary before merge:** in a Projects session, a PR merge (`gh pr merge`, a `gh api` merge call or a merge tool) is refused until a line in one of that session's own posts or edits says "external effects" and names the PR. It reads only the command text: it reads the command word by word with bash or PowerShell quoting rules (quotes, escapes, heredocs, here-strings and option values never hide or replace the PR number, and a redirection's stream number or target is never read as it; a command it cannot finish reading counts as a merge with no number) and checks every merge in one command; curl, GraphQL, wrapper shells, prefixes, aliases, scripts, direct pushes and a command inside a double-quoted `$(...)` or backticks are not seen, and an unreadable transcript lets the merge pass. Sessions outside Projects never see it.
- The skill describes the layout in a new **Post layout** rule. The Claude Projects controller skill is 2026-10-26.6 (save the new skill card).

## 3.15.12 (governance tap card)

### Governance question

- **Tap to answer in Claude Code:** in a github.com repository with no governance decision, Claude Code shows a Yes, No, Later card with the question as three short lines of text above it, so the question is seen in the mobile app and Remote Control too, where a hook's hold message is not shown. The held message is kept and handed back after the answer, as before; on the turn that shows the card nothing else runs, read-only tools included. Only the user answers: a card with an answer already filled in is refused, and a tap counts only on the card Toolkit let through, once, in the session that was asked. Typing yes, no or later still works.
- **Shorter notices:** the held-message notice is three lines in both hosts (Codex shows it as text), and the follow-up and not-on-github.com notices are one or two lines. What each answer does is in the bridge guide.

## 3.15.11 (input readers)

### Input readers

- **Gate rules name the reader design:** a safety decision read from YAML, shell or free text now uses a default-deny reader over a subset its G0 states, and G1 tests it with the shared hostile-input set. To make room, four gate-rules sentences that are said elsewhere were removed: the G0 and G2 skip rules (in the G0 Discovery bullet and the global rules), "tests and CI run on every edit" (the global rules) and "two failed fixes of the same thing: stop and rethink" (the global rules now carry the stop after two failed fixes).
- **Shared hostile-input set:** `repo/tests/support/hostile-inputs.cjs` holds the input shapes past reviews found readers getting wrong (line breaks, continued lines, quoting and escapes, YAML structure, indents and spaces, invisible and look-alike characters, free-text lists and labels, large inputs), each built from code points so the source holds no raw invisible characters. It adds `variants` (every line-break and byte-order-mark form of an input), `timing` (a growth-ratio check for quadratic work) and `expectDefaultDeny` (every case refused unless a test names it as an allowed exception). It holds data and assertions only and never decides whether an input is safe.
- **First adopter:** the default-branch protection check's tests run the YAML, line-break, indent and invisible families and the large-input check. Every case comes back unverified except four the reader decodes exactly as YAML does: a CRLF line end, a quoted `on` key with no escapes, a consistent odd indent and one leading byte order mark.
- **Protection check fix:** the workflow reader no longer accepts a doubled single quote (`'it''s'`) in a value, a list item or a flow list. It read `'x''y'` as `x''y` while GitHub reads `x'y`, so two jobs named `"x'y"` and `'x''y'` (one skipped on pull requests) passed the one-producer check. A workflow that doubles a quote is now outside the subset, so unverified. For the same reason the reader refuses a plain value holding " #" (in YAML a comment always starts there, but a quote earlier in the value made the reader keep it, so `name: x' #'` read as `x' #'` while GitHub reads `x'`), and a job name that YAML reads as a number or a boolean (`1.10` is the number 1.1, `True` is true), which it reports as an unreadable name.
- **One-producer check counts every job that could report the name:** a matrix job (any `strategy`, including an expression; GitHub adds " (values)", also before a reusable call's " / <called job>", and a skipped one reports its bare name) or a reusable workflow call (GitHub adds " / <called job>") whose name could be a required check now leaves that check unverified instead of being left out. An expression name is read as GitHub reads it, so a `}}` inside a quoted string no longer ends it, and one that never closes could produce any name. A job name that matches a required check only in letter case, or a quoted name with spaces at either end, also leaves it unverified, since the check does not rely on how GitHub compares or trims names. Checks that GitHub-managed workflows report without a file, such as CodeQL default setup, and checks a step posts with a token that can write them are not counted; the check names this as a limit. The shared hostile-input set gains a `check-names` family of such names, each with the name GitHub reports.

## 3.15.10 (flexible setup answers)

- **You answer setup in your own words:** after the setup question bank, reply `all recommended`, `allrecommended`, `use all the recommended ones` or `change 3.1 to D, rest recommended`. The agent turns a clear reply into the exact answer, adds the bank reference itself and shows one line saying what it sent; it never asks you to type the reference. It asks one short question when the reply is unclear, never treats a bare `yes` or `ok` as an answer, and uses only your reply to the newest bank.
- **Setup accepts sloppy spelling:** `all recommended` in any case, with spaces, hyphens, underscores or nothing between the words and one optional full stop; the bank reference in any case, with or without hyphens, with O read as 0 and I or L as 1, followed by a colon or spaces; and changes separated by commas, semicolons or spaces. A missing, wrong or old reference, duplicates, unknown questions or choices, and mixed answers still stop before any change. A live terminal accepts the same spellings.
- The reply guide under the bank now reads "Reply with either: `all recommended` or only your changes", and still prints the bank reference above it.

## 3.15.9 (setup launch on Windows)

### Setup launch on Windows

- **One setup line for PowerShell and cmd.exe:** agents now run the managed checkout's setup script by its resolved full path, written with forward slashes inside double quotes and with no `$env:` or `%...%` variables: `node "<home folder>/.ai-agent-toolkit/source/ai-agent-toolkit/repo/scripts/setup-toolkit.cjs" --execute --profile auto-main`. The old PowerShell-only line failed when Codex ran it through `cmd.exe`, because `cmd.exe` does not expand `$env:`, so "refresh toolkit" never started setup. The shell keeps the chat's own folder, so setup still fast-forwards your own Toolkit clone and measures that project's instructions.
- **Same form for toolkit env, the setup help and `--codex-cli`:** the `toolkit-env` skill, `setup-toolkit.cjs --help` and the `--codex-cli` hint all use a resolved full path in quotes.
- **PowerShell blocks for people:** commands people type themselves in the README, the bridge guide, How to use and the toolkit env guide keep their PowerShell form and are labelled as PowerShell for a person to type.
- **Windows launch test:** a new test launches setup from a different folder whose path has a space, with a home folder that has a space, through both `cmd.exe` and PowerShell, and shows the old line failing through `cmd.exe`.

## 3.15.8 (pull request text checks)

### Pull request text is checked before review

- **New personal-data guard rules for pull request text:** the guard's `pr` mode and the pull request part of its `ci` mode now also block real home-folder paths (`PDG-HOME-PATH`: Windows, Linux and macOS, where the account name is not a placeholder such as `example`, `<you>` or `%USERNAME%`) and AI attribution: claude.ai session, chat and project-thread links (`PDG-AI-SESSION-LINK`), "Generated with" or "Generated by" Claude Code footers (`PDG-AI-FOOTER`), and the Projects attribution marker and its "Requested by ... project thread" line (`PDG-AI-MARKER`). Findings name the place and rule only, never the value. File content, paths, branch names and commit messages keep the existing rules.
- **Opt-out for attribution only:** a repository that wants AI attribution in pull requests sets `scope.pull_request_attribution` to `false` in its guard config. The key is optional and on when absent, so existing configs stay valid. The home-path rule always runs with `pull_request_text`, and in CI a change cannot switch attribution off for itself.
- **Edits are re-checked:** the `Validate` workflow also runs when a pull request's title or body is edited, so a footer a tool adds after the last push fails the required check, and removing it clears the check without a new commit. The personal-data CI template also runs on edits, and both workflows cancel an older run for the same pull request.
- **Repositories that already have the guard workflow:** the installer keeps an existing `.github/workflows/personal-data-guard.yml`, so add `types: [opened, edited, reopened, synchronize]` under its `pull_request:` trigger by hand to get the re-check on edits.
- **Open pull requests:** after this change, an open pull request whose body still has an AI attribution footer or session link fails the personal-data check on its next push or edit. Remove those lines from the body.
- **Projects instructions:** the attribution line now says to strip the platform's requester header and project-thread links too, and to remove anything the platform adds, because the guard fails a PR that keeps them.
- **Protection check reads activity types:** the governance protection check now treats a pull request `types:` list that keeps `opened`, `synchronize` and `reopened` as running on every push, so adding `edited` keeps a required check verified. Any other list, or one it cannot read, stays unverified.

## 3.15.7 (task moves and catch-ups)

### Projects skill

- **Moving a task or catching up a run:** moving or recreating a scheduled task to a time already passed today skips today's run unless it already ran today (a swap's test run counts). The coordinator says which run is skipped and catches it up the same turn by messaging the task's home thread to run its prompt, and confirms the report arrived. A bound task's prompt never runs in another thread or the coordinator, and a bound task is never fired with fire_trigger from another thread, since that run starts with no project tools, files or memory. A cron change keeps the binding. Tasks marked stopped by owner are never moved or caught up.
- **Stray runs stop cleanly:** every rendered task's run setup now starts with a check. A run with no project tools (deferred tools count) or no access to the project files makes no other tool call, skips delivery and ends with the single line "skipped: started outside its home thread".
- **Nudge timing:** the daily check-in reads the time the nudge should last have fired from the nudge's own cron, so hours outside its waking window never count; a nudge that fires less often than hourly allows its interval plus 5 minutes, and a nudge with no run yet, as after a swap, counts as armed while its next run is within one interval.
- The Claude Projects controller skill is 2026-10-26.5 (save the new skill card). Live check-in and nudge tasks pick up the new run setup through the daily check-in's task swap.

## 3.15.6 (standing permission asks)

- **Standing permission asks:** when a step stops on the owner, an agent checks the standing-permission ledger and, if nothing covers it, asks once in plain English: just this once, from now on for this exact scope, or no. The ledger is `standing-permissions/ledger.json` in the owner's evidence store, so every project and computer reads the same list. An entry covers a step only when it is an active standing grant, in date, an exact match, traceable to the owner's own answer with the same decision and scope, given on the date it was last reviewed and backing no other entry, and not a hard stop; only the owner's answer creates one, a "just this once" answer never covers a later step, and a standing grant counts as the fresh approval for that one step but never as current-turn approval. Hard stops (keys and credentials, force-pushes, deleting the only copy of evidence, pushes to the default branch, merges without the owner's OK, live and security changes, turning off checks, editing their own permission settings or adding allow rules to saved settings, host hard-denies, acting as the owner, and the rest of the safety floor) are one list in the safety-gates playbooks and are never offered or honoured. Each entry has a 90-day review (its `review_by` must be 90 days after its last review), unique ids, revoke by id with a revoke date, and an all-projects scope the owner can pick but is never the default or the recommendation. A grant is owner authority only: where the host still blocks, the card names the one native change the owner makes and the entry records it in `native_rule` (in Claude Code an allow rule or `autoMode.allow` entry in user settings, or narrowing the owner's own ask rule, which an allow rule never clears; in Codex the allow choice at an approval prompt), and agents never write their own permission settings by any route. Each entry keeps a copy of the card and the owner's answer beside the ledger as a record only: the original answer wins, a mismatch beyond the label swaps means the entry covers nothing, a session that can read only the copy (such as one on the owner's computer) asks the owner one restating line first, and each answer backs one entry; a revoked entry met later still names the host change to undo. The rule is in the global rules, the procedure in both safety-gates playbooks, and the Projects skill (2026-10-26.4; the owner saves it from the skill update card) uses a decision card; the project instructions block is unchanged, since it has no room and threads already read the global rules. To make room, one docs-cleanup sentence moved from the global rules into the docs-governance playbooks.

## 3.15.5

### Plain-text check

- **One portable check for plain user-facing text:** `skills/secure-ci-cd/scripts/plain-text-check.cjs` fails when a user-facing doc carries a link to one GitHub issue, pull request, discussion, commit or comparison, a hash-number reference or a "PR" or "issue" number label, or one of the repository's own shorthand codes listed as banned terms in `.github/plain-text.json`. Each banned term carries its reason and the plain wording to use, and a banned term can also catch a lowercase letter after its digits. Reviewed exemptions show in the diff: text kept per file with a reason (a stored job name, a heading level, a score), and a line marker `plain-text: allow <reason>` with a real reason, which covers only a `#number` on that line. Whole same-file links to numbered headings and `issues/new` links pass. Structured files are checked on their names, titles, descriptions and prompts only. Items already there sit in a baseline written once that only shrinks. It points; it never rewrites text. `--files` checks named files only.
- **Installer and CI template:** `install-plain-text-check.cjs` copies the check into `.github/scripts/` with a version and hash header, writes the settings and starting baseline only when missing, adds `templates/github-actions/plain-text.yml` with `--workflow` (read-only permissions, pinned actions) and reports drift with `--check`. It refuses to replace a repository's own file at the copy path.
- **On in every governed repository:** `repository-agent-rules` installs the check with a governed repository's materials and offers it elsewhere next to the personal-data guard; a refresh re-checks it. `toolkit governance check` reports a governed repository without the check, or with an outdated or edited copy, as drift; a repository switches it off only with a recorded reason.
- **Startup note for outdated checks:** in a repository whose Toolkit GitHub governance is on, the session-start rules check also compares its vendored Toolkit checks (the plain-text check and the personal-data guard) with the running Toolkit, notes a missing plain-text check unless it was switched off with a reason, and prints one read-only note per finding.
- **Toolkit runs the same check:** `repo/scripts/check-plain-references.cjs` now runs the portable check with Toolkit's settings in `repo/contracts/plain-references/config.json`, which bans Toolkit's own release, lane, record and test-row codes across skills, docs, contracts and the readable fields of JSON and YAML files.
- **Whole-repository sweep:** the remaining issue references and codes in docs, skills, contracts, setup questions, helper titles and plugin blurbs were rewritten in plain words, so the baseline is empty. The delivery contract is now `repo/docs/TOOLKIT-DELIVERY.md`. The setup topology choice reads "Toolkit repos: main session + Toolkit planning and build helpers only. Elsewhere: one layer of subagents."
- **Chat replies count:** the global plain-language rule now names chat replies among the human-facing work it covers.

## 3.15.4 (final-product UAT)

### Coding gates

- **Owner UAT tests only the final product:** the owner is asked to try only features the user runs and sees, such as hook setup in Codex or Claude Code, a quote run or a design run. Internals (governance, programme state, gate plumbing) are proven by CI, tests, G2 and agent UAT; with no final-product step, UAT is not required. Each ask says in plain words what the feature does, the one thing to try and what the owner should see.
- **Device steps stay with the agent:** a step on the user's computer that an agent there can do, such as creating a local scheduled task, is done by the Remote Control session itself; the user is asked only when a safety check blocks it.

### Projects skill

- Owner UAT lists and the hybrid work list follow the two rules above; Toolkit text says "computer" or "Remote Control session" rather than naming one kind of device. The Claude Projects controller skill is 2026-10-26.3 (save the new skill card).

## 3.15.3

### Projects skill

- **Running post and links enforced:** a new Toolkit hook runs before every Claude Projects post, in the coordinator and in work threads. It refuses a fresh post while the owner has not written since that session's newest post (unless that post nears 8 KB) and tells it to edit that post instead, and it refuses any post that names "PR <n>" without a link. It reads the session's own transcript, so the rule survives a context reset. Replies under a post are exempt from the fresh-post check but still need their links, decision cards are not checked, and sessions without the Claude Projects post tools never see it. Every PR in a list needs its own link. The skill now also has the coordinator keep its running post id as the first memory line, and links every PR, thread, file or artifact it names: a PR's changed files only once it is ready for the owner to check and merge, otherwise the chat thread that owns it. Briefs tell work threads to keep one running post with one-line updates. The hourly nudge flags back-to-back posts, a stale running post id and missing links. The Claude Projects controller skill is 2026-10-26.2 (save the new skill card).

## 3.15.2

### Claude Projects

- **A card each when the account copies fall behind:** Claude Projects controller skill 2026-10-26.1 (tap Save on its card). The skill card is one Save tap. After the first card, a coordinator that can post skill cards adds the memory line `skill cards: coordinator`; from then on the check-in writes "card due" instead of posting its own card, and the coordinator posts it in the project chat, so the owner gets one card where they read. On "card failed" the coordinator posts it too when it can. No agent can update a claude.ai plugin, so when the Toolkit plugin is more than a day behind, the coordinator posts one plugin card in the project chat with two clicks in Customize > Plugins (remove the Toolkit plugin only and let it reinstall), with Check for updates and a marketplace re-add as fallbacks. A retired skill card in the chat gets a "don't save" line.
- **Plugin line on every run:** the check-in shows `**Plugin:** current` or how far behind it is, names the commit where `main` moved past the account version, and puts `PLUGIN BEHIND` on its first line once per `main` version (the "plugin behind" record in its state file).
- **No false skill drift from a short clone:** before the check-in calls an account file a direct edit, it fetches the full history of its shallow Toolkit clone and checks every revision again, so an old but unedited account copy is reported as behind, not edited. If that fetch fails, it reports drift as unverified and posts no card.

## 3.15.1 (local secret scan)

### Secure CI/CD skill

- **Local secret scan:** `skills/secure-ci-cd/scripts/local-security-scan.cjs` checks one repository on the owner's computer for committed credentials, read-only, across every tracked or unignored file and every line ever added on any branch or tag (merges against their first parent, every file as text, no line too long). It needs only Node and git, taken from an absolute PATH folder outside the scanned repository, installs nothing and sends nothing off the computer; vulnerable dependencies stay with Dependabot. The report (`--out`, outside the scanned repository) names places only (file, line, column, short commit, format), never any part of a match, an author or a commit message, and classes each finding as a release blocker or a likely false positive. `--recheck` shows what is fixed, still open or new. Exit codes: 0 clean, 1 release blocker, 2 could not scan (including a report that cannot be written), 3 incomplete (a shallow clone, or a file over 5 MB or unreadable).
- **Shared secret formats:** `skills/secure-ci-cd/scripts/secret-patterns.cjs` holds providers' published token shapes (fixed prefix, exact length, fixed characters) with no entropy guessing, finds armoured PGP and encrypted PEM private keys, skips plain placeholders and honours a same-line `secret-scan: allow <reason>` marker for matches before it. Other Toolkit secret checks reuse it.

## 3.15.0 (dependency updates)

### Dependency and security settings

- **`toolkit governance check` checks dependency and security settings:** for an ENABLED github.com repository with a programme binding it reports drift when Dependabot alerts or security updates are off, `.github/dependabot.yml` (or `.yaml`) misses a package ecosystem found in the repository, or, on a public repository, secret scanning, push protection, CodeQL (default setup, or an advanced setup in a workflow) or private vulnerability reporting is off. On a private or internal repository the paid features are required only when the owner answered on; without an answer the check reports the missing answer.
- **Safe Dependabot auto-merge:** the programme binding takes an optional `dependency_updates` (`auto_merge`: `off`, the default, or `patch-minor`; `github_actions`: `owner`, the default, or `auto-merge`). With `patch-minor`, a new workflow template turns on GitHub auto-merge, merge commit only, for Dependabot patch and minor updates, so GitHub merges once every required check passes. It uses only the built-in token, never checks out the pull request's code, acts only on pull requests to the default branch whose every commit is Dependabot's, reads the policy from the default branch, does nothing unless a ruleset requires at least one check, pins auto-merge to the head commit it checked, and never turns it on for a re-run someone else started. Major updates, minor updates from a 0.x version, updates whose maintainers changed and, by default, GitHub Actions updates get one comment for the owner and stay open. When anyone but Dependabot pushes to or re-runs the pull request, or its base branch changes, auto-merge is turned off again; when that cannot be confirmed the job fails rather than saying so. A merge made with the built-in token starts no push workflows on the base branch; they run on its next push.
- **Free settings on by default:** GitHub's free dependency and security settings are on by default for a governed repository, covered by the owner's yes to governance. The new `toolkit governance security` (agents may run it) and `toolkit governance migrate` turn them on without another question, write a `dependabot.yml` (weekly, cooldown, patch and minor grouped) and the workflow only where none exists, and read everything back. They never edit a file they did not write, never turn on CodeQL default setup over an advanced setup, write nothing when GitHub cannot be read, report a read-back that fails for any written setting as unverified (exit 2), count CodeQL as an advanced setup when a default-branch workflow that runs on its own or as a reusable workflow has init and analyze steps in one job that is not switched off, or GitHub received CodeQL results on the default branch in the last 90 days from anything but default setup (any other workflow whose text names CodeQL, other than its upload-sarif step, keeps default setup off and is reported for a hand check), leave alone a setting GitHub does not allow on the plan or under an organisation policy, and record every change with what GitHub showed before. On a private repository the update pull requests use the owner's Actions minutes.
- **Paid features are always asked, default off:** on a private repository, secret scanning, push protection and CodeQL need GitHub's paid Secret Protection and Code Security. Governance setup now asks about them every time, says they are paid, and records only the owner's own answer as `paid_security` (`off` or `on`) in the programme binding; the check reports a private repository without an answer, and nothing paid is turned on without "on". The paid answer and auto-merge are read from the binding merged on the default branch, never from the working tree, so an unmerged edit turns nothing on. The terminal `enable` question says the same.
- **This repository:** Dependabot now also covers npm, with a cooldown and grouping, and carries the auto-merge workflow; the owner gave standing permission for Dependabot patch and minor updates to merge on green (`auto_merge: patch-minor`, effective once this binding is merged), and GitHub Actions updates stay with the owner. Dependabot does not bump the auto-merge workflow's own pinned action: it moves with Toolkit's template.

## 3.14.0 (programme pages)

### Programme pages refresh without a token

- **New `refresh` command in `programme.cjs`:** the full reconcile pass with `--apply`, which any session in a governed checkout may run, executors included. It writes under the controller that holds the parent now and takes no session, patch or verdict, so every decision stays the controller's. It refuses when nobody holds the parent (`PARENT_UNHELD`).
- **After-write hook:** the plugins' after-tool hook marks a session that wrote to GitHub (connector write tools, `gh issue` or `gh pr` writes, `gh api` writes, `git push`), and the turn-end hook starts `refresh` in the background once for each governed repository it wrote for. It uses the computer's own `gh` sign-in. Codex users trust one more hook (`PostToolUse`) in `/hooks`.
- **One pass at a time per repository on a computer:** while another pass holds the lock, `refresh` queues one more pass for it and ends (a failed pass or a long burst leaves it to the next refresh or the hourly sweep), and `reconcile --apply` refuses (`PASS_RUNNING`). The lock is taken over only from an owner whose process has ended, whose lock was written before a restart the computer can tell (by its boot id on Linux, or elsewhere by an uptime lower than the lock recorded; on Windows a Fast Startup shutdown is not a restart), or who has been silent for 6 hours (a killed pass whose process id was reused). A pass that loses its lock stops before its next GitHub request, and an owner removes only its own lock.
- **Hourly sweep:** the Projects hourly nudge gains a programme step that runs `refresh` where `gh` is signed in, and Projects setup now has a local Remote Control thread create the one local sweep task on the device when the repository's GitHub governance is ENABLED and a device is named (never otherwise), because cloud threads cannot refresh the pages themselves. The sweep also catches edits made on the web.
- **Removed the token-based programme reconcile workflow** and its secret and writer-variable setup. Nothing stores a GitHub token for the programme pages.

## 3.13.8

### Now and Later

- **Two roadmap groups:** the Programme Graph's Class column shows `NOW` for work in progress (an open or draft PR, or an active, owner-waiting or held gate) and `LATER` for every other committed, unfinished task. Optional work still sorts last as `OPTIONAL`. There is no `NEXT` group: a planned release still shows on the task page but no longer moves a task.
- **Later is in priority order:** the catalogue `order` is the priority again. Inside each group rows sort by `order`, lowest first, then by child number, and native sub-issues follow. The top Later task is what starts next.
- **Start next:** the CURRENT summary ends with one **Start next** line naming the top Later task, or None. A task whose PR merged or whose issue closed is skipped, even before its state catches up.
- **Ties are named:** a reconcile finding `ORDER_TIE` lists queued tasks in one group that share an `order`, so the controller can set a distinct priority with `update-parent`. While older classes are still reported, migrate first, or set COMMITTED and the priority in one patch.
- **Older classes:** the CORE, HARDENING and LATER migration patch renumbers `order` in the old sequence, which becomes the priority. Before migration their old per-class numbers tie, so a pass may reorder them.
- **Rules text:** the governed rules order work Now, then Later by priority; Toolkit V3, CONTROLLER.md and the reconciler skill say the same.

## 3.13.7

### Programme pages

- **Generated parts first:** the parent page reads the CURRENT summary, then the Programme Graph directly under it, then the controller's hand-written notes and everything else, with the comment trace last. A task page reads its links, title and status block, then its direction note and everything else, with the comment trace last. PR pages are unchanged. A block found anywhere else, higher or lower, moves to its place once; hand-written text is never edited, only moved past, and a hand-kept index the graph replaces is removed in the same pass.
- **Comment links open the comment:** every link the reconciler writes is the comment's full address. The old short links only worked when the comment was already on the page, so on a long issue, or in the GitHub mobile app, they opened the top of the issue instead.
- **Shorter CURRENT summary:** it lists only the work in progress, each with its gate, PR, anything waiting on the owner and next step. Queued work shows in the graph.
- **Graph columns and order:** the columns are Task, Task Description, Child #, PR #, Class and Status. The gate a task is in shows in CURRENT and on its own page. Inside each class, in-progress rows come before queued ones, then rows go by child number; native sub-issues follow the same order.
- **The catalogue `order` no longer sets a position:** rows and native sub-issues sort by class, status and child number, so the first pass after updating may reorder sub-issues, including tasks still on the older CORE, HARDENING and LATER classes. The older-class migration patch still works and moves nothing itself.
- **Older copies hold instead of flipping a page:** a copy of the reconciler that finds a page written by a newer Toolkit leaves it alone and says to update Toolkit on that computer, so two computers on different versions never swap a page between layouts.
- **Joins keep your formatting:** when a block moves, only blank lines are trimmed where text is joined, so a two-space line break or an indented code line next to it is kept. A replaced hand-kept section now ends at the next managed block too, so it never takes the comment trace or the text after it with it. The comment trace is added at the end of a page once and then stays where it is.
- **One line per topic:** the comment trace lists each topic on one line, every comment as a link named by its comment ID, with "(replaced by ...)" after a replaced record. A topic is the task's name as the graph shows it, or a short subject for a programme-wide comment, and may now contain spaces. On a task page, comments without a topic fall under the task's own name; on the parent they fall under "Other comments", as before. A task name containing `&` or another escaped character stays one topic. When a page fills up, a topic's links move into one index comment and the line shrinks to a link to it. The trace audit accepts "replaced by" or "superseded by" right after a link.

## 3.13.6 (repository protection)

### Default-branch protection

- **`toolkit governance check` checks the default branch:** for an ENABLED github.com repository with a programme binding, it reports drift unless the default branch requires exactly the binding's `required_checks` (rulesets and classic branch protection together), each pinned to an app; exactly one workflow job produces each check; that job's workflow runs on every pull request to the default branch (no path filter, no branch filter that leaves it out); its job condition is absent or exactly `always()` or `!cancelled()`; a job that waits for others has a step whose result is the declared aggregate command's (plain node command lines ending with `node repo/scripts/run-tests.cjs --verify-ci`, `TEST_LEGS: ${{ toJSON(needs) }}`, no step condition, `continue-on-error`, custom shell or working directory); and only merge commits are allowed. The workflow reader is default-deny: a workflow with any line outside a plain YAML subset (printable ASCII on every line, comments included; block scalars only for `run`, `if`, `shell` and `continue-on-error`; no anchors, tags, explicit keys, flow mappings, continued values, misplaced indents, duplicate keys, tabs, control characters, Unicode line breaks, non-ASCII spaces, lone carriage returns or second documents) is unverified, and a job name written as a YAML null counts as no name. A waiting job without such a step, a job named by an expression that could produce the check, or anything GitHub would not show leaves protection unverified, never conformant, and the first line counts unverified items. `--offline` still checks the workflow files.
- **`toolkit governance migrate` offers the fix:** after its own typed yes it creates or updates one ruleset named "Toolkit: protected default branch" (the default branch, a pull request for every change, the binding's checks pinned to GitHub Actions, merge commits only, no bypass; an update replaces that ruleset's rules) where a binding check is not required or squash or rebase merges are allowed. Workflow problems are shown before the question, and a repository where no job produces a binding check, or its workflow skips pull requests to the default branch, is not offered the ruleset, since it would block those merges. It never edits a ruleset or branch protection it did not create; what its own ruleset cannot fix is listed to change by hand, and a refused write is reported once, not retried.

### Removed

- **Old CI Gate machinery:** the unused trusted-CI repository protection scripts, contracts, templates, fixtures and tests are gone, and so is the rule that every edit to the Validate workflow had to rewrite a pinned blob.
- **Control-plane kernel:** removed with its contracts and tests. The capability registry stays, because it is the per-computer governance store; the kernel's one used part, the remote-identity check, now lives in the registry under the same contract name, so identities already stored keep their keys.

## 3.13.5

### Projects skill

- **Daily check-in posts the skill update card:** when the account copy of the Projects skill is an older Toolkit revision, the check-in posts the update card in its own thread, once per Version, so the owner only taps Save. It never posts one over direct account edits. The coordinator lists the Save tap on the owner's pending list and keeps the card's thread open until the owner saves, releasing older cards once a newer one is posted, the owner declines, or the copy drifts. When the card cannot be posted, the old re-upload note stays.

## 3.13.4

### Projects skill

- **Pending lists name every owner-hands step:** whenever the coordinator tells the owner what waits on them, it lists every step only the owner can do, optional ones and ones posted only inside a thread included, each with its link. The hourly nudge's **Waiting on owner:** list now carries those steps too, so its live task prompt is swapped after merge. The Claude Projects controller skill is 2026-10-25.7 (re-upload it).

## 3.13.3

### Workspace and temp hygiene

- **Test runs leave nothing behind:** every test file that left temp folders behind now removes them after its tests, also when they fail, and the test runner fails a run whose tests left anything in its temp folder, naming each item; anything a test leaves outside that folder is not checked. Before, the runner quietly removed dozens of leftovers per CI shard, and a test file run on its own with plain `node --test` wrote them into your real temp folder.
- **The stale sweep deletes only its own folders:** each run folder now carries a marker file, and the next run removes a folder an interrupted run left only when it carries that marker and is more than a day old. A `run-*` folder without the marker, such as one you or another tool made in the same temp root, is reported and left alone, and a link is never followed.
- **One place for worktrees:** worktrees an agent makes go in the repository's ignored `.tmp/worktrees/<lane>-<gate>-<sha>`, so two gates of one lane never share a path; worktrees Claude Code or Codex make stay where the host puts them. Gate sessions use the primary checkout unless they need their own worktree, which then starts at the exact admitted commit with its HEAD recorded. After a lane's PR merges, the controller removes the lane's worktree with `git worktree remove` and `git worktree prune`, and deletes its local branch with `git branch -d` only once the branch is in the default branch, never with `--force` or `-D`. A worktree that is dirty, locked, unmerged or holds ignored files (such as kept evidence in `.tmp/` or a `.env`, which `git worktree remove` would delete), and the branch of a PR closed unmerged, are reported and kept.
- **Leftover report:** `node repo/scripts/workspace-residue-report.cjs [--repo <checkout>] [--base <ref>] [--json]` lists a checkout's extra worktrees and local branches as ready to remove or look first (uncommitted changes, ignored files, locked, folder gone, not merged, host-made, default branch), with the commands to run. Paths are shown relative to the checkout. It only reads git state, reads no file contents itself and changes nothing.

## 3.13.2

### Source watch

- **Notifier works under the no-force-push rule:** the notice branch only grows. A changed report becomes one new report-only commit on top of the branch, pushed without force, so the scheduled run no longer fails when the report changes. A branch in any other shape is refused and nothing is pushed, instead of being overwritten.
- **Notice closes itself:** when nothing is left to review, the notifier closes the one notice pull request it opened, unmerged, with a short comment. It keeps the branch and never closes a pull request anyone else opened.
- **Trackers shown as history:** reports call a cursor's tracker the tracker at last review, so a closed task is never shown as the current owner.
- **Host drift review recorded:** the first Codex and Claude Code drift review is recorded, with findings routed to their owners and no Toolkit component changed. Its evidence links point at the current Codex and Claude Code docs.
- **design.md upstream reviewed:** the latest upstream change lets design tokens also sit in YAML blocks inside each section. No Toolkit code reads or writes those tokens; the design.md reference is left for its separate refresh.

## 3.13.1

### Gate rules: no-weakening review checks

- **No-weakening proof:** when a change touches detection or guard code, G2 compares head against base, runs the base tests and fixtures against the head, and requires a reason for every case that was blocked or flagged before and is now allowed.
- **Early returns keep the guards:** every early return, skip or fast path in changed code must show that the generic guards still run first or are provably not needed, with a test for the return path.

## 3.13.0

### Now, Next and Later

- **The roadmap groups come from the release:** the Programme Graph's Class column is worked out from each task, never set by hand: `NOW` when it is in progress (an open or draft PR, or an active gate, including merged work still waiting on UAT or review), `NEXT` when it is queued with a planned release (by convention a name, not a version number), `LATER` when it is committed with no release, and `OPTIONAL` for an optional task with no release. Rows and native sub-issues sort in that order, then completed and retired work as before, so a task moves up when its release is set or its PR opens. Finished rows show `-` in the Class column.
- **The catalogue keeps only what the owner decides:** an outcome's class is `COMMITTED`, `OPTIONAL`, `COMPLETED` or `RETIRED`. The older `CORE`, `HARDENING` and `LATER` still read as `COMMITTED` and keep their old CORE, HARDENING, LATER sequence, so reconciling before the migration moves nothing. Each reconcile reports `CLASS_LEGACY` with a patch; applying it whole with `update-parent` sets `COMMITTED` and renumbers `order` in that sequence, so the migration moves nothing either. No write adds an older class, and `init-parent` refuses them. The CURRENT summary's queued list is now headed **Queued**.
- **Hardening is gone:** the rules order work Now, then Next, then Later. A G2 finding that adds protection without breaking acceptance is a follow-up that joins an existing or new outcome, whose release makes it Next or Later; ship blocker, Later or optional, and unsupported or duplicate are unchanged.

## 3.12.1 (n8n helper review follow-ups)

- **One live rule everywhere:** the transport module's own postcondition check now uses the same fail-closed rule as the live helpers, so a published version or a missing state never passes as unpublished.
- **Truthful messages:** preparing a new workflow says it gets no MCP exposure or error workflow, the prepared-import validator says preparation checked the setting against the target, and the helper README states the fail-closed rule and which machine check reads Docker.
- **Killed runs:** every helper file name now starts with the process id of the run that wrote it. A run that is killed before its clean-up leaves its stored live workflow list behind until the next run starts, and that run deletes the helper files of any run that is no longer running. A file is kept only while a process with its id is running and started before the file was written, so a process id reused by a later process does not keep a killed run's list. The clean-up touches only the helpers' own file names, and nothing when the list folder or `.tmp` is a link; the helpers also refuse to store the list when either is a link.

## 3.12.0 (server operations)

### External operation preflight

- **New skill `external-operation-preflight`:** it checks a live change on an outside system before the owner approves it. Its offline checker, `scripts/preflight-check.cjs`, reads one JSON operation plan and returns ALLOW, ALLOW_WITH_NOTICE or HOLD with typed reasons and a plan hash the approval covers. It holds when a name and the provider disagree about an environment, when a binding crosses environments or one store is writable from two, when a temporary resource lacks a cleanup owner or end date, when an action has no authority entry or contradictory ones, when a merge would auto-deploy without an approved deployment or a read-back trigger pause, when a fallback route changes target, privilege, credential or effect, and when a plan that touches production anywhere (including a store reached through an owner exception) has no rollback plan naming the operation's environment or no backup evidence at the retrievable level. Matching whole words in the name, any environment that is not plainly non-production (alpha, staging, dev, qa and similar) counts as production, so `main` or `prd` do too; names with the whole word test, testing, preview, restore or drill must be temporary. A missing or malformed field holds the plan rather than being read as no restriction. It never calls a provider or reads credentials. The skill also owns the backup and restore evidence contract: production only by default, seven local copies, and separate evidence for configured, uploaded, retrievable and restored. Plain owner-managed SSH stays the default; no SSH broker is built.

### Host observability

- **New skill `host-observability`:** one read-only monitor per Linux host, assuming the provider offers none. An hourly pulse reads CPU load, memory, swap, out-of-memory kills, disk and inodes, uptime and reboots, failed systemd units, Docker container state and optional health URLs, and gives the host one of five states: `NORMAL`, `REVIEW_CAPACITY`, `UPGRADE_OR_REBALANCE_REQUIRED`, `EMERGENCY_PRESSURE` or `OBSERVABILITY_DEGRADED`. Thresholds are per-host settings; load counts only when sustained, and fast disk growth needs a review. A pulse older than 60 minutes, a failed collector, a missing tool, a failed alert delivery, or missing alerting or heartbeat is degraded, never healthy.
- **Off-host heartbeat and alerts, with no default:** the pulse pings an owner-chosen dead-man's-switch URL every run, so the host is never the only witness to its own uptime. The skill asks the owner how alerts and the heartbeat should reach them and suggests options (Slack, Discord, ntfy, Telegram, email, any webhook; a hosted or self-hosted heartbeat service). Alerts go out on a change, at once on emergency pressure, on a reboot, and again after a failed delivery, which is never recorded as sent.
- **Installer:** installs the hourly timer only when run with `--install` (or removes it with `--remove`) and otherwise prints its plan; it refuses without Linux and systemd, puts back what was there if an install fails, keeps an existing env file (tightened to mode 600), and keeps one backup of replaced files. The service runs as `host-pulse`, an unprivileged system user with no login that the installer creates and `--remove` deletes, with no capabilities, a read-only view of the system and one writable state folder. Docker checks are opt-in with `--with-docker`, and the plan says plainly that Docker socket access equals root on the host. Two test units send a test alert and a test heartbeat with the same env file and sandbox. Explicit-only skill; installing it on a host needs the owner's approval for that host.

## 3.11.0

### Rules audit: leaner always-loaded rules

- **Risk tiers pick the checking:** `node repo/scripts/toolkit-risk-tier.cjs` matches the changed paths against `.github/toolkit-risk-tiers.json` and prints RISKY, NORMAL or LIGHT; a mixed change takes its highest tier, and a change that only bumps the product version is LIGHT. RISKY work (governance and helper hooks, setup, the bridge, installers, home-folder and app-config writes, the rules themselves, toolkit-env, cleanup code) gets agent UAT, owner UAT for any owner-hands steps and a full G2; NORMAL work (tests, developer tools and other code outside the RISKY paths) gets one independent review; LIGHT work (docs and wording) gets the builder's own diff read. G0 still runs for every new task, repository or environment; only LIGHT edits and fixes inside an already-discovered task skip it. Every tier runs tests and CI.
- **Risk tiers hold their ground:** only a product version bump counts as LIGHT, and on a risky path only a JSON `"version"` key or a managed-block marker's `toolkit=` value (a `version` constant counts only outside the risky paths); a behaviour setting such as a minimum version keeps the path's tier. Risky patterns ignore letter case, so a path typed in another case on Windows stays RISKY; a `!` entry matches its one file exactly, so a new file that differs only in case stays RISKY. RISKY now follows one rule instead of a file list: everything setup, the bridge, a hook or an installer runs or copies out, everything a workflow with a write token or secret runs, the data files RISKY code names by path, and instructions, governance and host config. Script folders are RISKY as a whole, so a new script starts RISKY; a `!` entry takes one named developer tool or read-only CI step back out of a script folder (never a wildcard, a bare name, a workflow, an instruction or a data file), and a test fails if any RISKY file reaches one through `require`, a `path.join` or `path.resolve` with literal parts, or a repository path written in its code, hook commands or workflow steps (from its own folder, the repository root, a `$VAR/` or `$PSScriptRoot` prefix, or a folder a shell line moves into). A workflow without a `permissions:` key counts as holding a write token. That test cannot follow a path built only at run time, a folder a script lists, or commands named inside data files, which is why the folders default to RISKY.
- **Version bumps read from git:** a bump counts as LIGHT only when each removed line pairs with an added line that differs only in the version, marker names with a dot (such as the Antigravity bootstrap) included. Reading from git, a path keeps the tier the list at the merge base gave it (or the built-in list when there was none), so a change cannot lower its own tier by editing or adding the list. Only lines inside hunks count, each removed line must pair with the added line at the same place (a moved line is never a bump), paths are read literally and unquoted, and a typed path is tidied first (`./`, `..`, doubled slashes, a trailing space or dot). A typed absolute path inside the checkout is read relative to its top, and `--repo` with a subfolder still reads the list at the top.
- **Delegation by default:** G0 still delegates suitable separable evidence gathering and G1 suitable independent implementation or validation, skipping it for trivial or inseparable work; outside gates, delegate when it saves context or wall time.
- **Windows installed-mode qualification:** Claude Code 2.1.310 on Windows with the installed 3.10.0 plugin passed 42 of 43 helper cases, A14 being the recorded limit; the install check's Helper routes line names this run.
- **Qualification rules kept:** V3 still says a fail-open host needs an enforceable launcher, an unenforceable helper path is unqualified, host PASS needs route, wrong-route and failure proof, and stale copies go only after the new version is proved.
- **Gate rules on demand:** the gate mechanics (fresh contexts, recoverable work, design policy, UAT, review, delta reviews and route proof) moved out of the global rules into `repo/contracts/agent-rules/gate-rules.md`, which gate sessions read before starting. The global block is about a fifth smaller, and with a typical hand-written user file, the global block and this repository's `AGENTS.md` together come to just over Codex's default 32 KiB limit, so setup's offer to raise the limit is needed for the whole of this repository's `AGENTS.md` to load.
- **No handover packets:** state lives in the branch, the PR or brief, the programme comments or the evidence store, so a controller or executor can be switched at any time. Generic rules never rely on chat or host memory.
- **Route proof reads the host's record:** pin model and effort in the launch command or config and read the host's own launch record once; a host that keeps none is recorded as not checkable. A model's self-report proves nothing.
- **No dollar caps:** failure budgets count attempts, never dollars.
- **Evidence without ritual:** in a Git evidence store the commit is the manifest and a push plus one fetch is the read-back. Archive once, at gate end, and keep run streams only for a FAIL or a disputed verdict. The expiry clock, pins and cleanup ledger are gone: scratch is deleted once its report and kept evidence are stored and read back.
- **Decision traces:** only decision comments (a tag or record ID) must be linked from the programme issue; other comments need no index entry.
- **One home per rule:** the takeover record lives in `CONTROLLER.md`, the issue rules in the governed block, and the finish rule in the global Shipping section. Full SHAs appear only in review verdicts, UAT results and merge summaries. One PR bumps the version once, and its body is refreshed when scope changes and once before asking to merge.
- **Toolkit V3:** the contract is now a short statement of current law; the dated decisions and one-off evaluations that produced it stay in git history.
- **Promise checker removed:** the promise list is a plain list in project memory, read by the hourly nudge; `toolkit-promise-check.cjs` and its fenced block are gone.

### Claude Projects

- **One running post:** after your last message, the Projects coordinator keeps all its output in one post that it edits, appending each new result, PR or question and keeping every earlier detail. The running post is always its newest top-level post, including the note it posts when it starts a thread, and before every edit it checks whether you have written in the main project chat since; if you have, it posts fresh. Each appended update starts with its local time, such as **[16:41] Update:**. It also starts a fresh post when the running post nears about 8 KB; its reply to a message you write inside a thread is appended to the running post. When you reply under one of its earlier posts, it answers in the main project chat with a fresh post starting "Re: your reply on" and a short topic, and never edits the older post. It still answers a burst of your messages in one post. The Projects skill and the managed project instructions block say the same.
- **Skill split:** guided setup, the instructions sync and the recurring-task procedures moved into `reference/` files beside the Projects skill, which is now 2026-10-25.3. Upload the skill together with its reference files.
- **Cheaper nudge:** the hourly nudge checks first whether anything moved since its last run and stops early when nothing did; it runs in waking hours on a small model. The binding check runs only in the daily check-in.
- **Every Toolkit scheduled task has a home thread:** the daily check-in is now bound to its own home thread like the hourly nudge, and that thread carries the task's model and effort. A fresh session per run is only the fallback, and every swap tries bound first (`--refresh` now needs `--session` for these tasks, so a swap always sets the session its replacement runs in), so a check-in set up fresh before this release moves to its own home thread on its next swap. The check-in reports a task whose prompt was rendered for a different session than its entry says. A home thread is never resolved; only a fresh-session run resolves its own run thread. The hourly nudge also reports the check-in as not armed when its home thread is resolved.
- **Feedback intake:** record only rejections and downgrades, one line each with the reason.
- **Skill drift in the daily check-in:** the check-in now compares the account copy of the Projects skill and its reference files with every Toolkit revision. A copy that matches an older revision reports `SKILL BEHIND`; one that matches none is saved and reports `SKILL DRIFT`, so direct edits come into Toolkit before anyone re-uploads. A separate drift task is no longer needed.
- **Loud check-in, silent nudge:** the coordinator posts the check-in's first line to the owner every run, so a missing day shows. The hourly nudge never posts in its home thread except to report a failed delivery, and asks for its own rebuild once a week.
- **Stopped tasks stay stopped:** when you stop the check-in or the nudge, its `SCHEDULED TASKS:` entry is marked `stopped by owner`. The project's own checks then never report it missing, outdated or due a rebuild, and nothing swaps or recreates it until you ask. The Toolkit project's watch over other projects may mention it once, and that project's coordinator leaves it stopped. Every automatic path follows one rule: a stopped task is never re-armed, updated, swapped, rebuilt or recreated, and restarting it removes the mark. A test checks every line in the skill folder that uses one of those verbs, whatever it calls the task.
- **Deleted tasks come back:** the check-in and the nudge each report the other as missing, and the coordinator recreates it from the template on `main` the same turn, unless you stopped it. If both are gone, the coordinator's once-a-day `list_triggers` check starts a cloud thread that recreates them and tells the owner once. Task runs stay read-only.
- **The Toolkit project watches the others:** its daily check-in reuses the same `list_triggers` read to spot any other Claude project missing its check-in or nudge, and reports it as one `PROJECT TASKS MISSING` line. It never recreates another project's tasks; that project's coordinator does on its next wake, unless its owner stopped them.

### Governance question

- **A locked session mark now fails safe.** The 3.10.0 notes said a mark that cannot be replaced fails safe, but a mark that could be neither replaced nor removed (a file another process held open, or a read-only folder) still let a resumed or continued run answer. Now the repository's mark is handled even when the session's cannot be, and when an old mark stays in place, the held messages and "later" answers that carry it lose their marks, so the question is asked again. Only if the held-messages file is locked too can the old run still answer, which is part of the speed-bump limit. This touches only a question still waiting for your answer: once you answer yes or no, that repository is not asked again on that computer, in any session.
- **Replayed messages from a resumed run are flagged.** The session mark now records whether a run was a resume or a fork. When any held message came from such a run, the messages handed over after your answer carry the "confirm with the user first" wording, whatever order they came in.
- **No more copy of the state in your folders.** Toolkit no longer writes `.ai-agent-toolkit/governance.json` into repositories or plain folders. Your answers stay where they always decided things, in the user-state files on your computer, and yes, no and later work as before. A copy an earlier version left behind is read by nothing and never changed; if you want it gone, ask your agent to delete it; it asks you first.
- **Every hold says never to act as the user.** The question, the not-on-github.com notice, the no-mark and resumed notices, and both hosts' "governance check failed" texts now end with the never-act line, so an agent that started the run itself and reads the hold is told not to answer it.

### Global rules

- **Delivery no longer assumes GitHub.** Commit, push and open-a-PR now apply to a git repository with a remote; elsewhere the agent just reports its changes. `gh pr checks` and `gh run watch` are named as the GitHub way to check CI, and a full local test run is the gate where there is no CI.
- **Offer to clean up after a merge.** After a merge, the agent offers to delete the branches of closed unmerged PRs that are not default, protected or in use. Deleting still needs your yes.
- **Kept run streams are evidence.** Deleting scratch needs no approval once its report and any evidence kept are stored and read back, and the agent then deletes it. A run stream or log is kept only for a FAIL or a disputed verdict; for a PASS the report and its cost line are enough. `CONTROLLER.md` and the Projects instructions block say the same, so a kept stream is not deleted before its archive is read back.
- Repeated lines were folded into the rules they repeated, to stay within the size budget.

### Helpers and hosts

- **The bridge doc no longer says the hooks decide the same way in and outside gate work:** a G2 session launches no helper, and a launcher-bound session is checked against its binding. A Codex test now pins the full "only the main session launches helpers" refusal, as the Claude Code test does. `CONTROLLER.md` now says subagents are helpers, never gates, without limiting helpers to gate work.
- **Helper hand check:** the bridge doc suggests "Launch a toolkit-g0-helper to list the top-level folders of this checkout. Stay on the current branch.", since naming another branch makes agents try to switch first.
- **Codex size line:** setup's "Codex instructions" line now counts the `AGENTS.md` of the repository you are in, and 0 bytes when it has none, instead of falling back to the Toolkit checkout's own file.

### Claude Code qualification runner

- **Rows A14 and A16 are unit-tested.** A16 now also requires a successful result, run records where the runner reads them, and the lead on its route, so a held, signed-out or unrecorded run no longer passes. Both row checks are tested with stub run summaries.
- **The runner cleans up the config file it creates.** With `CLAUDE_CONFIG_DIR` set, Claude Code keeps its global config in `<config>/.claude.json`; a file the live runs created there is now removed at the end. The runner notes that macOS is not supported.

### Owner UAT

- **Owner UAT is narrowed:** it holds only steps that need the owner's own hands, such as real app UI, signed-in accounts and device behaviour CI cannot reach. CI (Windows runners included), automated tests and G2 review prove everything else, and each UAT list names the passing check for every step it leaves out. When nothing needs the owner's hands, UAT is recorded as not required.
- **Where it lives:** the Coding Gates in the global rules, the issue-closing rule in the governed block ("any owner UAT"), the controller's admission rule, the V3 direction and one Projects skill line for UAT lists. The Claude Projects controller skill is 2026-10-25.3 (re-upload it). Duplicated sentences in the global rules and the controller file were trimmed to keep both inside their size budgets.

### Plain-English skill text

- **Skill descriptions and Codex cards in plain words:** `controller-bootstrap`, `github-program-reconciler`, `skill-product-review`, `n8n-workflow-transport` and `n8n-environment-setup` no longer show internal programme codes or Toolkit shorthand in the text hosts show in skill lists. Gate names stay, explained in brackets, for example "a planning, build or review session (G0, G1 or G2)". The controller-bootstrap and reconciler READMEs follow.
- **No more label exception:** the readable-text test no longer allows an unexplained programme code in any skill description.

### CI checks

- **The CI drift guard pins the whole of `validate.yml`:** the file must match its pinned text everywhere except the gate command list, including the final `validate` job, comments and anything before the jobs. Each gate command must be a plain repository script line with no shell syntax, and the usual spellings of `set +e`, `|| echo` and a `shell:` key are refused as a second check.
- **No test file is skipped silently:** a `.test.cjs` entry in `repo/tests` with a name outside the allowed pattern, or a folder or link named like a test, now fails every runner mode instead of never running.

## 3.10.2 (n8n helpers that work on any machine, and n8n 2.x publish state)

### n8n import and export helpers on any machine

- **Reading n8n's output:** n8n prints `export:workflow` through its own log, so a container set to a quieter log level, file-only logs or JSON log lines hid or wrapped the workflow list, and an empty list was read as "no workflows". The helpers now pin the log settings for that one call, read the list with Node while tolerating warning lines around it, and treat an empty list from a successful command as an error. The stored copy of the list is deleted when the run finishes or fails.
- **No PowerShell rewrites of workflow JSON:** PowerShell 6 and later turned date-like strings into dates and wrote them back in the machine's time zone, and every edition refused keys that differ only by case. Workflow JSON is now read and written only by Node (`n8n-cli-workflow-json.cjs`); PowerShell sees small summaries.
- **Container detection:** the official image is found from Docker Hub or `docker.n8n.io` under any tag or digest, not only `n8nio/n8n` and `n8nio/n8n:stable`. Images from other registries still need an explicit target.
- **One complete helper set:** `n8n-helper-set.json` stamps every helper file with a content hash that ignores line endings. The live helpers check it first and name any missing or changed file; repository-local scripts are reported and kept. `n8n-helper-set.cjs refresh` previews and then copies a new set into a repository without deleting anything, and keeps a repository's own edited helper README.
- **Check this machine:** `check-n8n-helper-machine.cjs` (menu option 10) reports Node.js, PowerShell, the helper set, Docker, the n8n container, its version and its log settings, with one next step. It is read-only, and `--offline` skips Docker.
- **No restart:** the helpers still never restart n8n; a restart prompt from older copies stays out of the set.

### n8n 2.x publish state and instance-only settings

- **Live unless clearly unpublished:** a workflow counts as unpublished only when `active` is false and no published version (`activeVersionId`) is set; a missing or unexpected state counts as live. The import postcondition, the published-target block and the validator all use this, and helper output says "unpublished" and "publish".
- **Instance-only settings:** canonical Git leaves out `settings.errorWorkflow` and `settings.availableInMCP` and says so. An import replaces the whole workflow, so a prepared import carries the target's own values for both (none for a new workflow), keeping its MCP exposure and error workflow as they were; preparation refuses any other value. The validator warns about either in committed files. Newer live-only fields (`activeVersion`, `parentFolder`, `parentFolderId`, `sourceWorkflowId`) are stripped too.
- **Risky-node report:** the validator lists Code, Execute Command, Read/Write Files, HTTP Request and credentialed nodes per workflow before any test or run, including their AI-agent tool variants; `--fail-on-risky-nodes` makes it fail.
- **Adapter installer:** in the canonical Toolkit source repository it reports that no n8n adapter is needed and writes nothing.
## 3.10.0 (host support, governance states, decision history and the personal-data guard)

### Decision history before planning

- **Comment tags:** a decision comment starts with its tag on the first line, then a `---` line. Each tag is its own list, and within a tag the latest comment wins; untagged comments go under "Other comments". One parser, `decision-tags.cjs`, is shared by the reconciler and the new history reader.
- **G0 reads the history first:** before planning a programme child, G0 runs the read-only `decision-history.cjs`. It reads the parent's and the child's comment traces separately, takes the latest comment per tag as live, and marks earlier ones as replaced (by an explicit `SUPERSEDES=`, by inference, or confirmed by the owner). It lists the untagged comments to read and prints a short live-scope summary with exact counts. It writes nothing: only the appointed controller writes programme state.
- **The owner confirms before it is the spec:** the summary becomes the child's spec only after the owner confirms it. The controller records that as a `SCOPE-CONFIRMED` comment on the child, and each correction is its own tagged comment.
- **Enablement backfill:** when governance is first enabled, the first reconcile pass writes every trace, and `decision-history.cjs --programme` reports each issue's coverage for the owner. An existing crawl can be read with `--ledger`.
- **Rules:** the governed Decision traces rule, a new portable decision-trace playbook routed from both playbook indexes, one Projects skill brief line and one `CONTROLLER.md` clause.

### Governance states

- **What is always on, and what is per folder:** wherever the plugin is installed, the global rules apply in every folder: the coding gates (G0, G1, G2), subagent limits, routes, safety rules and the portable skills. The coding gates, delegation and routes moved from the governed block into the global rules for this. GitHub governance is the part switched per folder: parent and child issues for programme tracking, records and decision traces, a private evidence store, the governed rules block and the no-force-push ruleset. A repository's own `AGENTS.md`, `CLAUDE.md` and `GEMINI.md` are changed only when it is ENABLED; only the user-level global files are the plugin's to write. Controllers stay a Toolkit default anywhere the owner appoints one; their GitHub records (CURRENT, takeover records, issue intake) apply only when ENABLED. The Claude Projects controller skill is 2026-10-24.3 (re-upload it).
- **Three kinds of folder, one function (`toolkit-governance-state.cjs`):** a folder without git is DISABLED automatically and never asked, and Toolkit records that in the folder's own `.ai-agent-toolkit/governance.json` (never at a drive root, in the home folder, or in the Desktop, Documents or Downloads folders themselves). A git repository that is not on github.com (no origin remote, or another host such as GitLab) is held once with a notice that GitHub governance works only on github.com; you reply ok and it is recorded as DISABLED. A github.com repository asks the question below. A github.com decision is stored in your own registry on this computer, keyed by repository identity, so every clone and worktree shares one answer. HTTPS, SSH and `git@` clones of a repository map to the same identity, and decisions stored under older key forms are still read. `node <Toolkit>/repo/scripts/toolkit-governance.cjs` has `status`, `enable`, `disable` (`decline` still works as the older word), `reopen`, `check` (a read-only conformance report), `catalogue` (skills per state) and `migrate` (one pass over the repositories under the `--root` folders: it proposes enable or disable for each, enable for one carrying the governed block, writes after a typed yes, then offers missing no-force-push rulesets after a second yes).
- **Rules follow the state:** the governed rules apply only in ENABLED github.com repositories that also carry `.github/toolkit-programme.json`. Every other folder gets the global rules, gates, subagents and portable skills, and portable skills are offered while a repository is still undecided too. The programme reconciler refuses every command unless GitHub governance is ENABLED. Repository rules can ship the binding from a new template, and a governed repository is offered a no-force-push branch ruleset.
- **Hard stop until you decide:** in a github.com repository with no decision, Claude Code and Codex hold every message, and every tool that changes something, and ask "Enable Toolkit's automated GitHub tracking governance for this repository? Reply yes, no or later", listing what it does (parent and child GitHub issues, records of plans, reviews and decisions, a private evidence store, the no-force-push ruleset). Reply `yes`, `no` or `later` (`later`, or `not now`, carries on under the global rules for that session only and asks again next session); `toolkit governance enable` or `disable` also work. Held messages come back on the turn you answer, and each session gets back only the messages it sent itself. After a yes, the agent asks the setup questions in one message (evidence store, parent issue, defaults to confirm) and opens one pull request with the governed block and binding; until it lands, each new session reminds you, without holding anything. Only your answer decides: the governed block and binding in a repository are files an agent can write, so a repository that carries them is still asked once. Only the session that was shown the question can answer it, in the same run, with a short reply or the full `toolkit governance` answer: a resumed session is asked again, and so is a session's question once another session has started in that repository, so a separate process cannot answer for you. A session started from a Claude Code session's shell command, or by a Toolkit launcher, is refused in a held repository with nothing kept. An edit or command from another folder that reaches into a held repository is refused, and so is resuming a Claude Code or Codex session while a message is held for an undecided repository; held messages are dropped after seven days. These command checks read the agent's command text, so they are a speed bump, not a security boundary, and the session marks are files an agent's own shell can reach. A mark that cannot be replaced fails safe, so that run cannot answer. The global rules also say never to act as the owner: no answering owner-only questions, and no sessions, scripts, UIs or computer use to supply an answer; every governance refusal an agent sees repeats it. One process an agent feeds several messages can still answer the question it was shown; that is a known limit. When messages replayed after your answer came from more than one run of the session, the agent is told to confirm them with you first. The answer is also recorded in the repository as `.ai-agent-toolkit/governance.json`, which Toolkit keeps out of git with a `.gitignore` inside that folder; Toolkit never edits your root `.gitignore`. That copy grants nothing by itself: the hook checks it against your user-state files and rewrites it when it is missing or wrong, and a copy that cannot be written never holds a decided repository. Codex setup names all four hooks to trust in `/hooks`. Each session start says the folder's state.
- **A damaged decisions file has a way out:** when your governance decisions file cannot be read, every hold, the session line, `status` and `check` name the file, and `toolkit-governance.cjs repair` in your own terminal moves it aside (kept next to the original) after you type yes, so Toolkit can ask about each repository again.
- **github.com means github.com:** github.com, ssh.github.com and SSH aliases such as `github-work` count; a GitHub Enterprise server does not, and gets the not-on-github.com notice. The governance state, the reconciler and `migrate` share this one test.
- **Limits:** Claude Code cloud sessions are not gated, because they keep no registry. On Codex, a hook that crashes or times out lets the message through, because Codex has no fail-closed setting for hooks. Codex also runs the new hooks only after you trust them in `/hooks`.
- **Force pushes and skipped checks:** the guard that refuses them now also covers an ENABLED repository whose governed block has not landed yet.
- **Helper launches follow the state:** the helper hooks on both hosts treat a repository as governed only when its state is ENABLED with the binding, or when a Toolkit launcher started the session.
- **Who may launch a helper:** in gate work, the G0 or G1 lead; outside gate work, the main session, for a bounded task on the route its installed helper file sets, with no admission. The global rules, both helper files and both hosts' hooks now say the same thing, so a one-off request such as "launch a toolkit-g0-helper to list the top-level folders" works the same in Codex Desktop, the Codex CLI and Claude Code.

### Executor checkpoints and host contract

- **Gate assignments:** only the appointed controller writes programme state. It assigns each gate to an executor with `assign --issue <n> --role G0|G1|G2 --assignment <id>`; a live assignment refuses another one unless `--supersede --reason` interrupts it. `reopen` and `interrupt` take a reason. Executors no longer claim gates.
- **Executor checkpoints:** an assigned executor runs `bind` once with its own session ID and then writes only its own checkpoint journal in the private store: branch, head, tree, dirty flag, ahead and behind, its route read-back and any `toolkit-return` block in its final message. A new turn-end (`Stop`) hook in both plugins refreshes the journal after each turn. It returns at once for any session that has not bound, never blocks a turn, prints nothing and records failures locally. Codex asks you to trust the new hook in `/hooks`.
- **Reconcile reads journals:** the controller's `reconcile --apply --controller` moves an assigned gate to `ACTIVE` when its journal appears and to `SUBMITTED` when a return is captured. A journal from an old assignment is reported once as `STALE_ASSIGNMENT`, and two sessions on one assignment hold that child with `DUPLICATE_SESSION`.
- **Returns:** the controller records a return from a thread or chat with `return --record <id> --assignment <id>` and decides with `return --consume <id> --verdict ACCEPT|REOPEN|WAITING_OWNER`. A G1 acceptance needs a G2 review passed at the live PR head.
- **Takeover proof:** a parent takeover needs `--takeover-record <comment id>`: the tool reads back a comment on the parent issue from the same account, with a decision ID, naming the current epoch and posted after the last state write. The replaced holder is refused from then on.
- **Host contract:** `repo/docs/HOST-CONTRACT.md` and its JSON twin record what custody needs from Claude Code and Codex: session identity, the turn-end hook rules, completion modes, duplicate-launch and handover checks, and honest limits.
- **Executors stay read-only:** a session a Toolkit launcher started (a gate or a pinned helper) never writes programme state, even with `--controller`. The turn-end hook writes nothing to the store once the repository's GitHub governance is off or its setup is not finished.
- **Clearer messages:** next actions addressed to the controller name `--controller`; a write without a session says it needs this session's own ID; an unsupported store kind names the supported one; whitespace-only values are refused.

### Generated CURRENT

- **CURRENT writes itself.** The parent's status section opens with a generated summary from the programme state: what is in progress (gate, PR, next action), what waits on the owner (a decision, a UAT or a blocker) and the next five queued tasks. Hand-written notes below it are kept as they are.

### Programme page: tags, retired and links

- **Comment traces by tag.** A comment's tag is its first line when its second line is `---`. Each page lists every comment per tag, with untagged comments under "Other comments"; tags are never combined. On overflow, tag lists move out largest first, each into its own index comment that carries the tag. The parent's list and a task's list stay separate.
- **RETIRED is its own status.** Retired tasks sort in their own group below COMPLETED and no longer show as completed.
- **Parent > Child > PR links.** Every task page, and every open or draft PR for a task, opens with `Path: #<parent> > ... > #<task> > PR #<pr>`, kept current by the reconcile pass; merged and closed PRs are left alone.
- **Over-threshold pages are caught.** A page at or over the size threshold is re-planned even when nothing else changed, so its largest tag lists move out or it is held as `BODY_TOO_LARGE`.

### Projects skill and block fixes

- **Edited blocks keep only real edits.** When the project-instructions block was edited by hand, `toolkit-projects-instructions.cjs --place` now compares it with the block version its marker was written from (found in Toolkit's history by the marker's digest), so lines of an older block are no longer kept as your edits next to the new ones.
- **Projects keep themselves current.** Claude Projects controller skill 2026-10-24.2 (re-upload it; it replaces 2026-10-24.1 below). Toolkit is now the base layer of every project and the project builds on top: only text inside Toolkit markers, the Toolkit-made scheduled tasks, the format of fenced `toolkit-*` blocks and the binding and scheduled-tasks memory lines ever change. Project memory, the project's own instruction lines and its own tasks are never overwritten, and where a project line differs from the base, the project line wins. `setup-inventory.json` lists everything setup creates, how the daily check-in checks it and how it is brought current.
- **The daily check-in finds what is out of date, and the coordinator fixes it without asking.** It runs every day, weekends included, and its first line carries SKILL UPDATE, BLOCK OUTDATED, BINDING STALE or UNKNOWN, TOOLKIT CHANGED, MEMORY FORMAT, TASKS OUTDATED, NUDGE NOT ARMED and PLUGIN BEHIND. The project-instructions sync now applies itself: the coordinator saves the old instructions and reads the copy back, changes only the Toolkit block and the lines that repeat it, checks the result (restoring the copy if anything is off) and posts a note with a one-line undo. The block always sits at the top of the instructions; `toolkit-projects-instructions.cjs --check` reports `misplaced` when it does not and lists project lines that repeat block lines (`overlaps:`), and `--place` prints the instructions with the block moved to the top and every project line kept.
- **Scheduled task prompts come from Toolkit.** The daily check-in and hourly nudge are rendered by `toolkit-projects-tasks.cjs` from templates, named `<PROJECT>: Daily check-in` and `<PROJECT>: Hourly nudge`, and checked on every check-in. When Toolkit changes them, the coordinator swaps each task automatically: it saves the old one, creates the new one, test-fires it, deletes the old one only after the test run reports, and posts a note with an undo. Hand-written prompts move over once the same way, with their project-specific steps kept word for word. The project's own tasks are only reported on, and local or device tasks are never recreated or moved to the cloud. Trigger ids live only on the project's `SCHEDULED TASKS:` memory line, so recreating one task no longer means editing another.
- **The hourly nudge runs in its own home thread,** so it no longer posts a run card in project chat every hour. The home thread is never resolved, the daily check-in watches that the nudge ran in the last 65 minutes, and the thread and task are rebuilt once a week. The daily check-in stays a fresh session per run.
- **Threads close once their result is out, with no waiting period.** Threads never resolve themselves; the hourly pass resolves a thread as soon as its output is saved, its result has reached you in project chat (or you replied after it) and nothing is waiting on you. The nudge also catches results that were resolved before being relayed, and answers hidden in reply threads you closed; the coordinator posts a one-line pointer in project chat for any answer there that needs you.
- **Posts and setup.** The coordinator edits its own post only while it is still the latest message in that chat or thread, in the main project chat and reply threads alike; otherwise it posts again, answers a burst of your messages in one post, and always posts a new result, PR or question as a new post. Setup asks you for one model setting only, the coordinator's (strongest Opus, effort High). The block's attribution line keeps any attribution header the platform requires on PRs, and the binding line now records the Toolkit version.
- **Controller law no longer goes stale between launches.** Claude Projects controller skill 2026-10-24.1 (re-upload it). The coordinator keeps one binding line in project memory with the bound commit and the full `CONTROLLER.md` blob, and compares `main`'s blob with it before every launch, rebinding first when the law changed. The daily check-in and the hourly nudge now run the same check: a mismatch puts `BINDING STALE` on the report's first line, and a missing binding line or a failed read puts `BINDING UNKNOWN` there. Briefs name the bound commit and blob, and when a skill update changes what the check-in or nudge does, the coordinator updates those task prompts in the same turn. The block's law-order line now says bound by commit and blob, so the next instructions check reports the block as outdated.
- **Claude Projects controller skill 2026-10-23.18** (re-upload it). Toolkit no longer asks for feedback about Toolkit itself: the project-instructions block, the skill and the global rules drop their `TOOLKIT_FEEDBACK` rules. If you want such feedback, keep the rule in your own instructions, outside the Toolkit markers. The next instructions check reports the block as outdated, and the sync replaces it after your OK.
- **Sync dedupes and reads the settings itself.** When the block is added or replaced, the coordinator also removes the lines outside the markers that the block now fully covers and trims the repeated part of lines that partly repeat it, in the same change and under the same OK; project-specific text and anything that differs stays. Threads can't read project settings, so the coordinator reads them and runs the check itself or hands a thread the exact text.
- **Briefs name sibling PRs.** A G0 lists the open sibling PRs it checked for overlap, and the G1 brief requires a re-check against them before building.

### claude.ai account copy check

- **The Claude Code install check reports a stale claude.ai account copy of Toolkit.** The Claude desktop app runs the copy from your claude.ai account, and only claude.ai updates it (from main). Setup and each Claude Code session start now read that copy's version from the app's local plugin folder and, when it is older than the Toolkit on this computer, say so with the fix: check that Sync automatically is on for the ai-agent-toolkit marketplace in claude.ai, or remove that marketplace and add it again. Read only: Toolkit never changes the account copy, reports no ids or paths, and the notice blocks nothing.

### Programme page and state read-back

- **The Programme Graph replaces the hand-kept Programme index.** It sits below the status section (the binding's new `projection`: `replace_section` "Programme index", `after_section` "CURRENT"), and child status blocks move under the title and the current-direction note. A block at the very top moves once.
- **Seven columns, sorted by class then completion.** `Task | Child # | PR # | Class | Status | Lane | Task Description`, with classes `CORE`, `HARDENING`, `LATER` and statuses `QUEUED`, `IN PROGRESS`, `COMPLETED`, `RETIRED` (retired tasks have their own status; `OPTIONAL` shows as `LATER`; a planned task with an open PR shows as in progress). Rows sort `CORE`, `HARDENING`, `LATER`, then `COMPLETED` by completion time with the latest last; nested children sort like any row, and native sub-issues follow the same order. The catalogue gains `name` and `description`, and child state gains `completed_at` (filled once from the issue close time, or set by the controller).
- **Every body lists every comment.** A generated comment trace closes each catalogued body: one line per comment with date, record, summary and link, marked `SUPERSEDES=` or "superseded by", under the rule that the body comes first and the latest comment wins. When the body would overflow, the whole list moves into one new index comment and the body keeps its link, repeating as comments grow.
- **Trace audit and repair.** The decision-trace audit fails on a superseded record left unmarked; reconcile reports `TRACE_STALE`, `TRACE_UNLINKED` and `TRACE_SUPERSEDED_UNMARKED`; `--repair` writes lines in the same shape, plus topic tags from a decision ledger with `--ledger`.
- **Untracked PRs are flagged.** `PR_UNTRACKED` (report only) names an open PR that says `Refs #n` (or Completes, Closes, Fixes, Resolves) for an open task whose state records no PR or branch.
- **State writes read back at the commit they created.** GitHub can serve the previous version of a file on a branch read made right after a write, which stopped the first programme apply with `STATE_READBACK_MISMATCH` although the stored copy was correct. The store now reads each write back at the commit the write returned and takes the next compare-and-swap sha from the write itself.
### Setup self-update

- **Fix: setup no longer runs old code after updating itself.** When setup fast-forwards the Toolkit copy it is running from and the update changes setup's own scripts or the Toolkit version, it now stops right there, before any plugin, settings or config step, says so under `## Setup updated itself`, and asks for one more run (exit code 24). Before, the rest of the run kept using the scripts it had loaded before the update, so a just-shipped setup message could still read "diagnostics withheld". The setup skill reruns the same command straight away.

### Personal-data guard

- **Personal-data guard.** `secure-ci-cd` now ships `scripts/personal-data-guard.cjs`, a zero-dependency check for email addresses, phone numbers (with a `+` country code, or Singapore numbers written as 65 and eight digits) and WhatsApp number links. It reads file content, including the text of Word, Excel, PowerPoint and PDF files, plus file names, commit and tag messages, branch names and pull request titles and bodies, after folding Unicode spaces, dashes, zero-width and direction marks, full-width digits, and percent or HTML-entity encodings. In CI and range checks, a change cannot switch off checks for itself: the base commit's settings apply until it is merged. Only content a change introduces is checked, every commit of a range is checked, and a merge is not blamed for lines from its other parent. Output names the place, class and rule, never the value, part of it or a hash of it. Any error that stops a complete scan fails. Images, legacy Office files and archives block unless the config lists them with a reason, and every run prints what it did not scan.
- **Hooks and CI for any repository.** `scripts/install-personal-data-guard.cjs` installs it on the owner's opt-in: a copy with a managed version and hash header, the config `.github/personal-data-guard.json` (the owner chooses whether author and committer addresses are scanned; public role addresses can be allowed; other exceptions need a line-level reason marker), `pre-commit`, `commit-msg` and `pre-push` hooks in the folder git really uses (`core.hooksPath` included, an existing hook kept and run after it), and with `--workflow` a CI job that checks every pull request and every branch push. `--check` reports drift. The repository-agent-rules install offers it.
- **Toolkit checks itself.** A new `personal-data` job in `validate.yml` runs on every pull request and every push to `main`, and the `validate` job waits for it, so the existing required check covers it.
- **Privacy rules for every repository.** A new `privacy-safe-checks.md` playbook: reserved fake values in fixtures, acquisition before projection, hashing where the data lives, synthetic baselines, no echo of matched data, and how to review a range. `safety-gates.md` gains the pushed-by-mistake steps: pushed to a public repository means public, agents never force-push to hide it, and the GitHub removal route is the owner's call.
- **Agents cannot skip the checks.** In a Toolkit-governed or personal-data-guarded repository, the Claude Code and Codex hooks refuse an agent's `git commit -n` or `--no-verify`, `git push --no-verify`, and a changed `core.hooksPath` (`git -c`, `--config-env` or `git config`), including inside `bash -c` and `pwsh -Command`. A person, a script or an alias can still skip local hooks, so CI stays the backstop.
- **No force pushes from agents.** The same hooks refuse `git push --force`, `-f`, `--force-with-lease`, `--mirror` and `+refspec` in governed and guarded repositories and to evidence stores (`TRANSPORT-*` repositories). The personal-data guard's `ci` and `range` modes stop on a shallow clone instead of reading its cut-off history as a rewrite, and `safety-gates.md` says to fetch full history before concluding that history was rewritten.
- **Rules:** G2 in governed repositories scans every commit, title and body of a pull request for personal data and checks where a computation ran before accepting that data stayed in place.
- **Names-only key listing proven.** New tests show that a synthetic value stored in Windows Credential Manager never crosses the `toolkit env` listing child's output, including malformed, partial and failing answers.

### Setup fixes

- **Claude Code setup no longer asks about Codex's instruction limit.** That question is Codex-only now; Claude Code setup keeps whatever choice is stored.
- **Clearer Claude Code rows.** The plugin row says setup checks the plugin after you answer and installs or refreshes it only if needed. The settings row recommends keeping them when all four are already set, and otherwise sets only the values that are not set yet.
- **Codex sandbox.** On Codex the setup skill asks up front to run setup outside the sandbox, because setup writes the managed checkout, `~/.codex` and `~/.ai-agent-toolkit`. A git failure with exit code 128 now says to run setup outside the Codex sandbox.
- The "explain" example in the bank names question 1.2, which every bank has.
- **Codex on Windows now really stops a held message or a refused tool call.** Before, it showed a hook failure and carried on. Rerun `setup toolkit` in Codex, then trust the updated hooks in `/hooks`.

## 3.9.1 (controller sweep, promises and the Projects instructions block)

Planned as 3.7.2; numbered 3.9.1 because it ships after 3.9.0.

- **Setup prompts:** at the one-question-at-a-time prompts, typing "all recommended" applies the displayed recommendation to that question and every remaining one (Enter still takes one recommendation). When Codex's Toolkit plugin is registered to a different Toolkit copy, setup now says so, says Codex's Toolkit plugin was not changed, and prints the one command that approves the switch, instead of "diagnostics withheld". A refused Codex downgrade says which versions conflict and that Codex's Toolkit plugin was not changed. When the configured Toolkit source checkout has uncommitted changes, the update report names it, says startup updates stay skipped until it is clean, and no longer promises a retry that cannot succeed.
- **Issues close only after their PR merged and the owner's UAT passed**, with any remainder moved to a linked follow-up first (`Closes`/`Fixes` only when UAT has already passed). **User-facing text describes current behaviour only**: versions, release qualifiers and roadmap labels go in changelogs and records. Claude Projects controller skill: the owner's post format applies to every project-chat post, quick replies included; a follow-up result edits your earlier post only while it is still the latest message there, with no later message from anyone including the user, otherwise (or when the user must act) it is a new post; and the default idle window before a finished thread is resolved is 2 days. The daily check-in also compares the claude.ai account copy of the Toolkit plugin with the default branch and reports a copy more than a day behind, with the fix (remove and re-add the account marketplace with Sync automatically on).

- **Fix: Codex setup no longer breaks Codex.** "All recommended" wrote `agents.max_threads = 0` on Codex V1 (`multi_agent`), and Codex then refused to start any turn ("agents.max_concurrent_threads_per_session must be at least 1"). The recommended helper capacity is now one helper, so G0 and G1 can start helpers. On V1 Toolkit writes the helper count (Codex does not count the main thread, per its config reference) and never below 1; "no helpers" is not offered there because Codex cannot express it. A Toolkit block that already holds 0 is offered for repair. After any Toolkit write to Codex's `config.toml`, Codex itself is asked to load the file; if it refuses the file, Toolkit puts the backup back and says so; a slow start or a failure unrelated to the file is reported as not verified and the write stays. Claude Code settings writes are read back, parsed and rolled back the same way. The "config changed" pause now says that `config.toml` changed on disk after setup read it, that nothing was written, and to close Codex and run setup again.
- **Skill metadata:** `api` is removed from every skill's `policy.products` (Codex accepts only `chatgpt`, `codex` and `atlas`), and a test enforces the list.
- **Host config writes rule** ([playbook](agent-playbooks/host-config-writes.md)): value limits come from the host's cited docs or source and tests derive from them; the host must load what Toolkit wrote, with automatic rollback; G1 UAT runs "all recommended", restarts the real host and completes one turn, for Codex and Claude Code; G2 checks all three.
- **Invariant models before building**, in the global rules, the governed block and a new portable `invariant-models.md` playbook: features that touch authority, custody, state machines or host configuration start from a written model of who may do what in which state and a closure test matrix (command x state x role, or config key x host limit), tested table-driven and reviewed against; a missing path reopens the matrix. Size caps for `CONTROLLER.md` (19,000) and the global block (17,200) rose for the new rules; the combined Codex limit check is unchanged.
- **Source watch works again.** `review-state.json` records are back in order (an out-of-order record made every scheduled notifier run fail), and the validator now parses the file the way the notifier does. ui-ux-pro-max keeps its pin; the review through `d14efff` is recorded as no action (its new CVEs are in files Toolkit does not use).

- **Promises are checked, not remembered.** `CONTROLLER.md` now says every "I'll ..." to the owner goes into the controller's promise list (id, action, trigger, status), follow-ups travel in the briefs of the sessions whose merge, review PASS or release triggers them, and those sessions end with a checklist. New `repo/scripts/toolkit-promise-check.cjs --list <file>` checks the list (JSON, or one `toolkit-promises` block in a Markdown file such as project memory) against merged PRs, PASS files and shipped versions, and exits 1 with an `Overdue promise:` line when a trigger has happened but the promise is still open. It works for Claude Projects, Codex and terminal controllers.
- **Run standard for every controller.** Gates (G0, G1, G2) run as a fresh session in the controller's own harness: a project thread or Remote Control session in Claude Projects, a new session of the same tool for Claude Code or Codex. The session's own start record proves its model and effort, never a headless run. Subagents are helpers inside a gate only, with their model and effort pinned in the agent file and confirmed from the run log; nested helpers need the host's spawn depth at 2 or more. The coordinator and non-gate threads never take over a gate's verdict.
- **Scratch goes first in the repo's gitignored `.tmp/`**, then a folder under your user profile only when an outside path is needed, never a drive root, and is deleted as soon as its report or evidence is recorded (worktrees through `git worktree remove` and `git worktree prune`). The global rules let an agent delete scratch it created in the same task without asking, never the only copy of evidence, your data or anything it did not create.
- **Feedback is input, not spec.** Task intake vets every feedback item against current `main` and rules and records accept, downgrade or reject with a reason before slotting it. Routines and executors never end a post with a question unless you must act.
- **G2's supported matrix starts from the supported-OS policy** (the README `Supported OS:` line: Windows only, Linux only as the CI and cloud build machine). Tests that existed only for macOS or FreeBSD support are trimmed; the tests proving that setup and `toolkit env` stop on other computers stay.
- **Claude Projects controller skill 2026-10-23.17** (re-upload it). Project instructions now carry a Toolkit-managed, versioned block that `repo/scripts/toolkit-projects-instructions.cjs --render` prints and `--check` compares (current, outdated, edited, missing, or declined); the coordinator replaces it only after your OK, flags edits inside it, and never re-offers a version you declined. The hourly nudge is the full sweep: every unresolved thread and project-chat post, stale labels, resolve candidates only once output is durably recorded, finished Remote Control sessions, overdue promises, and one reminder listing every item still waiting on you. Scheduled tasks run as a fresh session per run on the cheapest model and effort that does the job, write their report to a file, send a short capped message with retry and resolve their own thread. The "raise a G2 thread's effort and review in the thread" guidance is gone.
- **Attribution check follow-ups.** `--trailer "Co-Authored-By=Claude ..."` and `Claude-Session=` are caught; `(git commit -F msg.txt)` and bundled options such as `-sF msg.txt` are read; file options are capped at 64 per command and each file is read once, so very long `-C` paths and repeated options stay fast.
- **Setup question bank:** in the terminal each other choice is on its own line instead of joined with semicolons; the chat bank stays one table per section. After the questions there is one reply line, and the setup skill stops there with no summary until setup finishes.

## 3.9.0 (programme state and reconciler)

- **State documents:** one private JSON document per programme outcome plus one for the parent, kept in a private store (`store.kind` `github`: `weijunswj/TRANSPORT-ai-agent-toolkit` under `state/weijunswj/ai-agent-toolkit/` for Toolkit) and bound by the new `.github/toolkit-programme.json`. Writes use compare-and-swap with readback and never write unchanged state; a fence epoch refuses stale writers after a takeover; gate returns are consumed by return ID, so reopen, resubmit and accept work in one session. Only the controller (the parent's holder) accepts a return or records UAT, review or completion; UAT and review must name the head they apply to; secret-shaped values are refused anywhere in a document. Schemas are in `repo/contracts/programme-state/`.
- **Reconcile pass:** `skills/github-program-reconciler/scripts/programme.cjs reconcile` dry-runs by default and, with `--apply`, attaches, reparents and reorders native sub-issues (fewest moves), tracks each PR's head and required checks at that head (never `GREEN` when a check is missing, pending, skipped or off-head, or none is required), and keeps a generated state block in the parent and each child body, rendered from the same revisions. A running pass re-reads the fence before every write, so a takeover stops it at the next effect. Every GitHub change writes an intent first and is read back; an interrupted pass is settled by readback, never replayed. Bodies change only between their markers, a body edited mid-pass is left alone, and a body that would reach 60,000 characters is refused. It never closes, deletes or merges.
- **Outcome order and close list:** outcomes sort by class (`CORE`, `HARDENING`, `LATER`, `OPTIONAL`, `COMPLETED`, `RETIRED`), then order within the class and issue number, in rendered rows and native sub-issues. `READY_TO_CLOSE` lists open issues with merged PRs and green required checks at the head, including the current gate, UAT and review states, gate acceptance and completion acceptance (G1 or later, retired with its latest return consumed as ACCEPT); the controller decides, and nothing is closed automatically.
- **Skill and scope:** `github-program-reconciler` loads on its own at significant events, including when the binding is added. Any session may run the dry-run reconcile or show and report it. Only the appointed controller writes programme state: it holds the parent document and runs every writing command itself, including gates, returns, UAT, review and completion. Executors (G0, G1, G2) and helpers never write. Every write needs `--controller`, and every write except creating the parent and a deliberate parent takeover comes from the session holding the parent document; a controller stopped by a takeover stops and reports to the owner. The reconciler, its state documents, managed blocks and sub-issue links act only where `.github/toolkit-programme.json` exists; every `programme.cjs` command refuses without it. Toolkit-governed rules (the `TOOLKIT-GOVERNED-RULES` block in `AGENTS.md`) and their issue records are unchanged. Company or third-party repositories without that block get no governed issue writes, only coding-governance gates, subagents and portable skills; global rules still apply, including PRs after requested edits and task issues when the user asks to add one. The reconciler supports github.com only and a `kind: github` state store. The separate decision-trace audit remains read-only. The private evidence store may use any backend and is separate from the state store.

## 3.8.0 (CI and test speed)

- **Every pull request now runs the tests on Windows too.** The suite runs in shards, two on Linux and four on Windows, side by side. A final `validate` job runs the repository checks and then proves from the shard summaries that each system ran every test file once with no failure; a failed, cancelled or skipped shard fails it. A pull request takes about 2 to 3 minutes; the single Linux job took 3.5 to 4 and never ran the 35 Windows-only tests (#465).
- **One test runner, locally and in CI.** `npm test` runs every file, `npm run test:changed` runs the files your change affects, and CI runs one shard each. Every run gets its own scratch temp folder, under `%USERPROFILE%\t` for local runs or under the runner's own temp folder in CI, set for every child process, never at a drive root and never an 8.3 short name, and removed when the run finishes, also when tests fail. The next run removes a folder left by an interrupted run once it is more than a day old. The shard list is `repo/contracts/ci/test-shards.json`; a new test file always runs in a shard.
- **A drift guard** pins the test steps in `validate.yml` and refuses narrowed file lists, test filters, `if: false`, masked exit codes, `continue-on-error`, matrix edits and a final job that does not wait for every shard.
- **Windows failures fixed by cause**, none skipped: tests that read CRLF checkouts as LF, source-watch tests that handed Git Bash a path it could not use, a launcher test that found the runner's own Docker, and `CLAUDE.md` checked out with CRLF.
- **Faster:** the validator runs in about half the time (it reads the topology policy once), and the slowest test files are split so they run in parallel, with the same tests.
- **Removed:** the manual-only `validate-toolkit.yml` and the separate `env-store.yml` workflows; Validate runs both of their checks on every change.
- **For every repository:** a new `fast-tests-and-sharding.md` playbook, a governed rule that asks for before-and-after measurement and a per-file budget, and a `secure-ci-cd` change that asks for commit-SHA action pins and sharded tests with one aggregate required check. Toolkit's own per-file budget check, `repo/scripts/check-test-durations.cjs`, only reports until a budget is set.

## 3.7.1 (toolkit env comments)

- **The `toolkit env edit` file keeps accepted comment and section lines.** The env record stores key names without assignment values, accepted comments verbatim and blank lines, and shows them in the same place next time; new keys come after them. `apply` refuses suspicious comments by line number only. Its duplicate-key and value-too-long messages also no longer name the key. `toolkit env remove` drops the name from the layout.
- **`import-codex-env` and `retire-codex-env` keep the comment lines** from `~/.codex/.env` when Toolkit has no layout yet, so they survive the file being retired. Retire now says when its backup is also the only copy of some comment lines.

- **Stricter comment screen.** Comments over 200 characters are refused before screening. The screen checks `NAME=value` assignments with non-empty values other than `<unchanged>`, common token prefixes, opaque runs of at least 24 characters containing letters or digits, and hidden controls. NFKC catches look-alikes it maps to `=`, such as fullwidth equals, not every look-alike or assignment syntax. Repeated equals are decoration; decorated headings, empty or unchanged commented-out keys and Unicode headings can be kept. HTTP(S) URLs and file paths ending in an extension are screened component by component for opaque runs. Zero-width joiners are allowed between emoji pictographs, with optional variation selectors or skin-tone modifiers before the joiner; other hidden controls are refused. Stored layouts are checked again before use or writes, with errors identifying positions in the manifest's `layout` list. This is a conservative screen, not a proof: never put a password, key or token in a comment. See [Toolkit Env](TOOLKIT-ENV.md#what-it-protects-and-what-it-does-not).
- **3.7.0 review follow-ups.** The attribution check screens the whole text of commit and PR commands, including wrappers, substitutions and here-documents. Its file parser tokenises quoted separators and Bash/PowerShell line continuations, skips git global-option values and composes repeated `-C` folders only for files in that git command. Unpaired files are also checked in the base folder; `gh` body files use that folder. Command detection is linear, each git command is limited to 64 `-C` options, and commands over 1,048,576 characters are refused. A quoted PATH entry (`"C:\Program Files\Git\cmd"`) counts when setup looks for git. Without Antigravity consent, n8n copies an earlier build left there are removed and reported separately from retired skills. The Antigravity question says the n8n skills come along. `explain` replaces `--execute` with `--plan --explain`. Claude Projects controller skill 2026-10-23.10 (re-upload it).

## 3.7.0 (setup and hooks)

- **Review fixes:** every git command setup and the bridge start comes from PATH by full path, so a `git.exe` in the opened folder never runs; the local clone step also works when setup hands off to the managed copy. The attribution check also covers Claude Code's PowerShell tool and `gh pr merge`. A failed settings write leaves no "set by Toolkit" record. The n8n skills go into Antigravity only when you keep Toolkit's skills there, and removing those removes the n8n copies too. Skill copies prune retired skills and never act on a malformed ledger entry.
- **Compact question bank** (#486). The bank is one table per section: each row shows what is true now, the recommended choice and its effect, and the other choices. Say "explain 1.5" (or run setup with `--explain 1.5`) for the full text of one question; the reference document keeps the full text. A new test checks that no question, default, "all recommended" answer or flag can turn on any merge.
- **Claude Projects controller skill 2026-10-23.9:** another project edits the uploaded copy only at your request, and project setup now also creates a recurring hourly stalled-work nudge (read-only, reports to the coordinator, pings you only when something needs you). The nudge reviews every open thread and is the only place threads get resolved. It replaces the one-shot active-work reminder. Upload the new file to claude.ai after this merges.
- **Commands you paste work in PowerShell.** Printed and documented `node` commands use `"$env:USERPROFILE\..."` instead of the cmd-only `"%USERPROFILE%\..."`.
- **Antigravity copy question is back** (#472). When Antigravity is installed, setup asks "Copy Toolkit's skills into Antigravity?" (opt-in). Choosing it copies the portable skills into `~/.gemini/config/skills` and keeps Toolkit's copies current; a later answer removes only Toolkit's copies. The per-workspace bridge copy stays.
- **Windows only in setup.** Setup stops before any step on a computer that is not Windows (Linux runs only as a CI build machine), and `toolkit env` loses the Linux key store. The install check builds the key store only when it needs it, so it skips `toolkit env` on a computer without one (#532).
- **Recommended Claude Code settings.** New setup question "Use Toolkit's recommended Claude Code settings?" sets four values in `~/.claude/settings.json`: `attribution: false`, `crossSessionInbound: "accept"`, `switchModelsOnFlag: false`, and read `AGENTS.md` as well as `CLAUDE.md`. A value you set yourself is never changed; turning it off removes only what Toolkit set.
- **No AI attribution.** Claude Code and Codex refuse a `git commit` or `gh pr create`/`edit` that carries a Co-Authored-By trailer naming Claude, a Claude-Session trailer, a claude.ai session link or a "Generated with Claude Code" footer.
- **Codex hooks on Windows** now use Codex's own `commandWindows`: a full PowerShell path and a `.ps1` launcher, so neither PowerShell nor `cmd.exe` runs a `node` or `powershell` file planted in the folder you open.
- **New session, not restart:** the install check says "new session needed" (start a new Claude Code session and close older ones), and Codex users are told to open `/hooks` and trust the updated Toolkit hooks.
- **Your local clone:** when setup runs from your own clone of Toolkit and it is clean and on `main`, setup fast-forwards it; otherwise it says why it did not. It never resets, forces, stashes or switches branches.
- **Codex refresh report** no longer says "refresh failed" after a successful update across a version change; it says "Codex plugin updated to <version>. It takes effect in your next Codex session."
- **Official n8n skills** ship as plain skill folders: the 15 folders of `n8n-io/skills` at a pinned commit, reviewed (Apache-2.0) and copied unchanged by setup into Claude Code's or Codex's skills folder and Antigravity's when it is installed. Your own copies are never changed; `toolkit-n8n-official-skills.cjs --remove` removes only Toolkit's. No plugin, hook or script comes along. After a good copy, setup turns off the `n8n-skills@n8n-io` plugin in Claude Code so the skills do not load twice; in Codex it says how. Older copies you keep (names without `-official`, or in Antigravity's older skills folder) are reported, never deleted.
- **Helper settings changed mid-session:** a Toolkit helper whose file was rewritten after the session started is refused with "Start a new session to use them."
- **Removed:** the n8n Skills plugin hook repair, and the rule-refresh PR auto-merge setup question; refresh PRs always stop for you to merge.

## 3.6.0 (instructions, README and packaging)

- **Windows only.** Toolkit supports Windows 10 and 11 computers. The README says so on its first line, the validator keeps that line there, and setup docs drop the POSIX commands and `$HOME` paths. Linux stays for CI, cloud agent sessions and the remote servers some skills manage (#532).
- **A short README.** The front page now covers what Toolkit is, install, update, remove, the skills and where the docs live; the detail moved to [How To Use](HOW-TO-USE.md).
- **`CLAUDE.md` is one line, `@AGENTS.md`.** The shim has no markers; the sync and the session-start check recognise it by its content, and an old marked shim reads as stale. **`GEMINI.md` is gone**: Antigravity reads `AGENTS.md` itself. `repository-agent-rules` removes an old Toolkit `GEMINI.md` shim on refresh and never touches anyone else's.
- **Global rules:** your own instructions rank with your current request; a shorter line for reading `AGENTS.md`; no AI attribution in commits or PRs; never create files at a drive root; and a task-intake rule (find the owning issue, else add a native sub-issue and read it back). The block stays inside its 16,500-byte budget (16,484).
- **`CONTROLLER.md`:** the same task-intake rule; the owner's own custom instructions and the Projects skill at the top of the order; and the owner's standing rules: only merges, deletions, real keys and irreversible steps need the owner's OK, and agents fully manage evidence (transport) stores on any backend, with the secret scan and the sole-copy rule kept. The global floor's opening sentence and the governed evidence line now carry that one exception, and both `safety-gates.md` playbooks point at it. To stay in budget, Tool Preference no longer offers to remove unused connectors.
- **Claude Projects controller skill** now lives in the repo at `repo/contracts/claude-projects/web-controller-projects/SKILL.md` (version 2026-10-23.7), outside `skills/` so no plugin offers it. You upload it to claude.ai yourself after a merge that changes it. You or another project may edit the uploaded copy directly; a coordinator brings those edits into Toolkit before the next upload.
- **Packaging:** the Skill Safety Matrix has a Packaging table that marks each skill portable or internal. The Antigravity copy now leaves out the four Toolkit-only skills (`controller-bootstrap`, `github-program-reconciler`, `toolkit-env`, `toolkit-setup`), and the validator keeps the table and the copier in step (#424).
- **This repository** tracks a `.claude/settings.json` that allows WebFetch and WebSearch here only.

## 3.5.0 (keys and tokens)

- **`toolkit env`:** one place for the API keys and tokens your coding apps use, kept in the computer's own credential store (Windows Credential Manager on this PC only, or the Linux Secret Service, with built-in tools only and no fallback file; macOS is not supported). `status` shows names only; `edit` opens a private Notepad file and `apply` saves it; `set`, `remove` (after a yes/no naming the key), `run --names A,B -- <tool>`, and `header` for the apps. See [Toolkit Env](TOOLKIT-ENV.md).
- **Apps read keys at use time:** `connect SERVER --name NAME` points a Claude Code MCP entry (`headersHelper`, through the `claude mcp` command) and a Codex MCP entry (`http_headers_helper`, removing `bearer_token_env_var`) at the store, with a preview, a yes/no and a backup; `revoke --feeders` puts them back. OpenCode has a reserved slot.
- **Moving off `~/.codex/.env`:** `import-codex-env` copies its keys into the store with a read-back check and leaves the file alone; `retire-codex-env`, which you run yourself, moves it into a private backup once nothing needs it.
- **Skill and checks:** a new `toolkit-env` skill routes "edit my env", "what keys do I have" and similar requests in every app, one global-rules line points to it, and the install check reports missing keys, changed entries and entries still on the old `~/.codex/.env` helper, by name only. A new CI job runs the store tests on Windows.

## 3.4.0 (rules and records)

- **Two instruction layers.** Generic rules now live in one global block (`repo/contracts/agent-rules/global-rules.md`) that setup installs into `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md` (and `~/.gemini/GEMINI.md` when enabled), refreshed at session start and checked by the install check. Repositories carry only the Toolkit-governed block (`toolkit-governed-rules.md`), which is also the opt-in. Root `AGENTS.md` dropped from 42.5 KB to under 14 KB, and a new setup question, "Raise Codex's instruction limit" (recommended yes), raises Codex's `project_doc_max_bytes` to 65536, because Codex desktop 26.1016 cut repository rules off at the 32 KiB default with the global block installed (open-source Codex does not count the user file; the owner's UAT showed the cut and the fix). The edit is checked with a real TOML parser, leaves 0 and higher values alone, sits inside Toolkit markers that keep the exact replaced line, is reported at every change, and is undone exactly on removal; setup and `--check` report the combined size.
- **Versioned, hashed markers** on every Toolkit insert (`BEGIN <NAME> v2 toolkit=<version> sha256=<12 hex>`). Refresh writes only between markers, keeps every other byte, restores hand-edited blocks with a backup, and `toolkit-global-rules.cjs --remove` removes the global block cleanly; the removal holds through session starts until `setup toolkit` installs again.
- **New global rules:** entry routing (ordinary task, ungoverned repository, substantial new project with no repository, governed repository, controller role), repository-wins precedence above a fixed safety floor, merge only after the owner's OK on external effects, tool preference order, model safety flags, fast-forward after merge, parallel builders on disjoint files, and an installed-result check before UAT. The hand-written "Toolkit Controller Bootstrap" content is folded in; setup reports the now-duplicate section and never edits it.
- **New governed rules:** release plan and one PR per lane, finish-fast batching, fast tests, decision traces (with the new read-only `github-program-reconciler` trace audit), short-plus-full SHA links, takeover records, session folders are never custody, a compact repo map, an authorised-context note, and route proof by the launched session's own metadata with effort pinned at launch.
- **Controller and docs:** `repo/CONTROLLER.md` shortened with every rule kept or moved to the governed block, plus the takeover record and host-neutral route proof; `repo/ARCHITECTURE.md` is now a compact repo map checked by a test; `controller-bootstrap` rebound to the current sources; stale contract references fixed in the skill safety matrix and reconciler skill.
- **Helpers:** G0 and G1 helper turn caps raised to 50 and 60.
- **Removed:** the three manual global templates (`AGENTS/CLAUDE/GEMINI.template.md`) and their generator, older marker spellings, the stale "one pending owner question" stack-selection text, and the source-of-truth block in root `AGENTS.md` (still in the README).
