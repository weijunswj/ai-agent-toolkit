# Source Manifest: Official n8n Skills Plugin Compatibility

## Exact Source Retained

- `_main/plugins/n8n-skills/.codex-plugin/plugin.json` is an exact copy of the current official repository-root Codex plugin manifest at the pinned upstream commit. The local project path remains descriptive; the pinned upstream source path is now `.codex-plugin/plugin.json`.

## First-Party Compatibility Metadata

- `_main/compatibility-contract.json` records the reviewed package identity, supported adapter versions, current upstream state, contract file set, and immutable Git blob identities used to cross-check the executable adapter.

Runtime enforcement derives critical hook paths and complete-tree identity from one bounded deterministic inspection. Each bounded regular file is opened once, checked with nanosecond stat identity when supported, hashed twice through the same descriptor, and rechecked through both descriptor and path identity so a synchronized same-size overwrite cannot hide behind coarse timestamps. The first-party Bridge records exact target/stage/backup identity and transition evidence through the existing owned-generation mechanism. It registers a target-untouched pre-transaction before copying, appends copy/transform evidence, and adjudicates that exact generation or a registered replacement before current-cache selection without scanning stage or backup name patterns.

## Excluded Upstream Material

The upstream marketplace wrappers, hook scripts, skill pack, README, and licence copy are not published or installed by this project. Their exact upstream paths and blob identities remain in `SOURCE-LOCK.json` so report-only source watch can flag ref movement for manual compatibility review. Upstream removed its mirrored-bundle synchronizer when Codex installation moved to the repository root.

The existing Apache-2.0 `1.0.1` synthetic fixture remains under `repo/tests/fixtures/` for regression coverage. Tests construct the `1.0.2` package contract from that unchanged hook subset plus the exact current manifest retained here; GitHub's immutable compare evidence shows that the compatibility hook and meta-skill blobs did not change between the two pinned commits.
