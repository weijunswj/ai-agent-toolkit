### Fixed

- Let pinned evidence-store pull request merges use the existing custody permission when a fresh merged parent binding names the exact separate store and live checks confirm privacy, write access, default-branch base and matching head. Other repositories keep their existing merge approval handling.
- Add isolated hook-pack coverage for verified evidence merges and failed verification, without contacting GitHub or reading real user state.
