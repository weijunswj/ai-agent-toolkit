### Fixed

- **Merge hold reads a stdin script as unread:** a shell told to read its script from standard input, PowerShell's documented `-Command -` and `-c -` spelling (`echo '<script>' | pwsh -Command -`, `powershell -c -`), now counts as a shell whose script the reader cannot find, so from Toolkit's own folder it is refused on Claude Bash, Claude PowerShell and Codex, as `| bash` already was. A POSIX shell's `-c -` and `-c --` count the same way. Elsewhere it stays ordinary work.
