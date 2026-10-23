# AI Agent Toolkit Repo Rules

<!-- AI-AGENT-TOOLKIT:repo/contracts/agent-rules/toolkit-governed-rules.md:BEGIN TOOLKIT-GOVERNED-RULES v2 toolkit=3.7.0 sha256=6bff32d84ee9 -->
# Toolkit-Governed Repository Rules

This block opts the repository into AI Agent Toolkit governance; nothing Toolkit-governed applies without it. Generic rules come from the Toolkit global rules in the harness's user-level file. If they are not in your context (for example in a cloud session), read https://github.com/weijunswj/ai-agent-toolkit/blob/main/repo/contracts/agent-rules/global-rules.md before planning, and load the `n8n-safety-router` skill before any n8n work; if it is unavailable, stop and report that. Repository rules outside this block win on conventions; nothing here relaxes the global safety floor except the evidence-store line, which the floor names.

## Gates

Coding work follows `G0 Discovery -> G1 Builder, including UAT -> G2 Review` unless the owner chooses another workflow. G0 and G1 share the same strong lead route. One builder owns the whole approved outcome across corrections, checkpoints and fresh sessions; in-scope fixes need no new admission. G2 starts after the working result and the owner's actual UAT acceptance, in fresh independent contexts. The pinned stack fixes the reviewer set (no added peer, duplicate or automatic closing panel), and every reviewer independently reviews the full accepted scope. Acceptance needs the whole roster, qualified routes, the exact candidate and coverage, verified evidence and no unresolved blocking finding, never a majority verdict or a scope/execution split. G2 stays adversarial on every reachable path inside the frozen supported host/environment matrix and agreed invariants, and rechecks target corrected boundary families rather than restarting discovery.

Fresh executor contexts are mandatory between G0 and G1, for initial G2, for a required model, effort or harness switch, runtime or environment replacement, activated instruction or profile revision or executor replacement, and after genuine session loss or forced compaction at a safe boundary. Planned G1 segment completion alone checkpoints and continues in the same session. Verify custody and stop the old writer before a controller relaunch; the successor continues the same approved assignment without another scope approval. A new SHA alone does not invalidate UAT: supply impact evidence and let the controller record UAT_RETAINED, UAT_PARTIAL_REQUIRED or UAT_FULL_REQUIRED. Correction rechecks use fresh contexts for the same selected reviewers unless a specific reviewer must be replaced. A same-family recheck is readmitted only on a closed family-closure record evaluated against the exact corrected candidate; a passing latest reproducer is not enough, and after two NOT PASSED rechecks of one family a consolidated root-cause reassessment comes first. Keep functional, UAT, review, custody, integration, publication, Core and parent states distinct. These rules do not claim the detailed native host matrix is implemented or qualified.

## Delegation And Routes

G0 must delegate suitable separable evidence gathering, and G1 suitable independent implementation or validation; the lead keeps reasoning, architecture, decisive proof, integration, UAT readiness and final quality. Exceptions (trivial or inseparable work, overhead above benefit, tightly coupled reasoning, an unavailable exact route, a real authority or safety boundary) are recorded briefly; there is no helper quota, ceremonial launch or extra owner permission for already-authorised direct work. Only a G0 or G1 lead launches helpers; helpers never launch or ask for another agent, and G2 has none.

Models and effort come only from an explicitly selected stack registry revision pinned in the controller decision and CURRENT admission, never inferred from the host, provider, alias or newest bundled registry; a newer registry needs explicit adoption and never changes an active run. Keep qualification overrides separate from production selection, and each stack's lead and helper bindings independent. Model and effort follow launch ownership: a human's own choice for an agent they open directly (including a G2 chat) is advisory, not a blocker, and is recorded as the actual route, never labelled the recommended one. Every automation-launched G0/G1/G2 worker or successor, even as root of its own session, and every G0/G1 helper gets the exact pinned route for its role and member, with no fallback or weaker effort. A root label is not a human override, and no model lock goes into a human-run entrypoint. Native permissions, independence, reviewer obligations and delegation limits still apply.

**Route proof:** every gate launch pins model and effort explicitly. Before consequential work, the launched session reads its own model and effort from session metadata (for example `get_session(self)`) and stops with a report when either is inherited, missing or different from the pinned route, on every launch path including Claude Projects thread starts. Service tier is the controller's concern (future launches use Standard). Keep model, effort, tier and route out of portable task prompts unless a runtime requires them.

## Delivery

- Agree a release plan up front: releases, lanes and order. Keep one open release PR per lane; work outside the plan states its reason.
- Finish fast: ship the biggest coherent batch that stays reviewable, reconcile records before the next task, and order work Core, then Hardening, then Later.
- Keep tests fast: targeted local runs, CI as the full gate, and sharding or caching only when coverage is unchanged.
- Keep a recoverable packet: exact source or delta, scope and authority, current results and evidence, environment, unresolved effects and denials, verified custody, and one next action. A continuation loads the current packet and changed instructions, not the full history.
- G1 checks the actual user or operator surface for clarity during validation and UAT, and G2 treats unsafe or misleading text as a real finding. Gate names `G0`, `G1` and `G2` are fine where the reader needs them.
- Every governed repository keeps a current compact repo map (parts, entry points, sources of truth, ownership, recorded commit), updated in the change that moves what it describes.

## Records And Evidence

- Programme tracking: keep the parent issue's tracker current (SHA, version, lane and gate, PR, review and UAT state, queue, completed, deferred and superseded work) and record start, PR head, review verdicts, findings and exact-head fixes, CI, merge, UAT result, remediation and completion. Keep pending gates open after merge.
- Decision traces: the programme issue body is the canonical record. Link every non-bot comment from the body's collapsed decision index by fragment link (`#issuecomment-<id>`), one line per record ID; a record that replaces another adds `SUPERSEDES=<record ID>`. Before the body passes 60,000 characters (GitHub's limit is 65,536), move older index lines into an index comment linked from the body, so every record stays one hop away. The `github-program-reconciler` trace audit fails on any unlinked comment.
- SHAs: link files and commits with the 7-character short SHA (longer if GitHub reports it ambiguous) and write the full 40-character SHA beside the link as plain code text.
- Takeover: a new controller posts one takeover record on the parent's CURRENT before acting (its identity, the bound commit and `CONTROLLER.md` blob, evidence that the previous writer stopped, the next action) and reads it back.
- Custody: session folders, side-session notes, scratchpads and temp paths are never custody. Packets, plans and reviews reach the selected private evidence store with a manifest and read-back before a record cites them; archive old sessions only after that read-back.
- Evidence (transport) stores are agent-managed with standing permission, whatever the backend (private repository, shared folder, drive): once the user-selected store, separate from the task repository, has its identity and privacy verified (a name or prefix alone grants nothing), agents write, reorganise, delete and, on Git, push to or merge into its default branch without asking. Scan every upload for secrets, never delete the sole copy of evidence, read writes back, and never relabel task source as evidence or retry a denied effect.

## Repository Setup

- If the repository does legitimate security-sensitive work, describe it in an `Authorised context` section outside this block: who owns the code, that the work is development and defensive testing of the repository's own software, and that nothing targets third-party systems.
- If the playbook index is missing during an instruction install, repair or refresh, report that it needs installing.
<!-- AI-AGENT-TOOLKIT:repo/contracts/agent-rules/toolkit-governed-rules.md:END TOOLKIT-GOVERNED-RULES -->

## This Repository

This repository is the canonical AI Agent Toolkit, and this file applies to it only: never copy it into another repository. Portable installs use [`skills/repository-agent-rules/repo-local/AGENTS.managed.template.md`](skills/repository-agent-rules/repo-local/AGENTS.managed.template.md). Keep this file short: it loads in every session here, so put detail in routed playbooks or source-of-truth docs and add nothing merely for completeness.

- **Routing:** read the [Toolkit playbook index](repo/docs/agent-playbooks/INDEX.md) (it replaces the portable index), classify the task, and read only the smallest matching playbook set and the docs it names; with no match, continue baseline-only. If a required playbook is missing or conflicts with this file, stop and report.
- **Programme:** for [programme #421](https://github.com/weijunswj/ai-agent-toolkit/issues/421), follow [Toolkit V3](repo/docs/TOOLKIT-V3.md) and load only the changed role instructions when continuing. Its preparation does not prove runtime implementation, installed qualification or native permission, and other repositories keep their own bindings.

## Safety

- Toolkit source changes go through a non-main branch and PR. Evidence custody follows the governed block above.
- Never commit secrets, private values, `.env`, `.n8n-local/`, `.tmp/`, package artifacts, runtime-only files, product code, customer data or business workflow JSON.
- Live systems, Docker, n8n runtime, import/export, sync, activation, credentials, SSH to real servers, deployment, firewall or production config, and destructive or external-service actions need explicit current-turn approval naming the target and operation.
- Never weaken tests, validation, schemas, guardrails, attribution, generated-output ownership or approval gates to pass a check, and never claim CI passed without checking it.

## Sources, Markers And Packaging

- Edit canonical surfaces directly (`skills/**`, `repo/contracts/**`, `repo/scripts/**`, `repo/docs/**`); no second publisher tree, and generated output is never a separate source. Before changing skills, contracts, scripts, provenance or synchronizers, read the [Source-of-Truth Contract](repo/contracts/source-of-truth-contract.md) (also synced into the README).
- Toolkit inserts use versioned, hashed markers (`repo/scripts/toolkit-managed-block.cjs`): `<!-- AI-AGENT-TOOLKIT:<source>:BEGIN <NAME> v2 toolkit=<version> sha256=<12 hex> -->` ... `<!-- AI-AGENT-TOOLKIT:<source>:END <NAME> -->`. Edit the named source, then run its sync (`node repo/scripts/sync-agent-instruction-shims.cjs --write`, `node repo/scripts/sync-repo-doc-contract.cjs --write`).
- Native plugin updates are host-local (`.codex-plugin/` for Codex, `.claude-plugin/` for Claude Code). The bridge keeps the managed checkout current and records hub state and update reports; setup also installs the global rules (`repo/scripts/toolkit-global-rules.cjs`). Antigravity gets a portable skills copy only. Hooks are optional; policy lives in docs, validators and the [Bridge doc](repo/docs/TOOLKIT-LOCAL-BRIDGE.md).
- Every commit that changes plugin-packaged content, setup, the bridge, skills, adapters or native plugin metadata bumps the Toolkit version in the same commit, keeping `repo/contracts/toolkit-local-bridge/version.json`, native plugin inputs and metadata, `BRIDGE_VERSION` and the Codex setup expected version aligned.
- Setup or refresh: follow [For AI Agents](repo/docs/FOR_AI_AGENTS.md); run the managed checkout's setup script when it exists, and `repo/scripts/setup-toolkit.cjs --execute --profile auto-main` only to bootstrap.

## Skill Creation Center

Before adding a skill, adapter, template or contract, check the existing `skills/**`, the README skill tables, the [Skill Safety Matrix](repo/docs/SKILL-SAFETY-MATRIX.md) and the skill-routing source. Extend an existing skill when its trigger, safety boundary, assets and validation fit without bloating it; create a new one only for a distinct trigger, domain, safety boundary, provenance need, asset set or validation path. Third-party skills or agent material go through `skill-product-review` first; nothing is copied, installed, run or adapted until its `allow` or `constrain` verdict covers that scope, and approved adaptations keep licence, attribution, provenance, source locks and validation. Keep reviewed provenance under `repo/source-watch/provenance/**`; source-watch jobs never update it. Prefer safety, provenance and usefulness over more surface area.

## Validation And PRs

- Run targeted checks for touched scripts, docs, generated surfaces and instruction files. Never run `npm run validate:all` locally here; CI owns the full gate.
- If a generated-output or contract check fails on unrelated stale files, report it instead of widening the PR.
- Use authenticated `gh` for authorised GitHub work. Before creating or updating PRs or issues, confirm the account with `gh auth status` and `gh api user --jq .login`; if that route is unavailable, hold the operation. Authentication grants no task authority.
- After a push, update the PR body when the diff, safety notes, validation, generated output or user-facing behaviour changed.
