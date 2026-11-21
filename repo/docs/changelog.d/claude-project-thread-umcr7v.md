Title: daily close list reaches the owner

### Fixed

- The daily stale sweep now prints a ready-to-post `CLOSE LIST <date>` block on every run: children whose PR merged and whose only step left is the owner's, after the agent's UAT passed and with no gate still at work, are listed with a "reply ok to close" row (naming the head the agent's UAT ran at, and showing the controller's acknowledgement note) instead of hiding on the held line; a child with no DONE WHEN heading or an unchecked row stays a judgement; the block says "nothing to close today" only when the sweep has no rows at all; a same-day rerun marks it "shown again"; an unreadable owner-wait list fails the sweep so it retries instead of looking empty.
- The programme's owner waits (`attention --json`) say why an owner UAT is the owner's: `agent_uat` is `PASSED` or `OWNER_ONLY`, with `uat_head` and `pr_state`.
- The daily check-in tells the controller to post that block to the owner as its own message every run, empty days included, with the run's other rows.
