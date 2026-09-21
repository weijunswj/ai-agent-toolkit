# C1 takeover and programme recovery evidence

The CURRENT projection is a bounded restart surface, not an event log and not a
second authority object. A takeover first reads the smallest live projection
needed to continue safely:

- repository, Controller revision, canonical main, and programme/current child;
- RUN, Lock, gate, repair count, and in-flight state;
- lightweight candidate PR metadata with exact head/tree/base identity;
- HOLD/dependency, next admissible action, and exact controlling receipt;
- only the minimum review, thread, and check summary needed for the decision.

Heavy PR objects are projected to admission metadata before they become
model-visible. The minimum projection is number, state, draft, head, tree,
base, and mergeability. Bodies, patches, diffs, full comment history, logs, and
unrelated ancillary fields remain progressively disclosed evidence.

Historical chronology is retrieved only by an exact controlling pointer when a
current decision requires it. A stale, missing, conflicting, or unverifiable
CURRENT projection fails closed with a reconciliation hold; it must not cause
chronology archaeology.

## Transition and readback

Material transitions regenerate the same canonical CURRENT projection and read
it back immediately. A readback with a different canonical digest, controlling
receipt, candidate identity, or next action is a typed failure. The next
consequential continuation is not admitted from stale state.

## Receipt pointers

The projection carries the exact identity and digest/reference of the
controlling authority or terminal receipt. A synopsis, label, status, or
notification is not a receipt and cannot replace one. Missing receipt evidence
holds the affected transition without reopening or replaying a completed
external operation.
