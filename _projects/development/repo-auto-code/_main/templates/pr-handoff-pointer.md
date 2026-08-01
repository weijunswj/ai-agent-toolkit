# PR Handoff Pointer Template

PR comments are compact discoverability pointers by default. The child comment remains canonical.

```text
[ AUTO-CODE HANDOFF POINTER: START ]
Protocol version: 1
Repository: <canonical owner/name>
Child: #<direct child>
PR: #<enrolled PR>
Packet ID: <packet id>
Enrolment marker: <parent/child/PR agreement reference>
Canonical child comment: <durable URL or immutable comment id>
Current head: <sha>
Status: DRAFT | READY_EXECUTOR | PROCESSED
Compatibility mirroring: disabled | enabled with tested dual-redaction
[ AUTO-CODE HANDOFF POINTER: END ]
```

This pointer cannot authorise execution, repair a missing canonical comment, or override a body disagreement. Full PR-comment mirroring is permitted only as an explicit compatibility mode with one canonical copy and tests proving both copies are public-safe and redacted together after reconciliation.
