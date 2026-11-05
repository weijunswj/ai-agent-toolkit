### Fixed

- Setup rejects restoration mixed with planning, explanation, execution or extra arguments before invoking recovery. Dedicated backup restoration still works.
- Plain-text stale-baseline notes retain file names, rules, counts and pruning guidance without printing matched text. Baseline storage remains unchanged.
- The hostile-input timing self-test uses a controlled monotonic clock to check growth, calibration and sample limits without scheduler-dependent assertions.
- Hook test pack guidance distinguishes the 15-minute job timeout from the 360-second pack budget.
