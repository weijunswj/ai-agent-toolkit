# Repository Notes

These notes hold the parts of this skill that depend on the AI Agent Toolkit: its rules commands, its shell hook for agent apps, its auto-merge settings file and the repository that ships these scripts. A repository without them can skip this file; the generic steps in SKILL.md still apply.

## Terms In SKILL.md

- "Repositories that opt in to shared rules" means Toolkit-governed repositories, where Toolkit governance is on.
- "The rules commands" means the Toolkit commands `toolkit governance check` and `toolkit governance security`, listed under Dependency Auto-Merge below.

## Personal-Data Guard

- The attribution check's session and project-thread link patterns match claude.ai links.
- A repository counts as the Toolkit only when it has both the guard source and `repo/scripts/toolkit-governance-conformance.cjs`.

## Check Before A Push

- With the Toolkit plugin installed, the shell hook in Claude Code and Codex refuses a `git push` or `gh pr create` when a commit being sent adds a credential, as SKILL.md describes.

## Hooks And Privacy-Safe Checks

- The fixtures, allow markers and pushed-by-mistake steps are in the `toolkit-playbooks` skill's `privacy-safe-checks.md`.

## Dependency Auto-Merge

- The settings file read by the auto-merge template is `.github/toolkit-programme.json` on the default branch, and the template reads its `dependency_updates` block.
- In a Toolkit-governed repository, `toolkit governance check` reports it with the other dependency and security settings, and `toolkit governance security` installs it once the settings file (the programme binding) allows auto-merge.
