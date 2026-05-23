# Codex Security Findings Triage — 2026-05-23

Triaged against current `origin/main` at `a4d6523` (`Merge pull request #64 from weijunswj/codex/fix-n8n-prepared-import-validation`).

Input CSV was present in the repository root at the start of triage and contained 23 rows. It had no line/range column, so "CSV line/range" below records the CSV row number and notes that no explicit line range was provided.

## Summary

| Bucket | Count |
|---|---:|
| real/fix-now | 0 |
| already-fixed | 6 |
| active-side-fix | 1 |
| false-positive | 0 |
| info/later | 16 |

## Findings

### Finding 1: Inline comments bypass workflow permission validation

- CSV severity: medium
- CSV file/path: `repo/scripts/validate-toolkit.cjs | repo/tests/validate-toolkit.test.cjs`
- CSV line/range: CSV row 1; no explicit line/range field provided
- Current classification: `info/later`
- Current status on `main`: Still active. The workflow itself grants only the intended permissions, but the parser still ignores permission entries with inline comments.
- Evidence:
  - Current code reference: `.github/workflows/source-watch-pr.yml:11` grants `contents: write` and `pull-requests: write`; `repo/scripts/validate-toolkit.cjs:815` only records permission lines that fully match `^  ([A-Za-z-]+):\s*(\S+)\s*$`; `repo/scripts/validate-toolkit.cjs:1231` compares the collected list to the two expected entries.
  - Related PR, if any: Introduced around PR #60; PR #63 changed source-watch notifier trust boundaries but did not change this parser.
  - Test coverage, if any: `repo/tests/validate-toolkit.test.cjs:460` rejects an uncommented extra permission. No current test covers `issues: write # comment`.
- Recommendation: Later hardening PR should parse YAML permissions robustly or reject unparsed indented entries in the permissions block.
- Needs PR:
  - yes
  - If yes, proposed PR title: Harden workflow permission parsing against inline comments

### Finding 2: Retired repo guard trusts mutable source locks

- CSV severity: medium
- CSV file/path: `repo/scripts/validate-toolkit.cjs | repo/scripts/audit-project-source-locks.cjs | repo/scripts/watch-project-sources.cjs`
- CSV line/range: CSV row 2; no explicit line/range field provided
- Current classification: `info/later`
- Current status on `main`: Still active as a validation design gap. Current lock data is not currently wrong, but changing lock lifecycle metadata can still affect the retired-repo deny set.
- Evidence:
  - Current code reference: `repo/scripts/validate-toolkit.cjs:292` derives retired internal repos from current `SOURCE-LOCK.json` files; `repo/scripts/validate-toolkit.cjs:466` blocks registry entries only if they are in that derived set; `repo/scripts/audit-project-source-locks.cjs:89` enforces constraints only when lifecycle is already `retired_after_migration`; `repo/scripts/watch-project-sources.cjs:59` treats `source_update_policy: none` or retired lifecycle as archived.
  - Related PR, if any: PR #54 (`Clean retired source repo references`).
  - Test coverage, if any: Current tests cover happy-path retired locks and third-party locks, but not the converse constraint that `migration_provenance_only` or `source_update_policy: none` must remain retired.
- Recommendation: Later PR should make retired internal repo identities immutable outside PR-controlled lock metadata or enforce lifecycle/role/update-policy converse constraints.
- Needs PR:
  - yes
  - If yes, proposed PR title: Make retired source repo validation fail closed

### Finding 3: Post-parse rewrites can poison generated JSON surfaces

- CSV severity: medium
- CSV file/path: `repo/scripts/sync-toolkit-projects.cjs | _projects/n8n/workflow-toolkit/toolkit.project.json | github/workflows/auto-sync-generated-surfaces.yml`
- CSV line/range: CSV row 3; no explicit line/range field provided
- Current classification: `info/later`
- Current status on `main`: Still active. JSON output is parsed and formatted, then text rewrites are applied without a second JSON parse or JSON-kind restriction.
- Evidence:
  - Current code reference: `repo/scripts/sync-toolkit-projects.cjs:266` allows `text_rewrites` on outputs generally; `repo/scripts/sync-toolkit-projects.cjs:628` applies arbitrary string replacements; `repo/scripts/sync-toolkit-projects.cjs:690` applies rewrites after `JSON.parse`/`JSON.stringify` for JSON outputs.
  - Related PR, if any: PR #49 (`agent-rule-path-cleanup`) introduced text rewrites.
  - Test coverage, if any: Existing rewrite tests cover extract/concat text outputs, not JSON rewrite validation.
- Recommendation: Later PR should either forbid `text_rewrites` on JSON outputs or reparse and validate rewritten JSON plus safety invariants.
- Needs PR:
  - yes
  - If yes, proposed PR title: Prevent text rewrites from mutating generated JSON semantics

### Finding 4: Symlinked skill-routing partial can leak CI files

- CSV severity: medium
- CSV file/path: `repo/scripts/sync-toolkit-projects.cjs | github/workflows/auto-sync-generated-surfaces.yml`
- CSV line/range: CSV row 4; no explicit line/range field provided
- Current classification: `already-fixed`
- Current status on `main`: Stale. The exact CSV leak path no longer exists on current `main`.
- Evidence:
  - Current code reference: `skills/n8n-local-setup/templates/agent-rules/partials/skill-routing-rules.md` is absent; agent-rule partial sources are now under `_projects/**/_main/_partials/`; `repo/scripts/sync-toolkit-projects.cjs:491` and `repo/scripts/sync-toolkit-projects.cjs:551` validate partial source locations under project `_main/_partials/`.
  - Related PR, if any: PR #36 (`fix-n8n-skill-routing-link`) and later agent-rule refactors removed the root-surface partial path from this finding.
  - Test coverage, if any: Agent-rule generation tests cover source-side template freshness and partial ownership in `repo/tests/validate-toolkit.test.cjs`.
- Recommendation: No separate PR for this stale path. A broader symlink-safe file-read hardening could be considered later, but this specific finding is fixed.
- Needs PR:
  - no
  - If yes, proposed PR title: n/a

### Finding 5: PR-controlled npm script can bypass validation gate

- CSV severity: medium
- CSV file/path: `github/workflows/validate.yml | package.json | repo/scripts/validate-toolkit.cjs`
- CSV line/range: CSV row 5; no explicit line/range field provided
- Current classification: `info/later`
- Current status on `main`: Still active for the unprivileged validation workflow. The workflow checks out PR code and runs the PR-controlled `npm run validate:all`.
- Evidence:
  - Current code reference: `.github/workflows/validate.yml:31` runs `npm run validate:all`; `package.json:18` defines that script in repository-controlled JSON; `repo/scripts/validate-toolkit.cjs:880` guards `npm run validate:all` only in the privileged auto-sync workflow context.
  - Related PR, if any: PR #32 (`ci-methodology-hardening`).
  - Test coverage, if any: `repo/tests/validate-toolkit.test.cjs:415` asserts the validate workflow uses `npm run validate:all`; `repo/tests/validate-toolkit.test.cjs:720` forbids it in the privileged auto-sync workflow.
- Recommendation: Later PR should make the read-only validation gate invoke a protected explicit command list, or validate `package.json` scripts before relying on them.
- Needs PR:
  - yes
  - If yes, proposed PR title: Harden PR validation against package-script tampering

### Finding 6: CMD wrappers allow PowerShell search-path hijacking

- CSV severity: medium
- CSV file/path: `skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/- export-n8n-workflows-live.cmd | skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/- import-n8n-workflows-live.cmd | skills/n8n-workflow-helper-scripts/templates/helper-scripts/sanitizer/- sanitise-n8n-template.cmd`
- CSV line/range: CSV row 6; no explicit line/range field provided
- Current classification: `active-side-fix`
- Current status on `main`: Still active in helper wrappers, though the CSV paths use the old dash-prefixed names. Current underscore-prefixed wrappers still invoke bare `powershell`.
- Evidence:
  - Current code reference: `skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/_export-n8n-workflows-live.cmd:6`, `skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/_import-n8n-workflows-live.cmd:7`, and `skills/n8n-workflow-helper-scripts/templates/helper-scripts/sanitizer/_sanitise-n8n-template.cmd:6` invoke `powershell` without an absolute path.
  - Related PR, if any: PR #62 addressed n8n sync-menu replay hardening, not these `.cmd` executable resolution calls.
  - Test coverage, if any: `repo/tests/n8n-helper-scripts.test.cjs:615` checks wrapper files exist across source/generated surfaces, but there is no assertion that wrappers resolve PowerShell by absolute system path.
- Recommendation: Fold into the active helper-script side fix, or split a focused helper-wrapper hardening PR if that side fix is not covering it.
- Needs PR:
  - yes
  - If yes, proposed PR title: Harden n8n helper CMD wrappers against PowerShell path hijacking

### Finding 7: Curated reference audit bypass for runtime instructions

- CSV severity: medium
- CSV file/path: `repo/scripts/audit-published-surfaces.cjs`
- CSV line/range: CSV row 7; no explicit line/range field provided
- Current classification: `info/later`
- Current status on `main`: Still partially active. Reviewed reference and overview exceptions can still suppress runtime-heft checks for short files.
- Evidence:
  - Current code reference: `repo/scripts/audit-published-surfaces.cjs:434` treats references as reviewed based on notes/fidelity wording; `repo/scripts/audit-published-surfaces.cjs:524` classifies such outputs as `curated_reference` before runtime reasons; `repo/scripts/audit-published-surfaces.cjs:623` defines heavy runtime shape without numbered setup steps or marker hits; `repo/scripts/audit-published-surfaces.cjs:624` suppresses explicit platform overview findings when not heavy.
  - Related PR, if any: PR #26 (`declare-n8n-workflow-sync-references`).
  - Test coverage, if any: `repo/tests/audit-published-surfaces.test.cjs:308` covers runtime-heavy workflow-toolkit reference fixtures, but short runtime-looking references remain less covered.
- Recommendation: Later audit PR should apply runtime marker and numbered-step checks before broad reviewed-reference/overview suppression.
- Needs PR:
  - yes
  - If yes, proposed PR title: Tighten curated reference runtime-surface audit exceptions

### Finding 8: Sanitizer leaves config literals in workflow metadata

- CSV severity: medium
- CSV file/path: `_projects/n8n/workflow-templates/_main/scripts/prepare-n8n-template.js | skills/n8n-workflow-sync/templates/sanitizer/prepare-n8n-template.js | repo/tests/n8n-helper-scripts.test.cjs`
- CSV line/range: CSV row 8; no explicit line/range field provided
- Current classification: `info/later`
- Current status on `main`: Still active in the current migrated sanitizer path. Current behavior intentionally rewrites collected config literals only inside node parameters, leaving node names and connection keys stable.
- Evidence:
  - Current code reference: `_projects/n8n/workflow-toolkit/_main/helper-scripts/sanitizer/prepare-n8n-template.js:470` says only parameter values are rewritten; `_projects/n8n/workflow-toolkit/_main/helper-scripts/sanitizer/prepare-n8n-template.js:417` warns only for remaining emails and URLs in the final object.
  - Related PR, if any: PR #25 (`update-n8n-sanitizer`).
  - Test coverage, if any: `repo/tests/n8n-helper-scripts.test.cjs:246` explicitly asserts node names and connection keys stay stable while parameter literals are replaced.
- Recommendation: Later PR should decide whether metadata config literals are acceptable with warnings, or add a warning-only detector for config-looking node names and connection metadata without breaking n8n references.
- Needs PR:
  - yes
  - If yes, proposed PR title: Warn on config-like literals preserved in n8n template metadata

### Finding 9: Curated template audit bypass for runtime surfaces

- CSV severity: medium
- CSV file/path: `repo/scripts/audit-published-surfaces.cjs`
- CSV line/range: CSV row 9; no explicit line/range field provided
- Current classification: `info/later`
- Current status on `main`: Partially active. Reviewed template outputs now get runtime-heft checks, but curated template directory and pack README categories still have broad allow paths.
- Evidence:
  - Current code reference: `repo/scripts/audit-published-surfaces.cjs:425` identifies reviewed templates by output path plus template wording; `repo/scripts/audit-published-surfaces.cjs:528` now rechecks reviewed templates for runtime reasons; `repo/scripts/audit-published-surfaces.cjs:571` through `repo/scripts/audit-published-surfaces.cjs:578` still allows curated template and pack README categories; `repo/scripts/audit-published-surfaces.cjs:610` immediately returns no curated-directory findings for allowed categories other than curated indexes.
  - Related PR, if any: PR #23 (`declare-secure-cicd-remaining-templates`).
  - Test coverage, if any: `repo/tests/audit-published-surfaces.test.cjs:247` covers a reviewed runtime-template fixture; pack README and curated directory bypass variants are not equivalently covered.
- Recommendation: Later PR should narrow template and pack README allow categories or run runtime-heft checks before allowing them.
- Needs PR:
  - yes
  - If yes, proposed PR title: Narrow curated template and pack README audit bypasses

### Finding 10: Platform overview exception bypasses curated runtime audit

- CSV severity: medium
- CSV file/path: `repo/scripts/audit-published-surfaces.cjs`
- CSV line/range: CSV row 10; no explicit line/range field provided
- Current classification: `info/later`
- Current status on `main`: Still active for short files. Heavy platform overview fixtures are covered, but the exception still ignores numbered steps and runtime marker hits when deciding whether a file is heavy.
- Evidence:
  - Current code reference: `repo/scripts/audit-published-surfaces.cjs:585` defines the platform overview boundary exception; `repo/scripts/audit-published-surfaces.cjs:623` sets `heavyRuntimeShape` from file size, code fences, and heading count only; `repo/scripts/audit-published-surfaces.cjs:624` suppresses matching platform overviews if not heavy.
  - Related PR, if any: PR #22 (`review-n8n-platform-overviews`).
  - Test coverage, if any: `repo/tests/audit-published-surfaces.test.cjs:350` covers a runtime-heavy platform overview with multiple code fences, not a short many-step runtime guide.
- Recommendation: Later PR should include numbered setup steps and runtime marker hits in the exception guard.
- Needs PR:
  - yes
  - If yes, proposed PR title: Include runtime markers in platform overview audit exceptions

### Finding 11: Curated output audit can be bypassed with overview metadata

- CSV severity: medium
- CSV file/path: `repo/scripts/audit-published-surfaces.cjs`
- CSV line/range: CSV row 11; no explicit line/range field provided
- Current classification: `info/later`
- Current status on `main`: Still active. `overview` metadata can still classify a curated output as `curated_index` before recipe runtime reasons run.
- Evidence:
  - Current code reference: `repo/scripts/audit-published-surfaces.cjs:409` treats notes/fidelity containing `overview` as overview-like; `repo/scripts/audit-published-surfaces.cjs:531` returns `curated_index` for index-like or overview-like curated outputs before calling `recipeBoundaryReasons`.
  - Related PR, if any: PR #20 (`audit-curated-output-boundaries`).
  - Test coverage, if any: `repo/tests/audit-published-surfaces.test.cjs:209` covers a new curated runtime recipe without using overview metadata to suppress the boundary classification.
- Recommendation: Later PR should run boundary/runtime reasons before accepting `overview` metadata, or require source-path and content-specific overview constraints.
- Needs PR:
  - yes
  - If yes, proposed PR title: Prevent overview metadata from suppressing curated runtime audit findings

### Finding 12: Published n8n setup binds Docker to all interfaces

- CSV severity: medium
- CSV file/path: `_projects/n8n/local-setup/toolkit.project.json | skills/n8n-local-setup/references/n8n/local-setup.md`
- CSV line/range: CSV row 12; no explicit line/range field provided
- Current classification: `info/later`
- Current status on `main`: Still active in the published setup guide.
- Evidence:
  - Current code reference: `skills/n8n-local-setup/references/n8n/local-setup.md:68` uses `docker run`; `skills/n8n-local-setup/references/n8n/local-setup.md:69` maps `-p "${HOST_PORT}:${CONTAINER_PORT}"`, which binds on all host interfaces by default.
  - Related PR, if any: PR #18 (`restore-n8n-local-setup-fidelity`).
  - Test coverage, if any: No current test asserts loopback-only Docker binding for the local setup guide.
- Recommendation: Later docs/source PR should change the local-only command to `127.0.0.1:${HOST_PORT}:${CONTAINER_PORT}` and add explicit public-hosting guidance separately.
- Needs PR:
  - yes
  - If yes, proposed PR title: Bind local n8n Docker setup to loopback by default

### Finding 13: Published-surface audit not enforced in CI

- CSV severity: medium
- CSV file/path: `package.json | github/workflows/validate.yml | github/workflows/validate-toolkit.yml | repo/tests/audit-published-surfaces.test.cjs`
- CSV line/range: CSV row 13; no explicit line/range field provided
- Current classification: `already-fixed`
- Current status on `main`: Fixed for the main `Validate` workflow. The audit is now included through `npm run validate:all`.
- Evidence:
  - Current code reference: `.github/workflows/validate.yml:31` runs `npm run validate:all`; `package.json:18` includes `node repo/scripts/audit-published-surfaces.cjs --check` in `validate:all`.
  - Related PR, if any: PR #32 (`ci-methodology-hardening`) changed the main validation entrypoint.
  - Test coverage, if any: `repo/tests/validate-toolkit.test.cjs:415` asserts the validate workflow uses `npm run validate:all`; `repo/tests/audit-published-surfaces.test.cjs:209` verifies new curated runtime recipes fail audit check.
- Recommendation: No separate PR for this stale finding. Finding 5 tracks the residual risk from relying on PR-controlled npm scripts.
- Needs PR:
  - no
  - If yes, proposed PR title: n/a

### Finding 14: Prompt fetches n8n helpers from unpinned external main

- CSV severity: medium
- CSV file/path: `_projects/cicd/secure-installer/toolkit.project.json | skills/secure-cicd-installer/templates/cicd/secure-cicd-prompt.md | _projects/cicd/secure-installer/SOURCE-LOCK.json | skills/secure-cicd-installer/packs/secure-cicd/pack.json`
- CSV line/range: CSV row 14; no explicit line/range field provided
- Current classification: `already-fixed`
- Current status on `main`: Fixed for the specific external-repo issue. The prompt no longer points consumers at `weijunswj/ai-cicd-installer/tree/main/templates/n8n/`.
- Evidence:
  - Current code reference: `skills/secure-cicd-installer/templates/cicd/secure-cicd-prompt.md:114` now points to the toolkit helper package under `https://github.com/weijunswj/ai-agent-toolkit/tree/main/skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/`; `_projects/cicd/secure-installer/SOURCE-LOCK.json:20` records that the deleted standalone helper-script repository URL was replaced.
  - Related PR, if any: Later secure-installer source-lock/helper updates after PR #16.
  - Test coverage, if any: `repo/tests/validate-toolkit.test.cjs:1369` and nearby tests check stale generated secure-CI prompt behavior.
- Recommendation: No separate PR for the original external-main issue. A lower-priority follow-up could decide whether same-repo `main` links in prompts should also be pinned or converted to local copy instructions.
- Needs PR:
  - no
  - If yes, proposed PR title: n/a

### Finding 15: Mixed dangerous PR changes now pass auto-sync check

- CSV severity: medium
- CSV file/path: `github/workflows/auto-sync-generated-surfaces.yml`
- CSV line/range: CSV row 15; no explicit line/range field provided
- Current classification: `info/later`
- Current status on `main`: Still active. The workflow skips with exit 0 for unsafe mixed paths instead of failing closed.
- Evidence:
  - Current code reference: `.github/workflows/auto-sync-generated-surfaces.yml:88` matches blocked paths such as `.github/*`, `repo/scripts/*`, tests, package files, and lockfiles; `.github/workflows/auto-sync-generated-surfaces.yml:90` emits a notice; `.github/workflows/auto-sync-generated-surfaces.yml:92` exits 0 with `should_sync=false`.
  - Related PR, if any: PR #13 (`auto-sync-generated-surfaces`).
  - Test coverage, if any: `repo/tests/validate-toolkit.test.cjs:800` currently expects the skip message rather than a failing status.
- Recommendation: Later PR should align the workflow with the repo contract by failing for mixed eligible and unsafe paths.
- Needs PR:
  - yes
  - If yes, proposed PR title: Fail auto-sync preflight on mixed unsafe PR changes

### Finding 16: Source-lock metadata can hide active sources

- CSV severity: medium
- CSV file/path: `scripts/audit-project-source-locks.cjs | scripts/watch-project-sources.cjs`
- CSV line/range: CSV row 16; no explicit line/range field provided
- Current classification: `info/later`
- Current status on `main`: Still active; CSV paths are stale and now live under `repo/scripts/`, but the lifecycle-policy validation gap remains.
- Evidence:
  - Current code reference: `repo/scripts/audit-project-source-locks.cjs:89` through `repo/scripts/audit-project-source-locks.cjs:119` enforce constraints for retired and third-party roles but not the inverse for `migration_provenance_only` or `source_update_policy: none`; `repo/scripts/watch-project-sources.cjs:59` archives any lock with update policy `none` or retired lifecycle.
  - Related PR, if any: PR #4 (`rehaul/project-modules-main`).
  - Test coverage, if any: Current validation tests cover allowed metadata values and retired/third-party positive cases, not active-source hiding via inconsistent metadata.
- Recommendation: Later PR should enforce converse lifecycle/role/update-policy invariants and cover them with validator tests.
- Needs PR:
  - yes
  - If yes, proposed PR title: Enforce source-lock lifecycle metadata consistency

### Finding 17: n8n sanitizer misses secrets embedded in expressions

- CSV severity: medium
- CSV file/path: `templates/n8n/sanitizer/prepare-n8n-template.js`
- CSV line/range: CSV row 17; no explicit line/range field provided
- Current classification: `info/later`
- Current status on `main`: Still active in the migrated sanitizer path.
- Evidence:
  - Current code reference: `_projects/n8n/workflow-toolkit/_main/helper-scripts/sanitizer/prepare-n8n-template.js:45` anchors `URL_RE` to the start of the string; `_projects/n8n/workflow-toolkit/_main/helper-scripts/sanitizer/prepare-n8n-template.js:325` handles expression strings specially; `_projects/n8n/workflow-toolkit/_main/helper-scripts/sanitizer/prepare-n8n-template.js:330` warns only if the whole expression matches email or start-anchored URL; `_projects/n8n/workflow-toolkit/_main/helper-scripts/sanitizer/prepare-n8n-template.js:425` repeats only email and start-anchored URL suspicious checks.
  - Related PR, if any: PR #2 (`migrate-aiagent-toolkit`).
  - Test coverage, if any: Existing sanitizer tests cover placeholder replacement and stable node names, not embedded URLs/bearer-like secrets inside expressions.
- Recommendation: Later sanitizer PR should inspect expression bodies for URLs, bearer-like tokens, and other secret/config markers while preserving legitimate n8n expressions.
- Needs PR:
  - yes
  - If yes, proposed PR title: Detect live secrets embedded in n8n expression strings

### Finding 18: Notion data source ID still committed in test

- CSV severity: low
- CSV file/path: `repo/tests/knowledge-index-updater.test.cjs`
- CSV line/range: CSV row 18; no explicit line/range field provided
- Current classification: `info/later`
- Current status on `main`: Still active. The production skill text uses placeholders, but the regression test still stores the removed data-source identifier as a constant.
- Evidence:
  - Current code reference: `repo/tests/knowledge-index-updater.test.cjs:13` defines `realDataSourceId`; `repo/tests/knowledge-index-updater.test.cjs:50` asserts generated skill text does not contain that value.
  - Related PR, if any: PR #61 (`knowledge-index-deterministic-identity`).
  - Test coverage, if any: The test covers absence from source/generated skill files, but not absence from the test file itself.
- Recommendation: Later low-risk cleanup should replace the constant with a clearly fake sentinel and keep the same absence assertion.
- Needs PR:
  - yes
  - If yes, proposed PR title: Replace real Notion data source test constant with fake sentinel

### Finding 19: Audit suppresses unsafe MCP runtime surface findings

- CSV severity: low
- CSV file/path: `repo/scripts/audit-published-surfaces.cjs | _projects/repo-methodology/mcp-ready-registry/SOURCE-MANIFEST.md | repo/scripts/sync-toolkit-projects.cjs`
- CSV line/range: CSV row 19; no explicit line/range field provided
- Current classification: `info/later`
- Current status on `main`: Still active as a low-severity audit exception gap.
- Evidence:
  - Current code reference: `_projects/repo-methodology/mcp-ready-registry/SOURCE-MANIFEST.md:27` says the module must not add runtime/package surfaces; `repo/scripts/audit-published-surfaces.cjs:497` through `repo/scripts/audit-published-surfaces.cjs:502` returns no main-adapter reasons for any `mcp/` output from that module's `_main/` sources.
  - Related PR, if any: MCP-ready registry ownership work around PR #42.
  - Test coverage, if any: No current test appears to add a runtime-looking MCP package surface from this module and assert audit failure.
- Recommendation: Later PR should narrow the exception to known design/spec outputs or add explicit forbidden runtime/package path checks.
- Needs PR:
  - yes
  - If yes, proposed PR title: Narrow MCP-ready registry published-surface audit exception

### Finding 20: Overbroad example JSON unignore can expose credentials

- CSV severity: low
- CSV file/path: `gitignore | scripts/validate-toolkit.cjs`
- CSV line/range: CSV row 20; no explicit line/range field provided
- Current classification: `info/later`
- Current status on `main`: Still active; CSV paths are stale and now correspond to `.gitignore` and `repo/scripts/validate-toolkit.cjs`.
- Evidence:
  - Current code reference: `.gitignore:19` through `.gitignore:23` ignore credential-looking JSON files and then re-include all `*.example.json`; `repo/scripts/validate-toolkit.cjs:385` exempts `.example.json` and `-example.json` from credential-looking JSON rejection.
  - Related PR, if any: PR #4 (`rehaul/project-modules-main`).
  - Test coverage, if any: No focused test currently proves credential-looking `*.example.json` outside the intended safe example path is rejected.
- Recommendation: Later PR should scope the unignore and validator exemption to intended safe example paths or fake-example naming conventions.
- Needs PR:
  - yes
  - If yes, proposed PR title: Narrow credential example JSON allowlist

### Finding 21: Import helper revalidates an unsupported prepared directory

- CSV severity: informational
- CSV file/path: `skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/import-n8n-workflows-live.ps1 | skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/validate-n8n-workflows.cjs`
- CSV line/range: CSV row 21; no explicit line/range field provided
- Current classification: `already-fixed`
- Current status on `main`: Fixed by PR #64.
- Evidence:
  - Current code reference: `skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/import-n8n-workflows-live.ps1:869` invokes `validate-n8n-workflows.cjs` with `--allow-prepared-dir`; `skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/validate-n8n-workflows.cjs:14` parses that flag; `skills/n8n-workflow-helper-scripts/templates/helper-scripts/import-export-sync/validate-n8n-workflows.cjs:91` only enforces the `n8n-workflows` basename when prepared dirs are not allowed.
  - Related PR, if any: PR #64 (`fix-n8n-prepared-import-validation`).
  - Test coverage, if any: `repo/tests/n8n-helper-scripts.test.cjs:390` covers strict rejection and explicit `--allow-prepared-dir` success; `repo/tests/n8n-helper-scripts.test.cjs:706` checks the import helper passes the flag after the `before-live-import` hook.
- Recommendation: No separate PR. Keep this in already-fixed notes.
- Needs PR:
  - no
  - If yes, proposed PR title: n/a

### Finding 22: Prepared workflow revalidation always aborts imports

- CSV severity: informational
- CSV file/path: `_projects/cicd/secure-installer/_main/templates/n8n/import-n8n-workflows-live.ps1 | _projects/cicd/secure-installer/_main/templates/n8n/validate-n8n-workflows.cjs`
- CSV line/range: CSV row 22; no explicit line/range field provided
- Current classification: `already-fixed`
- Current status on `main`: Fixed by PR #64 in the Secure CI/CD copied helper surface as well.
- Evidence:
  - Current code reference: `_projects/cicd/secure-installer/_main/templates/n8n/import-n8n-workflows-live.ps1:869` passes `--allow-prepared-dir`; `_projects/cicd/secure-installer/_main/templates/n8n/validate-n8n-workflows.cjs:14` parses that flag; `_projects/cicd/secure-installer/_main/templates/n8n/validate-n8n-workflows.cjs:91` keeps default strict basename validation when the flag is absent.
  - Related PR, if any: PR #64 (`fix-n8n-prepared-import-validation`).
  - Test coverage, if any: `repo/tests/n8n-helper-scripts.test.cjs:390` and `repo/tests/n8n-helper-scripts.test.cjs:706` cover the shared generated helper behavior.
- Recommendation: No separate PR. Keep this in already-fixed notes.
- Needs PR:
  - no
  - If yes, proposed PR title: n/a

### Finding 23: Stale source locks and generated n8n helper output

- CSV severity: informational
- CSV file/path: `_projects/cicd/secure-installer/SOURCE-LOCK.json | _projects/cicd/secure-installer/_main/templates/n8n/validate-n8n-workflows.cjs | for_ai/templates/n8n/sync-helpers/validate-n8n-workflows.cjs | repo/scripts/sync-toolkit-projects.cjs | repo/scripts/audit-project-source-locks.cjs`
- CSV line/range: CSV row 23; no explicit line/range field provided
- Current classification: `already-fixed`
- Current status on `main`: Fixed for the CSV's n8n helper/source-lock drift. The obsolete `for_ai/templates/n8n/sync-helpers/validate-n8n-workflows.cjs` path is absent, and source-lock audit passes on current `main`.
- Evidence:
  - Current code reference: `_projects/cicd/secure-installer/SOURCE-LOCK.json:48`, `_projects/cicd/secure-installer/SOURCE-LOCK.json:55`, and `_projects/cicd/secure-installer/SOURCE-LOCK.json:88` contain current helper blob pins/notes; `for_ai/templates/n8n/sync-helpers/validate-n8n-workflows.cjs` is not present on current `main`.
  - Related PR, if any: PR #64 (`fix-n8n-prepared-import-validation`) updated the prepared-import helper surfaces; the triage run also confirmed `node repo/scripts/audit-project-source-locks.cjs` passes.
  - Test coverage, if any: Source-lock validation tests in `repo/tests/validate-toolkit.test.cjs` cover missing blob pins and adapted-entry notes.
- Recommendation: No separate source-lock PR for this CSV finding. Note that the current `sync-toolkit-projects --check` command reports unrelated stale generated agent metadata, captured under validation.
- Needs PR:
  - no
  - If yes, proposed PR title: n/a

## Fix-now queue

No findings are classified `real/fix-now`. The CSV contains medium, low, and informational findings; none met the task's threshold for report-plus-immediate-fix in this pass.

## Active side-fix queue

- Finding 6: CMD wrappers allow PowerShell search-path hijacking. Current helper wrappers still invoke bare `powershell`; fold into the active helper-script side fix or split a focused helper-wrapper hardening PR.

## Already-fixed notes

- Finding 4 is stale because the cited root-surface skill-routing partial path is gone on current `main`; agent-rule partials now route through project `_main/_partials/` sources.
- Finding 13 is fixed for the main `Validate` workflow because `npm run validate:all` now includes `audit-published-surfaces.cjs --check`; Finding 5 tracks the residual npm-script trust issue.
- Finding 14 is fixed for the cited external `ai-cicd-installer` main-branch helper-fetch path; the prompt now points to the toolkit helper package instead.
- Findings 21 and 22 are fixed by PR #64, which added `--allow-prepared-dir` to prepared import revalidation and tests for that behavior.
- Finding 23 is fixed for the cited helper source-lock drift; current source-lock audit passes, and the obsolete `for_ai/templates/n8n/sync-helpers/validate-n8n-workflows.cjs` path is absent.

## Validation

- `npm run validate:all`: failed in `node repo/scripts/sync-toolkit-projects.cjs --check` because current `main` reports stale generated outputs for `skills/windows-localhost-workflows/agents/openai.yaml` and `skills/knowledge-index-updater/agents/openai.yaml`.
- `git diff --check`: passed.
- `git status --short`: showed only this untracked report file before staging.
