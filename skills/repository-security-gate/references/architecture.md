<!--
Generated from toolkit project source. Do not edit directly.
Project: cicd.repository-security-gate
Source: _projects/cicd/repository-security-gate/_main/docs/architecture.md
Update the project source and run sync.
-->
# Repository Security Gate Architecture

## Scope

This phase delivers Phase A, a reusable Phase B foundation, and the Toolkit
consumer pilot. Swooshz Platform, SQAG, SKR, X-Boundaries, preview DAST, and
production release adoption remain separate consumer work.

## Trust boundaries

| Boundary | Trigger | Authority | Network/code execution |
| --- | --- | --- | --- |
| Trusted PR gate | protected `pull_request_target` definition | Exact protected workflow/gate commit in `trusted-gate/`; PR head is data in `candidate/` | Downloads only immutable locked scanner assets; scanner and invariant subprocesses receive no GitHub token or secrets |
| Full/release gate | push/manual release evidence | Read-only repository contents | Same locked assets; release mode also requires exact commit and optional artifact digest |
| Hourly source-watch | schedule on trusted `main` | Metadata read plus stable notification-branch write | Queries allowlisted official metadata only; never downloads or executes upstream code |
| Candidate validation | manual dispatch on trusted `main` | Read-only contents and artifact upload | Downloads one exact candidate into disposable runner storage, verifies provenance, then runs only synthetic fixtures |
| AI/human handoff | manual or label-driven stable-head request | Read-only packet | No automatic model call or API key; exact-head packet is handed to an independent reviewer |

The source-watch and candidate-validation lanes are separate workflows. The
security gate uses a protected-base `pull_request_target` workflow strictly as
the immutable enforcement authority. It checks out the exact PR head,
including a public fork head, into a separate candidate root and never runs
candidate workflow or gate-control code. Tools and sealed reports live in a
third operation-owned root. All checkouts use read-only permissions and
disabled credential persistence. Fork pull requests receive no secrets.
Public fork heads are supported by fetching the exact public base commit into
the candidate object database without credentials. A topology that cannot
resolve both exact commits fails closed; private-fork enablement requires a
separately reviewed checkout design and is not implied by this template.

The report binds the protected authority commit/tree, invoking workflow
commit/digest, trusted workflow, runner, wrapper, policy, rules, tool lock,
installer and schema digests, candidate commit/tree/manifest, and named
checkout topology. Protected-mode invoking identity must equal the trusted
authority binding. Missing or ambiguous authority is unverified.

PR #293 bootstraps the not-yet-merged gate from an exact immutable commit in a
separate trusted checkout. Its candidate-owned invoking workflow digest is
recorded separately and requires independent review; bootstrap evidence is not
represented as protected enforcement. After merge, the `pull_request`
bootstrap trigger is removed and the repository ruleset must require the
protected `trusted-security-gate` job from this workflow. A candidate change to
the workflow or gate remains scanned data and is promoted only by protected
merge.

PR mode detects changes to workflow, runner, wrapper, policy, lock, rules,
schemas, and installer control paths. It records `authority_promotion` as
review-required and keeps the result unverified until separate immutable
independent review promotes those bytes. A required status context by name
alone is insufficient; the repository ruleset must bind the protected
workflow identity and its `Trusted repository security gate` job.

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
exact-case repository-relative Git path, line/column, severity, a bounded
diagnostic discriminator, and a safe generic message. Exact duplicate
emissions collapse to one finding with an occurrence count. Any same-identity,
different-payload collision makes the gate unverified.

Path separators are normalised to `/`, but case is never folded in finding or
suppression identity. The gate enumerates the exact Git tree, records bounded
case-fold alias groups, and requires each scanner path to match exactly one
tracked path. Incorrectly cased or ambiguous case-fold-only scanner output
fails closed. A suppression matches one exact-case Git path only.

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
base/head, manifest digest, and test-source digest. In trusted CI these tests
run under a separate no-secret, no-network OS identity against a read-only
candidate checkout. The trusted verifier rechecks candidate and authority
identity after each executable scanner or invariant phase and before sealing;
mutation is unverified.

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
version `1.2.0`. Its workflow calls the repo-local runner and lock. The
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
