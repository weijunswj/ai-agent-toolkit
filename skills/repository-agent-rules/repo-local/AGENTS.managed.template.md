<!--
Curated AI-facing source.
Source: repo/contracts/agent-rules/repo-local
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

<!-- AI-AGENT-TOOLKIT:repo/contracts/agent-rules/toolkit-governed-rules.md:BEGIN TOOLKIT-GOVERNED-RULES v2 toolkit=3.50.0 sha256=a140e8e75399 -->
# Toolkit-Governed Repository Rules

On github.com, only the valid `.github/toolkit-programme.json` merged on origin's default branch decides on/off on every computer. Enabled binds programme records, decision traces and evidence custody. Pending proposals and local answers decide nothing. Unreadable GitHub permits ordinary work with a note, without governance effects or standing task auto-merge. Coding gates and delegation always apply from the user-level global rules and gate rules. If missing, read https://github.com/weijunswj/ai-agent-toolkit/blob/main/repo/contracts/agent-rules/global-rules.md before planning, and load the `n8n-safety-router` skill before any n8n work; if it is unavailable, stop and report that. Outside rules win on conventions; only the floor's named evidence-store line can relax it.

## Delivery

- Agree releases, lanes and order first. Keep one open release PR per lane; explain work outside the plan.
- Ship coherent reviewable batches, reconcile records before the next task, and order work Now, then Later by priority.
- Set CI, test shards and time budgets here; measure before and after changes.
- Keep a compact repo map (parts, entry points, sources of truth, ownership, recorded commit); update it with changes to those parts.

## Records And Evidence

- Programme tracking: the parent's tracker shows SHA, version, lane, gate, PR, review and UAT state, queue, completed, deferred and superseded work. Update on changes; a comment changing none is its own record. Keep pending gates open after merge.
- Decision traces: the programme issue body is the canonical record. Record each owner decision that changes scope, authority or the plan as one tagged comment (tag on the first line, then `---`); other comments need no index entry. The `github-program-reconciler` lists them by tag; parent and child traces never mix, the latest comment wins within a tag, `SUPERSEDES=<record ID>` replaces a record and long lists page into index comments. G0 reads both traces and has the owner confirm a live-scope summary first (decision-trace playbook).
- SHAs: link files and commits with the 7-character short SHA (longer if GitHub reports it ambiguous). Write the full 40-character SHA only in review verdicts, UAT results and merge summaries.
- Issues: to add a task, search the parent's sub-issues and open or recently closed issues; extend or reopen an owner, else create a child and attach it as a native sub-issue. A child closes as completed once a merge completes every criterion and any owner UAT passed, any remainder moved to a linked follow-up first: that PR says `Closes #n`, else the controller does. Use `Refs` for staged, UAT-pending, blocked, partial or follow-up PRs.
- Parent completion: close only with every native child and descendant closed, including optional and uncatalogued children; catalogue status alone never suffices. With merged-binding `parent_lifecycle` permission, fenced refresh reopens incomplete parents and completes open parents with non-empty, entirely closed native trees. Incomplete reads hold changes. Use Refs for parent links in records and pull request bodies; avoid closing words before those links.
- Custody: session folders, side-session notes, scratchpads and temp paths are never custody. Store plans/reviews in the selected private evidence store before citation or archival; in a Git store the commit is the manifest and a push plus one fetch the read-back.
- Evidence (transport) stores are agent-managed with standing permission on any backend: once the user-selected store, separate from the task repository, has verified identity and privacy (a name or prefix alone grants nothing), agents write, reorganise, delete and, on Git, push to or merge into its default branch without asking. Scan uploads for secrets; never delete the sole copy of evidence, relabel task source as evidence or retry a denied effect.

## Repository Setup

- For legitimate security-sensitive work, add an `Authorised context` section outside this block: code owner, development and defensive testing of its own software, no third-party targets.
- Report a missing playbook index during instruction install, repair or refresh.
<!-- AI-AGENT-TOOLKIT:repo/contracts/agent-rules/toolkit-governed-rules.md:END TOOLKIT-GOVERNED-RULES -->
