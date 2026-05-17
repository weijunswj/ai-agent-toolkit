# How To Use

This repo is a reusable toolkit for AI-agent work. It gives humans and agents a stable place to find project modules, skills, playbooks, templates, packs, optional tools, and registry metadata.

## Use Project Modules

Use [_projects/](../../_projects/) when you need the preserved source context behind an AI-facing surface.

- `_main/` keeps preserved project files, full docs, and provenance source.
- `curated_output_for_ai/` keeps reviewed AI-facing source material that sync recipes publish into `for_ai/`.
- `_generated/` is preview-only and not source of truth.

Start with:

- [Local n8n Setup](../../_projects/n8n/local-setup/)
- [n8n Workflow Templates](../../_projects/n8n/workflow-templates/)
- [Secure CI/CD Installer](../../_projects/cicd/secure-installer/)
- [UI/UX Pro Max Design](../../_projects/design/ui-ux-pro-max/)

To sync generated AI-facing surfaces:

```powershell
node repo/scripts/sync-toolkit-projects.cjs --write
node repo/scripts/sync-toolkit-projects.cjs --check
```

To inspect source update status:

```powershell
node repo/scripts/watch-project-sources.cjs
```

This is an advisory plan only. Retired internal sources are provenance-only, not active update targets. Third-party active sources require manual review.

## Use Skills Manually

1. Open the skill folder under `for_ai/skills/`.
2. Read `README.md` for human setup notes.
3. Load `SKILL.md` into the target AI platform.
4. Include `agents/openai.yaml` when the platform supports OpenAI skill metadata.

For Codex or Claude Code, copy the whole skill folder into that tool's supported skills folder.

`for_ai/skills/**/SKILL.md` files are published toolkit surfaces. If a generated notice is present, update the source path named in that notice and run `node repo/scripts/sync-toolkit-projects.cjs --write`. Directly maintained `linked` skills should be rare and justified in the related project manifest.

## Use Templates Manually

Templates are published material. Review them before copying into a consumer repo, and follow generated notices back to `_main/` or `curated_output_for_ai/` when editing toolkit-owned sources.

- [Agent rule templates](../../for_ai/templates/agent-rules/) contain generated `AGENTS.md`, `CLAUDE.md`, and `GEMINI.md` outputs.
- [MCP config templates](../../for_ai/templates/mcp-configs/) contain MCP setup examples.
- [n8n templates](../../for_ai/templates/n8n/) contain n8n helper-template sources and sanitizer tooling.
- [CI/CD templates](../../for_ai/templates/cicd/) contain CI/CD installer prompts and status templates.

Generated template outputs are intentional. [PowerShell generator](../scripts/build-agent-rule-templates.ps1) and [CMD wrapper](../scripts/-%20build-agent-rule-templates.cmd) regenerate only the three agent-rule files under [agent-rule templates](../../for_ai/templates/agent-rules/).

n8n helper templates may write scoped local outputs after they are copied into a reviewed consumer repo: `n8n-workflows/*.json`, ignored `.tmp/**`, ignored `.n8n-local/**`, and sanitizer staging folders. Keep those local folders ignored.

## Use Packs

Packs are manifest-defined bundles under [for_ai/packs](../../for_ai/packs/). They are designed for future approval-gated installation.

Until the installer MCP exists, use packs as review checklists:

1. Open the pack README.
2. Inspect `pack.json`.
3. Review every path in `installs`.
4. Copy only the files you intentionally want.

## Codex Setup

Use:

- [Codex playbook](../../for_ai/playbooks/ai-agent-platforms/codex.md)
- [Codex agent rules](../../for_ai/templates/agent-rules/AGENTS.md)
- [Codex MCP config](../../for_ai/templates/mcp-configs/codex-mcp-config.md)
- [Local n8n setup source module](../../_projects/n8n/local-setup/)

Keep live n8n tokens in user environment variables, not repo files.

## Claude Code Setup

Use:

- [Claude Code playbook](../../for_ai/playbooks/ai-agent-platforms/claude-code.md)
- [Claude Code agent rules](../../for_ai/templates/agent-rules/CLAUDE.md)
- [Claude Code MCP config](../../for_ai/templates/mcp-configs/claude-mcp-config.md)
- [Claude Code source guide](../../_projects/n8n/local-setup/_main/5.%20extra%20-%20claude%20code%20integration.md)

Use user-scoped MCP config unless a project intentionally needs project-scoped config.

## ChatGPT Web And Claude Web

ChatGPT web and Claude web can use instruction-only skills when custom skills are available in the account or workspace. They cannot safely run local shell commands unless the platform provides a tool with that access.

Do not automate ChatGPT web or Claude web with cookies, sessions, browser automation, or session hacks.

## MCP Registry

The MCP registry is design-only in v1. Once built, use it for read-only discovery of skills, playbooks, templates, and packs.

If a target AI platform does not support MCP, use the JSON registries and docs manually.

## Optional Design Tool

Use [for_ai/tools/design-system-generator/](../../for_ai/tools/design-system-generator/) for local-only CSV-backed design-system recommendations. It does not require internet access and is separate from the instruction-only [design skill](../../for_ai/skills/design/ui-ux-secure-frontend-design/).

## What Not To Do

- Do not paste real secrets into repo files.
- Do not copy live n8n exports into this toolkit.
- Do not install pack files without reviewing the target writes.
- Do not run live import/export helpers from this toolkit repo.
- Do not run live n8n import/export helpers in CI.
- Do not auto-merge or auto-apply upstream updates.
- Do not edit generated AI-facing project outputs directly; update `_main/` or `curated_output_for_ai/` and run sync/check.
