---
name: knowledge-index-updater
description: Update, clean, and maintain a personal notion knowledge index that consolidates notion pages, github repositories, guides, references, and portfolio items. use when the user asks to create or update a one-stop shop, merge notion and github duplicates, use notion key and github key url columns as clickable identity fields, categorise entries, generate short descriptions, create the default grouped category view, schedule daily checks, or mark missing/stale knowledge items without deleting them. supports chatgpt, codex, claude, and claude code where those platforms expose compatible skill loading and required connectors.
---

<!--
Generated from toolkit project source. Do not edit directly.
Project: knowledge.knowledge-index-updater
Source: _projects/knowledge/knowledge-index-updater/_main/skill/SKILL.md
Update the project source and run sync.
-->
# Knowledge Index Updater

## Overview

Maintain a simple Notion Knowledge Index backed by Notion and GitHub. The index must stay lightweight: one canonical row per real project, guide, reference, repo, or portfolio item. Use `Notion Key` and `GitHub Key` as the only hard identity fields so repeated runs match existing rows instead of creating duplicates. Treat existing rows as user-confirmed; propose non-trivial updates before changing meaningful fields.

## Platform Support

Support these platforms by default where possible:

- ChatGPT: use `SKILL.md` and `agents/openai.yaml`.
- Codex: use the same skill folder inside the expected project skills location.
- Claude: use this skill if Claude Skills are available in the account or workspace.
- Claude Code: copy the skill folder into `~/.claude/skills/` for personal use or `.claude/skills/` for project use.

If a platform cannot access Notion, GitHub, or scheduled tasks, explain the limitation and provide manual update steps instead of claiming the update was completed.

For Claude-specific notes, see `agents/claude.md`.

## Core Principles

1. Keep one canonical row per thing.
   - Merge Notion pages and GitHub repos that describe the same project, guide, or system.
   - Do not create separate rows just because the item exists in both Notion and GitHub.
2. Treat key fields as primary-key-like identity fields.
   - Notion cannot enforce database primary keys, so simulate them with `Notion Key` and `GitHub Key`.
   - `Notion Key` and `GitHub Key` are both clickable source URLs and the only hard identity fields.
   - `Canonical Key` is removed from the clean default schema because it is AI-generated and can drift between scheduled runs.
   - If an existing database still has a legacy `Canonical Key` column, ignore it during scheduled runs unless the user explicitly asks for legacy cleanup.
   - Before creating any row, search/query existing rows and compare against `Notion Key` and `GitHub Key`.
3. Index, do not duplicate.
   - Store short descriptions and source keys, not full guides or READMEs.
4. Be conservative.
    - Never permanently delete rows automatically.
    - Treat existing rows as user-confirmed.
    - Apply audit/propose-first for meaningful updates before writing them.
   - Mark uncertain duplicates as `Needs review`.
   - Mark confirmed missing sources as `Missing` only after checking the source.
5. Make links clickable.
   - Use scheme-less links if full URLs are blocked: `notion.so/<page-id>` and `github.com/<owner>/<repo>`.
6. Keep descriptions short.
   - Use one sentence focused on what the item is and why it exists.

## Default Index Schema

Create or migrate the Notion database to exactly this clean default schema unless the user explicitly asks for extra fields:

- `Name` — title.
- `Category` — select options in this order and colour set:
  - `Guide` — blue.
  - `Reference` — purple.
  - `Repo` — green.
  - `Portfolio` — yellow.
  - `Tool` — orange.
  - `Other` — gray.
- `Description` — rich text, one sentence.
- `Source` — select options in this order and colour set:
  - `Notion` — gray.
  - `GitHub` — default.
  - `Notion + GitHub` — blue.
  - `External` — brown.
- `Notion Key` — URL, clickable Notion source and identity key using `notion.so/<page-id>`.
- `GitHub Key` — URL, clickable GitHub source and identity key using `github.com/<owner>/<repo>`.
- `Visibility` — select options:
  - `Private` — red.
  - `Public-safe` — green.
- `Status` — select options:
  - `Active` — green.
  - `Draft` — yellow.
  - `Stale` — orange.
  - `Missing` — red.
  - `Needs review` — purple.
- `Last checked` — date.

Do not create `Notion Link`, `GitHub Link`, `Source Link`, `Canonical Key`, `Related / Backlinks`, `Last reviewed`, or `Archived` status in the default setup. If an old database already has those fields, migrate useful URL values into the clean fields above. Hide legacy `Canonical Key` from the default view first, and delete it only after the user confirms legacy cleanup.

### Default database DDL

Use this DDL when creating a fresh index:

```sql
CREATE TABLE ("Name" TITLE, "Category" SELECT('Guide':blue, 'Reference':purple, 'Repo':green, 'Portfolio':yellow, 'Tool':orange, 'Other':gray), "Description" RICH_TEXT, "Source" SELECT('Notion':gray, 'GitHub':default, 'Notion + GitHub':blue, 'External':brown), "Notion Key" URL, "GitHub Key" URL, "Visibility" SELECT('Private':red, 'Public-safe':green), "Status" SELECT('Active':green, 'Draft':yellow, 'Stale':orange, 'Missing':red, 'Needs review':purple), "Last checked" DATE)
```

## Default View Setup

The default working view should mirror the current Knowledge Index setup:

- View name: `Default view` when creating the database's primary view, or `Active Index - Keys Only` if creating an additional clean view.
- Type: table.
- Group by: `Category`.
- Hide empty groups: true.
- Group sort: manual/default category order.
- Row sort: use `Name` ascending only when creating a separate active view; otherwise preserve the default grouped view.
- Visible properties, in this order:
  1. `Category`
  2. `Name`
  3. `Description`
  4. `GitHub Key`
  5. `Notion Key`
  6. `Source`
  7. `Last checked`
  8. `Status`
  9. `Visibility`

If the Notion tool supports creating or updating views, create/update a table view with this configuration after creating or migrating the database. If the exact default view cannot be modified, create a new view named `Active Index - Keys Only` using the same visible column order and `Status = Active` as an optional filter only when the user wants a clean active-only view.

## Workflow

### 1. Locate or create the index

1. Search Notion for an existing database named `Knowledge Index` or a user-provided index name.
2. Fetch the database or data source schema before creating or updating rows.
3. If no index exists and the user wants setup, create one using the Default Index Schema and Default database DDL above.
4. If multiple possible indexes exist, use the most recently edited obvious match, then tell the user what you used.

### 2. Gather sources

Use the Notion connector to find relevant pages and the GitHub connector to list accessible repositories.

For Notion, search for pages using broad terms such as:
- `portfolio guide reference setup automation`
- `study guide checklist prompt system`
- project-specific names from existing rows.

For GitHub, list accessible repositories and capture:
- owner/repo name.
- visibility.
- archived status.
- default branch when available.
- clean repo key as `github.com/<owner>/<repo>`.

### 3. Build hard identity keys before writing

For every candidate, derive keys:

- `Notion Key`: `notion.so/<page-id>` if a Notion page exists.
- `GitHub Key`: `github.com/<owner>/<repo>` if a GitHub repo exists.

Do not create or use `Canonical Key` for matching, creating, merging, or deduplication. If a legacy row still has `Canonical Key`, ignore that column unless the user explicitly asks for legacy cleanup.

### 4. Match before creating rows

Before creating any row, query existing rows by `Notion Key` and `GitHub Key`.

1. Exact `Notion Key` match wins.
2. Exact `GitHub Key` match wins.
3. If either key already exists in another row, use that existing row instead of creating a duplicate.
4. If a Notion page and GitHub repo clearly describe the same real thing, propose merging into one row and setting `Source` to `Notion + GitHub`; apply only after confirmation when an existing row would be changed.
5. Do not use `Canonical Key` for matching.

If any strong match exists, work from that existing row. Do not create a new row.

If unsure whether two items are the same, do not merge silently. Mark or create an item with `Status = Needs review` and explain the uncertainty.

### Existing row update confirmation

Default mode is **audit/propose first**.

No meaningful write may happen unless the user gives explicit current-turn approval for the exact write or exact batch of writes.

Meaningful writes that always require confirmation:

- Creating a Notion page/row.
- Updating `Name`.
- Updating `Category`.
- Updating `Description`.
- Updating `Status`.
- Updating `Visibility`.
- Updating `Source`.
- Updating `Notion Key`.
- Updating `GitHub Key`.
- Updating `Canonical Key`.
- Appending source identity data to an existing row.
- Adding, changing, or merging `Source`.
- Adding, changing, or merging `Notion Key`.
- Adding, changing, or merging `GitHub Key`.
- Adding, changing, or merging `Canonical Key`.
- Archiving rows.
- Deleting rows.
- Any GitHub write, issue, branch, PR, file, label, metadata, or repository mutation if the skill routes such work.
- Any batch write containing anything other than pure `Last checked` refreshes for rows with no meaningful changes.
- Any row creation or update that changes any property other than `Last checked`.

Allowed without confirmation:

- Search/read Notion.
- Search/read GitHub.
- Compare current data against desired data.
- Produce a proposed change list.
- Explain what would be written if approved.
- Refresh only `Last checked` for rows where no meaningful field changes are needed.

Only pure `Last checked` refreshes are approval-free.

`Last checked` may be refreshed without confirmation only when all conditions are true:

1. The user requested a check/update/sync/review run.
2. The row already exists.
3. No meaningful field changes are needed for that row.
4. The write changes only `Last checked`.
5. No other property, identity key, source field, status, visibility, title, description, archive/delete state, or content changes are included.

Special rule for rows with pending proposed meaningful changes:

If a row has any proposed meaningful change, do not refresh `Last checked` for that row until the user approves or rejects the proposed change.

Special rule for batch writes:

- Batch writes are allowed without confirmation only when every item in the batch is a pure `Last checked` refresh for a row with no meaningful changes.
- If a batch contains even one meaningful write, propose meaningful writes first and request confirmation before applying anything.

Use this exact proposal format:

```markdown
1. **<NAME>:**
   - **Target:** `<Notion page / GitHub item / canonical row>`
   - **Write type:** `<create / update / archive / delete / key merge / source merge / status update / visibility update / description update>`
   - **Current data:** `<current value or compact current row summary>`
   - **Suggested data:** `<suggested replacement>`
   - **Reason:** `<why this update is suggested>`

2. **<NAME>:**
   - **Target:** `<Notion page / GitHub item / canonical row>`
   - **Write type:** `<create / update / archive / delete / key merge / source merge / status update / visibility update / description update>`
   - **Current data:** `<current value or compact current row summary>`
   - **Suggested data:** `<suggested replacement>`
   - **Reason:** `<why this update is suggested>`

**Do you want me to apply these proposed writes?**
```

Do not apply any meaningful write without confirmation.

If approval is not available, report the proposed writes and reasons instead of applying them.

If the user approves only some items, apply only those approved items.

At the end of every run, report any rows refreshed without confirmation under this section:

#### Refreshed without confirmation

- `<NAME>` - `Last checked` refreshed because no meaningful changes were found.

### 5. Canonical row shape

For each canonical item:

- `Name`: Human-readable project/guide/reference name.
- `Category`: choose the best default category:
  - `Guide` for setup guides, reminders, playbooks, and study guides.
  - `Reference` for reusable knowledge, systems, notes, and conceptual material.
  - `Repo` for standalone GitHub repositories without a matching Notion page.
  - `Portfolio` for public portfolio/project pages and case-study pages.
  - `Tool` for standalone utilities/tools that are not primarily repos or guides.
  - `Other` only when no better category fits.
- `Description`: one sentence.
- `Source`: `Notion + GitHub` when both keys exist; otherwise `Notion`, `GitHub`, or `External`.
- `Notion Key`: clean clickable Notion URL when a Notion page exists.
- `GitHub Key`: clean clickable GitHub URL when a GitHub repo exists.
- `Visibility`: `Private` if any source is private unless the user explicitly marks it public-safe.
- `Status`: `Active` for canonical live entries.
- `Last checked`: today.

Do not create separate `Notion Link`, `GitHub Link`, `Source Link`, or `Canonical Key` columns. The key columns are both identity fields and clickable source links.

### Property-only Notion page updates

When updating an existing row through the Notion MCP `notion_update_page` tool with `"command": "update_properties"` and no body edits, always include `"content_updates": []` in the request. This is required for single page updates and for every item in batched page updates, even when only page properties change.

Keep all property values, including `null` or other remove-value markers, inside `properties`. Do not move property changes into `content_updates`. Do not change create or delete behaviour because of this rule.

Single property-only page update:

```json
{
  "page_id": "<page-id>",
  "command": "update_properties",
  "properties": {
    "GitHub Key": "github.com/<owner>/<repo>",
    "Status": "Active"
  },
  "content_updates": []
}
```

Batched page updates must apply the same shape to each property-only `notion_update_page` payload:

```json
[
  {
    "page_id": "<page-id-1>",
    "command": "update_properties",
    "properties": {
      "GitHub Key": "github.com/<owner>/<repo>",
      "Status": "Active"
    },
    "content_updates": []
  },
  {
    "page_id": "<page-id-2>",
    "command": "update_properties",
    "properties": {
      "GitHub Key": null,
      "Status": "Missing"
    },
    "content_updates": []
  }
]
```

### 6. Handle existing duplicates

When duplicate rows already exist:

1. Pick or update the canonical row.
2. Move all useful URL values into the canonical row's `Notion Key` and `GitHub Key`.
3. Mark uncertain duplicate rows as `Needs review`.
4. Mark stale or broken rows as `Stale` or `Missing` after checking the source.
5. Do not permanently delete rows unless the user explicitly asks.
6. Prefer using the grouped Category view so the user sees one row per thing in the correct section.

If a legacy database already has an `Archived` status option, you may use it for old duplicate rows only when the user wants them hidden. Do not add `Archived` to the clean default schema.

If a legacy database already has `Canonical Key`, do not require immediate deletion. Hide it from the default view first. Delete it only after the user confirms legacy cleanup.

### 7. Scheduled updater behaviour

When the user asks for a recurring updater, create a scheduled task that:

- Search Notion and GitHub for new, changed, removed, or renamed items.
- Use `Notion Key` and `GitHub Key` as the only hard identity checks before writing.
- Scheduled runs must propose meaningful writes instead of applying them automatically.
- Propose meaningful updates to existing canonical rows and get explicit approval before applying any meaningful write.
- May refresh safe check-only fields such as `Last checked` when the user requested a check/update run.
- Add new canonical rows only when no key or clear real-world match exists, with explicit current-turn confirmation.
- Do not add or update rows, identity keys, source fields, archive/delete state, or merge operations without explicit current-turn confirmation.
- Do not apply meaningful writes to existing rows without current-turn confirmation.
- Do not apply any meaningful write without confirmation in scheduled runs.
- Do not apply pure `Last checked` refreshes to rows with pending meaningful proposed writes.
- Only pure `Last checked` refreshes are approval-free.
- Batch writes without confirmation are allowed only when every batch item is a pure `Last checked` refresh with no meaningful change.
- Do not permanently delete anything.
- Report what changed after each run.

Replace the placeholder database name and data source URL with the user's actual Notion Knowledge Index details before using this prompt in an external scheduler.

#### Recommended Codex automation prompt

```text
Use the `knowledge-index-updater` skill.

Before doing anything else:
1. Locate and read the current `knowledge-index-updater/SKILL.md`.
2. Prefer the installed Codex skill folder if available.
3. If no installed skill is available, read `skills/knowledge-index-updater/SKILL.md` from the local `ai-agent-toolkit` repo.
4. If generated skill output is unavailable, read `_projects/knowledge/knowledge-index-updater/_main/skill/SKILL.md` from the local `ai-agent-toolkit` repo.
5. If no current skill file can be found, stop and report that the automation cannot safely run because it cannot load the current `knowledge-index-updater` rules.

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

## Output Format

After updating, respond with a compact summary:

```markdown
## Done ✅

Updated the Knowledge Index.

### Changes
- Added: <count>.
- Updated / merged: <count>.
- Marked Needs review: <count>.
- Marked Missing: <count>.

### Notable merges
- <Notion item> + <GitHub repo> → <canonical row>.

### View / schema
- Schema: Keys-only source fields.
- View: Grouped by Category, visible columns ordered as current default.

### Caveats
- <Any connector, URL, schema, or matching uncertainty>.
```

When no changes are needed, say that clearly and still mention the sources checked.

## Quality Checks

Before finalising:

- Confirm every created or updated row has `Name`, `Category`, `Description`, `Source`, `Visibility`, `Status`, and `Last checked`.
- Confirm rows with Notion sources have `Notion Key`.
- Confirm rows with GitHub sources have `GitHub Key`.
- Confirm there are no redundant `Notion Link`, `GitHub Link`, `Source Link`, or `Canonical Key` columns unless the user explicitly asked for them.
- Confirm confirmed merges or newly created rows with both keys use `Source = Notion + GitHub`.
- Confirm no duplicate active rows share the same `Notion Key` or `GitHub Key`.
- Confirm the default view is grouped by `Category` and hides empty category groups when supported.
- Confirm the visible columns are ordered: `Category`, `Name`, `Description`, `GitHub Key`, `Notion Key`, `Source`, `Last checked`, `Status`, `Visibility`.
- Confirm no destructive deletion occurred unless the user explicitly asked for deletion.
- Surface uncertainty instead of guessing.
