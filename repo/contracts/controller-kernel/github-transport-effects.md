# C1 GitHub transport effects

GitHub transport is a mechanical effect surface. Transport success does not
grant architecture, ownership, gate, merge, or finality authority. Every
consequential operation is bound to the current repository, candidate, Lock,
and controlling authority before it is dispatched and is read back after the
effect.

## Terminal receipts

The terminal receipt contract preserves three terminal cases:

- issue close;
- pull request merge;
- pull request close without merge.

Each receipt is typed, self-sufficient, digest-bound, and read back on the same
GitHub object. A merged PR receipt binds the integrated commit and candidate
head/base identities when available. A closed-unmerged receipt records the
non-integration disposition and branch/candidate status. An issue receipt
records completed, superseded/transferred, duplicate, not-planned, or another
evidence-backed disposition plus any continuing owner or successor.

Ambiguous transport is recovered idempotently by reading the exact object and
receipt identity. If the terminal effect already happened, the operation is not
replayed. Missing, stale, or unverifiable receipt readback is
`TERMINAL_RECEIPT_INCOMPLETE`; the object is not reopened solely to create a
missing receipt.

Concrete wording, Markdown layout, and renderer presentation remain renderer
policy. The semantic receipt contract remains append-only, secret-safe, and
durable for later takeover.
