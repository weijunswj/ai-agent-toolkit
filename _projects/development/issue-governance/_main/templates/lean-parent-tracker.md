# Lean Parent Programme Tracker

**Governance mode:** `toolkit-governed`
**Policy version:** 2.0.0

## Instructions

This is the canonical programme tracker template for a Toolkit-governed repository.

- This body is current authority. Comments preserve chronology.
- Each material task appears as one concise checklist line.
- Detailed implementation, review, testing and acceptance evidence belongs in the child issue.
- PR merge does not automatically complete a task.
- The reconciliation timestamp changes only after substantive reconciliation.
- The web controller owns acceptance and checklist completion by default.
- Coding agents propose text unless explicitly granted bounded writes.
- Implementers never self-certify independent review or acceptance.
- Do not include secret values or unnecessary private paths.

## Canonical Parent Declaration

Every Toolkit-governed repository declares exactly one canonical programme tracker using this metadata block:

```yaml
governance_mode: toolkit-governed
canonical_parent_tracker: #<issue_number>
policy_version: "2.0.0"
```

## Tracker Body Template

```md
# Programme Tracker

**Repository:** <owner/repo>
**Governance mode:** `toolkit-governed`
**Policy version:** 2.0.0
**Canonical parent tracker:** #<this_issue>

Last reconciled: **DD Month YYYY, HH:mm SGT**

## Active Tasks

- [ ] #<child_number> Short task title — compact current status
- [ ] #<child_number> Short task title — PR #<pr_number> open; implementation incomplete
- [ ] #<child_number> Short task title — BLOCKED on <condition>

## Completed Tasks

- [x] #<child_number> Short task title — COMPLETE
- [x] #<child_number> Short task title — merged in PR #<pr_number>

## Notes

<!-- Compact programme decisions, blockers or sequencing notes only. Detailed evidence belongs in child issues. -->
```

## Line Format Rules

Each checklist line should contain only:

1. Checkbox (`- [ ]` or `- [x]`).
2. Linked child issue number.
3. Short task title.
4. Compact current status.
5. Optionally: active PR number or decisive blocker.

Do not duplicate full implementation evidence in the parent tracker.
