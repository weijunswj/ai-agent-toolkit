# Knowledge Index Updater

This skill maintains a clean Notion Knowledge Index backed by Notion pages and GitHub repos.

This README is written for an AI agent. Read it before using the skill.

## Supported platforms

This skill should support these platforms by default:

| Platform | Support notes |
|---|---|
| ChatGPT | Use `SKILL.md` and `agents/openai.yaml`. Requires Notion, GitHub, and automation connectors for full workflow. |
| Codex | Use the same skill folder inside the project skills location. Requires repo/tool access to Notion/GitHub workflows if available. |
| Claude | Use the same `SKILL.md` folder if Claude Skills are enabled. Skip Claude-specific setup if the account/workspace does not expose Skills. |
| Claude Code | Copy the skill folder into `~/.claude/skills/` for personal use or `.claude/skills/` for project use. |

If a platform cannot access Notion, GitHub, or scheduled tasks, explain the limitation and still provide a manual update plan.

## What this skill is for

Use this skill when the user wants to:

1. Build or update a one-stop Knowledge Index in Notion.
2. Keep Notion portfolio pages and GitHub repos in one clean table.
3. Avoid duplicate rows when the same thing exists in both Notion and GitHub.
4. Categorise guides, references, repos, portfolio pages, tools, and other items.
5. Run a daily updater that checks for new, changed, missing, or renamed sources.

## Required sources

The agent should use:

1. Notion connector.
2. GitHub connector.
3. Automation/scheduler tool when the user asks for recurring updates.

## Default Notion table

The table should be called:

```text
Knowledge Index
```

Default columns:

```text
Name
Category
Description
Source
Notion Key
GitHub Key
Visibility
Status
Last checked
```

Do not create these old columns:

```text
Notion Link
GitHub Link
Source Link
Related / Backlinks
Last reviewed
Canonical Key
```

## Key rule

The key columns are also the clickable links. `Notion Key` and `GitHub Key` are the only hard identity fields.

Use:

```text
Notion Key = notion.so/<page-id>
GitHub Key = github.com/<owner>/<repo>
```

Before creating a row, always query whether an existing row already has the same:

1. Notion Key.
2. GitHub Key.

If any key matches, use the existing row. Do not create a new row.

Do not use `Canonical Key` for matching, creating, merging, or deduplication. It is removed from the clean default schema because it is AI-generated and can drift. If an existing database still has `Canonical Key`, ignore it during scheduled runs unless the user explicitly asks for legacy cleanup. Hide it from the default view before deleting it, and delete it only after the user confirms cleanup.

## Existing row update confirmation

Default mode is **audit/propose first**.

No meaningful write may happen unless the user gives explicit current-turn approval for the exact write or exact batch of writes.

Meaningful writes that always require confirmation:

- Creating a Notion page/row.
- Updating `Name`, `Category`, `Description`, `Source`, `Notion Key`, `GitHub Key`, `Visibility`, `Status`.
- Adding, changing, or merging `Source`, `Notion Key`, `GitHub Key`, or `Canonical Key`.
- Appending source identity data to an existing row.
- Archiving rows.
- Deleting rows.
- Any GitHub write, issue, branch, PR, file, label, metadata, or repository mutation if the skill routes such work.

Allowed without confirmation:

- Search/read Notion.
- Search/read GitHub.
- Compare current data against desired data.
- Produce a proposed change list.
- Explain what would be written if approved.
- Refresh only `Last checked` when the row already exists, no meaningful change is needed for that row, and the user requested a check/update run.

Use this exact proposal style:

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

If a row already has a proposed meaningful change, do not refresh `Last checked` for that row until the proposal is approved or rejected.

If a batch contains even one meaningful write, propose meaningful writes first and request confirmation before applying anything.

Batch refresh without confirmation is allowed only when every batch item is a pure `Last checked` refresh for a row with no meaningful changes.

## Notion update payload rule

When using Notion MCP `notion_update_page` with `command: "update_properties"` for a property-only row update, always include `content_updates: []`.

This applies to single row updates and every item in batched updates, even when no page body edits are intended. Keep property values, including `null` remove-value cases, inside `properties`. Do not change create or delete behaviour because of this rule.

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

## Category rules

Use these categories:

| Category | Use for |
|---|---|
| Guide | Setup guides, playbooks, reminders, study guides. |
| Reference | Reusable notes, systems, conceptual material. |
| Repo | GitHub repos without a matching Notion page. |
| Portfolio | Public portfolio/project/case-study pages. |
| Tool | Standalone utilities/tools. |
| Other | Only when nothing else fits. |

## Default view

The default table view should be:

1. Table view.
2. Grouped by `Category`.
3. Empty groups hidden.
4. Visible columns in this order:
   1. Category
   2. Name
   3. Description
   4. GitHub Key
   5. Notion Key
   6. Source
   7. Last checked
   8. Status
   9. Visibility

## Merge examples

Use one row for these pairs:

| Notion page | GitHub repo | Canonical row |
|---|---|---|
| Local n8n Setup Guide | example-org/local-n8n-setup | Local n8n Setup |
| Secure CI/CD Installer guide | example-org/secure-cicd-installer | Secure CI/CD Installer |
| Playlist Deduplicator Agent | example-org/playlist-deduplicator-agent | Playlist Deduplicator Agent |
| Public Strategy Dashboard | example-org/public-strategy-dashboard | Public Strategy Dashboard |
| Daily Reminder Tool | example-org/daily-reminder-tool | Daily Reminder Tool |

## Status rules

Use:

| Status | Meaning |
|---|---|
| Active | Current canonical row. |
| Draft | Work in progress. |
| Stale | Source exists but may be outdated. |
| Missing | Source was checked and no longer exists. |
| Needs review | The agent is unsure and needs human review. |

Do not delete rows unless the user explicitly asks.

## Output after update

Always return a short summary:

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

### Caveats
- <Any uncertainty or tool limitation>.
```
