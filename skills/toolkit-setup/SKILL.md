---
name: toolkit-setup
description: Use when the user says "setup toolkit" or "refresh toolkit", asks to repair the installed n8n Skills plugin or fix n8n .sh hooks opening in an editor on Windows, or when the task is clearly about AI Agent Toolkit plugin setup/update state, Toolkit Local Bridge setup or troubleshooting, repo-backed auto-update, bridge audit/sync/disable, OpenCode native-plugin migration, AG2 skills-only proof-gated projection, native Codex or Claude Code plugin behavior, Windows hook repair, or bridge setup safety. Route only installed-plugin repair intents to the bounded Toolkit setup subsystem and repo/scripts/toolkit-local-bridge.cjs; do not use for ordinary project coding, repo-local n8n helper scripts, live n8n operations, or generic n8n/MCP work.
---


# Toolkit Setup

Use this skill as a discoverability router for Toolkit plugin and local bridge setup work.

Run this routine with the root agent alone. `setup toolkit` is ordinary interactive setup; do not spawn subagents to inspect instructions, documentation, repository or host state, setup choices, or validation output.

Bridge setup, repo auto-update, sync, audit, disable, Windows plugin hook repair, and troubleshooting are Toolkit setup infrastructure. The bridge implementation lives in `repo/scripts/toolkit-local-bridge.cjs`; Codex native plugin verification/install lives in `repo/scripts/setup-codex-toolkit-plugin.cjs`; Codex plugin hook repair lives in `repo/scripts/repair-codex-plugin-windows-hooks.cjs`; Claude Code native plugin metadata lives under `.claude-plugin/`; detailed policy lives in `repo/docs/TOOLKIT-LOCAL-BRIDGE.md`, `repo/docs/HOW-TO-USE.md`, `AGENTS.md`, validators, and tests.

## Platform Split

- Codex native plugin install/update is Codex-only. Codex may verify or refresh only the Codex Toolkit native plugin cache. On Windows, the same opt-in may also reconcile only the exactly recognised installed `n8n-skills@n8n-io` hook layout after plugin updates.
- Claude Code native plugin install/update is Claude Code-only. The setup orchestrator verifies `.claude-plugin/plugin.json` and `.claude-plugin/hooks/hooks.json`; use Claude Code's native Toolkit plugin flow when Claude Code reports the package is missing, stale, disabled, or untrusted.
- The shared bridge is platform-neutral. After the native Toolkit package is installed in Codex or Claude Code, use `repo/scripts/toolkit-local-bridge.cjs` for repo auto-update, audit, OpenCode migration work, and the proof-gated AG2 skills-only projection.
- Hook approval differs by host. Codex setup must explain Codex hook trust; Claude Code setup must follow Claude Code's own native plugin/hook review behavior and should confirm the hook uses `--sync-source claude-plugin`.
- The active route is `User/Web authority -> versioned role registry -> exact resolved launch record -> capability-proven host adapter -> bounded execution loop`. Codex, Claude Code, and OpenCode adapters prove capability for the exact record; they do not select a model, speed, service tier, backend, host, worker/checker mapping, or fallback. Unsupported or contradictory evidence fails closed.
- Pre-approval setup and plan discovery do not launch a native child. The ordinary setup bank contains no helper-count, RAM-admission, reservation, queue, refusal, checker-policy, or model-binding choice. Root-only is the safe unapplied result when an exact route or host proof is unavailable; capability evidence never becomes scheduling authority.
- Depth-1 children resolve independently. An omitted child speed resolves to Standard and never inherits a Priority root; Priority child execution requires exact child authority or an enumerated tree override that yields an exact child launch record. The managed terminal lifecycle keeps leases, locks, atomic writes, rollback, snapshot binding, and interruption recovery as transaction safety only.

## Required Route

1. Inspect the local repo context and read `repo/docs/TOOLKIT-LOCAL-BRIDGE.md` before changing bridge behavior or running write commands.
2. For English prompts such as `setup toolkit`, `refresh toolkit`, or plain `refresh` in a Toolkit setup/update context, use the host-aware setup orchestrator from the managed checkout whenever it exists. Do not use the active repo worktree command as the canonical route.

```powershell
node "%USERPROFILE%\.ai-agent-toolkit\source\ai-agent-toolkit\repo\scripts\setup-toolkit.cjs" --execute --profile auto-main
```

```sh
node "$HOME/.ai-agent-toolkit/source/ai-agent-toolkit/repo/scripts/setup-toolkit.cjs" --execute --profile auto-main
```

The orchestrator discovers current state, shows one consolidated upfront setup question bank, pauses before preference or target writes, then runs to completion unless a real safety blocker appears.

Treat exit code `23` as an intentional pause only after the managed child emits exactly one complete bank on stdout and the delegating parent acknowledges that it forwarded the bank visibly. In a chat host, emit the complete compact bank as ordinary visible text before asking for approval. Hidden tool output, an internal summary, or a statement that the bank exists does not count. A blanket recommended-default action is allowed only in the same visible response as every consequential current outcome, recommendation, effect, and choice. Never say `shown above` or equivalent unless the complete bank is in that same payload. Missing, partial, duplicate, misordered, wrong-stream, timed-out, signalled, failed, recursive, or invalid-identity managed output fails closed in one execution without retry, fallback, approval, or writes. Do not rerun with `--yes-recommended` unless the user explicitly asked to use the displayed recommended choices in the current turn.

Managed delegation launches the child before waiting for non-TTY stdin EOF. It streams exact input bytes under a fixed limit; the child emits the bank before reading unresolved input and binds it to exact byte length, SHA-256, marker counts, and question count. The parent waits for and validates the exact bounded stdout payload regardless of control/stdout delivery order, forwards it once, and only then acknowledges visibility. Length/digest mismatch or oversized input, output, or metadata fails closed with a privacy-safe diagnosis.

It must show this explanation:

**Toolkit will use a dedicated clean `main` checkout as the single update source. Active Codex or Claude Code sessions may remain on PR branches, but plugin updates will not depend on those branches.**

Default managed source checkout:

- Windows: `%USERPROFILE%\.ai-agent-toolkit\source\ai-agent-toolkit`
- POSIX: `~/.ai-agent-toolkit/source/ai-agent-toolkit`

The managed checkout is separate from the active Codex or Claude Code worktree, plugin caches, `.tmp` directories, and temporary marketplace checkouts. If the active Toolkit worktree is on a PR branch, setup should warn that this is okay and continue using the managed clean `main` checkout.

If the managed checkout path does not yet exist or does not contain `repo/scripts/setup-toolkit.cjs`, the active repo command is bootstrap/fallback only:

```powershell
node repo/scripts/setup-toolkit.cjs --execute --profile auto-main
```

When fallback/bootstrap is used, say that it is bootstrap-only. After the managed checkout exists, hand off to the managed checkout script above and use that script for the question bank, setup writes, and verification. In Claude Code, append `--host claude-code` to the managed or fallback setup command. If the managed setup script exists but exits for question-bank pause or a real safety blocker, do not fall back to the active repo command; stop and report the pause or blocker. Do not run an active stale verifier after managed setup; verify from the same managed checkout script/repo that performed setup.

3. One semantic wizard model must drive chat text, interactive terminal prompts, piped answers, explicit flags, plan output, structured JSON, approval summaries, generated setup documentation, and execution in the same order. After host and availability resolution, the renderer derives contiguous section/question references, deterministic A-ZZ choice references, totals, and a quick index without replacing stable semantic IDs or canonical values. The ordinary renderer groups consequential rows under `Updates and reports`, `Computer performance`, and `Other coding apps`. Every decision block uses this order with readable spacing: indexed title, **What this controls:**, **Current:**, **Verification:**, lettered **Recommended:** choice, recommended outcome, **Why:**, lettered **Choices:** with a consequence for every choice, then **After applying:** when state, files, native configuration, restart, or manual steps are relevant. The generated [Toolkit setup question reference](../../repo/docs/SETUP-QUESTIONS.generated.md) is produced from this same runtime metadata and must not be edited directly.

- Keep ordinary descriptions to one or two short sentences. Omit OpenCode or AG2 rows when they have no practical effect in the detected environment.
- The primary bank must not expose issue or PR references, ownership terminology, raw runtime names, raw TOML keys, slot arithmetic, source identifiers, raw paths, backup paths, restore commands, or a helper-capacity row. Put any bounded legacy diagnostic detail only in an explicit migration or repair operation and its technical proposal.
- Automatic maintenance includes the clean Toolkit update source, automatic verified updates, meaningful report creation, and report retention. Failed or safety-blocked reports open automatically; successful reports stay closed. Report auto-open is not an ordinary question.
- Ordinary setup does not ask users to choose helper-agent quantities and does not perform RAM/resource admission, reservations, queue/refusal, checker scheduling, or native model-policy writes. Existing legacy Codex state is migration evidence only and cannot select a route; explicit legacy flags are retained only as bounded compatibility inputs and never authorize or force a launch. Exact route records and capability proofs fail closed when missing, contradictory, stale, or unsupported.
- Transactional legacy-config diagnostics remain isolated from active setup. A separate explicit advanced compatibility/repair operation may inspect exact owned blocks, preserve unrelated bytes, bind a proposal to the snapshot, and use the existing atomic backup/rollback/restore safeguards; ordinary setup preserves that state without adding a helper-capacity row. Inspection, planning, SessionStart, ordinary setup, and unapproved reads never repair or create a backup. No migration path becomes scheduling or model authority.
- Reject unexpected extra non-empty piped question-bank input for every host before any setup mutation. Whitespace-only trailing input remains empty after normalization.
- Claude Code, Codex, and OpenCode use the same exact-record boundary: resolve a role record, prove the host adapter can execute that record, then enter the existing bounded loop. No native child controller, memory admission, reservation queue, independent checker authority, or fixed worker/model binding is introduced by this skill. Root or parent ownership remains responsible for integration, validation, and final judgment.

After the complete bank is visible, exact `all recommended` explicitly approves every displayed recommendation. A changed-only response such as `1.2=B, 2.1=C` explicitly approves every displayed recommendation except the listed replacements. Unspecified entries therefore apply their displayed recommendation. Non-interactive and managed-continuation concise replies must prefix the command with the displayed privacy-safe bank reference; one canonical payload binds schema, host, ordered sections, stable and visible question identity, titles, what each question controls, displayed current/effective and verification state, availability, every recommendation and reason/outcome, every canonical choice and visible label/consequence, after-applying effects, and displayed selection/default behavior. Validation happens before any indexed mapping and rejects missing, malformed, truncated, stale, cross-host, reordered, or conditionally changed banks before writes. Advertise concise input only when every visible question is unresolved. If explicit flags resolved part of the bank, one canonical non-TTY answer plan renders unresolved question lines first, followed only by applicable custom-checkout or retention detail lines. Each detail binds its stable owner, visible reference when present, activation choice, validation contract, and privacy-safe description. Display choice-activated conditions before input, derive applicable entries after question answers, and consume them in that exact displayed order. Missing or misordered detail fails before writes, and drive, spaced, UNC, or file-URL-shaped detail text is never interpreted as a concise envelope. Reject concise input before mapping so it cannot override explicit selections. Fully explicit input neither waits for setup-question stdin nor advertises a reply guide. A live TTY gets one same-process concise-command stage after the complete bank and may press Enter for one-at-a-time prompts; malformed commands, invalid choices, and invalid detail values re-prompt. Stable question IDs and canonical choice values remain authoritative; presentation references are evidence, not persisted configuration identity. Empty, EOF, partial, malformed, mixed, duplicate, unavailable, or stale input never means all recommended. Existing canonical textual values, complete line-by-line input, explicit flags, and explicitly user-requested `--yes-recommended` remain supported. After the bank is answered, do not pause again for preference questions.

Allowed later blockers include dirty managed checkout, unexpected remote, fetch/auth failure, non-fast-forward update, validation failure, plugin cache verification failure, host hook trust required, unsupported/missing host CLI, unsafe Codex config topology/TOML, or unsafe OpenCode/AG2 target writes.

4. Start other bridge requests with a dry-run or audit command, usually:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --audit
```

The audit reports new-format owned staging generations separately from historical unmarked or unrelated matching directories. Never delete staging from its name, age, or dead PID alone. For one safely attributable generation reported as reconcilable, preview and then run only the exact approved generation:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --reconcile-staging <generation-id>
node repo/scripts/toolkit-local-bridge.cjs --reconcile-staging <generation-id> --write
```

Historical unmarked, malformed, mismatched, live, indeterminate, escaped, symlink, junction, reparse-point, and unrelated entries remain untouched.

5. Use `repo/scripts/setup-codex-toolkit-plugin.cjs` only through the managed checkout setup flow for Codex native plugin install/update verification. For Claude Code setup prompts, run the managed checkout setup command with `--host claude-code`, while keeping Claude Code's native plugin install/trust flow host-local. Use `repo/scripts/toolkit-local-bridge.cjs` for shared bridge setup, repo auto-update enablement, sync, audit, disable, stale-state recovery, and troubleshooting. Use `repo/scripts/repair-codex-plugin-windows-hooks.cjs` only for post-install Windows hook audit/repair of an installed Codex plugin root.

On Windows, do **not** rely on bare `codex`; it can resolve to a non-runnable WindowsApps alias. Use `setup-codex-toolkit-plugin.cjs --codex-cli "%USERPROFILE%\.codex\plugins\.plugin-appserver\codex.exe"` when an explicit CLI path is needed.

6. Before final response after setup, report the active worktree path and commit if inspected, managed checkout path and commit, exact setup script path executed, whether the question bank appeared, and the exact Codex delegation state. Before final response after repo changes, run the relevant validators or tests for the touched surface.

## Legacy configuration safety

- Active setup never writes Codex or Claude worker limits, scheduler settings, reservations, queues, refusal policy, checker policy, or model bindings. Legacy identifiers are retained only for migration detection, historical evidence, and repair diagnostics; they cannot select a route.
- The separate legacy-config migration code may inspect exact owned blocks, preserve unrelated bytes, and use the existing snapshot/lease/atomic-backup/rollback/restore safeguards. Structural ambiguity, unsupported tables, mixed ownership, drift, special files, and every unverifiable case fail closed. Ordinary setup, plan, SessionStart, and unapproved reads never repair or create a backup.
- Current execution uses the versioned role registry, an exact resolved launch record, and a capability-only host adapter before the bounded execution loop. The final bridge audit still runs before ordinary setup completion; it is not a scheduling or model gate.

## Safety Rules

- OpenCode uses the required native Toolkit plugin migration path. AG2 is skills-only and opt-in only after supported read-only destination proof; no AG2 Toolkit plugin or Gemini instruction surface is installed.
- Detection is allowed; autosetup is forbidden.
- Sync only enabled targets.
- Disabled or never-enabled targets must not be touched.
- Repo auto-update must validate the configured Toolkit repo and expected remote, refuse dirty worktrees without stashing or switching, auto-switch only the managed clean checkout back to the configured branch, fast-forward update, and run hook-light validation before enabled-target sync.
- Codex plugin cache auto-refresh is Codex-only. When enabled, startup hooks may refresh stale Codex Toolkit plugin cache content only from the configured managed `main` repo after repo validation and delegated target sync succeed. On Windows, the same opt-in inventories n8n cache identity independently of the legacy hook-manifest path, prefers `codex plugin list --available --json` to select the single installed and enabled `n8n-skills@n8n-io` version/root, and reconciles only a known supported version/layout with the existing Toolkit wrapper. CLI omission is not uninstall proof: explicit enabled config plus exactly one cache candidate may select the fallback target; explicit disabled config leaves retained caches untouched; absent, malformed, or multi-candidate state fails closed. Retained historical caches and unrelated plugins are skipped. Missing, moved, ambiguous, unknown, or malformed current layouts fail closed and require upstream compatibility review.
- Startup hooks may also run a passive repo-local instruction preflight for the current working directory. Codex checks `AGENTS.md`; Claude Code checks `AGENTS.md` and `CLAUDE.md`. The preflight may compare expected `AI-AGENT-TOOLKIT` managed block content against bundled repo-local templates, but it must only warn and must not write, repair, back up, create, or refresh instruction files. When findings exist, pause and ask whether to run `repository-agent-rules` check/repair/refresh now or proceed with the current task despite the warning.
- Claude Code plugin cache refresh is Claude-Code-only. If it cannot be automated, report the verified metadata/cache status and the exact manual Claude Code native plugin action required.
- Meaningful update activity should write an update report when reports are enabled; no-op updates should print concise status instead of spamming reports. A central classification opens only reports requiring action, including validation, fetch/update, dirty-checkout, remote-mismatch, target-sync, native-cache refresh, hook-repair, rollback, or restoration failures. Successful updates, refreshes, repairs, and syncs remain closed. Legacy persisted all-report auto-open state is migrated to this failure-only behavior, and compatibility flags never restore success-report auto-opening.
- Toolkit-managed update reports/logs older than 7 days are cleaned up best-effort from the Toolkit-managed report/log directory only. Cleanup failures should warn but not block setup or agent startup.
- Do not run npm, pip, package installs, or dependency installers from this skill.
- In Codex, the only allowed marketplace operation in this flow is the Codex-only local Toolkit plugin install/update path through `setup-codex-toolkit-plugin.cjs --write` or equivalent Codex local marketplace commands.
- In Claude Code, use Claude Code's native Toolkit plugin flow and do not call Codex marketplace commands.
- After a requested Codex plugin install or update on Windows, repair that installed plugin root before approving hooks. If repair cannot make hooks safe, fail with the repair error instead of reporting success. Trusted Toolkit Codex startup hooks may repeat the exact supported `n8n-skills@n8n-io` repair when Codex plugin cache auto-refresh is enabled; other plugins require an explicit targeted install/repair flow.
- Do not mutate arbitrary project repos by default.
- Do not use Codex to update Claude Code or Claude Code to update Codex.
- Refuse downgrade unless the user explicitly requests `--force-downgrade` for recovery.
- Keep hooks optional and policy-light; critical policy must stay in docs, validators, and the shared updater.

## n8n Plugin Path Note

Official `n8n-io/skills` plugin setup is owned by n8n setup guidance. Marketplace registration alone is not installation. Verify `n8n-skills@n8n-io` is installed and enabled, not merely available. On Windows, repair and audit the current installed plugin cache path under `.codex/plugins/cache/n8n-io/n8n-skills/<version>` before trusting hooks. The current version must come from positive Codex installed state or the bounded single-candidate config/cache fallback, never cache directory ordering. Trusted Toolkit Codex startup hooks may repair an exactly recognised supported upstream layout again after future plugin updates when Codex plugin cache auto-refresh is enabled. Already repaired layouts are a no-op; retained historical caches are skipped; partially repaired, moved, ambiguous, malformed, or unknown current versions fail closed. Startup reconciliation proves repaired bytes for later hook discovery; it does not claim that Codex re-reads another plugin's already-discovered command during the same SessionStart event. After an upstream refresh, the deterministic pre-session path remains the approved Toolkit n8n repair before restarting Codex, and native UAT must record first-session behavior. Do not repair or audit temporary marketplace checkout paths such as `.codex/.tmp/marketplaces/n8n-io/plugins/n8n-skills`.

Route `repair n8n plugin`, `fix n8n skill hooks`, `repair the n8n Skills plugin`, and questions about n8n `.sh` hooks opening in VS Code to this bounded installed-plugin inspection/repair path. Before acting, distinguish the target:

1. Installed Codex `n8n-skills@n8n-io` cache: inspect the exact identity/version/layout and use the existing Windows hook reconciliation. The enabled Codex plugin-maintenance preference is standing permission only for the exact known-compatible transform.
2. Claude Code plugin: inspect and report through Claude Code's native plugin flow; Codex must not mutate Claude Code cache.
3. Toolkit source or canonical skill: follow repository ownership and regeneration rules, not installed-cache repair.
4. Consumer-repo `n8n-workflows/scripts/` helpers: route to the workspace helper ownership path; do not touch plugin caches.
5. Live n8n workflows, community nodes, Docker, or server operations: load the n8n safety/setup route and require its live-action approvals; do not trigger plugin-cache repair.

When the target is genuinely ambiguous, ask for the smallest numbered choice from the applicable targets above. Do not load every n8n or MCP skill merely because the word `n8n` appears.

The OpenCode native package and AG2 skills-only projection do not include official n8n plugin hooks, so target repo instructions must cue `using-n8n-skills`.

## Validation

For bridge or setup-surface changes, prefer targeted checks first:

```powershell
node repo/scripts/validate-toolkit.cjs
node --test repo/tests/toolkit-local-bridge-hook-light.test.cjs
node repo/scripts/validate-toolkit.cjs
```

Run `node --test repo/tests/toolkit-local-bridge.test.cjs` when the change affects bridge behavior, hooks, target sync semantics, repo auto-update behavior, report cleanup, host-native cache behavior, or before PR/release validation. Do not run local `npm run validate:all`; use the frozen targeted matrix and let hosted validation own that aggregate command.
