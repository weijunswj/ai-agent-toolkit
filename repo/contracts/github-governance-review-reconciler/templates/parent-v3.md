<!-- AI-AGENT-TOOLKIT:N5-PARENT:BEGIN v3 -->
## Metadata
## Current work
## Pending work
## Other open PRs
## Terminal and repository detail
## Deferred Findings
## Tracker format contract

<!-- AI-AGENT-TOOLKIT:N5-STATE:BEGIN v1 -->
{}
<!-- AI-AGENT-TOOLKIT:N5-STATE:END -->
<!-- AI-AGENT-TOOLKIT:N5-PARENT:END -->

Tracker format contract: one canonical parent, one flat deterministic queue,
current-state projection, and byte-preserved owner-controlled text outside the
managed block. A2 binds the exact repository_id before any GitHub access; no
per-call repository identity override is valid. Current and expected review
candidate identity must be explicit and match the represented PR head, tree,
and base. Terminal objectives require explicit completed/disposed status;
completed status requires durable public-safe evidence and a retained digest.

Human-v2 source-bound companion (normal current path): render a non-lossy
projection with Current programme status, Immediate next, Children / work
packages, Completed work when applicable, and Programme boundaries. Omit PR
registry detail and zero-lane noise from the parent view. The complete
canonical owner state is embedded only in the human-v2 parent carrier; the
presentation model is ephemeral. The legacy v3 block remains accepted for
historical compatibility, while predecessor human-v1 residue is unsupported.
