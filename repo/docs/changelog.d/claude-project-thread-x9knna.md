### Fixed

- The issue-closure check now refuses a `gh issue close` or closing PR write hidden in a PowerShell hash value (`@{a=gh ...}`), in a block inside a parenthesised group or hash literal after a data command, behind a `#` or `<#` or single quote inside a `cmd` script, in a here-string or heredoc given to `iex` or `pwsh -Command`, in `iex(...)`, or among the arguments after a POSIX `-c` script.
- Where PowerShell may run the command, a guarded gh command with a parenthesised argument (`gh ('issue','close','1')`) or an `@name` splat is refused by name; reads such as `gh api $url` and flag values such as `--assignee @me` stay allowed.
- Two `gh api graphql -f query="$query"` calls after one literal `query='...'` assignment are no longer refused with the wrong advice.
