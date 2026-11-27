### Added

- **Programme graph progress:** each task's Waiting on cell on the programme graph now starts with its DONE WHEN progress, ticked rows against all rows (for example `Progress: 3/5`), when the task page has DONE WHEN checkbox rows. Tasks with no such rows show no count. A pass that reads a task page keeps its count in the task's state, so rows in the graph's archive comments and tasks a pass did not read keep their count, and the graph does not change while nothing else does.
