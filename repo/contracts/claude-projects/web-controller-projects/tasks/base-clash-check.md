# Weekly base clash check

Local Toolkit is the base, and Projects may differ from it only through `reference/base-overrides.md`. This weekly step finds new clashes so the owner decides them. It changes nothing itself.

**When:** once a week. A project with its own weekly audit runs it there. Otherwise the daily check-in runs it when the last `Base check:` line in its `state.md` is 7 or more days old, or missing.

1. Read `BASE` in the guidebook folder: one `<blob SHA> <path>` line per base file. Compare it with the `BASE` lines saved at the last check (in `state.md`, under `Base check:`).
2. **No change** and the hook table still matches: report one line, `Base check: no change`, and save today's date with the lines.
3. **A base file changed:** in a fresh clone of the Toolkit repository, read `git diff <old blob> <new blob>` for that file. Read the diff against `SKILL.md`, `reference/base-overrides.md` and `reference/cloud-hook-parity.md`. For each place the new base text and a Projects rule now say different things, and the overrides list has no row with an owner record for it, report `BASE CLASH: <file>: <one line>`. The coordinator puts each one to the owner as a question card, with its problem, fix and skip lines.
4. **Hooks:** list the hook scripts in `.claude-plugin/hooks/hooks.json`. A script with no row in `reference/cloud-hook-parity.md`, or one whose cloud behaviour changed in the diff, is a `BASE CLASH: hook <script>: <one line>`.
5. Save the new `BASE` lines and the date under `Base check:` in `state.md` only after every clash is reported.

Never edit the skill, the overrides list or the base to clear a clash: a change goes through a Toolkit PR after the owner answers.
