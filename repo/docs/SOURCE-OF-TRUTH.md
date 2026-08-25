# Source Of Truth

This repo owns reusable AI-agent toolkit assets. Direct canonical content lives in `skills/**` and `repo/**`; there is no second project or publisher tree.

## Toolkit-Owned

- Reusable skills under `skills/**`.
- Skill-local guides, references, templates, and helper assets.
- Machine contracts, fixtures, and reviewed templates under `repo/contracts/**`.
- Runtime and maintenance scripts under `repo/scripts/**`.
- Focused tests under `repo/tests/**`.
- Native plugin source contracts under `repo/contracts/toolkit-local-bridge/**` and generated native package metadata under `.codex-plugin/**` and `.claude-plugin/**`.
- Active third-party provenance under `repo/source-watch/provenance/**`.

## Product-Owned

Product repos own product code, product workflows, product configs, customer data, live n8n workflow exports, local helper outputs such as `.tmp/**`, `.n8n-local/**`, `.to-sanitise/**`, and `.sanitised/**`, and production deployment settings.

Do not move product-owned assets into this toolkit.

## Managed Surfaces

The two retained deterministic synchronizers are:

- `repo/scripts/sync-agent-instruction-shims.cjs` for the managed root instruction blocks and manual portable templates.
- `repo/scripts/sync-repo-doc-contract.cjs` for the managed source-of-truth block in `README.md` and `AGENTS.md`.

They do not publish skills, create packs, read project manifests, or write privileged PR branches. All other maintained skill and contract files are edited at their canonical paths.

Native plugin metadata remains platform-separated:

- `.codex-plugin/**` is the Codex package surface.
- `.claude-plugin/**` is the Claude Code package surface.
- Neither native package may install or update the other platform.

## Source Locks

`repo/source-watch/provenance/**/SOURCE-LOCK.json` owns active third-party provenance: source repo, ref, locked commit, allowlisted files, exact blob pins, attribution requirement, and manual-review update policy. Source-watch is notification-only and must not copy upstream files, update pins, execute upstream code, or treat a notification PR as approval.

Repo-wide MCP is intentionally not shipped or maintained as a generated surface. Official n8n Skills plus instance-level MCP references remain inside `skills/n8n-local-setup/` as secondary setup material.

## Documentation Links

Human-facing navigational paths and URLs must be clickable Markdown links. Do not leave important links only inside code fences or inline code.
