### Changed

- The scheduled programme sweep can now read and redraw a whole board in one pass. Its request cap is 1,500 on GitHub and 600 on a computer, where it shares the signed-in account's hourly limit. Every other refresh keeps 300. A task now starts only when its reads and the pages already owed also fit within what GitHub reports as left for the hour, above the low-remaining mark, so a larger cap never draws pages past GitHub's limit.
- The cloud Programme Sweep workflow starts at minute 41 instead of 17, because GitHub delays and drops scheduled runs at the top of the hour. It also runs after every push to main, so each merge refreshes the board even when GitHub drops an hourly start. It never runs for pull requests or forks.
- The sweep's summary line now shows its request cap and whether the pass completed, beside the tasks read and the tasks still queued.
