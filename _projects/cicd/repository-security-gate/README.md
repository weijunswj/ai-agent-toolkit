# Repository Security Gate

Canonical source, policy, tools, schemas, rules, fixtures, templates, and
architecture live in [_main/](_main/).

This first-party module publishes the version-pinned
`skills/repository-security-gate/` consumer surface without bundling scanner
engines or third-party rule packs.

Tool downloads, quarantined candidate execution, and consumer adoption remain
explicitly reviewed. No live target, production DAST, credential, private data,
provider, database, object storage, browser history, or Docker daemon is part
of this module.
