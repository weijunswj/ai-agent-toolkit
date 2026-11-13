Title: merge train by default

### Changed

- Controllers now land two or more merge-ready pull requests as one merge train on their own, instead of merging them one at a time. The Controller routes its merge step to the page that holds the train rule, the Claude Projects skill puts the train ahead of the one-PR bump route, and the hourly nudge flags ready pull requests that should ride together. Trains batch, never gate: a pull request ready on its own, or one that clashes with no running train, merges straight to main without waiting to board, and an ejected member rides a later train once fixed and re-reviewed.
- Running a merge train needs no planning or build gate and runs on the small model tier. The lane never fixes a conflict: it ejects the member and that member's builder fixes it. A train needs no review of its own once `verify` passes and CI is green; only files two or more members change get a short delta review.

### Added

- `toolkit-merge-train.cjs verify` lists the files two or more members change (`overlap`) and the review the train needs (`review`).
