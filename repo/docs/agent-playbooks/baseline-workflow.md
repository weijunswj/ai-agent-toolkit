# Baseline Workflow Playbook

Use this only when the task is broad, ambiguous, high-blast-radius, explicitly asks for detailed workflow guidance, or continues a multi-PR programme.

## Operating Rules

- Inspect the relevant files before editing.
- Keep diffs narrow and source-owned.
- Prefer existing repo patterns and documented commands.
- Do not weaken validation, safety checks, schemas, attribution, or generated-output ownership.
- Update related docs when a workflow, setup, policy, or instruction contract changes.
- Run the smallest relevant validation first, then broader checks only when warranted.

## Multi-PR Programmes

- Default to one fresh Codex chat per focused PR. When practical, use the existing chat only for review, merge, and generating the next prompt. Do not keep implementing many PRs in one overloaded chat; two PRs may share a chat only when both are tiny and low-risk.
- Start a fresh chat after broad helper or script changes, repeated failed fixes or debugging loops, or a PR that changes many files (roughly more than 15). Also start fresh when generated surfaces, source projects, tests, and runtime scripts are all involved.
- Start a fresh chat before the next PR after large n8n, bridge, plugin, docs-cleanup, or validator work.
- Do not commit handoff, status, or report docs only to preserve chat context. Keep compact continuation state in the PR body and final response.
- Limit the next prompt to the repo, merged PRs relevant to the programme, the current next PR, operating constraints, and acceptance criteria. Once the programme is underway, do not paste the entire original `/goal` into every follow-up.

## Final Report

Report files changed, what changed, validation results, generated-output status when applicable, remaining risks, `Instruction sources used`, and `MEMORY.md changed: Yes/No`.
