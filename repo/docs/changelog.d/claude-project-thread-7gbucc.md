### Changed

- A new top Development Principle, Accuracy first: zero hallucinations and no false data is always the top priority, and every claim, status or done verdict is checked in depth against its sources rather than skimmed.
- Tests first now says what makes a test worth keeping: it fails on the old code for the right reason or guards a real contract, through the real code path with realistic inputs. Reviews flag data shaped to the assertion, test-only branches, a stubbed unit under test, duplicates and tautologies.
- The PR review playbook applies both: check each claim against its source and run each new or changed test against the old code.
