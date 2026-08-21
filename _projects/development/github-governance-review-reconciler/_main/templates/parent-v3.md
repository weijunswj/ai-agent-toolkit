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
