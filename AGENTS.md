# AI Agent Toolkit Repo Rules

<!-- AI-AGENT-TOOLKIT:repo/contracts/agent-rules/toolkit-governed-rules.md:BEGIN TOOLKIT-GOVERNED-RULES v2 toolkit=3.42.0 sha256=2930f0892c71 -->
# Toolkit-Governed Repository Rules

With the user's yes, this block and `.github/toolkit-programme.json` turn on Toolkit's GitHub governance for this github.com repository: programme records, decision traces, evidence custody and the rules below. Nothing here applies until the user says yes, without both, or off github.com. The coding gates and delegation are in the Toolkit global rules in the harness's user-level file, with gate mechanics in the gate rules, and apply everywhere. If they are missing (for example in a cloud session), read https://github.com/weijunswj/ai-agent-toolkit/blob/main/repo/contracts/agent-rules/global-rules.md before planning, and load the `n8n-safety-router` skill before any n8n work; if it is unavailable, stop and report that. Repository rules outside this block win on conventions; nothing here relaxes the global safety floor except the evidence-store line, which the floor names.

## Delivery

- Agree a release plan up front: releases, lanes and order. Keep one open release PR per lane; work outside the plan states its reason.
- Finish fast: ship the biggest coherent batch that stays reviewable, reconcile records before the next task, and order work Now, then Later by priority.
- Repository-wide CI, test sharding and time budgets are set here, measured before and after a change.
- Every governed repository keeps a current compact repo map (parts, entry points, sources of truth, ownership, recorded commit), updated in the change that moves what it describes.

## Records And Evidence

- Programme tracking: the parent issue's tracker shows SHA, version, lane and gate, PR, review and UAT state, queue, and completed, deferred and superseded work. Update it when one of those changes; a comment that changes none is its own record. Keep pending gates open after merge.
- Decision traces: the programme issue body is the canonical record. Record each owner decision that changes scope, authority or the plan as one tagged comment (tag on the first line, then `---`); other comments need no index entry. The `github-program-reconciler` lists them by tag; parent and child traces never mix, the latest comment wins within a tag, `SUPERSEDES=<record ID>` replaces a record and long lists page into index comments. G0 reads both traces and has the owner confirm a live-scope summary first (decision-trace playbook).
- SHAs: link files and commits with the 7-character short SHA (longer if GitHub reports it ambiguous). Write the full 40-character SHA only in review verdicts, UAT results and merge summaries.
- Issues: to add a task, search the parent's sub-issues and open or recently closed issues; extend or reopen an owner, else create a child and attach it as a native sub-issue. A child closes as completed once a merge completes every criterion and any owner UAT passed, any remainder moved to a linked follow-up first: that PR says `Closes #n`, else the controller does. Use `Refs` for staged, UAT-pending, blocked, partial or follow-up PRs.
- Custody: session folders, side-session notes, scratchpads and temp paths are never custody. Plans and reviews reach the selected private evidence store before a record cites them or sessions are archived; in a Git store the commit is the manifest and a push plus one fetch the read-back.
- Evidence (transport) stores are agent-managed with standing permission, whatever the backend (private repository, shared folder, drive): once the user-selected store, separate from the task repository, has its identity and privacy verified (a name or prefix alone grants nothing), agents write, reorganise, delete and, on Git, push to or merge into its default branch without asking. Scan every upload for secrets, never delete the sole copy of evidence, never relabel task source as evidence or retry a denied effect.

## Repository Setup

- If the repository does legitimate security-sensitive work, describe it in an `Authorised context` section outside this block: who owns the code, that the work is development and defensive testing of the repository's own software, and that nothing targets third-party systems.
- If the playbook index is missing during an instruction install, repair or refresh, report that it needs installing.
<!-- AI-AGENT-TOOLKIT:repo/contracts/agent-rules/toolkit-governed-rules.md:END TOOLKIT-GOVERNED-RULES -->

## This Repository

This repository is the canonical AI Agent Toolkit, and this file applies to it only: never copy it into another repository. Portable installs use [`skills/repository-agent-rules/repo-local/AGENTS.managed.template.md`](skills/repository-agent-rules/repo-local/AGENTS.managed.template.md). Keep this file short: it loads in every session here, so put detail in routed playbooks or source-of-truth docs and add nothing merely for completeness.

- **Routing:** read the [Toolkit playbook index](repo/docs/agent-playbooks/INDEX.md) (it replaces the portable index), classify the task, and read only the smallest matching playbook set and the docs it names; with no match, continue baseline-only. If a required playbook is missing or conflicts with this file, stop and report.
- **Programme:** for the programme, follow the [Toolkit delivery contract](repo/docs/TOOLKIT-DELIVERY.md) and load only the changed role instructions when continuing. Its preparation does not prove runtime implementation, installed qualification or native permission, and other repositories keep their own bindings.

## Safety

- Toolkit source changes go through a non-main branch and PR. Evidence custody follows the governed block above.
- Never commit secrets, private values, `.env`, `.n8n-local/`, `.tmp/`, package artifacts, runtime-only files, product code, customer data or business workflow JSON.
- Live systems, Docker, n8n runtime, import/export, sync, activation, credentials, SSH to real servers, deployment, firewall or production config, and destructive or external-service actions need explicit current-turn approval naming the target and operation.
- Never weaken tests, validation, schemas, guardrails, attribution, generated-output ownership or approval gates to pass a check, and never claim CI passed without checking it.

## Sources, Markers And Packaging

- Host config writers: follow [host config writes](repo/docs/agent-playbooks/host-config-writes.md).

- Edit canonical surfaces directly (`skills/**`, `repo/contracts/**`, `repo/scripts/**`, `repo/docs/**`); no second publisher tree, and generated output is never a separate source. Before changing skills, contracts, scripts, provenance or synchronizers, read the [Source-of-Truth Contract](repo/contracts/source-of-truth-contract.md) (also synced into the README).
- Toolkit inserts use versioned, hashed markers (`repo/scripts/toolkit-managed-block.cjs`): `<!-- AI-AGENT-TOOLKIT:<source>:BEGIN <NAME> v2 toolkit=<version> sha256=<12 hex> -->` ... `<!-- AI-AGENT-TOOLKIT:<source>:END <NAME> -->`. Edit the named source, then run its sync (`node repo/scripts/sync-agent-instruction-shims.cjs --write`, `node repo/scripts/sync-repo-doc-contract.cjs --write`).
- Native plugin updates are host-local (`.codex-plugin/` for Codex, `.claude-plugin/` for Claude Code). The bridge keeps the managed checkout current and records hub state and update reports; setup also installs the global rules (`repo/scripts/toolkit-global-rules.cjs`). Antigravity gets a portable skills copy only. Hooks are optional; policy lives in docs, validators and the [Bridge doc](repo/docs/TOOLKIT-LOCAL-BRIDGE.md).
- Every PR that changes plugin-packaged content, setup, the bridge, skills, adapters or native plugin metadata prepares its own Toolkit bump with `node repo/scripts/bump-version.cjs --next patch|minor|major` after merging `main`, folding its [changelog fragment](repo/docs/changelog.d/README.md) as its last commit. After merging any PR in this repository, the merging agent runs `node repo/scripts/toolkit-rebump-prs.cjs --apply` after agreeing branch custody with the current builders; without a computer, it asks a computer lane to do so. Recheck CI and route the full delta for review. The bump keeps `repo/contracts/toolkit-local-bridge/version.json`, native plugin inputs and metadata, `BRIDGE_VERSION` and the Codex setup expected version aligned.
- Setup or refresh: follow [For AI Agents](repo/docs/FOR_AI_AGENTS.md); run the managed checkout's setup script when it exists, and `repo/scripts/setup-toolkit.cjs --execute --profile auto-main` only to bootstrap.

## Skill Creation Center

Before adding a skill, adapter, template or contract, check the existing `skills/**`, the README skill tables, the [Skill Safety Matrix](repo/docs/SKILL-SAFETY-MATRIX.md) and the skill-routing source. Extend an existing skill when its trigger, safety boundary, assets and validation fit without bloating it; create a new one only for a distinct trigger, domain, safety boundary, provenance need, asset set or validation path. Third-party skills or agent material go through `skill-product-review` first; nothing is copied, installed, run or adapted until its `allow` or `constrain` verdict covers that scope, and approved adaptations keep licence, attribution, provenance, source locks and validation. Keep reviewed provenance under `repo/source-watch/provenance/**`; source-watch jobs never update it. Prefer safety, provenance and usefulness over more surface area.

## Validation And PRs

- Run targeted checks for touched scripts, docs, generated surfaces and instruction files. Never run `npm run validate:all` locally here; CI owns the full gate.
- If a generated-output or contract check fails on unrelated stale files, report it instead of widening the PR.
- Docs: plain English, no issue/PR refs (CI-checked).
- Use authenticated `gh` for authorised GitHub work. Before creating or updating PRs or issues, confirm the account with `gh auth status` and `gh api user --jq .login`; if that route is unavailable, hold the operation. Authentication grants no task authority.
- Update the PR body when scope or user-facing behaviour changes, and once before asking to merge.
