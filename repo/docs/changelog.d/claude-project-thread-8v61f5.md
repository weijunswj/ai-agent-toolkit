Title: every task run reaches the project chat

### Claude Projects
- Each scheduled task run now posts one line in its home thread (its first line and the report path) and stamps a run file under `/mnt/project-files/toolkit/task-runs/`; a message to the coordinator is only the retry when that post fails.
- The coordinator relays every run to the project chat as one line and stamps the relay. On a new session's first wake, and on every wake a task home thread starts, it relays any run newer than its relay stamp, so runs are no longer lost when the coordinator session is replaced.
- The hourly nudge flags runs still unrelayed after 15 minutes (`UNRELAYED TASK RUNS`) and working lanes below the lane cap while work is queued (`LANES UNDER CAP`). Its quick no-change check no longer trusts the project chat's page order and ignores its own home-thread lines.
- The daily check-in reports each task's last run and whether it was relayed, flags a run unrelayed for over an hour (`RELAY GAP`), and advises opting a project's own tasks into the Toolkit shell to get the same line and stamp.
- Existing task prompts check as outdated, so the next daily check-in swaps them to the new delivery.
