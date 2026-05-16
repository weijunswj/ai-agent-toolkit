---
name: knowledge-index-updater
description: update, clean, and maintain a personal notion knowledge index that consolidates notion pages, github repositories, guides, references, and portfolio items. use when the user asks to create or update a one-stop shop, merge notion and github duplicates, use notion key and github key url columns as clickable identity fields, categorise entries, generate short descriptions, create the default grouped category view, schedule daily checks, or mark missing/stale knowledge items without deleting them. supports chatgpt, codex, claude, and claude code where those platforms expose compatible skill loading and required connectors.
---

# Knowledge Index Updater

## Overview

Maintain a simple Notion Knowledge Index backed by Notion and GitHub. The index must stay lightweight: one canonical row per real project, guide, reference, repo, or portfolio item. Use URL/key fields as the identity of a row so repeated runs update existing rows instead of creating duplicates.

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
   - Notion cannot enforce database primary keys, so simulate them with `Notion Key`, `GitHub Key`, and `Canonical Key`.
   - `Notion Key` and `GitHub Key` are both clickable source URLs and identity fields.
   - Before creating any row, search/query existing rows and compare against these keys.
3. Index, do not duplicate.
   - Store short descriptions and source keys, not full guides or READMEs.
4. Be conservative.
   - Never permanently delete rows automatically.
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
- `Canonical Key` — rich text, normalized identity slug, e.g. `codex-n8n-local-setup`.
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

Do not create `Notion Link`, `GitHub Link`, `Source Link`, `Related / Backlinks`, `Last reviewed`, or `Archived` status in the default setup. If an old database already has those fields, migrate their useful values into the clean fields above and then remove the redundant columns when safe.

### Default database DDL

Use this DDL when creating a fresh index:

```sql
CREATE TABLE ("Name" TITLE, "Category" SELECT('Guide':blue, 'Reference':purple, 'Repo':green, 'Portfolio':yellow, 'Tool':orange, 'Other':gray), "Description" RICH_TEXT, "Source" SELECT('Notion':gray, 'GitHub':default, 'Notion + GitHub':blue, 'External':brown), "Notion Key" URL, "GitHub Key" URL, "Canonical Key" RICH_TEXT, "Visibility" SELECT('Private':red, 'Public-safe':green), "Status" SELECT('Active':green, 'Draft':yellow, 'Stale':orange, 'Missing':red, 'Needs review':purple), "Last checked" DATE)
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
  6. `Canonical Key`
  7. `Source`
  8. `Last checked`
  9. `Status`
  10. `Visibility`

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

### 3. Build identity keys before writing

For every candidate, derive keys:

- `Notion Key`: `notion.so/<page-id>` if a Notion page exists.
- `GitHub Key`: `github.com/<owner>/<repo>` if a GitHub repo exists.
- `Canonical Key`: normalized slug for the real thing.
  - Lowercase.
  - Remove punctuation.
  - Convert spaces/underscores to hyphens.
  - Prefer stable project slugs over verbose page titles.

Examples:

- `Codex + n8n Local Setup Guide` + `weijunswj/codex-n8n-local-setup` → `canonical key = codex-n8n-local-setup`.
- `AI CI/CD Installer — Universal GitHub Actions Setup Prompt` + `weijunswj/ai-cicd-installer` → `canonical key = ai-cicd-installer`.
- `Spotify Playlist Deduplicator Agent` + `weijunswj/spotify-playlist-deduplicator-agent` → `canonical key = spotify-playlist-deduplicator-agent`.
- `PhoenixSig — Public Strategy Dashboard...` + `weijunswj/TQQQ-PhoenixSig` → `canonical key = phoenixsig`.
- `TQQQ Covered Call Daily Reminder` + `weijunswj/tqqq-covered-call` → `canonical key = tqqq-covered-call`.

### 4. Match before creating rows

Before creating any row, check for an existing row where any of these match:

1. Existing `Notion Key` equals candidate `Notion Key`.
2. Existing `GitHub Key` equals candidate `GitHub Key`.
3. Existing `Canonical Key` equals candidate `Canonical Key`.
4. Strong semantic/slug match between project names.

If any strong match exists, update that row. Do not create a new row.

If unsure whether two items are the same, do not merge silently. Mark or create an item with `Status = Needs review` and explain the uncertainty.

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
- `Canonical Key`: stable normalized slug.
- `Visibility`: `Private` if any source is private unless the user explicitly marks it public-safe.
- `Status`: `Active` for canonical live entries.
- `Last checked`: today.

Do not create separate `Notion Link` or `GitHub Link` columns. The key columns are both identity fields and clickable source links.

### 6. Handle existing duplicates

When duplicate rows already exist:

1. Pick or update the canonical row.
2. Move all useful URL values into the canonical row's `Notion Key`, `GitHub Key`, and `Canonical Key`.
3. Mark uncertain duplicate rows as `Needs review`.
4. Mark stale or broken rows as `Stale` or `Missing` after checking the source.
5. Do not permanently delete rows unless the user explicitly asks.
6. Prefer using the grouped Category view so the user sees one row per thing in the correct section.

If a legacy database already has an `Archived` status option, you may use it for old duplicate rows only when the user wants them hidden. Do not add `Archived` to the clean default schema.

### 7. Scheduled updater behaviour

When the user asks for a recurring updater, create a scheduled task that:

- Searches Notion and GitHub for new, changed, removed, or renamed items.
- Uses `Notion Key`, `GitHub Key`, and `Canonical Key` as identity checks before writing.
- Updates existing canonical rows.
- Adds new canonical rows only when no key or strong match exists.
- Marks uncertain items as `Needs review` and confirmed missing sources as `Missing`.
- Does not permanently delete anything.
- Reports what changed after each run.

Recommended prompt:

```text
Search my Notion and GitHub for new, changed, removed, or renamed guides, references, portfolio pages, and repositories. Update my Notion Knowledge Index using one canonical row per real project, guide, reference, portfolio item, or repo. Treat Notion Key, GitHub Key, and Canonical Key as identity fields and clickable source fields: before creating any row, first look for an existing row with the same Notion Key, GitHub Key, or Canonical Key. Use Notion Key for notion.so/<page-id>. Use GitHub Key for github.com/<owner>/<repo>. Do not create separate Notion Link or GitHub Link columns. Merge Notion and GitHub items that refer to the same thing before creating rows. Set Source to Notion + GitHub when both exist. Update category, short description, visibility, status, and Last checked. Keep the table grouped by Category with visible columns ordered Category, Name, Description, GitHub Key, Notion Key, Canonical Key, Source, Last checked, Status, Visibility. Do not permanently delete anything. Mark uncertain duplicates as Needs review and confirmed missing sources as Missing. Tell me what changed.
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
- Confirm every canonical row has `Canonical Key`.
- Confirm rows with Notion sources have `Notion Key`.
- Confirm rows with GitHub sources have `GitHub Key`.
- Confirm there are no redundant `Notion Link` or `GitHub Link` columns unless the user explicitly asked for them.
- Confirm merged rows use `Source = Notion + GitHub`.
- Confirm no duplicate active rows share the same `Notion Key`, `GitHub Key`, or `Canonical Key`.
- Confirm the default view is grouped by `Category` and hides empty category groups when supported.
- Confirm the visible columns are ordered: `Category`, `Name`, `Description`, `GitHub Key`, `Notion Key`, `Canonical Key`, `Source`, `Last checked`, `Status`, `Visibility`.
- Confirm no destructive deletion occurred unless the user explicitly asked for deletion.
- Surface uncertainty instead of guessing.
