# Hook Design Playbook

Use this before adding a Toolkit hook, adding a rule inside an existing hook, or widening what a hook matches. Hooks run on every tool call of every session that loads Toolkit, so a hook that guesses wrong stops ordinary work everywhere at once.

## When A Hook Is Allowed

A hook is allowed only for one of these:

- An effect that cannot be undone or that leaks something: a merge, a push to the default branch, a force push, a credential in what a push sends, AI attribution in a commit or pull request, an agent recording an owner-only answer.
- A behaviour the owner named that a written rule has already failed to hold, and that a hook can check where it runs. A hook only acts in the host sessions that load the plugin: the Projects post hook was removed because the coordinator it was written for runs where Toolkit's hooks do not.

Everything else is a written rule in a playbook, a skill or the global rules. CI stays the backstop for checks it already runs (plain-text findings, skipped commit checks, personal data).

## What A Hook Checks

- **An exact effect, never intent.** Match a command and its arguments, a tool name, a path or a field. Never read free text (chat wording, report bodies, prompts, file contents being written) to guess whether a call means something. The readers that tried, a short-answer launch reader and a session resume reader, refused ordinary reads, metadata saves and reports and were removed.
- **One named failure.** The hook's header comment names the concrete failure it prevents, as the global rules ask of every safeguard.
- **Its own failure.** It says what happens when it cannot read the call or its own process fails: fail closed only where the effect is irreversible or leaks (the merge hold, the push guard), and fail open with a note everywhere else.

## Proportionate, Not Bank-Grade

A hook stops realistic agent slips, not a determined attacker, so it may accept a rare gap to avoid a common false block. Write each accepted gap down where the hook is described. For example, the push check reads a new or empty remote against what any remote already holds, so it does not re-read a long history on every first push; a credential already in history that another remote holds is not caught again when that history goes to the new remote.

## Tests

Every hook carries both kinds of rows:

- **Must-refuse rows** for each effect it exists to stop.
- **Must-pass rows** for ordinary daily commands near its pattern: reads of `.claude` and `.codex` folders, reports and metadata files that name Claude or Codex next to yes, no or ok, `grep -rn` and `head -c`, heredocs and here-strings, loops over file names, SSH reads. Run them in an enabled repository, a disabled one and a plain folder, on every shell tool name both hosts report.

CI runs the full pack on Linux and one Windows job per family. The nine Windows families, including closure-shell, each keep the 360-second pack budget; the required `validate` check waits for all of them. Sharding changes execution layout only: corpus rows, hosts and expectations stay intact.

## Owner Approval

A new hook, or a new rule inside a hook, needs the owner's yes on one line: what it stops, and what it might wrongly stop. Put that line in the pull request body.

## Review

At each release, and at least once a year, list the hooks with their false-block fixes and their real catches since the last review. A hook with repeated false-block fixes and no catch moves to a written rule.

## Closure command reader

The closure guard uses a default-deny reader over recognised executable command positions with separate flag-arity tables for PR create, PR edit, issue close and API calls. An unquoted guarded gh write found elsewhere in a command, including with a brace or equals sign attached to gh, is refused by name, including assignments with clean text and unknown wrappers, and so is a gh command whose noun, or whose verb under pr or issue, is not literal. The stop-parsing word and block comments are skipped first. The reader works on words, so substituted program names and functions defined outside the command stay accepted gaps. Quoted examples and arguments of echo, printf, Write-Output, Write-Host, Write-Warning, Write-Error, Write-Verbose, grep, rg, Select-String, cat, Get-Content, git and command lookups remain data. Literal heredoc bodies and here-strings are inspected as text; expansion is never executed. Supported condition positions, wrappers, substitutions and shell-fed heredocs are read as command positions. Recognised shell runners recurse only into their script argument. Heredoc and here-string data stay separate; executable shell heredocs, bounded loop bodies and PowerShell script blocks are inspected without expansion or execution. Unknown flags on a guarded write, duplicate scalar options and unresolved closure-sensitive text hold local writes.

Only supplied edit text is checked before an edit. Merge and CI checks retain responsibility for existing title, body and commits. PR closing targets pass without child traversal. Same-repository missing targets pass only after the inspected PR was read; cross-repository failures remain unknown. Clean supplied shell text needs no repository lookup; unresolved closing targets hold only the affected write. Codex checks closure before consuming a merge approval. A merge seen by the merge detector but unmatched by the command reader refuses with an unresolved-message reason and keeps its approval. Cloud connector merge-message text is checked, with unknown state advisory. Each hook invocation shares a monotonic deadline across origin, evidence and closure reads; the non-consuming merge pre-pass skips closure reads.

The supported wrappers are time, nohup, builtin, call, winpty, sudo, doas, nice, timeout, env, xargs, command and exec. Script arguments of POSIX shells, cmd and PowerShell are read, as are Start-Process, saps and start calls with one literal argument string and known options. Other gh argument forms are refused. A command lookup with command -v or -V remains data. These are bounded readers, not shell execution.

Wrapper option forms follow the reader's tables. PowerShell command options concatenate the remaining argument strings; quotation marks needed by that script must be present in those strings. Nested scripts retain outer expansion information, and an unreported shell uses conservative escape handling. Generated files and literal stdin follow one shared reader for PR and merge-message text.

## Real-host smoke and hook approval

A smoke never renames, swaps or edits files inside the installed plugin root. Codex fingerprints the whole bundle, so such edits revoke approval and make an apparent allow result meaningless. Install a candidate through the supported setup path, then let the owner approve its hooks in `/hooks`. Require a positive control refusal in the same fresh chat before counting any ALLOWED result. Record config hashes before and after without recording private config values.

The fixture pack exercises hook processes, not Codex approval or delivery. Nested code-mode shell calls reach the hooks as Bash, including PowerShell commands. In a 29 October 2026 test the outer JavaScript cell reached no hook; the capture planned to re-measure that on Codex 0.166 did not run. That cell, write_stdin into an already allowed shell and opaque Desktop REPL code remain accepted delivery gaps. Before a Codex gate launches, the installed hook-state `--check` must pass as the host contract defines; anything else holds the launch until the owner reviews `/hooks`.
