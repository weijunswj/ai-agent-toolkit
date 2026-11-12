Title: closing words wait for the owner's UAT

### Fixed

- **Closing words wait for UAT:** the issue closure check (CI and the PreToolUse hook) now refuses `Closes`, `Fixes` or `Resolves` in a pull request's title, body or commits while its own UAT line is `OWNER_TEST_NEEDED` or invalid, and names the `Refs` link to use instead. Before, a merge could close a child issue before the owner tested it.
