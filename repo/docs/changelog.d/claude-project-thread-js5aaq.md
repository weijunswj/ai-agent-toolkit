### Fixed

- Report Codex hooks changed since approval or unverified instead of saying they are on, and provide a read-only hook check that holds gate launches until approval is current.
- Refuse unreadable issue-close calls and PowerShell quoting that hides a GitHub write under Codex Bash, while preserving ordinary reads and quoted examples.
- Correct code-mode hook guidance and require smoke tests to prove a guard refusal without editing the installed plugin folder.
