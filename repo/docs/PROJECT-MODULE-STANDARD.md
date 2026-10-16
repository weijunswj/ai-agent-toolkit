# Canonical Surface Standard

This repository uses direct canonical surfaces with no secondary ownership or publication tree.

## Surface Roles

- `skills/<skill-name>/` is a complete copyable skill folder containing `SKILL.md` and any required README, references, templates, agents, tools, or tests.
- `repo/contracts/` contains machine-readable contracts and reviewed source inputs that are not themselves portable skills.
- `repo/scripts/` contains deterministic runtime and maintenance helpers.
- `repo/tests/` contains focused contract, parser, safety, and runtime tests.
- `repo/source-watch/provenance/` contains active third-party attribution locks.
- `repo/docs/` contains policy, safety, architecture, and validation guidance.
- `.codex-plugin/` and `.claude-plugin/` contain native plugin package metadata; their authoritative inputs are under `repo/contracts/toolkit-local-bridge/`.

## Skill Creation And Routing

Before adding a skill, inspect existing `skills/**`, README skill tables, the Skill Safety Matrix, and `repo/contracts/agent-rules/toolkit-skill-routing.md`. Prefer extending an existing skill when the trigger, safety boundary, local assets, and validation path fit without making it ambiguous or bloated.

Every concrete `skills/<skill-name>/SKILL.md` must have:

- A matching folder name and frontmatter name.
- A concise, accurate description with the exact trigger and non-trigger boundary.
- Local runtime context for required instructions; external links may support provenance but must not be required for normal use.
- A README or install/use note.
- A routing entry or an intentional omission with a concrete reason.
- A row in `repo/docs/SKILL-SAFETY-MATRIX.md`.

Skills that consume live governance must identify their accepted source bindings and fail closed when a required source is unavailable or differs. Do not bundle a local policy copy as a fallback or imply that skill presence assigns a role, capability, or native host permission. Routing and safety-matrix closure remain required for every concrete skill.

If a skill uses third-party material, run `skill-product-review` before copying, importing, executing, or adapting it. Preserve attribution and keep the active source lock under `repo/source-watch/provenance/`.

## Agent Rules

The source inputs for managed instruction blocks and portable repo-local templates live under `repo/contracts/agent-rules/`. Keep `AI-AGENT-TOOLKIT` markers intact and use `repo/scripts/sync-agent-instruction-shims.cjs` for the root shims and manual templates. Portable templates must not depend on Toolkit-only paths.

## Validation

Use targeted checks while editing:

```powershell
node repo/scripts/sync-agent-instruction-shims.cjs --check
node repo/scripts/sync-repo-doc-contract.cjs --check
node repo/scripts/audit-project-source-locks.cjs
node repo/scripts/audit-published-surfaces.cjs --check
node repo/scripts/audit-skill-portability.cjs
node repo/scripts/validate-toolkit.cjs
node --test repo/tests/<focused-test>.test.cjs
git diff --check
```

The read-only CI workflow owns the full validation gate. Do not run project scripts, live n8n actions, network downloads, or package installation as part of surface validation.

## Continuous core module closure

The coordinated core uses the existing contracts, runtime, tests and docs homes. New native adapter capabilities must bind to existing authentic receipt/CURRENT admission, retained counters and qualified host primitives. Do not introduce a parallel product tree, store, scheduler or projection writer. Installer fingerprints must include the complete reached runtime and policy/schema dependency closure.

## Runtime ownership

Toolkit operations with retained identity, mutable session state, asynchronous process settlement, or several mutation/recovery phases use an object that captures its dependencies at construction and implements the operation directly. Existing public factory functions remain compatibility entrypoints into those owners. Constructors do not grant host authority; authentic receipt, CURRENT, qualification and effect admission remain independent checks.

The Core owners include StackRegistrySnapshot, CapturedStackBinding, CurrentStackSelectionSession, CoreCommandSession, HelperRouteGuard, ClaudeParentDispatchGate, OpenCodeHelperBoundary, NativeCodexAdapter, CodexProtocolClient, ControllerEffectChannel, the authority/receipt repositories, ReviewSetEvaluator and TrustedAuthorityContext. Cleanup, capability publication, typed Git commits, backups, staging, plugin mutation/settlement, source-watch requests and portable menu/export transactions have corresponding operation owners.

Pure schema validators, canonical serialization, immutable DTO builders, deterministic reducers and renderers remain functions. Synchronous read-only inspections and single stateless command facades may remain functions when they retain no operation/session identity or mutation/recovery phase; classify each concrete path and boundary. Shell process facades keep their explicit argument and host permission checks. A subsystem name, old implementation, or third-party attribution is not an exemption for Toolkit-created stateful orchestration.

Retained third-party files keep their existing source-lock mode and attribution. Adapted files must be assessed on their actual Toolkit behavior; their upstream blob is not proof that the local adapted bytes are exact. Keep generated instruction projections synchronized through the existing canonical tools. Source-level ownership and controlled test results do not promote installed packages or establish native qualification, owner UAT, independent G2 or release.
