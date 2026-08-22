# Source Manifest: N5 GitHub Governance and Truthful PR-Review Reconciler

## Source-owned surfaces

- `_main/github-governance-review-reconciler-contract.schema.json` is the
  closed contract shape for parent, child, PR, review, finding, and Deferred
  Findings records.
- `_main/github-governance-review-reconciler-policy.json` records the accepted
  A1-A4 boundary, v3 tracker rules, transaction failures, review authority,
  Deferred Findings policy, optional Codex capability, Auto-code boundary,
  historical PR #310 disposition, the Run-181 B1-B6 contract-integrity roots,
  and the Run-183 four-root closure for canonical A2 identity, accepted child
  completion evidence, A4-derived materiality, and unmanaged-only initialise.
  Run-185 closes trusted first-party review/terminal evidence adapters, fresh A4 Deferred-Finding revalidation, and conservative legacy residue detection.
- `_main/tracker-v3-grammar.json` and `_main/templates/` are the deterministic
  managed-block grammar and templates. They do not permit model-authored
  parent Markdown reconstruction.
- `repo/scripts/toolkit-github-governance-review-reconciler.cjs` is the one
  shared runtime for local parsing, bounded projection, preview, injected
  adapter reconciliation, inventory, finding classification, and DF handling.
- `repo/tests/` contains RED-first and boundary acceptance tests.
  Run-181 acceptance covers exact A2 repository identity, global lifecycle/PR
  uniqueness, explicit review evidence, shared transaction ownership,
  Run-185 adversarial tests cover trusted adapter boundaries, fresh DF
  revalidation, and legacy residue variants.

## Published surface

The explicit-only skill is generated from project source. Do not edit generated
files directly; update `_main/skill/` and run:

```text
node repo/scripts/sync-toolkit-projects.cjs --write
```

The generated skill contains instructions and metadata only. No MCP surface is
published. No live GitHub/provider adapter, workflow, credential, review
thread, Ready, merge, or finality action is included.

## Historical and authority boundaries

The implementation uses current canonical A1-A4 primitives by contract. It
does not revive #318, PR #310 code, the old caller-token/cache workflow, #337,
or a generic Web controller authority. A1 remains sole mutation and opaque
authority-ticket owner; A2 remains consent/state only; A3 remains five
durable execution contracts without finality; A4 remains assurance and Web
handoff only.

Deferred Findings are an index/provenance/revalidation register, not a second
queue or an automatic backlog issue creator. Ordinary executors inspect and
recommend; Run-183 derives materiality at every finding ingress, and only the
current programme Web/user controller may mutate review
threads or make final dispositions.
