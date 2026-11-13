### Fixed

- **Cloud sweep follow-up:** after its wait the follow-up starts nothing when another sweep is already queued, running or newer. It also runs when the footer step fails, and its built-in token can read contents, so the checkout works on a private repository.
- **No paid waits:** on a private repository no runner waits an hour after a pass stopped mid-way at GitHub's hourly App limit; the hourly gate resumes it from its board note. A pass that found the limit already at the margin keeps its one follow-up, and a pass stopped by its own time limit still follows up at once.
- **Footer cleaning at the limit:** a run that stopped at GitHub's hourly App limit skips footer cleaning, so it never spends the safety margin.
- **No red runs on a GitHub blip:** a 5xx, a 429 or a dropped connection in the gate or the follow-up ends the run green with a notice; the next start tries again. A missing token or repository, a 401, 403 or 404, and any other error still show red.
- **Cloud jobs contract:** the programme sweep's row names the gate workflow that holds its hourly cron, and `toolkit governance check` says the gate starts the sweep.
- **Store push refusal:** the store command the raw-push refusal prints now includes `--store`, a path in the store and `--repo-root`, so it runs as printed from the store folder.
