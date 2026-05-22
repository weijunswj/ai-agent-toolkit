# How To Use

This repo is a reusable toolkit for AI-agent work. It gives humans and agents a stable place to find preserved project modules, copyable skills, MCP-ready registry/design/spec metadata, and maintenance scripts.

## Use Project Modules

Use [_projects/](../../_projects/) when you need the preserved source context behind an AI-facing surface.

- `_main/` keeps preserved project files, full docs, and provenance source.
- `curated_output_for_ai/` keeps reviewed AI-facing source material that sync recipes publish into `skills/` and `mcp/`.
- `_generated/` is preview-only and not source of truth.

Start with:

- [Local n8n Setup](../../_projects/n8n/local-setup/)
- [n8n Workflow Toolkit](../../_projects/n8n/workflow-toolkit/)
- [Secure CI/CD Installer](../../_projects/cicd/secure-installer/)
- [UI/UX Pro Max Design](../../_projects/design/ui-ux-pro-max/)

To sync generated AI-facing surfaces:

```powershell
node repo/scripts/sync-repo-doc-contract.cjs --write
node repo/scripts/sync-repo-doc-contract.cjs --check
node repo/scripts/sync-toolkit-projects.cjs --write
node repo/scripts/sync-toolkit-projects.cjs --check
```

To inspect source update status:

```powershell
node repo/scripts/watch-project-sources.cjs
```

This is an advisory plan only. Retired internal sources are provenance-only, not active update targets. Third-party active sources require manual review.

## Use Skills Manually

1. Open the skill folder under `skills/`.
2. Read `README.md` for human setup notes.
3. Load `SKILL.md` into the target AI platform.
4. Include `agents/openai.yaml` when the platform supports OpenAI skill metadata.

For Codex or Claude Code, copy the whole skill folder into that tool's supported skills folder.

`skills/**/SKILL.md` files are published toolkit surfaces. If a generated notice is present, update the source path named in that notice and run `node repo/scripts/sync-toolkit-projects.cjs --write`. Directly maintained `linked` skills should be rare and justified in the related project manifest.

## Use Skill-Local Templates Manually

Templates are published material. Review them before copying into a consumer repo, and follow generated notices back to `_main/` or `curated_output_for_ai/` when editing toolkit-owned sources.

- [Generic agent rule templates](../../skills/ai-coding-agent-rules/) contain generated inert `AGENTS.template.md`, `CLAUDE.template.md`, and `GEMINI.template.md` outputs.
- [n8n agent rule add-on](../../skills/n8n-local-setup/agent-rules/n8n-mcp-rules.template.md) contains n8n workflow and MCP safety rules for merging after the generic baseline.
- [MCP config templates](../../skills/n8n-local-setup/templates/mcp-configs/) contain MCP setup examples.
- [n8n import/export sync helpers](../../skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/) contain n8n import/export, validation, compare, prepare, and sync helper templates.
- [n8n sanitizer helpers](../../skills/n8n-workflow-helper-scripts/templates/helper-scripts/sanitizer/) contain sanitizer tooling.
- [n8n workflow templates](../../skills/n8n-workflow-templates/templates/) contain public generic inactive workflow JSON templates.
- [CI/CD templates](../../skills/secure-cicd-installer/templates/cicd/) contain CI/CD installer prompts and status templates.

Generated template outputs are intentional. [PowerShell generator](../scripts/build-agent-rule-templates.ps1) and [CMD wrapper](../scripts/_build-agent-rule-templates.cmd) regenerate the generic source-side templates under `_projects/development/ai-coding-agent-rules/_main/` and the n8n add-on under `_projects/n8n/local-setup/_main/agent-rules/`; toolkit sync publishes inert skill copies.

n8n helper templates may write scoped local outputs after they are copied into a reviewed consumer repo: `n8n-workflows/*.json`, ignored `.tmp/**`, ignored `.n8n-local/**`, and sanitizer staging folders. Keep those local folders ignored.

## Use Skill-Local Packs

Packs are manifest-defined bundles stored inside the related skill folder under `skills/<skill-name>/packs/`. They are review checklists, not a root user-facing surface.

Until the installer MCP exists, use packs as review checklists:

1. Open the pack README inside the skill folder.
2. Inspect `pack.json`.
3. Review every path in `installs`.
4. Copy only the files you intentionally want.

## Codex Setup

Use:

- [Codex reference](../../skills/n8n-local-setup/references/ai-agent-platforms/codex.md)
- [Codex generic agent rules template](../../skills/ai-coding-agent-rules/AGENTS.template.md)
- [n8n agent rules add-on](../../skills/n8n-local-setup/agent-rules/n8n-mcp-rules.template.md)
- [Codex MCP config](../../skills/n8n-local-setup/templates/mcp-configs/codex-mcp-config.md)
- [Local n8n setup source module](../../_projects/n8n/local-setup/)

Keep live n8n tokens in user environment variables, not repo files.

## Claude Code Setup

Use:

- [Claude Code reference](../../skills/n8n-local-setup/references/ai-agent-platforms/claude-code.md)
- [Claude Code generic agent rules template](../../skills/ai-coding-agent-rules/CLAUDE.template.md)
- [n8n agent rules add-on](../../skills/n8n-local-setup/agent-rules/n8n-mcp-rules.template.md)
- [Claude Code MCP config](../../skills/n8n-local-setup/templates/mcp-configs/claude-mcp-config.md)
- [Claude Code source guide](../../_projects/n8n/local-setup/_main/5.%20extra%20-%20claude%20code%20integration.md)

Use user-scoped MCP config unless a project intentionally needs project-scoped config.

## ChatGPT Web And Claude Web

ChatGPT web and Claude web can use instruction-only skills when custom skills are available in the account or workspace. They cannot safely run local shell commands unless the platform provides a tool with that access.

Do not automate ChatGPT web or Claude web with cookies, sessions, browser automation, or session hacks.

## MCP

The MCP surface is MCP-ready registry and design/spec material in v1. Use [mcp/](../../mcp/) for status, project specs, and read-only discovery metadata.

No runnable MCP server, package, CLI, or executable MCP tools are shipped from this repo today.

If a target AI platform does not support MCP, use the JSON registries and docs manually.

## Optional Design Tool

Use [skills/ui-ux-secure-frontend-design/tools/design-system-generator/](../../skills/ui-ux-secure-frontend-design/tools/design-system-generator/) for local-only CSV-backed design-system recommendations. It does not require internet access and is separate from the instruction-only [design skill](../../skills/ui-ux-secure-frontend-design/).

## What Not To Do

- Do not paste real secrets into repo files.
- Do not copy live n8n exports into this toolkit.
- Do not install pack files without reviewing the target writes.
- Do not run live import/export helpers from this toolkit repo.
- Do not run live n8n import/export helpers in CI.
- Do not auto-merge or auto-apply upstream updates.
- Do not edit generated AI-facing project outputs directly; update `_main/` or `curated_output_for_ai/` and run sync/check.
