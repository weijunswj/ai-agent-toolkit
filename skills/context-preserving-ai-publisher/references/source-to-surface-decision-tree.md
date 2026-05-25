<!--
Generated from toolkit project source. Do not edit directly.
Project: repo-methodology.context-preserving-ai-publisher
Source: _projects/repo-methodology/context-preserving-ai-publisher/_main/source-to-surface-decision-tree.md
Update the project source and run sync.
-->
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

## 3. Does It Publish A Skill?

When creating or materially changing a skill, decide:

- Does this publish an agent-usable skill folder with `SKILL.md`?
- Should the skill be listed in the repo's skill-routing guidance for supported agents?
- Does the `SKILL.md` description clearly support implicit invocation where supported?
- Does the skill need local examples, references, templates, tools, assets, or pack manifests inside the skill folder?
- Do README skill tables, registry metadata, or routing docs need updates?
- What validation proves the source and generated output stayed aligned?

If a skill is intentionally omitted from auto-routing, document the reason in the routing source.

## 4. Which Recipe Fits?

Use these generic recipe classes:

- `copy`: publish one source file or folder exactly.
- `extract`: publish a marked source section exactly.
- `concat`: publish several source files in a deterministic order.
- `curated`: publish reviewed adapter material.
- `json`: parse and format JSON deterministically.
- `linked`: directly maintained output, only with a documented reason.

If your repo uses different names, keep the same intent: deterministic source-to-output declarations.

## 5. Are Links Still Valid After Publishing?

Human-facing navigational paths and URLs must be clickable Markdown links. Important links must not exist only inside code fences or inline code.

- Use code blocks for commands, payloads, literal examples, and copy/paste prompts.
- Use inline code for commands, filenames being discussed literally, globs, config keys, or short literal examples.
- Do not use inline code as the only navigation path to important docs or assets.

When a curated file is intentionally authored as a published-surface source, it may use output-relative links. Add a note in the curated source when those links are confusing from the source folder, for example:

```md
This file is authored as a published-surface source; relative links are intended to resolve after sync at <output path>.
```

When full docs are exact copied from source and their source-relative links break after publishing, do not rewrite the whole doc just to fix links. Prefer tiny compatibility shims in the published skill folder.

## 6. Does The Manifest Declare The Output?

Before sync passes, the manifest should declare:

- Output path.
- Source path or source list.
- Recipe kind.
- Fidelity classification.
- Allowed write path.
- Denied sensitive paths.
- Shared-surface ownership, if applicable.

## 7. What Must Be Audited?

At minimum, audit for:

- New undeclared published files.
- New cross-owned outputs.
- New suspicious lossy surfaces.
- New boundary violations between source and curated adapter material.
- New baseline movement.
- Broken links.
- Unsafe executable or live-system behavior.
