### Fixed

- **Source-watch notices never merge on the standing answer:** a pull request that changes the source-watch notice report (`repo/source-watch/reviews/**`) now waits for the owner's typed merge in the task auto-merge check, and the whole `repo/source-watch/**` folder is in the RISKY tier. A notice closes unmerged once it is triaged, but the report was a LIGHT `.md` file outside the merge-authority list, so one UAT line could have made a notice eligible to merge.

### Changed

- The ui-ux-pro-max reviewed-through cursor moves to upstream `b6a7900`. The upstream commits in that range change the upstream CLI asset sync, its CI path filter, upstream tests, a gallery copy of an already tracked data file, the excluded README, and the adapted `design_system.py`, which gains a preview page writer and design token export. Toolkit's adapted generator is a smaller local-only subset with none of those writers, so nothing is adapted now; no exact-copy data file or licence changed, and the earlier recommendation of a separate data refresh stands.
