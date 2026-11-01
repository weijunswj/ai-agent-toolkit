### Fixed

- Automatically recover missing PR links for completed tasks from merged PR body references, closing links and timeline references. Select the latest merge, then the higher PR number on an exact timestamp tie.
- Bound discovery requests, report missing or incomplete evidence, and preserve existing findings while reads are incomplete. Recheck eligibility through the guarded state writer before saving.
- Keep retired tasks out of discovery and show their PR cell as a dash without discarding historical state.
