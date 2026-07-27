---
name: Privileged workflow activation
about: Controller-owned activation gate after the inert Stage A rehearsal
title: "Activate one bounded trusted-workflow canary"
labels: []
assignees: []
---

## Authority

- Parent tracker: #299
- Stage A canonical-main SHA:
- Stage A rehearsal workflow/run/job:
- Closure-manifest digest:

## Exact canary

- Pull request number:
- Head SHA:
- Workflow: auto-sync | source-watch

## Locked scope

- [ ] One activation branch and one activation PR.
- [ ] Only reviewed enablement, permission, and canary-selection surfaces change.
- [ ] Every non-canary target fails before untrusted checkout.
- [ ] Global concurrency remains enabled.
- [ ] Push is non-force and remote-head protected.
- [ ] General enablement remains false.

## Acceptance

- [ ] Manual controller acceptance before merge.
- [ ] One post-merge canary proves exact scope and head protection.
- [ ] Failure leaves general writeback impossible.
- [ ] Stage B2 remains a separate issue and PR.
