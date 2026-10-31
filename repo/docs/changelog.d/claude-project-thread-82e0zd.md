Title: parallel lanes

### Changed

- The Projects controller skill and its project-instructions block now say to run independent pull requests side by side: no ready or working pull request waits for another, whatever their numbers or start order, and only merges land one at a time. At most 3 lanes of any type work at once unless the owner sets another number. The coordinator answers the owner's sudden requests itself and opens one extra lane only for a request that needs real thread work. The serial review route, the single gate device and usage pacing still apply.
- The project-instructions block size limit rises to 5,850 bytes to hold the lanes line, because the coordinator reads the block but not the skill.
