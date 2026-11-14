### Removed

- `toolkit governance reopen` and `toolkit governance catalogue` are gone. Nothing called them: reopen only printed "Nothing changed", and the catalogue was a list nobody read once `toolkit cmd` stopped offering it.
- The per-state skill catalogue code and its skill tier file go with it, and `toolkit governance check` no longer reports catalogue drift. The skill routing test still checks that every routed skill exists.
- The governance guard no longer lists `reopen` or `repair` as decision words, since neither is a governance command.
