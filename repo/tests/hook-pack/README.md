# Hook test pack

One list of tool calls that every hook change must keep deciding the same way: calls that must pass (no false blocks) and calls that must stop (no leaks), including what happens when a hook itself breaks. `repo/scripts/toolkit-hook-pack.cjs` runs them through the hooks exactly as Claude Code and Codex start them: it reads both `hooks.json` files from a temporary copy of the plugin, matches each call against the real matchers, writes the plugin folder into the command and starts every matching hook as its own process with the call on stdin. On Windows the Codex hooks run through the PowerShell launcher setup installs. It then reads the decision the host would act on and checks that no fixture file changed.

## Running it

- `node repo/scripts/toolkit-hook-pack.cjs run`: every row on this computer's system. Add `--suite <kind>`, `--family <file name>`, `--rows <id,id>`, `--host claude|codex` or `--verbose` (prints each refusal's text).
- `node repo/scripts/toolkit-hook-pack.cjs run --against <commit>`: the revert proof. It runs the rows that commit's pack does not have (or `--rows`) against the plugin as it was there, and passes only when each one fails there. Run it against the parent of a fix to show the fix is what makes its rows pass; no hook script needs feeding by hand.
- `node repo/scripts/toolkit-hook-pack.cjs check-expectations`: lists every row removed, lowered to `known-bad` or changed in any other way since the base (hosts, event, payload, fixture, fault, expect, kind, source or note); only flipping a known-bad row toward passing (`status`, `known_bad_on`, `lane`, `added`) needs no reason. In a pull request each needs a line under a `## Pack changes` heading in the body: `<row id>: <why>`.
- `node repo/scripts/toolkit-hook-pack.cjs validate`: checks the row format only.

CI runs the pack on Linux and Windows in the `hook-pack` job of `validate.yml`, within a 6-minute budget each, and the `validate` job waits for it and runs the expectation-change check.

## Rows

Each file in `corpus/` is one family (the effect it guards: push, attribution, governance, merge, fault and so on), `{ "schema": "toolkit-hook-pack/v1", "family": "<file name>", "rows": [...] }`. A row:

- `id`: starts with a capital letter, unique in the pack.
- `source`: where the row came from (an incident, a review report, a seed).
- `kind`: the suite it belongs to: `benign` (must pass), `hostile` (must stop), `fault` (the hook breaks), `update` (the plugin folder changes mid-chat), `state` (a decision that depends on earlier sessions or transcripts) or `parity` (both hosts and shell readings must agree).
- `hosts`: `claude`, `codex` or both. A row on both hosts must decide the same on each, unless `expect_by_host` gives a host its own expectation and `note` says why.
- `event`: `PreToolUse` (the default), `PostToolUse` or `UserPromptSubmit`.
- `payload`: the call as the host sends it (`tool_name`, `tool_input`, or `prompt`). The runner adds `session_id`, `transcript_path`, `cwd` and `hook_event_name` unless the payload sets them.
- `fixture` (optional): `repo` with `governance` (`enabled`, `undecided` or `none`), `name`, `branch`, `commits` (`{ files, message }`, the default is one commit), `worktrees` (branch names, each its own working tree beside the working folder), `nested_worktrees` (`{ branch, commits }`, each its own working tree under the working folder's ignored `.tmp/worktrees/`, with its own commits), `staged` files, `task_auto_merge` (a governed fixture's merged task auto-merge answer), and for an `undecided` fixture `owner` (its remote's owner) and `cached_binding_store` (true: another governed repository on this computer has a cached programme binding naming `toolkit-test-fixture/<name>` as its evidence store); `gate_role` (`G0`, `G1` or `G2`: the session is a Toolkit gate run, as a launcher marks it); `owner_session` (true: the user started the session); `files` written into the working folder; `transcript` entries written to the session's transcript file.
- `fault` (optional): `deleted-plugin-root` (the plugin version folder is gone), `remove-file`, `throw-module` or `stall-module` with a `file` under `repo/scripts`, `bad-json` or `empty-input`.
- `expect`: `decision` (`allow` or `deny`) and optionally `reason`, the script name of the hook that refused (with `:failure` when the host refused because the hook itself failed). A refusal that comes only from a hook failing meets a row only when the row names that `:failure` reason, so a broken hook never stands in for a real decision. Never the refusal's text.
- `status`: `pass`, or `known-bad` for a bug its lane has not fixed yet, with `lane`, `added` (the date) and optionally `known_bad_on` (the hosts it fails on; all of them when absent). The runner fails when a known-bad row starts passing, so the fix flips it to `pass` in the same change.

Placeholders in a payload, fixture file or transcript: `{work}` (the working folder), `{trees}` (the extra working trees), `{home}` (the fixture's home), `{transcript}` (the session transcript) and `{credential}` (a fake credential built at run time, so none sits in the repository).

Each row gets its own fixture and home, so no row reads the real user's state or another row's; the home is put back as built before the second host runs.
