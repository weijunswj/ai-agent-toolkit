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

### repo/source-watch/provenance/google-design-md

- Source repo: `google-labs-code/design.md`
- Source ref: `main`
- Adopted commit: `679d3018869335b8ef7906b69fccfd4d48991d1b`
- Reviewed-through commit: `679d3018869335b8ef7906b69fccfd4d48991d1b`
- Latest observed commit: `db977b3c1d1f309269f43d5d17ae828d54bd6ae3`
- Why a new review is required: The latest observed upstream commit differs from the human-reviewed-through commit.
- Prior disposition: `NO_ACTION`
- Tracker at last review (history; find the current owner at triage): `#473`
- Update policy: `manual_review_required`
- Public attribution required: `true`

Tracked files:
- `adapted` `docs/spec.md` -> `skills/frontend-art-direction/references/design-md-contract.md` @ fc04f91a561fbde6be804c9d33defc285b09a976 - Adapted into a concise, Toolkit-local DESIGN.md contract reference for the UI/UX skill. The Toolkit does not vendor or execute upstream package tooling.
- `excluded` `LICENSE` -> `(excluded)` - Apache-2.0 license is summarized in the co-located Toolkit third-party notes; the full upstream license text is not vendored here.
- `excluded` `README.md` -> `(excluded)` - Reviewed for orientation and CLI references, but not copied. Toolkit guidance is re-authored locally and avoids upstream package or CLI execution.
- `excluded` `package.json` -> `(excluded)` - Excluded because Toolkit support is documentation/reference only and must not add the upstream package as a default dependency.
- `excluded` `packages/cli/package.json` -> `(excluded)` - Excluded because the Toolkit does not vendor, install, wrap, or execute the upstream CLI.
- `excluded` `bun.lock` -> `(excluded)` - Excluded because upstream package lockfiles and dependency state are outside the Toolkit local-only reference scope.

### repo/source-watch/provenance/ui-ux-pro-max

- Source repo: `nextlevelbuilder/ui-ux-pro-max-skill`
- Source ref: `main`
- Adopted commit: `0e8d408204fdc66b8189960dd28cc20d71db188e`
- Reviewed-through commit: `e59ff376a41f7ca47b7541ad5c116495cbade3ee`
- Latest observed commit: `f76d1653d7467fc11fb9d9d79295a421c92ab958`
- Why a new review is required: The latest observed upstream commit differs from the human-reviewed-through commit.
- Prior disposition: `NO_ACTION`
- Tracker at last review (history; find the current owner at triage): `#473`
- Update policy: `manual_review_required`
- Public attribution required: `true`

Tracked files:
- `exact` `src/ui-ux-pro-max/data/app-interface.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/app-interface.csv` @ 95e328c807a23be02c9c32c736d0fa19109c6076
- `exact` `src/ui-ux-pro-max/data/charts.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/charts.csv` @ c6f4f875fd5b34379f24dbb541539492366a1058
- `exact` `src/ui-ux-pro-max/data/colors.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/colors.csv` @ 5d2bf7389105f8a824b504b57cc93c00dc1d7e0a
- `exact` `src/ui-ux-pro-max/data/google-fonts.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/google-fonts.csv` @ d7f87e3e0159b1caba083b9954793d9852256aa0
- `exact` `src/ui-ux-pro-max/data/icons.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/icons.csv` @ cfc3f1eccd7e5aee15d8d70f86d8fa17ba737958
- `exact` `src/ui-ux-pro-max/data/landing.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/landing.csv` @ 34858160aa2789c49dca274d48bb116d51dd3f0a
- `exact` `src/ui-ux-pro-max/data/products.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/products.csv` @ f5f747335cdc631359ed6705ede2906e93d41b19
- `exact` `src/ui-ux-pro-max/data/react-performance.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/react-performance.csv` @ 425a8e76c6b3bae40e8c633ffbf7ad6222c9f73a
- `exact` `src/ui-ux-pro-max/data/stacks/angular.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/stacks/angular.csv` @ 5a1878dbee2b3c55c6468cbb18699b84d1a8c4d2
- `exact` `src/ui-ux-pro-max/data/stacks/astro.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/stacks/astro.csv` @ 1fd2492420b20a0b311295ab883597fadb8245a6
- `exact` `src/ui-ux-pro-max/data/stacks/flutter.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/stacks/flutter.csv` @ 731805c4076bd9f2755ca4bd7def5be6f6df7e9c
- `exact` `src/ui-ux-pro-max/data/stacks/html-tailwind.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/stacks/html-tailwind.csv` @ 9089eb0fc821ff0c8d135f8ee503be345e8fcb84
- `exact` `src/ui-ux-pro-max/data/stacks/jetpack-compose.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/stacks/jetpack-compose.csv` @ 8daa0b8f9a2ca3f0f1711664d9d677cd1c38dd9e
- `exact` `src/ui-ux-pro-max/data/stacks/laravel.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/stacks/laravel.csv` @ ed11b0fba457e02857f996d1542fb0b8e1271756
- `exact` `src/ui-ux-pro-max/data/stacks/nextjs.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/stacks/nextjs.csv` @ acdaf097dff26ba0d3b22ab4544bf6169c87afd4
- `exact` `src/ui-ux-pro-max/data/stacks/nuxt-ui.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/stacks/nuxt-ui.csv` @ f6b8000e106aaf421a61da45134e35c8f03e18c6
- `exact` `src/ui-ux-pro-max/data/stacks/nuxtjs.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/stacks/nuxtjs.csv` @ ceab9cf3358d2788af0bd7dc14cb3fab769740d0
- `exact` `src/ui-ux-pro-max/data/stacks/react-native.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/stacks/react-native.csv` @ a5aea45dc1d0341b11ee42076a86db842d4d2a19
- `exact` `src/ui-ux-pro-max/data/stacks/react.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/stacks/react.csv` @ fe8f001e695a978733449e04e99d7135af0f1bf3
- `exact` `src/ui-ux-pro-max/data/stacks/shadcn.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/stacks/shadcn.csv` @ 0e8bedf3084e7a40d6310bcd3011c437efcb1700
- `exact` `src/ui-ux-pro-max/data/stacks/svelte.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/stacks/svelte.csv` @ 51684fe70448e15333cd16207db7da8aea0508e6
- `exact` `src/ui-ux-pro-max/data/stacks/swiftui.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/stacks/swiftui.csv` @ ea9b95e8922e663b2adf27a7346e2c2f44c7a215
- `exact` `src/ui-ux-pro-max/data/stacks/threejs.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/stacks/threejs.csv` @ f62286320038beabbdc5e11e07ca2818d8e959a4
- `exact` `src/ui-ux-pro-max/data/stacks/vue.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/stacks/vue.csv` @ 83997c515775170f22b638635aae0a67a46dfc87
- `exact` `src/ui-ux-pro-max/data/styles.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/styles.csv` @ 7ed18d6ef06557b9a6f2285b87b458fd71e4722f
- `exact` `src/ui-ux-pro-max/data/typography.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/typography.csv` @ 70d107d107de30150863c965767320ec33ef29ad
- `exact` `src/ui-ux-pro-max/data/ui-reasoning.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/ui-reasoning.csv` @ 8931d4c809f8e22ddac00ce612ce0c35f34a59b6
- `exact` `src/ui-ux-pro-max/data/ux-guidelines.csv` -> `skills/frontend-art-direction/tools/design-system-generator/data/ux-guidelines.csv` @ b81d5a2ff845e348af60f96262b67f941b8f506f
- `adapted` `src/ui-ux-pro-max/scripts/core.py` -> `skills/frontend-art-direction/tools/design-system-generator/scripts/core.py` @ 02a3eee65462772dda9e0e56ae1dc1531b68c85a - Adapted for toolkit local-only safety boundaries and AI-facing tool data layout.
- `adapted` `src/ui-ux-pro-max/scripts/design_system.py` -> `skills/frontend-art-direction/tools/design-system-generator/scripts/design_system.py` @ d5fe1575f00d839f919603bd09b44fe7e9def4fb - Adapted for toolkit local-only safety boundaries and AI-facing tool data layout.
- `excluded` `README.md` -> `(excluded)` - Excluded from the toolkit local-only subset.
- `excluded` `src/ui-ux-pro-max/data/catalog-summary.json` -> `(excluded)` - Not adopted: new upstream file listed by refresh-source-lock. Adopt it in a reviewed pull request if the Toolkit needs it.
- `excluded` `src/ui-ux-pro-max/data/data-provenance.json` -> `(excluded)` - Not adopted: new upstream file listed by refresh-source-lock. Adopt it in a reviewed pull request if the Toolkit needs it.
- `excluded` `src/ui-ux-pro-max/data/google-font-licenses.json` -> `(excluded)` - Not adopted: new upstream file listed by refresh-source-lock. Adopt it in a reviewed pull request if the Toolkit needs it.
- `excluded` `src/ui-ux-pro-max/data/motion.csv` -> `(excluded)` - Not adopted: new upstream file listed by refresh-source-lock. Adopt it in a reviewed pull request if the Toolkit needs it.
- `excluded` `src/ui-ux-pro-max/data/phosphor-icons-upstream.json` -> `(excluded)` - Not adopted: new upstream file listed by refresh-source-lock. Adopt it in a reviewed pull request if the Toolkit needs it.
- `excluded` `src/ui-ux-pro-max/data/stacks/avalonia.csv` -> `(excluded)` - Not adopted: new upstream file listed by refresh-source-lock. Adopt it in a reviewed pull request if the Toolkit needs it.
- `excluded` `src/ui-ux-pro-max/data/stacks/javafx.csv` -> `(excluded)` - Not adopted: new upstream file listed by refresh-source-lock. Adopt it in a reviewed pull request if the Toolkit needs it.
- `excluded` `src/ui-ux-pro-max/data/stacks/uno.csv` -> `(excluded)` - Not adopted: new upstream file listed by refresh-source-lock. Adopt it in a reviewed pull request if the Toolkit needs it.
- `excluded` `src/ui-ux-pro-max/data/stacks/uwp.csv` -> `(excluded)` - Not adopted: new upstream file listed by refresh-source-lock. Adopt it in a reviewed pull request if the Toolkit needs it.
- `excluded` `src/ui-ux-pro-max/data/stacks/winui.csv` -> `(excluded)` - Not adopted: new upstream file listed by refresh-source-lock. Adopt it in a reviewed pull request if the Toolkit needs it.
- `excluded` `src/ui-ux-pro-max/data/stacks/wpf.csv` -> `(excluded)` - Not adopted: new upstream file listed by refresh-source-lock. Adopt it in a reviewed pull request if the Toolkit needs it.
- `excluded` `src/ui-ux-pro-max/scripts/reasoning_contract.py` -> `(excluded)` - Not adopted: new upstream file listed by refresh-source-lock. Adopt it in a reviewed pull request if the Toolkit needs it.
- `excluded` `src/ui-ux-pro-max/scripts/search.py` -> `(excluded)` - Not adopted: new upstream file listed by refresh-source-lock. Adopt it in a reviewed pull request if the Toolkit needs it.
- `excluded` `src/ui-ux-pro-max/scripts/validate_data.py` -> `(excluded)` - Not adopted: new upstream file listed by refresh-source-lock. Adopt it in a reviewed pull request if the Toolkit needs it.

## Advisory Actions Requiring Review

No actionable advisory targets require review.
