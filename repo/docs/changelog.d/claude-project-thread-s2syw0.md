### Fixed

- **Closed tasks can leave the programme parent:** GitHub caps a parent issue at 100 sub-issues. The reconciler no longer attaches, moves or reorders a closed `COMPLETED` or `RETIRED` task back under its parent, so the controller can detach closed tasks to make room for new ones. A detached finished task is read on its rotation turn or when it changes, not every sweep pass. A reopened task needs its native parent again.
