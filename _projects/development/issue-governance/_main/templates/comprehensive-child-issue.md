# Comprehensive Multi-Step Child Issue Template

**Governance mode:** `toolkit-governed`
**Policy version:** 2.0.0

## Instructions

Use this template for material multi-step tasks. Closed issues retain their structural profile and must pass all required-section checks.

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

Parent tracker: #<parent_issue>
Implementation branch: <branch_name> or `null`
Implementation PR: #<pr_number> or `Not opened`
Replacement reason: <reason> (conditional — omit if not a replacement PR)
Supersedes PR: #<pr_number> (conditional — omit if not a replacement PR)
Depends on: #<issue_number> or `none`
Blocks: #<issue_number> or `none`
Related: #<issue_number> or `none`

# Why this issue exists

<Why this task exists, what problem it solves, and why now.>

# Goal and scope

<What this issue delivers. Include non-goals where useful.>

## Non-goals

- <Explicit out-of-scope items>

# Completed work

- <Completed item with evidence or PR reference>

# Current blockers and findings

- <Blocker or finding with evidence>

# Remaining steps

- [ ] <Remaining task>
- [ ] <Remaining task>

# Acceptance criteria

- [ ] <Criterion that must be true before closure>
- [ ] <Criterion that must be true before closure>

# Linked PRs and follow-ups

- PR #<number> — <description and state>
- Follow-up: #<number> — <description>

# Decisions and durable evidence

- <Decision with date and rationale>

# Safety and authority

- Controller-owned: reconciliation, acceptance, checklist completion, closure.
- Implementer scope: read, implement, report evidence, propose text.
- Bounded writes: <none | granted by prompt #...>
```

## Required Sections Checklist

When auditing, these sections must be present (including for closed issues):

- [ ] Current status (non-empty)
- [ ] Reconciliation timestamp (exactly one, well-formed DD format)
- [ ] Parent tracker link
- [ ] Implementation branch
- [ ] Implementation PR
- [ ] Dependencies
- [ ] Blockers
- [ ] Related work
- [ ] Why this issue exists
- [ ] Goal and scope
- [ ] Completed work
- [ ] Current blockers and findings
- [ ] Remaining steps
- [ ] Acceptance criteria
- [ ] Linked PRs and follow-ups
- [ ] Decisions and durable evidence
- [ ] Safety and authority
