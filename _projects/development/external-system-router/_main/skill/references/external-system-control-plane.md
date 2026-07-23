# External-System Control Plane

## Governing Rule

The owner authorises an exact objective and target. Toolkit classifies the operation risk, then selects the strongest reviewed interface admissible for that exact operation.

Use this order of reasoning:

```text
strongest reviewed structured interface for the exact operation
-> another admissible structured interface
-> informed browser/computer-use fallback
-> narrow owner action when delegation is unsafe
```

Do not use a global `MCP > API > browser` ladder. A read-only MCP cannot block an official API write. A complete typed MCP may outrank a weaker API only for the operation whose target binding, schema, redaction, failure semantics, preconditions, postconditions, and rollback have been proven.

## Risk Tiers

| Tier | Meaning | Approval |
| --- | --- | --- |
| 0 | Exact-target inspection that is read-only and does not expose a newly sensitive data class. | Standing permission inside the established task envelope. |
| 1 | Bounded, reversible, normally non-production change. | Task-envelope approval; no per-request prompt. |
| 2 | Production or sensitive but reversible change, including deployment, exact env write, credential/OAuth setup, or approved rollback. | Explicitly listed task-scoped owner authorisation; complete the approved sequence and verification without repeated prompts. |
| 3 | Destructive, irreversible, cross-target, credential revocation, data restore, DNS deletion, or similarly high-blast-radius action. | Exact immediate owner approval for that operation. |

Forbidden operations override every tier. Crossing provider, target, account/organisation, resource, environment, tier, sensitive-data class, interface restriction, or material objective scope requires a new envelope or owner decision.

## Task-Authorisation Envelope

Record:

- provider;
- target alias;
- account or organisation alias;
- exact instance, project, application, or resource alias;
- environment;
- objective;
- allowed operations;
- minimum risk tier for every allowed operation;
- explicitly authorised Tier 2 operations;
- forbidden operations;
- expected result;
- verification;
- rollback or safe-disable;
- lifetime;
- owner approval reference;
- sensitive-data classes;
- interface restrictions, when applicable.

Do not ask before every API request, CLI command, MCP call, or browser click inside a valid envelope.

## Universal Graphical-Control Approval

Before Chrome/browser plugins, computer use, accessibility or UI automation, screenshot-driven control, desktop automation, file pickers, UI clipboard interaction, or similar graphical control, state:

- goal;
- browser/profile or desktop application;
- origin, account, project, environment, and resource;
- why API, CLI, MCP, connector, or file access is insufficient;
- what may be read;
- what may be clicked, typed, uploaded, downloaded, or changed;
- whether credentials, cookies, history, downloads, clipboard, customer/private data, or unrelated windows may be encountered;
- forbidden scope;
- expected result;
- verification;
- rollback or safe-disable.

Then ask one bold explicit question. A technical permission popup is not informed owner approval. One approval covers only the disclosed envelope.

## Browser-History Last Resort

Try and document failure of these safer paths first:

1. committed non-secret provider requirements;
2. Toolkit local target registry;
3. configured API, CLI, MCP, or connector metadata;
4. current task context and approved origins;
5. safe public/provider metadata, DNS, or approved open tabs;
6. asking the owner for the URL.

If history is still necessary, state the exact reason, browser/profile, bounded domains, bounded time range, unrelated information that may appear, and stop condition; then obtain explicit approval. Stop as soon as the target is found.

## Progressive Reconciliation

Reconcile repository evidence and current intent at:

- new session or substantive task start;
- branch switch or pull;
- relevant repository change;
- managed-marker drift;
- provider assets appearing;
- host switch;
- capability failure or schema drift;
- explicit provider setup intent.

Repository evidence alone is insufficient when the objective adds a capability. Intent alone is insufficient when the repo proves additional boundaries or prohibitions. Maintain a progressive ledger and do not declare completion until every required capability is verified, blocked/deferred, or unnecessary with evidence.

Generic Toolkit setup installs no provider integrations. Setup can be multi-step and may recommend owner-approved additions or removals.

## Component-Based n8n Routing

- Repo owns workflow JSON: recommend canonical `n8n-workflows/` rules and helper/compiler scripts.
- Agent designs nodes or expressions: recommend official n8n Skills.
- Live read/import/update: audit and select the strongest admissible API, supported CLI, MCP, or other structured transport for each operation.
- Credential creation or OAuth: use an informed graphical fallback only where no safe structured operation exists.
- Webhook-only consumer: do not install workflow helpers unless workflow ownership appears.
- Historical mention only: install nothing and recommend owner-reviewed removal of stale n8n markers.

Official n8n Skills and live n8n MCP are separate capabilities. Installing Skills never implies installing MCP. The current official n8n CLI/API client is not a production transport unless its then-current official support contract and an operation audit prove otherwise.

## Target And Credential Model

Resolve `provider + target alias + environment`. Default to one appropriately scoped credential per provider target. Additional credentials are optional only for provider limitations, ownership boundaries, or explicit isolation.

Never select a target from the most recently used credential, open tabs, browser history, the first environment variable, or a generic provider token. Resolve from repo/task context or ask once, then pin it in the envelope.

The local registry may store sanitized target fingerprints, private-origin references, non-secret resource references, credential references (never values), installed interfaces, capability/version/schema digests, route selections, audit state, and structured receipt references. It is not a plaintext secret vault.

## Secret Handling

Preference order:

1. Connector/provider-managed OAuth or credential store.
2. OS credential manager, password manager, or reviewed local secret broker.
3. Short-lived process/session injection.
4. User environment variable or application-specific plaintext file as compatibility fallback.

`~/.codex/.env` is plaintext. A repo `.env` is plaintext and adds Git/sync risk. Persistent user/Windows environment variables are not secure vaults. Secrets never enter repository files, chat, GitHub, reports, receipts, or ordinary logs.

## Capability Audit

Audit per operation and record sanitized evidence for identity/version, available operation, target binding, input schema, auth/scope status without values, redaction, retry/idempotency, preconditions, postconditions, rollback, and failure semantics. An interface is not sufficient merely because it is installed or authenticated.

## Promotion And Demotion

Required lifecycle:

```text
deterministic drift detection
-> semantic review
-> synthetic tests
-> native UAT
-> owner-approved migration
-> observation period
-> optional later removal/revocation approval
```

Promote or demote one verified operation only. Retain the prior route until parity and native UAT pass. Never automatically revoke credentials or delete working configuration.

## Receipts And Continuation

Write one versioned local ignored receipt per operation with one supported next action and explicit unchanged scope. Exclude raw provider responses, secrets, tokens, cookies, full environment listings, raw screenshots, private absolute paths, and customer/private payloads.

Codex and Claude continue through named supported operations and receipts. They do not edit adapter scripts to improvise a new operation.

## Scheduled Boundary

Hourly deterministic collectors and capability checks are read-only. An optional daily ChatGPT Scheduled Task may recommend one operation, but neither path may install, mutate, promote, demote, revoke, or execute a provider operation automatically.
