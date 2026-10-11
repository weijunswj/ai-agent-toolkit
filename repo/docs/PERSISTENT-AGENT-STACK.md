# Persistent-agent stack

This is replaceable configuration for explicitly identified persistent agents using the [helper workflow](PERSISTENT-AGENT-HELPER-PROFILE.md). Apply the generic defaults, then any override explicitly matching the actual agent/host. An unknown or non-persistent agent mode skips this file. A persistent agent without a matching override uses the generic defaults and does not inherit OpenAI dot's observations or route choices.

Configuration grants no task, publication, merge, deployment, spending, access, security or credential authority. Current system/safety requirements, task authority, host permissions and explicit denials remain controlling. This is documentation, not a framework, scheduler or runtime enforcement mechanism.

## Configuration precedence

The helper workflow owns shared operational safeguards. This stack owns configuration only: generic defaults apply first, and an explicitly matching host section overrides conflicting defaults only for the named model role, transport order or operation exception. An override does not weaken shared workflow requirements, Controller governance, task authority, host permissions, denials, confirmation requirements or consumed limits. Unspecified settings retain the generic defaults. Reconcile missing or conflicting authority/capability before the dependent action; do not infer permission from configuration.

## Generic persistent-agent defaults

### Mechanical role

Use the existing owner-approved, capability-qualified role for routine non-gate mechanical work. This generic section selects no model family, reasoning level or service tier. Resolve any required selection through current owner-approved configuration and supported launch controls; verify accepted configuration before dispatch. Missing required configuration is a capability gap, not permission to invent a model default or change an admitted worker.

### GitHub transport

For an already-authorised bounded operation, prefer authenticated `gh` when the actual host supports and permits it. Otherwise use an available capability-qualified GitHub connector or an authorised bounded executor route. A controller without supported CLI access delegates the mechanical operation to a qualified executor when permitted; it does not claim local or elevated CLI access. Existing host rules and task authority determine whether execution or escalation is permitted.

Before use, qualify the selected route for the exact operation and intended account/repository, reconcile active or ambiguous execution, and apply the helper workflow's complete bounded handoff, payload/custody, concurrency and readback requirements. Connector or CLI availability does not establish mutation authority. Keep complex, ambiguous or consequential decisions with the controller and a separately qualified stronger route. If no supported authorised route is qualified, retain the exact capability gap and hold only the dependent action.

These defaults classify no connector operation as broken and grant no GitHub, publication, merge, escalation, access, security or credential permission. Explicit denials, mandatory confirmations, no-retry restrictions and unresolved effects carry across all routes.

## OpenAI dot

For OpenAI dot only, the following mechanical-role selection, executor-first transport order and branch-creation exception override conflicting generic configuration defaults. Shared workflow safeguards and all independent authority and host restrictions remain unchanged.

### Persisted-task references

When no verified user-facing task URL is available, use `cloud_threads.attach` for the exact verified persisted task when that operation is supported. Verify the target identity and successful attachment result/readback before relying on it. Do not invent a URL or substitute only a title or ID while the supported attachment capability is available; if it is unavailable, report the capability gap and hold the dependent reference action. When approval is needed, include the precise action and target in the approval text. Attachment provides context only; it grants no approval, bypasses no denial and expands no authority.

### Mechanical GitHub role

For routine already-authorised non-gate mechanical GitHub work with an exact approved diff/payload only:

- Model family: Luna
- Reasoning: Controller-selected supported effort per bounded job. Request it explicitly via launch controls, verify and retain requested/accepted configuration, and choose proportionately. Do not use stronger effort to cure missing authority, evidence or tool failure.
- Service tier: Standard

Resolve and configure the selected role through supported launch controls and verify the accepted configuration. Distinguish requested/accepted configuration from unexposed runtime identity; prompt wording and worker self-attestation are not configuration proof. If the route cannot be qualified, return the exact capability gap rather than silently substituting a model or widening permissions.

This role changes no other helper profile, G1-G4 registry entry, gate assignment, assurance requirement or admitted worker. Apply changes only at authorised safe admissions; never hot-swap live work. The complete bounded handoff, payload/custody, body/comment-trace, approval and readback instructions live in the [GitHub section](PERSISTENT-AGENT-HELPER-PROFILE.md#github), not duplicated here.

### GitHub transport order

For all routine already-authorised mechanical GitHub mutations, start with a qualified executor on the mechanical-GitHub role above, including private admission records, CURRENT/status updates, issue/PR/comment bodies and branch/file writes. The persistent controller retains connector reads and consequential decisions. Give the executor the exact approved bounded operation and required evidence/readback; it may use its GitHub connector or qualified task-scoped escalated `gh` under current permissions and the operation-specific exception below. Verify its actual intended-account authentication, supported launch configuration and effects; neither route availability nor escalation grants additional authority. Do not change credentials or security settings to make a route work. Pending approvals, explicit denials, no-retry restrictions and unresolved effects carry into the executor unchanged; delegation is not permission to reroute a denied action, and a required approval must use the actual supported approval prompt. Other persistent hosts use the generic defaults above.

Apply this transport order only to operations already within task authority. The selected model role covers routine non-gate mechanical work with an exact approved diff/payload, not complex, ambiguous or consequential decision-making. Keep those decisions with the controller and any separately qualified stronger route. Preserve all other helper preferences, the G1-G4 stack registry and assignments, and admitted workers; do not hot-swap live work.

A tool/service failure is not an access/authority denial. Explicit denials, mandatory confirmations, no-retry instructions and unresolved effects carry across all routes. Never launch an executor, change transport or narrow a payload to evade a denied effect.

### GitHub connector exception - OpenAI dot

Observed in OpenAI dot on 11 October 2026: skip the connector's `create_branch` operation immediately for the observed generic `user cancelled MCP tool call` failure family. Two identical authorised attempts returned that generic result and remote branch readback confirmed absence; the owner confirmed no cancellation. For a new already-authorised branch operation, the selected mechanical-GitHub executor first reconciles the exact remote ref, then uses its qualified task-scoped escalated `gh`; the controller does not perform the mutation directly. Apply this exception only to branch creation; it does not disable connector reads or unrelated writes.

Reassess this exception when a supported capability change or controlled, authorised qualification demonstrates that connector branch creation works. Do not perform repeated connector probes during ordinary delivery. Record the current evidence and any revision in the existing task/decision record rather than assuming the exception is permanent or globally applicable.

Explicit permission-denied results from `create_file`, `update_file` or `create_blob` are not covered by this transport-fault exception. Preserve the exact denied action and target under the [approval rules](PERSISTENT-AGENT-HELPER-PROFILE.md#approval-denial-and-generic-cancellation-handling); do not relabel them as service failures or route around them. Successful issue/status writes remain eligible for the selected executor's GitHub connector. No other operation is classified as broken without current evidence.

### Maintenance boundary

These OpenAI dot settings and observations were owner-approved on 11 October 2026. Keep observations dated and operation-specific; verify the actual executor's current capability. Do not infer another runtime's permissions or authentication from dot's result. Maintain reusable verified changes here without copying custom approval rules, private incident details or secrets. Preserve actual owner cancellations and all independent denial/retry limits.
