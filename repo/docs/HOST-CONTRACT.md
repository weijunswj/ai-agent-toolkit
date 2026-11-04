# Host Contract

What the programme custody model needs from each supported host (Claude Code and Codex), and how the Toolkit meets it today. The machine-readable twin is [`repo/contracts/programme-state/host-contract-v1.json`](../contracts/programme-state/host-contract-v1.json); tests read it against the shipped plugin hooks. This page records needs and current mechanisms. It does not claim native qualification: route controls, subagent lifecycle and launch escalation stay with each host's own support work (one for Codex, one for Claude Code), which follows this shared contract.

## Who writes what

Only the appointed controller writes programme state (the parent and child documents). An executor the controller assigned to a gate writes only its own checkpoint journal in the private state store, through `bind` and its turn-end hook. The controller's `reconcile --apply --controller` reads journals into the child document. Gate acceptance, UAT, review and completion are written only by the controller. The [reconciler skill](../../skills/github-program-reconciler/SKILL.md) has the commands.

## 1. Session identity

- **Hook input:** both hosts pass `session_id` to the turn-end hook. Only a 16-character hash of it is stored or used in a file name.
- **Executor:** binds with `programme.cjs bind --issue <n> --assignment <id> --session <its own session ID>`. An inherited or empty value is never used.
  - Claude Code: the session's ID is in `CLAUDE_CODE_SESSION_ID`. This was observed in sessions and is not yet in the host's environment-variable reference, so a bind that cannot read it falls back to the assisted mode.
  - Codex: no documented way for a session to read its own ID was found, so Codex executors use the assisted mode until the Codex host support work qualifies one.
- **Route proof:** the launched session reads its model and effort from session metadata before consequential work and passes them to `bind` (`--model`, `--effort`, `--route-read-back`), which records them in the journal. On Codex the lead verifies the route from the session log.

## 2. Turn-end hook

| | Rule |
|---|---|
| Event | `Stop`, one command hook in each plugin's `hooks.json`, no matcher |
| Script | `repo/scripts/toolkit-programme-checkpoint-hook.cjs` |
| Timeout | 30 seconds in `hooks.json`; the hook stops itself at 20 seconds and each GitHub call at 8 |
| Never blocks | Always exits 0 and prints nothing on stdout (Codex reads turn-end stdout as JSON; exit 2 or a block decision would continue the turn on either host) |
| Unbound session | No local binding for this session, or no `.github/toolkit-programme.json` in the bound repository: returns before any git, gh or network call |
| Facts written | Branch, HEAD, tree, dirty flag, ahead and behind, and the last fenced `toolkit-return` block in the final message. Identical facts write nothing |
| Failure | Recorded in the session's local errors file; the next checkpoint writes it to the journal and `show --session` lists it |
| Windows | Claude Code runs the same command. Codex runs `commandWindows`: the full `powershell.exe` path with `-File repo/scripts/toolkit-programme-checkpoint-hook.ps1`, which setup adds to the installed copy only and which also always exits 0 |
| Trust | Codex skips a plugin hook until it is reviewed and trusted in `/hooks`; setup says so after a hook change |
| Programme refresh | After the checkpoint, a session the after-tool hook marked starts `programme.cjs refresh` detached, once for each governed repository it wrote for, then clears the mark; output is appended to one `last-run-<checkout key>.log` per checkout in `~/.ai-agent-toolkit/user-state/programme-refresh/`, and marks older than a day are removed. A write with no governed checkout on this computer, or governance not ENABLED there, starts nothing |

The same script also runs on `PostToolUse` (one command hook, matcher `^(?:Bash|PowerShell|mcp__.*[Gg][Ii][Tt][Hh][Uu][Bb].*)$` in Claude Code and `^(?:Bash|exec_command|shell|local_shell|PowerShell|mcp__.*[Gg][Ii][Tt][Hh][Uu][Bb].*)$` in Codex, 10-second timeout, the same Windows launcher in Codex). It reads only the hook input: after a GitHub write (a GitHub connector tool that writes an issue, comment, sub-issue link, pull request, review or branch files; `gh issue` or `gh pr` writes; `gh api` with a write method, or fields without `GET`, or a GraphQL mutation; `git push`) it writes one small mark file for the session. No git, gh or network call, exit 0, nothing on stdout.

The return block the hook reads:

````text
```toolkit-return
return_id: g1-r1
verdict_requested: ACCEPT
at_head: <40-character commit SHA>
next_action: Controller: start G2 at this head
blockers: none yet; owner UAT pending
```
````

`verdict_requested` is `ACCEPT`, `WAITING_OWNER` or empty; `blockers` are separated by `;`. A request is only a request: the controller decides with `return --consume`.

## 3. Completion mode

| Mode | Meaning | Where |
|---|---|---|
| `native` | The executor binds; its turn-end hook journals checkpoints and returns | Claude Code on the owner's computer |
| `toolkit_assisted` | The executor reports in its thread or chat; the controller records the return with `return --record` | Codex today; cloud sessions and Projects threads on either host |
| `unsupported` | No custody path; the controller does not launch gate work there | Any host not listed here |

## 4. No duplicate launch

Before launching a gate the launcher runs `show --issue <n>`. A live assignment (`ASSIGNED`, `ACTIVE`, `SUBMITTED` or `WAITING_OWNER`) holds the launch. `assign` refuses one too, unless `--supersede --reason` marks the old assignment `INTERRUPTED`. Two sessions journaling one assignment hold that child with `DUPLICATE_SESSION`.

## 5. Handover

Stop or fence the old writer, settle in-flight effects, then assign the successor. Journals of the old assignment are reported once as `STALE_ASSIGNMENT` and never replayed. A parent takeover needs a takeover record comment on the parent issue that the tool reads back (`claim --parent --takeover --takeover-record <comment id>`).

## 6. Helpers

Named helper definitions carry the pinned model and effort. In gate work only a G0 or G1 lead launches helpers; outside gate work the main session may launch them on their installed route, with no admission. Helpers never launch, and G2 has none. How each host carries out the route belongs to that host's own support work.

Claude Code (rows refer to the launch matrix in `repo/tests/support/claude-helper-matrix.cjs`; stored results in `repo/contracts/host-qualification/claude-code.json`):

| Need | How Claude Code meets it |
|---|---|
| Hook event | `PreToolUse` with matcher `Agent\|Task`, from the plugin's `hooks.json` (the hook rows of the launch matrix in `repo/tests/support/claude-helper-matrix.cjs`) |
| Blocking output | JSON `permissionDecision: "deny"` with a plain reason; an allowed launch returns no decision, so Claude Code's own permissions still apply |
| Failure and timeout | The hook has `onFailure: "block"`; a decision module that fails becomes a deny in a Toolkit gate run (both are matrix rows) |
| Trust step | None: Claude Code has no separate trust step for plugin hooks. Setup checks that no setting turns hooks off and that the agent hook in the folder Claude Code runs refuses a test launch |
| Helper definitions | Markdown agent files rendered from the pinned stack, looked up as Claude Code loads them: managed folder, project folders up to the repository root, user folder (a matrix row covers the order) |
| Depth | Claude Code's own `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1` plus the hook's refusal of any launch from a helper (a matrix row) |
| Route proof | Served model and effort from Claude Code's run records (subagent transcript and `.meta.json`), never the helper's report (the matrix's live rows) |
| Known limit | A session `--agents` definition of a helper name outranks the files and no hook sees it (a matrix row); Toolkit launchers refuse it with `toolkit-claude-session-agents.cjs` |

Codex (hook-process cases in `repo/tests/qualification/codex-native-helper.live.cjs`; stored results in `repo/contracts/host-qualification/codex.json`; the helper policy is in `repo/scripts/toolkit-codex-helper-policy.cjs`; the [Bridge's hook policy](TOOLKIT-LOCAL-BRIDGE.md#hook-policy) has the detail):

| Need | How Codex meets it |
|---|---|
| Hook event | `PreToolUse` with matcher `^(?:Agent\|[A-Za-z0-9_-]*spawn_agent\|Bash\|exec_command\|shell\|local_shell\|PowerShell)$`, from the plugin's `hooks.json`. The spawn part covers V1 (`multi_agent`) `spawn_agent` and V2 (`multi_agent_v2`) `<namespace>spawn_agent` |
| Blocking output | JSON `permissionDecision: "deny"` with a plain reason, the reason on stderr and exit 2. An allowed launch exits 0 with no output, because Codex records a bare allow as a failed hook run, so Codex's own permissions still apply |
| Failure and timeout | Codex does not block when a hook cannot start, crashes, exits with another status or times out, or is missing, disabled or untrusted. The decision modules load inside the guarded path, so a broken module denies in a Toolkit gate run. On Windows the PowerShell launcher denies a helper launch when it cannot start Node |
| Trust step | Codex skips a plugin hook until it is reviewed and trusted in `/hooks`. A changed hook needs trusting again, and setup says so |
| Helper definitions | `toolkit-g0-helper.toml` and `toolkit-g1-helper.toml` in `<CODEX_HOME or ~/.codex>/agents`, rendered from the pinned stack by `toolkit-codex-helper-agents.cjs`. In a Toolkit gate run, every copy Codex could load (each `.codex/agents` folder from the working folder up to the repository root, and the user folder) must byte-match the rendered file |
| Admission | In a Toolkit gate run (a session a Toolkit launcher started) only those two helpers launch; elsewhere, governed repositories included, the main session launches any agent. The hook refuses built-in agents, a launch that names no agent, model or effort fields, resume, a V1 `fork_context: true`, a V2 launch whose `fork_turns` is not `none`, and any launch in a G2 session |
| Depth | Setup keeps V1 `max_depth = 1`. Codex sends hooks no caller-agent identity, so the hook cannot refuse a helper that launches another helper, and leaf depth stays an instruction |
| Route proof | Served model and effort from the Codex session log, read by the lead, never the helper's report |
| Known limit | Hook failures fail open (above). In Codex Desktop on Windows, a helper's shell can hit "Requested registry access is not allowed" (Desktop's sandbox for subagents, seen in October 2026) |

## 7. Gate workspace

A writing gate works only inside its own session's writable folders, so the owner's plan approval never needs a second yes in the gate chat.

- **Codex Desktop:** a chat can write in its working folder and in any worktree attached to that chat. A controller starts a builder with `create_thread` and `environment: { type: "worktree" }`, or the builder's first step makes its worktree with `create_worktree`. Either way the worktree becomes the chat's working folder and writable folder (session logs and an owner test, October 2026): a write inside it runs with no prompt, and a write one folder above it is refused by the sandbox. In those chats PowerShell could not start ("Requested registry access is not allowed"), so the builder used `cmd`. A chat started with `environment: { type: "local" }` writes only in the project's main checkout.
- **Where they live:** Codex Desktop, not Toolkit, places these worktrees, in its own worktrees folder (seen as `_worktrees/<name>/<repository>` beside the repositories, October 2026), not in `.tmp/worktrees`. After the lane's PR merges, the controller removes it with Codex's `archive_worktree`, which saves a recoverable snapshot first, and keeps a worktree that tool refuses or that still holds unmerged work, reporting it.
- **Never point a chat at another folder.** A chat told to escalate its shells into a folder outside its own sends every write to Codex's automatic reviewer, which trusts only what the owner typed in that chat and rightly refuses an approval forwarded from the controller. Rewording or retrying after that refusal routes around the reviewer.
- **Scratch:** a Codex gate keeps scratch in its worktree's ignored `.tmp/`, because a user-profile folder is outside the chat's folders.
- **Known limit:** Codex cannot attach an existing worktree to a new chat (seen October 2026), and starting a successor from a lane branch still checked out in the old worktree is not yet qualified. Until it is, a successor continues in the old chat, or the owner approves its out-of-scope writes with Codex's native approval in the chat that asks.

### Review CLI permissions

The Windows review permission recipe was qualified on Codex CLI `0.166.0`, model `gpt-6.1-sol`, effort `high`, using the real authenticated Codex home with optional MCP servers disabled for that invocation. One command passed all eleven boundary and fixture checks. This does not qualify `xhigh`, a complete test suite or the hook pack on this route; those execution results remain required for each review.

Before launch, inspect the effective Windows backend in the real home and any selected configuration layers: `windows.sandbox` must already be `"elevated"`. Stop if it is different or cannot be verified. Never set or change it for the owner. The same-home helper comparison measured Node children and network refusal under elevated; unelevated returned child-process `EPERM` and an HTTP response. Unelevated is a network boundary failure, not a usable alternative.

Prepare the launch outside any enclosing Codex sandbox:

1. Use a real disposable worktree of the governed repository at the candidate commit, outside the granted temp root. A scratch folder with synthetic `.git` metadata hits the governance hold and can produce an empty turn. Do not bypass that hold.
2. Select one absolute, long-form temp root covering the actual test consumers, separate from and not an ancestor of the worktree. Pre-create it with plain `mkdir` so permissions inherit. Python `tempfile.mkdtemp` makes owner-only outer folders the sandbox cannot use; an absent grant root stops sandbox startup. A temp-folder argument grants no permission.
3. Keep the Codex process's own startup temp folder outside the grant. Do not assume its `TEMP` reaches sandboxed commands: elevated supplied a separate agent temp folder where `mkdtemp` failed with `EPERM`. Set all three temp variables inside every review command as shown below. Keep reports outside runner-owned run folders, within the grant, and retain evidence before cleanup.
4. Read the enabled optional MCP server names from the user config and add one invocation-only `enabled=false` override for each. Do not disable a required server; stop if a requirement conflicts. Keep managed requirements, hooks and execpolicy active. Never copy credentials to an isolated home or edit persistent config.
5. Use the argument template below, with actual absolute paths and server names substituted, and send the short review prompt on stdin. Do not add `--sandbox` or `--add-dir`. Loaded legacy `sandbox_mode` settings take precedence over the named profile. Stop if a loaded configuration conflicts; do not repair host settings as part of the launch. See the [official permission guide](https://learn.chatgpt.com/docs/permissions).

```text
codex exec --json --color never -C <real-disposable-worktree> -m gpt-6.1-sol -c model_reasoning_effort="high" -c approval_policy="never" -c default_permissions="review-temp-qualification" -c permissions.review-temp-qualification={extends=":read-only",filesystem={"<absolute-pre-created-temp-root>"="write"},network={enabled=false}} -c mcp_servers.<name>.enabled=false -
```

Repeat the MCP override for every enabled optional server; omit it when there are none. Pass each `-c` value as one argument with the launcher's native quoting, never with literal environment macros in TOML paths. The qualified invocation did not use `--ephemeral`; do not claim unmeasured flag combinations. A qualification prompt runs only its probe command and prints the output, with one model session, a stated timeout and no retries.

Inside the PowerShell review command, replace the root placeholder with the actual grant before invoking tests:

```powershell
$env:TEMP = '<absolute-pre-created-temp-root>'
$env:TMP = $env:TEMP
$env:TMPDIR = $env:TEMP
node repo/scripts/run-tests.cjs --temp-root $env:TEMP repo/tests/ci-test-shards.test.cjs
```

This is a command pattern, not a claim that this test file passed in the qualified session. Direct hook-pack commands need the same in-command assignments. Once inside that command, the runner supplies its children and nested runners with their own run folder; see [validation guidance](VALIDATION-STRATEGY.md#review-temp-permissions).

Inspect native command events and `turn_context`: root reads, exactly one temp write entry and restricted command networking are the required effective permissions. The record can label the translated `sandbox_policy` as `workspace-write` with only the temp root writable; inspect the actual entries rather than interpreting that label as a source write grant. Do not switch to a broader policy to obtain a preferred label.

| Check on the disposable worktree | Required result |
| --- | --- |
| Read source and Git metadata | Allowed |
| Write temp files; create and remove mkdtemp fixtures and nested Node test runs | Allowed, fixtures cleaned up |
| Create files in candidate, metadata or sibling outside the grant; overwrite source | Refused, candidate bytes unchanged |
| HTTPS from the sandboxed command | Explicit permission denial; an HTTP response or timeout cannot pass |
| Required local tests and unchanged hook pack | Separately recorded results for the exact candidate commit |

Repeat affected qualification checks when the host, CLI, backend or launch changes. Helper results do not replace real exec evidence. A zero-usage empty turn is a hold to investigate, not a pass: `--json` can hide the governance hook line. Preserve native output and inspect the hold; never retry a refused command through another route. Missing results, unexpected writes or network access hold acceptance. No persistent host-config writer is introduced.

## 8. Lane write fences

The integration controller alone writes the parent, the version files and the integration files the lane map names (`repo/contracts/lanes/lane-map.json` once it lands). A lane controller writes only the child the catalogue delegates to it (`assign` and `interrupt`), with its own decision-ID prefix.

## 9. Honest limits

- The fence orders cooperating Toolkit writers under one GitHub account; it authenticates nobody.
- The tool cannot see whether another host session has stopped. A takeover record must carry that evidence (session archived, remote control ended).
- A journal is evidence, not state, until the controller's reconcile reads it.
