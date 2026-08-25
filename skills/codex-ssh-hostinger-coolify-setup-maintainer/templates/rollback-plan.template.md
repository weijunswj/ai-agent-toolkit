# Rollback Plan

Target: `<app/service>`
Current version: `<commit/image/config>`
Rollback version: `<commit/image/config>`
Database impact: `<none|forward-fix|restore required>`

## Approval Gate

- [!] Needs owner approval - Owner approval is required before rollback execution.

## Steps

1. Preserve current logs and evidence.
2. Confirm backup/snapshot state.
3. Execute only approved rollback steps.
4. Run smoke tests.
5. Decide PASS/WARN/FAIL and record evidence.
