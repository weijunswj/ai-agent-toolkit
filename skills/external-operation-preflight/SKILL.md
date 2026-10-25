---
name: external-operation-preflight
description: Use before any live change on an outside system, such as a hosting provider, deployment platform, database, bucket, DNS or SaaS service: creating, binding, renaming, migrating, promoting, deploying, pausing a trigger, restoring or merging into a branch that auto-deploys. Binds exact targets to one environment, checks resource identity, authority and downstream effects with an offline checker, and holds on any mismatch. Also owns the backup and restore evidence contract.
---

# External Operation Preflight

Check one live change on an outside system before the owner approves it. The skill plans and checks; it never runs the change, calls a provider or touches credentials itself. The owner's approval of the exact targets and operation is still required.

## Steps

1. **Pick the interface.** Use the best allowed one in this order: the service's connector or plugin, its MCP server, its official API or CLI, browser automation, computer use. A lower one may win when it is clearly better for this operation; say why.
2. **Read the live state.** Read the targets and every resource they use (databases, buckets, queues, domains) from the provider itself. Discovery stays passive: no writes, test sends or probes with side effects unless an approval names the target, the allowed effects and the cleanup.
3. **Write the operation plan** as JSON from [the example](templates/operation-plan.example.json): one environment name (production, alpha, test, restore and so on), the exact targets, each resource with the environment its name says and the environment the provider reports, the bindings between them, the authority entries, what the action sets off downstream, and any route already tried. Put key names and references in the plan, never a secret value.
4. **Run the checker:** `node <this skill>/scripts/preflight-check.cjs plan.json`. It prints a verdict, typed reasons and the plan's SHA-256.
5. **Ask for approval only on ALLOW or ALLOW_WITH_NOTICE.** Show the owner the plan, the verdict, any notice and the plan hash. The approval covers that hash; any change to the plan goes back to step 3.
6. **After the change,** read the result back from the provider, never from labels or your own log, and do every item in `required_read_back`.

## Rules the checker enforces

- **One environment, matching identity.** Each target and resource's name environment must match the provider's. Each binding stays inside one environment. A store writable from two environments is refused. An owner exception that names the resources, the environments, a reason and an end date turns this into ALLOW_WITH_NOTICE.
- **Temporary resources** (test, preview, restore) need a temporary name, a data rule, a cleanup owner, an end date that has not passed, and a provider read-back when removed.
- **Authority is a list.** Entries are resource, action, environment scope and allow or deny. Anything not listed is refused; an allow and a deny for the same thing is a conflict.
- **An action counts with what it sets off.** A merge into a branch that auto-deploys is a deployment. Before that merge, choose one: accept the deployment (revision and health read-back afterwards), pause the trigger first with a read-back, or hold the merge. An active evidence freeze holds the deployment unless the approval says it ends the freeze. An unknown trigger stops the action.
- **Fallback routes.** If one approved route fails before doing anything, the next pre-approved route over the same target, privilege and effect may run; tell the user about the failure. A route that may have changed something stops everything until it is recovered and read back.

## Reasons

| Verdict | Reason | What to do |
|---|---|---|
| HOLD | `RESOURCE_IDENTITY_MISMATCH` | Find out which side is right. Never auto-rename, delete or move a live resource to make it fit; the owner decides. |
| HOLD | `TEMPORARY_RESOURCE_INCOMPLETE` | Add the missing name, rule, owner, end date or read-back. |
| HOLD | `NOT_AUTHORISED`, `RESOURCE_AUTHORITY_PROJECTION_CONFLICT` | Ask the owner for an authority entry, or to resolve the contradiction. |
| HOLD | `DOWNSTREAM_EFFECT_COUPLING_UNRESOLVED`, `DEFER_MERGE`, `EVIDENCE_FREEZE_ACTIVE` | Find the trigger, or get the deployment or pause approved, or hold. |
| HOLD | `ROUTE_FALLBACK_REFUSED`, `PRIOR_ATTEMPT_AMBIGUOUS` | Stop, recover and read back; ask before another route. |
| HOLD | `PLAN_INVALID`, `SECRET_IN_PLAN` | Fix the plan; replace any value with its key name, and treat a pasted value as exposed. |
| ALLOW_WITH_NOTICE | | Pass every notice to the owner with the approval request. |

## Also

- **Pausing a trigger** is its own live change, with before and after read-back.
- **Host resizes** read capacity before and after; new headroom stays unassigned until the owner assigns it.
- **SSH:** plain owner-managed SSH with the owner's own keys comes first. Use an app-connected remote session only when SSH cannot do the job. Toolkit does not build an SSH broker.
- **Backups and restores** follow [the backup and recovery contract](references/backup-and-recovery.md): what to back up, where, how many to keep, and the four kinds of evidence a restore claim needs.

## Do Not Use

- Not for local-only work, code changes with no live effect, or reading public docs.
- n8n live work goes through `n8n-safety-router` first; this checker can still run on its plan.
- Exposure and hardening reviews stay in `self-hosted-service-safety`; keys for the user's own coding apps stay in `toolkit-env`.

## Safety Boundary

Planning and checking only. The checker is offline and read-only. Every live change, deletion, rename, restore, trigger pause or credential action needs the owner's explicit approval naming the target and operation, on a plan the checker allowed.
