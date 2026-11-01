# Web Controller for Claude Projects: guidebook refresh

Reference for the `web-controller-projects` skill, opened when the coordinator refreshes the guidebook copy, finds it missing or gets `SKILL COPY FAILED`. The skill's precedence, style and approvals apply; where this file and the skill differ, the skill wins. A bold section name, such as **Hourly nudge**, names a section of the skill.

## Refreshing the guidebook copy
- **One refresh, three routes.** `node repo/scripts/toolkit-projects-guidebook.cjs --out <folder>`, run by a cloud thread from a fresh clone of main, copies the files, writes `instructions-block.md`, writes `VERSION` last and reads every file back; it prints `SKILL COPY REFRESHED <Version>`, plus `BLOCK CHANGED <version>` when the block changed, or `SKILL COPY FAILED <reason>`. `--check <folder>` only compares.
  - The hourly nudge checks the copy against a fresh clone of main every run and refreshes a stale or changed copy itself (at most an hour behind a merge or a stray write).
  - After a merge that changes this skill or the Toolkit version, start a cloud thread for the refresh at once (fast route, optional speed-up).
  - The daily check-in is the backstop: it refreshes a copy still stale two hours after main changed, or when the nudge is stopped or not armed, and reports `GUIDEBOOK MISSING` or `SKILL COPY STALE`.
- **Missing folder:** when the folder or `VERSION` is missing, start the refresh thread and work from the managed block until it reports. A project that has never had a copy gets one this way once the block that carries the guidebook line arrives.
- `SKILL COPY FAILED`: start one fresh refresh thread; when that fails too, tell the owner once what failed and keep working from the last copy.
