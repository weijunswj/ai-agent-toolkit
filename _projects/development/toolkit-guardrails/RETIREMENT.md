# Retired Toolkit Guardrails Boundary

This former issue #313 source module is retired as current control-plane authority. Its required project manifest remains registered under the standard filename but is marked `lifecycle: retired`; no current A1 runtime imports it or treats it as control-plane authority.

The old source/runtime and focused regression suite remain unchanged as historical/adversarial evidence. Do not patch them or add consumers. The current A1 implementation is the source-only, default-off [Control-Plane Kernel](../control-plane-kernel/).

This retirement preserves auditability and the old tests; it does not claim that the historical engine satisfies the 11 PR #325 invariants. Those outcomes are proven only by the replacement kernel's focused contract suite.
