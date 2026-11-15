### Fixed

- **Source-watch notices never merge on the standing answer:** a pull request that changes the source-watch notice report (`repo/source-watch/reviews/**`) now waits for the owner's typed merge in the task auto-merge check, and the whole `repo/source-watch/**` folder is in the RISKY tier. A notice closes unmerged once it is triaged, but the report was a LIGHT `.md` file outside the merge-authority list, so one UAT line could have made a notice eligible to merge.

### Changed

- The ui-ux-pro-max reviewed-through cursor moves to upstream `0e8d408`. The two new upstream commits change only the upstream CLI asset sync, its CI path filter, an upstream IME test and a gallery copy of an already tracked data file; no tracked file or licence changed, so the earlier recommendation of a separate data refresh stands.
