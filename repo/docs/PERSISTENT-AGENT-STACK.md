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

For OpenAI dot only, the following mechanical-role selection and authenticated escalated `gh` transport order override conflicting generic configuration defaults. Shared workflow safeguards and all independent authority and host restrictions remain unchanged.

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

For all already-authorised GitHub reads and writes, use authenticated task-scoped escalated `gh` through a supported execution mode permitted by the actual host. This includes source and state reads, independent readback, private admission records, CURRENT/status updates, issue/PR/comment bodies and branch/file writes. Use the controller's own route when it is available and qualified for the operation. When it is unavailable, delegate the bounded mechanical operation to a qualified executor using authenticated task-scoped escalated `gh`; use the mechanical-GitHub role above where its routine non-gate scope applies. Required independent roles and gate placement remain controlling. Do not use a GitHub connector as a fallback. If no supported authorised escalated `gh` route is qualified, report the exact capability gap and hold only the dependent action.

Before execution, verify the actual route's intended-account authentication, repository, supported execution mode and current permission for the exact operation; for delegation, also verify the supported launch configuration. Give the executor the exact approved bounded operation and required evidence/readback. Neither route selection, authentication nor escalation grants authority or automatic approval. Do not change credentials or security settings to make a route work. Pending approvals, explicit denials, no-retry restrictions and unresolved effects carry into the executor unchanged; delegation is not permission to reroute a denied action, and required approval must use the actual supported approval prompt. Other persistent hosts use the generic defaults above.

Apply this transport order only to operations already within task authority. The selected model role covers routine non-gate mechanical work with an exact approved diff/payload, not complex, ambiguous or consequential decision-making. Keep those decisions with the controller and any separately qualified stronger route. Preserve all other helper preferences, the G1-G4 stack registry and assignments, and admitted workers; do not hot-swap live work.

A tool/service failure is not an access/authority denial. Explicit denials, mandatory confirmations, no-retry instructions and unresolved effects carry across all routes. Never launch an executor, change transport or narrow a payload to evade a denied effect.

### Prior connector observation - OpenAI dot

Observed in OpenAI dot on 11 October 2026: two identical authorised connector `create_branch` attempts returned the generic `user cancelled MCP tool call` result, remote branch readback confirmed absence, and the owner confirmed no cancellation. The all-GitHub escalated `gh` transport preference above supersedes the former branch-only routing exception; this observation does not classify other connector operations as broken or prove another host's capability. Requalifying a connector does not by itself change the owner's selected route.

Explicit permission-denied results, including prior `create_file`, `update_file` or `create_blob` denials, remain controlling. Preserve the exact denied action and target under the [approval rules](PERSISTENT-AGENT-HELPER-PROFILE.md#approval-denial-and-generic-cancellation-handling); do not relabel them as service failures or use the selected `gh` route to bypass them.

### Maintenance boundary

These OpenAI dot settings and observations were owner-approved on 11 October 2026. Keep observations dated and operation-specific; verify the actual controller or executor route's current capability. Do not infer another runtime's permissions or authentication from dot's result. Maintain reusable verified changes here without copying custom approval rules, private incident details or secrets. Preserve actual owner cancellations and all independent denial/retry limits.
