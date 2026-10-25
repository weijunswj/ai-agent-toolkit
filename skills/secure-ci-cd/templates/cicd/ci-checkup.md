# CI Check-Up

Use this to find out whether a repository's CI has fallen behind its code: new packages, languages, test folders or slower suites that CI does not cover yet. Setup through the main procedure is one-off; this check keeps it current.

## When To Run It

- At every release plan in a repository with Toolkit's GitHub governance on.
- While planning a change that touches CI, or adds a package, a language or a test folder. Use `--base <ref>` so the report covers only what the change touches.
- In final readiness audits.
- Whenever someone asks "is CI still up to date?" or asks for a CI check-up.

## Run

```text
node <toolkit>/skills/secure-ci-cd/scripts/ci-checkup.cjs --repo <path> [--base <ref>] [--runs <n>] [--no-github] [--json]
```

Run it from the Toolkit copy; do not copy it into the repository, so it never goes stale there. It is read-only: it reads files, lists them with git, and with a working `gh` login reads the job times of the last few green runs on the default branch and the default branch's required checks. It writes nothing, runs no repository code and needs no install. It starts `git` and `gh` only by full path from PATH folders outside the repository, from a working folder outside it, so a program planted in the repository never runs; it skips links that lead out of the repository; and `--base` never rewrites the git index and refuses a ref that starts with `-`. Without a `gh` login the job-time rows say "not checked (no GitHub access)" instead of guessing, and required checks it cannot read (classic branch protection needs admin) count as unknown, not as none.

## What It Compares

| Area | It flags |
|---|---|
| Parts | A package `test`, `lint`, `build` or `typecheck` script no CI step runs; a Go, Rust, Maven, Gradle or Python project no step builds or tests; a Dockerfile no step builds (not under examples, fixtures or `.devcontainer`) |
| Tests | A test file (`*.test.*`, `*.spec.*`, `test_*` and `*_test` Python, JavaScript or TypeScript files, `*_test.go`) or test folder no step reaches, directly, through a folder a reached script names, or through a test runner a CI command starts above it (only its targets, such as `discover -s tests`, when it names any) |
| Scripts | A script no test names, imports (including a bare Python import of a script folder) or runs through `python -m` or a package script name, after following `require`/`import`; a script CI or a package script starts (not one it only compiles, lints, syntax-checks or names in a comment), a test named after the script on whole name parts, and a thin `__main__.py` count as covered (always a CHECK) |
| Speed | No declared time budget; a budget no CI step checks; test files with no measured time; a job over budget; a test job with no matrix whose measured time is over the unsharded limit |
| Hygiene | An action not pinned to a full commit SHA; no `permissions:`; `continue-on-error`, `|| true`, `set +e`, or a custom shell template such as `bash {0}` without `-e` (plain `shell: bash` runs with `-e`); path filters on a pull request trigger when a job in that workflow is a required check, or when the required checks cannot be read or may belong to a job with an expression name or a reusable workflow (a required check that never runs stays "Pending"); no Dependabot `github-actions` entry |
| Status document | No CI status document (the setting, else the default path, else the one Markdown file named like a CI/CD status document that is not a template); a workflow it does not list; a workflow it lists that is gone |

Each line is `GAP` (clear and fixable), `CHECK` (needs judgement) or `OK`, with the file and a plain fix hint. The exit code is 0 for any report; it never fails a build by itself. Exit 2 means it could not run (bad arguments or a refused settings file).

## Settings

An optional `.github/ci-checkup.json` in the repository:

```json
{
  "schema": "ci-checkup/v1",
  "status_doc": "docs/ci-cd/CURRENT_CICD_STATUS.md",
  "budgets": { "job_seconds": 600, "unsharded_test_job_seconds": 300 },
  "ignore": [
    { "check": "scripts.untested", "path": "tools/", "reason": "one-off maintenance helpers, run by hand" }
  ]
}
```

- `status_doc` names the status document when it is not at the default path.
- `budgets` are seconds. Without `job_seconds` the report notes that no budget is declared. The 300-second unsharded test job value is a starting point, not a measurement; set the repository's own once job times are measured.
- Every `ignore` needs a known `check` and a reason of at least 12 characters; a `path` ending in `/` covers a folder. An ignore that matches nothing is reported so it can be removed. Add one only when the owner agrees the item is not a gap.

## Judge, Then Fix

1. Read each `GAP` and `CHECK`. Drop false alarms; the script lists candidates and the agent decides.
2. List the real gaps in the release plan or the current PR.
3. Fix clear gaps in a normal PR in that repository. This skill's approval gates still apply where the repository has no standing approval: ask before commit, push, PR, merge or deploy. Workflow edits get the review their risk tier needs.
4. Update the CI status document in the same PR, including its "Last CI check-up" line, so it stays the true record.

## Not Covered

Deeper workflow linting and security scanning (expression and shell checks, template injection, risky triggers) is the job of dedicated tools such as actionlint and zizmor. The check-up only suggests adding them as CI jobs through the main procedure and its approval gates; it installs nothing.
