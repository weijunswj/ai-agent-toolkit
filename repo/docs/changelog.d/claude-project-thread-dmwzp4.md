### Fixed

- The leftover-files scan now lists the cloud sweep workflow copies in repositories with governance off, and says when one was edited by hand.
- The cloud sweep workflows' header comments now hold both in the Toolkit and in a governed repository's copy (CI trigger, where the gate script and the refresh come from).
- `toolkit governance check` re-renders a cloud sweep copy at its own Toolkit commit, when the checkout has it and the render is unchanged since, so a hand edit with a recomputed hash shows as drift instead of an older copy. The render now lives in `repo/scripts/toolkit-cloud-workflows-render.cjs`.
