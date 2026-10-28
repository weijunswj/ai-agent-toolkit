<!--
Curated AI-facing source.
Source: repo/contracts/agent-rules/repo-local
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

<!-- AI-AGENT-TOOLKIT:repo/contracts/agent-rules/toolkit-governed-rules.md:BEGIN TOOLKIT-GOVERNED-RULES v2 toolkit=3.15.20 sha256=132af9446394 -->
# Toolkit-Governed Repository Rules

With the user's yes, this block and `.github/toolkit-programme.json` turn on Toolkit's GitHub governance for this github.com repository: programme records, decision traces, evidence custody and the rules below. Nothing here applies until the user says yes, without both, or off github.com. The coding gates and delegation are in the Toolkit global rules in the harness's user-level file, with gate mechanics in the gate rules, and apply everywhere. If they are missing (for example in a cloud session), read https://github.com/weijunswj/ai-agent-toolkit/blob/main/repo/contracts/agent-rules/global-rules.md before planning, and load the `n8n-safety-router` skill before any n8n work; if it is unavailable, stop and report that. Repository rules outside this block win on conventions; nothing here relaxes the global safety floor except the evidence-store line, which the floor names.

## Delivery

- Agree a release plan up front: releases, lanes and order. Keep one open release PR per lane; work outside the plan states its reason.
- Finish fast: ship the biggest coherent batch that stays reviewable, reconcile records before the next task, and order work Now, then Later by priority.
- Repository-wide CI, test sharding and time budgets are set here, measured before and after a change.
- Every governed repository keeps a current compact repo map (parts, entry points, sources of truth, ownership, recorded commit), updated in the change that moves what it describes.

## Records And Evidence

- Programme tracking: the parent issue's tracker shows SHA, version, lane and gate, PR, review and UAT state, queue, and completed, deferred and superseded work. Update it when one of those changes; a comment that changes none is its own record. Keep pending gates open after merge.
- Decision traces: the programme issue body is the canonical record. Record each owner decision that changes scope, authority or the plan as one tagged comment (tag on the first line, then `---`); other comments need no index entry. The `github-program-reconciler` lists them by tag; parent and child traces never mix, the latest comment wins within a tag, `SUPERSEDES=<record ID>` replaces a record and long lists page into index comments. G0 reads both traces and has the owner confirm a live-scope summary first (decision-trace playbook).
- SHAs: link files and commits with the 7-character short SHA (longer if GitHub reports it ambiguous). Write the full 40-character SHA only in review verdicts, UAT results and merge summaries.
- Issues: to add a task, search the parent's sub-issues and open or recently closed issues; extend or reopen an owner, else create a child and attach it as a native sub-issue. Use `Refs` for staged, UAT-pending, blocked or follow-up PRs; `Closes`/`Fixes`, and closing, only once the merge completes every criterion and any owner UAT passed, with any remainder moved to a linked follow-up first.
- Custody: session folders, side-session notes, scratchpads and temp paths are never custody. Plans and reviews reach the selected private evidence store before a record cites them or sessions are archived; in a Git store the commit is the manifest and a push plus one fetch the read-back.
- Evidence (transport) stores are agent-managed with standing permission, whatever the backend (private repository, shared folder, drive): once the user-selected store, separate from the task repository, has its identity and privacy verified (a name or prefix alone grants nothing), agents write, reorganise, delete and, on Git, push to or merge into its default branch without asking. Scan every upload for secrets, never delete the sole copy of evidence, never relabel task source as evidence or retry a denied effect.

## Repository Setup

- If the repository does legitimate security-sensitive work, describe it in an `Authorised context` section outside this block: who owns the code, that the work is development and defensive testing of the repository's own software, and that nothing targets third-party systems.
- If the playbook index is missing during an instruction install, repair or refresh, report that it needs installing.
<!-- AI-AGENT-TOOLKIT:repo/contracts/agent-rules/toolkit-governed-rules.md:END TOOLKIT-GOVERNED-RULES -->
