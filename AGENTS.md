# AI Agent Toolkit Repo Rules

## This Repository

This repository is the canonical AI Agent Toolkit, and this file applies to it only: never copy it into another repository. Governed repositories, this one included, get the Toolkit-governed rules from the installed Toolkit at session start, never from a copy in `AGENTS.md`. Keep this file short: it loads in every session here, so put detail in routed playbooks or source-of-truth docs and add nothing merely for completeness. Keep Toolkit generic and least restrictive for every harness and agent (global Development Principles: Generic, platform first).

- **Routing:** read the [Toolkit playbook index](repo/docs/agent-playbooks/INDEX.md) (it replaces the `toolkit-playbooks` skill index here), classify the task, and read only the smallest matching playbook set and the docs it names; with no match, continue baseline-only. If a required playbook is missing or conflicts with this file, stop and report.
- **Programme:** for the programme, follow the [Toolkit delivery contract](repo/docs/TOOLKIT-DELIVERY.md) and load only the changed role instructions when continuing. Its preparation does not prove runtime implementation, installed qualification or native permission, and other repositories keep their own bindings.

## Authorised context

This repository is the owner's own code. Its security-sensitive work (merge, push, credential and attribution guards, hook probes, hostile-input tests) is development and defensive testing of this repository's own software, on isolated fixtures, scratch repositories and the owner's own computers. Nothing here targets third-party systems or anyone else's data.

## Safety

- Toolkit source changes go through a non-main branch and PR. Evidence custody follows the Toolkit-governed rules.
- Never commit secrets, private values, `.env`, `.n8n-local/`, `.tmp/`, package artifacts, runtime-only files, product code, customer data or business workflow JSON.
- Live systems, Docker, n8n runtime, import/export, sync, activation, credentials, SSH to real servers, deployment, firewall or production config, and destructive or external-service actions need explicit current-turn approval naming the target and operation.
- Never weaken tests, validation, schemas, guardrails, attribution, generated-output ownership or approval gates to pass a check, and never claim CI passed without checking it.

## Sources, Markers And Packaging

- Host config writers: follow [host config writes](repo/docs/agent-playbooks/host-config-writes.md).

- Edit canonical surfaces directly (`skills/**`, `repo/contracts/**`, `repo/scripts/**`, `repo/docs/**`); no second publisher tree, and generated output is never a separate source. Before changing skills, contracts, scripts, provenance or synchronizers, read the [Source-of-Truth Contract](repo/contracts/source-of-truth-contract.md) (also synced into the README).
- Toolkit inserts use versioned, hashed markers (`repo/scripts/toolkit-managed-block.cjs`): `<!-- AI-AGENT-TOOLKIT:<source>:BEGIN <NAME> v2 toolkit=<version> sha256=<12 hex> -->` ... `<!-- AI-AGENT-TOOLKIT:<source>:END <NAME> -->`. Edit the named source, then run its sync (`node repo/scripts/sync-agent-instruction-shims.cjs --write`, `node repo/scripts/sync-repo-doc-contract.cjs --write`).
- Native plugin updates are host-local (`.codex-plugin/` for Codex, `.claude-plugin/` for Claude Code). The bridge keeps the managed checkout current and records hub state and update reports; setup also installs the global rules (`repo/scripts/toolkit-global-rules.cjs`). Antigravity gets a portable skills copy only. Hooks are optional; policy lives in docs, validators and the [Bridge doc](repo/docs/TOOLKIT-LOCAL-BRIDGE.md).
- Every PR that changes [plugin-packaged content](repo/contracts/source-of-truth-contract.md#version-bumps), setup, the bridge, skills, adapters or native plugin metadata holds `main`'s version, carries a [changelog fragment](repo/docs/changelog.d/README.md) and names its level in one body line, `Bump: patch|minor|major`. The merging agent bumps once, at merge time: on the PR branch it merges `main`, runs `node repo/scripts/bump-version.cjs --next <level>`, pushes, waits for green CI and merges that head (a merge train, `repo/scripts/toolkit-merge-train.cjs`, bumps once for all its PRs); a clean main merge and the version-only commit need no new review, a source conflict gets a delta review. A PR that already carries a bump is re-bumped by the re-bump workflow, or by `node repo/scripts/toolkit-rebump-prs.cjs --apply` after agreeing branch custody with its builder. The bump keeps `repo/contracts/toolkit-local-bridge/version.json`, native plugin inputs and metadata, `BRIDGE_VERSION` and the Codex setup expected version aligned.
- Setup or refresh: follow [For AI Agents](repo/docs/FOR_AI_AGENTS.md); run the managed checkout's setup script when it exists, and `repo/scripts/setup-toolkit.cjs --execute --profile auto-main` only to bootstrap.

## Skill Creation Center

Before adding a skill, adapter, template or contract, check the existing `skills/**`, the README skill tables, the [Skill Safety Matrix](repo/docs/SKILL-SAFETY-MATRIX.md) and the skill-routing source. Extend an existing skill when its trigger, safety boundary, assets and validation fit without bloating it; create a new one only for a distinct trigger, domain, safety boundary, provenance need, asset set or validation path. Third-party skills or agent material go through `skill-product-review` first; nothing is copied, installed, run or adapted until its `allow` or `constrain` verdict covers that scope, and approved adaptations keep licence, attribution, provenance, source locks and validation. Keep reviewed provenance under `repo/source-watch/provenance/**`; source-watch jobs never update it. Prefer safety, provenance and usefulness over more surface area.

## Validation And PRs

- Run targeted checks for touched scripts, docs, generated surfaces and instruction files. Never run `npm run validate:all` locally here; CI owns the full gate.
- If a generated-output or contract check fails on unrelated stale files, report it instead of widening the PR.
- Docs: plain English, no issue/PR refs (CI-checked).
- Use authenticated `gh` for authorised GitHub work. Before creating or updating PRs or issues, confirm the account with `gh auth status` and `gh api user --jq .login`; if that route is unavailable, hold the operation. Authentication grants no task authority.
- Update the PR body when scope or user-facing behaviour changes, and once before asking to merge.
