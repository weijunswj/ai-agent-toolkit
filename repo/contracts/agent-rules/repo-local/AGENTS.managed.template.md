<!--
Curated AI-facing source.
Source: repo/contracts/agent-rules/repo-local
Review rule: Preserve safety constraints from preserved source. Do not weaken credential, .env, .tmp, .n8n-local, live n8n action, approval, attribution, or local-only rules.
-->

<!-- AI-AGENT-TOOLKIT:repo/contracts/agent-rules/toolkit-governed-rules.md:BEGIN TOOLKIT-GOVERNED-RULES v2 toolkit=3.10.0 sha256=f2b36c18b54d -->
# Toolkit-Governed Repository Rules

With the user's yes, this block and `.github/toolkit-programme.json` turn on Toolkit's GitHub governance for this github.com repository: programme records, decision traces, evidence custody and the rules below. Nothing here applies until the user says yes, without both, or off github.com. The coding gates, delegation and routes are in the Toolkit global rules in the harness's user-level file and apply everywhere. If they are missing (for example in a cloud session), read https://github.com/weijunswj/ai-agent-toolkit/blob/main/repo/contracts/agent-rules/global-rules.md before planning, and load the `n8n-safety-router` skill before any n8n work; if it is unavailable, stop and report that. Repository rules outside this block win on conventions; nothing here relaxes the global safety floor except the evidence-store line, which the floor names.

## Delivery

- Agree a release plan up front: releases, lanes and order. Keep one open release PR per lane; work outside the plan states its reason.
- Finish fast: ship the biggest coherent batch that stays reviewable, reconcile records before the next task, and order work Core, then Hardening, then Later.
- Repository-wide CI, test sharding and time budgets are set here, measured before and after a change.
- Every governed repository keeps a current compact repo map (parts, entry points, sources of truth, ownership, recorded commit), updated in the change that moves what it describes.

## Records And Evidence

- Programme tracking: keep the parent issue's tracker current (SHA, version, lane and gate, PR, review and UAT state, queue, completed, deferred and superseded work) and record start, PR head, review verdicts, findings and exact-head fixes, CI, merge, UAT result, remediation and completion. Keep pending gates open after merge.
- Decision traces: the programme issue body is the canonical record. The `github-program-reconciler` links every non-bot comment from it (`#issuecomment-<id>`), one list per comment tag (first line, then `---`); parent and child traces never mix, and within a tag the latest comment wins. `SUPERSEDES=<record ID>` replaces a record. Before 60,000 characters, long lists page into index comments one hop away. G0 reads both traces and has the owner confirm a live-scope summary first (decision-trace playbook).
- SHAs: link files and commits with the 7-character short SHA (longer if GitHub reports it ambiguous) and write the full 40-character SHA beside the link as plain code text.
- Takeover: a new controller posts one takeover record on the parent's CURRENT before acting (its identity, the bound commit and `CONTROLLER.md` blob, evidence that the previous writer stopped, the next action) and reads it back.
- Custody: session folders, side-session notes, scratchpads and temp paths are never custody. Packets, plans and reviews reach the selected private evidence store with a manifest and read-back before a record cites them; archive old sessions only after that read-back.
- Evidence (transport) stores are agent-managed with standing permission, whatever the backend (private repository, shared folder, drive): once the user-selected store, separate from the task repository, has its identity and privacy verified (a name or prefix alone grants nothing), agents write, reorganise, delete and, on Git, push to or merge into its default branch without asking. Scan every upload for secrets, never delete the sole copy of evidence, read writes back, and never relabel task source as evidence or retry a denied effect.

## Repository Setup

- If the repository does legitimate security-sensitive work, describe it in an `Authorised context` section outside this block: who owns the code, that the work is development and defensive testing of the repository's own software, and that nothing targets third-party systems.
- If the playbook index is missing during an instruction install, repair or refresh, report that it needs installing.
<!-- AI-AGENT-TOOLKIT:repo/contracts/agent-rules/toolkit-governed-rules.md:END TOOLKIT-GOVERNED-RULES -->
