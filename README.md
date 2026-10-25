# AI Agent Toolkit

Skills and working rules for AI coding agents. Toolkit installs them into Codex and Claude Code as a native plugin, keeps them current from this repository's `main` branch, and adds a short set of global rules every session follows. Antigravity gets a portable copy of the skills only.

**Supported OS:** Windows 10 and 11. macOS and Linux computers are not supported. (Linux is still used for CI, cloud agent sessions and the remote servers some skills manage.)

**Programme reconciler:** the reconciler, its state documents, managed blocks and sub-issue links act only where the owner adds `.github/toolkit-programme.json` and GitHub governance is ENABLED; every `programme.cjs` command refuses otherwise. It supports github.com only, with `kind: github` as its only state store backend. The binding does not change the Toolkit-governed rules (the `TOOLKIT-GOVERNED-RULES` block in `AGENTS.md`) or their issue records. Plain folders, repositories not on github.com and repositories without that block get no governed issue writes, only the coding gates, subagents and portable skills; global rules still apply, including PRs after requested edits and task issues when the user asks to add one.

**Evidence custody:** the private evidence (transport) store can be any backend. It is separate from the reconciler's state store.

## Install

You need Git, Node.js and Codex or Claude Code on a Windows computer.

1. Clone this repository: `git clone https://github.com/weijunswj/ai-agent-toolkit`.
2. Open the folder in Codex or Claude Code and say `setup toolkit`.
3. Answer the setup questions. Reply `all recommended` to take every recommended choice.
4. Start a new session when setup says so. In the Codex app, open `/hooks` and trust the updated Toolkit hook.

Setup keeps its own clean copy of this repository at `%USERPROFILE%\.ai-agent-toolkit\source\ai-agent-toolkit` and installs from there. Details: [How To Use](repo/docs/HOW-TO-USE.md#install-toolkit-skills).

## Update

With automatic updates on (setup recommends it), Toolkit checks for a newer `main` when a Codex or Claude Code session starts and updates itself. To update now, say `refresh toolkit`. Start a new session afterwards so the new version loads.

## Remove

- **Claude Code:** `claude plugin uninstall ai-agent-toolkit@ai-agent-toolkit-local`
- **Codex:** `codex plugin remove ai-agent-toolkit@ai-agent-toolkit-local`
- **Global rules:** `node "$env:USERPROFILE\.ai-agent-toolkit\source\ai-agent-toolkit\repo\scripts\toolkit-global-rules.cjs" --remove` takes Toolkit's block out of `~/.claude/CLAUDE.md` and `~/.codex/AGENTS.md` and leaves the rest of each file alone.
- **Automatic updates:** `node "$env:USERPROFILE\.ai-agent-toolkit\source\ai-agent-toolkit\repo\scripts\toolkit-local-bridge.cjs" --disable-auto-sync --disable-repo-auto-update --write`
- **Settings and files left behind:** before uninstalling, run `setup toolkit` in Claude Code and choose "Broader native behaviour" so Toolkit removes the subagent limit it set in your Claude Code settings, and in Codex answer "Leave it" for the instruction limit so Toolkit takes its `project_doc_max_bytes` line out of `~/.codex/config.toml`. Afterwards you can delete the `toolkit-*.md` helper files in `%USERPROFILE%\.claude\agents` and the `%USERPROFILE%\.ai-agent-toolkit` folder.

## Skills

Each skill is a folder under [skills/](skills/). Copy the whole folder, not just `SKILL.md`, if you install one by hand ([where each app looks](repo/docs/HOW-TO-USE.md#manual-skill-folder-locations)).

| Skill | Use |
|---|---|
| [Repository Agent Rules](skills/repository-agent-rules/) | Put a repository under Toolkit's rules, or check and repair them. |
| [Controller Bootstrap](skills/controller-bootstrap/) | Re-enter an already assigned Toolkit controller after lost context. |
| [Toolkit Setup](skills/toolkit-setup/) | Set up, update, check or troubleshoot Toolkit itself. |
| [Toolkit Env](skills/toolkit-env/) | Manage your API keys and tokens in Windows Credential Manager, kept out of chat. |
| [n8n Safety Router](skills/n8n-safety-router/) | The safety rules to load before any n8n work. |
| [n8n Environment Setup](skills/n8n-environment-setup/) | Set up n8n locally or on a server, with backups and the official n8n skills. |
| [n8n Workflow Transport](skills/n8n-workflow-transport/) | Clean, check and compare n8n workflow files before an approved import or export. |
| [Secure CI/CD](skills/secure-ci-cd/) | Plan security-first CI/CD and GitHub Actions; block personal data in commits and pull requests. |
| [Skill Product Review](skills/skill-product-review/) | Review third-party agent skills before using or adapting them. |
| [Local AI Safety](skills/local-ai-safety/) | Review local AI runtimes, model downloads and exposed endpoints. |
| [Managed App Foundation Review](skills/managed-app-foundation-review/) | Compare managed services before building auth, databases or other foundations yourself. |
| [GitHub Program Reconciler](skills/github-program-reconciler/) | Keep a GitHub programme issue and its children in step with the real PR and review state. |
| [Release Readiness Audit](skills/release-readiness-audit/) | Run a guarded release-readiness audit and fix batches. |
| [Codex SSH Hostinger Coolify Setup Maintainer](skills/codex-ssh-hostinger-coolify-setup-maintainer/) | Set up and maintain a Hostinger VPS with Coolify, with owner approval gates. |
| [External Operation Preflight](skills/external-operation-preflight/) | Check a live change on an outside service (deploys, auto-deploying merges, new resources, restores) before approval, and prove backups by evidence level. |
| [Host Observability](skills/host-observability/) | Watch one Linux server: hourly health pulse, off-host heartbeat and alerts where you choose. |
| [Self-Hosted Service Safety](skills/self-hosted-service-safety/) | Review Docker, VPS, tunnel and public-port safety for self-hosted services. |
| [Frontend Art Direction](skills/frontend-art-direction/) | Give a frontend a deliberate visual direction, or review one against an approved design. |
| [Windows Local Dev Services](skills/windows-local-dev-services/) | Start, check and troubleshoot local dev servers on Windows. |

How risky each skill is and what it may touch: [Skill Safety Matrix](repo/docs/SKILL-SAFETY-MATRIX.md).

## Where the docs live

| Doc | What it covers |
|---|---|
| [How To Use](repo/docs/HOW-TO-USE.md) | Setup steps, manual skill copies, each app's details. |
| [Toolkit Local Bridge](repo/docs/TOOLKIT-LOCAL-BRIDGE.md) | How updates, plugin installs and session-start checks work. |
| [Toolkit Env](repo/docs/TOOLKIT-ENV.md) | Where API keys are kept and how apps reach them. |
| [For AI Agents](repo/docs/FOR_AI_AGENTS.md) | What an agent working in this repository reads first. |
| [Validation Strategy](repo/docs/VALIDATION-STRATEGY.md) | Which checks to run before a pull request. |
| [repo/docs/](repo/docs/) | Everything else: policy, safety, architecture and the changelog. |

Maintainers start with [AGENTS.md](AGENTS.md). There is no repo-wide MCP server; n8n work uses the [official n8n Skills](https://github.com/n8n-io/skills) and the n8n API.

## Appendix: Source-of-Truth Contract

<!-- AI-AGENT-TOOLKIT:repo/contracts/source-of-truth-contract.md:BEGIN SOURCE-OF-TRUTH-CONTRACT v2 toolkit=3.13.7 sha256=24ee07475127 -->
## Source-of-Truth Contract

- `skills/**` is the canonical copyable product surface; each skill folder is the install unit and is edited directly. `skills/controller-bootstrap/` is an explicit-only re-entry procedure for an assigned Toolkit controller; it depends on the live `repo/CONTROLLER.md` and `repo/contracts/controller-kernel/stack-registry-v3.json` and is not a policy copy, role assignment or permission.
- `repo/contracts/**` holds the machine contracts (schemas, policies, fixtures, templates, agent-rule sources); `repo/scripts/**` the runtime and maintenance code; `repo/tests/**` the focused tests. `repo/contracts/agent-rules/toolkit-skill-routing.md` routes the current skill set and records omitted skills.
- One direct canonical tree: new skills go under `skills/**` after Skill Creation Center review, everything else under `repo/**`. No secondary ownership, publication, packaging or generic sync layers. Only two synchronizers exist: `repo/scripts/sync-repo-doc-contract.cjs` (this block) and `repo/scripts/sync-agent-instruction-shims.cjs` (the governed rules block, repo-local templates and shims, the n8n adapter template, and the three n8n safety derivatives of `repo/contracts/agent-rules/n8n-safety-rules.md` in `skills/n8n-safety-router/`, `skills/n8n-environment-setup/references/` and `skills/n8n-workflow-transport/references/`). Repair with those exact commands; there is no generic `run sync`.
- `repo/source-watch/provenance/**/SOURCE-LOCK.json` holds only active third-party pins (upstream repo, ref, commit, update policy, attribution, allowlist, blob pins). Scheduled source-watch only opens or refreshes a review PR: it never copies upstream files, edits locks, runs upstream code, merges, pushes to main or runs live n8n, and a notification is not approval.
- `.codex-plugin/` and `.claude-plugin/` hold each host's native plugin metadata and never update the other host. There is no repo-wide MCP surface; n8n work uses the official n8n Skills and API, with setup guidance in `skills/n8n-environment-setup/`. Skill and runtime context stays local and traceable; external links may support provenance but are never required to run.
- Coordinated decisions use controller-decision v2, the captured registry v3 revision and raw digest, nested IR v3, Codex adapter v2 and CURRENT v2, and no other versions. The canonical profiles are owner-gpt and owner-claude; their independent full-scope reviewer sets are defined only by the pinned registry and currently contain one and one members, with no additional peer. Source progress does not establish native or installed qualification.
<!-- AI-AGENT-TOOLKIT:repo/contracts/source-of-truth-contract.md:END SOURCE-OF-TRUTH-CONTRACT -->
