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
Canonical Key
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
```

## Key rule

The key columns are also the clickable links.

Use:

```text
Notion Key = notion.so/<page-id>
GitHub Key = github.com/<owner>/<repo>
Canonical Key = stable-slug-for-the-real-thing
```

Before creating a row, always check whether an existing row already has the same:

1. Notion Key.
2. GitHub Key.
3. Canonical Key.

If any key matches, update the existing row. Do not create a new row.

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
   6. Canonical Key
   7. Source
   8. Last checked
   9. Status
   10. Visibility

## Merge examples

Use one row for these pairs:

| Notion page | GitHub repo | Canonical row |
|---|---|---|
| Codex + n8n Local Setup Guide | weijunswj/codex-n8n-local-setup | Codex + n8n Local Setup |
| AI CI/CD Installer guide | weijunswj/ai-cicd-installer | AI CI/CD Installer |
| Spotify Playlist Deduplicator Agent | weijunswj/spotify-playlist-deduplicator-agent | Spotify Playlist Deduplicator Agent |
| PhoenixSig page | weijunswj/TQQQ-PhoenixSig | PhoenixSig |
| TQQQ Covered Call Daily Reminder | weijunswj/tqqq-covered-call | TQQQ Covered Call |

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
