# Reduced Atomic Child Issue Template

**Governance mode:** `toolkit-governed`
**Policy version:** 2.0.0

## Instructions

Use this template for small, atomic tasks that do not require the full comprehensive structure. Closed issues retain their structural profile and must pass all required-section checks.

- This body is current authority. Comments preserve chronology.
- PR merge does not automatically complete a task.
- The reconciliation timestamp changes only after substantive reconciliation.
- The web controller owns acceptance and checklist completion by default.
- Coding agents propose text unless explicitly granted bounded writes.
- Implementers never self-certify independent review or acceptance.
- Do not include secret values or unnecessary private paths.

## Template

```md
# Current status

<one current verdict/status line>

Last reconciled: **DD Month YYYY, HH:mm SGT**

Parent tracker: #<parent-issue>
Implementation branch: <branch-name-or-null>
Implementation PR: #<pr-number-or-not-opened>
Replacement reason: <reason> (conditional — omit if not a replacement PR)
Supersedes PR: #<pr_number> (conditional — omit if not a replacement PR)
Depends on: <issue-identity-or-none>
Blocks: <issue-identity-or-none>
Related: <issue-identity-or-none>

# Why this issue exists

<Why this task exists.>

# Completed work

- <Completed item>

# Blockers

- <Blocker or `none`>

# Remaining work

- [ ] <Remaining task>

# Acceptance criteria

- [ ] <Criterion that must be true before closure>

# Linked PRs or follow-ups

- PR #<number> — <description and state>

# Safety and authority

- Controller-owned: reconciliation, acceptance, checklist completion, closure.
- Implementer scope: read, implement, report evidence, propose text.
```

## Required Sections Checklist

When auditing, these sections must be present (including for closed issues):

- [ ] Current status (non-empty)
- [ ] Reconciliation timestamp (exactly one, well-formed DD format)
- [ ] Parent link
- [ ] Implementation branch
- [ ] Implementation PR
- [ ] Why this issue exists
- [ ] Completed work
- [ ] Blockers
- [ ] Remaining work
- [ ] Acceptance criteria
- [ ] Linked PRs or follow-ups
- [ ] Safety and authority
