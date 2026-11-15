Title: periodic runs hand GitHub steps to a thread with the repos

### Claude Projects

- **Added:** the hourly nudge and the daily check-in start their first line with `GITHUB STEPS OWED: <steps> | ` when a step could not read GitHub (the nudge's CI waits, PR sweep and programme sweep; the check-in's GitHub and checker steps), instead of only saying so.
- **Changed:** a coordinator without repo access no longer finishes a task run by relaying it: the same turn it hands every GitHub step of the run to a thread that has the repos, and writes `.done` only after that thread reports back (**GitHub steps need repo access** in the recurring-tasks reference, and the skill's **Every task run reaches the project chat** line).
