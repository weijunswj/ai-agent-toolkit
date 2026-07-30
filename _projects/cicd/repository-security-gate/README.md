# Repository Security Gate

Canonical source, policy, tools, schemas, rules, fixtures, templates, and
architecture live in [_main/](_main/).

This first-party module publishes the version-pinned
`skills/repository-security-gate/` consumer surface without bundling scanner
engines or third-party rule packs.

The source-only first-party GitHub App under `_main/app/` is deliberately
excluded from `skills/**`. Repository tooling does not deploy or install it,
create credentials, or activate a ruleset. Its separately governed promotion
is required before any App-bound required context can be enabled.

The generated pack includes the protected data-only Toolkit invariant harness
and its synthetic negative fixtures. The App service remains outside the
portable pack, while its exact source closure is bound by the protected
producer inventory.

Tool downloads, quarantined candidate execution, and consumer adoption remain
explicitly reviewed. No live target, production DAST, credential, private data,
provider, database, object storage, browser history, or Docker daemon is part
of this module.
