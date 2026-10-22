# Toolkit Repository Map

A compact, pointer-only map of this repository. Rules live in [CONTROLLER.md](CONTROLLER.md), the root `AGENTS.md` and the sources named below; this file only says where things are. Update it in the change that moves what it describes; `repo/tests/repo-map.test.cjs` checks that every path listed here exists.

Last reviewed against `main` `1478dadaafb65cd5573a929f263cffbdbcc333b2`.

## Parts

| Part | Path | Owns |
|---|---|---|
| Skills | `skills/` | The copyable product: one folder per skill, edited directly |
| Agent-rule sources | `repo/contracts/agent-rules/` | Global rules, governed-repository rules, n8n safety rules, skill routing |
| Repo-local templates | `repo/contracts/agent-rules/repo-local/` | Managed `AGENTS.md` template and host shims, projected into `skills/repository-agent-rules/repo-local/` |
| Controller kernel | `repo/contracts/controller-kernel/` | Stack registry, controller decision, gate IR and Codex adapter schemas |
| Bridge contract | `repo/contracts/toolkit-local-bridge/` | Package version and native plugin inputs |
| Scripts | `repo/scripts/` | Setup, bridge, hooks, synchronizers, audits and validators |
| Tests | `repo/tests/` | Focused contract and runtime tests (`node --test repo/tests/*.test.cjs`) |
| Docs | `repo/docs/` | Human and agent docs, routed by `repo/docs/agent-playbooks/INDEX.md` |
| Provenance | `repo/source-watch/` | Third-party source locks and the notification-only source watch |
| Native plugins | `.claude-plugin/`, `.codex-plugin/` | Claude Code and Codex plugin metadata and hooks |
| CI | `.github/workflows/` | `validate.yml` is the full gate; `env-store.yml` runs the env store tests on Windows and macOS |

## Entry points

| Entry | Path |
|---|---|
| Setup (`setup toolkit`) | `repo/scripts/setup-toolkit.cjs`, `repo/scripts/setup-toolkit-core.cjs` |
| Session-start hooks and bridge | `repo/scripts/toolkit-local-bridge.cjs`, `repo/scripts/toolkit-codex-session-start.cjs` |
| Install check | `repo/scripts/toolkit-install-health.cjs` |
| Keys and tokens (`toolkit env`) | `repo/scripts/toolkit-env.cjs`, `repo/scripts/toolkit-env-store.cjs`, `repo/scripts/toolkit-env-feeders.cjs` |
| Global rules installer | `repo/scripts/toolkit-global-rules.cjs` |
| Managed marker format | `repo/scripts/toolkit-managed-block.cjs` |
| Helper hooks | `repo/scripts/toolkit-claude-agent-hook.cjs`, `repo/scripts/toolkit-codex-helper-hook.cjs` |
| Instruction sync | `repo/scripts/sync-agent-instruction-shims.cjs`, `repo/scripts/sync-repo-doc-contract.cjs` |
| Full validation list | `repo/scripts/run-validation-gate.cjs` |
| Decision-trace audit | `skills/github-program-reconciler/scripts/decision-trace-audit.cjs` |

## Sources of truth

| Subject | Source |
|---|---|
| Controller procedure | `repo/CONTROLLER.md` |
| Programme direction | `repo/docs/TOOLKIT-V3.md` |
| Global rules (every harness session) | `repo/contracts/agent-rules/global-rules.md` |
| Governed-repository rules | `repo/contracts/agent-rules/toolkit-governed-rules.md` |
| Models, effort and reviewers | `repo/contracts/controller-kernel/stack-registry-v3.json` |
| Source ownership | `repo/contracts/source-of-truth-contract.md` |
| Package version | `repo/contracts/toolkit-local-bridge/version.json` |
| Release notes | `repo/docs/CHANGELOG.md` |

## Ownership

The repository owner approves merges, releases and live effects. The appointed controller owns programme records and review routing ([programme #421](https://github.com/weijunswj/ai-agent-toolkit/issues/421)); builders own their admitted change through UAT readiness.
