# Active Source Watch Review

PR needed: yes

This PR is a review notification only.
No source files or advisory tracking documents were updated.
No SOURCE-LOCK pins or advisory baselines were changed.
No SOURCE-LOCK pins were changed.
No toolkit rules, skills, hooks, memory guidance, repo-map guidance, or cleanup guidance were modified or deleted.
No upstream code was executed.
No auto-merge is allowed.
A human must review upstream changes, attribution/licence impact, allowlist scope, advisory recommendations, and host-harness drift evidence, then ask an AI agent to inspect before any real edits happen.

Advisory actions, when present, are read from `repo/source-watch/advisory-targets.json`.
No advisory tracking document was changed by this workflow.
If advisory action is taken, update the advisory document in a separate human-reviewed PR.
If meaningful host-harness drift is found, open a separate PR with evidence, rationale, exact proposed modifications, and validation.

## Manual Review Checklist

- [ ] Review upstream diff manually.
- [ ] Confirm changed files are within allowlist.
- [ ] Confirm attribution/licence notes still apply.
- [ ] Confirm no upstream code was executed.
- [ ] Decide whether a separate update PR should copy/adapt files.
- [ ] For Host Harness Capability Drift Review, classify affected toolkit components using the linked template before proposing changes.
- [ ] Confirm any shrink, move, host-native, or delete recommendation is implemented only in a separate evidence-backed PR.
- [ ] If advisory action is taken, update the advisory document in a separate human-reviewed PR.
- [ ] Run npm run validate:all before any real source update merge.

## Active Third-Party Updates

### _projects/design/google-design-md

- Source repo: `google-labs-code/design.md`
- Source ref: `main`
- Locked commit: `ea4a3240d4c0d06778b9e39efeb553851be27c17`
- Latest commit: `2513a54eca0dc414b7881d48aaa44353397e0c88`
- Update policy: `manual_review_required`
- Public attribution required: `true`

Tracked files:
- `adapted` `docs/spec.md` -> `_projects/design/google-design-md/_main/design-md-contract.md` @ 41b6d085316409cfbdb44c3b7c47534230d69f54 - Adapted into a concise, Toolkit-local DESIGN.md contract reference for the UI/UX skill. The Toolkit does not vendor or execute upstream package tooling.
- `adapted` `docs/spec.md` -> `skills/ui-ux-secure-frontend-design/references/design-md-contract.md` @ 41b6d085316409cfbdb44c3b7c47534230d69f54 - AI-facing shared-surface reference generated from the Toolkit-local adapted source document.
- `adapted` `LICENSE` -> `_projects/design/google-design-md/LICENSE-THIRD-PARTY-NOTES.md` @ 15e431c225cf463f87a61f4e2a76dfb09e2bf849 - Apache-2.0 license summarized in Toolkit third-party notes; the full upstream license text is not vendored here.
- `excluded` `README.md` -> `(excluded)` - Reviewed for orientation and CLI references, but not copied. Toolkit guidance is re-authored locally and avoids upstream package or CLI execution.
- `excluded` `package.json` -> `(excluded)` - Excluded because Toolkit support is documentation/reference only and must not add the upstream package as a default dependency.
- `excluded` `packages/cli/package.json` -> `(excluded)` - Excluded because the Toolkit does not vendor, install, wrap, or execute the upstream CLI.
- `excluded` `bun.lock` -> `(excluded)` - Excluded because upstream package lockfiles and dependency state are outside the Toolkit local-only reference scope.

### _projects/design/ui-ux-pro-max

- Source repo: `nextlevelbuilder/ui-ux-pro-max-skill`
- Source ref: `main`
- Locked commit: `10d6ca310541d3ffeee6dceda0a29e373796f321`
- Latest commit: `1307d97a72e6c1cda572cb65471ae5ce82995218`
- Update policy: `manual_review_required`
- Public attribution required: `true`

Tracked files:
- `excluded` `package.json` -> `(excluded)` - Excluded from the toolkit local-only subset.
- `exact` `src/ui-ux-pro-max/data/app-interface.csv` -> `_projects/design/ui-ux-pro-max/_main/src/ui-ux-pro-max/data/app-interface.csv` @ 28278d29b2aa005beb8a0566c64bcf84490d5e6c
- `exact` `src/ui-ux-pro-max/data/charts.csv` -> `_projects/design/ui-ux-pro-max/_main/src/ui-ux-pro-max/data/charts.csv` @ c27b726c1162aa79d93f46ef039523666be44187
- `exact` `src/ui-ux-pro-max/data/colors.csv` -> `_projects/design/ui-ux-pro-max/_main/src/ui-ux-pro-max/data/colors.csv` @ 7b2b0672037001ef08f1686f3d1f1c87e14a71c1
- `exact` `src/ui-ux-pro-max/data/google-fonts.csv` -> `_projects/design/ui-ux-pro-max/_main/src/ui-ux-pro-max/data/google-fonts.csv` @ 45ece9ea26e9df5405b987270067cb88dab79f67
- `exact` `src/ui-ux-pro-max/data/icons.csv` -> `_projects/design/ui-ux-pro-max/_main/src/ui-ux-pro-max/data/icons.csv` @ 6e5c245cef2014e05987aa1360ae80f75bbb1adc
- `exact` `src/ui-ux-pro-max/data/landing.csv` -> `_projects/design/ui-ux-pro-max/_main/src/ui-ux-pro-max/data/landing.csv` @ f64101ec49882e68b0555da56e328187fd2f9a8c
- `exact` `src/ui-ux-pro-max/data/products.csv` -> `_projects/design/ui-ux-pro-max/_main/src/ui-ux-pro-max/data/products.csv` @ 17826b856edc5e26b6244d06e48e481f74418810
- `exact` `src/ui-ux-pro-max/data/react-performance.csv` -> `_projects/design/ui-ux-pro-max/_main/src/ui-ux-pro-max/data/react-performance.csv` @ 7d7e3f5d7fcf8ba9a224985abdf33a9fd69fdaf3
- `exact` `src/ui-ux-pro-max/data/stacks/angular.csv` -> `_projects/design/ui-ux-pro-max/_main/src/ui-ux-pro-max/data/stacks/angular.csv` @ a29004540d42fe6bf9e1426d51f1b032fc005139
- `exact` `src/ui-ux-pro-max/data/stacks/astro.csv` -> `_projects/design/ui-ux-pro-max/_main/src/ui-ux-pro-max/data/stacks/astro.csv` @ fda333d8e6cdd307919ceeed8f85d832885b05f2
- `exact` `src/ui-ux-pro-max/data/stacks/flutter.csv` -> `_projects/design/ui-ux-pro-max/_main/src/ui-ux-pro-max/data/stacks/flutter.csv` @ 2e32c6a29bf8e4ceeb61e92e33193adbe1219a75
- `exact` `src/ui-ux-pro-max/data/stacks/html-tailwind.csv` -> `_projects/design/ui-ux-pro-max/_main/src/ui-ux-pro-max/data/stacks/html-tailwind.csv` @ 0efe300f3c0d0fd2de3e07c90b38c08b44b5bbeb
- `exact` `src/ui-ux-pro-max/data/stacks/jetpack-compose.csv` -> `_projects/design/ui-ux-pro-max/_main/src/ui-ux-pro-max/data/stacks/jetpack-compose.csv` @ 039553320ba6ab3d0ef6ea4f426c47c4b8296686
- `exact` `src/ui-ux-pro-max/data/stacks/laravel.csv` -> `_projects/design/ui-ux-pro-max/_main/src/ui-ux-pro-max/data/stacks/laravel.csv` @ 99890000a1ab5f28d05abf72e1ec3a98019c6429
- `exact` `src/ui-ux-pro-max/data/stacks/nextjs.csv` -> `_projects/design/ui-ux-pro-max/_main/src/ui-ux-pro-max/data/stacks/nextjs.csv` @ 6e9bea577c8c9294113d741b3f8dd3e6b1770b1c
- `exact` `src/ui-ux-pro-max/data/stacks/nuxt-ui.csv` -> `_projects/design/ui-ux-pro-max/_main/src/ui-ux-pro-max/data/stacks/nuxt-ui.csv` @ d35728bd1553cf5febca4724e162422ed84a23a0
- `exact` `src/ui-ux-pro-max/data/stacks/nuxtjs.csv` -> `_projects/design/ui-ux-pro-max/_main/src/ui-ux-pro-max/data/stacks/nuxtjs.csv` @ 1f1ec3555b04a093f7cf8a44b7a247cb175073cd
- `exact` `src/ui-ux-pro-max/data/stacks/react-native.csv` -> `_projects/design/ui-ux-pro-max/_main/src/ui-ux-pro-max/data/stacks/react-native.csv` @ 209e893c3b2441813add061270009d9b6fe3e512
- `exact` `src/ui-ux-pro-max/data/stacks/react.csv` -> `_projects/design/ui-ux-pro-max/_main/src/ui-ux-pro-max/data/stacks/react.csv` @ ff08ee203acc0ea69a2444c8420e5a80dd07a0e2
- `exact` `src/ui-ux-pro-max/data/stacks/shadcn.csv` -> `_projects/design/ui-ux-pro-max/_main/src/ui-ux-pro-max/data/stacks/shadcn.csv` @ 61aeaa24ddaf4b7ad2c6b1eb7f5a31da9c88ae83
- `exact` `src/ui-ux-pro-max/data/stacks/svelte.csv` -> `_projects/design/ui-ux-pro-max/_main/src/ui-ux-pro-max/data/stacks/svelte.csv` @ 1c6b4562d5d1c4ca98ad70959367ffcd68df5611
- `exact` `src/ui-ux-pro-max/data/stacks/swiftui.csv` -> `_projects/design/ui-ux-pro-max/_main/src/ui-ux-pro-max/data/stacks/swiftui.csv` @ e20f9f90e11d61b92ce39b05a672f2a660aa48ec
- `exact` `src/ui-ux-pro-max/data/stacks/threejs.csv` -> `_projects/design/ui-ux-pro-max/_main/src/ui-ux-pro-max/data/stacks/threejs.csv` @ f4e759b54151f3c2ed0c22ab8570217bbaea6407
- `exact` `src/ui-ux-pro-max/data/stacks/vue.csv` -> `_projects/design/ui-ux-pro-max/_main/src/ui-ux-pro-max/data/stacks/vue.csv` @ 77cb4b06fd179153ec5a8d11e2b35f8f79522183
- `exact` `src/ui-ux-pro-max/data/styles.csv` -> `_projects/design/ui-ux-pro-max/_main/src/ui-ux-pro-max/data/styles.csv` @ 8bacc703fadb0165b0a2b746ca78c80513e0d5b0
- `exact` `src/ui-ux-pro-max/data/typography.csv` -> `_projects/design/ui-ux-pro-max/_main/src/ui-ux-pro-max/data/typography.csv` @ 7a1893794804be2d4a9b1347ebd2a8df3e79c66e
- `exact` `src/ui-ux-pro-max/data/ui-reasoning.csv` -> `_projects/design/ui-ux-pro-max/_main/src/ui-ux-pro-max/data/ui-reasoning.csv` @ 8b6ca2fb256e13ff2a0a9dd150f34e1bc2ec8e25
- `exact` `src/ui-ux-pro-max/data/ux-guidelines.csv` -> `_projects/design/ui-ux-pro-max/_main/src/ui-ux-pro-max/data/ux-guidelines.csv` @ e347aeda7401aac08879a7b11c3907782c7bcadb
- `adapted` `src/ui-ux-pro-max/scripts/core.py` -> `_projects/design/ui-ux-pro-max/_main/src/ui-ux-pro-max/scripts/core.py` @ 2480a8bc8a98665dc39da3022db843320ba86201 - Adapted for toolkit local-only safety boundaries and AI-facing tool data layout.
- `adapted` `src/ui-ux-pro-max/scripts/design_system.py` -> `_projects/design/ui-ux-pro-max/_main/src/ui-ux-pro-max/scripts/design_system.py` @ 512a808c4ed44d2ddc5f583b40bba3e78e3afb46 - Adapted for toolkit local-only safety boundaries and AI-facing tool data layout.
- `adapted` `src/ui-ux-pro-max/scripts/core.py` -> `skills/ui-ux-secure-frontend-design/tools/design-system-generator/scripts/core.py` @ 2480a8bc8a98665dc39da3022db843320ba86201 - AI-facing tool uses the toolkit-adapted local-only script from _main.
- `adapted` `src/ui-ux-pro-max/scripts/design_system.py` -> `skills/ui-ux-secure-frontend-design/tools/design-system-generator/scripts/design_system.py` @ 512a808c4ed44d2ddc5f583b40bba3e78e3afb46 - AI-facing tool uses the toolkit-adapted local-only script from _main.
- `excluded` `pyproject.toml` -> `(excluded)` - Excluded from the toolkit local-only subset.
- `excluded` `README.md` -> `(excluded)` - Excluded from the toolkit local-only subset.
- `excluded` `src/ui-ux-pro-max/data/_sync_all.py` -> `(excluded)` - Excluded from the toolkit local-only subset.
- `excluded` `src/ui-ux-pro-max/data/design.csv` -> `(excluded)` - Excluded from the toolkit local-only subset.
- `excluded` `src/ui-ux-pro-max/data/draft.csv` -> `(excluded)` - Excluded from the toolkit local-only subset.

## Advisory Actions Requiring Review

Advisory target document: `repo/source-watch/advisory-targets.json`.
Update `repo/source-watch/advisory-targets.json` when advisory action is taken. Record the recommendation, action taken, remaining work, and removal condition. For periodic manual reviews, record last_reviewed_at only in a separate human-reviewed PR. Remove a target once fully implemented and covered by normal SOURCE-LOCK source-watch, or once it is no longer relevant.

### Open Knowledge Format draft spec

- Target id: `okf-spec`
- Kind: `github_path`
- State: `watching`
- Repo: `GoogleCloudPlatform/knowledge-catalog`
- Ref: `main`
- Path: `okf/SPEC.md`
- Status: `Advisory baseline required`
- Baseline note: Initial advisory baseline must be set in a separate human-reviewed PR.
- Recommendation: Review draft spec changes only; do not copy spec text or change toolkit docs from the daily source-watch PR.
- Action taken: No toolkit implementation has been accepted yet.
- Remaining work: Decide whether any reviewed concept should become first-party toolkit documentation. If accepted, open a separate implementation PR and then either move future upstream tracking into SOURCE-LOCK or remove this advisory target.
- Removal condition: Remove after accepted OKF-derived toolkit work is implemented and any ongoing upstream dependency is represented by SOURCE-LOCK daily source-watch, or after deciding no action is needed.

### Ponytail decision ladder patterns

- Target id: `ponytail-decision-ladder`
- Kind: `github_repo`
- State: `watching`
- Repo: `DietrichGebert/ponytail`
- Ref: `main`
- Status: `Advisory baseline required`
- Baseline note: Initial advisory baseline must be set in a separate human-reviewed PR.
- Recommendation: Review concepts only; do not vendor hooks, plugins, dependencies, or upstream code from the daily source-watch PR.
- Action taken: No toolkit implementation has been accepted yet.
- Remaining work: Decide whether any reviewed decision-ladder concept belongs in toolkit planning or review guidance. If accepted, open a separate implementation PR and then either move future upstream tracking into SOURCE-LOCK or remove this advisory target.
- Removal condition: Remove after accepted Ponytail-inspired toolkit work is implemented and any ongoing upstream dependency is represented by SOURCE-LOCK daily source-watch, or after deciding no action is needed.

### Official n8n Skills Windows hook compatibility

- Target id: `n8n-skills-hook-compatibility`
- Kind: `github_repo`
- State: `watching`
- Repo: `n8n-io/skills`
- Ref: `main`
- Status: `Advisory update detected`
- Baseline commit: `c350f8b4bd8417108bce266d88e21b8a1bb966db`
- Latest commit: `eb18fc3ab3e2820c748c2d84386fb5496efc1516`
- Recommendation: Review upstream plugin identity, version, hooks/hooks.json, hook entrypoints, and Windows execution semantics only. Source-watch must not mutate installed caches or extend the compatibility contract.
- Action taken: Toolkit recognises the exact n8n-skills@n8n-io 1.0.1 hook layout at the baseline commit and may reapply its bounded Windows launcher transform through approved Codex plugin maintenance.
- Remaining work: When upstream differs, review the new version and hook layout under #248. If compatible support is justified, update fingerprints and fixtures in a separate human-reviewed implementation PR; otherwise retain fail-closed behavior.
- Removal condition: Remove only if official n8n Skills no longer needs Toolkit Windows hook compatibility or ongoing tracking moves to an active SOURCE-LOCK contract.

### Host Harness Capability Drift Review

- Target id: `host-harness-capability-drift-review`
- Kind: `manual`
- State: `watching`
- Status: `Periodic review due`
- Review cadence: `90 day(s)`
- Last reviewed: `never`
- Today: `2026-07-24`
- Due reason: No last_reviewed_at is recorded.
- Review template: `repo/source-watch/templates/host-harness-capability-drift-review.md`
- Evidence sources:
  - OpenAI Codex changelog: https://developers.openai.com/codex/changelog
  - OpenAI Codex AGENTS.md docs: https://developers.openai.com/codex/guides/agents-md
  - OpenAI Codex memories docs: https://developers.openai.com/codex/memories
  - OpenAI Codex hooks docs: https://developers.openai.com/codex/hooks
  - OpenAI Codex rules docs: https://developers.openai.com/codex/rules
  - Claude Code overview docs: https://code.claude.com/docs/en/overview
  - Claude Code memory and rules docs: https://code.claude.com/docs/en/memory
  - Claude Code hooks docs: https://code.claude.com/docs/en/hooks
  - Claude Code changelog: https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
- Toolkit scope:
  - skills/** and skill-routing guidance
  - AGENTS.md, CLAUDE.md, GEMINI.md, and .agents/rules/**
  - .codex-plugin/**, .claude-plugin/**, and hook guidance
  - repo-map and docs-index guidance
  - MEMORY.md guidance
  - documentation cleanup and token-saving/collapse guidance
- Classification options: Keep, Shrink, Move to hook, Move to host-native feature, Delete, Needs benchmark/eval before decision
- Recommendation: Run the template on cadence. Keep safety rules unless official host behavior demonstrably covers the same risk; propose shrink, move, host-native migration, or deletion only in a separate evidence-backed PR.
- Action taken: Review lane added. No toolkit component has been changed by source-watch.
- Remaining work: Perform the next cadence review using the template. If no meaningful drift is found, update last_reviewed_at and this status record only. If meaningful drift is found, open a separate PR with evidence, rationale, exact proposed modifications, and validation.
- Removal condition: Remove only if supported host harnesses stop changing relevant native capabilities or another maintained source-watch lane fully owns this review.
