### Fixed

- **Raw pushes to the evidence store:** the shell hook (Claude Code and the Codex helper hook) now refuses a raw `git push` to an evidence store that an enabled binding cached on this computer names, in every form the push checks read (`cd`, `git -C`, a URL, a nested shell, PowerShell), deletes included and dry runs excepted, and points at `toolkit-store.cjs save`. Before this, the permission blocks only left raw pushes out, so auto mode could run one with no prompt. Pushes to other repositories, the store command itself and computers with no cached binding are unchanged.
