# Active Source Watch Review

PR needed: yes

This PR is a review notification only.
No source files or advisory tracking documents were updated.
No review-state cursors were changed.
No SOURCE-LOCK pins or advisory baselines were changed.
No SOURCE-LOCK pins were changed.
No toolkit rules, skills, hooks, repo-map guidance, or cleanup guidance were modified or deleted.
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

### repo/source-watch/provenance/ui-ux-pro-max

- Source repo: `nextlevelbuilder/ui-ux-pro-max-skill`
- Source ref: `main`
- Adopted commit: `10d6ca310541d3ffeee6dceda0a29e373796f321`
- Reviewed-through commit: `d14efff8ed1faa4187f004f79926f428c8074ec7`
- Latest observed commit: `9a3f14f7423037ccb8feeb4fee7482291b9c820e`
- Why a new review is required: The latest observed upstream commit differs from the human-reviewed-through commit.
- Prior disposition: `NO_ACTION`
- Tracker at last review (history; find the current owner at triage): `#473`
- Update policy: `manual_review_required`
- Public attribution required: `true`

Tracked files:
- `excluded` `package.json` -> `(excluded)` - Excluded from the toolkit local-only subset.
- `exact` `src/ui-ux-pro-max/data/app-interface.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/app-interface.csv` @ 28278d29b2aa005beb8a0566c64bcf84490d5e6c
- `exact` `src/ui-ux-pro-max/data/charts.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/charts.csv` @ c27b726c1162aa79d93f46ef039523666be44187
- `exact` `src/ui-ux-pro-max/data/colors.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/colors.csv` @ 7b2b0672037001ef08f1686f3d1f1c87e14a71c1
- `exact` `src/ui-ux-pro-max/data/google-fonts.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/google-fonts.csv` @ 45ece9ea26e9df5405b987270067cb88dab79f67
- `exact` `src/ui-ux-pro-max/data/icons.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/icons.csv` @ 6e5c245cef2014e05987aa1360ae80f75bbb1adc
- `exact` `src/ui-ux-pro-max/data/landing.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/landing.csv` @ f64101ec49882e68b0555da56e328187fd2f9a8c
- `exact` `src/ui-ux-pro-max/data/products.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/products.csv` @ 17826b856edc5e26b6244d06e48e481f74418810
- `exact` `src/ui-ux-pro-max/data/react-performance.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/react-performance.csv` @ 7d7e3f5d7fcf8ba9a224985abdf33a9fd69fdaf3
- `exact` `src/ui-ux-pro-max/data/stacks/angular.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/stacks/angular.csv` @ a29004540d42fe6bf9e1426d51f1b032fc005139
- `exact` `src/ui-ux-pro-max/data/stacks/astro.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/stacks/astro.csv` @ fda333d8e6cdd307919ceeed8f85d832885b05f2
- `exact` `src/ui-ux-pro-max/data/stacks/flutter.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/stacks/flutter.csv` @ 2e32c6a29bf8e4ceeb61e92e33193adbe1219a75
- `exact` `src/ui-ux-pro-max/data/stacks/html-tailwind.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/stacks/html-tailwind.csv` @ 0efe300f3c0d0fd2de3e07c90b38c08b44b5bbeb
- `exact` `src/ui-ux-pro-max/data/stacks/jetpack-compose.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/stacks/jetpack-compose.csv` @ 039553320ba6ab3d0ef6ea4f426c47c4b8296686
- `exact` `src/ui-ux-pro-max/data/stacks/laravel.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/stacks/laravel.csv` @ 99890000a1ab5f28d05abf72e1ec3a98019c6429
- `exact` `src/ui-ux-pro-max/data/stacks/nextjs.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/stacks/nextjs.csv` @ 6e9bea577c8c9294113d741b3f8dd3e6b1770b1c
- `exact` `src/ui-ux-pro-max/data/stacks/nuxt-ui.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/stacks/nuxt-ui.csv` @ d35728bd1553cf5febca4724e162422ed84a23a0
- `exact` `src/ui-ux-pro-max/data/stacks/nuxtjs.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/stacks/nuxtjs.csv` @ 1f1ec3555b04a093f7cf8a44b7a247cb175073cd
- `exact` `src/ui-ux-pro-max/data/stacks/react-native.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/stacks/react-native.csv` @ 209e893c3b2441813add061270009d9b6fe3e512
- `exact` `src/ui-ux-pro-max/data/stacks/react.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/stacks/react.csv` @ ff08ee203acc0ea69a2444c8420e5a80dd07a0e2
- `exact` `src/ui-ux-pro-max/data/stacks/shadcn.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/stacks/shadcn.csv` @ 61aeaa24ddaf4b7ad2c6b1eb7f5a31da9c88ae83
- `exact` `src/ui-ux-pro-max/data/stacks/svelte.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/stacks/svelte.csv` @ 1c6b4562d5d1c4ca98ad70959367ffcd68df5611
- `exact` `src/ui-ux-pro-max/data/stacks/swiftui.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/stacks/swiftui.csv` @ e20f9f90e11d61b92ce39b05a672f2a660aa48ec
- `exact` `src/ui-ux-pro-max/data/stacks/threejs.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/stacks/threejs.csv` @ f4e759b54151f3c2ed0c22ab8570217bbaea6407
- `exact` `src/ui-ux-pro-max/data/stacks/vue.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/stacks/vue.csv` @ 77cb4b06fd179153ec5a8d11e2b35f8f79522183
- `exact` `src/ui-ux-pro-max/data/styles.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/styles.csv` @ 8bacc703fadb0165b0a2b746ca78c80513e0d5b0
- `exact` `src/ui-ux-pro-max/data/typography.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/typography.csv` @ 7a1893794804be2d4a9b1347ebd2a8df3e79c66e
- `exact` `src/ui-ux-pro-max/data/ui-reasoning.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/ui-reasoning.csv` @ 8b6ca2fb256e13ff2a0a9dd150f34e1bc2ec8e25
- `exact` `src/ui-ux-pro-max/data/ux-guidelines.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/ux-guidelines.csv` @ e347aeda7401aac08879a7b11c3907782c7bcadb
- `adapted` `src/ui-ux-pro-max/scripts/core.py` -> `skills/frontend-art-direction/tools/design-system-generator/scripts/core.py` @ 2480a8bc8a98665dc39da3022db843320ba86201 - Adapted for toolkit local-only safety boundaries and AI-facing tool data layout.
- `adapted` `src/ui-ux-pro-max/scripts/design_system.py` -> `skills/frontend-art-direction/tools/design-system-generator/scripts/design_system.py` @ 512a808c4ed44d2ddc5f583b40bba3e78e3afb46 - Adapted for toolkit local-only safety boundaries and AI-facing tool data layout.
- `excluded` `pyproject.toml` -> `(excluded)` - Excluded from the toolkit local-only subset.
- `excluded` `README.md` -> `(excluded)` - Excluded from the toolkit local-only subset.
- `excluded` `src/ui-ux-pro-max/data/_sync_all.py` -> `(excluded)` - Excluded from the toolkit local-only subset.
- `excluded` `src/ui-ux-pro-max/data/design.csv` -> `(excluded)` - Excluded from the toolkit local-only subset.
- `excluded` `src/ui-ux-pro-max/data/draft.csv` -> `(excluded)` - Excluded from the toolkit local-only subset.

## Advisory Actions Requiring Review

No actionable advisory targets require review.
