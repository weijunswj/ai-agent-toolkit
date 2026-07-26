# Optional Daily ChatGPT Scheduled Task Handoff

Toolkit does not require a separately billed OpenAI API key for normal capability review. This optional advisory can be used in ChatGPT Scheduled Tasks when the owner already has that capability.

## Input Boundary

Provide only sanitized GitHub/provider evidence produced by deterministic collectors:

- stable finding/digest identifiers;
- public upstream release/ref movement;
- sanitized tool-schema or API-version digests;
- Toolkit source-lock and adapter version status;
- consumer requirement changes;
- stale capability-audit markers;
- synthetic/native UAT status without private payloads.

Do not provide private local state, credentials, tokens, cookies, private origins/IDs, raw provider output, environment listings, screenshots, customer/private data, or local absolute paths.

## Prompt Contract

```text
Review only the supplied sanitized external-capability drift evidence.
Return exactly one of:

NO_ACTION

or

RECOMMENDATION
operation: <one bounded migration, UAT, or update recommendation>
reason: <sanitized evidence-based reason>
required_owner_decision: <one decision>
forbidden_automatic_actions: install, configure, promote, demote, revoke, mutate provider

Do not access private local state. Do not install integrations, modify configuration,
promote or demote routes, revoke credentials, or perform provider mutations.
```

The advisory may be paused, absent, or unable to access a connector. Toolkit remains fully usable and deterministic without it.
