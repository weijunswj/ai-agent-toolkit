### Merge scope

- **Permission-line pin test waits for the owner:** a change to `repo/tests/toolkit-permissions.test.cjs`, the test that pins the commands and flags each pasted permission line allows, now needs the owner's typed merge. A change that widens what those lines allow must touch that test, so it can no longer ride task auto-merge.
