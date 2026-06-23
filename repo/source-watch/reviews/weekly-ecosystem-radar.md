# Weekly Ecosystem Radar

PR needed: yes

This PR is a weekly ecosystem radar report only.
The scheduled workflow stages only `repo/source-watch/reviews/weekly-ecosystem-radar.md`.
No `_projects/**`, `SOURCE-LOCK.json`, generated `skills/**`, advisory baselines, provider or deployment config, secrets, or application code were staged by the workflow.
No issues are created and no `issues: write` permission is requested.
No source pins were changed.
No SOURCE-LOCK pins were changed.
No advisory baselines were changed.
No upstream code was executed.
No upstream packages were installed.
No live deployment actions, provider calls, notification tests, or production mutations were run.
No auto-merge is allowed.
Advisory baseline advancement requires a separate human-approved PR.

Existing source-watch behavior is preserved; this radar reuses the same active SOURCE-LOCK discovery and latest-commit comparison helpers, and the legacy daily source-watch workflow remains unchanged.

## Manual Review Checklist

- [ ] Review source-lock drift manually before opening any source update PR.
- [ ] Confirm advisory target relevance before changing baselines.
- [ ] Keep source-pin and advisory-baseline changes in separate human-approved PRs.
- [ ] Confirm no upstream code or package installation was run.
- [ ] Confirm no live deployment, provider, notification, or production mutation occurred.

## Active Third-Party Source Pins

### _projects/design/ui-ux-pro-max

- Source repo: `nextlevelbuilder/ui-ux-pro-max-skill`
- Source ref: `main`
- Locked commit: `10d6ca310541d3ffeee6dceda0a29e373796f321`
- Latest commit: `1518fec29d19ce905cd0c689255137b9dcab7ccc`
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

## Advisory Targets

### Open Knowledge Format draft spec

- Target id: `okf-spec`
- Kind: `github_path`
- Repo: `GoogleCloudPlatform/knowledge-catalog`
- Ref: `main`
- Path: `okf/SPEC.md`
- Affects: `knowledge format review`, `future repo documentation convention`
- Status: `Advisory baseline required`
- Baseline note: Initial OKF advisory baseline must be set through a separate human-approved PR after reviewing the current spec.
- Recommended action: Review draft spec changes only; do not copy spec text or change toolkit docs from the scheduled radar.

### Ponytail decision ladder patterns

- Target id: `ponytail-decision-ladder`
- Kind: `github_repo`
- Repo: `DietrichGebert/ponytail`
- Ref: `main`
- Affects: `planning heuristics`, `agent review prompts`
- Status: `Advisory baseline required`
- Baseline note: Initial Ponytail advisory baseline must be set through a separate human-approved PR after reviewing the decision-ladder material.
- Recommended action: Review concepts only; do not vendor hooks, plugins, dependencies, or upstream code from the scheduled radar.
