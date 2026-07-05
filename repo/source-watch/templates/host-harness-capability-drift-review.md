# Host Harness Capability Drift Review

Review date:
Reviewer:
Host/version reviewed:

## Evidence Table

| Native host capability observed | Source/evidence | Toolkit component affected | Duplication/conflict risk | Recommendation | Validation needed |
| --- | --- | --- | --- | --- | --- |
|  |  |  |  | Keep / Shrink / Move to hook / Move to host-native feature / Delete / Needs benchmark/eval before decision |  |

## Required Scope

- Codex / OpenAI Codex docs or changelog.
- Claude Code docs or changelog.
- Existing toolkit `skills/**`, root instructions, hooks/plugin metadata, repo-map guidance, `MEMORY.md` guidance, and documentation-cleanup guidance.

## Decision Rules

- Do not auto-delete or auto-modify toolkit components from the source-watch PR.
- If no meaningful drift is found, update only the advisory review/status record in a separate PR.
- If meaningful drift is found, open a separate PR with evidence, rationale, exact proposed modifications, and validation.
- Use `Needs benchmark/eval before decision` when the host feature may be equivalent but behavior or token impact is not yet proven.
