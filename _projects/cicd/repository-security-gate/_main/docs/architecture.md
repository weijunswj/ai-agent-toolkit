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
The ordinary security gate never uses `pull_request_target`. The existing
generated-surface auto-sync workflow is a separately guarded same-repository
writeback exception with executable trust-boundary evidence and an exact,
expiring suppression. Fork pull requests receive no secrets.

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
  affected invariants. Both commits must resolve, base must be an ancestor of
  head, the clean checkout must equal head, and the report records the verified
  Git commit digest before any scanner runs.
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

An invalid provenance lock blocks every applicable scanner before execution.
Scanner and transitive-tool paths must be regular, non-symlink entries inside
the verified tool directory; actionlint selects ShellCheck only through its
locked `-shellcheck` binding.

No failure path discards implementation, terminates an agent session, invokes
Codex Security, or claims unbounded security.

## Privacy contract

Reports contain only stable identities, severity, repository-relative path,
bounded line/column, versions, coverage states, suppression references,
unverified layers, infrastructure failures, and next action. They exclude raw
source excerpts, raw scanner output, credentials, environment values, private
absolute paths, customer data, and private artifacts.

Scanner identities hash a canonical payload containing tool, rule/code,
case-folded repository-relative path, line/column, severity, a bounded
diagnostic discriminator, and a safe generic message. Exact duplicate
emissions collapse to one finding with an occurrence count. Any same-identity,
different-payload collision makes the gate unverified.

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

WEB_API and WORKFLOW_INTEGRATION consumers provide
`security/security-gate-invariants.json` using the versioned consumer invariant
schema. Entries name one contained, non-symlink regular test file and one
allowlisted runner (`node`, `python`, or `powershell`); arbitrary shell strings
and arguments are not accepted. Execution is timeout/output bounded. A valid
result is structured PASS or FINDINGS evidence, bound to profile, exact
base/head, manifest digest, and test-source digest.

Suppressions use supported Toolkit issue or review-discussion authority, a
real introduction commit that changed the exact source path, an exact expiring
finding identity, and a contained compensating test. The test digest must match
successful invariant evidence from the same run. Duplicate identities,
overlapping authority, redirected tests, and source/tool/rule/test/approval
drift fail closed.

The review packet classifies the complete changed-file manifest under a
separate hard bound before applying packet limits. It records total, included,
and omitted counts plus the complete-manifest SHA-256. Every sensitive file and
location must fit or packet generation fails closed.

## Consumer integration

A consumer commits a complete copy of this generated folder and records module
version `1.1.0`. Its workflow calls the repo-local runner and lock. The
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
