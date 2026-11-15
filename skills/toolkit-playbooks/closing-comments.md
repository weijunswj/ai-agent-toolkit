# Closing comments

Read when closing, merging or asking the owner to merge a PR or issue. Whoever closes the item or asks for the merge stays subscribed and posts the story when the merged or closed event arrives. This duty applies in every repository; it grants no merge or close permission.

## Post the story

Describe what shipped and why, the records and issues it settles, G2 and UAT verdicts with their full SHAs, and follow-ups. Use `Refs` before issue references, never close, fix or resolve words. Keep secrets out. Write the story to a local body file and run the installed reconciler command from the target repository's checkout:

```text
node <toolkit>/skills/github-program-reconciler/scripts/programme.cjs closing-comment --pr N --body-file story.txt --dry-run
node <toolkit>/skills/github-program-reconciler/scripts/programme.cjs closing-comment --pr N --body-file story.txt
```

Use `--issue N` instead of `--pr N` for an issue. The command uses the existing authenticated `gh` sign-in, appends the story marker, and reads the post back. It needs no programme binding and writes no programme state. It refuses open items, unsafe bodies and an existing story after this close. Use `--force-another` only when another story is intended. After an uncertain post, inspect comments before retrying. Hosts may add their own footer; this command adds none.

## Missing stories

Only a Toolkit story marker created after the close counts, by any author. An unmarked owner comment or a marker before the close does not count. The marker is `<!-- toolkit-closing kind=story -->`.

The hourly programme refresh checks governed repositories only. Its first complete PR and issue scans seed watermarks without reporting old closes. Later scans retain unread items for the next pass, with at most 60 comment requests while planning and 120 across planning, recovery and posting, inside the shared refresh time budget. An incomplete read never resolves that item's finding.

After a gap has remained open for 24 hours, refresh may append facts with `<!-- toolkit-closing kind=facts -->`, at most 20 per pass. It rechecks markers immediately before posting and settles the existing parent intent by readback, including after a crash. It never edits or deletes a closing comment. Facts leave the item waiting until a story appears. The waiting preview shows the full count and at most five lines; `programme.cjs attention` lists the rest. Historic backfills require their own approved operation.
