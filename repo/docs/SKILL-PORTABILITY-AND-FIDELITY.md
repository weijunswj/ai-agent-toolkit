# Skill Portability And Fidelity

This repo publishes skills as folder packages.

A skill folder must contain enough local context to be useful when copied into an agent environment. The install unit is the whole `skills/<skill-name>/` folder, not only `SKILL.md`.

## Portability Rules

- `README.md` is for human install and use notes.
- `SKILL.md` is the agent entrypoint.
- Longer required runtime context should live in local files such as `references/`, `examples/`, `templates/`, `agents/`, `tools/`, or other clearly named support folders.
- Helper scripts, examples, templates, and configuration snippets that are required for normal use should stay inside the skill folder.
- External links may support provenance or further reading.
- External links must not be required for normal skill execution.
- A copied skill folder should not require the user or agent to understand the rest of this repository before the skill can be used.

## Fidelity Rules

- Published skill content must not be a lossy replacement for the source document.
- A generated or public surface must not replace a full working guide with a short summary.
- Summaries are allowed only as catalogues, descriptions, navigation tables, or clearly marked overview files.
- Required instructions, references, examples, templates, and helper files must stay local to the skill or trace back to declared project source.
- `SKILL.md` should be concise but operational. It may route to local references instead of duplicating long instructions inline.

## Routing Fidelity Values

Project routing manifests may use `fidelity` to make publishing intent explicit:

| Value | Meaning |
|---|---|
| `exact` | Copied without truncation or summarisation. |
| `reviewed_entrypoint` | Reviewed skill or MCP entrypoint text, not a lossy substitute for the source. |
| `catalogue_summary` | Short catalogue, table, registry description, or navigation summary only. |
| `generated_metadata` | Machine-readable metadata generated from source declarations. |

Use `catalogue_summary` only for catalogues, descriptions, navigation tables, or overview files. Do not use it as the only copy of required runtime instructions.

## Audit

Run:

```powershell
node repo/scripts/audit-skill-portability.cjs
```

The audit is deterministic. It checks for skill entrypoints, human install notes, missing local references from `SKILL.md`, thin/link-only skills, placeholder-only local references, required runtime context that appears to exist only behind external URLs, and old removed skill paths.
