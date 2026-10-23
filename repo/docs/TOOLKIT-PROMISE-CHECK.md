# Check controller promises

A promise is a follow-up the controller has committed to do when an event happens,
such as "Run the next review when the PR merges". Record its trigger and action so
the follow-up cannot disappear between check-ins. The controller owns the list.

## List format

Save a JSON file containing a `promises` array:

```json
{
  "promises": [
    {
      "id": "review-after-merge",
      "action": "Run the follow-up review and report its result",
      "trigger": { "type": "pr_merged", "repo": "example-owner/example-repo", "pr": 123 },
      "status": "open",
      "owner": "Coordinator"
    }
  ]
}
```

Or keep exactly one `toolkit-promises` fenced block in a text or Markdown file:

````markdown
# Controller memory

```toolkit-promises
{"promises":[{"id":"after-pass","action":"Start the follow-up review","trigger":{"type":"pass_file","path":"reports/check-PASS.md","contains":"Verdict: PASS"}}]}
```
````

Each entry needs a unique string `id`, a string `action` and a `trigger` object.
`status` is `open` by default, or `done`. Optional `owner`, `made_at` and `evidence`
are strings. Unknown keys, duplicate IDs and invalid triggers fail before lookups.
Done entries are counted without checking their triggers.

## Triggers

- `pr_merged`: Set `repo` to `owner/name` and `pr` to a positive integer.
  Fires when GitHub reports a non-null `merged_at`.
- `pass_file`: Set `path` to a local file, relative to the list file's folder.
  For a GitHub file, also set `repo` and optionally `ref` (default `main`).
  Optional `contains` requires a plain substring in the file text.
- `version_shipped`: Set `repo` and a `version` in `X.Y.Z` form.
  Optional `path` defaults to `repo/contracts/toolkit-local-bridge/version.json`;
  `ref` defaults to `main`. Fires when that JSON file's `version` is greater than
  or equal to the requested version. For example, `3.10.0` exceeds `3.9.9`.

## Run at every check-in

```text
node repo/scripts/toolkit-promise-check.cjs --list controller-memory.md
node repo/scripts/toolkit-promise-check.cjs --list promises.json --json
```

Run from a Toolkit checkout with Node.js. GitHub checks require authenticated `gh`
on PATH. Missing files or GitHub 404 responses mean the trigger has not happened;
other lookup failures are reported as "Could not check". Local checks need no `gh`.

- Claude Projects: Keep the list in project memory. The hourly nudge's cloud thread
  runs this script from a Toolkit checkout and reports every `Overdue promise:`
  line to the coordinator. Make the memory file available to that thread.
- Codex or terminal controller: Keep the list in the controller packet or transport
  store and run the script at each check-in.

## Results and action

Text output gives one line per promise: `Overdue promise:`, `Waiting:`,
`Could not check:` or `Done:`, followed by a count summary. `--json` instead emits
`overdue`, `waiting`, `unknown`, `done` arrays and `summary` counts.

Exit codes: `0` means no overdue or unknown promises; `1` means at least one overdue;
`2` means usage or input error; `3` means a lookup could not be completed.
Overdue takes priority over lookup failures. Fix input errors or retry failed checks.

An overdue promise means the follow-up is done now or explicitly handed back to
its owner, never silently dropped. Mark it `done` only once it is completed or the
handoff is explicit, and record the outcome in `evidence`.
