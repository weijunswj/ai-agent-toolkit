# How To Use

This repo is a reusable toolkit for AI-agent work. It gives humans and agents a stable place to find canonical skills, machine contracts, provenance records, and maintenance scripts.

## Find Canonical Material

- `skills/<skill-name>/` is the complete copyable skill unit.
- `repo/contracts/` contains schemas, policies, fixtures, templates, agent-rule inputs, and the Toolkit Local Bridge package contract.
- `repo/scripts/` contains deterministic maintenance and runtime helpers.
- `repo/tests/` contains focused contract and runtime tests.
- `repo/source-watch/provenance/` contains the two active third-party source locks.

To refresh the two retained managed instruction surfaces:

```powershell
node repo/scripts/sync-agent-instruction-shims.cjs --write
node repo/scripts/sync-agent-instruction-shims.cjs --check
node repo/scripts/sync-repo-doc-contract.cjs --write
node repo/scripts/sync-repo-doc-contract.cjs --check
```

To inspect source update status:

```powershell
node repo/scripts/watch-project-sources.cjs
```

To run the same active third-party commit drift check used by the scheduled PR notifier:

```powershell
node repo/scripts/check-project-source-updates.cjs
```

Retired internal sources are provenance-only, not active update targets. Third-party active sources require manual review. The scheduled source-watch PR is a notification only; it must not copy upstream files, update SOURCE-LOCK pins, update advisory records, or change toolkit components. Host-harness capability drift reviews live under [repo/source-watch/](../source-watch/) and can only recommend separate evidence-backed PRs.

## Install Toolkit Skills

### Native Toolkit Setup

For normal human setup, keep the journey short:

1. Pull or update this Toolkit repo from `weijunswj/ai-agent-toolkit`.
2. In Codex or Claude Code, open the repo and say `setup toolkit`, `refresh toolkit`, or plain `refresh` while the conversation is clearly about Toolkit setup/update state. Agents must run the one-question-bank setup journey from the managed checkout instead of stopping after plugin verification or using the active repo worktree as the canonical source. Codex uses `node "%USERPROFILE%\.ai-agent-toolkit\source\ai-agent-toolkit\repo\scripts\setup-toolkit.cjs" --execute --profile auto-main`; Claude Code appends `--host claude-code`.
3. Setup is handled by the root agent alone and must not spawn subagents for instructions, state, choices, or validation. In chat, the complete compact bank must be visible in the same response as any recommended-default shortcut; hidden command output or a summary does not count. Managed delegation uses one execution with an explicit child/parent visibility acknowledgement; missing, partial, duplicate, misordered, or wrong-stream bank output blocks approval and writes without retry. Do not rerun with `--yes-recommended` unless the user explicitly accepts the displayed recommendations.
4. **Toolkit will use a dedicated clean `main` checkout as the single update source. Active Codex or Claude Code sessions may remain on PR branches, but plugin updates will not depend on those branches.**
5. The default managed checkout path is `%USERPROFILE%\.ai-agent-toolkit\source\ai-agent-toolkit`. Use `node repo/scripts/setup-toolkit.cjs --execute --profile auto-main` from the active repo only as bootstrap/fallback when the managed checkout script is missing, then hand off to the managed checkout script after it exists.
6. Let the host install, verify, or refresh its own Toolkit native plugin path, then run the lite setup validation.
7. If Codex installs or updates the plugin, manually approve the startup hook when Codex prompts.
8. Start a new session when setup says "new session needed". In the Codex app, open `/hooks` and trust the updated Toolkit hooks.
9. Keep native plugin installs host-local: Codex must not install/update Claude Code, and Claude Code must not install/update Codex.
10. Answer the complete setup wizard before any preference, target, or Codex configuration write. One semantic model drives chat, terminal, piped, flag, plan, JSON, summary, and execution modes, and rejects unexpected extra non-empty piped answers for every host before mutation. The normal Codex capacity recommendation is root agent only. One-helper and custom values are manual memory backstops, never a strict launch profile or launch permission. Effective runtime details, exact keys, root-inclusive capacity arithmetic, backups, and restore commands appear only in a technical proposal. Structurally complete user-owned controls already matching the selected outcome are preserved byte-for-byte without `apply`, editor, backup, replacement, or Toolkit markers; different replaceable controls require one `apply` confirmation. Isolated malformed recognised Toolkit marker material may receive the same explicit proposal/`apply` transaction only when one regular active config, valid UTF-8/TOML, one effective explicit table, canonical Toolkit assignments, exact affected ranges, and no user or structural ambiguity are proven. Marker-only repair preserves compatible user-owned values; unknown/obsolete markers, mixed families, interleaved content, unsupported tables/topology, and stale proposals remain unchanged and fail closed. Unsupported MultiAgentV2 child tables, explicit false or non-boolean V2 enablement, and unknown or unsupported detection make no mutation. Current host paths without verified admission, medium effort, and child-only non-fast enforcement stay root-only. Codex Security never raises normal capacity automatically or relabels a sequential review as official Deep Scan.
11. The current wizard groups `Updates and reports`, `Computer performance`, and `Other coding apps`. It reports dynamic totals, shows one quick index, numbers resolved questions contiguously, and letters choices deterministically. Non-interactive replies prefix `all recommended` or changed-only input such as `1.2=B, 3.1=D` with the displayed privacy-safe bank reference; this prevents reinterpretation against another host, order, target set, recommendation, or choice bank. A live terminal offers one same-process concise-command stage, with Enter falling back to one-at-a-time questions and invalid input re-prompted. Empty or partial input never means all recommended. The wizard no longer asks ordinary users to select helper counts or capacity. Root-only remains available through topology or explicit Codex compatibility controls; saved Codex values are preserved as restrictive backstops. Technical runtime, raw setting, backup, and restore details appear only when an explicit advanced repair choice requires a proposal.
12. The bridge writes into no other app. Antigravity uses the explicit portable skills copy in [Antigravity 2](#antigravity-2).
13. Meaningful update reports stay enabled by default. Action-required reports open automatically, successful update/refresh/repair/sync reports remain closed, true no-ops create no report, and legacy all-report auto-open state migrates to this failure-only behavior. Toolkit-managed reports/logs older than 7 days are cleaned up best-effort from the Toolkit report/log directory.

Codex and Claude Code update Toolkit through their own native plugin systems:

- Codex updates Toolkit through the Codex native plugin system using [`.codex-plugin/plugin.json`](../../.codex-plugin/plugin.json).
- Claude Code updates Toolkit through the Claude Code native plugin system using [`.claude-plugin/plugin.json`](../../.claude-plugin/plugin.json).
- Codex does not install or update Claude Code.
- Claude Code does not install or update Codex.
- OpenCode is not a Toolkit bridge target; copy skill folders by hand as described below. Antigravity receives portable skills through an explicit copy only.

Detailed plugin verification and bridge command mechanics live in [Toolkit Local Bridge](TOOLKIT-LOCAL-BRIDGE.md).

### Manual Skill-Folder Copying

Manual installation means copying a Toolkit-owned `skills/<skill-name>/` folder into one supported location. It is separate from native plugin setup.

1. Use the whole `skills/<skill-name>/` folder as the install unit.
2. Copy whole skill folders, not just `SKILL.md`.
3. Keep `README.md`, `references/`, `templates/`, `agents/`, and other supporting files beside `SKILL.md` when present.
4. Choose **ANY ONE** supported install location per platform.
5. Do not paste secrets, tokens, `.env` values, or credentials into repo files.

Repo-local agent instruction installs need a selected or open target repo, or an explicit target path. Generic rules reach every session through the global rules that `setup toolkit` installs in each harness's user-level file. A repository opts into Toolkit governance with the governed block in its `AGENTS.md`, created or merged from [repo-local/AGENTS.managed.template.md](../../skills/repository-agent-rules/repo-local/AGENTS.managed.template.md), not from this toolkit repo's root [AGENTS.md](../../AGENTS.md). Claude Code uses a one-line `CLAUDE.md` (`@AGENTS.md`) and Antigravity a small bootstrap under `.agents/rules/`; both point back to the target repo's `AGENTS.md`, so never install one by itself.

### Manual Skill Folder Locations

| Platform | Manual Toolkit-owned skill folder locations | Active instruction files |
|---|---|---|
| Codex | `<repo>\.agents\skills\<skill-name>\`<br>`%USERPROFILE%\.agents\skills\<skill-name>\` | `AGENTS.md` |
| Claude Code | `<repo>\.claude\skills\<skill-name>\`<br>`%USERPROFILE%\.claude\skills\<skill-name>\` | `AGENTS.md`, `CLAUDE.md` shim |
| OpenCode | `<repo>\.opencode\skills\<skill-name>\`<br>`%USERPROFILE%\.config\opencode\skills\<skill-name>\`<br>`<repo>\.claude\skills\<skill-name>\`<br>`%USERPROFILE%\.claude\skills\<skill-name>\`<br>`<repo>\.agents\skills\<skill-name>\`<br>`%USERPROFILE%\.agents\skills\<skill-name>\` | `AGENTS.md` |
| Antigravity 2 | `<workspace>\.agents\skills\<skill-name>\` (portable copy only; no native plugin) | `AGENTS.md`, Antigravity 2 bootstrap |

This repo does not commit package archives. Keep `_dist/`, `.zip`, and `.tgz` artifacts out of commits.

Humans and agents use the same canonical `skills/**` and `repo/**` surfaces. No intermediate publication step is required.

### Codex

Manual whole-skill-folder copying is for installing a specific Toolkit skill without the native plugin.

**Choose any one supported Codex skill-folder location:**

| Scope | Skill folder location |
|---|---|
| Repo-level | `<repo>\.agents\skills\<skill-name>\SKILL.md` |
| User-level | `%USERPROFILE%\.agents\skills\<skill-name>\SKILL.md` |

Codex scans repo skills from `.agents/skills` from the current working directory up to the repo root. It initially sees each skill's name, description, and file path, then loads the full `SKILL.md` only when selected. Use `/skills` or `$skill-name` for explicit invocation; implicit invocation depends on the `description` frontmatter. `~/.codex/config.toml` is for Codex configuration, including disabling skills by `SKILL.md` path, not the main skill install surface.

### Claude Code

Manual whole-skill-folder copying is for installing a specific Toolkit skill without the native plugin.

**Choose any one supported Claude Code skill-folder location:**

| Scope | Skill folder location |
|---|---|
| Project-level | `<repo>\.claude\skills\<skill-name>\SKILL.md` |
| User-level | `%USERPROFILE%\.claude\skills\<skill-name>\SKILL.md` |

Use `CLAUDE.md`, `CLAUDE.local.md`, or `.claude/rules/` for always-on Claude Code instructions.

### OpenCode

Manual whole-skill-folder copying is the way to install a Toolkit skill for OpenCode; the Toolkit bridge has no OpenCode target.

**Choose any one supported OpenCode skill-folder location:**

| Scope | Skill folder location |
|---|---|
| Project OpenCode config | `<repo>\.opencode\skills\<skill-name>\SKILL.md` |
| User OpenCode config | `%USERPROFILE%\.config\opencode\skills\<skill-name>\SKILL.md` |
| Project Claude-compatible | `<repo>\.claude\skills\<skill-name>\SKILL.md` |
| User Claude-compatible | `%USERPROFILE%\.claude\skills\<skill-name>\SKILL.md` |
| Project agent-compatible | `<repo>\.agents\skills\<skill-name>\SKILL.md` |
| User agent-compatible | `%USERPROFILE%\.agents\skills\<skill-name>\SKILL.md` |

OpenCode walks upward from the current working directory to the git worktree for project-local skill paths, and it also loads global skill definitions. Use `AGENTS.md`, `AGENTS.override.md`, or the configured OpenCode rules file for always-on OpenCode instructions.

### Antigravity 2

Antigravity receives portable Toolkit skills only. There is no native Antigravity plugin or bridge sync target.

When Antigravity is installed, `setup toolkit` asks "Copy Toolkit's skills into Antigravity?". Choosing it copies the portable skills into Antigravity's global skills folder (`~/.gemini/config/skills`) and keeps Toolkit's copies current on each setup; a later answer can remove only Toolkit's copies. Folders you copied yourself are never changed.

For one workspace only, use the copy below instead.

Preview the copy into one workspace first:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --copy-antigravity-skills --antigravity-project-root <absolute-path>
```

After explicit approval of that exact write:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --copy-antigravity-skills --antigravity-project-root <absolute-path> --write
```

The copy writes only skill files under `<workspace>\.agents\skills\` and leaves out the Toolkit-only skills (see Packaging in the [Skill Safety Matrix](SKILL-SAFETY-MATRIX.md#packaging)). It does not install Python, Antigravity 2, AG2 or pip packages, change global settings or enable auto-sync.

**Use the portable workspace location for Toolkit skills:**

| Location type | Skill folder path |
|---|---|
| Workspace portable copy | `<workspace>\.agents\skills\<skill-name>\SKILL.md` |

**Put repo-local bootstrap outputs in the target repo:**

1. `AGENTS.md`.
2. `.agents/rules/00-agent-toolkit-bootstrap.md`.

Antigravity 2 reads `AGENTS.md` itself, so Toolkit installs no `GEMINI.md` shim.

`skills/**/SKILL.md` files are complete canonical toolkit surfaces. Edit the relevant skill folder directly and run the targeted skill portability and surface audits.

## Documentation Links

Human-facing navigational paths and URLs must be clickable Markdown links. Do not leave important links only inside code fences or inline code. Code blocks are for commands, payloads, literal examples, and copy/paste prompts.

## Use The Toolkit Local Bridge

The Toolkit Local Bridge is for user-local, PC-level adapter state. It is not a project-repo installer.

Default hub path: `%USERPROFILE%\.ai-agent-toolkit\current`.

Audit without writes:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --audit
```

Sync already-enabled targets after approval:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --sync-enabled --write
```

Enable opt-in repo-backed auto-update from the managed clean Toolkit checkout:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --enable-repo-auto-update --repo-path "%USERPROFILE%\.ai-agent-toolkit\source\ai-agent-toolkit" --repo-branch main --enable-auto-sync --write
```

After this is enabled, Codex and Claude Code Toolkit plugin SessionStart hooks use the managed checkout as source of truth: they validate the repo and remote, refuse dirty worktrees without stashing or switching, switch the clean managed checkout back to the configured branch if it is on another one, fetch the configured branch, fast-forward only, run hook-light validation (`node repo/scripts/validate-toolkit.cjs` + `node --test repo/tests/toolkit-local-bridge-hook-light.test.cjs`), and then record the updated hub state from the updated repo script. The hook path does not run full suite validation; run full validation manually when needed:

```powershell
npm run validate:all
node --test repo/tests/toolkit-local-bridge.test.cjs
```

Disable auto-sync:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --disable-auto-sync --write
```

Disable repo auto-update:

```powershell
node repo/scripts/toolkit-local-bridge.cjs --disable-repo-auto-update --write
```

The bridge is Toolkit setup and maintenance infrastructure with one compact `toolkit-setup` discoverability skill, not a command-per-bridge skill family. It never silently sets up new non-native targets. Repo, Codex, and Claude Code bridge copies record and enforce their versions independently, while `hub_version` remains a reporting and older-cache compatibility watermark only. Disabled and never-enabled targets are not touched.

Codex hooks run the bridge copy in Codex's plugin cache. Claude Code runs Toolkit in place from the managed checkout. After a bridge fix is merged:

- In Codex, run `setup toolkit` to refresh its cache.
- In Claude Code, the fix arrives when the managed checkout updates: with automatic updates on, that happens at the next session start. To update at once, run `setup toolkit --host claude-code` (or `setup toolkit` from Claude Code), then restart Claude Code.

Refreshing one host never mutates the other host's cache.

Claude strict root-only enforcement is applied only when native plugin installation freshness, enabled state, host-reported trust, and active hook execution all verify for proof schema 3: exact plugin version, cache identity, hooks configuration, controller bytes, process-launch bytes, and executed native-agent hook-script bytes. Every bound installed path must be a non-symlink regular file. Schema-2 proof is stale and unsupported. Setup does not approve trust or manufacture activation proof, and an install/update or restart instruction is not proof that the current session executes the hook. The verified setup CLI is persisted, with explicit and current environment overrides taking precedence without rewriting the profile. Relative path-like commands are rejected. Bare commands resolve only from absolute PATH entries and execute that exact candidate, so project-local shims cannot shadow the trusted launcher. Missing or lost proof leaves strict state root-only/unapplied; broader-native remains available explicitly outside Toolkit control.

The Toolkit direct (`toolkit-direct`) Claude worker and checker topology is retired. Setup offers root-only, broader-native and keep, runs no launch-capability probes, and resolves a stored direct profile to root-only. Governed workers use the registry-pinned V3 launchers.

Policy layering stays portable:

1. `AGENTS.md` is compact context and routing.
2. Skills/docs carry detailed portable workflows.
3. Validators and schemas enforce deterministic rules.
4. Hooks provide optional native automation around the shared updater.

## Use Skill-Local Templates Manually

Templates are canonical material. Review them before copying into a consumer repo and update the owning `skills/**` or `repo/contracts/**` surface directly.

- [Generic agent rule templates](../../skills/repository-agent-rules/) contain generated inert slim baseline templates only. They intentionally do not include the full n8n ruleset or full skill-routing table.
- [n8n agent rules](../../skills/n8n-safety-router/) contain the full n8n operating ruleset plus optional brief adapters under `adapters/`.
- [n8n local setup](../../skills/n8n-environment-setup/references/n8n/local-setup.md), [production Cloudflare Tunnel self-hosting](../../skills/n8n-environment-setup/references/n8n/production-cloudflare-tunnel.md), and [Hostinger Coolify VPS n8n](../../skills/n8n-environment-setup/references/n8n/hostinger-vps.md) contain the full local dev, local/CGNAT production, and hosted n8n setup guides.
- [Codex SSH Hostinger Coolify Setup Maintainer](../../skills/codex-ssh-hostinger-coolify-setup-maintainer/) is the separate skill for Hostinger VPS plus Coolify setup, SSH preflight, maintenance, and incident response. Use it before the hosted n8n guide when Coolify is not already running.
- n8n work with AI agents uses the [official n8n Skills](https://github.com/n8n-io/skills) and the n8n API.
- [n8n local stack templates](../../skills/n8n-environment-setup/templates/.n8n-local/) contain the localhost/ngrok dev Docker Compose, placeholder environment, launcher, and menu files.
- [n8n production Cloudflare stack templates](../../skills/n8n-environment-setup/templates/.n8n-production-cloudflare/) contain the separate production Docker Compose, placeholder environment, launcher, and menu files for local/CGNAT self-hosting through Cloudflare Tunnel.
- [n8n import/export sync helpers](../../skills/n8n-workflow-transport/templates/helper-scripts/import-export-sync/) contain n8n import/export, validation, compare, prepare, and sync helper templates.
- [n8n sanitizer helpers](../../skills/n8n-workflow-transport/templates/helper-scripts/sanitizer/) contain sanitizer tooling.
- [CI/CD templates](../../skills/secure-ci-cd/templates/cicd/) contain CI/CD installer prompts and status templates.

Managed template outputs are intentional. `node repo/scripts/sync-agent-instruction-shims.cjs --write` updates canonical agent-rule templates and root instruction shims from `repo/contracts/agent-rules/`. Other skill templates are maintained directly in their skill folders.

For n8n work, install or load `skills/n8n-safety-router`. The optional adapter installer can detect n8n repositories and preview patches to active instruction files, but it must be run with `--dry-run` first. Before running it with `--write`, pause, name the current target file and operation, explain the write, and ask for explicit current-turn approval. Do not copy the full n8n rules into global always-on instructions unless you intentionally accept the context cost.

n8n helper templates may write scoped local outputs after they are copied into a reviewed consumer repo: `n8n-workflows/*.json`, ignored `.tmp/**`, ignored `.n8n-local/**`, and sanitizer staging folders. Keep those local folders ignored.

## Codex Setup

Use:

- [Codex managed agent rules template](../../skills/repository-agent-rules/repo-local/AGENTS.managed.template.md)
- [n8n agent rules skill](../../skills/n8n-safety-router/)
- [optional Codex n8n adapter](../../skills/n8n-safety-router/adapters/AGENTS.n8n-brief.template.md)
- [Local n8n setup reference](../../skills/n8n-environment-setup/references/n8n/local-setup.md)
- [Local stack templates](../../skills/n8n-environment-setup/templates/.n8n-local/)
- [Production Cloudflare Tunnel reference](../../skills/n8n-environment-setup/references/n8n/production-cloudflare-tunnel.md)
- [Production Cloudflare stack templates](../../skills/n8n-environment-setup/templates/.n8n-production-cloudflare/)
- [Local n8n setup skill](../../skills/n8n-environment-setup/)

Keep live n8n tokens in user environment variables, not repo files. Codex n8n work uses the [official n8n Skills](https://github.com/n8n-io/skills) and the n8n API; that setup is secondary and not part of the beginner local setup path.

## Claude Code Setup

Use:

- [Shared managed agent rules template](../../skills/repository-agent-rules/repo-local/AGENTS.managed.template.md)
- [Claude Code shim template](../../skills/repository-agent-rules/repo-local/CLAUDE.shim.template.md)
- [n8n agent rules skill](../../skills/n8n-safety-router/)
- [optional Claude n8n adapter](../../skills/n8n-safety-router/adapters/CLAUDE.n8n-brief.template.md)
- [Local n8n setup reference](../../skills/n8n-environment-setup/references/n8n/local-setup.md)
- [Local stack templates](../../skills/n8n-environment-setup/templates/.n8n-local/)
- [Production Cloudflare Tunnel reference](../../skills/n8n-environment-setup/references/n8n/production-cloudflare-tunnel.md)
- [Production Cloudflare stack templates](../../skills/n8n-environment-setup/templates/.n8n-production-cloudflare/)

Claude Code n8n work uses the [official n8n Skills](https://github.com/n8n-io/skills) and the n8n API; that setup is secondary and not part of the beginner local setup path.

## OpenCode Setup

Use:

- [OpenCode managed agent rules template](../../skills/repository-agent-rules/repo-local/AGENTS.managed.template.md)
- [n8n agent rules skill](../../skills/n8n-safety-router/)
- [optional OpenCode n8n adapter](../../skills/n8n-safety-router/adapters/AGENTS.n8n-brief.template.md)
- [Local n8n setup reference](../../skills/n8n-environment-setup/references/n8n/local-setup.md)
- [Local stack templates](../../skills/n8n-environment-setup/templates/.n8n-local/)
- [Production Cloudflare Tunnel reference](../../skills/n8n-environment-setup/references/n8n/production-cloudflare-tunnel.md)
- [Production Cloudflare stack templates](../../skills/n8n-environment-setup/templates/.n8n-production-cloudflare/)

OpenCode [official n8n Skills](https://github.com/n8n-io/skills) support is platform-dependent and not part of the beginner local setup path.

## Antigravity 2 Setup

Use:

- [Shared managed agent rules template](../../skills/repository-agent-rules/repo-local/AGENTS.managed.template.md)
- [Antigravity 2 bootstrap template](../../skills/repository-agent-rules/repo-local/antigravity-bootstrap.template.md)
- [n8n agent rules skill](../../skills/n8n-safety-router/)
- [optional Antigravity 2 n8n adapter](../../skills/n8n-safety-router/adapters/GEMINI.n8n-brief.template.md)
- [Local n8n setup reference](../../skills/n8n-environment-setup/references/n8n/local-setup.md)
- [Local stack templates](../../skills/n8n-environment-setup/templates/.n8n-local/)
- [Production Cloudflare Tunnel reference](../../skills/n8n-environment-setup/references/n8n/production-cloudflare-tunnel.md)
- [Production Cloudflare stack templates](../../skills/n8n-environment-setup/templates/.n8n-production-cloudflare/)

Antigravity 2 [official n8n Skills](https://github.com/n8n-io/skills) support is platform-dependent and not part of the beginner local setup path.

## ChatGPT Web And Claude Web

ChatGPT web and Claude web can use instruction-only skills when custom skills are available in the account or workspace. They cannot safely run local shell commands unless the platform provides a tool with that access.

Do not automate ChatGPT web or Claude web with cookies, sessions, browser automation, or session hacks.

## MCP Status

Repo-wide MCP is intentionally not shipped, generated, maintained, or advertised as a supported surface for now.

The supported path is direct and skills-first: humans and agents use `skills/**` and `repo/**`.

n8n work uses the [official n8n Skills](https://github.com/n8n-io/skills) and the n8n API, with setup guidance in [skills/n8n-environment-setup/](../../skills/n8n-environment-setup/). This is not a repo-wide MCP surface.

## Optional Design Tool

Use [skills/frontend-art-direction/tools/design-system-generator/](../../skills/frontend-art-direction/tools/design-system-generator/) for local-only CSV-backed design-system recommendations. It does not require internet access and is separate from the instruction-only [design skill](../../skills/frontend-art-direction/).

## What Not To Do

- Do not paste real secrets into repo files.
- Do not copy live n8n exports into this toolkit.
- Pause before installing pack files: review the target writes, name the exact files, and ask for explicit current-turn approval.
- Do not copy the full n8n rules into global always-on instructions unless the extra context cost is intentional.
- Do not run live import/export helpers from this toolkit repo.
- Do not run live n8n import/export helpers in CI.
- Do not auto-merge or auto-apply upstream updates. Treat upstream changes as review prompts, then use a separate human-approved PR for any source update.
- Edit the direct canonical AI-facing skill or contract surface; run retained synchronizer checks only for managed root blocks and shims.
