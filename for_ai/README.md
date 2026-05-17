# AI-Facing Published Surface

`for_ai/` is the published AI-facing surface for this toolkit. It is useful for humans and AI consumers, but `_projects/` owns source for internal generated material.

<!-- BEGIN SOURCE-OF-TRUTH-CONTRACT -->
## Source-of-Truth Contract

This repo has a source layer and a published layer.

- `_projects/**/_main/` preserves full source material and original docs. Do not casually rewrite preserved source.
- `_projects/**/curated_output_for_ai/` stores reviewed AI-facing source material. Curated files may be AI-assisted, but they are source files and must be reviewed before publishing.
- `_projects/**/toolkit.project.json` is the routing contract. It declares which `_main/` or `curated_output_for_ai/` files publish to which `for_ai/` outputs.
- `for_ai/` is the published AI-facing surface for skills, MCP notes, templates, packs, registries, tools, and playbooks.
- Generated `for_ai/` files must not be edited directly. Update the matching `_projects` source or curated file, then run sync.
- `linked` outputs are rare exceptions and must be explicitly declared with a reason in `toolkit.project.json`.
- Publish declared outputs with:
  `node repo/scripts/sync-toolkit-projects.cjs --write`
- Check generated freshness with:
  `node repo/scripts/sync-toolkit-projects.cjs --check`
- CI currently checks generated freshness, but it must not invent curated content from `_main/`.
- Future auto-sync may write generated outputs on same-repo PR branches, but this PR must not add that auto-writeback workflow.
- Curated output must not weaken credential, `.env`, `.tmp`, `.n8n-local`, live n8n action, approval, attribution, or local-only safety constraints from the preserved source.
<!-- END SOURCE-OF-TRUTH-CONTRACT -->

## Contents

- `for_ai/skills/`: published AI-agent skills.
- `for_ai/mcp/`: MCP design notes and project specs.
- `for_ai/templates/`: agent-rule, MCP, n8n, and CI/CD templates.
- `for_ai/packs/`: approval-gated bundle manifests.
- `for_ai/registry/`: JSON discovery metadata.
- `for_ai/tools/`: optional local-only tooling.
- `for_ai/playbooks/`: concise AI/operator playbooks.

Many internal files here are generated from `_projects/**/curated_output_for_ai/`. Generated files include source notices. To change generated content, edit the matching `_projects` source, then run `node repo/scripts/sync-toolkit-projects.cjs --write`.

`linked` exceptions must be declared in `toolkit.project.json`. Third-party or adapted tooling may have special attribution rules and must not be treated as personal or product-owned work.
