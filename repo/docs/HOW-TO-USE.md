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

Preferred install: copy the whole `skills/<skill-name>/` folder into one supported location.
OpenCode stays on a short manual whole-skill-folder install note for now.

1. Use the whole `skills/<skill-name>/` folder as the install unit.
2. Copy whole skill folders, not just `SKILL.md`.
3. Keep `README.md`, `references/`, `templates/`, `agents/`, `packs/`, and other supporting files beside `SKILL.md` when present.
4. Choose **ANY ONE** supported install location per platform.
5. Do not paste secrets, tokens, `.env` values, or credentials into repo files.

Codex and Claude Code plugin/package support exists, but this repo does not make it the primary install path yet. Only introduce Codex/Claude plugin packaging later if the install experience becomes as simple as Antigravity-style folder copy / drag-and-drop setup. Until then, Codex and Claude Code should use direct whole-skill-folder installs.

### Preferred Routes

| Platform | Preferred route | Location guidance | Notes |
|---|---|---|---|
| Codex | Direct whole-skill-folder install | See Codex locations below. | Current path for Codex skills. |
| Claude Code | Direct whole-skill-folder install | See Claude Code locations below. | Current path for Claude Code skills. |
| OpenCode | Short manual whole-skill-folder note only | See OpenCode locations below. | No OpenCode plugin packaging is introduced here. |
| Antigravity | Plugin-scoped skill-folder install | See Antigravity path below. | Skill loading stays separate from repo-local bootstrap outputs. |

This repo does not commit package archives. Keep `_dist/`, `.zip`, and `.tgz` artifacts out of commits.

Humans use `_projects/**` for source review and maintenance. Agents use generated `skills/**` surfaces after sync. Optional n8n AI-coding-agent MCP feature references are secondary and not the beginner local setup path.

### Codex

For Codex, use direct whole-skill-folder install first.

**Choose any one supported Codex skill-folder location:**

| Scope | Skill folder location |
|---|---|
| Repo-level | `<repo>/.agents/skills/<skill-name>/SKILL.md` |
| User-level | `$HOME/.agents/skills/<skill-name>/SKILL.md` |
| Admin-level | `/etc/codex/skills/<skill-name>/SKILL.md` |

Codex scans repo skills from `.agents/skills` from the current working directory up to the repo root. It initially sees each skill's name, description, and file path, then loads the full `SKILL.md` only when selected. Use `/skills` or `$skill-name` for explicit invocation; implicit invocation depends on the `description` frontmatter. `~/.codex/config.toml` is for Codex configuration, including disabling skills by `SKILL.md` path, not the main skill install surface.

### Claude Code

For Claude Code, use direct whole-skill-folder install first.

**Choose any one supported Claude Code skill-folder location:**

| Scope | Skill folder location |
|---|---|
| Project-level | `<repo>/.claude/skills/<skill-name>/SKILL.md` |
| User-level | `$HOME/.claude/skills/<skill-name>/SKILL.md` |

Use `CLAUDE.md`, `CLAUDE.local.md`, or `.claude/rules/` for always-on Claude Code instructions.

### OpenCode

For OpenCode, use a short manual whole-skill-folder install only.

**Choose any one supported OpenCode skill-folder location:**

| Scope | Skill folder location |
|---|---|
| Project OpenCode config | `<repo>/.opencode/skills/<skill-name>/SKILL.md` |
| User OpenCode config | `$HOME/.config/opencode/skills/<skill-name>/SKILL.md` |
| Project Claude-compatible | `<repo>/.claude/skills/<skill-name>/SKILL.md` |
| User Claude-compatible | `$HOME/.claude/skills/<skill-name>/SKILL.md` |
| Project agent-compatible | `<repo>/.agents/skills/<skill-name>/SKILL.md` |
| User agent-compatible | `$HOME/.agents/skills/<skill-name>/SKILL.md` |

OpenCode walks upward from the current working directory to the git worktree for project-local skill paths, and it also loads global skill definitions. Use `AGENTS.md`, `AGENTS.override.md`, or the configured OpenCode rules file for always-on OpenCode instructions.

### Antigravity

For Antigravity, use the observed plugin-scoped install first.

**Use the Antigravity plugin-scoped skill-folder location for toolkit skills:**

| Location type | Skill folder path |
|---|---|
| Plugin-scoped | `C:\Users\<user>\.gemini\config\plugins\<plugin-name>\skills\<skill-name>\SKILL.md` |

Use `ai-agent-toolkit` as `<plugin-name>` for this repo unless you intentionally create a differently named local plugin folder. This plugin-scoped folder is for loading toolkit skills.

**Put repo-local bootstrap outputs in the target repo, not inside the Antigravity plugin folder:**

1. `AGENTS.md`.
2. `GEMINI.md`.
3. `.agents/rules/00-agent-toolkit-bootstrap.md`.

Use `GEMINI.md` or the configured context file for always-on Antigravity instructions.

`skills/**/SKILL.md` files are published toolkit surfaces. If a generated notice is present, update the source path named in that notice and run `node repo/scripts/sync-toolkit-projects.cjs --write`. Directly maintained `linked` skills should be rare and justified in the related project manifest.

## Documentation Links

Human-facing navigational paths and URLs must be clickable Markdown links. Do not leave important links only inside code fences or inline code. Code blocks are for commands, payloads, literal examples, and copy/paste prompts.

## Use Skill-Local Templates Manually

Templates are published material. Review them before copying into a consumer repo, and follow generated notices back to `_main/` or `curated_output_for_ai/` when editing toolkit-owned sources.

- [Generic agent rule templates](../../skills/ai-coding-agent-rules/) contain generated inert slim baseline templates only. They intentionally do not include the full n8n ruleset or full skill-routing table.
- [n8n agent rules](../../skills/n8n-agent-rules/) contain the full n8n operating ruleset plus optional brief adapters under `adapters/`.
- [n8n local setup](../../skills/n8n-local-setup/references/n8n/local-setup.md) and [Hostinger VPS](../../skills/n8n-local-setup/references/n8n/hostinger-vps.md) contain the full local and hosted setup guides.
- [n8n AI-agent platform references](../../skills/n8n-local-setup/references/ai-agent-platforms/) contain platform-specific skills/rules pointers and optional n8n MCP feature setup.
- [n8n local stack templates](../../skills/n8n-local-setup/templates/local-stack/) contain the local Docker Compose, placeholder environment, launcher, and menu files.
- [n8n optional MCP config templates](../../skills/n8n-local-setup/templates/mcp-configs/) contain AI-coding-agent MCP config examples for users intentionally enabling n8n MCP.
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
- [Local n8n setup reference](../../skills/n8n-local-setup/references/n8n/local-setup.md)
- [Local stack templates](../../skills/n8n-local-setup/templates/local-stack/)
- [Local n8n setup source module](../../_projects/n8n/local-setup/)

Keep live n8n tokens in user environment variables, not repo files. Optional Codex MCP feature config is secondary and not part of the beginner local setup path.

## Claude Code Setup

Use:

- [Claude Code reference](../../skills/n8n-local-setup/references/ai-agent-platforms/claude-code.md)
- [Shared managed agent rules template](../../skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md)
- [Claude Code shim template](../../skills/ai-coding-agent-rules/repo-local/CLAUDE.shim.template.md)
- [n8n agent rules skill](../../skills/n8n-agent-rules/)
- [optional Claude n8n adapter](../../skills/n8n-agent-rules/adapters/CLAUDE.n8n-brief.template.md)
- [Local n8n setup reference](../../skills/n8n-local-setup/references/n8n/local-setup.md)
- [Local stack templates](../../skills/n8n-local-setup/templates/local-stack/)

Optional Claude Code MCP feature config is secondary and not part of the beginner local setup path.

## OpenCode Setup

Use:

- [OpenCode reference](../../skills/n8n-local-setup/references/ai-agent-platforms/opencode.md)
- [OpenCode managed agent rules template](../../skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md)
- [n8n agent rules skill](../../skills/n8n-agent-rules/)
- [optional OpenCode n8n adapter](../../skills/n8n-agent-rules/adapters/AGENTS.n8n-brief.template.md)
- [Local n8n setup reference](../../skills/n8n-local-setup/references/n8n/local-setup.md)
- [Local stack templates](../../skills/n8n-local-setup/templates/local-stack/)

Optional OpenCode MCP feature config is secondary and not part of the beginner local setup path.

## Antigravity Setup

Use:

- [Antigravity reference](../../skills/n8n-local-setup/references/ai-agent-platforms/antigravity.md)
- [Shared managed agent rules template](../../skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md)
- [Antigravity GEMINI shim template](../../skills/ai-coding-agent-rules/repo-local/GEMINI.shim.template.md)
- [Antigravity bootstrap template](../../skills/ai-coding-agent-rules/repo-local/antigravity-bootstrap.template.md)
- [n8n agent rules skill](../../skills/n8n-agent-rules/)
- [optional Antigravity n8n adapter](../../skills/n8n-agent-rules/adapters/GEMINI.n8n-brief.template.md)
- [Local n8n setup reference](../../skills/n8n-local-setup/references/n8n/local-setup.md)
- [Local stack templates](../../skills/n8n-local-setup/templates/local-stack/)

Optional Antigravity MCP feature config is secondary and not part of the beginner local setup path.

## ChatGPT Web And Claude Web

ChatGPT web and Claude web can use instruction-only skills when custom skills are available in the account or workspace. They cannot safely run local shell commands unless the platform provides a tool with that access.

Do not automate ChatGPT web or Claude web with cookies, sessions, browser automation, or session hacks.

## MCP

The MCP surface is design/spec-only material in v1. Use [mcp/](../../mcp/) for status, project specs, and read-only discovery metadata.

No runnable MCP server, package, CLI, or executable MCP tools are shipped from this repo today.

The supported path is skills-first: humans use `_projects/**`, and agents use `skills/**`. Optional n8n AI-coding-agent MCP feature references are packaged under `skills/n8n-local-setup/` as secondary setup material.

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
