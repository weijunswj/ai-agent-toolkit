# Source Manifest: Repository Security Gate

## First-party source

All implementation, policy, rules, schemas, fixtures, templates, and
documentation in `_main/` are first-party Toolkit material written for issue
#284. No scanner engine, third-party rule pack, scanner output, vulnerability
database, credential, private data, or consumer-repository code is copied into
this module.

## Reviewed adapter source

`curated_output_for_ai/` contains only the short skill entrypoint, README,
OpenAI metadata, and pack metadata. Runtime-critical files publish exactly from
`_main/`.

## External provenance

`_main/config/tool-lock.json` records official upstream release, licence,
asset, checksum, signature/attestation, platform, and output-contract evidence.
Those records are metadata, not copied software. Source-watch consumes the
generated lock as notification-only input.

## Source-only enforcement service

`_main/app/` contains first-party source for the sole typed publisher of the
three future required checks. It has no copied third-party runtime dependency,
is not a generated skill output, and is not deployed or installed by Toolkit
project sync.

## Protected invariant closure

`_main/tools/protected-toolkit-invariants.cjs`, its immutable manifest, and
`_main/fixtures/protected-toolkit-invariants/negative-cases.json` are
first-party purpose-built protected evidence. They execute no candidate test
or helper code. The broader mapped Toolkit suites remain ordinary required CI
and cannot grant suppression or publication authority.

## Published surface

The whole generated `skills/repository-security-gate/` folder is the portable
consumer unit. The Toolkit pilot calls the generated local runner so source and
consumer bytes are exercised together.
