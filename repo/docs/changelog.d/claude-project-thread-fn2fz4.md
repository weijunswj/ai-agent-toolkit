Title: holder orders and sweeps that finish

### Programme reconciler

- **Holder orders:** a controller with no shell of its own (a web controller) writes its decisions into a holder order: the exact writes, for the parent's current holder and epoch, until an expiry at most a day ahead. The session it hands the order to runs `programme.cjs run-order --order <file> --session <id>`, which runs only those writes as the holder, stops at the first refusal and logs the order, its digest, the running session's hash and each outcome in the parent's private part. A rerun skips finished writes; `--dry-run` writes nothing. Claims, takeovers, `init-parent` and `migrate-state` never run from an order.
- **Sweeps draw their pages:** a sweep pass now budgets each task page at its measured cost (about seven requests) for every task likely to need one, and counts the requests that opened the store. A large parent no longer reads every task, runs out of requests and draws no page at all, pass after pass; its pages now fill in over a few passes and the stopped-pass finding clears.
- **A busy sweep says who holds it:** a refresh that meets another sweep's live lease prints the holder's host, start time and lease end, and its JSON carries them as `holder`.

### Issue closure guard

- **Merged owner-test PRs:** closing words for a task are refused while a merged PR in the same repository that references it still says `UAT: OWNER_TEST_NEEDED`, even if the task's page has not recorded the owed test.
