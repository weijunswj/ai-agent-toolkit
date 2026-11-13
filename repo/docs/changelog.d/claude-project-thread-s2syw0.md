### Fixed

- **Closed tasks can leave the programme parent:** GitHub caps a parent issue at 100 sub-issues. The reconciler no longer attaches, moves or reorders a closed `COMPLETED` or `RETIRED` task back under its parent, so the controller can detach closed tasks to make room for new ones. A closed task that still has open sub-issues or unfinished catalogued tasks under it keeps its native parent. A detached finished task is read on its rotation turn or when it changes, not every sweep pass. A reopened task needs its native parent again.
- **Parent completion checks the catalogue too:** the programme parent closes automatically only when every catalogued task is closed or finished, so a task that could not attach (or was detached) still holds it open.
