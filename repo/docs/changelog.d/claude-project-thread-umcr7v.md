Title: daily close list reaches the owner

### Fixed

- The daily stale sweep now prints a ready-to-post `CLOSE LIST <date>` block on every run: children whose PR merged and whose only step left is the owner's, after the agent's UAT passed, are listed with a "reply ok to close" row instead of hiding on the held line; an empty day says "nothing to close today"; an unreadable owner-wait list fails the sweep so it retries instead of looking empty.
- The programme's owner waits (`attention --json`) say why an owner UAT is the owner's: `agent_uat` is `PASSED` or `OWNER_ONLY`.
- The daily check-in tells the controller to post that block to the owner as its own message every run, empty days included.
