Title: remove toolkit review fixes

### Fixed

- **Exact task removal:** `remove toolkit` now removes and exports the exact Task Scheduler task it found, so a task name with wildcard characters such as `[1]` can never match a different task. Two tasks with one name are left alone.
- **Copies and leftovers are kept:** a task carrying a recorded task's marker in another folder, and a recorded task that is still there but no longer Toolkit's, are now listed as changed by you and kept unless named with `--include`. Their record and the shared task runner stay with them.
- **Linked folders in the leftover report:** a linked `.github` folder is shown under "Not listed" instead of as the kept programme file, and a linked playbook folder is one line instead of one per playbook.
- **Plain results:** the apply result says "put back to the earlier value" and similar words instead of raw codes like `restored-previous`.
- **Damaged Codex line:** when the plan said Codex's `config.toml` is left alone because its Toolkit lines are damaged, apply no longer reports that as a failure or prints it twice.

### Changed

- **Typed merge:** a pull request that changes `toolkit-remove.cjs`, `toolkit-remove-parts.cjs` or `toolkit-commands.cjs` now always waits for the owner's typed merge.
- **How-to:** typed Toolkit commands get no line on the message that carries the governance question.
