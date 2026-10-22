# Repo-Local Agent Instructions Playbook

Use this for `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.agents/rules`, managed markers, global rules, repo-local templates, shims, or `repository-agent-rules`.

## Source model

- `repo/contracts/agent-rules/global-rules.md`: generic rules for every session, installed by setup into each harness's user-level file (`repo/scripts/toolkit-global-rules.cjs`). Keep it short; it loads everywhere.
- `repo/contracts/agent-rules/toolkit-governed-rules.md`: the Toolkit-governed block. It opens this repository's root `AGENTS.md`, followed by the Toolkit-only rules written directly in that file, and is the portable template `skills/repository-agent-rules/repo-local/AGENTS.managed.template.md`.
- Shim and bootstrap templates under `repo/contracts/agent-rules/repo-local/` are their own source (the body between their markers) and are projected into the skill folder and the root shims.
- Byte budgets: the global block and root `AGENTS.md` together stay under Codex's 32 KiB project-doc limit with CRLF line endings (`repo/tests/instruction-budget.test.cjs`).

Edit the source, run `node repo/scripts/sync-agent-instruction-shims.cjs --write`, then the check.

## Markers

Every Toolkit insert uses `repo/scripts/toolkit-managed-block.cjs` markers (`BEGIN <NAME> v2 toolkit=<version> sha256=<12 hex>`). Keep pairs intact and edit the source named in the marker. Portable templates must not depend on Toolkit-only paths such as `repo/docs/agent-playbooks/`, `repo/scripts/` or source-watch records.

## Session reset

When `repository-agent-rules` installs or repairs instructions in a consumer repo, keep its session-reset prompt and backup behaviour.
