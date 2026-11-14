Title: shorter command list

### Changed

- **`toolkit cmd` lists only what you would type:** setup, refresh and remove Toolkit; `toolkit env` (or `toolkit show env`); `toolkit governance` (or `governance setup`); and `merge N`. Every other command, `toolkit permissions` included, still works when typed as a whole message, but the list leaves it out.
- **`toolkit governance` is now a guide:** typed as a whole message (or `governance setup`), it runs governance setup, which in a governed repository shows the merged answers, and then offers the next step: turn governance on, change task auto-merge or turn it off. Each change is one pull request for you to merge.
- **`toolkit env` is a typed command:** it opens the keys editor, the same as `toolkit show env`.
