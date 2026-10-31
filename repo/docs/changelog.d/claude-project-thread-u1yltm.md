### Fixed

- The `auto-merge-eligible` check no longer shows red on every always-manual pull request while task auto-merge is off. It reads the default branch's programme binding and, unless that says `after-gates`, passes and only lists what would be always manual. A binding it cannot read keeps the full check.

### Security

- The `toolkit-owner-merge` label now counts only when the repository owner's own user account adds it. A label added by a bot, an app or anyone else is removed and the check fails. A push after the label still removes it and turns the check red.
