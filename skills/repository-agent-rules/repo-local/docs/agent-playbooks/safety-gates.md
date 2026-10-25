# Safety Gates Playbook

Use this when a task may affect live systems, credentials, secrets, customer/private data, destructive state, deployments, runtime state, external services, Docker, SSH, auth, or security settings.

## Approval Rule

Before a risky action, verify that explicit approval is bound to the exact action and remains valid; request fresh approval when the scope does not cover the action or is revoked, expired, or unresolved.

The evidence-store line in the managed `AGENTS.md` is the standing approval for that store: writes, deletions and merges there need no further approval.

Bind each approval to the exact owner, action, target, resources, effects, recipient, conditions, expiry, revocation state, and recorded outcome. An unchanged, unexpired, unrevoked approval remains valid for the same still-pending action when only the turn, worker, chat, or transport changes. Assignment, custody, capability, and native permission remain separate; an approval, receipt, or prose cannot supply missing native permission. A changed or new action, revoked or expired approval, or recorded outcome that leaves further work unapproved requires fresh approval or host confirmation before that additional effect. Words like `continue`, `next`, `apply`, or `do it` stay within the approved scope.

## Standing Permission Asks

When a needed step stops on the owner (an approval, a host permission prompt, or a safety check the owner may lawfully clear), ask for a decision instead of sending the owner to do the step by hand, and never route the step around the stop.

### Check the ledger first

Read the standing-permission ledger before asking. An entry covers the step only when it is active, its review date has not passed, and its machine, project or repository, folder or script, and action match the step exactly. A wider, changed or new step asks again. A recorded "no" also counts: do not ask again for that scope unless the owner raises it.

### What may be offered

- **Standing (from now on):** a repeated, reversible, narrowly scoped step on a named machine and folder, with checks an agent can run itself before acting and a backup or undo. Examples: replacing a tested script in one named folder; running one named read-only command; writing to one named scratch or evidence folder.
- **Just this once:** anything new, wide or one-off.
- **Never offered, only explained:** real keys, credentials, tokens or `.env` values; force-pushes, history rewrites or deleting the only copy of evidence; merging without the owner's OK on a summary of its external effects (each merge stays its own OK); production, live-system, firewall or security changes; turning off tests, validation, guardrails, attribution rules or any safety check; anything the host hard-denies; anything that means acting as the owner.

### The card

One plain-English card, one screen, with the recommended option marked. In Claude Projects use a decision card; in plain Claude Code use the native question prompt.

- **Stopped on:** the step in plain words.
- **Why it stopped:** one line, for example "your laptop's safety check blocks changing scripts it didn't write".
- **What I'd do:** the exact machine, folder or script, and action.
- **Checks first, told after:** what must pass before acting, and what the owner is told afterwards.
- **Not covered:** one line naming what the grant does not allow.
- **Options:** just this once; yes, from now on for exactly this; no. Offer "for all my projects" as a scope only where the step makes sense everywhere, never as the default.

Ask at most once per scope, and batch several asks into one card where they arrive together.

### The ledger

The ledger lives in the owner's selected evidence (transport) store at `standing-permissions/ledger.json`, so every project and computer reads the same list. With no evidence store, offer only "just this once" or "no" and say a standing OK needs one. Agents write the ledger under the evidence-store standing approval, scan it for secrets, and read the write back. It never holds secrets or personal data.

Each entry has: `id`, `granted_at`, `decision` (`standing`, `once` or `no`), `answer_ref` (where the owner answered, such as a card or message id), `machine`, `scope` (`project` or `all-projects`), `project` (the project or repository; empty for `all-projects`), `target` (exact folder or script), `action`, `checks_first`, `told_after`, `not_covered`, `native_rule` (the host rule the owner added, or empty), `review_by` (90 days after `granted_at`), `status` (`active`, `revoked` or `expired`).

### Review and revoke

- **Review:** after `review_by` an entry no longer covers anything. At the next use, ask one line, "still OK?", and on yes record a new `review_by`. Never nag between uses.
- **Revoke:** the owner says "revoke <id>" or edits the entry. Mark it `revoked`. If it has a `native_rule`, tell the owner which rule to remove in `/permissions`.

### Host permission stays separate

A ledger entry is owner authority only. It never supplies host-native permission, never makes a hard stop clearable, and never replaces the existing approval rules above.

- The ledger works the same in every harness: it is a plain file in the evidence store. What the host lets through is decided by each harness's own permission settings:
  - **Claude Code:** `/permissions` allow rules, and the auto mode classifier's `autoMode` entries, which it reads only from the owner's user settings or managed settings. The classifier reads the owner's own messages and the commands run, not tool output, so a card tap relayed to another machine does not clear it.
  - **Codex:** `prefix_rule()` entries in a rules file such as `~/.codex/rules/default.rules`, where its own "don't ask again" approvals are saved.
  - **Any other harness:** its own allow setting. If it has none, a standing OK still saves the owner the question, but the host prompt stays.
- Where the host still blocks a granted step, the card names the exact native rule for that harness, for example an `autoMode.allow` entry, a narrow `Bash(...)` allow rule or a `prefix_rule()`, and the owner adds it once through the harness's own settings. Agents never write their own permission settings.
- After a grant, the same session or any session in scope does the step through its normal route. If the host still blocks it, stop and tell the owner in one line what the block is. Never retry another way, in another session, by script, UI or computer use.

### Worked example

The owner answered a card with a standing OK: on one named laptop, agents may replace the session digest script and its test file in one named folder, only after the tests pass and a real-data dry run scans clean, keeping a backup of the live script, and telling the owner afterwards. Not covered: any other file, folder or action, or running new code on the laptop. Review in 90 days.

## Never Do By Default

- Do not modify credentials, secrets, tokens, private keys, `.env` values, or private values.
- Do not run destructive commands, rewrite git history, deploy, restart services, change firewall/security settings, or mutate production config without approval.
- Do not touch customer/private data or live databases without approval.
- Do not remove tests, validation, guardrails, or approval gates to make a check pass.

## Personal Data Pushed By Mistake

- Pushed to a public repository means public. Clones, forks, cached views and pull request references can keep it; squashing, rebasing, force-pushing or deleting the branch does not remove it from GitHub.
- Agents never rewrite history or force-push to "fix" it. Remove the value in a new commit, record the affected commit SHAs and where the value appeared (place and class, never the value), and tell the owner at once. Rotate anything credential-like first.
- Offer the owner the GitHub removal route: GitHub's sensitive-data procedure, then a GitHub Support request to purge cached views and pull request references. That route is the owner's decision and action, and it never reaches forks or other people's clones.

## History Rewrites

- In a Toolkit-governed or personal-data-guarded repository, and when pushing to an evidence store (a `TRANSPORT-*` repository), the Toolkit agent hooks refuse force pushes: `--force`, `-f`, `--force-with-lease`, `--mirror` and `+refspec`. Push a new commit or a merge commit instead. Branch rules on GitHub stay the real protection.
- Before concluding that history was rewritten, run `git rev-parse --is-shallow-repository`. A shallow clone shows its oldest fetched commit as a root and `git fetch` can print `(forced update)` for a plain fast-forward. Fetch full history first (`git fetch --unshallow`), or ask GitHub to compare the two commits, and only then check ancestry.

## Reporting

If approval is required, state the action, target, risk, and exact confirmation needed. If approval is not available, stop before the risky action and report the safe work completed.
