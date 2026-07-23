# Repository Security Gate Architecture

## Scope

This phase delivers Phase A, a reusable Phase B foundation, and the Toolkit
consumer pilot. Swooshz Platform, SQAG, SKR, X-Boundaries, preview DAST, and
production release adoption remain separate consumer work.

## Trust boundaries

| Boundary | Trigger | Authority | Network/code execution |
| --- | --- | --- | --- |
| Untrusted PR gate | `pull_request` | Read-only repository contents | Downloads only immutable locked scanner assets; no secrets, provider access, or production network |
| Full/release gate | push/manual release evidence | Read-only repository contents | Same locked assets; release mode also requires exact commit and optional artifact digest |
| Hourly source-watch | schedule on trusted `main` | Metadata read plus stable notification-branch write | Queries allowlisted official metadata only; never downloads or executes upstream code |
| Candidate validation | manual dispatch on trusted `main` | Read-only contents and artifact upload | Downloads one exact candidate into disposable runner storage, verifies provenance, then runs only synthetic fixtures |
| AI/human handoff | manual or label-driven stable-head request | Read-only packet | No automatic model call or API key; exact-head packet is handed to an independent reviewer |

The source-watch and candidate-validation lanes are separate workflows.
`pull_request_target` is not used. Fork pull requests receive no secrets.

## Repository profiles

Classification walks repository content after case-folding path names and
rejecting redirected entries. A repository configuration cannot declare an
exemption.

| Profile | Content evidence |
| --- | --- |
| `SECURITY_PROFILE_EXEMPT` | No executable source, scripts, manifests, lockfiles, Actions, Docker/IaC, deployable config, generated executable surface, or web/API target |
| `SECURITY_PROFILE_LIGHTWEIGHT_CI` | Workflows or deploy/config/IaC are present without application/library/runtime source |
| `SECURITY_PROFILE_TOOLING_LIBRARY` | Executable source, scripts, dependencies, generators, or libraries are present |
| `SECURITY_PROFILE_WEB_API` | Tooling/library evidence plus web/API framework, route, schema, or server evidence |
| `SECURITY_PROFILE_WORKFLOW_INTEGRATION` | Workflow JSON, n8n/integration bridge, webhook orchestration, or integration-runtime evidence |

Ambiguous executable content is non-exempt. Shebangs and executable markers in
misleading extensions count. Hidden, nested, case-folded, and generated paths
are classified.

## Scan modes

- `pr`: binds exact base/head, scans changed files, expands security-critical
  changes to full relevant rules, checks dependency deltas, all Actions, and
  affected invariants.
- `full`: scans the entire tree, dependencies, Actions, Docker/IaC, first-party
  rules, and all Toolkit invariants.
- `scheduled`: full mode plus lock, database/rule freshness, blocked tools, and
  expired suppressions. It never mutates pins.
- `release`: full mode bound to exact commit and optional artifact/image digest.
  Any executable delta after evidence invalidates the result.

## Failure states

`SECURITY_PASS` is possible only when every required layer completed and parsed.
Findings produce `SECURITY_FINDINGS`. Missing tools, stale required data,
invalid output, checksum/publisher mismatch, malformed lock or suppression,
and incomplete required coverage produce `SECURITY_GATE_UNVERIFIED` or
`SECURITY_GATE_INFRA_BLOCKED`. A genuinely non-executable repository produces
`SECURITY_PROFILE_EXEMPT`.

No failure path discards implementation, terminates an agent session, invokes
Codex Security, or claims unbounded security.

## Privacy contract

Reports contain only stable identities, severity, repository-relative path,
bounded line/column, versions, coverage states, suppression references,
unverified layers, infrastructure failures, and next action. They exclude raw
source excerpts, raw scanner output, credentials, environment values, private
absolute paths, customer data, and private artifacts.

## Toolkit security invariants

The gate consumes focused existing tests rather than duplicating their large
fixtures. `config/invariants.json` maps evidence to:

- exact provider/target/environment/resource/operation binding;
- credential-reference-only and no-plaintext-output contracts;
- rollback/crash-boundary safety;
- bounded traversal and redirected-entry rejection;
- exact target uniqueness;
- fail-closed policy/document absence;
- read-only semantics;
- receipt/evidence reuse prevention;
- source/generated alignment;
- scanner/provenance lock integrity.

## Consumer integration

A consumer commits a complete copy of this generated folder and records module
version `1.0.0`. Its workflow calls the repo-local runner and lock. The
repository may refresh only through an independently reviewed Toolkit update.
It never executes a mutable remote branch as its only gate.

## Explicit gaps

- Semgrep CE is not executed until an official immutable binary/checksum or an
  equally strong approved packaging route is validated.
- ZAP is deferred to isolated web/API consumer pilots; no deployed target is
  configured here.
- Container image digest scanning is available through Trivy when a consumer
  supplies an exact image digest; the Toolkit pilot has no built image.
- The first-party rules are deliberately focused and do not replace language-
  specific semantic review.
- Candidate signatures/attestations are enforced only where upstream publishes
  them; absence is recorded, never invented.
