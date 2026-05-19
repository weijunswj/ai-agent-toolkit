<!--
Generated from toolkit project source. Do not edit directly.
Project: meta.context-preserving-ai-publisher
Source: _projects/meta/context-preserving-ai-publisher/_main/validation-strategy.md
Update the project source and run sync.
-->
# Validation Strategy

Use targeted validation while maintaining source-traceable AI-facing surfaces, then run the target repo's full final validation before reporting completion.

## During Maintenance

Do not spam the full validation suite while files are still changing. Use narrow checks to localise failures:

- sync or generated-output freshness checks after manifest changes.
- source-lock or provenance audits after moving source material.
- surface audits after changing generated published files.
- focused tests for the script, validator, or policy changed.
- whitespace or diff checks before staging.

Targeted validation is for faster feedback, not weaker standards.

## Final Validation

Before saying the work is complete, run the target repo's documented full final validation. If the local repo requires a full suite, do not skip it.

If full validation fails, inspect the failing section, run the smallest relevant command to reproduce it, fix that issue, and retry the full suite after the targeted fix.

## Local Law Wins

This is generic guidance. The target repo's local validation law, agent instructions, CI rules, and maintainer request always win over this file.
