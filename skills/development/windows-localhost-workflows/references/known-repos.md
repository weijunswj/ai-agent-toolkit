# Known Repository Startup Patterns

Use this file only after checking the generic workflow in `SKILL.md`.

## ian-trending-system

Known local pattern from previous Windows troubleshooting:

- App root: `ian-trending-system-web`.
- Normal URL: `http://localhost:3000`.
- Normal mode: local auth from `.env`.
- Working command: run the package manager's direct `pnpm dev` command from `ian-trending-system-web`.
- Common broken path: `start-local-dev.ps1` can fail when Corepack hits `.corepack` / `EPERM` issues.
- Reliable fallback: resolve `pnpm.cmd` with `Get-Command pnpm.cmd`, run it directly, and detach outside the sandbox if `spawn EPERM` appears.

Do not assume these paths apply to other repos.
