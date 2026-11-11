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
- Reviewed-through commit: `6e5da5382f41edbba9d73b2c62f33f32e9971f15`
- Latest observed commit: `1ed38aa9dd4451b9039f9aeb9ed1d2579edafddf`
- Why a new review is required: The latest observed upstream commit differs from the human-reviewed-through commit.
- Prior disposition: `SEPARATE_IMPLEMENTATION_PR_RECOMMENDED`
- Tracker at last review (history; find the current owner at triage): `#473`
- Update policy: `manual_review_required`
- Public attribution required: `true`

Tracked files:
- `adapted` `docs/spec.md` -> `skills/frontend-art-direction/references/design-md-contract.md` @ 5995e5482fc338a9f9923d5912551241a82e6e8a - Adapted into a concise, Toolkit-local DESIGN.md contract reference for the UI/UX skill. The Toolkit does not vendor or execute upstream package tooling.
- `excluded` `LICENSE` -> `(excluded)` - Apache-2.0 license is summarized in the co-located Toolkit third-party notes; the full upstream license text is not vendored here.
- `excluded` `README.md` -> `(excluded)` - Reviewed for orientation and CLI references, but not copied. Toolkit guidance is re-authored locally and avoids upstream package or CLI execution.
- `excluded` `package.json` -> `(excluded)` - Excluded because Toolkit support is documentation/reference only and must not add the upstream package as a default dependency.
- `excluded` `packages/cli/package.json` -> `(excluded)` - Excluded because the Toolkit does not vendor, install, wrap, or execute the upstream CLI.
- `excluded` `bun.lock` -> `(excluded)` - Excluded because upstream package lockfiles and dependency state are outside the Toolkit local-only reference scope.

### repo/source-watch/provenance/n8n-io-skills

- Source repo: `n8n-io/skills`
- Source ref: `main`
- Adopted commit: `27b6b9f429ac0be90cae764512dbc579d7107e95`
- Reviewed-through commit: `27b6b9f429ac0be90cae764512dbc579d7107e95`
- Latest observed commit: `626f50fdf2934116eea2c5469339e03d2d524e83`
- Why a new review is required: The latest observed upstream commit differs from the human-reviewed-through commit.
- Prior disposition: `NO_ACTION`
- Tracker at last review (history; find the current owner at triage): `#473`
- Update policy: `manual_review_required`
- Public attribution required: `true`

Tracked files:
- `excluded` `.agents/plugins/marketplace.json` -> `(excluded)` - Codex marketplace wrapper. Excluded: skills only, no plugin.
- `excluded` `.claude-plugin/marketplace.json` -> `(excluded)` - Claude Code plugin wrapper. Excluded: Toolkit ships the skill folders only, never the plugin.
- `excluded` `.claude-plugin/plugin.json` -> `(excluded)` - Claude Code plugin wrapper. Excluded: Toolkit ships the skill folders only, never the plugin.
- `excluded` `.codex-plugin/plugin.json` -> `(excluded)` - Codex plugin wrapper. Excluded: skills only, no plugin.
- `excluded` `.gitignore` -> `(excluded)` - Upstream ignore rules. Excluded.
- `excluded` `CLAUDE.md` -> `(excluded)` - Upstream repository instructions for its own maintainers. Excluded.
- `excluded` `CONTRIBUTING.md` -> `(excluded)` - Upstream contribution guide. Excluded.
- `exact` `LICENSE` -> `repo/contracts/third-party/n8n-io-skills/LICENSE` @ c87e50b21d7195576cfda86509960d9f80a1d3bd - Apache-2.0 licence text, kept with the copied skills.
- `excluded` `README.md` -> `(excluded)` - Upstream readme, reviewed for install paths and hosts. Excluded; Toolkit docs describe the copy.
- `excluded` `hooks/hooks.json` -> `(excluded)` - Plugin hook scripts (.sh). Excluded: nothing from upstream runs on the user's computer.
- `excluded` `hooks/post-tool-use/validate-workflow.sh` -> `(excluded)` - Plugin hook scripts (.sh). Excluded: nothing from upstream runs on the user's computer.
- `excluded` `hooks/pre-tool-use/_emit.sh` -> `(excluded)` - Plugin hook scripts (.sh). Excluded: nothing from upstream runs on the user's computer.
- `excluded` `hooks/pre-tool-use/agent-build.sh` -> `(excluded)` - Plugin hook scripts (.sh). Excluded: nothing from upstream runs on the user's computer.
- `excluded` `hooks/pre-tool-use/create-workflow.sh` -> `(excluded)` - Plugin hook scripts (.sh). Excluded: nothing from upstream runs on the user's computer.
- `excluded` `hooks/pre-tool-use/execute-workflow.sh` -> `(excluded)` - Plugin hook scripts (.sh). Excluded: nothing from upstream runs on the user's computer.
- `excluded` `hooks/pre-tool-use/get-node.sh` -> `(excluded)` - Plugin hook scripts (.sh). Excluded: nothing from upstream runs on the user's computer.
- `excluded` `hooks/pre-tool-use/test-workflow.sh` -> `(excluded)` - Plugin hook scripts (.sh). Excluded: nothing from upstream runs on the user's computer.
- `excluded` `hooks/pre-tool-use/update-workflow.sh` -> `(excluded)` - Plugin hook scripts (.sh). Excluded: nothing from upstream runs on the user's computer.
- `excluded` `hooks/pre-tool-use/validate-workflow.sh` -> `(excluded)` - Plugin hook scripts (.sh). Excluded: nothing from upstream runs on the user's computer.
- `excluded` `hooks/session-start.sh` -> `(excluded)` - Plugin hook scripts (.sh). Excluded: nothing from upstream runs on the user's computer.
- `excluded` `opencode/README.md` -> `(excluded)` - OpenCode plugin wrapper. Excluded: OpenCode reads the Claude Code and Codex skill folders Toolkit fills.
- `excluded` `opencode/plugin.ts` -> `(excluded)` - OpenCode plugin wrapper. Excluded: OpenCode reads the Claude Code and Codex skill folders Toolkit fills.
- `excluded` `package.json` -> `(excluded)` - Package manifest. Excluded: no upstream package is installed.
- `exact` `skills/n8n-agents-official/SKILL.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-agents-official/SKILL.md` @ 2cc6bdd39ef5743ca2b107919424586247b6b73f - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-agents-official/references/APPROVALS.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-agents-official/references/APPROVALS.md` @ f8825a9bb4e1f46f9e40155dd7cd937764a61223 - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-agents-official/references/CHANNELS.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-agents-official/references/CHANNELS.md` @ 1b49ec2ca00d995a4c8622195421773c791c7084 - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-agents-official/references/CONFIG.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-agents-official/references/CONFIG.md` @ 4cf4c8aefefe6b319b9468661b83c1787d4c9cc8 - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-agents-official/references/KNOWLEDGE.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-agents-official/references/KNOWLEDGE.md` @ 65d37dd59ae41bf3bf621f71d685f5b7512323e3 - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-agents-official/references/MCP_BUILD.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-agents-official/references/MCP_BUILD.md` @ e90648cd240b7aab59540883fae5c61ea2beb402 - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-agents-official/references/MEMORY.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-agents-official/references/MEMORY.md` @ ac598014cb183e80cccae01e60f25fc80b20c5b4 - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-agents-official/references/MESSAGE_AN_AGENT.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-agents-official/references/MESSAGE_AN_AGENT.md` @ 9f11921f3d8f8f6fb867e5f75233c49a942678db - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-agents-official/references/SESSIONS_AND_DEBUGGING.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-agents-official/references/SESSIONS_AND_DEBUGGING.md` @ d4a274716d203d022a210c844e678482f50e143a - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-agents-official/references/SKILLS.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-agents-official/references/SKILLS.md` @ 0a938d79cf7149b96207e7b5764f3ca301a33d3b - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-agents-official/references/SUB_AGENTS.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-agents-official/references/SUB_AGENTS.md` @ 2ff2fe78b3b4e0c4e44853f2357e7080b8a88699 - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-agents-official/references/TASKS.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-agents-official/references/TASKS.md` @ 6f9b6459181aa73f34c7fee946026eec0eaa7f58 - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-agents-official/references/TOOLS.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-agents-official/references/TOOLS.md` @ 9a992277ef3f2214abdfef75cb0ea5b0872d35a7 - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-ai-nodes-official/SKILL.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-ai-nodes-official/SKILL.md` @ 3bca21ce9371ae1537ad57b07907c5ec1c67ab66 - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-ai-nodes-official/references/CHAT_SURFACE_PATTERNS.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-ai-nodes-official/references/CHAT_SURFACE_PATTERNS.md` @ ff56fb4b96aef81194a2a34be9c51c0d9e1ee364 - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-ai-nodes-official/references/HUMAN_REVIEW.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-ai-nodes-official/references/HUMAN_REVIEW.md` @ 06d71d1cd1a510f1a01b1d18ba0724ccaab27359 - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-ai-nodes-official/references/MEMORY.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-ai-nodes-official/references/MEMORY.md` @ d1df6701bc629d1bd2e98724b7c4d6a4c5e58961 - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-ai-nodes-official/references/RAG.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-ai-nodes-official/references/RAG.md` @ b2ead11f6a49f5ee3955e1ce90df93e62b693b4f - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-ai-nodes-official/references/STRUCTURED_OUTPUT.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-ai-nodes-official/references/STRUCTURED_OUTPUT.md` @ 95c84e0556bb67312c14b86d60a2cd1ff152f652 - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-ai-nodes-official/references/SUBWORKFLOW_AS_TOOL.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-ai-nodes-official/references/SUBWORKFLOW_AS_TOOL.md` @ 0b890cc44ef3f83616c6c4768fb080bafc6b7437 - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-ai-nodes-official/references/SYSTEM_PROMPT.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-ai-nodes-official/references/SYSTEM_PROMPT.md` @ 9afc08dfe55fee956eeb460155ccd96e52f923e1 - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-ai-nodes-official/references/TOOLS.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-ai-nodes-official/references/TOOLS.md` @ 0a2d2493e24062a593e852adaa1f93777873b8a4 - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-ai-nodes-official/references/examples/agent-core.json` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-ai-nodes-official/references/examples/agent-core.json` @ 9038b54c5f1d7281c97172863c71d43ba4e9a7a1 - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-ai-nodes-official/references/examples/notion-ideas-subagent.json` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-ai-nodes-official/references/examples/notion-ideas-subagent.json` @ df13734941f43a4e39f2ad72e381ad7f612c2a4f - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-ai-nodes-official/references/examples/slack-router.json` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-ai-nodes-official/references/examples/slack-router.json` @ 3e44e1f110c4d68a0f08b00930c9e084adbd8e17 - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-binary-and-data-official/SKILL.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-binary-and-data-official/SKILL.md` @ 76cb0016fec245ac88c83ceda1f03b5528c628e1 - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-binary-and-data-official/references/AGENT_TOOL_BINARY.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-binary-and-data-official/references/AGENT_TOOL_BINARY.md` @ 31d5c41ce1686ff8c0e195c8491c48b0b34759a3 - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-binary-and-data-official/references/BINARY_BASICS.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-binary-and-data-official/references/BINARY_BASICS.md` @ d80b902ad506f71c5a8397c7d79c3fb4ffa4d3ad - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-binary-and-data-official/references/CDN_REQUIREMENT.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-binary-and-data-official/references/CDN_REQUIREMENT.md` @ 3270d8cf70d2e5c0de744f204c7328d55eaa41d5 - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-binary-and-data-official/references/MERGE_FOR_CONTEXT.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-binary-and-data-official/references/MERGE_FOR_CONTEXT.md` @ 592e9cf00d195e91ef54c79c3d226a3e4669e222 - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-code-nodes-official/SKILL.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-code-nodes-official/SKILL.md` @ 2a5b08a00b5f47a2e89d5876f5ddae74625e41d2 - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-code-nodes-official/references/ARROW_FUNCTIONS_IN_EDIT_FIELDS.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-code-nodes-official/references/ARROW_FUNCTIONS_IN_EDIT_FIELDS.md` @ d7d5bbd99bbb3345c4bb451cb8887160dcaca3ba - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-code-nodes-official/references/DECISION_TREE.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-code-nodes-official/references/DECISION_TREE.md` @ 1a47f3b14e79004232f4237c9a67cc71732d4dbe - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-code-nodes-official/references/JAVASCRIPT_PATTERNS.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-code-nodes-official/references/JAVASCRIPT_PATTERNS.md` @ c813c9e72811efc0dfec530cc2493d931647e7d5 - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-credentials-and-security-official/SKILL.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-credentials-and-security-official/SKILL.md` @ ab550731df56ce82b94b493b1427ae8fed9d8e88 - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-credentials-and-security-official/references/CREDENTIAL_SYSTEM.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-credentials-and-security-official/references/CREDENTIAL_SYSTEM.md` @ 09429830e9563fba4d44b72cf8a6fe958183a032 - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-credentials-and-security-official/references/CUSTOM_CREDENTIALS.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-credentials-and-security-official/references/CUSTOM_CREDENTIALS.md` @ 9e339571c5cf8ced0c2cfe96b460455bbc589df8 - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-credentials-and-security-official/references/FINDING_API_DOCS.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-credentials-and-security-official/references/FINDING_API_DOCS.md` @ 4f1b41be6047ed97e6c1ad93bf69986d438b593c - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-credentials-and-security-official/references/HTTP_REQUEST_WITH_AUTH.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-credentials-and-security-official/references/HTTP_REQUEST_WITH_AUTH.md` @ 522aba689d49144ce8fca39660034147b9dd9f84 - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-data-tables-official/SKILL.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-data-tables-official/SKILL.md` @ a60ec281b3949a7d3130d750a1d232c74a539623 - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-data-tables-official/references/DEDUP_PATTERNS.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-data-tables-official/references/DEDUP_PATTERNS.md` @ 3e376183c21f5786984414fb8ef66782756fffa9 - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-data-tables-official/references/OPERATIONS.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-data-tables-official/references/OPERATIONS.md` @ c0c04a0ee772f5ecb5e7ef418add9b6ff59895a6 - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-data-tables-official/references/SCHEMA_DESIGN.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-data-tables-official/references/SCHEMA_DESIGN.md` @ b324935e8741c1761da43bfd60d9504b00b6fd50 - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-debugging-official/SKILL.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-debugging-official/SKILL.md` @ acc1575ccfc5a4cda3369aed78b8c4cea7022510 - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-debugging-official/references/FETCHING_N8N_SOURCE.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-debugging-official/references/FETCHING_N8N_SOURCE.md` @ 73975288fb54b5fc04aec289cfe1e8250d97094e - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-debugging-official/references/PARAMETER_VERIFICATION.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-debugging-official/references/PARAMETER_VERIFICATION.md` @ f76fb06aa541ada62634980f5605f7c3c0e6bd67 - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-error-handling-official/SKILL.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-error-handling-official/SKILL.md` @ a8eaa5db28f4ccdfefffaf175a01916ffcccf761 - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-error-handling-official/references/API_WORKFLOWS.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-error-handling-official/references/API_WORKFLOWS.md` @ 986c8f2a2018edbbbbab56b1488ef3a506581838 - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-error-handling-official/references/ERROR_WORKFLOWS.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-error-handling-official/references/ERROR_WORKFLOWS.md` @ d8d345a54f79375ff67b62cc326d5e374377643d - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-error-handling-official/references/NODE_ERROR_OUTPUTS.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-error-handling-official/references/NODE_ERROR_OUTPUTS.md` @ 050cf9fc6da4769adc81e51a65f28857138cabed - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-error-handling-official/references/RESPONSE_SHAPES.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-error-handling-official/references/RESPONSE_SHAPES.md` @ fa0e36b93bcec4363fcc2fc15f616b4440138ca5 - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-error-handling-official/references/examples/validation-subworkflow-usage.ts` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-error-handling-official/references/examples/validation-subworkflow-usage.ts` @ ff3a8a0b318de6940a3411038df750ee1c59624c - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-error-handling-official/references/examples/validation-subworkflow.ts` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-error-handling-official/references/examples/validation-subworkflow.ts` @ 815887197a5148514fd9a60d80944942b1e6b2a0 - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-expressions-official/SKILL.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-expressions-official/SKILL.md` @ 76de420cb9b0be4782869598d791b5c2523ef74b - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-extending-mcp-official/SKILL.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-extending-mcp-official/SKILL.md` @ 39c60e9888f226c01e1008f20cd544b8b3886d3a - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-loops-official/SKILL.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-loops-official/SKILL.md` @ d740065da5f837dfdd816ff83539ff06ff20baab - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-loops-official/references/HTTP_PAGINATION.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-loops-official/references/HTTP_PAGINATION.md` @ 3acefc89c433faf8824fac312be8c5fd06914147 - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-loops-official/references/LOOP_OVER_ITEMS.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-loops-official/references/LOOP_OVER_ITEMS.md` @ eda6f24c0a6c31159c205d16b4b0099ce6db6233 - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-node-configuration-official/SKILL.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-node-configuration-official/SKILL.md` @ f74020b6d953b1e022e74a65d45cd90a3c5d7aba - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-node-configuration-official/references/AI_NODES.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-node-configuration-official/references/AI_NODES.md` @ 149f89d5d858f6fb7367fb38b8e7ec308b94a076 - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-node-configuration-official/references/COMMS_NODES.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-node-configuration-official/references/COMMS_NODES.md` @ c3dc77e867e23ab7ff6319e2670f65d36d38dd3c - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-node-configuration-official/references/DATABASE_NODES.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-node-configuration-official/references/DATABASE_NODES.md` @ 4675eb0d3396e0e7c21b9bf75c3fa5f231f21ba9 - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-node-configuration-official/references/HTTP_NODES.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-node-configuration-official/references/HTTP_NODES.md` @ ffa2e555762d296c3cf43f6a1f3e23abea97dd9f - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-node-configuration-official/references/MERGE_NODE.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-node-configuration-official/references/MERGE_NODE.md` @ 4794055b21cefbae4e038dc156432af922b53697 - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-node-configuration-official/references/SWITCH_FALLBACK.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-node-configuration-official/references/SWITCH_FALLBACK.md` @ 17cc79ac27666d3b69c88dd5687bd233aa271408 - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-node-configuration-official/references/TRIGGER_NODES.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-node-configuration-official/references/TRIGGER_NODES.md` @ 5686e4415555a7f3c69406dfeb2390613564aebf - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-node-configuration-official/references/WEBHOOK_NODES.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-node-configuration-official/references/WEBHOOK_NODES.md` @ 4a4a9940c2de2647b4e3b88f0462374c6a362890 - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-subworkflows-official/SKILL.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-subworkflows-official/SKILL.md` @ 7b28ce283bab63de3734935304a54ff0802c56da - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-subworkflows-official/references/NAMING_AND_DISCOVERY.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-subworkflows-official/references/NAMING_AND_DISCOVERY.md` @ 6b301cb722066d59842bb251ed607d9947cdb8e2 - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-subworkflows-official/references/SUBWORKFLOW_PATTERNS.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-subworkflows-official/references/SUBWORKFLOW_PATTERNS.md` @ 07b9c45912cc76eb34bd0ed109a1a26d0a118f3d - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-workflow-lifecycle-official/SKILL.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-workflow-lifecycle-official/SKILL.md` @ d875adeb99306ffc3e8db42a3b14655d564e163c - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-workflow-lifecycle-official/references/FOLDER_LIMITATIONS.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-workflow-lifecycle-official/references/FOLDER_LIMITATIONS.md` @ dbf2fadb17ec6f0b3f8baf729a766e592845c18f - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-workflow-lifecycle-official/references/MCP_ACCESS_PER_WORKFLOW.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-workflow-lifecycle-official/references/MCP_ACCESS_PER_WORKFLOW.md` @ 6ec8f71e358dd97bf2319f053b5c1bbfe7b1f829 - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-workflow-lifecycle-official/references/NAMING_CONVENTIONS.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-workflow-lifecycle-official/references/NAMING_CONVENTIONS.md` @ 9fd4266f46a13553d236b20b2ed5c3b24118f3cc - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-workflow-lifecycle-official/references/NODE_GROUPS.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-workflow-lifecycle-official/references/NODE_GROUPS.md` @ cbb8350ec5d3f099988ad274b1e01b84d2cdee6a - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-workflow-lifecycle-official/references/REVIEW_CHECKLIST.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-workflow-lifecycle-official/references/REVIEW_CHECKLIST.md` @ 4f34070c0f4dff2f7bd035d876c537de8ba02b31 - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-workflow-lifecycle-official/references/STICKY_NOTES.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-workflow-lifecycle-official/references/STICKY_NOTES.md` @ d833066c6aecf7daef331244a6d7334ffebfa88a - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-workflow-lifecycle-official/references/TESTING.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-workflow-lifecycle-official/references/TESTING.md` @ a368d0f84e1aa5e9baa03a1f7ff29614155056fe - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/n8n-workflow-lifecycle-official/references/VALIDATION_CHECKLIST.md` -> `repo/contracts/third-party/n8n-io-skills/skills/n8n-workflow-lifecycle-official/references/VALIDATION_CHECKLIST.md` @ 6e4d1168f4d219f34753b29958ffdb7712401aed - Exact copy; setup copies this skill folder into each app's skills folder.
- `exact` `skills/using-n8n-skills-official/SKILL.md` -> `repo/contracts/third-party/n8n-io-skills/skills/using-n8n-skills-official/SKILL.md` @ 2ce112a5e14fbd29db3b46128650b2b241a74ac5 - Exact copy; setup copies this skill folder into each app's skills folder.

## Advisory Actions Requiring Review

No actionable advisory targets require review.
