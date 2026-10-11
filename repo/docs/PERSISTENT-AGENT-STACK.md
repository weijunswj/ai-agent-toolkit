# Persistent-agent stack

This is replaceable owner-specific configuration for explicitly identified persistent agents using the [helper workflow](PERSISTENT-AGENT-HELPER-PROFILE.md). Apply only the section matching the actual agent/host. An unknown or non-persistent mode skips this file; another persistent host does not inherit OpenAI dot's quirks or route choices.

Configuration grants no task, publication, merge, deployment, spending, access, security or credential authority. Current system/safety requirements, task authority, host permissions and explicit denials remain controlling. This is documentation, not a framework, scheduler or runtime enforcement mechanism.

## OpenAI dot

### Mechanical GitHub role

For routine already-authorised non-gate mechanical GitHub work with an exact approved diff/payload only:

- Model family: Luna
- Reasoning: High
- Service tier: Standard

Resolve and configure the selected role through supported launch controls and verify the accepted configuration. Distinguish requested/accepted configuration from unexposed runtime identity; prompt wording and worker self-attestation are not configuration proof. If the route cannot be qualified, return the exact capability gap rather than silently substituting a model or widening permissions.

This role changes no other helper profile, G1-G4 registry entry, gate assignment, assurance requirement or admitted worker. Apply changes only at authorised safe admissions; never hot-swap live work. The complete bounded handoff, payload/custody, body/comment-trace, approval and readback instructions live in the [GitHub section](PERSISTENT-AGENT-HELPER-PROFILE.md#github), not duplicated here.

### GitHub transport order

For an already-authorised GitHub operation, use this order after checking the operation-specific exception below:

1. Use the available authenticated GitHub connector first.
2. If that operation is unavailable or fails for a verified tool/service reason, use supported task-scoped escalated `gh` directly when it is available, authenticated as the intended account, and permitted for the exact action. Qualify actual access; do not infer it from a binary, UI label or another host's result. Escalation remains subject to host review and grants no additional authority. Do not change credentials or security settings to make this route work.
3. If that route is unavailable, launch a qualified executor using the mechanical-GitHub role above. Give it the complete bounded operation and have it use its GitHub connector and/or supported task-scoped escalated `gh` under these same rules. Verify the accepted launch configuration, input access and result; the controller retains decisions and independently verifies consequential effects.

Apply this transport order only to operations already within task authority. The selected model role covers routine non-gate mechanical work with an exact approved diff/payload, not complex, ambiguous or consequential decision-making. Keep those decisions with the controller and any separately qualified stronger route. Preserve all other helper preferences, the G1-G4 stack registry and assignments, and admitted workers; do not hot-swap live work.

A tool/service failure is not an access/authority denial. Explicit denials, mandatory confirmations, no-retry instructions and unresolved effects carry across all routes. Never launch an executor, change transport or narrow a payload to evade a denied effect.

### GitHub connector exception - OpenAI dot

Observed in OpenAI dot on 11 October 2026: skip the connector's `create_branch` operation immediately for the observed generic `user cancelled MCP tool call` failure family. Two identical authorised attempts returned that generic result and remote branch readback confirmed absence; the owner confirmed no cancellation. For a new already-authorised branch operation, first reconcile the exact remote ref, then use qualified escalated `gh` directly, or a qualified executor if direct `gh` is unavailable. Apply this exception only to branch creation; it does not disable connector reads or unrelated writes.

Reassess this exception when a supported capability change or controlled, authorised qualification demonstrates that connector branch creation works. Do not perform repeated connector probes during ordinary delivery. Record the current evidence and any revision in the existing task/decision record rather than assuming the exception is permanent or globally applicable.

Explicit permission-denied results from `create_file`, `update_file` or `create_blob` are not covered by this transport-fault exception. Preserve the exact denied action and target under the [approval rules](PERSISTENT-AGENT-HELPER-PROFILE.md#approval-denial-and-generic-cancellation-handling); do not relabel them as service failures or route around them. Successful issue/status writes remain eligible for connector-first use. No other operation is classified as broken without current evidence.

### Maintenance boundary

These OpenAI dot settings and observations were owner-approved on 11 October 2026. Keep observations dated and operation-specific; verify the actual executor's current capability. Do not infer another runtime's permissions or authentication from dot's result. Maintain reusable verified changes here without copying custom approval rules, private incident details or secrets. Preserve actual owner cancellations and all independent denial/retry limits.
