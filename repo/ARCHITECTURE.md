# Toolkit Repository Map

A compact, pointer-only map of this repository. Rules live in [CONTROLLER.md](CONTROLLER.md), the root `AGENTS.md` and the sources named below; this file only says where things are. Update it in the change that moves what it describes; `repo/tests/repo-map.test.cjs` checks that every path listed here exists.

Last reviewed against `main` `9b7ffff3c30078c2290c809d20bc7c49e3f96e8d`.

## Parts

| Part | Path | Owns |
|---|---|---|
| Skills | `skills/` | The copyable product: one folder per skill, edited directly |
| Agent-rule sources | `repo/contracts/agent-rules/` | Global rules, governed-repository rules, n8n safety rules, skill routing |
| Repo-local templates | `repo/contracts/agent-rules/repo-local/` | Managed `AGENTS.md` template, the one-line `CLAUDE.md` and the Antigravity bootstrap, projected into `skills/repository-agent-rules/repo-local/` |
| Projects controller skill | `repo/contracts/claude-projects/web-controller-projects/` | Source of the Claude Projects coordinator skill, uploaded to claude.ai by hand; never offered as a plugin skill |
| Controller kernel | `repo/contracts/controller-kernel/` | Stack registry, controller decision, gate IR and Codex adapter schemas |
| Bridge contract | `repo/contracts/toolkit-local-bridge/` | Package version and native plugin inputs |
| Lane map | `repo/contracts/lanes/lane-map.json` | Which files the Claude and Codex lanes own and which stay integration-owned |
| Scripts | `repo/scripts/` | Setup, bridge, hooks, synchronizers, audits and validators |
| Tests | `repo/tests/` | Focused contract and runtime tests, run by `repo/scripts/run-tests.cjs` from the shard manifest `repo/contracts/ci/test-shards.json` |
| Docs | `repo/docs/` | Human and agent docs, routed by `repo/docs/agent-playbooks/INDEX.md` |
| Provenance | `repo/source-watch/` | Third-party source locks and the notification-only source watch |
| Native plugins | `.claude-plugin/`, `.codex-plugin/` | Claude Code and Codex plugin metadata and hooks |
| CI | `.github/workflows/` | `validate.yml` is the full gate: test shards on Linux and Windows and the `personal-data` check (config `.github/personal-data-guard.json`), then the `validate` job checks and verifies them (the Windows shards include the env store tests on the real Credential Manager) |

## Entry points

| Entry | Path |
|---|---|
| Setup (`setup toolkit`) | `repo/scripts/setup-toolkit.cjs`, `repo/scripts/setup-toolkit-core.cjs` |
| Native plugin install | `repo/scripts/setup-claude-toolkit-plugin.cjs`, `repo/scripts/setup-codex-toolkit-plugin.cjs` |
| Session-start hooks and bridge | `repo/scripts/toolkit-local-bridge.cjs`, `repo/scripts/toolkit-codex-session-start.cjs` |
| Install check | `repo/scripts/toolkit-install-health.cjs` |
| Keys and tokens (`toolkit env`) | `repo/scripts/toolkit-env.cjs`, `repo/scripts/toolkit-env-store.cjs`, `repo/scripts/toolkit-env-feeders.cjs` |
| Global rules installer | `repo/scripts/toolkit-global-rules.cjs` |
| Managed marker format | `repo/scripts/toolkit-managed-block.cjs` |
| Helper hooks | `repo/scripts/toolkit-claude-agent-hook.cjs`, `repo/scripts/toolkit-codex-helper-hook.cjs` |
| Helper route guard and adapter | `repo/scripts/toolkit-v3-helper-guard.cjs`, `repo/scripts/toolkit-v3-native-helper-adapter.cjs` (shared core), `repo/scripts/toolkit-v3-native-helper-adapter-claude.cjs`, `repo/scripts/toolkit-v3-native-helper-adapter-codex.cjs` |
| Claude helper agents | `repo/scripts/toolkit-claude-helper-agents.cjs`, `repo/scripts/toolkit-claude-helper-spec.cjs`, `repo/scripts/toolkit-claude-task-session.cjs` |
| Version bump | `repo/scripts/bump-version.cjs` |
| Instruction sync | `repo/scripts/sync-agent-instruction-shims.cjs`, `repo/scripts/sync-repo-doc-contract.cjs` |
| Full validation list | `repo/scripts/run-validation-gate.cjs` |
| Plain-references check | `repo/scripts/check-plain-references.cjs` (run by `validate-toolkit.cjs`), baseline `repo/contracts/plain-references/baseline.json` |
| Shared executable resolution | `skills/github-program-reconciler/scripts/resolve-executable.cjs` |
| Decision-trace audit | `skills/github-program-reconciler/scripts/decision-trace-audit.cjs` |
| Personal-data guard and installer | `skills/secure-ci-cd/scripts/personal-data-guard.cjs`, `skills/secure-ci-cd/scripts/install-personal-data-guard.cjs` |
| Programme state and reconcile pass | `skills/github-program-reconciler/scripts/programme.cjs`, `skills/github-program-reconciler/scripts/programme-state.cjs` |
| Executor checkpoint journals and turn-end hook | `skills/github-program-reconciler/scripts/programme-checkpoint.cjs`, `repo/scripts/toolkit-programme-checkpoint-hook.cjs`, `repo/scripts/toolkit-programme-checkpoint-hook.ps1` |

## Sources of truth

| Subject | Source |
|---|---|
| Controller procedure | `repo/CONTROLLER.md` |
| Programme direction | `repo/docs/TOOLKIT-V3.md` |
| Global rules (every harness session) | `repo/contracts/agent-rules/global-rules.md` |
| Governed-repository rules | `repo/contracts/agent-rules/toolkit-governed-rules.md` |
| Models, effort and reviewers | `repo/contracts/controller-kernel/stack-registry-v3.json` |
| Source ownership | `repo/contracts/source-of-truth-contract.md` |
| Package version | `repo/contracts/toolkit-local-bridge/version.json`, read at runtime through `repo/scripts/toolkit-version.cjs` |
| Programme binding and state document schemas | `.github/toolkit-programme.json`, `repo/contracts/programme-state/` |
| Host needs for programme custody | `repo/docs/HOST-CONTRACT.md`, `repo/contracts/programme-state/host-contract-v1.json` |
| Release notes | `repo/docs/CHANGELOG.md` |

## Ownership

The repository owner approves merges, releases and live effects. The appointed controller owns programme records and review routing ([programme #421](https://github.com/weijunswj/ai-agent-toolkit/issues/421)); builders own their admitted change through UAT readiness.
