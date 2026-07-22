# Source Manifest: Official n8n Skills Plugin Compatibility

## Exact Source Retained

- `_main/plugins/n8n-skills/.codex-plugin/plugin.json` is an exact copy of the current official repository-root Codex plugin manifest at the pinned upstream commit. The local project path remains descriptive; the pinned upstream source path is now `.codex-plugin/plugin.json`.

## First-Party Compatibility Metadata

- `_main/compatibility-contract.json` records the reviewed package identity, supported adapter versions, current upstream state, contract file set, and immutable Git blob identities used to cross-check the executable adapter.

## Excluded Upstream Material

The upstream marketplace wrappers, hook scripts, skill pack, README, and licence copy are not published or installed by this project. Their exact upstream paths and blob identities remain in `SOURCE-LOCK.json` so report-only source watch can flag ref movement for manual compatibility review. Upstream removed its mirrored-bundle synchronizer when Codex installation moved to the repository root.

The existing Apache-2.0 `1.0.1` synthetic fixture remains under `repo/tests/fixtures/` for regression coverage. Tests construct the `1.0.2` package contract from that unchanged hook subset plus the exact current manifest retained here; GitHub's immutable compare evidence shows that the compatibility hook and meta-skill blobs did not change between the two pinned commits.
