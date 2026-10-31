### Fixed

- The `auto-merge-eligible` check no longer shows red on every always-manual pull request while task auto-merge is off. It reads the default branch's programme binding and, unless that says `after-gates`, passes and only lists what would be always manual. A binding it cannot read keeps the full check.

### Security

- The `toolkit-owner-merge` label now counts only when the repository owner's own user account adds it. A label added by a bot, an app or anyone else is removed and the check fails. A push after the label still removes it and turns the check red.
- Taking the `toolkit-owner-merge` label off, or a refused label, sets the head's `toolkit-owner-merge` status to failure, and only the newest status counts, so a label added back later cannot reuse an earlier OK.
- Before a task auto-merge, the controller runs the eligibility check itself, without `--binding-at`, on the head it merges, and merges only on exit 0 or with the owner's label. This covers a pull request whose check went green while auto-merge was off.
- In a repository an organisation owns, no user is the owner, so the label never counts there (it fails closed).
