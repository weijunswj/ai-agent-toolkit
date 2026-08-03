# Source Manifest: Toolkit Guardrails

## Preserved in `_main/`

- `guardrail-policy.json` and its JSON Schema.
- `operation-contract.schema.json` and `approval-contract.schema.json`.
- `host-capability-matrix.json`.
- `semantic-hooks.md` and `command-classification-contract.md`.
- Deterministic fixture manifest under `fixtures/`.

These files are first-party canonical policy and contract source. Deterministic normalisation, repository-resolution interpretation, command classification, policy lookup, and non-approval decision calculation are distinct from stateful replay-consuming approval verification. The complete engine is not wholly pure: only those named components are deterministic; approval verification is stateful when it consumes replay state. They are not copied from a host plugin, provider, external repository, or user configuration.

## Curated projection

- `curated_output_for_ai/guardrail-policy-projection.md` is a reviewed explanatory projection for human/controller reading.
- It is deliberately not a generated global instruction file and is not published into `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.agents/rules/`, or any host plugin surface.

## Runtime surface

- `repo/scripts/toolkit-guardrails/*.cjs` is first-party executable source kept separate from the source project because the repository's script convention owns runtime modules there.
- `repo/tests/toolkit-guardrails.test.cjs` is the focused deterministic test surface.
- Approval verification owns volatile, in-memory, process-local replay slots and per-slot serialisation. This replay state is non-durable, non-distributed, and non-cross-process, and a Node.js process restart resets it. It is confined to this source-only reference implementation: it is not native-host enforcement, restart-safe production replay protection, or production-distributed replay protection.

## Source-to-surface receipt

`toolkit.project.json` declares `surface.publish_as: source_only` and an empty output list. `node repo/scripts/sync-toolkit-projects.cjs --check` therefore validates the project shape without writing a published surface. The focused tests compare the source policy, schemas, fixture manifest, capability claims, and runtime module set and verify that the curated projection is not treated as executable policy.

## Excluded

- Host hook manifests and adapters.
- User-home plugin files, trust state, permission state, bridge state, credentials, secrets, `.env*`, private keys, live systems, databases, deployments, package artifacts, and provider state.
- GitHub issues, pull requests, reviews, review conversations, and evaluation ledgers.
- `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.agents/rules/`, `.codex-plugin/`, and `.claude-plugin/`.
