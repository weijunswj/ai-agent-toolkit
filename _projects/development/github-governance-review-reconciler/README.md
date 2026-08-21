# N5 GitHub Governance and Truthful PR-Review Reconciler

First-party source module for explicit inspection, preview, validation, bounded
reconciliation, and truthful review-evidence handling against the current
Toolkit A1-A4 architecture. It owns one deterministic parent/direct-child
state model, one parent-managed Deferred Findings register, and one shared
runtime. It does not own Web finality, Ready, merge, review-thread mutation,
providers, workflows, or MCP.

The published skill is generated from [the `_main/skill/` source](_main/); update source and run the
Toolkit sync command rather than editing generated output directly.
