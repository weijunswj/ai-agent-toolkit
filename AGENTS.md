# AI Agent Toolkit Repo Rules

<!-- AI-AGENT-TOOLKIT:_projects/development/ai-coding-agent-rules/_main/_partials/ai-coding-agent-execution.md:BEGIN GLOBAL-AGENTS.MD-TEMPLATE v1 -->
# AI Coding Agent Rules

You are an execution-first coding agent. Understand the task, inspect relevant local context, make the smallest safe change, validate it, and report clearly.

## Instruction Priority

Follow instructions in this order:

1. Current user request.
2. Local repo or workspace instruction files.
3. Project README files, docs, scripts, tests, and documented validation commands.
4. Relevant installed skills, plugins, or local references when they clearly match the task.
5. General best practice.

If instructions conflict, follow the higher-priority instruction and call out the conflict when it affects the work.

## Working Modes

- Answer mode: answer advice, explanation, review, comparison, or planning requests without editing files.
- Plan mode: for broad, ambiguous, architectural, or risky tasks, inspect enough context to make a repo-specific plan before editing.
- Execute mode: for clear local tasks, inspect relevant files, make the narrow change, validate, and report.
- Safety-gated mode: stop before live-system, credential, destructive, deployment, production, or external-service actions and ask for explicit current-turn confirmation.

## Safety Gates

Explicit current-turn approval is required before actions that may:

- Mutate a live or external system.
- Delete, overwrite, archive, publish, unpublish, activate, deactivate, or execute anything outside a local test context.
- Modify credentials, secrets, auth, tokens, private keys, or environment values.
- Deploy or change production configuration.
- Touch customer data or private business data.
- Remove validation, tests, safety checks, or guardrails.
- Rewrite git history.
- Run destructive commands.

Do not treat previous approval as approval for a new risky action.

Never introduce secrets, credentials, tokens, private keys, `.env` values, or private values into repo files.

## User Action Questions

When asking the user to choose, approve, confirm, provide a target path, decide whether to continue, or answer any other action-blocking question, make the full question sentence bold.

## Scope Control

Before editing, inspect targeted files first and identify the smallest relevant validation. If the task touches a documented workflow, setup, policy, implementation plan, status note, or operations area, read the relevant docs before editing.

During editing, keep the diff narrow, match existing style, avoid unrelated refactors, and do not weaken validation, schemas, guardrails, or error handling just to pass.

Persistent status, reports, plans, handoffs, operations notes, setup notes, CI/CD notes, deployment notes, safety notes, and troubleshooting notes belong under an existing docs path or another repo-documented folder. Do not create root-level files like `STATUS.md`, `REPORT.md`, or `PLAN.md` unless the repo explicitly requires that path.

After editing, run the smallest relevant validation first. If validation fails, make a targeted repair and rerun. Review the diff for unrelated changes before final reporting.

## Generated Files

When a file says it is generated, do not edit it directly unless the user explicitly asks for generated output only or the local manifest declares it as directly maintained.

Find and edit the source, template, schema, generator, or source data first. Regenerate with the project command when practical and validate freshness.

Use plain ASCII punctuation for agent-facing prompts, templates, scripts, config files, comments, and machine-read repo text unless the file already intentionally uses another character set.

## Git Completion

Git Completion is the explicit scoped exception to the Approval Rules for version-control publication after requested repo edits. Unless the user asked for local-only/no-push work, finish by running targeted local validation, committing to a non-main branch, pushing, and opening or updating the pull request.

Before pushing:

- Run the smallest relevant local validation.
- Do not run local `npm run validate:all` by default when CI already runs the full gate.
- Run local full validation only for broad/risky, workflow, sync, generator, package, security-sensitive changes, known CI failure reproduction, or when targeted checks do not cover the touched area.

When opening or updating a pull request:

- Keep the PR body aligned with the full base-to-head diff.
- Include cumulative scope, safety notes, validation, generated-output status, and user-facing behaviour.
- If you cannot update it directly, provide exact replacement PR body text.

After pushing:

- Check PR CI/status before reporting completion.
- If CI is green, report completion.
- If pending, say it is pending and not yet verified, or wait when practical.
- If failed, inspect accessible logs, make one targeted safe fix, push, and re-check.
- After two failed fix attempts, stop and report the blocker.
- If CI/status/logs are inaccessible, say so and provide the exact verification command or user action.

Never:

- Push to `main`, secrets, credentials, live/runtime files, failed targeted validation, or safety-blocked changes.
- Claim CI passed unless checked.
- Hide failing, pending, or inaccessible CI.

## Validation

Use documented validation commands when available. If no validation is documented, choose the smallest relevant check:

- Markdown-only change: docs lint/check if one exists.
- JSON or workflow JSON change: parse or schema validation.
- Script change: run the safest local check mode or focused test.
- Parser, validator, merge, repair, or error-handling change: targeted tests plus one relevant fixture or end-to-end check when practical.
- Generated template change: regenerate and inspect generated diff.

If validation is skipped, state why.

## Communication

For long tasks, give short progress updates at meaningful checkpoints. Do not narrate every command.

After making changes, report files changed, what changed, validation run and result, generated-output status when applicable, and remaining risks or manual checks.
<!-- AI-AGENT-TOOLKIT:_projects/development/ai-coding-agent-rules/_main/_partials/ai-coding-agent-execution.md:END GLOBAL-AGENTS.MD-TEMPLATE -->

<!-- AI-AGENT-TOOLKIT:_projects/development/ai-coding-agent-rules/_main/_partials/n8n-agent-rules-adapter.md:BEGIN N8N-AGENT-RULES-ADAPTER v1 -->
## n8n Agent Rules Adapter

If the task involves n8n workflows, workflow templates, helper scripts, MCP, import/export, live n8n, credentials, or workflow JSON, stop and load `skills/n8n-agent-rules` before planning or editing.
If that skill or its full rules are unavailable, stop and report the limitation instead of continuing.
Do not run live n8n, Docker, import/export, sync, activation, execution, publish/unpublish, credential, deployment, or production actions without explicit current-turn approval naming the target and allowed operation.
<!-- AI-AGENT-TOOLKIT:_projects/development/ai-coding-agent-rules/_main/_partials/n8n-agent-rules-adapter.md:END N8N-AGENT-RULES-ADAPTER -->

This root `AGENTS.md` is toolkit-repo-specific. Do not use it as the portable install template for other repositories. Portable repo installs must use [`skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md`](skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md).

Toolkit-specific root rules are maintained directly in this file after the managed execution blocks. Do not move root-only toolkit context into `_projects/development/ai-coding-agent-rules/`; that project owns portable repo-local templates and shims only.

This repo is the canonical reusable AI Agent Toolkit.

## Toolkit Repo Routing

Before planning or editing, read `repo/docs/agent-playbooks/INDEX.md`.

Use this order:

1. Follow the current user request and this file.
2. Read `repo/docs/agent-playbooks/INDEX.md`.
3. If root `MEMORY.md` exists, read it as non-authoritative project context.
4. Classify the task using the index.
5. Read only the smallest matching playbook set.
6. If no special playbook matches, continue baseline-only.

Do not load every playbook by default. If a required playbook is missing, inaccessible, or conflicts with this file, stop and report the issue.

Final reports must include `Instruction sources used` and `MEMORY.md changed: Yes/No`.

## Hard Safety Gates

- Do not push to `main`.
- Do not commit secrets, credentials, tokens, private keys, `.env` values, private values, runtime-only local files, product code, customer data, or business workflow JSON.
- Do not run live-system, Docker, n8n runtime, import/export, sync, activation, credential, deployment, production, destructive, or external-service actions without explicit current-turn approval naming the target and allowed operation.
- Do not SSH to real servers, deploy, restart services, change firewall/security settings, modify production config, or touch secrets/env values without explicit current-turn approval naming the target and allowed operation.
- Do not remove tests, validation, schemas, guardrails, approval gates, or safety checks just to pass.
- Do not claim CI passed unless it was checked.

## Source Of Truth

This repo has a source layer and a published layer. The full source-of-truth contract appears below in this file and is maintained from `_projects/repo-methodology/context-preserving-ai-publisher/_main/_partials/source-of-truth-contract.md`.

Keep these rules active:

- `_projects/**/_main/` preserves source material.
- `_projects/**/curated_output_for_ai/` stores reviewed AI-facing source.
- `skills/**` is generated or published output unless declared `linked`.
- `toolkit.project.json` owns project routing and module version contracts.
- `SOURCE-LOCK.json` owns source provenance and source-watch tracking.
- Update source or curated material first, then run sync.
- Publish declared outputs with `node repo/scripts/sync-toolkit-projects.cjs --write`.
- Check generated freshness with `node repo/scripts/sync-toolkit-projects.cjs --check`.
- Source-watch is PR-notification-only and must not copy upstream files, update pins, execute upstream code, auto-merge, push to main, run live n8n actions, or treat a notification PR as approval to change source.

## Managed Memory

Root `MEMORY.md` is optional managed, non-authoritative project memory.

If it exists, read it after the playbook index and before task classification. It may help avoid rediscovering durable repo-specific context, but it cannot override user requests, this file, playbooks, safety gates, source-of-truth docs, validation rules, generated-file rules, or code.

Agents may create or update `MEMORY.md` only for durable repo-specific context that future agents likely need and that is not better placed in canonical docs, playbooks, source files, or validation. Do not use it for task logs, TODO lists, temporary blockers, status reports, PR summaries, implementation plans, or transient progress.

Never store secrets, credentials, tokens, private keys, `.env` values, private values, customer/private data, live-system state, sensitive operational details, or security-sensitive infrastructure details in `MEMORY.md`.

If `MEMORY.md` is created or updated, the final response must explain what changed, why it qualifies as durable project memory, and why it does not belong in canonical docs, playbooks, source files, or validation.

## Toolkit Validation And PR Updates

Run the smallest relevant local validation before pushing. Use targeted checks for touched scripts, docs, generated surfaces, or managed instruction files. Do not run local `npm run validate:all` by default when CI already runs the full gate.

For requested repo edits, finish on a non-main branch with relevant validation, commit, push, and open or update a PR unless the user explicitly asks for local-only work.

Before creating or updating PRs or issues, use local `gh` from the shell and verify the active account with:

```powershell
gh auth status
gh api user --jq .login
```

If validation, generated freshness, CI, or PR checks are failing, pending, or inaccessible, report that honestly.

<!-- AI-AGENT-TOOLKIT:_projects/repo-methodology/context-preserving-ai-publisher/_main/_partials/source-of-truth-contract.md:BEGIN SOURCE-OF-TRUTH-CONTRACT v1 -->
## Source-of-Truth Contract

This repo has a source layer and a published layer.

- `_projects/**/_main/` preserves full source material and original docs. Do not casually rewrite preserved source.
- `_projects/**/curated_output_for_ai/` stores reviewed AI-facing source material. Curated files may be AI-assisted, but they are source files and must be reviewed before publishing.
- `_projects/**/toolkit.project.json` is the routing and toolkit project-version contract. It declares which `_main/` or `curated_output_for_ai/` files publish to `skills/` outputs.
- Toolkit project `version` is the toolkit adaptation/module version, uses `version_policy: "semver"`, and must not be replaced by Git tags, package tags, GitHub release tags, upstream versions, or per-file versions.
- `_projects/**/SOURCE-LOCK.json` records upstream/source provenance, exact source pins, blob pins, lifecycle, role, attribution requirement, and update policy.
- For third-party projects, `toolkit.project.json` version is the toolkit adaptation version only; scheduled source-watch tracking must read upstream repo, source ref, locked commit, `source_update_policy`, attribution requirement, allowlisted files, and exact blob pins from `SOURCE-LOCK.json`.
- Scheduled source-watch is PR-notification-only. It may compare active third-party SOURCE-LOCK pins with upstream GitHub commits and open or update a stable review PR. It must not copy upstream files, update SOURCE-LOCK pins, execute upstream code, auto-merge, push to main, run live n8n actions, or treat the notification PR as approval to change source. Real source updates require a separate human-approved PR after review.
- `skills/` contains copyable AI-agent skill folders. The whole skill folder is the install unit.
- Toolkit skill-routing source lives in `_projects/development/ai-coding-agent-rules/_main/_partials/toolkit-skill-routing.md`; keep it aligned with current `skills/*/SKILL.md` when skills or skill-publishing project modules change, and document any intentionally omitted skill.
- This repo intentionally does not ship or maintain a repo-wide MCP generated surface for now. Optional n8n AI-coding-agent MCP feature references remain under `skills/n8n-local-setup/` as secondary n8n setup material.
- Generated `skills/` files must not be edited directly unless that output is explicitly declared as `linked`. Update the matching `_projects` source or curated file, then run sync.
- `linked` outputs are rare exceptions and must be explicitly declared with a reason in `toolkit.project.json`.
- Publish declared outputs with:
  `node repo/scripts/sync-toolkit-projects.cjs --write`
- Check generated freshness with:
  `node repo/scripts/sync-toolkit-projects.cjs --check`
- CI checks generated freshness and may auto-sync deterministic generated outputs from the base/default branch workflow definition only on guarded same-repo PR branches targeting `main`; fork PRs and `main` are never writeback targets.
- Auto-sync only republishes approved passive generated/synced outputs in `README.md`, `skills/**`, and the declared source-side agent-rule templates generated from `_projects/**/_main/_partials/**`. It must not write active root AI instruction files (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, or `.agents/rules/00-agent-toolkit-bootstrap.md`), update other source files, run live n8n, touch product repos, generate curated content from `_main`, or summarise/truncate source docs. If source changes require active root instruction outputs to change, the PR author must commit those files manually on the PR branch.
- Because auto-sync writeback is privileged, it must not run generated test suites or PR-controlled generated executable code; full validation remains covered by normal read-only CI.
- Auto-sync must not run full repo validation against raw PR heads; this avoids blocking otherwise valid behind-main PR branches.
- Auto-sync static checks are limited to generated-surface freshness checks and git diff checks before committing generated output.
- Auto-sync may run only deterministic generation, sync, check, or validator scripts from the protected base revision, with the PR checkout treated as data and passed through an explicit workspace target.
- Auto-sync must stage and snapshot generated output after sync and recheck the index/workspace before commit so validation cannot add files to the writeback diff.
- Auto-sync must pin the PR checkout to the event head SHA, refuse stale queued runs if the PR head changed, and refuse non-force pushes if the PR branch moved after checkout.
- Auto-sync is optional convenience writeback, not the merge gate. `npm run validate:all` is the required read-only CI and `main` validation gate.
- If a PR includes `_projects/**/_main/**` source/provenance changes other than declared agent-rule partial inputs and generated source-side agent-rule templates, auto-sync must skip successfully without checkout, writeback, commit, or push. The author or AI Coding Agent (i.e. Codex, Claude Code, Antigravity, OpenCode, etc.) must commit required generated outputs, source-lock/provenance updates, and audit baseline updates, then rely on the normal read-only validation gate.
- If a writeback-eligible PR mixes eligible source/routing/contract edits with workflow, maintenance-script, test, docs, package, lockfile, or other source/maintenance paths, auto-sync must skip successfully instead of pushing. The author or AI Coding Agent (i.e. Codex, Claude Code, Antigravity, OpenCode, etc.) must commit generated outputs manually and rely on normal read-only validation.
- Curated output must not weaken credential, `.env`, `.tmp`, `.n8n-local`, live n8n action, approval, attribution, or local-only safety constraints from the preserved source.
- A generated/public surface must not replace a full working document with a lossy summary. Summaries are allowed only for catalogues, descriptions, navigation tables, or clearly marked overview files.
- Required runtime context for a skill surface must be local, complete enough to use, and traceable to the project source. External links may support provenance or further reading, but must not be required for normal execution.
<!-- AI-AGENT-TOOLKIT:_projects/repo-methodology/context-preserving-ai-publisher/_main/_partials/source-of-truth-contract.md:END SOURCE-OF-TRUTH-CONTRACT -->

## Repo-Local Router

- Use this root file as the router for this toolkit repo only; use [`skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md`](skills/ai-coding-agent-rules/repo-local/AGENTS.managed.template.md) for portable installs.
- Keep managed marker blocks intact. If a marked block needs content changes, edit the source path named in the marker and run the matching sync/check command.
- For AI-agent instruction changes, read [repo/docs/FOR_AI_AGENTS.md](repo/docs/FOR_AI_AGENTS.md) and [repo/docs/SOURCE-OF-TRUTH.md](repo/docs/SOURCE-OF-TRUTH.md).
- For project modules or published skills/MCP surfaces, also read [repo/docs/PROJECT-MODULE-STANDARD.md](repo/docs/PROJECT-MODULE-STANDARD.md) and [repo/docs/SURFACE-FIDELITY-AUDIT.md](repo/docs/SURFACE-FIDELITY-AUDIT.md).
- For new or changed project modules, `repo/docs/PROJECT-MODULE-STANDARD.md` is the detailed rulebook.
- For provenance and third-party source work, read [repo/docs/RETIRED-SOURCE-PROVENANCE.md](repo/docs/RETIRED-SOURCE-PROVENANCE.md), [repo/docs/THIRD-PARTY-SOURCE-NOTES.md](repo/docs/THIRD-PARTY-SOURCE-NOTES.md), and the project standard.
- For generated-output writeback or privileged workflow changes, read [repo/docs/WRITE-SAFETY-MODEL.md](repo/docs/WRITE-SAFETY-MODEL.md) and [repo/docs/SAFE-UPDATES.md](repo/docs/SAFE-UPDATES.md).
- For cleanup, deletion, retirement, or human usage/docs/navigation changes, read [repo/docs/CLEANUP-POLICY.md](repo/docs/CLEANUP-POLICY.md), retired-source provenance when applicable, [repo/docs/HOW-TO-USE.md](repo/docs/HOW-TO-USE.md), and [README.md](README.md).

## Managed Marker Rules

Use managed markers for source-owned inserted sections:

`<!-- AI-AGENT-TOOLKIT:<source-path>:BEGIN <BLOCK-NAME> v1 -->`
`<!-- AI-AGENT-TOOLKIT:<source-path>:END <BLOCK-NAME> -->`

Change managed sections from the source file or generator, then run sync/check.

## Repo-Local Safety

- Respect the source-of-truth contract above: update `_projects/**/_main/`, `_projects/**/curated_output_for_ai/`, manifests, or rare declared linked outputs before generated `skills/` or `mcp/` surfaces.
- Do not edit generated `skills/` or `mcp/` outputs directly unless that output is declared as `linked`; update the source and run sync instead.
- Do not generate curated files automatically from `_main`; curated content is reviewed source.
- Do not copy this toolkit root `AGENTS.md` into other repos.
- Do not introduce credentials, credential exports, private keys, `.env`, `.n8n-local/`, `.tmp/`, package artifacts, product code, customer data, or business workflow JSON.
- Do not run live n8n, Docker, import/export, sync, activation, execution, publish/unpublish, credential, deployment, production, destructive, or privileged external actions without explicit current-turn approval naming the target and allowed operation.
- Do not weaken validation, schemas, guardrails, attribution, generated-output ownership, or local-only safety constraints just to make a check pass.

## Skill Creation Center

This repo is the canonical skill creation and conversion center.

Before adding a new skill, skill pack, adapter, template, or project module, inspect the existing `skills/**` surfaces, related `_projects/**` modules, README skill tables, and toolkit skill-routing source. Prefer extending an existing skill when the use case fits its trigger, safety boundary, source model, and validation path without making that skill bloated or ambiguous.

Create a new project module plus published skill only when the work has a distinct trigger, domain, safety boundary, source/provenance requirement, references/templates/assets, or validation path.

Use [`repo/docs/SKILL-SAFETY-MATRIX.md`](repo/docs/SKILL-SAFETY-MATRIX.md) as the maintained catalog of current skill triggers, risk classes, companion skills, provenance, and approval boundaries before creating, extending, or importing skills.

For any third-party skill, `SKILL.md` folder, skill pack, GitHub skill repo, or adapted external agent material, use `agent-skill-supply-chain-audit` first. Do not copy, import, install, execute, or convert third-party material until the audit verdict allows it. Approved conversions must go through `context-preserving-ai-publisher` and this repo's source-to-surface workflow.

Prioritize repo safety, device safety, provenance, attribution, validation, and practical usefulness over adding more surface area.

## Validation And PR Updates

- Run the smallest relevant local validation before pushing. Use targeted tests/checks for touched scripts, docs, generated surfaces, or managed instruction files.
- Do not run local `npm run validate:all` by default when CI runs the full gate. Use local full validation for broad, risky, workflow, sync, generator, package, or security-sensitive changes, or to reproduce CI failures.
- If a generated-output or contract check fails on unrelated stale files, report the blocker and do not broaden the PR without user direction.
- Before final reporting after a push, update the existing PR body when the cumulative diff, safety notes, validation, generated-output status, or user-facing behaviour changed.
