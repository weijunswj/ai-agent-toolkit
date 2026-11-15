### Merge scope

- **Permission-line pin test waits for the owner:** a change to `repo/tests/toolkit-permissions.test.cjs`, the test that pins the commands and flags each pasted permission line allows, now needs the owner's typed merge. A new command, subcommand or flag on a pasted line fails that test, so that change now waits for the owner's typed merge; a changed check behind an existing flag still relies on review.
