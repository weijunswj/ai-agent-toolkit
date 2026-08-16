# A1 Control-Plane Kernel

This first-party, source-only module is the replacement A1 control-plane identity, typed-operation authority, secret-boundary, one-shot ticket, and structural-impact contract for `DL-AGENT-NATIVE-LOOP-MVP-001-A1`.

The kernel is deterministic and default-off. It does not install hooks, execute shell commands, resolve the filesystem, call providers, mutate GitHub, parse prose instructions, or claim native-host enforcement. A host or controller must provide explicit typed operation and trusted resolver evidence; arbitrary or unmodelled shell input is unsupported.

The remote identity validator is the sole runtime/schema contract for URL and SCP-style repository identities. Credential-bearing userinfo, URL query/fragment data, local paths, malformed IPv6/ports, UNC paths, and malformed SCP-like values are rejected before evidence or digests are produced.

Authority tickets are capability-neutral, immutable, session/turn/call/operation/target-bound records. Consumption is synchronous and one-shot by default; bounded replay is explicitly capped and expired or exhausted records are compacted from the process-local store. This is a source-only contract, not durable or distributed replay protection.

The temporary structural-impact compatibility rule from issue #342 remains active until later canonical propagation verification. The permanent deterministic mechanism lives in `assessStructuralImpact`; it reports the targeted repo-wide consumer categories required for structural changes without performing a broad scan itself.

The historical `toolkit-guardrails` engine is not imported or used by this module. Its source remains preserved as retired evidence during this bounded replacement.

[Canonical source](_main/)
