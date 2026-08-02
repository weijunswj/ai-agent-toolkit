# Deterministic Command Classification Contract

The classifier is adapter-neutral and model-free. It receives a shell name, command text, operation working directory, and explicit repository-resolution evidence. It returns structured classes and target evidence; it never executes a command or decides authority from a keyword alone.

## Supported forms

- POSIX shell: `sh`, `bash`, `zsh` and common file, redirection, pipeline, and nested-shell forms.
- PowerShell: `pwsh`, `powershell`, `Set-Content`, `Remove-Item`, `Move-Item`, `Get-Content`, `Invoke-*`, and nested `-Command` forms.
- Windows CMD: `cmd`, `cmd.exe`, `type`, `copy`, `move`, `del`, `erase`, `rmdir`, `ren`, redirection, and nested `/c` forms.
- Git: status, diff, add, commit, push, force push, reset, clean, restore, checkout, branch/tag deletion, rebase, and history-rewrite forms.

## Classification rules

1. Resolve target paths before treating a command as repository-local.
2. `.` and `..`, sibling repositories, parent workspaces, extra roots, Windows drives, case variants, symlinks, junctions, reparse points, redirects, and mixed target sets remain explicit evidence.
3. A compound command inherits the most restrictive component. Pipelines and redirections are inspected as separate effects.
4. Nested shell execution, opaque scripts, dynamic expansion, unresolved glob targets, and untrusted script bodies are `ask` or `unsupported`; they are never silently safe.
5. `git push` is routine only when it is non-force, targets the current authorized non-protected branch on the authorized remote, and the active prompt explicitly permits pushing.
6. Destructive local operations return `ask` unless a narrow exact approval is verified. Protected or catastrophic targets return `deny`.
7. Secret dumps, secret exfiltration, malicious activity, and guardrail-disable/bypass attempts return `deny`.
8. External-system, database, cloud, provider, deployment, GitHub issue/PR/review, and MCP mutations require exact trusted approval or a role-boundary `deny`.

## Privacy

The input command is used only for deterministic classification and digest computation. Results contain no raw command, raw prompt, raw target path, secret value, environment value, or unrestricted tool output.
