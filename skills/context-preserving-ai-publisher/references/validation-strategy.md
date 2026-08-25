# Validation Strategy

Use targeted validation while maintaining source-traceable AI-facing surfaces, then rely on the target repo's CI or documented full gate for PR-ready completion.

For this toolkit repo, the canonical full validation command is `npm run validate:all`. The read-only PR and `main` validation workflow should call that command directly and treat it as the required merge gate. Local agents should not run the full suite before every push when CI already runs the full gate.

## During Maintenance

Do not spam the full validation suite while files are still changing. Use narrow checks to localise failures:

- sync or generated-output freshness checks after manifest changes.
- source-lock or provenance audits after moving source material.
- surface audits after changing generated published files.
- focused tests for the script, validator, or policy changed.
- whitespace or diff checks before staging.

Targeted validation is for faster feedback, not weaker standards.

## Local Full Validation

Run local full validation when the target repo requires it, when the change is broad or risky, when workflow, sync, generator, packaging, or security-sensitive behavior changed, or when CI fails and local reproduction is needed.

If full validation fails, inspect the failing section, run the smallest relevant command to reproduce it, fix that issue, and retry the full suite after the targeted fix.

## Generated-Output Writeback

Auto-sync is optional convenience writeback for narrow deterministic generated-surface updates. It is not a substitute for the target repo's full validation gate.

For `_projects/**/_main/**` source or provenance changes, auto-sync should skip instead of blessing the PR. The author or Codex must update the source, source-lock/provenance metadata when needed, generated outputs, and audit baselines when needed, then rely on the target repo's full validation gate.

Read-only CI should catch missed steps by failing validation. Privileged writeback should not silently mutate source/provenance PRs.

## Local Law Wins

This is generic guidance. The target repo's local validation law, agent instructions, CI rules, and maintainer request always win over this file.
