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
| Failure and timeout | The hook has `onFailure: "block"`; a decision module that fails becomes a deny in governed work (both are matrix rows) |
| Trust step | None: Claude Code has no separate trust step for plugin hooks. Setup checks that no setting turns hooks off and that the agent hook in the folder Claude Code runs refuses a test launch |
| Helper definitions | Markdown agent files rendered from the pinned stack, looked up as Claude Code loads them: managed folder, project folders up to the repository root, user folder (a matrix row covers the order) |
| Depth | Claude Code's own `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH=1` plus the hook's refusal of any launch from a helper (a matrix row) |
| Route proof | Served model and effort from Claude Code's run records (subagent transcript and `.meta.json`), never the helper's report (the matrix's live rows) |
| Known limit | A session `--agents` definition of a helper name outranks the files and no hook sees it (a matrix row); Toolkit launchers refuse it with `toolkit-claude-session-agents.cjs` |

## 7. Lane write fences

The integration controller alone writes the parent, the version files and the integration files the lane map names (`repo/contracts/lanes/lane-map.json` once it lands). A lane controller writes only the child the catalogue delegates to it (`assign` and `interrupt`), with its own decision-ID prefix.

## 8. Honest limits

- The fence orders cooperating Toolkit writers under one GitHub account; it authenticates nobody.
- The tool cannot see whether another host session has stopped. A takeover record must carry that evidence (session archived, remote control ended).
- A journal is evidence, not state, until the controller's reconcile reads it.
