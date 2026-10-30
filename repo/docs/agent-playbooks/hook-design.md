# Hook Design Playbook

Use this before adding a Toolkit hook, adding a rule inside an existing hook, or widening what a hook matches. Hooks run on every tool call of every session that loads Toolkit, so a hook that guesses wrong stops ordinary work everywhere at once.

## When A Hook Is Allowed

A hook is allowed only for one of these:

- An effect that cannot be undone or that leaks something: a merge, a push to the default branch, a force push, a credential in what a push sends, AI attribution in a commit or pull request, an agent recording an owner-only answer.
- A behaviour the owner named that a written rule has already failed to hold, such as the Projects running post.

Everything else is a written rule in a playbook, a skill or the global rules. CI stays the backstop for checks it already runs (plain-text findings, skipped commit checks, personal data).

## What A Hook Checks

- **An exact effect, never intent.** Match a command and its arguments, a tool name, a path or a field. Never read free text (chat wording, report bodies, prompts, file contents being written) to guess whether a call means something. The readers that tried, a short-answer launch reader and a session resume reader, refused ordinary reads, metadata saves and reports and were removed.
- **One named failure.** The hook's header comment names the concrete failure it prevents, as the global rules ask of every safeguard.
- **Its own failure.** It says what happens when it cannot read the call or its own process fails: fail closed only where the effect is irreversible or leaks (the merge hold, the push guard), and fail open with a note everywhere else.

## Tests

Every hook carries both kinds of rows:

- **Must-refuse rows** for each effect it exists to stop.
- **Must-pass rows** for ordinary daily commands near its pattern: reads of `.claude` and `.codex` folders, reports and metadata files that name Claude or Codex next to yes, no or ok, `grep -rn` and `head -c`, heredocs and here-strings, loops over file names, SSH reads. Run them in an enabled repository, a disabled one and a plain folder, on every shell tool name both hosts report.

## Owner Approval

A new hook, or a new rule inside a hook, needs the owner's yes on one line: what it stops, and what it might wrongly stop. Put that line in the pull request body.

## Review

At each release, and at least once a year, list the hooks with their false-block fixes and their real catches since the last review. A hook with repeated false-block fixes and no catch moves to a written rule.
