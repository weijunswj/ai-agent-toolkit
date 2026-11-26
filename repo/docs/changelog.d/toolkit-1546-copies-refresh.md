### Added

- **Every Toolkit copy is named:** a governed repository's session start and the cloud sweep now name every Toolkit copy a refresh would change: the rendered workflow copies, the personal data guard and dependency auto-merge (copied as they are) and the vendored plain-text check, each marked missing, edited by hand or older copy. Before, a missing or older copied file got no line anywhere. The line tells the controller to open the refresh that session, without asking.
- **Settings drift line:** the once-a-day background read also reads the repository settings governance needs (no-force-push ruleset, required checks, merge methods, up to date before merging, dependency and security settings). While any has drifted, the session start gives one line naming what drifted and the exact step for the owner's one yes.
- **Governed repository inventory:** `repo/contracts/governed-repository-inventory.json` lists every part a governed repository gets from Toolkit and how each follows Toolkit main; its test fails when a default cloud workflow, a file a refresh may change or a governance check finding has no row.

### Changed

- **Refresh from any checkout:** `toolkit-cloud-workflows.cjs --refresh-pr` now works from any checkout of the repository, a feature branch or worktree included. It reads the default branch head on GitHub from git objects (fetching it once when missing) instead of needing the checkout on that head with no local change under `.github`.
- **Refresh names its Toolkit commit:** the refresh pull request's commit message and body end with `Toolkit commit: <full commit>`, and when its branch moves every copy on it is re-rendered from that commit, so the line stays true.
