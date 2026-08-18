# A1-SOIR R1 Control-Plane Kernel

This first-party, source-only module implements the accepted `DL-AGENT-NATIVE-LOOP-MVP-001-A1-SOIR-R1` control-plane contract for #346.

The kernel is deterministic and default-off. Its trust boundary is `Safe Observation -> detached Observation IR -> full validation -> hard-deny reduction -> fully-valid policy -> canonical binding`. It does not install hooks, execute commands, resolve the filesystem, call providers, mutate GitHub, parse prose, or claim native-host enforcement.

Only fully valid detached canonical data can enter ordinary policy, digest, authority, or ticket routing. Invalid or partial evidence may establish hard deny only. Authority tickets remain opaque identity-bound capabilities backed by a module-private trusted context; the public runtime does not expose a ticket store or self-mint path.

The temporary structural-impact rule from issue #342 remains active until canonical propagation is verified. `assessStructuralImpact` reports the targeted repository-wide consumer categories but does not perform the search itself.

The historical `toolkit-guardrails` engine and closed PR #347 are not imported or used as implementation sources.

[Canonical source](_main/)
