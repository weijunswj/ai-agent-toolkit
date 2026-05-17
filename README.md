# AI Agent Toolkit

Reusable AI-agent skills, templates, packs, registries, MCP design notes, and local-only tools.

## How Humans Should Use This Repo

Start here if you are browsing or copying things manually:

1. Use [_projects/**/_main/](_projects/) as the human source library. These folders hold the full preserved guides and original docs.
2. Use [for_ai/templates/](for_ai/templates/) when you need a copy-paste template, such as agent rules, MCP config notes, n8n helper docs, or CI/CD snippets.
3. Use [for_ai/packs/](for_ai/packs/) as checklists before copying multiple files. Packs are approval-gated manifests, not automatic installers in v1.
4. Use [repo/](repo/) only for maintaining this toolkit: validation scripts, tests, policy docs, provenance notes, and CI support.

The [for_ai/](for_ai/) tree is the published AI-facing layer. Humans can review it, but it is not the primary manual documentation layer. In particular:

- [for_ai/skills/](for_ai/skills/) contains portable instruction packs for AI agents.
- [for_ai/mcp/](for_ai/mcp/) contains future-facing MCP design documents. No MCP server implementation is shipped in v1.
- [for_ai/registry/](for_ai/registry/) contains JSON discovery metadata for tools and future installers.
- [for_ai/playbooks/](for_ai/playbooks/) contains short routing notes for agents and operators, not full replacement docs.

## Manual Skills And MCP Guide

For humans who want to use the skills manually:

1. Pick the skill folder under [for_ai/skills/](for_ai/skills/).
2. Read its `README.md` first, then its `SKILL.md`.
3. Copy the whole skill folder into the target agent's skill location so relative references, examples, and helper files stay together.
4. If a pack exists for that use case, review the matching [for_ai/packs/*/pack.json](for_ai/packs/) before copying files.
5. Do not copy secrets, `.env` files, credential exports, live n8n exports, or product/customer workflow JSON into this repo or out of it.

For humans who want to use the MCP material manually:

1. Read [for_ai/mcp/README.md](for_ai/mcp/README.md) first.
2. Treat [for_ai/mcp/projects/](for_ai/mcp/projects/) as project-specific MCP specs and safety notes.
3. Treat [for_ai/mcp/registry-mcp/](for_ai/mcp/registry-mcp/) and [for_ai/mcp/installer-mcp/](for_ai/mcp/installer-mcp/) as design references for future servers, not runnable services.
4. Use [for_ai/templates/mcp-configs/](for_ai/templates/mcp-configs/) for copy-paste MCP configuration notes when a consumer repo or agent needs them.
5. Keep live MCP credentials and local machine config outside this repo.

## Mental Model

| Path | Purpose |
| --- | --- |
| [_projects/](_projects/) | Canonical preserved source library. Humans should use `_projects/**/_main/` for full source docs and original guides. |
| [for_ai/](for_ai/) | AI-facing published assets: skills, MCP notes, templates, packs, registries, tools, and operator playbooks. |
| [repo/](repo/) | Repo maintenance assets: validation scripts, tests, policy docs, provenance notes, and CI support. |

Root stays intentionally small: `README.md`, `AGENTS.md`, `package.json`, `.gitignore`, `.gitattributes`, `.github/`, `_projects/`, `for_ai/`, and `repo/`.

## Source Library

Project modules keep preserved source material in:

```text
_projects/<category>/<project>/_main/
```

Each project module also carries `toolkit.project.json`, `SOURCE-MANIFEST.md`, `SOURCE-LOCK.json`, and a tiny landing `README.md`. Those landing cards point to `_main/` and do not replace the preserved source docs.

Current project modules:

- [Local n8n Setup](_projects/n8n/local-setup/)
- [n8n Workflow Templates](_projects/n8n/workflow-templates/)
- [Secure CI/CD Installer](_projects/cicd/secure-installer/)
- [UI/UX Pro Max Design](_projects/design/ui-ux-pro-max/)

## AI Surfaces

Use [for_ai/](for_ai/) for published assets that agents or installers consume:

- [Skills](for_ai/skills/)
- [MCP design notes](for_ai/mcp/)
- [Templates](for_ai/templates/)
- [Packs](for_ai/packs/)
- [Registries](for_ai/registry/)
- [Tools](for_ai/tools/)
- [AI/operator playbooks](for_ai/playbooks/)

`for_ai/playbooks/` contains concise routing and operating notes. It is not the canonical human documentation layer; use `_projects/**/_main/` for full source docs.

## Maintenance

Repo-local policy, validation, and CI support live under [repo/](repo/):

- [Docs](repo/docs/)
- [Scripts](repo/scripts/)
- [Tests](repo/tests/)

Source-watch is advisory and read-only. It renders update candidates from source-lock metadata but does not fetch upstream commits, copy files, update `SOURCE-LOCK.json`, create branches, create PRs, run live n8n actions, or mutate credentials.

Retired internal source repos remain provenance-only; see [Retired Source Provenance](repo/docs/RETIRED-SOURCE-PROVENANCE.md). The active third-party source `nextlevelbuilder/ui-ux-pro-max-skill` remains manual-review and attribution-gated.

## Validation

```powershell
node repo/scripts/sync-toolkit-projects.cjs --check
node repo/scripts/audit-project-source-locks.cjs
node repo/scripts/validate-toolkit.cjs
node --test repo/tests/*.test.cjs
node repo/scripts/package-skills.cjs --check
node repo/scripts/package-packs.cjs --check
python -m unittest discover -s for_ai/tools/design-system-generator/tests
git diff --check
```
