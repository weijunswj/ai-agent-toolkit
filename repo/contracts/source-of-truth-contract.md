## Source-of-Truth Contract

`skills/**` is the canonical copyable AI-agent product surface. The whole skill folder is the install unit, and retained skills are edited directly.
- `repo/contracts/**` is the canonical machine contract surface for schemas, policies, fixtures, templates, and agent-rule inputs.
- `repo/scripts/**` is the canonical runtime and maintenance implementation surface; `repo/tests/**` owns focused contract and runtime tests.
- `repo/contracts/agent-rules/toolkit-skill-routing.md` is the routing source for the current `skills/*/SKILL.md` set and records intentionally omitted skills.
- `repo/source-watch/provenance/**/SOURCE-LOCK.json` contains only active third-party attribution pins. Each lock records the upstream repo, ref, commit, update policy, attribution requirement, allowlist, and exact blob pins for retained copied or adapted files.
- Scheduled source-watch is PR-notification-only. It may compare active source-lock pins and advisory targets with upstream GitHub commits, then open or refresh a stable review PR. It must not copy upstream files, change source-lock/advisory records, execute upstream code, auto-merge, push to main, run live n8n actions, or treat notification as approval. Real updates require a separate human-approved PR.
- The toolkit does not maintain project manifests, standalone `_main` source ownership, project-to-skill publishing, pack packaging, generated skill copies, privileged generated-surface writeback, or a generic Toolkit sync command. New Toolkit skills are created directly at canonical `skills/**` paths after Skill Creation Center review; contracts, runtime, tests, and docs are created directly at canonical `repo/**` paths.
- The retained deterministic synchronizers remain narrow: `repo/scripts/sync-repo-doc-contract.cjs` maintains only the managed source-of-truth block, while `repo/scripts/sync-agent-instruction-shims.cjs` maintains root/repo-local instruction shims and exactly four portable n8n safety derivatives sourced from `repo/contracts/agent-rules/n8n-agent-rules.md`:
  - `skills/n8n-agent-rules/n8n-agent-rules.md`
  - `skills/n8n-local-setup/references/n8n-agent-rules.md`
  - `skills/n8n-workflow-helper-scripts/references/n8n-agent-rules.md`
  - `skills/n8n-workflow-templates/references/n8n-agent-rules.md`
- This n8n derivative set is a bounded portable/local safety-context exception, not project-to-skill publishing or general generated-surface writeback. Use the exact retained synchronizer command for repair; no unspecified generic `run sync` command exists.
- `.codex-plugin/` and `.claude-plugin/` contain native plugin metadata for the current Toolkit package. They remain platform-separated and must not be used to cross-update the other native platform.
- This repo intentionally does not ship or maintain a repo-wide MCP generated surface. Official n8n Skills plus instance-level MCP references remain inside `skills/n8n-local-setup/` as secondary n8n setup material.
- All retained skill/runtime context must remain local, complete enough to use, and traceable through direct repository paths or the two retained third-party provenance records. External links may support provenance but must not be required for normal execution.
