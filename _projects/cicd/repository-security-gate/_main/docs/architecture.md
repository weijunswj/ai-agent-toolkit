# Repository Security Gate Architecture

## Scope

This phase delivers Phase A, a reusable Phase B foundation, and the Toolkit
consumer pilot. Swooshz Platform, SQAG, SKR, X-Boundaries, preview DAST, and
production release adoption remain separate consumer work.

## Trust boundaries

| Boundary | Trigger | Authority | Network/code execution |
| --- | --- | --- | --- |
| Required-check publisher | first-party GitHub App webhook | GitHub-assigned App integration identity and separately governed deployment | App token is contained in the App and can dispatch only the protected workflow and publish only three typed Checks |
| Trusted PR gate | App `workflow_dispatch` to the protected default branch | Exact protected workflow/gate commit in `authority/`; PR head is data in `candidate/` | Downloads only immutable locked scanner assets; candidate subprocesses receive no App token, GitHub token, or secrets |
| Full/release gate | separately reviewed protected dispatch | Read-only repository contents | Same locked assets; release mode also requires exact commit and optional artifact digest |
| Hourly source-watch | schedule on trusted `main` | Metadata read plus stable notification-branch write | Queries allowlisted official metadata only; never downloads or executes upstream code |
| Candidate validation | manual dispatch on trusted `main` | Read-only contents and artifact upload | Downloads one exact candidate into disposable runner storage, verifies provenance, then runs only synthetic fixtures |
| AI/human handoff | manual or label-driven stable-head request | Read-only packet | No automatic model call or API key; exact-head packet is handed to an independent reviewer |

The source-watch and candidate-validation lanes are separate workflows.
`pull_request_target`, candidate workflow execution, candidate generator
execution, and PR-branch writeback are prohibited. The first-party
`weijunswj-toolkit-security-gate` GitHub App verifies a pull-request webhook,
reserves one durable check identity for each locked context, signs a bounded
dispatch envelope, and dispatches the exact protected default-branch workflow.
That workflow checks out the exact candidate, including a permitted fork head,
into a separate data root. Tools, reports, generated comparison, and invariant
homes use separate operation-owned roots. Checkouts are read-only and disable
credential persistence. A topology that cannot resolve the exact authority,
base, candidate, repository, installation, correlation, and nonce fails closed.

The report binds the protected authority commit/tree, invoking workflow
commit/digest, trusted workflow, runner, wrapper, policy, rules, tool lock,
installer and schema digests, candidate commit/tree/manifest, and named
checkout topology. Protected-mode invoking identity must equal the trusted
authority binding. Missing or ambiguous authority is unverified.

PR #293's earlier immutable bootstrap evidence remains historical
non-enforcement evidence. This version removes all bootstrap and candidate
triggers. After merge, the App is deployed and installed through a separate
approved promotion, produces an exact protected pass while no new context is
required, and only then supplies its GitHub-assigned numeric integration ID to
the generated non-applying ruleset plan. A candidate change to workflow, gate,
App, policy, lock, rules, schemas, generator, terminal, or suppression authority
remains scanned data and is promoted only by protected merge.

PR mode detects changes to workflow, runner, wrapper, policy, lock, rules,
schemas, and installer control paths. It records `authority_promotion` as
review-required and keeps the result unverified until separate immutable
independent review promotes those bytes. A required context name alone is
insufficient. The future ruleset binds `Repository security gate`, `Validate`,
and `Validate Toolkit` to the same exact GitHub-assigned App integration ID.
No GitHub Actions job may use an exact or ambiguity-equivalent context name.

## Required-check authority and terminal protocol

The App source is first-party, source-only material under `_main/app/`; it is
not published into `skills/**` and is not deployed by repository tooling. Its
locked permission contract is Actions write, Checks write, Statuses write,
Contents read, Pull requests read, and implicit metadata read. Statuses write
exists only for expected-source ruleset eligibility; commit-status publication
is forbidden. Checks publication is possible only through the typed publisher
and only for the three enumerated contexts. Contents/workflows/admin/issues/
secrets/deployments/packages/environments writes are forbidden.

Deployment authority is a separately reviewed, owner-controlled Worker release
from the exact accepted App source closure. Installation ownership remains
with `weijunswj`; enrollment requires both an explicit GitHub App installation
and the exact numeric repository ID in `ENROLLED_REPOSITORY_IDS`. The runtime
accepts only the named bindings in `required-check-producers.json`. Candidate
code and workflows receive none of them. Private fork heads must be readable
through the approved installation scope or fail closed. Repository rename and
transfer handling rebinds the stable numeric repository identity before work
resumes.

The App private key, webhook secret, and dispatch signing key are created and
held only in the separately governed deployment. Rotation drains active
correlations, updates the protected dispatch public key and runtime key through
a reviewed fail-closed maintenance window, verifies a synthetic dispatch, and
then revokes the old key. Compromise response suspends the installation,
revokes both signing authorities, cancels active checks, preserves bounded
receipts, and requires a new protected pass before reactivation.

Webhook signatures use `X-Hub-Signature-256`; delivery IDs and nonces are
durably replay-protected. Dispatches bind repository and installation IDs, PR,
base/ref/generation, exact head, exact protected authority, App name and
integration ID, delivery, correlation, nonce, the App-issued monotonic
same-head attempt generation, issue/expiry times, and the canonical envelope
digest. The protected runner verifies the Ed25519 signature with a
promotion-time public key and refuses a missing or changed authority.
The App resolves authority from the live protected default-branch tip rather
than conflating authority with the PR's recorded base SHA. The terminal OIDC
token must bind repository ID, repository name, workflow ref and SHA, event,
run ID, first run attempt, and GitHub `check_run_id` to the exact static and
numeric terminal job identities.

Each repository Durable Object serializes mutation and commits state plus
compaction in one storage transaction. All active correlations, unresolved
dispatch intents, incomplete publication sets, and current-head authority are
retained without age-based removal. Full terminal records retain at least the
newest 256 correlations and publication sets; additional full records remain
for 30 days up to a hard bound of 2,048 correlations and 512 publication sets.
Delivery replay records retain at least the newest 512 and otherwise seven days
up to 2,048. Attestations retain at least the newest 256 and otherwise 30 days
up to 512. Nonces remain through expiry. Compacted records enter daily
hash-chained audit buckets retained for 400 days; older buckets fold into an
indefinitely retained cumulative anchor. A crash before commit changes nothing,
and a crash after commit leaves a complete recoverable state transition.

One head/context check owns successive App-issued generations. A durable
repository-wide sequence watermark remains after terminal correlation and head
compaction, so a later generation for the same head is always strictly newer.
A newer generation may replace the current terminal outcome; an older
correlation, native workflow rerun, duplicate generation, or conflicting
terminal digest cannot update it. Complete attempt evidence remains in the
retained correlation, publication, and audit chains. The App records
`dispatch_intent` before the API boundary and `dispatch_unknown` before sending.
Unknown outcomes are reconciled by exact protected-workflow run title, authority
SHA, event, branch, and correlation discovery. Webhook redelivery performs this
reconciliation immediately, while the configured five-minute Worker cron
independently sweeps every enrolled repository Durable Object. A unique
discovered active run resumes. A uniquely discovered completed run enters the
same terminal artifact, OIDC, authority, and current-head verification path as
a completion webhook; if that evidence cannot validate, the recovery sweep
seals and publishes fail-closed outcomes for all three contexts. An ambiguous
run fails closed; an undiscovered expired intent is sealed and terminalized as
failure for all three contexts. The sweep also resumes current-attempt
`publishing` correlations from their immutable sealed set and per-context
progress. A verifier or publication fault after sealing therefore retries only
the unpublished contexts and reaches `completed` or `failed` without replacing
the sealed outcome or allowing a stale attempt to publish.

The protected workflow recursively inventories workflow and local action
producers under strict file/job/edge/depth/matrix/name bounds. It rejects
duplicate YAML keys, tags/anchors, unresolved or dynamic names, cycles, missing
targets, mutable external references, and ambiguous producer identities.
Exact Unicode names are retained; a separate NFKC/trim/ASCII-whitespace/case-
fold key detects ambiguity.

The three terminal jobs have locked static IDs and names, direct complete
`needs` sets, and exactly `if: ${{ always() }}`. They fail unless every expected
prerequisite exists and is exactly `success`. Each produces one bounded,
digest-bound receipt. The App reloads the PR, resolves exactly one authorised
workflow run and attempt, verifies its protected ref, OIDC job claims, artifact,
inventory and receipt bindings, and checks the head again immediately before
publishing. Missing, conflicting, stale, superseded, malformed, or
infrastructure evidence can never publish success.
Malformed or missing terminal evidence is converted to an explicit App
`failure` conclusion when publication infrastructure remains available; if
the App itself is unavailable, no successful required check exists.
Before the first terminal Checks API call, the App seals one immutable set
containing all three context outcomes for the accepted attempt. Per-context
progress is durable. Redelivery replays only pending members of that exact set,
so a crash or unknown API outcome cannot authorize a different digest, downgrade
a verified success with unrelated failure evidence, or strand an unrecoverable
mixed set.

Artifact admission parses the complete bounded ZIP structure. It requires one
disk, one local header at offset zero, exactly one matching central-directory
entry, one canonical expected basename, matching flags/method/sizes/CRC,
bounded decompression, a terminal end-of-central-directory record, and no
duplicate name, second entry, data descriptor, ZIP64 sentinel, preamble, or
trailing bytes.

Generated-surface fidelity runs protected generator bytes in an operation-owned
copy and compares candidate bytes only as inert inputs. Its lock binds authority
commit/tree, source manifests, generator path/digest, dependency lock, expected
outputs, candidate head/tree, and comparison digest. There is no writeback,
commit, push, or candidate-controller fallback.

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

`config/invariants.json` separates seven purpose-built protected invariants
from seven broad ordinary required-CI suites. The protected harness is an exact
trusted binding. It reads candidate bytes only as bounded data, receives no
candidate-controlled executable, has a five-second per-property limit and a
forty-second suite limit, runs with no network, secret, repository write, HOME
write, or dependency installation, and returns only the bounded
`tk.security.protected-toolkit-invariant-result/v1` contract. Every protected
property has a trusted synthetic negative fixture that must fail before
candidate evidence is accepted.

The protected catalogue proves the exact App permission boundary,
candidate-workflow non-publication, static terminal structure, trusted-only
suppression authority, report privacy, data-only protected generation, and
unique typed App publisher. Exact harness, fixture and input-manifest digests
are recorded in coverage. Malformed evidence, launch failure, sandbox failure,
timeout, output overflow, identity drift, or a failed negative fixture is
unverified.

The broader repository-security-gate, fallback-risk, agent-lifecycle,
source-watch workflow, instruction-shim, source-update and skill-routing suites
remain mandatory under `Validate` or `Validate Toolkit`. Their current
security-relevant assertions and owning contexts are exhaustively listed in
`config/invariants.json`; they do not grant suppression authority and are not
misrepresented as protected invariant evidence. Ordinary suites execute
protected test and script bytes against a disposable, unprivileged, no-secret
candidate worker. Authority-bearing protected invariants remain a separate
read-only worker contract.

WEB_API and WORKFLOW_INTEGRATION consumers may provide
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

Consumer-owned invariant code can produce ordinary findings or advisory PASS
evidence, but cannot authorise its own suppression. Invariant execution reports
only bounded privacy-safe classes: `PASS`, `FINDINGS`, `TIMEOUT`,
`SANDBOX_UNAVAILABLE`, `EXECUTION_FAILED`, `MALFORMED_RESULT`, `OUTPUT_LIMIT`,
or `IDENTITY_DRIFT`. A failed no-network/user-namespace launch is not relabelled
as a test finding and never falls back to unsandboxed candidate execution.

Active suppressions live only in the protected trusted checkout. Each exact,
expiring record binds a finding, exact-case Git path, source and tool/rule
versions, introduction commit, review authority, protected invariant ID,
complete protected harness closure digest, and exact candidate input contract.
The wrapper binds the active manifest, closure manifest, harness, schemas,
authority commit, and authority-manifest digest. The protected harness executes
trusted bytes and treats the candidate strictly as bounded input data.

`repo/security/security-gate-suppression-proposals.json` is candidate-owned and
proposal-only. It never removes a finding and is reported as
`authority_promotion: review_required`. A candidate change to active-authority
surfaces, proposals, a protected invariant closure equivalent, or any source or
input supporting a suppression makes that suppression ineligible for the same
candidate. Promotion requires a later protected authority revision. Duplicate
identities, overlapping authority, redirected inputs, and
source/tool/rule/closure/approval drift fail closed.

The review packet classifies the complete changed-file manifest under a
separate hard bound before applying packet limits. It records total, included,
and omitted counts plus the complete-manifest SHA-256. Every sensitive file and
location must fit or packet generation fails closed.

## Promotion and rollback

The generated ruleset promotion plan is data only and rejects a missing or
non-positive integration ID. A later separately approved promotion must verify
merged source/generated identities; deploy and install the separately governed
App with locked permissions; exercise the dispatch path while not required;
obtain an exact protected pass; retire historical bootstrap authority
separately; obtain another protected pass; atomically add all three App-bound
contexts while preserving CodeQL, code quality, pull-request review, deletion,
and non-fast-forward protections; read the ruleset back; and prove both a
blocking negative PR and a clean positive PR.

Any failed read-back or protected check restores the exact recorded snapshot.
The App is suspended or its key revoked on compromise. State-store ambiguity,
key rotation overlap, installation suspension, repository transfer/rename, or
evidence split brain blocks success until one exact authority is re-established.

## Consumer integration

A consumer commits a complete copy of this generated folder and records module
version `1.3.0`. Its workflow calls the repo-local runner and lock. The
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
