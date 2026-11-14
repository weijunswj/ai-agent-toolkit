Title: shorter command list

### Changed

- **`toolkit cmd` lists only what you would type:** setup, refresh and remove Toolkit; `toolkit env` (or `toolkit show env`); `toolkit governance` (or `governance setup`); and `merge N`. `setup governance` and `refresh governance` open the same governance guide. The typed shortcuts for the governance tools (`toolkit governance status`, `check`, `discover`, `catalogue`, `security` and `migrate`) are gone: agents, setup and CI run those tools directly. `toolkit permissions` and `toolkit update scheduled task` are off the list.
- **`toolkit governance` is now a guide:** typed as a whole message (or `governance setup`), it runs governance setup, which in a governed repository shows the merged answers, and then offers the next step: turn governance on, change task auto-merge or turn it off. Each change is one pull request for you to merge.
- **`toolkit env` is a typed command:** it opens the keys editor, the same as `toolkit show env`.
