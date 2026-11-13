### Changed

- **Shard timings catch-all:** The Toolkit Shard Timings workflow also starts on a push to `main`, in case the daily schedule stops firing. A push run first checks whether a refresh ran in the last 24 hours and skips the refresh when one did, and only one run goes at a time.
