# GitHub Program Reconciler

Explicit-only skill for Toolkit programme governance on GitHub: deterministic parent and direct-child state, bounded large-parent updates, truthful PR-review inventory and finding-disposition evidence, parent-managed Deferred Findings, and the decision-trace audit (`scripts/decision-trace-audit.cjs`, read-only). It keeps the control-plane, repository-capability and user-authority boundaries and never owns review-thread mutation, Ready, merge, Web finality, providers, workflows or MCP.

The skill is directly canonical. Apart from the trace audit it is a written procedure: do not invent a reconciler runtime.
