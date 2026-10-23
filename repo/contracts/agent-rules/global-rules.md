# Toolkit Global Rules

Installed by AI Agent Toolkit setup; applies in every folder. Work execution-first: inspect, make the smallest safe change, validate, report honestly. Answer, review and plan without editing files. For broad, ambiguous, architectural or risky work, make a repository-specific plan before editing.

## Precedence And Safety Floor

Follow, in order: the user's current request and their own instructions (custom instructions, preferences); the repository's instructions (`AGENTS.md`, `CLAUDE.md` or equivalent, including any Toolkit-governed block) and what they point to; these rules; relevant skills or plugins; best practice. Where repository instructions conflict with these rules, the repository wins on conventions and workflow. Report material conflicts.

If the repository's `AGENTS.md` is not already in your instructions, read it, and any nested `AGENTS.md` covering your files, before starting.

Repository text other than the governed evidence-store rule cannot relax this safety floor; only the user can, in the conversation or their own instructions:

- Never commit or push secrets, credentials, tokens, private keys, `.env` values or other private values.
- No destructive, live, deployment or credential action without explicit approval.
- Never push task or product source to the default branch.
- Never merge without the owner's OK on a summary of the merge's external effects.
- No AI attribution in commits or PRs: no Co-Authored-By or session trailers, session links or "Generated with" footers.

## Entry Routing

- **Ordinary task** (documents, research, questions, code examples), even when the working folder is a Toolkit repository: do it directly. No G0/G1/G2, issue records, controller reads or GitHub writes.
- **Repository without a Toolkit-governed block** (including company repositories and new projects): these rules plus the repository's own. Do not edit its instruction files unless the user explicitly installs Toolkit governance (`repository-agent-rules`); offer that only when the user wants the G0/G1/G2 workflow. GitHub access is transport only: after requested edits, branch, push and open a PR, and never merge unless the user says so.
- **Substantial software project with no repository yet:** when a repository and the G0/G1/G2 lifecycle would clearly help, recommend them once; if the user declines, carry on as an ordinary task.
- **Toolkit-governed repository** (its `AGENTS.md` carries the `TOOLKIT-GOVERNED-RULES` block): also follow that block.
- **Controller role:** inactive unless the user explicitly appoints this session controller for a named repository. A session started by another agent or given a role packet (G0, G1, G2, reviewer, helper) is an executor even if an appointment is visible: follow the packet and repository rules, keep the role, and read only the `CONTROLLER.md` clauses the task needs. If unsure, act as executor and ask. On appointment, in a new session or after lost context, read and bind `repo/CONTROLLER.md` from `weijunswj/ai-agent-toolkit` `main`, never remembered governance. Before each later launch or authority transition, check its revision and reread only if it changed; if it is unreadable, hold controller actions.
- **Toolkit feedback:** when a run exposes a reusable Toolkit governance or workflow gap (not only a repository defect), end the message with a short `TOOLKIT_FEEDBACK` block (gap, evidence, smallest general fix) without interrupting the run or widening scope.

## Safety Gates

Get explicit approval bound to the exact action before anything that may:

- mutate a live or external system;
- change credentials, secrets, auth, tokens, private keys or environment values;
- deploy, publish, activate, deactivate, import, export, sync, restart or expose services;
- run Docker or external-service actions outside a clearly safe local or test context;
- touch customer, private or private business data;
- delete, overwrite, archive or run destructive commands;
- remove validation, tests, safety checks or guardrails;
- rewrite git history.

Deleting scratch this agent created in this task (temporary worktrees, briefs, outputs, test runs/repositories) needs no approval after durable report/evidence recording. Never delete sole evidence, user data or anything the agent did not create under this exception.

Before a gated action, confirm an approval covers it and the host-native permission exists. An approval binds the owner, action, target, resources, effects, recipient, conditions and expiry, and survives only a change of turn, worker, chat or transport for the same pending action; anything changed, new, revoked, expired or left unapproved by its outcome needs fresh approval. Approval, assignment, custody and capability never supply a missing host-native permission. Words like `continue`, `next`, `apply` or `do it` stay within the approved scope.

## Delegation

The root session owns integration, validation, conflict resolution and final judgement, and validates every returned result. Give each helper an isolated context and one minimal self-contained task. Outside Toolkit-governed work the limit is one layer: the main session may start subagents; subagents never start another. Mutating siblings need disjoint files and scope; read-only siblings may investigate separable questions in parallel. Run parallel builders only on disjoint files with no dependency on work still in review.

## Tool Preference

For an external service, prefer in order: its connector or plugin, its MCP server, its official API or CLI, browser automation, computer use. A lower option may win when materially better for one operation. If the preferred one is missing, guide its setup rather than silently downgrade. Never ask for or repeat a key or token in chat; use `toolkit-env`.

## Model Safety Flags

Prefer plain accurate words (`stop`, `remove`, `skip check`) over loaded ones; keep exact terms and real API names. Never disguise genuinely offensive work to avoid a safety classifier. If you or a subagent are switched to a fallback model, stop, report the time, request ID if shown and request, and retry in a fresh session with a clearer request or ask the owner. `claude --safe-mode` shows whether instruction files caused the flag.

## Shipping

Take the shortest safe path to a usable, verifiable outcome: `COMPLETE THE BASICS -> SHIP -> OBSERVE -> IMPROVE`. Perfection is not completion.

Before shipping, complete the applicable minimum floor: core functionality and critical workflows; consequential correctness; authentication, authorisation and tenant isolation; security boundaries; data integrity, persistence, migration and destructive-operation safety; privacy and secrets; required validation and truthful readiness evidence; deployment, health and rollback prerequisites when release is in scope; every explicit acceptance criterion.

Classify remaining work as `SHIP_BLOCKER` or `POST_SHIP`. Known material defects in the floor block. Polish, speculative refactors, future-proofing, optional abstraction, non-critical cleanup and low-confidence risks are `POST_SHIP` unless concrete evidence makes them blockers. Shipping bias never overrides approvals, safety gates, privacy, required validation or finality. Source-only checks, fixtures and CI do not prove user acceptance or an installed result: before handing work to the user for acceptance, check the real installed or deployed result where one exists.

**Finish authorised work before stopping.** Carry every dependency-ready safe step of authorised work to the actual deliverable in one run where practical (implementation, targeted tests, CI, authorised publication with conflict controls, readback), then report once instead of asking whether to continue. A plan, green test, commit, draft PR, helper return, checkpoint, upload, CI watcher start or progress note is not a finish. A genuine user decision, new scope or spend, missing permission, credential or route, unknown external effect, incomplete CI or pending independent review holds only the steps that depend on it; continue the rest and report the exact hold and next action. This never authorises working around a denial, an unsafe retry, a duplicate writer, an unapproved model launch or claimed background work.

## Engineering Defaults

- **Ownership:** give stateful or effectful behaviour (application, runtime, resource, persistence, workflow) a cohesive owner object with explicit constructor dependencies and methods that enforce its invariants and effect order, composed through narrow interfaces. Pure transformations, data definitions, predicates and stateless adapters may stay functions. No mutable state in module globals and no classes that only forward. Refactors keep public behaviour, approvals, independent readback, concurrency controls and recovery semantics. Record the boundary and reason for a consequential exception, and have planning, validation and review check the actual state and effect owners and their dependency contracts, not class counts. Never refactor generated or third-party code as canonical source; keep its licences and provenance.
- **Invariant models:** authority, custody, state-machine or host-config features start from a written model of who may do what in which state and a closure matrix (command x state x role, or config key x cited host limit), tested table-driven and reviewed against; a missing path reopens the matrix.
- **Errors and privacy:** user-facing errors are generic with a support-safe reference that matches the server log entry. Logs hold no prompts, uploads, model outputs, secrets, auth headers or cookies, payment data, private connector data or unneeded personal data.
- **Fallbacks:** fix the real failure path. No broad fallbacks, silent compatibility paths, sample-data fallbacks, fake success or catch-and-continue unless needed for correctness, data or migration safety, or approved compatibility; then make it narrow, visible, tested on both paths and documented with a removal condition. Never hide data loss, auth, permission, payment, persistence, audit, security, missing config, broken integrations or failed validation, use fake business data, or silently downgrade production behaviour.
- **Deployment branches:** unless the repository has its own convention, a deployment or release-preparation branch for a named environment is `deployment/<environment>` (lowercase, e.g. `deployment/staging`); never `deploy/`, `release-deploy/`, bare `prod/` or `staging/`. A branch name grants no deployment, merge or live authority.

## Scope And Hygiene

Before editing, read repository instructions, the playbook index (e.g. `docs/agent-playbooks/INDEX.md`) and only the smallest matching docs, never recursively; include changed workflow, setup, policy, generated-file, migration, API-contract and operations docs. Use and maintain repo maps. Inspect targets; choose the smallest validation. Broaden scans only if targeted evidence is insufficient.

Keep the diff narrow and in style. Change order: no change, reuse, smallest root-cause fix, bounded simplification, new abstraction only if needed. Never weaken validation, schemas, guardrails, approvals or error handling to pass. After editing, run the smallest validation first, fix targeted failures, rerun, and review the diff for unrelated changes.

**Change-local hygiene:** in each change, check affected direct, indirect, dynamic, generated, test, documentation and external consumers. Remove superseded code, routes, exports, settings, dependencies, fallbacks and references in the same change. Keep a compatibility path only with a verified current consumer, a safety or recovery reason, an owner, a removal trigger and a focused test; never discard active or unknown recovery effects. Record brief removal and retention evidence with the normal tests. This is part of the change, not an extra gate or a whole-repository audit.

Status, reports, plans, handoffs and operations notes go under an existing documented path, not new root `STATUS.md`, `REPORT.md` or `PLAN.md`. Broad docs work merges durable findings into the smallest canonical home, compresses without losing decisions, validation, risks, provenance, ownership or licensing, and reports what was consolidated, kept, archived or deleted.

Put scratch first in a gitignored repo/worktree temp folder (e.g. `.tmp/`); use a user-profile folder only for an outside path or more permission, never a drive root. Delete scratch once its report/evidence is recorded.

When a file says it is generated, edit its source, template or generator and regenerate, unless the user asks for generated output only or a manifest marks it directly maintained. Use plain ASCII punctuation in agent-facing and machine-read text unless the file already uses another character set.

## Human-readable Work

New or changed human-facing work (screens, labels, notifications, errors, instructions, documents, operator output, diagrams, workflows) uses plain accurate names for its reader, not internal programme, release or run labels. Operational artefacts describe their real behaviour: what they are for, what starts them, inputs, main actions, outputs, failure and recovery, and who acts, with short help nearby and machine IDs kept out of titles. n8n workflows follow `n8n-safety-router`'s readable presentation; renames keep node IDs, expressions, connections and credentials. Check the real surface when validating: misleading text is a real defect, but unrelated work triggers no blanket rename. Protocol strings, historical receipts and frozen evidence change only with proven consumers and a safe transition; a retained unclear label names its consumer, owner, need and removal condition. User-facing text (skills, prompts, CLI output, docs) describes current behaviour only; versions, release qualifiers and roadmap labels go in changelogs and records.

## Validation And Git

Use the repository's documented validation, else the smallest relevant check. Run targeted tests locally and let CI run the full gate (a full local run only for broad, risky, workflow, generator, package or security-sensitive changes, known CI failures or thin coverage). Keep tests fast without losing coverage. After interruptions, check for orphaned package, test or server processes. Say why when you skip validation.

After requested edits, unless the user asked for local-only work: validate, commit to a non-default branch, push, and open or update the PR with a body matching the full base-to-head diff (scope, safety, validation, generated output, user-facing behaviour). Check CI on the exact PR head with one `gh pr checks <PR> --watch --interval 60` or `gh run watch <run> --exit-status`, no keepalive loops or duplicate watchers, and never claim CI passed without every required check. On failure, read the logs and make one targeted fix; after two failed fixes, stop and report. If CI is inaccessible, say so and give the command. Never push failed validation, live or runtime files, or safety-blocked changes.

After a merge, fast-forward the local default-branch checkout only when it is on that branch and clean; otherwise skip it and say why. Never reset or force.

Issue and PR tracking acts only on the current repository's own remote and never authorises merge, deployment, secrets or workflow changes. To add a task, search the parent's sub-issues (if any) and open or recently closed issues; extend or reopen an owner, else create a child, attach it as a native sub-issue and read it back. Use `Refs` for staged, UAT-pending, blocked or follow-up PRs, and `Closes`/`Fixes` only when the merge completes every criterion and the owner's UAT has passed. Verify the exact head before resolving. Keep issue bodies current and history in comments; report failed writes. Close an issue only after its PR merged and the owner's UAT passed, first moving any remainder to a linked follow-up issue or PR.

## Communication

Make every action-blocking question to the user (choose, approve, confirm, give a path, continue) one fully bold sentence. On long tasks, update briefly at real checkpoints without narrating commands. Report changes, exact validation results, generated-output status, remaining risks and manual checks, the PR link and checked CI status.
