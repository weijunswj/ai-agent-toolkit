# How To Use

This repo is a reusable toolkit for AI-agent work. It gives humans and agents a stable place to find preserved project modules, copyable skills, MCP-ready registry/design/spec metadata, and maintenance scripts.

## Use Project Modules

Use [_projects/](../../_projects/) when you need the preserved source context behind an AI-facing surface.

- `_main/` keeps preserved project files, full docs, and provenance source.
- `curated_output_for_ai/` keeps reviewed AI-facing source material that sync recipes publish into `skills/` and `mcp/`.
- `_generated/` is preview-only and not source of truth.
- `toolkit.project.json` owns the toolkit module version, routing contract, generated outputs, and write policy.
- `SOURCE-LOCK.json` owns upstream/source provenance, source pins, blob pins, lifecycle, attribution requirements, and source-watch update policy.

For third-party projects, the project `version` is the toolkit adaptation version, not the upstream version. Source-watch tasks must use `SOURCE-LOCK.json` for upstream repo, source ref, locked commit, update policy, attribution requirement, allowlisted files, and exact blob pins.

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

To run the same active third-party commit drift check used by the scheduled PR notifier:

```powershell
node repo/scripts/check-project-source-updates.cjs
```

Retired internal sources are provenance-only, not active update targets. Third-party active sources require manual review. The scheduled source-watch PR is a notification only; it must not copy upstream files or update SOURCE-LOCK pins.

## Install Toolkit Skills

Preferred install: use plugin/package install for Codex, Claude Code, and Antigravity.
OpenCode stays on a short manual skill-folder install note for now.

1. Use the whole `skills/<skill-name>/` folder as the install unit.
2. Copy whole skill folders, not just `SKILL.md`.
3. Keep `skills/<skill-name>/README.md`, `references/`, `templates/`, `agents/`, and `packs/` beside `SKILL.md` when they exist.
4. Do not paste secrets, tokens, `.env` values, or credentials into repo files.

### Preferred Routes

| Platform | Preferred route | Package layout | Notes |
|---|---|---|---|
| Codex | Plugin/package install first | `ai-agent-toolkit/.codex-plugin/plugin.json` plus `ai-agent-toolkit/skills/<skill-name>/SKILL.md` | Use Codex plugin/package install when available. Do not place a plugin root inside `.agents/skills/`; use direct skill-folder locations below only as a fallback. |
| Claude Code | Plugin/package install first | `ai-agent-toolkit/.claude-plugin/plugin.json` plus `ai-agent-toolkit/skills/<skill-name>/SKILL.md` | Use Claude Code marketplace/plugin install when available. Do not place a plugin root inside `.claude/skills/`; use direct skill-folder locations below only as a fallback. |
| Antigravity | Plugin-scoped install first | `C:\Users\<user>\.gemini\config\plugins\<plugin-name>\skills\<skill-name>\SKILL.md` | Use the observed plugin-scoped folder layout. Add a minimal `plugin.json` beside `skills/` only when the installed Antigravity runtime or docs require plugin metadata. |
| OpenCode | Short manual skill-folder note only | `skills/<skill-name>/SKILL.md` copied into an OpenCode-supported skills folder | Do not overbuild a fake OpenCode plugin package in this PR. |

### Package Folder Shape

Use this folder shape when creating a local plugin/package from this repo:

```text
ai-agent-toolkit/
|-- .codex-plugin/
|   `-- plugin.json
|-- .claude-plugin/
|   |-- plugin.json
|   `-- marketplace.json
`-- skills/
    `-- <skill-name>/
        |-- SKILL.md
        |-- README.md
        |-- references/
        `-- templates/
```

Codex and Claude Code plugin packages are plugin roots with manifests beside `skills/`. Direct skill fallback folders are separate install locations. Do not put a plugin root inside `.agents/skills/` or `.claude/skills/`.

The `.codex-plugin/plugin.json` file is for Codex plugin packages. The `.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` files are for Claude Code plugin and marketplace install. Do not add Antigravity manifest fields unless the installed runtime documents them.

Minimal Codex plugin manifest shape:

```json
{
  "name": "ai-agent-toolkit",
  "version": "0.1.0",
  "description": "Reusable AI-agent toolkit skills.",
  "author": {
    "name": "weijunswj"
  },
  "repository": "https://github.com/weijunswj/ai-agent-toolkit",
  "license": "UNLICENSED",
  "skills": "./skills/",
  "interface": {
    "displayName": "AI Agent Toolkit",
    "shortDescription": "Reusable agent skills and safe setup notes.",
    "longDescription": "Source-traceable AI-agent skills, local setup references, MCP config templates, and safety-first workflow guidance.",
    "developerName": "weijunswj",
    "category": "Productivity",
    "capabilities": [
      "Interactive",
      "Read",
      "Write"
    ]
  }
}
```

Minimal Claude Code plugin manifest shape:

```json
{
  "name": "ai-agent-toolkit",
  "displayName": "AI Agent Toolkit",
  "version": "0.1.0",
  "description": "Reusable AI-agent toolkit skills.",
  "author": {
    "name": "weijunswj"
  },
  "repository": "https://github.com/weijunswj/ai-agent-toolkit",
  "license": "UNLICENSED",
  "skills": "./skills/"
}
```

This repo does not commit generated package archives. If you run package scripts locally, keep `_dist/`, `.zip`, and `.tgz` artifacts out of commits.

### Codex

For Codex, use plugin/package install first. This repo root is the plugin package because `.codex-plugin/plugin.json` sits beside `skills/`. A Codex plugin install is not a plugin folder copied under `.agents/skills/`; `.agents/skills/` is only for direct skill fallback.

For local personal Codex plugin development, keep the plugin source as a plugin root such as `%USERPROFILE%\plugins\ai-agent-toolkit\`, then point the personal marketplace entry at that source from `%USERPROFILE%\.agents\plugins\marketplace.json`. After install, Codex may copy the plugin into its own plugin cache; do not hand-edit the cache as the source of truth.

Fallback locations for whole skill folders:

- Fallback repo-level: `<repo>/.agents/skills/<skill-name>/SKILL.md`.
- Fallback user-level: `$HOME/.agents/skills/<skill-name>/SKILL.md`.
- Fallback admin-level: `/etc/codex/skills/<skill-name>/SKILL.md`.

Codex scans repo skills from `.agents/skills` from the current working directory up to the repo root. It initially sees each skill's name, description, and file path, then loads the full `SKILL.md` only when selected. Use `/skills` or `$skill-name` for explicit invocation; implicit invocation depends on the `description` frontmatter. `~/.codex/config.toml` is for Codex configuration, including disabling skills by `SKILL.md` path, not the main skill install surface.

### Claude Code

For Claude Code, use plugin/package install first. This repo root is a Claude Code plugin package because `.claude-plugin/plugin.json` sits beside `skills/`; `.claude-plugin/marketplace.json` lets a marketplace install point back to this root.

Use `claude --plugin-dir <path-to-ai-agent-toolkit>` for local plugin testing. For marketplace install, add the marketplace that contains `.claude-plugin/marketplace.json`, then install `ai-agent-toolkit@ai-agent-toolkit`.

Fallback locations for whole skill folders:

- Fallback project-level: `<repo>/.claude/skills/<skill-name>/SKILL.md`.
- Fallback user-level: `$HOME/.claude/skills/<skill-name>/SKILL.md`.

Use `CLAUDE.md`, `CLAUDE.local.md`, or `.claude/rules/` for always-on Claude Code instructions.

### OpenCode

For OpenCode, use a short manual skill-folder install only.

**Copy or symlink the whole `skills/<skill-name>/` folder into ANY ONE supported location:**

- Project OpenCode config: `<repo>/.opencode/skills/<skill-name>/SKILL.md`.
- User OpenCode config: `$HOME/.config/opencode/skills/<skill-name>/SKILL.md`.
- Project Claude-compatible: `<repo>/.claude/skills/<skill-name>/SKILL.md`.
- User Claude-compatible: `$HOME/.claude/skills/<skill-name>/SKILL.md`.
- Project agent-compatible: `<repo>/.agents/skills/<skill-name>/SKILL.md`.
- User agent-compatible: `$HOME/.agents/skills/<skill-name>/SKILL.md`.

OpenCode walks upward from the current working directory to the git worktree for project-local skill paths, and it also loads global skill definitions. Use `AGENTS.md`, `AGENTS.override.md`, or the configured OpenCode rules file for always-on OpenCode instructions.

### Antigravity

For Antigravity, use the observed plugin-scoped install first:

- Plugin-scoped: `C:\Users\<user>\.gemini\config\plugins\<plugin-name>\skills\<skill-name>\SKILL.md`.

Use `ai-agent-toolkit` as `<plugin-name>` for this repo unless you intentionally create a differently named local plugin folder. Use `GEMINI.md` or the configured context file for always-on Antigravity instructions.

`skills/**/SKILL.md` files are published toolkit surfaces. If a generated notice is present, update the source path named in that notice and run `node repo/scripts/sync-toolkit-projects.cjs --write`. Directly maintained `linked` skills should be rare and justified in the related project manifest.

## Documentation Links

Human-facing navigational paths and URLs must be clickable Markdown links. Do not leave important links only inside code fences or inline code. Code blocks are for commands, payloads, literal examples, and copy/paste prompts.

## Use Skill-Local Templates Manually

Templates are published material. Review them before copying into a consumer repo, and follow generated notices back to `_main/` or `curated_output_for_ai/` when editing toolkit-owned sources.

- [Generic agent rule templates](../../skills/ai-coding-agent-rules/) contain generated inert slim baseline templates only. They intentionally do not include the full n8n ruleset or full skill-routing table.
- [n8n agent rules](../../skills/n8n-agent-rules/) contain the full n8n operating ruleset plus optional brief adapters under `adapters/`.
- [MCP config templates](../../skills/n8n-local-setup/templates/mcp-configs/) contain MCP setup examples.
- [n8n import/export sync helpers](../../skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/) contain n8n import/export, validation, compare, prepare, and sync helper templates.
- [n8n sanitizer helpers](../../skills/n8n-workflow-helper-scripts/templates/helper-scripts/sanitizer/) contain sanitizer tooling.
- [n8n workflow templates](../../skills/n8n-workflow-templates/templates/) contain public generic inactive workflow JSON templates.
- [CI/CD templates](../../skills/secure-cicd-installer/templates/cicd/) contain CI/CD installer prompts and status templates.

Generated template outputs are intentional. `node repo/scripts/sync-agent-instruction-shims.cjs --write` regenerates project-pure source-side baseline templates and root instruction shims from `_projects/development/ai-coding-agent-rules/_main/`; `node repo/scripts/sync-toolkit-projects.cjs --write` publishes inert skill copies and the generated `n8n-agent-rules` skill.

For n8n work, install or load `skills/n8n-agent-rules`. The optional adapter installer can detect n8n repositories and preview patches to active instruction files, but it must be run with `--dry-run` first and must not be run with `--write` unless the user explicitly approves the current target file and operation. Do not copy the full n8n rules into global always-on instructions unless you intentionally accept the context cost.

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
- [Codex managed agent rules template](../../skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md)
- [n8n agent rules skill](../../skills/n8n-agent-rules/)
- [optional Codex n8n adapter](../../skills/n8n-agent-rules/adapters/AGENTS.n8n-brief.template.md)
- [Codex MCP config](../../skills/n8n-local-setup/templates/mcp-configs/codex-mcp-config.md)
- [Local n8n setup source module](../../_projects/n8n/local-setup/)

Keep live n8n tokens in user environment variables, not repo files.

## Claude Code Setup

Use:

- [Claude Code reference](../../skills/n8n-local-setup/references/ai-agent-platforms/claude-code.md)
- [Shared managed agent rules template](../../skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md)
- [Claude Code shim template](../../skills/ai-coding-agent-rules/repo-local/CLAUDE.shim.template.md)
- [n8n agent rules skill](../../skills/n8n-agent-rules/)
- [optional Claude n8n adapter](../../skills/n8n-agent-rules/adapters/CLAUDE.n8n-brief.template.md)
- [Claude Code MCP config](../../skills/n8n-local-setup/templates/mcp-configs/claude-mcp-config.md)
- [Claude Code source guide](../../_projects/n8n/local-setup/_main/5.%20extra%20-%20claude%20code%20integration.md)

Use user-scoped MCP config unless a project intentionally needs project-scoped config.

## OpenCode Setup

Use:

- [OpenCode reference](../../skills/n8n-local-setup/references/ai-agent-platforms/opencode.md)
- [OpenCode managed agent rules template](../../skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md)
- [n8n agent rules skill](../../skills/n8n-agent-rules/)
- [optional OpenCode n8n adapter](../../skills/n8n-agent-rules/adapters/AGENTS.n8n-brief.template.md)
- [OpenCode MCP config](../../skills/n8n-local-setup/templates/mcp-configs/opencode-mcp-config.md)
- [OpenCode source guide](../../_projects/n8n/local-setup/_main/6.%20extra%20-%20opencode%20integration.md)

Use user-scoped OpenCode config unless a project intentionally needs project-specific overrides.

## Antigravity Setup

Use:

- [Antigravity reference](../../skills/n8n-local-setup/references/ai-agent-platforms/antigravity.md)
- [Shared managed agent rules template](../../skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md)
- [Antigravity GEMINI shim template](../../skills/ai-coding-agent-rules/repo-local/GEMINI.shim.template.md)
- [Antigravity bootstrap template](../../skills/ai-coding-agent-rules/repo-local/antigravity-bootstrap.template.md)
- [n8n agent rules skill](../../skills/n8n-agent-rules/)
- [optional Antigravity n8n adapter](../../skills/n8n-agent-rules/adapters/GEMINI.n8n-brief.template.md)
- [Antigravity MCP config](../../skills/n8n-local-setup/templates/mcp-configs/antigravity-mcp-config.md)
- [Antigravity source guide](../../_projects/n8n/local-setup/_main/7.%20extra%20-%20antigravity%20integration.md)

Use user-scoped Antigravity config unless a project intentionally needs project-specific overrides.

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
- Do not copy the full n8n rules into global always-on instructions unless the extra context cost is intentional.
- Do not run live import/export helpers from this toolkit repo.
- Do not run live n8n import/export helpers in CI.
- Do not auto-merge or auto-apply upstream updates.
- Do not edit generated AI-facing project outputs directly; update `_main/` or `curated_output_for_ai/` and run sync/check.
