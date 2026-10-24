# Privacy-Safe Checks Playbook

Use this when a check, test, query, script, log or piece of evidence touches personal or private data (customer records, contact details, credentials, private business data), when writing fixtures or examples, or when reviewing a change for leaked personal data.

## Fixtures And Examples

- Use reserved fake values only: the `example.com`, `example.net` and `example.org` domains, the `.test`, `.example`, `.invalid` and `.internal` domains, synthetic names, and numbers nobody owns.
- Real values live only in runtime settings or the private evidence store, never in the repository.
- In tests, build personal-data shaped values at runtime from pieces (for example `local + '@' + domain`), so the test source itself stays clean under the personal-data guard without allow markers.

## Acquisition Before Projection

- Pick the acquisition call that returns only the fields you are allowed to use. Filtering after a whole record has crossed into your process is too late: the record is already in memory, logs, crash dumps and error paths.
- When the only API returns whole records, contain it behind a boundary (a child process, a database view, a server-side query) and let only the permitted fields cross that boundary on every path: success, error, retry, timeout and crash.
- State which boundary the claim covers. A test that proves nothing crosses a child process's output says nothing about what happens inside the child.

## Hash Where The Data Lives

- Run digests, counts and comparisons inside the store (a database-side digest or `COUNT(*)`), never fetch rows and hash them in the client. A client-side hash of fetched rows means the data left the store.
- Evidence records the exact query text and where it ran (database, host, role), so a reviewer can check the computation location.
- A hash of a low-entropy value (a phone number, an email address) can be reversed by trying every candidate. Never publish one as evidence.

## Synthetic Baseline Before Reliance

Before relying on a check against real data, run it on a synthetic baseline with the same shape (columns, encodings, separators, edge cases) and record that it gives the expected result.

## No Echo

- No matched value, part of one, or hash of one on stdout, stderr, error messages, logs, CI annotations, pull request or issue comments, or evidence files. Report the place, the class and the rule only.
- Keep error messages generic: a runtime parser error (for example from `JSON.parse`) can quote the input it failed on.

## Personal-Data Guard

The `secure-ci-cd` skill ships a zero-dependency guard (`skills/secure-ci-cd/scripts/personal-data-guard.cjs`) for email addresses, phone numbers and WhatsApp number links. It checks file content (including `.docx`, `.xlsx`, `.pptx` and PDF text), file names, commit and tag messages, branch names and pull request text, and never prints a value.

- Install it only on the owner's opt-in: `node <toolkit>/skills/secure-ci-cd/scripts/install-personal-data-guard.cjs --repo <repo> --identity <excluded|included> [--identity-reason <text>] --workflow`. It copies the guard to `.github/scripts/`, writes `.github/personal-data-guard.json`, and installs `pre-commit`, `commit-msg` and `pre-push` hooks in the folder git really uses (`core.hooksPath` included), keeping any existing hook. `--check` reports drift.
- Local hooks can be skipped with `--no-verify`. In a governed or guarded repository the Toolkit agent hooks refuse an agent's `git commit -n` or `--no-verify`, `git push --no-verify` and a changed `core.hooksPath`, but a person, a script or an alias can still skip them. The CI job is the backstop; make it part of a required check.
- In CI and in a reviewer's range check, a change cannot switch off scope or identity checks for itself: the base commit's config applies until the change is merged, and allow or `not_scanned` entries the change adds are named in the report. Review those notes like any other finding.
- Allow a public role address (`security@`, `noreply@` and similar) in the config `allow` list. Anything else needs a line-level `personal-data-guard: allow <reason>` marker, which every run counts. Content the guard cannot read (images, legacy Office files, archives) blocks unless the config lists its path with a reason, and every run prints that list.

## Review

- Check every commit in the pull request range plus its title and body, not only the final diff: `node .github/scripts/personal-data-guard.cjs range <base>..<head>` and `pr`. A value added in one commit and removed in a later one is still public once pushed.
- A claim that data stayed in place needs the computation location verified (the query and where it ran), not just an output that looks aggregated.
- If personal data was pushed, follow the incident steps in [Safety gates](safety-gates.md).
