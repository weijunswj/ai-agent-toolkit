# Repository Capability Registry

This source-only project defines the A2 v2 repository capability decision
contract and its deterministic local runtime.

It owns only:

- the privacy-safe external registry for repository.governance, execution_loop,
  and repository.protection;
- explicit owner decision and scoped receipt semantics;
- closed v1-to-v2 migration that preserves legacy owner receipts without
  treating migration as consent;
- bounded local Git remote identity binding;
- the fail-closed atomic writer;
- the read-only quiet-entry and unresolved-question-bank contract.

It does not publish a skill or host integration. A1 operation authority,
future A3 loop execution, N5 review mechanics, N6 CI governance, N7
publisher/source-watch work, N8 native hooks/adapters, providers, credentials,
deployment, and live systems remain separate lanes.

The registry stores only lower-case repository digests, closed capability
decisions, explicit-owner provenance digests, contract identity, one compact
current receipt per capability, and bounded non-authority migration metadata.
Paths, raw remotes, prompts, repository contents, credentials, secrets,
environment values, and unrestricted tool output are forbidden.


See the preserved contract and policy sources in [_main/](_main/).
