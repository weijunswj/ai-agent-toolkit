# Third-Party Notes

Toolkit ships the official n8n skills from:

- Project: `n8n-io/skills`
- Source subset: the 15 skill folders under `skills/` (`n8n-agents-official` to `using-n8n-skills-official`)
- Pinned commit: `27b6b9f429ac0be90cae764512dbc579d7107e95`
- License: Apache-2.0, kept beside the copy at `repo/contracts/third-party/n8n-io-skills/LICENSE`
- Upstream repository: [n8n-io/skills](https://github.com/n8n-io/skills)

The folders are exact copies under `repo/contracts/third-party/n8n-io-skills/skills/`. Setup copies them, unchanged, into Claude Code's, Codex's and Antigravity's own skills folders. Toolkit never copies or runs the upstream plugin wrappers, hook scripts, OpenCode plugin or package manifest. The example workflows in `n8n-ai-nodes-official/references/examples/` are reference text with placeholder credential ids; nothing imports them.

Review (`skill-product-review`, 23 Oct 2026): verdict `constrain`. Only the skill folders and the licence may be shipped; everything else in the repository stays excluded. A new upstream release is a manual review: source-watch flags it, the owner decides, and an approved update ships as a Toolkit patch release.

Keep public attribution to `n8n-io/skills` with the Apache-2.0 licence note.
