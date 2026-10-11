# GitHub Program Reconciler

Explicit-only skill for the shipped Toolkit governance and review-reconciliation contract: deterministic
parent/direct-child governance, bounded large-parent mutation, truthful PR
review inventory and finding disposition evidence, and parent-managed Deferred
Findings. It preserves the shipped control-plane, repository-capability, execution,
assurance and user-authority boundaries and never owns
review-thread mutation, Ready, merge, Web finality, providers, workflows, or
MCP.

This skill is directly canonical. Use the local runtime and focused tests when validating it.

The runtime provides one production human-surface authority facade,
`humanSurfaceV2`, with only
`readComplete`, `render`, `extendHistory`, and `planMigration`. Complete reads
are source-bound and fail closed on malformed, mixed, residual, or unsupported
managed bodies. Human-v2 rendering uses typed public nodes, strict canonical
carriers, source-bound descriptors and BOUND authorities, while accepted frozen
v5 bodies remain read-only compatibility inputs. PR rendering uses the private
`github.program.pr-phase-projection.v1` with explicit `CURRENT_DERIVED`,
`STRUCTURAL_PROVENANCE`, `DESCRIPTOR_AT_CREATION`, and `OMITTED` zones. The
facade never performs provider writes or claims provider CAS. The executable proof
requires actual production calls, exact ordered case receipts, and fail-closed
aggregation for the three eight-case families.
