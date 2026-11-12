Title: typed commands and remove Toolkit

### Added

- **Typed commands:** `toolkit cmd`, `toolkit command`, `toolkit refresh`, `toolkit setup` and `toolkit show env`, typed as the whole message on your own computer, are matched exactly by the Codex and Claude Code prompt hooks. The agent is told which action was asked for, so `toolkit show env` always opens the editor. A phrase inside a longer message, in a relayed message or in a cloud session stays plain text, and a governance hold is unchanged. `node repo/scripts/toolkit-commands.cjs` prints the command list.
- **Remove Toolkit from this computer:** `remove toolkit` routes to `repo/scripts/toolkit-remove.cjs`. `plan` lists every scheduled task that carries Toolkit's marker in any Task Scheduler folder, Toolkit's own task files and the Toolkit block in each global rules file, with a plan code. `apply --confirm <plan code>` removes exactly that list after the owner's OK; a list that changed removes nothing. Tasks changed by hand stay unless named, the owner's own listed tasks always stay, and no repository, key, settings file or plugin is touched.
- **Leftover file report:** `repo/scripts/toolkit-leftover-files.cjs scan` lists files that are provably Toolkit's in GitHub checkouts whose governance is off or undecided. It reports only and never deletes.

### Changed

- **Setup covers the computer only:** setup no longer prints a task plan for the managed checkout and the folder it was started in. The computer-wide task update under the saved approval stays, and the direct task plan still gives one repository's details.
- **Hook pack:** context checks now also read the context a prompt hook adds.
