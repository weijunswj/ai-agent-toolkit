Title: closing words wait for a task's recorded UAT

### Fixed

- **Owed UAT on the target:** the issue closure check now also refuses a closing word for an open issue whose generated programme status records UAT as `PENDING`, `UAT_PARTIAL_REQUIRED` or `UAT_FULL_REQUIRED`, whatever the pull request's own UAT line says, and names the `Refs` link to use. Before, a pull request that needed no UAT of its own could close a task still waiting on the owner's test, even through quoted text.
