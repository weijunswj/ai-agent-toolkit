### Fixed

- **Refresh pull request checks governance first:** `toolkit-cloud-workflows.cjs --refresh-pr` now gives a repository that is not governed its one note before it checks that the Toolkit checkout's commit is on main, as the bridge doc says. Before, a Toolkit checkout off main told an ungoverned repository to update the checkout first, which only led to the same note. A governed repository still stops on an off-main Toolkit commit before any GitHub read or write. This also makes the command's own test give the same result on pull request and main runs.
