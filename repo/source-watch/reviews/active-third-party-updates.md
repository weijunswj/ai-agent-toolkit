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
- Adopted commit: `9bf8eae67128b6cc55ad9bf86665767deb4c11cd`
- Reviewed-through commit: `9bf8eae67128b6cc55ad9bf86665767deb4c11cd`
- Latest observed commit: `6e5da5382f41edbba9d73b2c62f33f32e9971f15`
- Why a new review is required: The latest observed upstream commit differs from the human-reviewed-through commit.
- Prior disposition: `SEPARATE_IMPLEMENTATION_PR_RECOMMENDED`
- Owning tracker: `#322`
- Update policy: `manual_review_required`
- Public attribution required: `true`

Tracked files:
- `adapted` `docs/spec.md` -> `skills/frontend-art-direction/references/design-md-contract.md` @ 5995e5482fc338a9f9923d5912551241a82e6e8a - Adapted into a concise, Toolkit-local DESIGN.md contract reference for the UI/UX skill. The Toolkit does not vendor or execute upstream package tooling.
- `excluded` `LICENSE` -> `(excluded)` - Apache-2.0 license is summarized in the co-located Toolkit third-party notes; the full upstream license text is not vendored here.
- `excluded` `README.md` -> `(excluded)` - Reviewed for orientation and CLI references, but not copied. Toolkit guidance is re-authored locally and avoids upstream package or CLI execution.
- `excluded` `package.json` -> `(excluded)` - Excluded because Toolkit support is documentation/reference only and must not add the upstream package as a default dependency.
- `excluded` `packages/cli/package.json` -> `(excluded)` - Excluded because the Toolkit does not vendor, install, wrap, or execute the upstream CLI.
- `excluded` `bun.lock` -> `(excluded)` - Excluded because upstream package lockfiles and dependency state are outside the Toolkit local-only reference scope.

## Advisory Actions Requiring Review

Advisory target document: `repo/source-watch/advisory-targets.json`.
Update `repo/source-watch/advisory-targets.json` when advisory action is taken. Record the recommendation, action taken, remaining work, and removal condition. For periodic manual reviews, record last_reviewed_at only in a separate human-reviewed PR. Remove a target once fully implemented and covered by normal SOURCE-LOCK source-watch, or once it is no longer relevant.

### Host Harness Capability Drift Review

- Target id: `host-harness-capability-drift-review`
- Kind: `manual`
- State: `watching`
- Status: `Periodic review due`
- Review cadence: `90 day(s)`
- Last reviewed: `never`
- Due reason: No last_reviewed_at is recorded.
- Review template: `repo/source-watch/templates/host-harness-capability-drift-review.md`
- Evidence sources:
  - OpenAI Codex changelog: https://developers.openai.com/codex/changelog
  - OpenAI Codex AGENTS.md docs: https://developers.openai.com/codex/guides/agents-md
  - OpenAI Codex hooks docs: https://developers.openai.com/codex/hooks
  - OpenAI Codex rules docs: https://developers.openai.com/codex/rules
  - Claude Code overview docs: https://code.claude.com/docs/en/overview
  - Claude Code hooks docs: https://code.claude.com/docs/en/hooks
  - Claude Code changelog: https://github.com/anthropics/claude-code/blob/main/CHANGELOG.md
- Toolkit scope:
  - skills/** and skill-routing guidance
  - AGENTS.md, CLAUDE.md, and .agents/rules/**
  - .codex-plugin/**, .claude-plugin/**, and hook guidance
  - repo-map and docs-index guidance
  - documentation cleanup and token-saving/collapse guidance
- Classification options: Keep, Shrink, Move to hook, Move to host-native feature, Delete, Needs benchmark/eval before decision
- Recommendation: Run the template on cadence. Keep safety rules unless official host behavior demonstrably covers the same risk; propose shrink, move, host-native migration, or deletion only in a separate evidence-backed PR.
- Action taken: Review lane added. No toolkit component has been changed by source-watch.
- Remaining work: Perform the next cadence review using the template. If no meaningful drift is found, update last_reviewed_at and this status record only. If meaningful drift is found, open a separate PR with evidence, rationale, exact proposed modifications, and validation.
- Removal condition: Remove only if supported host harnesses stop changing relevant native capabilities or another maintained source-watch lane fully owns this review.
