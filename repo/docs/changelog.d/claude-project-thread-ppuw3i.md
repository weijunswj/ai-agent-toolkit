### Fixed

- **The programme sweep reads the newest result of a required check.** For each app that set the check, the newest run decides: an older failure no longer turns a check red once a newer run passed, and a newer failure or cancelled run is no longer hidden by an older pass. Each run's completion time and app ride in the same GraphQL read, with no extra requests. When either cannot be read, the earlier cautious rule applies.
- **The REST fallback for pull request checks can read green.** It now judges REST's lower-case states the way it judges GraphQL's, so a passing check read over REST no longer stays pending.
- **A sweep stopped in planning whose save finds the state branch busy now says it saved nothing.** The lease keeps the stop and the changed-since bookmark for the next pass, which reports it.
