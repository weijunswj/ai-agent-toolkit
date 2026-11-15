### Fixed

- The decision-trace audit and `programme.cjs trace` no longer read the record a comment replaces as its own record ID when its text starts with `SUPERSEDES=`. A record ID inside a `SUPERSEDES=` token now only names the replaced record, wherever the token sits, so a record written `SUPERSEDES=` first no longer shows as a false "superseded by itself" finding.
