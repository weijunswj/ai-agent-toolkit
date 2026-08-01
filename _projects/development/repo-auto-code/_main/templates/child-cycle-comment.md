# Canonical Child Cycle Comment Template

The child issue comment is the canonical full audit and handoff chronology. A PR comment normally points to it instead of duplicating the prompt.

```text
[ CHILD CYCLE COMMENT: START ]

Status: DRAFT | READY_EXECUTOR | PROCESSED
Packet ID: <unique packet or none>
Controller Run ID: <run id>
Executor Run ID: <run id or none>
Child: #<direct child>
PR: #<enrolled PR or none>
Observed head: <sha or none>
Resulting head: <sha or none>

Observed and independently verified:
<complete public-safe audit summary>

Completed:
<executor evidence and validation>

Review reconciliation:
<every applicable finding and truthful disposition>

Controller decision:
<turn, gate, next action, or completion evidence>

Remaining:
<bounded obligations and blockers>

When a worker is required, the only actionable payload is the complete marked packet below. `DRAFT` is never actionable; `READY_EXECUTOR` is set last after parent/child/PR reread.

[ ORCHESTRATOR TO EXECUTOR: START ]

Packet ID: <unique>
Controller Run ID: <run id>
Current gate / Design Lock: <gate and lock>
Starting authority: <exact authority>
Assigned provider: <provider>
Assigned model: <model>
Assigned reasoning: <reasoning>
Assigned role: <role>

<Complete public-safe standalone assignment>

[ ORCHESTRATOR TO EXECUTOR: END ]

After the result is reconciled, replace only the transient next-worker payload with the exact redaction marker defined in `protocol.md`. Preserve this audit record and all executor evidence.

[ CHILD CYCLE COMMENT: END ]
```

The original comment must be public-safe at creation. Redaction is visible cleanup and not guaranteed erasure.
