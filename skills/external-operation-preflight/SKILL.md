---
name: external-operation-preflight
description: Use before any live change on an outside system, such as a hosting provider, deployment platform, database, bucket, DNS or SaaS service: creating, binding, renaming, migrating, promoting, deploying, pausing a trigger, restoring or merging into a branch that auto-deploys. Binds exact targets to one environment, checks resource identity, authority and downstream effects with an offline checker, and holds on any mismatch. Also owns the backup and restore evidence contract.
---

# External Operation Preflight

Check one live change on an outside system before the owner approves it. The skill plans and checks; it never runs the change, calls a provider or touches credentials.

## Steps

1. **Pick the interface** in this order: the service's connector or plugin, its MCP server, its official API or CLI, browser automation, computer use. A lower one may win when clearly better for this operation; say why.
2. **Read the live state** of the targets and every resource they use from the provider itself. Discovery stays passive: no writes, test sends or side-effect probes unless an approval names the target, allowed effects and cleanup.
3. **Write the plan** as JSON from [the example](templates/operation-plan.example.json): one environment, the exact targets, each resource's name environment and provider environment, `temporary` (true or false) on everything, bindings, authority entries, `downstream` (trigger `NONE` when nothing is set off), routes tried, and for production a `rollback` plan and `backup_evidence`. Key names only, never a secret value.
4. **Run** `node <this skill>/scripts/preflight-check.cjs plan.json`. It prints a verdict, typed reasons, the date checked and the plan's SHA-256.
5. **Ask for approval only on ALLOW or ALLOW_WITH_NOTICE**, showing the plan, verdict, notices and hash. The owner's current-turn approval covers that hash; any change to the plan goes back to step 3.
6. **After the change,** read the result back from the provider, never from labels or your own log, and do every `required_read_back` item.

## What the checker enforces

It fails closed: a missing, unknown or malformed field holds the plan.

- **One environment.** Names and provider read-back must agree; every action and binding stays inside the operation's environment. A store writable from two environments is refused unless an owner exception names the resource, environment, reason and an end date.
- **Temporary resources** (any environment whose name has test, testing, preview, restore or drill in it, and anything marked temporary) need a temporary name, data rule, cleanup owner, unexpired end date and a provider read-back on removal.
- **Authority is a list** of resource, action, scope and allow or deny, checked for the operation's own action and every extra action. Unlisted means refused.
- **An action counts with what it sets off.** A merge or push into an auto-deploying branch is a deployment: accept it, pause the trigger first with a read-back, or hold. An evidence freeze holds the deployment unless the approval ends it. An unknown trigger stops the action.
- **Production** is any environment whose name has a production word (production, prod, prd, live) or none of these words: alpha, beta, staging, stage, dev, development, test, testing, qa, uat, sandbox, preview, restore, drill, local. So `main`, `prd`, `prod-eu` and `qa-prd` count. A plan that touches production anywhere, including a store reached through an owner exception, needs `rollback` with a plan and the operation's environment, and backup evidence at `retrievable` or higher for anything that can touch data (only restart and trigger pause or resume are exempt).
- **Fallback routes** run only after a route failed before doing anything, and only when pre-approved with the same target, privilege, credential and effect. Tell the user about the failure.

## Reasons

| Reason | What to do |
|---|---|
| `RESOURCE_IDENTITY_MISMATCH` | Find which side is right. Never auto-rename, delete or move a live resource to fit; the owner decides. |
| `TEMPORARY_RESOURCE_INCOMPLETE` | Add the missing cleanup details. |
| `NOT_AUTHORISED`, `RESOURCE_AUTHORITY_PROJECTION_CONFLICT` | Ask the owner for an entry, or to resolve the contradiction. |
| `DOWNSTREAM_EFFECT_COUPLING_UNRESOLVED`, `DEFER_MERGE`, `EVIDENCE_FREEZE_ACTIVE` | Find the trigger, get the deployment or pause approved, or hold. |
| `ROLLBACK_EVIDENCE_MISSING`, `BACKUP_EVIDENCE_MISSING` | Write the rollback; prove the backup per the contract below. |
| `ROUTE_FALLBACK_REFUSED`, `PRIOR_ATTEMPT_AMBIGUOUS` | Stop, recover and read back; ask before another route. |
| `PLAN_INVALID`, `SECRET_IN_PLAN` | Fix the plan; replace any value with its key name and treat a pasted value as exposed. |

ALLOW_WITH_NOTICE: pass every notice to the owner with the approval request.

## Also

- **Pausing a trigger** is its own live change, with before and after read-back.
- **Host resizes** read capacity before and after; new headroom stays unassigned.
- **SSH:** plain owner-managed SSH with the owner's keys first; an app-connected remote session only when SSH cannot do the job. No SSH broker.
- **Backups and restores** follow [the backup and recovery contract](references/backup-and-recovery.md).

## Do Not Use

Not for local-only work or code changes with no live effect. n8n live work goes through `n8n-safety-router` first. Exposure reviews stay in `self-hosted-service-safety`; the user's coding-app keys stay in `toolkit-env`.

## Safety Boundary

Planning and checking only. Every live change, deletion, rename, restore, trigger pause or credential action needs the owner's explicit current-turn approval naming the target and operation, on a plan the checker allowed.
