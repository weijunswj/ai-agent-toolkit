# Project Module Standard

Project modules are the source-of-truth layer for reusable toolkit inputs.

```text
projects/<category>/<project-name>/
  README.md
  toolkit.project.json
  SOURCE-MANIFEST.md
  main/
  exports/
  _generated/
```

## Folder Roles

- `projects/` keeps reusable source projects inside the toolkit without burying consumer-facing outputs.
- `main/` preserves actual project/source files with original names and structure where practical.
- `exports/` contains curated source material used to generate or update root-level surfaces.
- `_generated/` is optional preview output only and is not source of truth.

Do not use `original/` or `derived/` as the standard project pattern. Do not truncate big source guides when preserving them in `main/`. If a file is shortened, label it as an export, summary, quickstart, or generated surface.

Project `main/templates/**` folders are preserved source only. Project `exports/templates/**` folders are the source for root toolkit templates. Root template outputs, such as [templates/agent-rules/AGENTS.md](../templates/agent-rules/AGENTS.md), are generated consumer-facing files.

## Root-Level Surfaces Stay Separate

These root folders remain obvious for consumers:

- [skills/](../skills/) for instruction-only AI-agent behavior layers.
- [mcp/](../mcp/) for safe MCP specs and project discovery docs.
- [templates/](../templates/) for ready-to-copy template material.
- [packs/](../packs/) for approval-gated install/review bundles.
- [tools/](../tools/) for optional executable tooling.
- [registry/](../registry/) for machine-readable discovery.
- [guides/](../guides/) for human-friendly quickstarts and canonical guides.
- [docs/](../docs/) for policy, standards, safety, and architecture docs.

## Export Mapping

Project exports feed root-level outputs:

- `projects/**/exports/skills/*.md` -> `skills/**/SKILL.md`
- `projects/**/exports/mcp/*.md` -> `mcp/**`
- `projects/**/exports/templates/**` -> `templates/**`
- `projects/**/exports/packs/**` -> `packs/**/pack.json`
- `projects/**/exports/registry/**` -> `registry/**`
- `projects/**/exports/guides/**` -> `guides/**`

Do not auto-generate skills or MCP specs by summarising arbitrary full docs from `main/`. Generate those surfaces only from explicit exports and `toolkit.project.json`.

## Source Locks

Each project module has a `SOURCE-LOCK.json` file. Exact-copy entries pin the expected Git blob SHA for preserved files. Adapted or excluded entries must say so explicitly with notes.

Run the local audit without network access:

```powershell
node scripts/audit-project-source-locks.cjs
```

To refresh a lock from latest upstream `main`, use this Codex procedure:

1. Fetch or clone the upstream source outside this toolkit repo.
2. Copy only approved safe files into the project module.
3. Mark exact copies as `mode: "exact"` with the upstream Git blob SHA.
4. Mark intentional local-only changes as `mode: "adapted"` with notes.
5. Mark intentionally omitted upstream files as `mode: "excluded"` with notes.
6. Run the source-lock audit and full validation.

## Adding A Project

1. Create `projects/<category>/<project-name>/`.
2. Add `README.md`, `SOURCE-MANIFEST.md`, and `toolkit.project.json`.
3. Preserve safe source files in `main/`.
4. Put curated root-output sources in `exports/`.
5. Declare every generated output in `toolkit.project.json`.
6. Run:

```powershell
node scripts/sync-toolkit-projects.cjs --write
node scripts/sync-toolkit-projects.cjs --check
node scripts/validate-toolkit.cjs
```

## Updating A Project

Update `main/` when source material changes. Update `exports/` only when a root-level surface should change. Then run the sync/check workflow. If `main/` changes but exports do not, the sync script warns so reviewers can confirm that no root surface needs an update.
