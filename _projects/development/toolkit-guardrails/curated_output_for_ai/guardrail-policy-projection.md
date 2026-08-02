# Guardrail Policy Projection

This is a source-owned explanatory projection of the canonical Toolkit guardrail policy for controller and maintainer review. It is not executable policy, is not loaded by the runtime, and is not published into any global instruction or host plugin surface.

Routine resolved work wholly inside the canonical active repository can be low-friction only when the current prompt, role, branch, and active Design Lock authority all permit it. Ordinary reads, edits, local validation, status/diff, staging, commits, and an explicitly authorised normal push to the current non-protected branch are routine classes.

Outside-repository targets, destructive overwrite, truncation, deletion, history destruction, force push, branch or tag deletion, external-system mutation, and unresolved consequential targets require exact trusted approval or a truthful stop. Secret exfiltration, malicious activity, guardrail bypass, catastrophic protected targets, active controller holds, and explicit role or Design Lock violations are hard denies.

The decision contract is exactly `allow`, `ask`, `deny`, or `unsupported`, with precedence `deny > unsupported > ask > allow`. Mixed operations use the most restrictive result. Approval is exact and same-session/turn/call; native auto, always-allow, bypass, saved permissions, transcript text, and executor claims are not Toolkit approval.

The runtime consumes structured policy and evidence only. It never parses `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, arbitrary prose, credentials, raw prompts, or unrestricted tool output as authority.
