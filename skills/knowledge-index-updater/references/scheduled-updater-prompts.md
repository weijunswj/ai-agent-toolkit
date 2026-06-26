<!--
Generated from toolkit project source. Do not edit directly.
Project: knowledge.knowledge-index-updater
Source: _projects/knowledge/knowledge-index-updater/_main/skill/references/scheduled-updater-prompts.md
Update the project source and run sync.
-->
# Knowledge Index Scheduled Updater Prompts

Use these copyable prompt variants only when creating or editing a recurring Knowledge Index updater or an external scheduler that cannot load the current skill at runtime. Replace placeholder database names and data-source URLs before use.

#### Recommended Codex automation prompt

```text
Use the `knowledge-index-updater` skill.

Before doing anything else:
1. Locate and read the current `knowledge-index-updater/SKILL.md`.
2. Prefer the installed Codex skill folder if available.
3. If no installed skill is available, read `skills/knowledge-index-updater/SKILL.md` from the local `ai-agent-toolkit` repo.
4. If generated skill output is unavailable, read `_projects/knowledge/knowledge-index-updater/_main/skill/SKILL.md` from the local `ai-agent-toolkit` repo.
5. Discover platform tooling before checking for missing sources:
   - If `Notion` or `GitHub` tools are not visible, explicitly run the available tool/plugin discovery flow for this platform (for Codex, run `tool_search_tool` for "notion" and "github") before deciding they are unavailable.
   - If a tool is still missing after discovery, report the exact missing tool name and list which knowledge-index work could not be completed because of that specific absence.
6. If no current skill file can be found after discovery and fallback attempts, stop and report that the automation cannot safely run because it cannot load the current `knowledge-index-updater` rules.
7. Local automation memory writes are best-effort only:
   - The runtime may read `C:/Users/xPass/.codex/automations/daily-knowledge-index-update/memory.md`.
   - Never require local filesystem write access for correctness.
   - If writing this file is blocked by environment policy, do not fail the run or skip Notion/GitHub updates.
   - Prefer durable Notion and GitHub state updates when those connectors are available.
   - Continue the knowledge-index update work and include a concise "Local memory update summary" with the intended memory payload in the final response.

Do not fall back to older inline Knowledge Index rules from this automation config if they conflict with the current skill.

Current database:
- Name: <Knowledge Index database name>
- Data source: <collection://your-notion-data-source-id>

Task:
Search my Notion and GitHub for new, changed, removed, or renamed guides, references, portfolio pages, tools, and repositories.

Follow the current `knowledge-index-updater` skill exactly, especially:
- `Scheduled updater behaviour`
- `Existing row update confirmation`
- `Property-only Notion page updates`
- `Quality Checks`

Important:
- Use `Notion Key` and `GitHub Key` as the only hard identity fields.
- Do not use `Canonical Key` for matching, creating, merging, or deduplication.
- Meaningful writes require explicit current-turn approval.
- Scheduled runs must propose meaningful writes instead of applying them automatically.
- Do not add or update rows, identity keys, source fields, archive/delete state, or merge operations without explicit current-turn confirmation.
- Add new canonical rows only when no key or clear real-world match exists, with explicit current-turn confirmation.
- Only pure `Last checked` refreshes on existing rows with no meaningful changes may be written without confirmation.
- Do not refresh `Last checked` for rows with pending proposed meaningful changes.
- When using Notion MCP `notion_update_page` with `command: "update_properties"` for property-only writes, include `content_updates: []`.

At the end, report:
- rows created
- rows updated
- rows marked Needs review
- rows marked Missing
- rows refreshed without confirmation
- anything skipped because identity was uncertain
- proposed meaningful writes awaiting approval
```

#### Static fallback prompt for external schedulers that cannot load skills

Use this static fallback only when the scheduler cannot load or read the current skill at runtime. Codex automation should use the self-loading prompt above instead.

```text
Search my Notion and GitHub for new, changed, removed, or renamed guides, references, portfolio pages, and repositories.

If Notion or GitHub tools are not immediately visible, run the platform's available tool/plugin discovery flow first.
- For Codex runs, discover "notion" and "github" tools explicitly before claiming they are unavailable.
- If a required tool is still unavailable, report the exact missing tool and list only the work that cannot be completed without it.

Local automation memory writes are best-effort only.
- The scheduler may read `C:/Users/xPass/.codex/automations/daily-knowledge-index-update/memory.md` when available.
- Never require local filesystem write access for correctness.
- If a local memory write is blocked by environment policy, continue the Notion/GitHub work and include a concise "Local memory update summary" with the intended memory payload in the final response.
- Prefer durable state in Notion and GitHub when those connectors are available.

Update the root-level Notion Knowledge Index using one row per real project, guide, reference, portfolio item, tool, or repo.

Current database:
- Name: <Knowledge Index database name>
- Data source: <collection://your-notion-data-source-id>

Hard identity rules:

- Treat `Notion Key` and `GitHub Key` as the only hard identity fields.
- `Notion Key` must use `notion.so/<page-id>`.
- `GitHub Key` must use `github.com/<owner>/<repo>`.
- Before creating any row, first query existing rows for the same `Notion Key` or `GitHub Key`.
- If either key already exists in another row, use that existing row instead of creating a duplicate.
- Do not create duplicate repo-only rows for projects that already have a Notion + GitHub row.
- If a Notion page and GitHub repo clearly describe the same real thing, propose merging them into one row and setting `Source` to `Notion + GitHub`; apply only after confirmation when an existing row would be changed.
- Do not use `Canonical Key` for matching, creating, merging, or deduplication.
- If an existing row still has a `Canonical Key`, ignore it unless I explicitly ask for legacy cleanup.

Update rules:

- Scheduled runs must propose meaningful writes instead of applying them automatically.
- Do not add or update rows, identity keys, source fields, archive/delete state, or merge operations without explicit current-turn confirmation.
- Do not apply meaningful writes to existing rows without current-turn confirmation.
- Do not update existing `Name`, `Category`, `Description`, `Source`, `Notion Key`, `GitHub Key`, `Visibility`, `Status`, or other meaningful fields without confirmation.
- Adding keys or source data to an existing row is a meaningful update. Changing `Source`, `Notion Key`, or `GitHub Key` on an existing row requires confirmation.
- If an existing row needs a non-trivial update, first list proposed writes in this exact style:
  1. **<NAME>:**
     - **Target:** `<Notion page / GitHub item / canonical row>`
     - **Write type:** `<create / update / archive / delete / key merge / source merge / status update / visibility update / description update / category update>`
     - **Current data:** `<current value or compact current row summary>`
     - **Suggested data:** `<suggested replacement>`
     - **Reason:** `<why this update is suggested>`
  2. **<NAME>:**
     - **Target:** `<Notion page / GitHub item / canonical row>`
     - **Write type:** `<create / update / archive / delete / key merge / source merge / status update / visibility update / description update / category update>`
     - **Current data:** `<current value or compact current row summary>`
     - **Suggested data:** `<suggested replacement>`
     - **Reason:** `<why this update is suggested>`
- Then ask: **Do you want me to apply these proposed writes?**
- If confirmation is unavailable, report the proposed writes instead of applying them.
- Safe refresh fields such as `Last checked` may be updated during this requested check/update run when no meaningful field changes are included.
- Do not refresh `Last checked` for rows with pending proposed meaningful changes until the proposal is approved or rejected.
- If the batch includes any meaningful write, propose the meaningful writes first and request approval before applying anything.
- Keep descriptions short: one sentence.
- Preserve the current default table view behaviour where possible:
  - grouped by `Category`
  - hidden empty groups
  - visible columns ordered:
    `Category`, `Name`, `Description`, `GitHub Key`, `Notion Key`, `Source`, `Last checked`, `Status`, `Visibility`
- Do not create separate Notion Link, GitHub Link, Source Link, or Canonical Key fields.
- When calling Notion MCP `notion_update_page` with `command: "update_properties"` for a property-only page write, include `content_updates: []` in every single or batched request even when no body edits are intended.
- Do not permanently delete anything.
- Mark uncertain duplicates as `Needs review`.
- Mark confirmed missing sources as `Missing`.
- Any meaningful write still requires explicit current-turn confirmation, including row creation.
- `Last checked` may be refreshed without confirmation only when no meaningful change is being written for that row and the user requested a check/update run.
- Only pure `Last checked` refreshes are approval-free.
- Do not refresh `Last checked` for rows that already have a proposed meaningful change until the proposal is approved or rejected.
- If the platform requires explicit confirmation for connector writes, batch all proposed writes into one compact approval request instead of asking repeatedly.

At the end, tell me:
- rows created
- rows updated
- rows marked Needs review
- rows marked Missing
- anything skipped because identity was uncertain
```

Use a daily 9:00 AM schedule in the user's local timezone unless they specify another time.
