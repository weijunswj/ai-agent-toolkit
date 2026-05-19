# Source-To-Surface Decision Tree

Use this decision tree before adding or changing an AI-facing repo surface.

## 1. Is The Material Runtime-Critical?

Runtime-critical material includes full setup steps, prompts, templates, policy text, troubleshooting notes, examples, command sequences, schemas, and anything a future agent needs to execute the work.

- Yes: store it in the source layer and publish with an exact `copy`, `extract`, or `concat` recipe.
- No: it may be a reviewed adapter, index, wrapper, manifest, or metadata file.

## 2. Is It A Short Router Or Adapter?

Short routers and adapters can live in the reviewed adapter layer when they do not replace full working detail.

Good adapter examples:

- `SKILL.md` entrypoint.
- Skill README.
- Reference index.
- Template index.
- Pack manifest.
- MCP overview.
- Safety wrapper.

## 3. Which Recipe Fits?

Use these generic recipe classes:

- `copy`: publish one source file or folder exactly.
- `extract`: publish a marked source section exactly.
- `concat`: publish several source files in a deterministic order.
- `curated`: publish reviewed adapter material.
- `json`: parse and format JSON deterministically.
- `linked`: directly maintained output, only with a documented reason.

If your repo uses different names, keep the same intent: deterministic source-to-output declarations.

## 4. Are Links Still Valid After Publishing?

When a curated file is intentionally authored as a published-surface source, it may use output-relative links. Add a note in the curated source when those links are confusing from the source folder, for example:

```md
This file is authored as a published-surface source; relative links are intended to resolve after sync at <output path>.
```

When full docs are exact copied from source and their source-relative links break after publishing, do not rewrite the whole doc just to fix links. Prefer tiny compatibility shims in the published skill folder.

## 5. Does The Manifest Declare The Output?

Before sync passes, the manifest should declare:

- Output path.
- Source path or source list.
- Recipe kind.
- Fidelity classification.
- Allowed write path.
- Denied sensitive paths.
- Shared-surface ownership, if applicable.

## 6. What Must Be Audited?

At minimum, audit for:

- New undeclared published files.
- New cross-owned outputs.
- New suspicious lossy surfaces.
- New boundary violations between source and curated adapter material.
- New baseline movement.
- Broken links.
- Unsafe executable or live-system behavior.
