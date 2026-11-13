### Fixed

- The leftover-files scan now lists the cloud sweep workflow copies in repositories with governance off, and says when one was edited by hand.
- The cloud sweep workflows' header comments now hold both in the Toolkit and in a governed repository's copy (CI trigger, where the gate script and the refresh come from).
- `toolkit governance check` re-renders a cloud sweep copy at its own Toolkit commit, when the checkout has it and the render is unchanged since, so a hand edit with a recomputed hash shows as drift instead of an older copy. It uses the CI workflow the copy itself names, so renaming or removing that workflow only makes the copy outdated. This covers copies pinned from this release on: the render now lives in `repo/scripts/toolkit-cloud-workflows-render.cjs`, so copies pinned before it keep the hash check until their next rules refresh.
- The governance check's note for an out-of-date copy now says it differs from what a refresh writes (an older Toolkit commit, an action pin or the CI workflow it follows), not only that its commit is older.
