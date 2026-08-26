# Write Safety Model

This toolkit allows writes only when they are required, scoped, declared, reviewed, and safe.

## Canonical Write Surfaces

The maintained repository surfaces are:

- `skills/**` for copyable skill content.
- `repo/contracts/**` for schemas, policies, fixtures, templates, provenance contracts, and agent-rule inputs.
- `repo/scripts/**` for deterministic maintenance and runtime helpers.
- `repo/tests/**` for focused validation.

The only retained repository synchronizers are `sync-repo-doc-contract.cjs` and `sync-agent-instruction-shims.cjs`. They update managed blocks and instruction shims only; they do not publish project outputs.

The Toolkit Local Bridge package version is declared in `repo/contracts/toolkit-local-bridge/version.json` and must remain aligned with authoritative native plugin inputs, checked-in native plugin metadata, `BRIDGE_VERSION`, the Codex setup expected version, and AG2 adapter metadata.

## Allowed Writes

Allowed writes must be declared and deterministic, such as:

- Updating canonical skills, contracts, docs, scripts, and tests during Toolkit maintenance.
- Updating the managed source-of-truth block or repo-local instruction shims through their synchronizers.
- A reviewed n8n sync helper writing `n8n-workflows/*.json` in a consumer repo.
- Ignored consumer-repo staging writes such as `.tmp/**` or `.n8n-local/**` when a helper explicitly declares them.
- Optional design-generator output when explicitly requested.

## Denied Writes

Denied writes include:

- `.env*`.
- Credentials and credential bindings.
- Private keys.
- Live n8n exports/imports committed to the repository.
- Arbitrary output paths.
- User-home or system paths without an explicit safe operation.
- Destructive deletes outside the approved local migration scope.
- Generated package artifacts.
- Package-install side effects.
- Network downloads.

## CI Rules

CI must not run live actions, import/export n8n workflows, activate/deactivate workflows, mutate credentials, install packages, or execute arbitrary external source. Source-watch remains notification-only and must not copy upstream files or update source pins.

CI validation is read-only. Native plugin metadata is checked in place, and no privileged publication workflow is maintained.
