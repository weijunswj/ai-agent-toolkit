<!--
Generated from toolkit project source. Do not edit directly.
Project: knowledge.knowledge-index-updater
Source: _projects/knowledge/knowledge-index-updater/_main/skill/references/update-confirmation.md
Update the project source and run sync.
-->
# Knowledge Index Update Confirmation

This reference preserves the detailed write-confirmation rules and proposal format for the `knowledge-index-updater` skill. Read it before preparing or applying Notion or GitHub writes, batch updates, duplicate merges, row creation, archive/delete actions, or scheduler write proposals.

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
