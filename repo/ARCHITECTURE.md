# Toolkit Repository Map

A compact, pointer-only map of this repository. Rules live in [CONTROLLER.md](CONTROLLER.md), the root `AGENTS.md` and the sources named below; this file only says where things are. Update it in the change that moves what it describes; `repo/tests/repo-map.test.cjs` checks that every path listed here exists.

Last reviewed against `main` `51c6bbe`.

## Parts

| Part | Path | Owns |
|---|---|---|
| Skills | `skills/` | The copyable product: one folder per skill, edited directly |
| Agent-rule sources | `repo/contracts/agent-rules/` | Global rules, gate rules, governed-repository rules, n8n safety rules, skill routing |
| Repo-local templates | `repo/contracts/agent-rules/repo-local/` | Managed `AGENTS.md` template, the one-line `CLAUDE.md` and the Antigravity bootstrap, projected into `skills/repository-agent-rules/repo-local/` |
| Projects controller skill | `repo/contracts/claude-projects/web-controller-projects/` | Source of the Claude Projects coordinator skill and its `reference/` files, read by the coordinator from the copy pulled from the repo into the project library and saved on claude.ai from a skill card when it fits one, the managed project-instructions block it places and its scheduled task templates; never offered as a plugin skill |
| Controller kernel | `repo/contracts/controller-kernel/` | Stack registry, controller decision, gate IR and Codex adapter schemas |
| Bridge contract | `repo/contracts/toolkit-local-bridge/` | Package version and native plugin inputs |
| Lane map | `repo/contracts/lanes/lane-map.json` | Which files the Claude and Codex lanes own and which stay integration-owned |
| Scripts | `repo/scripts/` | Setup, bridge, hooks, synchronizers, audits and validators |
| Tests | `repo/tests/` | Focused contract and runtime tests, run by `repo/scripts/run-tests.cjs` from the shard manifest `repo/contracts/ci/test-shards.json` |
| Docs | `repo/docs/` | Human and agent docs, routed by `repo/docs/agent-playbooks/INDEX.md` |
| Provenance | `repo/source-watch/` | Third-party source locks and the notification-only source watch |
| Native plugins | `.claude-plugin/`, `.codex-plugin/` | Claude Code and Codex plugin metadata and hooks |
| CI | `.github/workflows/` | `validate.yml` is the full gate: test shards on Linux and Windows, the full `hook-pack` job on Linux and the `hook-pack-windows` job on Windows (the nine families in four groups) and the `personal-data` check (config `.github/personal-data-guard.json`), then the `validate` job checks and verifies them (the Windows shards include the env store tests on the real Credential Manager); it runs again when a pull request's title or body is edited. |

## Entry points

| Entry | Path |
|---|---|
| Setup (`setup toolkit`) | `repo/scripts/setup-toolkit.cjs`, `repo/scripts/setup-toolkit-core.cjs` (shared core), `repo/scripts/setup-core-claude.cjs`, `repo/scripts/setup-core-codex.cjs` |
| Native plugin install | `repo/scripts/setup-claude-toolkit-plugin.cjs`, `repo/scripts/setup-codex-toolkit-plugin.cjs` |
| Session-start hooks and bridge | `repo/scripts/toolkit-local-bridge.cjs`, `repo/scripts/toolkit-codex-session-start.cjs` |
| Install check | `repo/scripts/toolkit-install-health.cjs`, `repo/scripts/toolkit-claude-account-copy.cjs` (the Claude app copy steps, shared with the session-start reminder and the daily check-in); Codex's Toolkit state and bundle fingerprint, read from the Codex files only, in `repo/scripts/toolkit-codex-install-state.cjs` (`--check` also asks the Codex the gate will run, named with `--codex`, once through its app-server, and holds gate launches until the files and that Codex agree every hook is on) |
| Typed commands (`toolkit cmd`, the other phrases both prompt hooks match exactly, and the `toolkit governance <subcommand>` phrases) and the command list | `repo/scripts/toolkit-commands.cjs` |
| Report-only scan for Toolkit files left in repositories with governance off | `repo/scripts/toolkit-leftover-files.cjs` |
| Keys and tokens (`toolkit env`) | `repo/scripts/toolkit-env.cjs`, `repo/scripts/toolkit-env-store.cjs`, `repo/scripts/toolkit-env-feeders.cjs`, `repo/scripts/toolkit-env-editor.cjs` |
| Global rules installer | `repo/scripts/toolkit-global-rules.cjs` |
| Managed marker format | `repo/scripts/toolkit-managed-block.cjs` |
| Hook test pack (every hook run as the hosts start it, against one list of calls that must pass or stop) | `repo/scripts/toolkit-hook-pack.cjs` (runner, revert proof and expectation-change check), `repo/tests/hook-pack/corpus/` (the rows), `repo/tests/hook-pack/README.md` (row format) |
| Helper hooks | `repo/scripts/toolkit-claude-agent-hook.cjs`, `repo/scripts/toolkit-codex-helper-hook.cjs` |
| Governance gate hooks (hold prompts and tools until a repository has a decision) | `repo/scripts/toolkit-governance-gate.cjs` (the gate), `repo/scripts/toolkit-governance-answer.cjs` (records the user's reply the agent read, under a one-use reply ticket), `repo/scripts/toolkit-governance-hook.cjs` (Claude Code), `repo/scripts/toolkit-codex-helper-hook.cjs` and `repo/scripts/toolkit-codex-session-start.cjs` (Codex) |
| Helper route guard and adapter | `repo/scripts/toolkit-v3-helper-guard.cjs`, `repo/scripts/toolkit-v3-native-helper-adapter.cjs` (shared core), `repo/scripts/toolkit-v3-native-helper-adapter-claude.cjs`, `repo/scripts/toolkit-v3-native-helper-adapter-codex.cjs` |
| Claude helper agents | `repo/scripts/toolkit-claude-helper-agents.cjs`, `repo/scripts/toolkit-claude-helper-spec.cjs`, `repo/scripts/toolkit-claude-task-session.cjs` |
| Version bump | `repo/scripts/bump-version.cjs` (`--next patch\|minor\|major`, run by the merging agent at merge time; folds notes from `repo/docs/changelog.d/`) |
| Reconcile older open PRs that already carry a bump after main moves | `repo/scripts/toolkit-rebump-prs.cjs` (re-bump workflow, merging agent or requested computer lane; report by default, `--apply` prepares and fast-forwards eligible branches) |
| Land several reviewed PRs with one bump and one CI run (merge train) | `repo/scripts/toolkit-merge-train.cjs` (`build`, `catchup`, `verify`, `body`, `split`, `land`, `eject`; never merges; rules in `repo/controller/evidence-and-finish.md` and `repo/docs/changelog.d/README.md`) |
| Risk tier of a change | `repo/scripts/toolkit-risk-tier.cjs`, this repository's list `.github/toolkit-risk-tiers.json` |
| Shell session check (two booleans, no authority) | `repo/scripts/toolkit-session-shell-check.cjs`; meaning and installed-shell qualification in the [host contract](docs/HOST-CONTRACT.md#check-what-a-shell-received) |
| Leftover worktrees and merged branches (read-only list) | `repo/scripts/workspace-residue-report.cjs` |
| Instruction sync | `repo/scripts/sync-agent-instruction-shims.cjs`, `repo/scripts/sync-repo-doc-contract.cjs`, `repo/scripts/sync-controller-pages.cjs` |
| Full validation list | `repo/scripts/run-validation-gate.cjs` |
| Plain-text check | Portable check `skills/secure-ci-cd/scripts/plain-text-check.cjs` and installer `skills/secure-ci-cd/scripts/install-plain-text-check.cjs`; Toolkit runs it through `repo/scripts/check-plain-references.cjs` (run by `validate-toolkit.cjs`) with settings `.github/plain-text.json` and baseline `repo/contracts/plain-references/baseline.json` |
| Projects instructions block | `repo/scripts/toolkit-projects-instructions.cjs`, source `repo/contracts/claude-projects/web-controller-projects/project-instructions.md` |
| Projects guidebook (library copy of the skill the coordinator reads) | `repo/scripts/toolkit-projects-guidebook.cjs`, copied from `repo/contracts/claude-projects/web-controller-projects/`; it also copies and checks the canonical takeover `repo/docs/agent-playbooks/controller-takeover.md` as `takeover.md` |
| Projects scheduled task prompts (stored as pointers, expanded from main each run) | `repo/scripts/toolkit-projects-tasks.cjs`, templates `repo/contracts/claude-projects/web-controller-projects/tasks/`, setup inventory `repo/contracts/claude-projects/web-controller-projects/setup-inventory.json` |
| Shared programme lock (built-ins only, unchanged record format; shared by programme and cleaner/apply owners) | `skills/github-program-reconciler/scripts/programme-lock.cjs`; scheduled jobs serialise store writes through `repo/scripts/toolkit-programme-lock.cjs` |
| Shared executable resolution | `skills/github-program-reconciler/scripts/resolve-executable.cjs` |
| Decision-trace audit | `skills/github-program-reconciler/scripts/decision-trace-audit.cjs` |
| Comment tags and G0 decision history | `skills/github-program-reconciler/scripts/decision-tags.cjs`, `skills/github-program-reconciler/scripts/decision-history.cjs` |
| Personal-data guard and installer | `skills/secure-ci-cd/scripts/personal-data-guard.cjs`, `skills/secure-ci-cd/scripts/install-personal-data-guard.cjs` |
| Governance state (`toolkit-governance.cjs`) | `repo/scripts/toolkit-governance-state.cjs` (the one state function), `repo/scripts/toolkit-governance.cjs` (CLI), `repo/scripts/toolkit-governance-conformance.cjs`, `repo/scripts/toolkit-governance-migration.cjs`, `repo/scripts/toolkit-governance-ruleset.cjs`, `repo/scripts/toolkit-governance-protection.cjs` (default-branch protection) |
| Task auto-merge (one switch per repository: `task_prs.auto_merge` in the merged binding; enabled governance required) | `repo/scripts/toolkit-governance-state.cjs` (`taskAutoMerge`, shared by reporting and enforcement, and `retireLegacyTaskAnswers`, which removes older per-app answers once the switch is read back), `repo/scripts/toolkit-governance.cjs` (`setup` and `refresh`, which show the switch and prepare a change as one binding pull request), `skills/github-program-reconciler/scripts/programme-state.cjs` and `repo/contracts/programme-state/binding-v2.schema.json` (the key), `repo/scripts/toolkit-merge-hold.cjs` (the pinned merge it lets through, after the scope check), `repo/scripts/toolkit-auto-merge-eligible.cjs` (the merge-authority list that waits for a typed merge, and the reader of the pull request body's `UAT:` line), `repo/contracts/agent-rules/gate-rules.md` (when the controller merges) |
| Programme state and reconcile pass | `skills/github-program-reconciler/scripts/programme.cjs`, `skills/github-program-reconciler/scripts/programme-state.cjs`; pure page archive grammar and formatting in `skills/github-program-reconciler/scripts/programme-page-archive.cjs`; pure task page layout in `skills/github-program-reconciler/scripts/programme-page-layout.cjs` |
| Programme sweep: saved queue, request budget, shared lease and cloud tokens | The reconciler in `skills/github-program-reconciler/scripts/programme-state.cjs` plans the queued pass and owns snapshot reads and the one state commit; `skills/github-program-reconciler/scripts/programme-sweep.cjs` (serial request budget), `skills/github-program-reconciler/scripts/programme-sweep-lease.cjs` (cross-host lease and its record), `skills/github-program-reconciler/scripts/programme-installation.cjs` (the cloud run's per-repository App tokens) |
| Cloud jobs (governance GitHub App) and the cloud programme sweep | `repo/contracts/cloud-jobs.json` (each job's tokens and which App permissions they take), `repo/scripts/toolkit-cloud-jobs.cjs` (reader and job guide; the App, its one permission list and their names are `repo/scripts/toolkit-governance-app.cjs`), `repo/scripts/toolkit-programme-sweep-action.cjs`, `repo/scripts/toolkit-programme-sweep-gate.cjs` (the near-free gate and the follow-up), `.github/workflows/toolkit-programme-sweep.yml`, `.github/workflows/toolkit-programme-sweep-gate.yml`, `repo/scripts/toolkit-cloud-workflows.cjs` (pinned copies of both workflows for other governed repositories; the render itself is `repo/scripts/toolkit-cloud-workflows-render.cjs`) |
| Parent closure safety and lifecycle | `skills/github-program-reconciler/scripts/issue-closure.cjs` (parser and bounded native-tree reads), `repo/scripts/toolkit-issue-closure.cjs` (pre-write hooks and read-only CI); the fenced reconciler owns parent repair and completion under the merged binding's explicit policy |
| Old Windows scheduled tasks, retired: setup creates none and names leftovers for `remove toolkit`; a task that still fires runs the retired stub `repo/scripts/toolkit-scheduled-job.cjs`, and `toolkit update scheduled task` only says it is retired. The task code stays until the clean-up that deletes it | `repo/scripts/toolkit-windows-tasks.cjs` (the only code that changes Windows tasks), `repo/scripts/setup-toolkit-core.cjs` (scoped setup removal), `repo/scripts/toolkit-scheduled-job.cjs`, `repo/scripts/toolkit-tasks.cjs`, `repo/scripts/toolkit-task-shape.cjs` (pure confirmed-shape selection), `repo/scripts/toolkit-task-policy.cjs` (shared independent-job command boundary), `repo/scripts/toolkit-task-schedule.cjs` (stable minutes and local computer ownership), `repo/scripts/toolkit-update-scheduled-task.cjs` (`toolkit update scheduled task` plan and approved apply), `repo/scripts/toolkit-task-health.cjs` (TASK HEALTH, shared per repository's own evidence store), `repo/scripts/toolkit-task-launcher.cjs` (launcher safety net), `repo/scripts/toolkit-remove.cjs` (`remove toolkit`: a read-only plan for the whole computer, then removal of exactly that list through the same scheduler after the owner's OK); registry `~/.ai-agent-toolkit/user-state/tasks.json`, stable local identity `~/.ai-agent-toolkit/user-state/task-computer.json`, checkout refresh serialisation and deferred local-store catch-up after writer lock release |
| One-time permission blocks (printed for the owner to paste or merge with `--apply` in their own terminal; agents write them only on the owner's own ask and never run `--apply`), the self-checking evidence store command and checked scratch cleanup | `repo/scripts/toolkit-permissions.cjs` (print and check only; `--apply` hands over to `repo/scripts/toolkit-permissions-apply.cjs`, the owner's own backed-up merge, refused in agent shells), `repo/scripts/toolkit-store.cjs` (bound store, secret scan of what it commits, plain push of the bound branch), `repo/scripts/toolkit-cleanup.cjs` (scratch roots, merged local branches, evidence store read-back first) |
| Cloud "Generated by Claude Code" footer: after-tool hook and selected programme/footer-only device sweep | `repo/scripts/toolkit-github-footer-guard.cjs`, `repo/scripts/toolkit-github-footer-hook.cjs`, `repo/scripts/toolkit-github-footer-sweep.cjs` |
| Executor checkpoint journals, after-write programme refresh, and the turn-end and after-tool hook | `skills/github-program-reconciler/scripts/programme-checkpoint.cjs`, `skills/github-program-reconciler/scripts/programme-refresh-trigger.cjs`, `repo/scripts/toolkit-programme-checkpoint-hook.cjs`, `repo/scripts/toolkit-programme-checkpoint-hook.ps1` |

Host config writes reuse `repo/scripts/codex-app-server.cjs` and share `repo/scripts/codex-config-load-check.cjs` (Codex effective-load check and rollback) and `repo/scripts/host-json-config-write.cjs` (Claude JSON read-back and rollback); see [host config writes](docs/agent-playbooks/host-config-writes.md).

## Sources of truth

| Subject | Source |
|---|---|
| Controller procedure | `repo/CONTROLLER.md` (the core) and the pages it lists under `repo/controller/`, kept in step by `repo/scripts/sync-controller-pages.cjs`; what enforces each rule: `repo/contracts/agent-rules/controller-enforcement-map.json`, checked by `repo/scripts/check-controller-enforcement-map.cjs`; generic takeover, capability routes and relay formats: `repo/docs/agent-playbooks/controller-takeover.md` |
| Programme direction | `repo/docs/TOOLKIT-DELIVERY.md` |
| Global rules (every harness session) | `repo/contracts/agent-rules/global-rules.md` |
| Gate rules (gate sessions and their controllers) | `repo/contracts/agent-rules/gate-rules.md` |
| Governed-repository rules | `repo/contracts/agent-rules/toolkit-governed-rules.md` |
| Models, effort and reviewers | `repo/contracts/controller-kernel/stack-registry-v3.json` |
| Source ownership | `repo/contracts/source-of-truth-contract.md` |
| Package version | `repo/contracts/toolkit-local-bridge/version.json`, read at runtime through `repo/scripts/toolkit-version.cjs` |
| Programme binding and state document schemas | `.github/toolkit-programme.json`, `repo/contracts/programme-state/` |
| Host needs for programme custody | `repo/docs/HOST-CONTRACT.md`, `repo/contracts/programme-state/host-contract-v1.json` |
| Repository governance decisions | Origin default-branch `.github/toolkit-programme.json`; `repo/scripts/toolkit-governance-binding.cjs` (observations), `repo/scripts/toolkit-governance-proposal.cjs` (pending requests and publication), `repo/scripts/toolkit-repository-identity.cjs` (identity), `repo/scripts/toolkit-user-state.cjs` (operational state directory) |
| Stored native host results (helper route) | `repo/contracts/host-qualification/claude-code.json` |
| Release notes | `repo/docs/CHANGELOG.md` |

## Ownership

The repository owner approves merges, releases and live effects. The appointed controller owns programme records and review routing (the programme parent issue named in `.github/toolkit-programme.json`); builders own their admitted change through UAT readiness.

Closing stories and bounded gap scans: `skills/github-program-reconciler/scripts/closing-comments.cjs`, composed by `skills/github-program-reconciler/scripts/programme-state.cjs` and its CLI; the parent intent journal owns backstop posts. Agent guidance: `skills/repository-agent-rules/repo-local/docs/agent-playbooks/closing-comments.md`.
