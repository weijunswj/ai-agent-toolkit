### Fixed

- **Cloud sweep follow-up:** after its wait the follow-up starts nothing when another sweep is already queued, running or newer. It also runs when the footer step fails, and its built-in token can read contents, so the checkout works on a private repository.
- **No paid waits:** on a private repository no runner waits an hour for GitHub's hourly App limit to reset; the hourly gate resumes that pass instead. A pass stopped by its own time limit still follows up at once.
- **Footer cleaning at the limit:** a run that stopped at GitHub's hourly App limit skips footer cleaning, so it never spends the safety margin.
- **No red runs on a GitHub blip:** a failed GitHub answer in the gate or the follow-up ends the run green with a notice; the next start tries again. A missing token or repository still shows red.
- **Cloud jobs contract:** the programme sweep's row names the gate workflow that holds its hourly cron, and `toolkit governance check` says the gate starts the sweep.
- **Store push refusal:** the store command the raw-push refusal prints now includes `--store` and `--repo-root`, so it runs as printed from the store folder.
